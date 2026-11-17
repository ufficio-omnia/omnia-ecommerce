import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { CHIAVE_POLITICA_PROVA_COPERTINA, CHIAVE_PREZZO_COPERTINA, CHIAVE_VENDITA_COPERTINA, interpretaInterruttoreVenditaCopertina, interpretaPrezzoCopertina } from "@/lib/copertina-acquisto-calcoli";
import { interpretaPoliticaProva, type PoliticaProva } from "@/lib/piano-lavoro-offerta-calcoli";

// La vendita a tutti della copertina della relazione tecnica (pagina «Copertina» della console, 17/11/2026): l'interruttore, il prezzo per gara uguale per
// tutti, la regola per gli account in prova. Valori in console_impostazioni (nessuna migrazione); qualunque errore di lettura = vendita spenta e prezzo di
// partenza. Modulo a parte (senza le regole del diritto) perché lo usano anche i pacchetti, senza giri di importazioni.

async function leggiValori(client: SupabaseClient, chiavi: string[]): Promise<Map<string, string>> {
  try {
    const { data, error } = await client.from("console_impostazioni").select("chiave, valore").in("chiave", chiavi).returns<{ chiave: string; valore: string }[]>();
    if (error) return new Map();
    return new Map((data ?? []).map((r) => [r.chiave, r.valore]));
  } catch {
    return new Map();
  }
}

export type ImpostazioniVenditaCopertina = { venditaAttiva: boolean; prezzoCentesimi: number; politicaProva: PoliticaProva };

export async function leggiImpostazioniVenditaCopertina(client?: SupabaseClient): Promise<ImpostazioniVenditaCopertina> {
  const valori = await leggiValori(client ?? createAdminClient(), [CHIAVE_VENDITA_COPERTINA, CHIAVE_PREZZO_COPERTINA, CHIAVE_POLITICA_PROVA_COPERTINA]);
  return {
    venditaAttiva: interpretaInterruttoreVenditaCopertina(valori.get(CHIAVE_VENDITA_COPERTINA)),
    prezzoCentesimi: interpretaPrezzoCopertina(valori.get(CHIAVE_PREZZO_COPERTINA)),
    politicaProva: interpretaPoliticaProva(valori.get(CHIAVE_POLITICA_PROVA_COPERTINA)),
  };
}

export async function venditaCopertinaAttiva(client?: SupabaseClient): Promise<boolean> {
  return (await leggiImpostazioniVenditaCopertina(client)).venditaAttiva;
}

export async function leggiPrezzoCopertina(client?: SupabaseClient): Promise<number> {
  return (await leggiImpostazioniVenditaCopertina(client)).prezzoCentesimi;
}

// La migrazione 0130 è stata eseguita? (tabella delle concessioni della copertina, e il servizio «copertina» ammesso nei pacchetti). Senza, i pacchetti e le
// concessioni della copertina non si offrono: un acquisto finirebbe contro il vincolo del database.
export async function migrazioneCopertinaPacchettiEseguita(client?: SupabaseClient): Promise<"si" | "no" | "errore"> {
  try {
    const { error } = await (client ?? createAdminClient()).from("omnia_ai_copertina_concessioni").select("id").limit(1);
    if (!error) return "si";
    return schemaAssente(error) ? "no" : "errore";
  } catch {
    return "errore";
  }
}
