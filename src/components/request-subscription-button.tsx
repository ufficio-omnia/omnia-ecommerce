"use client";

import { useActionState } from "react";
import {
  sendMessageAsCustomer,
  type MessageState,
} from "@/app/actions/messages";

const initialState: MessageState = {};

const REQUEST_BODY =
  "Vorrei attivare l'abbonamento OMNIA AI. Potete contattarmi per scegliere il piano e i dettagli di pagamento?";

export default function RequestSubscriptionButton() {
  const [state, formAction, pending] = useActionState(
    sendMessageAsCustomer,
    initialState,
  );

  const submitted = state !== initialState && !state.error;

  if (submitted) {
    return (
      <p className="text-sm text-forest">
        Richiesta inviata. Ti contatteremo a breve per attivare l&apos;abbonamento.
      </p>
    );
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="body" value={REQUEST_BODY} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-forest px-6 py-2.5 font-mono text-xs tracking-wide text-cream uppercase transition-colors hover:bg-forest-dark disabled:opacity-50"
      >
        {pending ? "Invio richiesta..." : "Richiedi attivazione"}
      </button>
      {state.error && <p className="mt-2 text-sm text-red-700">{state.error}</p>}
    </form>
  );
}
