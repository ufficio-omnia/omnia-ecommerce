import type { SupabaseClient } from "@supabase/supabase-js";
import { acquisisciBlocco, rilasciaBlocco } from "@/lib/demo-blocco";
import { COLONNE_ADS, chiamaGoogle, configurazioneAdsDaAmbiente, registraEsitoInvioAds, riconciliaInviata, riservaInvioAds, type EsitoRiconciliazione, type LeadAds } from "@/lib/demo-ads-data-manager";
import {
  dataMinimaReale,
  esitoDaRispostaIngest,
  faseAds,
  fraseInvioAds,
  inviabileAMano,
  mascheraIdentificativo,
  motiviStatoNonInviabile,
  type FaseAds,
  type MotivoStatoNonInviabile,
} from "@/lib/demo-ads-invio-calcoli";
import { fraseCorretta, idRichiestaValido } from "@/lib/demo-ga4-prova-calcoli";
import { consensiVerificati, type ConsensiVerificati } from "@/lib/demo-consensi-calcoli";
import { leggiConsensi, verificatoreFirma } from "@/lib/demo-consensi";
import { URL_DATA_MANAGER_INGEST, costruisciRichiestaAds, identificativoClic, type MotivoNonInviabile } from "@/lib/demo-conversioni-calcoli";
import { segretoFirmaConsensi, sha256Hex } from "@/lib/demo-hash";
import { credenzialiDaAmbiente, ottieniTokenAccesso } from "@/lib/google-oauth";
import { schemaAssente } from "@/lib/omnia-ai-incassi";

// INVIO REALE di UNA conversione Google Ads, su comando dell'amministratore, per UNA richiesta di demo. Questo modulo NON controlla chi lo
// chiama: il controllo admin sta nell'azione della console (azioni/demo-ads-invio.ts), come prima operazione. Regole e motivazioni:
// demo-ads-invio-calcoli.ts, demo-ads-data-manager.ts e GUIDA-DEMO-TRACCIAMENTO.md (sezione «Invio reale a Google Ads»).
//
// Va bene anche col cron in «SOLO VERIFICA»: l'invio manuale è una decisione esplicita e separata (frase digitata, specifica della
// richiesta), e NON dipende dalla variabile DEMO_ADS_VALIDATE_ONLY. Non serve nessuna variabile in più.
//
// Ordine delle operazioni (ogni passo che fallisce FERMA tutto, prima di mandare qualcosa):
//   1. interruttori (importazione accesa, account, azione, credenziali, segreto della firma) e frase digitata (con l'id della richiesta);
//   2. blocco condiviso con il cron (nessuna esecuzione in parallelo);
//   3. richiesta letta dal database: confermata, stato inviabile, clic, consensi con FIRMA verificata, richiesta costruibile;
//   4. token di accesso di Google (se manca non si è prenotato niente);
//   5. PRENOTAZIONE con scrittura condizionata: da qui in poi nessun altro (cron compreso) può inviare per questa richiesta;
//   6. UN solo invio, validateOnly=false, senza ritentativi, con tempo massimo;
//   7. esito registrato: «sent» con id di richiesta, oppure «sent» senza id e codice (INCERTO), oppure «failed» (rifiuto chiaro).
// Mai nei risultati, nei log o negli errori: email, identificativi di clic, token, corpi di richiesta.

// 10 secondi, come l'invio a GA4: la pagina della console ha 30 secondi in tutto (token, letture, scritture e questa chiamata).
export const TEMPO_MASSIMO_INVIO_ADS_MS = 10_000;
const MASSIMO_RICHIESTE_ELENCO = 30;

// ── Interruttori ────────────────────────────────────────────────────────────────────────────────────────────────────────

export type MotivoInvioAdsSpento = "importazione_spenta" | "configurazione_incompleta" | "credenziali_mancanti" | "segreto_firma_mancante";

export const TESTO_INVIO_ADS_SPENTO: Record<MotivoInvioAdsSpento, string> = {
  importazione_spenta: "L'importazione Google Ads è spenta (DEMO_ADS_IMPORT_ENABLED diverso da 1).",
  configurazione_incompleta: "Mancano l'account Google Ads o l'azione di conversione (GOOGLE_ADS_CUSTOMER_ID, GOOGLE_ADS_DEMO_CONVERSION_ACTION_ID).",
  credenziali_mancanti: "Mancano le credenziali OAuth di Google Ads (client id, client secret, refresh token).",
  segreto_firma_mancante: "Manca il segreto con cui si verificano le firme dei consensi.",
};

export type StatoGateInvioAds = {
  attivo: boolean;
  mancanti: MotivoInvioAdsSpento[];
  // cosa fa il CRON (non l'invio manuale): solo verifica oppure reale, e da quale data può inviare
  modalitaCron: "solo_verifica" | "reale";
  dataMinimaCron: string | null;
  // account e azione, solo le ultime tre cifre: servono a riconoscerli, non a usarli
  contoMascherato: string | null;
  azioneMascherata: string | null;
};

export function statoGateInvioAds(env: Record<string, string | undefined>): StatoGateInvioAds {
  const config = configurazioneAdsDaAmbiente(env);
  const mancanti: MotivoInvioAdsSpento[] = [];
  if (env.DEMO_ADS_IMPORT_ENABLED !== "1") mancanti.push("importazione_spenta");
  if (!config) mancanti.push("configurazione_incompleta");
  if (!credenzialiDaAmbiente(env, "GOOGLE_ADS_REFRESH_TOKEN")) mancanti.push("credenziali_mancanti");
  if (!segretoFirmaConsensi(env)) mancanti.push("segreto_firma_mancante");
  return {
    attivo: mancanti.length === 0,
    mancanti,
    modalitaCron: env.DEMO_ADS_VALIDATE_ONLY === "0" ? "reale" : "solo_verifica",
    dataMinimaCron: dataMinimaReale(env)?.iso ?? null,
    contoMascherato: config ? mascheraIdentificativo(config.idCliente) : null,
    azioneMascherata: config ? mascheraIdentificativo(config.idAzioneConversione) : null,
  };
}

// ── Elenco (sola lettura) ────────────────────────────────────────────────────────────────────────────────────────────────

export type MotivoNonInviabileAMano = MotivoStatoNonInviabile | Exclude<MotivoNonInviabile, "non_confermata">;

export const TESTO_NON_INVIABILE_ADS: Record<MotivoNonInviabileAMano, string> = {
  non_confermata: "la prenotazione non è confermata",
  stato_non_inviabile: "è già stata inviata o non è inviabile",
  tentativi_esauriti: "tentativi esauriti",
  senza_data: "manca la data della prenotazione",
  senza_identificativo: "nessun identificativo di clic",
  troppo_vecchia: "prenotazione più vecchia di 90 giorni",
  senza_consenso: "consensi non validi (informativa, cookie pubblicitari o firma)",
};

export type AnteprimaInvioAds = {
  conversionTime: string;
  transactionId: string;
  usaClic: "gclid" | "gbraid" | "wbraid" | null;
  usaEmail: boolean;
  adUserData: "CONSENT_GRANTED" | "CONSENT_DENIED";
  adPersonalization: "CONSENT_GRANTED" | "CONSENT_DENIED";
  validateOnly: boolean;
};

export type RigaInvioAds = {
  leadId: string;
  azienda: string;
  settore: string;
  creataIl: string;
  prenotataIl: string | null;
  statoDb: LeadAds["ads_import_status"];
  fase: FaseAds;
  tentativi: number;
  requestId: string | null;
  errore: string | null;
  inviataIl: string | null;
  prossimoTentativoIl: string | null;
  consensi: ConsensiVerificati;
  inviabile: boolean;
  motivi: MotivoNonInviabileAMano[];
  anteprima: AnteprimaInvioAds | null;
};

export type RisultatoElencoInvioAds = { ok: true; gate: StatoGateInvioAds; righe: RigaInvioAds[] } | { ok: false; motivo: "schema_assente" | "errore_database" };

type RigaElenco = LeadAds & { company: string | null };

// Le richieste che hanno (o possono avere) una conversione Google Ads: pronte, verificate, inviate, accettate, fallite. Sola lettura.
export async function leggiInvioAds(admin: SupabaseClient, env: Record<string, string | undefined>, adessoMs: number): Promise<RisultatoElencoInvioAds> {
  const gate = statoGateInvioAds(env);
  const segretoFirma = segretoFirmaConsensi(env);
  const config = configurazioneAdsDaAmbiente(env);
  const r = await admin
    .from("demo_leads")
    .select(`${COLONNE_ADS}, company`)
    .in("ads_import_status", ["ready", "validated", "sent", "accepted", "failed"])
    .order("created_at", { ascending: false })
    .limit(MASSIMO_RICHIESTE_ELENCO)
    .returns<RigaElenco[]>();
  if (r.error) return { ok: false, motivo: schemaAssente(r.error) ? "schema_assente" : "errore_database" };
  const leads = r.data ?? [];
  const letti = await leggiConsensi(admin, leads.map((l) => l.id));
  if (!letti.ok) return { ok: false, motivo: "errore_database" };
  const verifica = segretoFirma ? verificatoreFirma(segretoFirma) : undefined;

  const righe: RigaInvioAds[] = leads.map((lead) => {
    // senza il segreto della firma i consensi NON si considerano validi (come per l'invio vero)
    const consensi: ConsensiVerificati = verifica ? consensiVerificati(letti.perRichiesta.get(lead.id) ?? [], verifica) : { privacy: false, cookie: false, misurazione: false };
    const fase = faseAds(lead, adessoMs);
    const motivi: MotivoNonInviabileAMano[] = [...motiviStatoNonInviabile(lead)];
    let anteprima: AnteprimaInvioAds | null = null;
    if (config && motivi.length === 0) {
      const c = costruisciRichiestaAds(lead, { ...config, soloVerifica: false }, adessoMs, sha256Hex, { consentiSoloEmail: env.DEMO_ADS_ALLOW_EMAIL_ONLY === "1" }, consensi);
      if (!c.ok) motivi.push(c.motivo);
      else {
        const evento = c.richiesta.events[0];
        anteprima = {
          conversionTime: evento.eventTimestamp,
          transactionId: evento.transactionId,
          usaClic: identificativoClic(lead)?.campo ?? null,
          usaEmail: !!evento.userData,
          adUserData: c.richiesta.consent.adUserData,
          adPersonalization: c.richiesta.consent.adPersonalization,
          validateOnly: c.richiesta.validateOnly,
        };
      }
    }
    return {
      leadId: lead.id,
      azienda: (lead.company ?? "").slice(0, 120),
      settore: lead.sector,
      creataIl: lead.created_at,
      prenotataIl: lead.prima_prenotazione_il,
      statoDb: lead.ads_import_status,
      fase,
      tentativi: lead.ads_attempts,
      requestId: lead.ads_request_id,
      errore: lead.ads_last_error,
      inviataIl: lead.ads_sent_at,
      prossimoTentativoIl: lead.ads_next_attempt_at,
      consensi,
      inviabile: motivi.length === 0 && anteprima !== null,
      motivi,
      anteprima,
    };
  });
  return { ok: true, gate, righe };
}

// ── Invio ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type RifiutoInvioAds = "invio_spento" | "id_non_valido" | "frase_errata" | "occupato" | "non_trovata" | "non_inviabile" | "token_non_ottenuto" | "gia_prenotata" | "errore_database";

export type RisultatoInvioAds =
  | { ok: false; motivo: RifiutoInvioAds; mancanti?: MotivoInvioAdsSpento[]; motivi?: MotivoNonInviabileAMano[] }
  | {
      // «ok» = l'invio è stato TENTATO (una sola volta). NON significa che Google abbia registrato la conversione: guardare «fase».
      ok: true;
      fase: FaseAds;
      codice: string | null;
      // l'identificativo di richiesta di Google (non è un dato personale); se l'esito non si è potuto registrare serve per controllare a mano
      requestId: string | null;
      esitoRegistrato: boolean;
      conversionTime: string;
      transactionId: string;
    };

export async function inviaConversioneAds(
  admin: SupabaseClient,
  env: Record<string, string | undefined>,
  input: { leadId: unknown; frase: unknown },
  adessoMs: number,
  fetchFn: typeof fetch = fetch,
  tempoMassimoMs: number = TEMPO_MASSIMO_INVIO_ADS_MS,
): Promise<RisultatoInvioAds> {
  // 1. interruttori, id e frase
  const gate = statoGateInvioAds(env);
  const config = configurazioneAdsDaAmbiente(env);
  const credenziali = credenzialiDaAmbiente(env, "GOOGLE_ADS_REFRESH_TOKEN");
  const segretoFirma = segretoFirmaConsensi(env);
  if (!gate.attivo || !config || !credenziali || !segretoFirma) return { ok: false, motivo: "invio_spento", mancanti: gate.mancanti };
  if (!idRichiestaValido(input.leadId)) return { ok: false, motivo: "id_non_valido" };
  const leadId = input.leadId;
  if (!fraseCorretta(input.frase, fraseInvioAds(leadId))) return { ok: false, motivo: "frase_errata" };

  // 2. blocco condiviso con il cron: se c'è un giro in corso si rinuncia (nessuna attesa, nessun ritentativo)
  const blocco = await acquisisciBlocco(admin, adessoMs);
  if (blocco === "occupato") return { ok: false, motivo: "occupato" };
  if (blocco === "non_disponibile") return { ok: false, motivo: "errore_database" };
  try {
    // 3. la richiesta, riletta dal database (non ci si fida di ciò che ha visto la pagina)
    const lr = await admin.from("demo_leads").select(COLONNE_ADS).eq("id", leadId).maybeSingle<LeadAds>();
    if (lr.error) return { ok: false, motivo: "errore_database" };
    if (!lr.data) return { ok: false, motivo: "non_trovata" };
    const lead = lr.data;
    if (!inviabileAMano(lead)) return { ok: false, motivo: "non_inviabile", motivi: motiviStatoNonInviabile(lead) };
    const letti = await leggiConsensi(admin, [lead.id]);
    if (!letti.ok) return { ok: false, motivo: "errore_database" };
    const consensi = consensiVerificati(letti.perRichiesta.get(lead.id) ?? [], verificatoreFirma(segretoFirma));
    const costruzione = costruisciRichiestaAds(lead, { ...config, soloVerifica: false }, adessoMs, sha256Hex, { consentiSoloEmail: env.DEMO_ADS_ALLOW_EMAIL_ONLY === "1" }, consensi);
    if (!costruzione.ok) return { ok: false, motivo: "non_inviabile", motivi: [costruzione.motivo] };
    const richiesta = costruzione.richiesta;
    // difesa in più: si invia solo una richiesta che dichiara validateOnly=false
    if (richiesta.validateOnly !== false) return { ok: false, motivo: "non_inviabile", motivi: ["stato_non_inviabile"] };
    const evento = richiesta.events[0];

    // 4. il token PRIMA di prenotare: se non si ottiene, non è successo niente
    const token = await ottieniTokenAccesso(credenziali, fetchFn);
    if (!token) return { ok: false, motivo: "token_non_ottenuto" };

    // 5. prenotazione: dopo questo punto nessun altro può inviare per questa richiesta
    const riserva = await riservaInvioAds(admin, lead, new Date(adessoMs).toISOString());
    if (riserva === "non_riservata") return { ok: false, motivo: "gia_prenotata" };
    if (riserva === "errore") return { ok: false, motivo: "errore_database" };

    // 6. UN solo invio, senza ritentativi
    const esito = esitoDaRispostaIngest(await chiamaGoogle(URL_DATA_MANAGER_INGEST, token, fetchFn, richiesta, tempoMassimoMs));

    // 7. l'esito si scrive sulla riga prenotata
    const registrato = await registraEsitoInvioAds(admin, lead.id, esito, lead.ads_attempts + 1, adessoMs, false);
    const fase: FaseAds = esito.tipo === "inviata" ? "in_elaborazione" : esito.tipo === "incerta" ? "incerta" : "rifiutata";
    return {
      ok: true,
      fase,
      codice: esito.tipo === "inviata" ? null : esito.codice,
      requestId: esito.tipo === "inviata" ? esito.requestId : null,
      esitoRegistrato: registrato,
      conversionTime: evento.eventTimestamp,
      transactionId: evento.transactionId,
    };
  } finally {
    await rilasciaBlocco(admin);
  }
}

// ── Controllo dell'esito (lettura su Google, scrive solo lo stato nel database) ──────────────────────────────────────────

export type RisultatoControlloAds =
  | { ok: false; motivo: "invio_spento" | "id_non_valido" | "non_trovata" | "non_controllabile" | "token_non_ottenuto" | "errore_database"; mancanti?: MotivoInvioAdsSpento[] }
  | { ok: true; esito: EsitoRiconciliazione; ragioni: string[]; httpStato: number | null };

// Legge requestStatus di una conversione già inviata (con identificativo di richiesta) e ne aggiorna lo stato. NON invia nessuna conversione:
// è una GET. Non serve frase.
export async function controllaEsitoAds(admin: SupabaseClient, env: Record<string, string | undefined>, input: { leadId: unknown }, adessoMs: number, fetchFn: typeof fetch = fetch): Promise<RisultatoControlloAds> {
  const gate = statoGateInvioAds(env);
  const credenziali = credenzialiDaAmbiente(env, "GOOGLE_ADS_REFRESH_TOKEN");
  if (!gate.attivo || !credenziali) return { ok: false, motivo: "invio_spento", mancanti: gate.mancanti };
  if (!idRichiestaValido(input.leadId)) return { ok: false, motivo: "id_non_valido" };
  const lr = await admin.from("demo_leads").select(COLONNE_ADS).eq("id", input.leadId).maybeSingle<LeadAds>();
  if (lr.error) return { ok: false, motivo: "errore_database" };
  if (!lr.data) return { ok: false, motivo: "non_trovata" };
  const lead = lr.data;
  if (lead.ads_import_status !== "sent" || !lead.ads_request_id) return { ok: false, motivo: "non_controllabile" };
  const token = await ottieniTokenAccesso(credenziali, fetchFn);
  if (!token) return { ok: false, motivo: "token_non_ottenuto" };
  const r = await riconciliaInviata(admin, token, lead, adessoMs, fetchFn, 0);
  return { ok: true, esito: r.esito, ragioni: r.ragioni, httpStato: r.httpStato };
}
