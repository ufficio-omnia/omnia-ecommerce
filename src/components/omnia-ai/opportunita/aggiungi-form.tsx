"use client";

import { useActionState } from "react";
import { aggiungiGaraAMano, type StatoAzioneRadar } from "@/app/actions/radar";

// «Aggiungi a mano»: CIG oppure collegamento, più campi facoltativi. Il collegamento non viene mai aperto da OMNIA: si salva e si mostra.
export default function AggiungiForm() {
  const [stato, azione, inCorso] = useActionState<StatoAzioneRadar, FormData>(aggiungiGaraAMano, {});
  return (
    <form action={azione} className="omnia-modulo omnia-opp-aggiungi">
      <div className="omnia-campo-riga">
        <label>
          <span className="omnia-etichetta">CIG</span>
          <input name="cig" className="omnia-input" maxLength={12} placeholder="10 caratteri, es. B1234ABCD5" autoComplete="off" />
        </label>
        <label>
          <span className="omnia-etichetta">oppure collegamento alla gara</span>
          <input name="url" type="url" className="omnia-input" maxLength={2000} placeholder="https://…" />
        </label>
      </div>
      <p className="omnia-opp-nota">Basta uno dei due. Gli altri campi sono facoltativi e servono a riconoscere la gara finché non compare nelle fonti.</p>
      <label>
        <span className="omnia-etichetta">Oggetto</span>
        <input name="oggetto" className="omnia-input" maxLength={500} />
      </label>
      <label>
        <span className="omnia-etichetta">Ente (stazione appaltante)</span>
        <input name="ente" className="omnia-input" maxLength={300} />
      </label>
      <div className="omnia-campo-riga">
        <label>
          <span className="omnia-etichetta">Scadenza delle offerte: giorno</span>
          <input name="scadenzaGiorno" type="date" className="omnia-input" />
        </label>
        <label>
          <span className="omnia-etichetta">ora (se la conosci)</span>
          <input name="scadenzaOra" type="time" className="omnia-input" />
        </label>
      </div>
      <label>
        <span className="omnia-etichetta">Importo (€)</span>
        <input name="importo" inputMode="decimal" className="omnia-input" placeholder="es. 250.000,00" />
      </label>
      {stato.errore && (
        <p className="omnia-messaggio-stato errore" role="alert">
          {stato.errore}
        </p>
      )}
      <button type="submit" className="omnia-btn omnia-btn-p" disabled={inCorso}>
        {inCorso ? "Aggiunta in corso…" : "Aggiungi e monitora"}
      </button>
    </form>
  );
}
