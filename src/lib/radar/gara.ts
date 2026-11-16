// Lettura di una gara dell'archivio pubblico e dei dati riservati dell'impresa che la riguardano (salvata, monitorata). Solo server.
// L'archivio si legge con la chiave di servizio dopo le guardie; le tabelle riservate con la sessione dell'utente (regole di accesso).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StatoProcedura } from "./importa-calcoli";

export type GaraPubblica = {
  id: string;
  chiave: string;
  oggetto: string;
  oggetto_breve: string | null;
  descrizione: string | null;
  sa_codice_fiscale: string | null;
  sa_denominazione: string | null;
  sa_comune: string | null;
  sa_provincia: string | null;
  codice_nuts: string | null;
  luogo_regioni: string[];
  ente_tipo: string | null;
  tipo_avviso: string | null;
  tipo_procedura: string | null;
  criterio_aggiudicazione: string | null;
  natura_contratto: "servizi" | "forniture" | "lavori" | "misto" | null;
  settori_speciali: boolean | null;
  data_pubblicazione: string | null;
  scadenza_offerte: string | null;
  scadenza_ora_indicata: boolean;
  scadenza_fonte: string | null;
  valore_stimato: number | null;
  durata_mesi: number | null;
  n_lotti: number | null;
  stato: StatoProcedura;
  rettificata: boolean;
  url_avviso: string | null;
  url_documenti: string | null;
  piattaforma_host: string | null;
  cpv_principale: string | null;
  cpv_tutti: string[];
  settori: string[];
  metodo_settore: "cpv" | "parole_chiave" | null;
  ultima_versione_id: string | null;
  prima_rilevazione_il: string;
  ultima_rilevazione_il: string;
};

export type LottoPubblico = {
  id: string;
  numero_lotto: string | null;
  cig: string | null;
  oggetto: string | null;
  cpv_principale: string | null;
  valore_stimato: number | null;
  durata_mesi: number | null;
  scadenza_offerte: string | null;
  scadenza_ora_indicata: boolean;
  url_documenti: string | null;
};

export type ProvenienzaAvviso = { fonte: string; id_fonte: string; url: string | null; pubblicato_il: string | null; versione: number | null; tipo_avviso: string | null; motivo_modifica: string | null; rilevato_il: string };
export type AggiornamentoGara = { id: string; tipo: string; campo: string | null; valore_precedente: string | null; valore_nuovo: string | null; fonte: string; id_fonte: string | null; rilevato_il: string };

const COLONNE_GARA =
  "id, chiave, oggetto, oggetto_breve, descrizione, sa_codice_fiscale, sa_denominazione, sa_comune, sa_provincia, codice_nuts, luogo_regioni, ente_tipo, tipo_avviso, tipo_procedura, criterio_aggiudicazione, natura_contratto, settori_speciali, data_pubblicazione, scadenza_offerte, scadenza_ora_indicata, scadenza_fonte, valore_stimato, durata_mesi, n_lotti, stato, rettificata, url_avviso, url_documenti, piattaforma_host, cpv_principale, cpv_tutti, settori, metodo_settore, ultima_versione_id, prima_rilevazione_il, ultima_rilevazione_il";

const numero = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function leggiGaraPubblica(admin: SupabaseClient, id: string): Promise<{ gara: GaraPubblica; lotti: LottoPubblico[]; provenienze: ProvenienzaAvviso[]; aggiornamenti: AggiornamentoGara[] } | null> {
  const { data: gara, error } = await admin.from("radar_procedure").select(COLONNE_GARA).eq("id", id).maybeSingle<GaraPubblica>();
  if (error || !gara) return null;
  const [lotti, provenienze, aggiornamenti] = await Promise.all([
    admin.from("radar_lotti").select("id, numero_lotto, cig, oggetto, cpv_principale, valore_stimato, durata_mesi, scadenza_offerte, scadenza_ora_indicata, url_documenti").eq("procedura_id", id).order("numero_lotto").returns<LottoPubblico[]>(),
    admin.from("radar_procedure_fonti").select("fonte, id_fonte, url, pubblicato_il, versione, tipo_avviso, motivo_modifica, rilevato_il").eq("procedura_id", id).order("pubblicato_il", { ascending: false }).returns<ProvenienzaAvviso[]>(),
    admin.from("radar_aggiornamenti").select("id, tipo, campo, valore_precedente, valore_nuovo, fonte, id_fonte, rilevato_il").eq("procedura_id", id).order("rilevato_il", { ascending: false }).limit(50).returns<AggiornamentoGara[]>(),
  ]);
  return {
    gara: { ...gara, valore_stimato: numero(gara.valore_stimato) },
    lotti: (lotti.data ?? []).map((l) => ({ ...l, valore_stimato: numero(l.valore_stimato) })),
    provenienze: provenienze.data ?? [],
    aggiornamenti: aggiornamenti.data ?? [],
  };
}

export type Salvataggio = { id: string; monitorata: boolean; ultimo_aggiornamento_visto_il: string | null; creata_il: string };

// Salvataggi dell'impresa per un insieme di gare pubbliche (sessione dell'utente: le regole di accesso mostrano solo i suoi).
export async function leggiSalvataggi(sessione: SupabaseClient, proceduraIds: string[]): Promise<Map<string, Salvataggio>> {
  if (proceduraIds.length === 0) return new Map();
  const { data } = await sessione
    .from("omnia_ai_radar_salvate")
    .select("id, procedura_id, monitorata, ultimo_aggiornamento_visto_il, creata_il")
    .in("procedura_id", proceduraIds)
    .returns<(Salvataggio & { procedura_id: string })[]>();
  return new Map((data ?? []).map((r) => [r.procedura_id, r]));
}
