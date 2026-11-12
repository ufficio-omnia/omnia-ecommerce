"use server";

import { createClient } from "@/lib/supabase/server";
import { richiediAccountAzione } from "@/lib/omnia-ai-account-guardie";

// "elaborazione" per il cliente corrente significa "almeno una delle sue gare ha un'analisi in corso", non lo stato
// globale del sistema — ogni cliente vede solo il proprio lavoro (per l'Ufficio Gare: le gare del titolare).
export type StatoDashboard = { inCorso: boolean; nonLette: number | null };

// Il controllo periodico della dashboard (stato-dashboard.tsx): spia del marchio e contatore della campanella in una
// sola chiamata, quindi UN solo controllo della sessione su Supabase Auth invece dei due di prima (uno per azione).
// Le autorizzazioni restano quelle di prima, ciascuna per il suo dato:
//   - gare in elaborazione: guardia dell'account (l'Ufficio Gare vede le gare del titolare, sospeso = nessuna);
//   - notifiche non lette: client con la sessione dell'utente, quindi le regole di accesso (RLS) della tabella.
// conNotifiche = false per l'Ufficio Gare, che non ha la campanella: la query non parte nemmeno.
// nonLette = null quando non si è letto (non richiesto, sessione non valida, errore): il contatore resta com'era.
export async function getStatoDashboard(conNotifiche: boolean): Promise<StatoDashboard> {
  const guardia = await richiediAccountAzione();
  if (!guardia.ok) return { inCorso: false, nonLette: null };

  const supabase = await createClient();
  const [gare, notifiche] = await Promise.all([
    supabase
      .from("gare")
      .select("id", { count: "exact", head: true })
      .eq("user_id", guardia.contesto.accountId)
      .eq("estrazione_stato", "in_corso"),
    conNotifiche === true
      ? supabase.from("omnia_ai_notifiche").select("id", { count: "exact", head: true }).eq("letta", false)
      : Promise.resolve(null),
  ]);

  return {
    inCorso: (gare.count ?? 0) > 0,
    nonLette: notifiche && !notifiche.error ? (notifiche.count ?? 0) : null,
  };
}
