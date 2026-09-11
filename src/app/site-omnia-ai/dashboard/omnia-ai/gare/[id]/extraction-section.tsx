"use client";

import { useActionState } from "react";
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
    <section className="mt-8 rounded-2xl border border-border bg-cream-soft p-5">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-mono text-xs tracking-wide text-sage uppercase">
          Dati estratti dall&apos;AI
        </h2>
        <form action={formAction}>
          <input type="hidden" name="garaId" value={garaId} />
          <button
            type="submit"
            disabled={pending}
            className="rounded-full border border-border-strong px-4 py-1.5 font-mono text-xs tracking-wide text-ink uppercase transition-colors hover:bg-ink hover:text-cream disabled:opacity-50"
          >
            {pending
              ? "Analisi in corso..."
              : hasData
                ? "Rianalizza documenti"
                : "Estrai dati con AI"}
          </button>
        </form>
      </div>

      {state.error && (
        <p className="mt-3 text-sm text-red-700">{state.error}</p>
      )}

      {estrazione.estrazione_stato === "errore" && !state.error && (
        <p className="mt-3 text-sm text-red-700">
          L&apos;ultima analisi non è andata a buon fine. Riprova.
        </p>
      )}

      {hasData ? (
        <div className="mt-4 space-y-5 text-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-cream px-3 py-2">
              <span className="block text-xs text-sage">Scadenza</span>
              <span className="text-ink">
                {estrazione.scadenza
                  ? new Date(estrazione.scadenza).toLocaleDateString("it-IT")
                  : "Non specificata"}
              </span>
            </div>
            <div className="rounded-lg border border-border bg-cream px-3 py-2">
              <span className="block text-xs text-sage">Importo</span>
              <span className="text-ink">
                {estrazione.importo
                  ? Number(estrazione.importo).toLocaleString("it-IT", {
                      style: "currency",
                      currency: "EUR",
                    })
                  : "Non specificato"}
              </span>
            </div>
            <div className="rounded-lg border border-border bg-cream px-3 py-2">
              <span className="block text-xs text-sage">Formattazione offerta tecnica</span>
              <span className="text-ink">
                {estrazione.relazione_font ?? "font non specificato"}
                {estrazione.relazione_dimensione_carattere
                  ? `, ${estrazione.relazione_dimensione_carattere}pt`
                  : ""}
                {estrazione.relazione_interlinea
                  ? `, interlinea ${estrazione.relazione_interlinea}`
                  : ""}
              </span>
            </div>
            <div className="rounded-lg border border-border bg-cream px-3 py-2">
              <span className="block text-xs text-sage">Limite pagine</span>
              <span className="text-ink">
                {estrazione.limite_pagine_totale
                  ? `${estrazione.limite_pagine_totale} pagine max`
                  : "Nessun limite complessivo indicato"}
              </span>
            </div>
          </div>

          {estrazione.criteri_riepilogo && estrazione.criteri_riepilogo.length > 0 && (
            <div>
              <span className="block text-xs text-sage">
                Criteri di valutazione
                {estrazione.punteggio_tecnico_max
                  ? ` — tecnica ${estrazione.punteggio_tecnico_max} punti${
                      estrazione.punteggio_economico_max
                        ? ` / economica ${estrazione.punteggio_economico_max} punti`
                        : ""
                    }`
                  : ""}
              </span>
              <table className="mt-1.5 w-full overflow-hidden rounded-lg border border-border text-left" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr className="bg-ink/5">
                    <th className="px-3 py-1.5 font-medium text-ink">N.</th>
                    <th className="px-3 py-1.5 font-medium text-ink">Criterio</th>
                    <th className="px-3 py-1.5 text-right font-medium text-ink">Punti max</th>
                  </tr>
                </thead>
                <tbody>
                  {estrazione.criteri_riepilogo.map((c, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-3 py-1.5 text-ink">{c.numero}</td>
                      <td className="px-3 py-1.5 text-ink">{c.titolo}</td>
                      <td className="px-3 py-1.5 text-right text-ink">{c.punti_max}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {estrazione.requisiti_chiave && estrazione.requisiti_chiave.length > 0 && (
            <div>
              <span className="block text-xs text-sage">Requisiti chiave</span>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-ink">
                {estrazione.requisiti_chiave.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          <details className="rounded-lg border border-border bg-cream">
            <summary className="cursor-pointer select-none px-3 py-2 font-mono text-xs tracking-wide text-sage uppercase">
              Dettagli completi (uso interno di OMNIA AI)
            </summary>
            <dl className="space-y-3 px-3 pb-3 pt-1 text-sm">
              <div>
                <dt className="text-sage">Criteri di valutazione — testo completo</dt>
                <dd className="mt-1 whitespace-pre-line text-justify text-ink">
                  {estrazione.criteri_valutazione}
                </dd>
              </div>
              <div>
                <dt className="text-sage">Requisiti di partecipazione — testo completo</dt>
                <dd className="mt-1 whitespace-pre-line text-justify text-ink">
                  {estrazione.requisiti}
                </dd>
              </div>
              <div>
                <dt className="text-sage">Limiti di pagine/formattazione — testo completo</dt>
                <dd className="mt-1 whitespace-pre-line text-justify text-ink">
                  {estrazione.limiti_formattazione}
                </dd>
              </div>
            </dl>
          </details>
        </div>
      ) : (
        <p className="mt-3 text-sm text-sage">
          Nessuna analisi ancora eseguita. Carica i documenti (PDF) e avvia
          l&apos;estrazione.
        </p>
      )}
    </section>
  );
}
