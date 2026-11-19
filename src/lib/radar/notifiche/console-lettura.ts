// Fase B4 (19/11/2026, B2) — letture di SOLA LETTURA per la pagina della console «Messaggi non consegnati» di B1 (26A §4). Solo server,
// client di servizio, dopo la guardia degli amministratori della console. Nessuna scrittura, nessun polling.
//
// Mai indirizzi email (non sono nemmeno salvati) né testi delle email: dell'evento si leggono solo tipo, categoria, chiave della gara e la
// denominazione breve dai dati congelati. Una richiesta per lettura, sugli indici della 0125 (consegne con problemi per data e id,
// conteggi per stato con la funzione radar_email_conteggi, ultimi giri). Tabelle assenti (0125 non applicata) = «non disponibile».

import type { SupabaseClient } from "@supabase/supabase-js";
import { schemaAssente } from "@/lib/omnia-ai-incassi";

export const STATI_PROBLEMA = ["fallita", "esito_incerto", "rimbalzata", "reclamo"] as const;
export type StatoProblema = (typeof STATI_PROBLEMA)[number];

export const STATI_CONSEGNA = ["in_coda", "in_invio", "inviata", "annullata", "scartata", "fallita", "esito_incerto", "rimbalzata", "reclamo"] as const;
export type StatoConsegna = (typeof STATI_CONSEGNA)[number];

/** Colonne lette: nessun indirizzo, nessun testo; dall'evento solo tipo, categoria, gara e denominazione. */
export const COLONNE_PROBLEMI =
  "id, aggiornata_il, creata_il, impresa_id, ruolo, stato, tentativi, ultimo_errore, motivo, provider, " +
  "evento:omnia_ai_radar_eventi(tipo, categoria, gara_chiave, denominazione:dati->gara->>denominazione)";

export const COLONNE_GIRI = "id, giorno_roma, fase, esito, iniziato_il, finito_il, ambiente, provider, conteggi, errore";

export type RigaProblema = {
  id: string;
  aggiornata_il: string;
  creata_il: string;
  impresa_id: string;
  ruolo: "titolare" | "ufficio_gare";
  stato: StatoProblema;
  tentativi: number;
  ultimo_errore: string | null;
  motivo: string | null;
  provider: "finto" | "resend" | null;
  evento: { tipo: string; categoria: string; gara_chiave: string; denominazione: string | null } | null;
};

export type Cursore = { aggiornataIl: string; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// istante come lo restituisce Postgres/PostgREST (es. 2026-11-19T10:00:00.123456+00:00): nient'altro entra nel filtro
const ISTANTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

/** Cursore opaco per l'indirizzo della pagina (base64url di «istante|id»). */
export function codificaCursore(c: Cursore): string {
  return Buffer.from(`${c.aggiornataIl}|${c.id}`, "utf8").toString("base64url");
}

/** Dal parametro della pagina al cursore; null se non valido (si riparte dalla prima pagina). */
export function decodificaCursore(s: string | null | undefined): Cursore | null {
  if (!s || s.length > 200 || !/^[A-Za-z0-9_-]+$/.test(s)) return null;
  const [aggiornataIl, id, ...resto] = Buffer.from(s, "base64url").toString("utf8").split("|");
  if (resto.length || !aggiornataIl || !id || !ISTANTE.test(aggiornataIl) || !UUID.test(id)) return null;
  return { aggiornataIl, id };
}

/** Il filtro «dopo il cursore» nell'ordine (aggiornata_il desc, id desc), con i valori tra virgolette. */
export function filtroDopoCursore(c: Cursore): string {
  return `aggiornata_il.lt."${c.aggiornataIl}",and(aggiornata_il.eq."${c.aggiornataIl}",id.lt.${c.id})`;
}

export type PaginaProblemi =
  | { disponibile: true; righe: RigaProblema[]; prossimo: string | null }
  | { disponibile: false; motivo: string };

/** Le consegne con problemi (fallita, esito incerto, rimbalzata, reclamo), le più recenti prima, `limite` per pagina (al più 100). */
export async function leggiProblemiEmail(admin: SupabaseClient, opzioni: { cursore?: string | null; limite?: number } = {}): Promise<PaginaProblemi> {
  const limite = Math.min(Math.max(Math.trunc(opzioni.limite ?? 50), 1), 100);
  const c = decodificaCursore(opzioni.cursore);
  let q = admin
    .from("omnia_ai_radar_email_consegne")
    .select(COLONNE_PROBLEMI)
    .in("stato", [...STATI_PROBLEMA])
    .order("aggiornata_il", { ascending: false })
    .order("id", { ascending: false })
    .limit(limite + 1);
  if (c) q = q.or(filtroDopoCursore(c));
  const { data, error } = await q.returns<RigaProblema[]>();
  if (error) return { disponibile: false, motivo: schemaAssente(error) ? "tabelle_assenti" : `errore: ${error.message}` };
  const righe = (data ?? []).slice(0, limite);
  const ultima = righe[righe.length - 1];
  const prossimo = (data ?? []).length > limite && ultima ? codificaCursore({ aggiornataIl: ultima.aggiornata_il, id: ultima.id }) : null;
  return { disponibile: true, righe, prossimo };
}

export type ConteggiStati = { disponibile: true; dal: string; perStato: Record<StatoConsegna, number> } | { disponibile: false; motivo: string };

/** Conteggi per stato delle consegne create dal `dal` (di solito gli ultimi 7 giorni): UNA richiesta alla funzione radar_email_conteggi. */
export async function contaConsegnePerStato(admin: SupabaseClient, dal: Date): Promise<ConteggiStati> {
  const dalIso = dal.toISOString();
  const { data, error } = await admin.rpc("radar_email_conteggi", { p_dal: dalIso });
  if (error) return { disponibile: false, motivo: schemaAssente(error) || error.code === "PGRST202" ? "tabelle_assenti" : `errore: ${error.message}` };
  const perStato = Object.fromEntries(STATI_CONSEGNA.map((s) => [s, 0])) as Record<StatoConsegna, number>;
  const righe: unknown[] = Array.isArray(data) ? data : [];
  for (const r of righe) {
    const x = r as { stato?: unknown; n?: unknown };
    if (typeof x.stato === "string" && (STATI_CONSEGNA as readonly string[]).includes(x.stato)) perStato[x.stato as StatoConsegna] = Number(x.n) || 0;
  }
  return { disponibile: true, dal: dalIso, perStato };
}

export type RigaGiro = {
  id: string;
  giorno_roma: string;
  fase: "eventi" | "invio";
  esito: "in_corso" | "riuscito" | "fallito" | "fermato";
  iniziato_il: string;
  finito_il: string | null;
  ambiente: string;
  provider: string;
  conteggi: Record<string, unknown>;
  errore: string | null;
};

/** Gli ultimi giri del processo giornaliero (al più 50). */
export async function leggiUltimiGiri(admin: SupabaseClient, limite = 10): Promise<{ disponibile: true; righe: RigaGiro[] } | { disponibile: false; motivo: string }> {
  const n = Math.min(Math.max(Math.trunc(limite), 1), 50);
  const { data, error } = await admin.from("radar_notifiche_giri").select(COLONNE_GIRI).order("iniziato_il", { ascending: false }).limit(n).returns<RigaGiro[]>();
  if (error) return { disponibile: false, motivo: schemaAssente(error) ? "tabelle_assenti" : `errore: ${error.message}` };
  return { disponibile: true, righe: data ?? [] };
}
