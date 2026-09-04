"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/require-admin";
import { sendEmail, ADMIN_EMAIL } from "@/lib/email";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export type MessageState = { error?: string };

export async function sendMessageAsCustomer(
  _prevState: MessageState,
  formData: FormData,
): Promise<MessageState> {
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return { error: "Scrivi un messaggio prima di inviare." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Sessione scaduta, ricarica la pagina." };

  const { error } = await supabase
    .from("messages")
    .insert({ user_id: user.id, sender: "cliente", body });

  if (error) {
    console.error("Errore invio messaggio cliente:", error);
    return { error: "Errore nell'invio del messaggio." };
  }

  await sendEmail({
    to: ADMIN_EMAIL,
    subject: `Nuovo messaggio da ${user.email}`,
    html: `<p><strong>${user.email}</strong> ha scritto:</p><p>${body}</p><p><a href="${siteUrl}/admin/clienti/${user.id}">Rispondi dal pannello admin</a></p>`,
  });

  revalidatePath("/dashboard/messaggi");
  return {};
}

export async function sendMessageAsAdmin(
  _prevState: MessageState,
  formData: FormData,
): Promise<MessageState> {
  if (!(await requireAdmin())) {
    return { error: "Non autorizzato." };
  }

  const targetUserId = String(formData.get("userId") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!targetUserId || !body) {
    return { error: "Scrivi un messaggio prima di inviare." };
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from("messages")
    .insert({ user_id: targetUserId, sender: "admin", body });

  if (error) {
    console.error("Errore invio messaggio admin:", error);
    return { error: "Errore nell'invio del messaggio." };
  }

  const { data: customer } = await supabase
    .from("users")
    .select("email")
    .eq("id", targetUserId)
    .single<{ email: string }>();

  if (customer?.email) {
    await sendEmail({
      to: customer.email,
      subject: "Nuova risposta da OMNIA",
      html: `<p>Hai ricevuto una risposta alla tua richiesta:</p><p>${body}</p><p><a href="${siteUrl}/dashboard/messaggi">Vai alla conversazione</a></p>`,
    });
  }

  revalidatePath(`/admin/clienti/${targetUserId}`);
  return {};
}
