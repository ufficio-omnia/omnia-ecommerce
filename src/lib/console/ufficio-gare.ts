import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { schemaAssente } from "@/lib/omnia-ai-incassi";

// Gli Uffici Gare (migrazione 0092) visti dalla console. Tutto con la chiave di servizio: da chiamare solo
// dopo richiediAdminPagina() / richiediAdminAzione().
//
// Un Ufficio Gare è un utente di un'azienda cliente (il «titolare»): non è un cliente a sé, non ha abbonamento,
// crediti né fatture, e nelle azioni della console («abbonamento a mano», gare gratuite, offerta pilot) non va
// trattato come tale: quelle si fanno sul titolare.

export type LegameUfficioGare =
  | {
      ruolo: "titolare";
      // da 1 a 3 (migrazione 0136), dal più vecchio
      uffici: { id: string; email: string; attivo: boolean; creatoIl: string; invitoInviatoIl: string; ultimoAccesso: string | null }[];
    }
  | {
      ruolo: "ufficio_gare";
      attivo: boolean;
      creatoIl: string;
      titolare: { id: string; email: string; azienda: string | null };
    };

type RigaMembro = { membro_id: string; titolare_id: string; attivo: boolean; creato_il: string; invito_inviato_il: string };

const COLONNE = "membro_id, titolare_id, attivo, creato_il, invito_inviato_il";

// null = nessun legame (o la migrazione non c'è ancora); "errore" = lettura non riuscita (chi chiama non deve concludere «nessun legame»).
export async function leggiLegameUfficioGare(userId: string, admin: SupabaseClient = createAdminClient()): Promise<LegameUfficioGare | null | "errore"> {
  const comeMembro = await admin.from("omnia_ai_membri").select(COLONNE).eq("membro_id", userId).maybeSingle<RigaMembro>();
  if (comeMembro.error) {
    if (schemaAssente(comeMembro.error)) return null;
    console.error("Console: lettura del legame Ufficio Gare fallita", comeMembro.error.message);
    return "errore";
  }
  if (comeMembro.data) {
    const titolareId = comeMembro.data.titolare_id;
    const [{ data: titolare }, { data: azienda }] = await Promise.all([
      admin.from("users").select("id, email").eq("id", titolareId).maybeSingle<{ id: string; email: string }>(),
      admin.from("companies").select("ragione_sociale").eq("user_id", titolareId).maybeSingle<{ ragione_sociale: string | null }>(),
    ]);
    return {
      ruolo: "ufficio_gare",
      attivo: comeMembro.data.attivo,
      creatoIl: comeMembro.data.creato_il,
      titolare: { id: titolareId, email: titolare?.email ?? titolareId, azienda: azienda?.ragione_sociale ?? null },
    };
  }

  const comeTitolare = await admin.from("omnia_ai_membri").select(COLONNE).eq("titolare_id", userId).order("creato_il", { ascending: true });
  if (comeTitolare.error) {
    console.error("Console: lettura degli Uffici Gare del titolare fallita", comeTitolare.error.message);
    return "errore";
  }
  const righe = (comeTitolare.data ?? []) as RigaMembro[];
  if (righe.length === 0) return null;
  const uffici = await Promise.all(
    righe.map(async (riga) => {
      const [{ data: membro }, accesso] = await Promise.all([
        admin.from("users").select("email").eq("id", riga.membro_id).maybeSingle<{ email: string }>(),
        admin.auth.admin.getUserById(riga.membro_id),
      ]);
      return {
        id: riga.membro_id,
        email: membro?.email ?? riga.membro_id,
        attivo: riga.attivo,
        creatoIl: riga.creato_il,
        invitoInviatoIl: riga.invito_inviato_il,
        ultimoAccesso: accesso.data?.user?.last_sign_in_at ?? null,
      };
    }),
  );
  return { ruolo: "titolare", uffici };
}

// Per le azioni della console: l'utente è l'Ufficio Gare di qualcuno? Restituisce il titolare, null se no, "errore" se non si sa.
export async function leggiTitolareDelMembro(userId: string, admin: SupabaseClient = createAdminClient()): Promise<string | null | "errore"> {
  const { data, error } = await admin.from("omnia_ai_membri").select("titolare_id").eq("membro_id", userId).maybeSingle<{ titolare_id: string }>();
  if (error) {
    if (schemaAssente(error)) return null;
    console.error("Console: controllo se l'utente è un Ufficio Gare fallito", error.message);
    return "errore";
  }
  return data?.titolare_id ?? null;
}

// Per l'eliminazione e l'anonimizzazione di un titolare: gli identificativi dei suoi Uffici Gare (vuoto se non ne ha).
export async function leggiMembriDelTitolare(titolareId: string, admin: SupabaseClient = createAdminClient()): Promise<string[] | "errore"> {
  const { data, error } = await admin.from("omnia_ai_membri").select("membro_id").eq("titolare_id", titolareId);
  if (error) {
    if (schemaAssente(error)) return [];
    console.error("Console: lettura degli Uffici Gare del titolare fallita", error.message);
    return "errore";
  }
  return ((data ?? []) as { membro_id: string }[]).map((r) => r.membro_id);
}

export const MESSAGGIO_E_UN_UFFICIO_GARE = "Questo utente è l'Ufficio Gare di un'azienda cliente, non un cliente a sé: l'operazione si fa sul titolare.";
export const MESSAGGIO_CONTROLLO_UFFICIO_GARE_NON_RIUSCITO = "Non riesco a controllare se questo utente è un Ufficio Gare: non è stato toccato nulla. Riprova tra qualche istante.";
