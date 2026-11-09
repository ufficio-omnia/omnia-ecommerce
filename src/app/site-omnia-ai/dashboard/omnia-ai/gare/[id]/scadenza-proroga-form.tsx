"use client";

import { useActionState } from "react";
import { impostaScadenzaGara, type ScadenzaState } from "@/app/actions/gara-extraction";
import { TESTO_ORA_SENZA_PRESUNZIONI, TESTO_PROROGA_SENZA_DATA } from "@/lib/gara-proroga";

const statoIniziale: ScadenzaState = {};

// Compare SOLO quando i documenti indicano una proroga dei termini di presentazione senza riportare la nuova data (la scheda
// della gara lo decide, e l'azione lo ricontrolla sul database). Il cliente scrive la nuova data (e, se la conosce, l'ora).
// I campi partono VUOTI: la data e l'ora che la scheda mostra (quelle del bando, superate dalla proroga) non si propongono come se
// fossero la nuova scadenza; si precompila solo ciò che il cliente ha già scritto lui.
export default function ScadenzaProrogaForm({
  garaId,
  scadenza,
  ora,
  manuale,
}: {
  garaId: string;
  scadenza: string | null;
  ora: string | null;
  // la scadenza mostrata l'ha inserita il cliente a mano
  manuale: boolean;
}) {
  const [stato, formAction, inCorso] = useActionState(impostaScadenzaGara, statoIniziale);

  return (
    <div className="omnia-messaggio-stato avviso" style={{ marginTop: 16 }}>
      <p style={{ margin: 0 }}>{TESTO_PROROGA_SENZA_DATA}</p>
      <form action={formAction} style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
        <input type="hidden" name="garaId" value={garaId} />
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5 }}>
          Nuova data di scadenza
          <input type="date" name="scadenza" required defaultValue={manuale ? (scadenza ?? "") : ""} style={{ padding: "6px 8px" }} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5 }}>
          Ora (se la conosci)
          <input type="time" name="ora" defaultValue={manuale ? (ora ?? "") : ""} style={{ padding: "6px 8px" }} />
        </label>
        <button type="submit" disabled={inCorso} className="omnia-btn omnia-btn-p omnia-btn-piccolo">
          {inCorso ? "Salvataggio..." : manuale ? "Aggiorna la scadenza" : "Salva la nuova scadenza"}
        </button>
      </form>
      <p className="omnia-riquadro-nota" style={{ margin: "8px 0 0" }}>{TESTO_ORA_SENZA_PRESUNZIONI}</p>
      {manuale && !stato.error && (
        <p className="omnia-riquadro-nota" style={{ margin: "10px 0 0" }}>
          La scadenza mostrata l&apos;hai inserita tu. Se carichi un documento che riporta la nuova data e rianalizzi, la prenderà da lì.
        </p>
      )}
      {stato.error && <p className="omnia-messaggio-stato errore" style={{ margin: "10px 0 0" }}>{stato.error}</p>}
      {stato.ok && !stato.error && <p className="omnia-messaggio-stato successo" style={{ margin: "10px 0 0" }}>Scadenza aggiornata.</p>}
    </div>
  );
}
