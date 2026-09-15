"use client";

import { useActionState } from "react";
import {
  startOmniaAiCreditsCheckout,
  type OmniaAiCreditsCheckoutState,
} from "@/app/actions/omnia-ai-credits";
import { PACCHETTI_CREDITI, formatEuro, type PacchettoCreditiSlug } from "@/lib/omnia-ai-plans";

const initialState: OmniaAiCreditsCheckoutState = {};

function PacchettoForm({ slug }: { slug: PacchettoCreditiSlug }) {
  const [state, formAction, pending] = useActionState(startOmniaAiCreditsCheckout, initialState);
  const pacchetto = PACCHETTI_CREDITI[slug];

  return (
    <form action={formAction} style={{ display: "inline-block", marginRight: 12, marginTop: 12 }}>
      <input type="hidden" name="pacchetto" value={slug} />
      <button type="submit" disabled={pending} className="omnia-btn omnia-btn-s omnia-btn-piccolo">
        {pending ? "Avvio pagamento..." : `${pacchetto.nome} — ${formatEuro(pacchetto.prezzoCentesimi)}`}
      </button>
      {state.error && (
        <p className="omnia-messaggio-stato errore" style={{ marginTop: 8 }}>
          {state.error}
        </p>
      )}
    </form>
  );
}

export default function AcquistaCreditiForm() {
  return (
    <div>
      <PacchettoForm slug="singola" />
      <PacchettoForm slug="pacchetto5" />
    </div>
  );
}
