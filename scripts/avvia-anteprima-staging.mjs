// Avvio dell'anteprima di Tender Intelligence SOLO contro lo staging. Si usa dalla configurazione «tender-intelligence-staging» del pannello
// (o a mano: node scripts/avvia-anteprima-staging.mjs [porta]). Qualunque cartella sia la radice del pannello, il server parte da QUESTA
// cartella di lavoro (quella dello script), e solo dopo la guardia anti-produzione (scripts/lib/guardia-ambiente-staging.mjs): se l'ambiente
// effettivo contiene un segno della produzione, l'avvio FALLISCE e non parte nulla.
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { controllaAmbiente, verificaChiaviSulloStaging } from "./lib/guardia-ambiente-staging.mjs";

const cartella = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(cartella, "package.json"));
const { loadEnvConfig } = require("@next/env");
const porta = process.argv[2] ?? process.env.PORT ?? "3110";
if (!/^\d{4,5}$/.test(porta)) {
  console.error("GUARDIA: porta non valida");
  process.exit(1);
}

// Lo stesso caricamento di `next dev` (sviluppo): file d'ambiente della cartella, con le variabili del processo che li sovrascrivono.
const { combinedEnv, loadedEnvFiles } = loadEnvConfig(cartella, true, { info() {}, error() {} });
const fileCaricati = loadedEnvFiles.map((f) => path.basename(f.path));
const esito = controllaAmbiente({ env: combinedEnv, fileCaricati });
const problemi = [...esito.problemi, ...(esito.ok ? await verificaChiaviSulloStaging(combinedEnv) : [])];
if (problemi.length > 0) {
  console.error("GUARDIA ANTI-PRODUZIONE: avvio BLOCCATO.");
  for (const p of problemi) console.error(` - ${p}`);
  process.exit(1);
}
console.log(`Guardia anti-produzione superata: cartella ${cartella}, file d'ambiente ${fileCaricati.join(", ")}, database dello staging.`);

const figlio = spawn(process.execPath, [path.join(cartella, "node_modules", "next", "dist", "bin", "next"), "dev", "-p", porta], { cwd: cartella, stdio: "inherit", env: process.env });
for (const segnale of ["SIGINT", "SIGTERM"]) process.on(segnale, () => figlio.kill(segnale));
figlio.on("exit", (codice) => process.exit(codice ?? 0));
