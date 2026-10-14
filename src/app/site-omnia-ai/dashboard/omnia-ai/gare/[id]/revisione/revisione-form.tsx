"use client";

import { useActionState, useState } from "react";
import { avviaRevisioneUmana, type RevisioneState } from "@/app/actions/omnia-ai-revisione";
import { formatEuro } from "@/lib/omnia-ai-plans";
import { REVISIONE, descriviFontePagine, testoRegoleUrgenza, type FontePagine } from "@/lib/omnia-ai-revisione-calcoli";
import { CLAUSOLE_REVISIONE, CLAUSOLE_SPECIFICHE_REVISIONE, VERSIONE_CONDIZIONI_REVISIONE } from "@/lib/omnia-ai-revisione-condizioni";

const statoIniziale: RevisioneState = {};

export type PrezzoPerForm = {
  pagine: number;
  fonte: FontePagine;
  baseCentesimi: number;
  maggiorazionePercentuale: number;
  totaleCentesimi: number;
  scadenzaTesto: string | null;
};

export default function RevisioneForm({
  garaId,
  prezzo,
  privacyVersion,
  emailAccount,
}: {
  garaId: string;
  prezzo: PrezzoPerForm;
  privacyVersion: number | null;
  emailAccount: string;
}) {
  const [stato, azione, inCorso] = useActionState(avviaRevisioneUmana, statoIniziale);
  const [accettaCondizioni, setAccettaCondizioni] = useState(false);
  const [approvaClausole, setApprovaClausole] = useState(false);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [cellulare, setCellulare] = useState("");

  // il prezzo può cambiare mentre il cliente compila (la scadenza passa a una fascia di urgenza diversa):
  // l'azione lo dice, e qui si mostra quello nuovo
  const totale = stato.prezzoAggiornatoCentesimi ?? prezzo.totaleCentesimi;
  const aggiornato = stato.prezzoAggiornatoCentesimi !== undefined && stato.prezzoAggiornatoCentesimi !== prezzo.totaleCentesimi;
  const puoProcedere = accettaCondizioni && approvaClausole && nome.trim() !== "" && email.trim() !== "" && cellulare.trim() !== "";
  const numeriSpecifiche = CLAUSOLE_SPECIFICHE_REVISIONE.map((c) => c.numero);

  return (
    <form action={azione} className="omnia-modulo">
      <input type="hidden" name="garaId" value={garaId} />
      <input type="hidden" name="prezzoMostratoCentesimi" value={totale} />

      <section className="omnia-riquadro">
        <span className="omnia-eyebrow">Il prezzo</span>
        <div className="omnia-dati-griglia" style={{ marginTop: 8 }}>
          <div className="omnia-dato">
            <div className="omnia-dato-etichetta">Pagine considerate</div>
            <div className="omnia-dato-valore">{prezzo.pagine}</div>
            <div className="omnia-riquadro-nota" style={{ margin: "4px 0 0" }}>
              {descriviFontePagine(prezzo.fonte)}
            </div>
          </div>
          <div className="omnia-dato">
            <div className="omnia-dato-etichetta">Prezzo di base</div>
            <div className="omnia-dato-valore">{formatEuro(prezzo.baseCentesimi)}</div>
          </div>
          {prezzo.maggiorazionePercentuale > 0 && (
            <div className="omnia-dato ambra">
              <div className="omnia-dato-etichetta">Maggiorazione per urgenza</div>
              <div className="omnia-dato-valore">+{prezzo.maggiorazionePercentuale}%</div>
              {prezzo.scadenzaTesto && (
                <div className="omnia-riquadro-nota" style={{ margin: "4px 0 0" }}>
                  la gara scade il {prezzo.scadenzaTesto}
                </div>
              )}
            </div>
          )}
          <div className="omnia-dato">
            <div className="omnia-dato-etichetta">Totale da pagare</div>
            <div className="omnia-dato-valore">{formatEuro(totale)}</div>
            <div className="omnia-riquadro-nota" style={{ margin: "4px 0 0" }}>
              IVA inclusa
            </div>
          </div>
        </div>
        <p className="omnia-riquadro-nota">
          Il prezzo va da {formatEuro(REVISIONE.prezzoBaseCentesimi)} (fino a {REVISIONE.pagineBase} pagine) a {formatEuro(REVISIONE.prezzoMassimoCentesimi)} ({REVISIONE.pagineMassimo} pagine o più). {testoRegoleUrgenza()}
        </p>
        {aggiornato && (
          <p className="omnia-messaggio-stato avviso">
            Il prezzo è stato aggiornato in base alla scadenza della gara: ora è <strong>{formatEuro(totale)}</strong>. Controllalo e conferma di nuovo.
          </p>
        )}
      </section>

      <section className="omnia-riquadro" style={{ marginTop: 20 }}>
        <span className="omnia-eyebrow">Cosa ci impegniamo a fare, e cosa serve da te</span>
        <ul style={{ margin: "10px 0 0", paddingLeft: 20, lineHeight: 1.6 }}>
          <li>
            Entro <strong>{REVISIONE.oreContattoLavorative} ore lavorative</strong> un consulente umano ti contatta personalmente.
          </li>
          <li>
            Entro <strong>{REVISIONE.oreConsegna} ore</strong> dall&apos;invio ricevi la relazione tecnica revisionata, completa di <strong>intestazione, piè di pagina e copertina grafica personalizzata</strong>.
          </li>
          <li>OMNIA AI si impegna al segreto professionale su tutto ciò che ci affidi.</li>
          <li>Tu ti impegni a fornire tutte le informazioni necessarie alla revisione e a rendere raggiungibile il referente.</li>
        </ul>
      </section>

      <section className="omnia-riquadro" style={{ marginTop: 20 }}>
        <span className="omnia-eyebrow">Referente della gara</span>
        <p className="omnia-riquadro-nota" style={{ marginTop: 6 }}>
          È la persona che il consulente chiamerà per la revisione.
        </p>
        <div className="omnia-campo-griglia" style={{ marginTop: 12 }}>
          <div className="largo">
            <label className="omnia-etichetta" htmlFor="referenteNome">
              Nome e cognome
            </label>
            <input className="omnia-input" id="referenteNome" name="referenteNome" required autoComplete="name" maxLength={120} value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>
          <div>
            <label className="omnia-etichetta" htmlFor="referenteEmail">
              Email
            </label>
            <input className="omnia-input" id="referenteEmail" name="referenteEmail" type="email" required autoComplete="email" placeholder={emailAccount} maxLength={160} value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="omnia-etichetta" htmlFor="referenteCellulare">
              Cellulare
            </label>
            <input className="omnia-input" id="referenteCellulare" name="referenteCellulare" type="tel" required autoComplete="tel" placeholder="+39 333 1234567" maxLength={30} value={cellulare} onChange={(e) => setCellulare(e.target.value)} />
          </div>
        </div>
      </section>

      <section className="omnia-riquadro" style={{ marginTop: 20 }}>
        <span className="omnia-eyebrow">Condizioni del servizio (versione {VERSIONE_CONDIZIONI_REVISIONE})</span>
        <div style={{ marginTop: 10, maxHeight: 280, overflowY: "auto", paddingRight: 8, fontSize: 14, lineHeight: 1.55 }}>
          {CLAUSOLE_REVISIONE.map((c) => (
            <p key={c.numero} id={`clausola-revisione-${c.numero}`} style={{ margin: "0 0 10px" }}>
              <strong>
                {c.numero}. {c.titolo}.
              </strong>{" "}
              {c.testo}
            </p>
          ))}
        </div>

        <div className="omnia-check-riga">
          <input id="acceptCondizioni" name="acceptCondizioni" type="checkbox" checked={accettaCondizioni} onChange={(e) => setAccettaCondizioni(e.target.checked)} required />
          <label htmlFor="acceptCondizioni">
            Dichiaro di aver letto e accettato le Condizioni del servizio di revisione umana (versione {VERSIONE_CONDIZIONI_REVISIONE}) e di aver preso visione della{" "}
            {privacyVersion ? (
              <a href={`/documenti-legali/privacy-policy/${privacyVersion}`} target="_blank" rel="noopener noreferrer">
                Privacy policy (versione {privacyVersion})
              </a>
            ) : (
              "Privacy policy"
            )}
            .
          </label>
        </div>
        <div className="omnia-check-riga">
          <input id="acceptClausole" name="acceptClausole" type="checkbox" checked={approvaClausole} onChange={(e) => setApprovaClausole(e.target.checked)} required />
          <label htmlFor="acceptClausole">
            Dichiaro di approvare specificamente, ai sensi di legge, le clausole n. {numeriSpecifiche.join(" e ")} (
            {CLAUSOLE_SPECIFICHE_REVISIONE.map((c) => c.titolo.toLowerCase()).join("; ")}) delle Condizioni del servizio di revisione umana.
          </label>
        </div>
      </section>

      {stato.error && !aggiornato && (
        <p className="omnia-messaggio-stato errore" style={{ marginTop: 16 }}>
          {stato.error}
        </p>
      )}

      <p style={{ marginTop: 20 }}>
        <button type="submit" className="omnia-btn omnia-btn-p" disabled={!puoProcedere || inCorso}>
          {inCorso ? "Apertura del pagamento…" : `Procedi al pagamento — ${formatEuro(totale)}`}
        </button>
      </p>
      <p className="omnia-riquadro-nota">Pagherai in modo sicuro con carta su Stripe. Ti arriverà una email di conferma e noi riceveremo subito la tua richiesta.</p>
    </form>
  );
}
