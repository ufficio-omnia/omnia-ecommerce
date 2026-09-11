import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { hasActiveSubscription } from "@/lib/subscription";
import RequestSubscriptionButton from "@/components/request-subscription-button";

export default async function OmniaAiLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const active = await hasActiveSubscription(user.id);

  if (!active) {
    return (
      <main className="flex-1">
        <div className="mx-auto max-w-xl px-4 py-16 text-center sm:px-6">
          <Link
            href="/"
            className="font-mono text-xs tracking-wide text-sage uppercase hover:text-ink"
          >
            ← Home
          </Link>

          <h1 className="mt-4 font-serif text-3xl text-ink">OMNIA AI</h1>
          <p className="mt-3 text-justify text-sm text-sage">
            OMNIA AI è disponibile solo con un abbonamento attivo. Ti
            permetterà di analizzare i bandi di gara e generare contenuti
            personalizzati a partire dal profilo della tua azienda. I piani
            di abbonamento saranno presto disponibili per l&apos;acquisto
            diretto: nel frattempo puoi richiedere l&apos;attivazione e ti
            contatteremo per attivarla manualmente.
          </p>

          <div className="mt-6">
            <RequestSubscriptionButton />
          </div>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}
