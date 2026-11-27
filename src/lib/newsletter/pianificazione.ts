// Calendario della newsletter nel fuso Europe/Rome, con l'ora legale gestita dal sistema (Intl), non a mano.
// Funzioni pure: le usano il cron, la console e le verifiche.

const FUSO = "Europe/Rome";

type PartiRoma = { anno: number; mese: number; giorno: number; ore: number; minuti: number; giornoSettimana: number };

export function partiRoma(d: Date): PartiRoma {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: FUSO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const giorni: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return { anno: Number(p.year), mese: Number(p.month), giorno: Number(p.day), ore: Number(p.hour), minuti: Number(p.minute), giornoSettimana: giorni[p.weekday] };
}

// Istante UTC corrispondente all'ora «da muro» di Roma indicata (prova +1 e +2: CET/CEST).
export function istanteRoma(anno: number, mese: number, giorno: number, ore: number, minuti: number): Date {
  for (const scarto of [1, 2]) {
    const candidato = new Date(Date.UTC(anno, mese - 1, giorno, ore - scarto, minuti));
    const p = partiRoma(candidato);
    if (p.anno === anno && p.mese === mese && p.giorno === giorno && p.ore === ore && p.minuti === minuti) return candidato;
  }
  // ora inesistente (salto dell'ora legale, 02:xx dell'ultima domenica di marzo): si prende l'ora dopo
  return new Date(Date.UTC(anno, mese - 1, giorno, ore - 1, minuti));
}

export function oraValida(ora: string): boolean {
  return /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(ora);
}

// Data di Roma (AAAA-MM-GG) dell'istante.
export function dataRoma(d: Date): string {
  const p = partiRoma(d);
  return `${p.anno}-${String(p.mese).padStart(2, "0")}-${String(p.giorno).padStart(2, "0")}`;
}

// Settimana ISO della data di Roma, es. «2026-W48».
export function settimanaIso(d: Date): string {
  const p = partiRoma(d);
  const g = new Date(Date.UTC(p.anno, p.mese - 1, p.giorno));
  const giornoIso = p.giornoSettimana;
  g.setUTCDate(g.getUTCDate() + 4 - giornoIso); // giovedì della stessa settimana
  const inizioAnno = new Date(Date.UTC(g.getUTCFullYear(), 0, 1));
  const settimana = Math.ceil(((g.getTime() - inizioAnno.getTime()) / 86400000 + 1) / 7);
  return `${g.getUTCFullYear()}-W${String(settimana).padStart(2, "0")}`;
}

// Istante della scadenza «giorno ISO + ora» nella settimana (di Roma) che contiene `rif`.
export function scadenzaNellaSettimana(giornoIso: number, ora: string, rif: Date): Date {
  const p = partiRoma(rif);
  const base = new Date(Date.UTC(p.anno, p.mese - 1, p.giorno));
  base.setUTCDate(base.getUTCDate() + (giornoIso - p.giornoSettimana));
  const [h, m] = ora.split(":").map(Number);
  return istanteRoma(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), h, m);
}

// Prossima scadenza futura (strettamente dopo `da`).
export function prossimaScadenza(giornoIso: number, ora: string, da: Date): Date {
  const questa = scadenzaNellaSettimana(giornoIso, ora, da);
  if (questa.getTime() > da.getTime()) return questa;
  return scadenzaNellaSettimana(giornoIso, ora, new Date(da.getTime() + 7 * 86400000));
}

// La generazione automatica parte se siamo nella finestra [scadenza, scadenza + 20 ore) di questa settimana:
// un cron che salta un giro recupera al giro dopo, ma una bozza non nasce giorni dopo (per esempio quando
// l'amministratore cambia il giorno a settimana inoltrata).
export const FINESTRA_GENERAZIONE_MS = 20 * 60 * 60 * 1000;

export function generazioneDovuta(giornoIso: number, ora: string, adesso: Date): boolean {
  const s = scadenzaNellaSettimana(giornoIso, ora, adesso).getTime();
  return adesso.getTime() >= s && adesso.getTime() < s + FINESTRA_GENERAZIONE_MS;
}

export function formattaRoma(iso: string | Date | null): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("it-IT", { timeZone: FUSO, weekday: "short", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
}

// Valore per <input type="datetime-local"> (ora di Roma) e ritorno.
export function perInputLocale(d: Date): string {
  const p = partiRoma(d);
  return `${p.anno}-${String(p.mese).padStart(2, "0")}-${String(p.giorno).padStart(2, "0")}T${String(p.ore).padStart(2, "0")}:${String(p.minuti).padStart(2, "0")}`;
}

export function daInputLocale(v: string): Date | null {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;
  return istanteRoma(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]));
}
