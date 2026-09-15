"use client";

import { useActionState } from "react";
import { cancelOmniaAiScheduledPlanChange } from "@/app/actions/omnia-ai-plan-change";

type Stato = { error?: string; ok?: boolean };

const initialState: Stato = {};

export default function AnnullaCambioPianoButton() {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [state, formAction, pending] = useActionState(async (_prev: Stato): Promise<Stato> => {
    const result = await cancelOmniaAiScheduledPlanChange();
    return result.error ? { error: result.error } : { ok: true };
  }, initialState);

  return (
    <form action={formAction}>
      <button type="submit" disabled={pending} className="omnia-btn omnia-btn-s omnia-btn-piccolo">
        {pending ? "Annullamento in corso..." : "Annulla il cambio programmato"}
      </button>
      {state.error && (
        <p className="omnia-messaggio-stato errore" style={{ marginTop: 12 }}>
          {state.error}
        </p>
      )}
      {state.ok && (
        <p className="omnia-messaggio-stato successo" style={{ marginTop: 12 }}>
          Annullamento registrato su Stripe. L&apos;aggiornamento sarà visibile qui a breve.
        </p>
      )}
    </form>
  );
}
