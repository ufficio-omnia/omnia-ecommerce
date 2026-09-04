import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import BankTransferForm from "./bank-transfer-form";
import CardCheckoutForm from "./card-checkout-form";

export default async function ProdottoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: product } = await supabase
    .from("products")
    .select(
      "id, title, description, price, active, product_files(id, label, sort_order)",
    )
    .eq("id", id)
    .single<{
      id: string;
      title: string;
      description: string | null;
      price: number;
      active: boolean;
      product_files: { id: string; label: string; sort_order: number }[];
    }>();

  if (!product || !product.active) {
    notFound();
  }

  const files = [...(product.product_files ?? [])].sort(
    (a, b) => a.sort_order - b.sort_order,
  );

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

        {files.length > 0 && (
          <div className="mt-4">
            <p className="text-sm font-medium">Contenuto del pacchetto</p>
            <ul className="mt-1 list-inside list-disc text-sm text-gray-600">
              {files.map((f) => (
                <li key={f.id}>{f.label}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-8 space-y-6">
          <div className="rounded-md border border-gray-200 p-4">
            <p className="text-sm font-medium">Paga con carta</p>
            <p className="mt-1 text-xs text-gray-500">
              Pagamento sicuro tramite Stripe. Il documento sarà sbloccato in
              dashboard dopo la conferma del pagamento.
            </p>
            <CardCheckoutForm productId={product.id} />
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
