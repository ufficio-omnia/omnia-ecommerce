"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { indexGaraDocumento, isIndexableFile } from "@/lib/gara-indexing";
import { sanitizeFileName } from "@/lib/document-text";

export type GaraState = { error?: string; warning?: string };

export async function createGara(
  _prevState: GaraState,
  formData: FormData,
): Promise<GaraState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Sessione scaduta, ricarica la pagina." };

  const titolo = String(formData.get("titolo") ?? "").trim();
  if (!titolo) return { error: "Inserisci un titolo per la gara." };

  const { data: gara, error } = await supabase
    .from("gare")
    .insert({ user_id: user.id, titolo })
    .select("id")
    .single<{ id: string }>();

  if (error || !gara) {
    console.error("Errore creazione gara:", error);
    return { error: "Errore nella creazione della gara." };
  }

  revalidatePath("/dashboard/omnia-ai/gare");
  redirect(`/dashboard/omnia-ai/gare/${gara.id}`);
}

export async function deleteGara(
  _prevState: GaraState,
  formData: FormData,
): Promise<GaraState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Sessione scaduta, ricarica la pagina." };

  const garaId = String(formData.get("garaId") ?? "");
  if (!garaId) return { error: "Gara non valida." };

  // Recuperiamo i percorsi dei file prima di eliminare la gara: le righe
  // in "gara_documenti"/"gara_messaggi" vengono cancellate a cascata dal
  // DB, ma i file nello storage no, vanno rimossi a parte. I documenti
  // generati dall'AI in chat sono referenziati da gara_messaggi.file_path,
  // non da gara_documenti.
  const [{ data: docs }, { data: msgFiles }] = await Promise.all([
    supabase.from("gara_documenti").select("file_path").eq("gara_id", garaId),
    supabase
      .from("gara_messaggi")
      .select("file_path")
      .eq("gara_id", garaId)
      .not("file_path", "is", null),
  ]);

  const { error } = await supabase.from("gare").delete().eq("id", garaId);

  if (error) {
    console.error("Errore eliminazione gara:", error);
    return { error: "Errore nell'eliminazione della gara." };
  }

  const filePaths = [...(docs ?? []), ...(msgFiles ?? [])]
    .map((d) => d.file_path)
    .filter((p): p is string => Boolean(p));

  if (filePaths.length) {
    const admin = createAdminClient();
    await admin.storage.from("gare").remove(filePaths);
  }

  redirect("/dashboard/omnia-ai/gare");
}

export async function uploadGaraDocumento(
  _prevState: GaraState,
  formData: FormData,
): Promise<GaraState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Sessione scaduta, ricarica la pagina." };

  const garaId = String(formData.get("garaId") ?? "");
  const file = formData.get("file") as File | null;

  if (!garaId || !file || file.size === 0) {
    return { error: "Seleziona un file da caricare." };
  }

  // La RLS ("gare_all_own") garantisce che questa select restituisca la
  // gara solo se appartiene all'utente corrente.
  const { data: gara } = await supabase
    .from("gare")
    .select("id")
    .eq("id", garaId)
    .single<{ id: string }>();

  if (!gara) return { error: "Gara non trovata." };

  // Il bucket "gare" accetta upload solo da admin via RLS storage: usiamo
  // la service role, come già fatto per fatture/documenti prodotto,
  // dopo aver verificato manualmente sopra che la gara sia dell'utente.
  const admin = createAdminClient();
  const filePath = `${garaId}/${Date.now()}-${sanitizeFileName(file.name)}`;

  const { error: uploadError } = await admin.storage
    .from("gare")
    .upload(filePath, file, { upsert: false });

  if (uploadError) {
    console.error("Errore upload documento gara:", uploadError);
    return { error: "Errore nel caricamento del file." };
  }

  const { data: nuovoDocumento, error: insertError } = await supabase
    .from("gara_documenti")
    .insert({
      gara_id: garaId,
      user_id: user.id,
      nome_file: file.name,
      file_path: filePath,
    })
    .select("id")
    .single<{ id: string }>();

  if (insertError || !nuovoDocumento) {
    console.error("Errore salvataggio documento gara:", insertError);
    return { error: "Errore nel salvataggio del documento." };
  }

  let warning: string | undefined;
  if (isIndexableFile(file.name)) {
    try {
      await indexGaraDocumento({
        garaId,
        documentoId: nuovoDocumento.id,
        userId: user.id,
        nomeFile: file.name,
        filePath,
      });
    } catch (err) {
      console.error("Errore indicizzazione documento gara:", err);
      warning =
        "Documento caricato, ma non è stato possibile prepararlo per la chat AI. Riprova ricaricandolo o contattaci.";
    }
  } else {
    warning =
      "Documento caricato, ma il formato non è supportato per la chat AI (solo PDF e Word .docx). Se il file è un vecchio .doc, risalvalo come .docx da Word e ricaricalo.";
  }

  revalidatePath(`/dashboard/omnia-ai/gare/${garaId}`);
  return { warning };
}

export async function removeGaraDocumento(
  _prevState: GaraState,
  formData: FormData,
): Promise<GaraState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Sessione scaduta, ricarica la pagina." };

  const docId = String(formData.get("docId") ?? "");
  const garaId = String(formData.get("garaId") ?? "");
  if (!docId) return { error: "Documento non valido." };

  const { data: doc } = await supabase
    .from("gara_documenti")
    .select("file_path")
    .eq("id", docId)
    .single<{ file_path: string }>();

  if (!doc) return { error: "Documento non trovato." };

  const { error } = await supabase
    .from("gara_documenti")
    .delete()
    .eq("id", docId);

  if (error) {
    console.error("Errore eliminazione documento gara:", error);
    return { error: "Errore nell'eliminazione del documento." };
  }

  const admin = createAdminClient();
  await admin.storage.from("gare").remove([doc.file_path]);

  if (garaId) revalidatePath(`/dashboard/omnia-ai/gare/${garaId}`);
  return {};
}

const ESTENSIONE_LOGO_PER_TIPO: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

// Logo della stazione appaltante/committente: specifico di questa gara
// (a differenza del logo aziendale e del logo software, fissi sul
// profilo azienda), usato da OMNIA AI per inserirlo negli organigrammi
// generati per questa gara.
export async function uploadGaraLogoCliente(
  _prevState: GaraState,
  formData: FormData,
): Promise<GaraState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Sessione scaduta, ricarica la pagina." };

  const garaId = String(formData.get("garaId") ?? "");
  const file = formData.get("logo") as File | null;
  if (!garaId || !file || file.size === 0) {
    return { error: "Seleziona un'immagine da caricare." };
  }

  const estensione = ESTENSIONE_LOGO_PER_TIPO[file.type];
  if (!estensione) {
    return { error: "Formato non supportato: carica un'immagine PNG, JPEG o WEBP." };
  }

  // La RLS ("gare_all_own") garantisce che questa select restituisca la
  // gara solo se appartiene all'utente corrente.
  const { data: gara } = await supabase.from("gare").select("id").eq("id", garaId).single<{ id: string }>();
  if (!gara) return { error: "Gara non trovata." };

  const path = `${garaId}/logo-cliente.${estensione}`;
  const admin = createAdminClient();
  const { error: uploadError } = await admin.storage
    .from("gare")
    .upload(path, file, { contentType: file.type, upsert: true });

  if (uploadError) {
    console.error("Errore upload logo cliente:", uploadError);
    return { error: "Errore nel caricamento del logo." };
  }

  const { error: updateError } = await supabase
    .from("gare")
    .update({ logo_cliente_path: path })
    .eq("id", garaId);

  if (updateError) {
    console.error("Errore salvataggio logo cliente:", updateError);
    return { error: "Errore nel salvataggio del logo." };
  }

  revalidatePath(`/dashboard/omnia-ai/gare/${garaId}`);
  return {};
}
