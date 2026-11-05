// Autotest dell'IDENTIFICAZIONE DEL PRENOTANTE nella sincronizzazione delle DEMO con Google Calendar (anomalia segnalata il 05/11/2026,
// dal test reale: «Più richieste possibili» e, nel caso, un account interno). Si controlla che:
//   - gli account interni (calendario, organizzatore, squadra, domini interni) non siano MAI scambiati per il cliente, anche se hanno
//     fatto una richiesta dal modulo, e che un dominio di posta pubblico non possa mai essere dichiarato «interno»;
//   - una richiesta ANNULLATA di un percorso precedente non confonda il percorso nuovo della stessa persona (il caso reale);
//   - persone diverse con una richiesta per lo stesso evento restino un caso da verificare, SENZA nessuna conversione;
//   - il caso riporti l'email del vero candidato e non quella del primo partecipante;
//   - i casi aperti si riesaminino una volta all'ora, in modo idempotente (nessun doppione) e senza che un riesame fallito blocchi nulla;
//   - la diagnosi degli eventi sia in sola lettura e non mostri email, nomi, titoli, id.
import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import { FintoDatabase, fetchFinto, type ChiamataFinta, type Riga } from "./demo-finto-supabase";
import {
  DOMINI_INTERNI_PREDEFINITI,
  DOMINI_POSTA_PUBBLICI,
  abbinaEvento,
  classificaPartecipanti,
  configurazioneDaAmbiente,
  dominiInterniDaAmbiente,
  haDominioInterno,
  partecipantiEsterni,
  tuttiGliEsterniHannoRifiutato,
  type EventoCalendario,
  type PrenotazioneNota,
  type RichiestaPerAbbinamento,
} from "../src/lib/demo-calendario-calcoli";
import { GIORNI_RIESAME_CASI, MASSIMO_RIESAMI_PER_GIRO, sincronizzaCalendario } from "../src/lib/demo-calendario-sync";
import { diagnosticaCasiAperti } from "../src/lib/demo-calendario-diagnosi";
import { costruisciConsensi, stringaDaFirmare } from "../src/lib/demo-consensi-calcoli";
import { firmaConsenso, sha256Hex } from "../src/lib/demo-hash";
import { VERSIONE_CONSENSI_DEMO } from "../src/lib/demo-lead-calcoli";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
const radice = path.join(__dirname, "..");
const leggi = (relativo: string) => fs.readFileSync(path.join(radice, relativo), "utf-8").replace(/\r\n/g, "\n");

const PRENOTANTE = "cliente.prova@esempio.test";
const ALTRO = "altro.cliente@esempio.test";
const INTERNO = "direzione@omniaitalia.com";
const SEGRETO_FIRMA = "firma-segreto";
const CALENDARIO = "cal@group.calendar.google.com";

const cfg = configurazioneDaAmbiente({ DEMO_CALENDAR_TITLE_REGEX: "demo omnia" });
const ev = (extra: Partial<EventoCalendario> = {}): EventoCalendario => ({
  id: "evt1", status: "confirmed", summary: "Demo OMNIA AI", created: "2026-11-05T14:57:35Z", start: { dateTime: "2026-11-06T09:00:00+01:00" },
  organizer: { email: "agenda@omniaitalia.com" }, attendees: [{ email: INTERNO, responseStatus: "accepted" }, { email: PRENOTANTE, responseStatus: "accepted" }], ...extra,
});
const rich = (id: string, email: string, creata: string, stato: RichiestaPerAbbinamento["booking_status"] = "pending", conversione = false): RichiestaPerAbbinamento => ({ id, email_norm: email, created_at: creata, booking_status: stato, conversione_inviata: conversione });
const abbina = (e: EventoCalendario, richieste: RichiestaPerAbbinamento[], nota: PrenotazioneNota | null = null, c = cfg) => abbinaEvento(e, { prenotazioneNota: nota, richieste }, c);

// le tre richieste del test reale del 05/11/2026
const R_ANNULLATA = rich("annullata", PRENOTANTE, "2026-11-04T12:31:58Z", "cancelled");
const R_ALTRO = rich("altro", ALTRO, "2026-11-05T13:05:13Z");
const R_NUOVA = rich("nuova", PRENOTANTE, "2026-11-05T14:57:13Z");

// ── database finto ──
type OpzioniConsensi = { cookie?: boolean; ads?: boolean };
function consensiFirmati(leadId: string, o: OpzioniConsensi = {}): Riga[] {
  return costruisciConsensi({ adsConsenso: o.ads ?? true, cookieAccettati: o.cookie ?? true, ipHash: null }, sha256Hex).map((c) => {
    const r = { ...c, lead_id: leadId, registrato_il: "2026-11-01T00:00:00.000Z" };
    return { ...r, firma: firmaConsenso(stringaDaFirmare(r), SEGRETO_FIRMA) };
  });
}
function richiestaDb(id: string, email: string, creata: string, stato: string, extra: Riga = {}): Riga {
  return {
    id, contatto_id: `contatto-${email}`, idempotency_key: `chiave-${id}-xxxxxxxxxx`, full_name: "Nome Prova", company: "Azienda Prova", email, email_norm: email, phone: "+393331234567", sector: "Altro",
    gclid: "GCLID_prova_12345", gbraid: null, wbraid: null, utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, utm_term: null, landing_path: "/", ga_client_id: "1234567890.1700000000", ga_session_id: null,
    attribution_consent: true, privacy_version: VERSIONE_CONSENSI_DEMO, privacy_accepted_at: creata, ads_measurement_consent: true, ads_measurement_consent_at: creata, ip_hash: null,
    booking_status: stato, superseded_by: null, prima_prenotazione_il: stato === "pending" ? null : creata, ga4_sent_at: null, ga4_attempts: 0,
    ads_import_status: stato === "pending" ? "not_ready" : stato === "cancelled" ? "skipped_cancelled" : "ready", ads_transaction_id: null, ads_request_id: null, ads_sent_at: null, ads_attempts: 0, ads_next_attempt_at: null, ads_last_error: null,
    created_at: creata, updated_at: creata, ...extra,
  };
}
function dbCon(leads: Riga[], extra: { prenotazioni?: Riga[]; casi?: Riga[] } = {}): FintoDatabase {
  const contatti = [...new Set(leads.map((l) => l.contatto_id as string))].map((id) => ({ id, email_norm: id.replace("contatto-", ""), email: id.replace("contatto-", ""), full_name: "x", company: "x", sector: "x", ultima_richiesta_il: "2026-11-01T00:00:00.000Z" }));
  return new FintoDatabase({ demo_contatti: contatti, demo_leads: leads, demo_consensi: leads.flatMap((l) => consensiFirmati(l.id as string)), demo_prenotazioni: extra.prenotazioni ?? [], demo_calendar_casi: extra.casi ?? [] });
}
const prenotazioneDb = (leadId: string, evento: string, stato = "confirmed"): Riga => ({ id: randomUUID(), lead_id: leadId, calendar_id: CALENDARIO, calendar_event_id: evento, stato, booked_at: "2026-11-04T12:33:43.000Z", starts_at: "2026-11-05T09:00:00.000Z", starts_at_originale: "2026-11-05T09:00:00.000Z", riprogrammata_il: null, cancelled_at: stato === "cancelled" ? "2026-11-05T07:50:41.000Z" : null, match_note: "x", created_at: "2026-11-04T12:33:43.000Z", updated_at: "2026-11-04T12:33:43.000Z" });
const casoDb = (evento: string, extra: Riga = {}): Riga => ({ id: randomUUID(), created_at: "2026-11-05T15:00:44.000Z", calendar_id: CALENDARIO, calendar_event_id: evento, motivo: "piu_lead", attendee_email_norm: INTERNO, event_created_at: "2026-11-05T14:57:35.000Z", event_starts_at: "2026-11-06T08:00:00.000Z", risolto: false, note: "2 richieste possibili per la stessa prenotazione.", ...extra });

const envCal = { DEMO_CALENDAR_SYNC_ENABLED: "1", GOOGLE_OAUTH_CLIENT_ID: "client-id", GOOGLE_OAUTH_CLIENT_SECRET: "client-segreto", GOOGLE_CALENDAR_REFRESH_TOKEN: "rt-segreto", GOOGLE_CALENDAR_ID: CALENDARIO, DEMO_CALENDAR_TITLE_REGEX: "demo omnia", DEMO_CONSENT_SIGNING_SECRET: SEGRETO_FIRMA };
const ORA_00 = Date.parse("2026-11-05T15:00:00.000Z"); // minuto 0: il giro del riesame
const ORA_30 = Date.parse("2026-11-05T15:30:00.000Z"); // minuto 30: nessun riesame

// calendario finto: le novità (lista) e gli eventi letti per id (null = non trovato)
function calendarioFinto(o: { novita?: EventoCalendario[]; perId?: Record<string, EventoCalendario | null> }) {
  return fetchFinto((c: ChiamataFinta) => {
    if (c.url.startsWith("https://oauth2.googleapis.com/token")) return { status: 200, json: { access_token: "at-segreto-xyz" } };
    const singolo = /\/calendar\/v3\/calendars\/[^/]+\/events\/([^?/]+)$/.exec(c.url);
    if (singolo) {
      const e = o.perId?.[decodeURIComponent(singolo[1])];
      return e ? { status: 200, json: e } : { status: 404 };
    }
    if (c.url.includes("/calendar/v3/calendars/")) return { status: 200, json: { items: o.novita ?? [], nextSyncToken: "T" } };
    return { status: 404 };
  });
}
const lettureSingole = (cf: { chiamate: ChiamataFinta[] }) => cf.chiamate.filter((x) => /\/events\/[^?/]+$/.test(x.url));
const leadDi = (db: FintoDatabase, id: string) => db.da("demo_leads").find((r) => r.id === id)!;

async function main() {
  // ═════════════════════════ 1. Chi sono i partecipanti ═════════════════════════
  console.log("--- Partecipanti: squadra, domini interni, esterni ---");
  const e0 = ev({ organizer: { email: "agenda@omniaitalia.com" }, attendees: [
    { email: "io@x.it", self: true }, { email: "capo@x.it", organizer: true }, { email: "sala@risorse.it", resource: true }, { email: "Squadra@Team.it" }, { email: "collega@omniaitalia.com" },
    { email: "sub@vendite.omniaitalia.com" }, { email: "agenda@omniaitalia.com" }, { email: "Cliente.Prova@esempio.test", optional: true }, { email: "cliente.prova@esempio.test" }, { email: "" }, {},
  ] });
  const cl = classificaPartecipanti(e0, configurazioneDaAmbiente({ DEMO_CALENDAR_INTERNAL_EMAILS: "squadra@team.it" }));
  const ruolo = (email: string) => cl.find((x) => x.email === email)?.ruolo;
  atteso("ogni partecipante ha il suo ruolo: calendario stesso, organizzatore, risorsa, squadra (email), dominio interno (anche i sottodomini), esterno", ruolo("io@x.it") === "calendario" && ruolo("capo@x.it") === "organizzatore" && ruolo("sala@risorse.it") === "risorsa" && ruolo("squadra@team.it") === "squadra" && ruolo("collega@omniaitalia.com") === "dominio_interno" && ruolo("sub@vendite.omniaitalia.com") === "dominio_interno" && ruolo("agenda@omniaitalia.com") === "organizzatore" && ruolo("cliente.prova@esempio.test") === "esterno", JSON.stringify(cl));
  atteso("le email si normalizzano e non si ripetono (maiuscole, doppioni); senza email o vuote si saltano", cl.filter((x) => x.email === "cliente.prova@esempio.test").length === 1 && cl.length === 8 && cl.every((x) => x.email !== ""));
  atteso("solo gli ESTERNI possono essere il prenotante", JSON.stringify(partecipantiEsterni(e0, configurazioneDaAmbiente({ DEMO_CALENDAR_INTERNAL_EMAILS: "squadra@team.it" }))) === JSON.stringify(["cliente.prova@esempio.test"]));
  atteso("il creatore che è il calendario stesso è interno; un creatore esterno NON viene mai assunto come prenotante (nessun ruolo speciale)", classificaPartecipanti(ev({ creator: { email: INTERNO, self: true } }), configurazioneDaAmbiente({ DEMO_CALENDAR_INTERNAL_DOMAINS: "-" })).find((x) => x.email === INTERNO)?.ruolo === "calendario" && classificaPartecipanti(ev({ creator: { email: PRENOTANTE } }), cfg).find((x) => x.email === PRENOTANTE)?.ruolo === "esterno");
  atteso("l'organizzatore dell'evento è interno anche se compare tra gli ospiti senza il suo contrassegno", classificaPartecipanti(ev({ organizer: { email: PRENOTANTE.replace("cliente.prova", "host") }, attendees: [{ email: "host@esempio.test" }, { email: "ospite@esempio.test" }] }), cfg).find((x) => x.email === "host@esempio.test")?.ruolo === "organizzatore");

  console.log("\n--- Configurazione dei domini interni ---");
  atteso("predefinito: il dominio dell'organizzazione è interno; vuoto o assente = predefinito", JSON.stringify(DOMINI_INTERNI_PREDEFINITI) === '["omniaitalia.com"]' && JSON.stringify(dominiInterniDaAmbiente(undefined)) === '["omniaitalia.com"]' && JSON.stringify(dominiInterniDaAmbiente("  ")) === '["omniaitalia.com"]');
  atteso("elenco personalizzato: minuscolo, con o senza «@», senza doppioni, voci malformate scartate", JSON.stringify(dominiInterniDaAmbiente("@Miaazienda.IT, miaazienda.it, altra-societa.com, non un dominio, x.y.z.")) === '["miaazienda.it","altra-societa.com"]');
  atteso("i domini di posta PUBBLICI non possono MAI essere «interni» (escluderebbero tutti i clienti che li usano)", DOMINI_POSTA_PUBBLICI.every((d) => dominiInterniDaAmbiente(`${d},omniaitalia.com`).join() === "omniaitalia.com") && dominiInterniDaAmbiente("gmail.com").length === 0 && DOMINI_POSTA_PUBBLICI.includes("gmail.com") && DOMINI_POSTA_PUBBLICI.includes("libero.it"));
  atteso("un cliente con la posta di un dominio pubblico NON è interno; un indirizzo che imita il dominio interno (omniaitalia.com.altro.it, miaomniaitalia.com) neppure", !haDominioInterno("cliente@gmail.com", cfg) && !haDominioInterno("x@omniaitalia.com.altro.it", cfg) && !haDominioInterno("x@miaomniaitalia.com", cfg) && haDominioInterno("x@omniaitalia.com", cfg) && haDominioInterno("x@sub.omniaitalia.com", cfg));

  // ═════════════════════════ 2. Il caso reale del 05/11/2026 ═════════════════════════
  console.log("\n--- Il caso reale: richiesta annullata del giorno prima + richiesta nuova + account interno tra gli ospiti ---");
  const reale = abbina(ev(), [R_ANNULLATA, R_ALTRO, R_NUOVA]);
  atteso("IL CASO REALE: la prenotazione, creata 22 secondi dopo la richiesta nuova, si abbina a QUELLA; la richiesta annullata di ieri resta com'è e nessuna richiesta viene «sostituita»", reale.tipo === "abbinato" && reale.richiesta.id === "nuova" && reale.sostituite.length === 0 && reale.email === PRENOTANTE, JSON.stringify(reale));
  atteso("l'account interno non entra nei candidati, e la richiesta di un'ALTRA persona che non è tra gli ospiti non conta", abbina(ev(), [R_ALTRO]).tipo === "caso" && (() => { const r = abbina(ev(), [R_ALTRO]); return r.tipo === "caso" && r.motivo === "nessun_lead"; })());
  atteso("senza la richiesta nuova, resta la riprenotazione dell'annullata (unica candidata)", (() => { const r = abbina(ev(), [R_ANNULLATA, R_ALTRO]); return r.tipo === "abbinato" && r.richiesta.id === "annullata"; })());

  console.log("\n--- Account interni con una richiesta dal modulo ---");
  const interna = rich("interna", INTERNO, "2026-11-05T14:00:00Z");
  atteso("un collega con una richiesta dal modulo, invitato all'evento, NON è il prenotante e non rende ambiguo l'abbinamento", (() => { const r = abbina(ev(), [interna, R_NUOVA]); return r.tipo === "abbinato" && r.richiesta.id === "nuova"; })());
  atteso("se l'unica richiesta è di un account interno, l'evento non ha un prenotante: nessuna conversione", (() => { const r = abbina(ev(), [interna]); return r.tipo === "caso" && r.motivo === "nessun_lead"; })());
  atteso("vale anche per email interne dichiarate a mano e per l'organizzatore dell'evento", (() => { const c = configurazioneDaAmbiente({ DEMO_CALENDAR_TITLE_REGEX: "demo omnia", DEMO_CALENDAR_INTERNAL_DOMAINS: "-", DEMO_CALENDAR_INTERNAL_EMAILS: INTERNO }); const r = abbina(ev(), [interna, R_NUOVA], null, c); return r.tipo === "abbinato" && r.richiesta.id === "nuova"; })() && (() => { const r = abbina(ev({ organizer: { email: INTERNO } }), [interna, R_NUOVA]); return r.tipo === "abbinato" && r.richiesta.id === "nuova"; })());
  atteso("evento con SOLO account interni (calendario, squadra, dominio): caso «senza_partecipante», nessuna richiesta cercata", (() => { const r = abbina(ev({ attendees: [{ email: INTERNO }, { email: "altro@omniaitalia.com" }] }), [interna, R_NUOVA]); return r.tipo === "caso" && r.motivo === "senza_partecipante" && r.email === null; })());
  atteso("un cliente Gmail con lo stesso «nome» di un account interno non viene escluso (il dominio pubblico non è interno)", (() => { const r = abbina(ev({ attendees: [{ email: INTERNO }, { email: "direzione@gmail.com" }] }), [rich("g", "direzione@gmail.com", "2026-11-05T14:57:13Z")]); return r.tipo === "abbinato" && r.richiesta.id === "g"; })());

  // ═════════════════════════ 3. Persone diverse: nessuna conversione ═════════════════════════
  console.log("\n--- Persone diverse con una richiesta per lo stesso evento ---");
  const due = abbina(ev({ attendees: [{ email: INTERNO }, { email: PRENOTANTE }, { email: ALTRO }] }), [R_NUOVA, R_ALTRO]);
  atteso("due persone ESTERNE, ciascuna con una richiesta: caso «piu_lead», nessuna conversione, e nel caso c'è l'email del candidato più recente (non quella del primo ospite)", due.tipo === "caso" && due.motivo === "piu_lead" && due.email === PRENOTANTE && /2 persone diverse/.test(due.nota), JSON.stringify(due));
  atteso("il caso non riporta mai l'account interno, anche se è il primo ospite dell'elenco", due.tipo === "caso" && due.email !== INTERNO);
  atteso("anche con tante richieste della stessa persona, se c'è un'altra persona il caso resta (non si sceglie tra persone)", (() => { const r = abbina(ev({ attendees: [{ email: PRENOTANTE }, { email: ALTRO }] }), [R_ANNULLATA, R_NUOVA, R_ALTRO]); return r.tipo === "caso" && r.motivo === "piu_lead"; })());

  // ═════════════════════════ 4. La stessa persona con più richieste ═════════════════════════
  console.log("\n--- La stessa persona con più richieste, annullate e ripetute ---");
  atteso("richiesta nuova creata DOPO l'ultima annullata → è del percorso nuovo; le annullate non si toccano", (() => { const r = abbina(ev(), [rich("a1", PRENOTANTE, "2026-10-20T10:00:00Z", "cancelled"), rich("a2", PRENOTANTE, "2026-11-01T10:00:00Z", "cancelled"), R_NUOVA]); return r.tipo === "abbinato" && r.richiesta.id === "nuova" && r.sostituite.length === 0; })());
  atteso("la richiesta nuova prevale sull'annullata SOLO se è vicina alla prenotazione: fino a 24 ore esatte prima sì; un secondo oltre le 24 ore → caso, nessuna conversione (non è certo che non sia la ripresa dell'annullata)", (() => {
    const evento = ev({ created: "2026-11-05T14:57:35Z" });
    const a = abbina(evento, [R_ANNULLATA, rich("n24", PRENOTANTE, "2026-11-04T14:57:35Z")]);
    const b = abbina(evento, [R_ANNULLATA, rich("n24piu1", PRENOTANTE, "2026-11-04T14:57:34Z")]);
    const c = abbina(evento, [R_ANNULLATA, rich("n3h", PRENOTANTE, "2026-11-05T11:57:35Z")]);
    return a.tipo === "abbinato" && a.richiesta.id === "n24" && a.sostituite.length === 0 && b.tipo === "caso" && b.motivo === "piu_lead" && /24 ore prima della prenotazione/.test(b.nota) && b.email === PRENOTANTE && c.tipo === "abbinato" && c.richiesta.id === "n3h";
  })());
  atteso("la regola temporale vale anche se le richieste sono più d'una e se la conversione dell'annullata non è partita; nel caso reale (22 secondi) la nuova richiesta prevale", (() => {
    const lenta = abbina(ev(), [rich("a", PRENOTANTE, "2026-10-20T10:00:00Z", "cancelled"), rich("p", PRENOTANTE, "2026-11-04T10:00:00Z")]);
    return lenta.tipo === "caso" && lenta.motivo === "piu_lead" && abbina(ev(), [R_ANNULLATA, R_NUOVA]).tipo === "abbinato";
  })());
  atteso("una richiesta annullata PIÙ RECENTE di quella ancora senza prenotazione: non è certo di quale sia → caso, nessuna conversione", (() => { const r = abbina(ev(), [rich("vecchia", PRENOTANTE, "2026-11-05T09:00:00Z"), rich("annullataRecente", PRENOTANTE, "2026-11-05T12:00:00Z", "cancelled")]); return r.tipo === "caso" && r.motivo === "piu_lead"; })());
  atteso("se per la richiesta annullata la conversione era GIÀ PARTITA, la nuova prenotazione della stessa persona va a verifica manuale (niente seconda conversione per lo stesso cliente)", (() => { const r = abbina(ev(), [rich("conv", PRENOTANTE, "2026-11-04T12:31:58Z", "cancelled", true), R_NUOVA]); return r.tipo === "caso" && r.motivo === "prenotazione_duplicata" && r.email === PRENOTANTE; })());
  atteso("più richieste ancora senza prenotazione entro 24 ore: vale la più recente, le altre restano nello storico come sostituite", (() => { const r = abbina(ev(), [rich("p1", PRENOTANTE, "2026-11-05T11:00:00Z"), rich("p2", PRENOTANTE, "2026-11-05T13:00:00Z"), R_NUOVA]); return r.tipo === "abbinato" && r.richiesta.id === "nuova" && r.sostituite.slice().sort().join() === "p1,p2"; })());
  atteso("… a più di 24 ore l'una dall'altra, o in modalità «manuale»: caso, nessuna conversione", (() => { const r = abbina(ev(), [rich("p1", PRENOTANTE, "2026-11-01T11:00:00Z"), R_NUOVA]); const m = abbina(ev(), [rich("p1", PRENOTANTE, "2026-11-05T11:00:00Z"), R_NUOVA], null, configurazioneDaAmbiente({ DEMO_CALENDAR_TITLE_REGEX: "demo omnia", DEMO_MULTI_RICHIESTA: "manuale" })); return r.tipo === "caso" && r.motivo === "piu_lead" && m.tipo === "caso" && m.motivo === "piu_lead"; })());
  atteso("più richieste solo ANNULLATE: la più recente entro 24 ore; oltre, caso", (() => { const a = abbina(ev(), [rich("c1", PRENOTANTE, "2026-11-05T10:00:00Z", "cancelled"), rich("c2", PRENOTANTE, "2026-11-05T12:00:00Z", "cancelled")]); const b = abbina(ev(), [rich("c1", PRENOTANTE, "2026-10-30T10:00:00Z", "cancelled"), rich("c2", PRENOTANTE, "2026-11-05T12:00:00Z", "cancelled")]); return a.tipo === "abbinato" && a.richiesta.id === "c2" && a.sostituite.length === 0 && b.tipo === "caso"; })());
  atteso("con UNA sola richiesta candidata si abbina sempre, anche in modalità «manuale» (la modalità riguarda solo le richieste multiple)", (() => { const c = configurazioneDaAmbiente({ DEMO_CALENDAR_TITLE_REGEX: "demo omnia", DEMO_MULTI_RICHIESTA: "manuale" }); const r = abbina(ev(), [R_NUOVA], null, c); const m = abbina(ev(), [R_ANNULLATA], null, c); return r.tipo === "abbinato" && r.richiesta.id === "nuova" && m.tipo === "abbinato" && m.richiesta.id === "annullata"; })());
  atteso("senza nessuna richiesta, il caso «nessun_lead» riporta l'email del PRIMO esterno (non del calendario né della squadra)", (() => { const r = abbina(ev({ attendees: [{ email: INTERNO }, { email: "esterno.uno@esempio.test" }, { email: "esterno.due@esempio.test" }] }), []); return r.tipo === "caso" && r.motivo === "nessun_lead" && r.email === "esterno.uno@esempio.test"; })());
  atteso("una richiesta GIÀ confermata con un altro evento, e nessuna nuova: «prenotazione_duplicata» (nessuna seconda conversione)", (() => { const r = abbina(ev({ id: "evt2" }), [rich("c", PRENOTANTE, "2026-11-04T12:31:58Z", "confirmed")]); return r.tipo === "caso" && r.motivo === "prenotazione_duplicata"; })());
  atteso("una richiesta «sostituita» non è mai un candidato", (() => { const r = abbina(ev(), [rich("s", PRENOTANTE, "2026-11-05T14:00:00Z", "superseded"), R_NUOVA]); return r.tipo === "abbinato" && r.richiesta.id === "nuova"; })());
  atteso("la finestra e la tolleranza restano: richiesta nata DOPO la prenotazione (oltre 10 minuti) o più di 30 giorni prima → non candidata", (() => { const dopo = abbina(ev(), [rich("d", PRENOTANTE, "2026-11-05T15:30:00Z")]); const vecchia = abbina(ev(), [rich("v", PRENOTANTE, "2026-09-01T10:00:00Z")]); return dopo.tipo === "caso" && vecchia.tipo === "caso" && vecchia.motivo === "fuori_finestra"; })());

  console.log("\n--- Email duplicate e maiuscole ---");
  atteso("lo stesso indirizzo scritto in modi diversi tra gli ospiti è UNA persona (e una richiesta sola resta univoca)", (() => { const r = abbina(ev({ attendees: [{ email: INTERNO }, { email: PRENOTANTE.toUpperCase() }, { email: ` ${PRENOTANTE} ` }] }), [R_NUOVA]); return r.tipo === "abbinato" && r.richiesta.id === "nuova"; })());

  console.log("\n--- Cancellazioni e rifiuti ---");
  const nota: PrenotazioneNota = { id: "pren1", lead_id: "nuova", stato: "confirmed", starts_at: "2026-11-06T08:00:00.000Z", starts_at_originale: "2026-11-06T08:00:00.000Z" };
  atteso("evento cancellato: annulla la prenotazione nota, anche con pochi campi; senza prenotazione nota non c'è niente da annullare", (() => { const a = abbina({ id: "evt1", status: "cancelled" }, [R_NUOVA], nota); const b = abbina({ id: "evtX", status: "cancelled" }, [R_NUOVA]); return a.tipo === "cancellato" && a.prenotazione?.id === "pren1" && b.tipo === "cancellato" && b.prenotazione === null; })());
  atteso("il cliente rifiuta l'invito mentre la squadra lo ha accettato: equivale ad annullare (conta solo chi poteva prenotare)", (() => { const e = ev({ attendees: [{ email: INTERNO, responseStatus: "accepted" }, { email: PRENOTANTE, responseStatus: "declined" }] }); return tuttiGliEsterniHannoRifiutato(e, cfg) && abbina(e, [R_NUOVA], nota).tipo === "cancellato" && abbina(e, [R_NUOVA]).tipo === "cancellato"; })());
  atteso("se rifiuta un collega e non il cliente, la prenotazione resta valida", (() => { const e = ev({ attendees: [{ email: INTERNO, responseStatus: "declined" }, { email: PRENOTANTE, responseStatus: "accepted" }] }); return !tuttiGliEsterniHannoRifiutato(e, cfg) && abbina(e, [], nota).tipo === "prenotazione_nota"; })());
  atteso("prenotazione già nota: rinominata, spostata o riattivata resta la stessa (nessun nuovo abbinamento, nessun doppione)", (() => { const r = abbina(ev({ summary: "Riunione", start: { dateTime: "2026-11-07T10:00:00+01:00" } }), [R_NUOVA, R_ANNULLATA], nota); return r.tipo === "prenotazione_nota" && r.nuovoInizio === "2026-11-07T09:00:00.000Z" && r.riattivata === false; })());

  // ═════════════════════════ 5. Sincronizzazione completa (database finto) ═════════════════════════
  console.log("\n--- Sincronizzazione: il caso reale, di punta in bianco ---");
  {
    const db = dbCon([richiestaDb("annullata", PRENOTANTE, "2026-11-04T12:31:58Z", "cancelled"), richiestaDb("altro", ALTRO, "2026-11-05T13:05:13Z", "pending"), richiestaDb("nuova", PRENOTANTE, "2026-11-05T14:57:13Z", "pending")], { prenotazioni: [prenotazioneDb("annullata", "evtVecchio", "cancelled")] });
    const cf = calendarioFinto({ novita: [ev()] });
    const r = await sincronizzaCalendario(db.comeClient(), envCal, ORA_30, cf.fetch);
    atteso("il test reale, rigiocato: la prenotazione viene abbinata alla richiesta nuova, nessun caso, nessuna richiesta sostituita", r.confermati === 1 && r.casi === 0 && r.sostituite === 0 && leadDi(db, "nuova").booking_status === "confirmed" && db.da("demo_calendar_casi").length === 0, JSON.stringify(r));
    atteso("la richiesta annullata di ieri e la sua prenotazione annullata NON vengono toccate; l'altra persona non c'entra", leadDi(db, "annullata").booking_status === "cancelled" && db.da("demo_prenotazioni").filter((x) => x.lead_id === "annullata").length === 1 && db.da("demo_prenotazioni").find((x) => x.lead_id === "annullata")?.stato === "cancelled" && leadDi(db, "altro").booking_status === "pending");
    atteso("la conversione è pronta SOLO per la richiesta nuova (data della prima prenotazione, consensi verificati); nessun invio a nessuno", leadDi(db, "nuova").ads_import_status === "ready" && leadDi(db, "nuova").prima_prenotazione_il === "2026-11-05T14:57:35.000Z" && leadDi(db, "annullata").ads_import_status === "skipped_cancelled" && cf.chiamate.every((x) => !/google-analytics|datamanager/.test(x.url)));
    const r2 = await sincronizzaCalendario(db.comeClient(), envCal, ORA_30 + 600_000, cf.fetch);
    atteso("rielaborare lo stesso evento non cambia nulla (nessun doppione)", r2.confermati === 0 && db.da("demo_prenotazioni").filter((x) => x.calendar_event_id === "evt1").length === 1 && db.da("demo_prenotazioni").length === 2);
  }

  console.log("\n--- Sincronizzazione: persone diverse e account interni ---");
  {
    const db = dbCon([richiestaDb("interna", INTERNO, "2026-11-05T14:00:00Z", "pending"), richiestaDb("nuova", PRENOTANTE, "2026-11-05T14:57:13Z", "pending")]);
    const r = await sincronizzaCalendario(db.comeClient(), envCal, ORA_30, calendarioFinto({ novita: [ev()] }).fetch);
    atteso("un collega con una richiesta dal modulo tra gli ospiti NON blocca il cliente: confermato il cliente, la richiesta del collega resta com'è", r.confermati === 1 && r.casi === 0 && leadDi(db, "nuova").booking_status === "confirmed" && leadDi(db, "interna").booking_status === "pending");
    const db2 = dbCon([richiestaDb("nuova", PRENOTANTE, "2026-11-05T14:57:13Z", "pending"), richiestaDb("altro", ALTRO, "2026-11-05T14:50:00Z", "pending")]);
    const r2 = await sincronizzaCalendario(db2.comeClient(), envCal, ORA_30, calendarioFinto({ novita: [ev({ attendees: [{ email: INTERNO }, { email: PRENOTANTE }, { email: ALTRO }] })] }).fetch);
    atteso("due persone diverse con una richiesta ciascuna per lo stesso evento: NESSUNA conversione (caso «piu_lead»), le richieste restano «pending»", r2.confermati === 0 && r2.casi === 1 && db2.da("demo_prenotazioni").length === 0 && db2.da("demo_leads").every((x) => x.booking_status === "pending") && db2.da("demo_leads").every((x) => x.ads_import_status === "not_ready"));
    atteso("il caso registra l'email del candidato (la persona con la richiesta più recente), non quella dell'account interno", db2.da("demo_calendar_casi")[0].motivo === "piu_lead" && db2.da("demo_calendar_casi")[0].attendee_email_norm === PRENOTANTE && /2 persone diverse/.test(String(db2.da("demo_calendar_casi")[0].note)));
  }

  console.log("\n--- Sincronizzazione: prenotazioni ripetute e cancellazioni ---");
  {
    // prima prenotazione, poi annullata; poi una richiesta nuova e una nuova prenotazione
    const db = dbCon([richiestaDb("r1", PRENOTANTE, "2026-11-04T12:31:58Z", "pending")]);
    await sincronizzaCalendario(db.comeClient(), envCal, ORA_30 - 86_400_000, calendarioFinto({ novita: [ev({ id: "e1", created: "2026-11-04T12:33:43Z" })] }).fetch);
    atteso("prima prenotazione: la richiesta 1 è confermata", leadDi(db, "r1").booking_status === "confirmed");
    await sincronizzaCalendario(db.comeClient(), envCal, ORA_30 - 3_600_000, calendarioFinto({ novita: [ev({ id: "e1", status: "cancelled" })] }).fetch);
    atteso("la prenotazione viene cancellata: richiesta e prenotazione annullate, conversione non partita", leadDi(db, "r1").booking_status === "cancelled" && db.da("demo_prenotazioni")[0].stato === "cancelled" && leadDi(db, "r1").ads_import_status === "skipped_cancelled");
    db.da("demo_leads").push(richiestaDb("r2", PRENOTANTE, "2026-11-05T14:57:13Z", "pending"));
    const r = await sincronizzaCalendario(db.comeClient(), envCal, ORA_30, calendarioFinto({ novita: [ev({ id: "e2" })] }).fetch);
    atteso("la persona torna con una richiesta nuova e prenota di nuovo: la nuova prenotazione va alla richiesta NUOVA, la vecchia resta annullata, due prenotazioni in tutto e UNA sola conferma", r.confermati === 1 && r.casi === 0 && leadDi(db, "r2").booking_status === "confirmed" && leadDi(db, "r1").booking_status === "cancelled" && db.da("demo_prenotazioni").length === 2 && db.da("demo_prenotazioni").filter((x) => x.stato === "confirmed").length === 1);
    const r3 = await sincronizzaCalendario(db.comeClient(), envCal, ORA_30 + 600_000, calendarioFinto({ novita: [ev({ id: "e2", status: "cancelled" })] }).fetch);
    atteso("e se anche questa viene cancellata: richiesta 2 annullata, richiesta 1 invariata, nessun doppione", r3.cancellati === 1 && leadDi(db, "r2").booking_status === "cancelled" && leadDi(db, "r1").booking_status === "cancelled" && db.da("demo_prenotazioni").length === 2);
  }
  {
    // conversione già partita per la prima richiesta, poi cancellata: la nuova prenotazione NON diventa una seconda conversione
    const db = dbCon([richiestaDb("conv", PRENOTANTE, "2026-11-04T12:31:58Z", "cancelled", { ads_import_status: "accepted", ads_request_id: "req" }), richiestaDb("nuova", PRENOTANTE, "2026-11-05T14:57:13Z", "pending")]);
    const r = await sincronizzaCalendario(db.comeClient(), envCal, ORA_30, calendarioFinto({ novita: [ev()] }).fetch);
    atteso("conversione già accettata per la richiesta poi annullata: la nuova prenotazione dello stesso cliente va a verifica manuale e NON produce una seconda conversione", r.confermati === 0 && r.casi === 1 && leadDi(db, "nuova").booking_status === "pending" && leadDi(db, "nuova").ads_import_status === "not_ready" && db.da("demo_calendar_casi")[0].motivo === "prenotazione_duplicata" && leadDi(db, "conv").ads_import_status === "accepted");
  }

  // ═════════════════════════ 6. Recupero della prenotazione già esistente ═════════════════════════
  console.log("\n--- Recupero: riesame dei casi aperti ---");
  {
    const leads = [richiestaDb("annullata", PRENOTANTE, "2026-11-04T12:31:58Z", "cancelled"), richiestaDb("altro", ALTRO, "2026-11-05T13:05:13Z", "pending"), richiestaDb("nuova", PRENOTANTE, "2026-11-05T14:57:13Z", "pending")];
    const db = dbCon(leads, { prenotazioni: [prenotazioneDb("annullata", "evtVecchio", "cancelled")], casi: [casoDb("evt1")] });
    // le novità sono vuote (l'evento era già stato visto): il riesame lo rilegge per id
    const cf = calendarioFinto({ novita: [], perId: { evt1: ev() } });
    const r = await sincronizzaCalendario(db.comeClient(), envCal, ORA_00, cf.fetch);
    atteso("IL RECUPERO: il caso aperto dal vecchio algoritmo si risolve da solo al riesame orario: prenotazione registrata, richiesta nuova confermata, caso chiuso", r.riesaminati === 1 && r.confermati === 1 && r.erroriRiesame === 0 && leadDi(db, "nuova").booking_status === "confirmed" && db.da("demo_calendar_casi")[0].risolto === true && db.da("demo_prenotazioni").filter((x) => x.calendar_event_id === "evt1").length === 1, JSON.stringify(r));
    atteso("il riesame legge l'evento in SOLA LETTURA (GET per id) e nessun dato va a Google Ads o GA4", lettureSingole(cf).length === 1 && lettureSingole(cf).every((x) => x.metodo === "GET" && x.intestazioni.authorization === "Bearer at-segreto-xyz") && cf.chiamate.every((x) => !/datamanager|google-analytics/.test(x.url)));
    atteso("la richiesta annullata di ieri, la sua prenotazione e l'altra persona restano com'erano", leadDi(db, "annullata").booking_status === "cancelled" && db.da("demo_prenotazioni").filter((x) => x.lead_id === "annullata").length === 1 && leadDi(db, "altro").booking_status === "pending");
    const cf2 = calendarioFinto({ novita: [], perId: { evt1: ev() } });
    const r2 = await sincronizzaCalendario(db.comeClient(), envCal, ORA_00 + 3_600_000, cf2.fetch);
    atteso("rieseguire non crea doppioni: il caso è chiuso, non si rilegge più nulla, una sola prenotazione per l'evento", r2.riesaminati === 0 && r2.confermati === 0 && lettureSingole(cf2).length === 0 && db.da("demo_prenotazioni").filter((x) => x.calendar_event_id === "evt1").length === 1 && db.da("demo_prenotazioni").length === 2);
  }
  {
    const db = dbCon([richiestaDb("nuova", PRENOTANTE, "2026-11-05T14:57:13Z", "pending")], { casi: [casoDb("evt1")] });
    const cf = calendarioFinto({ novita: [], perId: { evt1: ev() } });
    const r = await sincronizzaCalendario(db.comeClient(), envCal, ORA_30, cf.fetch);
    atteso("il riesame parte UNA volta all'ora: al minuto 30 non rilegge niente e il caso resta aperto", r.riesaminati === 0 && lettureSingole(cf).length === 0 && db.da("demo_calendar_casi")[0].risolto === false && leadDi(db, "nuova").booking_status === "pending");
    const rMin9 = await sincronizzaCalendario(db.comeClient(), envCal, Date.parse("2026-11-05T15:09:59.000Z"), cf.fetch);
    atteso("… dentro i primi dieci minuti dell'ora sì (anche se il cron è in ritardo)", rMin9.riesaminati === 1 && db.da("demo_calendar_casi")[0].risolto === true);
  }
  {
    // un riesame che resta incerto non conta come caso nuovo, ma aggiorna il caso con il candidato vero
    const db = dbCon([richiestaDb("nuova", PRENOTANTE, "2026-11-05T14:57:13Z", "pending"), richiestaDb("altro", ALTRO, "2026-11-05T14:50:00Z", "pending")], { casi: [casoDb("evt1", { attendee_email_norm: INTERNO, note: "2 richieste possibili per la stessa prenotazione." })] });
    const cf = calendarioFinto({ novita: [], perId: { evt1: ev({ attendees: [{ email: INTERNO }, { email: PRENOTANTE }, { email: ALTRO }] }) } });
    const r = await sincronizzaCalendario(db.comeClient(), envCal, ORA_00, cf.fetch);
    atteso("riesame di un caso che resta incerto (due persone): resta aperto, NON conta come caso nuovo, e si aggiorna con l'email del candidato e la nota giusta", r.riesaminati === 1 && r.casi === 0 && db.da("demo_calendar_casi").length === 1 && db.da("demo_calendar_casi")[0].risolto === false && db.da("demo_calendar_casi")[0].attendee_email_norm === PRENOTANTE && /2 persone diverse/.test(String(db.da("demo_calendar_casi")[0].note)) && db.da("demo_prenotazioni").length === 0);
  }
  {
    const db = dbCon([richiestaDb("nuova", PRENOTANTE, "2026-11-05T14:57:13Z", "pending")], { casi: [casoDb("evtSparito"), casoDb("evt1")] });
    const cf = calendarioFinto({ novita: [], perId: { evt1: ev() } });
    const r = await sincronizzaCalendario(db.comeClient(), envCal, ORA_00, cf.fetch);
    atteso("un evento che non si trova più (404) non rompe il riesame: errore contato, gli altri casi si risolvono, il token di sincronizzazione avanza lo stesso", r.erroriRiesame === 1 && r.riesaminati === 1 && leadDi(db, "nuova").booking_status === "confirmed" && db.da("demo_sync_stato")[0].sync_token === "T" && db.da("demo_calendar_casi").find((x) => x.calendar_event_id === "evtSparito")?.risolto === false);
    const dbVecchi = dbCon([richiestaDb("nuova", PRENOTANTE, "2026-11-05T14:57:13Z", "pending")], { casi: [casoDb("evtOld", { created_at: new Date(ORA_00 - (GIORNI_RIESAME_CASI + 1) * 86_400_000).toISOString() }), casoDb("evtRisolto", { risolto: true }), casoDb("evtAltroCal", { calendar_id: "altro@calendario.test" })] });
    const cf2 = calendarioFinto({ novita: [], perId: { evtOld: ev(), evtRisolto: ev(), evtAltroCal: ev() } });
    await sincronizzaCalendario(dbVecchi.comeClient(), envCal, ORA_00, cf2.fetch);
    atteso(`non si riesaminano i casi più vecchi di ${GIORNI_RIESAME_CASI} giorni, quelli già chiusi né quelli di un altro calendario`, lettureSingole(cf2).length === 0);
    const molti = Array.from({ length: MASSIMO_RIESAMI_PER_GIRO + 5 }, (_, i) => casoDb(`evt${i}`));
    const dbMolti = dbCon([richiestaDb("nuova", PRENOTANTE, "2026-11-05T14:57:13Z", "pending")], { casi: molti });
    const cf3 = calendarioFinto({ novita: [], perId: {} });
    await sincronizzaCalendario(dbMolti.comeClient(), envCal, ORA_00, cf3.fetch);
    atteso(`al massimo ${MASSIMO_RIESAMI_PER_GIRO} casi per giro`, lettureSingole(cf3).length === MASSIMO_RIESAMI_PER_GIRO);
  }
  {
    const db = dbCon([richiestaDb("nuova", PRENOTANTE, "2026-11-05T14:57:13Z", "pending")], { casi: [casoDb("evt1")] });
    db.guasto = (t, tipo) => (t === "demo_prenotazioni" && tipo === "insert" ? { code: "XX000", message: "boom" } : null);
    const cf = calendarioFinto({ novita: [], perId: { evt1: ev() } });
    const r = await sincronizzaCalendario(db.comeClient(), envCal, ORA_00, cf.fetch);
    atteso("un guasto durante il riesame è contato (erroriRiesame) senza eccezioni, senza toccare la richiesta e senza bloccare il token", r.erroriRiesame === 1 && r.riesaminati === 0 && leadDi(db, "nuova").booking_status === "pending" && db.da("demo_sync_stato")[0].sync_token === "T" && db.da("demo_calendar_casi")[0].risolto === false);
  }
  {
    // recupero con la prenotazione già registrata (interruzione precedente): nessun doppione
    const db = dbCon([richiestaDb("nuova", PRENOTANTE, "2026-11-05T14:57:13Z", "pending")], { prenotazioni: [prenotazioneDb("nuova", "evt1")], casi: [casoDb("evt1")] });
    const r = await sincronizzaCalendario(db.comeClient(), envCal, ORA_00, calendarioFinto({ novita: [], perId: { evt1: ev() } }).fetch);
    atteso("se la prenotazione per quell'evento esiste già, il riesame la completa (richiesta confermata) senza crearne un'altra", r.riesaminati === 1 && leadDi(db, "nuova").booking_status === "confirmed" && db.da("demo_prenotazioni").filter((x) => x.calendar_event_id === "evt1").length === 1);
  }

  // ═════════════════════════ 7. Diagnosi in sola lettura ═════════════════════════
  console.log("\n--- Diagnosi degli eventi dei casi aperti (sola lettura, senza dati personali) ---");
  {
    const db = dbCon([richiestaDb("annullata", PRENOTANTE, "2026-11-04T12:31:58Z", "cancelled"), richiestaDb("altro", ALTRO, "2026-11-05T13:05:13Z", "pending"), richiestaDb("nuova", PRENOTANTE, "2026-11-05T14:57:13Z", "pending"), richiestaDb("interna", INTERNO, "2026-11-05T14:00:00Z", "pending")], { casi: [casoDb("evtSegreto123")] });
    const evento = { ...ev({ id: "evtSegreto123", creator: { email: "creatore.interno@omniaitalia.com" } }), conferenceData: { x: 1 }, htmlLink: "https://calendar/segreto", description: "descrizione riservata Mario Rossi" } as unknown as EventoCalendario;
    const cf = calendarioFinto({ perId: { evtSegreto123: evento } });
    const operazioniPrima = db.operazioni.length;
    const r = await diagnosticaCasiAperti(db.comeClient(), envCal, cf.fetch);
    const testo = JSON.stringify(r);
    atteso("la diagnosi descrive l'evento: ospiti con ruolo e risposta, richieste candidate, creatore e organizzatore, esito con le regole di adesso", r.eseguita && r.eventi.length === 1 && r.eventi[0].trovato && r.eventi[0].ospiti.length === 2 && r.eventi[0].ospiti[0].ruolo === "dominio_interno" && r.eventi[0].ospiti[1].ruolo === "esterno" && r.eventi[0].ospiti[1].richiesteTotali === 2 && r.eventi[0].ospiti[1].richiesteCandidate === 2 && r.eventi[0].richiesteCandidate.length === 2 && r.eventi[0].creatore.interno && !r.eventi[0].creatore.ancheOspite && r.eventi[0].titoloDemo && r.eventi[0].esitoConLeRegoleDiOra.tipo === "abbinato", testo.slice(0, 600));
    atteso("l'ospite interno ha zero richieste candidate; le richieste candidate dicono lo stato e quanti minuti prima dell'evento sono state fatte (22 secondi → 0 minuti)", r.eseguita && r.eventi[0].ospiti[0].richiesteTotali === 1 && r.eventi[0].ospiti[0].richiesteCandidate === 0 && r.eventi[0].richiesteCandidate.length === 2 && r.eventi[0].richiesteCandidate.some((x) => x.stato === "pending" && x.minutiPrimaDellEvento === 0) && r.eventi[0].richiesteCandidate.some((x) => x.stato === "cancelled" && x.minutiPrimaDellEvento > 1000));
    atteso("dell'evento si riportano i NOMI dei campi (non i valori)", r.eseguita && r.eventi[0].campiPresenti.includes("attendees") && r.eventi[0].campiPresenti.includes("conferenceData") && !testo.includes("descrizione riservata"));
    atteso("NESSUNA email, nome, titolo, id di evento o di richiesta, indirizzo o testo libero nel risultato", ![PRENOTANTE, ALTRO, INTERNO, "creatore.interno", "evtSegreto123", "annullata\"", "Mario Rossi", "Demo OMNIA", "calendar/segreto", "at-segreto-xyz", "rt-segreto", "client-segreto", "@"].some((x) => testo.includes(x)), [PRENOTANTE, ALTRO, INTERNO, "evtSegreto123", "@"].filter((x) => testo.includes(x)).join(","));
    atteso("è SOLA LETTURA: solo SELECT sul database, solo GET al calendario (più il token), nessuna chiamata a Ads o GA4", db.operazioni.slice(operazioniPrima).every((o) => o.tipo === "select") && cf.chiamate.filter((x) => !x.url.startsWith("https://oauth2")).every((x) => x.metodo === "GET") && cf.chiamate.every((x) => !/datamanager|google-analytics/.test(x.url)));
    const cfVuoto = calendarioFinto({});
    const rVuota = await diagnosticaCasiAperti(dbCon([]).comeClient(), envCal, cfVuoto.fetch);
    const rNonTrovato = await diagnosticaCasiAperti(dbCon([], { casi: [casoDb("evtX")] }).comeClient(), envCal, calendarioFinto({ perId: {} }).fetch);
    const rSenzaCred = await diagnosticaCasiAperti(dbCon([], { casi: [casoDb("evtX")] }).comeClient(), { ...envCal, GOOGLE_CALENDAR_REFRESH_TOKEN: undefined }, calendarioFinto({}).fetch);
    const rToken = await diagnosticaCasiAperti(dbCon([], { casi: [casoDb("evtX")] }).comeClient(), envCal, fetchFinto(() => ({ status: 401 })).fetch);
    atteso("nessun caso aperto: elenco vuoto e nessuna chiamata di rete; evento non trovato: lo dice; credenziali mancanti o OAuth fallito: motivo chiaro", rVuota.eseguita && rVuota.eventi.length === 0 && cfVuoto.chiamate.length === 0 && rNonTrovato.eseguita && rNonTrovato.eventi[0].trovato === false && rNonTrovato.eventi[0].esitoConLeRegoleDiOra.tipo === "evento_non_letto" && !rSenzaCred.eseguita && rSenzaCred.motivo === "credenziali_mancanti" && !rToken.eseguita && rToken.motivo === "token_non_ottenuto");
  }

  // ═════════════════════════ 8. Codice ═════════════════════════
  console.log("\n--- Codice: sola lettura, solo admin, variabili e guida ---");
  const diagnosi = leggi("src/lib/demo-calendario-diagnosi.ts");
  const azione = leggi("src/app/site-console/azioni/demo-calendario.ts");
  const comp = leggi("src/app/site-console/_componenti/diagnosi-calendario.tsx");
  const sync = leggi("src/lib/demo-calendario-sync.ts");
  const calc = leggi("src/lib/demo-calendario-calcoli.ts");
  const guida = leggi("GUIDA-DEMO-TRACCIAMENTO.md");
  atteso("la diagnosi non scrive nulla e non usa console: nessuna insert/update/upsert/delete, nessun console.*", !/\.(insert|update|upsert|delete)\(/.test(diagnosi + azione) && !/console\./.test(diagnosi + azione));
  atteso("l'azione della diagnosi controlla l'admin come PRIMA operazione, poi: una alla volta, un minuto di pausa, dieci all'ora; blocco rilasciato sempre; niente messaggi liberi", /^"use server";/.test(azione) && azione.indexOf("await richiediAdminAzione()") > 0 && azione.indexOf("await richiediAdminAzione()") < azione.indexOf("if (inEsecuzione)") && azione.indexOf("if (inEsecuzione)") < azione.indexOf("await diagnosticaCasiAperti(") && /const PAUSA_MINIMA_MS = 60_000;/.test(azione) && /if \(adesso - ultimaEsecuzioneMs < PAUSA_MINIMA_MS\) return \{ ok: false, errore: "Attendi un minuto/.test(azione) && /const MASSIMO_ALL_ORA = 10;/.test(azione) && /if \(esecuzioniRecenti\.length >= MASSIMO_ALL_ORA\) return \{ ok: false, errore: "Troppe diagnosi/.test(azione) && /inEsecuzione = true;\s*ultimaEsecuzioneMs = adesso;\s*esecuzioniRecenti\.push\(adesso\);/.test(azione) && /\} finally \{\s*inEsecuzione = false;\s*\}/.test(azione) && /errore: "La diagnosi non è riuscita \(errore imprevisto\)\."/.test(azione));
  atteso("il pulsante sta nella pagina DEMO e si spegne per un minuto dopo l'uso; ospiti come «ospite N», senza email", /<DiagnosiCalendario \/>/.test(leggi("src/app/site-console/_componenti/demo-vista.tsx")) && /disabled=\{inCorso \|\| inPausa\}/.test(comp) && /setTimeout\(\(\) => setInPausa\(false\), 60_000\)/.test(comp) && /ospite \{o\.ospite\}/.test(comp) && !/\.email\b/.test(comp));
  atteso("il riesame dei casi gira una volta all'ora (minuti 0-9), con tetto di casi per giro e senza influire sul token", /getUTCMinutes\(\) < 10\) await riesaminaCasiAperti\(/.test(sync) && /MASSIMO_RIESAMI_PER_GIRO = 10/.test(sync) && /GIORNI_RIESAME_CASI = 30/.test(sync) && sync.indexOf("riesaminaCasiAperti(contesto") < sync.indexOf("const tuttoBene"));
  atteso("il riesame legge gli eventi in sola lettura (nessuna chiamata di scrittura verso Calendar)", !/method:\s*"(POST|PUT|PATCH|DELETE)"/.test(sync + diagnosi) && /calendar\.readonly/.test(sync));
  atteso("la logica di abbinamento non prende mai «il primo partecipante» come prenotante e non usa il creatore per scegliere", !/valide\[0\],\s*nota: `\$\{candidati/.test(calc) && /Non si assume mai che il primo esterno sia il cliente|non\s+si assume mai che il primo esterno/i.test(calc.replace(/\n\/\/\s*/g, " ")) && !/creator\??\.email[^;]*abbinato/.test(calc));
  atteso("la variabile DEMO_CALENDAR_INTERNAL_DOMAINS è descritta nella guida, con il predefinito e la protezione dei domini pubblici", /DEMO_CALENDAR_INTERNAL_DOMAINS/.test(guida) && /omniaitalia\.com/.test(guida) && /pubblic/i.test(guida));
  atteso("la guida descrive l'identificazione del prenotante, il riesame dei casi aperti e la diagnosi degli eventi", /Chi ha prenotato/i.test(guida) && /riesame/i.test(guida) && /Diagnosi degli eventi/i.test(guida));
  atteso("il test è nella catena verifica:livello1", /tsx scripts\/verifica-demo-abbinamento-omnia-ai\.ts/.test(leggi("package.json")));
  atteso("nessun file del pagamento, dell'autenticazione, del modulo o dell'azione di richiesta è stato toccato dalla correzione", ["src/app/api/webhooks/stripe/route.ts", "src/app/actions/omnia-ai-demo.ts", "src/components/omnia-ai/demo-form.tsx", "src/lib/demo-leads.ts", "src/lib/demo-ga4.ts", "src/lib/demo-ads-data-manager.ts"].every((f) => !/demo-calendario-diagnosi|riesaminaCasiAperti|dominiInterni/.test(leggi(f))));

  if (fallimenti.length > 0) {
    console.log(`\n${fallimenti.length} controlli falliti:\n- ${fallimenti.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\nTutti i controlli sono andati a buon fine.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
