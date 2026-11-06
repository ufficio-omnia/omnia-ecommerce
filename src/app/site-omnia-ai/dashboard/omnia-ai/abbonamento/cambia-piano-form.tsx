"use client";

import { useState, useTransition } from "react";
import {
  previewOmniaAiPlanChange,
  confirmOmniaAiPlanChange,
  type PreviewCambioPiano,
} from "@/app/actions/omnia-ai-plan-change";
import { PIANI, PIANI_ORDINE, formatEuro, type PianoSlug } from "@/lib/omnia-ai-plans";
import { CLAUSOLE_PIANO_LAVORO, CLAUSOLE_SPECIFICHE_PIANO_LAVORO, VERSIONE_CONDIZIONI_PIANO_LAVORO } from "@/lib/piano-lavoro-acquisto-calcoli";
import { ETICHETTA_LINK_CONDIZIONI, PERCORSO_CONDIZIONI_PIANO_LAVORO, testoAccettazioneCompleta } from "@/lib/piano-lavoro-testi";

type PreviewOk = Exclude<PreviewCambioPiano, { error: string }>;

// Cambia piano e piano di lavoro. La destinazione è «piano» (si mantiene il piano di lavoro che si ha), «piano:lavoro» (lo si aggiunge) o
// «piano:base» (lo si toglie): il server la rivalida da zero. `surplusPianoLavoro` null = l'aggiunta non è in vendita (togliere e mantenere restano possibili).
export default function CambiaPianoForm({
  pianoAttuale,
  pianoLavoroAttuale = false,
  surplusPianoLavoro = null,
}: {
  pianoAttuale: PianoSlug;
  pianoLavoroAttuale?: boolean;
  surplusPianoLavoro?: Record<PianoSlug, number> | null;
}) {
  const [destinazione, setDestinazione] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewOk | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [fatto, setFatto] = useState(false);
  const [accettaAvvertenze, setAccettaAvvertenze] = useState(false);
  const [pending, startTransition] = useTransition();

  function scegli(dest: string) {
    setDestinazione(dest);
    setPreview(null);
    setErrore(null);
    setAccettaAvvertenze(false);
    startTransition(async () => {
      const risultato = await previewOmniaAiPlanChange(dest);
      if ("error" in risultato) {
        setErrore(risultato.error);
      } else {
        setPreview(risultato);
      }
    });
  }

  function annulla() {
    setDestinazione(null);
    setPreview(null);
    setErrore(null);
    setAccettaAvvertenze(false);
  }

  function conferma() {
    if (!destinazione) return;
    startTransition(async () => {
      const risultato = await confirmOmniaAiPlanChange(destinazione, accettaAvvertenze);
      if (risultato.error) {
        setErrore(risultato.error);
      } else {
        setFatto(true);
      }
    });
  }

  if (fatto) {
    return (
      <p className="omnia-messaggio-stato successo">
        Richiesta inviata. L&apos;aggiornamento sarà visibile qui a breve.
      </p>
    );
  }

  const altriPiani = PIANI_ORDINE.filter((p) => p !== pianoAttuale);
  const numeriSpecifiche = CLAUSOLE_SPECIFICHE_PIANO_LAVORO.map((c) => c.numero);
  // chi sta AGGIUNGENDO il piano di lavoro deve accettare le avvertenze; il server lo riverifica
  const aggiunge = preview?.cambioPianoLavoro === "aggiunto";
  const puoConfermare = !pending && (!aggiunge || accettaAvvertenze);

  const pulsanti = (conferma_etichetta: string) => (
    <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
      <button type="button" onClick={conferma} disabled={!puoConfermare} className="omnia-btn omnia-btn-p omnia-btn-piccolo">
        {pending ? "Conferma in corso..." : conferma_etichetta}
      </button>
      <button type="button" onClick={annulla} disabled={pending} className="omnia-btn omnia-btn-s omnia-btn-piccolo">
        Annulla
      </button>
    </div>
  );

  const avvertenze = aggiunge && (
    <div style={{ marginTop: 12 }}>
      <details>
        <summary style={{ cursor: "pointer" }}>Avvertenze sul piano di lavoro (versione {VERSIONE_CONDIZIONI_PIANO_LAVORO})</summary>
        <div style={{ marginTop: 10, maxHeight: 240, overflowY: "auto", paddingRight: 8, fontSize: 14, lineHeight: 1.55 }}>
          {CLAUSOLE_PIANO_LAVORO.map((c) => (
            <p key={c.numero} style={{ margin: "0 0 10px" }}>
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
        <input id="accettaAvvertenzePianoLavoro" type="checkbox" checked={accettaAvvertenze} onChange={(e) => setAccettaAvvertenze(e.target.checked)} />
        <label htmlFor="accettaAvvertenzePianoLavoro">
          {testoAccettazioneCompleta(numeriSpecifiche, CLAUSOLE_SPECIFICHE_PIANO_LAVORO.map((c) => c.titolo.toLowerCase()))}
        </label>
      </div>
    </div>
  );

  return (
    <div>
      {!destinazione && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {altriPiani.map((p) => (
            <button key={p} type="button" onClick={() => scegli(p)} className="omnia-btn omnia-btn-s omnia-btn-piccolo">
              Passa a {PIANI[p].nome}
              {pianoLavoroAttuale ? " (con piano di lavoro)" : ""}
            </button>
          ))}
          {!pianoLavoroAttuale && surplusPianoLavoro && (
            <button type="button" onClick={() => scegli(`${pianoAttuale}:lavoro`)} className="omnia-btn omnia-btn-s omnia-btn-piccolo">
              Aggiungi il piano di lavoro (+{formatEuro(surplusPianoLavoro[pianoAttuale])} al mese)
            </button>
          )}
          {pianoLavoroAttuale && (
            <button type="button" onClick={() => scegli(`${pianoAttuale}:base`)} className="omnia-btn omnia-btn-s omnia-btn-piccolo">
              Togli il piano di lavoro
            </button>
          )}
        </div>
      )}

      {destinazione && (
        <div className="omnia-riquadro" style={{ marginTop: 16 }}>
          {pending && !preview && !errore && (
            <p className="omnia-riquadro-nota">Calcolo in corso...</p>
          )}

          {errore && (
            <p className="omnia-messaggio-stato errore" style={{ marginTop: 0 }}>
              {errore}
            </p>
          )}

          {preview && preview.tipo === "upgrade" && (
            <>
              <p>
                {preview.stessoPiano ? (
                  <>
                    Aggiunta immediata del piano di lavoro al tuo piano <strong>{PIANI[preview.pianoDestinazione].nome}</strong>: verranno addebitati ora{" "}
                    <strong>{formatEuro(preview.importoImmediatoCentesimi)}</strong> (conguaglio per i giorni residui del periodo in corso). Il piano di lavoro è attivo da questo momento
                    per le gare incluse nel piano.
                  </>
                ) : (
                  <>
                    Passaggio immediato a <strong>{preview.nomeNuovo}</strong>: verranno addebitati ora <strong>{formatEuro(preview.importoImmediatoCentesimi)}</strong> (conguaglio per i
                    giorni residui del periodo in corso). Il nuovo piano è attivo da questo momento.
                  </>
                )}
              </p>
              {!preview.stessoPiano && (
                <p>
                  Da ora e fino al rinnovo avrai <strong>{preview.gareDisponibiliDaOra} gare</strong> disponibili ({preview.gareIncluseNuovo} incluse nel piano{" "}
                  {PIANI[preview.pianoDestinazione].nome}, meno le {preview.gareConsumate} già usate in questo periodo). Dal rinnovo successivo tornerai al pieno di {preview.gareIncluseNuovo}.
                </p>
              )}
              {avvertenze}
              {pulsanti(`Conferma, addebita ${formatEuro(preview.importoImmediatoCentesimi)}`)}
            </>
          )}

          {preview && preview.tipo === "downgrade" && (
            <>
              <p>
                {preview.stessoPiano ? (
                  <>
                    Il piano di lavoro verrà tolto dal tuo abbonamento dal prossimo rinnovo ({new Date(preview.dataEffettivo).toLocaleDateString("it-IT")}): fino ad allora resta incluso. Nessun
                    addebito ora, e il prezzo mensile scende dal rinnovo.
                  </>
                ) : (
                  <>
                    Passaggio a <strong>{preview.nomeNuovo}</strong> dal prossimo rinnovo ({new Date(preview.dataEffettivo).toLocaleDateString("it-IT")}): il periodo in corso resta al piano
                    attuale, con le sue gare residue. Nessun addebito ora.
                  </>
                )}
              </p>
              {!preview.stessoPiano && (
                <p>
                  Dal rinnovo avrai <strong>{preview.gareIncluseNuovo} gare incluse</strong> al mese — meno di quelle attuali.
                </p>
              )}
              {pulsanti("Conferma il cambio")}
            </>
          )}
        </div>
      )}
    </div>
  );
}
