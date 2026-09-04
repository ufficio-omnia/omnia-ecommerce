import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { effectivePrice } from "@/lib/products";

type Product = {
  id: string;
  title: string;
  description: string | null;
  price: number;
  discount_active: boolean;
  discount_price: number | null;
  product_files: { id: string }[];
};

export default async function Home() {
  const supabase = await createClient();
  const { data: productsRaw } = await supabase
    .from("products")
    .select(
      "id, title, description, price, discount_active, discount_price, product_files(id)",
    )
    .eq("active", true)
    .order("price", { ascending: true });

  const products = (productsRaw ?? []) as unknown as Product[];

  return (
    <main className="flex-1">
      <section className="border-b border-border">
        <div className="mx-auto max-w-4xl px-4 py-20 text-center sm:px-6 sm:py-28">
          <p className="font-mono text-xs tracking-widest text-forest uppercase">
            Documenti per gare d&apos;appalto
          </p>
          <h1 className="mt-5 font-serif text-4xl leading-tight font-medium text-ink sm:text-5xl">
            L&apos;offerta tecnica pronta.
            <br />
            <span className="text-forest italic">Da scaricare oggi.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-sage">
            Facsimile e modelli professionali per la tua partecipazione a
            gare d&apos;appalto: relazione tecnica, piani di lavoro,
            organigrammi e check list, pronti da personalizzare.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Link
              href="/prodotti"
              className="rounded-full bg-forest px-6 py-3 font-mono text-xs tracking-wide text-cream uppercase transition-colors hover:bg-forest-dark"
            >
              Scopri i pacchetti
            </Link>
            <Link
              href="/login"
              className="rounded-full border border-border-strong px-6 py-3 font-mono text-xs tracking-wide text-ink uppercase transition-colors hover:bg-ink hover:text-cream"
            >
              Accedi all&apos;area riservata
            </Link>
          </div>
        </div>
      </section>

      {products.length > 0 && (
        <section className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-20">
          <h2 className="text-center font-serif text-2xl text-ink sm:text-3xl">
            Scegli il tuo pacchetto
          </h2>
          <p className="mx-auto mt-2 max-w-md text-center text-sm text-sage">
            Un prezzo fisso, tutti i documenti inclusi, download immediato
            dopo il pagamento.
          </p>

          <div className="mt-10 grid gap-6 sm:grid-cols-3">
            {products.map((p) => {
              const discounted =
                p.discount_active && p.discount_price != null;

              return (
                <div
                  key={p.id}
                  className="flex flex-col rounded-2xl border border-border bg-cream-soft p-6 transition-shadow hover:shadow-lg"
                >
                  <h3 className="font-serif text-xl text-ink">{p.title}</h3>
                  <p className="mt-2 flex-1 text-sm text-sage">
                    {p.description}
                  </p>

                  <p className="mt-4 text-xs text-sage">
                    {p.product_files?.length ?? 0}{" "}
                    {p.product_files?.length === 1
                      ? "documento incluso"
                      : "documenti inclusi"}
                  </p>

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
            })}
          </div>
        </section>
      )}
    </main>
  );
}
