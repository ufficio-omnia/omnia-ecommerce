"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { sendEmail, ADMIN_EMAIL } from "@/lib/email";
import { escapeHtml, testoPerEmail } from "@/lib/html";
import { CONSOLE_BASE_URL } from "@/lib/zone";

export type MessageState = { error?: string };

// Messaggio del cliente dall'area riservata dell'e-commerce. La risposta dell'admin
// non sta più qui: si scrive dalla scheda del cliente nella console
// (src/app/site-console/azioni/utenti.ts).
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

  // L'email e il testo li ha scritti il cliente: vanno neutralizzati, altrimenti
  // un cliente potrebbe mettere un collegamento qualunque in un'email che arriva
  // all'admin con il marchio di OMNIA. Il link porta alla scheda del cliente nella
  // console (che chiede l'accesso: da lì si risponde).
  await sendEmail({
    to: ADMIN_EMAIL,
    subject: `Nuovo messaggio da ${user.email}`,
    html: `<p><strong>${escapeHtml(user.email ?? "")}</strong> ha scritto:</p><p>${testoPerEmail(body)}</p><p><a href="${CONSOLE_BASE_URL}/utenti/${user.id}">Rispondi dalla console</a></p>`,
  });

  revalidatePath("/dashboard/messaggi");
  return {};
}
