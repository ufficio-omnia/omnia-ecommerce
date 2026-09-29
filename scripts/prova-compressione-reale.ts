// Prova REALE (una chiamata vera, non gratuita) della compressione mirata
// su UN SOLO sotto-criterio — non l'intera gara: il costo di una prova
// resta quello di un sotto-criterio, non quello di una generazione
// completa. Usa il testo ANONIMIZZATO di test/fixtures/compressione-
// riferimento.json (nessun dato reale di cliente in questa prova).
//
// Uso:
//   npx tsx scripts/prova-compressione-reale.ts --sotto-criterio=1.1
//   npx tsx scripts/prova-compressione-reale.ts --sotto-criterio=1.1 --leggero
//   npx tsx scripts/prova-compressione-reale.ts --sotto-criterio=1.1 --registra
//   npx tsx scripts/prova-compressione-reale.ts --sotto-criterio=1.1 --replay
//
// --leggero: usa il modello leggero (src/lib/anthropic.ts) — SOLO per
//   verificare che il meccanismo (accetta/rifiuta/ripristina) funzioni, MAI
//   per giudicare la qualità del testo prodotto.
// --registra (default se non esiste ancora una cassetta per questo
//   sotto-criterio): chiama il modello davvero e salva la richiesta/
//   risposta in test/diagnostica/prove-compressione/<chiave>/cassetta.json
//   (non committata: contenuto reale di una chiamata, anche se il testo di
//   partenza è anonimizzato).
// --replay: nessuna chiamata, rilegge la cassetta salvata in precedenza —
//   usalo per riprovare la logica di accettazione/ripristino quante volte
//   serve a costo zero dopo una prima registrazione.
//
// Il costo (se --registra) viene loggato in ai_operazioni con user_id null,
// gara_id null (non è una gara reale, è testo anonimizzato) e operazione
// prefissata "prova:"/"prova-leggero:" da operazionePerRegistro.
import fs from "fs";
import path from "path";
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const args = process.argv.slice(2);
const chiaveArg = args.find((a) => a.startsWith("--sotto-criterio="))?.split("=")[1];
const leggero = args.includes("--leggero");
const replay = args.includes("--replay");

if (!chiaveArg) {
  console.error("Uso: npx tsx scripts/prova-compressione-reale.ts --sotto-criterio=1.1 [--leggero] [--registra|--replay]");
  process.exit(1);
}
const chiave: string = chiaveArg;

// Va impostata PRIMA di importare src/lib/anthropic (o comunque prima della
// prima chiamata: modelloAttivo() legge process.env a ogni chiamata, ma è
// più chiaro impostarle qui, in cima).
process.env.OMNIA_AI_SCRIPT_PROVE = "1";
if (leggero) process.env.OMNIA_AI_MODELLO_PROVA = "leggero";

import { dividiInBlocchi, unisciBlocchi, type Sezione } from "../src/lib/budget-blocchi";
import { comprimiBloccoConGaranzie, comprimiConModello } from "../src/lib/compressione-mirata";
import { modelloAttivo } from "../src/lib/anthropic";
import { calcolaBudgetSottoCriteri, trovaBudgetSottoCriterio } from "../src/lib/sotto-criteri";
import { estraiRequisitiDaCriteri } from "../src/lib/confronto-tagli";
import { registraCompressione, riproduciCompressione, cassettaEsiste } from "./lib/registrazione-anthropic";

const FIXTURE_PATH = path.join(__dirname, "..", "test", "fixtures", "compressione-riferimento.json");
const CARTELLA_CASSETTA = path.join(__dirname, "..", "test", "diagnostica", "prove-compressione", chiave);

type Fixture = {
  gara: {
    criteri_valutazione: string;
    criteri_riepilogo: { numero: string; titolo: string; punti_max: number }[];
    sub_criteri_tabellari: string[];
    limite_pagine_totale: number;
    punteggio_tecnico_max: number;
  };
  formattazione: { dimensioneCarattere?: number; interlinea?: number };
  verificate: Sezione[];
};

async function main() {
  const fixture: Fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf-8"));
  const { gara, formattazione, verificate } = fixture;

  const sezione = verificate.find((s) => dividiInBlocchi(s.contenuto).some((b) => b.chiave?.toLowerCase() === chiave.toLowerCase()));
  if (!sezione) {
    console.error(`Sotto-criterio "${chiave}" non trovato nel riferimento.`);
    process.exit(1);
  }
  const blocco = dividiInBlocchi(sezione.contenuto).find((b) => b.chiave?.toLowerCase() === chiave.toLowerCase())!;

  const budgetGara = calcolaBudgetSottoCriteri({
    criteriValutazione: gara.criteri_valutazione,
    criteriRiepilogo: gara.criteri_riepilogo,
    punteggioTecnicoMax: gara.punteggio_tecnico_max,
    limitePagineTotale: gara.limite_pagine_totale,
    subCriteriTabellari: gara.sub_criteri_tabellari,
    formattazione,
  });
  const sotto = trovaBudgetSottoCriterio(budgetGara, chiave);
  if (!sotto) {
    console.error(`Nessun budget calcolabile per "${chiave}".`);
    process.exit(1);
  }
  if (sotto.tabellare) {
    console.error(`"${chiave}" è tabellare: non richiede compressione.`);
    process.exit(1);
  }
  const requisito = estraiRequisitiDaCriteri(gara.criteri_valutazione).find((r) => r.chiave.toLowerCase() === chiave.toLowerCase());

  const usaCassetta = replay || (!args.includes("--registra") && cassettaEsiste(CARTELLA_CASSETTA));
  const modalita = usaCassetta ? "REPLAY (nessuna chiamata)" : "REGISTRAZIONE (chiamata reale)";
  console.log(`Sotto-criterio ${chiave} "${sotto.titolo}" (${sotto.punti} punti) — modalità: ${modalita} — modello: ${usaCassetta ? "n/d" : modelloAttivo()}${leggero ? " (LEGGERO — solo prova di meccanismo)" : ""}`);
  console.log(`Tetto: ${sotto.paginePreviste.toFixed(2)} pagine (${sotto.parolePreviste} parole).`);

  const comprimi = usaCassetta ? riproduciCompressione(CARTELLA_CASSETTA) : registraCompressione(CARTELLA_CASSETTA, comprimiConModello);

  const esito = await comprimiBloccoConGaranzie({
    chiave,
    titoloBlocco: sezione.titolo_sezione,
    bloccoOriginale: blocco.testo,
    bloccoAttuale: blocco.testo,
    pagineTarget: sotto.paginePreviste,
    sotto: { titolo: sotto.titolo, requisito: sotto.requisito, punti: sotto.punti },
    punteggioTecnico: gara.punteggio_tecnico_max,
    requisito,
    paroleTetto: sotto.parolePreviste,
    paroleXPagina: budgetGara!.paroleProsaPerPagina,
    formattazione,
    context: { userId: null, garaId: null },
    comprimi,
  });

  console.log(`\nEsito: ${esito.esito} (${esito.tentativi} tentativo/i) — ${esito.paginePrima.toFixed(2)} → ${esito.pagineDopo.toFixed(2)} pagine`);
  if (esito.ripristino && esito.ripristino !== "nulla da ripristinare") console.log(`Ripristino: ${esito.ripristino}`);
  if (esito.motivo) console.log(`Motivo del rifiuto: ${esito.motivo}`);
  if (esito.avvisi.length) console.log(`Avvisi: ${esito.avvisi.join(" | ")}`);
  console.log(`\n--- Testo risultante ---\n${unisciBlocchi([{ chiave, testo: esito.testo }])}`);

  if (!usaCassetta) console.log(`\nRegistrazione salvata in: ${CARTELLA_CASSETTA} (non committata — riusala con --replay).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
