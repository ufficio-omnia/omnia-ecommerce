import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { IBAN, INTESTATARIO } from "@/lib/bank-details";

export default async function BonificoIstruzioniPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ new?: string }>;
}) {
  const { orderId } = await params;
  const { new: isNewCustomer } = await searchParams;
  const admin = createAdminClient();

  const { data: order } = await admin
    .from("orders")
    .select("id, total_amount, products(title)")
    .eq("id", orderId)
    .single<{
      id: string;
      total_amount: number;
      products: { title: string } | null;
    }>();

  if (!order) {
    notFound();
  }

  return (
    <main className="flex flex-1 flex-col px-4 py-16">
      <div className="mx-auto w-full max-w-md">
        <h1 className="text-2xl font-semibold">Ordine ricevuto</h1>
        <p className="mt-2 text-sm text-gray-600">
          Completa il pagamento con bonifico bancario. Il documento sarà
          sbloccato in dashboard non appena confermiamo la ricezione.
        </p>

        <dl className="mt-6 space-y-2 rounded-md border border-gray-200 p-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-gray-600">Documento</dt>
            <dd className="font-medium">{order.products?.title}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-600">IBAN</dt>
            <dd className="font-medium">{IBAN}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-600">Intestatario</dt>
            <dd className="font-medium">{INTESTATARIO}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-600">Importo</dt>
            <dd className="font-medium">
              {Number(order.total_amount).toLocaleString("it-IT", {
                style: "currency",
                currency: "EUR",
              })}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-600">Causale</dt>
            <dd className="font-medium">Ordine {order.id.slice(0, 8)}</dd>
          </div>
        </dl>

        <p className="mt-6 text-sm text-gray-600">
          {isNewCustomer
            ? "Ti abbiamo anche inviato un'email per attivare il tuo account e impostare la password."
            : "Ti invieremo un'email non appena il documento sarà pronto per il download."}
        </p>
      </div>
    </main>
  );
}
