// Prova dell'espansione mirata (src/lib/espansione-mirata.ts) con il modello
// VERO su bozze già generate e salvate in locale (di solito quelle di
// scripts/prova-ricchezza-visiva.ts).
//
//   npx tsx scripts/prova-espansione-reale.ts --gara <uuid> --file <bozza.md> [--file <altra.md> ...]
//
// SOLA LETTURA sul DB (legge solo i dati della gara per il budget); scrive solo
// file locali accanto alla bozza ("<nome>-espanso.md", cartella ignorata da
// git). Costa denaro vero: una chiamata per ogni sotto-criterio sotto l'80%
// del proprio tetto.
import fs from "fs";
import path from "path";
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createClient } = require("@supabase/supabase-js");
import { budgetSottoCriteriDiGara, type GaraContesto } from "../src/lib/gara-chat-prompt";
import { espandiSezioneSottoTetto, riepilogoEsitiEspansione } from "../src/lib/espansione-mirata";
import { assegnaIconeMancanti } from "../src/lib/densita-visiva";
import { descriviMisura, descriviProsa, misuraProsa, misuraVisiva } from "../src/lib/ricchezza-visiva";
import { stimaPagineContenuto } from "../src/lib/stima-pagine";

function argomenti(nome: string): string[] {
  const valori: string[] = [];
  process.argv.forEach((a, i) => {
    if (a === `--${nome}` && process.argv[i + 1]) valori.push(process.argv[i + 1]);
  });
  return valori;
}

async function main() {
  const garaId = argomenti("gara")[0];
  const files = argomenti("file");
  if (!garaId || files.length === 0) throw new Error("Servono --gara e almeno un --file");

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: g, error } = await admin
    .from("gare")
    .select("titolo, scadenza, importo, criteri_valutazione, requisiti, limiti_formattazione, limite_pagine_totale, punteggio_tecnico_max, criteri_riepilogo, relazione_dimensione_carattere, relazione_interlinea, sub_criteri_tabellari, sedi, personale_uscente")
    .eq("id", garaId)
    .single();
  if (error || !g) throw new Error(`Gara non trovata: ${error?.message}`);
  const gara = g as GaraContesto;
  const budget = budgetSottoCriteriDiGara(gara);
  if (!budget) throw new Error("La gara non ha un budget per sotto-criterio");
  const formattazione = { dimensioneCarattere: gara.relazione_dimensione_carattere ?? 12, interlinea: gara.relazione_interlinea ?? 1 };

  await Promise.all(
    files.map(async (file) => {
      const contenuto = fs.readFileSync(file, "utf-8");
      const t0 = Date.now();
      const esito = await espandiSezioneSottoTetto({
        titoloSezione: "Sezione di prova",
        contenuto,
        budget,
        criteriValutazione: gara.criteri_valutazione,
        punteggioTecnico: gara.punteggio_tecnico_max ?? undefined,
        formattazione,
        context: { userId: null, garaId },
      });
      const secondi = Math.round((Date.now() - t0) / 1000);
      const conIcone = assegnaIconeMancanti(esito.contenuto);
      fs.writeFileSync(file.replace(/\.md$/, "-espanso.md"), conIcone.testo);
      console.log(`\n${path.basename(file)} (${secondi}s)`);
      console.log(`  prima:  ${descriviMisura(misuraVisiva(contenuto))}, pagine ${stimaPagineContenuto(contenuto, formattazione).toFixed(2)}`);
      console.log(`  dopo:   ${descriviMisura(misuraVisiva(conIcone.testo))}, pagine ${stimaPagineContenuto(conIcone.testo, formattazione).toFixed(2)} (icone aggiunte dal codice: ${conIcone.aggiunte})`);
      console.log(`  prosa prima: ${descriviProsa(misuraProsa(contenuto), misuraVisiva(contenuto).parole)}`);
      console.log(`  prosa dopo:  ${descriviProsa(misuraProsa(conIcone.testo), misuraVisiva(conIcone.testo).parole)}`);
      for (const riga of riepilogoEsitiEspansione(esito.esiti)) console.log(`  ${riga}`);
    }),
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
