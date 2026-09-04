import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions/auth";
import { downloadDocument } from "@/app/actions/download";
import { IBAN, INTESTATARIO } from "@/lib/bank-details";

type OrderRow = {
  id: string;
  status: string;
  total_amount: number;
  created_at: string;
  products: { title: string } | null;
};

export default async function DashboardPage() {
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

  const { data: ordersRaw } = await supabase
    .from("orders")
    .select("id, status, total_amount, created_at, products(title)")
    .order("created_at", { ascending: false });

  const orders = ordersRaw as unknown as OrderRow[] | null;

  return (
    <main className="flex flex-1 flex-col px-4 py-16">
      <div className="mx-auto w-full max-w-2xl">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <form action={signOut}>
            <button
              type="submit"
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
            >
              Esci
            </button>
          </form>
        </div>

        <p className="mt-4 text-sm text-gray-600">
          Accesso effettuato come <span className="font-medium">{user.email}</span>.
        </p>

        {profile?.role === "admin" && (
          <Link
            href="/admin"
            className="mt-6 inline-block text-sm font-medium underline"
          >
            Vai al pannello admin
          </Link>
        )}

        <section className="mt-10">
          <h2 className="text-lg font-medium">I tuoi ordini</h2>
          <ul className="mt-3 space-y-3">
            {orders?.length ? (
              orders.map((o) => (
                <li
                  key={o.id}
                  className="rounded-md border border-gray-200 p-4"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">
                        {o.products?.title ?? "Documento"}
                      </p>
                      <p className="mt-1 text-xs text-gray-500">
                        {Number(o.total_amount).toLocaleString("it-IT", {
                          style: "currency",
                          currency: "EUR",
                        })}{" "}
                        ·{" "}
                        {o.status === "pagato" ? "Pagato" : "In attesa di pagamento"}
                      </p>
                    </div>

                    {o.status === "pagato" ? (
                      <form action={downloadDocument}>
                        <input type="hidden" name="orderId" value={o.id} />
                        <button
                          type="submit"
                          className="rounded-md bg-black px-3 py-1.5 text-sm font-medium text-white"
                        >
                          Scarica
                        </button>
                      </form>
                    ) : (
                      <span className="text-xs text-gray-400">
                        Non disponibile
                      </span>
                    )}
                  </div>

                  {o.status !== "pagato" && (
                    <dl className="mt-3 space-y-1 border-t border-gray-100 pt-3 text-xs">
                      <div className="flex justify-between">
                        <dt className="text-gray-500">IBAN</dt>
                        <dd className="font-medium">{IBAN}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-gray-500">Intestatario</dt>
                        <dd className="font-medium">{INTESTATARIO}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-gray-500">Causale</dt>
                        <dd className="font-mono font-medium">
                          Ordine {o.id.slice(0, 8)}
                        </dd>
                      </div>
                    </dl>
                  )}
                </li>
              ))
            ) : (
              <p className="text-sm text-gray-500">Nessun ordine.</p>
            )}
          </ul>
        </section>
      </div>
    </main>
  );
}
