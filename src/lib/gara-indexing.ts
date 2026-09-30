import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { chunkText } from "@/lib/chunk-text";
import { embedDocuments } from "@/lib/voyage";
import { extractText, isIndexableFile as isIndexableDocumentoTesto } from "@/lib/document-text";
import { convertiTabellaATesto, mediaTypeImmagine, categorizzaAllegato } from "@/lib/attachment-text";
import { createAnthropicClient, MODELLO_PRINCIPALE } from "@/lib/anthropic";
import { logAiUsage } from "@/lib/ai-usage";
import { ISTRUZIONI_TRASCRIZIONE_IMMAGINE } from "@/lib/prompts";

// Formati indicizzabili per un documento di gara: più ampio di
// isIndexableFile in document-text.ts (che resta solo PDF/Word — usato
// anche dall'archivio stile OMNIA gestito dall'admin, dove xlsx/immagini
// non hanno senso: nessuna nota di stile/struttura titoli da estrarne).
// Qui invece un cliente carica di tutto per una gara reale — tabelle Excel
// (elenchi personale, computi), screenshot di chiarimenti — e va reso
// cercabile comunque.
const ESTENSIONI_TABELLA = ["xlsx", "xls", "csv"];
const ESTENSIONI_IMMAGINE = ["png", "jpg", "jpeg", "gif", "webp"];
const ESTENSIONI_TESTO_SEMPLICE = ["txt"];

export function isIndexableFile(nomeFile: string): boolean {
  if (isIndexableDocumentoTesto(nomeFile)) return true;
  const estensione = nomeFile.toLowerCase().split(".").pop() ?? "";
  return ESTENSIONI_TABELLA.includes(estensione) || ESTENSIONI_IMMAGINE.includes(estensione) || ESTENSIONI_TESTO_SEMPLICE.includes(estensione);
}

// Limite dimensione per la trascrizione immagine: stesso limite già
// applicato agli allegati immagine in chat (attachment-text.ts), per
// coerenza — oltre non ha senso mandarla comunque al modello.
const LIMITE_BYTE_IMMAGINE = 5 * 1024 * 1024;

// Trascrive un'immagine (screenshot di un chiarimento, pagina scansionata)
// in testo Markdown con il modello — Voyage (l'embedding usato per la
// ricerca RAG) lavora solo su testo, quindi l'immagine deve diventare
// testo UNA VOLTA SOLA qui, al caricamento del documento, non reinviata
// come immagine a ogni ricerca futura nella chat. Sempre il modello
// principale (mai modelloAttivo/leggero): questo testo entra
// permanentemente nella base di conoscenza cercabile della gara, non è una
// prova di meccanismo — un errore di trascrizione qui si ripropone in ogni
// futura ricerca su quel documento.
export async function trascriviImmagine(nomeFile: string, buffer: Buffer, context: { userId: string | null; garaId: string | null }): Promise<string> {
  if (buffer.length > LIMITE_BYTE_IMMAGINE) {
    throw new Error(`Immagine troppo grande per la trascrizione (${(buffer.length / 1024 / 1024).toFixed(1)} MB, limite 5 MB).`);
  }
  const anthropic = createAnthropicClient();
  const response = await anthropic.messages.create({
    model: MODELLO_PRINCIPALE,
    max_tokens: 8000,
    thinking: { type: "disabled" },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaTypeImmagine(nomeFile), data: buffer.toString("base64") } },
          { type: "text", text: ISTRUZIONI_TRASCRIZIONE_IMMAGINE },
        ],
      },
    ],
  });

  await logAiUsage({
    userId: context.userId,
    garaId: context.garaId,
    operazione: "trascrizione_immagine_gara",
    provider: "anthropic",
    model: MODELLO_PRINCIPALE,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });

  return response.content.map((b) => (b.type === "text" ? b.text : "")).join("\n").trim();
}

// Estrae il testo indicizzabile di un documento di gara in QUALSIASI dei
// formati accettati da isIndexableFile — PDF/Word delegano a
// document-text.ts (invariato), Excel/CSV alla stessa conversione già
// usata per gli allegati in chat (attachment-text.ts, un'unica
// implementazione), le immagini alla trascrizione sopra (l'unico formato
// che richiede una chiamata al modello, quindi l'unico per cui questa
// funzione ha bisogno del context per registrarne il costo).
async function extractGaraDocumentText(nomeFile: string, buffer: Buffer, context: { userId: string | null; garaId: string | null }): Promise<string> {
  if (isIndexableDocumentoTesto(nomeFile)) return extractText(nomeFile, buffer);
  if (categorizzaAllegato(nomeFile) === "immagine") return trascriviImmagine(nomeFile, buffer, context);
  const estensione = nomeFile.toLowerCase().split(".").pop() ?? "";
  if (ESTENSIONI_TESTO_SEMPLICE.includes(estensione)) return buffer.toString("utf-8");
  return convertiTabellaATesto(nomeFile, buffer);
}

export async function indexGaraDocumento(params: {
  garaId: string;
  documentoId: string;
  userId: string;
  nomeFile: string;
  filePath: string;
}): Promise<void> {
  const { garaId, documentoId, userId, nomeFile, filePath } = params;

  const admin = createAdminClient();
  const { data: file, error: downloadError } = await admin.storage
    .from("gare")
    .download(filePath);

  if (downloadError || !file) {
    throw new Error("Errore nel download del documento per l'indicizzazione.");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const testo = await extractGaraDocumentText(nomeFile, buffer, { userId, garaId });
  const chunks = chunkText(testo);

  if (chunks.length === 0) return;

  const embeddings = await embedDocuments(chunks, {
    userId,
    garaId,
    operazione: "indicizzazione_documento_gara",
  });

  const supabase = await createClient();
  const rows = chunks.map((contenuto, index) => ({
    documento_id: documentoId,
    gara_id: garaId,
    user_id: userId,
    chunk_index: index,
    contenuto,
    embedding: embeddings[index],
  }));

  const { error: insertError } = await supabase
    .from("gara_documenti_chunks")
    .insert(rows);

  if (insertError) {
    console.error("Errore salvataggio chunk indicizzazione:", insertError);
    throw new Error("Errore nel salvataggio dell'indicizzazione.");
  }
}
