// Controllo di non regressione — LIVELLO 1 (gratuito, automatico).
//
// Ricostruisce il documento Word dal testo GIA' generato in
// test/fixtures/relazione-riferimento.json (anonimizzato da una prova
// reale su Aosta — vedi verifica-livello2.ts, che lo produce) usando SOLO
// il renderer (buildDocxBuffer): nessuna chiamata a un modello, nessuna
// rete, nessun DB. I controlli veri e propri vivono in
// scripts/lib/controlli-relazione.ts, condivisi con il livello 2: un
// fixture promosso dal livello 2 senza essere già passato per questi
// stessi controlli non avrebbe senso come riferimento.
//
// Gira in prebuild (vedi package.json): un fallimento qui blocca "npm run
// build" e quindi la pubblicazione, perché una modifica che rompe il
// renderer non deve poter arrivare in produzione senza che nessuno se ne
// accorga.
import fs from "fs";
import path from "path";
import { eseguiControlliStrutturali, type FixtureRelazione } from "./lib/controlli-relazione";

const FIXTURE_PATH = path.join(__dirname, "..", "test", "fixtures", "relazione-riferimento.json");

async function main() {
  const fixture: FixtureRelazione = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf-8"));
  const { errori, riepilogo } = await eseguiControlliStrutturali(fixture);

  console.log(`Controllo di livello 1: ${riepilogo}`);

  if (errori.length > 0) {
    console.error(`\nFALLITO — ${errori.length} problema/i:`);
    for (const e of errori) console.error(` - ${e}`);
    process.exit(1);
  }

  console.log("OK — tutte le verifiche superate.");
}

main().catch((err) => {
  console.error("Errore inatteso nel controllo di livello 1:", err);
  process.exit(1);
});
