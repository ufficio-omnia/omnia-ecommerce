"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { requireAdmin } from "@/lib/require-admin";

type DeleteState = { error?: string };

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export async function markOrderAsPaid(formData: FormData) {
  const orderId = String(formData.get("orderId") ?? "");
  if (!orderId) return;
  if (!(await requireAdmin())) return;

  const admin = createAdminClient();

  const { error: updateError } = await admin
    .from("orders")
    .update({ status: "pagato" })
    .eq("id", orderId);

  if (updateError) {
    console.error("Errore aggiornamento ordine:", updateError);
    return;
  }

  const { data: order, error: fetchError } = await admin
    .from("orders")
    .select("users(email), products(title)")
    .eq("id", orderId)
    .single<{
      users: { email: string } | null;
      products: { title: string } | null;
    }>();

  if (fetchError) {
    console.error("Errore recupero dati ordine per email:", fetchError);
  }

  if (order?.users?.email) {
    await sendEmail({
      to: order.users.email,
      subject: "Il tuo documento è pronto per il download",
      html: `<p>Il pagamento del tuo ordine è stato confermato.</p><p>Il documento <strong>${order.products?.title ?? ""}</strong> è ora disponibile nella tua area riservata.</p><p><a href="${siteUrl}/dashboard">Vai alla dashboard</a></p>`,
    });
  }

  revalidatePath("/admin");
}

export async function deleteOrder(
  _prevState: DeleteState,
  formData: FormData,
): Promise<DeleteState> {
  if (!(await requireAdmin())) {
    return { error: "Non autorizzato." };
  }

  const orderId = String(formData.get("orderId") ?? "");
  if (!orderId) return { error: "Ordine non valido." };

  const admin = createAdminClient();

  // Recuperiamo il file della fattura prima di eliminare l'ordine: la
  // riga in "invoices" viene cancellata a cascata dal DB, ma il file
  // nello storage no, va rimosso a parte.
  const { data: invoice } = await admin
    .from("invoices")
    .select("file_path")
    .eq("order_id", orderId)
    .maybeSingle<{ file_path: string }>();

  const { error } = await admin.from("orders").delete().eq("id", orderId);

  if (error) {
    console.error("Errore eliminazione ordine:", error);
    return { error: "Errore nell'eliminazione dell'ordine." };
  }

  if (invoice?.file_path) {
    await admin.storage.from("invoices").remove([invoice.file_path]);
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/clienti/${formData.get("userId") ?? ""}`);
  return {};
}

type OrderInvoicePath = { invoices: { file_path: string } | null };

export async function deleteUser(
  _prevState: DeleteState,
  formData: FormData,
): Promise<DeleteState> {
  if (!(await requireAdmin())) {
    return { error: "Non autorizzato." };
  }

  const targetUserId = String(formData.get("userId") ?? "");
  if (!targetUserId) return { error: "Utente non valido." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user?.id === targetUserId) {
    return { error: "Non puoi eliminare il tuo stesso account." };
  }

  const admin = createAdminClient();

  // Raccogliamo i file fattura da rimuovere dallo storage: la cancellazione
  // dell'utente elimina a cascata (via FK) i suoi ordini/fatture nel DB,
  // ma non i file nello storage.
  const { data: ordersRaw } = await admin
    .from("orders")
    .select("invoices(file_path)")
    .eq("user_id", targetUserId);

  const orders = ordersRaw as unknown as OrderInvoicePath[] | null;

  // Eliminare l'utente auth (non solo la riga public.users) è l'unico
  // punto di cancellazione necessario: public.users, companies, orders e
  // invoices sono tutti collegati con "on delete cascade" fino ad
  // auth.users.
  const { error } = await admin.auth.admin.deleteUser(targetUserId);

  if (error) {
    console.error("Errore eliminazione utente:", error);
    return { error: "Errore nell'eliminazione dell'utente." };
  }

  const filePaths = (orders ?? [])
    .map((o) => o.invoices?.file_path)
    .filter((p): p is string => Boolean(p));

  if (filePaths.length) {
    await admin.storage.from("invoices").remove(filePaths);
  }

  redirect("/admin");
}

export async function uploadInvoice(formData: FormData) {
  const orderId = String(formData.get("orderId") ?? "");
  const file = formData.get("file") as File | null;

  if (!orderId || !file || file.size === 0) return;
  if (!(await requireAdmin())) return;

  // Usiamo la service role (bypassa la RLS) perché l'upload via sessione
  // authenticated normale falliva sulla RLS dello storage per motivi non
  // chiari; il controllo admin sopra sostituisce la RLS come barriera di
  // sicurezza in questo caso.
  const admin = createAdminClient();
  const filePath = `${orderId}.pdf`;

  const { error: uploadError } = await admin.storage
    .from("invoices")
    .upload(filePath, file, { contentType: "application/pdf", upsert: true });

  if (uploadError) {
    console.error("Errore upload fattura:", uploadError);
    return;
  }

  const { error: insertError } = await admin
    .from("invoices")
    .upsert({ order_id: orderId, file_path: filePath }, { onConflict: "order_id" });

  if (insertError) {
    console.error("Errore salvataggio fattura:", insertError);
    return;
  }

  const { data: order } = await admin
    .from("orders")
    .select("users(email)")
    .eq("id", orderId)
    .single<{ users: { email: string } | null }>();

  if (order?.users?.email) {
    await sendEmail({
      to: order.users.email,
      subject: "La tua fattura è disponibile",
      html: `<p>La fattura relativa al tuo ordine è ora disponibile nella tua area riservata.</p><p><a href="${siteUrl}/dashboard">Vai alla dashboard</a></p>`,
    });
  }

  revalidatePath("/admin");
}
