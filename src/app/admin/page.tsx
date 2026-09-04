import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { markOrderAsPaid, uploadInvoice } from "@/app/actions/admin";

type OrderRow = {
  id: string;
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
        "id, status, payment_method, total_amount, created_at, users(email), products(title), invoices(id)",
      )
      .order("created_at", { ascending: false }),
  ]);

  const orders = ordersRaw as unknown as OrderRow[] | null;

  return (
    <main className="flex flex-1 flex-col px-4 py-16">
      <div className="mx-auto w-full max-w-4xl">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Pannello admin</h1>
          <Link
            href="/dashboard"
            className="text-sm font-medium underline text-gray-600"
          >
            Torna alla dashboard
          </Link>
        </div>

        <section className="mt-10">
          <h2 className="text-lg font-medium">Utenti</h2>
          <div className="mt-3 overflow-x-auto rounded-md border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Email</th>
                  <th className="px-4 py-2 text-left font-medium">Ruolo</th>
                  <th className="px-4 py-2 text-left font-medium">
                    Registrato il
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {users?.length ? (
                  users.map((u) => (
                    <tr key={u.id}>
                      <td className="px-4 py-2">{u.email}</td>
                      <td className="px-4 py-2">{u.role}</td>
                      <td className="px-4 py-2">
                        {new Date(u.created_at).toLocaleDateString("it-IT")}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-4 py-2 text-gray-500" colSpan={3}>
                      Nessun utente.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-medium">Ordini</h2>
          <div className="mt-3 overflow-x-auto rounded-md border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Ordine</th>
                  <th className="px-4 py-2 text-left font-medium">Cliente</th>
                  <th className="px-4 py-2 text-left font-medium">
                    Documento
                  </th>
                  <th className="px-4 py-2 text-left font-medium">Stato</th>
                  <th className="px-4 py-2 text-left font-medium">
                    Pagamento
                  </th>
                  <th className="px-4 py-2 text-left font-medium">Importo</th>
                  <th className="px-4 py-2 text-left font-medium">Data</th>
                  <th className="px-4 py-2 text-left font-medium">Azione</th>
                  <th className="px-4 py-2 text-left font-medium">Fattura</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {orders?.length ? (
                  orders.map((o) => (
                    <tr key={o.id}>
                      <td className="px-4 py-2 font-mono text-xs">
                        {o.id.slice(0, 8)}
                      </td>
                      <td className="px-4 py-2">{o.users?.email ?? "—"}</td>
                      <td className="px-4 py-2">{o.products?.title ?? "—"}</td>
                      <td className="px-4 py-2">{o.status}</td>
                      <td className="px-4 py-2">{o.payment_method ?? "—"}</td>
                      <td className="px-4 py-2">
                        {Number(o.total_amount).toLocaleString("it-IT", {
                          style: "currency",
                          currency: "EUR",
                        })}
                      </td>
                      <td className="px-4 py-2">
                        {new Date(o.created_at).toLocaleDateString("it-IT")}
                      </td>
                      <td className="px-4 py-2">
                        {o.status === "in_attesa" ? (
                          <form action={markOrderAsPaid}>
                            <input type="hidden" name="orderId" value={o.id} />
                            <button
                              type="submit"
                              className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium hover:bg-gray-50"
                            >
                              Segna come pagato
                            </button>
                          </form>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {o.status !== "pagato" ? (
                          "—"
                        ) : o.invoices ? (
                          "Caricata"
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
                              className="w-32 text-xs"
                            />
                            <button
                              type="submit"
                              className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium hover:bg-gray-50"
                            >
                              Carica
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-4 py-2 text-gray-500" colSpan={9}>
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
