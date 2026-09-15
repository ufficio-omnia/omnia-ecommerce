import { createClient } from "@/lib/supabase/server";
import { getOmniaAiAccessState } from "@/lib/omnia-ai-access";

// Solo il booleano "pieno accesso o no": chi ha bisogno di distinguere
// anche la sola lettura usa getOmniaAiAccessState direttamente.
export async function hasActiveSubscription(userId: string): Promise<boolean> {
  const supabase = await createClient();
  const stato = await getOmniaAiAccessState(userId, supabase);
  return stato.stato === "attivo";
}
