import type { SupabaseClient } from "@supabase/supabase-js";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import {
  abbinaEvento,
  aggiornamentoPerConferma,
  configurazioneDaAmbiente,
  creazioneEvento,
  inizioEvento,
  partecipantiEsterni,
  type ConfigurazioneDemoCalendario,
  type EventoCalendario,
  type LeadPerAbbinamento,
} from "@/lib/demo-calendario-calcoli";
import { statoAdsPerConferma, type StatoAds } from "@/lib/demo-conversioni-calcoli";
import { credenzialiDaAmbiente, ottieniTokenAccesso } from "@/lib/google-oauth";

// Sincronizzazione periodica con il calendario Google delle demo (Google Calendar API, events.list con syncToken). Legge le
// prenotazioni, le abbina ai lead del modulo con le regole di demo-calendario-calcoli.ts e porta il lead a «confirmed».
//
// Sicurezza e affidabilità:
//   - SPENTA finché DEMO_CALENDAR_SYNC_ENABLED non è «1» e non ci sono le credenziali;
//   - sola LETTURA del calendario (scope calendar.readonly); le credenziali stanno solo nel server;
//   - idempotente: rielaborare lo stesso evento non cambia nulla; il «syncToken» avanza solo se TUTTI gli eventi sono stati
//     elaborati, così niente si perde; se il token scade (410) si rifà una lettura completa;
//   - nei log solo numeri e codici, mai email, nomi o titoli degli eventi.

export const SCOPE_CALENDAR_SOLA_LETTURA = "https://www.googleapis.com/auth/calendar.readonly";
const GIORNI_LETTURA_COMPLETA = 60;
const PAGINE_MASSIME = 20;
const TEMPO_MASSIMO_MS = 15_000;

export type RisultatoSync = {
  eseguita: boolean;
  motivo?: "spenta" | "credenziali_mancanti" | "schema_assente" | "token_non_ottenuto" | "errore_calendario" | "errore_database";
  letturaCompleta?: boolean;
  eventiVisti: number;
  confermati: number;
  cancellati: number;
  casi: number;
  errori: number;
};

const VUOTO: Omit<RisultatoSync, "eseguita"> = { eventiVisti: 0, confermati: 0, cancellati: 0, casi: 0, errori: 0 };

type RigaLead = LeadPerAbbinamento & {
  booking_starts_at: string | null;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  attribution_consent: boolean;
  ads_measurement_consent: boolean;
  ads_import_status: StatoAds;
};

const COLONNE_LEAD = "id, email_norm, created_at, booking_status, calendar_event_id, booking_starts_at, gclid, gbraid, wbraid, attribution_consent, ads_measurement_consent, ads_import_status";

async function leggiPagina(url: string, token: string, fetchFn: typeof fetch): Promise<{ stato: number; corpo: { items?: EventoCalendario[]; nextPageToken?: string; nextSyncToken?: string } | null }> {
  const controllo = new AbortController();
  const timer = setTimeout(() => controllo.abort(), TEMPO_MASSIMO_MS);
  try {
    const risposta = await fetchFn(url, { headers: { Authorization: `Bearer ${token}` }, signal: controllo.signal });
    if (!risposta.ok) return { stato: risposta.status, corpo: null };
    return { stato: risposta.status, corpo: (await risposta.json()) as { items?: EventoCalendario[]; nextPageToken?: string; nextSyncToken?: string } };
  } finally {
    clearTimeout(timer);
  }
}

// Tutti gli eventi (novità o lettura completa). Restituisce anche il nuovo token da salvare.
async function leggiEventi(
  calendarId: string,
  token: string,
  syncToken: string | null,
  adessoMs: number,
  fetchFn: typeof fetch,
): Promise<{ eventi: EventoCalendario[]; nuovoToken: string | null; tokenScaduto: boolean; errore: boolean }> {
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const eventi: EventoCalendario[] = [];
  let pagina: string | null = null;
  for (let i = 0; i < PAGINE_MASSIME; i++) {
    const parametri = new URLSearchParams({ showDeleted: "true", singleEvents: "true", maxResults: "250" });
    if (syncToken) parametri.set("syncToken", syncToken);
    else parametri.set("timeMin", new Date(adessoMs - GIORNI_LETTURA_COMPLETA * 86_400_000).toISOString());
    if (pagina) parametri.set("pageToken", pagina);
    const { stato, corpo } = await leggiPagina(`${base}?${parametri.toString()}`, token, fetchFn);
    if (stato === 410) return { eventi: [], nuovoToken: null, tokenScaduto: true, errore: false };
    if (!corpo) {
      console.error("Sincronizzazione demo: Calendar ha risposto con stato", stato);
      return { eventi: [], nuovoToken: null, tokenScaduto: false, errore: true };
    }
    eventi.push(...(corpo.items ?? []));
    if (corpo.nextPageToken) {
      pagina = corpo.nextPageToken;
      continue;
    }
    return { eventi, nuovoToken: corpo.nextSyncToken ?? null, tokenScaduto: false, errore: false };
  }
  console.error("Sincronizzazione demo: troppe pagine, lettura interrotta");
  return { eventi, nuovoToken: null, tokenScaduto: false, errore: true };
}

async function elaboraEvento(
  admin: SupabaseClient,
  evento: EventoCalendario,
  config: ConfigurazioneDemoCalendario,
  calendarId: string,
  consentiSoloEmail: boolean,
  risultato: RisultatoSync,
  adessoIso: string,
): Promise<void> {
  const email = partecipantiEsterni(evento, config);
  const perEmail = email.length > 0 ? await admin.from("demo_leads").select(COLONNE_LEAD).in("email_norm", email) : { data: [] as RigaLead[], error: null };
  const perEvento = await admin.from("demo_leads").select(COLONNE_LEAD).eq("calendar_event_id", evento.id);
  if (perEmail.error || perEvento.error) throw new Error("lettura lead");
  const lead = new Map<string, RigaLead>();
  for (const r of [...((perEmail.data ?? []) as RigaLead[]), ...((perEvento.data ?? []) as RigaLead[])]) lead.set(r.id, r);
  const elenco = [...lead.values()];

  const esito = abbinaEvento(evento, elenco, config);

  if (esito.tipo === "ignora") return;

  if (esito.tipo === "cancellato") {
    const legato = elenco.find((l) => l.calendar_event_id === evento.id);
    if (legato && legato.booking_status === "confirmed") {
      const nuovoStato: StatoAds = ["not_ready", "ready", "validated", "failed"].includes(legato.ads_import_status) ? "skipped_cancelled" : legato.ads_import_status;
      const { error } = await admin.from("demo_leads").update({ booking_status: "cancelled", ads_import_status: nuovoStato, ads_next_attempt_at: null }).eq("id", legato.id).eq("booking_status", "confirmed");
      if (error) throw new Error("annullamento lead");
      risultato.cancellati++;
    }
    return;
  }

  if (esito.tipo === "gia_abbinato") {
    const l = esito.lead as RigaLead;
    const inizio = inizioEvento(evento);
    if (l.booking_status === "cancelled") {
      // l'evento è tornato valido: la prenotazione è di nuovo confermata
      const conferma = aggiornamentoPerConferma(evento, calendarId);
      if (conferma) {
        const ads = ["sent", "accepted"].includes(l.ads_import_status) ? l.ads_import_status : statoAdsPerConferma(l, { consentiSoloEmail });
        const { error } = await admin.from("demo_leads").update({ ...conferma, ads_import_status: ads, ads_next_attempt_at: null }).eq("id", l.id).eq("booking_status", "cancelled");
        if (error) throw new Error("riconferma lead");
        risultato.confermati++;
      }
    } else if (inizio && inizio !== l.booking_starts_at) {
      const { error } = await admin.from("demo_leads").update({ booking_starts_at: inizio }).eq("id", l.id);
      if (error) throw new Error("aggiornamento data");
    }
    return;
  }

  if (esito.tipo === "abbinato") {
    const l = esito.lead as RigaLead;
    const conferma = aggiornamentoPerConferma(evento, calendarId);
    if (!conferma) {
      await registraCaso(admin, evento, calendarId, "fuori_finestra", esito.email, "L'evento non ha la data di creazione.");
      risultato.casi++;
      return;
    }
    const ads = ["sent", "accepted"].includes(l.ads_import_status) ? l.ads_import_status : statoAdsPerConferma(l, { consentiSoloEmail });
    const { data, error } = await admin
      .from("demo_leads")
      .update({ ...conferma, ads_import_status: ads, ads_attempts: 0, ads_next_attempt_at: adessoIso, ads_last_error: null })
      .eq("id", l.id)
      .in("booking_status", ["pending", "cancelled"])
      .select("id");
    if (error) throw new Error("conferma lead");
    if ((data ?? []).length > 0) risultato.confermati++;
    await admin.from("demo_calendar_casi").update({ risolto: true }).eq("calendar_event_id", evento.id);
    return;
  }

  await registraCaso(admin, evento, calendarId, esito.motivo, esito.email, esito.nota);
  risultato.casi++;
}

async function registraCaso(admin: SupabaseClient, evento: EventoCalendario, calendarId: string, motivo: string, email: string | null, nota: string): Promise<void> {
  // «risolto» non si scrive: un caso già chiuso a mano non si riapre, uno nuovo nasce aperto (valore di default della colonna)
  const { error } = await admin.from("demo_calendar_casi").upsert(
    {
      calendar_id: calendarId,
      calendar_event_id: evento.id,
      motivo,
      attendee_email_norm: email,
      event_created_at: creazioneEvento(evento),
      event_starts_at: inizioEvento(evento),
      note: nota.slice(0, 300),
    },
    { onConflict: "calendar_event_id" },
  );
  if (error) throw new Error("registro caso");
}

export async function sincronizzaCalendario(
  admin: SupabaseClient,
  env: Record<string, string | undefined>,
  adessoMs: number,
  fetchFn: typeof fetch = fetch,
): Promise<RisultatoSync> {
  if (env.DEMO_CALENDAR_SYNC_ENABLED !== "1") return { eseguita: false, motivo: "spenta", ...VUOTO };
  const credenziali = credenzialiDaAmbiente(env, "GOOGLE_CALENDAR_REFRESH_TOKEN");
  const calendarId = env.GOOGLE_CALENDAR_ID?.trim();
  if (!credenziali || !calendarId) return { eseguita: false, motivo: "credenziali_mancanti", ...VUOTO };

  const adessoIso = new Date(adessoMs).toISOString();
  const { data: stato, error: erroreStato } = await admin.from("demo_sync_stato").select("sync_token").eq("id", 1).maybeSingle<{ sync_token: string | null }>();
  if (erroreStato) return { eseguita: false, motivo: schemaAssente(erroreStato) ? "schema_assente" : "errore_database", ...VUOTO };

  const token = await ottieniTokenAccesso(credenziali, fetchFn);
  if (!token) {
    await admin.from("demo_sync_stato").update({ last_run_at: adessoIso, last_error: "token_non_ottenuto" }).eq("id", 1);
    return { eseguita: false, motivo: "token_non_ottenuto", ...VUOTO };
  }

  let letturaCompleta = !stato?.sync_token;
  let lettura = await leggiEventi(calendarId, token, stato?.sync_token ?? null, adessoMs, fetchFn);
  if (lettura.tokenScaduto) {
    letturaCompleta = true;
    lettura = await leggiEventi(calendarId, token, null, adessoMs, fetchFn);
  }
  if (lettura.errore) {
    await admin.from("demo_sync_stato").update({ last_run_at: adessoIso, last_error: "errore_calendario" }).eq("id", 1);
    return { eseguita: false, motivo: "errore_calendario", letturaCompleta, ...VUOTO };
  }

  const config = configurazioneDaAmbiente(env);
  const consentiSoloEmail = env.DEMO_ADS_ALLOW_EMAIL_ONLY === "1";
  const risultato: RisultatoSync = { eseguita: true, letturaCompleta, eventiVisti: lettura.eventi.length, confermati: 0, cancellati: 0, casi: 0, errori: 0 };
  for (const evento of lettura.eventi) {
    if (!evento.id) continue;
    try {
      await elaboraEvento(admin, evento, config, calendarId, consentiSoloEmail, risultato, adessoIso);
    } catch {
      risultato.errori++;
    }
  }

  // Il token avanza solo se tutto è andato bene: altrimenti la prossima esecuzione rilegge gli stessi eventi (è sicuro, è idempotente).
  const tuttoBene = risultato.errori === 0 && lettura.nuovoToken !== null;
  await admin
    .from("demo_sync_stato")
    .update({
      last_run_at: adessoIso,
      ...(tuttoBene ? { sync_token: lettura.nuovoToken, last_success_at: adessoIso, last_error: null } : { last_error: risultato.errori > 0 ? "errori_su_eventi" : "token_mancante" }),
    })
    .eq("id", 1);
  return risultato;
}
