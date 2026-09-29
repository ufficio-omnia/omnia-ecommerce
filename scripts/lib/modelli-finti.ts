// Modelli FINTI per la funzione di compressione (FunzioneCompressione in
// src/lib/compressione-mirata.ts): permettono di provare tutta la logica di
// garanzia (ripristino, controllo del contratto, rifiuto, nuovo tentativo,
// tetto alle chiamate) senza chiamare alcun modello e quindi senza spendere
// nulla. Non simulano la QUALITÀ di un modello vero: simulano i suoi
// difetti noti, uno alla volta.
import type { FunzioneCompressione, RichiestaCompressione } from "../../src/lib/compressione-mirata";
import { stimaPagineContenuto } from "../../src/lib/stima-pagine";

type Formattazione = { dimensioneCarattere?: number; interlinea?: number };

// Riduce bene: toglie i paragrafi di prosa dal fondo finché il blocco rientra
// nel target, lasciando tabelle, note, sottotitoli e figure.
export function modelloFedele(formattazione: Formattazione): FunzioneCompressione {
  return async (r: RichiestaCompressione) => {
    const pezzi = r.testo.split(/\n\s*\n/);
    const stima = (p: string[]) => stimaPagineContenuto(p.join("\n\n"), formattazione);
    while (stima(pezzi) > r.pagineTarget && pezzi.length > 2) {
      let idx = -1;
      for (let i = pezzi.length - 1; i >= 1; i--) {
        const p = pezzi[i].trim();
        if (p.startsWith("|") || p.startsWith("[TABELLA") || p.startsWith("[ORGANIGRAMMA") || p.startsWith("*") || p.startsWith("###")) continue;
        idx = i;
        break;
      }
      if (idx < 0) break;
      pezzi.splice(idx, 1);
    }
    return pezzi.join("\n\n");
  };
}

// Difetto osservato su un'uscita reale: riduce ma toglie gli asterischi di
// conferma dai valori e cancella le citazioni di articolo.
export function modelloCheTogliAsterischiECitazioni(formattazione: Formattazione): FunzioneCompressione {
  const base = modelloFedele(formattazione);
  return async (r) => {
    const t = (await base(r)) ?? "";
    return t.replace(/ \*(?=[\s.,;:)]|$)/gm, "").replace(/\s*\(?\bart\.\s*\d+(?:\.\d+)?[^.,;)]*/g, "");
  };
}

// Difetto estremo: restituisce il solo titolo.
export const modelloCheSvuota: FunzioneCompressione = async (r) => r.testo.split("\n")[0];

// Non risponde (errore di rete, risposta troncata).
export const modelloCheFallisce: FunzioneCompressione = async () => null;
