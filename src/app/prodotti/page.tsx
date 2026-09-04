import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function ProdottiPage() {
  const supabase = await createClient();
  const { data: products } = await supabase
    .from("products")
    .select("id, title, description, price")
    .order("created_at", { ascending: false });

  return (
    <main className="flex flex-1 flex-col px-4 py-16">
      <div className="mx-auto w-full max-w-2xl">
        <h1 className="text-2xl font-semibold">Documenti disponibili</h1>

        <ul className="mt-6 space-y-4">
          {products?.length ? (
            products.map((p) => (
              <li key={p.id} className="rounded-md border border-gray-200 p-4">
                <Link href={`/prodotti/${p.id}`} className="font-medium underline">
                  {p.title}
                </Link>
                <p className="mt-1 text-sm text-gray-600">{p.description}</p>
                <p className="mt-2 text-sm font-medium">
                  {Number(p.price).toLocaleString("it-IT", {
                    style: "currency",
                    currency: "EUR",
                  })}
                </p>
              </li>
            ))
          ) : (
            <p className="text-sm text-gray-500">Nessun documento disponibile.</p>
          )}
        </ul>
      </div>
    </main>
  );
}
