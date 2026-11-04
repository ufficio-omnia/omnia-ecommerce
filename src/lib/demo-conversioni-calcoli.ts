import { emailPerGoogle } from "@/lib/demo-lead-calcoli";

// Conversioni della DEMO PRENOTATA (GA4 e Google Ads): regole PURE (nessuna rete, nessun database, nessuna chiave) per decidere se
// e cosa inviare. L'invio vero sta in src/lib/demo-ga4.ts e src/lib/demo-ads-data-manager.ts; i test in
// scripts/verifica-demo-tracciamento-omnia-ai.ts.
//
// Una conversione nasce SOLO da una prenotazione confermata sul calendario e abbinata al lead con certezza. La sola visita, il clic,
// l'apertura del calendario e l'invio del modulo non sono mai conversioni.
//
// Documentazione di riferimento (letta il 04/11/2026): Google Data Manager API (events:ingest, requestStatus:retrieve) e GA4
// Measurement Protocol (eventi retrodatabili fino a 72 ore).

export type LeadPerConversione = {
  id: string;
  email: string;
  booking_status: "pending" | "confirmed" | "cancelled";
  booked_at: string | null;
  created_at: string;
  sector: string;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  attribution_consent: boolean;
  ads_measurement_consent: boolean;
  ga_client_id: string | null;
  ga_session_id: string | null;
  ga4_sent_at: string | null;
  ads_import_status: StatoAds;
  ads_attempts: number;
};

export type StatoAds =
  | "not_ready"
  | "ready"
  | "validated"
  | "sent"
  | "accepted"
  | "failed"
  | "skipped_no_consent"
  | "skipped_no_identifier"
  | "skipped_cancelled";

export const GIORNI_MASSIMI_CLIC = 90;

export function identificativoClic(lead: Pick<LeadPerConversione, "gclid" | "gbraid" | "wbraid">): { campo: "gclid" | "gbraid" | "wbraid"; valore: string } | null {
  if (lead.gclid) return { campo: "gclid", valore: lead.gclid };
  if (lead.gbraid) return { campo: "gbraid", valore: lead.gbraid };
  if (lead.wbraid) return { campo: "wbraid", valore: lead.wbraid };
  return null;
}

// Lo stato Google Ads di un lead appena CONFERMATO. Serve il consenso ai cookie pubblicitari (data prima del salvataggio
// dell'attribuzione) e un identificativo di clic; l'email cifrata si aggiunge solo con il consenso facoltativo del modulo. Senza
// identificativo di clic: niente invio, salvo che sia abilitato l'invio «solo email» (conversioni avanzate per i lead) E il
// visitatore abbia dato anche il consenso del modulo.
export function statoAdsPerConferma(
  lead: Pick<LeadPerConversione, "gclid" | "gbraid" | "wbraid" | "attribution_consent" | "ads_measurement_consent">,
  opzioni: { consentiSoloEmail: boolean },
): StatoAds {
  if (!lead.attribution_consent && !lead.ads_measurement_consent) return "skipped_no_consent";
  if (identificativoClic(lead)) return lead.attribution_consent ? "ready" : "skipped_no_consent";
  if (opzioni.consentiSoloEmail && lead.ads_measurement_consent) return "ready";
  return "skipped_no_identifier";
}

// ── GA4 (Measurement Protocol) ───────────────────────────────────────────────────────────────────────────────────────────

export const NOME_EVENTO_GA4_PRENOTATA = "demo_booking_confirmed";
export const FINESTRA_RETRODATA_GA4_MS = 72 * 3_600_000;

export function deveInviareGa4(lead: LeadPerConversione): boolean {
  return lead.booking_status === "confirmed" && !!lead.booked_at && lead.ga4_sent_at === null && lead.attribution_consent && !!lead.ga_client_id;
}

export type CorpoGa4 = {
  client_id: string;
  timestamp_micros: number;
  consent: { ad_user_data: "GRANTED" | "DENIED"; ad_personalization: "GRANTED" | "DENIED" };
  events: { name: string; params: Record<string, string | number> }[];
};

// Un solo evento per lead, senza dati personali (niente email, nome, telefono): il settore e l'identificativo della richiesta.
// timestamp_micros = quando è stata fatta la prenotazione, se è dentro le 72 ore che GA4 accetta; altrimenti «adesso».
export function costruisciCorpoGa4(lead: LeadPerConversione, adessoMs: number): CorpoGa4 | null {
  if (!deveInviareGa4(lead) || !lead.ga_client_id || !lead.booked_at) return null;
  const prenotata = Date.parse(lead.booked_at);
  const dentroFinestra = Number.isFinite(prenotata) && adessoMs - prenotata >= 0 && adessoMs - prenotata <= FINESTRA_RETRODATA_GA4_MS;
  const params: Record<string, string | number> = {
    engagement_time_msec: 1,
    demo_sector: lead.sector.slice(0, 100),
    transaction_id: `omnia-demo-${lead.id}`,
  };
  if (lead.ga_session_id && /^\d+$/.test(lead.ga_session_id)) params.session_id = Number(lead.ga_session_id);
  return {
    client_id: lead.ga_client_id,
    timestamp_micros: (dentroFinestra ? prenotata : adessoMs) * 1000,
    consent: {
      ad_user_data: lead.attribution_consent ? "GRANTED" : "DENIED",
      ad_personalization: lead.attribution_consent && lead.ads_measurement_consent ? "GRANTED" : "DENIED",
    },
    events: [{ name: NOME_EVENTO_GA4_PRENOTATA, params }],
  };
}

// ── Google Ads (Data Manager API) ────────────────────────────────────────────────────────────────────────────────────────

export const URL_DATA_MANAGER_INGEST = "https://datamanager.googleapis.com/v1/events:ingest";
export const URL_DATA_MANAGER_STATO = "https://datamanager.googleapis.com/v1/requestStatus:retrieve";
export const SCOPE_DATA_MANAGER = "https://www.googleapis.com/auth/datamanager";

export type ConfigurazioneAds = {
  idCliente: string; // 10 cifre, senza trattini: l'account Google Ads proprietario dell'azione di conversione
  idClienteGestore?: string; // account da cui si accede (manager), se diverso
  idAzioneConversione: string; // ID NUMERICO dell'azione «OMNIA AI - DEMO prenotata» (tipo «Sito web, importazione dai clic»)
  soloVerifica: boolean; // true = validateOnly: Google controlla la richiesta ma non registra niente
};

export function idTransazioneAds(leadId: string): string {
  return `omnia-demo-${leadId}`;
}

function cifreSole(valore: string): boolean {
  return /^\d{10}$/.test(valore);
}
export function configurazioneAdsValida(c: Partial<ConfigurazioneAds>): c is ConfigurazioneAds {
  return !!c.idCliente && cifreSole(c.idCliente) && (!c.idClienteGestore || cifreSole(c.idClienteGestore)) && !!c.idAzioneConversione && /^\d{3,20}$/.test(c.idAzioneConversione) && typeof c.soloVerifica === "boolean";
}

export type RichiestaAds = {
  destinations: {
    operatingAccount: { accountType: "GOOGLE_ADS"; accountId: string };
    loginAccount: { accountType: "GOOGLE_ADS"; accountId: string };
    productDestinationId: string;
  }[];
  encoding: "HEX";
  consent: { adUserData: "CONSENT_GRANTED" | "CONSENT_DENIED"; adPersonalization: "CONSENT_GRANTED" | "CONSENT_DENIED" };
  events: {
    eventTimestamp: string;
    eventSource: "WEB";
    transactionId: string;
    adIdentifiers?: Partial<Record<"gclid" | "gbraid" | "wbraid", string>>;
    userData?: { userIdentifiers: { emailAddress: string }[] };
  }[];
  validateOnly: boolean;
};

export type MotivoNonInviabile = "non_confermata" | "senza_data" | "senza_identificativo" | "troppo_vecchia" | "senza_consenso";

// Una richiesta con UN evento (un lead per richiesta: l'esito di Google si legge per richiesta, così si sa esattamente quale lead è
// stato accettato). `hash` calcola lo SHA-256 esadecimale (sta nel file del server: qui non si importa crypto).
export function costruisciRichiestaAds(
  lead: LeadPerConversione,
  config: ConfigurazioneAds,
  adessoMs: number,
  hash: (testo: string) => string,
  opzioni: { consentiSoloEmail: boolean },
): { ok: true; richiesta: RichiestaAds } | { ok: false; motivo: MotivoNonInviabile } {
  if (lead.booking_status !== "confirmed") return { ok: false, motivo: "non_confermata" };
  if (!lead.booked_at || !Number.isFinite(Date.parse(lead.booked_at))) return { ok: false, motivo: "senza_data" };
  const prenotata = Date.parse(lead.booked_at);
  if (adessoMs - prenotata > GIORNI_MASSIMI_CLIC * 86_400_000) return { ok: false, motivo: "troppo_vecchia" };

  const stato = statoAdsPerConferma(lead, opzioni);
  if (stato === "skipped_no_consent") return { ok: false, motivo: "senza_consenso" };
  if (stato === "skipped_no_identifier") return { ok: false, motivo: "senza_identificativo" };

  const clic = identificativoClic(lead);
  const conEmail = lead.ads_measurement_consent;
  const evento: RichiestaAds["events"][number] = {
    // RFC 3339 in UTC: l'ora della prenotazione, senza fusi orari locali
    eventTimestamp: new Date(Math.min(prenotata, adessoMs)).toISOString(),
    eventSource: "WEB",
    transactionId: idTransazioneAds(lead.id),
  };
  if (clic && lead.attribution_consent) evento.adIdentifiers = { [clic.campo]: clic.valore };
  if (conEmail) evento.userData = { userIdentifiers: [{ emailAddress: hash(emailPerGoogle(lead.email)) }] };

  return {
    ok: true,
    richiesta: {
      destinations: [
        {
          operatingAccount: { accountType: "GOOGLE_ADS", accountId: config.idCliente },
          loginAccount: { accountType: "GOOGLE_ADS", accountId: config.idClienteGestore ?? config.idCliente },
          productDestinationId: config.idAzioneConversione,
        },
      ],
      encoding: "HEX",
      consent: {
        adUserData: lead.attribution_consent || conEmail ? "CONSENT_GRANTED" : "CONSENT_DENIED",
        adPersonalization: lead.attribution_consent && conEmail ? "CONSENT_GRANTED" : "CONSENT_DENIED",
      },
      events: [evento],
      validateOnly: config.soloVerifica,
    },
  };
}

// Pause tra un tentativo e il successivo (minuti): 10, 30, 2 ore, 8 ore, 24 ore. Dopo il sesto tentativo il lead resta «failed».
export const PAUSE_TENTATIVI_MINUTI = [10, 30, 120, 480, 1440];
export const TENTATIVI_MASSIMI = PAUSE_TENTATIVI_MINUTI.length + 1;

export function prossimoTentativo(tentativiGiaFatti: number, adessoMs: number): string | null {
  if (tentativiGiaFatti >= TENTATIVI_MASSIMI) return null;
  const pausa = PAUSE_TENTATIVI_MINUTI[Math.min(Math.max(tentativiGiaFatti - 1, 0), PAUSE_TENTATIVI_MINUTI.length - 1)];
  return new Date(adessoMs + pausa * 60_000).toISOString();
}

export type EsitoRichiestaAds = "in_corso" | "riuscita" | "parziale" | "fallita" | "sconosciuta";

// Lo stato di una richiesta già inviata (risposta di requestStatus:retrieve). Una conversione si considera ACQUISITA solo con
// «SUCCESS»: finché è «PROCESSING» si aspetta; «PARTIAL_SUCCESS» e «FAILED» sono errori (le ragioni sono nomi di errore, non dati).
export function interpretaStatoRichiesta(risposta: unknown): { esito: EsitoRichiestaAds; ragioni: string[] } {
  const elenco = (risposta as { requestStatusPerDestination?: unknown })?.requestStatusPerDestination;
  if (!Array.isArray(elenco) || elenco.length === 0) return { esito: "sconosciuta", ragioni: [] };
  const voci = elenco as { requestStatus?: string; errorInfo?: { errorCounts?: { reason?: string }[] } }[];
  const stati = voci.map((v) => v.requestStatus);
  const ragioni = voci.flatMap((v) => (v.errorInfo?.errorCounts ?? []).map((e) => String(e.reason ?? "")).filter((r) => /^[A-Z0-9_]{1,80}$/.test(r)));
  if (stati.every((s) => s === "SUCCESS")) return { esito: "riuscita", ragioni };
  if (stati.some((s) => s === "FAILED")) return { esito: "fallita", ragioni };
  if (stati.some((s) => s === "PARTIAL_SUCCESS")) return { esito: "parziale", ragioni };
  if (stati.some((s) => s === "PROCESSING")) return { esito: "in_corso", ragioni };
  return { esito: "sconosciuta", ragioni };
}

// Il testo da salvare in ads_last_error: solo codici (mai testi liberi, mai email, mai identificativi di clic), al massimo 300 caratteri.
export function testoErroreSicuro(codici: string[]): string {
  return codici
    .filter((c) => /^[A-Za-z0-9_:.\- ]{1,80}$/.test(c))
    .join(", ")
    .slice(0, 300);
}
