"use client";

import { useActionState } from "react";
import type { FormEvent } from "react";
import type { StatoAzione } from "../azioni/ordini";

// Pulsante che esegue una server action, con una conferma preventiva se serve.
// La conferma è una finestra del browser: per azioni con effetti fuori dalla
// console (email al cliente, cancellazioni) un passaggio in più è voluto; per un
// cambio di stato reversibile (attiva/disattiva, sposta) si omette.
// L'esito positivo lo mostra la pagina (redirect con avviso o dati ricaricati); qui
// resta solo l'eventuale errore, accanto al pulsante.
export default function PulsanteAzione({
  azione,
  campi,
  conferma,
  etichetta,
  etichettaInCorso,
  variante = "neutro",
  disabilitato = false,
  titolo,
}: {
  azione: (stato: StatoAzione, dati: FormData) => Promise<StatoAzione>;
  campi: Record<string, string>;
  conferma?: string;
  etichetta: string;
  etichettaInCorso: string;
  variante?: "neutro" | "primario" | "pericolo";
  disabilitato?: boolean;
  // spiegazione al passaggio del mouse e per i lettori di schermo (utile con etichette brevi come «↑»)
  titolo?: string;
}) {
  const [stato, esegui, inCorso] = useActionState(azione, {});

  function alInvio(evento: FormEvent<HTMLFormElement>) {
    if (conferma && !window.confirm(conferma)) evento.preventDefault();
  }

  return (
    <form action={esegui} onSubmit={alInvio} className="cn-azione">
      {Object.entries(campi).map(([nome, valore]) => (
        <input key={nome} type="hidden" name={nome} value={valore} />
      ))}
      <button type="submit" className={`cn-btn piccolo${variante === "neutro" ? "" : ` ${variante}`}`} disabled={inCorso || disabilitato} title={titolo} aria-label={etichetta.length <= 2 ? titolo : undefined}>
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
