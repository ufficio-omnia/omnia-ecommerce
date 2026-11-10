"use client";

import { useActionState, useState } from "react";
import { acquistaPacchettoServizio, type AcquistoPacchettoState } from "@/app/actions/pacchetti-servizi";
import { CLAUSOLE_PACCHETTI, CLAUSOLE_SPECIFICHE_PACCHETTI, VERSIONE_CONDIZIONI_PACCHETTI, formattaEuro, testoUnita, type ServizioPacchetto } from "@/lib/pacchetti-servizi-calcoli";
import { CLAUSOLE_PIANO_LAVORO, CLAUSOLE_SPECIFICHE_PIANO_LAVORO, VERSIONE_CONDIZIONI_PIANO_LAVORO } from "@/lib/piano-lavoro-acquisto-calcoli";
import { ETICHETTA_LINK_CONDIZIONI, PERCORSO_CONDIZIONI_PIANO_LAVORO } from "@/lib/piano-lavoro-testi";

const statoIniziale: AcquistoPacchettoState = {};

// Acquisto di un pacchetto: condizioni del pacchetto e avvertenze del servizio (versionate) da accettare, poi il pagamento su Stripe. Il prezzo
// che si vede viene rimandato al server solo per accorgersi se nel frattempo è cambiato: il server lo rilegge sempre.
export default function AcquistoPacchettoForm({
  servizio,
  quantita,
  prezzoCentesimi,
  privacyVersione,
  aperto,
  offertaId,
}: {
  servizio: ServizioPacchetto;
  quantita: number;
  prezzoCentesimi: number;
  privacyVersione: number | null;
  aperto: boolean;
  // l'offerta dedicata al cliente, se il pacchetto è quello: il server rilegge quantità e prezzo dall'offerta
  offertaId?: string;
}) {
  const suffisso = offertaId ? `offerta-${offertaId}` : String(quantita);
  const [stato, formAction, inCorso] = useActionState(acquistaPacchettoServizio, statoIniziale);
  const [accetta, setAccetta] = useState(false);
  const [approva, setApprova] = useState(false);
  const prezzo = stato.prezzoAggiornatoCentesimi ?? prezzoCentesimi;
  const aggiornato = stato.prezzoAggiornatoCentesimi !== undefined && stato.prezzoAggiornatoCentesimi !== prezzoCentesimi;
  const unita = testoUnita(quantita, servizio);

  return (
    <form action={formAction} style={{ marginTop: 14 }}>
      <input type="hidden" name="servizio" value={servizio} />
      <input type="hidden" name="quantita" value={quantita} />
      {offertaId && <input type="hidden" name="offertaId" value={offertaId} />}
      <input type="hidden" name="prezzoMostratoCentesimi" value={prezzo} />

      <details open={aperto}>
        <summary style={{ cursor: "pointer" }}>
          Condizioni del pacchetto (versione {VERSIONE_CONDIZIONI_PACCHETTI}) e avvertenze sul servizio (versione {VERSIONE_CONDIZIONI_PIANO_LAVORO})
        </summary>
        <div style={{ marginTop: 10, maxHeight: 280, overflowY: "auto", paddingRight: 8, fontSize: 14, lineHeight: 1.55 }}>
          <p style={{ margin: "0 0 8px" }}>
            <strong>Il pacchetto</strong>
          </p>
          {CLAUSOLE_PACCHETTI.map((c) => (
            <p key={`p${c.numero}`} style={{ margin: "0 0 10px" }}>
              <strong>
                {c.numero}. {c.titolo}.
              </strong>{" "}
              {c.testo}
            </p>
          ))}
          <p style={{ margin: "14px 0 8px" }}>
            <strong>Le avvertenze sul servizio «piano di lavoro»</strong>
          </p>
          {CLAUSOLE_PIANO_LAVORO.map((c) => (
            <p key={`s${c.numero}`} style={{ margin: "0 0 10px" }}>
              <strong>
                {c.numero}. {c.titolo}.
              </strong>{" "}
              {c.testo}
            </p>
          ))}
          <p style={{ margin: 0 }}>
            <a href={PERCORSO_CONDIZIONI_PIANO_LAVORO} target="_blank" rel="noopener noreferrer">
              {ETICHETTA_LINK_CONDIZIONI}
            </a>
          </p>
        </div>
      </details>

      <div className="omnia-check-riga">
        <input id={`accettaCondizioni-${suffisso}`} name="accettaCondizioni" type="checkbox" checked={accetta} onChange={(e) => setAccetta(e.target.checked)} required />
        <label htmlFor={`accettaCondizioni-${suffisso}`}>
          Dichiaro di aver letto e accettato le condizioni del pacchetto (versione {VERSIONE_CONDIZIONI_PACCHETTI}) e le avvertenze sul piano di lavoro (versione{" "}
          {VERSIONE_CONDIZIONI_PIANO_LAVORO}) e di aver preso visione della{" "}
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
        <input id={`accettaClausole-${suffisso}`} name="accettaClausole" type="checkbox" checked={approva} onChange={(e) => setApprova(e.target.checked)} required />
        <label htmlFor={`accettaClausole-${suffisso}`}>
          Dichiaro di approvare specificamente, ai sensi di legge, le clausole n. {CLAUSOLE_SPECIFICHE_PACCHETTI.map((c) => c.numero).join(", ")} del pacchetto (
          {CLAUSOLE_SPECIFICHE_PACCHETTI.map((c) => c.titolo.toLowerCase()).join("; ")}) e le clausole n. {CLAUSOLE_SPECIFICHE_PIANO_LAVORO.map((c) => c.numero).join(", ")} delle avvertenze sul
          piano di lavoro ({CLAUSOLE_SPECIFICHE_PIANO_LAVORO.map((c) => c.titolo.toLowerCase()).join("; ")}).
        </label>
      </div>

      {stato.error && !inCorso && (
        <p className="omnia-messaggio-stato errore" style={{ marginTop: 12 }}>
          {stato.error}
          {aggiornato ? ` Nuovo importo: ${formattaEuro(prezzo)}.` : ""}
        </p>
      )}

      <p style={{ marginTop: 14 }}>
        <button type="submit" className="omnia-btn omnia-btn-p" disabled={!accetta || !approva || inCorso}>
          {inCorso ? "Apertura del pagamento…" : `Acquista ${unita} — ${formattaEuro(prezzo)}`}
        </button>
      </p>
    </form>
  );
}
