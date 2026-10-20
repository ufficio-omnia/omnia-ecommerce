import { createAdminClient } from "@/lib/supabase/admin";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import type { SegnaleValido } from "@/lib/omnia-ai-presenza-calcoli";

// Scrittura della presenza (migrazione 0094): il segnale che arriva dall'area riservata e l'uscita con «Esci». Si passa
// SEMPRE dall'utente della sessione, mai da un identificativo scritto dal browser. Con la chiave di servizio, tramite due
// funzioni del database (un'unica istruzione ciascuna). Prima della migrazione le funzioni non ci sono: si ignora senza
// rumore, mai un errore per l'utente (la presenza non deve poter rompere né il lavoro né l'uscita).

type Cliente = ReturnType<typeof createAdminClient>;

function funzioneAssente(errore: { code?: string; message?: string } | null | undefined): boolean {
  return Boolean(errore && (schemaAssente(errore) || ["PGRST202", "42883"].includes(errore.code ?? "")));
}

export async function registraSegnale(userId: string, segnale: SegnaleValido, admin: Cliente = createAdminClient()): Promise<boolean> {
  try {
    const { error } = await admin.rpc("omnia_ai_presenza_segnale", { p_user: userId, p_attivo: segnale.attivo, p_sezione: segnale.sezione });
    if (error) {
      if (!funzioneAssente(error)) console.error("Presenza: segnale non registrato", error.code, error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error("Presenza: segnale non registrato", e instanceof Error ? e.message : e);
    return false;
  }
}

export async function registraUscita(userId: string, admin: Cliente = createAdminClient()): Promise<boolean> {
  try {
    const { error } = await admin.rpc("omnia_ai_presenza_uscita", { p_user: userId });
    if (error) {
      if (!funzioneAssente(error)) console.error("Presenza: uscita non registrata", error.code, error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error("Presenza: uscita non registrata", e instanceof Error ? e.message : e);
    return false;
  }
}
