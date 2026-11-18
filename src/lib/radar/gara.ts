// Lettura di una gara dell'archivio pubblico e dei dati riservati dell'impresa che la riguardano (salvata, monitorata). Solo server.
// L'archivio si legge con la chiave di servizio dopo le guardie; le tabelle riservate con la sessione dell'utente (regole di accesso).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StatoProcedura } from "./importa-calcoli";
import type { ProvenienzaCampi } from "./unione-calcoli";
import { aggiornamentoPerCliente, garaVisibileAiClienti, type FonteGara } from "./fonti-gara-calcoli";
import { fontiNascosteAiClienti, fontiVisibiliDa } from "./fonti-nascoste";
import { FONTI_UNITE } from "./unione-calcoli";
import { CLASSIFICAZIONI_SCHEDA, COLONNA_RIGHE_ATTIVE, classificazioneDaRiga, type ClassificazioneLetta, type ConClassificazioni } from "./classificazioni-lettura";

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
  scadenza_giorno: string | null;
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
  // fase B1-bis (0115): da quale fonte viene ogni gruppo di dati
  provenienza_campi: ProvenienzaCampi | null;
  // fase B1-bis (0117): gara che resta, se questa è collegata a un'altra
  unita_a: string | null;
  // fase B2a (0120): fonti della gara, base d'asta (Sintel, SardegnaCAT), tipo di opportunità
  fonti: string[] | null;
  valore_base: number | null;
  tipo_opportunita: string | null;
  partecipazione: string | null;
};

export type LottoPubblico = {
  id: string;
  numero_lotto: string | null;
  cig: string | null;
  oggetto: string | null;
  cpv_principale: string | null;
  valore_stimato: number | null;
  durata_mesi: number | null;
  scadenza_giorno: string | null;
  scadenza_offerte: string | null;
  scadenza_ora_indicata: boolean;
  url_documenti: string | null;
};

export type ProvenienzaAvviso = { fonte: string; id_fonte: string; url: string | null; pubblicato_il: string | null; versione: number | null; tipo_avviso: string | null; motivo_modifica: string | null; rilevato_il: string; aggiornato_il: string | null; procedura_id?: string };
export type AggiornamentoGara = { id: string; tipo: string; campo: string | null; valore_precedente: string | null; valore_nuovo: string | null; fonte: string; id_fonte: string | null; rilevato_il: string };

const COLONNE_GARA =
  "id, chiave, oggetto, oggetto_breve, descrizione, sa_codice_fiscale, sa_denominazione, sa_comune, sa_provincia, codice_nuts, luogo_regioni, ente_tipo, tipo_avviso, tipo_procedura, criterio_aggiudicazione, natura_contratto, settori_speciali, data_pubblicazione, scadenza_giorno, scadenza_offerte, scadenza_ora_indicata, scadenza_fonte, valore_stimato, durata_mesi, n_lotti, stato, rettificata, url_avviso, url_documenti, piattaforma_host, cpv_principale, cpv_tutti, settori, metodo_settore, ultima_versione_id, prima_rilevazione_il, ultima_rilevazione_il, provenienza_campi, unita_a, fonti, valore_base, tipo_opportunita, partecipazione";

const numero = (v: unknown) => (v === null || v === undefined ? null : Number(v));

const COLONNE_LOTTO_PUBBLICO = "id, numero_lotto, cig, oggetto, cpv_principale, valore_stimato, durata_mesi, scadenza_giorno, scadenza_offerte, scadenza_ora_indicata, url_documenti";
const COLONNE_AVVISO = "fonte, id_fonte, url, pubblicato_il, versione, tipo_avviso, motivo_modifica, rilevato_il, aggiornato_il, procedura_id";

export type DatiGaraPubblica = {
  gara: GaraPubblica;
  lotti: LottoPubblico[];
  provenienze: ProvenienzaAvviso[];
  aggiornamenti: AggiornamentoGara[];
  controlli: Record<string, string | null>;
  // gare collegate a questa (0117): restano intere nel database; qui se ne mostrano fonti e CIG dei lotti con lo stesso numero
  collegate: string[];
  cigCollegati: Map<string, string>;
  // fase B3: classificazione per settore della 0121 (solo con l'interruttore acceso e le tabelle leggibili); null = come prima
  classificazione: ClassificazioneLetta | null;
};

// controlli = ultimo giro riuscito di ciascuna fonte (la gara risulta verificata su quella fonte fino a quel momento)
// Fase B3: con le classificazioni accese, stato e righe attive della 0121 arrivano nella STESSA richiesta della gara (nessuna lettura in più).
export async function leggiGaraPubblica(admin: SupabaseClient, id: string, opzioni: { classificazioni?: boolean } = {}): Promise<DatiGaraPubblica | null> {
  const leggi = (conClassificazioni: boolean) =>
    conClassificazioni
      ? admin.from("radar_procedure").select(`${COLONNE_GARA}, ${CLASSIFICAZIONI_SCHEDA}`).eq("id", id).eq(COLONNA_RIGHE_ATTIVE, true).maybeSingle<GaraPubblica & ConClassificazioni>()
      : admin.from("radar_procedure").select(COLONNE_GARA).eq("id", id).maybeSingle<GaraPubblica & ConClassificazioni>();
  let conClassificazioni = opzioni.classificazioni === true;
  let { data: letta, error } = await leggi(conClassificazioni);
  if (error && conClassificazioni) {
    // tabelle della 0121 assenti o non leggibili: la scheda resta quella di prima
    conClassificazioni = false;
    ({ data: letta, error } = await leggi(false));
  }
  if (error || !letta) return null;
  const { classificazione_stato, classificazioni, ...gara } = letta;
  const classificazione = conClassificazioni ? classificazioneDaRiga({ classificazione_stato, classificazioni }) : null;
  // fonti non ancora mostrabili ai clienti (0120): una gara che ha SOLO quelle non esiste per il cliente; nelle altre non compaiono.
  // Una gara collegata a un'altra resta leggibile: la sua pagina porta alla gara che resta (0117).
  const nascoste = new Set(await fontiNascosteAiClienti());
  if (!gara.unita_a && !garaVisibileAiClienti(gara, nascoste)) return null;
  const [lotti, provenienze, aggiornamenti, fonti, collegateRaw] = await Promise.all([
    admin.from("radar_lotti").select(COLONNE_LOTTO_PUBBLICO).eq("procedura_id", id).order("numero_lotto").returns<LottoPubblico[]>(),
    admin.from("radar_procedure_fonti").select(COLONNE_AVVISO).eq("procedura_id", id).order("pubblicato_il", { ascending: false }).returns<ProvenienzaAvviso[]>(),
    admin.from("radar_aggiornamenti").select("id, tipo, campo, valore_precedente, valore_nuovo, fonte, id_fonte, rilevato_il").eq("procedura_id", id).order("rilevato_il", { ascending: false }).limit(50).returns<AggiornamentoGara[]>(),
    admin.from("radar_fonti_stato").select("fonte, ultimo_successo_il").in("fonte", fontiVisibiliDa([...nascoste])).returns<{ fonte: string; ultimo_successo_il: string | null }[]>(),
    admin.from("radar_procedure").select("id, chiave, fonti").eq("unita_a", id).returns<{ id: string; chiave: string; fonti: string[] | null }[]>(),
  ]);
  const collegate = (collegateRaw.data ?? []).map((r) => r.id);
  // CIG delle gare collegate: solo da quelle che hanno almeno una fonte visibile
  const collegateVisibili = (collegateRaw.data ?? []).filter((r) => garaVisibileAiClienti(r, nascoste)).map((r) => r.id);
  let avvisiCollegati: ProvenienzaAvviso[] = [];
  const cigCollegati = new Map<string, string>();
  if (collegate.length > 0) {
    const [pc, lc] = await Promise.all([
      admin.from("radar_procedure_fonti").select(COLONNE_AVVISO).in("procedura_id", collegate).returns<ProvenienzaAvviso[]>(),
      collegateVisibili.length > 0
        ? admin.from("radar_lotti").select("numero_lotto, cig").in("procedura_id", collegateVisibili).not("cig", "is", null).returns<{ numero_lotto: string | null; cig: string }[]>()
        : Promise.resolve({ data: [] as { numero_lotto: string | null; cig: string }[] }),
    ]);
    avvisiCollegati = pc.data ?? [];
    for (const l of lc.data ?? []) if (l.numero_lotto && !cigCollegati.has(l.numero_lotto)) cigCollegati.set(l.numero_lotto, l.cig);
  }
  return {
    gara: { ...gara, valore_stimato: numero(gara.valore_stimato), valore_base: numero(gara.valore_base) },
    lotti: (lotti.data ?? []).map((l) => ({ ...l, valore_stimato: numero(l.valore_stimato) })),
    provenienze: [...(provenienze.data ?? []), ...avvisiCollegati].filter((p) => !nascoste.has(p.fonte)).sort((a, b) => (b.pubblicato_il ?? "").localeCompare(a.pubblicato_il ?? "")),
    // mai le righe interne (suggerimenti di unione, classificazioni da verificare) né quelle di una fonte nascosta ai clienti
    aggiornamenti: (aggiornamenti.data ?? []).filter((a) => aggiornamentoPerCliente(a, nascoste)),
    controlli: Object.fromEntries((fonti.data ?? []).map((f) => [f.fonte, f.ultimo_successo_il])),
    collegate,
    cigCollegati,
    classificazione,
  };
}

// Le fonti (TED, PVL) delle gare di una pagina di risultati: una lettura sola, solo per le gare mostrate. Senza provenienza: TED.
export async function leggiFontiGare(admin: SupabaseClient, proceduraIds: string[]): Promise<Map<string, FonteGara[]>> {
  if (proceduraIds.length === 0) return new Map();
  // solo le fonti mostrabili ai clienti (0120); anche quelle delle gare collegate a queste (0117), attribuite alla gara che resta
  const visibili = fontiVisibiliDa(await fontiNascosteAiClienti());
  const [{ data }, { data: collegate }] = await Promise.all([
    admin.from("radar_procedure_fonti").select("procedura_id, fonte").in("procedura_id", proceduraIds).in("fonte", visibili).returns<{ procedura_id: string; fonte: FonteGara }[]>(),
    admin.from("radar_procedure").select("id, unita_a").in("unita_a", proceduraIds).returns<{ id: string; unita_a: string }[]>(),
  ]);
  const righe = [...(data ?? [])];
  if ((collegate ?? []).length) {
    const restaDi = new Map((collegate ?? []).map((c) => [c.id, c.unita_a]));
    const { data: extra } = await admin.from("radar_procedure_fonti").select("procedura_id, fonte").in("procedura_id", [...restaDi.keys()]).in("fonte", visibili).returns<{ procedura_id: string; fonte: FonteGara }[]>();
    for (const r of extra ?? []) righe.push({ procedura_id: restaDi.get(r.procedura_id) as string, fonte: r.fonte });
  }
  const out = new Map<string, FonteGara[]>();
  for (const r of righe) {
    const v = out.get(r.procedura_id) ?? [];
    if (!v.includes(r.fonte)) v.push(r.fonte);
    out.set(r.procedura_id, v);
  }
  for (const [k, v] of out) out.set(k, FONTI_UNITE.filter((f) => v.includes(f)));
  return out;
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
