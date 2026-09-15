import { createClient } from "@/lib/supabase/server";
import { getOmniaAiAccessState } from "@/lib/omnia-ai-access";

// Solo il booleano "pieno accesso o no": chi ha bisogno di distinguere
// anche la sola lettura usa getOmniaAiAccessState direttamente.
//
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
  const stato = await getOmniaAiAccessState(userId, supabase);
  return stato.stato === "attivo";
}
