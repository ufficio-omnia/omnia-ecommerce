// Autotest della PROVA REALE dell'evento GA4 «demo_booking_confirmed» (richiesta dell'utente, 05/11/2026): un'azione dell'amministratore
// manda UN evento per UNA richiesta di prova, dopo averla prenotata in modo esclusivo (tabella demo_ga4_prove, migrazione 0099).
//
// Nessuna rete, nessun database vero, nessuna chiave: moduli puri, un database finto in memoria che imita anche i vincoli e il trigger
// della migrazione 0099, e un fetch finto che registra le chiamate (scripts/demo-finto-supabase.ts). Il test NON chiama mai GA4.
// Si controlla in particolare che:
//   - senza interruttori (GA4 acceso, segreti, email di prova) e senza la frase digitata NON parta niente;
//   - l'invio sia UNO, all'endpoint di PRODUZIONE (mai quello di validazione), e solo dopo la prenotazione esclusiva;
//   - due, otto, cento tentativi in parallelo o uno dopo l'altro producano UNA sola chiamata (chiave unica + blocco);
//   - nessun ritentativo automatico, qualunque sia l'esito (4xx, 5xx, rete, tempo scaduto, scrittura dell'esito fallita);
//   - una risposta 2xx NON diventi mai «verificata» da sola: solo la dichiarazione dell'amministratore (con frase) lo fa;
//   - consensi e firma siano verificati, e demo_leads / demo_consensi / Google Ads non vengano toccati;
//   - il cron GA4 non riprenda MAI una richiesta riservata alla prova (in nessuno stato, con DEBUG acceso o spento) e si fermi se non
//     riesce a saperlo;
//   - la macchina a stati del codice coincida con quella del trigger, e nessun segreto o dato personale esca da risultati, log e righe.
import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import { FintoDatabase, fetchFinto, type Riga } from "./demo-finto-supabase";
import { costruisciConsensi, stringaDaFirmare } from "../src/lib/demo-consensi-calcoli";
import { firmaConsenso, sha256Hex } from "../src/lib/demo-hash";
import { costruisciCorpoGa4 } from "../src/lib/demo-conversioni-calcoli";
import {
  COSA_FARE_STATO_PROVA,
  ETICHETTA_STATO_PROVA,
  FRASE_EVENTO_ASSENTE,
  FRASE_EVENTO_PRESENTE,
  FRASE_INVIO_PROVA,
  MINUTI_RISERVA_SCADUTA,
  STATI_DA_RISOLVERE,
  STATI_FINALI_PROVA,
  STATI_PROVA_GA4,
  TONO_STATO_PROVA,
  anteprimaEvento,
  emailInProva,
  emailProvaDaAmbiente,
  esitoDaEccezione,
  esitoDaStatoHttp,
  fraseCorretta,
  fraseRisoluzione,
  idRichiestaValido,
  motiviNonIdonea,
  risolvibile,
  statoGateProva,
  transizioneAmmessa,
  type LeadPerProva,
  type StatoProvaGa4,
} from "../src/lib/demo-ga4-prova-calcoli";
import { idRichiesteRiservate, leggiProveGa4, registraEsitoInvio, risolviProvaGa4, riservaInvioGa4 } from "../src/lib/demo-ga4-riserva";
import { URL_GA4_PRODUZIONE, inviaProvaGa4, preparaProvaGa4, risolviProvaGa4Admin } from "../src/lib/demo-ga4-prova";
import { inviaConversioniGa4 } from "../src/lib/demo-ga4";
import { eseguiCicloDemo } from "../src/lib/demo-ciclo";
import { riepilogoGa4 } from "../src/lib/console/demo-calcoli";
import { leggiDemo } from "../src/lib/console/demo";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
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

// ── Dati di prova ────────────────────────────────────────────────────────────────────────────────────────────────────────

const ADESSO_ISO = "2026-11-10T10:00:00.000Z";
const ADESSO = Date.parse(ADESSO_ISO);
const SEGRETO_FIRMA = "firma-segreto";
const SEGRETO_API = "ga-segreto-prova";
const ID_MISURAZIONE = "G-TESTPROVA1";
const EMAIL_PROVA = "prova.ga4@esempio.it";
const CLIENT_ID = "1234567890.1700000000";
const UTENTE = "11111111-1111-4111-8111-111111111111";
const PRENOTATA_ISO = "2026-11-10T09:50:00.000Z"; // 10 minuti prima di «adesso»
const SEGRETI = [SEGRETO_API, SEGRETO_FIRMA, EMAIL_PROVA, "Prova.GA4@Esempio.it", CLIENT_ID];

const ENV = {
  DEMO_GA4_MP_ENABLED: "1",
  GA4_API_SECRET: SEGRETO_API,
  GA4_MEASUREMENT_ID: ID_MISURAZIONE,
  DEMO_CONSENT_SIGNING_SECRET: SEGRETO_FIRMA,
  DEMO_GA4_PROVA_EMAIL: "Prova.GA4@Esempio.it",
  DEMO_GA4_MP_DEBUG: "1",
};

type OpzioniConsensi = { privacy?: boolean; cookie?: boolean; ads?: boolean; firmare?: boolean };
function consensiFirmati(leadId: string, o: OpzioniConsensi = {}): Riga[] {
  return costruisciConsensi({ adsConsenso: o.ads ?? true, cookieAccettati: o.cookie ?? true, ipHash: null }, sha256Hex)
    .filter((c) => c.tipo !== "informativa_privacy" || o.privacy !== false)
    .map((c) => {
      const r = { ...c, lead_id: leadId, registrato_il: "2026-11-10T09:45:00.000Z" };
      return { ...r, firma: o.firmare === false ? null : firmaConsenso(stringaDaFirmare(r), SEGRETO_FIRMA) };
    });
}

function richiesta(extra: Riga = {}): Riga {
  const id = (extra.id as string | undefined) ?? randomUUID();
  return {
    id, contatto_id: `contatto-${id}`, idempotency_key: `chiave-${id}-xxxxxxxxxx`,
    full_name: "Prova Ga4", company: "Azienda di prova", email: "Prova.GA4@Esempio.it", email_norm: EMAIL_PROVA,
    phone: "+393331234567", sector: "Pulizie e sanificazione", gclid: null, gbraid: null, wbraid: null,
    utm_source: "google", utm_medium: "cpc", utm_campaign: "demo", utm_content: null, utm_term: null, landing_path: "/",
    ga_client_id: CLIENT_ID, ga_session_id: "1700000000", attribution_consent: true,
    ads_measurement_consent: true, ads_measurement_consent_at: "2026-11-10T09:45:00.000Z", ip_hash: null,
    booking_status: "confirmed", superseded_by: null, prima_prenotazione_il: PRENOTATA_ISO,
    ga4_sent_at: null, ga4_attempts: 0, ads_import_status: "not_ready", ads_transaction_id: null, ads_request_id: null, ads_sent_at: null, ads_attempts: 0,
    ads_next_attempt_at: null, ads_last_error: null, created_at: "2026-11-10T09:45:00.000Z", updated_at: "2026-11-10T09:45:00.000Z", ...extra,
  };
}

function rigaProva(leadId: string, stato: StatoProvaGa4, extra: Riga = {}): Riga {
  return {
    lead_id: leadId, origine: "prova", stato, transaction_id: `omnia-demo-${leadId}`, id_misurazione: ID_MISURAZIONE,
    timestamp_evento: PRENOTATA_ISO, timestamp_modalita: "prenotazione", riservata_il: ADESSO_ISO, riservata_da: UTENTE,
    inviata_il: null, esito_codice: null, http_status: null, risolta_il: null, risolta_da: null, aggiornata_il: ADESSO_ISO, ...extra,
  };
}

function dbCon(o: { leads?: Riga[]; consensi?: Record<string, OpzioniConsensi>; prove?: Riga[]; lock?: string | null } = {}): FintoDatabase {
  const leads = o.leads ?? [];
  const contatti = leads.map((l) => ({ id: l.contatto_id, email_norm: l.email_norm, email: l.email, full_name: l.full_name, company: l.company, phone: l.phone, sector: l.sector, ultima_richiesta_il: l.created_at, created_at: l.created_at, updated_at: l.created_at }));
  return new FintoDatabase({
    demo_contatti: contatti,
    demo_leads: leads,
    demo_consensi: leads.flatMap((l) => consensiFirmati(l.id as string, o.consensi?.[l.id as string] ?? {})),
    demo_ga4_prove: o.prove ?? [],
    demo_sync_stato: [{ id: 1, sync_token: null, last_run_at: null, last_success_at: null, last_error: null, lock_until: o.lock ?? null }],
  });
}

const fotografia = (db: FintoDatabase, tabella: string) => JSON.stringify(db.da(tabella));
const scrittureSu = (db: FintoDatabase, tabelle: string[]) => db.operazioni.filter((o) => tabelle.includes(o.tabella) && o.tipo !== "select").length;
const invia = (db: FintoDatabase, leadId: unknown, f: typeof fetch, env: Record<string, string | undefined> = ENV, frase: unknown = FRASE_INVIO_PROVA, adesso = ADESSO, tempo?: number) =>
  inviaProvaGa4(db.comeClient(), env, { leadId, frase, utenteId: UTENTE }, adesso, f, tempo);
const sendOk = () => fetchFinto(() => ({ status: 204 }));

// fetch che risponde dopo un po' (per far sovrapporre le esecuzioni)
function fetchLento(ms: number, status = 204) {
  const chiamate: string[] = [];
  const f = (async (input: RequestInfo | URL) => {
    chiamate.push(String(input));
    await new Promise((r) => setTimeout(r, ms));
    return { ok: status >= 200 && status < 300, status, json: async () => ({}) } as unknown as Response;
  }) as typeof fetch;
  return { fetch: f, chiamate };
}
// fetch che non risponde mai, ma rispetta il segnale di annullamento (per provare il tempo massimo)
function fetchSospeso() {
  const chiamate: string[] = [];
  const f = ((input: RequestInfo | URL, init?: RequestInit) => {
    chiamate.push(String(input));
    return new Promise<Response>((_, rifiuta) => {
      init?.signal?.addEventListener("abort", () => rifiuta(new DOMException("The operation was aborted", "AbortError")));
    });
  }) as typeof fetch;
  return { fetch: f, chiamate };
}

async function main() {
  // ═════════════════════════ 1. Regole pure ═════════════════════════
  console.log("--- Regole pure ---");
  atteso("la frase di conferma si confronta INTERA e identica: spazi ai bordi e doppi spazi non contano, maiuscole sì, qualsiasi altra cosa no", fraseCorretta(FRASE_INVIO_PROVA, FRASE_INVIO_PROVA) && fraseCorretta(`  ${FRASE_INVIO_PROVA}  `, FRASE_INVIO_PROVA) && fraseCorretta("INVIA  1   EVENTO REALE", FRASE_INVIO_PROVA) && !fraseCorretta("invia 1 evento reale", FRASE_INVIO_PROVA) && !fraseCorretta("INVIA 1 EVENTO", FRASE_INVIO_PROVA) && !fraseCorretta(`${FRASE_INVIO_PROVA}!`, FRASE_INVIO_PROVA) && !fraseCorretta("", FRASE_INVIO_PROVA) && !fraseCorretta(undefined, FRASE_INVIO_PROVA) && !fraseCorretta(null, FRASE_INVIO_PROVA) && !fraseCorretta(42, FRASE_INVIO_PROVA) && !fraseCorretta(["INVIA 1 EVENTO REALE"], FRASE_INVIO_PROVA));
  atteso("le tre frasi sono diverse tra loro (una frase di risoluzione non può mai autorizzare un invio) e ciascuna dichiarazione ha la sua", new Set([FRASE_INVIO_PROVA, FRASE_EVENTO_PRESENTE, FRASE_EVENTO_ASSENTE]).size === 3 && fraseRisoluzione("verified") === FRASE_EVENTO_PRESENTE && fraseRisoluzione("not_received") === FRASE_EVENTO_ASSENTE && !fraseCorretta(FRASE_EVENTO_PRESENTE, FRASE_INVIO_PROVA) && !fraseCorretta(FRASE_INVIO_PROVA, FRASE_EVENTO_PRESENTE));
  atteso("identificativo di richiesta: solo UUID", idRichiestaValido(randomUUID()) && !idRichiestaValido("l-ok") && !idRichiestaValido("") && !idRichiestaValido(undefined) && !idRichiestaValido("' or 1=1 --") && !idRichiestaValido(`${randomUUID()}x`) && !idRichiestaValido(`x${randomUUID()}`) && !idRichiestaValido(` ${randomUUID()}`) && !idRichiestaValido(`${randomUUID()}\n`) && !idRichiestaValido(123));
  atteso("email di prova: una o più, separate da virgola, punto e virgola o spazio; minuscole, senza doppioni, solo indirizzi con forma valida", JSON.stringify(emailProvaDaAmbiente({ DEMO_GA4_PROVA_EMAIL: " A@x.it, b@y.it;A@X.IT  c@z.it senza-chiocciola , , @x.it, x@y" })) === JSON.stringify(["a@x.it", "b@y.it", "c@z.it"]) && emailProvaDaAmbiente({}).length === 0 && emailProvaDaAmbiente({ DEMO_GA4_PROVA_EMAIL: "   " }).length === 0);
  atteso("l'email di una richiesta si confronta in minuscolo e senza spazi", emailInProva("  Prova.GA4@Esempio.it ", [EMAIL_PROVA]) && !emailInProva("altro@esempio.it", [EMAIL_PROVA]) && !emailInProva("prova.ga4@esempio.it", []));

  const gate = (env: Record<string, string | undefined>, firma = true) => statoGateProva(env, firma);
  atteso("prova attiva solo con GA4 acceso, segreto API, segreto di firma ed email di prova; ciascuno mancante la spegne dicendo perché", gate(ENV).attiva && gate(ENV).mancanti.length === 0 && gate(ENV).emailDiProva === 1 && gate({ ...ENV, DEMO_GA4_MP_ENABLED: "0" }).mancanti.join() === "ga4_spento" && gate({ ...ENV, DEMO_GA4_MP_ENABLED: undefined }).mancanti.join() === "ga4_spento" && gate({ ...ENV, GA4_API_SECRET: " " }).mancanti.join() === "segreto_api_mancante" && gate(ENV, false).mancanti.join() === "segreto_firma_mancante" && gate({ ...ENV, DEMO_GA4_PROVA_EMAIL: "" }).mancanti.join() === "email_prova_mancante" && gate({}, false).mancanti.length === 4 && !gate({}, false).attiva);
  atteso("DEMO_GA4_MP_DEBUG non cambia l'interruttore (riguarda solo il cron)", gate({ ...ENV, DEMO_GA4_MP_DEBUG: "0" }).attiva === gate({ ...ENV, DEMO_GA4_MP_DEBUG: "1" }).attiva && gate({ ...ENV, DEMO_GA4_MP_DEBUG: undefined }).attiva);

  const leadPuro = richiesta() as unknown as LeadPerProva;
  const tutti = { privacy: true, cookie: true, misurazione: true };
  const lista = [EMAIL_PROVA];
  atteso("richiesta idonea: nessun motivo di esclusione", motiviNonIdonea(leadPuro, tutti, lista).length === 0);
  const motivoDi = (extra: Riga, consensi = tutti, l: string[] = lista) => motiviNonIdonea(richiesta(extra) as unknown as LeadPerProva, consensi, l);
  atteso("ogni condizione mancante è un motivo a sé: non confermata, senza data, email non di prova, senza client_id, cookie (colonna), consensi del registro, già inviata", motivoDi({ booking_status: "pending" }).join() === "non_confermata" && motivoDi({ booking_status: "cancelled" }).includes("non_confermata") && motivoDi({ prima_prenotazione_il: null }).join() === "senza_data_prenotazione" && motivoDi({}, tutti, ["altro@esempio.it"]).join() === "email_non_di_prova" && motivoDi({}, tutti, []).join() === "email_non_di_prova" && motivoDi({ ga_client_id: null }).join() === "senza_client_id" && motivoDi({ attribution_consent: false }).join() === "cookie_non_accettati" && motivoDi({ attribution_consent: null }).join() === "cookie_non_accettati" && motivoDi({}, { ...tutti, privacy: false }).join() === "consensi_non_validi" && motivoDi({}, { ...tutti, cookie: false }).join() === "consensi_non_validi" && motivoDi({ ga4_sent_at: "2026-11-09T10:00:00.000Z" }).join() === "gia_inviata");
  atteso("la misurazione pubblicitaria NON è richiesta per la prova (solo cambia ad_personalization)", motivoDi({}, { privacy: true, cookie: true, misurazione: false }).length === 0);

  const anteOra = anteprimaEvento(leadPuro, ADESSO, tutti)!;
  const corpoDiretto = costruisciCorpoGa4(leadPuro, ADESSO, tutti)!;
  atteso("l'anteprima usa la STESSA funzione di produzione: il corpo è identico a costruisciCorpoGa4", JSON.stringify(anteOra.corpo) === JSON.stringify(corpoDiretto) && anteOra.corpo.events[0].name === "demo_booking_confirmed" && anteOra.corpo.events[0].params.transaction_id === `omnia-demo-${leadPuro.id}`);
  atteso("prenotazione di 10 minuti fa: l'evento porta l'ora della prenotazione, dentro i 30 minuti di Realtime", anteOra.modalita === "prenotazione" && anteOra.timestampEventoMs === Date.parse(PRENOTATA_ISO) && anteOra.minutiDallaPrenotazione === 10 && anteOra.dentroFinestraRealtime);
  const anteMin = (minuti: number) => anteprimaEvento(richiesta({ prima_prenotazione_il: new Date(ADESSO - minuti * 60_000).toISOString() }) as unknown as LeadPerProva, ADESSO, tutti)!;
  atteso("finestra Realtime: 30 minuti dentro, 31 fuori", anteMin(30).dentroFinestraRealtime && !anteMin(31).dentroFinestraRealtime && anteMin(0).dentroFinestraRealtime);
  const oltre72 = anteprimaEvento(richiesta({ prima_prenotazione_il: new Date(ADESSO - 73 * 3_600_000).toISOString() }) as unknown as LeadPerProva, ADESSO, tutti)!;
  atteso("prenotazione di oltre 72 ore fa: l'evento porta l'ora dell'invio (modalità «invio»)", oltre72.modalita === "invio" && oltre72.timestampEventoMs === ADESSO);
  atteso("senza consensi validi l'anteprima non esiste (nessun corpo da inviare)", anteprimaEvento(leadPuro, ADESSO, { ...tutti, cookie: false }) === null && anteprimaEvento(richiesta({ ga_client_id: null }) as unknown as LeadPerProva, ADESSO, tutti) === null);
  atteso("ad_personalization segue la misurazione pubblicitaria (GRANTED con, DENIED senza)", anteOra.corpo.consent.ad_personalization === "GRANTED" && anteprimaEvento(leadPuro, ADESSO, { ...tutti, misurazione: false })!.corpo.consent.ad_personalization === "DENIED");

  atteso("2xx → inviata ma NON verificata", [200, 201, 204, 299].every((s) => esitoDaStatoHttp(s).stato === "sent_unverified" && esitoDaStatoHttp(s).codice === "http_2xx" && esitoDaStatoHttp(s).httpStato === s));
  atteso("4xx → rifiutata", [400, 401, 403, 404, 429, 499].every((s) => esitoDaStatoHttp(s).stato === "rejected" && esitoDaStatoHttp(s).codice === "http_4xx"));
  atteso("5xx, 3xx, 1xx → incerto (Google può aver registrato l'evento e fallito dopo)", [100, 199, 300, 302, 399, 500, 502, 503, 599].every((s) => esitoDaStatoHttp(s).stato === "uncertain" && esitoDaStatoHttp(s).codice === "http_altro"));
  atteso("nessuna risposta → incerto, con codice «timeout» o «rete» e senza stato HTTP", esitoDaEccezione(true).stato === "uncertain" && esitoDaEccezione(true).codice === "timeout" && esitoDaEccezione(false).codice === "rete" && esitoDaEccezione(false).httpStato === null);
  atteso("nessun esito di invio è mai «verified» o «not_received»", [200, 204, 400, 404, 500].every((s) => !STATI_FINALI_PROVA.includes(esitoDaStatoHttp(s).stato)) && !STATI_FINALI_PROVA.includes(esitoDaEccezione(true).stato) && !STATI_FINALI_PROVA.includes(esitoDaEccezione(false).stato));

  const attesa = (da: StatoProvaGa4, a: StatoProvaGa4): boolean => {
    if (da === "reserved") return a !== "reserved";
    if (da === "sent_unverified" || da === "uncertain" || da === "rejected") return a === "verified" || a === "not_received";
    return false;
  };
  atteso("macchina a stati: tutte le 36 coppie (da → a) come da progetto; i due stati finali non si lasciano mai", STATI_PROVA_GA4.every((da) => STATI_PROVA_GA4.every((a) => transizioneAmmessa(da, a) === attesa(da, a))) && STATI_FINALI_PROVA.every((f) => STATI_PROVA_GA4.every((a) => !transizioneAmmessa(f, a))));
  atteso("nessuno stato torna a «reserved» e da uno stato non si resta nello stesso stato", STATI_PROVA_GA4.every((s) => !transizioneAmmessa(s, "reserved") && !transizioneAmmessa(s, s)));
  const quando = (minutiFa: number) => new Date(ADESSO - minutiFa * 60_000).toISOString();
  atteso("risoluzione a mano: da «inviata non verificata», «incerto» e «rifiutata» sempre; da «prenotata» solo dopo 5 minuti; mai da uno stato finale", STATI_DA_RISOLVERE.every((s) => risolvibile(s, quando(0), ADESSO)) && !risolvibile("reserved", quando(0), ADESSO) && !risolvibile("reserved", quando(MINUTI_RISERVA_SCADUTA - 0.01), ADESSO) && risolvibile("reserved", quando(MINUTI_RISERVA_SCADUTA), ADESSO) && risolvibile("reserved", quando(600), ADESSO) && !risolvibile("verified", quando(600), ADESSO) && !risolvibile("not_received", quando(600), ADESSO) && !risolvibile("reserved", "non-una-data", ADESSO));
  atteso("la durata dopo cui una riserva è «interrotta» coincide con quella del blocco condiviso con il cron (5 minuti)", MINUTI_RISERVA_SCADUTA === 5 && /DURATA_BLOCCO_MS = 5 \* 60_000/.test(leggi("src/lib/demo-blocco.ts")));
  atteso("ogni stato ha etichetta, tono e indicazione su cosa fare; «inviata» dichiara di NON essere verificata", STATI_PROVA_GA4.every((s) => ETICHETTA_STATO_PROVA[s] && TONO_STATO_PROVA[s] && COSA_FARE_STATO_PROVA[s].length > 20) && /NON ancora verificata/.test(ETICHETTA_STATO_PROVA.sent_unverified) && /non prova/.test(COSA_FARE_STATO_PROVA.sent_unverified));

  // la macchina a stati del database (la stessa che impone il trigger) coincide con quella del codice
  {
    let coincide = true;
    for (const da of STATI_PROVA_GA4) {
      for (const a of STATI_PROVA_GA4) {
        const id = randomUUID();
        const db = dbCon({ prove: [rigaProva(id, da)] });
        const r = await db.from("demo_ga4_prove").update({ stato: a }).eq("lead_id", id).select("lead_id");
        if ((r.error === null) !== transizioneAmmessa(da, a)) coincide = false;
      }
    }
    atteso("il database (trigger imitato dal database finto) accetta e rifiuta le stesse transizioni del codice", coincide);
    const id = randomUUID();
    const db = dbCon({ prove: [rigaProva(id, "reserved")] });
    const cambia = async (campo: string, valore: unknown) => (await db.from("demo_ga4_prove").update({ [campo]: valore }).eq("lead_id", id).select("lead_id")).error !== null;
    atteso("il database non permette di cambiare i dati della prenotazione dell'invio (richiesta, origine, ora dell'evento, chi, quando) né di cancellare una riga", (await cambia("lead_id", randomUUID())) && (await cambia("origine", "cron")) && (await cambia("timestamp_evento", "2026-11-10T09:00:00.000Z")) && (await cambia("riservata_il", ADESSO_ISO.replace("10:00", "10:01"))) && (await cambia("riservata_da", null)) && (await cambia("transaction_id", "x")) && (await db.from("demo_ga4_prove").delete().eq("lead_id", id)).error !== null && db.da("demo_ga4_prove").length === 1);
  }

  // ═════════════════════════ 2. Prenotazione esclusiva ═════════════════════════
  console.log("\n--- Prenotazione esclusiva (chiave unica) ---");
  const dati = (leadId: string) => ({ leadId, origine: "prova" as const, utenteId: UTENTE, transactionId: `omnia-demo-${leadId}`, idMisurazione: ID_MISURAZIONE, timestampEventoIso: PRENOTATA_ISO, modalitaTimestamp: "prenotazione" as const, adessoIso: ADESSO_ISO });
  {
    const id = randomUUID();
    const db = dbCon();
    const a = await riservaInvioGa4(db.comeClient(), dati(id));
    const b = await riservaInvioGa4(db.comeClient(), dati(id));
    atteso("la prima prenotazione riesce (stato «reserved», con chi e quando), la seconda sulla stessa richiesta no", a.ok && !b.ok && !b.ok && b.motivo === "gia_presente" && db.da("demo_ga4_prove").length === 1 && db.da("demo_ga4_prove")[0].stato === "reserved" && db.da("demo_ga4_prove")[0].riservata_da === UTENTE && db.da("demo_ga4_prove")[0].origine === "prova");
    const id2 = randomUUID();
    const db2 = dbCon();
    const tante = await Promise.all(Array.from({ length: 25 }, () => riservaInvioGa4(db2.comeClient(), dati(id2))));
    atteso("25 prenotazioni IN PARALLELO della stessa richiesta (istanze diverse): ne riesce UNA sola, le altre sono «già presente»", tante.filter((r) => r.ok).length === 1 && tante.filter((r) => !r.ok && r.motivo === "gia_presente").length === 24 && db2.da("demo_ga4_prove").length === 1);
    const altre = await Promise.all([randomUUID(), randomUUID(), randomUUID()].map((x) => riservaInvioGa4(db2.comeClient(), dati(x))));
    atteso("richieste diverse non si bloccano a vicenda", altre.every((r) => r.ok) && db2.da("demo_ga4_prove").length === 4);
    const dbA = dbCon();
    dbA.errori.demo_ga4_prove = { code: "42P01", message: "relation does not exist" };
    const dbG = dbCon();
    dbG.errori.demo_ga4_prove = { code: "XX000", message: "boom" };
    const rA = await riservaInvioGa4(dbA.comeClient(), dati(id));
    const rG = await riservaInvioGa4(dbG.comeClient(), dati(id));
    atteso("tabella non creata → «schema_assente»; qualunque altro errore → «errore_database» (mai scambiati per «già presente»)", !rA.ok && rA.motivo === "schema_assente" && !rG.ok && rG.motivo === "errore_database");
  }
  {
    const id = randomUUID();
    const db = dbCon({ prove: [rigaProva(id, "reserved")] });
    const esito = { stato: "sent_unverified" as const, codice: "http_2xx" as const, httpStato: 204 };
    const ok1 = await registraEsitoInvio(db.comeClient(), id, esito, ADESSO_ISO);
    const ok2 = await registraEsitoInvio(db.comeClient(), id, { stato: "rejected", codice: "http_4xx", httpStato: 400 }, ADESSO_ISO);
    atteso("l'esito si scrive SOLO se la riga è ancora «reserved» e una volta sola (confronta e scambia): il secondo tentativo non sovrascrive", ok1 && !ok2 && db.da("demo_ga4_prove")[0].stato === "sent_unverified" && db.da("demo_ga4_prove")[0].http_status === 204 && db.da("demo_ga4_prove")[0].esito_codice === "http_2xx" && db.da("demo_ga4_prove")[0].inviata_il === ADESSO_ISO);
    const ignota = await registraEsitoInvio(db.comeClient(), randomUUID(), esito, ADESSO_ISO);
    const dbE = dbCon({ prove: [rigaProva(id, "reserved")] });
    dbE.errori.demo_ga4_prove = { code: "XX000", message: "boom" };
    atteso("richiesta senza riga o database in errore → l'esito NON risulta registrato", !ignota && !(await registraEsitoInvio(dbE.comeClient(), id, esito, ADESSO_ISO)));
  }
  {
    const id = randomUUID();
    const prova = (stato: StatoProvaGa4, riservata = ADESSO_ISO) => dbCon({ prove: [rigaProva(id, stato, { riservata_il: riservata })] });
    const risolvi = (db: FintoDatabase, esito: "verified" | "not_received" = "verified", adesso = ADESSO) => risolviProvaGa4(db.comeClient(), id, esito, UTENTE, adesso);
    const d1 = prova("sent_unverified");
    const r1 = await risolvi(d1);
    atteso("da «inviata non verificata» l'amministratore dichiara «verified»: si registra chi e quando", r1.ok && d1.da("demo_ga4_prove")[0].stato === "verified" && d1.da("demo_ga4_prove")[0].risolta_da === UTENTE && d1.da("demo_ga4_prove")[0].risolta_il === ADESSO_ISO);
    const risultati: boolean[] = [];
    for (const s of ["uncertain", "rejected", "sent_unverified"] as const) for (const e of ["verified", "not_received"] as const) risultati.push((await risolvi(prova(s), e)).ok);
    atteso("da «incerto», «rifiutata» e «inviata» si può dichiarare sia «verified» sia «not_received»", risultati.every(Boolean));
    const fresca = prova("reserved", ADESSO_ISO);
    const rFresca = await risolvi(fresca);
    const vecchia = prova("reserved", new Date(ADESSO - 6 * 60_000).toISOString());
    atteso("una riserva recente NON si può risolvere (l'invio potrebbe essere in corso); una ferma da più di 5 minuti sì", !rFresca.ok && rFresca.motivo === "non_risolvibile" && rFresca.stato === "reserved" && fresca.da("demo_ga4_prove")[0].stato === "reserved" && (await risolvi(vecchia)).ok && vecchia.da("demo_ga4_prove")[0].stato === "verified");
    const fin = prova("verified");
    const fin2 = prova("not_received");
    const rF = await risolvi(fin, "not_received");
    atteso("uno stato finale non si cambia più", !rF.ok && rF.motivo === "non_risolvibile" && fin.da("demo_ga4_prove")[0].stato === "verified" && !(await risolvi(fin2, "verified")).ok && fin2.da("demo_ga4_prove")[0].stato === "not_received");
    const nt = await risolviProvaGa4(dbCon().comeClient(), randomUUID(), "verified", UTENTE, ADESSO);
    atteso("richiesta senza riga → «non_trovata»", !nt.ok && nt.motivo === "non_trovata");
    const conc = prova("uncertain");
    let scattata = false;
    conc.guasto = (tabella, tipo) => {
      if (tabella === "demo_ga4_prove" && tipo === "update" && !scattata) {
        scattata = true;
        conc.da("demo_ga4_prove")[0].stato = "verified"; // qualcun altro lo ha risolto un istante prima
      }
      return null;
    };
    const rc = await risolvi(conc, "not_received");
    atteso("se lo stato cambia tra la lettura e la scrittura (due amministratori insieme) vince il primo: «cambiata_nel_frattempo», nessuna sovrascrittura", !rc.ok && rc.motivo === "cambiata_nel_frattempo" && conc.da("demo_ga4_prove")[0].stato === "verified" && conc.da("demo_ga4_prove")[0].risolta_il === null);
    const dbS = prova("uncertain");
    dbS.errori.demo_ga4_prove = { code: "42P01", message: "x" };
    const dbX = prova("uncertain");
    dbX.errori.demo_ga4_prove = { code: "XX000", message: "x" };
    const rS = await risolvi(dbS);
    const rX = await risolvi(dbX);
    atteso("tabella assente → «schema_assente»; altro errore → «errore_database»", !rS.ok && rS.motivo === "schema_assente" && !rX.ok && rX.motivo === "errore_database");
  }
  {
    const a = randomUUID();
    const b = randomUUID();
    const c = randomUUID();
    const db = dbCon({ prove: [rigaProva(a, "reserved"), rigaProva(b, "not_received")] });
    const r = await idRichiesteRiservate(db.comeClient(), [a, b, c]);
    atteso("le richieste riservate si riconoscono in QUALUNQUE stato (anche «reserved» e «not_received»)", r.ok && r.ids.has(a) && r.ids.has(b) && !r.ids.has(c) && r.ids.size === 2);
    const dbA = dbCon();
    dbA.errori.demo_ga4_prove = { code: "42P01", message: "x" };
    const dbX = dbCon();
    dbX.errori.demo_ga4_prove = { code: "XX000", message: "x" };
    const rA = await idRichiesteRiservate(dbA.comeClient(), [a]);
    const rX = await idRichiesteRiservate(dbX.comeClient(), [a]);
    atteso("tabella non creata → nessuna riserva (il cron funziona come prima); altro errore → «ok:false» (il cron si ferma)", rA.ok && rA.ids.size === 0 && !rX.ok && (await idRichiesteRiservate(db.comeClient(), [])).ok);
    const lettura = await leggiProveGa4(db.comeClient(), ADESSO);
    atteso("lettura del registro: stati, esito, ora dell'evento e se è risolvibile; mai segreti", lettura.stato === "ok" && lettura.righe.length === 2 && lettura.righe.every((x) => !SEGRETI.some((s) => JSON.stringify(x).includes(s))) && lettura.righe.find((x) => x.leadId === b)!.risolvibile === false && lettura.righe.find((x) => x.leadId === a)!.risolvibile === false);
    const dbT = dbCon();
    dbT.errori.demo_ga4_prove = { code: "42P01", message: "x" };
    atteso("registro: tabella assente → «tabella_assente», altro errore → «errore»", (await leggiProveGa4(dbT.comeClient(), ADESSO)).stato === "tabella_assente" && (await leggiProveGa4(dbX.comeClient(), ADESSO)).stato === "errore");
  }

  // ═════════════════════════ 3. Invio ═════════════════════════
  console.log("\n--- Invio della prova reale ---");
  {
    const lead = richiesta();
    const id = lead.id as string;
    const db = dbCon({ leads: [lead] });
    const primaLeads = fotografia(db, "demo_leads");
    const primaConsensi = fotografia(db, "demo_consensi");
    let osservato: { riga: Riga | undefined; blocco: unknown; leadsInvariati: boolean } = { riga: undefined, blocco: null, leadsInvariati: false };
    const cf = fetchFinto(() => {
      const riga = db.da("demo_ga4_prove").find((r) => r.lead_id === id);
      osservato = { riga: riga ? { ...riga } : undefined, blocco: db.da("demo_sync_stato")[0].lock_until, leadsInvariati: fotografia(db, "demo_leads") === primaLeads };
      return { status: 204 };
    });
    const { valore: r, log } = await conLog(() => invia(db, id, cf.fetch));
    atteso("invio riuscito: UNA sola chiamata, esito «inviata, NON verificata» (mai «verificata» da sola)", r.ok && r.stato === "sent_unverified" && r.codice === "http_2xx" && r.httpStato === 204 && r.esitoRegistrato && cf.chiamate.length === 1, JSON.stringify(r));
    atteso("la chiamata va all'endpoint di PRODUZIONE «/mp/collect» (mai quello di validazione), in POST JSON, con ID di misurazione e segreto", cf.chiamate[0].url.startsWith(`${URL_GA4_PRODUZIONE}?measurement_id=${ID_MISURAZIONE}&api_secret=${SEGRETO_API}`) && URL_GA4_PRODUZIONE === "https://www.google-analytics.com/mp/collect" && !cf.chiamate[0].url.includes("/debug/") && cf.chiamate[0].metodo === "POST" && cf.chiamate[0].intestazioni["content-type"] === "application/json");
    const corpo = JSON.parse(cf.chiamate[0].corpo ?? "{}") as { client_id: string; timestamp_micros: number; consent: Record<string, string>; events: { name: string; params: Record<string, unknown> }[] };
    atteso("il corpo è QUELLO di produzione (costruisciCorpoGa4): un evento «demo_booking_confirmed», ora della prenotazione, transaction_id della richiesta, nessun dato personale", JSON.stringify(corpo) === JSON.stringify(costruisciCorpoGa4(lead as unknown as LeadPerProva, ADESSO, tutti)) && corpo.events.length === 1 && corpo.events[0].name === "demo_booking_confirmed" && corpo.timestamp_micros === Date.parse(PRENOTATA_ISO) * 1000 && corpo.events[0].params.transaction_id === `omnia-demo-${id}` && !/@|Prova|Azienda|\+39/.test(cf.chiamate[0].corpo ?? ""));
    atteso("DEMO_GA4_MP_DEBUG=1 non cambia niente per la prova: l'invio è reale (il debug riguarda solo il cron)", cf.chiamate.length === 1 && !cf.chiamate[0].url.includes("debug"));
    const riga = db.da("demo_ga4_prove")[0];
    atteso("nel registro: stato «sent_unverified», codice http_2xx, HTTP 204, ora dell'evento e modalità, chi l'ha lanciata, transaction_id e proprietà GA4", db.da("demo_ga4_prove").length === 1 && riga.lead_id === id && riga.stato === "sent_unverified" && riga.esito_codice === "http_2xx" && riga.http_status === 204 && riga.timestamp_evento === PRENOTATA_ISO && riga.timestamp_modalita === "prenotazione" && riga.riservata_da === UTENTE && riga.transaction_id === `omnia-demo-${id}` && riga.id_misurazione === ID_MISURAZIONE && riga.origine === "prova" && riga.risolta_il === null);
    atteso("la prenotazione esclusiva esiste PRIMA della chiamata (stato «reserved», richiesta ancora non toccata) e il blocco condiviso col cron è preso", osservato.riga?.stato === "reserved" && osservato.blocco !== null && osservato.leadsInvariati);
    atteso("a fine invio il blocco condiviso col cron è rilasciato", db.da("demo_sync_stato")[0].lock_until === null);
    atteso("richieste e consensi NON si toccano (nessuna scrittura su demo_leads, demo_consensi, prenotazioni, casi; contenuti identici)", scrittureSu(db, ["demo_leads", "demo_consensi", "demo_prenotazioni", "demo_calendar_casi", "demo_contatti"]) === 0 && fotografia(db, "demo_leads") === primaLeads && fotografia(db, "demo_consensi") === primaConsensi);
    atteso("nessun segreto, email o client_id nel risultato, nei log o nel registro", SEGRETI.every((s) => !JSON.stringify(r).includes(s) && !log.includes(s) && !JSON.stringify(db.da("demo_ga4_prove")).includes(s)), JSON.stringify(r));

    const cf2 = sendOk();
    const r2 = await invia(db, id, cf2.fetch, ENV, FRASE_INVIO_PROVA, ADESSO + 60_000);
    atteso("un secondo invio per la stessa richiesta (uno dopo l'altro) è rifiutato dicendo lo stato esistente, senza chiamare nessuno", !r2.ok && r2.motivo === "gia_presente" && r2.statoEsistente === "sent_unverified" && cf2.chiamate.length === 0 && db.da("demo_ga4_prove").length === 1);
    const r3 = await invia(db, id, cf2.fetch, { ...ENV, DEMO_GA4_MP_DEBUG: "0" }, FRASE_INVIO_PROVA, ADESSO + 3_600_000);
    atteso("nemmeno un'ora dopo, nemmeno con DEBUG spento: una richiesta ha UNA sola prova", !r3.ok && r3.motivo === "gia_presente" && cf2.chiamate.length === 0);
  }

  console.log("\n--- Concorrenza ---");
  {
    const lead = richiesta();
    const id = lead.id as string;
    const db = dbCon({ leads: [lead] });
    const cf = fetchLento(25);
    const risultati = await Promise.all(Array.from({ length: 12 }, () => invia(db, id, cf.fetch)));
    atteso("12 tentativi IN PARALLELO sulla stessa richiesta (con un invio lento che li fa sovrapporre): UNA sola chiamata, un solo «ok», gli altri rifiutati", cf.chiamate.length === 1 && risultati.filter((r) => r.ok).length === 1 && risultati.filter((r) => !r.ok).length === 11 && db.da("demo_ga4_prove").length === 1, JSON.stringify(risultati.map((r) => (r.ok ? "ok" : r.motivo))));
    atteso("i rifiutati dicono «occupato» o «già presente»; il blocco finisce rilasciato; la riga ha un esito", risultati.filter((r) => !r.ok).every((r) => !r.ok && (r.motivo === "occupato" || r.motivo === "gia_presente")) && db.da("demo_sync_stato")[0].lock_until === null && db.da("demo_ga4_prove")[0].stato === "sent_unverified");
    const dopo = await Promise.all(Array.from({ length: 5 }, () => invia(db, id, cf.fetch)));
    atteso("altri 5 tentativi (insieme) dopo che il primo è finito: nessuna nuova chiamata; uno trova la riga («già presente»), gli altri il blocco («occupato»)", cf.chiamate.length === 1 && dopo.every((r) => !r.ok && (r.motivo === "gia_presente" || r.motivo === "occupato")) && dopo.some((r) => !r.ok && r.motivo === "gia_presente"));
  }
  {
    const l1 = richiesta();
    const l2 = richiesta();
    const db = dbCon({ leads: [l1, l2] });
    const cf = fetchLento(25);
    const [a, b] = await Promise.all([invia(db, l1.id, cf.fetch), invia(db, l2.id, cf.fetch)]);
    atteso("due richieste DIVERSE insieme: il blocco condiviso ne lascia passare una (l'altra «occupato», nessuna attesa, nessun ritentativo) e parte UNA sola chiamata", cf.chiamate.length === 1 && [a, b].filter((r) => r.ok).length === 1 && [a, b].filter((r) => !r.ok && r.motivo === "occupato").length === 1 && db.da("demo_ga4_prove").length === 1);
  }
  {
    // la chiave unica regge anche se il blocco è scaduto (esecuzione morta, blocco di un'altra istanza scaduto): niente doppione
    const lead = richiesta();
    const id = lead.id as string;
    const db = dbCon({ leads: [lead], prove: [rigaProva(id, "reserved")], lock: "2026-11-10T09:00:00.000Z" });
    const cf = sendOk();
    const r = await invia(db, id, cf.fetch);
    atteso("riserva già presente (esecuzione precedente morta) con blocco scaduto: «già presente», nessuna chiamata, la riserva resta com'è", !r.ok && r.motivo === "gia_presente" && r.statoEsistente === "reserved" && cf.chiamate.length === 0 && db.da("demo_ga4_prove")[0].stato === "reserved");
  }
  {
    const lead = richiesta();
    const id = lead.id as string;
    const db = dbCon({ leads: [lead], lock: "2026-11-10T10:03:00.000Z" });
    const cf = sendOk();
    const r = await invia(db, id, cf.fetch);
    atteso("giro del cron in corso (blocco preso da un altro): «occupato», nessuna chiamata, nessuna riga, e il blocco DELL'ALTRO non viene rilasciato", !r.ok && r.motivo === "occupato" && cf.chiamate.length === 0 && db.da("demo_ga4_prove").length === 0 && db.da("demo_sync_stato")[0].lock_until === "2026-11-10T10:03:00.000Z");
  }

  console.log("\n--- Interruttori e frase ---");
  {
    const lead = richiesta();
    const id = lead.id as string;
    const casi: [string, Record<string, string | undefined>][] = [
      ["GA4 spento", { ...ENV, DEMO_GA4_MP_ENABLED: "0" }],
      ["GA4 senza flag", { ...ENV, DEMO_GA4_MP_ENABLED: undefined }],
      ["senza segreto API", { ...ENV, GA4_API_SECRET: undefined }],
      ["senza segreto di firma", { ...ENV, DEMO_CONSENT_SIGNING_SECRET: undefined }],
      ["senza email di prova", { ...ENV, DEMO_GA4_PROVA_EMAIL: undefined }],
      ["email di prova vuota", { ...ENV, DEMO_GA4_PROVA_EMAIL: " " }],
    ];
    for (const [nome, env] of casi) {
      const db = dbCon({ leads: [lead] });
      const cf = sendOk();
      const r = await invia(db, id, cf.fetch, env);
      atteso(`${nome}: prova spenta, nessuna chiamata, nessuna riga, il database non viene nemmeno letto`, !r.ok && r.motivo === "prova_spenta" && (r.mancanti ?? []).length >= 1 && cf.chiamate.length === 0 && db.da("demo_ga4_prove").length === 0 && db.operazioni.length === 0);
    }
    for (const [nome, frase] of [["frase vuota", ""], ["frase minuscola", "invia 1 evento reale"], ["frase di un'altra azione", FRASE_EVENTO_PRESENTE], ["frase incompleta", "INVIA 1 EVENTO"], ["frase con aggiunte", `${FRASE_INVIO_PROVA} ORA`], ["frase nulla", null], ["frase non testo", { x: 1 }]] as [string, unknown][]) {
      const db = dbCon({ leads: [lead] });
      const cf = sendOk();
      const r = await invia(db, id, cf.fetch, ENV, frase);
      atteso(`${nome}: rifiutato, nessuna chiamata, nessuna operazione sul database (il blocco non viene nemmeno preso)`, !r.ok && r.motivo === "frase_errata" && cf.chiamate.length === 0 && db.operazioni.length === 0);
    }
    {
      const db = dbCon({ leads: [lead] });
      const cf = sendOk();
      const r = await inviaProvaGa4(db.comeClient(), ENV, { leadId: id, frase: undefined, utenteId: UTENTE }, ADESSO, cf.fetch);
      atteso("frase assente (undefined): rifiutato, nessuna chiamata, nessuna operazione sul database", !r.ok && r.motivo === "frase_errata" && cf.chiamate.length === 0 && db.operazioni.length === 0);
    }
    for (const [nome, valore] of [["testo qualsiasi", "l-ok"], ["vuoto", ""], ["numero", 7], ["iniezione", "' or 1=1 --"], ["indefinito", undefined]] as [string, unknown][]) {
      const db = dbCon({ leads: [lead] });
      const cf = sendOk();
      const r = await invia(db, valore, cf.fetch);
      atteso(`identificativo non valido (${nome}): rifiutato, nessuna chiamata, nessuna operazione sul database`, !r.ok && r.motivo === "id_non_valido" && cf.chiamate.length === 0 && db.operazioni.length === 0);
    }
    const dbN = dbCon({ leads: [lead] });
    const cfN = sendOk();
    const rN = await invia(dbN, randomUUID(), cfN.fetch);
    atteso("richiesta inesistente: «non trovata», nessuna chiamata, nessuna riga, blocco rilasciato", !rN.ok && rN.motivo === "non_trovata" && cfN.chiamate.length === 0 && dbN.da("demo_ga4_prove").length === 0 && dbN.da("demo_sync_stato")[0].lock_until === null);
  }

  console.log("\n--- Idoneità, consensi e firma ---");
  {
    const prova = async (nome: string, lead: Riga, motivo: string, consensi?: OpzioniConsensi, ritocca?: (db: FintoDatabase) => void) => {
      const db = dbCon({ leads: [lead], consensi: consensi ? { [lead.id as string]: consensi } : undefined });
      ritocca?.(db);
      const cf = sendOk();
      const r = await invia(db, lead.id, cf.fetch);
      atteso(`${nome}: non idonea (${motivo}), nessuna chiamata, nessuna riga, blocco rilasciato`, !r.ok && r.motivo === "non_idonea" && (r.motiviNonIdonea ?? []).includes(motivo as never) && cf.chiamate.length === 0 && db.da("demo_ga4_prove").length === 0 && db.da("demo_sync_stato")[0].lock_until === null, JSON.stringify(r));
    };
    await prova("email che non è di prova", richiesta({ email: "cliente.vero@esempio.it", email_norm: "cliente.vero@esempio.it" }), "email_non_di_prova");
    await prova("prenotazione non confermata (in attesa)", richiesta({ booking_status: "pending", prima_prenotazione_il: null }), "non_confermata");
    await prova("prenotazione annullata", richiesta({ booking_status: "cancelled" }), "non_confermata");
    await prova("prenotazione sostituita", richiesta({ booking_status: "superseded", prima_prenotazione_il: null }), "non_confermata");
    await prova("senza client_id", richiesta({ ga_client_id: null }), "senza_client_id");
    await prova("cookie non accettati (colonna riassuntiva)", richiesta({ attribution_consent: false }), "cookie_non_accettati");
    await prova("cookie negati nel REGISTRO (anche se la colonna dice sì)", richiesta(), "consensi_non_validi", { cookie: false });
    await prova("informativa privacy mancante nel registro", richiesta(), "consensi_non_validi", { privacy: false });
    await prova("consensi NON firmati", richiesta(), "consensi_non_validi", { firmare: false });
    await prova("una riga di consenso ALTERATA (la firma non torna più)", richiesta(), "consensi_non_validi", undefined, (db) => {
      db.da("demo_consensi").find((r) => r.tipo === "cookie_pubblicitari")!.valore = "denied";
    });
    await prova("riga di consenso con firma di un altro segreto", richiesta(), "consensi_non_validi", undefined, (db) => {
      for (const r of db.da("demo_consensi")) r.firma = firmaConsenso(stringaDaFirmare(r as never), "segreto-sbagliato");
    });
    await prova("nessun consenso nel registro", richiesta(), "consensi_non_validi", undefined, (db) => {
      db.tabelle.demo_consensi = [];
    });
    await prova("evento già inviato (ga4_sent_at)", richiesta({ ga4_sent_at: "2026-11-10T09:55:00.000Z" }), "gia_inviata");
    const lead = richiesta();
    const dbM = dbCon({ leads: [lead], consensi: { [lead.id as string]: { ads: false } } });
    const cfM = sendOk();
    const rM = await invia(dbM, lead.id, cfM.fetch);
    const corpoM = JSON.parse(cfM.chiamate[0]?.corpo ?? "{}") as { consent?: { ad_personalization?: string; ad_user_data?: string } };
    atteso("senza il consenso facoltativo alla misurazione la prova si può fare, con ad_personalization DENIED (come in produzione)", rM.ok && corpoM.consent?.ad_personalization === "DENIED" && corpoM.consent?.ad_user_data === "GRANTED");
    const dbS = dbCon({ leads: [richiesta({ prima_prenotazione_il: new Date(ADESSO - 80 * 3_600_000).toISOString() })] });
    const cfS = sendOk();
    const rS = await invia(dbS, dbS.da("demo_leads")[0].id, cfS.fetch);
    const corpoS = JSON.parse(cfS.chiamate[0]?.corpo ?? "{}") as { timestamp_micros?: number };
    atteso("prenotazione di oltre 72 ore fa: l'evento porta l'ora dell'invio e il registro lo dichiara («invio»)", rS.ok && rS.modalitaTimestamp === "invio" && corpoS.timestamp_micros === ADESSO * 1000 && dbS.da("demo_ga4_prove")[0].timestamp_modalita === "invio" && dbS.da("demo_ga4_prove")[0].timestamp_evento === ADESSO_ISO);
  }

  console.log("\n--- Esiti e nessun ritentativo ---");
  {
    const esiti: [string, () => { fetch: typeof fetch; chiamate: unknown[] }, string, string | null, number | null][] = [
      ["HTTP 400", () => fetchFinto(() => ({ status: 400 })), "rejected", "http_4xx", 400],
      ["HTTP 404", () => fetchFinto(() => ({ status: 404 })), "rejected", "http_4xx", 404],
      ["HTTP 429", () => fetchFinto(() => ({ status: 429 })), "rejected", "http_4xx", 429],
      ["HTTP 500", () => fetchFinto(() => ({ status: 500 })), "uncertain", "http_altro", 500],
      ["HTTP 503", () => fetchFinto(() => ({ status: 503 })), "uncertain", "http_altro", 503],
      ["HTTP 200", () => fetchFinto(() => ({ status: 200 })), "sent_unverified", "http_2xx", 200],
    ];
    for (const [nome, crea, stato, codice, http] of esiti) {
      const lead = richiesta();
      const db = dbCon({ leads: [lead] });
      const cf = crea();
      const r = await invia(db, lead.id, cf.fetch);
      const riga = db.da("demo_ga4_prove")[0];
      const ancora = await invia(db, lead.id, cf.fetch);
      atteso(`${nome}: stato «${stato}» registrato, UNA sola chiamata e nessun ritentativo (nemmeno chiedendo di nuovo)`, r.ok && r.stato === stato && riga.stato === stato && riga.esito_codice === codice && riga.http_status === http && cf.chiamate.length === 1 && !ancora.ok && ancora.motivo === "gia_presente", JSON.stringify([r, riga.stato]));
    }
    // errore di rete: il testo dell'errore contiene l'indirizzo CON il segreto: non deve uscire da nessuna parte
    const lead = richiesta();
    const db = dbCon({ leads: [lead] });
    let chiamate = 0;
    const fRete = (async (input: RequestInfo | URL) => {
      chiamate++;
      throw new Error(`fetch failed: ${String(input)}`);
    }) as typeof fetch;
    const { valore: r, log } = await conLog(() => invia(db, lead.id, fRete));
    atteso("errore di rete: stato «incerto», codice «rete», senza stato HTTP, UNA sola chiamata, il segreto dell'indirizzo non esce da risultato, log e registro", r.ok && r.stato === "uncertain" && r.codice === "rete" && r.httpStato === null && chiamate === 1 && db.da("demo_ga4_prove")[0].stato === "uncertain" && SEGRETI.every((s) => !JSON.stringify(r).includes(s) && !log.includes(s) && !JSON.stringify(db.da("demo_ga4_prove")).includes(s)));
    atteso("dopo l'errore di rete NON si può rimandare: la prova resta bloccata finché l'amministratore non dichiara cosa vede", !(await invia(db, lead.id, fRete)).ok && chiamate === 1);
    // tempo scaduto
    const l2 = richiesta();
    const db2 = dbCon({ leads: [l2] });
    const sosp = fetchSospeso();
    const r2 = await invia(db2, l2.id, sosp.fetch, ENV, FRASE_INVIO_PROVA, ADESSO, 30);
    atteso("risposta che non arriva mai: dopo il tempo massimo l'invio si annulla, stato «incerto», codice «timeout», UNA sola chiamata, blocco rilasciato", r2.ok && r2.stato === "uncertain" && r2.codice === "timeout" && sosp.chiamate.length === 1 && db2.da("demo_ga4_prove")[0].esito_codice === "timeout" && db2.da("demo_sync_stato")[0].lock_until === null);
  }
  {
    // la scrittura dell'esito: si riprova UNA volta (è il database, non GA4)
    const lead = richiesta();
    const db = dbCon({ leads: [lead] });
    let tentativi = 0;
    db.guasto = (tabella, tipo) => {
      if (tabella === "demo_ga4_prove" && tipo === "update" && tentativi++ === 0) return { code: "XX000", message: "boom" };
      return null;
    };
    const cf = sendOk();
    const r = await invia(db, lead.id, cf.fetch);
    atteso("se la prima scrittura dell'esito fallisce, si riprova UNA volta sul database: esito registrato e UNA sola chiamata a GA4", r.ok && r.esitoRegistrato && db.da("demo_ga4_prove")[0].stato === "sent_unverified" && cf.chiamate.length === 1 && tentativi === 2);
    const l2 = richiesta();
    const db2 = dbCon({ leads: [l2] });
    db2.guasto = (tabella, tipo) => (tabella === "demo_ga4_prove" && tipo === "update" ? { code: "XX000", message: "boom" } : null);
    const cf2 = sendOk();
    const r2 = await invia(db2, l2.id, cf2.fetch);
    atteso("se la scrittura dell'esito non riesce mai: l'esito NON risulta registrato (lo dice), la riga resta «reserved», una sola chiamata, blocco rilasciato", r2.ok && !r2.esitoRegistrato && r2.stato === "sent_unverified" && db2.da("demo_ga4_prove")[0].stato === "reserved" && cf2.chiamate.length === 1 && db2.da("demo_sync_stato")[0].lock_until === null);
    const r2b = await invia(db2, l2.id, cf2.fetch, ENV, FRASE_INVIO_PROVA, ADESSO + 10 * 60_000);
    atteso("…e non si rimanda neanche dopo 10 minuti: la riga «reserved» blocca (si risolve a mano)", !r2b.ok && r2b.motivo === "gia_presente" && cf2.chiamate.length === 1);
    db2.guasto = null; // il database è tornato a funzionare
    const r2c = await risolviProvaGa4Admin(db2.comeClient(), { leadId: l2.id, esito: "verified", frase: FRASE_EVENTO_PRESENTE, utenteId: UTENTE }, ADESSO + 10 * 60_000);
    atteso("…ma dopo 5 minuti l'amministratore la può risolvere dichiarando cosa vede", r2c.ok && r2c.da === "reserved" && db2.da("demo_ga4_prove")[0].stato === "verified");
  }
  {
    const lead = richiesta();
    const db = dbCon({ leads: [lead] });
    db.guasto = (tabella, tipo) => (tabella === "demo_ga4_prove" && tipo === "insert" ? { code: "XX000", message: "boom" } : null);
    const cf = sendOk();
    const r = await invia(db, lead.id, cf.fetch);
    atteso("se la prenotazione esclusiva non si scrive: nessuna chiamata (mai inviare senza aver prenotato), blocco rilasciato", !r.ok && r.motivo === "errore_database" && cf.chiamate.length === 0 && db.da("demo_ga4_prove").length === 0 && db.da("demo_sync_stato")[0].lock_until === null);
    const dbT = dbCon({ leads: [lead] });
    dbT.errori.demo_ga4_prove = { code: "42P01", message: "relation does not exist" };
    const cfT = sendOk();
    const rT = await invia(dbT, lead.id, cfT.fetch);
    atteso("tabella delle prove non creata (migrazione 0099 non eseguita): «schema_assente», nessuna chiamata, blocco rilasciato", !rT.ok && rT.motivo === "schema_assente" && cfT.chiamate.length === 0 && dbT.da("demo_sync_stato")[0].lock_until === null);
    const dbL = dbCon({ leads: [lead] });
    dbL.errori.demo_leads = { code: "XX000", message: "boom" };
    const cfL = sendOk();
    const rL = await invia(dbL, lead.id, cfL.fetch);
    atteso("richiesta non leggibile (errore del database): nessuna chiamata, nessuna riga, blocco rilasciato", !rL.ok && rL.motivo === "errore_database" && cfL.chiamate.length === 0 && dbL.da("demo_ga4_prove").length === 0 && dbL.da("demo_sync_stato")[0].lock_until === null);
    const dbC = dbCon({ leads: [lead] });
    dbC.errori.demo_consensi = { code: "XX000", message: "boom" };
    const cfC = sendOk();
    const rC = await invia(dbC, lead.id, cfC.fetch);
    atteso("registro dei consensi non leggibile: nessuna chiamata (senza poterli verificare non si invia)", !rC.ok && rC.motivo === "errore_database" && cfC.chiamate.length === 0 && dbC.da("demo_ga4_prove").length === 0);
    const dbB = dbCon({ leads: [lead] });
    dbB.errori.demo_sync_stato = { code: "XX000", message: "boom" };
    const cfB = sendOk();
    const { valore: rB } = await conLog(() => invia(dbB, lead.id, cfB.fetch));
    atteso("blocco condiviso non disponibile: nessuna chiamata", !rB.ok && rB.motivo === "errore_database" && cfB.chiamate.length === 0 && dbB.da("demo_ga4_prove").length === 0);
  }

  // ═════════════════════════ 4. Preparazione (sola lettura) ═════════════════════════
  console.log("\n--- Preparazione: elenco delle richieste di prova (sola lettura) ---");
  {
    const A = richiesta({ created_at: "2026-11-10T09:55:00.000Z" });
    const B = richiesta({ email: "cliente.vero@esempio.it", email_norm: "cliente.vero@esempio.it" });
    const C = richiesta();
    const D = richiesta({ booking_status: "pending", prima_prenotazione_il: null });
    const E = richiesta();
    const F = richiesta({ ga_client_id: null });
    const db = dbCon({ leads: [A, B, C, D, E, F], consensi: { [E.id as string]: { cookie: false } }, prove: [rigaProva(C.id as string, "uncertain")] });
    const prima = JSON.stringify(db.tabelle);
    const { valore: p, log } = await conLog(() => preparaProvaGa4(db.comeClient(), ENV, ADESSO));
    const ok = p.ok ? p : null;
    const di = (x: Riga) => ok?.candidate.find((c) => c.leadId === x.id);
    atteso("elenca solo le richieste CONFERMATE con email di prova e senza una riga nel registro (non quelle di clienti veri, non quelle in attesa, non quelle già usate)", !!ok && ok.candidate.length === 3 && !!di(A) && !!di(E) && !!di(F) && !di(B) && !di(C) && !di(D), JSON.stringify(ok?.candidate.map((c) => c.leadId)));
    atteso("la richiesta idonea ha l'anteprima: evento, parametri, ora della prenotazione (10 minuti fa), dentro Realtime, ad_personalization", !!di(A)?.idoneo && di(A)?.anteprima?.nomeEvento === "demo_booking_confirmed" && di(A)?.anteprima?.modalita === "prenotazione" && di(A)?.anteprima?.minutiDallaPrenotazione === 10 && di(A)?.anteprima?.dentroFinestraRealtime === true && di(A)?.anteprima?.adPersonalization === "GRANTED" && !!di(A)?.anteprima?.parametri.includes("transaction_id") && !!di(A)?.anteprima?.parametri.includes("session_id"));
    atteso("le non idonee dicono perché (consensi non validi; senza client_id) e non hanno anteprima", di(E)?.idoneo === false && !!di(E)?.motivi.includes("consensi_non_validi") && di(E)?.anteprima === null && di(F)?.idoneo === false && !!di(F)?.motivi.includes("senza_client_id") && di(F)?.haClientId === false);
    atteso("sola lettura: nessuna scrittura, nessuna chiamata di rete, database identico, nessun segreto/email/client_id nel risultato o nei log", db.operazioni.every((o) => o.tipo === "select") && JSON.stringify(db.tabelle) === prima && SEGRETI.every((s) => !JSON.stringify(p).includes(s) && !log.includes(s)));
    const dbOff = dbCon({ leads: [A] });
    const spenta = await preparaProvaGa4(dbOff.comeClient(), { ...ENV, DEMO_GA4_PROVA_EMAIL: undefined }, ADESSO);
    atteso("con la prova spenta dice perché e non legge nemmeno il database", spenta.ok && !spenta.gate.attiva && spenta.gate.mancanti.includes("email_prova_mancante") && spenta.candidate.length === 0 && dbOff.operazioni.length === 0);
    const dbA = dbCon({ leads: [A] });
    dbA.errori.demo_ga4_prove = { code: "42P01", message: "x" };
    const dbX = dbCon({ leads: [A] });
    dbX.errori.demo_leads = { code: "XX000", message: "x" };
    const rA = await preparaProvaGa4(dbA.comeClient(), ENV, ADESSO);
    const rX = await preparaProvaGa4(dbX.comeClient(), ENV, ADESSO);
    atteso("tabella delle prove non creata → «schema_assente» (non si propone niente); errore di lettura → «errore_database»", !rA.ok && rA.motivo === "schema_assente" && !rX.ok && rX.motivo === "errore_database");
  }

  // ═════════════════════════ 5. Risoluzione amministrativa ═════════════════════════
  console.log("\n--- Risoluzione degli stati incerti ---");
  {
    const id = randomUUID();
    const crea = (stato: StatoProvaGa4 = "uncertain") => dbCon({ prove: [rigaProva(id, stato)] });
    const risolvi = (db: FintoDatabase, esito: unknown, frase: unknown, leadId: unknown = id) => risolviProvaGa4Admin(db.comeClient(), { leadId, esito, frase, utenteId: UTENTE }, ADESSO);
    const d1 = crea();
    const r1 = await risolvi(d1, "verified", FRASE_EVENTO_PRESENTE);
    atteso("«evento presente»: frase giusta → «verified», con chi e quando", r1.ok && r1.a === "verified" && r1.da === "uncertain" && d1.da("demo_ga4_prove")[0].stato === "verified" && d1.da("demo_ga4_prove")[0].risolta_da === UTENTE);
    const d2 = crea("sent_unverified");
    const r2 = await risolvi(d2, "not_received", FRASE_EVENTO_ASSENTE);
    atteso("«evento assente»: frase giusta → «not_received»", r2.ok && r2.a === "not_received" && d2.da("demo_ga4_prove")[0].stato === "not_received");
    const d3 = crea();
    const incrociate = [await risolvi(d3, "not_received", FRASE_EVENTO_PRESENTE), await risolvi(d3, "verified", FRASE_EVENTO_ASSENTE), await risolvi(d3, "verified", FRASE_INVIO_PROVA), await risolvi(d3, "verified", ""), await risolvi(d3, "verified", undefined)];
    atteso("la frase di una dichiarazione non vale per l'altra né per l'invio: rifiutate, riga invariata", incrociate.every((x) => !x.ok && x.motivo === "frase_errata") && d3.da("demo_ga4_prove")[0].stato === "uncertain" && d3.operazioni.length === 0);
    const d4 = crea();
    const strani = [await risolvi(d4, "reserved", FRASE_EVENTO_PRESENTE), await risolvi(d4, "sent_unverified", FRASE_EVENTO_PRESENTE), await risolvi(d4, undefined, FRASE_EVENTO_PRESENTE), await risolvi(d4, "VERIFIED", FRASE_EVENTO_PRESENTE)];
    atteso("si può dichiarare solo «verified» o «not_received» (mai riportare a «reserved», mai «inviata»)", strani.every((x) => !x.ok && x.motivo === "esito_non_valido") && d4.da("demo_ga4_prove")[0].stato === "uncertain");
    const idBrutti = [await risolvi(d4, "verified", FRASE_EVENTO_PRESENTE, "x"), await risolvi(d4, "verified", FRASE_EVENTO_PRESENTE, null), await risolviProvaGa4Admin(d4.comeClient(), { leadId: undefined, esito: "verified", frase: FRASE_EVENTO_PRESENTE, utenteId: UTENTE }, ADESSO)];
    atteso("identificativo non valido → rifiutato senza toccare il database", idBrutti.every((x) => !x.ok && x.motivo === "id_non_valido") && d4.operazioni.length === 0);
    const dopo = await risolvi(d1, "not_received", FRASE_EVENTO_ASSENTE);
    atteso("dopo la dichiarazione lo stato è finale: nessuna seconda dichiarazione", !dopo.ok && dopo.motivo === "non_risolvibile" && d1.da("demo_ga4_prove")[0].stato === "verified");
    atteso("la risoluzione non invia niente a nessuno (il modulo non ha nemmeno un fetch da usare)", !/fetch/.test(leggi("src/lib/demo-ga4-prova.ts").split("export async function risolviProvaGa4Admin")[1] ?? "fetch"));
  }

  // ═════════════════════════ 6. Il cron non riprende le richieste riservate ═════════════════════════
  console.log("\n--- Cron GA4: le richieste riservate alla prova non si riprendono mai ---");
  {
    const env = { DEMO_GA4_MP_ENABLED: "1", GA4_API_SECRET: SEGRETO_API, DEMO_CONSENT_SIGNING_SECRET: SEGRETO_FIRMA };
    for (const stato of STATI_PROVA_GA4) {
      const riservata = richiesta();
      const libera = richiesta();
      const db = dbCon({ leads: [riservata, libera], prove: [rigaProva(riservata.id as string, stato)] });
      const cf = sendOk();
      const rg = await inviaConversioniGa4(db.comeClient(), env, ADESSO, cf.fetch);
      const corpi = cf.chiamate.map((c) => JSON.parse(c.corpo ?? "{}") as { events: { params: { transaction_id: string } }[] });
      atteso(`cron con DEBUG SPENTO, richiesta riservata in stato «${stato}»: non viene inviata; quella libera sì (una sola chiamata)`, rg.inviati === 1 && cf.chiamate.length === 1 && corpi[0].events[0].params.transaction_id === `omnia-demo-${libera.id}` && db.da("demo_leads").find((x) => x.id === riservata.id)?.ga4_sent_at === null && db.da("demo_leads").find((x) => x.id === riservata.id)?.ga4_attempts === 0 && rg.riservateProva === 1, JSON.stringify(rg));
    }
    const riservata = richiesta();
    const dbD = dbCon({ leads: [riservata], prove: [rigaProva(riservata.id as string, "reserved")] });
    const cfD = fetchFinto(() => ({ status: 200, json: { validationMessages: [] } }));
    const rd = await inviaConversioniGa4(dbD.comeClient(), { ...env, DEMO_GA4_MP_DEBUG: "1" }, ADESSO, cfD.fetch);
    atteso("cron con DEBUG acceso: la richiesta riservata non viene nemmeno validata", cfD.chiamate.length === 0 && rd.verificati === 0 && rd.riservateProva === 1);
    const dbNo = dbCon({ leads: [richiesta()] });
    const cfNo = sendOk();
    const rNo = await inviaConversioniGa4(dbNo.comeClient(), env, ADESSO, cfNo.fetch);
    atteso("senza righe nel registro il cron funziona come prima (e non aggiunge il campo «riservateProva»)", rNo.inviati === 1 && cfNo.chiamate.length === 1 && rNo.riservateProva === undefined);
    const dbX = dbCon({ leads: [richiesta()] });
    dbX.errori.demo_ga4_prove = { code: "XX000", message: "boom" };
    const cfX = sendOk();
    const rX = await inviaConversioniGa4(dbX.comeClient(), env, ADESSO, cfX.fetch);
    atteso("se non riesce a sapere quali richieste sono riservate, il cron si ferma (nessuna chiamata): meglio un giro saltato che un doppione", !rX.abilitato && rX.motivo === "errore_database" && cfX.chiamate.length === 0);
    const dbS = dbCon({ leads: [richiesta()] });
    dbS.errori.demo_ga4_prove = { code: "42P01", message: "x" };
    const cfS = sendOk();
    const rS = await inviaConversioniGa4(dbS.comeClient(), env, ADESSO, cfS.fetch);
    atteso("se la tabella non esiste ancora (migrazione 0099 non eseguita) il cron funziona come prima", rS.inviati === 1 && cfS.chiamate.length === 1);

    // il giro completo (calendario → GA4 → Ads) con una richiesta riservata
    const lead = richiesta();
    const dbC = dbCon({ leads: [lead], prove: [rigaProva(lead.id as string, "sent_unverified")] });
    const cfC = sendOk();
    const ciclo = await eseguiCicloDemo(dbC.comeClient(), { ...env, DEMO_GA4_MP_ENABLED: "1" }, ADESSO, cfC.fetch);
    atteso("nel giro completo del cron la richiesta riservata non produce nessuna chiamata a GA4", ciclo.eseguito && cfC.chiamate.filter((c) => c.url.includes("google-analytics.com")).length === 0 && dbC.da("demo_leads")[0].ga4_sent_at === null);
  }
  {
    // la prova e il cron: la richiesta che la prova ha usato non viene più mandata dal cron, anche con DEBUG spento dopo
    const lead = richiesta();
    const db = dbCon({ leads: [lead] });
    const cfProva = sendOk();
    const r = await invia(db, lead.id, cfProva.fetch);
    const cfCron = sendOk();
    const env = { DEMO_GA4_MP_ENABLED: "1", GA4_API_SECRET: SEGRETO_API, DEMO_CONSENT_SIGNING_SECRET: SEGRETO_FIRMA };
    const giri = [] as number[];
    for (let i = 1; i <= 3; i++) giri.push((await inviaConversioniGa4(db.comeClient(), env, ADESSO + i * 600_000, cfCron.fetch)).inviati);
    atteso("prova reale e poi DEBUG spento: il cron, in tre giri successivi, non rimanda la richiesta già usata (evento totale: 1)", r.ok && cfProva.chiamate.length === 1 && cfCron.chiamate.length === 0 && giri.every((n) => n === 0));
    // …e se la prova fosse stata dichiarata «non ricevuta», il cron non la riprende comunque
    await risolviProvaGa4Admin(db.comeClient(), { leadId: lead.id, esito: "not_received", frase: FRASE_EVENTO_ASSENTE, utenteId: UTENTE }, ADESSO + 60_000);
    const rg = await inviaConversioniGa4(db.comeClient(), env, ADESSO + 4_000_000, cfCron.fetch);
    atteso("anche dopo «evento assente in GA4» (not_received) il cron NON la riprende (per riprovare serve una nuova prenotazione)", db.da("demo_ga4_prove")[0].stato === "not_received" && rg.inviati === 0 && cfCron.chiamate.length === 0);
  }

  // ═════════════════════════ 7. Console ═════════════════════════
  console.log("\n--- Console: conteggi e lettura ---");
  {
    const righe = [
      { id: "a", stato: "confirmed" as const, ga4InviatoIl: null, ga4Tentativi: 0, haClientId: true },
      { id: "b", stato: "confirmed" as const, ga4InviatoIl: null, ga4Tentativi: 0, haClientId: true },
      { id: "c", stato: "confirmed" as const, ga4InviatoIl: "2026-11-10T09:00:00.000Z", ga4Tentativi: 0, haClientId: true },
      { id: "d", stato: "confirmed" as const, ga4InviatoIl: null, ga4Tentativi: 0, haClientId: false },
      { stato: "confirmed" as const, ga4InviatoIl: null, ga4Tentativi: 0, haClientId: true },
    ];
    const senza = riepilogoGa4(righe);
    const con = riepilogoGa4(righe, new Set(["a", "c"]));
    atteso("riepilogo GA4 senza riserve: come prima (con «riservateProva» a 0)", senza.inviati === 1 && senza.inAttesa === 3 && senza.nonInviabili === 1 && senza.riservateProva === 0);
    atteso("le richieste riservate alla prova non sono né «in attesa» né «inviate» né «non inviabili»: si contano a parte", con.riservateProva === 2 && con.inviati === 0 && con.inAttesa === 2 && con.nonInviabili === 1);

    const lead = richiesta();
    const periodo = { daIso: "2026-11-01T00:00:00.000Z", aIso: "2026-12-01T00:00:00.000Z" };
    const dbP = dbCon({ leads: [lead], prove: [rigaProva(lead.id as string, "uncertain", { riservata_il: new Date(ADESSO - 30 * 60_000).toISOString() })] });
    const ris = await leggiDemo(periodo, dbP.comeClient(), ENV, new Date(ADESSO));
    const dati = ris.stato === "ok" ? ris.dati : null;
    atteso("la console legge il registro delle prove e lo mostra con stato, esito e se è risolvibile; la richiesta riservata non è «in attesa»", !!dati && dati.provaGa4.tabella === "ok" && dati.provaGa4.prove.length === 1 && dati.provaGa4.prove[0].stato === "uncertain" && dati.provaGa4.prove[0].risolvibile && dati.ga4.riservateProva === 1 && dati.ga4.inAttesa === 0 && dati.provaGa4.gate.attiva);
    const dbM = dbCon({ leads: [lead] });
    dbM.errori.demo_ga4_prove = { code: "42P01", message: "x" };
    const rM = await leggiDemo(periodo, dbM.comeClient(), ENV, new Date(ADESSO));
    atteso("tabella delle prove non creata: la pagina DEMO funziona lo stesso e la sezione lo dice (non è un errore dell'intera pagina)", rM.stato === "ok" && rM.dati.provaGa4.tabella === "assente" && rM.dati.provaGa4.prove.length === 0 && rM.dati.richieste.length === 1);
    const dbE = dbCon({ leads: [lead] });
    dbE.errori.demo_ga4_prove = { code: "XX000", message: "x" };
    const { valore: rE, log } = await conLog(() => leggiDemo(periodo, dbE.comeClient(), ENV, new Date(ADESSO)));
    atteso("lettura delle prove in errore: il resto della pagina funziona, la sezione dice «errore» e il log non contiene dati", rE.stato === "ok" && rE.dati.provaGa4.tabella === "errore" && SEGRETI.every((s) => !log.includes(s)));
    const rOff = await leggiDemo(periodo, dbCon({ leads: [lead] }).comeClient(), { ...ENV, DEMO_GA4_PROVA_EMAIL: undefined }, new Date(ADESSO));
    atteso("senza email di prova la console mostra la prova «spenta» e il motivo", rOff.stato === "ok" && !rOff.dati.provaGa4.gate.attiva && rOff.dati.provaGa4.gate.mancanti.includes("email_prova_mancante"));
    atteso("i dati che la console manda alla pagina non contengono segreti", !JSON.stringify(dati?.provaGa4).includes(SEGRETO_API) && !JSON.stringify(dati?.integrazioni).includes(SEGRETO_API) && !JSON.stringify(dati?.integrazioni).includes(SEGRETO_FIRMA));
  }

  // ═════════════════════════ 8. Struttura del codice, della migrazione e della guida ═════════════════════════
  console.log("\n--- Struttura: codice, migrazione, guida ---");
  {
    const modulo = leggi("src/lib/demo-ga4-prova.ts");
    const riserva = leggi("src/lib/demo-ga4-riserva.ts");
    const calcoli = leggi("src/lib/demo-ga4-prova-calcoli.ts");
    const azione = leggi("src/app/site-console/azioni/demo-ga4-prova.ts");
    const vista = leggi("src/app/site-console/_componenti/prova-ga4-reale.tsx");
    const sql = leggi("supabase/migrations/0099_demo_ga4_prove.sql");
    const guida = leggi("GUIDA-DEMO-TRACCIAMENTO.md");
    const pagina = leggi("src/app/site-console/(app)/demo/page.tsx");

    const codice = (s: string) => s.replace(/(^|\s)\/\/.*$/gm, "$1"); // senza i commenti (che possono nominare il debug per spiegare che NON si usa)
    atteso("il modulo di invio usa solo l'endpoint di produzione: nel CODICE nessun riferimento all'endpoint di validazione né alla modalità debug", !/\/debug\//.test(codice(modulo + riserva + calcoli)) && !/DEMO_GA4_MP_DEBUG/.test(codice(modulo + riserva + calcoli)) && /\/mp\/collect/.test(codice(modulo)));
    atteso("l'invio chiama fetch UNA volta sola (nessun ciclo, nessun ritentativo)", (modulo.match(/fetchFn\(/g) ?? []).length === 1 && !/for \(|while \(|setInterval|retry|riprova\(/.test(modulo.split("// 5. UN solo invio")[1]?.split("// 6.")[0] ?? "for ("));
    atteso("la prenotazione esclusiva viene PRIMA dell'invio nel codice (riservaInvioGa4 prima di fetchFn)", modulo.indexOf("riservaInvioGa4(admin") > 0 && modulo.indexOf("riservaInvioGa4(admin") < modulo.indexOf("fetchFn("));
    const invio = modulo.split("export async function inviaProvaGa4")[1] ?? "";
    atteso("il blocco condiviso col cron si prende prima di leggere la richiesta e si rilascia in un finally, solo se preso", invio.indexOf("acquisisciBlocco(") > 0 && invio.indexOf("acquisisciBlocco(") < invio.indexOf('from("demo_leads")') && /finally \{\s*await rilasciaBlocco\(admin\);/.test(invio) && invio.indexOf('blocco === "occupato"') < invio.indexOf("try {") && invio.indexOf('blocco === "non_disponibile"') < invio.indexOf("try {"));
    atteso("il modulo di invio non scrive MAI su demo_leads, demo_consensi, prenotazioni, casi o contatti (solo letture)", !/from\("demo_(leads|consensi|prenotazioni|calendar_casi|contatti)"\)\s*\.(insert|update|upsert|delete)/.test(modulo + riserva) && !/demo-ads|google-oauth|Data Manager/.test(modulo + riserva + calcoli + azione));
    atteso("nessun console.* nei nuovi moduli (niente può finire nei log con segreti o dati)", !/console\./.test(modulo + riserva + calcoli + azione + vista));
    atteso("i nuovi moduli non usano NEXT_PUBLIC_ e il segreto API si legge solo nel modulo di invio", !/NEXT_PUBLIC_/.test(modulo + riserva + calcoli + azione + vista) && /GA4_API_SECRET/.test(modulo) && !/GA4_API_SECRET/.test(riserva + azione + vista));
    atteso("il file delle regole può finire nel browser: non importa crittografia né database né rete, non legge process.env", !/^import .*(node:|crypto|supabase|demo-hash|demo-consensi"|demo-ga4-riserva)/m.test(calcoli) && !/fetch\(|process\.env/.test(calcoli));
    atteso("l'azione: ognuna delle tre funzioni controlla l'amministratore come PRIMA operazione", (azione.match(/export async function \w+\([^)]*\): Promise<[^{]+\{\n  const sessione = await richiediAdminAzione\(\);\n  if \(!sessione\) return \{ ok: false, errore: "Non autorizzato\." \};/g) ?? []).length === 3 && (azione.match(/export async function/g) ?? []).length === 3);
    atteso("l'azione prende l'identificativo dell'amministratore dalla sessione (non dalla pagina) e legge l'ambiente sul server: la pagina non può passare né ambiente, né segreti, né utente", (azione.match(/utenteId: sessione\.userId/g) ?? []).length === 2 && /process\.env/.test(azione) && !/export async function \w+\([^)]*(env|secret|segreto|utenteId|userId)/i.test(azione));
    atteso("la pagina DEMO ha un tempo massimo adeguato (maxDuration) per l'invio e le letture", /export const maxDuration = (\d+)/.test(pagina) && Number(/export const maxDuration = (\d+)/.exec(pagina)?.[1]) >= 30);
    atteso("la sezione della pagina chiede la frase digitata e la confronta con le costanti condivise (invio e due dichiarazioni)", /FRASE_INVIO_PROVA/.test(vista) && /FRASE_EVENTO_PRESENTE/.test(vista) && /FRASE_EVENTO_ASSENTE/.test(vista) && /disabled=\{inInvio \|\| frase\.trim\(\) !== FRASE_INVIO_PROVA\}/.test(vista) && !/fetch\(|process\.env/.test(vista));
    const vistaDemo = leggi("src/app/site-console/_componenti/demo-vista.tsx");
    atteso("la sezione è montata nella pagina DEMO con i dati del registro; non usa il router di Next (la pagina si rilegge dall'azione con revalidatePath, come le altre azioni della console)", /import ProvaGa4Reale from "\.\/prova-ga4-reale"/.test(vistaDemo) && /<ProvaGa4Reale prova=\{d\.provaGa4\} \/>/.test(vistaDemo) && !/useRouter|router\./.test(vista) && (azione.match(/revalidatePath\("\/site-console", "layout"\)/g) ?? []).length === 2);
    atteso("la sezione dichiara a chiare lettere che l'invio è REALE anche con GA4 in DEBUG e che «inviata» non è «verificata»", /Questo invio è REALE/.test(vista) && /DEBUG/.test(vista) && /non<\/strong> prova che l&apos;evento sia in Analytics/.test(vista));

    atteso("migrazione 0099: chiave primaria su lead_id (il vincolo unico), RLS attiva, nessuna policy, nessun accesso a anon/authenticated, GRANT solo a service_role", /lead_id uuid primary key/.test(sql) && /enable row level security/.test(sql) && !/create policy/i.test(sql) && /revoke all on public\.demo_ga4_prove from anon, authenticated/.test(sql) && /grant select, insert, update, delete on public\.demo_ga4_prove to service_role/.test(sql) && !/to (anon|authenticated)\b/.test(sql.replace(/revoke all[^;]*;/g, "")));
    const statiSql = /stato text not null check \(stato in \(([^)]+)\)\)/.exec(sql)?.[1].split(",").map((s) => s.trim().replace(/'/g, "")) ?? [];
    atteso("migrazione 0099: gli stati ammessi dal database sono ESATTAMENTE quelli del codice", JSON.stringify(statiSql) === JSON.stringify([...STATI_PROVA_GA4]), statiSql.join());
    atteso("migrazione 0099: il trigger impone le stesse regole (righe non cancellabili, dati immutabili, stati finali, transizioni)", /before update or delete on public\.demo_ga4_prove/.test(sql) && /tg_op = 'DELETE'/.test(sql) && /old\.stato in \('verified', 'not_received'\)/.test(sql) && /old\.stato = 'reserved' and new\.stato not in \('sent_unverified', 'uncertain', 'rejected', 'verified', 'not_received'\)/.test(sql) && /old\.stato in \('sent_unverified', 'uncertain', 'rejected'\) and new\.stato not in \('verified', 'not_received'\)/.test(sql) && /new\.lead_id <> old\.lead_id/.test(sql) && /new\.timestamp_evento <> old\.timestamp_evento/.test(sql));
    atteso("migrazione 0099: idempotente (create … if not exists, create or replace, drop trigger if exists), senza chiave esterna (la cancellazione di una richiesta non cancella la traccia dell'invio), senza dati personali", /create table if not exists public\.demo_ga4_prove/.test(sql) && /create or replace function public\.demo_ga4_prove_regole/.test(sql) && /drop trigger if exists demo_ga4_prove_regole/.test(sql) && !/references /.test(sql) && !/email|phone|telefono|client_id|gclid/i.test(sql.replace(/--.*$/gm, "")) && /notify pgrst, 'reload schema'/.test(sql));
    atteso("migrazione 0099: esiste e la precedente è la 0098 (numerazione senza buchi né doppioni)", fs.existsSync(path.join(radice, "supabase/migrations/0099_demo_ga4_prove.sql")) && fs.readdirSync(path.join(radice, "supabase/migrations")).filter((f) => f.startsWith("0099")).length === 1 && fs.readdirSync(path.join(radice, "supabase/migrations")).filter((f) => f.startsWith("0098")).length === 1);

    atteso("la guida documenta la prova reale: variabile DEMO_GA4_PROVA_EMAIL, migrazione 0099, i sei stati, la frase digitata, il cron che non riprende, la procedura per gli stati incerti e la verifica in GA4", /DEMO_GA4_PROVA_EMAIL/.test(guida) && /0099/.test(guida) && STATI_PROVA_GA4.every((s) => guida.includes(s)) && /INVIA 1 EVENTO REALE/.test(guida) && /demo_ga4_prove/.test(guida) && /incert/.test(guida) && /Realtime/.test(guida));
    atteso("ogni variabile letta dal nuovo codice è nella guida e nessuna è esposta al browser", ["DEMO_GA4_PROVA_EMAIL", "DEMO_GA4_MP_ENABLED", "GA4_API_SECRET", "GA4_MEASUREMENT_ID"].every((v) => guida.includes(v)) && [...new Set((calcoli + modulo + riserva).match(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g) ?? [])].filter((v) => /^(DEMO|GA4|GOOGLE)_/.test(v)).every((v) => guida.includes(v)));
    atteso("il test è nella catena verifica:livello1", /tsx scripts\/verifica-demo-ga4-prova-omnia-ai\.ts/.test(leggi("package.json")));
    atteso("la configurazione di Vercel non cambia: nessun nuovo cron e nessuna variabile nel codice di Next", !/ga4-prova/.test(leggi("vercel.json")) && !/DEMO_GA4_PROVA_EMAIL/.test(leggi("next.config.ts")));
  }

  if (fallimenti.length > 0) {
    console.log(`\n${fallimenti.length} controlli falliti:\n- ${fallimenti.join("\n- ")}`);
    process.exit(1);
  }
  completato = true;
  console.log("\nTutti i controlli sono andati a buon fine.");
}

// Se una promessa resta appesa (per esempio un invio che non si annulla mai) Node esce da solo con codice 0 senza dire niente: qui si
// trasforma in un fallimento.
let completato = false;
process.on("exit", () => {
  if (!completato && process.exitCode === undefined) {
    console.log("FALLITO il test non è arrivato in fondo (una promessa è rimasta appesa)");
    process.exitCode = 1;
  }
});

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
