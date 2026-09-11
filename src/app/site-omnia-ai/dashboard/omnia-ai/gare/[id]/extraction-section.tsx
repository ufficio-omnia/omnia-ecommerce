"use client";

import { useActionState } from "react";
import Link from "next/link";
import {
  extractGaraData,
  type ExtractionState,
} from "@/app/actions/gara-extraction";

const initialState: ExtractionState = {};

type CriterioRiepilogo = { numero: string; titolo: string; punti_max: number };

export type Estrazione = {
  scadenza: string | null;
  importo: number | null;
  criteri_valutazione: string | null;
  requisiti: string | null;
  limiti_formattazione: string | null;
  relazione_font: string | null;
  relazione_dimensione_carattere: number | null;
  relazione_interlinea: number | null;
  limite_pagine_totale: number | null;
  punteggio_tecnico_max: number | null;
  punteggio_economico_max: number | null;
  criteri_riepilogo: CriterioRiepilogo[] | null;
  requisiti_chiave: string[] | null;
  estrazione_stato: string;
  estrazione_aggiornata_il: string | null;
};

export default function ExtractionSection({
  garaId,
  estrazione,
}: {
  garaId: string;
  estrazione: Estrazione;
}) {
  const [state, formAction, pending] = useActionState(
    extractGaraData,
    initialState,
  );

  const hasData = estrazione.estrazione_stato === "completata";

  return (
    <section className="omnia-riquadro" style={{ marginTop: 24 }}>
      <div className="omnia-app-intestazione">
        <span className="omnia-eyebrow">Dati estratti dall&apos;AI</span>
        <form action={formAction}>
          <input type="hidden" name="garaId" value={garaId} />
          <button type="submit" disabled={pending} className="omnia-btn omnia-btn-p omnia-btn-piccolo">
            {pending
              ? "Analisi in corso..."
              : hasData
                ? "Rianalizza documenti"
                : "Estrai dati con AI"}
          </button>
        </form>
      </div>

      {state.error && (
        <div className="omnia-messaggio-stato errore">
          <p style={{ margin: 0 }}>{state.error}</p>
          {state.quotaEsaurita && (
            <Link
              href="/dashboard/omnia-ai/abbonamento"
              className="omnia-btn omnia-btn-s omnia-btn-piccolo"
              style={{ marginTop: 10, display: "inline-block" }}
            >
              Acquista crediti o gestisci l&apos;abbonamento →
            </Link>
          )}
        </div>
      )}

      {estrazione.estrazione_stato === "errore" && !state.error && (
        <p className="omnia-messaggio-stato errore">
          L&apos;ultima analisi non è andata a buon fine. Riprova.
        </p>
      )}

      {hasData ? (
        <div style={{ marginTop: 8 }}>
          <div className="omnia-dati-griglia">
            <div className={`omnia-dato${estrazione.scadenza ? " ambra" : ""}`}>
              <div className="omnia-dato-etichetta">Scadenza</div>
              <div className="omnia-dato-valore">
                {estrazione.scadenza
                  ? new Date(estrazione.scadenza).toLocaleDateString("it-IT")
                  : "Non specificata"}
              </div>
            </div>
            <div className="omnia-dato">
              <div className="omnia-dato-etichetta">Importo</div>
              <div className="omnia-dato-valore">
                {estrazione.importo
                  ? Number(estrazione.importo).toLocaleString("it-IT", {
                      style: "currency",
                      currency: "EUR",
                    })
                  : "Non specificato"}
              </div>
            </div>
            <div className="omnia-dato">
              <div className="omnia-dato-etichetta">Formattazione offerta tecnica</div>
              <div className="omnia-dato-valore">
                {estrazione.relazione_font ?? "font non specificato"}
                {estrazione.relazione_dimensione_carattere
                  ? `, ${estrazione.relazione_dimensione_carattere}pt`
                  : ""}
                {estrazione.relazione_interlinea
                  ? `, interlinea ${estrazione.relazione_interlinea}`
                  : ""}
              </div>
            </div>
            <div className="omnia-dato">
              <div className="omnia-dato-etichetta">Limite pagine</div>
              <div className="omnia-dato-valore">
                {estrazione.limite_pagine_totale
                  ? `${estrazione.limite_pagine_totale} pagine max`
                  : "Nessun limite complessivo indicato"}
              </div>
            </div>
          </div>

          {estrazione.criteri_riepilogo && estrazione.criteri_riepilogo.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <span className="omnia-eyebrow">
                Criteri di valutazione
                {estrazione.punteggio_tecnico_max
                  ? ` — tecnica ${estrazione.punteggio_tecnico_max} punti${
                      estrazione.punteggio_economico_max
                        ? ` / economica ${estrazione.punteggio_economico_max} punti`
                        : ""
                    }`
                  : ""}
              </span>
              <div className="omnia-tabella-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>N.</th>
                      <th>Criterio</th>
                      <th className="num">Punti max</th>
                    </tr>
                  </thead>
                  <tbody>
                    {estrazione.criteri_riepilogo.map((c, i) => (
                      <tr key={i}>
                        <td>{c.numero}</td>
                        <td>{c.titolo}</td>
                        <td className="num">{c.punti_max}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {estrazione.requisiti_chiave && estrazione.requisiti_chiave.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <span className="omnia-eyebrow">Requisiti chiave</span>
              <ul style={{ marginTop: 10 }}>
                {estrazione.requisiti_chiave.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          <details className="omnia-dettagli" style={{ marginTop: 24 }}>
            <summary>Dettagli completi (uso interno di OMNIA AI)</summary>
            <dl className="omnia-dettagli-corpo">
              <div>
                <dt>Criteri di valutazione — testo completo</dt>
                <dd>{estrazione.criteri_valutazione}</dd>
              </div>
              <div>
                <dt>Requisiti di partecipazione — testo completo</dt>
                <dd>{estrazione.requisiti}</dd>
              </div>
              <div>
                <dt>Limiti di pagine/formattazione — testo completo</dt>
                <dd>{estrazione.limiti_formattazione}</dd>
              </div>
            </dl>
          </details>
        </div>
      ) : (
        <p className="omnia-riquadro-nota" style={{ marginTop: 12 }}>
          Nessuna analisi ancora eseguita. Carica i documenti (PDF) e avvia l&apos;estrazione.
        </p>
      )}
    </section>
  );
}
