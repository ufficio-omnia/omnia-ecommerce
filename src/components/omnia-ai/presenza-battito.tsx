"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { FINESTRA_ATTIVITA_MS, INTERVALLO_SEGNALE_MS } from "@/lib/omnia-ai-presenza-calcoli";

// Il segnale di presenza dell'area riservata (migrazione 0094). Non mostra niente: ogni ~45 secondi, finché la scheda è aperta
// E visibile, dice al server «sono qui» e se l'utente ha mosso il mouse, scritto, scorso o toccato lo schermo nell'ultimo minuto
// («attivo») oppure no («fermo»). Insieme manda il percorso della pagina: il server ne tiene solo la SEZIONE (dashboard, gare,
// abbonamento…), mai l'indirizzo preciso. Nessun cookie, nessun dato salvato nel browser, nessun contenuto della pagina.
//
//   - scheda nascosta (altra scheda, schermo spento): nessun segnale; quando torna visibile ne parte subito uno;
//   - cambio pagina: un segnale subito (al massimo uno ogni 10 secondi), così la sezione in console è aggiornata;
//   - risposta 401 (sessione finita, per esempio dopo «Esci» in un'altra scheda): smette di mandare segnali;
//   - qualunque errore di rete si ignora: la presenza non deve mai disturbare chi lavora.
const INTERVALLO_MINIMO_MS = 10_000;
const EVENTI_ATTIVITA = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"] as const;

export default function PresenzaBattito() {
  const percorso = usePathname();
  const percorsoRef = useRef(percorso);
  const inviaRef = useRef<((conMinimo: boolean) => void) | null>(null);

  useEffect(() => {
    let ultimaAttivita = Date.now();
    let ultimoInvio = 0;
    let fermato = false;

    const invia = (conMinimo: boolean) => {
      if (fermato || document.visibilityState !== "visible") return;
      const adesso = Date.now();
      if (conMinimo && adesso - ultimoInvio < INTERVALLO_MINIMO_MS) return;
      ultimoInvio = adesso;
      fetch("/api/presenza", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attivo: adesso - ultimaAttivita < FINESTRA_ATTIVITA_MS, percorso: percorsoRef.current }),
        credentials: "same-origin",
        cache: "no-store",
        keepalive: true,
      })
        .then((risposta) => {
          if (risposta.status === 401) fermato = true;
        })
        .catch(() => {});
    };
    inviaRef.current = invia;

    const registraAttivita = () => {
      ultimaAttivita = Date.now();
    };
    for (const evento of EVENTI_ATTIVITA) window.addEventListener(evento, registraAttivita, { passive: true, capture: true });
    const alCambioDiVisibilita = () => {
      if (document.visibilityState === "visible") invia(true);
    };
    document.addEventListener("visibilitychange", alCambioDiVisibilita);

    invia(false);
    const timer = window.setInterval(() => invia(false), INTERVALLO_SEGNALE_MS);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", alCambioDiVisibilita);
      for (const evento of EVENTI_ATTIVITA) window.removeEventListener(evento, registraAttivita, { capture: true });
      inviaRef.current = null;
    };
  }, []);

  // Cambio pagina: la sezione nuova parte subito (con il minimo di 10 secondi tra un invio e l'altro).
  useEffect(() => {
    if (percorsoRef.current === percorso) return;
    percorsoRef.current = percorso;
    inviaRef.current?.(true);
  }, [percorso]);

  return null;
}
