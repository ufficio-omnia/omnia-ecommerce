"use client";

import { useActionState, useState } from "react";
import {
  startOmniaAiSubscriptionCheckout,
  type OmniaAiCheckoutState,
} from "@/app/actions/omnia-ai-subscription";
import type { PianoSlug } from "@/lib/omnia-ai-plans";

const initialState: OmniaAiCheckoutState = {};

export default function AbbonatiPianoForm({
  piano,
  emailUtente,
  condizioniVersion,
  privacyVersion,
}: {
  piano: PianoSlug;
  emailUtente: string | null;
  condizioniVersion: number;
  privacyVersion: number;
}) {
  const [state, formAction, pending] = useActionState(
    startOmniaAiSubscriptionCheckout,
    initialState,
  );
  const [acceptCondizioniPrivacy, setAcceptCondizioniPrivacy] = useState(false);
  const [acceptClausoleSpecifiche, setAcceptClausoleSpecifiche] = useState(false);

  const canSubmit = acceptCondizioniPrivacy && acceptClausoleSpecifiche;
  const condizioniUrl = `/documenti-legali/condizioni-abbonamento/${condizioniVersion}`;

  return (
    <form action={formAction} className="omnia-modulo">
      <input type="hidden" name="planSlug" value={piano} />

      {emailUtente ? (
        <p className="omnia-riquadro-nota">
          Riceverai la fattura su <strong>{emailUtente}</strong>, l&apos;email del tuo account.
        </p>
      ) : (
        <div>
          <label className="omnia-etichetta" htmlFor="email">
            Email
          </label>
          <input
            className="omnia-input"
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
          />
        </div>
      )}

      <div className="omnia-riquadro">
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
        {pending ? "Attivazione in corso..." : "Abbonati"}
      </button>
    </form>
  );
}
