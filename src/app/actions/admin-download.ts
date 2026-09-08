"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/require-admin";

export type AdminDownloadState = { error?: string; url?: string };

// Supabase Storage forza Content-Type: text/plain sui tipi "renderizzabili
// dal browser" (anti-XSS), quindi una signed URL diretta li mostra come
// testo grezzo invece di visualizzarli. Per questi passiamo dalla rotta
// /api/admin/product-file, che serve i bytes col Content-Type corretto.
const RENDERABLE_EXTENSIONS = new Set(["html", "htm", "svg", "xml"]);

// Azione separata da src/app/actions/download.ts: quel file gestisce il
// download del cliente (autorizzato da "ordine pagato") e resta invariato.
// Qui il controllo di autorizzazione è invece "utente admin", per
// permettere di verificare un file appena caricato indipendentemente
// dallo stato di un ordine.
export async function downloadProductFileAdmin(
  _prevState: AdminDownloadState,
  formData: FormData,
): Promise<AdminDownloadState> {
  if (!(await requireAdmin())) {
    return { error: "Non autorizzato." };
  }

  const fileId = String(formData.get("fileId") ?? "");
  if (!fileId) return {};

  const admin = createAdminClient();

  const { data: file } = await admin
    .from("product_files")
    .select("file_path")
    .eq("id", fileId)
    .single<{ file_path: string }>();

  if (!file) {
    return { error: "File non trovato." };
  }

  const ext = file.file_path.split(".").pop()?.toLowerCase() ?? "";
  if (RENDERABLE_EXTENSIONS.has(ext)) {
    return { url: `/api/admin/product-file/${fileId}` };
  }

  const { data: signed, error } = await admin.storage
    .from("documents")
    .createSignedUrl(file.file_path, 60);

  if (error || !signed) {
    return { error: "Errore nella generazione del link di download." };
  }

  return { url: signed.signedUrl };
}
