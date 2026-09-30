"use server";

import type Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAnthropicClient } from "@/lib/anthropic";
import { embedQuery } from "@/lib/voyage";
import { logAiUsage } from "@/lib/ai-usage";
import { sanitizeFileName } from "@/lib/document-text";
import {
  categorizzaAllegato,
  estraiTestoAllegato,
  mediaTypeImmagine,
  LIMITE_BYTE_PER_CATEGORIA,
  MAX_ALLEGATI_PER_MESSAGGIO,
} from "@/lib/attachment-text";
import { stimaPagineContenuto } from "@/lib/stima-pagine";
import {
  generaBozzaSezione,
  componiRelazioneFinale,
  elencoSezioniEsistenti,
  correggiSezioneConBudget,
  applicaMarcatoriTabellari,
  applicaSostituzioniAnonimizzazione,
} from "@/lib/relazione-tecnica";
import { requireOmniaAiWriteAccess } from "@/lib/omnia-ai-access";
import {
  buildSystemPrompt,
  buildGeneraBozzaTool,
  formattaDatiGaraStrutturati,
  type GaraContesto,
  type CompanyContesto,
} from "@/lib/gara-chat-prompt";

export type { GaraContesto, CompanyContesto };

export type ChatState = { error?: string };

const MODEL = "claude-sonnet-5";
const MAX_HISTORY = 12;
const MAX_CHUNKS = 8;
const MAX_KB_CHUNKS = 6;
const MAX_TOOL_ROUNDS = 4;

// I segnaposto di anonimizzazione e le forme generiche "l'operatore
// economico"/"il concorrente" sono gestiti in modo deterministico da
// applicaSostituzioniAnonimizzazione (src/lib/relazione-tecnica.ts),
// condivisa con componiRelazioneFinale — prima vivevano solo qui, e la
// relazione finale composta da "componi relazione finale" non le
// riceveva mai: era questa la causa per cui "operatore economico"
// continuava a comparire nel documento finale nonostante il fix qui.

const COMPONI_RELAZIONE_TOOL: Anthropic.Tool = {
  name: "componi_relazione_finale",
  description:
    "Compone la Relazione Tecnica DEFINITIVA della gara, unendo tutte le bozze di sezione generate finora in un unico documento Word con un solo titolo e un solo indice (rilevando ed eliminando automaticamente eventuali bozze duplicate/superate dello stesso criterio, tenendo la versione più recente/completa). Usalo SOLO quando il cliente lo chiede esplicitamente in modo inequivocabile (es. 'componi/unisci/metti insieme tutti i criteri nella relazione finale'), mai di propria iniziativa.",
  input_schema: {
    type: "object",
    properties: {},
  },
};

const WEB_SEARCH_TOOL: Anthropic.WebSearchTool20250305 = {
  type: "web_search_20250305",
  name: "web_search",
  max_uses: 3,
};

export async function sendGaraMessage(
  _prevState: ChatState,
  formData: FormData,
): Promise<ChatState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Sessione scaduta, ricarica la pagina." };

  const accessoNegato = await requireOmniaAiWriteAccess(user.id, supabase);
  if (accessoNegato) return { error: accessoNegato };

  const garaId = String(formData.get("garaId") ?? "");
  const messaggio = String(formData.get("messaggio") ?? "").trim();
  const allegatiFile = formData
    .getAll("allegati")
    .filter((f): f is File => f instanceof File && f.size > 0);

  if (!garaId || (!messaggio && allegatiFile.length === 0)) {
    return { error: "Scrivi un messaggio o allega un file." };
  }

  if (allegatiFile.length > MAX_ALLEGATI_PER_MESSAGGIO) {
    return { error: `Puoi allegare al massimo ${MAX_ALLEGATI_PER_MESSAGGIO} file per messaggio.` };
  }

  for (const file of allegatiFile) {
    const categoria = categorizzaAllegato(file.name);
    if (categoria === "non_supportato") {
      return {
        error: `Formato non supportato: "${file.name}". Sono ammessi immagini (PNG/JPG/GIF/WEBP), PDF, Word (.docx) ed Excel/CSV (.xlsx/.xls/.csv).`,
      };
    }
    if (file.size > LIMITE_BYTE_PER_CATEGORIA[categoria]) {
      const limiteMb = Math.round(LIMITE_BYTE_PER_CATEGORIA[categoria] / (1024 * 1024));
      return { error: `"${file.name}" supera il limite di ${limiteMb}MB per questo tipo di file.` };
    }
  }

  // La RLS ("gare_all_own") garantisce che questa select restituisca la
  // gara solo se appartiene all'utente corrente.
  const { data: gara } = await supabase
    .from("gare")
    .select(
      "titolo, scadenza, importo, criteri_valutazione, requisiti, limiti_formattazione, limite_pagine_totale, punteggio_tecnico_max, criteri_riepilogo, relazione_dimensione_carattere, relazione_interlinea, sub_criteri_tabellari, sedi, personale_uscente",
    )
    .eq("id", garaId)
    .single<GaraContesto>();

  if (!gara) return { error: "Gara non trovata." };

  const { data: company } = await supabase
    .from("companies")
    .select(
      "ragione_sociale, forma_giuridica, numero_dipendenti, fatturato_medio_annuo, certificazioni, referenze, settori_attivita, presentazione",
    )
    .eq("user_id", user.id)
    .maybeSingle<CompanyContesto>();

  const { data: storicoRaw } = await supabase
    .from("gara_messaggi")
    .select("ruolo, contenuto")
    .eq("gara_id", garaId)
    .order("created_at", { ascending: false })
    .limit(MAX_HISTORY)
    .returns<{ ruolo: string; contenuto: string }[]>();

  const storico = (storicoRaw ?? []).slice().reverse();

  const { data: messaggioInserito, error: insertUserError } = await supabase
    .from("gara_messaggi")
    .insert({
      gara_id: garaId,
      user_id: user.id,
      ruolo: "utente",
      contenuto: messaggio || "[Allegato]",
    })
    .select("id")
    .single<{ id: string }>();

  if (insertUserError || !messaggioInserito) {
    console.error("Errore salvataggio messaggio utente:", insertUserError);
    return { error: "Errore nell'invio del messaggio." };
  }

  // Blocchi per gli allegati di QUESTO messaggio da aggiungere alla
  // chiamata Claude: immagini/PDF come blocchi nativi (vision/documento),
  // Word/Excel/CSV come testo estratto — un allegato malformato non deve
  // bloccare l'invio dell'intero messaggio, quindi ogni file è gestito
  // per conto suo e un fallimento diventa una nota testuale invece di un
  // errore fatale.
  const blocchiAllegati: Anthropic.ContentBlockParam[] = [];
  if (allegatiFile.length > 0) {
    const admin = createAdminClient();
    for (const [indice, file] of allegatiFile.entries()) {
      try {
        const buffer = Buffer.from(await file.arrayBuffer());
        const filePath = `${garaId}/chat-allegati/${Date.now()}-${indice}-${sanitizeFileName(file.name)}`;

        const { error: uploadError } = await admin.storage
          .from("gare")
          .upload(filePath, buffer, { contentType: file.type || undefined, upsert: false });

        if (uploadError) {
          console.error("Errore upload allegato chat:", uploadError);
          blocchiAllegati.push({ type: "text", text: `[Allegato "${file.name}": errore nel caricamento]` });
          continue;
        }

        const { error: insertAllegatoError } = await supabase.from("gara_messaggio_allegati").insert({
          messaggio_id: messaggioInserito.id,
          gara_id: garaId,
          user_id: user.id,
          nome_file: file.name,
          file_path: filePath,
          mime_type: file.type || "application/octet-stream",
        });
        if (insertAllegatoError) {
          console.error(`Errore salvataggio riga allegato "${file.name}":`, insertAllegatoError);
        }

        const categoria = categorizzaAllegato(file.name);
        if (categoria === "immagine") {
          blocchiAllegati.push({
            type: "image",
            source: {
              type: "base64",
              media_type: mediaTypeImmagine(file.name),
              data: buffer.toString("base64"),
            },
          });
        } else if (categoria === "pdf") {
          blocchiAllegati.push({
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: buffer.toString("base64") },
          });
        } else {
          const testo = await estraiTestoAllegato(file.name, buffer);
          blocchiAllegati.push({ type: "text", text: `[Allegato "${file.name}"]\n${testo}` });
        }
      } catch (err) {
        console.error(`Errore elaborazione allegato "${file.name}":`, err);
        blocchiAllegati.push({
          type: "text",
          text: `[Allegato "${file.name}": non è stato possibile leggerne il contenuto]`,
        });
      }
    }
  }

  let rispostaFinale = "";
  let fileGenerato: { nomeFile: string; filePath: string; pagineStimate: number } | null = null;

  try {
    const queryEmbedding = await embedQuery(messaggio, {
      userId: user.id,
      garaId,
      operazione: "chat_gara_ricerca",
    });

    const [
      { data: chunksRaw, error: matchError },
      { data: kbChunksRaw, error: kbMatchError },
      { data: kbStileRaw, error: kbStileError },
    ] = await Promise.all([
      supabase.rpc("match_gara_chunks", {
        query_embedding: queryEmbedding,
        target_gara_id: garaId,
        match_count: MAX_CHUNKS,
      }),
      supabase.rpc("match_knowledge_base_chunks", {
        query_embedding: queryEmbedding,
        match_count: MAX_KB_CHUNKS,
      }),
      supabase.rpc("match_knowledge_base_stile", {
        query_embedding: queryEmbedding,
        match_count: MAX_KB_CHUNKS,
      }),
    ]);

    if (matchError) {
      console.error("Errore ricerca chunk gara:", matchError);
    }
    if (kbMatchError) {
      console.error("Errore ricerca chunk knowledge base:", kbMatchError);
    }
    if (kbStileError) {
      console.error("Errore ricerca stile knowledge base:", kbStileError);
    }

    // NOTA PRIVACY (bug reale, corretto): qui venivano allegate come
    // immagini vere (blocchi vision) le pagine/tabelle/organigrammi
    // grezzi estratti dai progetti di riferimento — screenshot reali,
    // MAI passati dall'anonimizzazione testuale (che agisce solo su
    // chunk/nota_stile/struttura_titoli). Il modello poteva quindi
    // leggere a schermo nomi di aziende/enti reali stampati nella
    // pagina e ripeterli in chat (verificato: "Zenith"/"ZFood"/"SASA",
    // presenti nei documenti originali ma già assenti dal testo
    // anonimizzato, comparivano comunque nella risposta perché il
    // modello li aveva letti nell'immagine allegata). Rimosso: lo stile
    // visivo per la generazione si basa solo su nota_stile/struttura_titoli
    // (testo, già passato dall'anonimizzazione) e sulle convenzioni
    // esplicite nel prompt (tag [TABELLA:colore], [ICONA:], ecc.).

    const chunks = (chunksRaw ?? []) as { contenuto: string }[];
    const contestoDocumenti = chunks
      .map((c, i) => `[Estratto ${i + 1}]\n${c.contenuto}`)
      .join("\n\n");

    const kbChunks = (kbChunksRaw ?? []) as { contenuto: string }[];
    const contestoKnowledgeBase = kbChunks
      .map((c, i) => `[Esempio ${i + 1}]\n${c.contenuto}`)
      .join("\n\n");

    // Stile e struttura recuperati per pertinenza rispetto a QUESTO
    // messaggio (stesso meccanismo del contenuto testuale), non con un
    // taglio fisso sui primi caricati: la ricerca scansiona sempre
    // l'intera knowledge base, indipendentemente da quanti documenti
    // contiene — nessuno escluso "a monte" dalla ricerca.
    const kbStile = (kbStileRaw ?? []) as {
      nota_stile: string | null;
      struttura_titoli: string | null;
    }[];

    const notaStileKnowledgeBase = kbStile
      .filter((d) => d.nota_stile)
      .map((d, i) => `[Progetto ${i + 1}]\n${d.nota_stile}`)
      .join("\n\n");

    const struttureKnowledgeBase = kbStile
      .filter((d) => d.struttura_titoli)
      .map((d, i) => `[Struttura progetto ${i + 1}]\n${d.struttura_titoli}`)
      .join("\n\n");

    const listaSezioniEsistenti = await elencoSezioniEsistenti(garaId);
    // Stima grezza (non un conteggio pagine Word reale) solo per dare
    // all'AI un'idea di quanto del limite di pagine totale del
    // disciplinare è già stato "consumato" dalle bozze precedenti,
    // quando decide quanto spazio dedicare alla prossima sezione.
    const PAROLE_PER_PAGINA_STIMATE = 450;
    const paroleTotaliEsistenti = listaSezioniEsistenti.reduce((tot, s) => tot + s.paroleStimate, 0);
    const paginaStimataEsistenti = Math.round(paroleTotaliEsistenti / PAROLE_PER_PAGINA_STIMATE);
    const sezioniEsistenti = listaSezioniEsistenti
      .map((s) => `[ordine ${s.ordine}] ${s.titolo_sezione} (~${Math.round(s.paroleStimate / PAROLE_PER_PAGINA_STIMATE)} pagine stimate)`)
      .join("\n");
    const sezioniEsistentiConTotale = sezioniEsistenti
      ? `${sezioniEsistenti}\n\nTotale stimato già scritto per questa gara: ~${paginaStimataEsistenti} pagine (su ${PAROLE_PER_PAGINA_STIMATE} parole/pagina, stima approssimativa — non un conteggio Word reale). Sottrai questo dal limite massimo di pagine del disciplinare per capire quante ne restano per i criteri non ancora trattati.`
      : "";

    const systemPrompt = buildSystemPrompt(
      gara,
      company ?? null,
      contestoDocumenti,
      contestoKnowledgeBase,
      notaStileKnowledgeBase,
      struttureKnowledgeBase,
      sezioniEsistentiConTotale,
    );
    const anthropic = createAnthropicClient();

    const contenutoUltimoMessaggio: Anthropic.ContentBlockParam[] = [
      ...blocchiAllegati,
      { type: "text", text: messaggio || "Ho allegato dei file, guardali per favore." },
    ];

    const messages: Anthropic.MessageParam[] = [
      ...storico.map((m) => ({
        role: m.ruolo === "utente" ? ("user" as const) : ("assistant" as const),
        content: m.contenuto,
      })),
      { role: "user" as const, content: contenutoUltimoMessaggio },
    ];

    // Gli strumenti di generazione vengono tolti dopo il primo uso in
    // questa richiesta: l'istruzione nel prompt ("al massimo una volta")
    // non è una garanzia, questo lo è, ed evita anche round aggiuntivi
    // inutili (più lenti e più costosi).
    let strumentiDisponibili: Anthropic.Tool[] = [buildGeneraBozzaTool(gara), COMPONI_RELAZIONE_TOOL];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      // max_tokens era 16000: troppo poco per una sezione densa di più
      // decine di pagine (bug osservato in pratica — il cliente chiedeva
      // ~27 pagine e otteneva sistematicamente 8-10, nonostante l'AI
      // dichiarasse di aver scritto un contenuto "molto più esteso": il
      // testo veniva semplicemente troncato dal tetto). claude-sonnet-5
      // supporta fino a 128K token di output, ma le richieste NON in
      // streaming rischiano un timeout HTTP con max_tokens alti — quindi
      // streaming invece di .create(), stesso fix già applicato altrove
      // in questo codebase per lo stesso problema.
      const stream = anthropic.messages.stream({
        model: MODEL,
        max_tokens: 64000,
        // Ragionamento esteso ("adaptive", con effort massimo per questo
        // modello): prima di scrivere/generare, il modello pianifica
        // internamente (struttura, coerenza con l'archivio di
        // riferimento, quale sezione sostituire) invece di rispondere
        // "di getto" — riduce errori come sezioni duplicate o risposte
        // superficiali su richieste complesse.
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
        system: systemPrompt,
        tools: [WEB_SEARCH_TOOL, ...strumentiDisponibili],
        messages,
      });
      const response = await stream.finalMessage();

      await logAiUsage({
        userId: user.id,
        garaId,
        operazione: "chat_gara",
        provider: "anthropic",
        model: MODEL,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      });

      if (response.stop_reason === "max_tokens") {
        console.warn(
          `sendGaraMessage: risposta troncata per max_tokens al round ${round} (gara ${garaId}).`,
        );
      }

      const testoBlocco = response.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("\n")
        .trim();

      if (testoBlocco) {
        rispostaFinale = rispostaFinale ? `${rispostaFinale}\n${testoBlocco}` : testoBlocco;
      }

      if (response.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: response.content });
        continue;
      }

      const toolUses = response.content.filter(
        (block) =>
          block.type === "tool_use" &&
          (block.name === "genera_bozza_sezione" || block.name === "componi_relazione_finale"),
      );

      if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
        break;
      }

      messages.push({ role: "assistant", content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolUses) {
        if (toolUse.type !== "tool_use") continue;

        if (toolUse.name === "componi_relazione_finale") {
          try {
            const risultato = await componiRelazioneFinale({ garaId, userId: user.id });
            if ("error" in risultato) {
              toolResults.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: risultato.error,
                is_error: true,
              });
            } else {
              fileGenerato = risultato;
              strumentiDisponibili = [];
              console.log(
                `sendGaraMessage: relazione finale composta "${risultato.nomeFile}" (${risultato.filePath}) per gara ${garaId}`,
              );
              // Avviso secondario, in chat: la garanzia VERA è il confronto
              // deterministico pagine_stimate/limite_pagine_totale già
              // mostrato dalla UI accanto al pulsante di download (vedi
              // chat-section.tsx) — questo serve solo a far commentare
              // anche il testo della risposta, non a sostituire quel
              // controllo.
              const superaLimite =
                gara.limite_pagine_totale != null && Math.ceil(risultato.pagineStimate) > gara.limite_pagine_totale;
              toolResults.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: `Relazione finale "${risultato.nomeFile}" composta con successo da tutte le bozze (~${risultato.pagineStimate.toFixed(1)} pagine stimate${gara.limite_pagine_totale != null ? `, limite disciplinare ${gara.limite_pagine_totale}` : ""}). Il cliente la vede già come allegato scaricabile in cima al messaggio, con un avviso visivo se supera il limite: NON ripetere il nome del file nella tua risposta.${superaLimite ? " ATTENZIONE: nonostante il tentativo automatico di ridurla, la relazione supera ancora il limite di pagine del disciplinare — dillo chiaramente al cliente in 1-2 frasi, invitandolo a rivedere/accorciare il contenuto prima di consegnarla." : " Scrivi solo 1-2 frasi di conferma."}`,
              });
            }
          } catch (err) {
            console.error("Errore composizione relazione finale:", err);
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: "Errore nella composizione della relazione finale.",
              is_error: true,
            });
          }
          continue;
        }

        const input = toolUse.input as {
          titolo_sezione: string;
          titolo_relazione?: string;
          contenuto: string;
          font?: string;
          dimensione_carattere?: number;
          interlinea?: number;
        };
        try {
          // Sostituzione deterministica dei sub-criteri tabellari: la
          // sola istruzione nel prompt (anche ripetuta con l'elenco
          // specifico della gara, nel punto esatto in cui il modello
          // scrive il contenuto) si è dimostrata inaffidabile in pratica
          // — un sub-criterio nell'elenco tabellare continuava a essere
          // scritto per esteso a ogni rigenerazione. Qui il codice
          // sovrascrive SEMPRE il corpo dei sub-criteri elencati con la
          // dicitura corretta, indipendentemente da cosa scrive l'AI:
          // una garanzia, non un'ennesima richiesta al modello.
          const contenutoSenzaPlaceholder = applicaSostituzioniAnonimizzazione(input.contenuto, company?.ragione_sociale);
          const contenutoConMarcatori = applicaMarcatoriTabellari(contenutoSenzaPlaceholder, gara.sub_criteri_tabellari);

          const formattazioneCorrente = {
            dimensioneCarattere: gara.relazione_dimensione_carattere ?? input.dimensione_carattere ?? 12,
            interlinea: gara.relazione_interlinea ?? input.interlinea ?? 1,
          };
          const numeroCriterio = input.titolo_sezione.match(/^(\d+)/)?.[1];
          const criterioCorrispondente =
            numeroCriterio && gara.criteri_riepilogo
              ? gara.criteri_riepilogo.find((c) => c.numero.trim() === numeroCriterio)
              : undefined;

          // Correggiamo qui il contenuto PRIMA di costruire il documento —
          // non lasciamo che sia il cliente, tramite avanti-indietro in
          // chat, a scoprire lo scostamento e a chiedere di rigenerare.
          // Con i sotto-criteri del disciplinare, ogni sotto-criterio oltre
          // il proprio tetto (in proporzione ai punti) viene ridotto da
          // solo, sapendo cosa vale e cosa richiede, con il controllo che
          // nulla di richiesto vada perso; senza, resta il ciclo di
          // misura/correzione per criterio (4 tentativi, verso il target
          // con margine di sicurezza già usato per "componi relazione
          // finale"). Vedi correggiSezioneConBudget.
          const correzione = await correggiSezioneConBudget({
            titoloSezione: input.titolo_sezione,
            contenuto: contenutoConMarcatori,
            criteriValutazione: gara.criteri_valutazione,
            criteriRiepilogo: gara.criteri_riepilogo,
            punteggioTecnicoMax: gara.punteggio_tecnico_max,
            limitePagineTotale: gara.limite_pagine_totale,
            subCriteriTabellari: gara.sub_criteri_tabellari,
            formattazione: formattazioneCorrente,
            context: { userId: user.id, garaId },
          });
          const contenutoCorretto = correzione.contenuto;
          const pagineTarget = correzione.pagineTargetCriterio;
          for (const riga of correzione.esiti) console.log(`sendGaraMessage [${garaId}] ${riga}`);
          // Riapplicate dopo l'eventuale espansione/condensazione: quel
          // passaggio non sa nulla né dei marcatori tabellari né
          // dell'anonimizzazione, e può riscrivere/ampliare il testo
          // reintroducendo "l'operatore economico" al posto del nome
          // reale (bug osservato in pratica, stesso motivo dei marcatori
          // tabellari sotto).
          const contenutoFinale = applicaSostituzioniAnonimizzazione(
            applicaMarcatoriTabellari(contenutoCorretto, gara.sub_criteri_tabellari),
            company?.ragione_sociale,
          );

          const { nomeFile, filePath, pagineStimate } = await generaBozzaSezione({
            garaId,
            userId: user.id,
            titoloSezione: input.titolo_sezione,
            titoloRelazione: input.titolo_relazione,
            contenuto: contenutoFinale,
            companyProfile: company,
            contestoDocumenti,
            datiGaraStrutturati: formattaDatiGaraStrutturati(gara),
            font: input.font,
            dimensioneCarattere: input.dimensione_carattere,
            interlinea: input.interlinea,
          });
          fileGenerato = { nomeFile, filePath, pagineStimate };
          strumentiDisponibili = [];
          console.log(
            `sendGaraMessage: bozza generata "${nomeFile}" (${filePath}) per gara ${garaId}, sezione "${input.titolo_sezione}"`,
          );

          // Conteggio REALE (non a parole) delle pagine effettivamente
          // scritte (dopo l'eventuale correzione sopra), riportato al
          // modello come fatto compiuto — la correzione automatica non è
          // garantita al 100% (il modello resta impreciso anche quando
          // gli si chiede di aggiustare il tiro), quindi il feedback
          // esplicito resta comunque necessario come ultima rete.
          const pagineReali = stimaPagineContenuto(contenutoFinale, formattazioneCorrente);
          // pagineTarget ha due significati diversi a seconda di
          // correzione.modalita (vedi correggiSezioneConBudget): in
          // "criterio" è il target verso cui il testo è STATO corretto dal
          // vivo qui; in "sotto-criteri" non c'è più alcuna correzione dal
          // vivo (bug reale osservato in produzione, 504 Vercel Runtime
          // Timeout: generazione + fino a 3 tentativi di compressione per
          // sotto-criterio + verifica dati, tutto nella stessa richiesta
          // serverless, superava il limite di 60s) — è solo un avviso che
          // il criterio resta oltre il totale previsto, corretto per
          // davvero solo componendo la relazione finale.
          const infoTarget =
            correzione.modalita === "criterio" && pagineTarget !== null && criterioCorrispondente
              ? ` Target per l'intero criterio ${criterioCorrispondente.numero} (${criterioCorrispondente.punti_max}/${gara.punteggio_tecnico_max} punti): ~${pagineTarget.toFixed(1)} pagine totali (eventualmente da dividere tra più bozze se il criterio ha più sub-criteri e generi in invii separati) — la lunghezza è già stata corretta automaticamente verso questo target.`
              : "";
          // Con i tetti per sotto-criterio la lunghezza è un MASSIMO: un
          // testo sotto il tetto è corretto, e non va proposto di ampliarlo
          // per raggiungere un numero di pagine (il vecchio invito ad
          // ampliare vale solo per il budget per criterio).
          const istruzioneLunghezza =
            correzione.modalita === "sotto-criteri"
              ? pagineTarget !== null
                ? ` La lunghezza per sotto-criterio è vincolata da un tetto in proporzione ai punti già dato al modello in fase di scrittura (non una correzione automatica qui): il criterio risulta comunque sopra il totale previsto (~${pagineTarget.toFixed(1)} pagine) — dillo chiaramente al cliente in una frase, la riduzione avviene in automatico solo componendo la relazione finale. NON proporre di ampliare per raggiungere un numero di pagine. Scrivi solo 1-2 frasi su cosa contiene questa sezione.`
                : ` La lunghezza è controllata per sotto-criterio, con un tetto in proporzione ai punti già rispettato in fase di scrittura: NON proporre di ampliare per raggiungere un numero di pagine. Scrivi solo 1-2 frasi su cosa contiene questa sezione.`
              : ` Se questo numero è ANCORA sensibilmente sotto l'obiettivo (tuo o del cliente) nonostante la correzione automatica, dillo chiaramente nella risposta invece di dichiarare il target raggiunto, e proponi di ampliarla — non limitarti a descrivere quanto hai scritto "in astratto". Altrimenti scrivi solo 1-2 frasi su cosa contiene questa sezione.`;

          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: `Bozza "${nomeFile}" generata con successo — occupa REALMENTE circa ${pagineReali.toFixed(1)} pagine A4 (conteggio effettivo che tiene conto di tabelle/immagini, non una tua stima).${infoTarget} Il cliente la vede già come allegato scaricabile in cima al messaggio: NON ripetere il nome del file nella tua risposta.${istruzioneLunghezza}`,
          });
        } catch (err) {
          console.error("Errore generazione bozza sezione:", err);
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: "Errore nella generazione della bozza.",
            is_error: true,
          });
        }
      }

      messages.push({ role: "user", content: toolResults });
    }

    // Se dopo tutti i round non è stato accumulato testo (es. l'AI ha
    // incatenato solo ricerche/strumenti senza mai scrivere una risposta,
    // o abbiamo raggiunto il tetto di round), forziamo una risposta
    // testuale finale invece di mostrare un errore generico.
    if (!rispostaFinale.trim()) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage?.role === "user") {
        const wrapUp = await anthropic.messages.create({
          model: MODEL,
          max_tokens: 3000,
          system: systemPrompt,
          tool_choice: { type: "none" },
          messages,
        });

        await logAiUsage({
          userId: user.id,
          garaId,
          operazione: "chat_gara_wrapup",
          provider: "anthropic",
          model: MODEL,
          inputTokens: wrapUp.usage.input_tokens,
          outputTokens: wrapUp.usage.output_tokens,
        });

        rispostaFinale = wrapUp.content
          .map((block) => (block.type === "text" ? block.text : ""))
          .join("\n")
          .trim();
      }
    }
  } catch (err) {
    console.error("Errore chat gara:", err);
  }

  if (!rispostaFinale.trim()) {
    console.warn(
      "sendGaraMessage: nessun testo prodotto dal modello dopo il ciclo di strumenti.",
    );
  }

  const contenutoFinale =
    rispostaFinale ||
    "Non sono riuscito a completare la richiesta. Prova a riformularla in modo più semplice o dividila in passaggi più piccoli.";

  console.log(
    `sendGaraMessage: salvataggio messaggio finale per gara ${garaId}, fileGenerato=${
      fileGenerato ? fileGenerato.nomeFile : "nessuno"
    }`,
  );

  const { error: insertAiError } = await supabase.from("gara_messaggi").insert({
    gara_id: garaId,
    user_id: user.id,
    ruolo: "assistente",
    contenuto: contenutoFinale,
    file_nome: fileGenerato?.nomeFile ?? null,
    file_path: fileGenerato?.filePath ?? null,
    pagine_stimate: fileGenerato?.pagineStimate ?? null,
  });

  if (insertAiError) {
    console.error("Errore salvataggio risposta AI:", insertAiError);
  }

  revalidatePath(`/dashboard/omnia-ai/gare/${garaId}`);
  return {};
}
