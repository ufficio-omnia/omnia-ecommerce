"use client";

import { useActionState, useState } from "react";
import { acquistaCopertina, type AcquistoCopertinaState } from "@/app/actions/gara-copertina";
import { CLAUSOLE_COPERTINA, CLAUSOLE_SPECIFICHE_COPERTINA, TESTI_COPERTINA, VERSIONE_CONDIZIONI_COPERTINA, testoApprovazioneSpecificaCopertina } from "@/lib/copertina-acquisto-calcoli";
import { prezzoCopertina } from "@/lib/copertina-diritto-calcoli";

const statoIniziale: AcquistoCopertinaState = {};

// Acquisto della copertina di questa gara: le condizioni (versionate) da accettare, poi il pagamento su Stripe. Il prezzo che si vede viene rimandato al
// server solo per accorgersi se nel frattempo è cambiato: il server lo rilegge sempre dalle impostazioni del cliente.
export default function AcquistoCopertina({ garaId, prezzoCentesimi, privacyVersione }: { garaId: string; prezzoCentesimi: number; privacyVersione: number | null }) {
  const [stato, formAction, inCorso] = useActionState(acquistaCopertina, statoIniziale);
  const [accetta, setAccetta] = useState(false);
  const [approva, setApprova] = useState(false);
  const prezzo = stato.prezzoAggiornatoCentesimi ?? prezzoCentesimi;
  const aggiornato = stato.prezzoAggiornatoCentesimi !== undefined && stato.prezzoAggiornatoCentesimi !== prezzoCentesimi;
  const numeriSpecifiche = CLAUSOLE_SPECIFICHE_COPERTINA.map((c) => c.numero);

  return (
    <form action={formAction} style={{ marginTop: 16 }}>
      <input type="hidden" name="garaId" value={garaId} />
      <input type="hidden" name="prezzoMostratoCentesimi" value={prezzo} />
      <p style={{ margin: 0 }}>
        <strong>Copertina di questa gara: {prezzoCopertina(prezzo)} (IVA inclusa).</strong>
        {TESTI_COPERTINA.dettaglioAcquisto}
      </p>

      <details style={{ marginTop: 10 }}>
        <summary style={{ cursor: "pointer" }}>
          {TESTI_COPERTINA.titoloAvvertenze} (versione {VERSIONE_CONDIZIONI_COPERTINA})
        </summary>
        <div style={{ marginTop: 10, maxHeight: 240, overflowY: "auto", paddingRight: 8, fontSize: 14, lineHeight: 1.55 }}>
          {CLAUSOLE_COPERTINA.map((c) => (
            <p key={c.numero} style={{ margin: "0 0 10px" }}>
              <strong>
                {c.numero}. {c.titolo}.
              </strong>{" "}
              {c.testo}
            </p>
          ))}
        </div>
      </details>

      <div className="omnia-check-riga">
        <input id="accettaAvvertenzeCopertina" name="accettaAvvertenze" type="checkbox" checked={accetta} onChange={(e) => setAccetta(e.target.checked)} required />
        <label htmlFor="accettaAvvertenzeCopertina">
          {TESTI_COPERTINA.accettaAvvertenze} (versione {VERSIONE_CONDIZIONI_COPERTINA}) e di aver preso visione della{" "}
          {privacyVersione ? (
            <a href={`/documenti-legali/privacy-policy/${privacyVersione}`} target="_blank" rel="noopener noreferrer">
              Privacy policy (versione {privacyVersione})
            </a>
          ) : (
            "Privacy policy"
          )}
          .
        </label>
      </div>
      <div className="omnia-check-riga">
        <input id="accettaClausoleCopertina" name="accettaClausole" type="checkbox" checked={approva} onChange={(e) => setApprova(e.target.checked)} required />
        <label htmlFor="accettaClausoleCopertina">{testoApprovazioneSpecificaCopertina(numeriSpecifiche, CLAUSOLE_SPECIFICHE_COPERTINA.map((c) => c.titolo.toLowerCase()))}</label>
      </div>

      {stato.error && !inCorso && (
        <p className="omnia-messaggio-stato errore" style={{ marginTop: 12 }}>
          {stato.error}
          {aggiornato ? ` Nuovo importo: ${prezzoCopertina(prezzo)}.` : ""}
        </p>
      )}

      <p style={{ marginTop: 14 }}>
        <button type="submit" className="omnia-btn omnia-btn-p" disabled={!accetta || !approva || inCorso}>
          {inCorso ? "Apertura del pagamento…" : `Acquista la copertina di questa gara — ${prezzoCopertina(prezzo)}`}
        </button>
      </p>
    </form>
  );
}
