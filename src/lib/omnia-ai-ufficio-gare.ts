import type { SupabaseClient } from "@supabase/supabase-js";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { sendEmail } from "@/lib/email";
import { emailInvitoUfficioGare } from "@/lib/omnia-ai-email-ufficio-gare-calcoli";
import { statoUfficioGare, type StatoUfficioGare } from "@/lib/omnia-ai-account-calcoli";

// L'Ufficio Gare visto dal titolare: lettura per la pagina e invio del link per scegliere la password.
// Tutto con la chiave di servizio, e SEMPRE partendo dall'identificativo del titolare che è loggato:
// mai un identificativo dell'Ufficio Gare arrivato dalla richiesta.

export type UfficioGare = {
  membroId: string;
  email: string;
  attivo: boolean;
  stato: StatoUfficioGare;
  creatoIl: string;
  invitoInviatoIl: string;
  // ultimo accesso (null: non è mai entrato)
  ultimoAccesso: string | null;
};

export type LetturaUfficioGare =
  | { esito: "assente" }
  | { esito: "presente"; ufficio: UfficioGare }
  // la migrazione 0092 non è stata eseguita: nessun Ufficio Gare può esistere né essere creato
  | { esito: "schema_assente" }
  | { esito: "errore" };

type RigaMembro = { membro_id: string; attivo: boolean; creato_il: string; invito_inviato_il: string };

export async function leggiUfficioGare(titolareId: string, admin: SupabaseClient): Promise<LetturaUfficioGare> {
  const { data, error } = await admin
    .from("omnia_ai_membri")
    .select("membro_id, attivo, creato_il, invito_inviato_il")
    .eq("titolare_id", titolareId)
    .eq("ruolo", "ufficio_gare")
    .maybeSingle<RigaMembro>();
  if (error) {
    if (schemaAssente(error)) return { esito: "schema_assente" };
    console.error("Ufficio Gare: lettura non riuscita", error.code, error.message);
    return { esito: "errore" };
  }
  if (!data) return { esito: "assente" };

  const [{ data: utente }, accesso] = await Promise.all([
    admin.from("users").select("email").eq("id", data.membro_id).maybeSingle<{ email: string }>(),
    admin.auth.admin.getUserById(data.membro_id),
  ]);
  if (!utente) {
    console.error("Ufficio Gare: riga dell'utente mancante per", data.membro_id);
    return { esito: "errore" };
  }
  const ultimoAccesso = accesso.data?.user?.last_sign_in_at ?? null;
  return {
    esito: "presente",
    ufficio: {
      membroId: data.membro_id,
      email: utente.email,
      attivo: data.attivo,
      stato: statoUfficioGare({ attivo: data.attivo, ultimoAccesso }),
      creatoIl: data.creato_il,
      invitoInviatoIl: data.invito_inviato_il,
      ultimoAccesso,
    },
  };
}

// Genera il link per scegliere la password (stesso meccanismo dell'attivazione di tutti gli altri account:
// token_hash verificato dalla pagina /attiva-account, mai un link che passa dalla console) e lo manda
// all'Ufficio Gare. Il link NON viene mai mostrato né scritto nel registro: va solo nell'email.
// Restituisce false se il link non si è generato o l'email non è partita.
export async function mandaLinkPasswordUfficioGare({
  admin,
  emailUfficioGare,
  titolareId,
  emailTitolare,
  origine,
}: {
  admin: SupabaseClient;
  emailUfficioGare: string;
  titolareId: string;
  emailTitolare: string | null;
  origine: string;
}): Promise<boolean> {
  const { data: link, error: erroreLink } = await admin.auth.admin.generateLink({ type: "magiclink", email: emailUfficioGare });
  const token = link?.properties?.hashed_token;
  if (erroreLink || !token) {
    console.error("Ufficio Gare: generazione del link di scelta password fallita", erroreLink?.message);
    return false;
  }
  // In locale il sito (zona) non si capisce dal dominio ma da un cookie che il browser può avere ancora su «console»:
  // il link porta con sé la zona, così apre sempre OMNIA AI. Sul sito vero (omnia-ai.it) la zona è il dominio e non si aggiunge nulla.
  const inLocale = /^https?:\/\/localhost(:\d+)?$/.test(origine);
  const url = `${origine}/attiva-account?${inLocale ? "__zone=omnia-ai&" : ""}token_hash=${encodeURIComponent(token)}&type=magiclink&next=${encodeURIComponent("/imposta-password")}`;

  const { data: azienda } = await admin.from("companies").select("ragione_sociale").eq("user_id", titolareId).maybeSingle<{ ragione_sociale: string | null }>();
  const email = emailInvitoUfficioGare({ linkPassword: url, nomeAzienda: azienda?.ragione_sociale ?? null, emailTitolare });
  return sendEmail({ to: emailUfficioGare, from: "OMNIA AI <noreply@omniaitalia.com>", subject: email.oggetto, html: email.html });
}
