"use client";

import { useState, useTransition } from "react";
import {
  previewOmniaAiPlanChange,
  confirmOmniaAiPlanChange,
  type PreviewCambioPiano,
} from "@/app/actions/omnia-ai-plan-change";
import { PIANI, PIANI_ORDINE, formatEuro, type PianoSlug } from "@/lib/omnia-ai-plans";

type PreviewOk = Exclude<PreviewCambioPiano, { error: string }>;

export default function CambiaPianoForm({ pianoAttuale }: { pianoAttuale: PianoSlug }) {
  const [pianoScelto, setPianoScelto] = useState<PianoSlug | null>(null);
  const [preview, setPreview] = useState<PreviewOk | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [fatto, setFatto] = useState(false);
  const [pending, startTransition] = useTransition();

  function scegli(piano: PianoSlug) {
    setPianoScelto(piano);
    setPreview(null);
    setErrore(null);
    startTransition(async () => {
      const risultato = await previewOmniaAiPlanChange(piano);
      if ("error" in risultato) {
        setErrore(risultato.error);
      } else {
        setPreview(risultato);
      }
    });
  }

  function annulla() {
    setPianoScelto(null);
    setPreview(null);
    setErrore(null);
  }

  function conferma() {
    if (!pianoScelto) return;
    startTransition(async () => {
      const risultato = await confirmOmniaAiPlanChange(pianoScelto);
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

  return (
    <div>
      {!pianoScelto && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {altriPiani.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => scegli(p)}
              className="omnia-btn omnia-btn-s omnia-btn-piccolo"
            >
              Passa a {PIANI[p].nome}
            </button>
          ))}
        </div>
      )}

      {pianoScelto && (
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
                Passaggio immediato a <strong>{preview.nomeNuovo}</strong>: verranno addebitati ora{" "}
                <strong>{formatEuro(preview.importoImmediatoCentesimi)}</strong> (conguaglio per i
                giorni residui del periodo in corso). Il nuovo piano è attivo da questo momento.
              </p>
              <p>
                Da ora e fino al rinnovo avrai <strong>{preview.gareDisponibiliDaOra} gare</strong>{" "}
                disponibili ({preview.gareIncluseNuovo} incluse nel piano {preview.nomeNuovo}, meno
                le {preview.gareConsumate} già usate in questo periodo). Dal rinnovo successivo
                tornerai al pieno di {preview.gareIncluseNuovo}.
              </p>
              <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
                <button
                  type="button"
                  onClick={conferma}
                  disabled={pending}
                  className="omnia-btn omnia-btn-p omnia-btn-piccolo"
                >
                  {pending
                    ? "Conferma in corso..."
                    : `Conferma, addebita ${formatEuro(preview.importoImmediatoCentesimi)}`}
                </button>
                <button
                  type="button"
                  onClick={annulla}
                  disabled={pending}
                  className="omnia-btn omnia-btn-s omnia-btn-piccolo"
                >
                  Annulla
                </button>
              </div>
            </>
          )}

          {preview && preview.tipo === "downgrade" && (
            <>
              <p>
                Passaggio a <strong>{preview.nomeNuovo}</strong> dal prossimo rinnovo (
                {new Date(preview.dataEffettivo).toLocaleDateString("it-IT")}): il periodo in corso
                resta al piano attuale, con le sue gare residue. Nessun addebito ora.
              </p>
              <p>
                Dal rinnovo avrai <strong>{preview.gareIncluseNuovo} gare incluse</strong> al mese —
                meno di quelle attuali.
              </p>
              <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
                <button
                  type="button"
                  onClick={conferma}
                  disabled={pending}
                  className="omnia-btn omnia-btn-p omnia-btn-piccolo"
                >
                  {pending ? "Conferma in corso..." : "Conferma il cambio"}
                </button>
                <button
                  type="button"
                  onClick={annulla}
                  disabled={pending}
                  className="omnia-btn omnia-btn-s omnia-btn-piccolo"
                >
                  Annulla
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
