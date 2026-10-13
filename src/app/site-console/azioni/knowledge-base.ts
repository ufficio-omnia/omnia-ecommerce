"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { richiediAdminAzione } from "@/lib/console/accesso";
import { extractText, isIndexableFile, sanitizeFileName } from "@/lib/document-text";
import { anonymizeText } from "@/lib/anonymize";
import { extractStyleNotes, type ImmagineEstratta } from "@/lib/style-notes";
import { extractStrutturaTitoli } from "@/lib/template-structure";
import { chunkText } from "@/lib/chunk-text";
import { embedDocuments } from "@/lib/voyage";

// Knowledge base di OMNIA AI: carica, ricalcola la struttura ed elimina i documenti
// (spostata dal vecchio pannello admin dell'e-commerce; la pipeline è la stessa).
// Ogni documento caricato fa chiamate vere ai modelli (anonimizzazione, note di
// stile, embedding): costano denaro e finiscono tra i costi di piattaforma.
// Ogni azione parte da richiediAdminAzione().

export type StatoKnowledgeBase = { errore?: string; ok?: boolean };

const PESO_MASSIMO_BYTE = 25 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ricarica() {
  revalidatePath("/site-console", "layout");
}

const EXTENSION_PER_TIPO: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

// Salva le immagini reali estratte da un documento (pagine PDF renderizzate,
// immagini incorporate in .docx) come libreria riutilizzabile: la nota_stile
// testuale da sola non basta a far "vedere" a OMNIA AI tabelle/organigrammi/schemi
// reali durante la generazione, servono le immagini stesse allegabili alle
// chiamate future.
async function salvaImmaginiKnowledgeBase(admin: SupabaseClient, documentoId: string, immagini: ImmagineEstratta[]): Promise<void> {
  const { data: esistenti } = await admin.from("knowledge_base_immagini").select("storage_path").eq("documento_id", documentoId);
  if (esistenti && esistenti.length > 0) {
    await admin.storage.from("knowledge-base").remove(esistenti.map((r) => r.storage_path as string));
  }
  await admin.from("knowledge_base_immagini").delete().eq("documento_id", documentoId);

  if (immagini.length === 0) return;

  const embeddings = await embedDocuments(
    immagini.map((img) => img.descrizione),
    { userId: null, garaId: null, operazione: "kb_embedding_immagini" },
  );

  for (const [index, img] of immagini.entries()) {
    const estensione = EXTENSION_PER_TIPO[img.contentType] ?? "png";
    const storagePath = `immagini/${documentoId}/${index}.${estensione}`;

    const { error: uploadError } = await admin.storage.from("knowledge-base").upload(storagePath, img.buffer, { contentType: img.contentType, upsert: true });
    if (uploadError) {
      console.error("Console: upload di un'immagine della knowledge base fallito", uploadError.message);
      continue;
    }

    const { error: insertError } = await admin.from("knowledge_base_immagini").insert({
      documento_id: documentoId,
      storage_path: storagePath,
      descrizione: img.descrizione,
      embedding: embeddings[index],
    });
    if (insertError) console.error("Console: salvataggio di un'immagine della knowledge base fallito", insertError.message);
  }
}

// Un solo embedding per documento (stile + struttura insieme): permette di
// recuperare per pertinenza gli esempi più adatti a ogni richiesta, invece di un
// taglio fisso sui primi N caricati — indispensabile con decine o centinaia di documenti.
async function embeddingStileStruttura(notaStile: string | null, strutturaTitoli: string | null): Promise<number[] | null> {
  const testo = [notaStile, strutturaTitoli].filter(Boolean).join("\n\n");
  if (!testo) return null;

  const [embedding] = await embedDocuments([testo], { userId: null, garaId: null, operazione: "kb_embedding_stile_struttura" });
  return embedding;
}

export async function caricaDocumento(_stato: StatoKnowledgeBase, formData: FormData): Promise<StatoKnowledgeBase> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { errore: "Seleziona un file da caricare." };
  if (!isIndexableFile(file.name)) return { errore: "Formato non supportato: carica un PDF o un Word (.docx)." };
  if (file.size > PESO_MASSIMO_BYTE) return { errore: `Il file supera i ${PESO_MASSIMO_BYTE / 1024 / 1024} MB.` };

  const admin = createAdminClient();
  const filePath = `${Date.now()}-${sanitizeFileName(file.name)}`;

  const { error: uploadError } = await admin.storage.from("knowledge-base").upload(filePath, file, { upsert: false });
  if (uploadError) {
    console.error("Console: upload nella knowledge base fallito", uploadError.message);
    return { errore: "Errore nel caricamento del file." };
  }

  const { data: documento, error: insertError } = await admin
    .from("knowledge_base_documenti")
    .insert({ nome_file: file.name, file_path: filePath, stato: "in_elaborazione" })
    .select("id")
    .single<{ id: string }>();
  if (insertError || !documento) {
    console.error("Console: salvataggio del documento nella knowledge base fallito", insertError?.message);
    // il file non ha una riga che lo usa: non si lascia nello storage
    await admin.storage.from("knowledge-base").remove([filePath]);
    return { errore: "Errore nel salvataggio del documento." };
  }

  // L'elaborazione (estrazione, anonimizzazione, indicizzazione) può richiedere
  // tempo su documenti lunghi: si fa in modo sincrono, senza una coda di lavori; la
  // pagina dichiara un maxDuration per questo.
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const testo = await extractText(file.name, buffer);
    const [testoAnonimizzato, noteStile, strutturaTitoli] = await Promise.all([
      anonymizeText(testo),
      extractStyleNotes(file.name, buffer).catch((err) => {
        console.error("Console: estrazione della nota di stile fallita", err);
        return null;
      }),
      extractStrutturaTitoli(file.name, buffer).catch((err) => {
        console.error("Console: estrazione della struttura dei titoli fallita", err);
        return null;
      }),
    ]);
    const notaStile = noteStile?.notaStile ?? null;
    const chunks = chunkText(testoAnonimizzato);

    if (chunks.length === 0) {
      // Nessun testo utile estratto (es. documento scansionato o fatto di immagini):
      // non lo si segna «pronto», altrimenti sembrerebbe indicizzato mentre non ha
      // prodotto nessun pezzo cercabile dalla chat.
      await admin.from("knowledge_base_documenti").update({ stato: "errore", nota_stile: notaStile }).eq("id", documento.id);
      ricarica();
      return { errore: "Nessun testo utilizzabile trovato in questo documento (potrebbe essere scansionato o basato su immagini). Non è stato indicizzato." };
    }

    const embeddings = await embedDocuments(chunks, { userId: null, garaId: null, operazione: "kb_embedding_documento" });
    const righe = chunks.map((contenuto, index) => ({ documento_id: documento.id, chunk_index: index, contenuto, embedding: embeddings[index] }));

    const { error: chunksError } = await admin.from("knowledge_base_chunks").insert(righe);
    if (chunksError) throw chunksError;

    const stileEmbedding = await embeddingStileStruttura(notaStile, strutturaTitoli);

    await admin
      .from("knowledge_base_documenti")
      .update({ stato: "pronto", nota_stile: notaStile, struttura_titoli: strutturaTitoli, stile_embedding: stileEmbedding })
      .eq("id", documento.id);

    if (noteStile) {
      await salvaImmaginiKnowledgeBase(admin, documento.id, noteStile.immagini).catch((err) => {
        console.error("Console: salvataggio delle immagini della knowledge base fallito", err);
      });
    }
  } catch (err) {
    console.error("Console: elaborazione del documento della knowledge base fallita", err);
    await admin.from("knowledge_base_documenti").update({ stato: "errore" }).eq("id", documento.id);
    ricarica();
    return { errore: "Documento caricato ma l'elaborazione (anonimizzazione e indicizzazione) è fallita. Eliminalo dall'elenco e riprova." };
  }

  ricarica();
  return { ok: true };
}

export async function ricalcolaStruttura(_stato: StatoKnowledgeBase, formData: FormData): Promise<StatoKnowledgeBase> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const docId = String(formData.get("docId") ?? "");
  if (!UUID.test(docId)) return { errore: "Documento non valido." };

  const admin = createAdminClient();
  const { data: documento } = await admin
    .from("knowledge_base_documenti")
    .select("nome_file, file_path, nota_stile")
    .eq("id", docId)
    .maybeSingle<{ nome_file: string; file_path: string; nota_stile: string | null }>();
  if (!documento) return { errore: "Documento non trovato." };

  const { data: file, error: downloadError } = await admin.storage.from("knowledge-base").download(documento.file_path);
  if (downloadError || !file) {
    console.error("Console: download del documento per la struttura dei titoli fallito", downloadError?.message);
    return { errore: "Errore nel recupero del file." };
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const strutturaTitoli = await extractStrutturaTitoli(documento.nome_file, buffer);
    const stileEmbedding = await embeddingStileStruttura(documento.nota_stile, strutturaTitoli);

    await admin.from("knowledge_base_documenti").update({ struttura_titoli: strutturaTitoli, stile_embedding: stileEmbedding }).eq("id", docId);
  } catch (err) {
    console.error("Console: estrazione della struttura dei titoli fallita", err);
    return { errore: "Errore nell'analisi della struttura del documento." };
  }

  ricarica();
  return { ok: true };
}

export async function eliminaDocumento(_stato: StatoKnowledgeBase, formData: FormData): Promise<StatoKnowledgeBase> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const docId = String(formData.get("docId") ?? "");
  if (!UUID.test(docId)) return { errore: "Documento non valido." };

  const admin = createAdminClient();
  const { data: documento } = await admin.from("knowledge_base_documenti").select("file_path").eq("id", docId).maybeSingle<{ file_path: string }>();
  if (!documento) return { errore: "Documento non trovato." };

  // Le immagini estratte hanno il file nello storage: la cascata del database tocca
  // le righe, non i file. Si leggono prima di cancellare.
  const { data: immagini } = await admin.from("knowledge_base_immagini").select("storage_path").eq("documento_id", docId);

  const { error } = await admin.from("knowledge_base_documenti").delete().eq("id", docId);
  if (error) {
    console.error("Console: eliminazione del documento della knowledge base fallita", error.message);
    return { errore: "Errore nell'eliminazione del documento." };
  }

  const percorsi = [documento.file_path, ...((immagini ?? []) as { storage_path: string }[]).map((i) => i.storage_path)];
  await admin.storage.from("knowledge-base").remove(percorsi);

  ricarica();
  return { ok: true };
}
