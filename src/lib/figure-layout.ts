import { C, Disegno, LARGHEZZA_DISEGNO, misuraApprossimata, type LayoutFigura, type Misura } from "@/lib/figure-base";
import type { DatiFigura } from "@/lib/figure-dati";
import { disegnaFlusso } from "@/lib/figura-flusso-layout";
import { disegnaLivelli } from "@/lib/figura-livelli-layout";
import { disegnaCronoprogramma } from "@/lib/figura-cronoprogramma-layout";
import { disegnaCruscotto } from "@/lib/figura-cruscotto-layout";
import { disegnaRete } from "@/lib/figura-rete-layout";

// Dispatcher dei layout delle figure (archetipi). Ogni archetipo disegna in
// un'area (x, y, w) di un Disegno e ritorna l'altezza usata; qui si aggiungono
// i margini e la nota fissa dei valori proposti (asterisco della guardia R9).

export const MARGINE_X = 24;
export const MARGINE_Y = 14;

export function calcolaLayoutFigura(dati: DatiFigura, opzioni: { misura: Misura }): LayoutFigura {
  const d = new Disegno(opzioni.misura);
  const area = { x: MARGINE_X, y: MARGINE_Y, w: LARGHEZZA_DISEGNO - 2 * MARGINE_X };
  let h = 0;
  switch (dati.archetipo) {
    case "flusso":
      h = disegnaFlusso(d, dati.flusso, area);
      break;
    case "livelli":
      h = disegnaLivelli(d, dati.livelli, area);
      break;
    case "cronoprogramma":
      h = disegnaCronoprogramma(d, dati.cronoprogramma, area);
      break;
    case "cruscotto":
      h = disegnaCruscotto(d, dati.cruscotto, area);
      break;
    case "rete":
      h = disegnaRete(d, dati.rete, area);
      break;
    default:
      throw new Error(`Archetipo sconosciuto: ${String((dati as { archetipo?: unknown }).archetipo)}`);
  }
  let altezza = MARGINE_Y + h + MARGINE_Y;
  if (d.valoriProposti) {
    d.testo(MARGINE_X, altezza + 2, "* Valore proposto, da confermare.", 11, false, C.grigioTesto, "inizio");
    altezza += 20;
  }
  return { larghezza: LARGHEZZA_DISEGNO, altezza, prims: d.prims, valoriProposti: d.valoriProposti };
}

// Altezza stimata (misura approssimata, senza canvas) per la stima delle pagine.
export function altezzaStimataFigura(dati: DatiFigura): number {
  return calcolaLayoutFigura(dati, { misura: misuraApprossimata }).altezza;
}
