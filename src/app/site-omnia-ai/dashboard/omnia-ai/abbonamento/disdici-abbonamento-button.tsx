"use client";

import { useActionState, type FormEvent } from "react";
import { cancelOmniaAiSubscription } from "@/app/actions/omnia-ai-subscription";

type Stato = { error?: string; ok?: boolean };

const initialState: Stato = {};

export default function DisdiciAbbonamentoButton({ dataRinnovo }: { dataRinnovo: string | null }) {
  // Non riusa DeleteButton: qui il risultato non è immediato come una
  // cancellazione (cancelOmniaAiSubscription non tocca lo stato locale,
  // arriva solo dal webhook) — serve un messaggio di successo esplicito,
  // non solo "nessun errore", altrimenti sembra che il click non abbia
  // fatto nulla.
  const [state, formAction, pending] = useActionState(async (_prev: Stato, formData: FormData) => {
    const result = await cancelOmniaAiSubscription({}, formData);
    return result.error ? { error: result.error } : { ok: true };
  }, initialState);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const confirmMessage = `Disdire l'abbonamento? Il servizio resta attivo fino al ${
      dataRinnovo ?? "termine del periodo corrente"
    }, comprese le gare residue del piano: da quella data non si rinnova più. I crediti aggiuntivi residui si estinguono con la cessazione, senza rimborso.`;
    if (!window.confirm(confirmMessage)) {
      event.preventDefault();
    }
  }

  return (
    <form action={formAction} onSubmit={handleSubmit}>
      <button type="submit" disabled={pending} className="omnia-btn omnia-btn-s omnia-btn-piccolo">
        {pending ? "Disdetta in corso..." : "Disdici abbonamento"}
      </button>
      {state.error && (
        <p className="omnia-messaggio-stato errore" style={{ marginTop: 12 }}>
          {state.error}
        </p>
      )}
      {state.ok && (
        <p className="omnia-messaggio-stato successo" style={{ marginTop: 12 }}>
          Disdetta registrata su Stripe. L&apos;aggiornamento sarà visibile qui a breve.
        </p>
      )}
    </form>
  );
}
