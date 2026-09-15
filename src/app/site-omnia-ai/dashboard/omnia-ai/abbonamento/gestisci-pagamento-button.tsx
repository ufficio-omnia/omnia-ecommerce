"use client";

import { useActionState } from "react";
import { openOmniaAiBillingPortal } from "@/app/actions/omnia-ai-subscription";

const initialState: { error?: string } = {};

export default function GestisciPagamentoButton() {
  const [state, formAction, pending] = useActionState(openOmniaAiBillingPortal, initialState);

  return (
    <form action={formAction}>
      <button type="submit" disabled={pending} className="omnia-btn omnia-btn-s omnia-btn-piccolo">
        {pending ? "Apertura in corso..." : "Cambia metodo di pagamento"}
      </button>
      {state.error && (
        <p className="omnia-messaggio-stato errore" style={{ marginTop: 12 }}>
          {state.error}
        </p>
      )}
    </form>
  );
}
