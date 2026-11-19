// Fase B4 (B1), grado 3 — Letture e scritture della pagina «Notifiche». Solo server, dopo le guardie.
//   - Preferenze (0124): si LEGGONO con la sessione dell'utente (RLS: il titolare vede tutta la sua impresa, un membro solo la propria riga) e
//     si SCRIVONO solo con il client di servizio dopo la guardia (la 0124 non dà scritture ai clienti).
//   - Persone e stato degli indirizzi: funzione radar_notifiche_destinatari della 0125 (solo servizio), chiesta per la SOLA impresa della
//     sessione; l'indirizzo email resta in memoria nel server e non arriva mai alla pagina (personeVisibili non lo porta).
//   - Membri dell'impresa per le azioni: omnia_ai_membri con titolare = l'impresa della sessione e attivo = vero.
// Tabelle assenti = «non disponibile», mai un errore mostrato al cliente.
import type { SupabaseClient } from "@supabase/supabase-js";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { personaDaRiga, type PersonaImpresa, type PreferenzePersona } from "./notifiche/destinatari-calcoli";
import {
  COLONNE_NOTIFICHE_PERSONE,
  TABELLA_NOTIFICHE_IMPRESA,
  TABELLA_NOTIFICHE_PERSONE,
  categorieDa,
  preferenzeDaRiga,
  righeIniziali,
  rigaPreferenze,
  type CategoriePreferenze,
  type PersoneDellImpresa,
} from "./notifiche-preferenze-calcoli";

export type LetturaNotifiche = {
  // 0124 nel database
  tabelle: boolean;
  esisteImpresa: boolean;
  emailAttive: boolean;
  preferenze: Map<string, PreferenzePersona>;
  // null = funzione della 0125 non disponibile (stato degli indirizzi non mostrabile)
  persone: PersonaImpresa[] | null;
};

/** Tre letture in parallelo, tutte per la sola impresa della sessione. */
export async function leggiNotifiche(sessione: SupabaseClient, admin: SupabaseClient, impresaId: string): Promise<LetturaNotifiche> {
  const [impresa, persone, destinatari] = await Promise.all([
    sessione.from(TABELLA_NOTIFICHE_IMPRESA).select("email_attive").eq("impresa_id", impresaId).maybeSingle<{ email_attive: boolean }>(),
    sessione.from(TABELLA_NOTIFICHE_PERSONE).select(COLONNE_NOTIFICHE_PERSONE).eq("impresa_id", impresaId).returns<Record<string, unknown>[]>(),
    admin.rpc("radar_notifiche_destinatari", { p_imprese: [impresaId] }),
  ]);
  const tabelle = !(schemaAssente(impresa.error) || schemaAssente(persone.error));
  if (impresa.error && !schemaAssente(impresa.error)) console.error("Tender Intelligence: lettura delle email dell'impresa non riuscita", impresa.error.code);
  if (persone.error && !schemaAssente(persone.error)) console.error("Tender Intelligence: lettura delle preferenze non riuscita", persone.error.code);
  const preferenze = new Map<string, PreferenzePersona>();
  for (const r of persone.data ?? []) {
    const p = preferenzeDaRiga(r);
    if (p && typeof r.user_id === "string") preferenze.set(r.user_id, p);
  }
  const elenco = destinatari.error ? null : (Array.isArray(destinatari.data) ? destinatari.data : []).map(personaDaRiga).filter((p): p is PersonaImpresa => !!p && p.impresaId === impresaId);
  return { tabelle, esisteImpresa: !!impresa.data, emailAttive: impresa.data?.email_attive === true, preferenze, persone: elenco };
}

/** Il titolare e i membri ATTIVI del suo Ufficio Gare. null se la lettura non riesce (chi chiama NON deve concedere). */
export async function leggiPersoneDellImpresa(admin: SupabaseClient, impresaId: string): Promise<PersoneDellImpresa | null> {
  const { data, error } = await admin.from("omnia_ai_membri").select("membro_id").eq("titolare_id", impresaId).eq("attivo", true).returns<{ membro_id: string }[]>();
  if (error) {
    console.error("Tender Intelligence: lettura dei membri dell'impresa non riuscita", error.code);
    return null;
  }
  return { impresaId, membriAttivi: (data ?? []).map((m) => m.membro_id).filter((m) => m !== impresaId) };
}

/** Le preferenze attuali di una persona dell'impresa (servizio), per il controllo «solo spegnere». */
export async function leggiPreferenzePersona(admin: SupabaseClient, impresaId: string, userId: string): Promise<{ ok: true; esisteImpresa: boolean; categorie: CategoriePreferenze | null } | { ok: false }> {
  const [impresa, persona] = await Promise.all([
    admin.from(TABELLA_NOTIFICHE_IMPRESA).select("impresa_id").eq("impresa_id", impresaId).maybeSingle(),
    admin.from(TABELLA_NOTIFICHE_PERSONE).select(COLONNE_NOTIFICHE_PERSONE).eq("impresa_id", impresaId).eq("user_id", userId).maybeSingle<Record<string, unknown>>(),
  ]);
  if (impresa.error || persona.error) return { ok: false };
  return { ok: true, esisteImpresa: !!impresa.data, categorie: persona.data ? categorieDa(preferenzeDaRiga(persona.data)) : null };
}

type Scrittura = { ok: true } | { ok: false; tabellaAssente: boolean };

function esito(error: { code?: string; message?: string } | null): Scrittura {
  if (!error) return { ok: true };
  const assente = schemaAssente(error);
  if (!assente) console.error("Tender Intelligence: scrittura delle notifiche non riuscita", error.code);
  return { ok: false, tabellaAssente: assente };
}

/**
 * Interruttore dell'impresa (solo titolare, dopo la guardia). Alla prima accensione crea le righe delle persone con i valori iniziali D-E4,
 * SOLO per chi non ne ha già una (le scelte già fatte non si toccano).
 */
export async function scriviEmailImpresa(admin: SupabaseClient, persone: PersoneDellImpresa, attive: boolean, autoreId: string, adesso: Date): Promise<Scrittura> {
  const quando = adesso.toISOString();
  const { error } = await admin.from(TABELLA_NOTIFICHE_IMPRESA).upsert({ impresa_id: persone.impresaId, email_attive: attive, aggiornato_il: quando, aggiornato_da: autoreId }, { onConflict: "impresa_id" });
  if (error || !attive) return esito(error);
  const { data: presenti, error: erroreLettura } = await admin.from(TABELLA_NOTIFICHE_PERSONE).select("user_id").eq("impresa_id", persone.impresaId).returns<{ user_id: string }[]>();
  if (erroreLettura) return esito(erroreLettura);
  const nuove = righeIniziali(persone, new Set((presenti ?? []).map((p) => p.user_id)), autoreId, quando);
  if (!nuove.length) return { ok: true };
  const { error: erroreNuove } = await admin.from(TABELLA_NOTIFICHE_PERSONE).upsert(nuove, { onConflict: "impresa_id,user_id", ignoreDuplicates: true });
  return esito(erroreNuove);
}

/**
 * Preferenze di una persona (dopo la guardia e validaModificaPreferenze). Se l'impresa non ha ancora la sua riga, la crea SOLO il titolare
 * (con le email spente): la riga della persona ne ha bisogno (chiave esterna della 0124).
 */
export async function scriviPreferenze(admin: SupabaseClient, d: { impresaId: string; userId: string; valori: CategoriePreferenze; autoreId: string; creaImpresa: boolean; adesso: Date }): Promise<Scrittura> {
  const quando = d.adesso.toISOString();
  if (d.creaImpresa) {
    const { error } = await admin.from(TABELLA_NOTIFICHE_IMPRESA).upsert({ impresa_id: d.impresaId, email_attive: false, aggiornato_il: quando, aggiornato_da: d.autoreId }, { onConflict: "impresa_id", ignoreDuplicates: true });
    if (error) return esito(error);
  }
  const { error } = await admin.from(TABELLA_NOTIFICHE_PERSONE).upsert(rigaPreferenze(d.impresaId, d.userId, d.valori, d.autoreId, quando), { onConflict: "impresa_id,user_id" });
  return esito(error);
}
