"use server";

import { createClient } from "@/lib/supabase/server";
import { richiediAccountAzione } from "@/lib/omnia-ai-account-guardie";

// Interrogata a intervalli dal driver client del marchio a tre stati
// (marchio-stato-driver.tsx): "elaborazione" per il cliente corrente
// significa "almeno una delle sue gare ha un'analisi in corso", non lo
// stato globale del sistema — ogni cliente vede solo il proprio lavoro.
export async function getStatoElaborazioneGare(): Promise<{ inCorso: boolean }> {
  const supabase = await createClient();
  // Per l'Ufficio Gare «le sue gare» sono quelle dell'azienda (del titolare).
  const guardia = await richiediAccountAzione();
  if (!guardia.ok) return { inCorso: false };

  const { count } = await supabase
    .from("gare")
    .select("id", { count: "exact", head: true })
    .eq("user_id", guardia.contesto.accountId)
    .eq("estrazione_stato", "in_corso");

  return { inCorso: (count ?? 0) > 0 };
}
