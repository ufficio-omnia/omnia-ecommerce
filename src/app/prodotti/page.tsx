import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { effectivePrice } from "@/lib/products";

type ProductFile = {
  label: string;
  sort_order: number;
};

type Product = {
  id: string;
  title: string;
  description: string | null;
  price: number;
  discount_active: boolean;
  discount_price: number | null;
  product_files: ProductFile[];
};

export default async function ProdottiPage() {
  const supabase = await createClient();
  const { data: productsRaw } = await supabase
    .from("products")
    .select(
      "id, title, description, price, discount_active, discount_price, product_files(label, sort_order)",
    )
    .eq("active", true)
    .order("price", { ascending: true });

  const products = productsRaw as unknown as Product[] | null;

  return (
    <main className="flex-1">
      <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="text-center">
          <p className="font-mono text-xs tracking-widest text-forest uppercase">
            Catalogo
          </p>
          <h1 className="mt-3 font-serif text-3xl text-ink sm:text-4xl">
            Documenti disponibili
          </h1>
          <p className="mx-auto mt-3 max-w-md text-justify text-sm text-sage">
            Ogni pacchetto include tutti i file elencati, pronti da scaricare
            e personalizzare non appena il pagamento è confermato.
          </p>
        </div>

        <div className="mt-12 grid gap-6 sm:grid-cols-3">
          {products?.length ? (
            products.map((p) => {
              const files = [...(p.product_files ?? [])].sort(
                (a, b) => a.sort_order - b.sort_order,
              );
              const discounted =
                p.discount_active && p.discount_price != null;

              return (
                <div
                  key={p.id}
                  className="flex flex-col rounded-2xl border border-border bg-cream-soft p-6 transition-shadow hover:shadow-lg"
                >
                  <Link href={`/prodotti/${p.id}`}>
                    <h2 className="font-serif text-xl text-ink hover:text-forest">
                      {p.title}
                    </h2>
                  </Link>
                  <p className="mt-2 text-justify text-sm text-sage">{p.description}</p>

                  {files.length > 0 && (
                    <ul className="mt-4 space-y-1 text-sm text-sage">
                      {files.map((f, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="text-forest">•</span> {f.label}
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="mt-5 flex-1" />

                  <div className="mt-4">
                    {discounted && (
                      <span className="mb-1 inline-block rounded-full bg-forest/10 px-2 py-0.5 font-mono text-[10px] tracking-wide text-forest uppercase">
                        Sconto momentaneo
                      </span>
                    )}
                    <div className="flex items-baseline gap-2">
                      {discounted && (
                        <span className="text-sm text-sage line-through">
                          {Number(p.price).toLocaleString("it-IT", {
                            style: "currency",
                            currency: "EUR",
                          })}
                        </span>
                      )}
                      <span className="font-serif text-2xl text-ink">
                        {Number(effectivePrice(p)).toLocaleString("it-IT", {
                          style: "currency",
                          currency: "EUR",
                        })}
                      </span>
                    </div>
                  </div>

                  <Link
                    href={`/prodotti/${p.id}`}
                    className="mt-5 rounded-full bg-ink px-4 py-2.5 text-center font-mono text-xs tracking-wide text-cream uppercase transition-colors hover:bg-forest"
                  >
                    Acquista
                  </Link>
                </div>
              );
            })
          ) : (
            <p className="text-sm text-sage sm:col-span-3">
              Nessun documento disponibile al momento.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
