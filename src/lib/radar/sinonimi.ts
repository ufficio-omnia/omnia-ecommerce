// Sinonimi di settore usati dalla ricerca, ricavati dalla MAPPA CPV APPROVATA (file cpv-settori-omnia.csv) e, per le parole che il CPV non
// ha, dalle parole chiave approvate (04_DECISIONI_E_PIANO, §4.1). Ogni termine dichiara da dove viene: il test controlla che un termine
// «cpv» compaia davvero nella descrizione del suo CPV nel file, e che uno «parola_chiave» faccia scattare la regola del suo settore.
// L'utente vede sempre quali sinonimi sono stati usati e da dove vengono. Logica pura.
//
// Esclusi di proposito i termini ambigui del file («custodia» → canili e cimiteri, «accoglienza» → migranti, «sorveglianza» → sanitaria,
// «guardia» → medica, «movimentazione» → terra): restano cercabili se l'utente li scrive, ma non allargano la ricerca da soli.
import type { SettoreRadar } from "./settori";
import { testoPerConfronto } from "./settori";

export type OrigineTermine = { tipo: "cpv"; cpv: string } | { tipo: "parola_chiave" };
export type Termine = { termine: string; origine: OrigineTermine };
export type GruppoSinonimi = { settore: SettoreRadar; termini: readonly Termine[] };

const cpv = (termine: string, codice: string): Termine => ({ termine, origine: { tipo: "cpv", cpv: codice } });
const parola = (termine: string): Termine => ({ termine, origine: { tipo: "parola_chiave" } });

export const SINONIMI: readonly GruppoSinonimi[] = [
  {
    settore: "pulizia",
    termini: [cpv("pulizia", "90910000"), parola("pulizie"), parola("sanificazione"), cpv("disinfezione", "90921000"), cpv("disinfestazione", "90923000"), cpv("fumigazione", "90924000"), parola("igiene ambientale")],
  },
  {
    settore: "ristorazione",
    termini: [cpv("ristorazione", "55300000"), cpv("mensa", "55510000"), parola("mense"), parola("refezione"), cpv("catering", "55520000"), cpv("distribuzione pasti", "55320000"), cpv("preparazione pasti", "55321000")],
  },
  {
    settore: "vigilanza_portierato",
    termini: [cpv("vigilanza", "98341140"), cpv("portineria", "98341120"), parola("portierato"), parola("guardiania"), cpv("pattugliamento", "79715000")],
  },
  {
    settore: "facchinaggio",
    termini: [parola("facchinaggio"), cpv("trasloco", "98392000"), parola("traslochi"), cpv("magazzinaggio", "63121100")],
  },
  {
    settore: "multiservizi",
    termini: [parola("multiservizi"), parola("global service"), parola("facility management"), cpv("gestione impianti", "79993100")],
  },
  {
    settore: "ausiliariato",
    termini: [parola("ausiliariato"), parola("servizi ausiliari")],
  },
];

// Radice di confronto: minuscole senza accenti, prime 5 lettere per le parole lunghe («pulizie» e «pulizia» → «puliz»).
function radice(parola: string): string {
  const t = testoPerConfronto(parola);
  return t.length > 5 ? t.slice(0, 5) : t;
}

export type Espansione = { settore: SettoreRadar; parolaUtente: string; aggiunti: Termine[] };

// Per ogni parola della domanda che coincide con un termine di un gruppo, gli altri termini del gruppo. Una parola composta del gruppo
// («igiene ambientale») vale se tutte le sue parole sono nella domanda.
export function espandiDomanda(parole: readonly string[]): Espansione[] {
  const radici = new Set(parole.map(radice));
  const out: Espansione[] = [];
  for (const g of SINONIMI) {
    const colpito = g.termini.find((t) => testoPerConfronto(t.termine).split(" ").every((p) => radici.has(radice(p))));
    if (!colpito) continue;
    const aggiunti = g.termini.filter((t) => t !== colpito && radice(t.termine) !== radice(colpito.termine));
    out.push({ settore: g.settore, parolaUtente: colpito.termine, aggiunti });
  }
  return out;
}
