import type Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAnthropicClient } from "@/lib/anthropic";
import { embedQuery } from "@/lib/voyage";
import { logAiUsage } from "@/lib/ai-usage";

const MODEL = "claude-sonnet-5";
const QUERY = "organigramma schema gerarchico struttura organizzativa aziendale caselle collegate";
const MAX_IMMAGINI = 3;

export type StileOrganigramma = {
  boxFill: string;
  boxStroke: string;
  boxRadius: number;
  connectorStroke: string;
  fontColor: string;
};

const STILE_TOOL: Anthropic.Tool = {
  name: "registra_stile_organigramma",
  description: "Registra lo stile grafico osservato negli organigrammi allegati (colori, forma delle caselle).",
  input_schema: {
    type: "object",
    properties: {
      box_fill: { type: "string", description: "Colore di riempimento prevalente delle caselle, esadecimale es. #2E86C1." },
      box_stroke: { type: "string", description: "Colore del bordo delle caselle, esadecimale." },
      box_radius: { type: "number", description: "Angoli delle caselle: 0 per angoli vivi/squadrati, un valore tra 4 e 14 per angoli arrotondati (più alto = più arrotondato)." },
      connector_stroke: { type: "string", description: "Colore delle linee di collegamento tra le caselle, esadecimale." },
      font_color: { type: "string", description: "Colore del testo dentro le caselle, esadecimale." },
    },
    required: ["box_fill", "box_stroke", "box_radius", "connector_stroke", "font_color"],
  },
};

// Cerca nella knowledge base immagini reali di organigrammi (per
// pertinenza semantica, non un tag manuale) e chiede a Claude di
// osservarle e restituire i parametri di stile grafico effettivamente
// usati (colori, forma delle caselle) — così l'organigramma che OMNIA AI
// disegna programmaticamente per il cliente assomiglia visivamente a
// quelli reali di OMNIA, non a uno stile fisso scelto a priori.
export async function ricavaStileOrganigramma(
  context: { userId: string | null; garaId: string | null },
): Promise<StileOrganigramma | null> {
  try {
    const supabase = await createClient();
    const queryEmbedding = await embedQuery(QUERY, {
      ...context,
      operazione: "organigramma_ricerca_stile",
    });

    const { data: immaginiRaw, error } = await supabase.rpc("match_knowledge_base_immagini", {
      query_embedding: queryEmbedding,
      match_count: MAX_IMMAGINI,
    });

    if (error) {
      console.error("Errore ricerca immagini organigramma:", error);
      return null;
    }

    const immagini = (immaginiRaw ?? []) as { storage_path: string; descrizione: string; similarity: number }[];
    // Sotto una certa soglia di pertinenza non ci sono probabilmente
    // organigrammi reali in knowledge base: meglio lo stile di default
    // che uno stile dedotto da immagini non pertinenti.
    const rilevanti = immagini.filter((img) => img.similarity > 0.4);
    if (rilevanti.length === 0) return null;

    const admin = createAdminClient();
    const download = await Promise.all(
      rilevanti.map((img) => admin.storage.from("knowledge-base").download(img.storage_path)),
    );

    const content: Anthropic.ContentBlockParam[] = [];
    for (const { data: file, error: dlErr } of download) {
      if (dlErr || !file) continue;
      const buffer = Buffer.from(await file.arrayBuffer());
      content.push({
        type: "image",
        source: { type: "base64", media_type: "image/png", data: buffer.toString("base64") },
      });
    }

    if (content.length === 0) return null;

    content.push({
      type: "text",
      text: "Osserva queste immagini (pagine/estratti di progetti tecnici reali che potrebbero contenere organigrammi/schemi gerarchici). Se contengono un organigramma o schema a caselle collegate, registra con lo strumento fornito lo stile grafico che usano (colore riempimento caselle, colore bordo, se gli angoli sono arrotondati o vivi, colore linee di collegamento, colore testo). Se nessuna immagine contiene un organigramma/schema del genere, registra comunque una stima ragionevole basata sui colori generali del documento (es. il colore del brand usato nei titoli).",
    });

    const anthropic = createAnthropicClient();
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 300,
      thinking: { type: "disabled" },
      tool_choice: { type: "tool", name: STILE_TOOL.name },
      tools: [STILE_TOOL],
      messages: [{ role: "user", content }],
    });

    await logAiUsage({
      userId: context.userId,
      garaId: context.garaId,
      operazione: "organigramma_stile",
      provider: "anthropic",
      model: MODEL,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return null;

    const input = toolUse.input as {
      box_fill?: string;
      box_stroke?: string;
      box_radius?: number;
      connector_stroke?: string;
      font_color?: string;
    };

    const hex = /^#[0-9a-fA-F]{6}$/;
    if (
      !input.box_fill || !hex.test(input.box_fill) ||
      !input.box_stroke || !hex.test(input.box_stroke) ||
      !input.connector_stroke || !hex.test(input.connector_stroke) ||
      !input.font_color || !hex.test(input.font_color) ||
      typeof input.box_radius !== "number"
    ) {
      return null;
    }

    return {
      boxFill: input.box_fill,
      boxStroke: input.box_stroke,
      boxRadius: Math.max(0, Math.min(20, input.box_radius)),
      connectorStroke: input.connector_stroke,
      fontColor: input.font_color,
    };
  } catch (err) {
    console.error("Errore ricavo stile organigramma:", err);
    return null;
  }
}
