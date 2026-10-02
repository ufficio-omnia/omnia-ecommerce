import { readFileSync } from "fs";
import path from "path";
import { RENDERER_SUPPORTA_COLORI_SEMANTICI } from "@/lib/colori-semantici";

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

// Regole che presuppongono una capacità del renderer (R20 e R22-bis:
// colore semantico, riquadri tipizzati, evidenziazione di riga/cella) sono
// racchiuse tra questi due commenti e restano nel prompt SOLO se il renderer
// le supporta: altrimenti il modello scriverebbe tag che il documento
// mostrerebbe come testo letterale.
const BLOCCO_COLORE_SEMANTICO_REGEX = /<!-- INIZIO COLORE SEMANTICO -->\n?([\s\S]*?)<!-- FINE COLORE SEMANTICO -->\n?/g;

export function applicaRegoleSupportate(testo: string, rendererSupportaColoriSemantici: boolean): string {
  return testo.replace(BLOCCO_COLORE_SEMANTICO_REGEX, (_blocco, contenuto: string) => (rendererSupportaColoriSemantici ? contenuto : ""));
}

// Solo la parte "attiva" del file: la sezione dopo il marcatore documenta
// regole rimandate alla migrazione a blocchi JSON (presuppongono capacità
// del renderer non ancora presenti) e non va inviata al modello oggi.
export const REGOLE_OMNIA = applicaRegoleSupportate(
  caricaPrompt("regole-omnia.md").split(MARCATORE_FINE_REGOLE_ATTIVE)[0],
  RENDERER_SUPPORTA_COLORI_SEMANTICI,
).trim();

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
// Compressione di UN sotto-criterio con punteggio e requisiti del
// disciplinare (segnaposto elencati nel file).
export const ISTRUZIONI_COMPRESSIONE_MIRATA = corpoPrompt("compressione-mirata-omnia.md");
export const ISTRUZIONI_ESPANSIONE = corpoPrompt("espansione-omnia.md");
export const ISTRUZIONI_VERIFICA_DATI = corpoPrompt("verifica-dati-omnia.md");
// Riformulazione di righe che rimandano all'offerta economica (R8) —
// vedi src/lib/garanzia-senza-economico.ts. Segnaposto: {TITOLO_SEZIONE},
// {CORREZIONI}.
export const ISTRUZIONI_RIFORMULAZIONE_SENZA_ECONOMICO = corpoPrompt("riformulazione-senza-economico-omnia.md");
// Trascrizione di un'immagine (documento di gara) in testo, prima
// dell'indicizzazione — vedi src/lib/gara-indexing.ts.
export const ISTRUZIONI_TRASCRIZIONE_IMMAGINE = corpoPrompt("trascrizione-immagine-omnia.md");
