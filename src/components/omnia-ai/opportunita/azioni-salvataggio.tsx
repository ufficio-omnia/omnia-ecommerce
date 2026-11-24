"use client";

import { useActionState } from "react";
import { aggiornaSalvataggio, type StatoAzioneRadar } from "@/app/actions/radar";

// «Salva» e «Monitora» di una gara (pubblica o aggiunta a mano). Azioni secondarie: pulsanti piccoli, l'esito resta accanto.
export default function AzioniSalvataggio({
  proceduraId,
  aggiuntaId,
  salvata,
  monitorata,
  operativo,
}: {
  proceduraId?: string;
  aggiuntaId?: string;
  salvata: boolean;
  monitorata: boolean;
  operativo: boolean;
}) {
  const [stato, azione, inCorso] = useActionState<StatoAzioneRadar, FormData>(aggiornaSalvataggio, {});
  const pulsante = (valore: string, testo: string, principale = false) => (
    <button type="submit" name="azione" value={valore} disabled={inCorso} className={`omnia-btn ${principale ? "omnia-btn-p" : "omnia-btn-s"} omnia-btn-piccolo`}>
      {testo}
    </button>
  );
  return (
    <form action={azione} className="omnia-opp-azioni">
      {proceduraId && <input type="hidden" name="proceduraId" value={proceduraId} />}
      {aggiuntaId && <input type="hidden" name="aggiuntaId" value={aggiuntaId} />}
      {!salvata && operativo && pulsante("salva", "☆ Salva")}
      {!monitorata && operativo && pulsante("monitora", "🔔 Monitora")}
      {monitorata && pulsante("non_monitorare", "Smetti di monitorare")}
      {salvata && pulsante("rimuovi", "Togli dalle salvate")}
      {salvata && !monitorata && <span className="omnia-badge verde">Salvata</span>}
      {monitorata && <span className="omnia-badge verde">Monitorata</span>}
      {stato.errore && <span className="omnia-opp-esito errore" role="alert">{stato.errore}</span>}
      {stato.ok && stato.messaggio && <span className="omnia-opp-esito" role="status">{stato.messaggio}</span>}
    </form>
  );
}
