"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";

// Schermate VERE dell'area riservata, rese anonime prima dello scatto (16/11/2026): nomi di aziende, enti, gare, importi, file ed email
// sostituiti con dati di esempio; la grafica e le funzioni sono quelle reali. I file stanno in public/site-omnia-ai/. I «dettagli» sono
// ritagli delle STESSE schermate alla risoluzione originale (nessuna interfaccia ricostruita), per leggere bene su telefono.
// Regola: mai una schermata con dati di clienti o di altre gare riconoscibili (stessa regola del piano di lavoro).
type Immagine = { src: string; width: number; height: number; alt: string };

export const SCHERMATE = {
  dashboard: {
    src: "/site-omnia-ai/screen-dashboard.webp",
    width: 1568,
    height: 696,
    alt: "Dashboard dell'area riservata di OMNIA AI: barra laterale con le sezioni (Gare, Documenti aziendali, Profilo azienda, Abbonamento, Servizi aggiuntivi, Pagamenti e fatture, Documenti contrattuali, Ufficio Gare, Impostazioni), riquadri con gare attive, completate, gare del piano e prossima scadenza, ed elenco delle gare con lo stato della relazione",
  },
  datiGara: {
    src: "/site-omnia-ai/screen-dati-gara.webp",
    width: 1300,
    height: 706,
    alt: "Pagina di una gara in OMNIA AI: dati estratti dai documenti (scadenza, importo, formattazione richiesta per l'offerta tecnica, limite di pagine), tabella dei criteri di valutazione con i punteggi e requisiti chiave",
  },
} as const satisfies Record<string, Immagine>;

export const DETTAGLI = {
  gare: {
    src: "/site-omnia-ai/screen-dettaglio-gare.webp",
    width: 822,
    height: 432,
    alt: "Dettaglio della dashboard: gare attive, completate, gare del piano, prossima scadenza e stato di ogni gara",
    etichetta: "Scadenze e stato delle gare",
  },
  vincoli: {
    src: "/site-omnia-ai/screen-dettaglio-vincoli.webp",
    width: 786,
    height: 146,
    alt: "Dettaglio della pagina della gara: scadenza, importo, formattazione richiesta e limite di pagine",
    etichetta: "Scadenza e vincoli di formattazione",
  },
  criteri: {
    src: "/site-omnia-ai/screen-dettaglio-criteri.webp",
    width: 786,
    height: 214,
    alt: "Dettaglio della pagina della gara: criteri di valutazione con il punteggio massimo di ciascuno",
    etichetta: "Criteri e punteggi",
  },
} as const satisfies Record<string, Immagine & { etichetta: string }>;

type Aperta = Immagine & { titolo: string };

// Finestra <dialog> nativa: Esc la chiude e il focus resta dentro. Alla chiusura il focus torna al pulsante che l'ha aperta e lo
// scorrimento della pagina sotto si sblocca. «Ingrandisci» mostra l'immagine alla sua grandezza reale dentro un'area che si sposta col
// dito (o con la rotellina): su telefono i dettagli diventano leggibili.
export default function SchermataPiattaforma({
  schermata,
  titolo,
  testo,
  dettagli = [],
}: {
  schermata: keyof typeof SCHERMATE;
  titolo: string;
  testo: string;
  dettagli?: (keyof typeof DETTAGLI)[];
}) {
  const s = SCHERMATE[schermata];
  const finestra = useRef<HTMLDialogElement>(null);
  const apritore = useRef<HTMLElement | null>(null);
  const [aperta, setAperta] = useState<Aperta | null>(null);
  const [zoom, setZoom] = useState(false);

  useEffect(() => {
    const d = finestra.current;
    if (!aperta || !d) return;
    if (!d.open) d.showModal();
    document.documentElement.classList.add("omnia-scorrimento-bloccato");
    return () => document.documentElement.classList.remove("omnia-scorrimento-bloccato");
  }, [aperta]);

  function apri(e: React.MouseEvent<HTMLElement>, immagine: Aperta) {
    apritore.current = e.currentTarget;
    setZoom(false);
    setAperta(immagine);
  }
  function chiudi() {
    finestra.current?.close();
  }

  return (
    <figure className="omnia-schermata">
      <button type="button" className="omnia-schermata-cornice" onClick={(e) => apri(e, { ...s, titolo })} aria-label={`${titolo}: ingrandisci la schermata`}>
        <span className="omnia-schermata-barra" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <Image src={s.src} width={s.width} height={s.height} alt={s.alt} unoptimized className="omnia-schermata-immagine" />
        <span className="omnia-schermata-lente" aria-hidden="true">
          Ingrandisci
        </span>
      </button>
      <figcaption>
        <b>{titolo}</b>
        <span>{testo}</span>
      </figcaption>

      {dettagli.length > 0 && (
        <ul className="omnia-schermata-dettagli" aria-label={`Dettagli: ${titolo}`}>
          {dettagli.map((k) => {
            const d = DETTAGLI[k];
            return (
              <li key={k}>
                <button type="button" onClick={(e) => apri(e, { ...d, titolo: d.etichetta })} aria-label={`${d.etichetta}: ingrandisci il dettaglio`}>
                  <Image src={d.src} width={d.width} height={d.height} alt={d.alt} unoptimized />
                  <span>{d.etichetta}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <dialog
        ref={finestra}
        className="omnia-schermata-finestra"
        aria-label={aperta?.titolo ?? titolo}
        onClose={() => {
          setAperta(null);
          apritore.current?.focus({ preventScroll: true });
        }}
        onClick={(e) => {
          // clic sullo sfondo (fuori dall'immagine e dai pulsanti): chiude
          if (e.target === e.currentTarget) chiudi();
        }}
      >
        {aperta && (
          <>
            <div className="omnia-schermata-comandi">
              <span>{aperta.titolo}</span>
              <button type="button" className="omnia-schermata-zoom" onClick={() => setZoom((z) => !z)} aria-pressed={zoom}>
                {zoom ? "Adatta allo schermo" : "Ingrandisci"}
              </button>
              <button type="button" className="omnia-schermata-chiudi" onClick={chiudi} aria-label="Chiudi">
                <span aria-hidden="true">×</span>
              </button>
            </div>
            <div
              className={`omnia-schermata-area${zoom ? " zoom" : ""}`}
              onClick={(e) => {
                if (e.target === e.currentTarget) chiudi();
              }}
            >
              <Image
                src={aperta.src}
                width={aperta.width}
                height={aperta.height}
                alt={aperta.alt}
                unoptimized
                className="omnia-schermata-grande"
                style={zoom ? { width: aperta.width, maxWidth: "none", maxHeight: "none" } : undefined}
                onClick={() => setZoom((z) => !z)}
              />
            </div>
            {!zoom && <p className="omnia-schermata-suggerimento">Tocca l&apos;immagine o «Ingrandisci» per vederla a grandezza reale e spostarti nei dettagli.</p>}
          </>
        )}
      </dialog>
    </figure>
  );
}
