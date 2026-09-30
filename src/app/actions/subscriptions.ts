"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/require-admin";

export type SubscriptionState = { error?: string };

const VALID_STATUSES = ["attivo", "scaduto", "annullato"];

export async function setSubscription(
  _prevState: SubscriptionState,
  formData: FormData,
): Promise<SubscriptionState> {
  if (!(await requireAdmin())) {
    return { error: "Non autorizzato." };
  }

  const userId = String(formData.get("userId") ?? "");
  // Minuscolo: subscriptions.plan viene confrontato con gli slug di
  // PIANI (src/lib/omnia-ai-plans.ts: "starter"/"professional"/
  // "enterprise") in modo case-sensitive in più punti — un admin che
  // scrive "Enterprise" da questo form di testo libero (bug osservato in
  // pratica) otteneva un piano non riconosciuto e il cliente vedeva "0/0
  // gare disponibili" nonostante l'abbonamento fosse attivo.
  const plan = String(formData.get("plan") ?? "").trim().toLowerCase();
  const status = String(formData.get("status") ?? "");
  const periodEndRaw = String(formData.get("currentPeriodEnd") ?? "").trim();

  if (!userId) return { error: "Utente non valido." };
  if (!plan) return { error: "Indica il piano." };
  if (!VALID_STATUSES.includes(status)) {
    return { error: "Stato non valido." };
  }

  const admin = createAdminClient();

  // Trattiamo la subscription più recente dell'utente come quella
  // "corrente": se esiste la aggiorniamo, altrimenti ne creiamo una nuova.
  // Non c'è vincolo unique su user_id, quindi il "più recente" è
  // determinato applicativamente.
  const { data: existing } = await admin
    .from("subscriptions")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();

  const payload = {
    user_id: userId,
    plan,
    status,
    current_period_end: periodEndRaw || null,
  };

  const { error } = existing
    ? await admin.from("subscriptions").update(payload).eq("id", existing.id)
    : await admin.from("subscriptions").insert(payload);

  if (error) {
    console.error("Errore salvataggio abbonamento:", error);
    return { error: "Errore nel salvataggio dell'abbonamento." };
  }

  revalidatePath(`/admin/clienti/${userId}`);
  return {};
}
