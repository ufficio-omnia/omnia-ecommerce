// Formati brevi delle schermate «Opportunità» (date, importi, conto alla rovescia). Puri: si usano nei componenti del server.
import { nomeSettore, type SettoreRadar } from "@/lib/radar/settori";
import { nomeRegione } from "@/lib/radar/territorio";
import { giorniAllaScadenza } from "@/lib/radar/sintesi-calcoli";

const FMT_BREVE = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "numeric", month: "short", year: "numeric" });
const FMT_ORA = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const FMT_GIORNO = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "2-digit", month: "2-digit", year: "numeric" });

export function scadenzaBreve(iso: string | null, oraIndicata: boolean): string {
  if (!iso) return "Scadenza non indicata";
  const d = new Date(iso);
  return oraIndicata ? `${FMT_BREVE.format(d)}, ${FMT_ORA.format(d)}` : `${FMT_BREVE.format(d)} · ora non indicata`;
}

export function contoAllaRovescia(iso: string | null, adesso: Date): { testo: string; urgente: boolean } | null {
  const g = giorniAllaScadenza(iso, adesso);
  if (g === null) return null;
  if (g < 0) return { testo: "Scaduta", urgente: false };
  if (g === 0) return { testo: "Scade oggi", urgente: true };
  if (g === 1) return { testo: "Scade domani", urgente: true };
  return { testo: `tra ${g} giorni`, urgente: g <= 7 };
}

export function importoBreve(n: number | null): string | null {
  if (n === null || !Number.isFinite(n)) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString("it-IT", { maximumFractionDigits: 2 })} mln €`;
  if (n >= 10_000) return `${Math.round(n / 1000).toLocaleString("it-IT")} mila €`;
  return `${n.toLocaleString("it-IT", { maximumFractionDigits: 2 })} €`;
}

export function giorno(iso: string | null): string | null {
  if (!iso) return null;
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  return Number.isNaN(d.getTime()) ? null : FMT_GIORNO.format(d);
}

export function settoriLeggibili(settori: readonly string[]): string {
  return settori.map((s) => nomeSettore(s as SettoreRadar)).join(" · ");
}

export function regioniLeggibili(regioni: readonly string[]): string {
  return regioni.map((r) => nomeRegione(r) ?? r).join(", ");
}
