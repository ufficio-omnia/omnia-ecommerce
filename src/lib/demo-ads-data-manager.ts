import type { SupabaseClient } from "@supabase/supabase-js";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import {
  URL_DATA_MANAGER_INGEST,
  URL_DATA_MANAGER_STATO,
  TENTATIVI_MASSIMI,
  configurazioneAdsValida,
  costruisciRichiestaAds,
  idTransazioneAds,
  interpretaStatoRichiesta,
  prossimoTentativo,
  testoErroreSicuro,
  type ConfigurazioneAds,
  type LeadPerConversione,
} from "@/lib/demo-conversioni-calcoli";
import {
  LIMITE_INVII_REALI_PER_GIRO,
  aggiornamentoDopoInvio,
  codiceErroreGoogle,
  dataMinimaReale,
  esitoDaRispostaIngest,
  type EsitoChiamataAds,
} from "@/lib/demo-ads-invio-calcoli";
import { consensiVerificati } from "@/lib/demo-consensi-calcoli";
import { leggiConsensi, verificatoreFirma } from "@/lib/demo-consensi";
import { segretoFirmaConsensi, sha256Hex } from "@/lib/demo-hash";
import { credenzialiDaAmbiente, ottieniTokenAccesso } from "@/lib/google-oauth";

// Conversione Google Ads «OMNIA AI - DEMO prenotata» tramite la Data Manager API (conversioni offline da lead). Documentazione
// letta il 04/11/2026: POST datamanager.googleapis.com/v1/events:ingest e GET …/v1/requestStatus:retrieve.
//
// SPENTA finché DEMO_ADS_IMPORT_ENABLED non è «1» e non sono impostati account, azione di conversione e credenziali. Anche accesa,
// parte in modalità «SOLO VERIFICA» (validateOnly: Google controlla la richiesta ma NON registra la conversione) finché
// DEMO_ADS_VALIDATE_ONLY non è «0»: così si prova con le credenziali vere senza toccare i dati dell'account di produzione.
//
// Garanzie:
//   - si importano SOLO richieste con prenotazione confermata sul calendario (lo stato «ready» lo mette la sincronizzazione);
//   - il consenso si legge dal REGISTRO verificabile (demo_consensi), con la firma controllata: una riga alterata non vale;
//   - una conversione è «accepted» soltanto quando requestStatus risponde SUCCESS; finché è PROCESSING si aspetta; requestStatus si legge
//     ad ogni giro, in qualunque modalità (è una lettura: non registra niente);
//   - un identificativo di transazione stabile per RICHIESTA («omnia-demo-<id richiesta>»): se la stessa persona fa più richieste
//     ognuna ha il suo, se la stessa richiesta ha più prenotazioni (annullata e rifatta) ne ha uno solo;
//   - MODALITÀ REALE (DEMO_ADS_VALIDATE_ONLY=0) — pensata perché una conversione parta UNA sola volta:
//       · il cron invia solo richieste confermate DOPO la data minima DEMO_ADS_REAL_FROM; senza una data valida non invia NIENTE;
//       · prima di chiamare Google l'invio si PRENOTA con una scrittura condizionata (stato «sent», nessun id di richiesta): chi non la
//         ottiene non invia. Se la funzione muore durante la chiamata, la conversione resta «sent» senza esito: INCERTA, mai ripresa;
//       · un esito incerto (rete, tempo scaduto, 5xx, risposta senza id) non si rimanda mai da solo; un rifiuto chiaro (4xx) non si
//         riprova da solo (serve una persona); solo la quota superata (429), che non ha elaborato niente, si riprova con pause crescenti;
//       · al massimo LIMITE_INVII_REALI_PER_GIRO conversioni vere per giro;
//   - nei log e nel database solo codici di errore, mai email, identificativi di clic o corpi di richiesta.
// Gli stati e le regole sono in demo-ads-invio-calcoli.ts; l'invio manuale di UNA richiesta dalla console è in demo-ads-invio.ts.

const TEMPO_MASSIMO_MS = 15_000;
const ORE_MASSIME_ELABORAZIONE = 48;
export const ATTESA_MINIMA_CONTROLLO_MS = 60_000;

export type RisultatoAds = {
  abilitato: boolean;
  // se «abilitato» è false: perché non parte. «data_minima_mancante» = modalità reale senza DEMO_ADS_REAL_FROM valida: si leggono gli
  // esiti già inviati ma NON si invia niente di nuovo.
  motivo?: "spento" | "configurazione_incompleta" | "segreto_firma_mancante" | "token_non_ottenuto" | "schema_assente" | "errore_database" | "data_minima_mancante";
  modalita?: "solo_verifica" | "reale";
  verificati: number;
  inviati: number;
  accettati: number;
  inElaborazione: number;
  falliti: number;
  saltati: number;
  // conversioni vere dall'esito incerto (non rimandate)
  incerti: number;
};

const VUOTO = { verificati: 0, inviati: 0, accettati: 0, inElaborazione: 0, falliti: 0, saltati: 0, incerti: 0 };

export function configurazioneAdsDaAmbiente(env: Record<string, string | undefined>): ConfigurazioneAds | null {
  const candidata: Partial<ConfigurazioneAds> = {
    idCliente: env.GOOGLE_ADS_CUSTOMER_ID?.replace(/-/g, "").trim(),
    idClienteGestore: env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/-/g, "").trim() || undefined,
    idAzioneConversione: env.GOOGLE_ADS_DEMO_CONVERSION_ACTION_ID?.trim(),
    soloVerifica: env.DEMO_ADS_VALIDATE_ONLY !== "0",
  };
  return configurazioneAdsValida(candidata) ? candidata : null;
}

export type LeadAds = LeadPerConversione & { ads_next_attempt_at: string | null; ads_request_id: string | null; ads_sent_at: string | null; ads_last_error: string | null };

export const COLONNE_ADS =
  "id, email, booking_status, prima_prenotazione_il, created_at, sector, gclid, gbraid, wbraid, ga_client_id, ga_session_id, ga4_sent_at, ads_import_status, ads_attempts, ads_next_attempt_at, ads_request_id, ads_sent_at, ads_last_error";

export async function chiamaGoogle(url: string, token: string, fetchFn: typeof fetch, corpo?: unknown, tempoMassimoMs: number = TEMPO_MASSIMO_MS): Promise<{ stato: number; json: unknown } | null> {
  const controllo = new AbortController();
  const timer = setTimeout(() => controllo.abort(), tempoMassimoMs);
  try {
    const risposta = await fetchFn(url, {
      method: corpo === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${token}`, ...(corpo === undefined ? {} : { "Content-Type": "application/json" }) },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: controllo.signal,
    });
    return { stato: risposta.status, json: await risposta.json().catch(() => null) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── Prenotazione dell'invio e registro dell'esito ────────────────────────────────────────────────────────────────────────

// PRENOTA l'invio PRIMA di chiamare Google: scrittura condizionata allo stato che la richiesta aveva quando è stata letta (e senza
// identificativo di richiesta, e ancora confermata). Se nel frattempo qualcun altro l'ha cambiata, non si prenota e NON si invia.
// Da qui la richiesta è «sent» senza id: se l'esito non si registra resta INCERTA e nessuno la rimanda.
export async function riservaInvioAds(
  admin: SupabaseClient,
  lead: Pick<LeadAds, "id" | "ads_import_status" | "ads_attempts">,
  adessoIso: string,
): Promise<"riservata" | "non_riservata" | "errore"> {
  const { data, error } = await admin
    .from("demo_leads")
    .update({
      ads_import_status: "sent",
      ads_sent_at: adessoIso,
      ads_request_id: null,
      ads_last_error: null,
      ads_attempts: lead.ads_attempts + 1,
      ads_next_attempt_at: null,
      ads_transaction_id: idTransazioneAds(lead.id),
    })
    .eq("id", lead.id)
    .eq("booking_status", "confirmed")
    .eq("ads_import_status", lead.ads_import_status)
    .eq("ads_attempts", lead.ads_attempts)
    .is("ads_request_id", null)
    .select("id");
  if (error) return "errore";
  return (data ?? []).length === 1 ? "riservata" : "non_riservata";
}

// Scrive l'esito sulla riga prenotata (e solo su quella: «sent» senza id). Una scrittura che non riesce si riprova UNA volta: è il
// database, non Google, quindi non c'è il rischio di un doppione. false = esito non registrato (la richiesta resta «sent» senza id, cioè
// incerta: chi chiama deve mostrare l'identificativo di richiesta, se c'è, perché si possa controllare a mano).
export async function registraEsitoInvioAds(admin: SupabaseClient, leadId: string, esito: EsitoChiamataAds, tentativi: number, adessoMs: number, ritentoAutomatico: boolean): Promise<boolean> {
  const aggiornamento = aggiornamentoDopoInvio(esito, tentativi, adessoMs, ritentoAutomatico);
  for (let prova = 0; prova < 2; prova++) {
    const { data, error } = await admin.from("demo_leads").update(aggiornamento).eq("id", leadId).eq("ads_import_status", "sent").is("ads_request_id", null).select("id");
    if (!error && (data ?? []).length === 1) return true;
  }
  return false;
}

// ── Lettura dell'esito di una richiesta già inviata ──────────────────────────────────────────────────────────────────────

export type EsitoRiconciliazione = "accettata" | "fallita" | "in_corso" | "non_letta" | "troppo_presto";

// Legge requestStatus di UNA conversione «sent» con identificativo di richiesta e scrive lo stato. È una lettura: non registra niente su
// Google. SUCCESS → «accepted»; PARTIAL_SUCCESS/FAILED → «failed» (senza riprovare: serve una persona); PROCESSING → si aspetta, fino a 48
// ore; una risposta non leggibile non cambia niente (si riprova al giro dopo).
export async function riconciliaInviata(
  admin: SupabaseClient,
  token: string,
  lead: Pick<LeadAds, "id" | "ads_request_id" | "ads_sent_at">,
  adessoMs: number,
  fetchFn: typeof fetch,
  attesaMinimaMs: number = ATTESA_MINIMA_CONTROLLO_MS,
): Promise<{ esito: EsitoRiconciliazione; ragioni: string[]; httpStato: number | null }> {
  const inviataAlle = lead.ads_sent_at ? Date.parse(lead.ads_sent_at) : adessoMs;
  if (adessoMs - inviataAlle < attesaMinimaMs) return { esito: "troppo_presto", ragioni: [], httpStato: null };
  const risposta = await chiamaGoogle(`${URL_DATA_MANAGER_STATO}?requestId=${encodeURIComponent(lead.ads_request_id ?? "")}`, token, fetchFn);
  if (!risposta || risposta.stato < 200 || risposta.stato >= 300) return { esito: "non_letta", ragioni: [], httpStato: risposta?.stato ?? null }; // si riprova alla prossima esecuzione
  const stato = interpretaStatoRichiesta(risposta.json);
  if (stato.esito === "riuscita") {
    await admin.from("demo_leads").update({ ads_import_status: "accepted", ads_last_error: null }).eq("id", lead.id).eq("ads_import_status", "sent");
    return { esito: "accettata", ragioni: stato.ragioni, httpStato: risposta.stato };
  }
  if (stato.esito === "parziale" || stato.esito === "fallita") {
    await admin.from("demo_leads").update({ ads_import_status: "failed", ads_next_attempt_at: null, ads_last_error: testoErroreSicuro([`ELABORAZIONE_${stato.esito.toUpperCase()}`, ...stato.ragioni]) }).eq("id", lead.id).eq("ads_import_status", "sent");
    return { esito: "fallita", ragioni: stato.ragioni, httpStato: risposta.stato };
  }
  if (stato.esito === "in_corso" && adessoMs - inviataAlle > ORE_MASSIME_ELABORAZIONE * 3_600_000) {
    await admin.from("demo_leads").update({ ads_import_status: "failed", ads_next_attempt_at: null, ads_last_error: "TIMEOUT_ELABORAZIONE" }).eq("id", lead.id).eq("ads_import_status", "sent");
    return { esito: "fallita", ragioni: ["TIMEOUT_ELABORAZIONE"], httpStato: risposta.stato };
  }
  if (stato.esito === "in_corso") return { esito: "in_corso", ragioni: stato.ragioni, httpStato: risposta.stato };
  return { esito: "non_letta", ragioni: [], httpStato: risposta.stato };
}

// Il giro del cron legge le richieste e POI le aggiorna, con una chiamata a Google in mezzo: nel frattempo un invio manuale dalla console
// (o un altro giro) può aver prenotato o inviato la stessa richiesta. Per questo OGNI aggiornamento del giro vale solo se la richiesta
// è ancora com'era quando è stata letta (stesso stato, nessun identificativo di richiesta): altrimenti non scrive niente e lo stato
// «sent» di un invio vero non viene mai sovrascritto (nemmeno da «validated» o da «skipped_*» del giro in «solo verifica»).
async function aggiornaSeInvariata(admin: SupabaseClient, lead: Pick<LeadAds, "id" | "ads_import_status">, dati: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await admin.from("demo_leads").update(dati).eq("id", lead.id).eq("ads_import_status", lead.ads_import_status).is("ads_request_id", null).select("id");
  return !error && (data ?? []).length === 1;
}

// ── Il giro del cron ─────────────────────────────────────────────────────────────────────────────────────────────────────

export async function inviaConversioniAds(
  admin: SupabaseClient,
  env: Record<string, string | undefined>,
  adessoMs: number,
  fetchFn: typeof fetch = fetch,
): Promise<RisultatoAds> {
  if (env.DEMO_ADS_IMPORT_ENABLED !== "1") return { abilitato: false, motivo: "spento", ...VUOTO };
  const config = configurazioneAdsDaAmbiente(env);
  const credenziali = credenzialiDaAmbiente(env, "GOOGLE_ADS_REFRESH_TOKEN");
  if (!config || !credenziali) return { abilitato: false, motivo: "configurazione_incompleta", ...VUOTO };
  const segretoFirma = segretoFirmaConsensi(env);
  if (!segretoFirma) return { abilitato: false, motivo: "segreto_firma_mancante", ...VUOTO };

  const token = await ottieniTokenAccesso(credenziali, fetchFn);
  if (!token) return { abilitato: false, motivo: "token_non_ottenuto", ...VUOTO };

  const esito: RisultatoAds = { abilitato: true, modalita: config.soloVerifica ? "solo_verifica" : "reale", ...VUOTO };
  const opzioni = { consentiSoloEmail: env.DEMO_ADS_ALLOW_EMAIL_ONLY === "1" };
  const adessoIso = new Date(adessoMs).toISOString();
  const verifica = verificatoreFirma(segretoFirma);

  // 1. Le conversioni già inviate (con identificativo di richiesta): si legge se Google le ha elaborate. In QUALUNQUE modalità: è una
  //    lettura, e serve anche per le conversioni inviate a mano dalla console mentre il cron è in «solo verifica».
  {
    const { data: inviate, error } = await admin.from("demo_leads").select(COLONNE_ADS).eq("ads_import_status", "sent").not("ads_request_id", "is", null).limit(50);
    if (error) return { ...esito, abilitato: false, motivo: schemaAssente(error) ? "schema_assente" : "errore_database" };
    for (const lead of (inviate ?? []) as LeadAds[]) {
      const r = await riconciliaInviata(admin, token, lead, adessoMs, fetchFn);
      if (r.esito === "accettata") esito.accettati++;
      else if (r.esito === "fallita") esito.falliti++;
      else if (r.esito === "in_corso") esito.inElaborazione++;
    }
  }

  // 2. Le conversioni da inviare. In modalità reale: solo dopo la data minima, e al massimo qualcuna per giro.
  let dataMinima: { ms: number; iso: string } | null = null;
  if (!config.soloVerifica) {
    dataMinima = dataMinimaReale(env);
    if (!dataMinima) return { ...esito, motivo: "data_minima_mancante" };
  }
  const stati = config.soloVerifica ? ["ready"] : ["ready", "validated", "failed"];
  let interrogazione = admin.from("demo_leads").select(COLONNE_ADS).eq("booking_status", "confirmed").in("ads_import_status", stati).lt("ads_attempts", TENTATIVI_MASSIMI);
  if (dataMinima) interrogazione = interrogazione.gte("prima_prenotazione_il", dataMinima.iso).is("ads_request_id", null);
  const { data, error } = await interrogazione.limit(50);
  if (error) return { ...esito, abilitato: false, motivo: schemaAssente(error) ? "schema_assente" : "errore_database" };

  const leads = (data ?? []) as LeadAds[];
  if (leads.length === 0) return esito;
  const letti = await leggiConsensi(admin, leads.map((l) => l.id));
  if (!letti.ok) return { ...esito, abilitato: false, motivo: "errore_database" };

  let prenotateInQuestoGiro = 0;
  for (const lead of leads) {
    // il tetto dei tentativi vale anche se il filtro della lettura non lo applicasse
    if (lead.ads_attempts >= TENTATIVI_MASSIMI) continue;
    const dovuto = lead.ads_next_attempt_at ? Date.parse(lead.ads_next_attempt_at) <= adessoMs : lead.ads_import_status !== "failed";
    if (!dovuto) continue;
    // anche il tetto per giro e la data minima valgono due volte (filtro della lettura e qui)
    if (dataMinima) {
      if (prenotateInQuestoGiro >= LIMITE_INVII_REALI_PER_GIRO) break;
      if (!lead.prima_prenotazione_il || Date.parse(lead.prima_prenotazione_il) < dataMinima.ms) continue;
      if (lead.ads_request_id) continue;
    }

    const consensi = consensiVerificati(letti.perRichiesta.get(lead.id) ?? [], verifica);
    const costruzione = costruisciRichiestaAds(lead, config, adessoMs, sha256Hex, opzioni, consensi);
    if (!costruzione.ok) {
      esito.saltati++;
      if (costruzione.motivo === "senza_consenso") await aggiornaSeInvariata(admin, lead, { ads_import_status: "skipped_no_consent", ads_next_attempt_at: null });
      else if (costruzione.motivo === "senza_identificativo") await aggiornaSeInvariata(admin, lead, { ads_import_status: "skipped_no_identifier", ads_next_attempt_at: null });
      else if (costruzione.motivo === "troppo_vecchia") await aggiornaSeInvariata(admin, lead, { ads_import_status: "failed", ads_next_attempt_at: null, ads_last_error: "ETA_OLTRE_90_GIORNI" });
      continue;
    }

    if (config.soloVerifica) {
      // SOLO VERIFICA: Google controlla la richiesta ma non registra niente, quindi ripetere o riprovare non può fare danni
      const risposta = await chiamaGoogle(URL_DATA_MANAGER_INGEST, token, fetchFn, costruzione.richiesta);
      const tentativi = lead.ads_attempts + 1;
      if (!risposta || risposta.stato < 200 || risposta.stato >= 300) {
        const errore = risposta ? `HTTP_${risposta.stato} ${codiceErroreGoogle(risposta.json)}`.trim() : "RETE";
        if (await aggiornaSeInvariata(admin, lead, { ads_import_status: "failed", ads_attempts: tentativi, ads_next_attempt_at: prossimoTentativo(tentativi, adessoMs), ads_last_error: testoErroreSicuro([errore]) })) esito.falliti++;
        continue;
      }
      // la richiesta è valida per Google, ma non è stata registrata nessuna conversione
      if (await aggiornaSeInvariata(admin, lead, { ads_import_status: "validated", ads_next_attempt_at: null, ads_last_error: null })) esito.verificati++;
      continue;
    }

    // MODALITÀ REALE. Difesa in più: si invia solo una richiesta che dichiara validateOnly=false.
    if (costruzione.richiesta.validateOnly !== false) {
      esito.saltati++;
      continue;
    }
    prenotateInQuestoGiro++;
    const riserva = await riservaInvioAds(admin, lead, adessoIso);
    if (riserva !== "riservata") {
      if (riserva === "errore") console.error("Ads: prenotazione dell'invio non riuscita, nessun invio");
      esito.saltati++;
      continue;
    }
    const tentativi = lead.ads_attempts + 1;
    const esitoChiamata = esitoDaRispostaIngest(await chiamaGoogle(URL_DATA_MANAGER_INGEST, token, fetchFn, costruzione.richiesta));
    const registrato = await registraEsitoInvioAds(admin, lead.id, esitoChiamata, tentativi, adessoMs, true);
    if (!registrato) {
      // l'identificativo di richiesta di Google non è un dato personale: si lascia nel log perché si possa controllare a mano
      console.error("Ads: esito dell'invio non registrato", esitoChiamata.tipo, esitoChiamata.tipo === "inviata" ? esitoChiamata.requestId : "");
    }
    if (esitoChiamata.tipo === "inviata") esito.inviati++;
    else if (esitoChiamata.tipo === "incerta") esito.incerti++;
    else esito.falliti++;
  }
  return esito;
}
