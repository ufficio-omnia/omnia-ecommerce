import { createAdminClient } from "@/lib/supabase/admin";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { statoPresenza, eOnline, type PresenzaCalcolata, type PresenzaDb } from "@/lib/omnia-ai-presenza-calcoli";

// Letture della presenza (migrazione 0094) per la console: elenco utenti, scheda cliente, Panoramica. Con la chiave di servizio:
// da chiamare solo dopo richiediAdminPagina(). Prima della migrazione la tabella non c'è: `disponibile: false`, nessun errore.
// Sono solo orari e il nome di una sezione: nessun contenuto del cliente.

const COLONNE = "user_id, ultimo_segnale, ultima_attivita, sezione, ingresso_il, uscita_il";
const LIMITE = 5000;

export type PresenzeLette = { disponibile: boolean; righe: Map<string, PresenzaDb> };

export async function leggiPresenze(): Promise<PresenzeLette> {
  const { data, error } = await createAdminClient().from("omnia_ai_presenza").select(COLONNE).order("ultimo_segnale", { ascending: false }).limit(LIMITE).returns<PresenzaDb[]>();
  if (error) {
    if (!schemaAssente(error)) console.error("Console: lettura della presenza fallita", error.code, error.message);
    return { disponibile: false, righe: new Map() };
  }
  return { disponibile: true, righe: new Map((data ?? []).map((r) => [r.user_id, r])) };
}

export type PresenzaUtente = { disponibile: boolean; presenza: PresenzaCalcolata };

// La presenza di UN utente (scheda cliente, e Ufficio Gare di quel cliente).
export async function leggiPresenzaUtente(userId: string, adesso: Date = new Date()): Promise<PresenzaUtente> {
  const { data, error } = await createAdminClient().from("omnia_ai_presenza").select(COLONNE).eq("user_id", userId).maybeSingle<PresenzaDb>();
  if (error) {
    if (!schemaAssente(error)) console.error("Console: lettura della presenza di un utente fallita", error.code, error.message);
    return { disponibile: false, presenza: statoPresenza(null, adesso) };
  }
  return { disponibile: true, presenza: statoPresenza(data, adesso) };
}

export type UtenteOnline = {
  id: string;
  email: string;
  azienda: string | null;
  // è l'Ufficio Gare di un altro cliente
  ufficioGareDi: string | null;
  presenza: PresenzaCalcolata;
};

export type OnlineAdesso = { disponibile: boolean; utenti: UtenteOnline[] };

// Chi è collegato adesso (esclusi gli amministratori: sono i nostri). Prima gli attivi, poi i fermi, a parità l'ultimo segnale
// più recente.
export async function leggiOnlineAdesso(adesso: Date = new Date()): Promise<OnlineAdesso> {
  const { disponibile, righe } = await leggiPresenze();
  if (!disponibile) return { disponibile: false, utenti: [] };

  const collegati = [...righe.values()].map((r) => ({ riga: r, presenza: statoPresenza(r, adesso) })).filter((x) => eOnline(x.presenza));
  if (collegati.length === 0) return { disponibile: true, utenti: [] };

  const admin = createAdminClient();
  const ids = collegati.map((x) => x.riga.user_id);
  const [utentiQ, aziendeQ, membriQ] = await Promise.all([
    admin.from("users").select("id, email, role").in("id", ids),
    admin.from("companies").select("user_id, ragione_sociale"),
    admin.from("omnia_ai_membri").select("membro_id, titolare_id").in("membro_id", ids),
  ]);
  if (utentiQ.error) {
    console.error("Console: lettura degli utenti collegati fallita", utentiQ.error.message);
    return { disponibile: true, utenti: [] };
  }
  const utenti = new Map((utentiQ.data ?? []).map((u) => [u.id as string, u as { id: string; email: string; role: string }]));
  const aziende = new Map(((aziendeQ.data ?? []) as { user_id: string; ragione_sociale: string | null }[]).map((a) => [a.user_id, a.ragione_sociale]));
  const membri = membriQ.error ? new Map<string, string>() : new Map(((membriQ.data ?? []) as { membro_id: string; titolare_id: string }[]).map((m) => [m.membro_id, m.titolare_id]));

  // di chi è l'Ufficio Gare: l'azienda del titolare, o la sua email se l'azienda non ha un nome
  const titolari = new Map<string, string>();
  const idTitolari = [...new Set(membri.values())];
  if (idTitolari.length > 0) {
    const { data: emailTitolari } = await admin.from("users").select("id, email").in("id", idTitolari);
    for (const t of (emailTitolari ?? []) as { id: string; email: string }[]) titolari.set(t.id, t.email);
  }

  const elenco: UtenteOnline[] = [];
  for (const { riga, presenza } of collegati) {
    const u = utenti.get(riga.user_id);
    if (!u || u.role === "admin") continue;
    const titolareId = membri.get(riga.user_id) ?? null;
    elenco.push({
      id: u.id,
      email: u.email,
      azienda: aziende.get(u.id) ?? null,
      ufficioGareDi: titolareId ? (aziende.get(titolareId) ?? titolari.get(titolareId) ?? "un altro cliente") : null,
      presenza,
    });
  }
  const peso = (p: PresenzaCalcolata) => (p.stato === "attivo" ? 0 : 1);
  elenco.sort((a, b) => peso(a.presenza) - peso(b.presenza) || (b.presenza.ultimoSegnale ?? "").localeCompare(a.presenza.ultimoSegnale ?? ""));
  return { disponibile: true, utenti: elenco };
}
