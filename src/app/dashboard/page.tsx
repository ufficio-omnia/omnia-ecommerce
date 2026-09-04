import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { downloadDocument, downloadInvoice } from "@/app/actions/download";
import { IBAN, INTESTATARIO } from "@/lib/bank-details";

type OrderRow = {
  id: string;
  status: string;
  total_amount: number;
  created_at: string;
  products: {
    title: string;
    product_files: { id: string; label: string }[];
  } | null;
  invoices: { id: string } | null;
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: ordersRaw } = await supabase
    .from("orders")
    .select(
      "id, status, total_amount, created_at, products(title, product_files(id, label)), invoices(id)",
    )
    .order("created_at", { ascending: false });

  const orders = ordersRaw as unknown as OrderRow[] | null;

  return (
    <main className="flex-1">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <h1 className="font-serif text-3xl text-ink">Dashboard</h1>
        <p className="mt-2 text-sm text-sage">
          Accesso effettuato come{" "}
          <span className="font-medium text-ink">{user.email}</span>.
        </p>

        <section className="mt-10">
          <h2 className="font-mono text-xs tracking-wide text-sage uppercase">
            I tuoi ordini
          </h2>
          <ul className="mt-4 space-y-4">
            {orders?.length ? (
              orders.map((o) => (
                <li
                  key={o.id}
                  className="rounded-2xl border border-border bg-cream-soft p-5"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-serif text-lg text-ink">
                        {o.products?.title ?? "Documento"}
                      </p>
                      <p className="mt-1 text-xs text-sage">
                        {Number(o.total_amount).toLocaleString("it-IT", {
                          style: "currency",
                          currency: "EUR",
                        })}{" "}
                        ·{" "}
                        {o.status === "pagato" ? (
                          <span className="text-forest">Pagato</span>
                        ) : (
                          "In attesa di pagamento"
                        )}
                      </p>
                      <p className="mt-1 text-xs text-sage">
                        Ordine:{" "}
                        <span className="font-mono">{o.id.slice(0, 8)}</span>
                      </p>
                    </div>

                    {o.status === "pagato" ? (
                      o.invoices && (
                        <form action={downloadInvoice}>
                          <input type="hidden" name="orderId" value={o.id} />
                          <button
                            type="submit"
                            className="rounded-full border border-border-strong px-3 py-1.5 font-mono text-xs tracking-wide text-ink uppercase transition-colors hover:bg-ink hover:text-cream"
                          >
                            Fattura
                          </button>
                        </form>
                      )
                    ) : (
                      <span className="font-mono text-xs text-sage uppercase">
                        Non disponibile
                      </span>
                    )}
                  </div>

                  {o.status === "pagato" && (
                    <ul className="mt-4 space-y-2 border-t border-border pt-4">
                      {o.products?.product_files?.length ? (
                        o.products.product_files.map((f) => (
                          <li
                            key={f.id}
                            className="flex items-center justify-between text-sm text-ink"
                          >
                            <span>{f.label}</span>
                            <form action={downloadDocument}>
                              <input type="hidden" name="orderId" value={o.id} />
                              <input type="hidden" name="fileId" value={f.id} />
                              <button
                                type="submit"
                                className="rounded-full bg-forest px-3 py-1.5 font-mono text-[10px] tracking-wide text-cream uppercase transition-colors hover:bg-forest-dark"
                              >
                                Scarica
                              </button>
                            </form>
                          </li>
                        ))
                      ) : (
                        <p className="text-xs text-sage">
                          Nessun file disponibile per questo prodotto.
                        </p>
                      )}
                    </ul>
                  )}

                  {o.status !== "pagato" && (
                    <dl className="mt-4 space-y-1 border-t border-border pt-4 text-xs">
                      <div className="flex justify-between">
                        <dt className="text-sage">IBAN</dt>
                        <dd className="font-medium text-ink">{IBAN}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-sage">Intestatario</dt>
                        <dd className="font-medium text-ink">{INTESTATARIO}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-sage">Causale</dt>
                        <dd className="font-mono font-medium text-ink">
                          Ordine {o.id.slice(0, 8)}
                        </dd>
                      </div>
                    </dl>
                  )}
                </li>
              ))
            ) : (
              <p className="text-sm text-sage">Nessun ordine.</p>
            )}
          </ul>
        </section>
      </div>
    </main>
  );
}
