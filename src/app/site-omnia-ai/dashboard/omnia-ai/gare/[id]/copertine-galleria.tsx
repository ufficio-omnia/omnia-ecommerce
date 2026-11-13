"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { scaricaCopertinaGara } from "@/app/actions/gara-copertina";
import OpenInNewTabButton from "@/components/open-in-new-tab-button";
import { ETICHETTA_STILE, etichettaNumero, type Stile } from "@/lib/copertina-relazione-calcoli";
import type { CopertinaVista } from "./copertina-panel";

const quando = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("it-IT", { timeZone: "Europe/Rome", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

// La lente sopra la miniatura (disegnata, non un'emoji: si vede uguale ovunque)
function Lente({ misura }: { misura: number }) {
  return (
    <svg width={misura} height={misura} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5 21 21" />
      <path d="M10.5 7.5v6M7.5 10.5h6" />
    </svg>
  );
}

// I due pulsanti per scaricare una copertina (PDF A4 e PNG): gli stessi nella griglia e nell'anteprima grande
function Scarica({ garaId, c, grandi }: { garaId: string; c: CopertinaVista; grandi: boolean }) {
  return (
    <>
      {c.nomePdf && (
        <OpenInNewTabButton
          action={scaricaCopertinaGara}
          hiddenFields={{ garaId, nomeFile: c.nomePdf }}
          label={grandi ? "Scarica il PDF (A4)" : "PDF"}
          pendingLabel="..."
          className="omnia-btn omnia-btn-p omnia-btn-piccolo"
        />
      )}
      <OpenInNewTabButton
        action={scaricaCopertinaGara}
        hiddenFields={{ garaId, nomeFile: c.nomePng }}
        label={grandi ? "Scarica l'immagine (PNG)" : "PNG"}
        pendingLabel="..."
        className="omnia-btn omnia-btn-s omnia-btn-piccolo"
      />
    </>
  );
}

// Le copertine della gara (richiesta dell'utente, 13/11/2026): tutte affiancate in una griglia di miniature, dalla più recente. Passando il mouse su una
// miniatura compare la lente; un clic (o un tocco, al telefono) apre l'anteprima grande in sovraimpressione, con i pulsanti per scaricarla e le frecce per
// passare alle altre. Esc, la ✕ o un clic fuori dall'immagine la chiudono.
export default function CopertineGalleria({ garaId, copertine }: { garaId: string; copertine: CopertinaVista[] }) {
  const [aperta, setAperta] = useState<number | null>(null);
  const chiudiRef = useRef<HTMLButtonElement>(null);
  // l'elemento da cui si è aperta l'anteprima: alla chiusura il fuoco torna lì
  const daDove = useRef<HTMLElement | null>(null);

  // la più recente di ciascuno stile ha l'etichetta «più recente»
  const primaPerStile = new Map<Stile, string>();
  for (const c of copertine) if (!primaPerStile.has(c.stile)) primaPerStile.set(c.stile, c.id);

  const apri = (i: number) => {
    daDove.current = document.activeElement as HTMLElement | null;
    setAperta(i);
  };
  const chiudi = useCallback(() => {
    setAperta(null);
    daDove.current?.focus();
  }, []);
  const vai = useCallback((passo: number) => setAperta((i) => (i === null ? i : (i + passo + copertine.length) % copertine.length)), [copertine.length]);

  // con l'anteprima aperta: tastiera (Esc, frecce) e pagina sotto ferma; tutto torna com'era alla chiusura (non a ogni cambio di copertina)
  const inVista = aperta !== null;
  useEffect(() => {
    if (!inVista) return;
    const tasto = (e: KeyboardEvent) => {
      if (e.key === "Escape") chiudi();
      else if (e.key === "ArrowLeft") vai(-1);
      else if (e.key === "ArrowRight") vai(1);
    };
    const overflowPrima = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", tasto);
    chiudiRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", tasto);
      document.body.style.overflow = overflowPrima;
    };
  }, [inVista, chiudi, vai]);

  if (copertine.length === 0) return null;
  const c = aperta !== null ? copertine[aperta] : null;

  return (
    <div style={{ marginTop: 18 }}>
      <p className="omnia-etichetta" style={{ margin: 0 }}>
        <strong>Le tue copertine ({copertine.length})</strong>
      </p>
      <p className="omnia-riquadro-nota" style={{ margin: "2px 0 0" }}>
        Fai clic su una copertina per vederla in grande.
      </p>
      <ul className="omnia-copertine-griglia">
        {copertine.map((x, i) => {
          const etichetta = etichettaNumero(x.numero);
          const piuRecente = primaPerStile.get(x.stile) === x.id;
          return (
            <li key={x.id} className="omnia-copertina-scheda">
              <button type="button" className="omnia-copertina-miniatura" onClick={() => apri(i)} aria-label={`Ingrandisci la ${etichetta}`} title="Ingrandisci">
                {x.anteprimaUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={x.anteprimaUrl} alt={`${etichetta}, ${ETICHETTA_STILE[x.stile].toLowerCase()}`} loading="lazy" />
                ) : (
                  <span className="omnia-copertina-vuota">Anteprima non disponibile</span>
                )}
                <span className="omnia-copertina-lente" aria-hidden="true">
                  <span>
                    <Lente misura={22} />
                  </span>
                </span>
                {piuRecente && <span className="omnia-copertina-recente">più recente</span>}
              </button>
              <div className="omnia-copertina-dati">
                <strong>{etichettaNumero(x.numero)}</strong>
                <span>
                  {ETICHETTA_STILE[x.stile]}
                  {x.modifica ? " · modificata in chat" : ""}
                </span>
                {x.generataIl && <span>{quando(x.generataIl)}</span>}
              </div>
              <div className="omnia-copertina-azioni">
                <Scarica garaId={garaId} c={x} grandi={false} />
              </div>
            </li>
          );
        })}
      </ul>

      {/* l'anteprima grande: fuori dal pannello (sul body), così sta sopra a tutto anche se un contenitore ha effetti grafici */}
      {c &&
        createPortal(
          <div
            className="omnia-lightbox"
            role="dialog"
            aria-modal="true"
            aria-label={`${etichettaNumero(c.numero)} in grande`}
            onClick={(e) => {
              if (e.target === e.currentTarget) chiudi();
            }}
          >
            <div className="omnia-lightbox-testa">
              <span>
                <strong>{etichettaNumero(c.numero)}</strong> · {ETICHETTA_STILE[c.stile]}
                {c.modifica ? " · modificata in chat" : ""}
                {c.generataIl ? ` · ${quando(c.generataIl)}` : ""}
              </span>
              <span className="omnia-lightbox-pulsanti">
                <Scarica garaId={garaId} c={c} grandi />
              </span>
            </div>
            {/* l'immagine intera; finché arriva si vede la miniatura sotto (già scaricata) */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={c.id}
              className="omnia-lightbox-immagine"
              src={c.grandeUrl ?? c.anteprimaUrl ?? ""}
              alt={`${etichettaNumero(c.numero)}, ${ETICHETTA_STILE[c.stile].toLowerCase()}`}
              style={c.anteprimaUrl ? { backgroundImage: `url("${c.anteprimaUrl}")` } : undefined}
            />
            <p className="omnia-lightbox-conta">
              {(aperta ?? 0) + 1} di {copertine.length}
              <span className="omnia-lightbox-tasti"> · frecce ← → per scorrere, Esc per chiudere</span>
            </p>
            <button ref={chiudiRef} type="button" className="omnia-lightbox-chiudi" onClick={chiudi} aria-label="Chiudi l'anteprima">
              ✕
            </button>
            {copertine.length > 1 && (
              <>
                <button type="button" className="omnia-lightbox-freccia sinistra" onClick={() => vai(-1)} aria-label="Copertina precedente">
                  ‹
                </button>
                <button type="button" className="omnia-lightbox-freccia destra" onClick={() => vai(1)} aria-label="Copertina successiva">
                  ›
                </button>
              </>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
