// Rigenera src/lib/radar/settori-dati.ts dal file approvato dal titolare, src/lib/radar/dati/cpv-settori-omnia.csv, che resta l'UNICA fonte
// della mappa CPV → settore di Tender Intelligence (decisione dell'11/11/2026). Da lanciare dopo ogni modifica del CSV:
//   npx tsx scripts/genera-cpv-radar.ts
// Il controllo di corrispondenza tra CSV e file generato sta in scripts/verifica-radar-fondamenta.ts (livello 1, quindi in prebuild).
import fs from "fs";
import path from "path";
import { leggiCsvCpvSettori } from "./lib/cpv-radar-csv";

const radice = path.join(__dirname, "..");
const righe = leggiCsvCpvSettori(path.join(radice, "src", "lib", "radar", "dati", "cpv-settori-omnia.csv"));
const corpo = righe.map((r) => `  { codice: ${JSON.stringify(r.codice)}, cpv: ${JSON.stringify(r.cpv)}, descrizione: ${JSON.stringify(r.descrizione)}, settore: ${JSON.stringify(r.settore)} },`).join("\n");
const testo = `// FILE GENERATO da scripts/genera-cpv-radar.ts a partire da src/lib/radar/dati/cpv-settori-omnia.csv: NON modificarlo a mano.
// Il CSV, approvato dal titolare l'11/11/2026, è l'unica fonte della mappa CPV → settore; questo file ne è la copia tipizzata.

export type RigaCpvSettore = { codice: string; cpv: string; descrizione: string; settore: string };

export const CPV_SETTORI_OMNIA: readonly RigaCpvSettore[] = [
${corpo}
];
`;
fs.writeFileSync(path.join(radice, "src", "lib", "radar", "settori-dati.ts"), testo);
console.log(`settori-dati.ts rigenerato: ${righe.length} codici`);
