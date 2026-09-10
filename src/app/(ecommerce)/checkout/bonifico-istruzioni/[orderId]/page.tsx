import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBankDetails } from "@/lib/bank-details";
import { ConversionTracker } from "@/components/conversion-tracker";

export const metadata: Metadata = {
  title: "Istruzioni bonifico",
  robots: { index: false, follow: false },
};

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

  const bank = await getBankDetails();

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-md">
        <h1 className="font-serif text-3xl text-ink">Ordine ricevuto</h1>
        <p className="mt-2 text-justify text-sm text-sage">
          Completa il pagamento con bonifico bancario. Il documento sarà
          sbloccato in dashboard non appena confermiamo la ricezione.
        </p>

        <dl className="mt-6 space-y-2 rounded-2xl border border-border bg-cream-soft p-5 text-sm">
          <div className="flex justify-between">
            <dt className="text-sage">Documento</dt>
            <dd className="font-medium text-ink">{order.products?.title}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-sage">IBAN</dt>
            <dd className="font-medium text-ink">{bank.iban}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-sage">Intestatario</dt>
            <dd className="font-medium text-ink">{bank.intestatario}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-sage">Importo (IVA inclusa)</dt>
            <dd className="font-medium text-ink">
              {Number(order.total_amount).toLocaleString("it-IT", {
                style: "currency",
                currency: "EUR",
              })}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-sage">Causale</dt>
            <dd className="font-mono font-medium text-ink">
              Ordine {order.id.slice(0, 8)}
            </dd>
          </div>
        </dl>

        <p className="mt-6 text-justify text-sm text-sage">
          {isNewCustomer
            ? "Ti abbiamo anche inviato un'email per attivare il tuo account e impostare la password."
            : "Ti invieremo un'email non appena il documento sarà pronto per il download."}
        </p>
      </div>

      <ConversionTracker
        orderId={order.id}
        value={Number(order.total_amount)}
      />
    </main>
  );
}
