import { createAdminClient } from "@/lib/supabase/admin";

// Un cliente creato dalla console ha una password iniziale scelta dall'amministratore. Appena
// il cliente sceglie la SUA password (dal link ricevuto per email, da «password dimenticata» o
// da Impostazioni) la console perde ogni possibilità di toccarla: qui lo si registra.
// Per qualunque altro utente non fa nulla (nessuna riga nella tabella degli utenti da console).
// Non solleva mai errori: un problema qui non deve impedire al cliente di aver cambiato password.
export async function segnaPasswordConsegnata(userId: string | null | undefined): Promise<void> {
  if (!userId) return;
  try {
    const { error } = await createAdminClient()
      .from("omnia_ai_utenti_console")
      .update({ password_consegnata_il: new Date().toISOString() })
      .eq("user_id", userId)
      .is("password_consegnata_il", null);
    // tabella assente (migrazione 0084 non eseguita): nessun utente da console esiste ancora
    if (error && !["42P01", "PGRST205"].includes(error.code ?? "")) console.error("Password consegnata: aggiornamento non riuscito", error.code, error.message);
  } catch (e) {
    console.error("Password consegnata: errore", e instanceof Error ? e.message : e);
  }
}
