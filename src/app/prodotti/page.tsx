import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

type ProductFile = {
  label: string;
  sort_order: number;
};

type Product = {
  id: string;
  title: string;
  description: string | null;
  price: number;
  product_files: ProductFile[];
};

export default async function ProdottiPage() {
  const supabase = await createClient();
  const { data: productsRaw } = await supabase
    .from("products")
    .select("id, title, description, price, product_files(label, sort_order)")
    .eq("active", true)
    .order("created_at", { ascending: false });

  const products = productsRaw as unknown as Product[] | null;

  return (
    <main className="flex flex-1 flex-col px-4 py-16">
      <div className="mx-auto w-full max-w-2xl">
        <h1 className="text-2xl font-semibold">Documenti disponibili</h1>

        <ul className="mt-6 space-y-4">
          {products?.length ? (
            products.map((p) => {
              const files = [...(p.product_files ?? [])].sort(
                (a, b) => a.sort_order - b.sort_order,
              );

              return (
                <li key={p.id} className="rounded-md border border-gray-200 p-4">
                  <Link href={`/prodotti/${p.id}`} className="font-medium underline">
                    {p.title}
                  </Link>
                  <p className="mt-1 text-sm text-gray-600">{p.description}</p>

                  {files.length > 0 && (
                    <ul className="mt-2 list-inside list-disc text-sm text-gray-600">
                      {files.map((f, i) => (
                        <li key={i}>{f.label}</li>
                      ))}
                    </ul>
                  )}

                  <div className="mt-3 flex items-center justify-between">
                    <p className="text-sm font-medium">
                      {Number(p.price).toLocaleString("it-IT", {
                        style: "currency",
                        currency: "EUR",
                      })}
                    </p>
                    <Link
                      href={`/prodotti/${p.id}`}
                      className="rounded-md bg-black px-3 py-1.5 text-sm font-medium text-white"
                    >
                      Acquista
                    </Link>
                  </div>
                </li>
              );
            })
          ) : (
            <p className="text-sm text-gray-500">Nessun documento disponibile.</p>
          )}
        </ul>
      </div>
    </main>
  );
}
