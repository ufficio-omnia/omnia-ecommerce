// Registro delle azioni di Tender Intelligence (omnia_ai_radar_utilizzi, migrazione 0111): una riga per azione, con i crediti addebitati
// (oggi sempre zero: costo per azione predefinito a zero, decisione D2) e il costo AI stimato. Serve ai limiti per organizzazione e alla console.
// Come logAiUsage: un errore di registrazione non interrompe mai l'azione già riuscita.
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AzioneRadar, AzioneStatistica } from "./diritto-calcoli";

export async function registraUtilizzoRadar(params: {
  accountId: string;
  membroId: string;
  azione: AzioneRadar | AzioneStatistica;
  proceduraId?: string | null;
  garaId?: string | null;
  crediti?: number;
  costoAiStimato?: number | null;
}): Promise<void> {
  try {
    const { error } = await createAdminClient().from("omnia_ai_radar_utilizzi").insert({
      user_id: params.accountId,
      membro_id: params.membroId,
      azione: params.azione,
      procedura_id: params.proceduraId ?? null,
      gara_id: params.garaId ?? null,
      crediti: Math.max(0, Math.floor(params.crediti ?? 0)),
      costo_ai_stimato: params.costoAiStimato ?? null,
    });
    if (error) console.error("Tender Intelligence: registrazione dell'utilizzo non riuscita", error.message);
  } catch (e) {
    console.error("Tender Intelligence: registrazione dell'utilizzo non riuscita", e);
  }
}

// Quante volte l'account ha fatto l'azione dalla data indicata. null = conteggio non riuscito: chi chiama NON deve concedere.
export async function contaUtilizziRadar(admin: SupabaseClient, accountId: string, azione: AzioneRadar | AzioneStatistica, dal: Date): Promise<number | null> {
  const { count, error } = await admin
    .from("omnia_ai_radar_utilizzi")
    .select("id", { count: "exact", head: true })
    .eq("user_id", accountId)
    .eq("azione", azione)
    .gte("creato_il", dal.toISOString());
  if (error) return null;
  return count ?? 0;
}
