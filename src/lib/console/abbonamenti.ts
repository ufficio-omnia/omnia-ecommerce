import { createAdminClient } from "@/lib/supabase/admin";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { calcolaMetriche, type AbbonamentoDb, type MetricheAbbonamenti } from "./abbonamenti-calcoli";
import { leggiIdentita } from "./costi";
import type { Identita } from "./costi-calcoli";
import type { Periodo } from "./periodo";

// Lettura dei dati per la pagina Abbonamenti. I calcoli stanno in
// abbonamenti-calcoli.ts. Da chiamare solo dopo richiediAdminPagina().

export type AbbonamentiLetti =
  | { stato: "errore"; messaggio: string }
  | {
      stato: "ok";
      metriche: MetricheAbbonamenti;
      identita: Map<string, Identita>;
      // le colonne livemode / disdetta_richiesta_il esistono (migrazione 0078)
      colonneNuoveDisponibili: boolean;
      includiProva: boolean;
    };

export async function leggiAbbonamenti(periodo: Periodo, opzioni: { includiProva?: boolean } = {}): Promise<AbbonamentiLetti> {
  const includiProva = opzioni.includiProva ?? false;
  const admin = createAdminClient();
  const base = "user_id, plan, status, stripe_subscription_id, created_at, current_period_end, cancel_at_period_end";

  let colonneNuoveDisponibili = true;
  let risposta: { data: unknown; error: { code?: string; message: string } | null } = await admin
    .from("subscriptions")
    .select(`${base}, livemode, disdetta_richiesta_il, terminata_il`)
    .limit(5000);
  if (risposta.error && schemaAssente(risposta.error)) {
    colonneNuoveDisponibili = false;
    risposta = await admin.from("subscriptions").select(base).limit(5000);
  }
  if (risposta.error) {
    console.error("Console: lettura abbonamenti fallita", risposta.error.message);
    return { stato: "errore", messaggio: "Lettura degli abbonamenti non riuscita." };
  }

  // Senza la migrazione 0078 non si sa quali abbonamenti sono di prova: l'account
  // Stripe di OMNIA AI è stato in test finora, quindi si trattano tutti come di prova.
  const righe: AbbonamentoDb[] = ((risposta.data ?? []) as Partial<AbbonamentoDb>[]).map((r) => ({
    user_id: r.user_id as string,
    plan: r.plan as string,
    status: r.status as string,
    stripe_subscription_id: r.stripe_subscription_id ?? null,
    created_at: r.created_at as string,
    current_period_end: r.current_period_end ?? null,
    cancel_at_period_end: r.cancel_at_period_end ?? null,
    livemode: colonneNuoveDisponibili ? (r.livemode ?? null) : r.stripe_subscription_id ? false : null,
    disdetta_richiesta_il: r.disdetta_richiesta_il ?? null,
    terminata_il: r.terminata_il ?? null,
  }));

  const metriche = calcolaMetriche(righe, periodo, new Date(), includiProva);
  const identita = await leggiIdentita(metriche.clienti.map((c) => c.userId));

  return { stato: "ok", metriche, identita, colonneNuoveDisponibili, includiProva };
}
