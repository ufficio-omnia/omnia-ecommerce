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
