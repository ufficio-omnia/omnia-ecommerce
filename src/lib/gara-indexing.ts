import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { chunkText } from "@/lib/chunk-text";
import { embedDocuments } from "@/lib/voyage";
import { extractText } from "@/lib/document-text";

export { isIndexableFile } from "@/lib/document-text";

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
  const testo = await extractText(nomeFile, buffer);
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
