import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { markOrderAsPaid, uploadInvoice, deleteOrder } from "@/app/actions/admin";
import DeleteButton from "@/components/delete-button";

type OrderRow = {
  id: string;
  user_id: string;
  status: string;
  payment_method: string | null;
  total_amount: number;
  created_at: string;
  users: { email: string } | null;
  products: { title: string } | null;
  invoices: { id: string } | null;
};

export default async function AdminPage() {
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

  const [{ data: users }, { data: ordersRaw }] = await Promise.all([
    supabase
      .from("users")
      .select("id, email, role, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("orders")
      .select(
        "id, user_id, status, payment_method, total_amount, created_at, users(email), products(title), invoices(id)",
      )
      .order("created_at", { ascending: false }),
  ]);

  const orders = ordersRaw as unknown as OrderRow[] | null;

  return (
    <main className="flex-1">
      <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
        <div className="flex items-center justify-between">
          <h1 className="font-serif text-3xl text-ink">Pannello admin</h1>
          <Link
            href="/admin/prodotti"
            className="rounded-full border border-border-strong px-4 py-1.5 font-mono text-xs tracking-wide text-ink uppercase transition-colors hover:bg-ink hover:text-cream"
          >
            Gestisci prodotti
          </Link>
        </div>

        <section className="mt-10">
          <h2 className="font-mono text-xs tracking-wide text-sage uppercase">
            Utenti
          </h2>
          <div className="mt-3 overflow-x-auto rounded-2xl border border-border bg-cream-soft">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead>
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-ink">Email</th>
                  <th className="px-4 py-2 text-left font-medium text-ink">Ruolo</th>
                  <th className="px-4 py-2 text-left font-medium text-ink">
                    Registrato il
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users?.length ? (
                  users.map((u) => (
                    <tr key={u.id} className="hover:bg-cream">
                      <td className="px-4 py-2">
                        <Link
                          href={`/admin/clienti/${u.id}`}
                          className="text-ink underline hover:text-forest"
                        >
                          {u.email}
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-ink">{u.role}</td>
                      <td className="px-4 py-2 text-sage">
                        {new Date(u.created_at).toLocaleDateString("it-IT")}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-4 py-2 text-sage" colSpan={3}>
                      Nessun utente.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-10">
          <h2 className="font-mono text-xs tracking-wide text-sage uppercase">
            Ordini
          </h2>
          <div className="mt-3 overflow-x-auto rounded-2xl border border-border bg-cream-soft">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead>
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-ink">Ordine</th>
                  <th className="px-4 py-2 text-left font-medium text-ink">Cliente</th>
                  <th className="px-4 py-2 text-left font-medium text-ink">
                    Documento
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-ink">Stato</th>
                  <th className="px-4 py-2 text-left font-medium text-ink">
                    Pagamento
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-ink">Importo</th>
                  <th className="px-4 py-2 text-left font-medium text-ink">Data</th>
                  <th className="px-4 py-2 text-left font-medium text-ink">Azione</th>
                  <th className="px-4 py-2 text-left font-medium text-ink">Fattura</th>
                  <th className="px-4 py-2 text-left font-medium text-ink"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {orders?.length ? (
                  orders.map((o) => (
                    <tr key={o.id}>
                      <td className="px-4 py-2 font-mono text-xs text-sage">
                        {o.id.slice(0, 8)}
                      </td>
                      <td className="px-4 py-2 text-ink">{o.users?.email ?? "—"}</td>
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
                        {o.status === "in_attesa" ? (
                          <form action={markOrderAsPaid}>
                            <input type="hidden" name="orderId" value={o.id} />
                            <button
                              type="submit"
                              className="rounded-full border border-border-strong px-2 py-1 font-mono text-[10px] tracking-wide text-ink uppercase hover:bg-ink hover:text-cream"
                            >
                              Segna come pagato
                            </button>
                          </form>
                        ) : (
                          <span className="text-sage">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {o.status !== "pagato" ? (
                          <span className="text-sage">—</span>
                        ) : o.invoices ? (
                          <span className="text-forest">Caricata</span>
                        ) : (
                          <form
                            action={uploadInvoice}
                            className="flex items-center gap-1"
                          >
                            <input type="hidden" name="orderId" value={o.id} />
                            <input
                              type="file"
                              name="file"
                              accept="application/pdf"
                              required
                              className="w-32 text-xs text-ink"
                            />
                            <button
                              type="submit"
                              className="rounded-full border border-border-strong px-2 py-1 font-mono text-[10px] tracking-wide text-ink uppercase hover:bg-ink hover:text-cream"
                            >
                              Carica
                            </button>
                          </form>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <DeleteButton
                          action={deleteOrder}
                          hiddenFields={{ orderId: o.id, userId: o.user_id }}
                          confirmMessage="Eliminare definitivamente questo ordine? L'operazione non è reversibile."
                          label="Elimina"
                          className="font-mono text-[10px] tracking-wide text-red-700 uppercase hover:underline"
                        />
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-4 py-2 text-sage" colSpan={10}>
                      Nessun ordine.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
