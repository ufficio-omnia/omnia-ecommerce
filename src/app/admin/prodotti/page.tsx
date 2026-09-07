import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  createProduct,
  updateProduct,
  toggleProductActive,
  setProductDiscount,
  clearProductDiscount,
  addProductFile,
  removeProductFile,
} from "@/app/actions/products";
import { DeleteProductButton } from "./delete-product-button";

type ProductFile = {
  id: string;
  label: string;
  file_path: string;
  sort_order: number;
};

type Product = {
  id: string;
  title: string;
  category: string | null;
  description: string | null;
  price: number;
  active: boolean;
  discount_active: boolean;
  discount_price: number | null;
  product_files: ProductFile[];
};

const inputClass =
  "mt-1 w-full rounded-lg border border-border bg-cream px-3 py-2 text-sm text-ink focus:border-forest focus:outline-none";
const smallInputClass =
  "mt-1 rounded-lg border border-border bg-cream px-2 py-1 text-sm text-ink focus:border-forest focus:outline-none";
const ghostButtonClass =
  "rounded-full border border-border-strong px-2 py-1 font-mono text-[10px] tracking-wide text-ink uppercase hover:bg-ink hover:text-cream";

export default async function AdminProdottiPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error: errorMessage } = await searchParams;
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

  const { data: productsRaw } = await supabase
    .from("products")
    .select(
      "id, title, category, description, price, active, discount_active, discount_price, product_files(id, label, file_path, sort_order)",
    )
    .order("created_at", { ascending: false });

  const products = productsRaw as unknown as Product[] | null;

  return (
    <main className="flex-1">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <div className="flex items-center justify-between">
          <h1 className="font-serif text-3xl text-ink">Gestisci prodotti</h1>
          <Link
            href="/admin"
            className="rounded-full border border-border-strong px-4 py-1.5 font-mono text-xs tracking-wide text-ink uppercase transition-colors hover:bg-ink hover:text-cream"
          >
            Torna al pannello admin
          </Link>
        </div>

        {errorMessage && (
          <div className="mt-6 rounded-xl border border-red-700/40 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorMessage}
          </div>
        )}

        <section className="mt-10 rounded-2xl border border-border bg-cream-soft p-5">
          <h2 className="font-mono text-xs tracking-wide text-sage uppercase">
            Aggiungi nuovo prodotto
          </h2>
          <form action={createProduct} className="mt-3 space-y-3">
            <div>
              <label htmlFor="title" className="block text-sm font-medium text-ink">
                Titolo
              </label>
              <input id="title" name="title" type="text" required className={inputClass} />
            </div>
            <div>
              <label htmlFor="category" className="block text-sm font-medium text-ink">
                Categoria
              </label>
              <input id="category" name="category" type="text" className={inputClass} />
            </div>
            <div>
              <label htmlFor="price" className="block text-sm font-medium text-ink">
                Prezzo (€)
              </label>
              <input
                id="price"
                name="price"
                type="number"
                step="0.01"
                min="0.01"
                required
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="description" className="block text-sm font-medium text-ink">
                Descrizione
              </label>
              <textarea id="description" name="description" rows={2} className={inputClass} />
            </div>
            <button
              type="submit"
              className="rounded-full bg-forest px-4 py-2.5 font-mono text-xs tracking-wide text-cream uppercase transition-colors hover:bg-forest-dark"
            >
              Aggiungi prodotto
            </button>
          </form>
        </section>

        <section className="mt-10 space-y-6">
          <h2 className="font-mono text-xs tracking-wide text-sage uppercase">
            Prodotti esistenti
          </h2>

          {products?.length ? (
            products.map((p) => (
              <div
                key={p.id}
                className="rounded-2xl border border-border bg-cream-soft p-5"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-serif text-lg text-ink">
                      {p.title}{" "}
                      {!p.active && (
                        <span className="ml-2 rounded-full bg-border px-2 py-0.5 font-mono text-[10px] text-sage uppercase">
                          Disattivato
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-sage">{p.category ?? "—"}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <form action={toggleProductActive}>
                      <input type="hidden" name="productId" value={p.id} />
                      <input type="hidden" name="active" value={String(p.active)} />
                      <button type="submit" className={ghostButtonClass}>
                        {p.active ? "Disattiva" : "Riattiva"}
                      </button>
                    </form>
                    <DeleteProductButton productId={p.id} productTitle={p.title} />
                  </div>
                </div>

                <form action={updateProduct} className="mt-3 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="productId" value={p.id} />
                  <div>
                    <label className="block text-xs text-sage">Prezzo (€)</label>
                    <input
                      name="price"
                      type="number"
                      step="0.01"
                      min="0.01"
                      defaultValue={p.price}
                      required
                      className={`${smallInputClass} w-28`}
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs text-sage">Descrizione</label>
                    <input
                      name="description"
                      type="text"
                      defaultValue={p.description ?? ""}
                      className={`${smallInputClass} w-full`}
                    />
                  </div>
                  <button type="submit" className={ghostButtonClass}>
                    Salva
                  </button>
                </form>

                <div className="mt-4 border-t border-border pt-3">
                  <p className="font-mono text-xs tracking-wide text-sage uppercase">
                    Sconto
                  </p>

                  {p.discount_active ? (
                    <div className="mt-2 flex items-center gap-3 text-sm">
                      <span className="text-ink">
                        Sconto attivo:{" "}
                        <span className="font-medium">
                          {Number(p.discount_price).toLocaleString("it-IT", {
                            style: "currency",
                            currency: "EUR",
                          })}
                        </span>{" "}
                        <span className="text-sage line-through">
                          {Number(p.price).toLocaleString("it-IT", {
                            style: "currency",
                            currency: "EUR",
                          })}
                        </span>
                      </span>
                      <form action={clearProductDiscount}>
                        <input type="hidden" name="productId" value={p.id} />
                        <button type="submit" className={ghostButtonClass}>
                          Disattiva sconto
                        </button>
                      </form>
                    </div>
                  ) : (
                    <form
                      action={setProductDiscount}
                      className="mt-2 flex flex-wrap items-end gap-2"
                    >
                      <input type="hidden" name="productId" value={p.id} />
                      <div>
                        <label className="block text-xs text-sage">
                          Prezzo scontato (€)
                        </label>
                        <input
                          name="discountPrice"
                          type="number"
                          step="0.01"
                          min="0.01"
                          max={p.price}
                          required
                          className={`${smallInputClass} w-28`}
                        />
                      </div>
                      <button type="submit" className={ghostButtonClass}>
                        Attiva sconto
                      </button>
                    </form>
                  )}
                </div>

                <div className="mt-4 border-t border-border pt-3">
                  <p className="font-mono text-xs tracking-wide text-sage uppercase">
                    File inclusi ({p.product_files?.length ?? 0})
                  </p>
                  <ul className="mt-2 space-y-1">
                    {[...(p.product_files ?? [])]
                      .sort((a, b) => a.sort_order - b.sort_order)
                      .map((f) => (
                        <li
                          key={f.id}
                          className="flex items-center justify-between text-sm text-ink"
                        >
                          <span>
                            <span className="text-xs text-sage">
                              [{f.sort_order}]
                            </span>{" "}
                            {f.label}
                          </span>
                          <form action={removeProductFile}>
                            <input type="hidden" name="fileId" value={f.id} />
                            <button
                              type="submit"
                              className="text-xs text-red-700 hover:underline"
                            >
                              Rimuovi
                            </button>
                          </form>
                        </li>
                      ))}
                  </ul>

                  <form
                    action={addProductFile}
                    className="mt-3 flex flex-wrap items-end gap-2"
                  >
                    <input type="hidden" name="productId" value={p.id} />
                    <div>
                      <label className="block text-xs text-sage">
                        Etichetta file
                      </label>
                      <input
                        name="label"
                        type="text"
                        required
                        placeholder="es. Piano di lavoro (Excel)"
                        className={`${smallInputClass} w-56`}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-sage">Ordine</label>
                      <input
                        name="sortOrder"
                        type="number"
                        defaultValue={p.product_files?.length ?? 0}
                        className={`${smallInputClass} w-16`}
                      />
                    </div>
                    <input
                      type="file"
                      name="file"
                      required
                      className="text-xs text-ink"
                    />
                    <button type="submit" className={ghostButtonClass}>
                      Aggiungi file
                    </button>
                  </form>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-sage">Nessun prodotto.</p>
          )}
        </section>
      </div>
    </main>
  );
}
