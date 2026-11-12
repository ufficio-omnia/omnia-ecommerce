"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

// Rilegge la pagina da sola ogni tot secondi, finché la scheda è aperta e visibile: serve alle pagine che mostrano chi è
// collegato (Panoramica ed elenco Utenti) per non dover premere «ricarica». Non si usa nelle pagine con moduli da compilare.
// router.refresh() rilegge i dati del server e lascia com'è lo stato del browser (scorrimento, filtri scritti).
//
// Ogni ricarica rifà tutte le letture della pagina (sull'elenco Utenti anche l'elenco completo degli accessi da Supabase
// Auth). Per non pesare sul database:
//   - scheda nascosta: nessuna ricarica; quando torna visibile ne parte subito una se l'ultima è più vecchia dell'intervallo
//     (i dati non restano mai indietro più di così mentre la si guarda);
//   - mai due ricariche sovrapposte: se la precedente non è ancora finita, il giro si salta.
// Nessuna memoria condivisa dei dati: ogni ricarica legge dati freschi dal server, come prima.
export default function RicaricaAutomatica({ secondi = 60 }: { secondi?: number }) {
  const router = useRouter();
  const [inCorso, avvia] = useTransition();
  const inCorsoRef = useRef(false);
  useEffect(() => {
    inCorsoRef.current = inCorso;
  }, [inCorso]);

  useEffect(() => {
    const intervalloMs = secondi * 1000;
    let ultimaRicarica = Date.now();

    const ricarica = () => {
      if (document.visibilityState !== "visible" || inCorsoRef.current) return;
      ultimaRicarica = Date.now();
      avvia(() => router.refresh());
    };

    const timer = window.setInterval(ricarica, intervalloMs);
    const alCambioDiVisibilita = () => {
      if (document.visibilityState === "visible" && Date.now() - ultimaRicarica >= intervalloMs) ricarica();
    };
    document.addEventListener("visibilitychange", alCambioDiVisibilita);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", alCambioDiVisibilita);
    };
  }, [router, secondi]);

  return null;
}
