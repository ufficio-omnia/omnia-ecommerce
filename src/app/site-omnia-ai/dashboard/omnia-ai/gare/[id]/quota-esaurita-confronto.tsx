"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  previewOmniaAiPlanChange,
  type PreviewCambioPiano,
} from "@/app/actions/omnia-ai-plan-change";
import { PIANI, PIANI_ORDINE, PACCHETTI_CREDITI, formatEuro, type PianoSlug } from "@/lib/omnia-ai-plans";

// Confronto esplicito, non una frase generica: per uno Starter, il
// credito costa 290 € per una gara sola, mentre passare al piano
// superiore costa il conguaglio (calcolato qui in tempo reale, non un
// numero statico) e porta a più gare incluse ogni mese. Chi è già sul
// piano più alto vede solo l'opzione crediti — non c'è un piano
// superiore da proporre.
export default function QuotaEsauritaConfronto({ pianoAttuale }: { pianoAttuale: string | null }) {
  const indiceAttuale = pianoAttuale ? PIANI_ORDINE.indexOf(pianoAttuale as PianoSlug) : -1;
  const pianoSuperiore =
    indiceAttuale >= 0 && indiceAttuale < PIANI_ORDINE.length - 1 ? PIANI_ORDINE[indiceAttuale + 1] : null;

  const [preview, setPreview] = useState<PreviewCambioPiano | null>(null);

  useEffect(() => {
    if (!pianoSuperiore) return;
    let annullato = false;
    previewOmniaAiPlanChange(pianoSuperiore).then((risultato) => {
      if (!annullato) setPreview(risultato);
    });
    return () => {
      annullato = true;
    };
  }, [pianoSuperiore]);

  const credito = PACCHETTI_CREDITI.singola;

  return (
    <div style={{ marginTop: 12 }}>
      <p className="omnia-riquadro-nota" style={{ margin: 0 }}>
        Due strade per continuare subito:
      </p>
      <div className="omnia-dati-griglia" style={{ marginTop: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <div className="omnia-dato">
          <div className="omnia-dato-etichetta">Credito singolo</div>
          <div className="omnia-dato-valore">
            {formatEuro(credito.prezzoCentesimi)} · 1 gara
          </div>
        </div>

        {pianoSuperiore && (
          <div className="omnia-dato">
            <div className="omnia-dato-etichetta">Piano {PIANI[pianoSuperiore].nome}</div>
            <div className="omnia-dato-valore">
              {preview && "tipo" in preview && preview.tipo === "upgrade"
                ? `${formatEuro(preview.importoImmediatoCentesimi)} ora · ${preview.gareIncluseNuovo} gare/mese`
                : "Calcolo in corso…"}
            </div>
          </div>
        )}
      </div>

      <Link
        href="/dashboard/omnia-ai/abbonamento"
        className="omnia-btn omnia-btn-s omnia-btn-piccolo"
        style={{ marginTop: 12, display: "inline-block" }}
      >
        Acquista crediti o cambia piano →
      </Link>
    </div>
  );
}
