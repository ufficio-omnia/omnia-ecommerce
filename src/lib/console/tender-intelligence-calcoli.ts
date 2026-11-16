// Console «Tender Intelligence» (fase B1): quali parametri si possono cambiare e con quali valori. Logica pura, provata da
// scripts/verifica-radar-b1.ts. Ogni modifica passa da qui nel server: il modulo della pagina non è una garanzia.
import { AZIONI_RADAR, CHIAVE_RADAR_ATTIVO, LIMITI_PREDEFINITI, PREFISSO_COSTO, PREFISSO_LIMITE, type NomeLimite } from "@/lib/radar/diritto-calcoli";

export const MASSIMO_COSTO_CONSOLE = 1_000;
export const MASSIMO_LIMITE_CONSOLE = 100_000;

export type ChiaveModificabile = { chiave: string; tipo: "interruttore" | "costo" | "limite" };

export const CHIAVI_MODIFICABILI: readonly ChiaveModificabile[] = [
  { chiave: CHIAVE_RADAR_ATTIVO, tipo: "interruttore" },
  ...AZIONI_RADAR.map((a) => ({ chiave: `${PREFISSO_COSTO}${a}`, tipo: "costo" as const })),
  ...(Object.keys(LIMITI_PREDEFINITI) as NomeLimite[]).map((n) => ({ chiave: `${PREFISSO_LIMITE}${n}`, tipo: "limite" as const })),
];

export type EsitoParametro = { ok: true; valore: string } | { ok: false; errore: string };

// Valore scritto in console → valore da salvare (stringa, come in console_impostazioni). Interruttore: solo «0» o «1». Costi: interi da 0
// a 1000 crediti. Limiti: interi da 0 a 100.000 (0 = azione bloccata per tutte le imprese senza un valore dedicato).
export function validaParametro(chiave: string, valore: string): EsitoParametro {
  const voce = CHIAVI_MODIFICABILI.find((c) => c.chiave === chiave);
  if (!voce) return { ok: false, errore: "Parametro non modificabile." };
  const v = valore.trim();
  if (voce.tipo === "interruttore") return v === "0" || v === "1" ? { ok: true, valore: v } : { ok: false, errore: "L'interruttore vale 0 (spento) o 1 (acceso)." };
  if (!/^\d{1,6}$/.test(v)) return { ok: false, errore: "Scrivi un numero intero senza segni né decimali." };
  const n = Number(v);
  const massimo = voce.tipo === "costo" ? MASSIMO_COSTO_CONSOLE : MASSIMO_LIMITE_CONSOLE;
  if (n > massimo) return { ok: false, errore: `Il valore massimo è ${massimo.toLocaleString("it-IT")}.` };
  return { ok: true, valore: String(n) };
}

// Le modifiche vere: solo i parametri il cui valore cambia (un salvataggio senza cambiamenti non scrive e non registra nulla).
export function modificheParametri(precedenti: ReadonlyMap<string, string>, nuovi: readonly { chiave: string; valore: string }[]): { chiave: string; prima: string | null; dopo: string }[] {
  return nuovi.filter((n) => (precedenti.get(n.chiave) ?? null) !== n.valore).map((n) => ({ chiave: n.chiave, prima: precedenti.get(n.chiave) ?? null, dopo: n.valore }));
}

const ETICHETTE_AZIONI: Record<string, string> = {
  ricerca: "ricerca",
  sintesi: "sintesi in linguaggio semplice",
  analisi_requisiti: "analisi dei requisiti",
  intelligence: "intelligence",
  crea_offerta: "creazione dell'offerta tecnica",
  aggiungi_manuale: "gara aggiunta a mano",
  monitora: "monitoraggio",
};
const ETICHETTE_LIMITI: Record<string, string> = {
  progetti_senza_analisi: "progetti dal Radar senza analisi",
  ricerche_minuto: "ricerche al minuto",
  sintesi_giorno: "sintesi al giorno",
  analisi_requisiti_giorno: "analisi dei requisiti al giorno",
};

// Nome leggibile di un parametro, per i messaggi d'errore della console.
export function etichettaParametro(chiave: string): string {
  if (chiave === CHIAVE_RADAR_ATTIVO) return "Interruttore generale";
  if (chiave.startsWith(PREFISSO_COSTO)) return `Costo (${ETICHETTE_AZIONI[chiave.slice(PREFISSO_COSTO.length)] ?? chiave})`;
  if (chiave.startsWith(PREFISSO_LIMITE)) return `Limite (${ETICHETTE_LIMITI[chiave.slice(PREFISSO_LIMITE.length)] ?? chiave})`;
  return chiave;
}

export function normalizzaEmailConsole(email: string): string | null {
  const e = email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 320 ? e : null;
}
