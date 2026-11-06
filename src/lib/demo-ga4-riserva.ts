import type { SupabaseClient } from "@supabase/supabase-js";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import {
  risolvibile,
  type CodiceEsitoInvio,
  type EsitoInvioProva,
  type EsitoRisoluzione,
  type RigaProvaGa4,
  type StatoProvaGa4,
} from "@/lib/demo-ga4-prova-calcoli";

// PRENOTAZIONE ESCLUSIVA dell'invio di un evento GA4 per una richiesta (tabella demo_ga4_prove, migrazione 0099). Solo SERVER.
// È scritta in modo da poter essere riutilizzata anche dal cron GA4 di produzione (colonna «origine»), ma oggi la usa solo la prova
// reale dell'amministratore (src/lib/demo-ga4-prova.ts).
//
// Come impedisce i doppioni:
//   - riservaInvioGa4 fa un INSERT: la chiave primaria (lead_id) è il vincolo. Il secondo tentativo, anche in parallelo e anche da
//     un'altra istanza del server, fallisce con «23505» e NON invia niente. Si prenota PRIMA di inviare (e non si segna DOPO): se
//     qualcosa si interrompe, resta una riga «reserved» e il rischio si sposta dal lato sicuro (un invio mancato, non un doppione).
//   - gli aggiornamenti sono «confronta e scambia»: si scrive solo se lo stato è ancora quello letto (.eq("stato", …)), e si controlla
//     che sia stata toccata UNA riga. Le transizioni valide le impone anche il database con un trigger.
// Nessuna funzione qui ritenta da sola un invio: i ritentativi sono una decisione dell'amministratore, e non sulla stessa richiesta.

export type OrigineRiserva = "prova" | "cron";

export type EsitoRiserva = { ok: true } | { ok: false; motivo: "gia_presente" | "schema_assente" | "errore_database" };

export type DatiRiserva = {
  leadId: string;
  origine: OrigineRiserva;
  utenteId: string | null;
  transactionId: string;
  idMisurazione: string;
  timestampEventoIso: string;
  modalitaTimestamp: "prenotazione" | "invio";
  adessoIso: string;
};

export async function riservaInvioGa4(admin: SupabaseClient, d: DatiRiserva): Promise<EsitoRiserva> {
  const { error } = await admin.from("demo_ga4_prove").insert({
    lead_id: d.leadId,
    origine: d.origine,
    stato: "reserved",
    transaction_id: d.transactionId,
    id_misurazione: d.idMisurazione,
    timestamp_evento: d.timestampEventoIso,
    timestamp_modalita: d.modalitaTimestamp,
    riservata_il: d.adessoIso,
    riservata_da: d.utenteId,
  });
  if (!error) return { ok: true };
  if (error.code === "23505") return { ok: false, motivo: "gia_presente" };
  if (schemaAssente(error)) return { ok: false, motivo: "schema_assente" };
  return { ok: false, motivo: "errore_database" };
}

// Registra l'esito SOLO se la riga è ancora «reserved» (una scrittura sola, con controllo di avere toccato esattamente una riga).
// Restituisce false se non è stato possibile: la riga resta «reserved» e l'amministratore la risolve a mano.
export async function registraEsitoInvio(admin: SupabaseClient, leadId: string, esito: EsitoInvioProva, adessoIso: string): Promise<boolean> {
  const { data, error } = await admin
    .from("demo_ga4_prove")
    .update({ stato: esito.stato, esito_codice: esito.codice, http_status: esito.httpStato, inviata_il: adessoIso, aggiornata_il: adessoIso })
    .eq("lead_id", leadId)
    .eq("stato", "reserved")
    .select("lead_id");
  return !error && (data ?? []).length === 1;
}

export type EsitoRisoluzioneDb =
  | { ok: true; da: StatoProvaGa4 }
  | { ok: false; motivo: "non_trovata" | "non_risolvibile" | "cambiata_nel_frattempo" | "schema_assente" | "errore_database"; stato?: StatoProvaGa4 };

// L'amministratore dichiara cosa ha visto in GA4: «verified» (c'è) o «not_received» (non c'è). Solo da uno stato «da risolvere» (o da
// una riserva interrotta da più di 5 minuti), e solo se nel frattempo lo stato non è cambiato.
export async function risolviProvaGa4(admin: SupabaseClient, leadId: string, esito: EsitoRisoluzione, utenteId: string | null, adessoMs: number): Promise<EsitoRisoluzioneDb> {
  const letta = await admin.from("demo_ga4_prove").select("stato, riservata_il").eq("lead_id", leadId).maybeSingle<{ stato: StatoProvaGa4; riservata_il: string }>();
  if (letta.error) return { ok: false, motivo: schemaAssente(letta.error) ? "schema_assente" : "errore_database" };
  if (!letta.data) return { ok: false, motivo: "non_trovata" };
  if (!risolvibile(letta.data.stato, letta.data.riservata_il, adessoMs)) return { ok: false, motivo: "non_risolvibile", stato: letta.data.stato };

  const adessoIso = new Date(adessoMs).toISOString();
  const { data, error } = await admin
    .from("demo_ga4_prove")
    .update({ stato: esito, risolta_il: adessoIso, risolta_da: utenteId, aggiornata_il: adessoIso })
    .eq("lead_id", leadId)
    .eq("stato", letta.data.stato)
    .select("lead_id");
  if (error) return { ok: false, motivo: schemaAssente(error) ? "schema_assente" : "errore_database" };
  if ((data ?? []).length !== 1) return { ok: false, motivo: "cambiata_nel_frattempo" };
  return { ok: true, da: letta.data.stato };
}

type RigaDb = {
  lead_id: string;
  origine: "prova" | "cron";
  stato: StatoProvaGa4;
  riservata_il: string;
  inviata_il: string | null;
  esito_codice: CodiceEsitoInvio | null;
  http_status: number | null;
  timestamp_evento: string;
  timestamp_modalita: "prenotazione" | "invio";
  id_misurazione: string;
  risolta_il: string | null;
};

const COLONNE = "lead_id, origine, stato, riservata_il, inviata_il, esito_codice, http_status, timestamp_evento, timestamp_modalita, id_misurazione, risolta_il";
const LIMITE_PROVE = 100;

export type LetturaProve = { stato: "ok"; righe: RigaProvaGa4[] } | { stato: "tabella_assente" } | { stato: "errore" };

export async function leggiProveGa4(admin: SupabaseClient, adessoMs: number): Promise<LetturaProve> {
  const r = await admin.from("demo_ga4_prove").select(COLONNE).order("riservata_il", { ascending: false }).limit(LIMITE_PROVE).returns<RigaDb[]>();
  if (r.error) return schemaAssente(r.error) ? { stato: "tabella_assente" } : { stato: "errore" };
  return {
    stato: "ok",
    righe: (r.data ?? []).map((x) => ({
      leadId: x.lead_id,
      origine: x.origine,
      stato: x.stato,
      riservataIl: x.riservata_il,
      inviataIl: x.inviata_il,
      esitoCodice: x.esito_codice,
      httpStato: x.http_status,
      timestampEventoIl: x.timestamp_evento,
      modalitaTimestamp: x.timestamp_modalita,
      idMisurazione: x.id_misurazione,
      risoltaIl: x.risolta_il,
      risolvibile: risolvibile(x.stato, x.riservata_il, adessoMs),
    })),
  };
}

// Quali di queste richieste hanno una riga nel registro (in QUALUNQUE stato): il cron GA4 non le riprende mai. Se la tabella non esiste
// non ci sono riserve: elenco vuoto. Qualunque altro errore → ok:false (il chiamante, se deve inviare davvero, si ferma).
export async function idRichiesteRiservate(admin: SupabaseClient, leadIds: string[]): Promise<{ ok: true; ids: Set<string> } | { ok: false }> {
  if (leadIds.length === 0) return { ok: true, ids: new Set() };
  const r = await admin.from("demo_ga4_prove").select("lead_id").in("lead_id", leadIds).returns<{ lead_id: string }[]>();
  if (r.error) return schemaAssente(r.error) ? { ok: true, ids: new Set() } : { ok: false };
  return { ok: true, ids: new Set((r.data ?? []).map((x) => x.lead_id)) };
}
