// Rigenera src/lib/radar/cpv-ricerca-pvl-dati.ts dall'elenco dei CPV di ricerca della PVL, src/lib/radar/dati/cpv-ricerca-pvl.csv (C2;
// decisione dell'utente del 23/11, nota 49C). Da lanciare dopo ogni modifica dell'elenco (una modifica registrata, decisa dall'utente):
//   npx tsx scripts/genera-cpv-ricerca-pvl.ts
// Si ferma su qualunque errore dell'elenco (scripts/lib/cpv-ricerca-pvl-csv.ts). Il controllo di corrispondenza tra elenco e file generato
// sta in scripts/verifica-radar-c2-pvl.ts (livello 1).
import fs from "fs";
import path from "path";
import { leggiCsvRicercaPvl } from "./lib/cpv-ricerca-pvl-csv";
import { CPV_SETTORI_OMNIA } from "../src/lib/radar/settori-dati";

const radice = path.join(__dirname, "..");
const righe = leggiCsvRicercaPvl(path.join(radice, "src", "lib", "radar", "dati", "cpv-ricerca-pvl.csv"), CPV_SETTORI_OMNIA.map((r) => r.cpv));
const corpo = righe
  .map((r) => `  { cpv: ${JSON.stringify(r.cpv)}, descrizione: ${JSON.stringify(r.descrizione)}, fascia: ${r.fascia}, gareRecuperate: ${r.gareRecuperate}, dataAggiunta: ${JSON.stringify(r.dataAggiunta)}, nota: ${JSON.stringify(r.nota)} },`)
  .join("\n");
const testo = `// FILE GENERATO da scripts/genera-cpv-ricerca-pvl.ts a partire da src/lib/radar/dati/cpv-ricerca-pvl.csv: NON modificarlo a mano.
// L'elenco (C2, decisione dell'utente del 23/11, nota 49C) serve SOLO alla ricerca della PVL: il settore lo decide il file di classificazione.

export type RigaCpvRicercaPvl = { cpv: string; descrizione: string | null; fascia: number; gareRecuperate: number; dataAggiunta: string; nota: string | null };

export const CPV_RICERCA_PVL: readonly RigaCpvRicercaPvl[] = [
${corpo}
];
`;
fs.writeFileSync(path.join(radice, "src", "lib", "radar", "cpv-ricerca-pvl-dati.ts"), testo);
console.log(`cpv-ricerca-pvl-dati.ts rigenerato: ${righe.length} codici`);
