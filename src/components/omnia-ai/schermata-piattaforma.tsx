"use client";

import { useRef } from "react";
import Image from "next/image";

// Schermate VERE dell'area riservata, rese anonime prima dello scatto (16/11/2026): nomi di aziende, enti, gare, importi, file ed email
// sostituiti con dati di esempio; la grafica e le funzioni sono quelle reali. I file stanno in public/site-omnia-ai/.
// Regola: mai una schermata con dati di clienti o di altre gare riconoscibili (stessa regola del piano di lavoro).
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
    alt: "Pagina di una gara in OMNIA AI: dati estratti automaticamente dai documenti (scadenza, importo, formattazione richiesta per l'offerta tecnica, limite di pagine), tabella dei criteri di valutazione con i punteggi e requisiti chiave",
  },
} as const;

// Al clic la schermata si ingrandisce in sovrimpressione (finestra <dialog> nativa: Esc la chiude e il focus resta dentro),
// con la X in alto; si chiude anche cliccando fuori dall'immagine. Nessuna nuova pagina o scheda.
export default function SchermataPiattaforma({
  schermata,
  titolo,
  testo,
}: {
  schermata: keyof typeof SCHERMATE;
  titolo: string;
  testo: string;
}) {
  const s = SCHERMATE[schermata];
  const finestra = useRef<HTMLDialogElement>(null);

  return (
    <figure className="omnia-schermata">
      <button
        type="button"
        className="omnia-schermata-cornice"
        onClick={() => finestra.current?.showModal()}
        aria-label={`${titolo}: ingrandisci la schermata`}
      >
        <span className="omnia-schermata-barra" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <Image src={s.src} width={s.width} height={s.height} alt={s.alt} sizes="(max-width: 900px) 100vw, 1100px" className="omnia-schermata-immagine" />
      </button>
      <figcaption>
        <b>{titolo}</b>
        <span>{testo}</span>
      </figcaption>

      <dialog
        ref={finestra}
        className="omnia-schermata-finestra"
        aria-label={titolo}
        onClick={(e) => {
          // clic sullo sfondo (fuori dall'immagine): chiude
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
      >
        <button type="button" className="omnia-schermata-chiudi" onClick={() => finestra.current?.close()} aria-label="Chiudi">
          <span aria-hidden="true">×</span>
        </button>
        <Image src={s.src} width={s.width} height={s.height} alt={s.alt} sizes="100vw" className="omnia-schermata-grande" />
      </dialog>
    </figure>
  );
}
