import { createAdminClient } from "@/lib/supabase/admin";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { giornoRoma } from "@/lib/omnia-ai-catalogo-calcoli";
import { gareOmaggioInCorso } from "@/lib/omnia-ai-gare-omaggio-calcoli";

// Gare in omaggio (migrazione 0131): quante gare in più valgono oggi per un cliente. Solo lettura, con la
// chiave di servizio e sempre filtrando per il cliente. Qualunque problema (tabella non ancora creata,
// errore di lettura, risposta strana) vale 0: un omaggio che non si legge non regala nulla ma non blocca
// mai le gare del piano.
export async function leggiGareOmaggioInCorso(userId: string, adesso: Date, admin?: ReturnType<typeof createAdminClient>): Promise<number> {
  try {
    const { data, error } = await (admin ?? createAdminClient()).from("omnia_ai_gare_omaggio").select("gare, dal, al, revocato_il").eq("user_id", userId);
    if (error) {
      if (!schemaAssente(error)) console.error("Gare in omaggio: lettura fallita", error.code, error.message);
      return 0;
    }
    return gareOmaggioInCorso(Array.isArray(data) ? data : [], giornoRoma(adesso));
  } catch (e) {
    console.error("Gare in omaggio: lettura fallita", e instanceof Error ? e.message : e);
    return 0;
  }
}
