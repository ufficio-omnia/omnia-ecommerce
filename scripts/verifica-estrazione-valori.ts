// Autotest dei valori dell'analisi resi compatibili con le colonne di `gare` (src/lib/estrazione-valori.ts).
//
// Caso reale da cui nasce (19/11/2026, gara Bonocunto): il modello ha mandato "" come limite_pagine_totale, il database l'ha
// rifiutato (22P02) e tutta l'analisi è finita in «Errore analisi». Qui si prova che nessun valore del tipo sbagliato arriva più
// al database e che il salvataggio dell'analisi passa davvero da questi filtri.
// Gratuito, nessun database né rete: gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import {
  cigOpzionale,
  elencoOggettiOpzionale,
  elencoTestiOpzionale,
  interoOpzionale,
  numeroOpzionale,
  testoOpzionale,
} from "../src/lib/estrazione-valori";

const fallimenti: string[] = [];
function uguale<T>(nome: string, ottenuto: T, previsto: T) {
  const ok = JSON.stringify(ottenuto) === JSON.stringify(previsto);
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ottenuto ${JSON.stringify(ottenuto)}, previsto ${JSON.stringify(previsto)}`}`);
  if (!ok) fallimenti.push(nome);
}

console.log("--- Interi (limite_pagine_totale) ---");
uguale("caso reale: testo vuoto → null", interoOpzionale(""), null);
uguale("numero intero resta", interoOpzionale(40), 40);
uguale("intero scritto come testo", interoOpzionale("40"), 40);
uguale("con la virgola non si arrotonda: null", interoOpzionale(40.5), null);
uguale("parole → null", interoOpzionale("non indicato"), null);
uguale("negativo → null", interoOpzionale(-3), null);
uguale("null/undefined → null", [interoOpzionale(null), interoOpzionale(undefined)], [null, null]);

console.log("--- Numeri (importo, punteggi, carattere, interlinea) ---");
uguale("numero resta", numeroOpzionale(52586.16), 52586.16);
uguale("testo vuoto → null", numeroOpzionale(""), null);
uguale("solo spazi → null", numeroOpzionale("   "), null);
uguale("virgola decimale", numeroOpzionale("1,5"), 1.5);
uguale("migliaia all'italiana con euro", numeroOpzionale("€ 52.586,16"), 52586.16);
uguale("«1.250» è ambiguo (1,25 o 1250): null, non si indovina", numeroOpzionale("1.250"), null);
uguale("migliaia con decimali non è ambiguo", numeroOpzionale("1.250,00"), 1250);
uguale("punto decimale", numeroOpzionale("1.5"), 1.5);
uguale("testo misto → null", numeroOpzionale("circa 50 mila"), null);
uguale("NaN e infinito → null", [numeroOpzionale(NaN), numeroOpzionale(Infinity)], [null, null]);
uguale("booleano → null", numeroOpzionale(true), null);

console.log("--- Testi ---");
uguale("testo con spazi ai bordi", testoOpzionale("  Comune di X "), "Comune di X");
uguale("testo vuoto → null", testoOpzionale(""), null);
uguale("numero → testo", testoOpzionale(12), "12");
uguale("oggetto → null", testoOpzionale({ a: 1 }), null);
uguale("CIG con spazi e minuscole", cigOpzionale(" bd71e0 be56 "), "BD71E0BE56");
uguale("CIG numerico non fa più fallire .replace", cigOpzionale(1234567890), "1234567890");
uguale("CIG vuoto → null", cigOpzionale(""), null);

console.log("--- Elenchi ---");
uguale("elenco di testi resta", elencoTestiOpzionale(["2.2", "4.1"]), ["2.2", "4.1"]);
uguale("elenco mandato come testo JSON", elencoTestiOpzionale('["2.2","4.1"]'), ["2.2", "4.1"]);
uguale("testo vuoto → null (text[] non riceve più \"\")", elencoTestiOpzionale(""), null);
uguale("testo libero non JSON → null (sotto-criteri scritti per esteso)", elencoTestiOpzionale("2.2, 4.1"), null);
uguale("voci vuote e non testo tolte", elencoTestiOpzionale(["a", "", null, 3]), ["a", "3"]);
uguale("elenco vuoto → null", elencoTestiOpzionale([]), null);
uguale("oggetti restano", elencoOggettiOpzionale([{ denominazione: "Palazzo" }]), [{ denominazione: "Palazzo" }]);
uguale("voci non oggetto tolte", elencoOggettiOpzionale([{ a: 1 }, "x", [1], null]), [{ a: 1 }]);
uguale("oggetti come testo JSON", elencoOggettiOpzionale('[{"numero":"A","punti_max":25}]'), [{ numero: "A", punti_max: 25 }]);
uguale("testo vuoto → null", elencoOggettiOpzionale(""), null);

console.log("--- Il salvataggio dell'analisi passa da qui ---");
const sorgente = fs.readFileSync(path.join(__dirname, "..", "src/app/actions/gara-extraction.ts"), "utf-8");
const blocco = sorgente.slice(sorgente.indexOf("const { error: updateError }"), sorgente.indexOf("if (updateError)"));
uguale("blocco del salvataggio trovato", blocco.length > 0, true);
const grezzi = [...blocco.matchAll(/:\s*result\.\w+/g)].map((m) => m[0]);
uguale("nessun campo salvato direttamente da result.* senza filtro", grezzi, []);
uguale("niente più `?? null` sui valori del modello", /result\.\w+\s*\?\?/.test(blocco), false);

console.log("");
if (fallimenti.length > 0) {
  console.error(`${fallimenti.length} controlli falliti:\n - ${fallimenti.join("\n - ")}`);
  process.exit(1);
}
console.log("Tutti i controlli sono andati a buon fine.");
