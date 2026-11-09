"use client";

import { useActionState } from "react";
import { impostaOraScadenzaGara, type ScadenzaState } from "@/app/actions/gara-extraction";
import { TESTO_ORA_MANUALE, testoOraMancante, type ContestoOra } from "@/lib/gara-proroga";

const statoIniziale: ScadenzaState = {};

// L'ora della scadenza quando i documenti NON la riportano (del bando o della proroga): la scrive il cliente. OMNIA AI non la presume e
// non la deduce, quindi il campo parte VUOTO (mai con l'ora del bando o con un orario «di default»). Compare solo se l'ora manca o se
// l'ha già scritta il cliente (la scheda della gara lo decide, e l'azione lo ricontrolla sul database). Se l'ora è scritta nei documenti
// il modulo non c'è: non si cambia a mano.
export default function ScadenzaOraForm({
  garaId,
  ora,
  manuale,
  contesto,
  spiegazione = true,
}: {
  garaId: string;
  // l'ora salvata, solo se l'ha scritta il cliente (per correggerla); altrimenti null
  ora: string | null;
  // l'ora mostrata l'ha inserita il cliente
  manuale: boolean;
  contesto: ContestoOra;
  // false quando la spiegazione è già scritta sopra (per esempio il messaggio della revisione umana)
  spiegazione?: boolean;
}) {
  const [stato, formAction, inCorso] = useActionState(impostaOraScadenzaGara, statoIniziale);

  return (
    <div className={manuale ? undefined : "omnia-messaggio-stato avviso"} style={{ marginTop: 16 }}>
      {spiegazione && <p style={{ margin: 0 }}>{manuale ? TESTO_ORA_MANUALE : testoOraMancante(contesto)}</p>}
      <form action={formAction} style={{ marginTop: spiegazione ? 12 : 0, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
        <input type="hidden" name="garaId" value={garaId} />
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5 }}>
          Ora della scadenza
          <input type="time" name="ora" required defaultValue={manuale ? (ora ?? "") : ""} style={{ padding: "6px 8px" }} />
        </label>
        <button type="submit" disabled={inCorso} className="omnia-btn omnia-btn-p omnia-btn-piccolo">
          {inCorso ? "Salvataggio..." : manuale ? "Aggiorna l'ora" : "Salva l'ora"}
        </button>
      </form>
      {stato.error && <p className="omnia-messaggio-stato errore" style={{ margin: "10px 0 0" }}>{stato.error}</p>}
      {stato.ok && !stato.error && <p className="omnia-messaggio-stato successo" style={{ margin: "10px 0 0" }}>Ora salvata.</p>}
    </div>
  );
}
