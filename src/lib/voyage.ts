import { logAiUsage, type AiUsageContext } from "@/lib/ai-usage";

const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const MODEL = "voyage-4";

type VoyageResponse = {
  data: { embedding: number[]; index: number }[];
  // Non tipato/letto finora da questo file: se presente nella risposta
  // reale, viene registrato in ai_operazioni; se assente, il costo resta
  // semplicemente non calcolabile per quella chiamata (mai inventato).
  usage?: { total_tokens?: number };
};

// Unico punto di aggancio per il logging costi lato Voyage: embedDocuments
// ed embedQuery passano entrambe da qui, quindi un solo posto registra
// ogni chiamata reale, indipendentemente da chi la origina.
async function embed(
  texts: string[],
  inputType: "document" | "query",
  context: AiUsageContext,
): Promise<number[][]> {
  const response = await fetch(VOYAGE_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input: texts, model: MODEL, input_type: inputType }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Errore Voyage AI (${response.status}): ${body}`);
  }

  const data = (await response.json()) as VoyageResponse;

  await logAiUsage({
    userId: context.userId,
    garaId: context.garaId,
    operazione: context.operazione,
    provider: "voyage",
    model: MODEL,
    inputTokens: data.usage?.total_tokens ?? null,
    outputTokens: null,
  });

  return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

export async function embedDocuments(
  texts: string[],
  context: AiUsageContext,
): Promise<number[][]> {
  return embed(texts, "document", context);
}

export async function embedQuery(text: string, context: AiUsageContext): Promise<number[]> {
  const [embedding] = await embed([text], "query", context);
  return embedding;
}
