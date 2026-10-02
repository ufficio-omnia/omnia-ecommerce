// Controllo di non regressione — LIVELLO 2 (a pagamento, manuale).
//
// Genera la relazione COMPLETA e REALE su Aosta (estrazione, 5 criteri,
// verifica dati, composizione con assicuraBudgetPagine) usando le stesse
// funzioni di produzione, poi applica: tutti i controlli strutturali del
// livello 1 (scripts/lib/controlli-relazione.ts) più quattro controlli
// specifici — nessun dato d'impresa senza fonte, coerenza aritmetica dei
// totali in tabella, tutte le sedi riportate, nessun segnaposto su dati di
// gara. Se TUTTO passa, anonimizza il risultato (committente, centrale,
// CIG, ragione sociale, sedi/indirizzi sostituiti con valori fittizi
// generici — vedi anonimizza()) e sostituisce
// test/fixtures/relazione-riferimento.json: da quel momento il livello 1
// verifica contro QUESTO risultato, non contro uno fisso nel tempo.
//
// Da lanciare a mano prima di pubblicare modifiche a regole (prompts/
// regole-omnia.md), compressione (prompts/compressione-omnia.md), estrazione
// (gara-extraction.ts) o verifica (verifica-dati-aziendali.ts,
// prompts/verifica-dati-omnia.md) — MAI nella build automatica: spende
// denaro reale (generazione + verifica + un audit finale) e richiede
// qualche minuto.
//
// Nessuna scrittura sulle righe della gara/relazione del cliente: legge i
// documenti reali di Aosta in sola lettura, scrive solo il fixture locale
// e logga il costo reale in ai_operazioni con user_id null (mai
// cancellato: è una spesa reale, si distingue dalle operazioni dei clienti
// per lo user_id nullo, non va eliminata — vedi ai-usage.ts).
import fs from "fs";
import path from "path";
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

import type Anthropic from "@anthropic-ai/sdk";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createClient } = require("@supabase/supabase-js");
import { buildSystemPrompt, buildGeneraBozzaTool, formattaDatiGaraStrutturati, organicoDisponibile, type GaraContesto, type CompanyContesto } from "../src/lib/gara-chat-prompt";
import { verificaDatiAziendali } from "../src/lib/verifica-dati-aziendali";
import { applicaMarcatoriTabellari, applicaSostituzioniAnonimizzazione, assicuraBudgetPagine } from "../src/lib/relazione-tecnica";
import { calcolaBudgetSottoCriteri } from "../src/lib/sotto-criteri";
import { analizzaColoriSorgente } from "../src/lib/colori-semantici";
import { embedQuery } from "../src/lib/voyage";
import { createAnthropicClient } from "../src/lib/anthropic";
import { logAiUsage } from "../src/lib/ai-usage";
import { eseguiControlliStrutturali, componiMarkdown, estraiTestiVisibili, type FixtureRelazione } from "./lib/controlli-relazione";
import { confrontaSubCriteri, estraiRequisitiDaCriteri, formattaConfronto, problemiContratto } from "./lib/confronto-tagli";

const GARA = "7e33e075-7c3a-4321-8751-c75d34f09dfa"; // Aosta — gara di riferimento fissa per il livello 2
const MODEL = "claude-sonnet-5";
const MAX_CHUNKS = 8;
const MAX_KB_CHUNKS = 6;
const FIXTURE_PATH = path.join(__dirname, "..", "test", "fixtures", "relazione-riferimento.json");

const EXTRACTION_TOOL = {
  name: "estrai_dati_gara",
  description: "Registra i dati strutturati estratti dai documenti di una gara d'appalto.",
  input_schema: {
    type: "object" as const,
    properties: {
      criteri_valutazione: { type: "string", description: "Struttura COMPLETA e letterale dei criteri di valutazione." },
      requisiti: { type: "string", description: "Riassunto dei requisiti di partecipazione." },
      limiti_formattazione: { type: "string", description: "Limiti di lunghezza/formattazione dell'offerta tecnica." },
      dimensione_carattere_richiesta: { type: "number", description: "Dimensione carattere richiesta." },
      interlinea_richiesta: { type: "number", description: "Interlinea richiesta." },
      limite_pagine_totale: { type: "number", description: "Numero massimo di pagine dell'offerta tecnica." },
      punteggio_tecnico_max: { type: "number", description: "Punteggio massimo offerta tecnica." },
      criteri_riepilogo: {
        type: "array",
        description: "Riepilogo sintetico dei criteri di primo livello.",
        items: { type: "object", properties: { numero: { type: "string" }, titolo: { type: "string" }, punti_max: { type: "number" } }, required: ["numero", "titolo", "punti_max"] },
      },
      sub_criteri_tabellari: { type: "array", description: "Codici dei sub-criteri solo-tabellari.", items: { type: "string" } },
      sedi: {
        type: "array",
        description: "Elenco di TUTTE le sedi/immobili/strutture in cui va svolto il servizio.",
        items: {
          type: "object",
          properties: { denominazione: { type: "string" }, indirizzo: { type: "string" }, superficie_mq: { type: "number" }, orari_apertura: { type: "string" }, frequenze: { type: "string" } },
          required: ["denominazione"],
        },
      },
      personale_uscente: {
        type: "array",
        description: "Elenco del personale interessato dalla clausola sociale. NON riportare MAI nominativi, codici fiscali o matricole.",
        items: {
          type: "object",
          properties: { livello_contrattuale: { type: "string" }, numero_addetti: { type: "number" }, ore_settimanali: { type: "number" }, anzianita: { type: "string" }, note: { type: "string" } },
          required: ["livello_contrattuale", "numero_addetti"],
        },
      },
    },
    required: ["criteri_valutazione", "requisiti", "limiti_formattazione"],
  },
};

const AUDIT_TOOL: Anthropic.Tool = {
  name: "restituisci_audit",
  description: "Restituisce l'esito dell'audit del documento.",
  input_schema: {
    type: "object",
    properties: {
      conforme: { type: "boolean", description: "true se NESSUN dato d'impresa (monte ore, addetti offerti, certificazioni, referenze, ecc.) compare senza riscontro nel profilo azienda o nei dati di gara forniti." },
      problemi: {
        type: "array",
        description: "Elenco dei problemi trovati (stringa breve per ciascuno). Vuoto se conforme=true.",
        items: { type: "string" },
      },
    },
    required: ["conforme", "problemi"],
  },
};

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// --- Controllo 2: coerenza aritmetica dei totali di tabella ---
// Parser deliberatamente semplice (numeri interi/a virgola, senza
// separatore delle migliaia): sufficiente per le tabelle di addetti/ore
// dove è stato osservato il bug reale (207 invece di 200), non un parser
// generico per ogni tabella numerica del documento.
function estraiNumero(cella: string): number | null {
  const pulita = cella.replace(/\*\*/g, "").replace(/\*/g, "").trim();
  const match = pulita.match(/-?\d+(?:,\d+)?/);
  if (!match) return null;
  return parseFloat(match[0].replace(",", "."));
}

function controllaCoerenzaTabelle(markdown: string): string[] {
  const problemi: string[] = [];
  const righeTabella = markdown.split("\n").filter((r) => r.trim().startsWith("|"));
  const tabelle: string[][] = [];
  let corrente: string[] = [];
  for (const riga of markdown.split("\n")) {
    if (riga.trim().startsWith("|")) {
      corrente.push(riga);
    } else if (corrente.length > 0) {
      tabelle.push(corrente);
      corrente = [];
    }
  }
  if (corrente.length > 0) tabelle.push(corrente);
  void righeTabella;

  for (const tabella of tabelle) {
    const righe = tabella
      .filter((r) => !/^\s*\|[-:\s|]+\|\s*$/.test(r))
      .map((r) => r.split("|").slice(1, -1).map((c) => c.trim()));
    if (righe.length < 3) continue; // intestazione + almeno 2 righe dati, poco senso controllare tabelle minuscole

    const [intestazione, ...corpo] = righe;
    const indiceTotale = corpo.findIndex((r) => /totale|somma/i.test(r[0] ?? ""));
    if (indiceTotale === -1) continue;

    const rigaTotale = corpo[indiceTotale];
    const righeDati = corpo.filter((_, i) => i !== indiceTotale);

    for (let col = 1; col < intestazione.length; col++) {
      const totaleDichiarato = estraiNumero(rigaTotale[col] ?? "");
      if (totaleDichiarato === null) continue;
      const valori = righeDati.map((r) => estraiNumero(r[col] ?? "")).filter((v): v is number => v !== null);
      if (valori.length < righeDati.length) continue; // colonna non interamente numerica, non è una colonna da sommare
      const sommaReale = valori.reduce((a, b) => a + b, 0);
      if (Math.abs(sommaReale - totaleDichiarato) > 0.5) {
        problemi.push(
          `Tabella con riga "${rigaTotale[0]}": colonna "${intestazione[col]}" dichiara ${totaleDichiarato} ma la somma delle righe è ${sommaReale}.`,
        );
      }
    }
  }
  return problemi;
}

// --- Controllo 3: tutte le sedi riportate ---
function controllaSediCoperte(markdown: string, sedi: { denominazione: string }[]): string[] {
  const problemi: string[] = [];
  for (const sede of sedi) {
    if (!markdown.toUpperCase().includes(sede.denominazione.toUpperCase())) {
      problemi.push(`Sede "${sede.denominazione}" non citata da nessuna parte nel documento.`);
    }
  }
  return problemi;
}

// --- Controllo: coerenza organigramma/organico ---
// Conta le "caselle" distinte nel blocco [ORGANIGRAMMA] più grande del
// documento (righe non vuote, esclusi i banner): ogni riga (casella
// indentata, "• " terminale, casella laterale "<"/">" ) rappresenta una
// persona per la sintassi definita in gara-chat-prompt.ts. Il MASSIMO tra
// i blocchi, non la somma: più organigrammi nello stesso documento sono
// tipicamente viste parziali della STESSA struttura (es. uno zoom su un
// singolo sotto-criterio), sommarli conterebbe la stessa persona più volte.
function contaMaxFigureOrganigramma(markdown: string): number {
  const blocchi = [...markdown.matchAll(/\[ORGANIGRAMMA\]([\s\S]*?)\[\/ORGANIGRAMMA\]/gi)].map((m) => m[1]);
  return blocchi.reduce((max, blocco) => {
    const nodi = blocco
      .split("\n")
      .map((r) => r.trim())
      .filter((r) => r.length > 0 && !/^\[\/?BANNER\]/i.test(r));
    return Math.max(max, nodi.length);
  }, 0);
}

function controllaCoerenzaOrganico(markdown: string, organico: number | null): string[] {
  if (organico == null) return [];
  const figure = contaMaxFigureOrganigramma(markdown);
  if (figure > organico) {
    return [`L'organigramma propone ${figure} ruoli/figure distinte ma l'organico disponibile (profilo azienda + personale uscente assorbito) è di ${organico} persone: la struttura non è sostenibile con l'organico dichiarato.`];
  }
  return [];
}

// --- Controllo 4: nessun segnaposto su dati di gara ---
function controllaSegnapostoSuDatiGara(markdown: string, sedi: { denominazione: string }[]): string[] {
  const problemi: string[] = [];
  const segnaposto = markdown.match(/\[DATO DA CONFERMARE:[^\]]*\]/g) || [];
  const paroleChiaveGara = [...sedi.map((s) => s.denominazione.toLowerCase()), "personale uscente", "clausola sociale", "superficie", "orari di apertura", "frequenz"];
  for (const s of segnaposto) {
    const testo = s.toLowerCase();
    const match = paroleChiaveGara.find((p) => testo.includes(p));
    if (match) {
      problemi.push(`Segnaposto su dato di gara (contiene "${match}"): ${s}`);
    }
  }
  return problemi;
}

// --- Controllo 1: audit finale AI (nessun dato d'impresa senza fonte) ---
async function auditDatiSenzaFonte(
  markdown: string,
  companyContesto: CompanyContesto,
  datiGaraStrutturati: string,
): Promise<string[]> {
  const anthropic = createAnthropicClient();
  let motivoUltimoTentativo = "";
  // Fino a due tentativi: con il ragionamento esteso il pensiero consuma lo
  // stesso max_tokens della risposta, e quando lo esaurisce prima di
  // chiamare lo strumento (osservato su un documento di ~10 pagine con
  // max_tokens 8000) l'audit non produce nessun esito. Il tetto è un limite,
  // non un budget pagato in anticipo; il secondo tentativo copre il caso in
  // cui il modello risponda comunque a parole.
  for (let tentativo = 1; tentativo <= 2; tentativo++) {
    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      thinking: { type: "adaptive" },
      system:
        "Sei un revisore che controlla un'offerta tecnica GIA' composta e corretta per una gara d'appalto di pulizie. Il tuo unico compito: trovare ogni numero o affermazione specifica sull'IMPRESA del cliente (monte ore, addetti offerti, certificazioni, referenze, nomi di clienti/prodotti/macchinari, esperienza pregressa) che NON trova riscontro nel profilo azienda o nei dati di gara forniti, ricordando che il monte ore/organico OFFERTO (proposto dall'impresa) è legittimo se marcato con un asterisco come proposta da confermare. Non segnalare requisiti del capitolato, riferimenti normativi, o dati di gara (sedi, superfici, personale uscente) già forniti. Chiama SEMPRE lo strumento fornito con l'esito.",
      tools: [AUDIT_TOOL],
      tool_choice: { type: "auto" },
      messages: [
        {
          role: "user",
          content: `Profilo azienda confermato:\n${companyContesto ? JSON.stringify(companyContesto, null, 2) : "Nessuno."}\n\nDati di gara strutturati (sedi/personale uscente, fonte primaria):\n${datiGaraStrutturati}\n\nTesto da auditare:\n\n${markdown}`,
        },
      ],
    });
    const response = await stream.finalMessage();
    await logAiUsage({ userId: null, garaId: GARA, operazione: "audit_livello2", provider: "anthropic", model: MODEL, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens });

    const toolUse = response.content.find((b) => b.type === "tool_use" && b.name === "restituisci_audit");
    if (toolUse && toolUse.type === "tool_use") {
      const esito = toolUse.input as { conforme: boolean; problemi: string[] };
      return esito.conforme ? [] : esito.problemi;
    }
    motivoUltimoTentativo = `stop_reason "${response.stop_reason}", ${response.usage.output_tokens} token in uscita`;
    console.warn(`Audit AI: tentativo ${tentativo} senza chiamata allo strumento (${motivoUltimoTentativo}).`);
  }
  return [`Audit AI: nessuna chiamata allo strumento in due tentativi (${motivoUltimoTentativo}) — impossibile verificare, trattato come fallimento.`];
}

// --- Anonimizzazione generica, ricostruita ad ogni run dai dati reali
// estratti (non una lista fissa scritta a mano): committente, centrale,
// CIG, ragione sociale e ogni sede/indirizzo diventano valori fittizi
// generici. Un controllo finale sui termini reali residui blocca la
// promozione a fixture se qualcosa non è stato sostituito.
function anonimizza(
  testo: string,
  reali: { stazioneAppaltante: string; amministrazioneCommittente: string; cig: string; ragioneSociale: string; sedi: { denominazione: string; indirizzo?: string | null }[] },
): { risultato: string; residui: string[] } {
  const sostituzioni: [string, string][] = [];
  reali.sedi.forEach((s, i) => {
    if (s.indirizzo) sostituzioni.push([s.indirizzo, `Via Esempio ${i + 1}, ${i + 1}`]);
  });
  reali.sedi.forEach((s, i) => {
    sostituzioni.push([s.denominazione, `Sede Esempio ${i + 1}`]);
    sostituzioni.push([s.denominazione.toUpperCase(), `SEDE ESEMPIO ${i + 1}`]);
    const titleCase = s.denominazione.replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
    sostituzioni.push([titleCase, `Sede Esempio ${i + 1}`]);
  });
  sostituzioni.push([reali.ragioneSociale, "IMPRESA ESEMPIO SRL"]);
  sostituzioni.push([reali.amministrazioneCommittente, "Comune di Esempio"]);
  sostituzioni.push([reali.stazioneAppaltante, "Centrale Appalti Esempio S.p.A."]);
  sostituzioni.push([reali.cig, "A1B2C3D4E5"]);
  const ultimaParolaCommittente = reali.amministrazioneCommittente.trim().split(/\s+/).pop();
  if (ultimaParolaCommittente && ultimaParolaCommittente.length > 3) {
    sostituzioni.push([ultimaParolaCommittente, "Esempio"]); // rete di sicurezza su residui isolati (es. solo "Aosta")
  }

  let risultato = testo;
  for (const [reale, fittizio] of sostituzioni) {
    if (!reale) continue;
    risultato = risultato.split(reale).join(fittizio);
  }

  const residui = sostituzioni.map(([reale]) => reale).filter((r) => r && risultato.includes(r));
  return { risultato, residui: [...new Set(residui)] };
}

(async () => {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const anthropic = createAnthropicClient();
  const inizioTest = new Date().toISOString();
  console.log("=== LIVELLO 2 — generazione reale su Aosta ===\nInizio:", inizioTest);

  // --- Estrazione reale ---
  const { data: documenti } = await admin.from("gara_documenti").select("nome_file, file_path").eq("gara_id", GARA);
  const pdfDocs = (documenti ?? []).filter((d: { nome_file: string }) => d.nome_file.toLowerCase().endsWith(".pdf"));
  const documentBlocks = await Promise.all(
    pdfDocs.map(async (doc: { nome_file: string; file_path: string }) => {
      const { data: file, error } = await admin.storage.from("gare").download(doc.file_path);
      if (error || !file) throw new Error(`Errore download ${doc.nome_file}: ${error?.message}`);
      const buffer = Buffer.from(await file.arrayBuffer());
      return { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: buffer.toString("base64") } };
    }),
  );
  const estrazioneResp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "disabled" },
    tools: [EXTRACTION_TOOL],
    tool_choice: { type: "tool", name: "estrai_dati_gara" },
    messages: [{ role: "user", content: [...documentBlocks, { type: "text", text: "Questi sono i documenti di una gara d'appalto per servizi di pulizia. Estrai i dati richiesti usando lo strumento fornito." }] }],
  });
  await logAiUsage({ userId: null, garaId: GARA, operazione: "estrazione_gara", provider: "anthropic", model: MODEL, inputTokens: estrazioneResp.usage.input_tokens, outputTokens: estrazioneResp.usage.output_tokens });
  const estrazioneTool = estrazioneResp.content.find((b) => b.type === "tool_use" && b.name === "estrai_dati_gara");
  if (!estrazioneTool || estrazioneTool.type !== "tool_use") throw new Error("Estrazione fallita.");
  const estratti = estrazioneTool.input as {
    criteri_valutazione: string; requisiti: string; limiti_formattazione: string;
    dimensione_carattere_richiesta?: number; interlinea_richiesta?: number; limite_pagine_totale?: number; punteggio_tecnico_max?: number;
    criteri_riepilogo?: { numero: string; titolo: string; punti_max: number }[]; sub_criteri_tabellari?: string[];
    sedi?: { denominazione: string; indirizzo?: string; superficie_mq?: number; orari_apertura?: string; frequenze?: string }[];
    personale_uscente?: { livello_contrattuale: string; numero_addetti: number; ore_settimanali?: number; anzianita?: string; note?: string }[];
  };
  console.log(`Estrazione OK: ${estratti.sedi?.length ?? 0} sedi, ${estratti.personale_uscente?.length ?? 0} personale, ${estratti.criteri_riepilogo?.length ?? 0} criteri, limite ${estratti.limite_pagine_totale} pagine`);

  const { data: garaRow } = await admin.from("gare").select("titolo, scadenza, importo, relazione_font, relazione_dimensione_carattere, relazione_interlinea, user_id").eq("id", GARA).single();
  const { data: company } = await admin
    .from("companies")
    .select("ragione_sociale, forma_giuridica, numero_dipendenti, fatturato_medio_annuo, certificazioni, referenze, settori_attivita, presentazione")
    .eq("user_id", garaRow.user_id)
    .maybeSingle();

  const gara: GaraContesto = {
    titolo: garaRow.titolo,
    scadenza: garaRow.scadenza,
    importo: garaRow.importo,
    criteri_valutazione: estratti.criteri_valutazione,
    requisiti: estratti.requisiti,
    limiti_formattazione: estratti.limiti_formattazione,
    limite_pagine_totale: estratti.limite_pagine_totale ?? null,
    punteggio_tecnico_max: estratti.punteggio_tecnico_max ?? null,
    criteri_riepilogo: estratti.criteri_riepilogo ?? null,
    relazione_dimensione_carattere: garaRow.relazione_dimensione_carattere ?? estratti.dimensione_carattere_richiesta ?? 12,
    relazione_interlinea: garaRow.relazione_interlinea ?? estratti.interlinea_richiesta ?? null,
    sub_criteri_tabellari: estratti.sub_criteri_tabellari ?? null,
    sedi: estratti.sedi ?? null,
    personale_uscente: estratti.personale_uscente ?? null,
  };
  const companyContesto: CompanyContesto = company
    ? { ragione_sociale: company.ragione_sociale, forma_giuridica: company.forma_giuridica, numero_dipendenti: company.numero_dipendenti, fatturato_medio_annuo: company.fatturato_medio_annuo, certificazioni: company.certificazioni, referenze: company.referenze, settori_attivita: company.settori_attivita, presentazione: company.presentazione }
    : null;

  if (!gara.limite_pagine_totale || !gara.punteggio_tecnico_max || !gara.criteri_riepilogo?.length || !gara.sedi?.length) {
    throw new Error("Dati insufficienti dall'estrazione (limite/punteggio/criteri/sedi mancanti) — livello 2 non può procedere.");
  }

  const formattazione = { font: garaRow.relazione_font ?? "Calibri", dimensioneCarattere: gara.relazione_dimensione_carattere ?? 12, interlinea: gara.relazione_interlinea ?? 1 };
  const datiGaraStrutturati = formattaDatiGaraStrutturati(gara);

  const sezioni: { titolo_sezione: string; contenuto: string }[] = [];

  for (const criterio of gara.criteri_riepilogo) {
    const messaggioUtente = `Sviluppa il criterio ${criterio.numero}. ${criterio.titolo}.`;
    console.log(`\n=== Criterio ${criterio.numero}: ${criterio.titolo} ===`);

    const queryEmbedding = await embedQuery(messaggioUtente, { userId: null, garaId: GARA, operazione: "chat_gara_ricerca" });
    const { data: tuttiChunk } = await admin.from("gara_documenti_chunks").select("contenuto, embedding").eq("gara_id", GARA);
    const chunks = (tuttiChunk ?? [])
      .map((c: { contenuto: string; embedding: string }) => ({ contenuto: c.contenuto, similarity: cosineSim(queryEmbedding, JSON.parse(c.embedding)) }))
      .sort((a: { similarity: number }, b: { similarity: number }) => b.similarity - a.similarity)
      .slice(0, MAX_CHUNKS);
    const contestoDocumenti = chunks.map((c: { contenuto: string }, i: number) => `[Estratto ${i + 1}]\n${c.contenuto}`).join("\n\n");

    const [{ data: kbChunksRaw }, { data: kbStileRaw }] = await Promise.all([
      admin.rpc("match_knowledge_base_chunks", { query_embedding: queryEmbedding, match_count: MAX_KB_CHUNKS }),
      admin.rpc("match_knowledge_base_stile", { query_embedding: queryEmbedding, match_count: MAX_KB_CHUNKS }),
    ]);
    const kbChunks = (kbChunksRaw ?? []) as { contenuto: string }[];
    const contestoKnowledgeBase = kbChunks.map((c: { contenuto: string }, i: number) => `[Esempio ${i + 1}]\n${c.contenuto}`).join("\n\n");
    const kbStile = (kbStileRaw ?? []) as { nota_stile: string | null; struttura_titoli: string | null }[];
    const notaStileKnowledgeBase = kbStile.filter((d) => d.nota_stile).map((d, i) => `[Progetto ${i + 1}]\n${d.nota_stile}`).join("\n\n");
    const struttureKnowledgeBase = kbStile.filter((d) => d.struttura_titoli).map((d, i) => `[Struttura progetto ${i + 1}]\n${d.struttura_titoli}`).join("\n\n");

    const systemPrompt = buildSystemPrompt(gara, companyContesto, contestoDocumenti, contestoKnowledgeBase, notaStileKnowledgeBase, struttureKnowledgeBase, "");
    const tool = buildGeneraBozzaTool(gara);

    const stream = anthropic.messages.stream({
      model: MODEL, max_tokens: 64000, thinking: { type: "adaptive" }, output_config: { effort: "high" },
      system: systemPrompt, tools: [tool], tool_choice: { type: "tool", name: "genera_bozza_sezione" },
      messages: [{ role: "user", content: messaggioUtente }],
    });
    const response = await stream.finalMessage();
    await logAiUsage({ userId: null, garaId: GARA, operazione: "chat_gara", provider: "anthropic", model: MODEL, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens });

    const toolUse = response.content.find((b) => b.type === "tool_use" && b.name === "genera_bozza_sezione");
    if (!toolUse || toolUse.type !== "tool_use") { console.error("Nessuna chiamata allo strumento per il criterio", criterio.numero); continue; }
    const input = toolUse.input as { titolo_sezione: string; contenuto: string };

    const senzaPlaceholder = applicaSostituzioniAnonimizzazione(input.contenuto, companyContesto?.ragione_sociale);
    const conMarcatori = applicaMarcatoriTabellari(senzaPlaceholder, gara.sub_criteri_tabellari ?? null);
    const verificato = await verificaDatiAziendali(conMarcatori, companyContesto, contestoDocumenti, datiGaraStrutturati, { userId: null, garaId: GARA });

    sezioni.push({ titolo_sezione: input.titolo_sezione, contenuto: verificato });
  }

  console.log(`\n=== COMPOSIZIONE (assicuraBudgetPagine) ===`);
  const { sezioni: sezioniCorrette, sezioniDopoFase1, sezioniTagliateDecisamente, esitiCompressione } = await assicuraBudgetPagine(
    sezioni,
    {
      limitePagineTotale: gara.limite_pagine_totale,
      punteggioTecnicoMax: gara.punteggio_tecnico_max,
      criteriRiepilogo: gara.criteri_riepilogo,
      subCriteriTabellari: gara.sub_criteri_tabellari,
      // Con questo campo presente e criteri_valutazione interpretabile,
      // assicuraBudgetPagine usa il budget per SOTTO-criterio (compressione
      // mirata + ripristino) invece del vecchio budget per solo criterio —
      // senza, il livello 2 proverebbe un percorso diverso da quello reale
      // usato in produzione.
      criteriValutazione: gara.criteri_valutazione,
    },
    companyContesto?.ragione_sociale,
    formattazione,
    { userId: null, garaId: GARA },
  );
  console.log(
    sezioniTagliateDecisamente.length > 0
      ? `Taglio deciso applicato a: ${sezioniTagliateDecisamente.join("; ")}`
      : "Taglio deciso non necessario (la correzione proporzionale è bastata).",
  );
  if (esitiCompressione.length > 0) {
    console.log(`\nCompressione per sotto-criterio (${esitiCompressione.length} riga/righe):`);
    for (const riga of esitiCompressione) console.log(`  ${riga}`);
  }

  // Intestazione REALE per la generazione/i controlli (stazione appaltante
  // e amministrazione committente non sono nello schema di estrazione
  // ridotto qui sopra: valori reali già confermati in sessioni precedenti
  // per questa stessa gara, non scritti sulla riga del cliente).
  const REALI = {
    stazioneAppaltante: "IN.VA. S.p.A.",
    amministrazioneCommittente: "Comune di Aosta",
    cig: "BCB1DA0DD2",
    ragioneSociale: companyContesto?.ragione_sociale ?? "",
    sedi: gara.sedi!,
  };

  const fixtureReale: FixtureRelazione = {
    titolo: "Relazione Tecnica - Servizio di Pulizia degli Uffici Comunali",
    sezioni: sezioniCorrette,
    formattazione,
    datiIntestazione: { stazioneAppaltante: REALI.stazioneAppaltante, amministrazioneCommittente: REALI.amministrazioneCommittente, cig: REALI.cig, concorrente: REALI.ragioneSociale },
    limitePagineTotale: gara.limite_pagine_totale,
  };

  // --- Controlli di livello 1 (strutturali, riusati) ---
  console.log(`\n=== CONTROLLI ===`);
  const esitoStrutturale = await eseguiControlliStrutturali(fixtureReale);
  const { errori: erroriStrutturali, riepilogo } = esitoStrutturale;
  console.log(`Strutturali: ${riepilogo}`);

  // Manifest delle figure: SEMPRE registrato (non solo in caso di errore),
  // così un'anomalia sul numero/tipo di immagini si diagnostica anche a
  // posteriori, senza rigenerare — quale figura, in quale parte del testo,
  // da quale sorgente.
  console.log(`\nFigure del documento (${esitoStrutturale.figure.length}):`);
  for (const r of esitoStrutturale.manifestFigure) console.log(`  ${r}`);

  // --- Controlli aggiuntivi di livello 2 (deterministici) ---
  const markdown = componiMarkdown(fixtureReale);
  const erroriArithmetica = controllaCoerenzaTabelle(markdown);
  const erroriSedi = controllaSediCoperte(markdown, gara.sedi!);
  const erroriSegnaposto = controllaSegnapostoSuDatiGara(markdown, gara.sedi!);
  const erroriOrganico = controllaCoerenzaOrganico(markdown, organicoDisponibile(gara, companyContesto));

  // --- Confronto prima/dopo dei tagli, sotto-criterio per sotto-criterio:
  // il testo verificato PRIMA di assicuraBudgetPagine contro quello dopo,
  // per confermare che il contratto di compressione (impegni e valori,
  // citazioni del capitolato, figure, elementi richiesti dal sub-criterio)
  // sia rispettato. Il confronto "dopo la fase 1 → dopo il taglio deciso"
  // isola l'effetto del solo taglio deciso, se è scattato.
  const requisiti = estraiRequisitiDaCriteri(gara.criteri_valutazione ?? "");
  // Tetti per sotto-criterio (stesso calcolo usato dalla generazione/
  // compressione): senza, il controllo "svuotato" giudicherebbe ogni
  // sotto-criterio contro la propria lunghezza originale (spesso ben sopra
  // il tetto perché generata prima del vincolo) invece che contro quanto
  // gli spetta — un falso allarme su una riduzione corretta.
  const budgetTetti = calcolaBudgetSottoCriteri({
    criteriValutazione: gara.criteri_valutazione,
    criteriRiepilogo: gara.criteri_riepilogo,
    punteggioTecnicoMax: gara.punteggio_tecnico_max,
    limitePagineTotale: gara.limite_pagine_totale,
    subCriteriTabellari: gara.sub_criteri_tabellari,
    formattazione,
  });
  const tettiParole = budgetTetti ? new Map(budgetTetti.sottoCriteri.map((s) => [s.chiave, s.parolePreviste])) : undefined;
  const confronti = confrontaSubCriteri(sezioni, sezioniCorrette, formattazione, requisiti);
  const { errori: erroriTagli, avvisi: avvisiTagli } = problemiContratto(confronti, 0.4, tettiParole);
  let reportConfronto = `CONFRONTO COMPLESSIVO (testo verificato prima della composizione → documento finale)\n${formattaConfronto(confronti)}`;
  if (sezioniTagliateDecisamente.length > 0) {
    const filtra = (elenco: { titolo_sezione: string; contenuto: string }[]) => elenco.filter((x) => sezioniTagliateDecisamente.includes(x.titolo_sezione));
    const soloDeciso = confrontaSubCriteri(filtra(sezioniDopoFase1), filtra(sezioniCorrette), formattazione, []);
    const { errori: erroriSoloDeciso } = problemiContratto(soloDeciso);
    reportConfronto += `\n\nEFFETTO DEL SOLO TAGLIO DECISO (dopo la fase 1 → finale, sezioni: ${sezioniTagliateDecisamente.join("; ")})\n${formattaConfronto(soloDeciso)}\n\nErrori del solo taglio deciso: ${erroriSoloDeciso.length ? "\n - " + erroriSoloDeciso.join("\n - ") : "nessuno"}`;
  }
  reportConfronto += `\n\nAVVISI (da giudicare):\n${avvisiTagli.length ? avvisiTagli.map((a) => ` - ${a}`).join("\n") : " nessuno"}`;

  // Dump diagnostico locale (cartella test/diagnostica/, ignorata da git:
  // contiene contenuto REALE non anonimizzato). Scritto PRIMA dell'audit AI
  // (che può fallire per crediti o rete): se qualcosa non torna, serve il
  // materiale per capire perché senza rigenerare a pagamento — contenuto
  // grezzo, il documento Word, il manifest delle figure e il confronto.
  const cartellaDump = path.join(__dirname, "..", "test", "diagnostica", `livello2-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  fs.mkdirSync(cartellaDump, { recursive: true });
  fs.writeFileSync(path.join(cartellaDump, "dump.json"), JSON.stringify({ fixtureReale, estratti, sezioniPrimaDellaComposizione: sezioni, sezioniDopoFase1, sezioniTagliateDecisamente }, null, 2));
  fs.writeFileSync(path.join(cartellaDump, "documento.docx"), esitoStrutturale.buffer);
  fs.writeFileSync(path.join(cartellaDump, "immagini-manifest.json"), JSON.stringify(esitoStrutturale.figure, null, 2));
  fs.writeFileSync(path.join(cartellaDump, "confronto-tagli.txt"), reportConfronto);
  console.log(`\nDump diagnostico (contenuto reale, non nel repository) in: ${cartellaDump}`);

  const erroriAudit = await auditDatiSenzaFonte(markdown, companyContesto, datiGaraStrutturati);
  void estraiTestiVisibili; // riesportata dal modulo condiviso, non serve qui direttamente

  const tuttiGliErrori = [
    ...erroriStrutturali.map((e) => `[Strutturale] ${e}`),
    ...erroriArithmetica.map((e) => `[Aritmetica tabelle] ${e}`),
    ...erroriSedi.map((e) => `[Copertura sedi] ${e}`),
    ...erroriSegnaposto.map((e) => `[Segnaposto su dati di gara] ${e}`),
    ...erroriOrganico.map((e) => `[Coerenza organico] ${e}`),
    ...erroriTagli.map((e) => `[Tagli] ${e}`),
    ...erroriAudit.map((e) => `[Audit dati d'impresa] ${e}`),
  ];

  console.log(`\n${tuttiGliErrori.length === 0 ? "TUTTI I CONTROLLI SUPERATI" : `${tuttiGliErrori.length} PROBLEMA/I TROVATO/I`}:`);
  for (const e of tuttiGliErrori) console.log(` - ${e}`);
  if (avvisiTagli.length > 0) {
    console.log(`\nAvvisi sui tagli, da giudicare a mano (dettaglio in confronto-tagli.txt):`);
    for (const a of avvisiTagli) console.log(` - ${a}`);
  }

  // Conformità del MODELLO ai colori semantici (R20, R22-bis): il documento è
  // comunque corretto perché il renderer applica le stesse regole (e i
  // controlli strutturali sopra lo verificano), ma qui si vede se il modello
  // le ha rispettate o se è il renderer a correggerlo — da giudicare a mano.
  const coloriSorgente = analizzaColoriSorgente(markdown);
  console.log(`\nColori semantici dichiarati dal modello: ${[...coloriSorgente.tipiDichiarati].join(", ") || "nessuno"}`);
  if (coloriSorgente.tagColore.length > 0) {
    console.log(`Avviso: parole di colore al posto di un tipo (il renderer le ignora, usa il primario): ${[...new Set(coloriSorgente.tagColore)].join(", ")}`);
  }
  if (coloriSorgente.evidenziazioniScartate.length > 0) {
    console.log(`Avviso: evidenziazioni dichiarate dal modello e NON applicate dal renderer (R22-bis):`);
    for (const s of coloriSorgente.evidenziazioniScartate) console.log(` - ${s}`);
  }


  // --- Costo reale (non cancellato) ---
  const { data: righe } = await admin.from("ai_operazioni").select("costo_stimato, operazione").is("user_id", null).eq("gara_id", GARA).gte("created_at", inizioTest);
  const costoTotale = (righe ?? []).reduce((tot: number, r: { costo_stimato: number | null }) => tot + (r.costo_stimato ?? 0), 0);
  const costoPerOperazione = new Map<string, number>();
  for (const r of righe ?? []) costoPerOperazione.set(r.operazione, (costoPerOperazione.get(r.operazione) ?? 0) + (r.costo_stimato ?? 0));

  console.log(`\n=== RIEPILOGO FINALE ===`);
  console.log(`Pagine finali: ${esitoStrutturale.pagineStimate.toFixed(2)} (limite dichiarato ${gara.limite_pagine_totale})${esitoStrutturale.pagineStimate > gara.limite_pagine_totale ? " — SOPRA IL LIMITE" : ""}`);
  console.log(`Costo totale della gara (con tutti gli interventi attivi): $${costoTotale.toFixed(4)} su ${(righe ?? []).length} operazioni`);
  for (const [op, costo] of [...costoPerOperazione].sort((a, b) => b[1] - a[1])) console.log(`  ${op}: $${costo.toFixed(4)}`);

  if (tuttiGliErrori.length > 0) {
    console.error("\nFixture di livello 1 NON aggiornato: correggere i problemi sopra e rilanciare.");
    process.exit(1);
  }

  // --- Promozione a nuovo riferimento di livello 1 (anonimizzato) ---
  const sezioniAnonime = sezioniCorrette.map((s) => {
    const titolo = anonimizza(s.titolo_sezione, REALI);
    const contenuto = anonimizza(s.contenuto, REALI);
    return { titolo_sezione: titolo.risultato, contenuto: contenuto.risultato, residui: [...titolo.residui, ...contenuto.residui] };
  });
  const residuiTotali = [...new Set(sezioniAnonime.flatMap((s) => s.residui))];

  if (residuiTotali.length > 0) {
    console.error(`\nAnonimizzazione incompleta — riferimenti reali ancora presenti dopo la sostituzione: ${residuiTotali.join(", ")}`);
    console.error("Fixture di livello 1 NON aggiornato.");
    process.exit(1);
  }

  const fixtureAnonimo: FixtureRelazione = {
    titolo: fixtureReale.titolo,
    sezioni: sezioniAnonime.map(({ titolo_sezione, contenuto }) => ({ titolo_sezione, contenuto })),
    formattazione,
    datiIntestazione: { stazioneAppaltante: "Centrale Appalti Esempio S.p.A.", amministrazioneCommittente: "Comune di Esempio", cig: "A1B2C3D4E5", concorrente: "IMPRESA ESEMPIO SRL" },
    limitePagineTotale: gara.limite_pagine_totale,
  };

  // Il riferimento anonimizzato deve a sua volta superare i controlli
  // strutturali: la sostituzione di nomi/indirizzi potrebbe alterare
  // qualcosa (intestazione, tabelle, figure) senza che nessuno se ne accorga
  // finché il livello 1 non fallisce in build.
  const { errori: erroriAnonimo } = await eseguiControlliStrutturali(fixtureAnonimo);
  if (erroriAnonimo.length > 0) {
    console.error(`\nIl riferimento anonimizzato NON supera i controlli strutturali:`);
    for (const e of erroriAnonimo) console.error(` - ${e}`);
    console.error("Fixture di livello 1 NON aggiornato.");
    process.exit(1);
  }

  fs.writeFileSync(FIXTURE_PATH, JSON.stringify(fixtureAnonimo, null, 2));
  console.log(`\nOK — test/fixtures/relazione-riferimento.json aggiornato con il nuovo riferimento approvato.`);
})().catch((err) => {
  console.error("Errore nel controllo di livello 2:", err);
  process.exit(1);
});
