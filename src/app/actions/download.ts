"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type DownloadState = { error?: string; url?: string };

export async function downloadDocument(
  _prevState: DownloadState,
  formData: FormData,
): Promise<DownloadState> {
  const orderId = String(formData.get("orderId") ?? "");
  const fileId = String(formData.get("fileId") ?? "");
  if (!orderId || !fileId) return {};

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // La RLS ("orders_select_own") garantisce che questa query restituisca
  // l'ordine solo se appartiene all'utente corrente: nessun controllo
  // aggiuntivo su user_id necessario qui.
  const { data: order } = await supabase
    .from("orders")
    .select("id, status, product_id")
    .eq("id", orderId)
    .single<{ id: string; status: string; product_id: string | null }>();

  if (!order || order.status !== "pagato" || !order.product_id) {
    return { error: "Documento non disponibile." };
  }

  // Verifichiamo che il file richiesto appartenga davvero al prodotto di
  // questo ordine, non solo che l'id esista da qualche parte.
  const { data: file } = await supabase
    .from("product_files")
    .select("file_path")
    .eq("id", fileId)
    .eq("product_id", order.product_id)
    .single<{ file_path: string }>();

  if (!file) {
    return { error: "File non trovato." };
  }

  const admin = createAdminClient();
  // Il nome file va passato esplicitamente a { download }: con
  // { download: true } Supabase risponde con "Content-Disposition:
  // attachment;" senza filename, e senza estensione alcuni browser
  // salvano il file come .txt (per via del Content-Type text/plain
  // forzato su html/svg/xml, vedi commit precedente).
  const fileName = file.file_path.split("/").pop()!.replace(/^\d+-/, "");

  const { data: signed, error } = await admin.storage
    .from("documents")
    .createSignedUrl(file.file_path, 60, { download: fileName });

  if (error || !signed) {
    return { error: "Errore nella generazione del link di download." };
  }

  return { url: signed.signedUrl };
}

export async function downloadGaraDocumento(
  _prevState: DownloadState,
  formData: FormData,
): Promise<DownloadState> {
  const docId = String(formData.get("docId") ?? "");
  if (!docId) return {};

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // La RLS ("gara_documenti_all_own") garantisce che questa query
  // restituisca il documento solo se appartiene all'utente corrente.
  const { data: doc } = await supabase
    .from("gara_documenti")
    .select("file_path, nome_file")
    .eq("id", docId)
    .single<{ file_path: string; nome_file: string }>();

  if (!doc) {
    return { error: "Documento non trovato." };
  }

  const admin = createAdminClient();
  // Il nome file va passato esplicitamente a { download }: senza,
  // Supabase risponde senza "Content-Disposition: attachment" e il
  // browser apre il file in una nuova scheda invece di scaricarlo (bug
  // osservato in pratica) — stesso fix già applicato a downloadDocument.
  const { data: signed, error } = await admin.storage
    .from("gare")
    .createSignedUrl(doc.file_path, 60, { download: doc.nome_file });

  if (error || !signed) {
    return { error: "Errore nella generazione del link di download." };
  }

  return { url: signed.signedUrl };
}

export async function downloadGaraMessaggioFile(
  _prevState: DownloadState,
  formData: FormData,
): Promise<DownloadState> {
  const msgId = String(formData.get("msgId") ?? "");
  if (!msgId) return {};

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // La RLS ("gara_messaggi_all_own") garantisce che questa query
  // restituisca il messaggio solo se appartiene all'utente corrente.
  const { data: messaggio } = await supabase
    .from("gara_messaggi")
    .select("file_path, file_nome")
    .eq("id", msgId)
    .single<{ file_path: string | null; file_nome: string | null }>();

  if (!messaggio?.file_path) {
    return { error: "File non trovato." };
  }

  const admin = createAdminClient();
  // Vedi commento su downloadGaraDocumento: senza { download } il
  // documento generato si apre in una nuova scheda invece di scaricarsi.
  const { data: signed, error } = await admin.storage
    .from("gare")
    .createSignedUrl(messaggio.file_path, 60, {
      download: messaggio.file_nome ?? true,
    });

  if (error || !signed) {
    return { error: "Errore nella generazione del link di download." };
  }

  return { url: signed.signedUrl };
}

export async function downloadAllegatoMessaggio(
  _prevState: DownloadState,
  formData: FormData,
): Promise<DownloadState> {
  const allegatoId = String(formData.get("allegatoId") ?? "");
  if (!allegatoId) return {};

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // La RLS ("gara_messaggio_allegati_all_own") garantisce che questa
  // query restituisca l'allegato solo se appartiene all'utente corrente.
  const { data: allegato } = await supabase
    .from("gara_messaggio_allegati")
    .select("file_path")
    .eq("id", allegatoId)
    .single<{ file_path: string }>();

  if (!allegato) {
    return { error: "Allegato non trovato." };
  }

  const admin = createAdminClient();
  // Niente { download } qui, di proposito: il pulsante si chiama "Apri"
  // (non "Scarica") — immagini e PDF devono aprirsi nella scheda, non
  // scaricarsi forzatamente. Diverso da downloadGaraDocumento/
  // downloadGaraMessaggioFile sotto, dove il pulsante dice "Scarica".
  const { data: signed, error } = await admin.storage
    .from("gare")
    .createSignedUrl(allegato.file_path, 60);

  if (error || !signed) {
    return { error: "Errore nella generazione del link di download." };
  }

  return { url: signed.signedUrl };
}

export async function downloadInvoice(
  _prevState: DownloadState,
  formData: FormData,
): Promise<DownloadState> {
  const orderId = String(formData.get("orderId") ?? "");
  if (!orderId) return {};

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // La RLS ("invoices_select_own") garantisce che questa query restituisca
  // la fattura solo se l'ordine collegato appartiene all'utente corrente.
  const { data: invoice } = await supabase
    .from("invoices")
    .select("file_path")
    .eq("order_id", orderId)
    .single<{ file_path: string }>();

  if (!invoice) {
    return { error: "Fattura non trovata." };
  }

  const admin = createAdminClient();
  const { data: signed, error } = await admin.storage
    .from("invoices")
    .createSignedUrl(invoice.file_path, 60);

  if (error || !signed) {
    return { error: "Errore nella generazione del link di download." };
  }

  return { url: signed.signedUrl };
}
