import Link from "next/link";
import { ConversionTrackerFromSession } from "@/components/conversion-tracker";

export default async function CartaSuccessoPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { session_id: sessionId } = await searchParams;

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-md rounded-2xl border border-border bg-cream-soft p-8 text-center">
        <h1 className="font-serif text-3xl text-ink">Pagamento ricevuto</h1>
        <p className="mt-3 text-justify text-sm text-sage">
          Grazie per il tuo acquisto. Controlla la tua email: appena
          confermiamo il pagamento riceverai le istruzioni per accedere al
          documento nella tua area riservata.
        </p>

        <Link
          href="/"
          className="mt-6 inline-block font-mono text-xs tracking-wide text-forest uppercase underline"
        >
          Torna alla home
        </Link>
      </div>

      {sessionId && <ConversionTrackerFromSession sessionId={sessionId} />}
    </main>
  );
}
