import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { effectivePrice } from "@/lib/products";
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
      "id, title, description, price, active, discount_active, discount_price, product_files(id, label, sort_order)",
    )
    .eq("id", id)
    .single<{
      id: string;
      title: string;
      description: string | null;
      price: number;
      active: boolean;
      discount_active: boolean;
      discount_price: number | null;
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
        {product.discount_active && product.discount_price != null ? (
          <div className="mt-4">
            <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700">
              Sconto momentaneo
            </span>
            <p className="mt-1">
              <span className="mr-2 text-lg text-gray-400 line-through">
                {Number(product.price).toLocaleString("it-IT", {
                  style: "currency",
                  currency: "EUR",
                })}
              </span>
              <span className="text-xl font-semibold">
                {Number(effectivePrice(product)).toLocaleString("it-IT", {
                  style: "currency",
                  currency: "EUR",
                })}
              </span>
            </p>
          </div>
        ) : (
          <p className="mt-4 text-xl font-semibold">
            {Number(product.price).toLocaleString("it-IT", {
              style: "currency",
              currency: "EUR",
            })}
          </p>
        )}

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
