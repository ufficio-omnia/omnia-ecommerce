import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { downloadInvoice } from "@/app/actions/download";
import { deleteOrder, deleteUser } from "@/app/actions/admin";
import OpenInNewTabButton from "@/components/open-in-new-tab-button";
import DeleteButton from "@/components/delete-button";
import ReplyForm from "./reply-form";

type Company = {
  ragione_sociale: string | null;
  partita_iva: string | null;
  indirizzo: string | null;
  codice_sdi: string | null;
  pec: string | null;
};

type OrderRow = {
  id: string;
  status: string;
  payment_method: string | null;
  total_amount: number;
  created_at: string;
  products: { title: string } | null;
  invoices: { id: string } | null;
};

type Message = {
  id: string;
  sender: string;
  body: string;
  created_at: string;
};

export default async function AdminClientePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    redirect("/dashboard");
  }

  const { data: customer } = await supabase
    .from("users")
    .select("id, email, role, created_at")
    .eq("id", id)
    .single<{ id: string; email: string; role: string; created_at: string }>();

  if (!customer) {
    notFound();
  }

  const [{ data: company }, { data: ordersRaw }, { data: messagesRaw }] =
    await Promise.all([
      supabase
        .from("companies")
        .select("ragione_sociale, partita_iva, indirizzo, codice_sdi, pec")
        .eq("user_id", id)
        .maybeSingle<Company>(),
      supabase
        .from("orders")
        .select(
          "id, status, payment_method, total_amount, created_at, products(title), invoices(id)",
        )
        .eq("user_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("messages")
        .select("id, sender, body, created_at")
        .eq("user_id", id)
        .order("created_at", { ascending: true }),
    ]);

  const orders = ordersRaw as unknown as OrderRow[] | null;
  const messages = messagesRaw as unknown as Message[] | null;

  return (
    <main className="flex-1">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <Link
          href="/admin"
          className="font-mono text-xs tracking-wide text-sage uppercase hover:text-ink"
        >
          ← Pannello admin
        </Link>

        <div className="mt-4 flex items-start justify-between gap-4">
          <div>
            <h1 className="font-serif text-3xl text-ink">{customer.email}</h1>
            <p className="mt-1 text-sm text-sage">
              Ruolo: {customer.role} · Registrato il{" "}
              {new Date(customer.created_at).toLocaleDateString("it-IT")}
            </p>
          </div>
          <DeleteButton
            action={deleteUser}
            hiddenFields={{ userId: customer.id }}
            confirmMessage={`Eliminare definitivamente l'account di ${customer.email}? Verranno cancellati anche tutti i suoi ordini e fatture. L'operazione non è reversibile.`}
            label="Elimina utente"
            className="shrink-0 rounded-full border border-red-700 px-4 py-1.5 font-mono text-xs tracking-wide text-red-700 uppercase hover:bg-red-700 hover:text-cream"
          />
        </div>

        <section className="mt-8 rounded-2xl border border-border bg-cream-soft p-5">
          <h2 className="font-mono text-xs tracking-wide text-sage uppercase">
            Dati di fatturazione
          </h2>
          {company ? (
            <dl className="mt-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-sage">Ragione sociale</dt>
                <dd className="text-ink">{company.ragione_sociale ?? "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-sage">Partita IVA</dt>
                <dd className="text-ink">{company.partita_iva ?? "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-sage">Indirizzo</dt>
                <dd className="text-ink">{company.indirizzo ?? "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-sage">Codice SDI</dt>
                <dd className="text-ink">{company.codice_sdi ?? "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-sage">PEC</dt>
                <dd className="text-ink">{company.pec ?? "—"}</dd>
              </div>
            </dl>
          ) : (
            <p className="mt-3 text-sm text-sage">
              Nessun dato di fatturazione ancora inserito.
            </p>
          )}
        </section>

        <section className="mt-8">
          <h2 className="font-mono text-xs tracking-wide text-sage uppercase">
            Ordini
          </h2>
          <div className="mt-3 overflow-x-auto rounded-2xl border border-border bg-cream-soft">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead>
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-ink">Documento</th>
                  <th className="px-4 py-2 text-left font-medium text-ink">Stato</th>
                  <th className="px-4 py-2 text-left font-medium text-ink">
                    Pagamento
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-ink">Importo</th>
                  <th className="px-4 py-2 text-left font-medium text-ink">Data</th>
                  <th className="px-4 py-2 text-left font-medium text-ink">Fattura</th>
                  <th className="px-4 py-2 text-left font-medium text-ink"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {orders?.length ? (
                  orders.map((o) => (
                    <tr key={o.id}>
                      <td className="px-4 py-2 text-ink">{o.products?.title ?? "—"}</td>
                      <td className="px-4 py-2 text-ink">
                        {o.status === "pagato" ? (
                          <span className="text-forest">{o.status}</span>
                        ) : (
                          o.status
                        )}
                      </td>
                      <td className="px-4 py-2 text-ink">{o.payment_method ?? "—"}</td>
                      <td className="px-4 py-2 text-ink">
                        {Number(o.total_amount).toLocaleString("it-IT", {
                          style: "currency",
                          currency: "EUR",
                        })}
                      </td>
                      <td className="px-4 py-2 text-sage">
                        {new Date(o.created_at).toLocaleDateString("it-IT")}
                      </td>
                      <td className="px-4 py-2">
                        {o.invoices ? (
                          <OpenInNewTabButton
                            action={downloadInvoice}
                            hiddenFields={{ orderId: o.id }}
                            label="Scarica"
                            className="rounded-full border border-border-strong px-2 py-1 font-mono text-[10px] tracking-wide text-ink uppercase hover:bg-ink hover:text-cream"
                          />
                        ) : (
                          <span className="text-sage">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <DeleteButton
                          action={deleteOrder}
                          hiddenFields={{ orderId: o.id, userId: customer.id }}
                          confirmMessage="Eliminare definitivamente questo ordine? L'operazione non è reversibile."
                          label="Elimina"
                          className="font-mono text-[10px] tracking-wide text-red-700 uppercase hover:underline"
                        />
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-4 py-2 text-sage" colSpan={7}>
                      Nessun ordine.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-8">
          <h2 className="font-mono text-xs tracking-wide text-sage uppercase">
            Messaggi
          </h2>
          <div className="mt-3 space-y-3 rounded-2xl border border-border bg-cream-soft p-5">
            {messages?.length ? (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.sender === "admin" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                      m.sender === "admin"
                        ? "bg-forest text-cream"
                        : "border border-border bg-cream text-ink"
                    }`}
                  >
                    <p className="text-justify">{m.body}</p>
                    <p
                      className={`mt-1 text-[10px] ${
                        m.sender === "admin" ? "text-cream/70" : "text-sage"
                      }`}
                    >
                      {new Date(m.created_at).toLocaleString("it-IT")}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-sage">Nessun messaggio.</p>
            )}
          </div>
          <ReplyForm userId={customer.id} />
        </section>
      </div>
    </main>
  );
}
