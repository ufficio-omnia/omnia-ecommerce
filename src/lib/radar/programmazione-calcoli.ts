// Orari dei giri programmati delle quattro fonti (piano 48C §3.2, decisioni D2 e D5 dell'utente del 23/11: «Sì, come proposto»). Logica
// PURA, nessun orologio: l'istante arriva come argomento. Gli orari sono di ROMA; il cambio dell'ora si gestisce sulle date (le righe dei
// cron UTC sono due per orario, CRON_PROPOSTI). Usata dagli allarmi delle fonti (stato-fonti-calcoli.ts, «giro_mancato») e dalla porta
// oraria delle rotte cron (giro-programmato.ts, K1).
import type { FonteEsecuzione, OrigineGiro } from "./esecuzioni-calcoli";
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
  // Fase 2 (26/11, proposta B2): SATER al minuto :50, lontano dai giri delle altre fonti (:05 PVL, :15 TED, :20 SardegnaCAT, :40 Sintel)
  // e dai promemoria (:00, :30); 3 giri nei feriali a 4 ore di distanza e uno nel fine settimana (3 richieste al portale per giro)
  sater: [
    { ora: "08:50", giorni: "feriali" },
    { ora: "12:50", giorni: "feriali" },
    { ora: "16:50", giorni: "feriali" },
    { ora: "12:50", giorni: "fine_settimana" },
  ],
};

const TESTO_GIORNI: Record<GiorniGiro, string> = { tutti: "tutti i giorni", feriali: "dal lunedì al venerdì", fine_settimana: "il sabato e la domenica" };
const elenco = (xs: readonly string[]) => (xs.length === 1 ? xs[0] : `${xs.slice(0, -1).join(", ")} e ${xs[xs.length - 1]}`);

/**
 * Gli orari dei giri di una fonte in parole, presi da ORARI_GIRI (mai scritti a mano altrove): «alle 08:05, 13:05 e 18:05 tutti i giorni».
 * Li mostrano la console e, nel riquadro delle fonti, le pagine dei clienti.
 */
export function testoOrari(fonte: FonteEsecuzione): string {
  const gruppi = new Map<GiorniGiro, string[]>();
  for (const o of ORARI_GIRI[fonte]) gruppi.set(o.giorni, [...(gruppi.get(o.giorni) ?? []), o.ora]);
  return [...gruppi].map(([g, ore]) => `alle ${elenco(ore)} ${TESTO_GIORNI[g]}`).join("; ");
}

/** Il giorno della settimana di una data AAAA-MM-GG (0 = domenica … 6 = sabato), dalla data stessa (indipendente dal fuso). */
export function giornoDellaSettimana(giorno: string): number {
  return new Date(Date.UTC(Number(giorno.slice(0, 4)), Number(giorno.slice(5, 7)) - 1, Number(giorno.slice(8, 10)))).getUTCDay();
}
export const eFeriale = (giorno: string): boolean => {
  const g = giornoDellaSettimana(giorno);
  return g >= 1 && g <= 5;
};
const vale = (giorni: GiorniGiro, giorno: string) => (giorni === "tutti" ? true : giorni === "feriali" ? eFeriale(giorno) : !eFeriale(giorno));

// memoria dei calcoli già fatti (giorno e ora → istante): il calcolo passa per il fuso di Roma, che è lento; il risultato non cambia mai
const ISTANTI_NOTI = new Map<string, number>();

/** L'istante di un'ora di Roma («HH:MM») in un giorno di calendario: con l'ora legale (+2) o solare (+1), quella che torna. */
export function istanteDiRoma(giorno: string, ora: string): Date {
  const chiave = `${giorno} ${ora}`;
  const noto = ISTANTI_NOTI.get(chiave);
  if (noto !== undefined) return new Date(noto);
  const [h, m] = ora.split(":").map(Number);
  for (const scarto of [1, 2]) {
    const d = new Date(Date.UTC(Number(giorno.slice(0, 4)), Number(giorno.slice(5, 7)) - 1, Number(giorno.slice(8, 10)), h - scarto, m));
    if (giornoRoma(d) === giorno && oraRoma(d) === ora) {
      if (ISTANTI_NOTI.size >= 5_000) ISTANTI_NOTI.clear();
      ISTANTI_NOTI.set(chiave, d.getTime());
      return d;
    }
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

// ───── porta oraria delle rotte cron (K1, 48C §3.1 punto 3) ─────

/** Un richiamo del cron vale come giro se cade da 2 minuti prima a 25 minuti dopo un orario previsto (ritardi di Vercel, 48C §3.2). */
export const TOLLERANZA_GIRO = { anticipoMinuti: 2, ritardoMinuti: 25 } as const;

/** Questo richiamo (istante `adesso`) è uno dei giri previsti della fonte, all'ora di ROMA? Funzione pura: nessun database, nessuna rete. */
export function eOraDiUnGiro(fonte: FonteEsecuzione, adesso: Date): boolean {
  const t = adesso.getTime();
  return orariPrevisti(fonte, new Date(t - TOLLERANZA_GIRO.ritardoMinuti * 60_000), new Date(t + TOLLERANZA_GIRO.anticipoMinuti * 60_000)).length > 0;
}

/**
 * Le righe di vercel.json PROPOSTE per ogni fonte (48C §3.2), in UTC: per ogni orario di Roma si chiamano le due ore UTC possibili (ora
 * solare e legale) e passa solo il richiamo che a Roma cade all'ora giusta (eOraDiUnGiro). NON sono in vercel.json: le mette il
 * coordinamento, al rilascio autorizzato. La prova le confronta con ORARI_GIRI giorno per giorno, cambi dell'ora compresi.
 */
export const CRON_PROPOSTI: Readonly<Record<FonteEsecuzione, readonly string[]>> = {
  pvl: ["5 6,7,11,12,16,17 * * *"],
  ted: ["15 8,9,14,15 * * 1-5"],
  sintel: ["40 5,6,11,12 * * *"],
  // una riga per rotta: chiama tutte le ore UTC possibili dei giorni feriali e del fine settimana, e decide la porta oraria
  sardegnacat: ["20 6,7,9,10,11,12,13,15,16 * * *"],
  // 08:50, 12:50 e 16:50 di Roma = 7, 11, 15 UTC d'inverno e 6, 10, 14 UTC d'estate; la porta oraria tiene solo quelli giusti
  sater: ["50 6,7,10,11,14,15 * * *"],
};
/**
 * Doppio richiamo (48C §3.1 punto 7): un giro PROGRAMMATO non riparte se l'ultimo giro riuscito della fonte è di meno di 45 minuti fa
 * (Vercel può chiamare due volte lo stesso cron); esce con «gia_eseguito» senza chiamare la fonte. I giri dalla console e dagli script
 * restano ammessi. I giri della stessa fonte distano almeno 3 ore: 45 minuti non ne toccano mai uno vero.
 */
export const MINUTI_DOPPIO_RICHIAMO = 45;
export function eDoppioRichiamo(origine: OrigineGiro | undefined, ultimoSuccessoIl: string | null | undefined, adesso: Date): boolean {
  if ((origine ?? "programmato") !== "programmato" || !ultimoSuccessoIl) return false;
  const t = Date.parse(ultimoSuccessoIl);
  return Number.isFinite(t) && t <= adesso.getTime() && adesso.getTime() - t < MINUTI_DOPPIO_RICHIAMO * 60_000;
}

/** Le rotte cron per fonte (K1: Sintel e SardegnaCAT hanno ciascuna la sua; la vecchia radar-regionali resta finché vercel.json non cambia). */
export const ROTTE_CRON: Readonly<Record<FonteEsecuzione, string>> = { ted: "/api/cron/radar-ted", pvl: "/api/cron/radar-pvl", sintel: "/api/cron/radar-sintel", sardegnacat: "/api/cron/radar-sardegnacat", sater: "/api/cron/radar-sater" };

/** L'interruttore d'ambiente di ogni rotta cron (= «attivo» per accenderla; spento di base). */
export const INTERRUTTORI_CRON: Readonly<Record<FonteEsecuzione, string>> = { ted: "RADAR_TED_CRON", pvl: "RADAR_PVL_CRON", sintel: "RADAR_SINTEL_CRON", sardegnacat: "RADAR_SARDEGNACAT_CRON", sater: "RADAR_SATER_CRON" };
/** Il vecchio interruttore della rotta unica radar-regionali (Sintel e SardegnaCAT insieme), finché quella rotta esiste. */
export const INTERRUTTORE_REGIONALI_VECCHIO = "RADAR_REGIONALI_CRON";

/**
 * Quali fonti hanno i giri programmati ACCESI in questo ambiente (interruttori d'ambiente): ognuna col proprio interruttore; Sintel e
 * SardegnaCAT anche col vecchio RADAR_REGIONALI_CRON (la rotta unica le lancia entrambe, finché c'è). Serve agli allarmi: un giro
 * «mancato» conta solo se il cron c'è.
 */
export function cronAttiviDa(env: Record<string, string | undefined>): Set<FonteEsecuzione> {
  const s = new Set<FonteEsecuzione>();
  for (const [fonte, nome] of Object.entries(INTERRUTTORI_CRON) as [FonteEsecuzione, string][]) if (env[nome] === "attivo") s.add(fonte);
  if (env[INTERRUTTORE_REGIONALI_VECCHIO] === "attivo") {
    s.add("sintel");
    s.add("sardegnacat");
  }
  return s;
}
