"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { getStatoDashboard } from "@/app/actions/omnia-ai-stato-sistema";
import { creaPollerStato } from "@/lib/omnia-ai-stato-dashboard-calcoli";
import { useMarchioStato } from "./marchio-stato-context";

const DURATA_PRONTO_MS = 5000;

// Il controllo periodico della dashboard, montato una volta sola nella shell (sopravvive ai cambi di pagina). Sostituisce
// i due timer di prima (marchio-stato-driver e campanella, ognuno ogni 6 secondi, anche a scheda nascosta).
//   - marchio in sidebar: viola a riposo, ambra quando almeno una gara del cliente è in elaborazione, verde per qualche
//     secondo alla conclusione (comportamento invariato);
//   - contatore della campanella: condiviso con NotificationBell tramite questo contesto.
// Ritmo, pausa a scheda nascosta e niente sovrapposizioni: src/lib/omnia-ai-stato-dashboard-calcoli.ts.
type StatoDashboardValue = {
  nonLette: number;
  setNonLette: Dispatch<SetStateAction<number>>;
};

const StatoDashboardContext = createContext<StatoDashboardValue | null>(null);

export function StatoDashboardProvider({ conNotifiche, children }: { conNotifiche: boolean; children: ReactNode }) {
  const { setStato } = useMarchioStato();
  const [nonLette, setNonLette] = useState(0);
  const eraInCorso = useRef(false);
  const timeoutPronto = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let annullato = false;

    const poller = creaPollerStato(
      async () => {
        const esito = await getStatoDashboard(conNotifiche);
        if (annullato) return null;

        if (esito.inCorso) {
          if (timeoutPronto.current) {
            clearTimeout(timeoutPronto.current);
            timeoutPronto.current = null;
          }
          setStato("elaborazione");
        } else if (eraInCorso.current) {
          // Transizione true -> false: un'elaborazione si è appena conclusa. Verde per qualche secondo, poi a riposo.
          setStato("pronto");
          timeoutPronto.current = setTimeout(() => setStato("riposo"), DURATA_PRONTO_MS);
        } else {
          setStato("riposo");
        }
        eraInCorso.current = esito.inCorso;

        if (esito.nonLette !== null) setNonLette(esito.nonLette);
        return { inCorso: esito.inCorso };
      },
      {
        adesso: () => Date.now(),
        programma: (fn, ms) => window.setTimeout(fn, ms),
        annulla: (id) => window.clearTimeout(id),
        visibile: () => document.visibilityState === "visible",
      },
    );

    const alCambioDiVisibilita = () => poller.alCambioVisibilita();
    document.addEventListener("visibilitychange", alCambioDiVisibilita);
    poller.avvia();

    return () => {
      annullato = true;
      poller.ferma();
      document.removeEventListener("visibilitychange", alCambioDiVisibilita);
      if (timeoutPronto.current) {
        clearTimeout(timeoutPronto.current);
        timeoutPronto.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setStato è stabile (useMemo nel provider), non va in dipendenza per non riavviare il controllo ad ogni render
  }, [conNotifiche]);

  const value = useMemo(() => ({ nonLette, setNonLette }), [nonLette]);
  return <StatoDashboardContext.Provider value={value}>{children}</StatoDashboardContext.Provider>;
}

export function useStatoDashboard(): StatoDashboardValue {
  const ctx = useContext(StatoDashboardContext);
  if (!ctx) throw new Error("useStatoDashboard va usato dentro <StatoDashboardProvider>");
  return ctx;
}
