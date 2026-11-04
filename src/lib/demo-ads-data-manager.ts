import type { SupabaseClient } from "@supabase/supabase-js";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import {
  URL_DATA_MANAGER_INGEST,
  URL_DATA_MANAGER_STATO,
  TENTATIVI_MASSIMI,
  configurazioneAdsValida,
  costruisciRichiestaAds,
  interpretaStatoRichiesta,
  prossimoTentativo,
  testoErroreSicuro,
  type ConfigurazioneAds,
  type LeadPerConversione,
} from "@/lib/demo-conversioni-calcoli";
import { sha256Hex } from "@/lib/demo-hash";
import { credenzialiDaAmbiente, ottieniTokenAccesso } from "@/lib/google-oauth";

// Conversione Google Ads «OMNIA AI - DEMO prenotata» tramite la Data Manager API (conversioni offline da lead). Documentazione
// letta il 04/11/2026: POST datamanager.googleapis.com/v1/events:ingest e GET …/v1/requestStatus:retrieve.
//
// SPENTA finché DEMO_ADS_IMPORT_ENABLED non è «1» e non sono impostati account, azione di conversione e credenziali. Anche accesa,
// parte in modalità «SOLO VERIFICA» (validateOnly: Google controlla la richiesta ma NON registra la conversione) finché
// DEMO_ADS_VALIDATE_ONLY non è «0»: così si prova con le credenziali vere senza toccare i dati dell'account di produzione.
//
// Garanzie:
//   - si importano SOLO lead con prenotazione confermata sul calendario (lo stato «ready» lo mette la sincronizzazione);
//   - una conversione è «accepted» soltanto quando requestStatus risponde SUCCESS; finché è PROCESSING si aspetta;
//   - un identificativo di transazione stabile per lead («omnia-demo-<id>»): Google tiene il primo evento e tratta i successivi come
//     rettifiche, quindi un nuovo invio non gonfia i conteggi; in più lo stato nel database impedisce di rimandare ciò che è
//     già «sent» o «accepted»;
//   - errori di rete o di Google: riprova con pause crescenti (10 min, 30 min, 2 h, 8 h, 24 h), al massimo 6 tentativi;
//     un errore di ELABORAZIONE (PARTIAL_SUCCESS / FAILED) non si riprova da solo: serve una persona;
//   - nei log e nel database solo codici di errore, mai email, identificativi di clic o corpi di richiesta.

const TEMPO_MASSIMO_MS = 15_000;
const ORE_MASSIME_ELABORAZIONE = 48;

export type RisultatoAds = {
  abilitato: boolean;
  motivo?: "spento" | "configurazione_incompleta" | "token_non_ottenuto" | "schema_assente" | "errore_database";
  modalita?: "solo_verifica" | "reale";
  verificati: number;
  inviati: number;
  accettati: number;
  inElaborazione: number;
  falliti: number;
  saltati: number;
};

const VUOTO = { verificati: 0, inviati: 0, accettati: 0, inElaborazione: 0, falliti: 0, saltati: 0 };

export function configurazioneAdsDaAmbiente(env: Record<string, string | undefined>): ConfigurazioneAds | null {
  const candidata: Partial<ConfigurazioneAds> = {
    idCliente: env.GOOGLE_ADS_CUSTOMER_ID?.replace(/-/g, "").trim(),
    idClienteGestore: env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/-/g, "").trim() || undefined,
    idAzioneConversione: env.GOOGLE_ADS_DEMO_CONVERSION_ACTION_ID?.trim(),
    soloVerifica: env.DEMO_ADS_VALIDATE_ONLY !== "0",
  };
  return configurazioneAdsValida(candidata) ? candidata : null;
}

type LeadAds = LeadPerConversione & { ads_next_attempt_at: string | null; ads_request_id: string | null; ads_sent_at: string | null };

async function chiama(url: string, token: string, fetchFn: typeof fetch, corpo?: unknown): Promise<{ stato: number; json: unknown } | null> {
  const controllo = new AbortController();
  const timer = setTimeout(() => controllo.abort(), TEMPO_MASSIMO_MS);
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

// Il codice d'errore di Google (es. «INVALID_ARGUMENT»), mai il messaggio libero.
function codiceErroreGoogle(json: unknown): string {
  const stato = (json as { error?: { status?: unknown } } | null)?.error?.status;
  return typeof stato === "string" && /^[A-Z_]{3,40}$/.test(stato) ? stato : "";
}

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

  const token = await ottieniTokenAccesso(credenziali, fetchFn);
  if (!token) return { abilitato: false, motivo: "token_non_ottenuto", ...VUOTO };

  const esito: RisultatoAds = { abilitato: true, modalita: config.soloVerifica ? "solo_verifica" : "reale", ...VUOTO };
  const opzioni = { consentiSoloEmail: env.DEMO_ADS_ALLOW_EMAIL_ONLY === "1" };
  const adessoIso = new Date(adessoMs).toISOString();
  const colonne = "id, email, booking_status, booked_at, created_at, sector, gclid, gbraid, wbraid, attribution_consent, ads_measurement_consent, ga_client_id, ga_session_id, ga4_sent_at, ads_import_status, ads_attempts, ads_next_attempt_at, ads_request_id, ads_sent_at";

  // 1. Le conversioni già inviate: si legge se Google le ha elaborate.
  if (!config.soloVerifica) {
    const { data: inviate, error } = await admin.from("demo_leads").select(colonne).eq("ads_import_status", "sent").not("ads_request_id", "is", null).limit(50);
    if (error) return { ...esito, abilitato: false, motivo: schemaAssente(error) ? "schema_assente" : "errore_database" };
    for (const lead of (inviate ?? []) as LeadAds[]) {
      const inviataAlle = lead.ads_sent_at ? Date.parse(lead.ads_sent_at) : adessoMs;
      if (adessoMs - inviataAlle < 60_000) continue;
      const risposta = await chiama(`${URL_DATA_MANAGER_STATO}?requestId=${encodeURIComponent(lead.ads_request_id ?? "")}`, token, fetchFn);
      if (!risposta || risposta.stato < 200 || risposta.stato >= 300) continue; // si riprova alla prossima esecuzione
      const stato = interpretaStatoRichiesta(risposta.json);
      if (stato.esito === "riuscita") {
        await admin.from("demo_leads").update({ ads_import_status: "accepted", ads_last_error: null }).eq("id", lead.id).eq("ads_import_status", "sent");
        esito.accettati++;
      } else if (stato.esito === "parziale" || stato.esito === "fallita") {
        await admin.from("demo_leads").update({ ads_import_status: "failed", ads_next_attempt_at: null, ads_last_error: testoErroreSicuro([`ELABORAZIONE_${stato.esito.toUpperCase()}`, ...stato.ragioni]) }).eq("id", lead.id).eq("ads_import_status", "sent");
        esito.falliti++;
      } else if (stato.esito === "in_corso" && adessoMs - inviataAlle > ORE_MASSIME_ELABORAZIONE * 3_600_000) {
        await admin.from("demo_leads").update({ ads_import_status: "failed", ads_next_attempt_at: null, ads_last_error: "TIMEOUT_ELABORAZIONE" }).eq("id", lead.id).eq("ads_import_status", "sent");
        esito.falliti++;
      } else if (stato.esito === "in_corso") {
        esito.inElaborazione++;
      }
    }
  }

  // 2. Le conversioni da inviare.
  const stati = config.soloVerifica ? ["ready"] : ["ready", "validated", "failed"];
  const { data, error } = await admin.from("demo_leads").select(colonne).eq("booking_status", "confirmed").in("ads_import_status", stati).lt("ads_attempts", TENTATIVI_MASSIMI).limit(50);
  if (error) return { ...esito, abilitato: false, motivo: schemaAssente(error) ? "schema_assente" : "errore_database" };

  for (const lead of (data ?? []) as LeadAds[]) {
    const dovuto = lead.ads_next_attempt_at ? Date.parse(lead.ads_next_attempt_at) <= adessoMs : lead.ads_import_status !== "failed";
    if (!dovuto) continue;

    const costruzione = costruisciRichiestaAds(lead, config, adessoMs, sha256Hex, opzioni);
    if (!costruzione.ok) {
      esito.saltati++;
      if (costruzione.motivo === "senza_consenso") await admin.from("demo_leads").update({ ads_import_status: "skipped_no_consent", ads_next_attempt_at: null }).eq("id", lead.id);
      else if (costruzione.motivo === "senza_identificativo") await admin.from("demo_leads").update({ ads_import_status: "skipped_no_identifier", ads_next_attempt_at: null }).eq("id", lead.id);
      else if (costruzione.motivo === "troppo_vecchia") await admin.from("demo_leads").update({ ads_import_status: "failed", ads_next_attempt_at: null, ads_last_error: "ETA_OLTRE_90_GIORNI" }).eq("id", lead.id);
      continue;
    }

    const risposta = await chiama(URL_DATA_MANAGER_INGEST, token, fetchFn, costruzione.richiesta);
    const tentativi = lead.ads_attempts + 1;
    if (!risposta || risposta.stato < 200 || risposta.stato >= 300) {
      const errore = risposta ? `HTTP_${risposta.stato} ${codiceErroreGoogle(risposta.json)}`.trim() : "RETE";
      await admin.from("demo_leads").update({ ads_import_status: "failed", ads_attempts: tentativi, ads_next_attempt_at: prossimoTentativo(tentativi, adessoMs), ads_last_error: testoErroreSicuro([errore]) }).eq("id", lead.id);
      esito.falliti++;
      continue;
    }

    if (config.soloVerifica) {
      // la richiesta è valida per Google, ma non è stata registrata nessuna conversione
      await admin.from("demo_leads").update({ ads_import_status: "validated", ads_next_attempt_at: null, ads_last_error: null }).eq("id", lead.id);
      esito.verificati++;
      continue;
    }
    const idRichiesta = (risposta.json as { requestId?: unknown } | null)?.requestId;
    if (typeof idRichiesta !== "string" || idRichiesta === "") {
      // Google ha accettato la richiesta ma non ha dato l'identificativo: non si potrebbe mai verificare l'elaborazione. Non si
      // riprova da soli (l'identificativo di transazione eviterebbe comunque un doppione): la guarda una persona.
      await admin.from("demo_leads").update({ ads_import_status: "failed", ads_attempts: tentativi, ads_next_attempt_at: null, ads_last_error: "RISPOSTA_SENZA_ID_RICHIESTA" }).eq("id", lead.id);
      esito.falliti++;
      continue;
    }
    await admin
      .from("demo_leads")
      .update({
        ads_import_status: "sent",
        ads_request_id: idRichiesta.slice(0, 200),
        ads_sent_at: adessoIso,
        ads_attempts: tentativi,
        ads_next_attempt_at: null,
        ads_last_error: null,
      })
      .eq("id", lead.id);
    esito.inviati++;
  }
  return esito;
}
