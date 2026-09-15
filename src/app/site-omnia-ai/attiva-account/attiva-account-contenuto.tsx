"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { EmailOtpType } from "@supabase/supabase-js";

export default function AttivaAccountContenuto() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") || "/dashboard/omnia-ai";

  const [errore, setErrore] = useState(false);

  useEffect(() => {
    // Nessun parametro: niente da verificare, il render sotto mostra già
    // l'errore senza bisogno di uno stato dedicato per questo caso.
    if (!tokenHash || !type) return;

    const supabase = createClient();
    // token_hash come parametro di query, verificato direttamente:
    // nessun frammento URL, nessun code PKCE, nessuna dipendenza dal
    // flowType del client — stesso meccanismo raccomandato da Supabase
    // per le email di attivazione generate lato server (vedi
    // handleOmniaAiSubscriptionCheckoutCompleted nel webhook Stripe).
    supabase.auth.verifyOtp({ token_hash: tokenHash, type }).then(({ error }) => {
      if (error) {
        setErrore(true);
      } else {
        router.replace(next);
      }
    });
  }, [tokenHash, type, next, router]);

  if (errore || !tokenHash || !type) {
    return (
      <>
        <h1 className="omnia-app-titolo">Link non valido o scaduto</h1>
        <p className="omnia-app-sottotitolo">
          Richiedi un nuovo link di attivazione o accedi se hai già impostato una password.
        </p>
      </>
    );
  }

  return <h1 className="omnia-app-titolo">Accesso in corso…</h1>;
}
