// Prova controllata della RICCHEZZA VISIVA e della lunghezza di UN criterio,
// con il modello vero e il prompt di produzione.
//
//   npx tsx scripts/prova-ricchezza-visiva.ts --gara <uuid> --criterio 3 --braccio attuale --n 3
//
// Bracci (stesso input, cambia una cosa sola):
//   attuale        il prompt così com'è nel codice;
//   senza-regole   come "attuale", ma senza le REGOLE_OMNIA (ablazione);
//   senza-tetti    come "attuale", ma senza alcun budget di pagine (ablazione).
// Il confronto "prima/dopo" di una modifica al prompt si fa lanciando lo
// stesso braccio "attuale" prima e dopo la modifica, con --etichetta diversa.
// Con --modulo-prompt <file.ts> si prova un'altra versione del prompt: il
// modulo deve esportare buildSystemPrompt e buildGeneraBozzaTool con le firme
// di src/lib/gara-chat-prompt.ts (utile per rigiocare il prompt di una data
// passata, estratto da git).
// Con --messaggio "<testo>" si usa quel testo come richiesta del cliente (e per
// la ricerca dei documenti), con --storico <file.json> una conversazione
// precedente [{ruolo:"utente"|"assistente", contenuto}] come in chat vera.
// Come in produzione (gara-chat.ts) lo strumento di generazione NON è forzato:
// il modello ragiona (thinking adattivo) e sceglie da solo, con la ricerca web
// disponibile. Forzare lo strumento disattiva di fatto il ragionamento e
// produce testi diversi da quelli veri: --forza-strumento lo riattiva solo
// per confronto.
//
// SOLA LETTURA sul DB: legge la gara (documenti, profilo) e scrive solo file
// locali in test/diagnostica/ricchezza-visiva/ (cartella ignorata da git).
// Le chiamate al modello vengono registrate con user_id nullo, come i livelli 2.
// Costa denaro vero: una generazione per ogni --n.
import fs from "fs";
import path from "path";
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createClient } = require("@supabase/supabase-js");
import { buildSystemPrompt, buildGeneraBozzaTool, budgetSottoCriteriDiGara, type GaraContesto, type CompanyContesto } from "../src/lib/gara-chat-prompt";
import { REGOLE_OMNIA } from "../src/lib/prompts";
import { trovaBudgetSottoCriterio } from "../src/lib/sotto-criteri";
import { stimaPagineContenuto } from "../src/lib/stima-pagine";
import { descriviMisura, misuraPerBlocco, misuraVisiva } from "../src/lib/ricchezza-visiva";
import { embedQuery } from "../src/lib/voyage";
import { createAnthropicClient } from "../src/lib/anthropic";
import { logAiUsage } from "../src/lib/ai-usage";

function arg(nome: string, predefinito?: string): string {
  const i = process.argv.indexOf(`--${nome}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (predefinito !== undefined) return predefinito;
  throw new Error(`Manca --${nome}`);
}

const cosine = (a: number[], b: number[]) => {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / (Math.sqrt(na) * Math.sqrt(nb));
};

async function main() {
  const garaId = arg("gara");
  const numeroCriterio = arg("criterio");
  const braccio = arg("braccio", "attuale");
  const n = Number(arg("n", "3"));
  const etichetta = arg("etichetta", braccio);
  const forzaStrumento = process.argv.includes("--forza-strumento");
  if (!["attuale", "senza-regole", "senza-tetti"].includes(braccio)) throw new Error(`Braccio sconosciuto: ${braccio}`);

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const anthropic = createAnthropicClient();

  const { data: g, error } = await admin
    .from("gare")
    .select("titolo, scadenza, importo, criteri_valutazione, requisiti, limiti_formattazione, limite_pagine_totale, punteggio_tecnico_max, criteri_riepilogo, relazione_dimensione_carattere, relazione_interlinea, sub_criteri_tabellari, sedi, personale_uscente, user_id")
    .eq("id", garaId)
    .single();
  if (error || !g) throw new Error(`Gara non trovata: ${error?.message}`);
  const gara = { ...(g as GaraContesto & { user_id: string }) };
  if (braccio === "senza-tetti") gara.limite_pagine_totale = null;
  const { data: company } = await admin
    .from("companies")
    .select("ragione_sociale, forma_giuridica, numero_dipendenti, fatturato_medio_annuo, certificazioni, referenze, settori_attivita, presentazione")
    .eq("user_id", gara.user_id)
    .maybeSingle();
  const companyContesto = (company ?? null) as CompanyContesto;

  const criterio = (gara.criteri_riepilogo ?? []).find((c) => c.numero.trim() === numeroCriterio);
  if (!criterio) throw new Error(`Criterio ${numeroCriterio} non trovato nel riepilogo della gara`);
  const messaggio = process.argv.includes("--messaggio") ? arg("messaggio") : `Sviluppa il criterio ${criterio.numero}. ${criterio.titolo}`;
  const storico = process.argv.includes("--storico")
    ? (JSON.parse(fs.readFileSync(arg("storico"), "utf-8")) as { ruolo: string; contenuto: string }[]).map((m) => ({ role: m.ruolo === "utente" ? ("user" as const) : ("assistant" as const), content: m.contenuto }))
    : [];

  // Stessa ricerca di produzione (gara-chat.ts): estratti della gara, esempi
  // e stile dalla knowledge base.
  const q = await embedQuery(messaggio, { userId: null, garaId, operazione: "chat_gara_ricerca" });
  const [{ data: chunksRaw }, { data: kbRaw }, { data: stileRaw }] = await Promise.all([
    admin.rpc("match_gara_chunks", { query_embedding: q, target_gara_id: garaId, match_count: 8 }),
    admin.rpc("match_knowledge_base_chunks", { query_embedding: q, match_count: 6 }),
    admin.rpc("match_knowledge_base_stile", { query_embedding: q, match_count: 6 }),
  ]);
  let chunks = (chunksRaw ?? []) as { contenuto: string }[];
  if (chunks.length === 0) {
    const { data: tutti } = await admin.from("gara_documenti_chunks").select("contenuto, embedding").eq("gara_id", garaId);
    chunks = (tutti ?? [])
      .map((c: { contenuto: string; embedding: string }) => ({ c: c.contenuto, s: cosine(q, JSON.parse(c.embedding)) }))
      .sort((a: { s: number }, b: { s: number }) => b.s - a.s)
      .slice(0, 8)
      .map((x: { c: string }) => ({ contenuto: x.c }));
  }
  const contestoDocumenti = chunks.map((c, i) => `[Estratto ${i + 1}]\n${c.contenuto}`).join("\n\n");
  const contestoKb = ((kbRaw ?? []) as { contenuto: string }[]).map((c, i) => `[Esempio ${i + 1}]\n${c.contenuto}`).join("\n\n");
  const stile = (stileRaw ?? []) as { nota_stile: string | null; struttura_titoli: string | null }[];
  const nota = stile.filter((d) => d.nota_stile).map((d, i) => `[Progetto ${i + 1}]\n${d.nota_stile}`).join("\n\n");
  const strutture = stile.filter((d) => d.struttura_titoli).map((d, i) => `[Struttura progetto ${i + 1}]\n${d.struttura_titoli}`).join("\n\n");

  const moduloAlt = process.argv.includes("--modulo-prompt")
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ? (require(path.resolve(arg("modulo-prompt"))) as { buildSystemPrompt: typeof buildSystemPrompt; buildGeneraBozzaTool: typeof buildGeneraBozzaTool })
    : null;
  const costruisciSistema = moduloAlt?.buildSystemPrompt ?? buildSystemPrompt;
  const costruisciStrumento = moduloAlt?.buildGeneraBozzaTool ?? buildGeneraBozzaTool;
  let systemPrompt = costruisciSistema(gara, companyContesto, contestoDocumenti, contestoKb, nota, strutture, "");
  if (braccio === "senza-regole") systemPrompt = systemPrompt.replace(REGOLE_OMNIA, "(nessuna regola di scrittura aggiuntiva)");
  const strumento = costruisciStrumento(gara);

  const formattazione = {
    dimensioneCarattere: gara.relazione_dimensione_carattere ?? undefined,
    interlinea: gara.relazione_interlinea ?? undefined,
  };
  // Il budget si valuta SEMPRE con i dati veri della gara, anche nel braccio
  // senza-tetti: serve a misurare quanto il testo li rispetta.
  const budgetReale = budgetSottoCriteriDiGara({ ...gara, limite_pagine_totale: (g as GaraContesto).limite_pagine_totale });

  const cartella = path.join(__dirname, "..", "test", "diagnostica", "ricchezza-visiva");
  fs.mkdirSync(cartella, { recursive: true });

  console.log(`Braccio "${etichetta}" (${braccio}) — criterio ${criterio.numero}, ${n} generazioni in parallelo`);

  const risultati = await Promise.all(
    Array.from({ length: n }, async (_, i) => {
      const t0 = Date.now();
      const stream = anthropic.messages.stream({
        model: "claude-sonnet-5",
        max_tokens: 64000,
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
        system: systemPrompt,
        tools: forzaStrumento ? [strumento] : [{ type: "web_search_20250305" as const, name: "web_search" as const, max_uses: 3 }, strumento],
        ...(forzaStrumento ? { tool_choice: { type: "tool" as const, name: "genera_bozza_sezione" } } : {}),
        messages: [...storico, { role: "user" as const, content: messaggio }],
      });
      const resp = await stream.finalMessage();
      await logAiUsage({ userId: null, garaId, operazione: "chat_gara", provider: "anthropic", model: "claude-sonnet-5", inputTokens: resp.usage.input_tokens, outputTokens: resp.usage.output_tokens });
      const tu = resp.content.find((b) => b.type === "tool_use" && b.name === "genera_bozza_sezione");
      const caratteriRagionamento = resp.content.reduce((tot, b) => tot + (b.type === "thinking" ? b.thinking.length : 0), 0);
      const ricerche = resp.content.filter((b) => b.type === "server_tool_use").length;
      const contenuto = (tu as { input: { contenuto?: string } } | undefined)?.input?.contenuto ?? "";
      const file = path.join(cartella, `${etichetta}-${i + 1}.md`);
      fs.writeFileSync(file, contenuto);
      fs.writeFileSync(file.replace(/\.md$/, ".input.json"), JSON.stringify((tu as { input?: unknown } | undefined)?.input ?? {}, null, 2));
      const secondi = Math.round((Date.now() - t0) / 1000);
      return { i: i + 1, contenuto, secondi, stop: resp.stop_reason, costoToken: `${resp.usage.input_tokens} in / ${resp.usage.output_tokens} out, ragionamento ${caratteriRagionamento} car., ricerche web ${ricerche}${tu ? "" : ", NESSUNA BOZZA GENERATA"}` };
    }),
  );

  const righe: Record<string, unknown>[] = [];
  for (const r of risultati.sort((a, b) => a.i - b.i)) {
    const m = misuraVisiva(r.contenuto);
    const pagine = stimaPagineContenuto(r.contenuto, formattazione);
    console.log(`\n#${r.i} (${r.secondi}s, ${r.costoToken}, stop=${r.stop}) — ${descriviMisura(m)}, pagine stimate ${pagine.toFixed(2)}`);
    const sforati: string[] = [];
    for (const b of misuraPerBlocco(r.contenuto)) {
      if (!b.chiave) continue;
      const bud = trovaBudgetSottoCriterio(budgetReale, b.chiave);
      const tetto = bud ? `tetto ${bud.parolePreviste}p${bud.tabellare ? " (tabellare)" : ""}` : "senza tetto";
      if (bud && !bud.tabellare && b.misura.parole > bud.parolePreviste * 1.1) sforati.push(b.chiave);
      console.log(`   ${b.chiave.padEnd(6)} parole ${String(b.misura.parole).padStart(4)} | icone ${String(b.misura.icone).padStart(2)} | box ${b.misura.riquadri} | tab ${b.misura.tabelle} | ${tetto}`);
    }
    if (sforati.length) console.log(`   sotto-criteri oltre il tetto (+10%): ${sforati.join(", ")}`);
    righe.push({ run: r.i, secondi: r.secondi, ...m, pagine: Number(pagine.toFixed(2)), sforati });
  }
  fs.writeFileSync(path.join(cartella, `${etichetta}.json`), JSON.stringify({ braccio, etichetta, criterio: criterio.numero, righe }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
