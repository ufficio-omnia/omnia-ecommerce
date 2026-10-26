// PROVA COL MODELLO VERO (a pagamento: qualche decina di centesimi per prova). NON fa parte della batteria automatica.
//
// Ricostruisce, per una gara reale, la situazione in cui un cliente ha fatto una certa richiesta in chat — stessa conversazione
// (gli ultimi 12 messaggi), stesse bozze salvate fino a quel momento, stesso prompt di sistema e stessi strumenti del codice vero
// (buildSystemPrompt, leggi_bozza_sezione, genera_bozza_sezione, la regola «leggi prima di riscrivere») — e fa rispondere il
// modello. Poi misura cosa conserva la nuova bozza rispetto alle precedenti (titoli, figure, tabelle, parole).
//
// Cosa NON fa: nessuna scrittura (niente file, niente righe nel database, niente costi registrati per il cliente), niente
// ricerca negli estratti dei documenti né nell'archivio di stile (il contesto è vuoto), niente passaggi di verifica dopo la
// generazione. Prova il comportamento del modello con il nuovo prompt e i nuovi strumenti, non la pipeline completa.
//
// Uso: npx tsx scripts/prova-memoria-chat-modello.ts <garaId> <numero del messaggio del cliente da rifare (1 = il primo)> [--salva]
//   --salva: scrive la bozza prodotta in un file di testo accanto allo script (cartella locale, non nel repository).
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import type Anthropic from "@anthropic-ai/sdk";
import { createAnthropicClient } from "../src/lib/anthropic";
import { calcolaCostoStimato } from "../src/lib/ai-pricing";
import { buildGeneraBozzaTool, buildSystemPrompt, LEGGI_BOZZA_TOOL, type CompanyContesto, type GaraContesto } from "../src/lib/gara-chat-prompt";
import {
  confrontaConBozzaBase,
  controllaLetturaPrimaDiGenerare,
  memoriaRichiesteCliente,
  leggiBozzeRichieste,
  raggruppaSezioni,
  testoConfrontoPerModello,
  testoElencoBozze,
  testoGenerazioneRifiutata,
  totaleUltimeVersioni,
  type SezioneSalvata,
} from "../src/lib/gara-bozze-contesto";

process.loadEnvFile(path.join(__dirname, "..", ".env.local"));

const MODEL = "claude-sonnet-5";
const MAX_HISTORY = 12;
const MAX_ROUNDS = 6;

async function main() {
  const [garaId, numeroMessaggio, ...opzioni] = process.argv.slice(2);
  if (!garaId || !numeroMessaggio) throw new Error("Uso: prova-memoria-chat-modello.ts <garaId> <numero messaggio> [--salva]");
  const salva = opzioni.includes("--salva");

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: gara } = await admin
    .from("gare")
    .select("user_id, titolo, scadenza, importo, criteri_valutazione, requisiti, limiti_formattazione, limite_pagine_totale, punteggio_tecnico_max, criteri_riepilogo, relazione_dimensione_carattere, relazione_interlinea, sub_criteri_tabellari, sedi, personale_uscente")
    .eq("id", garaId)
    .single();
  if (!gara) throw new Error("gara non trovata");
  const { data: company } = await admin
    .from("companies")
    .select("ragione_sociale, forma_giuridica, numero_dipendenti, fatturato_medio_annuo, certificazioni, referenze, settori_attivita, presentazione")
    .eq("user_id", gara.user_id)
    .maybeSingle();

  const { data: tuttiMessaggi } = await admin.from("gara_messaggi").select("ruolo, contenuto, created_at").eq("gara_id", garaId).order("created_at", { ascending: true });
  const idx = Number(numeroMessaggio) - 1;
  const richiesta = tuttiMessaggi?.[idx];
  if (!richiesta || richiesta.ruolo !== "utente") throw new Error(`il messaggio ${numeroMessaggio} non esiste o non è del cliente`);
  const precedenti = (tuttiMessaggi ?? []).slice(0, idx);
  const storico = precedenti.slice(-MAX_HISTORY);
  const memoria = memoriaRichiesteCliente(precedenti, MAX_HISTORY);

  // le bozze come erano nel momento della richiesta
  const { data: sezioniTutte } = await admin.from("gara_relazione_sezioni").select("ordine, titolo_sezione, contenuto, created_at").eq("gara_id", garaId).order("ordine");
  const sezioni = ((sezioniTutte ?? []) as SezioneSalvata[]).filter((s) => s.created_at < richiesta.created_at);
  const seguenti = ((sezioniTutte ?? []) as SezioneSalvata[]).filter((s) => s.created_at >= richiesta.created_at);
  const gruppi = raggruppaSezioni(sezioni);

  console.log(`Gara «${String(gara.titolo).slice(0, 40)}» — richiesta del cliente #${numeroMessaggio} (${richiesta.contenuto.length} caratteri)`);
  console.log(`Situazione di partenza: ${sezioni.length} bozze salvate in ${gruppi.length} criteri; conversazione vista: ${storico.length} messaggi; promemoria richieste: ${memoria ? memoria.split("\n").length + " righe" : "vuoto"}`);

  const garaCtx = gara as unknown as GaraContesto;
  const totale = totaleUltimeVersioni(gruppi);
  const elenco = testoElencoBozze(gruppi);
  const sistema = buildSystemPrompt(
    garaCtx,
    (company ?? null) as CompanyContesto,
    "",
    "",
    "",
    "",
    elenco ? `${elenco}\n\nTotale stimato già scritto per questa gara (l'ultima versione di ogni criterio, contata una volta sola): ~${totale.pagine} pagine.` : "",
    null,
    memoria,
  );

  const anthropic = createAnthropicClient();
  const messaggi: Anthropic.MessageParam[] = [
    ...storico.map((m) => ({ role: m.ruolo === "utente" ? ("user" as const) : ("assistant" as const), content: m.contenuto })),
    { role: "user" as const, content: richiesta.contenuto },
  ];
  let strumenti: Anthropic.Tool[] = [LEGGI_BOZZA_TOOL, buildGeneraBozzaTool(garaCtx)];

  const bozzeLette = new Map<number, SezioneSalvata>();
  const sequenza: string[] = [];
  let rifiuti = 0;
  let contenutoGenerato: string | null = null;
  let titoloGenerato = "";
  let baseUsata: SezioneSalvata | undefined;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreazione = 0;
  let cacheLettura = 0;
  let rispostaFinale = "";

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      system: [{ type: "text", text: sistema, cache_control: { type: "ephemeral" } }],
      tools: strumenti,
      messages: messaggi,
    });
    const risposta = await stream.finalMessage();
    inputTokens += risposta.usage.input_tokens;
    outputTokens += risposta.usage.output_tokens;
    cacheCreazione += risposta.usage.cache_creation_input_tokens ?? 0;
    cacheLettura += risposta.usage.cache_read_input_tokens ?? 0;
    const testo = risposta.content.map((b) => (b.type === "text" ? b.text : "")).join("\n").trim();
    if (testo) rispostaFinale = rispostaFinale ? `${rispostaFinale}\n${testo}` : testo;

    const usi = risposta.content.filter((b) => b.type === "tool_use");
    if (risposta.stop_reason !== "tool_use" || usi.length === 0) break;

    messaggi.push({ role: "assistant", content: risposta.content });
    const risultati: Anthropic.ToolResultBlockParam[] = [];
    const lettureDelPassaggio: SezioneSalvata[] = [];
    for (const uso of usi) {
      if (uso.type !== "tool_use") continue;
      if (uso.name === "leggi_bozza_sezione") {
        // come nel codice vero: fino a 4 bozze in una chiamata
        const lettura = leggiBozzeRichieste((uso.input as { ordini?: unknown; ordine?: unknown } | null) ?? {}, sezioni);
        sequenza.push(`leggi(${lettura.trovate.map((s) => s.ordine).join("+") || "nessuna"}${lettura.inesistenti.length ? ` [inesistenti: ${lettura.inesistenti.join(",")}]` : ""})`);
        for (const s of lettura.trovate) lettureDelPassaggio.push(s);
        risultati.push({ type: "tool_result", tool_use_id: uso.id, content: lettura.testo, ...(lettura.trovate.length === 0 ? { is_error: true } : {}) });
        continue;
      }
      if (uso.name === "genera_bozza_sezione") {
        const input = uso.input as { titolo_sezione?: string; contenuto?: string };
        const controllo = controllaLetturaPrimaDiGenerare(input.titolo_sezione ?? "", gruppi, new Set(bozzeLette.keys()));
        if (!controllo.ok) {
          rifiuti++;
          sequenza.push(`genera(«${(input.titolo_sezione ?? "").slice(0, 25)}») RIFIUTATA`);
          risultati.push({ type: "tool_result", tool_use_id: uso.id, is_error: true, content: testoGenerazioneRifiutata(controllo) });
          continue;
        }
        sequenza.push(`genera(«${(input.titolo_sezione ?? "").slice(0, 25)}»)`);
        contenutoGenerato = input.contenuto ?? "";
        titoloGenerato = input.titolo_sezione ?? "";
        baseUsata = controllo.ordineBase !== null ? bozzeLette.get(controllo.ordineBase) : undefined;
        const confronto = baseUsata ? testoConfrontoPerModello(confrontaConBozzaBase(baseUsata.contenuto, contenutoGenerato), baseUsata.ordine) : "";
        risultati.push({ type: "tool_result", tool_use_id: uso.id, content: `${confronto}Bozza generata con successo (prova: nessun file creato). Il cliente la vede come allegato. Scrivi solo 1-2 frasi su cosa contiene.` });
        strumenti = [];
        continue;
      }
    }
    for (const l of lettureDelPassaggio) bozzeLette.set(l.ordine, l);
    messaggi.push({ role: "user", content: risultati });
  }

  // Come nel codice vero: se il ciclo finisce con i risultati degli strumenti e senza una risposta del modello (passaggi esauriti),
  // una chiusura senza strumenti scrive la risposta al cliente.
  let chiusura = false;
  if (messaggi[messaggi.length - 1]?.role === "user" && Array.isArray(messaggi[messaggi.length - 1].content)) {
    chiusura = true;
    const c = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 3000,
      system: [{ type: "text", text: sistema, cache_control: { type: "ephemeral" } }],
      tool_choice: { type: "none" },
      messages: messaggi,
    });
    inputTokens += c.usage.input_tokens;
    outputTokens += c.usage.output_tokens;
    cacheCreazione += c.usage.cache_creation_input_tokens ?? 0;
    cacheLettura += c.usage.cache_read_input_tokens ?? 0;
    const testoChiusura = c.content.map((b) => (b.type === "text" ? b.text : "")).join("\n").trim();
    rispostaFinale = rispostaFinale.trim() && testoChiusura ? `${rispostaFinale}\n${testoChiusura}` : testoChiusura || rispostaFinale;
  }

  const costo = calcolaCostoStimato(MODEL, inputTokens, outputTokens,{ creazione: cacheCreazione, lettura: cacheLettura });
  console.log(`\nSequenza degli strumenti: ${sequenza.join(" → ") || "(nessuno)"}`);
  console.log(`Generazioni rifiutate perché la bozza non era stata letta: ${rifiuti}`);
  if (chiusura) console.log("(il ciclo è finito con strumenti da chiudere: risposta scritta dalla chiusura finale)");
  console.log(`Token: ${inputTokens} in (+ ${cacheCreazione} scritti in cache, ${cacheLettura} letti dalla cache) / ${outputTokens} out — costo stimato USD ${costo === null ? "?" : costo.toFixed(2)}`);

  if (contenutoGenerato === null) {
    console.log("\nIl modello NON ha generato nessuna bozza. Risposta:\n" + rispostaFinale.slice(0, 800));
    return;
  }

  const parole = contenutoGenerato.split(/\s+/).filter(Boolean).length;
  console.log(`\nNuova bozza «${titoloGenerato.slice(0, 60)}»: ${parole} parole`);
  if (baseUsata) {
    const c = confrontaConBozzaBase(baseUsata.contenuto, contenutoGenerato);
    console.log(`Rispetto alla bozza di partenza [ordine ${baseUsata.ordine}] (${c.parole.prima} parole): mancano ${c.titoliMancanti.length} titoli, figure ${c.figure.prima}→${c.figure.dopo}, organigramma ${c.organigrammi.prima}→${c.organigrammi.dopo}, tabelle ${c.tabelle.prima}→${c.tabelle.dopo}, parole conservate ${Math.round(c.paroleConservate * 100)}%`);
    for (const t of c.titoliMancanti.slice(0, 8)) console.log(`   ✗ ${t.slice(0, 90)}`);
  } else {
    console.log("(nessuna bozza di partenza letta per questo criterio)");
  }
  // le altre versioni dello stesso criterio: quanto delle versioni precedenti è presente
  const chiave = gruppi.find((g) => g.versioni.some((v) => v.titolo.split(" ")[0] === titoloGenerato.split(" ")[0]))?.chiave;
  const gruppo = gruppi.find((g) => g.chiave === chiave);
  if (gruppo) {
    console.log("\nQuanti titoli delle versioni precedenti di questo criterio sono presenti nella nuova bozza:");
    for (const v of gruppo.versioni.slice(0, 8)) {
      const s = sezioni.find((x) => x.ordine === v.ordine)!;
      const c = confrontaConBozzaBase(s.contenuto, contenutoGenerato);
      const titoliPrima = (s.contenuto.match(/^#{2,3}\s+.+$/gm) ?? []).length;
      console.log(`  versione ${String(v.ordine).padStart(2)} (${titoliPrima} titoli, ${c.parole.prima} parole): presenti ${titoliPrima - c.titoliMancanti.length}/${titoliPrima}, parole conservate ${Math.round(c.paroleConservate * 100)}%`);
    }
  }
  if (seguenti.length > 0) {
    const realeSuccessiva = seguenti.find((s) => s.titolo_sezione.split(" ")[0] === titoloGenerato.split(" ")[0]);
    if (realeSuccessiva && baseUsata) {
      const c = confrontaConBozzaBase(baseUsata.contenuto, realeSuccessiva.contenuto);
      console.log(`\nPer confronto, cosa fece il sistema VECCHIO (bozza salvata [ordine ${realeSuccessiva.ordine}], ${c.parole.dopo} parole) rispetto alla stessa partenza: mancano ${c.titoliMancanti.length} titoli, parole conservate ${Math.round(c.paroleConservate * 100)}%`);
    }
  }
  console.log("\nRisposta del modello al cliente:\n" + rispostaFinale.slice(0, 700));
  if (salva) {
    const file = path.join(__dirname, "..", `prova-memoria-bozza-${Date.now()}.txt`);
    fs.writeFileSync(file, contenutoGenerato);
    console.log(`\nBozza salvata in ${file} (cartella locale: NON aggiungerla al repository)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
