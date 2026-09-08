"use server";

import { createAdminClient } from "@/lib/supabase/admin";

export type ConversionOrder = { id: string; value: number } | null;

// Lookup read-only per il tracciamento Google Ads: non crea/modifica
// nulla, serve solo a recuperare id e importo reale dell'ordine dopo il
// redirect da Stripe. isLastAttempt logga un errore (visibile nei log
// server) solo quando anche l'ultimo tentativo di retry non trova
// l'ordine — per accorgersi se il webhook Stripe è lento/fallito senza
// spammare un log per ogni tentativo intermedio.
export async function findOrderForConversion(
  stripeSessionId: string,
  isLastAttempt: boolean,
): Promise<ConversionOrder> {
  if (!stripeSessionId) return null;

  const admin = createAdminClient();
  const { data: order } = await admin
    .from("orders")
    .select("id, total_amount")
    .eq("stripe_session_id", stripeSessionId)
    .maybeSingle<{ id: string; total_amount: number }>();

  if (order) {
    return { id: order.id, value: Number(order.total_amount) };
  }

  if (isLastAttempt) {
    console.error(
      "Conversione Google Ads non tracciata: nessun ordine trovato dopo tutti i retry per stripe_session_id",
      stripeSessionId,
    );
  }

  return null;
}
