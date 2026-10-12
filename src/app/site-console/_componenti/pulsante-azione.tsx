"use client";

import { useActionState } from "react";
import type { FormEvent } from "react";
import type { StatoAzione } from "../azioni/ordini";

// Pulsante che esegue una server action con una conferma preventiva. La
// conferma è una finestra del browser: per azioni con effetti fuori dalla
// console (email al cliente, cancellazioni) un passaggio in più è voluto.
// L'esito positivo lo mostra la pagina (redirect con avviso); qui resta solo
// l'eventuale errore, accanto al pulsante.
export default function PulsanteAzione({
  azione,
  campi,
  conferma,
  etichetta,
  etichettaInCorso,
  variante = "neutro",
}: {
  azione: (stato: StatoAzione, dati: FormData) => Promise<StatoAzione>;
  campi: Record<string, string>;
  conferma: string;
  etichetta: string;
  etichettaInCorso: string;
  variante?: "neutro" | "primario" | "pericolo";
}) {
  const [stato, esegui, inCorso] = useActionState(azione, {});

  function alInvio(evento: FormEvent<HTMLFormElement>) {
    if (!window.confirm(conferma)) evento.preventDefault();
  }

  return (
    <form action={esegui} onSubmit={alInvio} className="cn-azione">
      {Object.entries(campi).map(([nome, valore]) => (
        <input key={nome} type="hidden" name={nome} value={valore} />
      ))}
      <button type="submit" className={`cn-btn piccolo${variante === "neutro" ? "" : ` ${variante}`}`} disabled={inCorso}>
        {inCorso ? etichettaInCorso : etichetta}
      </button>
      {stato.errore && (
        <span className="cn-azione-errore" role="alert">
          {stato.errore}
        </span>
      )}
    </form>
  );
}
