// Prova controllata delle FIGURE SCHEMATICHE con il modello vero e il prompt di
// produzione: genera UN criterio come in chat, poi costruisce e disegna le
// figure che il modello ha dichiarato (stesso codice di produzione: schema dello
// strumento, costruzione con i fatti del profilo, guardia R9, inserimento dei
// segnaposto) e salva i PNG per guardarli.
//
//   npx tsx scripts/prova-figure-reale.ts --gara <uuid> --criterio 2 [--etichetta x] [--n 1]
//        [--messaggio "<richiesta del cliente>"]
//        [--simula-piattaforma "FM360" --simula-funzioni "Cruscotto indicatori;Report mensile"]
//
// --simula-* sostituisce SOLO nel prompt e nella costruzione di questa prova i
// fatti del profilo sulla piattaforma (nel database il campo delle funzioni non
// esiste finché la migrazione 0072 non è eseguita): non scrive nulla.
//
// SOLA LETTURA sul DB; scrive solo file locali in test/diagnostica/figure-reali/
// (cartella ignorata da git). Le chiamate al modello sono registrate con user_id
// nullo, come i livelli 2. Costa denaro vero: una generazione per ogni --n.
import fs from "fs";
import path from "path";
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createClient } = require("@supabase/supabase-js");
import { buildSystemPrompt, buildGeneraBozzaTool, type GaraContesto, type CompanyContesto } from "../src/lib/gara-chat-prompt";
import { stimaPagineContenuto } from "../src/lib/stima-pagine";
import { embedQuery } from "../src/lib/voyage";
import { createAnthropicClient } from "../src/lib/anthropic";
import { logAiUsage } from "../src/lib/ai-usage";
import { leggiFattiFigure } from "../src/lib/figure-fatti";
import { costruisciFigure, leggiFunzioniPiattaforma, type FattiFigure } from "../src/lib/figure-contesto";
import { inserisciFigure } from "../src/lib/figure-dati";
import { disegnaFigura } from "../src/lib/figura-disegno";
import { caricaEvidenzaDati } from "../src/lib/evidenza-dati";

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
  const garaArg = arg("gara");
  const files = process.argv.flatMap((a, i) => (a === "--file" && process.argv[i + 1] ? [process.argv[i + 1]] : []));
  const numeroCriterio = arg("criterio", "");
  const n = Number(arg("n", "1"));
  const etichetta = arg("etichetta", `fig-${garaArg.slice(0, 6)}-c${numeroCriterio}`);

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const anthropic = createAnthropicClient();

  const { data: tutte } = await admin.from("gare").select("id");
  const garaId = ((tutte ?? []) as { id: string }[]).find((g) => g.id === garaArg || g.id.startsWith(garaArg))?.id;
  if (!garaId) throw new Error(`Gara non trovata: ${garaArg}`);

  const { data: g, error } = await admin
    .from("gare")
    .select("titolo, scadenza, importo, criteri_valutazione, requisiti, limiti_formattazione, limite_pagine_totale, punteggio_tecnico_max, criteri_riepilogo, relazione_dimensione_carattere, relazione_interlinea, sub_criteri_tabellari, sedi, personale_uscente, user_id")
    .eq("id", garaId)
    .single();
  if (error || !g) throw new Error(`Gara non trovata: ${error?.message}`);
  const gara = g as GaraContesto & { user_id: string };
  const { data: company } = await admin
    .from("companies")
    .select("ragione_sociale, forma_giuridica, numero_dipendenti, fatturato_medio_annuo, certificazioni, referenze, settori_attivita, presentazione")
    .eq("user_id", gara.user_id)
    .maybeSingle();
  const companyContesto = (company ?? null) as CompanyContesto;

  // Fatti del profilo sulla piattaforma: dal DB, oppure simulati per la prova.
  let fatti: FattiFigure = await leggiFattiFigure({ supabase: admin, userId: gara.user_id });
  if (process.argv.includes("--simula-piattaforma")) {
    fatti = { piattaforma: arg("simula-piattaforma"), funzioniPiattaforma: leggiFunzioniPiattaforma(arg("simula-funzioni", "").split(";").join("\n")) };
    console.log(`(SIMULATO) piattaforma «${fatti.piattaforma}», funzioni: ${fatti.funzioniPiattaforma.join("; ") || "nessuna"}`);
  }
  console.log(`Fatti figure: piattaforma ${fatti.piattaforma ?? "—"}, funzioni ${fatti.funzioniPiattaforma.length}`);

  const formattazione = { dimensioneCarattere: gara.relazione_dimensione_carattere ?? undefined, interlinea: gara.relazione_interlinea ?? undefined };
  const evidenza = await caricaEvidenzaDati({ garaId, userId: gara.user_id, supabase: admin });

  const cartella = path.join(__dirname, "..", "test", "diagnostica", "figure-reali");
  fs.mkdirSync(cartella, { recursive: true });
  const elabora = async (input: { contenuto?: string; figure?: unknown }, nome: string) => {
    const contenuto = input.contenuto ?? "";
    const dichiarate = Array.isArray(input.figure) ? input.figure : [];
    const segnaposti = contenuto.match(/\[FIGURA:\d+\]/g) ?? [];
    console.log(`  figure dichiarate: ${dichiarate.length} [${dichiarate.map((f) => (f as { archetipo?: string }).archetipo).join(", ")}] | segnaposti nel testo: ${segnaposti.join(" ") || "nessuno"} | organigramma dichiarato: ${input.contenuto && /\[ORGANIGRAMMA\]/.test(input.contenuto) ? "sì" : "no"}`);
    const citaNumero = /\bfigura\s+\d+\b/i.test(contenuto);
    console.log(`  il testo cita un numero di figura ("Figura N")? ${citaNumero ? "SÌ (da correggere)" : "no"}`);

    // Densità per sotto-criterio: prosa, tabelle, elenchi, figure (R16: tabellare predefinito, prosa eccezione).
    for (const b of contenuto.split(/\n(?=##\s)/)) {
      if (!/^##\s/.test(b)) continue;
      const prosa = b.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p && !/^[|#\-\[*]/.test(p) && !/^\[FIGURA:/.test(p));
      const parole = prosa.reduce((t, p) => t + p.split(/\s+/).length, 0);
      const tabelle = (b.match(/^\s*\|[-:\s|]+\|\s*$/gm) ?? []).length;
      const figure = (b.match(/\[FIGURA:\d+\]/g) ?? []).length + (b.match(/\[ORGANIGRAMMA\]/g) ?? []).length;
      console.log(`  ${b.split("\n")[0].slice(0, 56).padEnd(56)} | prosa ${String(prosa.length).padStart(2)} par. (${prosa.length ? Math.round(parole / prosa.length) : 0} parole/par.) | tabelle ${tabelle} | par./tabella ${tabelle ? (prosa.length / tabelle).toFixed(1) : "—"} | figure ${figure}`);
    }
    const esito = costruisciFigure(input.figure, fatti, { evidenza });
    for (const a of esito.avvisi) console.log(`  AVVISO: ${a}`);
    const inserite = inserisciFigure(contenuto, esito.blocchi);
    console.log(`  inserite ${inserite.inserite} | segnaposti senza figura ${inserite.senzaFigura.join(",") || "—"} | figure non richiamate ${inserite.nonRichiamate.join(",") || "—"}`);
    console.log(`  pagine stimate della sezione (con le figure): ${stimaPagineContenuto(inserite.testo, formattazione).toFixed(2)} (senza figure: ${stimaPagineContenuto(contenuto.replace(/\[FIGURA:\d+\]/g, ""), formattazione).toFixed(2)})`);
    for (let k = 0; k < esito.figure.length; k++) {
      const f = esito.figure[k];
      if (!f) continue;
      const r = await disegnaFigura(f, {});
      const out = path.join(cartella, `${nome}-figura${k + 1}-${f.archetipo}.png`);
      fs.writeFileSync(out, r.buffer);
      console.log(`  figura ${k + 1} (${f.archetipo}): «${f.didascalia}» → ${out}`);
    }
  };

  if (files.length > 0) {
    for (const f of files) {
      console.log(`
${path.basename(f)} (da un input salvato, nessuna chiamata al modello)`);
      await elabora(JSON.parse(fs.readFileSync(f, "utf-8")), path.basename(f).replace(/.input.json$/, ""));
    }
    return;
  }

  const criterio = (gara.criteri_riepilogo ?? []).find((c) => c.numero.trim() === numeroCriterio);
  if (!criterio) throw new Error(`Criterio ${numeroCriterio} non trovato nel riepilogo della gara`);
  const messaggio = process.argv.includes("--messaggio") ? arg("messaggio") : `Sviluppa il criterio ${criterio.numero}. ${criterio.titolo}`;

  const q = await embedQuery(messaggio, { userId: null, garaId, operazione: "chat_gara_ricerca" });
  const [{ data: chunksRaw }, { data: kbRaw }, { data: stileRaw }] = await Promise.all([
    admin.rpc("match_gara_chunks", { query_embedding: q, target_gara_id: garaId, match_count: 8 }),
    admin.rpc("match_knowledge_base_chunks", { query_embedding: q, match_count: 6 }),
    admin.rpc("match_knowledge_base_stile", { query_embedding: q, match_count: 6 }),
  ]);
  let chunks = (chunksRaw ?? []) as { contenuto: string }[];
  if (chunks.length === 0) {
    const { data: tuttiChunk } = await admin.from("gara_documenti_chunks").select("contenuto, embedding").eq("gara_id", garaId);
    chunks = (tuttiChunk ?? [])
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

  const systemPrompt = buildSystemPrompt(gara, companyContesto, contestoDocumenti, contestoKb, nota, strutture, "", fatti);
  const strumento = buildGeneraBozzaTool(gara);
  console.log(`Gara «${gara.titolo}», criterio ${criterio.numero} «${criterio.titolo}», ${n} generazione/i in parallelo\nRichiesta: ${messaggio}`);

  await Promise.all(
    Array.from({ length: n }, async (_, i) => {
      const t0 = Date.now();
      const stream = anthropic.messages.stream({
        model: "claude-sonnet-5",
        max_tokens: 64000,
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
        system: systemPrompt,
        tools: [{ type: "web_search_20250305" as const, name: "web_search" as const, max_uses: 3 }, strumento],
        messages: [{ role: "user" as const, content: messaggio }],
      });
      const resp = await stream.finalMessage();
      await logAiUsage({ userId: null, garaId, operazione: "chat_gara", provider: "anthropic", model: "claude-sonnet-5", inputTokens: resp.usage.input_tokens, outputTokens: resp.usage.output_tokens });
      const tu = resp.content.find((b) => b.type === "tool_use" && b.name === "genera_bozza_sezione");
      const input = ((tu as { input?: Record<string, unknown> } | undefined)?.input ?? {}) as { contenuto?: string; figure?: unknown };
      const nome = `${etichetta}-${i + 1}`;
      fs.writeFileSync(path.join(cartella, `${nome}.input.json`), JSON.stringify(input, null, 2));
      const secondi = Math.round((Date.now() - t0) / 1000);
      console.log(`\n#${i + 1} (${secondi}s, ${resp.usage.input_tokens} in / ${resp.usage.output_tokens} out, stop=${resp.stop_reason}${tu ? "" : ", NESSUNA BOZZA GENERATA"})`);
      if (!tu) return;

      await elabora(input, nome);
    }),
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
