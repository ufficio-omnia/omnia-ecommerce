"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAnthropicClient } from "@/lib/anthropic";
import { logAiUsage } from "@/lib/ai-usage";
import { consumeGaraQuotaIfNeeded } from "@/lib/gara-consumo";

export type ExtractionState = { error?: string; quotaEsaurita?: boolean };

const MODEL = "claude-sonnet-5";

const EXTRACTION_TOOL = {
  name: "estrai_dati_gara",
  description:
    "Registra i dati strutturati estratti dai documenti di una gara d'appalto.",
  input_schema: {
    type: "object" as const,
    properties: {
      scadenza: {
        type: "string",
        description:
          "Data di scadenza per la presentazione dell'offerta, formato YYYY-MM-DD. Ometti il campo se non è indicata nei documenti.",
      },
      importo: {
        type: "number",
        description:
          "Importo a base d'asta della gara, in euro, solo numero. Ometti il campo se non è indicato nei documenti.",
      },
      criteri_valutazione: {
        type: "string",
        description:
          "Struttura COMPLETA e LETTERALE dei criteri di valutazione dell'offerta tecnica, non un riassunto: riporta ogni criterio, ogni sub-criterio e OGNI singolo punto/lettera in cui un sub-criterio si articola (es. se il disciplinare scrive per il sub-criterio 1.1 tre punti 'a) ..., b) ..., c) ...', riportali tutti e tre per intero, non solo il titolo del sub-criterio), con la stessa numerazione/lettering usata dal disciplinare (es. 1, 1.1, 1.1.a — mantieni ESATTAMENTE lo schema del documento, non inventarne uno tuo se il disciplinare ne usa uno diverso, es. numeri romani o lettere maiuscole) e il punteggio massimo di ciascun livello dove indicato. Questo campo verrà usato per scrivere l'offerta tecnica punto per punto: ometterne anche solo uno o riassumerlo genericamente causa un errore grave (contenuto generato che non risponde a quanto richiesto). Se non specificati, scrivi 'Non specificati nei documenti forniti.'",
      },
      requisiti: {
        type: "string",
        description:
          "Riassunto dei requisiti di partecipazione richiesti (es. certificazioni, fatturato minimo, esperienza pregressa). Se non specificati, scrivi 'Non specificati nei documenti forniti.'",
      },
      limiti_formattazione: {
        type: "string",
        description:
          "Tutti i limiti di lunghezza/formattazione dell'offerta tecnica indicati dal disciplinare: numero massimo di pagine (per l'intera offerta tecnica e/o per singolo criterio/sotto-criterio), font/dimensione/interlinea richiesti, eventuali limiti su numero di caratteri o allegati. Riporta anche come i punteggi tecnici sono ripartiti tra i criteri se aiuta a capire quanto spazio dedicare a ciascuno (es. 'Criterio A: max 34/80 punti, Criterio B: max 20/80 punti'). Se non ci sono limiti espliciti, scrivi 'Nessun limite di pagine/formattazione specificato nei documenti forniti.'",
      },
      font_richiesto: {
        type: "string",
        description:
          "Nome del carattere/font richiesto dal disciplinare per l'offerta tecnica (es. 'Times New Roman', 'Arial'). Ometti il campo se non è specificato nei documenti.",
      },
      dimensione_carattere_richiesta: {
        type: "number",
        description:
          "Dimensione del carattere in punti richiesta dal disciplinare (es. 12). Ometti il campo se non è specificata.",
      },
      interlinea_richiesta: {
        type: "number",
        description:
          "Interlinea richiesta dal disciplinare come moltiplicatore (es. 1.5 per 'interlinea 1,5'). Ometti il campo se non è specificata.",
      },
      limite_pagine_totale: {
        type: "number",
        description:
          "Numero massimo di pagine/facciate consentite per l'intera offerta tecnica, solo il numero (es. 40). Ometti se il disciplinare non indica un limite complessivo (anche se indica limiti per singolo criterio).",
      },
      punteggio_tecnico_max: {
        type: "number",
        description: "Punteggio massimo totale dell'offerta tecnica (es. 80). Ometti se non specificato.",
      },
      punteggio_economico_max: {
        type: "number",
        description: "Punteggio massimo totale dell'offerta economica (es. 20). Ometti se non specificato.",
      },
      criteri_riepilogo: {
        type: "array",
        description:
          "Riepilogo sintetico SOLO dei criteri di primo livello (non i sub-criteri), uno per voce, per una tabella riassuntiva mostrata al cliente — non sostituisce 'criteri_valutazione' che resta il testo completo.",
        items: {
          type: "object",
          properties: {
            numero: { type: "string", description: "Numero/lettera del criterio così come nel disciplinare (es. '1', 'A')." },
            titolo: { type: "string", description: "Titolo del criterio, breve." },
            punti_max: { type: "number", description: "Punteggio massimo di questo criterio." },
          },
          required: ["numero", "titolo", "punti_max"],
        },
      },
      requisiti_chiave: {
        type: "array",
        description:
          "3-6 requisiti di partecipazione più rilevanti per il cliente in forma di frase breve e concreta (es. 'Fatturato minimo €12.566.251,09', 'Cauzione provvisoria 2% (€251.325,02)', 'Sopralluogo obbligatorio'), per un elenco sintetico mostrato al cliente — non sostituisce 'requisiti' che resta il testo completo.",
        items: { type: "string" },
      },
      sub_criteri_tabellari: {
        type: "array",
        description:
          "Codici dei sub-criteri (es. '2.2', '4.1' — usa la numerazione ESATTA del disciplinare) per cui il disciplinare NON richiede una descrizione/proposta tecnica ma la sola compilazione di una tabella, griglia o checklist di conformità già predisposta (riconoscibile da formulazioni come 'il concorrente barra le caratteristiche possedute', 'dichiara sì/no per ciascuna voce', 'compila la tabella allegata', 'autodichiarazione del possesso'). Questo elenco verrà usato per SALTARE la generazione di contenuto discorsivo per questi sub-criteri (verrà scritta solo una dicitura segnaposto): includi un sub-criterio SOLO se sei sicuro che non richieda alcun testo libero, nel dubbio ometti l'elemento. Lascia vuoto se il disciplinare non prevede sub-criteri di questo tipo.",
        items: { type: "string" },
      },
    },
    required: ["criteri_valutazione", "requisiti", "limiti_formattazione"],
  },
};

export async function extractGaraData(
  _prevState: ExtractionState,
  formData: FormData,
): Promise<ExtractionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Sessione scaduta, ricarica la pagina." };

  const garaId = String(formData.get("garaId") ?? "");
  if (!garaId) return { error: "Gara non valida." };

  // La RLS ("gare_all_own") garantisce che questa select restituisca la
  // gara solo se appartiene all'utente corrente.
  const { data: gara } = await supabase
    .from("gare")
    .select("id")
    .eq("id", garaId)
    .single<{ id: string }>();

  if (!gara) return { error: "Gara non trovata." };

  const { data: documenti } = await supabase
    .from("gara_documenti")
    .select("nome_file, file_path")
    .eq("gara_id", garaId)
    .returns<{ nome_file: string; file_path: string }[]>();

  const pdfDocs = (documenti ?? []).filter((d) =>
    d.nome_file.toLowerCase().endsWith(".pdf"),
  );

  if (pdfDocs.length === 0) {
    return {
      error:
        "Carica almeno un documento in formato PDF prima di avviare l'estrazione: al momento è l'unico formato analizzato automaticamente.",
    };
  }

  const consumo = await consumeGaraQuotaIfNeeded({ garaId, userId: user.id });
  if (consumo.error) {
    return { error: consumo.error, quotaEsaurita: true };
  }

  await supabase
    .from("gare")
    .update({ estrazione_stato: "in_corso" })
    .eq("id", garaId);

  try {
    const admin = createAdminClient();

    const documentBlocks = await Promise.all(
      pdfDocs.map(async (doc) => {
        const { data: file, error } = await admin.storage
          .from("gare")
          .download(doc.file_path);

        if (error || !file) {
          throw new Error(`Errore nel download di ${doc.nome_file}`);
        }

        const buffer = Buffer.from(await file.arrayBuffer());

        return {
          type: "document" as const,
          source: {
            type: "base64" as const,
            media_type: "application/pdf" as const,
            data: buffer.toString("base64"),
          },
        };
      }),
    );

    const anthropic = createAnthropicClient();

    const response = await anthropic.messages.create({
      model: MODEL,
      // criteri_valutazione ora richiede la struttura COMPLETA e
      // letterale (ogni sub-criterio ed ogni punto a)/b)/c), non un
      // riassunto): su bandi articolati può superare da sola diverse
      // migliaia di caratteri. Con un limite più basso la risposta
      // veniva troncata prima di completare tutti i campi (bug
      // osservato più volte: campi successivi come limiti_formattazione
      // o font/dimensione/interlinea restavano sempre vuoti).
      max_tokens: 8000,
      thinking: { type: "disabled" },
      tools: [EXTRACTION_TOOL],
      tool_choice: { type: "tool", name: "estrai_dati_gara" },
      messages: [
        {
          role: "user",
          content: [
            ...documentBlocks,
            {
              type: "text",
              text: "Questi sono i documenti di una gara d'appalto per servizi di pulizia. Estrai i dati richiesti usando lo strumento fornito.",
            },
          ],
        },
      ],
    });

    await logAiUsage({
      userId: user.id,
      garaId,
      operazione: "estrazione_gara",
      provider: "anthropic",
      model: MODEL,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });

    const toolUse = response.content.find(
      (block) => block.type === "tool_use" && block.name === "estrai_dati_gara",
    );

    if (!toolUse || toolUse.type !== "tool_use") {
      throw new Error("Nessun dato estratto dalla risposta AI.");
    }

    const result = toolUse.input as {
      scadenza?: string;
      importo?: number;
      criteri_valutazione: string;
      requisiti: string;
      limiti_formattazione: string;
      font_richiesto?: string;
      dimensione_carattere_richiesta?: number;
      interlinea_richiesta?: number;
      limite_pagine_totale?: number;
      punteggio_tecnico_max?: number;
      punteggio_economico_max?: number;
      criteri_riepilogo?: { numero: string; titolo: string; punti_max: number }[];
      requisiti_chiave?: string[];
      sub_criteri_tabellari?: string[];
    };

    // Font/dimensione/interlinea vengono fissati qui, appena i documenti
    // sono analizzati — non solo se l'AI se ne accorge per caso durante
    // la chat (rischio reale osservato: un bando specificava "carattere
    // 12, Times New Roman, interlinea 1,5" ma la generazione non ne ha
    // mai tenuto conto perché non era mai stato salvato). Non sovrascrive
    // un valore eventualmente già impostato (es. da una generazione
    // precedente a questa rianalisi).
    const { data: garaEsistente } = await supabase
      .from("gare")
      .select("relazione_font, relazione_dimensione_carattere, relazione_interlinea")
      .eq("id", garaId)
      .single<{
        relazione_font: string | null;
        relazione_dimensione_carattere: number | null;
        relazione_interlinea: number | null;
      }>();

    const { error: updateError } = await supabase
      .from("gare")
      .update({
        scadenza: result.scadenza || null,
        importo: result.importo ?? null,
        criteri_valutazione: result.criteri_valutazione,
        requisiti: result.requisiti,
        limiti_formattazione: result.limiti_formattazione,
        relazione_font: garaEsistente?.relazione_font ?? result.font_richiesto ?? null,
        relazione_dimensione_carattere:
          garaEsistente?.relazione_dimensione_carattere ?? result.dimensione_carattere_richiesta ?? null,
        relazione_interlinea: garaEsistente?.relazione_interlinea ?? result.interlinea_richiesta ?? null,
        limite_pagine_totale: result.limite_pagine_totale ?? null,
        punteggio_tecnico_max: result.punteggio_tecnico_max ?? null,
        punteggio_economico_max: result.punteggio_economico_max ?? null,
        criteri_riepilogo: result.criteri_riepilogo ?? null,
        requisiti_chiave: result.requisiti_chiave ?? null,
        sub_criteri_tabellari: result.sub_criteri_tabellari ?? null,
        estrazione_stato: "completata",
        estrazione_aggiornata_il: new Date().toISOString(),
      })
      .eq("id", garaId);

    if (updateError) {
      console.error("Errore salvataggio estrazione:", updateError);
      throw new Error("Errore nel salvataggio dei dati estratti.");
    }
  } catch (err) {
    console.error("Errore estrazione dati gara:", err);
    await supabase
      .from("gare")
      .update({ estrazione_stato: "errore" })
      .eq("id", garaId);

    revalidatePath(`/dashboard/omnia-ai/gare/${garaId}`);
    return {
      error:
        "Errore durante l'estrazione dei dati. Riprova tra qualche minuto.",
    };
  }

  revalidatePath(`/dashboard/omnia-ai/gare/${garaId}`);
  return {};
}
