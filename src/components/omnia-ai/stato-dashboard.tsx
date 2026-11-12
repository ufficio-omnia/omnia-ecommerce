"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { getStatoDashboard } from "@/app/actions/omnia-ai-stato-sistema";
import { creaPollerStato, type PollerStato } from "@/lib/omnia-ai-stato-dashboard-calcoli";
import { useMarchioStato } from "./marchio-stato-context";

const DURATA_PRONTO_MS = 5000;

// Il controllo periodico della dashboard, montato una volta sola nella shell (sopravvive ai cambi di pagina). Sostituisce
// i due timer di prima (marchio-stato-driver e campanella, ognuno ogni 6 secondi, anche a scheda nascosta).
//   - marchio in sidebar: viola a riposo, ambra quando almeno una gara del cliente è in elaborazione, verde per qualche
//     secondo alla conclusione;
//   - contatore della campanella: condiviso con NotificationBell tramite questo contesto.
// Ritmo, pausa a scheda nascosta e niente sovrapposizioni: src/lib/omnia-ai-stato-dashboard-calcoli.ts.
//
// Segnale locale (SegnaleElaborazione): un'analisi avviata da QUESTA scheda accende subito l'ambra, senza aspettare il
// server. Serve davvero: il browser manda le azioni del server una alla volta, quindi mentre l'analisi è in corso il
// controllo periodico di questa scheda resta in coda dietro di lei e non potrebbe accorgersene. Alla fine dell'analisi:
// verde, e un controllo subito per riallineare stato reale e notifiche. Il segnale si limita a LEGGERE lo stato
// «in attesa» del pulsante: non tocca l'analisi né l'azione che la esegue.
type StatoDashboardValue = {
  nonLette: number;
  setNonLette: Dispatch<SetStateAction<number>>;
  segnalaElaborazioneLocale: (attiva: boolean) => void;
};

const StatoDashboardContext = createContext<StatoDashboardValue | null>(null);

export function StatoDashboardProvider({ conNotifiche, children }: { conNotifiche: boolean; children: ReactNode }) {
  const { setStato } = useMarchioStato();
  const [nonLette, setNonLette] = useState(0);
  const eraInCorso = useRef(false);
  const ultimoServerInCorso = useRef(false);
  const elaborazioniLocali = useRef(0);
  const timeoutPronto = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollerRef = useRef<PollerStato | null>(null);

  // Lo stato del marchio da quello che si sa: il server, oppure un'analisi in corso avviata da questa scheda.
  const applica = useCallback(() => {
    const inCorso = ultimoServerInCorso.current || elaborazioniLocali.current > 0;
    if (inCorso) {
      if (timeoutPronto.current) {
        clearTimeout(timeoutPronto.current);
        timeoutPronto.current = null;
      }
      setStato("elaborazione");
    } else if (eraInCorso.current) {
      // Transizione in corso -> conclusa: verde per qualche secondo, poi a riposo.
      setStato("pronto");
      timeoutPronto.current = setTimeout(() => {
        timeoutPronto.current = null;
        setStato("riposo");
      }, DURATA_PRONTO_MS);
    } else if (!timeoutPronto.current) {
      setStato("riposo");
    }
    eraInCorso.current = inCorso;
    return inCorso;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setStato è stabile (useMemo nel provider)
  }, []);

  useEffect(() => {
    let annullato = false;

    const poller = creaPollerStato(
      async () => {
        const esito = await getStatoDashboard(conNotifiche);
        if (annullato) return null;
        ultimoServerInCorso.current = esito.inCorso;
        const inCorso = applica();
        if (esito.nonLette !== null) setNonLette(esito.nonLette);
        return { inCorso };
      },
      {
        adesso: () => Date.now(),
        programma: (fn, ms) => window.setTimeout(fn, ms),
        annulla: (id) => window.clearTimeout(id),
        visibile: () => document.visibilityState === "visible",
      },
    );
    pollerRef.current = poller;

    const alCambioDiVisibilita = () => poller.alCambioVisibilita();
    document.addEventListener("visibilitychange", alCambioDiVisibilita);
    poller.avvia();

    return () => {
      annullato = true;
      poller.ferma();
      pollerRef.current = null;
      document.removeEventListener("visibilitychange", alCambioDiVisibilita);
      if (timeoutPronto.current) {
        clearTimeout(timeoutPronto.current);
        timeoutPronto.current = null;
      }
    };
  }, [conNotifiche, applica]);

  const segnalaElaborazioneLocale = useCallback(
    (attiva: boolean) => {
      elaborazioniLocali.current = Math.max(0, elaborazioniLocali.current + (attiva ? 1 : -1));
      applica();
      pollerRef.current?.aggiornaOra();
    },
    [applica],
  );

  const value = useMemo(() => ({ nonLette, setNonLette, segnalaElaborazioneLocale }), [nonLette, segnalaElaborazioneLocale]);
  return <StatoDashboardContext.Provider value={value}>{children}</StatoDashboardContext.Provider>;
}

export function useStatoDashboard(): StatoDashboardValue {
  const ctx = useContext(StatoDashboardContext);
  if (!ctx) throw new Error("useStatoDashboard va usato dentro <StatoDashboardProvider>");
  return ctx;
}

// Da mettere accanto a un pulsante che avvia un'analisi: legge soltanto il suo stato «in attesa». Fuori dalla dashboard
// (nessun provider) non fa nulla.
export function SegnaleElaborazione({ attiva }: { attiva: boolean }) {
  const ctx = useContext(StatoDashboardContext);
  const segnala = ctx?.segnalaElaborazioneLocale;
  useEffect(() => {
    if (!attiva || !segnala) return;
    segnala(true);
    return () => segnala(false);
  }, [attiva, segnala]);
  return null;
}
