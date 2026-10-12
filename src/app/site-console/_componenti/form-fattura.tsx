"use client";

import { useActionState } from "react";
import type { StatoAzione } from "../azioni/ordini";

export default function FormFattura({
  orderId,
  azione,
}: {
  orderId: string;
  azione: (stato: StatoAzione, dati: FormData) => Promise<StatoAzione>;
}) {
  const [stato, esegui, inCorso] = useActionState(azione, {});

  return (
    <form action={esegui} className="cn-azione riga">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="file" name="file" accept="application/pdf" required className="cn-file" aria-label="Fattura in PDF" />
      <button type="submit" className="cn-btn piccolo" disabled={inCorso}>
        {inCorso ? "Carico…" : "Carica"}
      </button>
      {stato.errore && (
        <span className="cn-azione-errore" role="alert">
          {stato.errore}
        </span>
      )}
    </form>
  );
}
