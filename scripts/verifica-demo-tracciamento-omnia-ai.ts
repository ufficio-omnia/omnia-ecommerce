// Autotest del tracciamento delle DEMO di OMNIA AI (richiesta dell'utente, 04/11/2026, con le otto migliorie dello stesso giorno):
// modulo → contatto + richiesta + prova dei consensi su Supabase → prenotazione sul calendario Google → evento GA4 e conversione
// Google Ads, SOLO per le prenotazioni confermate e abbinate con certezza.
//
// Nessuna rete, nessun database vero, nessuna chiave: si usano i moduli puri, un database finto in memoria con i vincoli della
// migrazione 0098 e un fetch finto (scripts/demo-finto-supabase.ts). Si controlla in particolare che:
//   - l'invio del modulo NON produca mai una conversione;
//   - se la richiesta non si salva, a sistema attivo NON si prosegue al calendario (errore recuperabile); un invio ripetuto non crea doppioni;
//   - contatto, richiesta e prenotazione siano tre cose distinte, senza sovrascrivere lo storico di chi fa più richieste;
//   - il consenso sia un registro firmato e verificabile, e una riga alterata non valga;
//   - conferma, annullamento, rifiuto e spostamento della prenotazione siano gestiti, e l'abbinamento incerto finisca in verifica manuale;
//   - nessuna conversione parta senza consenso, senza prenotazione confermata, o due volte;
//   - le integrazioni siano spente finché non sono configurate e partano in «solo verifica» finché non si passa alla modalità reale;
//   - due cron in parallelo non si sovrappongano;
//   - nei log e nelle risposte non compaiano email, token o identificativi di clic.
import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import { FintoDatabase, fetchFinto, type ChiamataFinta, type Riga } from "./demo-finto-supabase";
import {
  CHIAVE_ATTRIBUZIONE,
  CHIAVE_CONSENSO_COOKIE,
  GIORNI_VALIDITA_ATTRIBUZIONE,
  NOME_CAMPO_CHIAVE,
  NOME_CAMPO_VERSIONE_CONSENSI,
  SETTORI_DEMO,
  VERSIONE_CONSENSI_DEMO,
  chiaveIdempotenzaValida,
  clientIdDaCookieGa,
  cookiePubblicitariAccettati,
  costruisciAttribuzioneSalvata,
  decisioneDopoSalvataggio,
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
  configurazioneDaAmbiente,
  eventoDemo,
  nuovaPrenotazioneDaEvento,
  ordinaEventiPerElaborazione,
  partecipantiEsterni,
  tuttiGliEsterniHannoRifiutato,
  type EventoCalendario,
  type PrenotazioneNota,
  type RichiestaPerAbbinamento,
} from "../src/lib/demo-calendario-calcoli";
import {
  TESTI_MODULO_DEMO,
  TESTO_BANNER_COOKIE,
  VERSIONE_BANNER_COOKIE,
  VERSIONE_INFORMATIVA_PRIVACY,
  consensiVerificati,
  costruisciConsensi,
  costruisciRevoca,
  dataStandard,
  statoConsenso,
  stringaDaFirmare,
  testoCanonico,
  ultimoConsenso,
  type ConsensoRegistrato,
  type ConsensiVerificati,
} from "../src/lib/demo-consensi-calcoli";
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
import { contattiOrfani, limitiConservazione } from "../src/lib/demo-conservazione-calcoli";
import { cronAutorizzato } from "../src/lib/cron-autorizzato";
import { firmaConsenso, firmaConsensoValida, hashIp, segretoFirmaConsensi, sha256Hex } from "../src/lib/demo-hash";
import { registraRevoca, verificatoreFirma } from "../src/lib/demo-consensi";
import { LIMITE_RICHIESTE_PER_EMAIL_GIORNO, LIMITE_RICHIESTE_PER_IP_ORA, eliminaDatiScaduti, registraLead, type IngressoLead } from "../src/lib/demo-leads";
import { DURATA_BLOCCO_MS, acquisisciBlocco, rilasciaBlocco } from "../src/lib/demo-blocco";
import { eseguiCicloDemo } from "../src/lib/demo-ciclo";
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
const SEGRETO_FIRMA = "firma-segreto";
const CALENDARIO = "cal@group.calendar.google.com";
const SEGRETI = ["rt-segreto", "at-segreto", "ads-rt", "ga-segreto", "mario.rossi@esempio.it", "Mario.Rossi@Esempio.it", "GCLID_abc12345", "client-segreto", SEGRETO_FIRMA, "cron-segreto"];

// I consensi di UNA richiesta come li scriverebbe il server (stesso codice, stessa firma): si possono alterare per provare le difese.
type OpzioniConsensi = { privacy?: boolean; cookie?: boolean; ads?: boolean; quando?: string; firmare?: boolean };
function consensiFirmati(leadId: string, o: OpzioniConsensi = {}): Riga[] {
  const quando = o.quando ?? "2026-11-10T09:00:00.000Z";
  return costruisciConsensi({ adsConsenso: o.ads ?? true, cookieAccettati: o.cookie ?? true, ipHash: null }, sha256Hex)
    .filter((c) => c.tipo !== "informativa_privacy" || o.privacy !== false)
    .map((c) => {
      const r = { ...c, lead_id: leadId, registrato_il: quando };
      return { ...r, firma: o.firmare === false ? null : firmaConsenso(stringaDaFirmare(r), SEGRETO_FIRMA) };
    });
}

// Una richiesta (demo_leads) già salvata, con tutti i campi della migrazione.
function richiesta(extra: Riga = {}): Riga {
  const id = (extra.id as string | undefined) ?? randomUUID();
  return {
    id, contatto_id: `contatto-${(extra.email_norm as string | undefined) ?? "mario.rossi@esempio.it"}`, idempotency_key: `chiave-${id}-xxxxxxxxxx`,
    full_name: "Mario Rossi", company: "Pulizie Rossi Srl", email: "Mario.Rossi@Esempio.it", email_norm: "mario.rossi@esempio.it",
    phone: "+393331234567", sector: "Pulizie e sanificazione", gclid: "GCLID_abc12345", gbraid: null, wbraid: null,
    utm_source: "google", utm_medium: "cpc", utm_campaign: "demo", utm_content: null, utm_term: null, landing_path: "/",
    ga_client_id: "1234567890.1700000000", ga_session_id: "1700000000", attribution_consent: true,
    privacy_version: VERSIONE_CONSENSI_DEMO, privacy_accepted_at: "2026-11-10T09:00:00.000Z", ads_measurement_consent: true, ads_measurement_consent_at: "2026-11-10T09:00:00.000Z",
    ip_hash: null, booking_status: "pending", superseded_by: null, prima_prenotazione_il: null,
    ga4_sent_at: null, ga4_attempts: 0, ads_import_status: "not_ready", ads_transaction_id: null, ads_request_id: null, ads_sent_at: null, ads_attempts: 0,
    ads_next_attempt_at: null, ads_last_error: null, created_at: "2026-11-10T09:00:00.000Z", updated_at: "2026-11-10T09:00:00.000Z", ...extra,
  };
}

// Un database con richieste, i loro contatti (la chiave esterna lo richiede) e, di norma, i loro consensi firmati.
function dbCon(o: { leads?: Riga[]; consensi?: Record<string, OpzioniConsensi>; senzaConsensi?: boolean; prenotazioni?: Riga[]; casi?: Riga[]; syncToken?: string | null } = {}): FintoDatabase {
  const leads = o.leads ?? [];
  const contatti = [...new Set(leads.map((l) => l.contatto_id as string))].map((id) => {
    const l = leads.find((x) => x.contatto_id === id)!;
    return { id, email_norm: l.email_norm, email: l.email, full_name: l.full_name, company: l.company, phone: l.phone, sector: l.sector, ultima_richiesta_il: l.created_at, created_at: l.created_at, updated_at: l.created_at };
  });
  const consensi = o.senzaConsensi ? [] : leads.flatMap((l) => consensiFirmati(l.id as string, o.consensi?.[l.id as string] ?? {}));
  return new FintoDatabase({
    demo_contatti: contatti,
    demo_leads: leads,
    demo_consensi: consensi,
    demo_prenotazioni: o.prenotazioni ?? [],
    demo_calendar_casi: o.casi ?? [],
    ...(o.syncToken !== undefined ? { demo_sync_stato: [{ id: 1, sync_token: o.syncToken, last_run_at: null, last_success_at: null, last_error: null, lock_until: null }] } : {}),
  });
}

// Una prenotazione già registrata (demo_prenotazioni).
function prenotazione(extra: Riga = {}): Riga {
  return { id: randomUUID(), lead_id: "lead1", calendar_id: CALENDARIO, calendar_event_id: "evt1", stato: "confirmed", booked_at: "2026-11-10T09:30:00.000Z", starts_at: "2026-11-12T09:00:00.000Z", starts_at_originale: "2026-11-12T09:00:00.000Z", riprogrammata_il: null, cancelled_at: null, match_note: null, created_at: "2026-11-10T09:30:00.000Z", updated_at: "2026-11-10T09:30:00.000Z", ...extra };
}
const confermata = (extra: Riga = {}) => richiesta({ booking_status: "confirmed", prima_prenotazione_il: "2026-11-10T09:30:00.000Z", ads_import_status: "ready", ...extra });

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

  // idempotenza e decisione dopo il salvataggio (parte pura)
  atteso("chiave di idempotenza: solo lettere, cifre e trattini, da 16 a 80 caratteri", chiaveIdempotenzaValida("550e8400-e29b-41d4-a716-446655440000") !== null && chiaveIdempotenzaValida(`  ${"a".repeat(16)} `) === "a".repeat(16) && chiaveIdempotenzaValida("corta") === null && chiaveIdempotenzaValida("a".repeat(81)) === null && chiaveIdempotenzaValida("con spazi dentro alla chiave") === null && chiaveIdempotenzaValida("chiave;drop-table-xxxxxxx") === null && chiaveIdempotenzaValida(null) === null && chiaveIdempotenzaValida(12345678901234567) === null);
  atteso("i nomi dei campi del modulo per la chiave e per la versione dei testi sono quelli attesi (la stessa costante serve al modulo e all'azione)", NOME_CAMPO_CHIAVE === "idempotency_key" && NOME_CAMPO_VERSIONE_CONSENSI === "consensi_versione");
  atteso("dopo il salvataggio: a sistema ATTIVO una richiesta non salvata NON prosegue in silenzio (errore recuperabile)", decisioneDopoSalvataggio("non_salvato", true) === "errore_recuperabile");
  atteso("… prima dell'attivazione il modulo funziona come sempre (si prosegue, la richiesta arriva per email)", decisioneDopoSalvataggio("non_salvato", false) === "prosegui");
  atteso("… creata, già registrata (invio ripetuto) → si prosegue; troppe richieste → si ferma, in ogni modalità", decisioneDopoSalvataggio("creato", true) === "prosegui" && decisioneDopoSalvataggio("gia_registrato", true) === "prosegui" && decisioneDopoSalvataggio("creato", false) === "prosegui" && decisioneDopoSalvataggio("troppe_richieste", true) === "troppe_richieste" && decisioneDopoSalvataggio("troppe_richieste", false) === "troppe_richieste");

  // ═════════════════════════ 3. Consensi: registro verificabile ═════════════════════════
  console.log("\n--- Consensi: registro che si aggiunge soltanto, versionato e firmato ---");
  const cs = costruisciConsensi({ adsConsenso: true, cookieAccettati: false, ipHash: "iphash1" }, sha256Hex);
  atteso("per ogni invio si registrano TRE consensi: informativa privacy, misurazione pubblicitaria, cookie pubblicitari (anche il «no»)", cs.length === 3 && uguali(cs.map((c) => c.tipo), ["informativa_privacy", "misurazione_pubblicitaria", "cookie_pubblicitari"]) && uguali(cs.map((c) => c.valore), ["granted", "granted", "denied"]));
  atteso("ogni consenso porta la versione del testo, l'impronta SHA-256 del testo esatto mostrato e la versione dell'informativa privacy", cs.every((c) => /^[0-9a-f]{64}$/.test(c.testo_sha256) && c.informativa_versione === VERSIONE_INFORMATIVA_PRIVACY && c.versione_testo !== "") && cs[0].testo_sha256 === sha256Hex(testoCanonico("informativa_privacy")) && cs[1].testo_sha256 === sha256Hex(TESTI_MODULO_DEMO.ads) && cs[2].testo_sha256 === sha256Hex(TESTO_BANNER_COOKIE) && cs[0].versione_testo === VERSIONE_CONSENSI_DEMO && cs[2].versione_testo === VERSIONE_BANNER_COOKIE);
  atteso("il consenso ai cookie lo dichiara il browser (il server non può verificarlo): è marcato come tale; gli altri due li dà il modulo", cs[2].dichiarato_dal_browser === true && cs[2].fonte === "banner_cookie_dichiarato" && cs[0].dichiarato_dal_browser === false && cs[0].fonte === "modulo_demo" && cs[1].fonte === "modulo_demo");
  atteso("il testo dell'informativa breve e dei consensi mostrato nel modulo è quello da cui si calcola l'impronta (stessa fonte)", testoCanonico("informativa_privacy").includes(TESTI_MODULO_DEMO.privacy) && testoCanonico("informativa_privacy").includes(TESTI_MODULO_DEMO.informativaPrima) && testoCanonico("misurazione_pubblicitaria") === TESTI_MODULO_DEMO.ads && testoCanonico("cookie_pubblicitari") === TESTO_BANNER_COOKIE);
  atteso("l'indirizzo IP nel registro è solo un hash, mai in chiaro", cs.every((c) => c.ip_hash === "iphash1"));

  const secretoF = SEGRETO_FIRMA;
  const rigaC = (extra: Partial<ConsensoRegistrato> = {}): ConsensoRegistrato => {
    const r = { ...cs[0], lead_id: "lead1", registrato_il: "2026-11-10T09:00:00.000Z", firma: null as string | null, ...extra };
    return { ...r, firma: extra.firma !== undefined ? extra.firma : firmaConsenso(stringaDaFirmare(r), secretoF) };
  };
  const firmata = rigaC();
  atteso("la firma (HMAC-SHA256 con un segreto del server) torna per la riga originale", firmaConsensoValida(stringaDaFirmare(firmata), firmata.firma, secretoF) && /^[0-9a-f]{64}$/.test(firmata.firma ?? ""));
  atteso("cambiando UN campo (valore, versione, impronta, richiesta, data, fonte) la firma non torna più", (["valore", "versione_testo", "testo_sha256", "lead_id", "registrato_il", "fonte", "tipo", "informativa_versione"] as const).every((campo) => { const alterata = { ...firmata, [campo]: campo === "valore" ? "denied" : campo === "testo_sha256" ? "0".repeat(64) : campo === "registrato_il" ? "2026-11-11T09:00:00.000Z" : "altro" } as ConsensoRegistrato; return !firmaConsensoValida(stringaDaFirmare(alterata), firmata.firma, secretoF); }));
  atteso("segreto sbagliato, firma assente o malformata → non valida", !firmaConsensoValida(stringaDaFirmare(firmata), firmata.firma, "altro-segreto") && !firmaConsensoValida(stringaDaFirmare(firmata), null, secretoF) && !firmaConsensoValida(stringaDaFirmare(firmata), "abc", secretoF) && !firmaConsensoValida(stringaDaFirmare(firmata), "Z".repeat(64), secretoF));
  atteso("la data si firma in forma standard: «+00:00» con microsecondi (come la restituisce Postgres) dà la stessa firma", stringaDaFirmare({ ...firmata, registrato_il: "2026-11-10T09:00:00+00:00" }) === stringaDaFirmare(firmata) && stringaDaFirmare({ ...firmata, registrato_il: "2026-11-10T09:00:00.000000+00:00" }) === stringaDaFirmare(firmata) && dataStandard("2026-11-10T11:00:00+02:00") === "2026-11-10T09:00:00.000Z");
  atteso("segreto della firma: quello dedicato, poi quello dell'hash degli indirizzi, poi CRON_SECRET; nessuno → nessuna firma", segretoFirmaConsensi({ DEMO_CONSENT_SIGNING_SECRET: " a ", DEMO_LEADS_HASH_SECRET: "b", CRON_SECRET: "c" }) === "a" && segretoFirmaConsensi({ DEMO_LEADS_HASH_SECRET: "b", CRON_SECRET: "c" }) === "b" && segretoFirmaConsensi({ CRON_SECRET: "c" }) === "c" && segretoFirmaConsensi({}) === null && segretoFirmaConsensi({ CRON_SECRET: "  " }) === null);

  const verificaF = (r: ConsensoRegistrato) => firmaConsensoValida(stringaDaFirmare(r), r.firma, secretoF);
  const c1 = rigaC({ tipo: "cookie_pubblicitari", valore: "granted", registrato_il: "2026-11-10T09:00:00.000Z" });
  const c2 = rigaC({ tipo: "cookie_pubblicitari", valore: "denied", fonte: "revoca", registrato_il: "2026-11-10T12:00:00.000Z" });
  atteso("il consenso valido è l'ULTIMA riga: una revoca (riga nuova «denied») annulla il consenso dato prima, in qualunque ordine arrivino", statoConsenso([c1], "cookie_pubblicitari", verificaF) === "concesso" && statoConsenso([c1, c2], "cookie_pubblicitari", verificaF) === "negato" && statoConsenso([c2, c1], "cookie_pubblicitari", verificaF) === "negato" && ultimoConsenso([c1, c2], "cookie_pubblicitari")?.valore === "denied");
  atteso("nessuna riga → «mancante»; una riga con firma alterata → «firma_non_valida» (non vale)", statoConsenso([], "cookie_pubblicitari", verificaF) === "mancante" && statoConsenso([{ ...c1, valore: "denied" }], "cookie_pubblicitari", verificaF) === "firma_non_valida" && statoConsenso([{ ...rigaC({ tipo: "cookie_pubblicitari", valore: "denied" }), valore: "granted" }], "cookie_pubblicitari", verificaF) === "firma_non_valida");
  const regTutti = (["informativa_privacy", "misurazione_pubblicitaria", "cookie_pubblicitari"] as const).map((tipo) => rigaC({ tipo, valore: "granted" }));
  atteso("cosa si può fare in base ai consensi verificati: privacy + cookie + misurazione", uguali(consensiVerificati(regTutti, verificaF), { privacy: true, cookie: true, misurazione: true }) && uguali(consensiVerificati([], verificaF), { privacy: false, cookie: false, misurazione: false }) && uguali(consensiVerificati([regTutti[0]], verificaF), { privacy: true, cookie: false, misurazione: false }));
  atteso("una riga alterata a mano fa cadere SOLO quel consenso", uguali(consensiVerificati([regTutti[0], regTutti[1], { ...regTutti[2], valore: "denied" }], verificaF), { privacy: true, cookie: false, misurazione: true }));
  atteso("la revoca è una riga nuova «denied», con fonte «revoca», che non modifica nulla di esistente", (() => { const r = costruisciRevoca("misurazione_pubblicitaria", "iph", sha256Hex); return r.valore === "denied" && r.fonte === "revoca" && r.tipo === "misurazione_pubblicitaria" && r.ip_hash === "iph"; })());
  atteso("la versione dell'informativa privacy registrata è la «1», come la pagina /privacy in vigore (la v1 non si modifica; con una v2 questa costante e il test vanno aggiornati)", VERSIONE_INFORMATIVA_PRIVACY === "1" && fs.existsSync(path.join(radice, "src/components/omnia-ai/legal/privacy-policy-v1.tsx")) && !fs.existsSync(path.join(radice, "src/components/omnia-ai/legal/privacy-policy-v2.tsx")));
  atteso("il testo del banner dei cookie registrato è quello che il banner mostra davvero", leggi("src/components/omnia-ai/cookie-consent.tsx").replace(/\s+/g, " ").includes(TESTO_BANNER_COOKIE));

  // ═════════════════════════ 4. Calendario: riconoscere e abbinare ═════════════════════════
  console.log("\n--- Calendario: riconoscere le demo, abbinarle alla richiesta, annullamenti e spostamenti ---");
  const cfg = configurazioneDaAmbiente({ DEMO_CALENDAR_TITLE_REGEX: "demo omnia", DEMO_CALENDAR_INTERNAL_EMAILS: "ufficio@omniaitalia.com, Team@omniaitalia.com", DEMO_MATCH_WINDOW_DAYS: "30" });
  atteso("configurazione dall'ambiente: titolo, email interne in minuscolo, finestra, gestione di più richieste (predefinita «ultima»)", cfg.titolo.test("DEMO OMNIA AI") && uguali(cfg.emailInterne, ["ufficio@omniaitalia.com", "team@omniaitalia.com"]) && cfg.finestraGiorni === 30 && cfg.multiRichiesta === "ultima" && configurazioneDaAmbiente({ DEMO_MULTI_RICHIESTA: "manuale" }).multiRichiesta === "manuale" && configurazioneDaAmbiente({ DEMO_MULTI_RICHIESTA: "boh" }).multiRichiesta === "ultima");
  const predefinita = configurazioneDaAmbiente({});
  atteso("senza configurazione: titolo «demo», nessuna email interna, finestra di 30 giorni; valori assurdi → predefiniti", predefinita.titolo.test("Demo") && predefinita.emailInterne.length === 0 && predefinita.finestraGiorni === FINESTRA_GIORNI_PREDEFINITA && configurazioneDaAmbiente({ DEMO_CALENDAR_TITLE_REGEX: "(" }).titolo.test("demo") && configurazioneDaAmbiente({ DEMO_MATCH_WINDOW_DAYS: "0" }).finestraGiorni === 30 && configurazioneDaAmbiente({ DEMO_MATCH_WINDOW_DAYS: "400" }).finestraGiorni === 30);

  const ev = (extra: Partial<EventoCalendario> = {}): EventoCalendario => ({
    id: "evt1", status: "confirmed", summary: "Demo OMNIA AI", created: "2026-11-10T09:30:00Z", start: { dateTime: "2026-11-12T10:00:00+01:00" },
    attendees: [{ email: "ufficio@omniaitalia.com", organizer: true, self: true }, { email: "Mario.Rossi@esempio.it", responseStatus: "accepted" }],
    organizer: { email: "ufficio@omniaitalia.com", self: true }, ...extra,
  });
  const rich = (extra: Partial<RichiestaPerAbbinamento> = {}): RichiestaPerAbbinamento => ({ id: "lead1", email_norm: "mario.rossi@esempio.it", created_at: "2026-11-10T09:00:00Z", booking_status: "pending", ...extra });
  const nota = (extra: Partial<PrenotazioneNota> = {}): PrenotazioneNota => ({ id: "pren1", lead_id: "lead1", stato: "confirmed", starts_at: "2026-11-12T09:00:00.000Z", starts_at_originale: "2026-11-12T09:00:00.000Z", ...extra });
  const esito = (e: EventoCalendario, richieste: RichiestaPerAbbinamento[] = [], n: PrenotazioneNota | null = null, c = cfg) => abbinaEvento(e, { prenotazioneNota: n, richieste }, c);

  atteso("evento DEMO: il titolo corrisponde; non lo è un'altra riunione; mai un tipo escluso", eventoDemo(ev(), cfg) && !eventoDemo(ev({ summary: "Riunione interna" }), cfg) && !eventoDemo(ev({ eventType: "outOfOffice" }), cfg) && !eventoDemo(ev({ summary: undefined }), cfg));
  atteso("chi ha prenotato: tolti organizzatore, calendario stesso, risorse, squadra e chi ha rifiutato; email normalizzate e senza doppioni", uguali(partecipantiEsterni(ev({ attendees: [{ email: "UFFICIO@omniaitalia.com" }, { email: "team@omniaitalia.com" }, { email: "sala@risorse.it", resource: true }, { email: "x@y.it", responseStatus: "declined" }, { email: "  Mario.Rossi@Esempio.IT " }, { email: "mario.rossi@esempio.it" }, { email: "boss@azienda.it" }], organizer: { email: "boss@azienda.it" } }), cfg), ["mario.rossi@esempio.it"]));
  atteso("chi è marcato come organizzatore o come il calendario stesso non è mai «chi ha prenotato», anche senza elenco di email interne", uguali(partecipantiEsterni(ev({ organizer: undefined, attendees: [{ email: "capo@x.it", organizer: true }, { email: "io@x.it", self: true }, { email: "cliente@x.it" }] }), configurazioneDaAmbiente({})), ["cliente@x.it"]));

  const a = esito(ev(), [rich()]);
  atteso("prenotazione e richiesta con la stessa email, nell'ordine giusto → abbinato (con quella richiesta, nessuna sostituita)", a.tipo === "abbinato" && a.richiesta.id === "lead1" && a.sostituite.length === 0, JSON.stringify(a));
  atteso("l'email dell'evento si confronta normalizzata (maiuscole e spazi)", esito(ev({ attendees: [{ email: " MARIO.ROSSI@ESEMPIO.IT " }] }), [rich()]).tipo === "abbinato");
  atteso("una prenotazione di 5 minuti PRIMA del modulo (scarto di orologi) si abbina; di 11 minuti prima no", esito(ev({ created: "2026-11-10T08:55:00Z" }), [rich()]).tipo === "abbinato" && (() => { const r = esito(ev({ created: "2026-11-10T08:49:00Z" }), [rich()]); return r.tipo === "caso" && r.motivo === "fuori_finestra"; })());
  atteso("finestra di 30 giorni: il trentesimo giorno sì, il trentunesimo no", esito(ev({ created: "2026-12-10T09:00:00Z" }), [rich()]).tipo === "abbinato" && (() => { const r = esito(ev({ created: "2026-12-10T09:00:01Z" }), [rich()]); return r.tipo === "caso" && r.motivo === "fuori_finestra"; })());
  atteso("nessuna richiesta con quell'email → caso «nessun_lead» (niente conversione)", (() => { const r = esito(ev({ attendees: [{ email: "altro@esempio.it" }] }), [rich()]); return r.tipo === "caso" && r.motivo === "nessun_lead"; })());
  atteso("più richieste della STESSA persona nello stesso percorso (entro 24 ore): vale la più recente, le altre «pending» diventano sostituite (restano nello storico)", (() => { const r = esito(ev({ created: "2026-11-10T12:00:00Z" }), [rich({ id: "A", created_at: "2026-11-10T09:00:00Z" }), rich({ id: "B", created_at: "2026-11-10T10:00:00Z" }), rich({ id: "C", created_at: "2026-11-10T11:00:00Z" })]); return r.tipo === "abbinato" && r.richiesta.id === "C" && uguali([...r.sostituite].sort(), ["A", "B"]); })());
  atteso("… una richiesta già annullata non viene «sostituita» (resta com'è)", (() => { const r = esito(ev({ created: "2026-11-10T12:00:00Z" }), [rich({ id: "A", created_at: "2026-11-10T09:00:00Z", booking_status: "cancelled" }), rich({ id: "B", created_at: "2026-11-10T10:00:00Z" })]); return r.tipo === "abbinato" && r.richiesta.id === "B" && r.sostituite.length === 0; })());
  atteso("più richieste della stessa persona a più di 24 ore l'una dall'altra → caso «piu_lead» (non si sceglie a caso)", (() => { const r = esito(ev({ created: "2026-11-10T12:00:00Z" }), [rich({ id: "A", created_at: "2026-11-08T09:00:00Z" }), rich({ id: "B", created_at: "2026-11-10T10:00:00Z" })]); return r.tipo === "caso" && r.motivo === "piu_lead"; })());
  atteso("con DEMO_MULTI_RICHIESTA=manuale anche due richieste ravvicinate vanno sempre a mano", (() => { const r = esito(ev({ created: "2026-11-10T12:00:00Z" }), [rich({ id: "A", created_at: "2026-11-10T09:00:00Z" }), rich({ id: "B", created_at: "2026-11-10T10:00:00Z" })], null, configurazioneDaAmbiente({ DEMO_CALENDAR_TITLE_REGEX: "demo omnia", DEMO_MULTI_RICHIESTA: "manuale" })); return r.tipo === "caso" && r.motivo === "piu_lead"; })());
  atteso("due persone DIVERSE invitate, ognuna con la sua richiesta → caso «piu_lead» (l'abbinamento non è univoco: nessuna conversione)", (() => { const r = esito(ev({ attendees: [{ email: "mario.rossi@esempio.it" }, { email: "anna@esempio.it" }] }), [rich(), rich({ id: "lead2", email_norm: "anna@esempio.it" })]); return r.tipo === "caso" && r.motivo === "piu_lead"; })());
  atteso("la stessa persona ha già una demo confermata con un altro evento → «prenotazione_duplicata» (nessuna seconda conversione)", (() => { const r = esito(ev({ id: "evt2" }), [rich({ booking_status: "confirmed" })]); return r.tipo === "caso" && r.motivo === "prenotazione_duplicata"; })());
  atteso("una richiesta annullata può essere ri-abbinata a una nuova prenotazione (annullata e rifatta)", esito(ev({ id: "evt9" }), [rich({ booking_status: "cancelled" })]).tipo === "abbinato");
  atteso("una richiesta «superseded» (sostituita da un'altra) non si abbina mai", (() => { const r = esito(ev(), [rich({ booking_status: "superseded" })]); return r.tipo === "caso"; })());
  atteso("più partecipanti esterni: si abbina se UNO solo ha una richiesta", (() => { const r = esito(ev({ attendees: [{ email: "collega@esempio.it" }, { email: "mario.rossi@esempio.it" }] }), [rich()]); return r.tipo === "abbinato" && r.richiesta.id === "lead1"; })());
  atteso("evento senza data di creazione → caso (non si può controllare l'ordine)", esito(ev({ created: undefined }), [rich()]).tipo === "caso");
  atteso("riunione che non è una demo → «ignora»; solo la squadra → «senza_partecipante»; email malformata → «email_non_valida»", esito(ev({ summary: "Riunione interna" }), [rich()]).tipo === "ignora" && (() => { const r1 = esito(ev({ attendees: [{ email: "ufficio@omniaitalia.com", organizer: true }] }), [rich()]); const r2 = esito(ev({ attendees: [{ email: "non-una-email" }] }), [rich()]); return r1.tipo === "caso" && r1.motivo === "senza_partecipante" && r2.tipo === "caso" && r2.motivo === "email_non_valida"; })());

  // annullamento, rifiuto, spostamento, riattivazione
  atteso("evento CANCELLATO con una prenotazione nota → «cancellato» con quella prenotazione; senza prenotazione nota non c'è niente da annullare", (() => { const r = esito(ev({ status: "cancelled" }), [], nota()); const r2 = esito(ev({ status: "cancelled" }), [rich()]); return r.tipo === "cancellato" && r.prenotazione?.id === "pren1" && r2.tipo === "cancellato" && r2.prenotazione === null; })());
  atteso("un evento cancellato può arrivare con pochissimi campi (solo id e stato): basta per annullare", (() => { const r = esito({ id: "evt1", status: "cancelled" }, [], nota()); return r.tipo === "cancellato" && r.prenotazione?.id === "pren1"; })());
  atteso("chi ha prenotato RIFIUTA l'invito: per Google equivale ad annullare → «cancellato» (anche se l'evento esiste ancora)", (() => { const e = ev({ attendees: [{ email: "ufficio@omniaitalia.com", organizer: true }, { email: "mario.rossi@esempio.it", responseStatus: "declined" }] }); const r = esito(e, [], nota()); const r2 = esito(e, [rich()]); return tuttiGliEsterniHannoRifiutato(e, cfg) && r.tipo === "cancellato" && r.prenotazione?.id === "pren1" && r2.tipo === "cancellato" && r2.prenotazione === null; })());
  atteso("se rifiuta solo UNO di due esterni la prenotazione resta valida", (() => { const e = ev({ attendees: [{ email: "mario.rossi@esempio.it", responseStatus: "declined" }, { email: "anna@esempio.it", responseStatus: "accepted" }] }); return !tuttiGliEsterniHannoRifiutato(e, cfg) && esito(e, [], nota()).tipo === "prenotazione_nota"; })());
  atteso("prenotazione già nota e nessuna modifica → «prenotazione_nota» senza orario nuovo e senza riattivazione (rielaborare non cambia nulla)", (() => { const r = esito(ev(), [], nota()); return r.tipo === "prenotazione_nota" && r.nuovoInizio === null && r.riattivata === false; })());
  atteso("evento SPOSTATO (stesso id, inizio diverso) → l'orario nuovo in UTC", (() => { const r = esito(ev({ start: { dateTime: "2026-11-13T15:00:00+01:00" } }), [], nota()); return r.tipo === "prenotazione_nota" && r.nuovoInizio === "2026-11-13T14:00:00.000Z"; })());
  atteso("evento già annullato che torna valido (stesso id) → «riattivata»", (() => { const r = esito(ev(), [], nota({ stato: "cancelled" })); return r.tipo === "prenotazione_nota" && r.riattivata === true; })());
  atteso("rinominare l'evento NON annulla la prenotazione già nota (il titolo conta solo la prima volta)", esito(ev({ summary: "Riunione con Mario" }), [], nota()).tipo === "prenotazione_nota");
  atteso("ordine di elaborazione: prima le cancellazioni, poi gli altri dal più vecchio (così «annullata e rifatta» nello stesso gruppo non diventa un caso)", (() => { const o = ordinaEventiPerElaborazione([ev({ id: "n2", created: "2026-11-11T08:00:00Z" }), ev({ id: "c1", status: "cancelled", created: "2026-11-12T08:00:00Z" }), ev({ id: "n1", created: "2026-11-10T08:00:00Z" })]); return uguali(o.map((e) => e.id), ["c1", "n1", "n2"]); })());
  const np = nuovaPrenotazioneDaEvento(ev(), CALENDARIO, "lead1", "abbinata");
  atteso("la riga di prenotazione: richiesta, calendario, evento, data di prenotazione e inizio in UTC (inizio originale = inizio)", !!np && np.lead_id === "lead1" && np.calendar_id === CALENDARIO && np.calendar_event_id === "evt1" && np.stato === "confirmed" && np.booked_at === "2026-11-10T09:30:00.000Z" && np.starts_at === "2026-11-12T09:00:00.000Z" && np.starts_at_originale === np.starts_at, JSON.stringify(np));
  atteso("senza la data di creazione dell'evento non si può confermare", nuovaPrenotazioneDaEvento(ev({ created: undefined }), CALENDARIO, "lead1", "x") === null);

  // ═════════════════════════ 5. Conversioni: regole ═════════════════════════
  console.log("\n--- Conversioni: quando e cosa si invia ---");
  const tutti: ConsensiVerificati = { privacy: true, cookie: true, misurazione: true };
  const base = (extra: Partial<LeadPerConversione> = {}): LeadPerConversione => ({
    id: "11111111-1111-4111-8111-111111111111", email: "Mario.Rossi+Demo@Gmail.com", booking_status: "confirmed", prima_prenotazione_il: "2026-11-10T09:30:00.000Z", created_at: "2026-11-10T09:00:00.000Z",
    sector: "Pulizie e sanificazione", gclid: "GCLID_abc12345", gbraid: null, wbraid: null,
    ga_client_id: "1234567890.1700000000", ga_session_id: "1700000000", ga4_sent_at: null, ads_import_status: "ready", ads_attempts: 0, ...extra,
  });
  const T = (extra: Partial<LeadPerConversione>, consensi: Partial<ConsensiVerificati> = {}, soloEmail = false) => statoAdsPerConferma({ gclid: "GCLID_abc12345", gbraid: null, wbraid: null, ...extra }, { ...tutti, ...consensi }, { consentiSoloEmail: soloEmail });
  atteso("stato Ads alla conferma: informativa + cookie accettati + identificativo di clic → ready (con o senza il consenso dell'email)", T({}) === "ready" && T({}, { misurazione: false }) === "ready");
  atteso("senza l'informativa accettata → skipped_no_consent, qualunque altra cosa ci sia", T({}, { privacy: false }) === "skipped_no_consent" && T({ gclid: null }, { privacy: false }, true) === "skipped_no_consent");
  atteso("senza nessun consenso pubblicitario → skipped_no_consent (il consenso viene prima dell'identificativo)", T({}, { cookie: false, misurazione: false }) === "skipped_no_consent" && T({ gclid: null }, { cookie: false, misurazione: false }) === "skipped_no_consent" && T({ gclid: null }, { cookie: false, misurazione: false }, true) === "skipped_no_consent");
  atteso("con il clic ma senza i cookie accettati → skipped_no_consent (anche se c'è il consenso dell'email)", T({}, { cookie: false }) === "skipped_no_consent");
  atteso("senza identificativo di clic → skipped_no_identifier, salvo l'invio «solo email» abilitato E il consenso dell'email", T({ gclid: null }) === "skipped_no_identifier" && T({ gclid: null }, {}, true) === "ready" && T({ gclid: null }, { misurazione: false }, true) === "skipped_no_identifier");

  const cfgAds: ConfigurazioneAds = { idCliente: "1234567890", idAzioneConversione: "987654321", soloVerifica: true };
  const hashFinto = (t: string) => `H(${t})`;
  const costruisci = (l: Partial<LeadPerConversione> = {}, c: Partial<ConfigurazioneAds> = {}, consensi: Partial<ConsensiVerificati> = {}, soloEmail = false, adesso = ADESSO) => costruisciRichiestaAds(base(l), { ...cfgAds, ...c }, adesso, hashFinto, { consentiSoloEmail: soloEmail }, { ...tutti, ...consensi });
  const r1 = costruisci();
  atteso("richiesta Google Ads: destinazione, codifica HEX, consenso, evento WEB con data UTC, identificativo di transazione per richiesta, clic ed email cifrata normalizzata", r1.ok && uguali(r1.richiesta.destinations, [{ operatingAccount: { accountType: "GOOGLE_ADS", accountId: "1234567890" }, loginAccount: { accountType: "GOOGLE_ADS", accountId: "1234567890" }, productDestinationId: "987654321" }]) && r1.richiesta.encoding === "HEX" && uguali(r1.richiesta.consent, { adUserData: "CONSENT_GRANTED", adPersonalization: "CONSENT_GRANTED" }) && r1.richiesta.events.length === 1 && r1.richiesta.events[0].eventTimestamp === "2026-11-10T09:30:00.000Z" && r1.richiesta.events[0].eventSource === "WEB" && r1.richiesta.events[0].transactionId === `omnia-demo-${base().id}` && uguali(r1.richiesta.events[0].adIdentifiers, { gclid: "GCLID_abc12345" }) && uguali(r1.richiesta.events[0].userData, { userIdentifiers: [{ emailAddress: "H(mariorossi@gmail.com)" }] }) && r1.richiesta.validateOnly === true, JSON.stringify(r1));
  atteso("l'identificativo di transazione dipende solo dalla RICHIESTA: stessa richiesta = stesso identificativo (anche con più prenotazioni), richieste diverse della stessa persona = identificativi diversi", idTransazioneAds("a") === idTransazioneAds("a") && idTransazioneAds("a") !== idTransazioneAds("b") && (() => { const x = costruisci({ id: "richiesta-1" }); const y = costruisci({ id: "richiesta-2", email: "Mario.Rossi+Demo@Gmail.com" }); return x.ok && y.ok && x.richiesta.events[0].transactionId !== y.richiesta.events[0].transactionId; })());
  atteso("l'ora della conversione è quella della PRIMA prenotazione (non cambia se poi la demo viene riprenotata)", (() => { const x = costruisci({ prima_prenotazione_il: "2026-11-09T08:00:00.000Z" }); return x.ok && x.richiesta.events[0].eventTimestamp === "2026-11-09T08:00:00.000Z"; })());
  atteso("«solo verifica» disattivata → validateOnly falso; account gestore usato come account di accesso", (() => { const r = costruisci({}, { soloVerifica: false, idClienteGestore: "5555555555" }); return r.ok && r.richiesta.validateOnly === false && r.richiesta.destinations[0].loginAccount.accountId === "5555555555" && r.richiesta.destinations[0].operatingAccount.accountId === "1234567890"; })());
  atteso("identificativo di clic: gclid, poi gbraid, poi wbraid (uno solo per evento)", (() => { const e = (l: Partial<LeadPerConversione>) => { const r = costruisci(l); return r.ok ? r.richiesta.events[0].adIdentifiers : null; }; return uguali(e({}), { gclid: "GCLID_abc12345" }) && uguali(e({ gclid: null, gbraid: "GBRAID_1234567" }), { gbraid: "GBRAID_1234567" }) && uguali(e({ gclid: null, wbraid: "WBRAID_1234567" }), { wbraid: "WBRAID_1234567" }) && uguali(e({ gbraid: "GBRAID_1234567", wbraid: "WBRAID_1234567" }), { gclid: "GCLID_abc12345" }); })());
  atteso("senza il consenso facoltativo dell'email: nessun dato dell'utente nella richiesta e personalizzazione negata", (() => { const r = costruisci({}, {}, { misurazione: false }); return r.ok && r.richiesta.events[0].userData === undefined && r.richiesta.consent.adPersonalization === "CONSENT_DENIED" && r.richiesta.consent.adUserData === "CONSENT_GRANTED"; })());
  atteso("«solo email» (senza clic, cookie non accettati ma consenso del modulo): solo l'email cifrata, nessun identificativo di clic", (() => { const r = costruisci({ gclid: null }, {}, { cookie: false }, true); return r.ok && r.richiesta.events[0].adIdentifiers === undefined && !!r.richiesta.events[0].userData && r.richiesta.consent.adPersonalization === "CONSENT_DENIED"; })());
  const nonOk = (l: Partial<LeadPerConversione>, consensi: Partial<ConsensiVerificati> = {}, soloEmail = false) => { const r = costruisci(l, {}, consensi, soloEmail); return r.ok ? "ok" : r.motivo; };
  atteso("mai una richiesta per: prenotazione non confermata, senza data, oltre 90 giorni, senza consenso, senza identificativo", nonOk({ booking_status: "pending" }) === "non_confermata" && nonOk({ booking_status: "cancelled" }) === "non_confermata" && nonOk({ booking_status: "superseded" }) === "non_confermata" && nonOk({ prima_prenotazione_il: null }) === "senza_data" && nonOk({ prima_prenotazione_il: "2026-07-01T00:00:00.000Z" }) === "troppo_vecchia" && nonOk({}, { cookie: false, misurazione: false }) === "senza_consenso" && nonOk({}, { privacy: false }) === "senza_consenso" && nonOk({ gclid: null }) === "senza_identificativo");
  atteso("una prenotazione «dal futuro» (orologi diversi) non produce un evento nel futuro", (() => { const r = costruisci({ prima_prenotazione_il: "2026-11-10T10:05:00.000Z" }); return r.ok && r.richiesta.events[0].eventTimestamp === ADESSO_ISO; })());
  atteso("nella richiesta non compaiono nome, azienda, telefono né l'email in chiaro", (() => { const r = costruisciRichiestaAds(base(), cfgAds, ADESSO, sha256Hex, { consentiSoloEmail: false }, tutti); const testo = JSON.stringify(r); return r.ok && !/Mario|Rossi|Pulizie|3331234567|gmail/i.test(testo) && /[0-9a-f]{64}/.test(testo); })());
  atteso("SHA-256 esadecimale corretto (valore noto)", sha256Hex("abc") === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  atteso("configurazione Ads: account a 10 cifre senza trattini, azione numerica, modalità «solo verifica» esplicita", configurazioneAdsValida(cfgAds) && !configurazioneAdsValida({ ...cfgAds, idCliente: "123-456-7890" }) && !configurazioneAdsValida({ ...cfgAds, idCliente: "123456789" }) && !configurazioneAdsValida({ ...cfgAds, idAzioneConversione: "azione" }) && !configurazioneAdsValida({ ...cfgAds, idClienteGestore: "12" }) && !configurazioneAdsValida({ idCliente: "1234567890", idAzioneConversione: "987654321" }));
  atteso("configurazione Ads dall'ambiente: «solo verifica» è la modalità predefinita, si esce solo con DEMO_ADS_VALIDATE_ONLY=0", configurazioneAdsDaAmbiente({ GOOGLE_ADS_CUSTOMER_ID: "123-456-7890", GOOGLE_ADS_DEMO_CONVERSION_ACTION_ID: "987654321" })?.soloVerifica === true && configurazioneAdsDaAmbiente({ GOOGLE_ADS_CUSTOMER_ID: "1234567890", GOOGLE_ADS_DEMO_CONVERSION_ACTION_ID: "987654321", DEMO_ADS_VALIDATE_ONLY: "0" })?.soloVerifica === false && configurazioneAdsDaAmbiente({ GOOGLE_ADS_CUSTOMER_ID: "1234567890" }) === null);
  atteso("pause tra i tentativi: 10 min, 30 min, 2 h, 8 h, 24 h; dopo il sesto nessun altro", uguali([...PAUSE_TENTATIVI_MINUTI], [10, 30, 120, 480, 1440]) && TENTATIVI_MASSIMI === 6 && [1, 2, 3, 4, 5].every((n) => prossimoTentativo(n, ADESSO) === new Date(ADESSO + PAUSE_TENTATIVI_MINUTI[n - 1] * 60_000).toISOString()) && prossimoTentativo(6, ADESSO) === null && prossimoTentativo(0, ADESSO) === new Date(ADESSO + 600_000).toISOString());
  atteso("stato di una richiesta già inviata: SUCCESS = riuscita; PROCESSING = in corso; FAILED e PARTIAL_SUCCESS = errori; il resto = sconosciuta", interpretaStatoRichiesta({ requestStatusPerDestination: [{ requestStatus: "SUCCESS" }] }).esito === "riuscita" && interpretaStatoRichiesta({ requestStatusPerDestination: [{ requestStatus: "PROCESSING" }] }).esito === "in_corso" && interpretaStatoRichiesta({ requestStatusPerDestination: [{ requestStatus: "FAILED" }] }).esito === "fallita" && interpretaStatoRichiesta({ requestStatusPerDestination: [{ requestStatus: "PARTIAL_SUCCESS" }] }).esito === "parziale" && interpretaStatoRichiesta({}).esito === "sconosciuta" && interpretaStatoRichiesta(null).esito === "sconosciuta" && interpretaStatoRichiesta({ requestStatusPerDestination: [{ requestStatus: "REQUEST_STATUS_UNKNOWN" }] }).esito === "sconosciuta");
  atteso("più destinazioni: «riuscita» solo se TUTTE sono SUCCESS; basta una FAILED per «fallita»; una PROCESSING tra SUCCESS = «in corso»", interpretaStatoRichiesta({ requestStatusPerDestination: [{ requestStatus: "SUCCESS" }, { requestStatus: "SUCCESS" }] }).esito === "riuscita" && interpretaStatoRichiesta({ requestStatusPerDestination: [{ requestStatus: "SUCCESS" }, { requestStatus: "FAILED" }] }).esito === "fallita" && interpretaStatoRichiesta({ requestStatusPerDestination: [{ requestStatus: "SUCCESS" }, { requestStatus: "PROCESSING" }] }).esito === "in_corso");
  atteso("le ragioni d'errore sono solo codici in maiuscolo (un testo libero o un'email non entra)", (() => { const s = interpretaStatoRichiesta({ requestStatusPerDestination: [{ requestStatus: "FAILED", errorInfo: { errorCounts: [{ reason: "PROCESSING_ERROR_REASON_DUPLICATE_GCLID" }, { reason: "mario@esempio.it" }, { reason: "errore libero con spazi" }] } }] }); return uguali(s.ragioni, ["PROCESSING_ERROR_REASON_DUPLICATE_GCLID"]); })() && testoErroreSicuro(["OK_CODICE", "con@email.it", "x".repeat(100)]) === "OK_CODICE" && testoErroreSicuro(Array.from({ length: 50 }, (_, i) => `CODICE_${i}`)).length <= 300);

  const g = costruisciCorpoGa4(base(), ADESSO, tutti);
  atteso("evento GA4: nome, client_id, timestamp della prima prenotazione, consenso, sessione numerica, identificativo, settore", !!g && g.events[0].name === "demo_booking_confirmed" && g.client_id === "1234567890.1700000000" && g.timestamp_micros === Date.parse("2026-11-10T09:30:00.000Z") * 1000 && g.consent.ad_user_data === "GRANTED" && g.consent.ad_personalization === "GRANTED" && g.events[0].params.session_id === 1700000000 && g.events[0].params.transaction_id === `omnia-demo-${base().id}` && g.events[0].params.demo_sector === "Pulizie e sanificazione" && g.events[0].params.engagement_time_msec === 1, JSON.stringify(g));
  atteso("evento GA4: la personalizzazione degli annunci è negata se manca il consenso facoltativo del modulo", costruisciCorpoGa4(base(), ADESSO, { ...tutti, misurazione: false })?.consent.ad_personalization === "DENIED" && costruisciCorpoGa4(base(), ADESSO, { ...tutti, misurazione: false })?.consent.ad_user_data === "GRANTED");
  atteso("evento GA4: oltre le 72 ore dalla prenotazione si usa «adesso» (GA4 non accetta di più)", (() => { const b = costruisciCorpoGa4(base({ prima_prenotazione_il: "2026-11-05T09:30:00.000Z" }), ADESSO, tutti); return !!b && b.timestamp_micros === ADESSO * 1000; })());
  atteso("evento GA4: nessun dato personale né identificativo di clic nel corpo", !/Mario|Rossi|Pulizie Rossi|3331234567|gmail|GCLID/i.test(JSON.stringify(g)));
  atteso("evento GA4: mai se già inviato, senza i consensi (informativa e cookie), senza client_id o se la prenotazione non è confermata; sessione non numerica omessa", costruisciCorpoGa4(base({ ga4_sent_at: "2026-11-10T09:40:00.000Z" }), ADESSO, tutti) === null && costruisciCorpoGa4(base(), ADESSO, { ...tutti, cookie: false }) === null && costruisciCorpoGa4(base(), ADESSO, { ...tutti, privacy: false }) === null && costruisciCorpoGa4(base({ ga_client_id: null }), ADESSO, tutti) === null && costruisciCorpoGa4(base({ booking_status: "pending" }), ADESSO, tutti) === null && costruisciCorpoGa4(base({ booking_status: "cancelled" }), ADESSO, tutti) === null && costruisciCorpoGa4(base({ booking_status: "superseded" }), ADESSO, tutti) === null && costruisciCorpoGa4(base({ prima_prenotazione_il: null }), ADESSO, tutti) === null && costruisciCorpoGa4(base({ ga_session_id: "abc" }), ADESSO, tutti)?.events[0].params.session_id === undefined);

  // ═════════════════════════ 6. Salvataggio della richiesta (database finto) ═════════════════════════
  console.log("\n--- Salvataggio: contatto, richiesta, consensi, idempotenza, limiti, guasti ---");
  const dati = (validaModuloDemo({ ...ok, adsConsenso: "on" }) as { ok: true; dati: IngressoLead["dati"] }).dati;
  let contatoreChiavi = 0;
  const ingresso = (extra: Partial<IngressoLead> = {}): IngressoLead => ({ dati, chiave: `chiave-invio-${++contatoreChiavi}-xxxxxxxx`, attribuzione: { gclid: "GCLID_abc12345", utm_source: "google", utm_medium: "cpc" }, consensoCookie: true, gaClientId: "1234567890.1700000000", gaSessionId: "1700000000", landingPath: "/piani", ipHash: "iphash1", segretoFirma: SEGRETO_FIRMA, adesso: new Date(ADESSO), ...extra });

  const db1 = new FintoDatabase();
  const s1 = await registraLead(db1.comeClient(), ingresso());
  const l1 = db1.da("demo_leads")[0];
  atteso("un invio crea UN contatto, UNA richiesta «pending» (nessuna prenotazione, nessuna conversione) e i TRE consensi", s1.esito === "creato" && db1.da("demo_contatti").length === 1 && db1.da("demo_leads").length === 1 && db1.da("demo_consensi").length === 3 && l1.booking_status === "pending" && l1.prima_prenotazione_il === null && l1.ads_import_status === "not_ready" && l1.ga4_sent_at === null && db1.da("demo_prenotazioni").length === 0, JSON.stringify(s1));
  atteso("contatto, richiesta e prenotazione sono identificativi DISTINTI: la richiesta punta al contatto, e non porta nessun id di calendario", s1.esito === "creato" && s1.leadId === l1.id && s1.contattoId === db1.da("demo_contatti")[0].id && l1.contatto_id === s1.contattoId && s1.leadId !== s1.contattoId && !("calendar_event_id" in l1) && !("booked_at" in l1));
  atteso("salva dati del modulo, versione dei consensi e l'identificativo di transazione della richiesta (stabile, derivato dal suo id)", l1.full_name === "Mario Rossi" && l1.company === "Pulizie Rossi Srl" && l1.email === "Mario.Rossi@Esempio.it" && l1.email_norm === "mario.rossi@esempio.it" && l1.phone === "+393331234567" && l1.sector === "Pulizie e sanificazione" && l1.privacy_version === VERSIONE_CONSENSI_DEMO && l1.privacy_accepted_at === ADESSO_ISO && l1.ads_measurement_consent === true && l1.ads_measurement_consent_at === ADESSO_ISO && l1.ads_transaction_id === idTransazioneAds(String(l1.id)));
  atteso("con i cookie accettati salva identificativi di clic, utm, percorso e identificativi di Analytics", l1.gclid === "GCLID_abc12345" && l1.utm_source === "google" && l1.utm_medium === "cpc" && l1.landing_path === "/piani" && l1.ga_client_id === "1234567890.1700000000" && l1.ga_session_id === "1700000000" && l1.attribution_consent === true);
  atteso("l'indirizzo IP non si salva mai: solo l'hash", l1.ip_hash === "iphash1" && !Object.keys(l1).some((k) => k === "ip" || k === "ip_address") && hashIp("203.0.113.9", "segreto") === hashIp(" 203.0.113.9 ", "segreto") && hashIp("203.0.113.9", "segreto") !== hashIp("203.0.113.9", "altro") && /^[0-9a-f]{64}$/.test(hashIp("203.0.113.9", "s")) && !hashIp("203.0.113.9", "s").includes("203"));

  const registro = db1.da("demo_consensi") as unknown as ConsensoRegistrato[];
  const verifica1 = verificatoreFirma(SEGRETO_FIRMA);
  atteso("il registro dei consensi della richiesta: tre righe firmate, tutte verificabili, legate alla richiesta, con data, testo (versione e impronta) e fonte", registro.length === 3 && registro.every((r) => r.lead_id === l1.id && r.registrato_il === ADESSO_ISO && /^[0-9a-f]{64}$/.test(r.testo_sha256) && r.versione_testo !== "" && verifica1(r)) && uguali(consensiVerificati(registro, verifica1), { privacy: true, cookie: true, misurazione: true }));
  atteso("… le impronte salvate sono quelle dei testi mostrati nel modulo", registro.find((r) => r.tipo === "informativa_privacy")?.testo_sha256 === sha256Hex(testoCanonico("informativa_privacy")) && registro.find((r) => r.tipo === "misurazione_pubblicitaria")?.testo_sha256 === sha256Hex(TESTI_MODULO_DEMO.ads) && registro.find((r) => r.tipo === "cookie_pubblicitari")?.fonte === "banner_cookie_dichiarato");
  atteso("il registro NON si modifica: un UPDATE sui consensi è vietato (trigger), la revoca è una riga nuova «denied» che annulla il consenso", (await db1.comeClient().from("demo_consensi").update({ valore: "denied" }).eq("lead_id", l1.id)).error?.code === "P0001" && db1.da("demo_consensi").every((r) => r.valore !== "denied" || r.tipo === "cookie_pubblicitari") && (await registraRevoca(db1.comeClient(), String(l1.id), "misurazione_pubblicitaria", "iph", new Date(ADESSO + 3_600_000), SEGRETO_FIRMA)).ok && db1.da("demo_consensi").length === 4 && uguali(consensiVerificati(db1.da("demo_consensi") as unknown as ConsensoRegistrato[], verifica1), { privacy: true, cookie: true, misurazione: false }));

  const db2 = new FintoDatabase();
  await registraLead(db2.comeClient(), ingresso({ consensoCookie: false, dati: { ...dati, adsConsenso: false } }));
  const l2 = db2.da("demo_leads")[0];
  const reg2 = db2.da("demo_consensi") as unknown as ConsensoRegistrato[];
  atteso("SENZA i cookie accettati nessuna attribuzione viene salvata (clic, utm, percorso, identificativi di Analytics)", l2.attribution_consent === false && l2.gclid === null && l2.gbraid === null && l2.wbraid === null && l2.utm_source === null && l2.utm_medium === null && l2.utm_campaign === null && l2.landing_path === null && l2.ga_client_id === null && l2.ga_session_id === null);
  atteso("… e il registro conserva anche il «no»: cookie negati e consenso facoltativo non dato (la scelta è stata offerta)", reg2.length === 3 && statoConsenso(reg2, "cookie_pubblicitari") === "negato" && statoConsenso(reg2, "misurazione_pubblicitaria") === "negato" && statoConsenso(reg2, "informativa_privacy") === "concesso" && l2.ads_measurement_consent === false && l2.ads_measurement_consent_at === null);
  const db2b = new FintoDatabase();
  await registraLead(db2b.comeClient(), ingresso({ segretoFirma: null }));
  atteso("senza segreto la riga si salva ma «non firmata» (firma nulla): non è verificabile, quindi non vale per nessun invio a Google", db2b.da("demo_consensi").length === 3 && db2b.da("demo_consensi").every((r) => r.firma === null) && uguali(consensiVerificati(db2b.da("demo_consensi") as unknown as ConsensoRegistrato[], verifica1), { privacy: false, cookie: false, misurazione: false }));

  // più richieste della stessa persona
  const db3 = new FintoDatabase();
  const a3 = await registraLead(db3.comeClient(), ingresso());
  const b3 = await registraLead(db3.comeClient(), ingresso({ dati: { ...dati, nome: "Mario Rossi Junior", email: "MARIO.ROSSI@esempio.IT", settore: "Multiservizi" }, attribuzione: {}, consensoCookie: false, adesso: new Date(ADESSO + 3600_000) }));
  const leads3 = db3.da("demo_leads");
  atteso("più richieste della STESSA persona (anche con maiuscole diverse nell'email): un solo contatto, DUE richieste, ognuna col suo identificativo", a3.esito === "creato" && b3.esito === "creato" && db3.da("demo_contatti").length === 1 && leads3.length === 2 && a3.leadId !== b3.leadId && a3.contattoId === b3.contattoId && leads3[0].ads_transaction_id !== leads3[1].ads_transaction_id, JSON.stringify([a3, b3]));
  atteso("lo STORICO non si sovrascrive: la prima richiesta resta com'era (nome, settore, attribuzione, data); il contatto riporta gli ultimi dati", leads3[0].full_name === "Mario Rossi" && leads3[0].sector === "Pulizie e sanificazione" && leads3[0].gclid === "GCLID_abc12345" && leads3[0].created_at === ADESSO_ISO && leads3[1].full_name === "Mario Rossi Junior" && leads3[1].gclid === null && leads3[1].created_at === new Date(ADESSO + 3600_000).toISOString() && db3.da("demo_contatti")[0].full_name === "Mario Rossi Junior" && db3.da("demo_contatti")[0].sector === "Multiservizi");
  atteso("ogni richiesta ha i SUOI tre consensi (non si condividono): sei righe, tre per richiesta", db3.da("demo_consensi").length === 6 && [a3, b3].every((x) => x.esito === "creato" && db3.da("demo_consensi").filter((r) => r.lead_id === x.leadId).length === 3));
  const db3b = dbCon({ leads: [confermata({ id: "gia", created_at: "2026-11-01T09:00:00.000Z" })] });
  atteso("chi ha già prenotato può inviare una nuova richiesta (riga nuova; la prenotazione confermata non si tocca)", (await registraLead(db3b.comeClient(), ingresso())).esito === "creato" && db3b.da("demo_leads").length === 2 && db3b.da("demo_leads").find((r) => r.id === "gia")?.booking_status === "confirmed");

  // idempotenza
  const db5 = new FintoDatabase();
  const k = "chiave-fissa-per-un-invio-xxxxxxxx";
  const p1 = await registraLead(db5.comeClient(), ingresso({ chiave: k }));
  const p2 = await registraLead(db5.comeClient(), ingresso({ chiave: k, adesso: new Date(ADESSO + 5_000) }));
  const p3 = await registraLead(db5.comeClient(), ingresso({ chiave: k, adesso: new Date(ADESSO + 9_000) }));
  atteso("IDEMPOTENZA: lo stesso invio ripetuto (doppio clic, nuovo tentativo dopo una risposta persa) non crea doppioni: una sola richiesta, un solo contatto, tre consensi", p1.esito === "creato" && p2.esito === "gia_registrato" && p3.esito === "gia_registrato" && db5.da("demo_leads").length === 1 && db5.da("demo_contatti").length === 1 && db5.da("demo_consensi").length === 3 && p2.esito === "gia_registrato" && p1.esito === "creato" && p2.leadId === p1.leadId && p2.contattoId === p1.contattoId, JSON.stringify([p1, p2, p3]));
  const p4 = await registraLead(db5.comeClient(), ingresso({ chiave: k, dati: { ...dati, email: "mario.corretto@esempio.it" } }));
  atteso("la stessa chiave con un'email DIVERSA non è lo stesso invio (la persona ha corretto l'indirizzo): nasce una richiesta nuova con chiave derivata, e un'ulteriore ripetizione la ritrova", p4.esito === "creato" && db5.da("demo_leads").length === 2 && db5.da("demo_contatti").length === 2 && (await registraLead(db5.comeClient(), ingresso({ chiave: k, dati: { ...dati, email: "mario.corretto@esempio.it" } }))).esito === "gia_registrato" && db5.da("demo_leads").length === 2);
  const dbR = dbCon({ leads: [richiesta({ id: "senza-consensi", idempotency_key: "chiave-interrotta-xxxxxxxx" })], senzaConsensi: true });
  const pr = await registraLead(dbR.comeClient(), ingresso({ chiave: "chiave-interrotta-xxxxxxxx" }));
  atteso("un invio interrotto a metà (richiesta salvata, consensi no) al nuovo tentativo viene completato: i consensi si registrano, senza una seconda richiesta", pr.esito === "gia_registrato" && dbR.da("demo_leads").length === 1 && dbR.da("demo_consensi").length === 3);

  // limiti
  const db4 = new FintoDatabase();
  db4.ora = () => ADESSO_ISO;
  let ultimo = await registraLead(db4.comeClient(), ingresso({ dati: { ...dati, email: "p0@esempio.it" } }));
  for (let i = 1; i < LIMITE_RICHIESTE_PER_IP_ORA; i++) ultimo = await registraLead(db4.comeClient(), ingresso({ dati: { ...dati, email: `p${i}@esempio.it` } }));
  const oltre = await registraLead(db4.comeClient(), ingresso({ dati: { ...dati, email: "extra@esempio.it" } }));
  atteso(`limite anti-abuso: dallo stesso indirizzo (hash) al massimo ${LIMITE_RICHIESTE_PER_IP_ORA} richieste all'ora; la successiva è respinta senza salvare nulla (né richiesta, né contatto, né consensi)`, ultimo.esito === "creato" && oltre.esito === "troppe_richieste" && db4.da("demo_leads").length === LIMITE_RICHIESTE_PER_IP_ORA && db4.da("demo_contatti").length === LIMITE_RICHIESTE_PER_IP_ORA && db4.da("demo_consensi").length === 3 * LIMITE_RICHIESTE_PER_IP_ORA);
  db4.ora = () => new Date(ADESSO + 3_700_000).toISOString();
  atteso("… e dopo un'ora si può di nuovo", (await registraLead(db4.comeClient(), ingresso({ dati: { ...dati, email: "extra@esempio.it" }, adesso: new Date(ADESSO + 3_700_000) }))).esito === "creato");
  const dbE = new FintoDatabase();
  let ultimaE: Awaited<ReturnType<typeof registraLead>> = { esito: "non_salvato", motivo: "errore" };
  for (let i = 0; i < LIMITE_RICHIESTE_PER_EMAIL_GIORNO; i++) ultimaE = await registraLead(dbE.comeClient(), ingresso({ ipHash: null }));
  const oltreE = await registraLead(dbE.comeClient(), ingresso({ ipHash: null }));
  atteso(`limite per email: la stessa persona al massimo ${LIMITE_RICHIESTE_PER_EMAIL_GIORNO} richieste al giorno (anche senza hash dell'indirizzo); oltre, respinta`, ultimaE.esito === "creato" && oltreE.esito === "troppe_richieste" && dbE.da("demo_leads").length === LIMITE_RICHIESTE_PER_EMAIL_GIORNO);
  atteso("senza hash dell'indirizzo il limite per indirizzo non si applica", (await registraLead(new FintoDatabase().comeClient(), ingresso({ ipHash: null }))).esito === "creato");

  const dbRl = new FintoDatabase();
  const kRl = "chiave-replica-limite-xxxxxxxx";
  await registraLead(dbRl.comeClient(), ingresso({ chiave: kRl, dati: { ...dati, email: "q0@esempio.it" } }));
  for (let i = 1; i < LIMITE_RICHIESTE_PER_IP_ORA; i++) await registraLead(dbRl.comeClient(), ingresso({ dati: { ...dati, email: `q${i}@esempio.it` } }));
  const replicaLimite = await registraLead(dbRl.comeClient(), ingresso({ chiave: kRl, dati: { ...dati, email: "q0@esempio.it" } }));
  atteso("un invio RIPETUTO non conta contro i limiti: anche con il limite orario già raggiunto restituisce la richiesta già registrata (senza crearne un'altra)", replicaLimite.esito === "gia_registrato" && dbRl.da("demo_leads").length === LIMITE_RICHIESTE_PER_IP_ORA);

  // guasti: tutto o niente
  const dbG1 = new FintoDatabase();
  dbG1.guasto = (t, tipo) => (t === "demo_consensi" && tipo === "insert" ? { code: "XX000", message: "Mario.Rossi@Esempio.it boom" } : null);
  const logG1 = await conLog(() => registraLead(dbG1.comeClient(), ingresso()));
  atteso("se i CONSENSI non si salvano la richiesta (e il contatto appena creato) si tolgono: non resta mai una richiesta senza la sua prova; esito «non_salvato»", logG1.valore.esito === "non_salvato" && dbG1.da("demo_leads").length === 0 && dbG1.da("demo_contatti").length === 0 && dbG1.da("demo_consensi").length === 0, JSON.stringify(logG1.valore));
  atteso("… e il log non riporta dati personali né messaggi d'errore", !/esempio|Mario|boom|GCLID/i.test(logG1.log), logG1.log);
  const dbG2 = dbCon({ leads: [richiesta({ id: "vecchia" })] });
  dbG2.guasto = (t, tipo) => (t === "demo_consensi" && tipo === "insert" ? { code: "XX000", message: "x" } : null);
  const g2 = await registraLead(dbG2.comeClient(), ingresso());
  atteso("con un contatto già esistente, un guasto sui consensi toglie solo la richiesta nuova: contatto e storico della persona restano", g2.esito === "non_salvato" && dbG2.da("demo_contatti").length === 1 && dbG2.da("demo_leads").length === 1 && dbG2.da("demo_leads")[0].id === "vecchia" && dbG2.da("demo_consensi").length === 3);
  const dbG3 = new FintoDatabase();
  dbG3.guasto = (t, tipo) => (t === "demo_leads" && tipo === "insert" ? { code: "XX000", message: "x" } : null);
  const g3 = await registraLead(dbG3.comeClient(), ingresso());
  atteso("se la richiesta non si salva, il contatto creato apposta non resta orfano", g3.esito === "non_salvato" && dbG3.da("demo_contatti").length === 0 && dbG3.da("demo_leads").length === 0);
  const dbMancante = new FintoDatabase();
  dbMancante.errori.demo_leads = { code: "42P01", message: "relation does not exist" };
  const logMancante = await conLog(() => registraLead(dbMancante.comeClient(), ingresso()));
  atteso("tabelle non ancora create (migrazione non eseguita): «non_salvato» con motivo «schema_assente», senza errori e senza dati nei log", logMancante.valore.esito === "non_salvato" && (logMancante.valore as { motivo?: string }).motivo === "schema_assente" && !/esempio|Mario|GCLID/i.test(logMancante.log), logMancante.log);
  const dbGuasto = new FintoDatabase();
  dbGuasto.errori.demo_leads = { code: "XX000", message: "Mario.Rossi@Esempio.it boom" };
  const logGuasto = await conLog(() => registraLead(dbGuasto.comeClient(), ingresso()));
  atteso("database fuori uso: «non_salvato» con motivo «errore», e il log riporta solo il codice dell'errore (mai il messaggio, che potrebbe contenere dati)", logGuasto.valore.esito === "non_salvato" && (logGuasto.valore as { motivo?: string }).motivo === "errore" && /XX000/.test(logGuasto.log) && !/Mario|esempio|boom/i.test(logGuasto.log), logGuasto.log);

  // ═════════════════════════ 7. Sincronizzazione del calendario (database e fetch finti) ═════════════════════════
  console.log("\n--- Sincronizzazione del calendario: conferma, annullamento, rifiuto, spostamento, abbinamento incerto ---");
  const envCal = { DEMO_CALENDAR_SYNC_ENABLED: "1", GOOGLE_OAUTH_CLIENT_ID: "client-id", GOOGLE_OAUTH_CLIENT_SECRET: "client-segreto", GOOGLE_CALENDAR_REFRESH_TOKEN: "rt-segreto", GOOGLE_CALENDAR_ID: CALENDARIO, DEMO_CALENDAR_TITLE_REGEX: "demo omnia", DEMO_CALENDAR_INTERNAL_EMAILS: "ufficio@omniaitalia.com", DEMO_CONSENT_SIGNING_SECRET: SEGRETO_FIRMA };
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
  const leadDi = (db: FintoDatabase, id = "lead1") => db.da("demo_leads").find((r) => r.id === id)!;
  const pren = (db: FintoDatabase, evento = "evt1") => db.da("demo_prenotazioni").find((r) => r.calendar_event_id === evento)!;

  // 7a. spenta / senza credenziali / errori
  {
    const db = dbCon({});
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
    const dbT = dbCon({});
    const rt = await conLog(() => sincronizzaCalendario(dbT.comeClient(), envCal, ADESSO, cfToken.fetch));
    atteso("token non ottenuto: nessuna chiamata al calendario, errore registrato, nessun segreto nei log", rt.valore.motivo === "token_non_ottenuto" && cfToken.chiamate.every((c) => !c.url.includes("/calendar/")) && dbT.da("demo_sync_stato")[0].last_error === "token_non_ottenuto" && !SEGRETI.some((s) => rt.log.includes(s)), rt.log);
    const cfErr = ambienteCalendario(() => ({ status: 500 }));
    const dbEr = dbCon({ syncToken: "VECCHIO" });
    const re = await sincronizzaCalendario(dbEr.comeClient(), envCal, ADESSO, cfErr.fetch);
    atteso("errore del calendario: nessuna modifica, il token di sincronizzazione NON avanza", re.motivo === "errore_calendario" && dbEr.da("demo_sync_stato")[0].sync_token === "VECCHIO" && dbEr.da("demo_sync_stato")[0].last_error === "errore_calendario");
    const cfRete = fetchFinto((c) => (c.url.includes("oauth2") ? { status: 200, json: { access_token: "at-segreto" } } : { status: 200, json: { items: [] } }));
    const cfReteKo = { ...cfRete, fetch: (async (u: RequestInfo | URL, i?: RequestInit) => { if (String(u).includes("/calendar/v3/")) throw new Error("rete"); return cfRete.fetch(u, i); }) as typeof fetch };
    const dbRete = dbCon({ syncToken: "VECCHIO" });
    const rr = await sincronizzaCalendario(dbRete.comeClient(), envCal, ADESSO, cfReteKo.fetch);
    atteso("rete caduta durante la lettura del calendario: nessuna eccezione, errore registrato, token fermo", rr.motivo === "errore_calendario" && dbRete.da("demo_sync_stato")[0].sync_token === "VECCHIO");
  }

  // 7b. conferma, idempotenza, token incrementale
  {
    const db = dbCon({ leads: [richiesta({ id: "lead1" })] });
    const cf = ambienteCalendario((c) => ({ status: 200, json: { items: [ev()], nextSyncToken: c.url.includes("syncToken") ? "TOKEN2" : "TOKEN1" } }));
    const { valore: r1s, log } = await conLog(() => sincronizzaCalendario(db.comeClient(), envCal, ADESSO, cf.fetch));
    const l = leadDi(db);
    atteso("prenotazione confermata e abbinata: la RICHIESTA passa a «confirmed» con la data della prima prenotazione; la prenotazione è una riga a parte (calendario, evento, orari)", r1s.eseguita && r1s.confermati === 1 && r1s.casi === 0 && r1s.errori === 0 && l.booking_status === "confirmed" && l.prima_prenotazione_il === "2026-11-10T09:30:00.000Z" && db.da("demo_prenotazioni").length === 1 && pren(db).lead_id === "lead1" && pren(db).calendar_id === CALENDARIO && pren(db).stato === "confirmed" && pren(db).booked_at === "2026-11-10T09:30:00.000Z" && pren(db).starts_at === "2026-11-12T09:00:00.000Z" && pren(db).starts_at_originale === "2026-11-12T09:00:00.000Z", JSON.stringify([r1s, l, db.da("demo_prenotazioni")]));
    atteso("… e la conversione Google Ads diventa «ready» (informativa + cookie + clic), pronta ma NON ancora inviata", l.ads_import_status === "ready" && l.ads_request_id === null && l.ads_sent_at === null && l.ads_attempts === 0 && l.ga4_sent_at === null);
    atteso("prima lettura: completa (timeMin), con eventi cancellati e ripetizioni espanse; legge il calendario in sola lettura con il token", (() => { const u = chiamateCalendario(cf)[0]; return !!u && u.url.includes("showDeleted=true") && u.url.includes("singleEvents=true") && u.url.includes("timeMin=") && !u.url.includes("syncToken") && u.intestazioni.authorization === "Bearer at-segreto" && u.metodo === "GET"; })());
    atteso("il token di sincronizzazione viene salvato, e nessun segreto o dato personale finisce nei log o nel risultato", db.da("demo_sync_stato")[0].sync_token === "TOKEN1" && db.da("demo_sync_stato")[0].last_error === null && !SEGRETI.some((s) => log.includes(s) || JSON.stringify(r1s).includes(s)), log);
    const r2s = await sincronizzaCalendario(db.comeClient(), envCal, ADESSO + 600_000, cf.fetch);
    atteso("seconda esecuzione: lettura incrementale (syncToken, senza timeMin) e rielaborare lo stesso evento NON cambia nulla (idempotente: nessuna seconda conferma, nessuna seconda prenotazione)", r2s.confermati === 0 && r2s.casi === 0 && r2s.riprogrammati === 0 && (() => { const u = chiamateCalendario(cf)[1]; return u.url.includes("syncToken=TOKEN1") && !u.url.includes("timeMin"); })() && leadDi(db).prima_prenotazione_il === "2026-11-10T09:30:00.000Z" && db.da("demo_leads").length === 1 && db.da("demo_prenotazioni").length === 1 && db.da("demo_sync_stato")[0].sync_token === "TOKEN2");
  }

  // 7c. spostamento, cancellazione, rifiuto, riconferma
  {
    const db = dbCon({ leads: [richiesta({ id: "lead1" })] });
    let evento = ev();
    const cf = ambienteCalendario(() => ({ status: 200, json: { items: [evento], nextSyncToken: "T" } }));
    await sincronizzaCalendario(db.comeClient(), envCal, ADESSO, cf.fetch);
    evento = ev({ start: { dateTime: "2026-11-13T15:00:00+01:00" }, updated: "2026-11-11T08:00:00Z" });
    const rm = await sincronizzaCalendario(db.comeClient(), envCal, ADESSO + 60_000, cf.fetch);
    atteso("evento SPOSTATO: cambia solo l'orario della demo (registrato anche quello originale e il momento dello spostamento); la prima prenotazione, la conferma e la conversione restano", rm.confermati === 0 && rm.riprogrammati === 1 && pren(db).starts_at === "2026-11-13T14:00:00.000Z" && pren(db).starts_at_originale === "2026-11-12T09:00:00.000Z" && pren(db).riprogrammata_il === new Date(ADESSO + 60_000).toISOString() && pren(db).booked_at === "2026-11-10T09:30:00.000Z" && leadDi(db).booking_status === "confirmed" && leadDi(db).prima_prenotazione_il === "2026-11-10T09:30:00.000Z" && leadDi(db).ads_import_status === "ready");
    const rm2 = await sincronizzaCalendario(db.comeClient(), envCal, ADESSO + 120_000, cf.fetch);
    atteso("lo stesso spostamento riletto non si conta due volte", rm2.riprogrammati === 0 && pren(db).riprogrammata_il === new Date(ADESSO + 60_000).toISOString());
    evento = ev({ status: "cancelled" });
    const rc = await sincronizzaCalendario(db.comeClient(), envCal, ADESSO + 180_000, cf.fetch);
    atteso("evento CANCELLATO: la prenotazione passa a «cancelled»; la richiesta, senza altre prenotazioni valide, a «cancelled», e la conversione non partirà (skipped_cancelled)", rc.cancellati === 1 && pren(db).stato === "cancelled" && pren(db).cancelled_at === new Date(ADESSO + 180_000).toISOString() && leadDi(db).booking_status === "cancelled" && leadDi(db).ads_import_status === "skipped_cancelled" && leadDi(db).ads_next_attempt_at === null, JSON.stringify([rc, leadDi(db)]));
    const rc2 = await sincronizzaCalendario(db.comeClient(), envCal, ADESSO + 240_000, cf.fetch);
    atteso("la cancellazione rivista non fa danni (idempotente)", rc2.cancellati === 0 && leadDi(db).booking_status === "cancelled" && db.da("demo_prenotazioni").length === 1);
    evento = ev({ status: "confirmed" });
    const rr = await sincronizzaCalendario(db.comeClient(), envCal, ADESSO + 300_000, cf.fetch);
    atteso("lo stesso evento ripristinato: prenotazione e richiesta tornano «confirmed», la conversione torna «ready», la PRIMA prenotazione resta quella di allora", rr.confermati === 1 && pren(db).stato === "confirmed" && pren(db).cancelled_at === null && leadDi(db).booking_status === "confirmed" && leadDi(db).ads_import_status === "ready" && leadDi(db).prima_prenotazione_il === "2026-11-10T09:30:00.000Z");
    // chi ha prenotato rifiuta l'invito
    evento = ev({ attendees: [{ email: "ufficio@omniaitalia.com", organizer: true, self: true }, { email: "Mario.Rossi@esempio.it", responseStatus: "declined" }] });
    const rd = await sincronizzaCalendario(db.comeClient(), envCal, ADESSO + 360_000, cf.fetch);
    atteso("chi ha prenotato RIFIUTA l'invito (l'evento esiste ancora): equivale ad annullare, come per Google", rd.cancellati === 1 && pren(db).stato === "cancelled" && leadDi(db).booking_status === "cancelled" && leadDi(db).ads_import_status === "skipped_cancelled");
    // evento cancellato con pochissimi campi
    evento = ev({ attendees: [{ email: "ufficio@omniaitalia.com", organizer: true, self: true }, { email: "mario.rossi@esempio.it" }] });
    await sincronizzaCalendario(db.comeClient(), envCal, ADESSO + 400_000, cf.fetch);
    evento = { id: "evt1", status: "cancelled" };
    const rmin = await sincronizzaCalendario(db.comeClient(), envCal, ADESSO + 420_000, cf.fetch);
    atteso("evento cancellato che arriva con SOLO id e stato: si annulla lo stesso (si cerca per id tra le prenotazioni note)", rmin.cancellati === 1 && pren(db).stato === "cancelled" && leadDi(db).booking_status === "cancelled");
  }
  {
    // cancellazione DOPO l'invio della conversione: lo stato Ads non si tocca
    const db = dbCon({ leads: [confermata({ id: "lead1", ads_import_status: "accepted" })], prenotazioni: [prenotazione()] });
    await sincronizzaCalendario(db.comeClient(), envCal, ADESSO, ambienteCalendario(() => ({ status: 200, json: { items: [ev({ status: "cancelled" })], nextSyncToken: "T" } })).fetch);
    atteso("cancellazione dopo una conversione già accettata: la richiesta è «cancelled» ma lo stato Ads «accepted» non viene riscritto", leadDi(db).booking_status === "cancelled" && leadDi(db).ads_import_status === "accepted");
    await sincronizzaCalendario(db.comeClient(), envCal, ADESSO + 60_000, ambienteCalendario(() => ({ status: 200, json: { items: [ev()], nextSyncToken: "T" } })).fetch);
    atteso("… e se poi la demo torna valida la conversione già accettata NON viene riarmata (nessun secondo invio)", leadDi(db).booking_status === "confirmed" && leadDi(db).ads_import_status === "accepted" && leadDi(db).ads_attempts === 0);
  }
  {
    // annullata e riprenotata (evento NUOVO), nello stesso gruppo: prima la cancellazione, poi la nuova
    const db = dbCon({ leads: [confermata({ id: "lead1" })], prenotazioni: [prenotazione()] });
    const cf = ambienteCalendario(() => ({ status: 200, json: { items: [ev({ id: "evt2", created: "2026-11-11T08:00:00Z", start: { dateTime: "2026-11-14T10:00:00+01:00" } }), ev({ id: "evt1", status: "cancelled" })], nextSyncToken: "T" } }));
    const rn = await sincronizzaCalendario(db.comeClient(), envCal, ADESSO, cf.fetch);
    atteso("annullata e riprenotata con un evento NUOVO (anche se arriva prima nell'elenco): la richiesta è di nuovo «confirmed» con DUE prenotazioni (una annullata, una valida) e UN solo caso di conversione", rn.cancellati === 1 && rn.confermati === 1 && rn.casi === 0 && db.da("demo_prenotazioni").length === 2 && pren(db, "evt1").stato === "cancelled" && pren(db, "evt2").stato === "confirmed" && pren(db, "evt2").lead_id === "lead1" && leadDi(db).booking_status === "confirmed" && leadDi(db).prima_prenotazione_il === "2026-11-10T09:30:00.000Z" && leadDi(db).ads_import_status === "ready" && db.da("demo_leads").length === 1, JSON.stringify([rn, db.da("demo_prenotazioni")]));
  }
  {
    // la nuova prenotazione arriva MENTRE la vecchia è ancora valida: non si sceglie, si segnala; poi la cancellazione arriva dopo
    const db = dbCon({ leads: [confermata({ id: "lead1" })], prenotazioni: [prenotazione()] });
    const rd = await sincronizzaCalendario(db.comeClient(), envCal, ADESSO, ambienteCalendario(() => ({ status: 200, json: { items: [ev({ id: "evt2", created: "2026-11-11T08:00:00Z" })], nextSyncToken: "T" } })).fetch);
    atteso("una seconda prenotazione mentre la prima è ancora valida: caso «prenotazione_duplicata» (a mano), nessuna seconda conversione, la richiesta non cambia", rd.casi === 1 && db.da("demo_calendar_casi")[0].motivo === "prenotazione_duplicata" && db.da("demo_prenotazioni").length === 1 && leadDi(db).booking_status === "confirmed");
  }

  // 7d. riparazione dopo un'interruzione, e guasti
  {
    const db = dbCon({ leads: [richiesta({ id: "lead1" })] });
    const cf = ambienteCalendario(() => ({ status: 200, json: { items: [ev()], nextSyncToken: "NUOVO" } }));
    db.guasto = (t, tipo) => (t === "demo_leads" && tipo === "update" ? { code: "XX000", message: "boom" } : null);
    const r1 = await sincronizzaCalendario(db.comeClient(), envCal, ADESSO, cf.fetch);
    atteso("scrittura interrotta a metà (prenotazione salvata, richiesta non aggiornata): errore segnalato, il token NON avanza", r1.errori === 1 && db.da("demo_prenotazioni").length === 1 && leadDi(db).booking_status === "pending" && db.da("demo_sync_stato")[0].sync_token === null && db.da("demo_sync_stato")[0].last_error === "errori_su_eventi");
    db.guasto = null;
    const r2 = await sincronizzaCalendario(db.comeClient(), envCal, ADESSO + 600_000, cf.fetch);
    atteso("… al giro dopo la prenotazione già nota COMPLETA la richiesta: confermata, senza doppioni", r2.errori === 0 && r2.confermati === 1 && db.da("demo_prenotazioni").length === 1 && leadDi(db).booking_status === "confirmed" && leadDi(db).ads_import_status === "ready" && db.da("demo_sync_stato")[0].sync_token === "NUOVO");
  }
  {
    const db = dbCon({ leads: [richiesta({ id: "lead1" })], prenotazioni: [prenotazione()] });
    const r = await sincronizzaCalendario(db.comeClient(), envCal, ADESSO, ambienteCalendario(() => ({ status: 200, json: { items: [ev()], nextSyncToken: "T" } })).fetch);
    atteso("una prenotazione già registrata con la richiesta rimasta «pending» (interruzione precedente) viene sistemata anche con una lettura nuova", r.confermati === 1 && leadDi(db).booking_status === "confirmed" && leadDi(db).prima_prenotazione_il === "2026-11-10T09:30:00.000Z");
  }
  {
    const dbG = dbCon({ leads: [richiesta({ id: "lead1" })] });
    const cfG = ambienteCalendario(() => ({ status: 200, json: { items: [ev()], nextSyncToken: "NUOVO2" } }));
    dbG.errori.demo_leads = { code: "XX000", message: "guasto" };
    const rg = await sincronizzaCalendario(dbG.comeClient(), envCal, ADESSO, cfG.fetch);
    atteso("errore su un evento: segnalato, e il token NON avanza (la prossima esecuzione rilegge gli stessi eventi senza perdere nulla)", rg.errori === 1 && dbG.da("demo_sync_stato")[0].sync_token === null && dbG.da("demo_sync_stato")[0].last_error === "errori_su_eventi");
    const dbL = dbCon({ leads: [richiesta({ id: "lead1" })] });
    dbL.guasto = (t, tipo) => (t === "demo_prenotazioni" && tipo === "insert" ? { code: "XX000", message: "x" } : null);
    const rl = await sincronizzaCalendario(dbL.comeClient(), envCal, ADESSO, cfG.fetch);
    atteso("se la prenotazione non si salva la richiesta NON passa a «confirmed» (niente conferma senza prenotazione)", rl.errori === 1 && leadDi(dbL).booking_status === "pending" && dbL.da("demo_prenotazioni").length === 0);
  }

  {
    // due prenotazioni valide per la stessa richiesta: se ne annulla una, l'altra la tiene «confermata»
    const db = dbCon({ leads: [confermata({ id: "lead1" })], prenotazioni: [prenotazione({ id: "pa", calendar_event_id: "evt1" }), prenotazione({ id: "pb", calendar_event_id: "evt2" })] });
    const rs = await sincronizzaCalendario(db.comeClient(), envCal, ADESSO, ambienteCalendario(() => ({ status: 200, json: { items: [ev({ id: "evt1", status: "cancelled" })], nextSyncToken: "T" } })).fetch);
    atteso("se una richiesta ha due prenotazioni valide e se ne annulla una, l'altra la tiene «confermata» (e la conversione resta pronta)", rs.cancellati === 1 && pren(db, "evt1").stato === "cancelled" && pren(db, "evt2").stato === "confirmed" && leadDi(db).booking_status === "confirmed" && leadDi(db).ads_import_status === "ready");
  }
  {
    // un caso rimasto aperto si chiude da solo quando la prenotazione viene poi abbinata
    const db = dbCon({ leads: [richiesta({ id: "lead1" })], casi: [{ calendar_event_id: "evt1", calendar_id: CALENDARIO, motivo: "nessun_lead", risolto: false, created_at: "2026-11-10T09:31:00.000Z" }] });
    await sincronizzaCalendario(db.comeClient(), envCal, ADESSO, ambienteCalendario(() => ({ status: 200, json: { items: [ev()], nextSyncToken: "T" } })).fetch);
    atteso("un caso aperto per lo stesso evento si chiude da solo quando la prenotazione viene abbinata", db.da("demo_calendar_casi")[0].risolto === true && leadDi(db).booking_status === "confirmed");
  }

  // 7e. abbinamento incerto: verifica manuale, nessuna conversione
  {
    const db = dbCon({ leads: [richiesta({ id: "lead1" })] });
    const cf = ambienteCalendario(() => ({ status: 200, json: { items: [ev({ id: "evtX", attendees: [{ email: "sconosciuto@altra.it" }] })], nextSyncToken: "T" } }));
    const { valore: rs, log } = await conLog(() => sincronizzaCalendario(db.comeClient(), envCal, ADESSO, cf.fetch));
    atteso("prenotazione senza richiesta corrispondente: registrata tra i casi da verificare, la richiesta resta «pending», nessuna prenotazione, nessuna conversione", rs.casi === 1 && rs.confermati === 0 && leadDi(db).booking_status === "pending" && leadDi(db).ads_import_status === "not_ready" && db.da("demo_prenotazioni").length === 0 && db.da("demo_calendar_casi").length === 1 && db.da("demo_calendar_casi")[0].motivo === "nessun_lead" && db.da("demo_calendar_casi")[0].risolto === false);
    atteso("… e il caso non compare nei log con l'email del partecipante", !/sconosciuto@altra\.it/.test(log) && !/altra\.it/.test(log), log);
    await sincronizzaCalendario(db.comeClient(), envCal, ADESSO, cf.fetch);
    atteso("riletto più volte, lo stesso evento resta UN solo caso (vincolo di unicità sull'evento)", db.da("demo_calendar_casi").length === 1);
    db.da("demo_calendar_casi")[0].risolto = true;
    await sincronizzaCalendario(db.comeClient(), envCal, ADESSO, cf.fetch);
    atteso("un caso già chiuso a mano non si riapre da solo", db.da("demo_calendar_casi")[0].risolto === true);
  }
  {
    // più persone invitate, ognuna con la sua richiesta
    const db = dbCon({ leads: [richiesta({ id: "lead1" }), richiesta({ id: "lead2", email_norm: "anna@esempio.it", email: "Anna@esempio.it" })] });
    const rs = await sincronizzaCalendario(db.comeClient(), envCal, ADESSO, ambienteCalendario(() => ({ status: 200, json: { items: [ev({ attendees: [{ email: "mario.rossi@esempio.it" }, { email: "anna@esempio.it" }] })], nextSyncToken: "T" } })).fetch);
    atteso("due persone invitate, ognuna con la sua richiesta: NESSUNA conversione (abbinamento non univoco), caso «piu_lead»", rs.casi === 1 && rs.confermati === 0 && db.da("demo_calendar_casi")[0].motivo === "piu_lead" && db.da("demo_leads").every((r) => r.booking_status === "pending") && db.da("demo_prenotazioni").length === 0);
  }
  {
    // la stessa persona fa due richieste ravvicinate: vale l'ultima, la prima resta nello storico come «superseded»
    const db = dbCon({ leads: [richiesta({ id: "A", created_at: "2026-11-10T09:00:00.000Z" }), richiesta({ id: "B", created_at: "2026-11-10T10:00:00.000Z" })] });
    const rs = await sincronizzaCalendario(db.comeClient(), envCal, ADESSO, ambienteCalendario(() => ({ status: 200, json: { items: [ev({ created: "2026-11-10T11:00:00Z" })], nextSyncToken: "T" } })).fetch);
    atteso("più richieste della stessa persona nello stesso giorno: la prenotazione va all'ULTIMA; la precedente resta nello storico come «superseded» (con il riferimento), senza conversione", rs.confermati === 1 && rs.sostituite === 1 && leadDi(db, "B").booking_status === "confirmed" && leadDi(db, "A").booking_status === "superseded" && leadDi(db, "A").superseded_by === "B" && leadDi(db, "A").ads_import_status === "not_ready" && leadDi(db, "B").ads_import_status === "ready" && pren(db).lead_id === "B" && db.da("demo_leads").length === 2);
    atteso("… la richiesta sostituita non partirà MAI verso GA4 né Google Ads (non è «confirmed»)", leadDi(db, "A").booking_status !== "confirmed" && leadDi(db, "A").prima_prenotazione_il === null);
    const db2 = dbCon({ leads: [richiesta({ id: "A", created_at: "2026-11-08T09:00:00.000Z" }), richiesta({ id: "B", created_at: "2026-11-10T10:00:00.000Z" })] });
    const rs2 = await sincronizzaCalendario(db2.comeClient(), envCal, ADESSO, ambienteCalendario(() => ({ status: 200, json: { items: [ev({ created: "2026-11-10T11:00:00Z" })], nextSyncToken: "T" } })).fetch);
    atteso("due richieste a più di 24 ore di distanza: caso «piu_lead», nessuna conferma e nessuna conversione", rs2.casi === 1 && rs2.confermati === 0 && db2.da("demo_calendar_casi")[0].motivo === "piu_lead" && db2.da("demo_leads").every((r) => r.booking_status === "pending"));
    const db3c = dbCon({ leads: [richiesta({ id: "A", created_at: "2026-11-10T09:00:00.000Z" }), richiesta({ id: "B", created_at: "2026-11-10T10:00:00.000Z" })] });
    const rs3 = await sincronizzaCalendario(db3c.comeClient(), { ...envCal, DEMO_MULTI_RICHIESTA: "manuale" }, ADESSO, ambienteCalendario(() => ({ status: 200, json: { items: [ev({ created: "2026-11-10T11:00:00Z" })], nextSyncToken: "T" } })).fetch);
    atteso("con DEMO_MULTI_RICHIESTA=manuale due richieste ravvicinate vanno comunque a mano", rs3.casi === 1 && rs3.confermati === 0 && db3c.da("demo_leads").every((r) => r.booking_status === "pending"));
  }
  {
    const db = dbCon({ leads: [confermata({ id: "lead1" })], prenotazioni: [prenotazione()] });
    const rd = await sincronizzaCalendario(db.comeClient(), envCal, ADESSO, ambienteCalendario(() => ({ status: 200, json: { items: [ev({ id: "evt2", created: "2026-11-10T09:45:00Z" })], nextSyncToken: "T" } })).fetch);
    atteso("seconda prenotazione della stessa persona: caso «prenotazione_duplicata», nessuna seconda conversione e la richiesta non cambia", rd.casi === 1 && db.da("demo_calendar_casi")[0].motivo === "prenotazione_duplicata" && db.da("demo_prenotazioni").length === 1 && db.da("demo_leads").length === 1);
  }
  {
    const db = dbCon({ leads: [richiesta({ id: "lead1" })] });
    const rr = await sincronizzaCalendario(db.comeClient(), envCal, ADESSO, ambienteCalendario(() => ({ status: 200, json: { items: [ev({ id: "evtR", summary: "Riunione interna" })], nextSyncToken: "T" } })).fetch);
    atteso("un evento che non è una demo (titolo diverso) si ignora del tutto: nessun caso, nessuna conferma", rr.confermati === 0 && rr.casi === 0 && db.da("demo_calendar_casi").length === 0 && leadDi(db).booking_status === "pending");
  }

  // 7f. consenso verificabile alla conferma
  {
    const dbS = dbCon({ leads: [richiesta({ id: "lead1" }), richiesta({ id: "lead2", email_norm: "anna@esempio.it", email: "Anna@esempio.it", contatto_id: "contatto-anna" })], consensi: { lead1: { cookie: false, ads: false }, lead2: { privacy: false } } });
    const rs = await sincronizzaCalendario(dbS.comeClient(), envCal, ADESSO, ambienteCalendario(() => ({ status: 200, json: { items: [ev(), ev({ id: "evt-anna", attendees: [{ email: "anna@esempio.it" }] })], nextSyncToken: "T" } })).fetch);
    atteso("senza cookie e senza consenso dell'email la prenotazione si conferma ma la conversione NON è pronta (skipped_no_consent); senza l'informativa idem", rs.confermati === 2 && leadDi(dbS).booking_status === "confirmed" && leadDi(dbS).ads_import_status === "skipped_no_consent" && leadDi(dbS, "lead2").ads_import_status === "skipped_no_consent");
    const dbM = dbCon({ leads: [richiesta({ id: "lead1" })], consensi: { lead1: { cookie: false } } });
    const rigaCookie = dbM.da("demo_consensi").find((r) => r.tipo === "cookie_pubblicitari")!;
    rigaCookie.valore = "granted"; // qualcuno altera il registro a mano, senza poter rifare la firma
    await sincronizzaCalendario(dbM.comeClient(), envCal, ADESSO, ambienteCalendario(() => ({ status: 200, json: { items: [ev()], nextSyncToken: "T" } })).fetch);
    atteso("un consenso ALTERATO a mano nel registro (firma che non torna) non vale: la conversione non è pronta", leadDi(dbM).ads_import_status === "skipped_no_consent");
  }

  // 7g. token scaduto (410) e pagine
  {
    const db = dbCon({ leads: [richiesta({ id: "lead1" })], syncToken: "SCADUTO" });
    const cf = ambienteCalendario((c) => (c.url.includes("syncToken=SCADUTO") ? { status: 410 } : { status: 200, json: { items: [ev()], nextSyncToken: "NUOVO" } }));
    const r410 = await sincronizzaCalendario(db.comeClient(), envCal, ADESSO, cf.fetch);
    atteso("token scaduto (410): si rifà una lettura completa e si salva il token nuovo", r410.letturaCompleta === true && r410.confermati === 1 && db.da("demo_sync_stato")[0].sync_token === "NUOVO" && chiamateCalendario(cf).length === 2 && chiamateCalendario(cf)[1].url.includes("timeMin") && !chiamateCalendario(cf)[1].url.includes("syncToken"));
    const dbP = dbCon({ leads: [richiesta({ id: "lead1" })] });
    const cfP = ambienteCalendario((c, n) => (n === 0 ? { status: 200, json: { items: [ev({ id: "x1", summary: "Altro" })], nextPageToken: "P2" } } : { status: 200, json: { items: [ev()], nextSyncToken: "FINE" } }));
    const rp = await sincronizzaCalendario(dbP.comeClient(), envCal, ADESSO, cfP.fetch);
    atteso("più pagine di eventi: si leggono tutte (pageToken) e il token arriva dall'ultima", rp.eventiVisti === 2 && rp.confermati === 1 && chiamateCalendario(cfP)[1].url.includes("pageToken=P2") && dbP.da("demo_sync_stato")[0].sync_token === "FINE");
  }

  // 7h. blocco contro le esecuzioni in parallelo, e giro completo
  console.log("\n--- Blocco e giro del cron: due esecuzioni non si sovrappongono ---");
  {
    const db = new FintoDatabase();
    const b1 = await acquisisciBlocco(db.comeClient(), ADESSO);
    const b2 = await acquisisciBlocco(db.comeClient(), ADESSO + 1_000);
    atteso("il blocco lo prende UNA esecuzione sola: la seconda trova «occupato»", b1 === "acquisito" && b2 === "occupato");
    atteso("scade da solo dopo 5 minuti (se l'esecuzione muore senza rilasciarlo)", (await acquisisciBlocco(db.comeClient(), ADESSO + DURATA_BLOCCO_MS - 1)) === "occupato" && (await acquisisciBlocco(db.comeClient(), ADESSO + DURATA_BLOCCO_MS + 1)) === "acquisito" && DURATA_BLOCCO_MS === 300_000);
    await rilasciaBlocco(db.comeClient());
    atteso("rilasciato, si può riprendere subito", db.da("demo_sync_stato")[0].lock_until === null && (await acquisisciBlocco(db.comeClient(), ADESSO + 2_000)) === "acquisito");
    const dbSenzaRiga = new FintoDatabase({ demo_sync_stato: [] });
    atteso("se la riga di stato non c'è ancora la crea e prende il blocco", (await acquisisciBlocco(dbSenzaRiga.comeClient(), ADESSO)) === "acquisito" && dbSenzaRiga.da("demo_sync_stato").length === 1);
    const dbMancante2 = new FintoDatabase();
    dbMancante2.errori.demo_sync_stato = { code: "42P01", message: "x" };
    atteso("migrazione non eseguita: «non_disponibile»", (await acquisisciBlocco(dbMancante2.comeClient(), ADESSO)) === "non_disponibile");
    // la corsa vera: due richieste "insieme" leggono lo stesso stato, ma solo una scrittura condizionata vince
    const dbCorsa = new FintoDatabase();
    const letture = await Promise.all([acquisisciBlocco(dbCorsa.comeClient(), ADESSO), acquisisciBlocco(dbCorsa.comeClient(), ADESSO)]);
    atteso("due esecuzioni partite nello stesso istante: una sola ottiene il blocco", letture.filter((x) => x === "acquisito").length === 1 && letture.filter((x) => x === "occupato").length === 1, JSON.stringify(letture));
  }
  {
    const cfTutto = fetchFinto(() => ({ status: 200, json: { items: [] } }));
    const dbOff = dbCon({});
    const off = await eseguiCicloDemo(dbOff.comeClient(), {}, ADESSO, cfTutto.fetch);
    atteso("giro del cron con TUTTO spento: non fa nulla (nessuna lettura del database, nessuna chiamata di rete)", !off.eseguito && off.motivo === "tutto_spento" && dbOff.operazioni.length === 0 && cfTutto.chiamate.length === 0);
    const dbOcc = dbCon({});
    dbOcc.da("demo_sync_stato")[0].lock_until = new Date(ADESSO + 60_000).toISOString();
    const cfOcc = ambienteCalendario(() => ({ status: 200, json: { items: [], nextSyncToken: "T" } }));
    const occ = await eseguiCicloDemo(dbOcc.comeClient(), { ...envCal, DEMO_GA4_MP_ENABLED: "1", GA4_API_SECRET: "ga-segreto" }, ADESSO, cfOcc.fetch);
    atteso("giro del cron mentre un altro è in corso: «occupato», NESSUNA chiamata di rete (né calendario, né GA4, né Ads)", !occ.eseguito && occ.motivo === "occupato" && cfOcc.chiamate.length === 0);
    const dbOk = dbCon({ leads: [richiesta({ id: "lead1" })] });
    const cfOk = fetchFinto((c) => (c.url.startsWith("https://oauth2.googleapis.com/token") ? { status: 200, json: { access_token: "at-segreto" } } : c.url.includes("/calendar/v3/") ? { status: 200, json: { items: [ev()], nextSyncToken: "T" } } : c.url.includes("google-analytics.com") ? { status: 204 } : { status: 404 }));
    const ok1 = await eseguiCicloDemo(dbOk.comeClient(), { ...envCal, DEMO_GA4_MP_ENABLED: "1", GA4_API_SECRET: "ga-segreto" }, ADESSO, cfOk.fetch);
    atteso("giro completo: calendario → GA4 → Ads in sequenza, e il blocco viene sempre rilasciato alla fine", ok1.eseguito === true && ok1.calendario.eseguita === true && leadDi(dbOk).booking_status === "confirmed" && leadDi(dbOk).ga4_sent_at === ADESSO_ISO && cfOk.chiamate.filter((c) => c.url.includes("google-analytics.com")).length === 1 && dbOk.da("demo_sync_stato")[0].lock_until === null, JSON.stringify(ok1));
    atteso("… e il risultato del giro non contiene dati personali né segreti", !SEGRETI.some((s) => JSON.stringify(ok1).includes(s)));

    // migrazione 0099 (registro delle prove reali GA4) NON ancora eseguita: il giro funziona come prima, il calendario continua a
    // sincronizzare e la richiesta confermata non viene bloccata da una tabella che non c'è
    const dbSenza0099 = dbCon({ leads: [richiesta({ id: "lead1" })] });
    dbSenza0099.errori.demo_ga4_prove = { code: "42P01", message: 'relation "public.demo_ga4_prove" does not exist' };
    const cfSenza0099 = fetchFinto((c) => (c.url.startsWith("https://oauth2.googleapis.com/token") ? { status: 200, json: { access_token: "at-segreto" } } : c.url.includes("/calendar/v3/") ? { status: 200, json: { items: [ev()], nextSyncToken: "T" } } : c.url.includes("google-analytics.com") ? { status: 204 } : { status: 404 }));
    const senza0099 = await eseguiCicloDemo(dbSenza0099.comeClient(), { ...envCal, DEMO_GA4_MP_ENABLED: "1", GA4_API_SECRET: "ga-segreto" }, ADESSO, cfSenza0099.fetch);
    atteso("tabella delle prove GA4 (migrazione 0099) non ancora creata: il giro del cron funziona come prima (calendario sincronizzato, richiesta confermata, blocco rilasciato)", senza0099.eseguito === true && senza0099.calendario.eseguita === true && leadDi(dbSenza0099).booking_status === "confirmed" && pren(dbSenza0099).stato === "confirmed" && dbSenza0099.da("demo_sync_stato")[0].lock_until === null && dbSenza0099.da("demo_sync_stato")[0].last_error === null, JSON.stringify(senza0099));
    atteso("… e anche il passo GA4 va come prima (una sola chiamata, senza errori)", cfSenza0099.chiamate.filter((c) => c.url.includes("google-analytics.com")).length === 1 && "ga4" in senza0099 && (senza0099.ga4 as { errori?: number }).errori === 0);
    const dbDbg0099 = dbCon({ leads: [richiesta({ id: "lead1" })] });
    dbDbg0099.errori.demo_ga4_prove = { code: "PGRST205", message: "Could not find the table 'public.demo_ga4_prove' in the schema cache" };
    const cfDbg0099 = fetchFinto((c) => (c.url.startsWith("https://oauth2.googleapis.com/token") ? { status: 200, json: { access_token: "at-segreto" } } : c.url.includes("/calendar/v3/") ? { status: 200, json: { items: [ev()], nextSyncToken: "T" } } : c.url.includes("google-analytics.com") ? { status: 200, json: { validationMessages: [] } } : { status: 404 }));
    const dbg0099 = await eseguiCicloDemo(dbDbg0099.comeClient(), { ...envCal, DEMO_GA4_MP_ENABLED: "1", DEMO_GA4_MP_DEBUG: "1", GA4_API_SECRET: "ga-segreto" }, ADESSO, cfDbg0099.fetch);
    atteso("tabella 0099 assente (errore di cache dello schema di PostgREST) con GA4 in DEBUG, come oggi in produzione: calendario ok, evento SOLO validato (mai inviato, nessuna scrittura sulla richiesta)", dbg0099.eseguito === true && dbg0099.calendario.eseguita === true && cfDbg0099.chiamate.filter((c) => c.url.includes("/debug/mp/collect")).length === 1 && cfDbg0099.chiamate.filter((c) => c.url.includes("google-analytics.com") && !c.url.includes("/debug/")).length === 0 && leadDi(dbDbg0099).ga4_sent_at === null && leadDi(dbDbg0099).ga4_attempts === 0, JSON.stringify(dbg0099));
  }

  // ═════════════════════════ 8. GA4 lato server ═════════════════════════
  console.log("\n--- GA4 Measurement Protocol (demo_booking_confirmed) ---");
  const envGa = { DEMO_GA4_MP_ENABLED: "1", GA4_API_SECRET: "ga-segreto", DEMO_CONSENT_SIGNING_SECRET: SEGRETO_FIRMA };
  const confermato = (extra: Riga = {}) => confermata({ id: randomUUID(), ...extra });
  {
    const dbOff = dbCon({ leads: [confermato()] });
    const cfOff = fetchFinto(() => ({ status: 204 }));
    const spento = await inviaConversioniGa4(dbOff.comeClient(), { GA4_API_SECRET: "ga-segreto", DEMO_CONSENT_SIGNING_SECRET: SEGRETO_FIRMA }, ADESSO, cfOff.fetch);
    const senzaSegreto = await inviaConversioniGa4(dbOff.comeClient(), { DEMO_GA4_MP_ENABLED: "1", DEMO_CONSENT_SIGNING_SECRET: SEGRETO_FIRMA }, ADESSO, cfOff.fetch);
    const senzaFirma = await inviaConversioniGa4(dbOff.comeClient(), { DEMO_GA4_MP_ENABLED: "1", GA4_API_SECRET: "ga-segreto" }, ADESSO, cfOff.fetch);
    atteso("GA4 lato server SPENTO senza DEMO_GA4_MP_ENABLED=1 o senza GA4_API_SECRET: nessuna chiamata; senza il segreto della firma dei consensi non parte (il consenso non sarebbe verificabile)", !spento.abilitato && !senzaSegreto.abilitato && !senzaFirma.abilitato && senzaFirma.motivo === "segreto_firma_mancante" && cfOff.chiamate.length === 0);

    const db = dbCon({
      leads: [confermato({ id: "l-ok" }), confermato({ id: "l-pending", booking_status: "pending", prima_prenotazione_il: null }), confermato({ id: "l-colonna", attribution_consent: false }), confermato({ id: "l-nocid", ga_client_id: null }), confermato({ id: "l-gia", ga4_sent_at: "2026-11-10T09:40:00.000Z" }), confermato({ id: "l-canc", booking_status: "cancelled" }), confermato({ id: "l-sostituita", booking_status: "superseded", prima_prenotazione_il: null }), confermato({ id: "l-registro" }), confermato({ id: "l-privacy" })],
      consensi: { "l-registro": { cookie: false }, "l-privacy": { privacy: false } },
    });
    const cf = fetchFinto(() => ({ status: 204 }));
    const { valore: rg, log } = await conLog(() => inviaConversioniGa4(db.comeClient(), envGa, ADESSO, cf.fetch));
    const corpi = cf.chiamate.map((c) => JSON.parse(c.corpo ?? "{}") as { client_id: string; events: { name: string }[] });
    atteso("si invia UN evento solo, per la sola richiesta confermata con i consensi nel REGISTRO e client_id, non ancora inviata", rg.inviati === 1 && cf.chiamate.length === 1 && corpi[0].events[0].name === "demo_booking_confirmed", JSON.stringify([rg, cf.chiamate.length]));
    atteso("l'invio va all'endpoint di raccolta con ID di misurazione e segreto, in POST JSON; il segreto non finisce nei log", cf.chiamate[0].url.startsWith("https://www.google-analytics.com/mp/collect?measurement_id=G-W551SWPNE4&api_secret=ga-segreto") && cf.chiamate[0].metodo === "POST" && !log.includes("ga-segreto"), cf.chiamate[0].url);
    atteso("la richiesta viene segnata come inviata; le altre no", db.da("demo_leads").find((r) => r.id === "l-ok")?.ga4_sent_at === ADESSO_ISO && db.da("demo_leads").filter((r) => r.ga4_sent_at === ADESSO_ISO).length === 1);
    atteso("senza il consenso nel registro (cookie negati, informativa mancante) l'evento non parte MAI, anche se la colonna riassuntiva dice «sì», e la richiesta esce dalla coda", rg.senzaConsenso === 2 && db.da("demo_leads").find((r) => r.id === "l-registro")?.ga4_attempts === 5 && db.da("demo_leads").find((r) => r.id === "l-privacy")?.ga4_attempts === 5 && db.da("demo_leads").find((r) => r.id === "l-registro")?.ga4_sent_at === null);
    const cf2 = fetchFinto(() => ({ status: 204 }));
    const rg2 = await inviaConversioniGa4(db.comeClient(), envGa, ADESSO + 600_000, cf2.fetch);
    atteso("nessun invio ripetuto: la volta dopo non parte niente (GA4 non deduplica, lo si manda una volta sola per richiesta)", rg2.inviati === 0 && cf2.chiamate.length === 0);

    const dbT = dbCon({ leads: [confermato({ id: "l-firma" })] });
    dbT.da("demo_consensi").find((r) => r.tipo === "cookie_pubblicitari")!.valore = "denied"; // alterato: la firma non torna più
    const cfT = fetchFinto(() => ({ status: 204 }));
    const rT = await inviaConversioniGa4(dbT.comeClient(), envGa, ADESSO, cfT.fetch);
    atteso("una riga di consenso ALTERATA nel registro (firma che non torna) non vale: nessun invio", rT.inviati === 0 && rT.senzaConsenso === 1 && cfT.chiamate.length === 0);
    const dbS = dbCon({ leads: [confermato({ id: "l-non-firmato" })], consensi: { "l-non-firmato": { firmare: false } } });
    const cfS = fetchFinto(() => ({ status: 204 }));
    atteso("una riga di consenso NON firmata non è verificabile: nessun invio", (await inviaConversioniGa4(dbS.comeClient(), envGa, ADESSO, cfS.fetch)).inviati === 0 && cfS.chiamate.length === 0);

    const dbDbg = dbCon({ leads: [confermato({ id: "l-dbg" })] });
    const cfDbg = fetchFinto(() => ({ status: 200, json: { validationMessages: [] } }));
    const rd = await inviaConversioniGa4(dbDbg.comeClient(), { ...envGa, DEMO_GA4_MP_DEBUG: "1" }, ADESSO, cfDbg.fetch);
    atteso("modalità di verifica (DEMO_GA4_MP_DEBUG=1): usa il server di validazione e NON segna l'evento come inviato", rd.verificati === 1 && rd.inviati === 0 && cfDbg.chiamate[0].url.includes("/debug/mp/collect") && dbDbg.da("demo_leads")[0].ga4_sent_at === null);
    const cfDbgKo = fetchFinto(() => ({ status: 200, json: { validationMessages: [{ fieldPath: "x", description: "boh" }] } }));
    atteso("… e se il server di validazione segnala errori, si conta l'errore", (await inviaConversioniGa4(dbDbg.comeClient(), { ...envGa, DEMO_GA4_MP_DEBUG: "1" }, ADESSO, cfDbgKo.fetch)).errori === 1);

    const dbKo = dbCon({ leads: [confermato({ id: "l-ko" })] });
    const cfKo = fetchFinto(() => ({ status: 500 }));
    for (let i = 0; i < 7; i++) await inviaConversioniGa4(dbKo.comeClient(), envGa, ADESSO + i * 600_000, cfKo.fetch);
    atteso("invii falliti: dopo 5 tentativi non si riprova più (e non risulta mai inviato)", cfKo.chiamate.length === 5 && dbKo.da("demo_leads")[0].ga4_attempts === 5 && dbKo.da("demo_leads")[0].ga4_sent_at === null, String(cfKo.chiamate.length));
    const cfRete = (() => { const x = fetchFinto(() => ({ status: 204 })); return { ...x, fetch: (async () => { throw new Error("rete"); }) as unknown as typeof fetch }; })();
    const dbRete = dbCon({ leads: [confermato({ id: "l-rete" })] });
    const rr = await inviaConversioniGa4(dbRete.comeClient(), envGa, ADESSO, cfRete.fetch);
    atteso("errore di rete: conta come tentativo fallito, nessuna eccezione", rr.errori === 1 && dbRete.da("demo_leads")[0].ga4_attempts === 1);
  }

  // ═════════════════════════ 9. Google Ads (Data Manager API) ═════════════════════════
  console.log("\n--- Google Ads: conversione «OMNIA AI - DEMO prenotata» ---");
  const envAds = { DEMO_ADS_IMPORT_ENABLED: "1", GOOGLE_ADS_CUSTOMER_ID: "1234567890", GOOGLE_ADS_DEMO_CONVERSION_ACTION_ID: "987654321", GOOGLE_OAUTH_CLIENT_ID: "client-id", GOOGLE_OAUTH_CLIENT_SECRET: "client-segreto", GOOGLE_ADS_REFRESH_TOKEN: "ads-rt", DEMO_CONSENT_SIGNING_SECRET: SEGRETO_FIRMA };
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
    const dbOff = dbCon({ leads: [pronto()] });
    const cfOff = ambienteAds({});
    const a0 = await inviaConversioniAds(dbOff.comeClient(), { ...envAds, DEMO_ADS_IMPORT_ENABLED: undefined }, ADESSO, cfOff.fetch);
    const a1b = await inviaConversioniAds(dbOff.comeClient(), { ...envAds, GOOGLE_ADS_DEMO_CONVERSION_ACTION_ID: undefined }, ADESSO, cfOff.fetch);
    const a2 = await inviaConversioniAds(dbOff.comeClient(), { ...envAds, GOOGLE_ADS_REFRESH_TOKEN: undefined }, ADESSO, cfOff.fetch);
    const a3 = await inviaConversioniAds(dbOff.comeClient(), { ...envAds, DEMO_CONSENT_SIGNING_SECRET: undefined }, ADESSO, cfOff.fetch);
    atteso("integrazione Ads SPENTA senza DEMO_ADS_IMPORT_ENABLED=1; configurazione incompleta (azione, credenziali o segreto della firma dei consensi mancanti) → non parte: nessuna chiamata di rete", !a0.abilitato && a0.motivo === "spento" && a1b.motivo === "configurazione_incompleta" && a2.motivo === "configurazione_incompleta" && a3.motivo === "segreto_firma_mancante" && cfOff.chiamate.length === 0 && dbOff.da("demo_leads")[0].ads_import_status === "ready");

    // solo verifica (predefinita)
    const db = dbCon({ leads: [pronto({ id: "l1" })] });
    const cf = ambienteAds({});
    const { valore: rv, log } = await conLog(() => inviaConversioniAds(db.comeClient(), envAds, ADESSO, cf.fetch));
    const corpo = JSON.parse(ingerimenti(cf)[0]?.corpo ?? "{}") as { validateOnly: boolean; encoding: string; events: { transactionId: string; eventTimestamp: string; adIdentifiers?: { gclid?: string }; userData?: { userIdentifiers: { emailAddress: string }[] } }[]; destinations: { productDestinationId: string }[] };
    atteso("modalità predefinita «SOLO VERIFICA»: la richiesta ha validateOnly=true, non si registra nessuna conversione", rv.modalita === "solo_verifica" && rv.verificati === 1 && rv.inviati === 0 && corpo.validateOnly === true && stati(cf).length === 0, JSON.stringify(rv));
    atteso("… la richiesta passa a «validated» (non a «sent»/«accepted»): non risulta acquisita", db.da("demo_leads")[0].ads_import_status === "validated" && db.da("demo_leads")[0].ads_request_id === null && db.da("demo_leads")[0].ads_sent_at === null);
    atteso("la richiesta usa l'azione di conversione, il clic, l'identificativo di transazione della RICHIESTA, l'ora della prima prenotazione e l'email in SHA-256 (mai in chiaro)", corpo.destinations[0].productDestinationId === "987654321" && corpo.events[0].adIdentifiers?.gclid === "GCLID_abc12345" && corpo.events[0].transactionId === "omnia-demo-l1" && corpo.events[0].eventTimestamp === "2026-11-10T09:30:00.000Z" && corpo.encoding === "HEX" && /^[0-9a-f]{64}$/.test(corpo.events[0].userData?.userIdentifiers[0].emailAddress ?? "") && !/mario\.rossi/i.test(ingerimenti(cf)[0].corpo ?? ""));
    atteso("la chiamata è un POST autenticato con il token e nei log non compaiono token, email o identificativi di clic", ingerimenti(cf)[0].metodo === "POST" && ingerimenti(cf)[0].intestazioni.authorization === "Bearer at-segreto" && !SEGRETI.some((s) => log.includes(s) || JSON.stringify(rv).includes(s)), log);
    const cf2 = ambienteAds({});
    await inviaConversioniAds(db.comeClient(), envAds, ADESSO + 600_000, cf2.fetch);
    atteso("in «solo verifica» una richiesta già verificata non si rimanda a ogni esecuzione", ingerimenti(cf2).length === 0);

    // modalità reale
    const envReale = { ...envAds, DEMO_ADS_VALIDATE_ONLY: "0" };
    const cf3 = ambienteAds({ ingest: () => ({ status: 200, json: { requestId: "req-reale-1" } }) });
    const r3 = await inviaConversioniAds(db.comeClient(), envReale, ADESSO + 700_000, cf3.fetch);
    const l3 = db.da("demo_leads")[0];
    atteso("modalità reale: le richieste già verificate vengono inviate davvero (validateOnly=false) e segnate «sent» con l'id della richiesta e l'identificativo di transazione, NON ancora «accepted»", r3.modalita === "reale" && r3.inviati === 1 && JSON.parse(ingerimenti(cf3)[0].corpo ?? "{}").validateOnly === false && l3.ads_import_status === "sent" && l3.ads_request_id === "req-reale-1" && l3.ads_transaction_id === "omnia-demo-l1" && l3.ads_attempts === 1 && l3.ads_sent_at === new Date(ADESSO + 700_000).toISOString(), JSON.stringify([r3, l3]));
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
    const dbF = dbCon({ leads: [pronto({ id: "lf" })] });
    const cfF = ambienteAds({ stato: () => ({ status: 200, json: { requestStatusPerDestination: [{ requestStatus: "FAILED", errorInfo: { errorCounts: [{ reason: "PROCESSING_ERROR_REASON_DUPLICATE_GCLID", recordCount: "1" }] } }] } }) });
    await inviaConversioniAds(dbF.comeClient(), envReale, ADESSO, cfF.fetch);
    await inviaConversioniAds(dbF.comeClient(), envReale, ADESSO + 120_000, cfF.fetch);
    const lf = dbF.da("demo_leads")[0];
    atteso("elaborazione FAILED: la richiesta diventa «failed» con il codice dell'errore, senza riprovare da sola (serve una persona)", lf.ads_import_status === "failed" && /DUPLICATE_GCLID/.test(String(lf.ads_last_error)) && lf.ads_next_attempt_at === null, JSON.stringify(lf));
    const cfF2 = ambienteAds({});
    await inviaConversioniAds(dbF.comeClient(), envReale, ADESSO + 90_000_000, cfF2.fetch);
    atteso("… e un «failed» senza data di nuovo tentativo non viene rimandato in automatico", ingerimenti(cfF2).length === 0);

    const dbP = dbCon({ leads: [pronto({ id: "lp" })] });
    const cfP = ambienteAds({ stato: () => ({ status: 200, json: { requestStatusPerDestination: [{ requestStatus: "PROCESSING" }] } }) });
    await inviaConversioniAds(dbP.comeClient(), envReale, ADESSO, cfP.fetch);
    const rp = await inviaConversioniAds(dbP.comeClient(), envReale, ADESSO + 120_000, cfP.fetch);
    atteso("elaborazione ancora in corso (PROCESSING): resta «sent», NON è considerata acquisita", rp.inElaborazione === 1 && dbP.da("demo_leads")[0].ads_import_status === "sent");
    const rp2 = await inviaConversioniAds(dbP.comeClient(), envReale, ADESSO + 49 * 3_600_000, cfP.fetch);
    atteso("oltre 48 ore ancora «in corso»: passa a «failed» (TIMEOUT_ELABORAZIONE) per la verifica manuale", rp2.falliti === 1 && dbP.da("demo_leads")[0].ads_import_status === "failed" && dbP.da("demo_leads")[0].ads_last_error === "TIMEOUT_ELABORAZIONE");

    // errori di rete / Google con nuovi tentativi
    const dbE = dbCon({ leads: [pronto({ id: "le" })] });
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

    const dbM = dbCon({ leads: [pronto({ id: "lm" })] });
    const cfM = ambienteAds({ ingest: () => ({ status: 503 }) });
    for (let i = 0; i < 9; i++) await inviaConversioniAds(dbM.comeClient(), envReale, ADESSO + i * 100_000_000, cfM.fetch);
    atteso("dopo 6 tentativi falliti non si riprova più e la richiesta resta «failed»", ingerimenti(cfM).length === TENTATIVI_MASSIMI && dbM.da("demo_leads")[0].ads_import_status === "failed" && dbM.da("demo_leads")[0].ads_attempts === TENTATIVI_MASSIMI && dbM.da("demo_leads")[0].ads_next_attempt_at === null, String(ingerimenti(cfM).length));
    const dbTetto = dbCon({ leads: [pronto({ id: "lt", ads_import_status: "failed", ads_attempts: TENTATIVI_MASSIMI, ads_next_attempt_at: new Date(ADESSO - 3_600_000).toISOString() })] });
    const cfTetto = ambienteAds({});
    await inviaConversioniAds(dbTetto.comeClient(), envReale, ADESSO, cfTetto.fetch);
    atteso("il tetto dei tentativi vale da solo: una richiesta «failed» con 6 tentativi e un nuovo tentativo già scaduto NON viene rimandata", ingerimenti(cfTetto).length === 0 && dbTetto.da("demo_leads")[0].ads_attempts === TENTATIVI_MASSIMI);
    const dbSotto = dbCon({ leads: [pronto({ id: "ls5", ads_import_status: "failed", ads_attempts: TENTATIVI_MASSIMI - 1, ads_next_attempt_at: new Date(ADESSO - 3_600_000).toISOString() })] });
    const cfSotto = ambienteAds({});
    await inviaConversioniAds(dbSotto.comeClient(), envReale, ADESSO, cfSotto.fetch);
    atteso("… mentre con 5 tentativi (uno meno del tetto) si riprova ancora una volta", ingerimenti(cfSotto).length === 1);
    const cfRete = (() => { const x = ambienteAds({}); return { ...x, fetch: (async (u: RequestInfo | URL, i?: RequestInit) => { if (String(u).includes("events:ingest")) throw new Error("rete"); return x.fetch(u, i); }) as typeof fetch }; })();
    const dbR = dbCon({ leads: [pronto({ id: "lr" })] });
    await inviaConversioniAds(dbR.comeClient(), envReale, ADESSO, cfRete.fetch);
    atteso("errore di rete: «failed» con codice «RETE» e nuovo tentativo programmato, nessuna eccezione", dbR.da("demo_leads")[0].ads_import_status === "failed" && dbR.da("demo_leads")[0].ads_last_error === "RETE" && dbR.da("demo_leads")[0].ads_next_attempt_at !== null);
    const dbSenzaId = dbCon({ leads: [pronto({ id: "ls" })] });
    await inviaConversioniAds(dbSenzaId.comeClient(), envReale, ADESSO, ambienteAds({ ingest: () => ({ status: 200, json: {} }) }).fetch);
    atteso("risposta senza identificativo di richiesta: «failed» (non si potrebbe verificare), senza riprovare", dbSenzaId.da("demo_leads")[0].ads_import_status === "failed" && dbSenzaId.da("demo_leads")[0].ads_last_error === "RISPOSTA_SENZA_ID_RICHIESTA" && dbSenzaId.da("demo_leads")[0].ads_next_attempt_at === null);

    // chi NON deve mai partire
    const dbN = dbCon({
      leads: [
        pronto({ id: "n-pending", booking_status: "pending", prima_prenotazione_il: null }),
        pronto({ id: "n-cancellato", booking_status: "cancelled" }),
        pronto({ id: "n-sostituita", booking_status: "superseded", prima_prenotazione_il: null }),
        pronto({ id: "n-noconsenso" }),
        pronto({ id: "n-noprivacy" }),
        pronto({ id: "n-noclic", gclid: null }),
        pronto({ id: "n-vecchio", prima_prenotazione_il: "2026-06-01T00:00:00.000Z" }),
        pronto({ id: "n-sent", ads_import_status: "sent", ads_request_id: "req-1", ads_sent_at: ADESSO_ISO }),
        pronto({ id: "n-accepted", ads_import_status: "accepted" }),
        pronto({ id: "n-scartato", ads_import_status: "skipped_no_consent" }),
      ],
      consensi: { "n-noconsenso": { cookie: false, ads: false }, "n-noprivacy": { privacy: false } },
    });
    const cfN = ambienteAds({ stato: () => ({ status: 200, json: { requestStatusPerDestination: [{ requestStatus: "PROCESSING" }] } }) });
    const rN = await inviaConversioniAds(dbN.comeClient(), envReale, ADESSO + 120_000, cfN.fetch);
    const inviatiId = ingerimenti(cfN).map((c) => (JSON.parse(c.corpo ?? "{}") as { events: { transactionId: string }[] }).events[0].transactionId);
    atteso("non parte MAI la conversione di: richiesta non confermata, cancellata, sostituita, senza consenso nel registro, senza clic, oltre 90 giorni, già inviata, già accettata (e le richieste non confermate non vengono nemmeno prese in esame: i «saltati» sono solo i 4 con un motivo vero)", inviatiId.length === 0 && rN.saltati === 4, `${inviatiId.join(",")} saltati ${rN.saltati}`);
    const stN = (id: string) => dbN.da("demo_leads").find((r) => r.id === id)?.ads_import_status;
    atteso("… e gli stati lo dicono: senza consenso o senza informativa «skipped_no_consent», senza clic «skipped_no_identifier», troppo vecchia «failed» (ETA_OLTRE_90_GIORNI)", stN("n-noconsenso") === "skipped_no_consent" && stN("n-noprivacy") === "skipped_no_consent" && stN("n-noclic") === "skipped_no_identifier" && stN("n-vecchio") === "failed" && dbN.da("demo_leads").find((r) => r.id === "n-vecchio")?.ads_last_error === "ETA_OLTRE_90_GIORNI" && stN("n-pending") === "ready");

    // il consenso si legge dal REGISTRO firmato: una riga alterata non vale, anche se la colonna riassuntiva dice «sì»
    const dbAlt = dbCon({ leads: [pronto({ id: "lalt", ads_measurement_consent: true, attribution_consent: true })], consensi: { lalt: { cookie: false } } });
    dbAlt.da("demo_consensi").find((r) => r.tipo === "cookie_pubblicitari")!.valore = "granted";
    const cfAlt = ambienteAds({});
    await inviaConversioniAds(dbAlt.comeClient(), envReale, ADESSO, cfAlt.fetch);
    atteso("un consenso ALTERATO a mano nel registro (firma che non torna) fa saltare l'invio, anche se le colonne riassuntive dicono «sì»", ingerimenti(cfAlt).length === 0 && dbAlt.da("demo_leads")[0].ads_import_status === "skipped_no_consent");
    const dbNF = dbCon({ leads: [pronto({ id: "lnf" })], consensi: { lnf: { firmare: false } } });
    const cfNF = ambienteAds({});
    await inviaConversioniAds(dbNF.comeClient(), envReale, ADESSO, cfNF.fetch);
    atteso("un consenso non firmato non è verificabile: nessun invio", ingerimenti(cfNF).length === 0 && dbNF.da("demo_leads")[0].ads_import_status === "skipped_no_consent");
    const dbRev = dbCon({ leads: [pronto({ id: "lrev" })] });
    await registraRevoca(dbRev.comeClient(), "lrev", "cookie_pubblicitari", null, new Date(ADESSO - 60_000), SEGRETO_FIRMA);
    const cfRev = ambienteAds({});
    await inviaConversioniAds(dbRev.comeClient(), envReale, ADESSO, cfRev.fetch);
    atteso("un consenso REVOCATO dopo la prenotazione (riga nuova «denied», più recente) ferma la conversione", ingerimenti(cfRev).length === 0 && dbRev.da("demo_leads")[0].ads_import_status === "skipped_no_consent");

    // consenso solo cookie, senza email
    const dbC = dbCon({ leads: [pronto({ id: "lc" })], consensi: { lc: { ads: false } } });
    const cfC = ambienteAds({});
    await inviaConversioniAds(dbC.comeClient(), envReale, ADESSO, cfC.fetch);
    const corpoC = JSON.parse(ingerimenti(cfC)[0]?.corpo ?? "{}") as { events: { userData?: unknown; adIdentifiers?: unknown }[] };
    atteso("senza il consenso facoltativo dell'email: parte solo il clic, MAI l'email (nemmeno cifrata)", ingerimenti(cfC).length === 1 && corpoC.events[0].userData === undefined && !!corpoC.events[0].adIdentifiers && !/[0-9a-f]{64}/.test(ingerimenti(cfC)[0].corpo ?? ""));
    // solo email
    const dbS = dbCon({ leads: [pronto({ id: "ls2", gclid: null, ads_import_status: "ready" })] });
    const cfS = ambienteAds({});
    await inviaConversioniAds(dbS.comeClient(), envReale, ADESSO, cfS.fetch);
    atteso("senza identificativo di clic l'invio «solo email» è spento di default (nessuna chiamata) e si accende solo con DEMO_ADS_ALLOW_EMAIL_ONLY=1", ingerimenti(cfS).length === 0 && dbS.da("demo_leads")[0].ads_import_status === "skipped_no_identifier");
    const dbS2 = dbCon({ leads: [pronto({ id: "ls3", gclid: null, ads_import_status: "ready" })] });
    const cfS2 = ambienteAds({});
    await inviaConversioniAds(dbS2.comeClient(), { ...envReale, DEMO_ADS_ALLOW_EMAIL_ONLY: "1" }, ADESSO, cfS2.fetch);
    atteso("… con il flag acceso e il consenso dell'email, parte solo l'email cifrata", ingerimenti(cfS2).length === 1 && JSON.parse(ingerimenti(cfS2)[0].corpo ?? "{}").events[0].adIdentifiers === undefined && !!JSON.parse(ingerimenti(cfS2)[0].corpo ?? "{}").events[0].userData);
    // deduplicazione
    const dbD = dbCon({ leads: [pronto({ id: "ld" })] });
    const cfD = ambienteAds({});
    await inviaConversioniAds(dbD.comeClient(), envReale, ADESSO, cfD.fetch);
    await inviaConversioniAds(dbD.comeClient(), envReale, ADESSO + 1000, cfD.fetch);
    await inviaConversioniAds(dbD.comeClient(), envReale, ADESSO + 2000, cfD.fetch);
    atteso("deduplicazione: la stessa richiesta eseguita tre volte di fila genera UNA sola conversione", ingerimenti(cfD).length === 1);
    // più richieste della stessa persona: ognuna la sua conversione, con identificativi diversi
    const dbDue = dbCon({ leads: [pronto({ id: "r-uno" }), pronto({ id: "r-due", created_at: "2026-11-10T09:30:00.000Z", idempotency_key: "chiave-seconda-xxxxxxxxxxxx" })] });
    const cfDue = ambienteAds({});
    await inviaConversioniAds(dbDue.comeClient(), envReale, ADESSO, cfDue.fetch);
    const idDue = ingerimenti(cfDue).map((c) => (JSON.parse(c.corpo ?? "{}") as { events: { transactionId: string }[] }).events[0].transactionId).sort();
    atteso("due richieste confermate della stessa persona (es. due percorsi diversi): due conversioni con identificativi di transazione DIVERSI (omnia-demo-<richiesta>)", uguali(idDue, ["omnia-demo-r-due", "omnia-demo-r-uno"]));
    // annullata e riprenotata dopo l'invio: nessun secondo invio
    const dbRp = dbCon({ leads: [confermata({ id: "lead1", ads_import_status: "ready" })], prenotazioni: [prenotazione()] });
    const cfRp1 = ambienteAds({});
    await inviaConversioniAds(dbRp.comeClient(), envReale, ADESSO, cfRp1.fetch);
    await sincronizzaCalendario(dbRp.comeClient(), envCal, ADESSO + 10 * 60_000, ambienteCalendario(() => ({ status: 200, json: { items: [ev({ id: "evt1", status: "cancelled" }), ev({ id: "evt2", created: "2026-11-10T09:50:00Z" })], nextSyncToken: "T" } })).fetch);
    const cfRp2 = ambienteAds({});
    await inviaConversioniAds(dbRp.comeClient(), envReale, ADESSO + 20 * 60_000, cfRp2.fetch);
    atteso("demo annullata e riprenotata DOPO l'invio della conversione: la richiesta è di nuovo confermata ma non parte nessuna seconda conversione (stesso identificativo, stato già «sent»)", ingerimenti(cfRp1).length === 1 && ingerimenti(cfRp2).length === 0 && leadDi(dbRp).booking_status === "confirmed" && leadDi(dbRp).ads_import_status === "accepted" && leadDi(dbRp).ads_transaction_id === "omnia-demo-lead1" && dbRp.da("demo_prenotazioni").length === 2);
    // migrazione non eseguita
    const dbSchema = new FintoDatabase();
    dbSchema.errori.demo_leads = { code: "42P01", message: "x" };
    atteso("migrazione non eseguita: «schema_assente», nessun invio", (await inviaConversioniAds(dbSchema.comeClient(), envReale, ADESSO, ambienteAds({}).fetch)).motivo === "schema_assente");
  }

  // ═════════════════════════ 10. Conservazione e cancellazione ═════════════════════════
  console.log("\n--- Conservazione e cancellazione dei dati ---");
  const lim = limitiConservazione(new Date("2026-11-10T00:00:00.000Z"));
  atteso("date di taglio: 90 giorni per le richieste senza prenotazione, 24 mesi per le altre, 12 mesi per i casi aperti, 6 per quelli risolti", lim.pendingPrimaDi === "2026-08-12T00:00:00.000Z" && lim.leadPrimaDi === "2024-11-10T00:00:00.000Z" && lim.casiApertiPrimaDi === "2025-11-10T00:00:00.000Z" && lim.casiRisoltiPrimaDi === "2026-05-10T00:00:00.000Z", JSON.stringify(lim));
  atteso("contatti orfani: quelli senza nessuna richiesta", uguali(contattiOrfani(["a", "b", "c"], ["b", "b"]), ["a", "c"]) && uguali(contattiOrfani([], ["x"]), []) && uguali(contattiOrfani(["a"], []), ["a"]));
  {
    const db = dbCon({
      leads: [
        richiesta({ id: "p-vecchio", email_norm: "vecchio@esempio.it", created_at: "2026-08-01T00:00:00.000Z" }),
        richiesta({ id: "s-vecchio", email_norm: "vecchio@esempio.it", booking_status: "superseded", created_at: "2026-08-02T00:00:00.000Z" }),
        richiesta({ id: "p-recente", email_norm: "recente@esempio.it", created_at: "2026-11-01T00:00:00.000Z" }),
        confermata({ id: "c-vecchio", email_norm: "lungo@esempio.it", created_at: "2024-10-01T00:00:00.000Z", prima_prenotazione_il: "2024-10-02T00:00:00.000Z" }),
        confermata({ id: "c-recente", email_norm: "misto@esempio.it", created_at: "2025-11-01T00:00:00.000Z", prima_prenotazione_il: "2025-11-02T00:00:00.000Z" }),
        richiesta({ id: "x-vecchio", email_norm: "misto@esempio.it", booking_status: "cancelled", created_at: "2024-01-01T00:00:00.000Z" }),
      ],
      prenotazioni: [prenotazione({ id: "pr1", lead_id: "c-vecchio", calendar_event_id: "e1" }), prenotazione({ id: "pr2", lead_id: "c-recente", calendar_event_id: "e2" })],
      casi: [
        { calendar_event_id: "k1", risolto: false, created_at: "2025-10-01T00:00:00.000Z" },
        { calendar_event_id: "k2", risolto: false, created_at: "2026-10-01T00:00:00.000Z" },
        { calendar_event_id: "k3", risolto: true, created_at: "2026-04-01T00:00:00.000Z" },
        { calendar_event_id: "k4", risolto: true, created_at: "2026-09-01T00:00:00.000Z" },
      ],
    });
    const contatoreConsensi = db.da("demo_consensi").length;
    const p = await eliminaDatiScaduti(db.comeClient(), new Date("2026-11-10T00:00:00.000Z"));
    const rimasti = db.da("demo_leads").map((r) => r.id).sort();
    atteso("conservazione: si cancellano le richieste senza prenotazione oltre 90 giorni (anche «superseded»), le altre oltre 24 mesi, e i casi oltre i limiti; il resto resta", uguali(rimasti, ["c-recente", "p-recente"]) && p.lead === 4 && p.casiAperti === 1 && p.casiRisolti === 1 && uguali(db.da("demo_calendar_casi").map((r) => r.calendar_event_id).sort(), ["k2", "k4"]) && !p.errore, JSON.stringify([p, rimasti]));
    atteso("… con una richiesta cancellano anche i suoi consensi e le sue prenotazioni (a cascata); quelli delle richieste rimaste restano", db.da("demo_consensi").length === contatoreConsensi - 4 * 3 && uguali(db.da("demo_prenotazioni").map((r) => r.id), ["pr2"]) && db.da("demo_consensi").every((r) => ["c-recente", "p-recente"].includes(String(r.lead_id))));
    atteso("… e i contatti rimasti senza richieste si cancellano; chi ha ancora una richiesta tiene il contatto", p.contatti === 2 && uguali(db.da("demo_contatti").map((r) => r.email_norm).sort(), ["misto@esempio.it", "recente@esempio.it"]), JSON.stringify([p, db.da("demo_contatti").map((r) => r.email_norm)]));
    const dbMancante = new FintoDatabase();
    dbMancante.errori.demo_leads = { code: "42P01", message: "x" };
    dbMancante.errori.demo_calendar_casi = { code: "42P01", message: "x" };
    dbMancante.errori.demo_contatti = { code: "42P01", message: "x" };
    atteso("tabelle non create: la conservazione non dà errore", (await eliminaDatiScaduti(dbMancante.comeClient(), new Date(ADESSO))).errore === false);
    const dbGuasto = dbCon({ leads: [richiesta({ id: "p-vecchio", created_at: "2026-08-01T00:00:00.000Z" })] });
    dbGuasto.errori.demo_leads = { code: "XX000", message: "x" };
    atteso("un guasto vero nella conservazione si segnala (errore: true)", (await eliminaDatiScaduti(dbGuasto.comeClient(), new Date("2026-11-10T00:00:00.000Z"))).errore === true);
  }
  atteso("route cron: autorizzate solo con «Bearer <CRON_SECRET>» e solo se il segreto è impostato", cronAutorizzato("Bearer abc", "abc") && cronAutorizzato("Bearer abc", " abc ") && !cronAutorizzato(null, "abc") && !cronAutorizzato("Bearer sbagliato", "abc") && !cronAutorizzato("Bearer undefined", undefined) && !cronAutorizzato("Bearer ", "") && !cronAutorizzato("Bearer ", undefined) && !cronAutorizzato("abc", "abc"));
  atteso("la riga di una richiesta cancellata su richiesta dell'interessato (funzione SQL) è coperta dalla migrazione: toglie contatto (e a cascata richieste, prenotazioni, consensi) e casi di quell'email", /with c as \(delete from public\.demo_contatti where email_norm = lower\(trim\(p_email_norm\)\)/.test(leggi("supabase/migrations/0098_demo_leads.sql")) && /delete from public\.demo_calendar_casi where attendee_email_norm/.test(leggi("supabase/migrations/0098_demo_leads.sql")));

  // ═════════════════════════ 11. Controlli sul codice ═════════════════════════
  console.log("\n--- Codice: migrazione, azione, modulo, cron, guida ---");
  const mig = leggi("supabase/migrations/0098_demo_leads.sql");
  const migSenzaCommenti = mig.replace(/--.*$/gm, "");
  const TABELLE = ["demo_contatti", "demo_leads", "demo_prenotazioni", "demo_consensi", "demo_calendar_casi", "demo_sync_stato"];
  atteso("migrazione 0098: le sei tabelle, con RLS attiva e NESSUNA policy (nessun accesso dal browser)", TABELLE.every((t) => new RegExp(`alter table public\\.${t} enable row level security`).test(migSenzaCommenti)) && !/create policy/i.test(migSenzaCommenti));
  atteso("migrazione 0098: permessi tolti a anon e authenticated, dati solo a service_role", TABELLE.every((t) => new RegExp(`revoke all on public\\.${t} from anon, authenticated`).test(migSenzaCommenti) && new RegExp(`grant select, insert, update, delete on public\\.${t} to service_role`).test(migSenzaCommenti)) && !/grant [^;]*to (anon|authenticated|public)/i.test(migSenzaCommenti));
  atteso("migrazione 0098: TRE identificativi distinti con i vincoli di unicità giusti (contatto per email, richiesta per chiave di idempotenza, prenotazione per evento del calendario, un caso per evento)", /constraint demo_contatti_email_uni unique \(email_norm\)/.test(migSenzaCommenti) && /constraint demo_leads_idempotenza_uni unique \(idempotency_key\)/.test(migSenzaCommenti) && /constraint demo_prenotazioni_evento_uni unique \(calendar_id, calendar_event_id\)/.test(migSenzaCommenti) && /constraint demo_calendar_casi_evento_uni unique \(calendar_event_id\)/.test(migSenzaCommenti) && !/unique index[^;]*demo_leads[^;]*email_norm/i.test(migSenzaCommenti));
  atteso("migrazione 0098: lo storico NON si sovrascrive: nessun vincolo di unicità per email sulle richieste (una persona può averne molte), e le richieste puntano al contatto", /contatto_id uuid not null references public\.demo_contatti \(id\) on delete cascade/.test(migSenzaCommenti) && (migSenzaCommenti.match(/lead_id uuid not null references public\.demo_leads \(id\) on delete cascade/g) ?? []).length === 2 && /superseded_by uuid references public\.demo_leads \(id\) on delete set null/.test(migSenzaCommenti));
  atteso("migrazione 0098: stati ammessi (inclusa «superseded»), una richiesta «confirmed» ha sempre la data della prima prenotazione, lunghezze massime sui campi", /booking_status in \('pending', 'confirmed', 'cancelled', 'superseded'\)/.test(migSenzaCommenti) && /demo_leads_confermata_ha_data check \(booking_status <> 'confirmed' or prima_prenotazione_il is not null\)/.test(migSenzaCommenti) && /ads_import_status in \('not_ready', 'ready', 'validated', 'sent', 'accepted', 'failed', 'skipped_no_consent', 'skipped_no_identifier', 'skipped_cancelled'\)/.test(migSenzaCommenti) && /char_length\(full_name\) between 2 and 120/.test(migSenzaCommenti) && /stato in \('confirmed', 'cancelled'\)/.test(migSenzaCommenti));
  atteso("migrazione 0098: registro dei consensi che si aggiunge soltanto (trigger che vieta l'UPDATE), con versione del testo, impronta SHA-256, versione dell'informativa e firma", /create trigger demo_consensi_senza_update\s+before update on public\.demo_consensi/.test(migSenzaCommenti) && /raise exception 'demo_consensi si aggiunge soltanto/.test(migSenzaCommenti) && /versione_testo text not null/.test(migSenzaCommenti) && /testo_sha256 text not null check \(testo_sha256 ~ '\^\[0-9a-f\]\{64\}\$'\)/.test(migSenzaCommenti) && /informativa_versione text not null/.test(migSenzaCommenti) && /firma text check/.test(migSenzaCommenti) && /dichiarato_dal_browser boolean/.test(migSenzaCommenti) && /tipo in \('informativa_privacy', 'misurazione_pubblicitaria', 'cookie_pubblicitari'\)/.test(migSenzaCommenti));
  atteso("migrazione 0098: nessun IP in chiaro (solo ip_hash), nessuna cancellazione di dati esistenti, idempotente, sei tabelle nuove", /ip_hash text/.test(migSenzaCommenti) && !/\bip_address\b|\bip text\b/.test(migSenzaCommenti) && !/\bdrop table\b|\btruncate\b|\bdelete from public\.(?!demo_)/i.test(migSenzaCommenti) && !/create table public\./.test(migSenzaCommenti) && (migSenzaCommenti.match(/create table if not exists/g) ?? []).length === 6);
  atteso("migrazione 0098: blocco della sincronizzazione (lock_until), cancellazione su richiesta (funzione riservata al server), conservazione descritta, ricarica dello schema", /lock_until timestamptz/.test(migSenzaCommenti) && /create or replace function public\.demo_cancella_dati_email/.test(migSenzaCommenti) && /revoke all on function public\.demo_cancella_dati_email\(text\) from public, anon, authenticated/.test(migSenzaCommenti) && /grant execute on function public\.demo_cancella_dati_email\(text\) to service_role/.test(migSenzaCommenti) && /Conservazione/.test(mig) && /notify pgrst, 'reload schema'/.test(migSenzaCommenti));
  atteso("migrazione 0098: ha il numero libero (dopo la 0095 di master e dopo la 0096 e la 0097 del lavoro in corso sul piano di lavoro)", fs.existsSync(path.join(radice, "supabase/migrations/0098_demo_leads.sql")) && !fs.existsSync(path.join(radice, "supabase/migrations/0096_demo_leads.sql")) && !fs.existsSync(path.join(radice, "supabase/migrations/0097_demo_leads.sql")) && fs.readdirSync(path.join(radice, "supabase/migrations")).filter((f) => f.startsWith("0098_")).length === 1);

  const azione = leggi("src/app/actions/omnia-ai-demo.ts");
  const posizione = (testo: string) => azione.indexOf(testo);
  atteso("azione: campo trappola → versione dei consensi → validazione → anti-bot → salvataggio → avviso all'ufficio, in quest'ordine", posizione("NOME_CAMPO_TRAPPOLA") > 0 && posizione("String(formData.get(NOME_CAMPO_TRAPPOLA)") < posizione("formData.get(NOME_CAMPO_VERSIONE_CONSENSI)") && posizione("formData.get(NOME_CAMPO_VERSIONE_CONSENSI)") < posizione("validaModuloDemo(grezzo)") && posizione("validaModuloDemo(grezzo)") < posizione("await verificaFormUmano(formData)") && posizione("await verificaFormUmano(formData)") < posizione("await registraLead(") && posizione("await registraLead(") < azione.lastIndexOf("await avvisaUfficio("));
  atteso("azione: il robot (campo trappola compilato) riceve un successo finto e non salva né scrive nulla", /if \(String\(formData\.get\(NOME_CAMPO_TRAPPOLA\) \?\? ""\)\.trim\(\) !== ""\) return \{ ok: true \};/.test(azione));
  atteso("azione: se i testi dei consensi che la persona ha visto non sono quelli in vigore, si chiede di ricaricare la pagina (il server non registrerebbe un consenso che non può dimostrare)", /if \(formData\.get\(NOME_CAMPO_VERSIONE_CONSENSI\) !== VERSIONE_CONSENSI_DEMO\) \{\s*return \{ ok: false, errore: TESTO_ERRORE_PAGINA_VECCHIA, ricarica: true \};/.test(azione));
  atteso("azione: il consenso ai cookie è quello dichiarato dal modulo («cookie_ok» = 1), mai presunto", /const consensoCookie = formData\.get\("cookie_ok"\) === "1";/.test(azione));
  atteso("azione: l'attribuzione è input non fidato (ridotta ai campi noti), i cookie di Analytics sono interpretati e il percorso è controllato", /pulisciAttribuzione\(JSON\.parse\(/.test(azione) && /clientIdDaCookieGa\(/.test(azione) && /sessionIdDaCookieGa\(/.test(azione) && /\^\\\/\[A-Za-z0-9\\-_\/\]\{0,150\}\$/.test(azione));
  atteso("azione: l'IP non si salva né si registra: solo un hash con segreto dedicato (DEMO_LEADS_HASH_SECRET)", /hashIp\(ip, segretoIp\)/.test(azione) && /DEMO_LEADS_HASH_SECRET/.test(azione) && !/ip_address|ip:\s*ip\b/.test(azione));
  atteso("azione: la chiave di idempotenza è quella del modulo (se valida), altrimenti ne crea una; il segreto della firma dei consensi arriva dall'ambiente", /chiaveIdempotenzaValida\(formData\.get\(NOME_CAMPO_CHIAVE\)\) \?\? randomUUID\(\)/.test(azione) && /segretoFirmaConsensi\(process\.env\)/.test(azione) && /segretoFirma, adesso: new Date\(\)/.test(azione));
  atteso("azione: a sistema ATTIVO (DEMO_LEADS_ATTIVO=1) una richiesta non salvata NON prosegue al calendario: risposta «ok: false» con errore recuperabile, e l'ufficio riceve comunque l'avviso «NON registrata»", /const attivo = process\.env\.DEMO_LEADS_ATTIVO === "1";/.test(azione) && /decisioneDopoSalvataggio\(salvataggio\.esito, attivo\)/.test(azione) && /if \(decisione === "errore_recuperabile"\) \{[\s\S]*?try \{\s*await avvisaUfficio\(dati, "NO \(errore[\s\S]*?"Richiesta demo NON registrata"\);[\s\S]*?return \{ ok: false, errore: TESTO_ERRORE_RECUPERABILE, recuperabile: true \};\s*\}/.test(azione));
  atteso("azione: l'avviso all'ufficio per un invio già registrato (ripetuto) non si rimanda; per uno nuovo sì", /if \(salvataggio\.esito !== "gia_registrato"\) \{\s*await avvisaUfficio\(/.test(azione));
  atteso("azione: a sistema attivo senza segreto per firmare i consensi non si salva (il consenso non sarebbe verificabile): stessa risposta recuperabile", /attivo && !segretoFirma/.test(azione));
  atteso("azione: NON registra nessuna conversione (niente GA4, Ads, gtag, fetch verso Google)", !/gtag|googleapis|google-analytics|datamanager|Measurement|ads_import_status|demo-ga4|demo-ads/.test(azione));
  atteso("azione: nessun dato personale nei log (nessun console.* che stampi i dati del modulo)", (azione.match(/console\./g) ?? []).length === 1 && /console\.error\("Richiesta demo: avviso all'ufficio non inviato"\)/.test(azione));
  atteso("azione: l'email all'ufficio escapa ogni valore inserito dal visitatore", /escapeHtml\(valore\)/.test(azione) && /escapeHtml\(etichetta\)/.test(azione));
  atteso("azione: prima dell'attivazione, se il database non risponde, la richiesta arriva comunque per email (il salvataggio non blocca l'avviso)", /Salvata nel registro/.test(azione) && /"NO \(da inserire a mano\)"/.test(azione) && /esito === "non_salvato" \? "NO/.test(azione));

  const modulo = leggi("src/components/omnia-ai/demo-form.tsx");
  atteso("modulo: pulsante «CONTINUA E PRENOTA LA DEMO» e campi richiesti (nome, azienda, email aziendale, telefono, settore)", /CONTINUA E PRENOTA LA DEMO/.test(modulo) && ["nome", "azienda", "email", "telefono", "settore"].every((c) => modulo.includes(`name="${c}"`)) && /Email aziendale/.test(modulo) && /Nome azienda/.test(modulo) && /SETTORI_DEMO\.map/.test(modulo));
  atteso("modulo: informativa privacy collegata, presa visione OBBLIGATORIA, consenso alla misurazione pubblicitaria FACOLTATIVO", /href="\/privacy"/.test(modulo) && /name="privacy" required/.test(modulo) && /name="adsConsenso"/.test(modulo) && !/name="adsConsenso" required/.test(modulo) && /Facoltativo/.test(TESTI_MODULO_DEMO.ads));
  atteso("modulo: i testi dell'informativa e dei consensi vengono dalla fonte unica (la stessa da cui il server calcola l'impronta registrata), non sono scritti a mano nel modulo", /TESTI_MODULO_DEMO\.informativaPrima/.test(modulo) && /TESTI_MODULO_DEMO\.privacy/.test(modulo) && /TESTI_MODULO_DEMO\.ads/.test(modulo) && !/Ho letto l&apos;informativa|acconsento a che il mio indirizzo/.test(modulo));
  atteso("modulo: convalida nel browser con la stessa funzione del server, anti-bot e campo trappola", /validaModuloDemo\(Object\.fromEntries\(dati\.entries\(\)\)\)/.test(modulo) && /<TurnstileCampo /.test(modulo) && /name=\{NOME_CAMPO_TRAPPOLA\}/.test(modulo) && /tabIndex=\{-1\}/.test(modulo));
  atteso("modulo: invia la versione dei testi dei consensi e una chiave di idempotenza che resta la STESSA nei tentativi successivi (creata una volta sola)", /dati\.set\(NOME_CAMPO_VERSIONE_CONSENSI, VERSIONE_CONSENSI_DEMO\)/.test(modulo) && /chiaveInvio\.current \?\?= nuovaChiaveInvio\(\)/.test(modulo) && /dati\.set\(NOME_CAMPO_CHIAVE, chiaveInvio\.current\)/.test(modulo) && !/chiaveInvio\.current = /.test(modulo));
  atteso("modulo: la scheda del calendario si apre subito nel clic (prima dell'attesa del server), senza accesso alla pagina di partenza, e si riempie dopo", modulo.indexOf('window.open("about:blank", "_blank")') > 0 && modulo.indexOf('window.open("about:blank", "_blank")') < modulo.indexOf("await inviaRichiestaDemo(dati)") && /scheda\.opener = null/.test(modulo) && /scheda\.location\.href = LINK_PRENOTA_DEMO/.test(modulo) && /scheda\?\.close\(\)/.test(modulo));
  atteso("modulo: il calendario si apre SOLO dopo l'esito positivo del server; con un errore (anche recuperabile) la scheda si chiude, si mostra il messaggio e si può riprovare", (modulo.match(/scheda\.location\.href/g) ?? []).length === 1 && /if \(!risposta\.ok\) \{[\s\S]*?return;\s*\}\s*inviaEventoGa\("demo_lead_submitted"[^;]*;\s*if \(scheda\) scheda\.location\.href = LINK_PRENOTA_DEMO;/.test(modulo) && /if \(!risposta\.ok\) \{[\s\S]*scheda\?\.close\(\);[\s\S]*setErrore\(risposta\.errore\);[\s\S]*return;\s*\}/.test(modulo) && /Apri il calendario e scegli l'orario/.test(modulo) && /<LinkDemo /.test(modulo));
  atteso("modulo: se il server chiede di ricaricare la pagina (testi cambiati) compare il pulsante «Ricarica la pagina»; se la risposta si perde si può riprovare con lo stesso modulo", /risposta\.ricarica === true/.test(modulo) && /Ricarica la pagina/.test(modulo) && /Riprova tra un istante/.test(modulo));
  atteso("modulo: l'attribuzione e i cookie di Analytics si leggono SOLO con i cookie pubblicitari accettati", /const consenso = cookiePubblicitariAccettati\(localStorage\.getItem\(CHIAVE_CONSENSO_COOKIE\)\)/.test(modulo) && /if \(consenso\) \{[\s\S]*leggiAttribuzioneSalvata[\s\S]*valoreCookie\(cookie, "_ga"\)[\s\S]*\}/.test(modulo) && /dati\.set\("cookie_ok", consenso \? "1" : "0"\)/.test(modulo));
  atteso("modulo: eventi GA4 «demo_booking_start» (primo campo toccato) e «demo_lead_submitted» (dopo l'esito positivo), mai «demo_booking_confirmed»", /inviaEventoGa\("demo_booking_start"/.test(modulo) && /inviaEventoGa\("demo_lead_submitted"/.test(modulo) && modulo.indexOf('inviaEventoGa("demo_lead_submitted"') > modulo.indexOf("if (!risposta.ok)") && !/demo_booking_confirmed/.test(modulo) && /onFocusCapture=\{alPrimoCampo\}/.test(modulo));
  atteso("modulo: Analytics si usa solo se il tag è già caricato dal banner (nessun gtag creato né caricato qui)", /typeof gtag === "function"/.test(modulo) && !/googletagmanager|gtag\('config'|gtag\("config"|dataLayer/.test(modulo));
  atteso("modulo: nessuna chiave riservata né client privilegiato nel browser (nemmeno i segreti dei consensi)", !/service_role|SERVICE_ROLE|createAdminClient|process\.env|demo-hash|DEMO_CONSENT/.test(modulo) && !/service_role|SERVICE_ROLE|createAdminClient|process\.env/.test(leggi("src/components/omnia-ai/attribuzione-demo.tsx")));
  atteso("il link del calendario NON è nell'URL con parametri pubblicitari: il modulo apre solo la costante", /LINK_PRENOTA_DEMO/.test(modulo) && !/calendar\.app\.google/.test(modulo) && !/\$\{.*LINK_PRENOTA_DEMO.*\?/.test(modulo) && !/LINK_PRENOTA_DEMO\s*\+/.test(modulo));
  atteso("il file dei testi dei consensi e quello degli hash NON finiscono nel browser per sbaglio: il modulo importa solo il file dei calcoli puri (senza node:crypto)", !/node:crypto/.test(leggi("src/lib/demo-consensi-calcoli.ts")) && !/node:crypto/.test(leggi("src/lib/demo-lead-calcoli.ts")) && !/from "@\/lib\/demo-hash"|from "@\/lib\/demo-consensi"/.test(modulo));

  const attrib = leggi("src/components/omnia-ai/attribuzione-demo.tsx");
  atteso("attribuzione: salva solo con i cookie pubblicitari accettati, cancella se il consenso non c'è più, legge solo il localStorage", /cookiePubblicitariAccettati\(localStorage\.getItem\(CHIAVE_CONSENSO_COOKIE\)\)/.test(attrib) && /localStorage\.removeItem\(CHIAVE_ATTRIBUZIONE\)/.test(attrib) && !/document\.cookie\s*=/.test(attrib) && !/fetch\(|sendBeacon|XMLHttpRequest/.test(attrib));
  atteso("attribuzione: si aggiorna anche quando il visitatore sceglie nel banner (evento di cambio consenso), con pulizia dell'ascoltatore", /window\.addEventListener\(EVENTO_CAMBIO_CONSENSO, aggiorna\)/.test(attrib) && /window\.removeEventListener\(EVENTO_CAMBIO_CONSENSO, aggiorna\)/.test(attrib) && /EVENTO_CAMBIO_CONSENSO = "omnia-ai-consent-change"/.test(attrib) && /const CONSENT_EVENT = "omnia-ai-consent-change";/.test(leggi("src/components/omnia-ai/cookie-consent.tsx")));
  atteso("il layout monta la cattura dell'attribuzione accanto al banner", /import AttribuzioneDemo from "@\/components\/omnia-ai\/attribuzione-demo";/.test(leggi("src/app/site-omnia-ai/layout.tsx")) && /<OmniaAiCookieConsent \/>\s*<AttribuzioneDemo \/>/.test(leggi("src/app/site-omnia-ai/layout.tsx")));

  const banner = leggi("src/components/omnia-ai/cookie-consent.tsx");
  atteso("il tracciamento esistente NON è stato toccato: stesso ID di Google Analytics, nessun ID Google Ads collegato, stessi script e stessa logica del banner", /const GA4_ID = "G-W551SWPNE4";/.test(banner) && /const GADS_ID: string \| null = null;/.test(banner) && /gtag\('config', '\$\{GA4_ID\}'\);/.test(banner) && /\{status === "accepted" && \(/.test(banner) && (banner.match(/gtag\('config'/g) ?? []).length === 2 && !/AW-18422155730|GT-P8RVLQB4/.test(banner));
  atteso("nessun altro file del sito OMNIA AI carica gtag.js o configura un secondo tag (nessun tracciamento duplicato)", (() => { const colpevoli: string[] = []; const percorri = (dir: string) => { for (const v of fs.readdirSync(path.join(radice, dir), { withFileTypes: true })) { const f = `${dir}/${v.name}`; if (v.isDirectory()) percorri(f); else if (/\.(ts|tsx)$/.test(v.name) && f !== "src/components/omnia-ai/cookie-consent.tsx" && f !== "src/components/cookie-consent.tsx" && /googletagmanager\.com\/gtag|gtag\(['"]config['"]/.test(fs.readFileSync(path.join(radice, f), "utf-8"))) colpevoli.push(f); } }; percorri("src"); return colpevoli.length === 0; })());

  const sync = leggi("src/app/api/cron/omnia-ai-demo-sync/route.ts");
  const purge = leggi("src/app/api/cron/omnia-ai-demo-purge/route.ts");
  const ciclo = leggi("src/lib/demo-ciclo.ts");
  atteso("cron: entrambe le route controllano il segreto PRIMA di fare qualsiasi cosa e rispondono 401 altrimenti", [sync, purge].every((r) => r.indexOf("cronAutorizzato(") > 0 && r.indexOf("cronAutorizzato(") < r.indexOf("createAdminClient()") && /status: 401/.test(r)));
  atteso("cron di sincronizzazione: un solo giro protetto dal blocco; tre passi indipendenti (un errore non ferma gli altri); il blocco si rilascia SEMPRE (finally); la risposta contiene solo numeri", /eseguiCicloDemo\(/.test(sync) && /acquisisciBlocco\(/.test(ciclo) && /finally \{\s*await rilasciaBlocco\(admin\);\s*\}/.test(ciclo) && (ciclo.match(/try \{/g) ?? []).length === 4 && /sincronizzaCalendario\(/.test(ciclo) && /inviaConversioniGa4\(/.test(ciclo) && /inviaConversioniAds\(/.test(ciclo) && !/\.email|full_name|gclid/.test(sync + ciclo));
  atteso("cron: i tre passi partono DOPO il blocco (se un altro giro è in corso non si tocca niente)", ciclo.indexOf("acquisisciBlocco(") < ciclo.indexOf("sincronizzaCalendario(") && ciclo.indexOf("sincronizzaCalendario(") < ciclo.indexOf("inviaConversioniGa4(") && ciclo.indexOf("inviaConversioniGa4(") < ciclo.indexOf("inviaConversioniAds("));
  const vercel = JSON.parse(leggi("vercel.json")) as { crons: { path: string; schedule: string }[] };
  atteso("vercel.json: sincronizzazione ogni 10 minuti (richiede il piano Pro di Vercel, che il progetto ha già) e conservazione ogni giorno; i cron di prima restano", vercel.crons.some((c) => c.path === "/api/cron/omnia-ai-demo-sync" && c.schedule === "*/10 * * * *") && vercel.crons.some((c) => c.path === "/api/cron/omnia-ai-demo-purge" && c.schedule === "30 3 * * *") && vercel.crons.some((c) => c.path === "/api/cron/omnia-ai-purge-cessati") && vercel.crons.some((c) => c.path === "/api/cron/omnia-ai-email-retry" && c.schedule === "*/15 * * * *") && vercel.crons.length === 4);

  const sorgentiIntegrazioni = ["src/lib/demo-calendario-sync.ts", "src/lib/demo-ga4.ts", "src/lib/demo-ads-data-manager.ts", "src/lib/google-oauth.ts", "src/lib/demo-leads.ts", "src/lib/demo-consensi.ts", "src/lib/demo-blocco.ts", "src/lib/demo-ciclo.ts"].map((f) => [f, leggi(f)] as const);
  atteso("nessun console.* nelle integrazioni stampa dati personali o segreti (solo codici e numeri)", sorgentiIntegrazioni.every(([, t]) => (t.match(/console\.(log|warn|error|info)\(([^)]*)\)/g) ?? []).every((c) => !/email|nome|full_name|gclid|token|secret|segreto|corpo|refresh/i.test(c.replace(/"[^"]*"/g, "")))));
  atteso("le integrazioni leggono i segreti solo dall'ambiente, nessun segreto scritto nel codice", sorgentiIntegrazioni.every(([, t]) => !/ya29\.|1\/\/0[A-Za-z0-9_-]{20,}|GOCSPX-|AIza[A-Za-z0-9_-]{20,}/.test(t)) && /env\.GOOGLE_OAUTH_CLIENT_SECRET/.test(leggi("src/lib/google-oauth.ts")));
  atteso("il calendario si legge in SOLA lettura: nessuna chiamata di scrittura verso Calendar e solo l'ambito calendar.readonly", !/method:\s*"(POST|PUT|PATCH|DELETE)"/.test(leggi("src/lib/demo-calendario-sync.ts")) && /calendar\.readonly/.test(leggi("src/lib/demo-calendario-sync.ts")));
  atteso("GA4 non si importa in Google Ads: il file di Ads non cita GA4 e viceversa (niente doppia conversione)", !/google-analytics|mp\/collect/.test(leggi("src/lib/demo-ads-data-manager.ts")) && !/datamanager|googleads/.test(leggi("src/lib/demo-ga4.ts")));
  atteso("Google Ads usa gli endpoint della Data Manager API e lo scope dedicato", /https:\/\/datamanager\.googleapis\.com\/v1\/events:ingest/.test(leggi("src/lib/demo-conversioni-calcoli.ts")) && /https:\/\/datamanager\.googleapis\.com\/v1\/requestStatus:retrieve/.test(leggi("src/lib/demo-conversioni-calcoli.ts")) && /https:\/\/www\.googleapis\.com\/auth\/datamanager/.test(leggi("src/lib/demo-conversioni-calcoli.ts")));
  atteso("GA4 e Ads leggono il consenso dal REGISTRO firmato (non dalle colonne riassuntive) e non partono senza il segreto della firma", ["src/lib/demo-ga4.ts", "src/lib/demo-ads-data-manager.ts"].every((f) => /leggiConsensi\(/.test(leggi(f)) && /verificatoreFirma\(/.test(leggi(f)) && /segretoFirmaConsensi\(env\)/.test(leggi(f)) && /segreto_firma_mancante/.test(leggi(f))) && !/ads_measurement_consent|attribution_consent/.test(leggi("src/lib/demo-ads-data-manager.ts")));
  atteso("i moduli di rete accettano fetch iniettato (testabili) e hanno un tempo massimo per ogni chiamata", ["src/lib/demo-calendario-sync.ts", "src/lib/demo-ga4.ts", "src/lib/demo-ads-data-manager.ts", "src/lib/google-oauth.ts"].every((f) => /fetchFn: typeof fetch = fetch/.test(leggi(f)) && /TEMPO_MASSIMO_MS/.test(leggi(f)) && /AbortController/.test(leggi(f))));
  atteso("nessuna modifica a pagamenti, abbonamenti, autenticazione o generazione delle offerte: i file toccati dal tracciamento sono solo quelli della demo", (() => { const vietati = ["src/app/api/webhooks/stripe/route.ts", "src/app/actions/gara-extraction.ts", "src/app/actions/gara-chat.ts", "src/lib/zone.ts", "src/proxy.ts", "src/lib/supabase/middleware.ts"]; return vietati.every((f) => !/demo-lead|demo_leads|demo-ga4|demo-ads|demo-calendario|LINK_PRENOTA_DEMO|demo_consensi/.test(leggi(f))); })());

  const guida = fs.existsSync(path.join(radice, "GUIDA-DEMO-TRACCIAMENTO.md")) ? leggi("GUIDA-DEMO-TRACCIAMENTO.md") : "";
  const variabili = ["DEMO_LEADS_HASH_SECRET", "DEMO_LEADS_ATTIVO", "DEMO_CONSENT_SIGNING_SECRET", "DEMO_MULTI_RICHIESTA", "CRON_SECRET", "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_CALENDAR_REFRESH_TOKEN", "GOOGLE_CALENDAR_ID", "DEMO_CALENDAR_SYNC_ENABLED", "DEMO_CALENDAR_TITLE_REGEX", "DEMO_CALENDAR_INTERNAL_EMAILS", "DEMO_MATCH_WINDOW_DAYS", "DEMO_GA4_MP_ENABLED", "GA4_API_SECRET", "GA4_MEASUREMENT_ID", "DEMO_GA4_MP_DEBUG", "DEMO_ADS_IMPORT_ENABLED", "DEMO_ADS_VALIDATE_ONLY", "DEMO_ADS_ALLOW_EMAIL_ONLY", "GOOGLE_ADS_CUSTOMER_ID", "GOOGLE_ADS_LOGIN_CUSTOMER_ID", "GOOGLE_ADS_DEMO_CONVERSION_ACTION_ID", "GOOGLE_ADS_REFRESH_TOKEN"];
  atteso("la guida esiste e descrive TUTTE le variabili d'ambiente usate dal codice", guida.length > 3000 && variabili.every((v) => guida.includes(v)), variabili.filter((v) => !guida.includes(v)).join(", "));
  const usate = new Set<string>();
  for (const f of ["src/lib/demo-calendario-sync.ts", "src/lib/demo-calendario-calcoli.ts", "src/lib/demo-ga4.ts", "src/lib/demo-ads-data-manager.ts", "src/lib/google-oauth.ts", "src/lib/demo-hash.ts", "src/lib/demo-ciclo.ts", "src/lib/demo-leads.ts", "src/app/actions/omnia-ai-demo.ts"]) for (const m of leggi(f).matchAll(/env\.([A-Z][A-Z0-9_]+)|process\.env\.([A-Z][A-Z0-9_]+)|env\[([A-Za-z]+)\]/g)) if (m[1] || m[2]) usate.add(m[1] ?? m[2]);
  atteso("ogni variabile letta dal codice è nella guida, e nessuna è esposta al browser (nessun NEXT_PUBLIC_)", [...usate].every((v) => guida.includes(v) && !v.startsWith("NEXT_PUBLIC_")), [...usate].filter((v) => !guida.includes(v)).join(", "));
  atteso("la guida dichiara cosa manca prima di andare in produzione (credenziali, prenotazione di prova, azione di conversione, informativa privacy), i limiti noti e i problemi ancora aperti", /Passaggi manuali/i.test(guida) && /azione di conversione/i.test(guida) && /prenotazione di prova/i.test(guida) && /informativa/i.test(guida) && /Limiti/i.test(guida) && /Problemi ancora aperti/i.test(guida));
  atteso("la guida documenta le otto migliorie (errore recuperabile, tre identificativi, registro dei consensi, calendario, limiti di Vercel, console DEMO, Data Manager API, verifiche)", /errore recuperabile/i.test(guida) && /tre identificativi/i.test(guida) && /registro dei consensi/i.test(guida) && /riprogramm/i.test(guida) && /piano Pro/i.test(guida) && /console/i.test(guida) && /Data Manager/i.test(guida) && /DEMO_LEADS_ATTIVO/.test(guida));
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
