"use client";

import { useActionState } from "react";
import { openOmniaAiBillingPortal } from "@/app/actions/omnia-ai-subscription";

const initialState: { error?: string } = {};

export default function GestisciPagamentoButton({ etichetta = "Cambia metodo di pagamento" }: { etichetta?: string }) {
  const [state, formAction, pending] = useActionState(openOmniaAiBillingPortal, initialState);

  return (
    <form action={formAction}>
      <button type="submit" disabled={pending} className="omnia-btn omnia-btn-s omnia-btn-piccolo">
        {pending ? "Apertura in corso..." : etichetta}
      </button>
      {state.error && (
        <p className="omnia-messaggio-stato errore" style={{ marginTop: 12 }}>
          {state.error}
        </p>
      )}
    </form>
  );
}
