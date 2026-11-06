"use client";

import { useActionState, useState } from "react";
import {
  startOmniaAiSubscriptionCheckout,
  type OmniaAiCheckoutState,
} from "@/app/actions/omnia-ai-subscription";
import ConsensiAbbonamento from "@/components/omnia-ai/consensi-abbonamento";
import OpzionePianoLavoro from "@/components/omnia-ai/opzione-piano-lavoro";
import { PIANI, type PianoSlug } from "@/lib/omnia-ai-plans";

const initialState: OmniaAiCheckoutState = {};

export default function AbbonatiPianoForm({
  piano,
  emailUtente,
  condizioniVersion,
  privacyVersion,
  allegatoVersion,
  offertaPianoLavoro,
}: {
  piano: PianoSlug;
  emailUtente: string | null;
  condizioniVersion: number;
  privacyVersion: number;
  allegatoVersion: number | null;
  // il supplemento e il prezzo mensile con il piano di lavoro; null = l'opzione non è in vendita
  offertaPianoLavoro: { surplusCentesimi: number; totaleCentesimi: number } | null;
}) {
  const [state, formAction, pending] = useActionState(
    startOmniaAiSubscriptionCheckout,
    initialState,
  );
  const [acceptCondizioniPrivacy, setAcceptCondizioniPrivacy] = useState(false);
  const [acceptClausoleSpecifiche, setAcceptClausoleSpecifiche] = useState(false);
  const [pianoLavoro, setPianoLavoro] = useState(false);
  const [acceptPianoLavoro, setAcceptPianoLavoro] = useState(false);

  const canSubmit = acceptCondizioniPrivacy && acceptClausoleSpecifiche && (!pianoLavoro || acceptPianoLavoro);

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

      {offertaPianoLavoro && (
        <OpzionePianoLavoro
          nomePiano={PIANI[piano].nome}
          surplusCentesimi={offertaPianoLavoro.surplusCentesimi}
          totaleCentesimi={offertaPianoLavoro.totaleCentesimi}
          aggiunto={pianoLavoro}
          onAggiuntoChange={setPianoLavoro}
          accettato={acceptPianoLavoro}
          onAccettatoChange={setAcceptPianoLavoro}
        />
      )}

      <ConsensiAbbonamento
        condizioniVersion={condizioniVersion}
        privacyVersion={privacyVersion}
        allegatoVersion={allegatoVersion}
        condizioniAccettate={acceptCondizioniPrivacy}
        onCondizioniChange={setAcceptCondizioniPrivacy}
        clausoleApprovate={acceptClausoleSpecifiche}
        onClausoleChange={setAcceptClausoleSpecifiche}
      />

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
