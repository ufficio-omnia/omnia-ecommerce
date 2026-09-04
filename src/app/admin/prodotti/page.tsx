import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  createProduct,
  updateProduct,
  toggleProductActive,
  addProductFile,
  removeProductFile,
} from "@/app/actions/products";

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
  product_files: ProductFile[];
};

export default async function AdminProdottiPage() {
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
      "id, title, category, description, price, active, product_files(id, label, file_path, sort_order)",
    )
    .order("created_at", { ascending: false });

  const products = productsRaw as unknown as Product[] | null;

  return (
    <main className="flex flex-1 flex-col px-4 py-16">
      <div className="mx-auto w-full max-w-3xl">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Gestisci prodotti</h1>
          <Link href="/admin" className="text-sm font-medium underline text-gray-600">
            Torna al pannello admin
          </Link>
        </div>

        <section className="mt-10 rounded-md border border-gray-200 p-4">
          <h2 className="text-lg font-medium">Aggiungi nuovo prodotto</h2>
          <form action={createProduct} className="mt-3 space-y-3">
            <div>
              <label htmlFor="title" className="block text-sm font-medium">
                Titolo
              </label>
              <input
                id="title"
                name="title"
                type="text"
                required
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="category" className="block text-sm font-medium">
                Categoria
              </label>
              <input
                id="category"
                name="category"
                type="text"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="price" className="block text-sm font-medium">
                Prezzo (€)
              </label>
              <input
                id="price"
                name="price"
                type="number"
                step="0.01"
                min="0.01"
                required
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="description" className="block text-sm font-medium">
                Descrizione
              </label>
              <textarea
                id="description"
                name="description"
                rows={2}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white"
            >
              Aggiungi prodotto
            </button>
          </form>
        </section>

        <section className="mt-10 space-y-6">
          <h2 className="text-lg font-medium">Prodotti esistenti</h2>

          {products?.length ? (
            products.map((p) => (
              <div key={p.id} className="rounded-md border border-gray-200 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">
                      {p.title}{" "}
                      {!p.active && (
                        <span className="ml-2 rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                          Disattivato
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-gray-500">{p.category ?? "—"}</p>
                  </div>
                  <form action={toggleProductActive}>
                    <input type="hidden" name="productId" value={p.id} />
                    <input type="hidden" name="active" value={String(p.active)} />
                    <button
                      type="submit"
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium hover:bg-gray-50"
                    >
                      {p.active ? "Disattiva" : "Riattiva"}
                    </button>
                  </form>
                </div>

                <form action={updateProduct} className="mt-3 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="productId" value={p.id} />
                  <div>
                    <label className="block text-xs text-gray-500">Prezzo (€)</label>
                    <input
                      name="price"
                      type="number"
                      step="0.01"
                      min="0.01"
                      defaultValue={p.price}
                      required
                      className="mt-1 w-28 rounded-md border border-gray-300 px-2 py-1 text-sm"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500">Descrizione</label>
                    <input
                      name="description"
                      type="text"
                      defaultValue={p.description ?? ""}
                      className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
                    />
                  </div>
                  <button
                    type="submit"
                    className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium hover:bg-gray-50"
                  >
                    Salva
                  </button>
                </form>

                <div className="mt-4 border-t border-gray-100 pt-3">
                  <p className="text-xs font-medium text-gray-600">
                    File inclusi ({p.product_files?.length ?? 0})
                  </p>
                  <ul className="mt-2 space-y-1">
                    {[...(p.product_files ?? [])]
                      .sort((a, b) => a.sort_order - b.sort_order)
                      .map((f) => (
                        <li
                          key={f.id}
                          className="flex items-center justify-between text-sm"
                        >
                          <span>
                            <span className="text-xs text-gray-400">
                              [{f.sort_order}]
                            </span>{" "}
                            {f.label}
                          </span>
                          <form action={removeProductFile}>
                            <input type="hidden" name="fileId" value={f.id} />
                            <button
                              type="submit"
                              className="text-xs text-red-600 hover:underline"
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
                      <label className="block text-xs text-gray-500">
                        Etichetta file
                      </label>
                      <input
                        name="label"
                        type="text"
                        required
                        placeholder="es. Piano di lavoro (Excel)"
                        className="mt-1 w-56 rounded-md border border-gray-300 px-2 py-1 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500">
                        Ordine
                      </label>
                      <input
                        name="sortOrder"
                        type="number"
                        defaultValue={p.product_files?.length ?? 0}
                        className="mt-1 w-16 rounded-md border border-gray-300 px-2 py-1 text-sm"
                      />
                    </div>
                    <input type="file" name="file" required className="text-xs" />
                    <button
                      type="submit"
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium hover:bg-gray-50"
                    >
                      Aggiungi file
                    </button>
                  </form>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-gray-500">Nessun prodotto.</p>
          )}
        </section>
      </div>
    </main>
  );
}
