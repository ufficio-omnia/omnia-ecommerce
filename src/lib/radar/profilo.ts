// Fase B4 (B1), grado 1 — Lettura e scrittura del profilo di ricerca dell'impresa (omnia_ai_radar_profili, bozza 0122 di B2). Solo server.
// Lettura: con la SESSIONE dell'utente, quindi con le regole di accesso della 0122 (titolare e Ufficio Gare attivo della stessa impresa).
// Scrittura: SOLO con la chiave di servizio, dopo la guardia del titolare (ai clienti la 0122 non dà permessi di scrittura).
// Tabella assente (0122 non applicata) = profilo non disponibile, mai un errore mostrato al cliente.
import type { SupabaseClient } from "@supabase/supabase-js";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { COLONNE_PROFILO, POSIZIONE_PROFILO, TABELLA_PROFILI, profiloDaRiga, rigaDaValori, type ProfiloLetto, type RigaProfilo, type ValoriProfilo } from "./profilo-calcoli";

export type LetturaProfilo = { disponibile: boolean; profilo: ProfiloLetto | null };

/** 1 lettura per chiave: la riga dell'impresa in posizione 1. */
export async function leggiProfiloRadar(sessione: SupabaseClient, impresaId: string): Promise<LetturaProfilo> {
  try {
    const { data, error } = await sessione
      .from(TABELLA_PROFILI)
      .select(COLONNE_PROFILO)
      .eq("user_id", impresaId)
      .eq("posizione", POSIZIONE_PROFILO)
      .maybeSingle<RigaProfilo>();
    if (error) {
      if (!schemaAssente(error)) console.error("Tender Intelligence: lettura del profilo non riuscita", error.code);
      return { disponibile: false, profilo: null };
    }
    return { disponibile: true, profilo: profiloDaRiga(data, impresaId) };
  } catch (e) {
    console.error("Tender Intelligence: lettura del profilo non riuscita", e);
    return { disponibile: false, profilo: null };
  }
}

/** Scrive il profilo (upsert sulla coppia impresa, posizione). Da chiamare SOLO dopo la guardia del titolare, con impresa e autore della sessione. */
export async function scriviProfiloRadar(admin: SupabaseClient, valori: ValoriProfilo, impresaId: string, autoreId: string, adesso: Date): Promise<{ ok: true } | { ok: false; tabellaAssente: boolean }> {
  const { error } = await admin.from(TABELLA_PROFILI).upsert(rigaDaValori(valori, impresaId, autoreId, adesso.toISOString()), { onConflict: "user_id,posizione" });
  if (!error) return { ok: true };
  const assente = schemaAssente(error);
  if (!assente) console.error("Tender Intelligence: salvataggio del profilo non riuscito", error.code);
  return { ok: false, tabellaAssente: assente };
}
