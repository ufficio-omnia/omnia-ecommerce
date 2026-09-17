import { PIANI, type PianoSlug } from "@/lib/omnia-ai-plans";
import type { createClient } from "@/lib/supabase/server";

export type SubscriptionAttivaRow = {
  id: string;
  plan: string;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  created_at: string;
  piano_programmato: string | null;
  piano_programmato_da: string | null;
};

export type ConsumoPeriodoCorrente = {
  subscription: SubscriptionAttivaRow;
  piano: (typeof PIANI)[PianoSlug] | undefined;
  gareIncluse: number;
  consumatePiano: number;
  gareResidue: number;
  saldoCrediti: number;
};

// Estratto da abbonamento/page.tsx: la pagina Abbonamento e i riquadri di
// stato della dashboard home devono mostrare esattamente gli stessi
// numeri nello stesso istante — calcolarli due volte rischierebbe di
// farli disallineare silenziosamente a ogni futura modifica di uno solo
// dei due punti. "Gare usate nel periodo" resta un conteggio dal vivo su
// gara_consumi (mai un contatore salvato, si azzera da sé cambiando la
// finestra temporale, coerente con lo stile append-only già usato altrove).
export async function getConsumoPeriodoCorrente(
  userId: string,
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<ConsumoPeriodoCorrente | null> {
  const { data: subscription } = await supabase
    .from("subscriptions")
    .select(
      "id, plan, current_period_start, current_period_end, cancel_at_period_end, created_at, piano_programmato, piano_programmato_da",
    )
    .eq("user_id", userId)
    .eq("status", "attivo")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<SubscriptionAttivaRow>();

  if (!subscription) return null;

  const piano = PIANI[subscription.plan as PianoSlug];
  const gareIncluse = piano?.gareIncluse ?? 0;
  const inizioPeriodo = subscription.current_period_start ?? subscription.created_at;

  const { count: consumatePiano } = await supabase
    .from("gara_consumi")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("tipo", "piano")
    .gte("created_at", inizioPeriodo);

  const gareResidue = Math.max(0, gareIncluse - (consumatePiano ?? 0));

  const { data: creditiRow } = await supabase
    .from("credits")
    .select("balance")
    .eq("user_id", userId)
    .maybeSingle<{ balance: number }>();

  return {
    subscription,
    piano,
    gareIncluse,
    consumatePiano: consumatePiano ?? 0,
    gareResidue,
    saldoCrediti: creditiRow?.balance ?? 0,
  };
}
