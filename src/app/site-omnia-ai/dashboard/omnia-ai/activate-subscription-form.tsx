"use client";

import { useActionState, useState } from "react";
import {
  startOmniaAiSubscriptionCheckout,
  type OmniaAiCheckoutState,
} from "@/app/actions/omnia-ai-subscription";
import ConsensiAbbonamento from "@/components/omnia-ai/consensi-abbonamento";
import { formatEuroCifra, type PianoSlug } from "@/lib/omnia-ai-plans";
import { testoOfferta, type PianoCatalogo } from "@/lib/omnia-ai-catalogo-calcoli";

const initialState: OmniaAiCheckoutState = {};

export default function ActivateSubscriptionForm({
  piani,
  condizioniVersion,
  privacyVersion,
  allegatoVersion,
}: {
  // i piani con il prezzo e lo sconto di oggi (catalogo modificabile dalla console)
  piani: PianoCatalogo[];
  condizioniVersion: number;
  privacyVersion: number;
  // versione in vigore dell'Allegato A; null se non esiste ancora
  allegatoVersion: number | null;
}) {
  const [state, formAction, pending] = useActionState(
    startOmniaAiSubscriptionCheckout,
    initialState,
  );
  const [planSlug, setPlanSlug] = useState<PianoSlug>("professional");
  const [acceptCondizioniPrivacy, setAcceptCondizioniPrivacy] = useState(false);
  const [acceptClausoleSpecifiche, setAcceptClausoleSpecifiche] = useState(false);

  const canSubmit = acceptCondizioniPrivacy && acceptClausoleSpecifiche;

  return (
    <form action={formAction}>
      <input type="hidden" name="planSlug" value={planSlug} />

      <div className="omnia-piani-scelta">
        {piani.map((p) => {
          const slug = p.slug;
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
                {p.sconto && <span className="omnia-prezzo-prima">{formatEuroCifra(p.prezzoListinoCentesimi)} €</span>}
                <span className="cifra">{formatEuroCifra(p.prezzoCentesimi)}</span>
                <span className="simbolo">€</span>
                <span className="periodo">/mese</span>
              </div>
              {p.sconto && <p className="omnia-prezzo-offerta">{testoOfferta(p.sconto, p.prezzoListinoCentesimi)}</p>}
              <ul>
                {p.voci.map((v) => (
                  <li key={v}>{v}</li>
                ))}
              </ul>
            </label>
          );
        })}
      </div>

      <ConsensiAbbonamento
        condizioniVersion={condizioniVersion}
        privacyVersion={privacyVersion}
        allegatoVersion={allegatoVersion}
        condizioniAccettate={acceptCondizioniPrivacy}
        onCondizioniChange={setAcceptCondizioniPrivacy}
        clausoleApprovate={acceptClausoleSpecifiche}
        onClausoleChange={setAcceptClausoleSpecifiche}
        margineSuperiore={24}
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
        {pending ? "Attivazione in corso..." : `Attiva il piano ${piani.find((p) => p.slug === planSlug)?.nome ?? ""}`}
      </button>
    </form>
  );
}
