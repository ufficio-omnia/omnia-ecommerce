import type { SupabaseClient } from "@supabase/supabase-js";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import {
  abbinaEvento,
  configurazioneDaAmbiente,
  creazioneEvento,
  eventoDemo,
  inizioEvento,
  nuovaPrenotazioneDaEvento,
  ordinaEventiPerElaborazione,
  partecipantiEsterni,
  type ConfigurazioneDemoCalendario,
  type EventoCalendario,
  type PrenotazioneNota,
  type RichiestaPerAbbinamento,
} from "@/lib/demo-calendario-calcoli";
import { consensiVerificati } from "@/lib/demo-consensi-calcoli";
import { leggiConsensi, verificatoreFirma } from "@/lib/demo-consensi";
import { segretoFirmaConsensi } from "@/lib/demo-hash";
import { statoAdsPerConferma, type StatoAds } from "@/lib/demo-conversioni-calcoli";
import { credenzialiDaAmbiente, ottieniTokenAccesso } from "@/lib/google-oauth";

// Sincronizzazione periodica con il calendario Google delle demo (Google Calendar API, events.list con syncToken). Legge le
// prenotazioni, le abbina alle RICHIESTE del modulo con le regole di demo-calendario-calcoli.ts e le registra in demo_prenotazioni.
//
// Sicurezza e affidabilità:
//   - SPENTA finché DEMO_CALENDAR_SYNC_ENABLED non è «1» e non ci sono le credenziali;
//   - sola LETTURA del calendario (scope calendar.readonly); le credenziali stanno solo nel server;
//   - idempotente: rielaborare lo stesso evento non cambia nulla (una prenotazione è una riga unica per evento; se una scrittura a
//     metà si è interrotta, la rielaborazione la completa); il «syncToken» avanza solo se TUTTI gli eventi sono stati elaborati; se
//     il token scade (410) si rifà una lettura completa;
//   - l'esecuzione è protetta da un blocco (demo-blocco.ts) contro due cron in parallelo;
//   - un abbinamento NON univoco non produce nessuna conversione: il caso si registra per la verifica a mano;
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
  riprogrammati: number;
  sostituite: number;
  casi: number;
  errori: number;
  // casi aperti riesaminati in questo giro (una volta all'ora) e riesami non riusciti
  riesaminati: number;
  erroriRiesame: number;
};

const VUOTO: Omit<RisultatoSync, "eseguita"> = { eventiVisti: 0, confermati: 0, cancellati: 0, riprogrammati: 0, sostituite: 0, casi: 0, errori: 0, riesaminati: 0, erroriRiesame: 0 };

type RigaRichiesta = RichiestaPerAbbinamento & {
  prima_prenotazione_il: string | null;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  ads_import_status: StatoAds;
};

const COLONNE_RICHIESTA = "id, email_norm, created_at, booking_status, prima_prenotazione_il, gclid, gbraid, wbraid, ads_import_status";
const STATI_ADS_CHIUSI: StatoAds[] = ["sent", "accepted"];

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
    let risultato: Awaited<ReturnType<typeof leggiPagina>>;
    try {
      risultato = await leggiPagina(`${base}?${parametri.toString()}`, token, fetchFn);
    } catch {
      console.error("Sincronizzazione demo: lettura del calendario non riuscita");
      return { eventi: [], nuovoToken: null, tokenScaduto: false, errore: true };
    }
    const { stato, corpo } = risultato;
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

type Contesto = {
  admin: SupabaseClient;
  config: ConfigurazioneDemoCalendario;
  calendarId: string;
  consentiSoloEmail: boolean;
  segretoFirma: string | null;
  risultato: RisultatoSync;
  adessoIso: string;
};

// La richiesta passa a «confermata» (o resta tale). `prima_prenotazione_il` si scrive UNA volta (la conversione ha l'ora della prima
// prenotazione, anche se poi si annulla e si riprenota). Lo stato Google Ads si ricalcola dai consensi, tranne se la conversione è già
// stata inviata (non si tocca mai ciò che è partito).
async function confermaRichiesta(c: Contesto, leadId: string, prenotataIl: string): Promise<boolean> {
  const { data, error } = await c.admin.from("demo_leads").select(COLONNE_RICHIESTA).eq("id", leadId).maybeSingle<RigaRichiesta>();
  if (error) throw new Error("lettura richiesta");
  if (!data) return false;
  if (data.booking_status === "confirmed" && data.prima_prenotazione_il) return false;

  const letti = await leggiConsensi(c.admin, [leadId]);
  if (!letti.ok) throw new Error("lettura consensi");
  const consensi = consensiVerificati(letti.perRichiesta.get(leadId) ?? [], c.segretoFirma ? verificatoreFirma(c.segretoFirma) : undefined);

  const aggiornamento: Record<string, unknown> = {
    booking_status: "confirmed",
    prima_prenotazione_il: data.prima_prenotazione_il ?? prenotataIl,
    updated_at: c.adessoIso,
  };
  if (!STATI_ADS_CHIUSI.includes(data.ads_import_status)) {
    aggiornamento.ads_import_status = statoAdsPerConferma(data, consensi, { consentiSoloEmail: c.consentiSoloEmail });
    aggiornamento.ads_attempts = 0;
    aggiornamento.ads_next_attempt_at = c.adessoIso;
    aggiornamento.ads_last_error = null;
  }
  const { error: erroreScrittura } = await c.admin.from("demo_leads").update(aggiornamento).eq("id", leadId).in("booking_status", ["pending", "cancelled", "confirmed"]);
  if (erroreScrittura) throw new Error("conferma richiesta");
  return true;
}

// Se la richiesta non ha più nessuna prenotazione valida, torna «annullata» (e la conversione non partirà, salvo che sia già partita).
async function annullaRichiestaSeSenzaPrenotazioni(c: Contesto, leadId: string): Promise<void> {
  const { count, error } = await c.admin.from("demo_prenotazioni").select("id", { count: "exact", head: true }).eq("lead_id", leadId).eq("stato", "confirmed");
  if (error) throw new Error("conteggio prenotazioni");
  if ((count ?? 0) > 0) return;
  const { data, error: erroreLettura } = await c.admin.from("demo_leads").select("ads_import_status").eq("id", leadId).maybeSingle<{ ads_import_status: StatoAds }>();
  if (erroreLettura) throw new Error("lettura richiesta");
  if (!data) return;
  const aggiornamento: Record<string, unknown> = { booking_status: "cancelled", updated_at: c.adessoIso };
  if (!STATI_ADS_CHIUSI.includes(data.ads_import_status)) {
    aggiornamento.ads_import_status = "skipped_cancelled";
    aggiornamento.ads_next_attempt_at = null;
  }
  const { error: erroreScrittura } = await c.admin.from("demo_leads").update(aggiornamento).eq("id", leadId).eq("booking_status", "confirmed");
  if (erroreScrittura) throw new Error("annullamento richiesta");
}

async function annullaPrenotazione(c: Contesto, prenotazione: PrenotazioneNota): Promise<void> {
  if (prenotazione.stato === "confirmed") {
    const { error } = await c.admin.from("demo_prenotazioni").update({ stato: "cancelled", cancelled_at: c.adessoIso, updated_at: c.adessoIso }).eq("id", prenotazione.id).eq("stato", "confirmed");
    if (error) throw new Error("annullamento prenotazione");
    c.risultato.cancellati++;
  }
  // anche se la prenotazione era già annullata: se la richiesta è rimasta «confermata» a causa di una scrittura interrotta, si sistema
  await annullaRichiestaSeSenzaPrenotazioni(c, prenotazione.lead_id);
}

async function elaboraEvento(c: Contesto, evento: EventoCalendario): Promise<void> {
  const noteRes = await c.admin
    .from("demo_prenotazioni")
    .select("id, lead_id, stato, starts_at, starts_at_originale")
    .eq("calendar_id", c.calendarId)
    .eq("calendar_event_id", evento.id)
    .maybeSingle<PrenotazioneNota>();
  if (noteRes.error) throw new Error("lettura prenotazione");
  const nota = noteRes.data;

  // le richieste delle persone invitate servono solo per una DEMO non ancora conosciuta
  let richieste: RigaRichiesta[] = [];
  if (!nota && evento.status !== "cancelled" && eventoDemo(evento, c.config)) {
    const email = partecipantiEsterni(evento, c.config);
    if (email.length > 0) {
      const { data, error } = await c.admin.from("demo_leads").select(COLONNE_RICHIESTA).in("email_norm", email);
      if (error) throw new Error("lettura richieste");
      richieste = ((data ?? []) as RigaRichiesta[]).map((r) => ({ ...r, conversione_inviata: STATI_ADS_CHIUSI.includes(r.ads_import_status) }));
    }
  }

  const esito = abbinaEvento(evento, { prenotazioneNota: nota, richieste }, c.config);

  if (esito.tipo === "ignora") return;

  if (esito.tipo === "cancellato") {
    if (esito.prenotazione) await annullaPrenotazione(c, esito.prenotazione);
    return;
  }

  if (esito.tipo === "prenotazione_nota") {
    const p = esito.prenotazione;
    const aggiornamento: Record<string, unknown> = {};
    if (esito.riattivata) {
      aggiornamento.stato = "confirmed";
      aggiornamento.cancelled_at = null;
    }
    if (esito.nuovoInizio) {
      aggiornamento.starts_at = esito.nuovoInizio;
      aggiornamento.riprogrammata_il = c.adessoIso;
      if (!p.starts_at_originale) aggiornamento.starts_at_originale = p.starts_at ?? esito.nuovoInizio;
    }
    if (Object.keys(aggiornamento).length > 0) {
      const { error } = await c.admin.from("demo_prenotazioni").update({ ...aggiornamento, updated_at: c.adessoIso }).eq("id", p.id);
      if (error) throw new Error("aggiornamento prenotazione");
      if (esito.nuovoInizio) c.risultato.riprogrammati++;
    }
    // una prenotazione valida deve avere la richiesta «confermata» (riattivata, oppure una scrittura precedente interrotta a metà)
    const prenotataIl = creazioneEvento(evento) ?? c.adessoIso;
    if (await confermaRichiesta(c, p.lead_id, prenotataIl)) c.risultato.confermati++;
    return;
  }

  if (esito.tipo === "abbinato") {
    const nuova = nuovaPrenotazioneDaEvento(evento, c.calendarId, esito.richiesta.id, "abbinata per email e data");
    if (!nuova) {
      await registraCaso(c, evento, "fuori_finestra", esito.email, "L'evento non ha la data di creazione.");
      c.risultato.casi++;
      return;
    }
    const { error } = await c.admin.from("demo_prenotazioni").insert(nuova);
    // codice 23505 = la stessa prenotazione l'ha già scritta un'altra esecuzione: non è un errore, la completa il prossimo giro
    if (error && error.code !== "23505") throw new Error("registrazione prenotazione");
    if (!error) {
      if (await confermaRichiesta(c, esito.richiesta.id, nuova.booked_at)) c.risultato.confermati++;
      if (esito.sostituite.length > 0) {
        const { data, error: erroreSostituzione } = await c.admin
          .from("demo_leads")
          .update({ booking_status: "superseded", superseded_by: esito.richiesta.id, updated_at: c.adessoIso })
          .in("id", esito.sostituite)
          .eq("booking_status", "pending")
          .select("id");
        if (erroreSostituzione) throw new Error("sostituzione richieste");
        c.risultato.sostituite += (data ?? []).length;
      }
      await c.admin.from("demo_calendar_casi").update({ risolto: true }).eq("calendar_event_id", evento.id);
    }
    return;
  }

  await registraCaso(c, evento, esito.motivo, esito.email, esito.nota);
  c.risultato.casi++;
}

// Un singolo evento per id (events.get, sola lettura). null se non c'è più (404/410) o la lettura non riesce: si riprova al prossimo giro.
export async function leggiEvento(calendarId: string, eventoId: string, token: string, fetchFn: typeof fetch): Promise<EventoCalendario | null> {
  const controllo = new AbortController();
  const timer = setTimeout(() => controllo.abort(), TEMPO_MASSIMO_MS);
  try {
    const risposta = await fetchFn(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventoId)}`, { headers: { Authorization: `Bearer ${token}` }, signal: controllo.signal });
    if (!risposta.ok) return null;
    const evento = (await risposta.json()) as EventoCalendario;
    return evento && typeof evento.id === "string" && evento.id !== "" ? evento : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// RIESAME dei casi aperti. La sincronizzazione legge solo le NOVITÀ del calendario: un caso («più richieste», «nessuna richiesta») non
// verrebbe mai rivisto da solo, neanche se nel frattempo è cambiata una regola o è arrivata la richiesta giusta. Una volta all'ora (il
// giro che cade nei primi dieci minuti) si rilegge, per id, ogni caso aperto degli ultimi 30 giorni (al massimo 10) e lo si rielabora con
// le regole di adesso. È IDEMPOTENTE: la prenotazione ha un indice unico per evento, quindi non nascono doppioni; se il caso si risolve
// la richiesta passa a «confirmed» e il caso si chiude; se resta incerto, il caso si aggiorna (email e nota del candidato vero).
export const GIORNI_RIESAME_CASI = 30;
export const MASSIMO_RIESAMI_PER_GIRO = 10;

async function riesaminaCasiAperti(c: Contesto, token: string, fetchFn: typeof fetch, adessoMs: number): Promise<void> {
  const dal = new Date(adessoMs - GIORNI_RIESAME_CASI * 86_400_000).toISOString();
  const { data, error } = await c.admin.from("demo_calendar_casi").select("calendar_event_id").eq("calendar_id", c.calendarId).eq("risolto", false).gte("created_at", dal).limit(MASSIMO_RIESAMI_PER_GIRO);
  if (error) {
    c.risultato.erroriRiesame++;
    return;
  }
  for (const riga of (data ?? []) as { calendar_event_id: string }[]) {
    const evento = await leggiEvento(c.calendarId, riga.calendar_event_id, token, fetchFn);
    if (!evento) {
      c.risultato.erroriRiesame++;
      continue;
    }
    // un riesame NON è un caso nuovo: il contatore dei casi del giro non cambia
    const casiPrima = c.risultato.casi;
    try {
      await elaboraEvento(c, evento);
      c.risultato.riesaminati++;
    } catch {
      c.risultato.erroriRiesame++;
    }
    c.risultato.casi = casiPrima;
  }
}

async function registraCaso(c: Contesto, evento: EventoCalendario, motivo: string, email: string | null, nota: string): Promise<void> {
  // «risolto» non si scrive: un caso già chiuso a mano non si riapre, uno nuovo nasce aperto (valore di default della colonna)
  const { error } = await c.admin.from("demo_calendar_casi").upsert(
    {
      calendar_id: c.calendarId,
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

  const risultato: RisultatoSync = { eseguita: true, letturaCompleta, ...VUOTO, eventiVisti: lettura.eventi.length };
  const contesto: Contesto = {
    admin,
    config: configurazioneDaAmbiente(env),
    calendarId,
    consentiSoloEmail: env.DEMO_ADS_ALLOW_EMAIL_ONLY === "1",
    segretoFirma: segretoFirmaConsensi(env),
    risultato,
    adessoIso,
  };
  // prima le cancellazioni, poi gli altri dal più vecchio: «annullata e prenotata di nuovo» non diventa un caso da verificare
  for (const evento of ordinaEventiPerElaborazione(lettura.eventi)) {
    if (!evento.id) continue;
    try {
      await elaboraEvento(contesto, evento);
    } catch {
      risultato.errori++;
    }
  }

  // una volta all'ora: riesame dei casi aperti (non influisce sul token: un riesame fallito non blocca la lettura delle novità)
  if (new Date(adessoMs).getUTCMinutes() < 10) await riesaminaCasiAperti(contesto, token, fetchFn, adessoMs);

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
