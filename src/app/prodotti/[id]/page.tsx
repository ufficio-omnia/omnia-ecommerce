import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import BankTransferForm from "./bank-transfer-form";

export default async function ProdottoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: product } = await supabase
    .from("products")
    .select("id, title, description, price")
    .eq("id", id)
    .single();

  if (!product) {
    notFound();
  }

  return (
    <main className="flex flex-1 flex-col px-4 py-16">
      <div className="mx-auto w-full max-w-md">
        <h1 className="text-2xl font-semibold">{product.title}</h1>
        <p className="mt-2 text-sm text-gray-600">{product.description}</p>
        <p className="mt-4 text-xl font-semibold">
          {Number(product.price).toLocaleString("it-IT", {
            style: "currency",
            currency: "EUR",
          })}
        </p>

        <div className="mt-8 space-y-6">
          <div className="rounded-md border border-gray-200 p-4 opacity-50">
            <p className="text-sm font-medium">Paga con carta</p>
            <p className="mt-1 text-xs text-gray-500">Disponibile a breve.</p>
          </div>

          <div className="rounded-md border border-gray-200 p-4">
            <p className="text-sm font-medium">Bonifico bancario</p>
            <p className="mt-1 text-xs text-gray-500">
              L&apos;ordine resterà in attesa finché non confermiamo il
              pagamento.
            </p>
            <BankTransferForm productId={product.id} />
          </div>
        </div>
      </div>
    </main>
  );
}
