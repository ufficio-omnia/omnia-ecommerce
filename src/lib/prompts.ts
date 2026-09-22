import { readFileSync } from "fs";
import path from "path";

// Carica un prompt da "prompts/" a runtime invece di duplicarne il testo in
// una costante TypeScript: il file .md resta l'unica fonte di verità
// (versionata, modificabile senza toccare il codice). "prompts/" va
// dichiarata in next.config.ts (outputFileTracingIncludes) perché il
// tracciamento automatico di Vercel non segue un readFileSync con percorso
// costruito a runtime.
function caricaPrompt(nomeFile: string): string {
  return readFileSync(path.join(process.cwd(), "prompts", nomeFile), "utf-8").trim();
}

const MARCATORE_FINE_REGOLE_ATTIVE = "<!-- FINE REGOLE ATTIVE -->";

// Solo la parte "attiva" del file: la sezione dopo il marcatore documenta
// regole rimandate alla migrazione a blocchi JSON (presuppongono capacità
// del renderer non ancora presenti) e non va inviata al modello oggi.
export const REGOLE_OMNIA = caricaPrompt("regole-omnia.md").split(MARCATORE_FINE_REGOLE_ATTIVE)[0].trim();

// Estrae solo il corpo del prompt tra i marcatori INIZIO/FINE, escludendo
// l'intestazione di spiegazione del file (destinata a chi legge il file
// versionato, non al modello).
function corpoPrompt(nomeFile: string): string {
  const testo = caricaPrompt(nomeFile);
  const inizio = testo.indexOf("<!-- INIZIO PROMPT -->");
  const fine = testo.indexOf("<!-- FINE PROMPT -->");
  if (inizio === -1 || fine === -1) {
    throw new Error(`${nomeFile}: marcatori INIZIO/FINE PROMPT non trovati.`);
  }
  return testo.slice(inizio + "<!-- INIZIO PROMPT -->".length, fine).trim();
}

// {N} sostituito dal chiamante con il numero di parole da togliere/
// aggiungere, calcolato in base allo scarto di pagine reale (vedi
// correggiSezioneVersoTarget in relazione-tecnica.ts).
export const ISTRUZIONI_COMPRESSIONE = corpoPrompt("compressione-omnia.md");
export const ISTRUZIONI_ESPANSIONE = corpoPrompt("espansione-omnia.md");
