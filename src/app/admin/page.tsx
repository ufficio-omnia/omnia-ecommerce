import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

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

  const [{ data: users }, { data: orders }] = await Promise.all([
    supabase
      .from("users")
      .select("id, email, role, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("orders")
      .select("id, user_id, status, payment_method, total_amount, created_at")
      .order("created_at", { ascending: false }),
  ]);

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
                  <th className="px-4 py-2 text-left font-medium">Stato</th>
                  <th className="px-4 py-2 text-left font-medium">
                    Pagamento
                  </th>
                  <th className="px-4 py-2 text-left font-medium">Importo</th>
                  <th className="px-4 py-2 text-left font-medium">Data</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {orders?.length ? (
                  orders.map((o) => (
                    <tr key={o.id}>
                      <td className="px-4 py-2">{o.status}</td>
                      <td className="px-4 py-2">{o.payment_method ?? "—"}</td>
                      <td className="px-4 py-2">
                        {o.total_amount.toLocaleString("it-IT", {
                          style: "currency",
                          currency: "EUR",
                        })}
                      </td>
                      <td className="px-4 py-2">
                        {new Date(o.created_at).toLocaleDateString("it-IT")}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-4 py-2 text-gray-500" colSpan={4}>
                      Nessun ordine (funzionalità e-commerce non ancora
                      implementata).
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
