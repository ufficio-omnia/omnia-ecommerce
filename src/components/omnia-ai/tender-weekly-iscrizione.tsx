"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import TurnstileCampo from "@/components/turnstile-campo";
import { NOME_CAMPO_TRAPPOLA } from "@/lib/demo-lead-calcoli";
import { TESTO_CONSENSO_NEWSLETTER } from "@/lib/newsletter/tipi";
import { iscrivitiTenderWeekly, type StatoIscrizione } from "@/app/actions/omnia-ai-newsletter";

// Iscrizione gratuita a Tender Weekly: niente account, niente abbonamento. Usata nella home (prima del piè di pagina) e
// nella pagina /newsletter. Dopo l'invio mostra l'invito a confermare dalla casella di posta (doppia conferma).

const CONTENUTI = [
  { titolo: "La notizia della settimana", testo: "La novità che conta davvero, spiegata con le sue conseguenze pratiche." },
  { titolo: "Normativa e giurisprudenza", testo: "Codice dei contratti, ANAC, MIT, TAR e Consiglio di Stato." },
  { titolo: "L'approfondimento dell'esperto", testo: "Strategie e attenzioni operative per l'ufficio gare." },
];

export default function TenderWeeklyIscrizione({ variante = "sezione" }: { variante?: "sezione" | "pagina" }) {
  const [stato, esegui, inCorso] = useActionState<StatoIscrizione, FormData>(iscrivitiTenderWeekly, {});
  const [email, setEmail] = useState("");

  return (
    <div className={`omnia-tw${variante === "pagina" ? " omnia-tw-pagina" : ""}`}>
      <div className="omnia-tw-testo">
        <p className="omnia-occhiello">Tender Weekly · la newsletter di OMNIA AI</p>
        <h2 className="omnia-tw-titolo">Il mondo degli appalti pubblici, ogni venerdì</h2>
        <p className="omnia-guida omnia-tw-guida">
          Una selezione ragionata delle novità della settimana, con le implicazioni operative per chi partecipa alle gare e sempre le fonti ufficiali da verificare.
        </p>
        <ul className="omnia-tw-elenco">
          {CONTENUTI.map((c) => (
            <li key={c.titolo}>
              <strong>{c.titolo}</strong>
              <span>{c.testo}</span>
            </li>
          ))}
        </ul>
        <p className="omnia-tw-garanzie">Gratuita · nessuna registrazione · ti disiscrivi con un clic</p>
      </div>

      <div className="omnia-tw-scheda">
        <div className="omnia-tw-copertina" aria-hidden="true">
          <span className="omnia-tw-copertina-occhiello">OMNIA AI · Edizione del venerdì</span>
          <span className="omnia-tw-copertina-testata">TENDER WEEKLY</span>
          <span className="omnia-tw-copertina-linea" />
          <span className="omnia-tw-copertina-claim">TECH WHEN POSSIBLE. HUMAN WHEN IT MATTERS.</span>
        </div>

        {stato.ok ? (
          <div className="omnia-tw-esito" role="status" aria-live="polite">
            <svg className="omnia-tw-busta" viewBox="0 0 48 48" aria-hidden="true">
              <rect x="5" y="11" width="38" height="27" rx="4" fill="none" stroke="currentColor" strokeWidth="2.5" />
              <path d="M7 14l17 13 17-13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
            </svg>
            <h3>Controlla la tua casella di posta</h3>
            <p>
              Ti abbiamo inviato un&apos;email{email ? (
                <>
                  {" "}a <strong>{email}</strong>
                </>
              ) : null}
              . Clicca sul link di conferma per completare l&apos;iscrizione: senza conferma non riceverai nulla.
            </p>
            <p className="omnia-tw-nota">Non la trovi? Controlla la cartella spam o promozioni. Il link vale 7 giorni.</p>
          </div>
        ) : (
          <form action={esegui} className="omnia-tw-modulo">
            <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
              <label htmlFor={`tw-${NOME_CAMPO_TRAPPOLA}-${variante}`}>Non compilare questo campo</label>
              <input id={`tw-${NOME_CAMPO_TRAPPOLA}-${variante}`} name={NOME_CAMPO_TRAPPOLA} type="text" tabIndex={-1} autoComplete="off" />
            </div>
            <label className="omnia-etichetta" htmlFor={`tw-email-${variante}`}>
              Indirizzo email
            </label>
            <input
              id={`tw-email-${variante}`}
              className="omnia-input"
              name="email"
              type="email"
              required
              autoComplete="email"
              inputMode="email"
              maxLength={254}
              placeholder="nome@azienda.it"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <label className="omnia-tw-consenso">
              <input type="checkbox" name="consenso" value="1" required />
              <span>
                {TESTO_CONSENSO_NEWSLETTER} Ho letto l&apos;
                <Link href="/privacy" target="_blank">
                  informativa privacy
                </Link>
                .
              </span>
            </label>
            <TurnstileCampo resetKey={stato} tema="sito" />
            {stato.errore && (
              <p className="omnia-tw-errore" role="alert">
                {stato.errore}
              </p>
            )}
            <button type="submit" className="omnia-btn omnia-btn-p omnia-tw-bottone" disabled={inCorso}>
              {inCorso ? "Invio in corso…" : "Iscriviti gratuitamente"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
