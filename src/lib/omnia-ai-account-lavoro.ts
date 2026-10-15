import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOmniaAiWriteAccess } from "@/lib/omnia-ai-access";
import { verificaDirittoGara } from "@/lib/gara-diritto";
import type { DirittoGara } from "@/lib/gara-diritto-calcoli";
import type { ContestoAccount } from "@/lib/omnia-ai-account";
import { MESSAGGIO_UFFICIO_GARE_ABBONAMENTO_NON_ATTIVO, messaggioPerUfficioGare } from "@/lib/omnia-ai-account-calcoli";
import { avvisaTitolareDopoLaRisposta } from "@/lib/omnia-ai-ufficio-gare-quota";

// Gli aiuti del LAVORO DI GARA per l'account effettivo (titolare o Ufficio Gare): abbonamento e quota si
// leggono sempre sul TITOLARE; all'Ufficio Gare si risponde con il promemoria per l'amministratore (mai con
// testi o link di acquisto) e il titolare riceve l'email (una al giorno, deciso dal database).

// Il client con cui leggere abbonamento, crediti e gare gratuite del titolare. Il titolare usa la propria
// sessione (come sempre); l'Ufficio Gare non ha accesso a quelle tabelle, quindi si legge con la chiave di
// servizio, SEMPRE filtrando per l'identificativo del titolare risolto sul server.
export function clientePerAccount(contesto: ContestoAccount, supabase: SupabaseClient): SupabaseClient {
  return contesto.ruolo === "ufficio_gare" ? createAdminClient() : supabase;
}

// Come requireOmniaAiWriteAccess, ma per l'account effettivo. Null se si può procedere; altrimenti il testo da mostrare.
export async function accessoNegatoPerAccount(contesto: ContestoAccount, user: Pick<User, "email">, supabase: SupabaseClient): Promise<string | null> {
  const negato = await requireOmniaAiWriteAccess(contesto.accountId, clientePerAccount(contesto, supabase));
  if (!negato) return null;
  if (contesto.ruolo === "ufficio_gare") {
    avvisaTitolareDopoLaRisposta({ contesto, emailUfficioGare: user.email, motivo: "abbonamento_non_attivo" });
    return MESSAGGIO_UFFICIO_GARE_ABBONAMENTO_NON_ATTIVO;
  }
  return negato;
}

// Come verificaDirittoGara, ma per l'account effettivo: i dati sono del titolare; se le gare sono finite
// l'Ufficio Gare riceve il promemoria per l'amministratore e il titolare l'email.
export async function dirittoGaraPerAccount({ contesto, user, garaId }: { contesto: ContestoAccount; user: Pick<User, "email">; garaId: string }): Promise<DirittoGara> {
  const diritto = await verificaDirittoGara({ garaId, userId: contesto.accountId });
  if (diritto.consentito || contesto.ruolo !== "ufficio_gare") return diritto;
  if (diritto.motivo === "verifica_non_riuscita") return diritto;
  avvisaTitolareDopoLaRisposta({ contesto, emailUfficioGare: user.email, motivo: "gare_finite" });
  return { ...diritto, messaggio: messaggioPerUfficioGare("gare_finite") };
}
