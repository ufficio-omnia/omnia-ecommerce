import { createClient } from "@/lib/supabase/server";

// Client opzionale: di default quello di sessione, corretto quando si
// controlla l'abbonamento dell'utente CORRENTE (la RLS "subscriptions_
// select_own" lo permette naturalmente, auth.uid() coincide con
// user_id). Serve però anche poter controllare l'abbonamento di un
// ALTRO utente — es. la guardia anti-doppio-abbonamento nel checkout
// anonimo, che verifica un'email diversa dalla sessione corrente (che
// potrebbe non esistere affatto): lì la RLS bloccherebbe silenziosamente
// la select (0 righe, mai un errore) restituendo sempre "false" anche
// quando un abbonamento attivo esiste davvero — bug osservato in
// pratica. Il chiamante passa in quel caso il client admin.
export async function hasActiveSubscription(
  userId: string,
  client?: Awaited<ReturnType<typeof createClient>>,
): Promise<boolean> {
  const supabase = client ?? (await createClient());

  const { data } = await supabase
    .from("subscriptions")
    .select("current_period_end")
    .eq("user_id", userId)
    .eq("status", "attivo")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ current_period_end: string | null }>();

  if (!data) return false;
  if (!data.current_period_end) return true;

  return new Date(data.current_period_end).getTime() > Date.now();
}
