"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function downloadDocument(formData: FormData) {
  const orderId = String(formData.get("orderId") ?? "");
  const fileId = String(formData.get("fileId") ?? "");
  if (!orderId || !fileId) return;

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
    redirect("/dashboard");
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
    redirect("/dashboard");
  }

  const admin = createAdminClient();
  const { data: signed, error } = await admin.storage
    .from("documents")
    .createSignedUrl(file.file_path, 60);

  if (error || !signed) {
    redirect("/dashboard");
  }

  redirect(signed.signedUrl);
}

export async function downloadInvoice(formData: FormData) {
  const orderId = String(formData.get("orderId") ?? "");
  if (!orderId) return;

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
    redirect("/dashboard");
  }

  const admin = createAdminClient();
  const { data: signed, error } = await admin.storage
    .from("invoices")
    .createSignedUrl(invoice.file_path, 60);

  if (error || !signed) {
    redirect("/dashboard");
  }

  redirect(signed.signedUrl);
}
