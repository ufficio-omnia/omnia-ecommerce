// Importazione dalla PVL di ANAC (fase B1-bis, SOLO STAGING): punto di ripresa, finestre, orari dei giri programmati, riga della gara
// costruita da un avviso. Logica pura, provata da scripts/verifica-radar-pvl.ts.
//
// Giri:
//   - FINESTRA (prima importazione controllata, dalla console o dallo script dello staging): un intervallo di giorni scelto, senza notifiche;
//   - INCREMENTALE (giri programmati 8:00, 13:00, 18:00 ora italiana, configurati ma NON attivi): dall'ultimo giorno letto meno uno
//     (sovrapposizione: un avviso pubblicato a fine giornata può comparire in ritardo) fino a oggi.
// In entrambi i casi il punto di ripresa (token della paginazione) si salva dopo ogni pagina: un giro interrotto riparte da lì; i doppioni
// li scartano le impronte (stesso avviso letto due volte = nessuna scrittura).
import type { BandoPvl } from "./fonti/pvl-calcoli";
import { aggiungiGiorni } from "./importa-ted-calcoli";
import { rigaDaBando, type RigaProcedura } from "./importa-calcoli";

export const GIORNI_SOVRAPPOSIZIONE_PVL = 1;
// Finestra massima di un giro programmato (dopo un fermo lungo non si recupera tutto in un colpo: serve una finestra concordata).
export const GIORNI_MASSIMI_INCREMENTALE = 7;
// Oltre questi avvisi per giorno di finestra la risposta è anomala: il giro si ferma e la console lo segnala.
export const AVVISI_ANOMALI_PER_GIORNO = 400;

export type CursorePvl = {
  versione: 1;
  modo: "finestra" | "incrementale";
  inCorso: boolean;
  da: string;
  a: string;
  token: string | null;
  pagine: number;
  // ultimo giorno letto per intero da un giro incrementale finito (la finestra controllata non lo sposta in avanti oltre il suo «a»)
  ultimoGiorno: string | null;
};

const GIORNO = /^\d{4}-\d{2}-\d{2}$/;

export function cursorePvlValido(v: unknown): CursorePvl | null {
  if (!v || typeof v !== "object") return null;
  const c = v as Partial<CursorePvl>;
  const g = (x: unknown) => typeof x === "string" && GIORNO.test(x);
  if (c.versione !== 1 || (c.modo !== "finestra" && c.modo !== "incrementale") || typeof c.inCorso !== "boolean") return null;
  if (!g(c.da) || !g(c.a) || (c.da as string) > (c.a as string)) return null;
  if (c.token !== null && (typeof c.token !== "string" || c.token.length > 500)) return null;
  if (!Number.isInteger(c.pagine) || (c.pagine as number) < 0) return null;
  if (c.ultimoGiorno !== null && !g(c.ultimoGiorno)) return null;
  return c as CursorePvl;
}

export function cursoreFinestra(da: string, a: string, salvato: unknown): CursorePvl {
  if (!GIORNO.test(da) || !GIORNO.test(a) || da > a) throw new Error("Finestra non valida");
  return { versione: 1, modo: "finestra", inCorso: true, da, a, token: null, pagine: 0, ultimoGiorno: cursorePvlValido(salvato)?.ultimoGiorno ?? null };
}

// Il giro programmato da fare adesso: un giro incrementale interrotto continua; altrimenti parte dall'ultimo giorno letto meno la
// sovrapposizione (al massimo GIORNI_MASSIMI_INCREMENTALE indietro). Senza un giorno letto: solo ieri e oggi.
export function cursoreIncrementale(salvato: unknown, oggi: string): CursorePvl {
  const c = cursorePvlValido(salvato);
  if (c && c.inCorso && c.modo === "incrementale") return c;
  const minimo = aggiungiGiorni(oggi, -GIORNI_MASSIMI_INCREMENTALE);
  const base = c?.ultimoGiorno ? aggiungiGiorni(c.ultimoGiorno, -GIORNI_SOVRAPPOSIZIONE_PVL) : aggiungiGiorni(oggi, -1);
  const da = base < minimo ? minimo : base > oggi ? oggi : base;
  return { versione: 1, modo: "incrementale", inCorso: true, da, a: oggi, token: null, pagine: 0, ultimoGiorno: c?.ultimoGiorno ?? null };
}

// Una pagina più corta del massimo è l'ultima: nessuna richiesta in più alla fonte (la PVL dopo l'ultima pagina risponde senza risultati).
export function cursoreDopoPagina(c: CursorePvl, avvisiLetti: number, token: string | null, avvisiPerPagina: number): CursorePvl {
  if (avvisiLetti >= avvisiPerPagina && token) return { ...c, token, pagine: c.pagine + 1 };
  const ultimo = c.modo === "incrementale" || !c.ultimoGiorno || c.a > c.ultimoGiorno ? c.a : c.ultimoGiorno;
  return { ...c, inCorso: false, token: null, pagine: c.pagine + 1, ultimoGiorno: c.modo === "incrementale" ? c.a : ultimo };
}

export function giorniFinestra(c: Pick<CursorePvl, "da" | "a">): number {
  return Math.round((Date.parse(`${c.a}T12:00:00Z`) - Date.parse(`${c.da}T12:00:00Z`)) / 86_400_000) + 1;
}

export function conteggioAnomalo(count: number | null, c: Pick<CursorePvl, "da" | "a">): boolean {
  return count !== null && count > AVVISI_ANOMALI_PER_GIORNO * giorniFinestra(c);
}

// ───── giri programmati: 8:00, 13:00, 18:00 ora italiana, con l'ora legale ─────

export const ORE_GIRI_PVL = [8, 13, 18] as const;

// Le righe di vercel.json che servirebbero: Vercel ragiona in UTC, quindi si chiamano entrambe le ore UTC possibili (ora solare e legale)
// e il percorso parte solo quando a Roma è l'ora giusta. NON sono in vercel.json: si aggiungono solo con l'autorizzazione operativa.
export const CRON_PVL_PROPOSTO = "5 6,7,11,12,16,17 * * *";

const FMT_ORA_ROMA = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function oraDiRoma(d: Date): { ora: number; minuto: number } {
  const [h, m] = FMT_ORA_ROMA.format(d).split(":").map(Number);
  return { ora: h, minuto: m };
}

// Questo richiamo del cron è uno dei tre giri? Sì solo nell'ora giusta a Roma (entro 30 minuti, per i ritardi di Vercel).
export function eOraDiUnGiroPvl(d: Date): boolean {
  const { ora, minuto } = oraDiRoma(d);
  return (ORE_GIRI_PVL as readonly number[]).includes(ora) && minuto < 30;
}

// Il prossimo giro previsto dopo «d» (per la console): il primo istante in cui a Roma sono le 8, le 13 o le 18.
export function prossimoGiroPvl(d: Date): Date {
  const t = new Date(d.getTime());
  t.setUTCSeconds(0, 0);
  t.setUTCMinutes(0);
  for (let i = 0; i < 72; i++) {
    t.setUTCHours(t.getUTCHours() + 1);
    const { ora, minuto } = oraDiRoma(t);
    if (minuto === 0 && (ORE_GIRI_PVL as readonly number[]).includes(ora)) return new Date(t.getTime());
  }
  return t;
}

// ───── riga della gara costruita da un solo avviso PVL ─────

export function rigaDaBandoPvl(b: BandoPvl, adesso: Date): RigaProcedura {
  return rigaDaBando(
    { record: b.record, regioni: b.regioni, enteTipo: null, scadenzaFonte: b.scadenzaFonte, settori: b.settori, metodoSettore: b.metodoSettore, meta: { data: b.meta.giorno, numero: `pvl:${b.meta.idAvviso}` } },
    null,
    adesso,
  );
}

// ───── statistiche di un giro (registrate in radar_fonti_stato.conteggi e mostrate in console) ─────

export type StatistichePvl = {
  pvl: { richieste: number; byte: number; ms: number; risposte: Record<string, number>; conteggioDichiarato: number | null };
  // sostituiti = avvisi che la PVL dichiara superati da un avviso nuovo (rettifiche, annullamenti), per tipo; non attivi = ritirati
  avvisi: { letti: number; perScheda: Record<string, number>; bandi: number; esiti: number; esclusi: Record<string, number>; sostituiti: Record<string, number>; nonAttivi: number };
  bandi: {
    invariati: number;
    // gare nuove nell'archivio: nazionali (senza avviso TED) e sopra soglia non ancora arrivate da TED
    nuoveNazionali: number;
    nuoveSopraSogliaSenzaTed: number;
    // la stessa gara era già nell'archivio da TED (riconosciuta col numero dell'avviso TED o col CIG)
    giaPresentiTed: number;
    // nuova versione di una gara già letta dalla PVL
    nuoveVersioni: number;
    aggiornate: number;
    rettifiche: number;
    annullate: number;
    // gare importate già scadute al momento dell'importazione (mai mostrate come aperte)
    scaduteAllImportazione: number;
    lotti: number;
    cigAssegnati: number;
    cigScartati: number;
    lottiNonAllineati: number;
    aggiunteCollegate: number;
    conflitti: number;
    mancanti: Record<string, number>;
  };
  esiti: { letti: number; applicati: number; senzaGara: number; invariati: number };
};

export function statistichePvlVuote(): StatistichePvl {
  return {
    pvl: { richieste: 0, byte: 0, ms: 0, risposte: {}, conteggioDichiarato: null },
    avvisi: { letti: 0, perScheda: {}, bandi: 0, esiti: 0, esclusi: {}, sostituiti: {}, nonAttivi: 0 },
    bandi: {
      invariati: 0,
      nuoveNazionali: 0,
      nuoveSopraSogliaSenzaTed: 0,
      giaPresentiTed: 0,
      nuoveVersioni: 0,
      aggiornate: 0,
      rettifiche: 0,
      annullate: 0,
      scaduteAllImportazione: 0,
      lotti: 0,
      cigAssegnati: 0,
      cigScartati: 0,
      lottiNonAllineati: 0,
      aggiunteCollegate: 0,
      conflitti: 0,
      mancanti: {},
    },
    esiti: { letti: 0, applicati: 0, senzaGara: 0, invariati: 0 },
  };
}

export function aggiungi(m: Record<string, number>, k: string, n = 1): void {
  m[k] = (m[k] ?? 0) + n;
}
