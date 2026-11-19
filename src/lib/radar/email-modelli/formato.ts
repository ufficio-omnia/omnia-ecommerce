// Formattazione pura per le email di Tender Intelligence: date, scadenze, collegamenti e testo sicuro. Nessun database, nessuna rete.
// La scadenza non si presume mai: senza un'ora indicata dalla fonte si scrive «ora non indicata dalla fonte».
import { esc } from "@/lib/omnia-ai-email-eventi-calcoli";
import type { ScadenzaEmail } from "./contratto";

export { esc };

export const TESTO_ORA_NON_INDICATA = "ora non indicata dalla fonte";
export const TESTO_SCADENZA_NON_INDICATA = "non indicata dalla fonte";

const FORMATO_GIORNO = new Intl.DateTimeFormat("it-IT", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" });
const FORMATO_DATA = new Intl.DateTimeFormat("it-IT", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });
const FORMATO_VERIFICA = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Un giorno «AAAA-MM-GG» valido come data di calendario (senza fusi: è il giorno di Roma già calcolato dalla fonte o dal motore). */
function dataDelGiorno(giorno: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(giorno ?? ""));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? d : null;
}

/** «HH:MM» valida (00:00–23:5x); qualunque altra cosa vale «ora non indicata». */
export function oraValida(ora: string | null | undefined): string | null {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(ora ?? "")) ? String(ora) : null;
}

/** «giovedì 26 novembre 2026». */
export function formattaGiorno(giorno: string | null | undefined): string | null {
  const d = dataDelGiorno(giorno);
  return d ? FORMATO_GIORNO.format(d) : null;
}

/** «26 novembre 2026». */
export function formattaData(giorno: string | null | undefined): string | null {
  const d = dataDelGiorno(String(giorno ?? "").slice(0, 10));
  return d ? FORMATO_DATA.format(d) : null;
}

/** Le parti della scadenza: il giorno leggibile (null se manca o non è valido) e l'ora SOLO se indicata dalla fonte. */
export function partiScadenza(scadenza: ScadenzaEmail | null | undefined): { giorno: string | null; ora: string | null } {
  const giorno = formattaGiorno(scadenza?.giorno);
  return { giorno, ora: giorno ? oraValida(scadenza?.ora) : null };
}

/** La scadenza come si legge nell'email: giorno e ora solo se l'ora è indicata dalla fonte; mai un'ora presunta. */
export function formattaScadenza(scadenza: ScadenzaEmail | null | undefined): string {
  const { giorno, ora } = partiScadenza(scadenza);
  if (!giorno) return TESTO_SCADENZA_NON_INDICATA;
  return ora ? `${giorno}, ore ${ora}` : `${giorno} · ${TESTO_ORA_NON_INDICATA}`;
}

/** «18/11/2026 alle 17:45» (ora di Roma), o null se il valore non è una data. */
export function formattaVerifica(iso: string | null | undefined): string | null {
  const t = Date.parse(String(iso ?? ""));
  if (!Number.isFinite(t)) return null;
  return FORMATO_VERIFICA.format(new Date(t)).replace(",", " alle");
}

/** Solo collegamenti http(s) senza spazi né caratteri di controllo: qualunque altro schema (javascript:, data:…) non si scrive. */
export function urlSicuro(url: string | null | undefined): string | null {
  const u = String(url ?? "").trim();
  return /^https?:\/\/[^\s<>"'\u0000-\u001f]+$/i.test(u) ? u : null;
}

/** Testo su una riga: niente caratteri di controllo né a capo (oggetto dell'email e testo semplice). */
export function riga(testo: string | null | undefined): string {
  return String(testo ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Accorcia su una riga a `massimo` caratteri, con «…». */
export function breve(testo: string | null | undefined, massimo: number): string {
  const r = riga(testo);
  return r.length > massimo ? `${r.slice(0, massimo - 1).trimEnd()}…` : r;
}
