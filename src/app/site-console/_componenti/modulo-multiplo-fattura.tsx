"use client";

import { useActionState, useState } from "react";
import type { StatoAzioneFattura } from "../azioni/fatturazione";
import type { StatoFattura } from "@/lib/console/fatturazione-calcoli";

type Azione = (stato: StatoAzioneFattura, dati: FormData) => Promise<StatoAzioneFattura>;

// Barra per cambiare lo stato di PIÙ righe insieme. Le caselle di selezione stanno
// nella tabella (fuori da questo modulo) e vi si collegano con form="modulo-multiplo".
export default function ModuloMultiploFattura({
  oggi,
  filtro,
  prova,
  azione,
}: {
  oggi: string;
  filtro: string;
  prova: boolean;
  azione: Azione;
}) {
  const [esito, esegui, inCorso] = useActionState(azione, {});
  const [stato, setStato] = useState<StatoFattura>("fatturata");

  return (
    <form id="modulo-multiplo" action={esegui} className="cn-multiplo">
      <input type="hidden" name="filtro" value={filtro} />
      {prova && <input type="hidden" name="prova" value="1" />}
      <span className="cn-etichetta-inline">Righe selezionate</span>
      <select name="stato" className="cn-input" value={stato} onChange={(e) => setStato(e.target.value as StatoFattura)} aria-label="Nuovo stato">
        <option value="fatturata">segna fatturate</option>
        <option value="non_dovuta">segna non dovute</option>
        <option value="da_fatturare">riporta a da fatturare</option>
      </select>
      {stato === "fatturata" && <input name="data" type="date" className="cn-input" defaultValue={oggi} max={oggi} required aria-label="Data fattura" />}
      <input name="note" className="cn-input" placeholder={stato === "non_dovuta" ? "Perché (obbligatorio)" : "Note (facoltative)"} maxLength={500} required={stato === "non_dovuta"} aria-label="Note" />
      <button type="submit" className="cn-btn piccolo" disabled={inCorso}>
        {inCorso ? "Salvo…" : "Applica"}
      </button>
      {stato === "fatturata" && <small className="cn-nota-inline">Il numero della fattura si aggiunge poi riga per riga.</small>}
      {esito.errore && (
        <span className="cn-azione-errore" role="alert">
          {esito.errore}
        </span>
      )}
    </form>
  );
}
