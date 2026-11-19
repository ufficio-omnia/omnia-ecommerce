"use client";

import { useActionState } from "react";
import { impostaScadenzaGara, type ScadenzaState } from "@/app/actions/gara-extraction";
import { TESTO_DATA_MANCANTE, TESTO_ORA_SENZA_PRESUNZIONI, TESTO_PROROGA_SENZA_DATA, type MotivoDataManuale } from "@/lib/gara-proroga";

const statoIniziale: ScadenzaState = {};

// Compare SOLO quando il cliente può scrivere la data di scadenza (motivoDataManuale: la scheda della gara lo decide, e l'azione lo
// ricontrolla sul database): i documenti indicano una proroga dei termini senza la nuova data, oppure, dopo l'analisi, i documenti
// non riportano nessuna data di scadenza (19/11/2026). Il cliente scrive la data (e, se la conosce, l'ora).
// I campi partono VUOTI: la data e l'ora che la scheda mostra (quelle del bando, superate dalla proroga) non si propongono come se
// fossero la nuova scadenza; si precompila solo ciò che il cliente ha già scritto lui.
export default function ScadenzaProrogaForm({
  garaId,
  scadenza,
  ora,
  manuale,
  motivo = "proroga_senza_data",
}: {
  garaId: string;
  scadenza: string | null;
  ora: string | null;
  // la scadenza mostrata l'ha inserita il cliente a mano
  manuale: boolean;
  motivo?: MotivoDataManuale;
}) {
  const [stato, formAction, inCorso] = useActionState(impostaScadenzaGara, statoIniziale);
  const proroga = motivo === "proroga_senza_data";

  return (
    <div className="omnia-messaggio-stato avviso" style={{ marginTop: 16 }}>
      {!(manuale && !proroga) && <p style={{ margin: 0 }}>{proroga ? TESTO_PROROGA_SENZA_DATA : TESTO_DATA_MANCANTE}</p>}
      <form action={formAction} style={{ marginTop: manuale && !proroga ? 0 : 12, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
        <input type="hidden" name="garaId" value={garaId} />
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5 }}>
          {proroga ? "Nuova data di scadenza" : "Data di scadenza"}
          <input type="date" name="scadenza" required defaultValue={manuale ? (scadenza ?? "") : ""} style={{ padding: "6px 8px" }} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5 }}>
          Ora (se la conosci)
          <input type="time" name="ora" defaultValue={manuale ? (ora ?? "") : ""} style={{ padding: "6px 8px" }} />
        </label>
        <button type="submit" disabled={inCorso} className="omnia-btn omnia-btn-p omnia-btn-piccolo">
          {inCorso ? "Salvataggio..." : manuale ? "Aggiorna la scadenza" : proroga ? "Salva la nuova scadenza" : "Salva la scadenza"}
        </button>
      </form>
      <p className="omnia-riquadro-nota" style={{ margin: "8px 0 0" }}>{TESTO_ORA_SENZA_PRESUNZIONI}</p>
      {manuale && !stato.error && (
        <p className="omnia-riquadro-nota" style={{ margin: "10px 0 0" }}>
          {proroga
            ? "La scadenza mostrata l'hai inserita tu. Se carichi un documento che riporta la nuova data e rianalizzi, la prenderà da lì."
            : "La scadenza mostrata l'hai inserita tu perché i documenti non la riportano. Se carichi un documento che la riporta e rianalizzi, la prenderà da lì."}
        </p>
      )}
      {stato.error && <p className="omnia-messaggio-stato errore" style={{ margin: "10px 0 0" }}>{stato.error}</p>}
      {stato.ok && !stato.error && <p className="omnia-messaggio-stato successo" style={{ margin: "10px 0 0" }}>Scadenza aggiornata.</p>}
    </div>
  );
}
