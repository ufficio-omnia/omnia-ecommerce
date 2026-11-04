// Autotest del tracciamento delle DEMO di OMNIA AI (richiesta dell'utente, 04/11/2026): modulo → lead su Supabase → prenotazione sul
// calendario Google → evento GA4 e conversione Google Ads, SOLO per le prenotazioni confermate e abbinate con certezza.
//
// Nessuna rete, nessun database vero, nessuna chiave: si usano i moduli puri, un database finto in memoria e un fetch finto
// (scripts/demo-finto-supabase.ts). Si controlla in particolare che:
//   - l'invio del modulo NON produca mai una conversione;
//   - l'abbinamento incerto finisca in verifica manuale senza inviare nulla;
//   - nessuna conversione parta senza consenso, senza prenotazione confermata, o due volte;
//   - le integrazioni siano spente finché non sono configurate e partano in «solo verifica» finché non si passa alla modalità reale;
//   - nei log e nelle risposte non compaiano email, token o identificativi di clic.
import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import { FintoDatabase, fetchFinto, type ChiamataFinta, type Riga } from "./demo-finto-supabase";
import {
  CHIAVE_ATTRIBUZIONE,
  CHIAVE_CONSENSO_COOKIE,
  GIORNI_VALIDITA_ATTRIBUZIONE,
  SETTORI_DEMO,
  VERSIONE_CONSENSI_DEMO,
  clientIdDaCookieGa,
  cookiePubblicitariAccettati,
  costruisciAttribuzioneSalvata,
  emailPerGoogle,
  leggiAttribuzioneDaUrl,
  leggiAttribuzioneSalvata,
  normalizzaEmail,
  pulisciAttribuzione,
  pulisciTelefono,
  sessionIdDaCookieGa,
  validaModuloDemo,
  valoreCookie,
} from "../src/lib/demo-lead-calcoli";
import {
  FINESTRA_GIORNI_PREDEFINITA,
  abbinaEvento,
  aggiornamentoPerConferma,
  configurazioneDaAmbiente,
  eventoDemo,
  partecipantiEsterni,
  type EventoCalendario,
  type LeadPerAbbinamento,
} from "../src/lib/demo-calendario-calcoli";
import {
  PAUSE_TENTATIVI_MINUTI,
  TENTATIVI_MASSIMI,
  configurazioneAdsValida,
  costruisciCorpoGa4,
  costruisciRichiestaAds,
  idTransazioneAds,
  interpretaStatoRichiesta,
  prossimoTentativo,
  statoAdsPerConferma,
  testoErroreSicuro,
  type ConfigurazioneAds,
  type LeadPerConversione,
} from "../src/lib/demo-conversioni-calcoli";
import { limitiConservazione } from "../src/lib/demo-conservazione-calcoli";
import { cronAutorizzato } from "../src/lib/cron-autorizzato";
import { hashIp, sha256Hex } from "../src/lib/demo-hash";
import { LIMITE_RICHIESTE_PER_IP_ORA, eliminaDatiScaduti, registraLead } from "../src/lib/demo-leads";
import { sincronizzaCalendario } from "../src/lib/demo-calendario-sync";
import { inviaConversioniGa4 } from "../src/lib/demo-ga4";
import { configurazioneAdsDaAmbiente, inviaConversioniAds } from "../src/lib/demo-ads-data-manager";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
const uguali = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const radice = path.join(__dirname, "..");
const leggi = (relativo: string) => fs.readFileSync(path.join(radice, relativo), "utf-8").replace(/\r\n/g, "\n");

// Cattura ciò che il codice scrive nei log, per controllare che non ci siano dati personali o segreti.
async function conLog<T>(fn: () => Promise<T>): Promise<{ valore: T; log: string }> {
  const originali = { error: console.error, warn: console.warn, log: console.log, info: console.info };
  const righe: string[] = [];
  const raccogli = (...args: unknown[]) => righe.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  console.error = raccogli;
  console.warn = raccogli;
  console.log = raccogli;
  console.info = raccogli;
  try {
    return { valore: await fn(), log: righe.join("\n") };
  } finally {
    console.error = originali.error;
    console.warn = originali.warn;
    console.log = originali.log;
    console.info = originali.info;
  }
}

const ADESSO_ISO = "2026-11-10T10:00:00.000Z";
const ADESSO = Date.parse(ADESSO_ISO);
const SEGRETI = ["rt-segreto", "at-segreto", "ads-rt", "ga-segreto", "mario.rossi@esempio.it", "Mario.Rossi@Esempio.it", "GCLID_abc12345", "client-segreto"];

function riga(extra: Riga = {}): Riga {
  return {
    id: randomUUID(), full_name: "Mario Rossi", company: "Pulizie Rossi Srl", email: "Mario.Rossi@Esempio.it", email_norm: "mario.rossi@esempio.it",
    phone: "+393331234567", sector: "Pulizie e sanificazione", gclid: "GCLID_abc12345", gbraid: null, wbraid: null,
    utm_source: "google", utm_medium: "cpc", utm_campaign: "demo", utm_content: null, utm_term: null, landing_path: "/",
    ga_client_id: "1234567890.1700000000", ga_session_id: "1700000000", attribution_consent: true,
    privacy_version: VERSIONE_CONSENSI_DEMO, privacy_accepted_at: "2026-11-10T09:00:00.000Z", ads_measurement_consent: true, ads_measurement_consent_at: "2026-11-10T09:00:00.000Z",
    ip_hash: null, booking_status: "pending", calendar_event_id: null, calendar_id: null, booked_at: null, booking_starts_at: null, booking_match_note: null,
    ga4_sent_at: null, ga4_attempts: 0, ads_import_status: "not_ready", ads_transaction_id: null, ads_request_id: null, ads_sent_at: null, ads_attempts: 0,
    ads_next_attempt_at: null, ads_last_error: null, created_at: "2026-11-10T09:00:00.000Z", updated_at: "2026-11-10T09:00:00.000Z", ...extra,
  };
}

async function main() {
  // ═════════════════════════ 1. Modulo: validazione e normalizzazione ═════════════════════════
  console.log("--- Modulo: validazione e normalizzazione ---");
  const ok = { nome: "  Mario   Rossi ", azienda: "Pulizie Rossi Srl", email: "Mario.Rossi@Esempio.it", telefono: "+39 333 123 4567", settore: "Pulizie e sanificazione", privacy: "on" };
  const v = validaModuloDemo(ok);
  atteso("un modulo completo è valido; spazi ripuliti, telefono ridotto a cifre con «+»", v.ok && v.dati.nome === "Mario Rossi" && v.dati.telefono === "+393331234567" && v.dati.adsConsenso === false, JSON.stringify(v));
  atteso("il consenso facoltativo alla misurazione pubblicitaria si legge da «on»", (() => { const r = validaModuloDemo({ ...ok, adsConsenso: "on" }); return r.ok && r.dati.adsConsenso === true; })());
  atteso("senza la presa visione dell'informativa privacy il modulo non è valido", (() => { const r = validaModuloDemo({ ...ok, privacy: undefined }); return !r.ok && !!r.errori.privacy; })());
  const rifiuta = (campo: string, valore: unknown, chiave: "nome" | "azienda" | "email" | "telefono" | "settore") => { const r = validaModuloDemo({ ...ok, [campo]: valore }); return !r.ok && !!r.errori[chiave]; };
  atteso("nome: troppo corto, solo cifre o con caratteri di controllo → rifiutato", rifiuta("nome", "A", "nome") && rifiuta("nome", "12", "nome") && rifiuta("nome", "Mario\u0000 Rossi", "nome") && rifiuta("nome", "", "nome"));
  atteso("azienda vuota → rifiutata", rifiuta("azienda", "   ", "azienda"));
  atteso("email: senza dominio, senza punto, con parentesi angolari o troppo lunga → rifiutata", ["a@b", "mario@esempio", "mario@@esempio.it", "<x>@esempio.it", `${"a".repeat(250)}@esempio.it`, "", "senza chiocciola.it"].every((e) => rifiuta("email", e, "email")));
  atteso("telefono: lettere, troppo corto (5 cifre), troppo lungo, «+» in mezzo → rifiutato; vuoto → rifiutato", ["abc", "12345", "1234567890123456", "333+1234567", "", "333 12x4567"].every((t) => rifiuta("telefono", t, "telefono")));
  atteso("telefono: formati comuni accettati (con spazi, trattini, parentesi, prefisso internazionale)", pulisciTelefono("06 1234567") === "061234567" && pulisciTelefono("(06) 123-4567") === "061234567" && pulisciTelefono("+39 06 1234567") === "+39061234567" && pulisciTelefono("0039 333 1234567") === "00393331234567");
  atteso("settore: solo quelli dell'elenco", rifiuta("settore", "Hacker", "settore") && rifiuta("settore", "", "settore") && SETTORI_DEMO.every((s) => validaModuloDemo({ ...ok, settore: s }).ok));
  atteso("i sette settori sono esattamente quelli richiesti, in ordine", uguali([...SETTORI_DEMO], ["Pulizie e sanificazione", "Multiservizi", "Ausiliariato", "Facchinaggio", "Ristorazione collettiva", "Vigilanza privata e servizi fiduciari", "Altro"]));
  atteso("i valori non testo (array, numeri, oggetti) non rompono la validazione", (() => { const r = validaModuloDemo({ nome: ["x"], azienda: 5, email: {}, telefono: null, settore: undefined, privacy: true }); return !r.ok && Object.keys(r.errori).length === 5; })());

  atteso("email normalizzata: spazi tolti e minuscolo", normalizzaEmail("  Mario.Rossi@Esempio.IT ") === "mario.rossi@esempio.it");
  atteso("email per Google, Gmail: punti e «+suffisso» tolti", emailPerGoogle("Mario.Rossi+Demo@Gmail.com") === "mariorossi@gmail.com" && emailPerGoogle("m.rossi@googlemail.com") === "mrossi@googlemail.com");
  atteso("email per Google, altri domini: punti e «+» restano", emailPerGoogle(" Mario.Rossi+x@Azienda.it ") === "mario.rossi+x@azienda.it");

  // ═════════════════════════ 2. Attribuzione pubblicitaria ═════════════════════════
  console.log("\n--- Attribuzione pubblicitaria (gclid, gbraid, wbraid, utm) ---");
  const a1 = leggiAttribuzioneDaUrl("?gclid=Cj0KCQiAabc_DEF-123&gbraid=0AAAAAbraid1234&wbraid=CjwKwbraid_99&utm_source=google&utm_medium=cpc&utm_campaign=demo+gare&utm_content=annuncio-1&utm_term=pulizie%20gare&foo=bar");
  atteso("legge tutti gli otto parametri, decodifica gli spazi e ignora gli altri", !!a1 && a1.gclid === "Cj0KCQiAabc_DEF-123" && a1.gbraid === "0AAAAAbraid1234" && a1.wbraid === "CjwKwbraid_99" && a1.utm_source === "google" && a1.utm_medium === "cpc" && a1.utm_campaign === "demo gare" && a1.utm_content === "annuncio-1" && a1.utm_term === "pulizie gare" && Object.keys(a1).length === 8, JSON.stringify(a1));
  atteso("nessun parametro → null", leggiAttribuzioneDaUrl("") === null && leggiAttribuzioneDaUrl("?pagina=2&foo=bar") === null && leggiAttribuzioneDaUrl("?utm_source=") === null);
  atteso("valori anomali scartati: script, spazi o simboli in un identificativo, troppo corti o troppo lunghi", leggiAttribuzioneDaUrl("?gclid=<script>alert(1)</script>") === null && leggiAttribuzioneDaUrl("?gclid=abc") === null && leggiAttribuzioneDaUrl(`?gclid=${"a".repeat(201)}`) === null && leggiAttribuzioneDaUrl("?gclid=abc%20def%20ghijkl") === null && leggiAttribuzioneDaUrl(`?utm_source=${"x".repeat(201)}`) === null && leggiAttribuzioneDaUrl("?utm_source=x%3Cscript%3E") === null);
  atteso("un valore valido accanto a uno anomalo: resta solo il valido", uguali(leggiAttribuzioneDaUrl("?gclid=valido_12345&utm_source=<b>"), { gclid: "valido_12345" }));
  atteso("pulisciAttribuzione tiene solo i campi noti e ben formati", uguali(pulisciAttribuzione({ gclid: "valido_12345", utm_source: "x<y", extra: "z", utm_medium: 5 }), { gclid: "valido_12345" }) && uguali(pulisciAttribuzione(null), {}) && uguali(pulisciAttribuzione("stringa"), {}));

  const salvata = costruisciAttribuzioneSalvata({ gclid: "valido_12345" }, ADESSO);
  const giorni = (n: number) => ADESSO + n * 86_400_000;
  atteso("attribuzione salvata: valida entro 90 giorni", uguali(leggiAttribuzioneSalvata(JSON.stringify(salvata), giorni(89)), { gclid: "valido_12345" }));
  atteso("attribuzione salvata: scaduta oltre 90 giorni, dal futuro, di altra versione, illeggibile o vuota → null", leggiAttribuzioneSalvata(JSON.stringify(salvata), giorni(GIORNI_VALIDITA_ATTRIBUZIONE + 1)) === null && leggiAttribuzioneSalvata(JSON.stringify(salvata), giorni(-1)) === null && leggiAttribuzioneSalvata(JSON.stringify({ ...salvata, v: 2 }), ADESSO) === null && leggiAttribuzioneSalvata("{non json", ADESSO) === null && leggiAttribuzioneSalvata(null, ADESSO) === null && leggiAttribuzioneSalvata(JSON.stringify({ v: 1, salvatoIl: ADESSO, valori: { gclid: "<x>" } }), ADESSO) === null);
  atteso("solo «accepted» conta come consenso ai cookie pubblicitari", cookiePubblicitariAccettati("accepted") && !cookiePubblicitariAccettati("rejected") && !cookiePubblicitariAccettati(null) && !cookiePubblicitariAccettati("pending"));
  atteso("identificativi di Google Analytics dai cookie (client_id, session_id), anche nelle due forme del cookie di sessione", clientIdDaCookieGa("GA1.1.1234567890.1700000000") === "1234567890.1700000000" && clientIdDaCookieGa("GA1.2.987654321.1699999999") === "987654321.1699999999" && clientIdDaCookieGa("boh") === null && clientIdDaCookieGa(undefined) === null && sessionIdDaCookieGa("GS1.1.1700000000.1.1.1700000100.0.0.0") === "1700000000" && sessionIdDaCookieGa("GS2.1.s1700000000$o1$g1$t1700000100$j0$l0$h0") === "1700000000" && sessionIdDaCookieGa("GS2.1.s1700000000") === "1700000000" && sessionIdDaCookieGa("boh") === null);
  atteso("lettura di un cookie per nome", valoreCookie("a=1; _ga=GA1.1.123456.456789; b=2", "_ga") === "GA1.1.123456.456789" && valoreCookie("a=1", "_ga") === null && valoreCookie("_ga=%E0%A4%A", "_ga") === null);
  atteso("le chiavi del consenso e dell'attribuzione nel browser sono quelle attese; il banner usa la stessa chiave", CHIAVE_ATTRIBUZIONE === "omnia-ai-attribuzione" && CHIAVE_CONSENSO_COOKIE === "omnia-ai-cookie-consent" && /const CONSENT_KEY = "omnia-ai-cookie-consent";/.test(leggi("src/components/omnia-ai/cookie-consent.tsx")));

  // ═════════════════════════ 3. Calendario: riconoscere e abbinare ═════════════════════════
  console.log("\n--- Calendario: riconoscere le demo e abbinarle al lead ---");
  const cfg = configurazioneDaAmbiente({ DEMO_CALENDAR_TITLE_REGEX: "demo omnia", DEMO_CALENDAR_INTERNAL_EMAILS: "ufficio@omniaitalia.com, Team@omniaitalia.com", DEMO_MATCH_WINDOW_DAYS: "30" });
  atteso("configurazione dall'ambiente: titolo, email interne in minuscolo, finestra", cfg.titolo.test("DEMO OMNIA AI") && uguali(cfg.emailInterne, ["ufficio@omniaitalia.com", "team@omniaitalia.com"]) && cfg.finestraGiorni === 30);
  const predefinita = configurazioneDaAmbiente({});
  atteso("senza configurazione: titolo «demo», nessuna email interna, finestra di 30 giorni; valori assurdi → predefiniti", predefinita.titolo.test("Demo") && predefinita.emailInterne.length === 0 && predefinita.finestraGiorni === FINESTRA_GIORNI_PREDEFINITA && configurazioneDaAmbiente({ DEMO_CALENDAR_TITLE_REGEX: "(" }).titolo.test("demo") && configurazioneDaAmbiente({ DEMO_MATCH_WINDOW_DAYS: "0" }).finestraGiorni === 30 && configurazioneDaAmbiente({ DEMO_MATCH_WINDOW_DAYS: "400" }).finestraGiorni === 30);

  const ev = (extra: Partial<EventoCalendario> = {}): EventoCalendario => ({
    id: "evt1", status: "confirmed", summary: "Demo OMNIA AI", created: "2026-11-10T09:30:00Z", start: { dateTime: "2026-11-12T10:00:00+01:00" },
    attendees: [{ email: "ufficio@omniaitalia.com", organizer: true, self: true }, { email: "Mario.Rossi@esempio.it", responseStatus: "accepted" }],
    organizer: { email: "ufficio@omniaitalia.com", self: true }, ...extra,
  });
  const lead = (extra: Partial<LeadPerAbbinamento> = {}): LeadPerAbbinamento => ({ id: "lead1", email_norm: "mario.rossi@esempio.it", created_at: "2026-11-10T09:00:00Z", booking_status: "pending", calendar_event_id: null, ...extra });
  const esito = (e: EventoCalendario, l: LeadPerAbbinamento[]) => abbinaEvento(e, l, cfg);

  atteso("evento DEMO: il titolo corrisponde; non lo è un'altra riunione; mai un tipo escluso", eventoDemo(ev(), cfg) && !eventoDemo(ev({ summary: "Riunione interna" }), cfg) && !eventoDemo(ev({ eventType: "outOfOffice" }), cfg) && !eventoDemo(ev({ summary: undefined }), cfg));
  atteso("chi ha prenotato: tolti organizzatore, calendario stesso, risorse, squadra e chi ha rifiutato; email normalizzate e senza doppioni", uguali(partecipantiEsterni(ev({ attendees: [{ email: "UFFICIO@omniaitalia.com" }, { email: "team@omniaitalia.com" }, { email: "sala@risorse.it", resource: true }, { email: "x@y.it", responseStatus: "declined" }, { email: "  Mario.Rossi@Esempio.IT " }, { email: "mario.rossi@esempio.it" }, { email: "boss@azienda.it" }], organizer: { email: "boss@azienda.it" } }), cfg), ["mario.rossi@esempio.it"]));

  atteso("chi è marcato come organizzatore o come il calendario stesso non è mai «chi ha prenotato», anche senza elenco di email interne", uguali(partecipantiEsterni(ev({ organizer: undefined, attendees: [{ email: "capo@x.it", organizer: true }, { email: "io@x.it", self: true }, { email: "cliente@x.it" }] }), configurazioneDaAmbiente({})), ["cliente@x.it"]));
  const a = esito(ev(), [lead()]);
  atteso("prenotazione e lead con la stessa email, nell'ordine giusto → abbinato", a.tipo === "abbinato" && a.lead.id === "lead1", JSON.stringify(a));
  atteso("l'email dell'evento si confronta normalizzata (maiuscole e spazi)", esito(ev({ attendees: [{ email: " MARIO.ROSSI@ESEMPIO.IT " }] }), [lead()]).tipo === "abbinato");
  atteso("una prenotazione di 5 minuti PRIMA del modulo (scarto di orologi) si abbina; di 11 minuti prima no", esito(ev({ created: "2026-11-10T08:55:00Z" }), [lead()]).tipo === "abbinato" && (() => { const r = esito(ev({ created: "2026-11-10T08:49:00Z" }), [lead()]); return r.tipo === "caso" && r.motivo === "fuori_finestra"; })());
  atteso("finestra di 30 giorni: il trentesimo giorno sì, il trentunesimo no", esito(ev({ created: "2026-12-10T09:00:00Z" }), [lead()]).tipo === "abbinato" && (() => { const r = esito(ev({ created: "2026-12-10T09:00:01Z" }), [lead()]); return r.tipo === "caso" && r.motivo === "fuori_finestra"; })());
  atteso("nessuna richiesta con quell'email → caso «nessun_lead» (niente conversione)", (() => { const r = esito(ev({ attendees: [{ email: "altro@esempio.it" }] }), [lead()]); return r.tipo === "caso" && r.motivo === "nessun_lead"; })());
  atteso("due richieste possibili per la stessa prenotazione → caso «piu_lead» (non si sceglie a caso)", (() => { const r = esito(ev(), [lead(), lead({ id: "lead2", booking_status: "cancelled" })]); return r.tipo === "caso" && r.motivo === "piu_lead"; })());
  atteso("la stessa persona ha già una demo confermata con un altro evento → «prenotazione_duplicata» (nessuna seconda conversione)", (() => { const r = esito(ev({ id: "evt2" }), [lead({ booking_status: "confirmed", calendar_event_id: "evt1" })]); return r.tipo === "caso" && r.motivo === "prenotazione_duplicata"; })());
  atteso("lo stesso evento già legato a un lead → «gia_abbinato» (solo modificato)", (() => { const r = esito(ev(), [lead({ booking_status: "confirmed", calendar_event_id: "evt1" })]); return r.tipo === "gia_abbinato"; })());
  atteso("evento cancellato → «cancellato»; riunione che non è una demo → «ignora»", esito(ev({ status: "cancelled" }), [lead()]).tipo === "cancellato" && esito(ev({ summary: "Riunione interna" }), [lead()]).tipo === "ignora");
  atteso("solo la squadra tra i partecipanti → caso «senza_partecipante»; email malformata → «email_non_valida»", (() => { const r1 = esito(ev({ attendees: [{ email: "ufficio@omniaitalia.com", organizer: true }] }), [lead()]); const r2 = esito(ev({ attendees: [{ email: "non-una-email" }] }), [lead()]); return r1.tipo === "caso" && r1.motivo === "senza_partecipante" && r2.tipo === "caso" && r2.motivo === "email_non_valida"; })());
  atteso("più partecipanti esterni: si abbina se UNO solo ha un lead", (() => { const r = esito(ev({ attendees: [{ email: "collega@esempio.it" }, { email: "mario.rossi@esempio.it" }] }), [lead()]); return r.tipo === "abbinato" && r.lead.id === "lead1"; })());
  atteso("evento senza data di creazione → caso (non si può controllare l'ordine)", (() => { const r = esito(ev({ created: undefined }), [lead()]); return r.tipo === "caso"; })());
  atteso("una richiesta annullata può essere ri-abbinata a una nuova prenotazione", esito(ev({ id: "evt9" }), [lead({ booking_status: "cancelled", calendar_event_id: "evt1" })]).tipo === "abbinato");
  const agg = aggiornamentoPerConferma(ev(), "cal-1");
  atteso("aggiornamento per conferma: stato, id evento, calendario, data di prenotazione e inizio in UTC", !!agg && agg.booking_status === "confirmed" && agg.calendar_event_id === "evt1" && agg.calendar_id === "cal-1" && agg.booked_at === "2026-11-10T09:30:00.000Z" && agg.booking_starts_at === "2026-11-12T09:00:00.000Z", JSON.stringify(agg));
  atteso("senza la data di creazione dell'evento non si può confermare", aggiornamentoPerConferma(ev({ created: undefined }), "cal-1") === null);

  // ═════════════════════════ 4. Conversioni: regole ═════════════════════════
  console.log("\n--- Conversioni: quando e cosa si invia ---");
  const base = (extra: Partial<LeadPerConversione> = {}): LeadPerConversione => ({
    id: "11111111-1111-4111-8111-111111111111", email: "Mario.Rossi+Demo@Gmail.com", booking_status: "confirmed", booked_at: "2026-11-10T09:30:00.000Z", created_at: "2026-11-10T09:00:00.000Z",
    sector: "Pulizie e sanificazione", gclid: "GCLID_abc12345", gbraid: null, wbraid: null, attribution_consent: true, ads_measurement_consent: true,
    ga_client_id: "1234567890.1700000000", ga_session_id: "1700000000", ga4_sent_at: null, ads_import_status: "ready", ads_attempts: 0, ...extra,
  });
  const T = (extra: Partial<Parameters<typeof statoAdsPerConferma>[0]>, soloEmail = false) => statoAdsPerConferma({ gclid: "GCLID_abc12345", gbraid: null, wbraid: null, attribution_consent: true, ads_measurement_consent: true, ...extra }, { consentiSoloEmail: soloEmail });
  atteso("stato Ads alla conferma: cookie accettati + identificativo di clic → ready (con o senza il consenso dell'email)", T({}) === "ready" && T({ ads_measurement_consent: false }) === "ready");
  atteso("senza nessun consenso → skipped_no_consent", T({ attribution_consent: false, ads_measurement_consent: false }) === "skipped_no_consent" && T({ attribution_consent: false }) === "skipped_no_consent");
  atteso("senza clic e senza nessun consenso → skipped_no_consent (il consenso viene prima dell'identificativo)", T({ gclid: null, attribution_consent: false, ads_measurement_consent: false }) === "skipped_no_consent" && T({ gclid: null, attribution_consent: false, ads_measurement_consent: false }, true) === "skipped_no_consent");
  atteso("senza identificativo di clic → skipped_no_identifier, salvo l'invio «solo email» abilitato E il consenso dell'email", T({ gclid: null }) === "skipped_no_identifier" && T({ gclid: null }, true) === "ready" && T({ gclid: null, ads_measurement_consent: false }, true) === "skipped_no_identifier");

  const cfgAds: ConfigurazioneAds = { idCliente: "1234567890", idAzioneConversione: "987654321", soloVerifica: true };
  const hashFinto = (t: string) => `H(${t})`;
  const r1 = costruisciRichiestaAds(base(), cfgAds, ADESSO, hashFinto, { consentiSoloEmail: false });
  atteso("richiesta Google Ads: destinazione, codifica HEX, consenso, evento WEB con data UTC, identificativo di transazione stabile, clic ed email cifrata normalizzata", r1.ok && uguali(r1.richiesta.destinations, [{ operatingAccount: { accountType: "GOOGLE_ADS", accountId: "1234567890" }, loginAccount: { accountType: "GOOGLE_ADS", accountId: "1234567890" }, productDestinationId: "987654321" }]) && r1.richiesta.encoding === "HEX" && uguali(r1.richiesta.consent, { adUserData: "CONSENT_GRANTED", adPersonalization: "CONSENT_GRANTED" }) && r1.richiesta.events.length === 1 && r1.richiesta.events[0].eventTimestamp === "2026-11-10T09:30:00.000Z" && r1.richiesta.events[0].eventSource === "WEB" && r1.richiesta.events[0].transactionId === `omnia-demo-${base().id}` && uguali(r1.richiesta.events[0].adIdentifiers, { gclid: "GCLID_abc12345" }) && uguali(r1.richiesta.events[0].userData, { userIdentifiers: [{ emailAddress: "H(mariorossi@gmail.com)" }] }) && r1.richiesta.validateOnly === true, JSON.stringify(r1));
  atteso("l'identificativo di transazione dipende solo dal lead (stesso lead = stesso identificativo, lead diversi = diversi)", idTransazioneAds("a") === idTransazioneAds("a") && idTransazioneAds("a") !== idTransazioneAds("b"));
  atteso("«solo verifica» disattivata → validateOnly falso; account gestore usato come account di accesso", (() => { const r = costruisciRichiestaAds(base(), { ...cfgAds, soloVerifica: false, idClienteGestore: "5555555555" }, ADESSO, hashFinto, { consentiSoloEmail: false }); return r.ok && r.richiesta.validateOnly === false && r.richiesta.destinations[0].loginAccount.accountId === "5555555555" && r.richiesta.destinations[0].operatingAccount.accountId === "1234567890"; })());
  atteso("identificativo di clic: gclid, poi gbraid, poi wbraid (uno solo per evento)", (() => { const e = (l: Partial<LeadPerConversione>) => { const r = costruisciRichiestaAds(base(l), cfgAds, ADESSO, hashFinto, { consentiSoloEmail: false }); return r.ok ? r.richiesta.events[0].adIdentifiers : null; }; return uguali(e({}), { gclid: "GCLID_abc12345" }) && uguali(e({ gclid: null, gbraid: "GBRAID_1234567" }), { gbraid: "GBRAID_1234567" }) && uguali(e({ gclid: null, wbraid: "WBRAID_1234567" }), { wbraid: "WBRAID_1234567" }) && uguali(e({ gbraid: "GBRAID_1234567", wbraid: "WBRAID_1234567" }), { gclid: "GCLID_abc12345" }); })());
  atteso("senza il consenso facoltativo dell'email: nessun dato dell'utente nella richiesta e personalizzazione negata", (() => { const r = costruisciRichiestaAds(base({ ads_measurement_consent: false }), cfgAds, ADESSO, hashFinto, { consentiSoloEmail: false }); return r.ok && r.richiesta.events[0].userData === undefined && r.richiesta.consent.adPersonalization === "CONSENT_DENIED" && r.richiesta.consent.adUserData === "CONSENT_GRANTED"; })());
  atteso("«solo email» (senza clic, cookie non accettati ma consenso del modulo): solo l'email cifrata, nessun identificativo di clic", (() => { const r = costruisciRichiestaAds(base({ gclid: null, attribution_consent: false }), cfgAds, ADESSO, hashFinto, { consentiSoloEmail: true }); return r.ok && r.richiesta.events[0].adIdentifiers === undefined && !!r.richiesta.events[0].userData && r.richiesta.consent.adPersonalization === "CONSENT_DENIED"; })());
  const nonOk = (l: Partial<LeadPerConversione>, soloEmail = false) => { const r = costruisciRichiestaAds(base(l), cfgAds, ADESSO, hashFinto, { consentiSoloEmail: soloEmail }); return r.ok ? "ok" : r.motivo; };
  atteso("mai una richiesta per: prenotazione non confermata, senza data, oltre 90 giorni, senza consenso, senza identificativo", nonOk({ booking_status: "pending" }) === "non_confermata" && nonOk({ booking_status: "cancelled" }) === "non_confermata" && nonOk({ booked_at: null }) === "senza_data" && nonOk({ booked_at: "2026-07-01T00:00:00.000Z" }) === "troppo_vecchia" && nonOk({ attribution_consent: false, ads_measurement_consent: false }) === "senza_consenso" && nonOk({ gclid: null }) === "senza_identificativo");
  atteso("una prenotazione «dal futuro» (orologi diversi) non produce un evento nel futuro", (() => { const r = costruisciRichiestaAds(base({ booked_at: "2026-11-10T10:05:00.000Z" }), cfgAds, ADESSO, hashFinto, { consentiSoloEmail: false }); return r.ok && r.richiesta.events[0].eventTimestamp === ADESSO_ISO; })());
  atteso("nella richiesta non compaiono nome, azienda, telefono né l'email in chiaro", (() => { const r = costruisciRichiestaAds(base(), cfgAds, ADESSO, sha256Hex, { consentiSoloEmail: false }); const testo = JSON.stringify(r); return r.ok && !/Mario|Rossi|Pulizie|3331234567|gmail/i.test(testo) && /[0-9a-f]{64}/.test(testo); })());
  atteso("SHA-256 esadecimale corretto (valore noto)", sha256Hex("abc") === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  atteso("configurazione Ads: account a 10 cifre senza trattini, azione numerica, modalità «solo verifica» esplicita", configurazioneAdsValida(cfgAds) && !configurazioneAdsValida({ ...cfgAds, idCliente: "123-456-7890" }) && !configurazioneAdsValida({ ...cfgAds, idCliente: "123456789" }) && !configurazioneAdsValida({ ...cfgAds, idAzioneConversione: "azione" }) && !configurazioneAdsValida({ ...cfgAds, idClienteGestore: "12" }) && !configurazioneAdsValida({ idCliente: "1234567890", idAzioneConversione: "987654321" }));
  atteso("configurazione Ads dall'ambiente: «solo verifica» è la modalità predefinita, si esce solo con DEMO_ADS_VALIDATE_ONLY=0", configurazioneAdsDaAmbiente({ GOOGLE_ADS_CUSTOMER_ID: "123-456-7890", GOOGLE_ADS_DEMO_CONVERSION_ACTION_ID: "987654321" })?.soloVerifica === true && configurazioneAdsDaAmbiente({ GOOGLE_ADS_CUSTOMER_ID: "1234567890", GOOGLE_ADS_DEMO_CONVERSION_ACTION_ID: "987654321", DEMO_ADS_VALIDATE_ONLY: "0" })?.soloVerifica === false && configurazioneAdsDaAmbiente({ GOOGLE_ADS_CUSTOMER_ID: "1234567890" }) === null);
  atteso("pause tra i tentativi: 10 min, 30 min, 2 h, 8 h, 24 h; dopo il sesto nessun altro", uguali([...PAUSE_TENTATIVI_MINUTI], [10, 30, 120, 480, 1440]) && TENTATIVI_MASSIMI === 6 && [1, 2, 3, 4, 5].every((n) => prossimoTentativo(n, ADESSO) === new Date(ADESSO + PAUSE_TENTATIVI_MINUTI[n - 1] * 60_000).toISOString()) && prossimoTentativo(6, ADESSO) === null && prossimoTentativo(0, ADESSO) === new Date(ADESSO + 600_000).toISOString());
  atteso("stato di una richiesta già inviata: SUCCESS = riuscita; PROCESSING = in corso; FAILED e PARTIAL_SUCCESS = errori; il resto = sconosciuta", interpretaStatoRichiesta({ requestStatusPerDestination: [{ requestStatus: "SUCCESS" }] }).esito === "riuscita" && interpretaStatoRichiesta({ requestStatusPerDestination: [{ requestStatus: "PROCESSING" }] }).esito === "in_corso" && interpretaStatoRichiesta({ requestStatusPerDestination: [{ requestStatus: "FAILED" }] }).esito === "fallita" && interpretaStatoRichiesta({ requestStatusPerDestination: [{ requestStatus: "PARTIAL_SUCCESS" }] }).esito === "parziale" && interpretaStatoRichiesta({}).esito === "sconosciuta" && interpretaStatoRichiesta(null).esito === "sconosciuta" && interpretaStatoRichiesta({ requestStatusPerDestination: [{ requestStatus: "REQUEST_STATUS_UNKNOWN" }] }).esito === "sconosciuta");
  atteso("più destinazioni: «riuscita» solo se TUTTE sono SUCCESS; basta una FAILED per «fallita»; una PROCESSING tra SUCCESS = «in corso»", interpretaStatoRichiesta({ requestStatusPerDestination: [{ requestStatus: "SUCCESS" }, { requestStatus: "SUCCESS" }] }).esito === "riuscita" && interpretaStatoRichiesta({ requestStatusPerDestination: [{ requestStatus: "SUCCESS" }, { requestStatus: "FAILED" }] }).esito === "fallita" && interpretaStatoRichiesta({ requestStatusPerDestination: [{ requestStatus: "SUCCESS" }, { requestStatus: "PROCESSING" }] }).esito === "in_corso");
  atteso("le ragioni d'errore sono solo codici in maiuscolo (un testo libero o un'email non entra)", (() => { const s = interpretaStatoRichiesta({ requestStatusPerDestination: [{ requestStatus: "FAILED", errorInfo: { errorCounts: [{ reason: "PROCESSING_ERROR_REASON_DUPLICATE_GCLID" }, { reason: "mario@esempio.it" }, { reason: "errore libero con spazi" }] } }] }); return uguali(s.ragioni, ["PROCESSING_ERROR_REASON_DUPLICATE_GCLID"]); })() && testoErroreSicuro(["OK_CODICE", "con@email.it", "x".repeat(100)]) === "OK_CODICE" && testoErroreSicuro(Array.from({ length: 50 }, (_, i) => `CODICE_${i}`)).length <= 300);

  const g = costruisciCorpoGa4(base(), ADESSO);
  atteso("evento GA4: nome, client_id, timestamp della prenotazione, consenso, sessione numerica, identificativo, settore", !!g && g.events[0].name === "demo_booking_confirmed" && g.client_id === "1234567890.1700000000" && g.timestamp_micros === Date.parse("2026-11-10T09:30:00.000Z") * 1000 && g.consent.ad_user_data === "GRANTED" && g.consent.ad_personalization === "GRANTED" && g.events[0].params.session_id === 1700000000 && g.events[0].params.transaction_id === `omnia-demo-${base().id}` && g.events[0].params.demo_sector === "Pulizie e sanificazione" && g.events[0].params.engagement_time_msec === 1, JSON.stringify(g));
  atteso("evento GA4: oltre le 72 ore dalla prenotazione si usa «adesso» (GA4 non accetta di più)", (() => { const b = costruisciCorpoGa4(base({ booked_at: "2026-11-05T09:30:00.000Z" }), ADESSO); return !!b && b.timestamp_micros === ADESSO * 1000; })());
  atteso("evento GA4: nessun dato personale né identificativo di clic nel corpo", !/Mario|Rossi|Pulizie Rossi|3331234567|gmail|GCLID/i.test(JSON.stringify(g)));
  atteso("evento GA4: mai se già inviato, senza consenso, senza client_id o se la prenotazione non è confermata; sessione non numerica omessa", costruisciCorpoGa4(base({ ga4_sent_at: "2026-11-10T09:40:00.000Z" }), ADESSO) === null && costruisciCorpoGa4(base({ attribution_consent: false }), ADESSO) === null && costruisciCorpoGa4(base({ ga_client_id: null }), ADESSO) === null && costruisciCorpoGa4(base({ booking_status: "pending" }), ADESSO) === null && costruisciCorpoGa4(base({ booking_status: "cancelled" }), ADESSO) === null && costruisciCorpoGa4(base({ ga_session_id: "abc" }), ADESSO)?.events[0].params.session_id === undefined);

  // ═════════════════════════ 5. Salvataggio del lead (database finto) ═════════════════════════
  console.log("\n--- Salvataggio del lead: stato pending, deduplicazione, limiti, consenso ---");
  const dati = (validaModuloDemo({ ...ok, adsConsenso: "on" }) as { ok: true; dati: Parameters<typeof registraLead>[1]["dati"] }).dati;
  const ingresso = (extra: Partial<Parameters<typeof registraLead>[1]> = {}): Parameters<typeof registraLead>[1] => ({ dati, attribuzione: { gclid: "GCLID_abc12345", utm_source: "google", utm_medium: "cpc" }, consensoCookie: true, gaClientId: "1234567890.1700000000", gaSessionId: "1700000000", landingPath: "/piani", ipHash: "iphash1", adesso: new Date(ADESSO), ...extra });

  const db1 = new FintoDatabase();
  const s1 = await registraLead(db1.comeClient(), ingresso());
  const l1 = db1.da("demo_leads")[0];
  atteso("un nuovo lead viene creato con stato «pending» e nessuna prenotazione, nessuna conversione", s1.esito === "creato" && db1.da("demo_leads").length === 1 && l1.booking_status === "pending" && l1.calendar_event_id === null && l1.booked_at === null && l1.ads_import_status === "not_ready" && l1.ga4_sent_at === null, JSON.stringify(s1));
  atteso("salva dati del modulo, consensi e versione dei consensi", l1.full_name === "Mario Rossi" && l1.company === "Pulizie Rossi Srl" && l1.email === "Mario.Rossi@Esempio.it" && l1.email_norm === "mario.rossi@esempio.it" && l1.phone === "+393331234567" && l1.sector === "Pulizie e sanificazione" && l1.privacy_version === VERSIONE_CONSENSI_DEMO && l1.privacy_accepted_at === ADESSO_ISO && l1.ads_measurement_consent === true && l1.ads_measurement_consent_at === ADESSO_ISO);
  atteso("con i cookie accettati salva identificativi di clic, utm, percorso e identificativi di Analytics", l1.gclid === "GCLID_abc12345" && l1.utm_source === "google" && l1.utm_medium === "cpc" && l1.landing_path === "/piani" && l1.ga_client_id === "1234567890.1700000000" && l1.ga_session_id === "1700000000" && l1.attribution_consent === true);
  atteso("l'indirizzo IP non si salva mai: solo l'hash", l1.ip_hash === "iphash1" && !Object.keys(l1).some((k) => k === "ip" || k === "ip_address") && hashIp("203.0.113.9", "segreto") === hashIp(" 203.0.113.9 ", "segreto") && hashIp("203.0.113.9", "segreto") !== hashIp("203.0.113.9", "altro") && /^[0-9a-f]{64}$/.test(hashIp("203.0.113.9", "s")) && !hashIp("203.0.113.9", "s").includes("203"));

  const db2 = new FintoDatabase();
  await registraLead(db2.comeClient(), ingresso({ consensoCookie: false }));
  const l2 = db2.da("demo_leads")[0];
  atteso("SENZA i cookie accettati nessuna attribuzione viene salvata (clic, utm, percorso, identificativi di Analytics)", l2.attribution_consent === false && l2.gclid === null && l2.gbraid === null && l2.wbraid === null && l2.utm_source === null && l2.utm_medium === null && l2.utm_campaign === null && l2.landing_path === null && l2.ga_client_id === null && l2.ga_session_id === null);

  const db3 = new FintoDatabase();
  await registraLead(db3.comeClient(), ingresso());
  const s3 = await registraLead(db3.comeClient(), ingresso({ dati: { ...dati, nome: "Mario Rossi Junior", email: "MARIO.ROSSI@esempio.IT" }, attribuzione: {}, adesso: new Date(ADESSO + 3600_000) }));
  const l3 = db3.da("demo_leads");
  atteso("deduplicazione: lo stesso indirizzo email (anche con maiuscole diverse) aggiorna la richiesta «pending» invece di crearne un'altra", s3.esito === "aggiornato" && l3.length === 1 && l3[0].full_name === "Mario Rossi Junior" && l3[0].created_at === new Date(ADESSO + 3600_000).toISOString(), JSON.stringify(s3));
  atteso("… e se il nuovo invio non ha attribuzione, quella raccolta prima non si perde", l3[0].gclid === "GCLID_abc12345" && l3[0].attribution_consent === true);
  const db3b = new FintoDatabase({ demo_leads: [riga({ booking_status: "confirmed", calendar_event_id: "evt1", booked_at: ADESSO_ISO })] });
  atteso("chi ha già prenotato può inviare una nuova richiesta (nuova riga, la prenotazione confermata non si tocca)", (await registraLead(db3b.comeClient(), ingresso())).esito === "creato" && db3b.da("demo_leads").length === 2 && db3b.da("demo_leads")[0].booking_status === "confirmed");

  const db4 = new FintoDatabase();
  db4.ora = () => ADESSO_ISO;
  let ultimo = await registraLead(db4.comeClient(), ingresso({ dati: { ...dati, email: "p0@esempio.it" } }));
  for (let i = 1; i < LIMITE_RICHIESTE_PER_IP_ORA; i++) ultimo = await registraLead(db4.comeClient(), ingresso({ dati: { ...dati, email: `p${i}@esempio.it` } }));
  const oltre = await registraLead(db4.comeClient(), ingresso({ dati: { ...dati, email: "extra@esempio.it" } }));
  atteso(`limite anti-abuso: dallo stesso indirizzo (hash) al massimo ${LIMITE_RICHIESTE_PER_IP_ORA} richieste all'ora; la successiva è respinta senza salvare`, ultimo.esito === "creato" && oltre.esito === "troppe_richieste" && db4.da("demo_leads").length === LIMITE_RICHIESTE_PER_IP_ORA);
  db4.ora = () => new Date(ADESSO + 3_700_000).toISOString();
  atteso("… e dopo un'ora si può di nuovo", (await registraLead(db4.comeClient(), ingresso({ dati: { ...dati, email: "extra@esempio.it" }, adesso: new Date(ADESSO + 3_700_000) }))).esito === "creato");
  atteso("senza hash dell'indirizzo il limite non si applica (resta la deduplicazione per email)", (await registraLead(new FintoDatabase().comeClient(), ingresso({ ipHash: null }))).esito === "creato");

  const dbMancante = new FintoDatabase();
  dbMancante.errori.demo_leads = { code: "42P01", message: "relation does not exist" };
  const logMancante = await conLog(() => registraLead(dbMancante.comeClient(), ingresso()));
  atteso("tabella non ancora creata (migrazione non eseguita): «non_salvato», senza errori e senza dati nei log", logMancante.valore.esito === "non_salvato" && !/esempio|Mario|GCLID/i.test(logMancante.log), logMancante.log);
  const dbGuasto = new FintoDatabase();
  dbGuasto.errori.demo_leads = { code: "XX000", message: "Mario.Rossi@Esempio.it boom" };
  const logGuasto = await conLog(() => registraLead(dbGuasto.comeClient(), ingresso()));
  atteso("database fuori uso: «non_salvato», e il log riporta solo il codice dell'errore (mai il messaggio, che potrebbe contenere dati)", logGuasto.valore.esito === "non_salvato" && /XX000/.test(logGuasto.log) && !/Mario|esempio|boom/i.test(logGuasto.log), logGuasto.log);

  // ═════════════════════════ 6. Sincronizzazione del calendario (database e fetch finti) ═════════════════════════
  console.log("\n--- Sincronizzazione del calendario ---");
  const envCal = { DEMO_CALENDAR_SYNC_ENABLED: "1", GOOGLE_OAUTH_CLIENT_ID: "client-id", GOOGLE_OAUTH_CLIENT_SECRET: "client-segreto", GOOGLE_CALENDAR_REFRESH_TOKEN: "rt-segreto", GOOGLE_CALENDAR_ID: "cal@group.calendar.google.com", DEMO_CALENDAR_TITLE_REGEX: "demo omnia", DEMO_CALENDAR_INTERNAL_EMAILS: "ufficio@omniaitalia.com" };
  const statoIniziale = () => ({ demo_sync_stato: [{ id: 1, sync_token: null, last_run_at: null, last_success_at: null, last_error: null }] });
  type Pagina = { items?: EventoCalendario[]; nextSyncToken?: string; nextPageToken?: string };
  function ambienteCalendario(pagine: (c: ChiamataFinta, n: number) => { status: number; json?: Pagina }) {
    let n = 0;
    return fetchFinto((c) => {
      if (c.url.startsWith("https://oauth2.googleapis.com/token")) return { status: 200, json: { access_token: "at-segreto", expires_in: 3600 } };
      if (c.url.includes("/calendar/v3/calendars/")) return pagine(c, n++);
      return { status: 404 };
    });
  }
  const chiamateCalendario = (cf: { chiamate: ChiamataFinta[] }) => cf.chiamate.filter((c) => c.url.includes("/calendar/v3/"));

  // 6a. spenta / senza credenziali / errori
  {
    const db = new FintoDatabase(statoIniziale());
    const cf = ambienteCalendario(() => ({ status: 200, json: { items: [] } }));
    const spenta = await sincronizzaCalendario(db.comeClient(), { ...envCal, DEMO_CALENDAR_SYNC_ENABLED: undefined }, ADESSO, cf.fetch);
    atteso("sincronizzazione SPENTA se DEMO_CALENDAR_SYNC_ENABLED non è «1»: nessuna chiamata di rete, nessuna lettura del database", !spenta.eseguita && spenta.motivo === "spenta" && cf.chiamate.length === 0 && db.operazioni.length === 0);
    const senza = await sincronizzaCalendario(db.comeClient(), { ...envCal, GOOGLE_CALENDAR_REFRESH_TOKEN: undefined }, ADESSO, cf.fetch);
    const senzaCal = await sincronizzaCalendario(db.comeClient(), { ...envCal, GOOGLE_CALENDAR_ID: undefined }, ADESSO, cf.fetch);
    atteso("accesa ma senza credenziali o senza calendario: non parte, nessuna chiamata di rete", senza.motivo === "credenziali_mancanti" && senzaCal.motivo === "credenziali_mancanti" && cf.chiamate.length === 0);
    const dbSenzaTabella = new FintoDatabase();
    dbSenzaTabella.errori.demo_sync_stato = { code: "42P01", message: "x" };
    atteso("migrazione non eseguita: «schema_assente», senza chiamate al calendario", (await sincronizzaCalendario(dbSenzaTabella.comeClient(), envCal, ADESSO, cf.fetch)).motivo === "schema_assente" && cf.chiamate.length === 0);
    const cfToken = fetchFinto((c) => (c.url.includes("oauth2") ? { status: 401 } : { status: 200, json: { items: [] } }));
    const dbT = new FintoDatabase(statoIniziale());
    const rt = await conLog(() => sincronizzaCalendario(dbT.comeClient(), envCal, ADESSO, cfToken.fetch));
    atteso("token non ottenuto: nessuna chiamata al calendario, errore registrato, nessun segreto nei log", rt.valore.motivo === "token_non_ottenuto" && cfToken.chiamate.every((c) => !c.url.includes("/calendar/")) && dbT.da("demo_sync_stato")[0].last_error === "token_non_ottenuto" && !SEGRETI.some((s) => rt.log.includes(s)), rt.log);
    const cfErr = ambienteCalendario(() => ({ status: 500 }));
    const dbE = new FintoDatabase({ demo_sync_stato: [{ id: 1, sync_token: "VECCHIO", last_run_at: null, last_success_at: null, last_error: null }] });
    const re = await sincronizzaCalendario(dbE.comeClient(), envCal, ADESSO, cfErr.fetch);
    atteso("errore del calendario: nessuna modifica, il token di sincronizzazione NON avanza", re.motivo === "errore_calendario" && dbE.da("demo_sync_stato")[0].sync_token === "VECCHIO" && dbE.da("demo_sync_stato")[0].last_error === "errore_calendario");
  }

  // 6b. conferma, idempotenza, token incrementale
  {
    const db = new FintoDatabase({ ...statoIniziale(), demo_leads: [riga({ id: "lead1" })] });
    const cf = ambienteCalendario((c) => ({ status: 200, json: { items: [ev()], nextSyncToken: c.url.includes("syncToken") ? "TOKEN2" : "TOKEN1" } }));
    const { valore: r1s, log } = await conLog(() => sincronizzaCalendario(db.comeClient(), envCal, ADESSO, cf.fetch));
    const l = db.da("demo_leads")[0];
    atteso("prenotazione confermata e abbinata: il lead passa a «confirmed» con id evento, calendario e data di prenotazione", r1s.eseguita && r1s.confermati === 1 && r1s.casi === 0 && r1s.errori === 0 && l.booking_status === "confirmed" && l.calendar_event_id === "evt1" && l.calendar_id === "cal@group.calendar.google.com" && l.booked_at === "2026-11-10T09:30:00.000Z" && l.booking_starts_at === "2026-11-12T09:00:00.000Z", JSON.stringify([r1s, l]));
    atteso("… e la conversione Google Ads diventa «ready» (cookie accettati + clic), pronta ma NON ancora inviata", l.ads_import_status === "ready" && l.ads_request_id === null && l.ads_sent_at === null && l.ads_attempts === 0);
    atteso("prima lettura: completa (timeMin), con eventi cancellati e ripetizioni espanse; legge il calendario in sola lettura con il token", (() => { const u = chiamateCalendario(cf)[0]; return !!u && u.url.includes("showDeleted=true") && u.url.includes("singleEvents=true") && u.url.includes("timeMin=") && !u.url.includes("syncToken") && u.intestazioni.authorization === "Bearer at-segreto" && u.metodo === "GET"; })());
    atteso("il token di sincronizzazione viene salvato, e nessun segreto o dato personale finisce nei log o nel risultato", db.da("demo_sync_stato")[0].sync_token === "TOKEN1" && db.da("demo_sync_stato")[0].last_error === null && !SEGRETI.some((s) => log.includes(s) || JSON.stringify(r1s).includes(s)), log);
    const r2s = await sincronizzaCalendario(db.comeClient(), envCal, ADESSO + 600_000, cf.fetch);
    const l2b = db.da("demo_leads")[0];
    atteso("seconda esecuzione: lettura incrementale (syncToken, senza timeMin) e rielaborare lo stesso evento NON cambia nulla (idempotente, nessuna seconda conferma)", r2s.confermati === 0 && r2s.casi === 0 && (() => { const u = chiamateCalendario(cf)[1]; return u.url.includes("syncToken=TOKEN1") && !u.url.includes("timeMin"); })() && l2b.booked_at === "2026-11-10T09:30:00.000Z" && db.da("demo_leads").length === 1 && db.da("demo_sync_stato")[0].sync_token === "TOKEN2");
  }

  // 6c. spostamento, cancellazione, riconferma
  {
    const db = new FintoDatabase({ ...statoIniziale(), demo_leads: [riga({ id: "lead1" })] });
    let evento = ev();
    const cf = ambienteCalendario(() => ({ status: 200, json: { items: [evento], nextSyncToken: "T" } }));
    await sincronizzaCalendario(db.comeClient(), envCal, ADESSO, cf.fetch);
    evento = ev({ start: { dateTime: "2026-11-13T15:00:00+01:00" }, updated: "2026-11-11T08:00:00Z" });
    const rm = await sincronizzaCalendario(db.comeClient(), envCal, ADESSO, cf.fetch);
    atteso("evento spostato: cambia solo l'orario della demo; la data di prenotazione e la conferma restano", rm.confermati === 0 && db.da("demo_leads")[0].booking_starts_at === "2026-11-13T14:00:00.000Z" && db.da("demo_leads")[0].booked_at === "2026-11-10T09:30:00.000Z" && db.da("demo_leads")[0].booking_status === "confirmed");
    evento = ev({ status: "cancelled" });
    const rc = await sincronizzaCalendario(db.comeClient(), envCal, ADESSO, cf.fetch);
    atteso("evento cancellato: il lead passa a «cancelled» e la conversione non partirà (skipped_cancelled)", rc.cancellati === 1 && db.da("demo_leads")[0].booking_status === "cancelled" && db.da("demo_leads")[0].ads_import_status === "skipped_cancelled" && db.da("demo_leads")[0].ads_next_attempt_at === null);
    const rc2 = await sincronizzaCalendario(db.comeClient(), envCal, ADESSO, cf.fetch);
    atteso("la cancellazione rivista non fa danni (idempotente)", rc2.cancellati === 0 && db.da("demo_leads")[0].booking_status === "cancelled");
    evento = ev({ status: "confirmed" });
    const rr = await sincronizzaCalendario(db.comeClient(), envCal, ADESSO, cf.fetch);
    atteso("lo stesso evento ripristinato: il lead torna «confirmed» e la conversione torna «ready»", rr.confermati === 1 && db.da("demo_leads")[0].booking_status === "confirmed" && db.da("demo_leads")[0].ads_import_status === "ready");
    // cancellazione DOPO l'invio della conversione: lo stato Ads non si tocca (non si può ritirare qui)
    const dbInv = new FintoDatabase({ ...statoIniziale(), demo_leads: [riga({ id: "lead1", booking_status: "confirmed", calendar_event_id: "evt1", booked_at: "2026-11-10T09:30:00.000Z", ads_import_status: "accepted" })] });
    await sincronizzaCalendario(dbInv.comeClient(), envCal, ADESSO, ambienteCalendario(() => ({ status: 200, json: { items: [ev({ status: "cancelled" })], nextSyncToken: "T" } })).fetch);
    atteso("cancellazione dopo una conversione già accettata: il lead è «cancelled» ma lo stato Ads «accepted» non viene riscritto", dbInv.da("demo_leads")[0].booking_status === "cancelled" && dbInv.da("demo_leads")[0].ads_import_status === "accepted");
  }

  // 6d. abbinamento incerto: verifica manuale, nessuna conversione
  {
    const db = new FintoDatabase({ ...statoIniziale(), demo_leads: [riga({ id: "lead1" })] });
    const cf = ambienteCalendario(() => ({ status: 200, json: { items: [ev({ id: "evtX", attendees: [{ email: "sconosciuto@altra.it" }] })], nextSyncToken: "T" } }));
    const { valore: rs, log } = await conLog(() => sincronizzaCalendario(db.comeClient(), envCal, ADESSO, cf.fetch));
    atteso("prenotazione senza lead corrispondente: registrata tra i casi da verificare, il lead resta «pending», nessuna conversione", rs.casi === 1 && rs.confermati === 0 && db.da("demo_leads")[0].booking_status === "pending" && db.da("demo_leads")[0].ads_import_status === "not_ready" && db.da("demo_calendar_casi").length === 1 && db.da("demo_calendar_casi")[0].motivo === "nessun_lead" && db.da("demo_calendar_casi")[0].risolto === false);
    atteso("… e il caso non compare nei log con l'email del partecipante", !/sconosciuto@altra\.it/.test(log) && !/altra\.it/.test(log), log);
    await sincronizzaCalendario(db.comeClient(), envCal, ADESSO, cf.fetch);
    atteso("riletto più volte, lo stesso evento resta UN solo caso (vincolo di unicità sull'evento)", db.da("demo_calendar_casi").length === 1);
    db.da("demo_calendar_casi")[0].risolto = true;
    await sincronizzaCalendario(db.comeClient(), envCal, ADESSO, cf.fetch);
    atteso("un caso già chiuso a mano non si riapre da solo", db.da("demo_calendar_casi")[0].risolto === true);
  }
  {
    const db = new FintoDatabase({ ...statoIniziale(), demo_leads: [riga({ id: "lead1", booking_status: "confirmed", calendar_event_id: "evt1", booked_at: "2026-11-10T09:30:00.000Z", ads_import_status: "ready" })] });
    const cf = ambienteCalendario(() => ({ status: 200, json: { items: [ev({ id: "evt2", created: "2026-11-10T09:45:00Z" })], nextSyncToken: "T" } }));
    const rd = await sincronizzaCalendario(db.comeClient(), envCal, ADESSO, cf.fetch);
    atteso("seconda prenotazione della stessa persona: caso «prenotazione_duplicata», nessuna seconda conversione e il lead non cambia", rd.casi === 1 && db.da("demo_calendar_casi")[0].motivo === "prenotazione_duplicata" && db.da("demo_leads")[0].calendar_event_id === "evt1" && db.da("demo_leads").length === 1);
  }
  {
    const db = new FintoDatabase({ ...statoIniziale(), demo_leads: [riga({ id: "lead1" })] });
    const cf = ambienteCalendario(() => ({ status: 200, json: { items: [ev({ id: "evtR", summary: "Riunione interna" })], nextSyncToken: "T" } }));
    const rr = await sincronizzaCalendario(db.comeClient(), envCal, ADESSO, cf.fetch);
    atteso("un evento che non è una demo (titolo diverso) si ignora del tutto: nessun caso, nessuna conferma", rr.confermati === 0 && rr.casi === 0 && db.da("demo_calendar_casi").length === 0 && db.da("demo_leads")[0].booking_status === "pending");
  }

  // 6e. token scaduto (410) e pagine
  {
    const db = new FintoDatabase({ demo_sync_stato: [{ id: 1, sync_token: "SCADUTO", last_run_at: null, last_success_at: null, last_error: null }], demo_leads: [riga({ id: "lead1" })] });
    const cf = ambienteCalendario((c) => (c.url.includes("syncToken=SCADUTO") ? { status: 410 } : { status: 200, json: { items: [ev()], nextSyncToken: "NUOVO" } }));
    const r410 = await sincronizzaCalendario(db.comeClient(), envCal, ADESSO, cf.fetch);
    atteso("token scaduto (410): si rifà una lettura completa e si salva il token nuovo", r410.letturaCompleta === true && r410.confermati === 1 && db.da("demo_sync_stato")[0].sync_token === "NUOVO" && chiamateCalendario(cf).length === 2 && chiamateCalendario(cf)[1].url.includes("timeMin") && !chiamateCalendario(cf)[1].url.includes("syncToken"));
    const dbP = new FintoDatabase({ ...statoIniziale(), demo_leads: [riga({ id: "lead1" })] });
    const cfP = ambienteCalendario((c, n) => (n === 0 ? { status: 200, json: { items: [ev({ id: "x1", summary: "Altro" })], nextPageToken: "P2" } } : { status: 200, json: { items: [ev()], nextSyncToken: "FINE" } }));
    const rp = await sincronizzaCalendario(dbP.comeClient(), envCal, ADESSO, cfP.fetch);
    atteso("più pagine di eventi: si leggono tutte (pageToken) e il token arriva dall'ultima", rp.eventiVisti === 2 && rp.confermati === 1 && chiamateCalendario(cfP)[1].url.includes("pageToken=P2") && dbP.da("demo_sync_stato")[0].sync_token === "FINE");
    const dbG = new FintoDatabase({ ...statoIniziale(), demo_leads: [riga({ id: "lead1" })] });
    const cfG = ambienteCalendario(() => ({ status: 200, json: { items: [ev()], nextSyncToken: "NUOVO2" } }));
    const rGuasto = (() => { dbG.errori.demo_leads = { code: "XX000", message: "guasto" }; return sincronizzaCalendario(dbG.comeClient(), envCal, ADESSO, cfG.fetch); })();
    const rg = await rGuasto;
    atteso("errore su un evento: segnalato, e il token NON avanza (la prossima esecuzione rilegge gli stessi eventi senza perdere nulla)", rg.errori === 1 && dbG.da("demo_sync_stato")[0].sync_token === null && dbG.da("demo_sync_stato")[0].last_error === "errori_su_eventi");
  }

  // ═════════════════════════ 7. GA4 lato server ═════════════════════════
  console.log("\n--- GA4 Measurement Protocol (demo_booking_confirmed) ---");
  const envGa = { DEMO_GA4_MP_ENABLED: "1", GA4_API_SECRET: "ga-segreto" };
  const confermato = (extra: Riga = {}) => riga({ booking_status: "confirmed", calendar_event_id: `evt-${randomUUID()}`, booked_at: "2026-11-10T09:30:00.000Z", ads_import_status: "ready", ...extra });
  {
    const dbOff = new FintoDatabase({ demo_leads: [confermato()] });
    const cfOff = fetchFinto(() => ({ status: 204 }));
    const spento = await inviaConversioniGa4(dbOff.comeClient(), { GA4_API_SECRET: "ga-segreto" }, ADESSO, cfOff.fetch);
    const senzaSegreto = await inviaConversioniGa4(dbOff.comeClient(), { DEMO_GA4_MP_ENABLED: "1" }, ADESSO, cfOff.fetch);
    atteso("GA4 lato server SPENTO senza DEMO_GA4_MP_ENABLED=1 o senza GA4_API_SECRET: nessuna chiamata", !spento.abilitato && !senzaSegreto.abilitato && cfOff.chiamate.length === 0);

    const db = new FintoDatabase({ demo_leads: [confermato({ id: "l-ok" }), confermato({ id: "l-pending", booking_status: "pending", calendar_event_id: null, booked_at: null }), confermato({ id: "l-noconsenso", attribution_consent: false }), confermato({ id: "l-nocid", ga_client_id: null }), confermato({ id: "l-gia", ga4_sent_at: "2026-11-10T09:40:00.000Z" }), confermato({ id: "l-canc", booking_status: "cancelled" })] });
    const cf = fetchFinto(() => ({ status: 204 }));
    const { valore: rg, log } = await conLog(() => inviaConversioniGa4(db.comeClient(), envGa, ADESSO, cf.fetch));
    const corpi = cf.chiamate.map((c) => JSON.parse(c.corpo ?? "{}") as { client_id: string; events: { name: string }[] });
    atteso("si invia UN evento solo, per la sola prenotazione confermata con consenso e client_id, non ancora inviata", rg.inviati === 1 && cf.chiamate.length === 1 && corpi[0].events[0].name === "demo_booking_confirmed", JSON.stringify([rg, cf.chiamate.length]));
    atteso("l'invio va all'endpoint di raccolta con ID di misurazione e segreto, in POST JSON; il segreto non finisce nei log", cf.chiamate[0].url.startsWith("https://www.google-analytics.com/mp/collect?measurement_id=G-W551SWPNE4&api_secret=ga-segreto") && cf.chiamate[0].metodo === "POST" && !log.includes("ga-segreto"), cf.chiamate[0].url);
    atteso("il lead viene segnato come inviato; gli altri no", db.da("demo_leads").find((r) => r.id === "l-ok")?.ga4_sent_at === ADESSO_ISO && db.da("demo_leads").filter((r) => r.ga4_sent_at === ADESSO_ISO).length === 1);
    const cf2 = fetchFinto(() => ({ status: 204 }));
    const rg2 = await inviaConversioniGa4(db.comeClient(), envGa, ADESSO + 600_000, cf2.fetch);
    atteso("nessun invio ripetuto: la volta dopo non parte niente (GA4 non deduplica, lo si manda una volta sola)", rg2.inviati === 0 && cf2.chiamate.length === 0);

    const dbDbg = new FintoDatabase({ demo_leads: [confermato({ id: "l-dbg" })] });
    const cfDbg = fetchFinto(() => ({ status: 200, json: { validationMessages: [] } }));
    const rd = await inviaConversioniGa4(dbDbg.comeClient(), { ...envGa, DEMO_GA4_MP_DEBUG: "1" }, ADESSO, cfDbg.fetch);
    atteso("modalità di verifica (DEMO_GA4_MP_DEBUG=1): usa il server di validazione e NON segna l'evento come inviato", rd.verificati === 1 && rd.inviati === 0 && cfDbg.chiamate[0].url.includes("/debug/mp/collect") && dbDbg.da("demo_leads")[0].ga4_sent_at === null);
    const cfDbgKo = fetchFinto(() => ({ status: 200, json: { validationMessages: [{ fieldPath: "x", description: "boh" }] } }));
    atteso("… e se il server di validazione segnala errori, si conta l'errore", (await inviaConversioniGa4(dbDbg.comeClient(), { ...envGa, DEMO_GA4_MP_DEBUG: "1" }, ADESSO, cfDbgKo.fetch)).errori === 1);

    const dbKo = new FintoDatabase({ demo_leads: [confermato({ id: "l-ko" })] });
    const cfKo = fetchFinto(() => ({ status: 500 }));
    for (let i = 0; i < 7; i++) await inviaConversioniGa4(dbKo.comeClient(), envGa, ADESSO + i * 600_000, cfKo.fetch);
    atteso("invii falliti: dopo 5 tentativi non si riprova più (e non risulta mai inviato)", cfKo.chiamate.length === 5 && dbKo.da("demo_leads")[0].ga4_attempts === 5 && dbKo.da("demo_leads")[0].ga4_sent_at === null, String(cfKo.chiamate.length));
    const cfRete = (() => { const x = fetchFinto(() => ({ status: 204 })); return { ...x, fetch: (async () => { throw new Error("rete"); }) as unknown as typeof fetch }; })();
    const dbRete = new FintoDatabase({ demo_leads: [confermato({ id: "l-rete" })] });
    const rr = await inviaConversioniGa4(dbRete.comeClient(), envGa, ADESSO, cfRete.fetch);
    atteso("errore di rete: conta come tentativo fallito, nessuna eccezione", rr.errori === 1 && dbRete.da("demo_leads")[0].ga4_attempts === 1);
  }

  // ═════════════════════════ 8. Google Ads (Data Manager API) ═════════════════════════
  console.log("\n--- Google Ads: conversione «OMNIA AI - DEMO prenotata» ---");
  const envAds = { DEMO_ADS_IMPORT_ENABLED: "1", GOOGLE_ADS_CUSTOMER_ID: "1234567890", GOOGLE_ADS_DEMO_CONVERSION_ACTION_ID: "987654321", GOOGLE_OAUTH_CLIENT_ID: "client-id", GOOGLE_OAUTH_CLIENT_SECRET: "client-segreto", GOOGLE_ADS_REFRESH_TOKEN: "ads-rt" };
  type RotteAds = { ingest?: (corpo: Record<string, unknown>, n: number) => { status: number; json?: unknown }; stato?: (id: string) => { status: number; json?: unknown } };
  function ambienteAds(rotte: RotteAds) {
    let n = 0;
    return fetchFinto((c) => {
      if (c.url.startsWith("https://oauth2.googleapis.com/token")) return { status: 200, json: { access_token: "at-segreto" } };
      if (c.url === "https://datamanager.googleapis.com/v1/events:ingest") return (rotte.ingest ?? (() => ({ status: 200, json: { requestId: `req-${n}` } })))(JSON.parse(c.corpo ?? "{}"), n++);
      if (c.url.startsWith("https://datamanager.googleapis.com/v1/requestStatus:retrieve")) return (rotte.stato ?? (() => ({ status: 200, json: { requestStatusPerDestination: [{ requestStatus: "SUCCESS" }] } })))(new URL(c.url).searchParams.get("requestId") ?? "");
      return { status: 404 };
    });
  }
  const ingerimenti = (cf: { chiamate: ChiamataFinta[] }) => cf.chiamate.filter((c) => c.url.endsWith("events:ingest"));
  const stati = (cf: { chiamate: ChiamataFinta[] }) => cf.chiamate.filter((c) => c.url.includes("requestStatus:retrieve"));
  const pronto = (extra: Riga = {}) => confermato({ ads_import_status: "ready", ...extra });

  {
    const dbOff = new FintoDatabase({ demo_leads: [pronto()] });
    const cfOff = ambienteAds({});
    const a0 = await inviaConversioniAds(dbOff.comeClient(), { ...envAds, DEMO_ADS_IMPORT_ENABLED: undefined }, ADESSO, cfOff.fetch);
    const a1b = await inviaConversioniAds(dbOff.comeClient(), { ...envAds, GOOGLE_ADS_DEMO_CONVERSION_ACTION_ID: undefined }, ADESSO, cfOff.fetch);
    const a2 = await inviaConversioniAds(dbOff.comeClient(), { ...envAds, GOOGLE_ADS_REFRESH_TOKEN: undefined }, ADESSO, cfOff.fetch);
    atteso("integrazione Ads SPENTA senza DEMO_ADS_IMPORT_ENABLED=1; configurazione incompleta (azione o credenziali mancanti) → non parte: nessuna chiamata di rete", !a0.abilitato && a0.motivo === "spento" && a1b.motivo === "configurazione_incompleta" && a2.motivo === "configurazione_incompleta" && cfOff.chiamate.length === 0 && dbOff.da("demo_leads")[0].ads_import_status === "ready");

    // solo verifica (predefinita)
    const db = new FintoDatabase({ demo_leads: [pronto({ id: "l1" })] });
    const cf = ambienteAds({});
    const { valore: rv, log } = await conLog(() => inviaConversioniAds(db.comeClient(), envAds, ADESSO, cf.fetch));
    const corpo = JSON.parse(ingerimenti(cf)[0]?.corpo ?? "{}") as { validateOnly: boolean; encoding: string; events: { transactionId: string; adIdentifiers?: { gclid?: string }; userData?: { userIdentifiers: { emailAddress: string }[] } }[]; destinations: { productDestinationId: string }[] };
    atteso("modalità predefinita «SOLO VERIFICA»: la richiesta ha validateOnly=true, non si registra nessuna conversione", rv.modalita === "solo_verifica" && rv.verificati === 1 && rv.inviati === 0 && corpo.validateOnly === true && stati(cf).length === 0, JSON.stringify(rv));
    atteso("… il lead passa a «validated» (non a «sent»/«accepted»): non risulta acquisito", db.da("demo_leads")[0].ads_import_status === "validated" && db.da("demo_leads")[0].ads_request_id === null && db.da("demo_leads")[0].ads_sent_at === null);
    atteso("la richiesta usa l'azione di conversione, il clic, l'identificativo di transazione stabile e l'email in SHA-256 (mai in chiaro)", corpo.destinations[0].productDestinationId === "987654321" && corpo.events[0].adIdentifiers?.gclid === "GCLID_abc12345" && corpo.events[0].transactionId === "omnia-demo-l1" && corpo.encoding === "HEX" && /^[0-9a-f]{64}$/.test(corpo.events[0].userData?.userIdentifiers[0].emailAddress ?? "") && !/mario\.rossi/i.test(ingerimenti(cf)[0].corpo ?? ""));
    atteso("la chiamata è un POST autenticato con il token e nei log non compaiono token, email o identificativi di clic", ingerimenti(cf)[0].metodo === "POST" && ingerimenti(cf)[0].intestazioni.authorization === "Bearer at-segreto" && !SEGRETI.some((s) => log.includes(s) || JSON.stringify(rv).includes(s)), log);
    const cf2 = ambienteAds({});
    await inviaConversioniAds(db.comeClient(), envAds, ADESSO + 600_000, cf2.fetch);
    atteso("in «solo verifica» un lead già verificato non si rimanda a ogni esecuzione", ingerimenti(cf2).length === 0);

    // modalità reale
    const envReale = { ...envAds, DEMO_ADS_VALIDATE_ONLY: "0" };
    const cf3 = ambienteAds({ ingest: () => ({ status: 200, json: { requestId: "req-reale-1" } }) });
    const r3 = await inviaConversioniAds(db.comeClient(), envReale, ADESSO + 700_000, cf3.fetch);
    const l3 = db.da("demo_leads")[0];
    atteso("modalità reale: i lead già verificati vengono inviati davvero (validateOnly=false) e segnati «sent» con l'id della richiesta, NON ancora «accepted»", r3.modalita === "reale" && r3.inviati === 1 && JSON.parse(ingerimenti(cf3)[0].corpo ?? "{}").validateOnly === false && l3.ads_import_status === "sent" && l3.ads_request_id === "req-reale-1" && l3.ads_attempts === 1 && l3.ads_sent_at === new Date(ADESSO + 700_000).toISOString(), JSON.stringify([r3, l3]));
    const cf4 = ambienteAds({});
    await inviaConversioniAds(db.comeClient(), envReale, ADESSO + 700_000 + 30_000, cf4.fetch);
    atteso("una conversione appena inviata non si ricontrolla subito (attesa di un minuto) e non si rimanda", stati(cf4).length === 0 && ingerimenti(cf4).length === 0 && db.da("demo_leads")[0].ads_import_status === "sent");
    const cf5 = ambienteAds({ stato: (id) => ({ status: 200, json: { requestStatusPerDestination: [{ requestStatus: "SUCCESS" }], idRichiesta: id } }) });
    const r5 = await inviaConversioniAds(db.comeClient(), envReale, ADESSO + 700_000 + 120_000, cf5.fetch);
    atteso("dopo un minuto si legge lo stato: SUCCESS → «accepted» (solo ora la conversione è acquisita)", r5.accettati === 1 && db.da("demo_leads")[0].ads_import_status === "accepted" && stati(cf5)[0].url.includes("requestId=req-reale-1") && stati(cf5)[0].metodo === "GET");
    const cf6 = ambienteAds({});
    await inviaConversioniAds(db.comeClient(), envReale, ADESSO + 5_000_000, cf6.fetch);
    atteso("una conversione «accepted» non si rimanda MAI e non si ricontrolla (nessun doppione)", ingerimenti(cf6).length === 0 && stati(cf6).length === 0);
  }
  {
    const envReale = { ...envAds, DEMO_ADS_VALIDATE_ONLY: "0" };
    // elaborazione fallita / in corso / troppo lunga
    const dbF = new FintoDatabase({ demo_leads: [pronto({ id: "lf" })] });
    const cfF = ambienteAds({ stato: () => ({ status: 200, json: { requestStatusPerDestination: [{ requestStatus: "FAILED", errorInfo: { errorCounts: [{ reason: "PROCESSING_ERROR_REASON_DUPLICATE_GCLID", recordCount: "1" }] } }] } }) });
    await inviaConversioniAds(dbF.comeClient(), envReale, ADESSO, cfF.fetch);
    await inviaConversioniAds(dbF.comeClient(), envReale, ADESSO + 120_000, cfF.fetch);
    const lf = dbF.da("demo_leads")[0];
    atteso("elaborazione FAILED: il lead diventa «failed» con il codice dell'errore, senza riprovare da solo (serve una persona)", lf.ads_import_status === "failed" && /DUPLICATE_GCLID/.test(String(lf.ads_last_error)) && lf.ads_next_attempt_at === null, JSON.stringify(lf));
    const cfF2 = ambienteAds({});
    await inviaConversioniAds(dbF.comeClient(), envReale, ADESSO + 90_000_000, cfF2.fetch);
    atteso("… e un «failed» senza data di nuovo tentativo non viene rimandato in automatico", ingerimenti(cfF2).length === 0);

    const dbP = new FintoDatabase({ demo_leads: [pronto({ id: "lp" })] });
    const cfP = ambienteAds({ stato: () => ({ status: 200, json: { requestStatusPerDestination: [{ requestStatus: "PROCESSING" }] } }) });
    await inviaConversioniAds(dbP.comeClient(), envReale, ADESSO, cfP.fetch);
    const rp = await inviaConversioniAds(dbP.comeClient(), envReale, ADESSO + 120_000, cfP.fetch);
    atteso("elaborazione ancora in corso (PROCESSING): resta «sent», NON è considerata acquisita", rp.inElaborazione === 1 && dbP.da("demo_leads")[0].ads_import_status === "sent");
    const rp2 = await inviaConversioniAds(dbP.comeClient(), envReale, ADESSO + 49 * 3_600_000, cfP.fetch);
    atteso("oltre 48 ore ancora «in corso»: passa a «failed» (TIMEOUT_ELABORAZIONE) per la verifica manuale", rp2.falliti === 1 && dbP.da("demo_leads")[0].ads_import_status === "failed" && dbP.da("demo_leads")[0].ads_last_error === "TIMEOUT_ELABORAZIONE");

    // errori di rete / Google con nuovi tentativi
    const dbE = new FintoDatabase({ demo_leads: [pronto({ id: "le" })] });
    let modo: "ko" | "ok" = "ko";
    const cfE = ambienteAds({ ingest: () => (modo === "ko" ? { status: 500, json: { error: { status: "INTERNAL", message: "Mario.Rossi@esempio.it dettaglio" } } } : { status: 200, json: { requestId: "req-ok" } }) });
    const { log: logE } = await conLog(() => inviaConversioniAds(dbE.comeClient(), envReale, ADESSO, cfE.fetch));
    const le = dbE.da("demo_leads")[0];
    atteso("errore di Google: «failed», un tentativo contato, prossimo tentativo tra 10 minuti, e dell'errore resta solo il codice (mai il messaggio)", le.ads_import_status === "failed" && le.ads_attempts === 1 && le.ads_next_attempt_at === new Date(ADESSO + 600_000).toISOString() && le.ads_last_error === "HTTP_500 INTERNAL" && !/Mario|esempio|dettaglio/i.test(`${le.ads_last_error}${logE}`), JSON.stringify(le));
    const cfE2 = ambienteAds({ ingest: () => ({ status: 500 }) });
    await inviaConversioniAds(dbE.comeClient(), envReale, ADESSO + 300_000, cfE2.fetch);
    atteso("prima della pausa non si riprova", ingerimenti(cfE2).length === 0 && dbE.da("demo_leads")[0].ads_attempts === 1);
    modo = "ok";
    const cfE3 = ambienteAds({ ingest: () => ({ status: 200, json: { requestId: "req-ok" } }) });
    await inviaConversioniAds(dbE.comeClient(), envReale, ADESSO + 650_000, cfE3.fetch);
    atteso("dopo la pausa si riprova e, se va bene, diventa «sent» (secondo tentativo)", dbE.da("demo_leads")[0].ads_import_status === "sent" && dbE.da("demo_leads")[0].ads_attempts === 2 && dbE.da("demo_leads")[0].ads_last_error === null && dbE.da("demo_leads")[0].ads_next_attempt_at === null);

    const dbM = new FintoDatabase({ demo_leads: [pronto({ id: "lm" })] });
    const cfM = ambienteAds({ ingest: () => ({ status: 503 }) });
    for (let i = 0; i < 9; i++) await inviaConversioniAds(dbM.comeClient(), envReale, ADESSO + i * 100_000_000, cfM.fetch);
    atteso("dopo 6 tentativi falliti non si riprova più e il lead resta «failed»", ingerimenti(cfM).length === TENTATIVI_MASSIMI && dbM.da("demo_leads")[0].ads_import_status === "failed" && dbM.da("demo_leads")[0].ads_attempts === TENTATIVI_MASSIMI && dbM.da("demo_leads")[0].ads_next_attempt_at === null, String(ingerimenti(cfM).length));
    const cfRete = (() => { const x = ambienteAds({}); return { ...x, fetch: (async (u: RequestInfo | URL, i?: RequestInit) => { if (String(u).includes("events:ingest")) throw new Error("rete"); return x.fetch(u, i); }) as typeof fetch }; })();
    const dbR = new FintoDatabase({ demo_leads: [pronto({ id: "lr" })] });
    await inviaConversioniAds(dbR.comeClient(), envReale, ADESSO, cfRete.fetch);
    atteso("errore di rete: «failed» con codice «RETE» e nuovo tentativo programmato, nessuna eccezione", dbR.da("demo_leads")[0].ads_import_status === "failed" && dbR.da("demo_leads")[0].ads_last_error === "RETE" && dbR.da("demo_leads")[0].ads_next_attempt_at !== null);
    const dbSenzaId = new FintoDatabase({ demo_leads: [pronto({ id: "ls" })] });
    await inviaConversioniAds(dbSenzaId.comeClient(), envReale, ADESSO, ambienteAds({ ingest: () => ({ status: 200, json: {} }) }).fetch);
    atteso("risposta senza identificativo di richiesta: «failed» (non si potrebbe verificare), senza riprovare", dbSenzaId.da("demo_leads")[0].ads_import_status === "failed" && dbSenzaId.da("demo_leads")[0].ads_last_error === "RISPOSTA_SENZA_ID_RICHIESTA" && dbSenzaId.da("demo_leads")[0].ads_next_attempt_at === null);

    // chi NON deve mai partire
    const dbN = new FintoDatabase({
      demo_leads: [
        pronto({ id: "n-pending", booking_status: "pending", calendar_event_id: null, booked_at: null }),
        pronto({ id: "n-cancellato", booking_status: "cancelled" }),
        pronto({ id: "n-noconsenso", attribution_consent: false, ads_measurement_consent: false }),
        pronto({ id: "n-noclic", gclid: null }),
        pronto({ id: "n-vecchio", booked_at: "2026-06-01T00:00:00.000Z" }),
        pronto({ id: "n-sent", ads_import_status: "sent", ads_request_id: "req-1", ads_sent_at: ADESSO_ISO }),
        pronto({ id: "n-accepted", ads_import_status: "accepted" }),
        pronto({ id: "n-scartato", ads_import_status: "skipped_no_consent" }),
      ],
    });
    const cfN = ambienteAds({ stato: () => ({ status: 200, json: { requestStatusPerDestination: [{ requestStatus: "PROCESSING" }] } }) });
    await inviaConversioniAds(dbN.comeClient(), envReale, ADESSO + 120_000, cfN.fetch);
    const inviatiId = ingerimenti(cfN).map((c) => (JSON.parse(c.corpo ?? "{}") as { events: { transactionId: string }[] }).events[0].transactionId);
    atteso("non parte MAI la conversione di: prenotazione non confermata, cancellata, senza consenso, senza clic, oltre 90 giorni, già inviata, già accettata", inviatiId.length === 0, inviatiId.join(","));
    const stN = (id: string) => dbN.da("demo_leads").find((r) => r.id === id)?.ads_import_status;
    atteso("… e gli stati lo dicono: senza consenso «skipped_no_consent», senza clic «skipped_no_identifier», troppo vecchia «failed» (ETA_OLTRE_90_GIORNI)", stN("n-noconsenso") === "skipped_no_consent" && stN("n-noclic") === "skipped_no_identifier" && stN("n-vecchio") === "failed" && dbN.da("demo_leads").find((r) => r.id === "n-vecchio")?.ads_last_error === "ETA_OLTRE_90_GIORNI" && stN("n-pending") === "ready");

    // consenso solo cookie, senza email
    const dbC = new FintoDatabase({ demo_leads: [pronto({ id: "lc", ads_measurement_consent: false })] });
    const cfC = ambienteAds({});
    await inviaConversioniAds(dbC.comeClient(), envReale, ADESSO, cfC.fetch);
    const corpoC = JSON.parse(ingerimenti(cfC)[0]?.corpo ?? "{}") as { events: { userData?: unknown; adIdentifiers?: unknown }[] };
    atteso("senza il consenso facoltativo dell'email: parte solo il clic, MAI l'email (nemmeno cifrata)", ingerimenti(cfC).length === 1 && corpoC.events[0].userData === undefined && !!corpoC.events[0].adIdentifiers && !/[0-9a-f]{64}/.test(ingerimenti(cfC)[0].corpo ?? ""));
    // solo email
    const dbS = new FintoDatabase({ demo_leads: [pronto({ id: "ls2", gclid: null, ads_import_status: "ready" })] });
    const cfS = ambienteAds({});
    await inviaConversioniAds(dbS.comeClient(), envReale, ADESSO, cfS.fetch);
    atteso("senza identificativo di clic l'invio «solo email» è spento di default (nessuna chiamata) e si accende solo con DEMO_ADS_ALLOW_EMAIL_ONLY=1", ingerimenti(cfS).length === 0 && dbS.da("demo_leads")[0].ads_import_status === "skipped_no_identifier");
    const dbS2 = new FintoDatabase({ demo_leads: [pronto({ id: "ls3", gclid: null, ads_import_status: "ready" })] });
    const cfS2 = ambienteAds({});
    await inviaConversioniAds(dbS2.comeClient(), { ...envReale, DEMO_ADS_ALLOW_EMAIL_ONLY: "1" }, ADESSO, cfS2.fetch);
    atteso("… con il flag acceso e il consenso dell'email, parte solo l'email cifrata", ingerimenti(cfS2).length === 1 && JSON.parse(ingerimenti(cfS2)[0].corpo ?? "{}").events[0].adIdentifiers === undefined && !!JSON.parse(ingerimenti(cfS2)[0].corpo ?? "{}").events[0].userData);
    // deduplicazione: stesso lead due volte in sequenza
    const dbD = new FintoDatabase({ demo_leads: [pronto({ id: "ld" })] });
    const cfD = ambienteAds({});
    await inviaConversioniAds(dbD.comeClient(), envReale, ADESSO, cfD.fetch);
    await inviaConversioniAds(dbD.comeClient(), envReale, ADESSO + 1000, cfD.fetch);
    await inviaConversioniAds(dbD.comeClient(), envReale, ADESSO + 2000, cfD.fetch);
    atteso("deduplicazione: lo stesso lead eseguito tre volte di fila genera UNA sola richiesta", ingerimenti(cfD).length === 1);
    // sola lettura del calendario: nessuna lettura quando le tabelle mancano
    const dbSchema = new FintoDatabase();
    dbSchema.errori.demo_leads = { code: "42P01", message: "x" };
    atteso("migrazione non eseguita: «schema_assente», nessun invio", (await inviaConversioniAds(dbSchema.comeClient(), envReale, ADESSO, ambienteAds({}).fetch)).motivo === "schema_assente");
  }

  // ═════════════════════════ 9. Conservazione e cancellazione ═════════════════════════
  console.log("\n--- Conservazione e cancellazione dei dati ---");
  const lim = limitiConservazione(new Date("2026-11-10T00:00:00.000Z"));
  atteso("date di taglio: 90 giorni per i «pending», 24 mesi per i lead, 12 mesi per i casi aperti, 6 per quelli risolti", lim.pendingPrimaDi === "2026-08-12T00:00:00.000Z" && lim.leadPrimaDi === "2024-11-10T00:00:00.000Z" && lim.casiApertiPrimaDi === "2025-11-10T00:00:00.000Z" && lim.casiRisoltiPrimaDi === "2026-05-10T00:00:00.000Z", JSON.stringify(lim));
  {
    const db = new FintoDatabase({
      demo_leads: [
        riga({ id: "p-vecchio", created_at: "2026-08-01T00:00:00.000Z" }),
        riga({ id: "p-recente", email_norm: "b@esempio.it", created_at: "2026-11-01T00:00:00.000Z" }),
        riga({ id: "c-vecchio", booking_status: "confirmed", calendar_event_id: "e1", booked_at: "2024-10-01T00:00:00.000Z", created_at: "2024-10-01T00:00:00.000Z" }),
        riga({ id: "c-recente", booking_status: "confirmed", calendar_event_id: "e2", booked_at: "2025-11-01T00:00:00.000Z", created_at: "2025-11-01T00:00:00.000Z" }),
        riga({ id: "x-vecchio", booking_status: "cancelled", calendar_event_id: "e3", created_at: "2024-01-01T00:00:00.000Z" }),
      ],
      demo_calendar_casi: [
        { calendar_event_id: "k1", risolto: false, created_at: "2025-10-01T00:00:00.000Z" },
        { calendar_event_id: "k2", risolto: false, created_at: "2026-10-01T00:00:00.000Z" },
        { calendar_event_id: "k3", risolto: true, created_at: "2026-04-01T00:00:00.000Z" },
        { calendar_event_id: "k4", risolto: true, created_at: "2026-09-01T00:00:00.000Z" },
      ],
    });
    const p = await eliminaDatiScaduti(db.comeClient(), new Date("2026-11-10T00:00:00.000Z"));
    const rimasti = db.da("demo_leads").map((r) => r.id).sort();
    atteso("conservazione: si cancellano i «pending» oltre 90 giorni, i lead oltre 24 mesi e i casi oltre i limiti; il resto resta", uguali(rimasti, ["c-recente", "p-recente"]) && p.lead === 3 && p.casiAperti === 1 && p.casiRisolti === 1 && uguali(db.da("demo_calendar_casi").map((r) => r.calendar_event_id).sort(), ["k2", "k4"]) && !p.errore, JSON.stringify([p, rimasti]));
    const dbMancante = new FintoDatabase();
    dbMancante.errori.demo_leads = { code: "42P01", message: "x" };
    dbMancante.errori.demo_calendar_casi = { code: "42P01", message: "x" };
    atteso("tabelle non create: la conservazione non dà errore", (await eliminaDatiScaduti(dbMancante.comeClient(), new Date(ADESSO))).errore === false);
  }
  atteso("route cron: autorizzate solo con «Bearer <CRON_SECRET>» e solo se il segreto è impostato", cronAutorizzato("Bearer abc", "abc") && cronAutorizzato("Bearer abc", " abc ") && !cronAutorizzato(null, "abc") && !cronAutorizzato("Bearer sbagliato", "abc") && !cronAutorizzato("Bearer undefined", undefined) && !cronAutorizzato("Bearer ", "") && !cronAutorizzato("Bearer ", undefined) && !cronAutorizzato("abc", "abc"));

  // ═════════════════════════ 10. Controlli sul codice ═════════════════════════
  console.log("\n--- Codice: migrazione, azione, modulo, cron ---");
  const mig = leggi("supabase/migrations/0098_demo_leads.sql");
  const migSenzaCommenti = mig.replace(/--.*$/gm, "");
  atteso("migrazione 0098: le tre tabelle, con RLS attiva e NESSUNA policy (nessun accesso dal browser)", ["demo_leads", "demo_calendar_casi", "demo_sync_stato"].every((t) => new RegExp(`alter table public\\.${t} enable row level security`).test(migSenzaCommenti)) && !/create policy/i.test(migSenzaCommenti));
  atteso("migrazione 0098: permessi tolti a anon e authenticated, dati solo a service_role", ["demo_leads", "demo_calendar_casi", "demo_sync_stato"].every((t) => new RegExp(`revoke all on public\\.${t} from anon, authenticated`).test(migSenzaCommenti) && new RegExp(`grant select, insert, update, delete on public\\.${t} to service_role`).test(migSenzaCommenti)) && !/grant [^;]*to (anon|authenticated|public)/i.test(migSenzaCommenti));
  atteso("migrazione 0098: un evento del calendario appartiene a un solo lead; una sola richiesta «pending» per email; un solo caso per evento", /create unique index if not exists demo_leads_calendar_event_uidx\s+on public\.demo_leads \(calendar_event_id\) where calendar_event_id is not null/.test(migSenzaCommenti) && /create unique index if not exists demo_leads_pending_email_uidx\s+on public\.demo_leads \(email_norm\) where booking_status = 'pending'/.test(migSenzaCommenti) && /constraint demo_calendar_casi_evento_uni unique \(calendar_event_id\)/.test(migSenzaCommenti));
  atteso("migrazione 0098: stati ammessi, un «confirmed» ha sempre evento e data, lunghezze massime sui campi", /booking_status in \('pending', 'confirmed', 'cancelled'\)/.test(migSenzaCommenti) && /demo_leads_confirmed_ha_evento check \(booking_status <> 'confirmed' or \(calendar_event_id is not null and booked_at is not null\)\)/.test(migSenzaCommenti) && /ads_import_status in \('not_ready', 'ready', 'validated', 'sent', 'accepted', 'failed', 'skipped_no_consent', 'skipped_no_identifier', 'skipped_cancelled'\)/.test(migSenzaCommenti) && /char_length\(full_name\) between 2 and 120/.test(migSenzaCommenti));
  atteso("migrazione 0098: nessun IP in chiaro (solo ip_hash), nessuna cancellazione di dati esistenti, idempotente", /ip_hash text/.test(migSenzaCommenti) && !/\bip_address\b|\bip text\b/.test(migSenzaCommenti) && !/\bdrop table\b|\btruncate\b|\bdelete from public\.(?!demo_)/i.test(migSenzaCommenti) && !/create table public\./.test(migSenzaCommenti) && (migSenzaCommenti.match(/create table if not exists/g) ?? []).length === 3);
  atteso("migrazione 0098: cancellazione su richiesta (funzione riservata al server), conservazione descritta, ricarica dello schema", /create or replace function public\.demo_cancella_dati_email/.test(migSenzaCommenti) && /revoke all on function public\.demo_cancella_dati_email\(text\) from public, anon, authenticated/.test(migSenzaCommenti) && /Conservazione/.test(mig) && /notify pgrst, 'reload schema'/.test(migSenzaCommenti));
  atteso("migrazione 0098: ha il numero libero (dopo la 0095 di master e dopo la 0096 e la 0097 del lavoro in corso sul piano di lavoro)", fs.existsSync(path.join(radice, "supabase/migrations/0098_demo_leads.sql")) && !fs.existsSync(path.join(radice, "supabase/migrations/0096_demo_leads.sql")) && !fs.existsSync(path.join(radice, "supabase/migrations/0097_demo_leads.sql")));

  const azione = leggi("src/app/actions/omnia-ai-demo.ts");
  const posizione = (testo: string) => azione.indexOf(testo);
  atteso("azione: campo trappola → validazione → anti-bot → salvataggio → email, in quest'ordine", posizione("NOME_CAMPO_TRAPPOLA") > 0 && posizione("NOME_CAMPO_TRAPPOLA") < posizione("validaModuloDemo(grezzo)") && posizione("validaModuloDemo(grezzo)") < posizione("await verificaFormUmano(formData)") && posizione("await verificaFormUmano(formData)") < posizione("await registraLead(") && posizione("await registraLead(") < posizione("await sendEmail("));
  atteso("azione: il robot (campo trappola compilato) riceve un successo finto e non salva né scrive nulla", /if \(String\(formData\.get\(NOME_CAMPO_TRAPPOLA\) \?\? ""\)\.trim\(\) !== ""\) return \{ ok: true \};/.test(azione));
  atteso("azione: il consenso ai cookie è quello dichiarato dal modulo («cookie_ok» = 1), mai presunto", /const consensoCookie = formData\.get\("cookie_ok"\) === "1";/.test(azione));
  atteso("azione: l'attribuzione è input non fidato (ridotta ai campi noti), i cookie di Analytics sono interpretati e il percorso è controllato", /pulisciAttribuzione\(JSON\.parse\(/.test(azione) && /clientIdDaCookieGa\(/.test(azione) && /sessionIdDaCookieGa\(/.test(azione) && /\^\\\/\[A-Za-z0-9\\-_\/\]\{0,150\}\$/.test(azione));
  atteso("azione: l'IP non si salva né si registra: solo un hash con segreto dedicato (DEMO_LEADS_HASH_SECRET)", /hashIp\(ip, segreto\)/.test(azione) && /DEMO_LEADS_HASH_SECRET/.test(azione) && !/ip_address|ip:\s*ip\b/.test(azione));
  atteso("azione: NON registra nessuna conversione (niente GA4, Ads, gtag, fetch verso Google)", !/gtag|googleapis|google-analytics|datamanager|Measurement|ads_import_status|demo-ga4|demo-ads/.test(azione));
  atteso("azione: nessun dato personale nei log (nessun console.* che stampi i dati del modulo)", (azione.match(/console\./g) ?? []).length === 0);
  atteso("azione: l'email all'ufficio escapa ogni valore inserito dal visitatore", /escapeHtml\(valore\)/.test(azione) && /escapeHtml\(etichetta\)/.test(azione));
  atteso("azione: se il database non risponde la richiesta arriva comunque per email (il salvataggio non blocca l'avviso)", !/if \(salvataggio\.esito === "non_salvato"\) return/.test(azione) && /Salvata nel registro/.test(azione));

  const modulo = leggi("src/components/omnia-ai/demo-form.tsx");
  atteso("modulo: pulsante «CONTINUA E PRENOTA LA DEMO» e campi richiesti (nome, azienda, email aziendale, telefono, settore)", /CONTINUA E PRENOTA LA DEMO/.test(modulo) && ["nome", "azienda", "email", "telefono", "settore"].every((c) => modulo.includes(`name="${c}"`)) && /Email aziendale/.test(modulo) && /Nome azienda/.test(modulo) && /SETTORI_DEMO\.map/.test(modulo));
  atteso("modulo: informativa privacy collegata, presa visione OBBLIGATORIA, consenso alla misurazione pubblicitaria FACOLTATIVO", /href="\/privacy"/.test(modulo) && /name="privacy" required/.test(modulo) && /name="adsConsenso"/.test(modulo) && !/name="adsConsenso" required/.test(modulo) && /Facoltativo/.test(modulo));
  atteso("modulo: convalida nel browser con la stessa funzione del server, anti-bot e campo trappola", /validaModuloDemo\(Object\.fromEntries\(dati\.entries\(\)\)\)/.test(modulo) && /<TurnstileCampo /.test(modulo) && /name=\{NOME_CAMPO_TRAPPOLA\}/.test(modulo) && /tabIndex=\{-1\}/.test(modulo));
  atteso("modulo: la scheda del calendario si apre subito nel clic (prima dell'attesa del server), senza accesso alla pagina di partenza, e si riempie dopo", modulo.indexOf('window.open("about:blank", "_blank")') > 0 && modulo.indexOf('window.open("about:blank", "_blank")') < modulo.indexOf("await inviaRichiestaDemo(dati)") && /scheda\.opener = null/.test(modulo) && /scheda\.location\.href = LINK_PRENOTA_DEMO/.test(modulo) && /scheda\?\.close\(\)/.test(modulo));
  atteso("modulo: il calendario si apre SOLO dopo l'esito positivo del server (mai con un errore) e c'è un pulsante di riserva se il browser blocca la scheda", modulo.indexOf("if (scheda) scheda.location.href") > modulo.indexOf("if (!risposta.ok)") && /Apri il calendario e scegli l'orario/.test(modulo) && /<LinkDemo /.test(modulo));
  atteso("modulo: l'attribuzione e i cookie di Analytics si leggono SOLO con i cookie pubblicitari accettati", /const consenso = cookiePubblicitariAccettati\(localStorage\.getItem\(CHIAVE_CONSENSO_COOKIE\)\)/.test(modulo) && /if \(consenso\) \{[\s\S]*leggiAttribuzioneSalvata[\s\S]*valoreCookie\(cookie, "_ga"\)[\s\S]*\}/.test(modulo) && /dati\.set\("cookie_ok", consenso \? "1" : "0"\)/.test(modulo));
  atteso("modulo: eventi GA4 «demo_booking_start» (primo campo toccato) e «demo_lead_submitted» (dopo l'esito positivo), mai «demo_booking_confirmed»", /inviaEventoGa\("demo_booking_start"/.test(modulo) && /inviaEventoGa\("demo_lead_submitted"/.test(modulo) && modulo.indexOf('inviaEventoGa("demo_lead_submitted"') > modulo.indexOf("if (!risposta.ok)") && !/demo_booking_confirmed/.test(modulo) && /onFocusCapture=\{alPrimoCampo\}/.test(modulo));
  atteso("modulo: Analytics si usa solo se il tag è già caricato dal banner (nessun gtag creato né caricato qui)", /typeof gtag === "function"/.test(modulo) && !/googletagmanager|gtag\('config'|gtag\("config"|dataLayer/.test(modulo));
  atteso("modulo: nessuna chiave riservata né client privilegiato nel browser", !/service_role|SERVICE_ROLE|createAdminClient|process\.env/.test(modulo) && !/service_role|SERVICE_ROLE|createAdminClient|process\.env/.test(leggi("src/components/omnia-ai/attribuzione-demo.tsx")));
  atteso("il link del calendario NON è nell'URL con parametri pubblicitari: il modulo apre solo la costante", /LINK_PRENOTA_DEMO/.test(modulo) && !/calendar\.app\.google/.test(modulo) && !/\$\{.*LINK_PRENOTA_DEMO.*\?/.test(modulo) && !/LINK_PRENOTA_DEMO\s*\+/.test(modulo));

  const attrib = leggi("src/components/omnia-ai/attribuzione-demo.tsx");
  atteso("attribuzione: salva solo con i cookie pubblicitari accettati, cancella se il consenso non c'è più, legge solo il localStorage", /cookiePubblicitariAccettati\(localStorage\.getItem\(CHIAVE_CONSENSO_COOKIE\)\)/.test(attrib) && /localStorage\.removeItem\(CHIAVE_ATTRIBUZIONE\)/.test(attrib) && !/document\.cookie\s*=/.test(attrib) && !/fetch\(|sendBeacon|XMLHttpRequest/.test(attrib));
  atteso("attribuzione: si aggiorna anche quando il visitatore sceglie nel banner (evento di cambio consenso), con pulizia dell'ascoltatore", /window\.addEventListener\(EVENTO_CAMBIO_CONSENSO, aggiorna\)/.test(attrib) && /window\.removeEventListener\(EVENTO_CAMBIO_CONSENSO, aggiorna\)/.test(attrib) && /EVENTO_CAMBIO_CONSENSO = "omnia-ai-consent-change"/.test(attrib) && /const CONSENT_EVENT = "omnia-ai-consent-change";/.test(leggi("src/components/omnia-ai/cookie-consent.tsx")));
  atteso("il layout monta la cattura dell'attribuzione accanto al banner", /import AttribuzioneDemo from "@\/components\/omnia-ai\/attribuzione-demo";/.test(leggi("src/app/site-omnia-ai/layout.tsx")) && /<OmniaAiCookieConsent \/>\s*<AttribuzioneDemo \/>/.test(leggi("src/app/site-omnia-ai/layout.tsx")));

  const banner = leggi("src/components/omnia-ai/cookie-consent.tsx");
  atteso("il tracciamento esistente NON è stato toccato: stesso ID di Google Analytics, nessun ID Google Ads collegato, stessi script e stessa logica del banner", /const GA4_ID = "G-W551SWPNE4";/.test(banner) && /const GADS_ID: string \| null = null;/.test(banner) && /gtag\('config', '\$\{GA4_ID\}'\);/.test(banner) && /\{status === "accepted" && \(/.test(banner) && (banner.match(/gtag\('config'/g) ?? []).length === 2 && !/AW-18422155730|GT-P8RVLQB4/.test(banner));
  atteso("nessun altro file del sito OMNIA AI carica gtag.js o configura un secondo tag (nessun tracciamento duplicato)", (() => { const colpevoli: string[] = []; const percorri = (dir: string) => { for (const v of fs.readdirSync(path.join(radice, dir), { withFileTypes: true })) { const f = `${dir}/${v.name}`; if (v.isDirectory()) percorri(f); else if (/\.(ts|tsx)$/.test(v.name) && f !== "src/components/omnia-ai/cookie-consent.tsx" && f !== "src/components/cookie-consent.tsx" && /googletagmanager\.com\/gtag|gtag\(['"]config['"]/.test(fs.readFileSync(path.join(radice, f), "utf-8"))) colpevoli.push(f); } }; percorri("src"); return colpevoli.length === 0; })());

  const sync = leggi("src/app/api/cron/omnia-ai-demo-sync/route.ts");
  const purge = leggi("src/app/api/cron/omnia-ai-demo-purge/route.ts");
  atteso("cron: entrambe le route controllano il segreto PRIMA di fare qualsiasi cosa e rispondono 401 altrimenti", [sync, purge].every((r) => r.indexOf("cronAutorizzato(") > 0 && r.indexOf("cronAutorizzato(") < r.indexOf("createAdminClient()") && /status: 401/.test(r)));
  atteso("cron di sincronizzazione: tre passi indipendenti (un errore non ferma gli altri) e la risposta contiene solo numeri", (sync.match(/try \{/g) ?? []).length === 3 && /sincronizzaCalendario\(/.test(sync) && /inviaConversioniGa4\(/.test(sync) && /inviaConversioniAds\(/.test(sync) && !/\.email|full_name|gclid/.test(sync));
  const vercel = JSON.parse(leggi("vercel.json")) as { crons: { path: string; schedule: string }[] };
  atteso("vercel.json: sincronizzazione ogni 10 minuti e conservazione ogni giorno; i cron di prima restano", vercel.crons.some((c) => c.path === "/api/cron/omnia-ai-demo-sync" && c.schedule === "*/10 * * * *") && vercel.crons.some((c) => c.path === "/api/cron/omnia-ai-demo-purge" && c.schedule === "30 3 * * *") && vercel.crons.some((c) => c.path === "/api/cron/omnia-ai-purge-cessati") && vercel.crons.some((c) => c.path === "/api/cron/omnia-ai-email-retry") && vercel.crons.length === 4);

  const sorgentiIntegrazioni = ["src/lib/demo-calendario-sync.ts", "src/lib/demo-ga4.ts", "src/lib/demo-ads-data-manager.ts", "src/lib/google-oauth.ts", "src/lib/demo-leads.ts"].map((f) => [f, leggi(f)] as const);
  atteso("nessun console.* nelle integrazioni stampa dati personali o segreti (solo codici e numeri)", sorgentiIntegrazioni.every(([, t]) => (t.match(/console\.(log|warn|error|info)\(([^)]*)\)/g) ?? []).every((c) => !/email|nome|full_name|gclid|token|secret|segreto|corpo|refresh/i.test(c.replace(/"[^"]*"/g, "")))));
  atteso("le integrazioni leggono i segreti solo dall'ambiente, nessun segreto scritto nel codice", sorgentiIntegrazioni.every(([, t]) => !/ya29\.|1\/\/0[A-Za-z0-9_-]{20,}|GOCSPX-|AIza[A-Za-z0-9_-]{20,}/.test(t)) && /env\.GOOGLE_OAUTH_CLIENT_SECRET/.test(leggi("src/lib/google-oauth.ts")));
  atteso("il calendario si legge in SOLA lettura: nessuna chiamata di scrittura verso Calendar e solo l'ambito calendar.readonly", !/method:\s*"(POST|PUT|PATCH|DELETE)"/.test(leggi("src/lib/demo-calendario-sync.ts")) && /calendar\.readonly/.test(leggi("src/lib/demo-calendario-sync.ts")));
  atteso("GA4 non si importa in Google Ads: il file di Ads non cita GA4 e viceversa (niente doppia conversione)", !/google-analytics|mp\/collect/.test(leggi("src/lib/demo-ads-data-manager.ts")) && !/datamanager|googleads/.test(leggi("src/lib/demo-ga4.ts")));
  atteso("Google Ads usa gli endpoint della Data Manager API e lo scope dedicato", /https:\/\/datamanager\.googleapis\.com\/v1\/events:ingest/.test(leggi("src/lib/demo-conversioni-calcoli.ts")) && /https:\/\/datamanager\.googleapis\.com\/v1\/requestStatus:retrieve/.test(leggi("src/lib/demo-conversioni-calcoli.ts")) && /https:\/\/www\.googleapis\.com\/auth\/datamanager/.test(leggi("src/lib/demo-conversioni-calcoli.ts")));
  atteso("i moduli di rete accettano fetch iniettato (testabili) e hanno un tempo massimo per ogni chiamata", ["src/lib/demo-calendario-sync.ts", "src/lib/demo-ga4.ts", "src/lib/demo-ads-data-manager.ts", "src/lib/google-oauth.ts"].every((f) => /fetchFn: typeof fetch = fetch/.test(leggi(f)) && /TEMPO_MASSIMO_MS/.test(leggi(f)) && /AbortController/.test(leggi(f))));
  atteso("nessuna modifica a pagamenti, abbonamenti, autenticazione o generazione delle offerte: i file toccati dal tracciamento sono solo quelli della demo", (() => { const vietati = ["src/app/api/webhooks/stripe/route.ts", "src/app/actions/gara-extraction.ts", "src/app/actions/gara-chat.ts", "src/lib/zone.ts", "src/proxy.ts", "src/lib/supabase/middleware.ts"]; return vietati.every((f) => !/demo-lead|demo_leads|demo-ga4|demo-ads|demo-calendario|LINK_PRENOTA_DEMO/.test(leggi(f))); })());

  const guida = fs.existsSync(path.join(radice, "GUIDA-DEMO-TRACCIAMENTO.md")) ? leggi("GUIDA-DEMO-TRACCIAMENTO.md") : "";
  const variabili = ["DEMO_LEADS_HASH_SECRET", "CRON_SECRET", "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_CALENDAR_REFRESH_TOKEN", "GOOGLE_CALENDAR_ID", "DEMO_CALENDAR_SYNC_ENABLED", "DEMO_CALENDAR_TITLE_REGEX", "DEMO_CALENDAR_INTERNAL_EMAILS", "DEMO_MATCH_WINDOW_DAYS", "DEMO_GA4_MP_ENABLED", "GA4_API_SECRET", "GA4_MEASUREMENT_ID", "DEMO_GA4_MP_DEBUG", "DEMO_ADS_IMPORT_ENABLED", "DEMO_ADS_VALIDATE_ONLY", "DEMO_ADS_ALLOW_EMAIL_ONLY", "GOOGLE_ADS_CUSTOMER_ID", "GOOGLE_ADS_LOGIN_CUSTOMER_ID", "GOOGLE_ADS_DEMO_CONVERSION_ACTION_ID", "GOOGLE_ADS_REFRESH_TOKEN"];
  atteso("la guida esiste e descrive TUTTE le variabili d'ambiente usate dal codice", guida.length > 3000 && variabili.every((v) => guida.includes(v)), variabili.filter((v) => !guida.includes(v)).join(", "));
  const usate = new Set<string>();
  for (const f of ["src/lib/demo-calendario-sync.ts", "src/lib/demo-calendario-calcoli.ts", "src/lib/demo-ga4.ts", "src/lib/demo-ads-data-manager.ts", "src/lib/google-oauth.ts", "src/app/actions/omnia-ai-demo.ts"]) for (const m of leggi(f).matchAll(/env\.([A-Z][A-Z0-9_]+)|process\.env\.([A-Z][A-Z0-9_]+)|env\[([A-Za-z]+)\]/g)) if (m[1] || m[2]) usate.add(m[1] ?? m[2]);
  atteso("ogni variabile letta dal codice è nella guida", [...usate].every((v) => guida.includes(v)), [...usate].filter((v) => !guida.includes(v)).join(", "));
  atteso("la guida dichiara cosa manca prima di andare in produzione (credenziali, prenotazione di prova, azione di conversione, informativa privacy)", /Passaggi manuali/i.test(guida) && /azione di conversione/i.test(guida) && /prenotazione di prova/i.test(guida) && /informativa/i.test(guida) && /Limiti/i.test(guida));
  atteso("il test è nella catena verifica:livello1", /tsx scripts\/verifica-demo-tracciamento-omnia-ai\.ts/.test(leggi("package.json")));

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
