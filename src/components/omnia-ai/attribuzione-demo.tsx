"use client";

import { useEffect } from "react";
import {
  CHIAVE_ATTRIBUZIONE,
  CHIAVE_CONSENSO_COOKIE,
  cookiePubblicitariAccettati,
  costruisciAttribuzioneSalvata,
  leggiAttribuzioneDaUrl,
} from "@/lib/demo-lead-calcoli";

// Conserva nel browser, per 90 giorni, gli identificativi di una campagna (gclid, gbraid, wbraid, utm_*) trovati nell'indirizzo, così
// il modulo della demo può associarli al lead anche se il visitatore ha girato per altre pagine prima di compilarlo.
//
// SOLO con i cookie pubblicitari accettati nel banner di omnia-ai.it: senza consenso non si salva niente, e se il consenso viene
// ritirato (o il banner viene riaperto) ciò che era stato salvato si cancella. Non legge né scrive cookie: usa il localStorage del
// sito, e il banner resta quello di prima (non si tocca). Non manda nulla a nessuno: i valori partono solo con l'invio del modulo.
const EVENTO_CAMBIO_CONSENSO = "omnia-ai-consent-change";

function aggiorna() {
  try {
    if (!cookiePubblicitariAccettati(localStorage.getItem(CHIAVE_CONSENSO_COOKIE))) {
      localStorage.removeItem(CHIAVE_ATTRIBUZIONE);
      return;
    }
    const trovata = leggiAttribuzioneDaUrl(window.location.search);
    if (trovata) localStorage.setItem(CHIAVE_ATTRIBUZIONE, JSON.stringify(costruisciAttribuzioneSalvata(trovata, Date.now())));
  } catch {
    // localStorage non disponibile (modalità privata, blocco): nessuna attribuzione, il resto funziona
  }
}

export default function AttribuzioneDemo() {
  useEffect(() => {
    aggiorna();
    window.addEventListener(EVENTO_CAMBIO_CONSENSO, aggiorna);
    return () => window.removeEventListener(EVENTO_CAMBIO_CONSENSO, aggiorna);
  }, []);
  return null;
}
