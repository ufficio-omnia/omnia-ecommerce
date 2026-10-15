"use client";

import { useActionState } from "react";
import { avvisaAmministratoreRevisione, type AvvisoRevisioneState } from "@/app/actions/omnia-ai-revisione";

const STATO_INIZIALE: AvvisoRevisioneState = {};

// Il pulsante «Richiedi revisione umana» dell'Ufficio Gare: non compra nulla, avvisa l'amministratore con
// un'email; la revisione la richiede e la paga lui dalla sua area riservata.
export default function RevisioneAvvisoForm({ garaId }: { garaId: string }) {
  const [stato, azione, inCorso] = useActionState(avvisaAmministratoreRevisione, STATO_INIZIALE);
  return (
    <form action={azione} style={{ margin: "16px 0 0" }}>
      <input type="hidden" name="garaId" value={garaId} />
      <button type="submit" disabled={inCorso} className="omnia-btn omnia-btn-p">
        {inCorso ? "INVIO IN CORSO..." : "RICHIEDI REVISIONE UMANA"}
      </button>
      <p className="omnia-riquadro-nota">La revisione la richiede e la paga l&apos;amministratore della tua azienda: con questo pulsante gli mandiamo la richiesta.</p>
      {stato.error && <p className="omnia-messaggio-stato errore">{stato.error}</p>}
      {stato.success && <p className="omnia-messaggio-stato successo">{stato.success}</p>}
    </form>
  );
}
