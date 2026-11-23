// Orari dei giri programmati delle quattro fonti (piano 48C §3.2, decisioni D2 e D5 dell'utente del 23/11: «Sì, come proposto»). Logica
// PURA, nessun orologio: l'istante arriva come argomento. Gli orari sono di ROMA; il cambio dell'ora si gestisce sulle date (le righe dei
// cron UTC saranno due per orario, pacchetto K1). Usata dagli allarmi delle fonti (stato-fonti-calcoli.ts, «giro_mancato») e, in K1, dalle
// porte orarie delle rotte cron.
import type { FonteEsecuzione } from "./esecuzioni-calcoli";
import { aggiungiGiorni, giornoRoma, oraRoma } from "./notifiche/calendario";

/** «feriali» = dal lunedì al venerdì; «fine_settimana» = sabato e domenica (le festività non sono considerate). */
export type GiorniGiro = "tutti" | "feriali" | "fine_settimana";
export type OrarioGiro = { ora: string; giorni: GiorniGiro };

export const ORARI_GIRI: Readonly<Record<FonteEsecuzione, readonly OrarioGiro[]>> = {
  pvl: [
    { ora: "08:05", giorni: "tutti" },
    { ora: "13:05", giorni: "tutti" },
    { ora: "18:05", giorni: "tutti" },
  ],
  ted: [
    { ora: "10:15", giorni: "feriali" },
    { ora: "16:15", giorni: "feriali" },
  ],
  sintel: [
    { ora: "07:40", giorni: "tutti" },
    { ora: "13:40", giorni: "tutti" },
  ],
  sardegnacat: [
    { ora: "08:20", giorni: "feriali" },
    { ora: "11:20", giorni: "feriali" },
    { ora: "14:20", giorni: "feriali" },
    { ora: "17:20", giorni: "feriali" },
    { ora: "12:20", giorni: "fine_settimana" },
  ],
};

/** Il giorno della settimana di una data AAAA-MM-GG (0 = domenica … 6 = sabato), dalla data stessa (indipendente dal fuso). */
export function giornoDellaSettimana(giorno: string): number {
  return new Date(Date.UTC(Number(giorno.slice(0, 4)), Number(giorno.slice(5, 7)) - 1, Number(giorno.slice(8, 10)))).getUTCDay();
}
export const eFeriale = (giorno: string): boolean => {
  const g = giornoDellaSettimana(giorno);
  return g >= 1 && g <= 5;
};
const vale = (giorni: GiorniGiro, giorno: string) => (giorni === "tutti" ? true : giorni === "feriali" ? eFeriale(giorno) : !eFeriale(giorno));

/** L'istante di un'ora di Roma («HH:MM») in un giorno di calendario: con l'ora legale (+2) o solare (+1), quella che torna. */
export function istanteDiRoma(giorno: string, ora: string): Date {
  const [h, m] = ora.split(":").map(Number);
  for (const scarto of [1, 2]) {
    const d = new Date(Date.UTC(Number(giorno.slice(0, 4)), Number(giorno.slice(5, 7)) - 1, Number(giorno.slice(8, 10)), h - scarto, m));
    if (giornoRoma(d) === giorno && oraRoma(d) === ora) return d;
  }
  throw new Error(`ora inesistente a Roma: ${giorno} ${ora}`);
}

/** Gli istanti dei giri previsti di una fonte con `da` < istante ≤ `a`, in ordine. */
export function orariPrevisti(fonte: FonteEsecuzione, da: Date, a: Date): Date[] {
  const out: Date[] = [];
  if (a.getTime() <= da.getTime()) return out;
  const ultimo = giornoRoma(a);
  for (let g = aggiungiGiorni(giornoRoma(da), -1); g <= ultimo; g = aggiungiGiorni(g, 1)) {
    for (const o of ORARI_GIRI[fonte]) {
      if (!vale(o.giorni, g)) continue;
      const t = istanteDiRoma(g, o.ora);
      if (t.getTime() > da.getTime() && t.getTime() <= a.getTime()) out.push(t);
    }
  }
  return out.sort((x, y) => x.getTime() - y.getTime());
}

/**
 * Quali fonti hanno i giri programmati ACCESI in questo ambiente (interruttori d'ambiente). Oggi: PVL con RADAR_PVL_CRON, Sintel e
 * SardegnaCAT con RADAR_REGIONALI_CRON (fino alla divisione delle rotte, K1: RADAR_SINTEL_CRON e RADAR_SARDEGNACAT_CRON), TED sempre
 * (il suo cron non ha ancora un interruttore: K1 aggiunge RADAR_TED_CRON). Serve agli allarmi: un giro «mancato» conta solo se il cron c'è.
 */
export function cronAttiviDa(env: Record<string, string | undefined>): Set<FonteEsecuzione> {
  const s = new Set<FonteEsecuzione>(["ted"]);
  if (env.RADAR_PVL_CRON === "attivo") s.add("pvl");
  if (env.RADAR_REGIONALI_CRON === "attivo" || env.RADAR_SINTEL_CRON === "attivo") s.add("sintel");
  if (env.RADAR_REGIONALI_CRON === "attivo" || env.RADAR_SARDEGNACAT_CRON === "attivo") s.add("sardegnacat");
  return s;
}
