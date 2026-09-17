"use client";

import { useEffect, useRef } from "react";
import { getStatoElaborazioneGare } from "@/app/actions/omnia-ai-stato-sistema";
import { useMarchioStato } from "./marchio-stato-context";

const INTERVALLO_MS = 6000;
const DURATA_PRONTO_MS = 5000;

// Monta una volta sola nella shell della dashboard: fa del marchio in
// sidebar la spia di stato del sistema (viola a riposo, ambra quando
// almeno una gara del cliente è in elaborazione, verde per qualche
// secondo alla conclusione), non solo un logo statico. Nessun output
// visibile: guida solo il MarchioStatoContext già montato dalla shell.
export default function MarchioStatoDriver() {
  const { setStato } = useMarchioStato();
  const eraInCorso = useRef(false);
  const timeoutPronto = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let annullato = false;

    async function controlla() {
      const { inCorso } = await getStatoElaborazioneGare();
      if (annullato) return;

      if (inCorso) {
        if (timeoutPronto.current) {
          clearTimeout(timeoutPronto.current);
          timeoutPronto.current = null;
        }
        setStato("elaborazione");
      } else if (eraInCorso.current) {
        // Transizione true -> false: un'elaborazione si è appena
        // conclusa. Verde per qualche secondo, poi torna a riposo.
        setStato("pronto");
        timeoutPronto.current = setTimeout(() => {
          setStato("riposo");
        }, DURATA_PRONTO_MS);
      } else {
        setStato("riposo");
      }

      eraInCorso.current = inCorso;
    }

    controlla();
    const id = setInterval(controlla, INTERVALLO_MS);

    return () => {
      annullato = true;
      clearInterval(id);
      if (timeoutPronto.current) clearTimeout(timeoutPronto.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setStato è stabile (useMemo nel provider), non va in dipendenza per non riavviare l'intervallo ad ogni render
  }, []);

  return null;
}
