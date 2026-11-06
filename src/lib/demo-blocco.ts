import type { SupabaseClient } from "@supabase/supabase-js";
import { schemaAssente } from "@/lib/omnia-ai-incassi";

// Blocco contro le esecuzioni in parallelo del cron «omnia-ai-demo-sync». Vercel Cron può consegnare la stessa chiamata più di una volta
// e non la ripete se fallisce (documentazione letta il 04/11/2026): due esecuzioni insieme manderebbero due volte lo stesso evento a GA4,
// che non toglie i doppioni. Il blocco è una colonna (demo_sync_stato.lock_until) presa con una scrittura condizionata: vince una sola.
// Se l'esecuzione muore senza rilasciarlo, scade da solo.

export const DURATA_BLOCCO_MS = 5 * 60_000;

export type EsitoBlocco = "acquisito" | "occupato" | "non_disponibile";

export async function acquisisciBlocco(admin: SupabaseClient, adessoMs: number): Promise<EsitoBlocco> {
  const lettura = await admin.from("demo_sync_stato").select("lock_until").eq("id", 1).maybeSingle<{ lock_until: string | null }>();
  if (lettura.error) {
    if (!schemaAssente(lettura.error)) console.error("Blocco demo: lettura non riuscita", lettura.error.code);
    return "non_disponibile";
  }
  const nuovo = new Date(adessoMs + DURATA_BLOCCO_MS).toISOString();
  if (!lettura.data) {
    const { error } = await admin.from("demo_sync_stato").insert({ id: 1, lock_until: nuovo });
    return error ? "occupato" : "acquisito";
  }
  const attuale = lettura.data.lock_until;
  if (attuale && Date.parse(attuale) > adessoMs) return "occupato";

  // scrittura condizionata: vale solo se nel frattempo nessuno ha preso il blocco
  const scrittura = admin.from("demo_sync_stato").update({ lock_until: nuovo }).eq("id", 1);
  const { data, error } = await (attuale === null ? scrittura.is("lock_until", null) : scrittura.eq("lock_until", attuale)).select("id");
  if (error) return "non_disponibile";
  return (data ?? []).length > 0 ? "acquisito" : "occupato";
}

export async function rilasciaBlocco(admin: SupabaseClient): Promise<void> {
  try {
    await admin.from("demo_sync_stato").update({ lock_until: null }).eq("id", 1);
  } catch {
    // scade da solo
  }
}
