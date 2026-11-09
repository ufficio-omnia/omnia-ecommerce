"use client";

import { useEffect, type ReactNode } from "react";
import {
  ETICHETTE_SCELTA,
  MEDIA_SISTEMA_CHIARO,
  SCELTE_TEMA,
  applicaTemaAlDocumento,
  salvaScelta,
  type SceltaTema,
} from "@/lib/tema-omnia-ai";
import { useSceltaTema } from "./use-tema";

// Interruttore del tema: tre pulsanti a icona (scuro, chiaro, automatico) in una pillola. Sta nell'intestazione del sito, nel menu
// mobile e nella barra dell'area riservata. La scelta si salva sul dispositivo SOLO dopo un clic; con «automatico» il tema segue
// il sistema anche se cambia mentre la pagina è aperta. Le icone sono SVG semplici, senza librerie.
const ICONE: Record<SceltaTema, ReactNode> = {
  scuro: <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4 8.2 8.2 0 1 0 20 14.2Z" />,
  chiaro: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.3M12 19.2v2.3M2.5 12h2.3M19.2 12h2.3M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" />
    </>
  ),
  auto: (
    <>
      <rect x="3" y="4.5" width="18" height="12" rx="2" />
      <path d="M8.5 20h7M12 16.5V20" />
    </>
  ),
};

export default function ToggleTema({ grande = false }: { grande?: boolean }) {
  const scelta = useSceltaTema();

  // Con «automatico» il tema deve seguire il sistema anche a pagina aperta.
  useEffect(() => {
    if (scelta !== "auto") return;
    const sistema = window.matchMedia(MEDIA_SISTEMA_CHIARO);
    const segui = () => applicaTemaAlDocumento(document, "auto", sistema.matches);
    sistema.addEventListener("change", segui);
    return () => sistema.removeEventListener("change", segui);
  }, [scelta]);

  function scegli(nuova: SceltaTema) {
    applicaTemaAlDocumento(document, nuova, window.matchMedia(MEDIA_SISTEMA_CHIARO).matches);
    let storage: Storage | null = null;
    try {
      storage = window.localStorage;
    } catch {
      storage = null; // dati del sito bloccati: la scelta vale per questa visita
    }
    salvaScelta(storage, nuova);
  }

  return (
    <div role="group" aria-label="Aspetto del sito" className={`omnia-tema${grande ? " grande" : ""}`}>
      {SCELTE_TEMA.map((s) => (
        <button
          key={s}
          type="button"
          aria-pressed={scelta === s}
          aria-label={ETICHETTE_SCELTA[s]}
          title={ETICHETTE_SCELTA[s]}
          onClick={() => scegli(s)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {ICONE[s]}
          </svg>
        </button>
      ))}
    </div>
  );
}
