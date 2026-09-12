"use client";

import { useActionState, useState } from "react";
import {
  startOmniaAiSubscriptionCheckout,
  type OmniaAiCheckoutState,
} from "@/app/actions/omnia-ai-subscription";
import { PIANI, PIANI_ORDINE, formatEuroCifra, type PianoSlug } from "@/lib/omnia-ai-plans";

const initialState: OmniaAiCheckoutState = {};

export default function ActivateSubscriptionForm({
  condizioniVersion,
  privacyVersion,
}: {
  condizioniVersion: number;
  privacyVersion: number;
}) {
  const [state, formAction, pending] = useActionState(
    startOmniaAiSubscriptionCheckout,
    initialState,
  );
  const [planSlug, setPlanSlug] = useState<PianoSlug>("professional");
  const [acceptCondizioniPrivacy, setAcceptCondizioniPrivacy] = useState(false);
  const [acceptClausoleSpecifiche, setAcceptClausoleSpecifiche] = useState(false);

  const canSubmit = acceptCondizioniPrivacy && acceptClausoleSpecifiche;
  const condizioniUrl = `/documenti-legali/condizioni-abbonamento/${condizioniVersion}`;

  return (
    <form action={formAction}>
      <input type="hidden" name="planSlug" value={planSlug} />

      <div className="omnia-piani-scelta">
        {PIANI_ORDINE.map((slug) => {
          const p = PIANI[slug];
          return (
            <label
              key={slug}
              className={`omnia-piano-scelta${planSlug === slug ? " selezionato" : ""}`}
            >
              <input
                type="radio"
                name="pianoRadio"
                value={slug}
                checked={planSlug === slug}
                onChange={() => setPlanSlug(slug)}
              />
              <div className="nome">{p.nome}</div>
              <div className="prezzo">
                <span className="cifra">{formatEuroCifra(p.prezzoCentesimi)}</span>
                <span className="simbolo">€</span>
                <span className="periodo">/mese</span>
              </div>
              <ul>
                {p.voci.map((v) => (
                  <li key={v}>{v}</li>
                ))}
              </ul>
            </label>
          );
        })}
      </div>

      <div className="omnia-riquadro" style={{ marginTop: 24 }}>
        <span className="omnia-eyebrow">Condizioni contrattuali</span>

        <div className="omnia-check-riga">
          <input
            id="acceptCondizioniPrivacy"
            name="acceptCondizioniPrivacy"
            type="checkbox"
            checked={acceptCondizioniPrivacy}
            onChange={(e) => setAcceptCondizioniPrivacy(e.target.checked)}
            required
          />
          <label htmlFor="acceptCondizioniPrivacy">
            Dichiaro di aver letto e accettato le{" "}
            <a href={condizioniUrl} target="_blank" rel="noopener noreferrer">
              Condizioni di abbonamento (versione {condizioniVersion})
            </a>{" "}
            e di aver preso visione della{" "}
            <a
              href={`/documenti-legali/privacy-policy/${privacyVersion}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Privacy policy (versione {privacyVersion})
            </a>
            .
          </label>
        </div>

        <div className="omnia-check-riga">
          <input
            id="acceptClausoleSpecifiche"
            name="acceptClausoleSpecifiche"
            type="checkbox"
            checked={acceptClausoleSpecifiche}
            onChange={(e) => setAcceptClausoleSpecifiche(e.target.checked)}
            required
          />
          <label htmlFor="acceptClausoleSpecifiche">
            Dichiaro di approvare specificamente, ai sensi di legge, le clausole n.{" "}
            <a href={`${condizioniUrl}#clausola-5`} target="_blank" rel="noopener noreferrer">
              5
            </a>{" "}
            (Gare incluse e crediti aggiuntivi),{" "}
            <a href={`${condizioniUrl}#clausola-8`} target="_blank" rel="noopener noreferrer">
              8
            </a>{" "}
            (Cosa succede dopo la cessazione),{" "}
            <a href={`${condizioniUrl}#clausola-11`} target="_blank" rel="noopener noreferrer">
              11
            </a>{" "}
            (Nessuna garanzia sull&apos;esito della gara) e{" "}
            <a href={`${condizioniUrl}#clausola-14`} target="_blank" rel="noopener noreferrer">
              14
            </a>{" "}
            (Limitazione di responsabilità) delle Condizioni di abbonamento.
          </label>
        </div>
      </div>

      <p className="omnia-riquadro-nota" style={{ marginTop: 16 }}>
        Rinnovo automatico mensile finché non disdici: puoi farlo in qualsiasi momento dalla tua
        area abbonamento, con effetto dalla fine del periodo in corso.
      </p>

      {state.error && (
        <p className="omnia-messaggio-stato errore" style={{ marginTop: 12 }}>
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || !canSubmit}
        className="omnia-btn omnia-btn-p"
        style={{ marginTop: 16 }}
      >
        {pending ? "Attivazione in corso..." : `Attiva il piano ${PIANI[planSlug].nome}`}
      </button>
    </form>
  );
}
