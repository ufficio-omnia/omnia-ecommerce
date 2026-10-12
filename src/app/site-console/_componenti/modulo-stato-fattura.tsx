"use client";

import { useActionState, useState } from "react";
import type { StatoAzioneFattura } from "../azioni/fatturazione";
import type { StatoFattura } from "@/lib/console/fatturazione-calcoli";

type Azione = (stato: StatoAzioneFattura, dati: FormData) => Promise<StatoAzioneFattura>;

// Modulo per segnare lo stato di UNA riga: si apre da «Aggiorna» e contiene lo
// stato, il numero e la data della fattura emessa e una nota. I campi si
// adattano allo stato scelto (numero e data solo per «fatturata»).
export default function ModuloStatoFattura({
  chiave,
  statoAttuale,
  numero,
  data,
  note,
  oggi,
  filtro,
  prova,
  azione,
}: {
  chiave: string;
  statoAttuale: StatoFattura;
  numero: string | null;
  data: string | null;
  note: string | null;
  // AAAA-MM-GG di oggi (Roma): data proposta per una fattura appena emessa
  oggi: string;
  filtro: string;
  prova: boolean;
  azione: Azione;
}) {
  const [esito, esegui, inCorso] = useActionState(azione, {});
  const [stato, setStato] = useState<StatoFattura>(statoAttuale === "da_fatturare" ? "fatturata" : statoAttuale);

  return (
    <details className="cn-modulo-riga">
      <summary className="cn-btn piccolo">Aggiorna</summary>
      <form action={esegui} className="cn-modulo-riga-corpo">
        <input type="hidden" name="riga" value={chiave} />
        <input type="hidden" name="filtro" value={filtro} />
        {prova && <input type="hidden" name="prova" value="1" />}

        <label className="cn-etichetta" htmlFor={`stato-${chiave}`}>
          Stato
        </label>
        <select id={`stato-${chiave}`} name="stato" className="cn-input" value={stato} onChange={(e) => setStato(e.target.value as StatoFattura)}>
          <option value="fatturata">Fatturata</option>
          <option value="da_fatturare">Da fatturare</option>
          <option value="non_dovuta">Non dovuta</option>
        </select>

        {stato === "fatturata" && (
          <>
            <label className="cn-etichetta" htmlFor={`numero-${chiave}`}>
              Numero fattura
            </label>
            <input id={`numero-${chiave}`} name="numero" className="cn-input" defaultValue={numero ?? ""} maxLength={60} placeholder="es. 2026/045" />
            <label className="cn-etichetta" htmlFor={`data-${chiave}`}>
              Data fattura
            </label>
            <input id={`data-${chiave}`} name="data" type="date" className="cn-input" defaultValue={data ?? oggi} max={oggi} required />
          </>
        )}

        <label className="cn-etichetta" htmlFor={`note-${chiave}`}>
          Note {stato === "non_dovuta" ? "(obbligatorie: perché)" : "(facoltative)"}
        </label>
        <input id={`note-${chiave}`} name="note" className="cn-input" defaultValue={note ?? ""} maxLength={500} required={stato === "non_dovuta"} />

        {esito.errore && (
          <p className="cn-esito errore" role="alert">
            {esito.errore}
          </p>
        )}
        <button type="submit" className="cn-btn primario piccolo" disabled={inCorso}>
          {inCorso ? "Salvo…" : "Salva"}
        </button>
      </form>
    </details>
  );
}
