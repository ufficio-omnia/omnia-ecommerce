"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/require-admin";
import { extractText, isIndexableFile, sanitizeFileName } from "@/lib/document-text";
import { anonymizeText } from "@/lib/anonymize";
import { extractStyleNotes, type ImmagineEstratta } from "@/lib/style-notes";
import { extractStrutturaTitoli } from "@/lib/template-structure";
import { chunkText } from "@/lib/chunk-text";
import { embedDocuments } from "@/lib/voyage";
import type { SupabaseClient } from "@supabase/supabase-js";

const EXTENSION_PER_TIPO: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

// Salva le immagini reali estratte da un documento (pagine PDF renderizzate,
// immagini incorporate in .docx) come libreria riutilizzabile: la
// nota_stile testuale da sola non basta più a far "vedere" a OMNIA AI
// tabelle/organigrammi/schemi reali durante la generazione, servono le
// immagini stesse allegabili alle chiamate future.
async function salvaImmaginiKnowledgeBase(
  admin: SupabaseClient,
  documentoId: string,
  immagini: ImmagineEstratta[],
): Promise<void> {
  const { data: esistenti } = await admin
    .from("knowledge_base_immagini")
    .select("storage_path")
    .eq("documento_id", documentoId);
  if (esistenti && esistenti.length > 0) {
    await admin.storage.from("knowledge-base").remove(esistenti.map((r) => r.storage_path as string));
  }
  await admin.from("knowledge_base_immagini").delete().eq("documento_id", documentoId);

  if (immagini.length === 0) return;

  const descrizioni = immagini.map((img) => img.descrizione);
  const embeddings = await embedDocuments(descrizioni);

  for (const [index, img] of immagini.entries()) {
    const estensione = EXTENSION_PER_TIPO[img.contentType] ?? "png";
    const storagePath = `immagini/${documentoId}/${index}.${estensione}`;

    const { error: uploadError } = await admin.storage
      .from("knowledge-base")
      .upload(storagePath, img.buffer, { contentType: img.contentType, upsert: true });

    if (uploadError) {
      console.error("Errore upload immagine knowledge base:", uploadError);
      continue;
    }

    const { error: insertError } = await admin.from("knowledge_base_immagini").insert({
      documento_id: documentoId,
      storage_path: storagePath,
      descrizione: img.descrizione,
      embedding: embeddings[index],
    });

    if (insertError) console.error("Errore salvataggio immagine knowledge base:", insertError);
  }
}

export type KnowledgeBaseState = { error?: string };

// Un solo embedding per documento (stile + struttura insieme): permette
// di recuperare per pertinenza gli esempi più adatti a ogni richiesta,
// invece di un taglio fisso sui primi N caricati — indispensabile con
// decine/centinaia di documenti in knowledge base.
async function embeddingStileStruttura(
  notaStile: string | null,
  strutturaTitoli: string | null,
): Promise<number[] | null> {
  const testo = [notaStile, strutturaTitoli].filter(Boolean).join("\n\n");
  if (!testo) return null;

  const [embedding] = await embedDocuments([testo]);
  return embedding;
}

export async function uploadKnowledgeBaseDocumento(
  _prevState: KnowledgeBaseState,
  formData: FormData,
): Promise<KnowledgeBaseState> {
  if (!(await requireAdmin())) return { error: "Non autorizzato." };

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "Seleziona un file da caricare." };
  if (!isIndexableFile(file.name)) {
    return { error: "Formato non supportato: carica un PDF o un Word (.docx)." };
  }

  const admin = createAdminClient();
  const filePath = `${Date.now()}-${sanitizeFileName(file.name)}`;

  const { error: uploadError } = await admin.storage
    .from("knowledge-base")
    .upload(filePath, file, { upsert: false });

  if (uploadError) {
    console.error("Errore upload knowledge base:", uploadError);
    return { error: "Errore nel caricamento del file." };
  }

  const { data: documento, error: insertError } = await admin
    .from("knowledge_base_documenti")
    .insert({ nome_file: file.name, file_path: filePath, stato: "in_elaborazione" })
    .select("id")
    .single<{ id: string }>();

  if (insertError || !documento) {
    console.error("Errore salvataggio documento knowledge base:", insertError);
    return { error: "Errore nel salvataggio del documento." };
  }

  // L'elaborazione (estrazione, anonimizzazione, indicizzazione) può
  // richiedere tempo su documenti lunghi: la facciamo comunque in modo
  // sincrono per semplicità, senza infrastruttura di job in background.
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const testo = await extractText(file.name, buffer);
    const [testoAnonimizzato, noteStile, strutturaTitoli] = await Promise.all([
      anonymizeText(testo),
      extractStyleNotes(file.name, buffer).catch((err) => {
        console.error("Errore estrazione nota di stile:", err);
        return null;
      }),
      extractStrutturaTitoli(file.name, buffer).catch((err) => {
        console.error("Errore estrazione struttura titoli:", err);
        return null;
      }),
    ]);
    const notaStile = noteStile?.notaStile ?? null;
    const chunks = chunkText(testoAnonimizzato);

    if (chunks.length === 0) {
      // Nessun testo utile estratto (es. documento scansionato/immagini):
      // non lo segniamo "pronto", altrimenti sembrerebbe indicizzato
      // mentre non ha prodotto nessun chunk cercabile dalla chat.
      await admin
        .from("knowledge_base_documenti")
        .update({ stato: "errore", nota_stile: notaStile })
        .eq("id", documento.id);
      revalidatePath("/admin/knowledge-base");
      return {
        error:
          "Nessun testo utilizzabile trovato in questo documento (potrebbe essere scansionato/basato su immagini). Non è stato indicizzato.",
      };
    }

    const embeddings = await embedDocuments(chunks);
    const rows = chunks.map((contenuto, index) => ({
      documento_id: documento.id,
      chunk_index: index,
      contenuto,
      embedding: embeddings[index],
    }));

    const { error: chunksError } = await admin
      .from("knowledge_base_chunks")
      .insert(rows);

    if (chunksError) throw chunksError;

    const stileEmbedding = await embeddingStileStruttura(notaStile, strutturaTitoli);

    await admin
      .from("knowledge_base_documenti")
      .update({
        stato: "pronto",
        nota_stile: notaStile,
        struttura_titoli: strutturaTitoli,
        stile_embedding: stileEmbedding,
      })
      .eq("id", documento.id);

    if (noteStile) {
      await salvaImmaginiKnowledgeBase(admin, documento.id, noteStile.immagini).catch((err) => {
        console.error("Errore salvataggio immagini knowledge base:", err);
      });
    }
  } catch (err) {
    console.error("Errore elaborazione documento knowledge base:", err);
    await admin
      .from("knowledge_base_documenti")
      .update({ stato: "errore" })
      .eq("id", documento.id);
    revalidatePath("/admin/knowledge-base");
    return {
      error:
        "Documento caricato ma l'elaborazione (anonimizzazione/indicizzazione) è fallita. Puoi eliminarlo e riprovare.",
    };
  }

  revalidatePath("/admin/knowledge-base");
  return {};
}

export async function ricalcolaStrutturaDocumento(
  _prevState: KnowledgeBaseState,
  formData: FormData,
): Promise<KnowledgeBaseState> {
  if (!(await requireAdmin())) return { error: "Non autorizzato." };

  const docId = String(formData.get("docId") ?? "");
  if (!docId) return { error: "Documento non valido." };

  const admin = createAdminClient();

  const { data: documento } = await admin
    .from("knowledge_base_documenti")
    .select("nome_file, file_path")
    .eq("id", docId)
    .maybeSingle<{ nome_file: string; file_path: string }>();

  if (!documento) return { error: "Documento non trovato." };

  const { data: esistente } = await admin
    .from("knowledge_base_documenti")
    .select("nota_stile")
    .eq("id", docId)
    .maybeSingle<{ nota_stile: string | null }>();

  const { data: file, error: downloadError } = await admin.storage
    .from("knowledge-base")
    .download(documento.file_path);

  if (downloadError || !file) {
    console.error("Errore download documento per struttura titoli:", downloadError);
    return { error: "Errore nel recupero del file." };
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const strutturaTitoli = await extractStrutturaTitoli(documento.nome_file, buffer);
    const stileEmbedding = await embeddingStileStruttura(
      esistente?.nota_stile ?? null,
      strutturaTitoli,
    );

    await admin
      .from("knowledge_base_documenti")
      .update({ struttura_titoli: strutturaTitoli, stile_embedding: stileEmbedding })
      .eq("id", docId);
  } catch (err) {
    console.error("Errore estrazione struttura titoli:", err);
    return { error: "Errore nell'analisi della struttura del documento." };
  }

  revalidatePath("/admin/knowledge-base");
  return {};
}

export async function deleteKnowledgeBaseDocumento(
  _prevState: KnowledgeBaseState,
  formData: FormData,
): Promise<KnowledgeBaseState> {
  if (!(await requireAdmin())) return { error: "Non autorizzato." };

  const docId = String(formData.get("docId") ?? "");
  if (!docId) return { error: "Documento non valido." };

  const admin = createAdminClient();

  const { data: documento } = await admin
    .from("knowledge_base_documenti")
    .select("file_path")
    .eq("id", docId)
    .maybeSingle<{ file_path: string }>();

  const { error } = await admin
    .from("knowledge_base_documenti")
    .delete()
    .eq("id", docId);

  if (error) {
    console.error("Errore eliminazione documento knowledge base:", error);
    return { error: "Errore nell'eliminazione del documento." };
  }

  if (documento?.file_path) {
    await admin.storage.from("knowledge-base").remove([documento.file_path]);
  }

  revalidatePath("/admin/knowledge-base");
  return {};
}
