// Autotest dell'INVIO REALE a Google Ads (Data Manager API, validateOnly=false) delle DEMO di OMNIA AI.
//
// Richiesta del titolare (10/11/2026): la prima conversione vera (Ascot Ristorazione) deve partire UNA sola volta, con un identificativo
// di transazione stabile, salvando l'identificativo di richiesta di Google, SENZA rimandare mai da soli un esito incerto e SENZA inviare
// in blocco vecchie richieste. Qui si controlla, con un database finto in memoria e un fetch finto (nessuna rete, nessuna chiave), che:
//   - l'invio manuale (console) parta solo con l'integrazione completa, la frase specifica della richiesta, il blocco libero e una
//     richiesta davvero inviabile (confermata, clic, consensi con firma valida), e non dipenda dalla modalità del cron;
//   - l'invio sia PRENOTATO nel database PRIMA di chiamare Google, e la prenotazione sia condizionata (chi non la ottiene non invia);
//   - l'ora della conversione sia quella della prenotazione (non dell'appuntamento), l'identificativo di transazione quello della richiesta;
//   - rete, tempo scaduto, 5xx e risposta senza identificativo siano esiti INCERTI mai rimandati; un rifiuto chiaro non si riprova da solo;
//   - l'identificativo di richiesta si salvi e requestStatus si legga in qualunque modalità del cron;
//   - il cron in modalità reale non invii niente senza una data minima valida, non prenda richieste precedenti, non superi il tetto per giro;
//   - nei risultati e nei log non compaiano email, token o identificativi di clic.
import fs from "fs";
import path from "path";
import { FintoDatabase, fetchFinto, type ChiamataFinta, type Riga } from "./demo-finto-supabase";
import { VERSIONE_CONSENSI_DEMO } from "../src/lib/demo-lead-calcoli";
import { costruisciConsensi, stringaDaFirmare } from "../src/lib/demo-consensi-calcoli";
import { TENTATIVI_MASSIMI } from "../src/lib/demo-conversioni-calcoli";
import { firmaConsenso, sha256Hex } from "../src/lib/demo-hash";
import { acquisisciBlocco } from "../src/lib/demo-blocco";
import { inviaConversioniAds, riservaInvioAds } from "../src/lib/demo-ads-data-manager";
import {
  COSA_FARE_FASE_ADS,
  ETICHETTA_FASE_ADS,
  FRASE_INVIO_ADS,
  LIMITE_INVII_REALI_PER_GIRO,
  TONO_FASE_ADS,
  aggiornamentoDopoInvio,
  dataMinimaReale,
  esitoDaRispostaIngest,
  faseAds,
  fraseInvioAds,
  inviabileAMano,
  mascheraIdentificativo,
  motiviStatoNonInviabile,
  type FaseAds,
  type RigaPerFase,
} from "../src/lib/demo-ads-invio-calcoli";
import { controllaEsitoAds, inviaConversioneAds, leggiInvioAds, statoGateInvioAds } from "../src/lib/demo-ads-invio";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
const radice = path.join(__dirname, "..");
const leggi = (relativo: string) => fs.readFileSync(path.join(radice, relativo), "utf-8").replace(/\r\n/g, "\n");

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
const ASCOT = "52dc0adc-d066-43e3-a9e2-dd4cbf21de84";
const ALTRO = "9b7a2d10-1111-4222-8333-444455556666";
const GCLID = "Cj0KCQ_clic-segretissimo_123456";
const EMAIL = "Direzione@Ascot-Esempio.it";
const SEGRETI = ["at-segreto", "ads-rt", "client-segreto", SEGRETO_FIRMA, GCLID, "direzione@ascot-esempio.it", EMAIL];
const PRENOTATA_PG = "2026-11-09T19:37:04+00:00"; // com'è scritta da Postgres: «+00:00», senza millisecondi

type OpzioniConsensi = { privacy?: boolean; cookie?: boolean; ads?: boolean; firmare?: boolean };
function consensiFirmati(leadId: string, o: OpzioniConsensi = {}): Riga[] {
  const quando = "2026-11-09T19:36:27.447Z";
  return costruisciConsensi({ adsConsenso: o.ads ?? false, cookieAccettati: o.cookie ?? true, ipHash: null }, sha256Hex)
    .filter((c) => c.tipo !== "informativa_privacy" || o.privacy !== false)
    .map((c) => {
      const r = { ...c, lead_id: leadId, registrato_il: quando };
      return { ...r, firma: o.firmare === false ? null : firmaConsenso(stringaDaFirmare(r), SEGRETO_FIRMA) };
    });
}

// La richiesta di Ascot com'è nel database vero: confermata, clic vero, cookie sì ed email NO, già «validated» dal cron.
function richiesta(extra: Riga = {}): Riga {
  const id = (extra.id as string | undefined) ?? ASCOT;
  return {
    id, contatto_id: `contatto-${id}`, idempotency_key: `chiave-${id}-xxxxxxxxxx`,
    full_name: "Direzione Ascot", company: "Ascot Ristorazione srl", email: EMAIL, email_norm: EMAIL.toLowerCase(),
    phone: null, sector: "Ristorazione collettiva", gclid: GCLID, gbraid: null, wbraid: null,
    utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, utm_term: null, landing_path: "/demo",
    ga_client_id: "1234567890.1700000000", ga_session_id: "1700000000", attribution_consent: true,
    privacy_version: VERSIONE_CONSENSI_DEMO, privacy_accepted_at: "2026-11-09T19:36:27.447Z", ads_measurement_consent: false, ads_measurement_consent_at: null,
    ip_hash: null, booking_status: "confirmed", superseded_by: null, prima_prenotazione_il: PRENOTATA_PG,
    ga4_sent_at: null, ga4_attempts: 0, ads_import_status: "validated", ads_transaction_id: null, ads_request_id: null, ads_sent_at: null, ads_attempts: 0,
    ads_next_attempt_at: null, ads_last_error: null, created_at: "2026-11-09T19:36:27.447Z", updated_at: "2026-11-09T19:40:41.443Z", ...extra,
  };
}

function dbCon(leads: Riga[], consensi: Record<string, OpzioniConsensi> = {}): FintoDatabase {
  const contatti = leads.map((l) => ({ id: l.contatto_id, email_norm: l.email_norm, email: l.email, full_name: l.full_name, company: l.company, phone: null, sector: l.sector, ultima_richiesta_il: l.created_at, created_at: l.created_at, updated_at: l.created_at }));
  return new FintoDatabase({
    demo_contatti: contatti,
    demo_leads: leads,
    demo_consensi: leads.flatMap((l) => consensiFirmati(l.id as string, consensi[l.id as string] ?? {})),
  });
}

const envAds = {
  DEMO_ADS_IMPORT_ENABLED: "1",
  GOOGLE_ADS_CUSTOMER_ID: "9976567647",
  GOOGLE_ADS_DEMO_CONVERSION_ACTION_ID: "7889474345",
  GOOGLE_OAUTH_CLIENT_ID: "client-id",
  GOOGLE_OAUTH_CLIENT_SECRET: "client-segreto",
  GOOGLE_ADS_REFRESH_TOKEN: "ads-rt",
  DEMO_CONSENT_SIGNING_SECRET: SEGRETO_FIRMA,
};

type Rotte = {
  ingest?: (corpo: Record<string, unknown>, n: number) => { status: number; json?: unknown };
  stato?: (id: string) => { status: number; json?: unknown };
  token?: () => { status: number; json?: unknown };
  // si chiama appena prima di rispondere all'invio: serve a guardare il database MENTRE la chiamata è in corso
  durante?: () => void;
};
function ambiente(rotte: Rotte = {}) {
  let n = 0;
  return fetchFinto((c) => {
    if (c.url.startsWith("https://oauth2.googleapis.com/token")) return (rotte.token ?? (() => ({ status: 200, json: { access_token: "at-segreto" } })))();
    if (c.url === "https://datamanager.googleapis.com/v1/events:ingest") {
      rotte.durante?.();
      return (rotte.ingest ?? (() => ({ status: 200, json: { requestId: `req-${n}` } })))(JSON.parse(c.corpo ?? "{}"), n++);
    }
    if (c.url.startsWith("https://datamanager.googleapis.com/v1/requestStatus:retrieve")) {
      return (rotte.stato ?? (() => ({ status: 200, json: { requestStatusPerDestination: [{ requestStatus: "SUCCESS" }] } })))(new URL(c.url).searchParams.get("requestId") ?? "");
    }
    return { status: 404 };
  });
}
const ingerimenti = (cf: { chiamate: ChiamataFinta[] }) => cf.chiamate.filter((c) => c.url.endsWith("events:ingest"));
const letture = (cf: { chiamate: ChiamataFinta[] }) => cf.chiamate.filter((c) => c.url.includes("requestStatus:retrieve"));
const lead = (db: FintoDatabase, id = ASCOT) => db.da("demo_leads").find((r) => r.id === id)!;
const frasePer = (id: string) => fraseInvioAds(id);

async function main() {
  // ═════════════════════════ 1. Regole pure ═════════════════════════
  console.log("\n--- Regole pure: esito della chiamata ---");
  const e = esitoDaRispostaIngest;
  atteso("nessuna risposta (rete caduta o tempo scaduto) → INCERTA", e(null).tipo === "incerta" && (e(null) as { codice: string }).codice === "RETE_O_TIMEOUT");
  atteso("200 con identificativo di richiesta → inviata, identificativo conservato", JSON.stringify(e({ stato: 200, json: { requestId: " abc-123 " } })) === JSON.stringify({ tipo: "inviata", requestId: "abc-123" }));
  atteso("200 SENZA identificativo (assente, vuoto, non testo, corpo non leggibile) → INCERTA: potrebbe essere stata registrata", [{}, { requestId: "" }, { requestId: "   " }, { requestId: 42 }, null].every((j) => e({ stato: 200, json: j }).tipo === "incerta"));
  atteso("5xx (500, 502, 503, 504) → INCERTA con il codice", [500, 502, 503, 504].every((s) => e({ stato: s, json: null }).tipo === "incerta") && (e({ stato: 500, json: { error: { status: "INTERNAL", message: "testo libero" } } }) as { codice: string }).codice === "HTTP_500 INTERNAL");
  atteso("risposte inattese (3xx, 1xx) → INCERTA (nel dubbio non si rimanda)", e({ stato: 302, json: null }).tipo === "incerta" && e({ stato: 100, json: null }).tipo === "incerta");
  atteso("429 (quota superata) → non elaborata: l'unica ritentabile", e({ stato: 429, json: { error: { status: "RESOURCE_EXHAUSTED" } } }).tipo === "non_elaborata");
  atteso("4xx chiari (400, 401, 403, 404) → rifiutata, con il solo codice di Google (mai il messaggio libero)", [400, 401, 403, 404].every((s) => e({ stato: s, json: null }).tipo === "rifiutata") && (e({ stato: 400, json: { error: { status: "INVALID_ARGUMENT", message: "Mario Rossi 3331234567" } } }) as { codice: string }).codice === "HTTP_400 INVALID_ARGUMENT");
  atteso("un codice di errore che non ha la forma di un codice (testo libero o minuscolo) non entra nell'esito", (e({ stato: 400, json: { error: { status: "mario.rossi@esempio.it" } } }) as { codice: string }).codice === "HTTP_400");

  console.log("\n--- Regole pure: cosa si scrive dopo l'invio ---");
  const ag = aggiornamentoDopoInvio;
  const adIso = new Date(ADESSO).toISOString();
  atteso("inviata: si salva l'identificativo di richiesta e si toglie l'errore (resta «sent»)", ag({ tipo: "inviata", requestId: "r1" }, 1, ADESSO, false).ads_request_id === "r1" && ag({ tipo: "inviata", requestId: "r1" }, 1, ADESSO, false).ads_last_error === null && ag({ tipo: "inviata", requestId: "r1" }, 1, ADESSO, false).ads_import_status === undefined);
  const inc = ag({ tipo: "incerta", codice: "RETE_O_TIMEOUT" }, 1, ADESSO, true);
  atteso("incerta: resta «sent» senza identificativo e senza prossimo tentativo, anche col ritento automatico acceso; il codice porta il prefisso ESITO_INCERTO", inc.ads_import_status === undefined && inc.ads_request_id === undefined && inc.ads_next_attempt_at === undefined && inc.ads_last_error === "ESITO_INCERTO:RETE_O_TIMEOUT");
  const rif = ag({ tipo: "rifiutata", codice: "HTTP_400 INVALID_ARGUMENT" }, 1, ADESSO, true);
  atteso("rifiutata: «failed», nessun prossimo tentativo (nemmeno col ritento acceso), data di invio azzerata", rif.ads_import_status === "failed" && rif.ads_next_attempt_at === null && rif.ads_sent_at === null && rif.ads_last_error === "HTTP_400 INVALID_ARGUMENT");
  atteso("quota superata: il ritento automatico c'è SOLO se lo chiede il cron (10 minuti dopo); a mano mai", ag({ tipo: "non_elaborata", codice: "HTTP_429" }, 1, ADESSO, true).ads_next_attempt_at === new Date(ADESSO + 600_000).toISOString() && ag({ tipo: "non_elaborata", codice: "HTTP_429" }, 1, ADESSO, false).ads_next_attempt_at === null && adIso === ADESSO_ISO);

  console.log("\n--- Regole pure: fasi di una conversione ---");
  const base: RigaPerFase = { ads_import_status: "ready", ads_request_id: null, ads_last_error: null, ads_sent_at: null, ads_next_attempt_at: null };
  const f = (extra: Partial<RigaPerFase>, adesso = ADESSO): FaseAds => faseAds({ ...base, ...extra }, adesso);
  atteso("pronta e verificata = da inviare; in attesa di prenotazione; scartate = non inviabili", f({ ads_import_status: "ready" }) === "da_inviare" && f({ ads_import_status: "validated" }) === "da_inviare" && f({ ads_import_status: "not_ready" }) === "non_ancora" && f({ ads_import_status: "skipped_no_consent" }) === "non_inviabile" && f({ ads_import_status: "skipped_cancelled" }) === "non_inviabile");
  atteso("«sent» con identificativo = Google la sta elaborando; «accepted» = accettata", f({ ads_import_status: "sent", ads_request_id: "r" }) === "in_elaborazione" && f({ ads_import_status: "accepted", ads_request_id: "r" }) === "accettata");
  atteso("«sent» senza identificativo e col codice ESITO_INCERTO = INCERTA", f({ ads_import_status: "sent", ads_last_error: "ESITO_INCERTO:HTTP_500" }) === "incerta");
  atteso("«sent» senza identificativo, prenotato da meno di 5 minuti = invio in corso; da più di 5 minuti (funzione morta durante la chiamata) = INCERTA", f({ ads_import_status: "sent", ads_sent_at: new Date(ADESSO - 60_000).toISOString() }) === "in_invio" && f({ ads_import_status: "sent", ads_sent_at: new Date(ADESSO - 6 * 60_000).toISOString() }) === "incerta" && f({ ads_import_status: "sent", ads_sent_at: null }) === "incerta");
  atteso("«failed»: senza prossimo tentativo = rifiutata (serve una persona); con prossimo tentativo = da ritentare (solo quota)", f({ ads_import_status: "failed" }) === "rifiutata" && f({ ads_import_status: "failed", ads_next_attempt_at: ADESSO_ISO }) === "da_ritentare");
  const tutte: FaseAds[] = ["non_ancora", "da_inviare", "in_invio", "incerta", "in_elaborazione", "accettata", "rifiutata", "da_ritentare", "non_inviabile"];
  atteso("ogni fase ha etichetta, tono e istruzione; l'esito incerto dice di NON rimandare e dove guardare", tutte.every((x) => !!ETICHETTA_FASE_ADS[x] && !!TONO_FASE_ADS[x] && !!COSA_FARE_FASE_ADS[x]) && /NON è stata rimandata/.test(COSA_FARE_FASE_ADS.incerta) && /Google Ads/.test(COSA_FARE_FASE_ADS.incerta));

  console.log("\n--- Regole pure: data minima, frase, stati inviabili ---");
  const dm = (v: string | undefined) => dataMinimaReale({ DEMO_ADS_REAL_FROM: v });
  atteso("data minima valida solo con ora e fuso (Z oppure ±hh:mm)", dm("2026-11-10T12:00:00Z")?.iso === "2026-11-10T12:00:00.000Z" && dm("2026-11-10T13:00:00+01:00")?.iso === "2026-11-10T12:00:00.000Z" && dm("2026-11-10T12:00Z")?.iso === "2026-11-10T12:00:00.000Z" && dm(" 2026-11-10T12:00:00.500Z ")?.ms === Date.parse("2026-11-10T12:00:00.500Z"));
  atteso("senza data valida il risultato è NULL (il cron non invia): assente, vuota, solo data, senza fuso, testo, data impossibile", [undefined, "", "   ", "2026-11-10", "2026-11-10T12:00:00", "ieri", "10/11/2026 12:00", "2026-13-45T12:00:00Z"].every((v) => dm(v) === null));
  atteso("la frase contiene l'id della richiesta (primi otto caratteri): diversa per ogni richiesta, mai quella generica", fraseInvioAds(ASCOT) === `${FRASE_INVIO_ADS} 52dc0adc` && fraseInvioAds(ALTRO) !== fraseInvioAds(ASCOT) && fraseInvioAds(ASCOT) !== FRASE_INVIO_ADS);
  const riga = (extra: Partial<RigaPerFase & { booking_status: string; ads_attempts: number }>) => ({ ...base, booking_status: "confirmed", ads_attempts: 0, ...extra });
  atteso("inviabili a mano: pronta, verificata, fallita SENZA identificativo (rifiuto chiaro); mai «sent», «accepted», «failed» con identificativo, scartate, non confermate, tentativi esauriti", inviabileAMano(riga({ ads_import_status: "ready" })) && inviabileAMano(riga({ ads_import_status: "validated" })) && inviabileAMano(riga({ ads_import_status: "failed" })) && !inviabileAMano(riga({ ads_import_status: "failed", ads_request_id: "r" })) && !inviabileAMano(riga({ ads_import_status: "sent" })) && !inviabileAMano(riga({ ads_import_status: "sent", ads_request_id: "r" })) && !inviabileAMano(riga({ ads_import_status: "accepted" })) && !inviabileAMano(riga({ ads_import_status: "skipped_no_consent" })) && !inviabileAMano(riga({ ads_import_status: "not_ready" })) && !inviabileAMano(riga({ ads_import_status: "validated", booking_status: "cancelled" })) && !inviabileAMano(riga({ ads_import_status: "validated", ads_attempts: TENTATIVI_MASSIMI })));
  atteso("i motivi dello stato: non confermata, tentativi esauriti, stato non inviabile (vuoto se si può)", motiviStatoNonInviabile(riga({ ads_import_status: "validated" })).length === 0 && motiviStatoNonInviabile(riga({ ads_import_status: "validated", booking_status: "pending" }))[0] === "non_confermata" && motiviStatoNonInviabile(riga({ ads_import_status: "failed", ads_attempts: TENTATIVI_MASSIMI }))[0] === "tentativi_esauriti" && motiviStatoNonInviabile(riga({ ads_import_status: "accepted" }))[0] === "stato_non_inviabile");
  atteso("account e azione si mostrano solo con le ultime tre cifre", mascheraIdentificativo("9976567647") === "•••647" && mascheraIdentificativo("7889474345") === "•••345" && mascheraIdentificativo("12") === "•••");

  // ═════════════════════════ 2. Interruttori ═════════════════════════
  console.log("\n--- Invio manuale: interruttori, frase, richiesta ---");
  {
    const db = dbCon([richiesta()]);
    const cf = ambiente();
    const spegni = async (extra: Record<string, string | undefined>) => inviaConversioneAds(db.comeClient(), { ...envAds, ...extra }, { leadId: ASCOT, frase: frasePer(ASCOT) }, ADESSO, cf.fetch);
    const r0 = await spegni({ DEMO_ADS_IMPORT_ENABLED: undefined });
    const r1 = await spegni({ GOOGLE_ADS_DEMO_CONVERSION_ACTION_ID: undefined });
    const r2 = await spegni({ GOOGLE_ADS_REFRESH_TOKEN: undefined });
    const r3 = await spegni({ DEMO_CONSENT_SIGNING_SECRET: undefined });
    const r4 = await spegni({ DEMO_ADS_IMPORT_ENABLED: "0" });
    atteso("integrazione spenta o incompleta (importazione, azione, credenziali, segreto della firma) → «invio_spento» con l'elenco di ciò che manca, nessuna chiamata, richiesta intatta", [r0, r1, r2, r3, r4].every((r) => !r.ok && r.motivo === "invio_spento") && JSON.stringify(r0).includes("importazione_spenta") && JSON.stringify(r1).includes("configurazione_incompleta") && JSON.stringify(r2).includes("credenziali_mancanti") && JSON.stringify(r3).includes("segreto_firma_mancante") && cf.chiamate.length === 0 && lead(db).ads_import_status === "validated" && lead(db).ads_attempts === 0);

    const prova = async (leadId: unknown, frase: unknown) => inviaConversioneAds(db.comeClient(), envAds, { leadId, frase }, ADESSO, cf.fetch);
    const rId = await prova("non-un-uuid", frasePer(ASCOT));
    const rIdVuoto = await prova(undefined, frasePer(ASCOT));
    const rF1 = await prova(ASCOT, "");
    const rF2 = await prova(ASCOT, FRASE_INVIO_ADS);
    const rF3 = await prova(ASCOT, frasePer(ALTRO));
    const rF4 = await prova(ASCOT, "invia 1 conversione reale 52dc0adc");
    const rF5 = await prova(ASCOT, 42);
    atteso("id non valido → «id_non_valido»; frase vuota, generica (senza id), di un'altra richiesta, in minuscolo o non testuale → «frase_errata»: nessuna chiamata a Google", !rId.ok && rId.motivo === "id_non_valido" && !rIdVuoto.ok && rIdVuoto.motivo === "id_non_valido" && [rF1, rF2, rF3, rF4, rF5].every((r) => !r.ok && r.motivo === "frase_errata") && cf.chiamate.length === 0);
    const rSpazi = await inviaConversioneAds(dbCon([richiesta()]).comeClient(), envAds, { leadId: ASCOT, frase: `  ${FRASE_INVIO_ADS}   52dc0adc  ` }, ADESSO, ambiente().fetch);
    atteso("spazi in più prima, dopo e in mezzo alla frase non contano (la frase è esatta per il resto)", rSpazi.ok);
    atteso("nessun tentativo di conferma ha cambiato qualcosa nel database", lead(db).ads_import_status === "validated" && lead(db).ads_attempts === 0 && lead(db).ads_request_id === null && lead(db).ads_sent_at === null);

    const rNon = await inviaConversioneAds(db.comeClient(), envAds, { leadId: ALTRO, frase: frasePer(ALTRO) }, ADESSO, cf.fetch);
    atteso("richiesta inesistente → «non_trovata», nessuna chiamata a Google", !rNon.ok && rNon.motivo === "non_trovata" && cf.chiamate.length === 0);

    // blocco occupato (cron in corso)
    const dbB = dbCon([richiesta()]);
    await acquisisciBlocco(dbB.comeClient(), ADESSO);
    const cfB = ambiente();
    const rB = await inviaConversioneAds(dbB.comeClient(), envAds, { leadId: ASCOT, frase: frasePer(ASCOT) }, ADESSO + 1000, cfB.fetch);
    atteso("giro del cron in corso (blocco preso) → «occupato»: non si invia e non si aspetta", !rB.ok && rB.motivo === "occupato" && cfB.chiamate.length === 0 && lead(dbB).ads_import_status === "validated");
  }

  // ═════════════════════════ 3. Chi NON può essere inviato ═════════════════════════
  console.log("\n--- Invio manuale: richieste non inviabili ---");
  {
    const casi: { nome: string; riga: Riga; consensi?: OpzioniConsensi; motivo: string }[] = [
      { nome: "prenotazione non confermata", riga: richiesta({ booking_status: "pending", prima_prenotazione_il: null, ads_import_status: "not_ready" }), motivo: "non_confermata" },
      { nome: "prenotazione annullata", riga: richiesta({ booking_status: "cancelled", ads_import_status: "skipped_cancelled" }), motivo: "non_confermata" },
      { nome: "già inviata (sent)", riga: richiesta({ ads_import_status: "sent", ads_request_id: "r-1", ads_sent_at: ADESSO_ISO }), motivo: "stato_non_inviabile" },
      { nome: "inviata senza esito (incerta)", riga: richiesta({ ads_import_status: "sent", ads_last_error: "ESITO_INCERTO:RETE_O_TIMEOUT", ads_sent_at: ADESSO_ISO }), motivo: "stato_non_inviabile" },
      { nome: "già accettata", riga: richiesta({ ads_import_status: "accepted", ads_request_id: "r-1" }), motivo: "stato_non_inviabile" },
      { nome: "fallita in elaborazione (ha un identificativo)", riga: richiesta({ ads_import_status: "failed", ads_request_id: "r-1" }), motivo: "stato_non_inviabile" },
      { nome: "scartata per consenso", riga: richiesta({ ads_import_status: "skipped_no_consent" }), motivo: "stato_non_inviabile" },
      { nome: "tentativi esauriti", riga: richiesta({ ads_import_status: "failed", ads_attempts: TENTATIVI_MASSIMI }), motivo: "tentativi_esauriti" },
      { nome: "senza cookie pubblicitari", riga: richiesta(), consensi: { cookie: false }, motivo: "senza_consenso" },
      { nome: "senza informativa", riga: richiesta(), consensi: { privacy: false }, motivo: "senza_consenso" },
      { nome: "consensi non firmati (non verificabili)", riga: richiesta(), consensi: { firmare: false }, motivo: "senza_consenso" },
      { nome: "senza identificativo di clic", riga: richiesta({ gclid: null }), motivo: "senza_identificativo" },
      { nome: "prenotazione di oltre 90 giorni fa", riga: richiesta({ prima_prenotazione_il: "2026-06-01T10:00:00+00:00" }), motivo: "troppo_vecchia" },
    ];
    for (const c of casi) {
      const db = dbCon([c.riga], { [ASCOT]: c.consensi ?? {} });
      const cf = ambiente();
      const prima = JSON.stringify(lead(db));
      const r = await inviaConversioneAds(db.comeClient(), envAds, { leadId: ASCOT, frase: frasePer(ASCOT) }, ADESSO, cf.fetch);
      atteso(`non inviabile: ${c.nome} → «non_inviabile» (${c.motivo}), nessuna chiamata a Google, richiesta intatta`, !r.ok && r.motivo === "non_inviabile" && JSON.stringify(r.motivi) === JSON.stringify([c.motivo]) && cf.chiamate.length === 0 && JSON.stringify(lead(db)) === prima, JSON.stringify(r));
    }
    // consenso alterato a mano nel registro
    const dbAlt = dbCon([richiesta()], { [ASCOT]: { cookie: false } });
    dbAlt.da("demo_consensi").find((r) => r.tipo === "cookie_pubblicitari")!.valore = "granted";
    const cfAlt = ambiente();
    const rAlt = await inviaConversioneAds(dbAlt.comeClient(), envAds, { leadId: ASCOT, frase: frasePer(ASCOT) }, ADESSO, cfAlt.fetch);
    atteso("un consenso ALTERATO a mano nel registro (firma che non torna) non vale, anche se la colonna riassuntiva dice «sì»", !rAlt.ok && rAlt.motivo === "non_inviabile" && cfAlt.chiamate.length === 0);
  }

  // ═════════════════════════ 4. L'invio di Ascot ═════════════════════════
  console.log("\n--- Invio manuale: il caso Ascot ---");
  {
    const db = dbCon([richiesta()]);
    // il database MENTRE la chiamata a Google è in corso: la prenotazione deve esserci già
    let durante: Riga | null = null;
    const cf = ambiente({ durante: () => (durante = { ...lead(db) }), ingest: () => ({ status: 200, json: { requestId: "req-ascot-001" } }) });
    const { valore: r, log } = await conLog(() => inviaConversioneAds(db.comeClient(), { ...envAds, DEMO_ADS_VALIDATE_ONLY: "1" }, { leadId: ASCOT, frase: frasePer(ASCOT) }, ADESSO, cf.fetch));
    const corpo = JSON.parse(ingerimenti(cf)[0]?.corpo ?? "{}") as { validateOnly: boolean; encoding: string; consent: { adUserData: string; adPersonalization: string }; destinations: { operatingAccount: { accountId: string }; productDestinationId: string }[]; events: { eventTimestamp: string; transactionId: string; adIdentifiers?: { gclid?: string }; userData?: unknown }[] };
    atteso("UNA sola chiamata a Google, un POST autenticato, con validateOnly=false anche se il cron è in «solo verifica»", ingerimenti(cf).length === 1 && ingerimenti(cf)[0].metodo === "POST" && ingerimenti(cf)[0].intestazioni.authorization === "Bearer at-segreto" && corpo.validateOnly === false);
    atteso("PRIMA della chiamata a Google la richiesta era già PRENOTATA nel database: «sent», senza identificativo di richiesta, un tentativo, data di prenotazione e identificativo di transazione già scritti", durante !== null && (durante as Riga).ads_import_status === "sent" && (durante as Riga).ads_request_id === null && (durante as Riga).ads_attempts === 1 && (durante as Riga).ads_sent_at === ADESSO_ISO && (durante as Riga).ads_transaction_id === `omnia-demo-${ASCOT}`, JSON.stringify(durante));
    atteso("l'ora della conversione è quella della PRENOTAZIONE (19:37:04 UTC), in UTC con «Z», non l'ora dell'appuntamento", corpo.events[0].eventTimestamp === "2026-11-09T19:37:04.000Z", corpo.events[0].eventTimestamp);
    atteso("l'identificativo di transazione è quello della RICHIESTA (stabile, mai casuale)", corpo.events[0].transactionId === `omnia-demo-${ASCOT}`);
    atteso("account e azione di conversione come configurati; codifica HEX", corpo.destinations[0].operatingAccount.accountId === "9976567647" && corpo.destinations[0].productDestinationId === "7889474345" && corpo.encoding === "HEX");
    atteso("Ascot ha dato cookie e informativa ma NON l'email: parte il solo clic, MAI l'email (nemmeno cifrata); dati pubblicitari concessi, personalizzazione NEGATA", corpo.events[0].adIdentifiers?.gclid === GCLID && corpo.events[0].userData === undefined && !/[0-9a-f]{64}/.test(ingerimenti(cf)[0].corpo ?? "") && corpo.consent.adUserData === "CONSENT_GRANTED" && corpo.consent.adPersonalization === "CONSENT_DENIED", JSON.stringify(corpo));
    const l = lead(db);
    atteso("dopo la risposta: «sent» con l'identificativo di richiesta di Google SALVATO, un solo tentativo, nessun errore, nessun prossimo tentativo", l.ads_import_status === "sent" && l.ads_request_id === "req-ascot-001" && l.ads_attempts === 1 && l.ads_last_error === null && l.ads_next_attempt_at === null && l.ads_transaction_id === `omnia-demo-${ASCOT}`);
    atteso("il risultato dice «in elaborazione», non «accettata»: una risposta positiva non prova che Google abbia registrato la conversione", r.ok && r.fase === "in_elaborazione" && r.requestId === "req-ascot-001" && r.esitoRegistrato && r.conversionTime === "2026-11-09T19:37:04.000Z" && r.transactionId === `omnia-demo-${ASCOT}`);
    atteso("nel risultato e nei log non compaiono email, token, segreti o identificativi di clic", !SEGRETI.some((s) => JSON.stringify(r).includes(s) || log.includes(s)), log);
    atteso("il blocco condiviso con il cron è stato rilasciato", db.da("demo_sync_stato")[0].lock_until === null);

    // un secondo invio della stessa richiesta non parte
    const cf2 = ambiente();
    const r2 = await inviaConversioneAds(db.comeClient(), envAds, { leadId: ASCOT, frase: frasePer(ASCOT) }, ADESSO + 5000, cf2.fetch);
    atteso("la stessa richiesta NON si rinvia: «non_inviabile» (già inviata), nessuna chiamata", !r2.ok && r2.motivo === "non_inviabile" && cf2.chiamate.length === 0 && lead(db).ads_attempts === 1);

    // il cron, in qualunque modalità, non la rimanda; e in «solo verifica» ne legge comunque l'esito
    const cf3 = ambiente({ stato: () => ({ status: 200, json: { requestStatusPerDestination: [{ requestStatus: "PROCESSING" }] } }) });
    const c1 = await inviaConversioniAds(db.comeClient(), envAds, ADESSO + 30_000, cf3.fetch);
    atteso("cron in «solo verifica», meno di un minuto dopo: non rimanda e non rilegge ancora", ingerimenti(cf3).length === 0 && letture(cf3).length === 0 && c1.inElaborazione === 0);
    const c2 = await inviaConversioniAds(db.comeClient(), envAds, ADESSO + 120_000, cf3.fetch);
    atteso("cron in «solo verifica», due minuti dopo: legge requestStatus (una GET) anche se non è in modalità reale; PROCESSING = ancora in elaborazione, mai «accepted»", letture(cf3).length === 1 && letture(cf3)[0].metodo === "GET" && letture(cf3)[0].url.includes("requestId=req-ascot-001") && ingerimenti(cf3).length === 0 && c2.inElaborazione === 1 && lead(db).ads_import_status === "sent");
    const cf4 = ambiente();
    const c3 = await inviaConversioniAds(db.comeClient(), envAds, ADESSO + 240_000, cf4.fetch);
    atteso("quando Google risponde SUCCESS, il cron (anche in «solo verifica») segna «accepted»: l'esito reale è registrato", c3.accettati === 1 && lead(db).ads_import_status === "accepted" && ingerimenti(cf4).length === 0);
    const cf5 = ambiente();
    await inviaConversioniAds(db.comeClient(), { ...envAds, DEMO_ADS_VALIDATE_ONLY: "0", DEMO_ADS_REAL_FROM: "2026-11-01T00:00:00Z" }, ADESSO + 86_400_000, cf5.fetch);
    atteso("neppure il cron in modalità REALE la rimanda (è «accepted»)", ingerimenti(cf5).length === 0 && letture(cf5).length === 0);
  }

  // ═════════════════════════ 5. Esiti incerti e rifiuti ═════════════════════════
  console.log("\n--- Invio manuale: esiti incerti, rifiuti, guasti ---");
  {
    const prova = async (db: FintoDatabase, cf: { fetch: typeof fetch }, tempo?: number) => inviaConversioneAds(db.comeClient(), envAds, { leadId: ASCOT, frase: frasePer(ASCOT) }, ADESSO, cf.fetch, tempo);

    // 5xx
    const db5 = dbCon([richiesta()]);
    const cf5 = ambiente({ ingest: () => ({ status: 503, json: { error: { status: "UNAVAILABLE", message: "mario.rossi@esempio.it" } } }) });
    const r5 = await prova(db5, cf5);
    atteso("errore 5xx: esito INCERTO. Resta «sent» senza identificativo, con il codice ESITO_INCERTO, un tentativo, nessun prossimo tentativo", r5.ok && r5.fase === "incerta" && r5.requestId === null && lead(db5).ads_import_status === "sent" && lead(db5).ads_request_id === null && lead(db5).ads_last_error === "ESITO_INCERTO:HTTP_503 UNAVAILABLE" && lead(db5).ads_attempts === 1 && lead(db5).ads_next_attempt_at === null, JSON.stringify([r5, lead(db5)]));
    const cf5b = ambiente();
    const r5b = await prova(db5, cf5b);
    const c5 = await inviaConversioniAds(db5.comeClient(), { ...envAds, DEMO_ADS_VALIDATE_ONLY: "0", DEMO_ADS_REAL_FROM: "2026-11-01T00:00:00Z" }, ADESSO + 7 * 86_400_000, cf5b.fetch);
    atteso("l'esito incerto NON si rimanda: né a mano (non_inviabile), né dal cron in modalità reale, nemmeno dopo una settimana; non si legge nemmeno requestStatus (non c'è un id)", !r5b.ok && r5b.motivo === "non_inviabile" && ingerimenti(cf5b).length === 0 && letture(cf5b).length === 0 && c5.incerti === 0 && c5.inviati === 0 && lead(db5).ads_attempts === 1);

    // rete caduta
    const dbR = dbCon([richiesta()]);
    const cfR = (() => { const x = ambiente(); return { ...x, fetch: (async (u: RequestInfo | URL, i?: RequestInit) => { if (String(u).includes("events:ingest")) throw new Error("rete caduta mario.rossi@esempio.it"); return x.fetch(u, i); }) as typeof fetch }; })();
    const { valore: rR, log: logR } = await conLog(() => prova(dbR, cfR));
    atteso("rete caduta: INCERTA (RETE_O_TIMEOUT), nessuna eccezione, nel risultato e nei log non c'è il testo dell'errore", rR.ok && rR.fase === "incerta" && rR.codice === "RETE_O_TIMEOUT" && lead(dbR).ads_last_error === "ESITO_INCERTO:RETE_O_TIMEOUT" && lead(dbR).ads_import_status === "sent" && !/mario|rete caduta/i.test(`${JSON.stringify(rR)}${logR}`));

    // tempo scaduto
    const dbT = dbCon([richiesta()]);
    const cfT = (() => { const x = ambiente(); return { ...x, fetch: ((u: RequestInfo | URL, i?: RequestInit) => { if (String(u).includes("events:ingest")) return new Promise<Response>((_ok, no) => i?.signal?.addEventListener("abort", () => no(new Error("annullata")))); return x.fetch(u, i); }) as typeof fetch }; })();
    const rT = await prova(dbT, cfT, 30);
    atteso("tempo massimo scaduto: INCERTA, la chiamata viene interrotta e non si rimanda", rT.ok && rT.fase === "incerta" && lead(dbT).ads_last_error === "ESITO_INCERTO:RETE_O_TIMEOUT" && lead(dbT).ads_import_status === "sent");

    // 200 senza id
    const dbS = dbCon([richiesta()]);
    const rS = await prova(dbS, ambiente({ ingest: () => ({ status: 200, json: {} }) }));
    atteso("risposta «ok» senza identificativo: INCERTA (la conversione può essere stata registrata)", rS.ok && rS.fase === "incerta" && lead(dbS).ads_last_error === "ESITO_INCERTO:RISPOSTA_SENZA_ID_RICHIESTA" && lead(dbS).ads_import_status === "sent" && lead(dbS).ads_request_id === null);

    // 400
    const dbF = dbCon([richiesta()]);
    const rF = await prova(dbF, ambiente({ ingest: () => ({ status: 400, json: { error: { status: "INVALID_ARGUMENT", message: "testo libero" } } }) }));
    atteso("rifiuto chiaro (400): «failed» con il solo codice, niente prossimo tentativo, data di invio azzerata, nessun identificativo", rF.ok && rF.fase === "rifiutata" && lead(dbF).ads_import_status === "failed" && lead(dbF).ads_last_error === "HTTP_400 INVALID_ARGUMENT" && lead(dbF).ads_next_attempt_at === null && lead(dbF).ads_sent_at === null && lead(dbF).ads_request_id === null && lead(dbF).ads_attempts === 1);
    const cfDopo = ambiente({ ingest: () => ({ status: 200, json: { requestId: "req-secondo" } }) });
    const cronDopo = await inviaConversioniAds(dbF.comeClient(), { ...envAds, DEMO_ADS_VALIDATE_ONLY: "0", DEMO_ADS_REAL_FROM: "2026-11-01T00:00:00Z" }, ADESSO + 7 * 86_400_000, cfDopo.fetch);
    atteso("… il cron non la riprova da solo (serve una persona)", ingerimenti(cfDopo).length === 0 && cronDopo.inviati === 0);
    const rFdopo = await prova(dbF, cfDopo);
    atteso("… ma l'amministratore, risolto il motivo, può rinviarla a mano (con la frase): parte, tentativo 2, identificativo salvato", rFdopo.ok && rFdopo.fase === "in_elaborazione" && lead(dbF).ads_import_status === "sent" && lead(dbF).ads_request_id === "req-secondo" && lead(dbF).ads_attempts === 2 && lead(dbF).ads_last_error === null);

    // 429 a mano
    const dbQ = dbCon([richiesta()]);
    const rQ = await prova(dbQ, ambiente({ ingest: () => ({ status: 429, json: { error: { status: "RESOURCE_EXHAUSTED" } } }) }));
    atteso("quota superata a mano: «failed» (nessuna elaborazione), SENZA ritento automatico: decide l'amministratore", rQ.ok && rQ.fase === "rifiutata" && lead(dbQ).ads_import_status === "failed" && lead(dbQ).ads_next_attempt_at === null && lead(dbQ).ads_last_error === "HTTP_429 RESOURCE_EXHAUSTED");

    // token non ottenuto
    const dbTk = dbCon([richiesta()]);
    const cfTk = ambiente({ token: () => ({ status: 401, json: { error: "invalid_grant" } }) });
    const { valore: rTk } = await conLog(() => prova(dbTk, cfTk));
    atteso("token di Google non ottenuto: «token_non_ottenuto», NIENTE prenotato (la richiesta resta «validated», zero tentativi), nessuna chiamata di invio", !rTk.ok && rTk.motivo === "token_non_ottenuto" && ingerimenti(cfTk).length === 0 && lead(dbTk).ads_import_status === "validated" && lead(dbTk).ads_attempts === 0 && lead(dbTk).ads_sent_at === null);

    // prenotazione che non riesce
    const dbG = dbCon([richiesta()]);
    dbG.guasto = (tabella, tipo, dati) => (tabella === "demo_leads" && tipo === "update" && (dati as Riga | null)?.ads_import_status === "sent" ? { code: "XX000", message: "guasto" } : null);
    const cfG = ambiente();
    const rG = await prova(dbG, cfG);
    atteso("prenotazione non riuscita (database): «errore_database» e NESSUNA chiamata a Google", !rG.ok && rG.motivo === "errore_database" && ingerimenti(cfG).length === 0 && lead(dbG).ads_import_status === "validated");

    // esito non registrabile
    const dbE = dbCon([richiesta()]);
    dbE.guasto = (tabella, tipo, dati) => (tabella === "demo_leads" && tipo === "update" && !!(dati as Riga | null)?.ads_request_id ? { code: "XX000", message: "guasto" } : null);
    const cfE = ambiente({ ingest: () => ({ status: 200, json: { requestId: "req-non-salvato" } }) });
    const { valore: rE } = await conLog(() => prova(dbE, cfE));
    atteso("se l'esito non si riesce a scrivere: il risultato dice «esitoRegistrato: false» e riporta l'identificativo di Google (per controllarlo a mano); la richiesta resta «sent» senza id = INCERTA, mai rimandata", rE.ok && rE.esitoRegistrato === false && rE.requestId === "req-non-salvato" && lead(dbE).ads_import_status === "sent" && lead(dbE).ads_request_id === null && faseAds(lead(dbE) as unknown as RigaPerFase, ADESSO + 10 * 60_000) === "incerta" && ingerimenti(cfE).length === 1);

    // guasto passeggero nella scrittura dell'esito: si riprova UNA volta (è il database, non Google: nessun doppione possibile)
    const dbP = dbCon([richiesta()]);
    let giaFallita = false;
    dbP.guasto = (tabella, tipo, dati) => {
      if (tabella === "demo_leads" && tipo === "update" && !!(dati as Riga | null)?.ads_request_id && !giaFallita) {
        giaFallita = true;
        return { code: "XX000", message: "guasto" };
      }
      return null;
    };
    const cfP = ambiente({ ingest: () => ({ status: 200, json: { requestId: "req-ok2" } }) });
    const rP = await prova(dbP, cfP);
    atteso("se la prima scrittura dell'esito non riesce se ne fa UNA seconda: l'identificativo di richiesta si salva e Google è chiamato una volta sola", rP.ok && rP.esitoRegistrato && lead(dbP).ads_request_id === "req-ok2" && ingerimenti(cfP).length === 1);

    // la richiesta cambia DOPO la lettura e PRIMA della prenotazione (un altro processo, o il cron): la prenotazione condizionata non riesce
    // e NON si invia. Il token si chiede proprio tra la lettura e la prenotazione, quindi è il punto giusto per far cambiare la riga.
    const dbL = dbCon([richiesta()]);
    const cfL = ambiente({
      token: () => {
        lead(dbL).ads_attempts = 3;
        return { status: 200, json: { access_token: "at-segreto" } };
      },
    });
    const rL = await prova(dbL, cfL);
    atteso("prenotazione persa (la richiesta è cambiata dopo la lettura): «gia_prenotata», NESSUNA chiamata a Google, la richiesta non è toccata", !rL.ok && rL.motivo === "gia_prenotata" && ingerimenti(cfL).length === 0 && lead(dbL).ads_import_status === "validated" && lead(dbL).ads_attempts === 3 && lead(dbL).ads_sent_at === null);

    // l'esito si scrive solo sulla riga PRENOTATA: se nel frattempo un altro processo l'ha cambiata, la scrittura non tocca nulla e NON si dichiara «registrato»
    const dbZ = dbCon([richiesta()]);
    const cfZ = ambiente({
      durante: () => {
        lead(dbZ).ads_import_status = "accepted";
      },
      ingest: () => ({ status: 200, json: { requestId: "req-contesa" } }),
    });
    const rZ = await prova(dbZ, cfZ);
    atteso("se durante la chiamata la riga è stata cambiata da altri, la scrittura dell'esito non tocca niente: «esitoRegistrato: false», l'identificativo di Google viene restituito e la riga cambiata da altri non viene sovrascritta", rZ.ok && rZ.esitoRegistrato === false && rZ.requestId === "req-contesa" && lead(dbZ).ads_import_status === "accepted" && lead(dbZ).ads_request_id === null);

    // prenotazione condizionata
    const dbC = dbCon([richiesta()]);
    const istantanea = { ...lead(dbC) } as { id: string; ads_import_status: "validated"; ads_attempts: number };
    const p1 = await riservaInvioAds(dbC.comeClient(), istantanea, ADESSO_ISO);
    const p2 = await riservaInvioAds(dbC.comeClient(), istantanea, ADESSO_ISO);
    atteso("la prenotazione è CONDIZIONATA allo stato letto: la prima riesce, la seconda (stessa lettura) no", p1 === "riservata" && p2 === "non_riservata" && lead(dbC).ads_attempts === 1);
    const dbC2 = dbCon([richiesta()]);
    const istantaneaC2 = { ...lead(dbC2) } as { id: string; ads_import_status: "validated"; ads_attempts: number };
    lead(dbC2).booking_status = "cancelled";
    atteso("… e non riesce se nel frattempo la prenotazione è stata annullata", (await riservaInvioAds(dbC2.comeClient(), istantaneaC2, ADESSO_ISO)) === "non_riservata" && lead(dbC2).ads_import_status === "validated");
  }

  // ═════════════════════════ 6. Il cron in modalità reale ═════════════════════════
  console.log("\n--- Cron in modalità reale: data minima, tetto, prenotazione ---");
  {
    const reale = { ...envAds, DEMO_ADS_VALIDATE_ONLY: "0" };
    const pronte = (n: number, extra: Riga = {}) =>
      Array.from({ length: n }, (_v, i) => richiesta({ id: `00000000-0000-4000-8000-00000000000${i + 1}`, ads_import_status: "ready", ...extra }));

    // senza data minima
    for (const valore of [undefined, "", "2026-11-01", "ieri", "2026-11-01T00:00:00"]) {
      const db = dbCon(pronte(2));
      const cf = ambiente();
      const r = await inviaConversioniAds(db.comeClient(), { ...reale, DEMO_ADS_REAL_FROM: valore }, ADESSO, cf.fetch);
      atteso(`modalità reale senza una data minima valida (${JSON.stringify(valore)}): NON invia niente, motivo «data_minima_mancante», le richieste restano come sono`, r.modalita === "reale" && r.motivo === "data_minima_mancante" && r.inviati === 0 && ingerimenti(cf).length === 0 && db.da("demo_leads").every((l) => l.ads_import_status === "ready" && l.ads_attempts === 0));
    }
    // … ma l'esito di ciò che è già partito si legge lo stesso
    {
      const db = dbCon([richiesta({ ads_import_status: "sent", ads_request_id: "req-gia", ads_sent_at: new Date(ADESSO - 3_600_000).toISOString(), ads_attempts: 1 }), ...pronte(1)]);
      const cf = ambiente();
      const r = await inviaConversioniAds(db.comeClient(), reale, ADESSO, cf.fetch);
      atteso("… ma senza data minima si legge comunque requestStatus di ciò che è già partito (SUCCESS → «accepted»), senza inviare altro", r.accettati === 1 && lead(db).ads_import_status === "accepted" && ingerimenti(cf).length === 0 && db.da("demo_leads").filter((l) => l.ads_import_status === "ready").length === 1);
    }
    // data minima: solo le prenotazioni successive
    {
      const db = dbCon([
        richiesta({ id: "00000000-0000-4000-8000-000000000011", ads_import_status: "ready", prima_prenotazione_il: "2026-11-09T19:37:04+00:00" }),
        richiesta({ id: "00000000-0000-4000-8000-000000000012", ads_import_status: "validated", prima_prenotazione_il: "2026-11-09T19:00:00+00:00" }),
        richiesta({ id: "00000000-0000-4000-8000-000000000013", ads_import_status: "ready", prima_prenotazione_il: "2026-11-10T08:00:00+00:00" }),
      ]);
      const cf = ambiente();
      const r = await inviaConversioniAds(db.comeClient(), { ...reale, DEMO_ADS_REAL_FROM: "2026-11-10T00:00:00Z" }, ADESSO, cf.fetch);
      const ids = ingerimenti(cf).map((c) => (JSON.parse(c.corpo ?? "{}") as { events: { transactionId: string }[] }).events[0].transactionId);
      atteso("con la data minima parte SOLO chi ha prenotato dopo (anche tra «ready» e «validated» di prima): le precedenti restano com'erano, intatte", r.inviati === 1 && ids.length === 1 && ids[0] === "omnia-demo-00000000-0000-4000-8000-000000000013" && lead(db, "00000000-0000-4000-8000-000000000011").ads_import_status === "ready" && lead(db, "00000000-0000-4000-8000-000000000012").ads_import_status === "validated" && lead(db, "00000000-0000-4000-8000-000000000011").ads_attempts === 0);
    }
    // tetto per giro
    {
      const db = dbCon(pronte(LIMITE_INVII_REALI_PER_GIRO + 2));
      const cf = ambiente();
      const r1 = await inviaConversioniAds(db.comeClient(), { ...reale, DEMO_ADS_REAL_FROM: "2026-11-01T00:00:00Z" }, ADESSO, cf.fetch);
      atteso(`in un solo giro non partono più di ${LIMITE_INVII_REALI_PER_GIRO} conversioni vere; le altre restano «ready», intatte`, ingerimenti(cf).length === LIMITE_INVII_REALI_PER_GIRO && r1.inviati === LIMITE_INVII_REALI_PER_GIRO && db.da("demo_leads").filter((l) => l.ads_import_status === "ready").length === 2 && db.da("demo_leads").filter((l) => l.ads_import_status === "ready").every((l) => l.ads_attempts === 0));
      const r2 = await inviaConversioniAds(db.comeClient(), { ...reale, DEMO_ADS_REAL_FROM: "2026-11-01T00:00:00Z" }, ADESSO + 600_000, cf.fetch);
      atteso("al giro dopo partono le rimanenti, e le prime non si rimandano", ingerimenti(cf).length === LIMITE_INVII_REALI_PER_GIRO + 2 && r2.inviati === 2 && new Set(ingerimenti(cf).map((c) => c.corpo)).size === LIMITE_INVII_REALI_PER_GIRO + 2);
    }
    // la prenotazione precede la chiamata
    {
      const db = dbCon(pronte(1));
      let durante: Riga | null = null;
      const cf = ambiente({ durante: () => (durante = { ...db.da("demo_leads")[0] }) });
      await inviaConversioniAds(db.comeClient(), { ...reale, DEMO_ADS_REAL_FROM: "2026-11-01T00:00:00Z" }, ADESSO, cf.fetch);
      atteso("anche nel cron la richiesta è «sent» (prenotata, senza id) PRIMA della chiamata a Google", durante !== null && (durante as Riga).ads_import_status === "sent" && (durante as Riga).ads_request_id === null && (durante as Riga).ads_attempts === 1 && /^req-/.test(String(db.da("demo_leads")[0].ads_request_id)) && db.da("demo_leads")[0].ads_import_status === "sent");
    }
    // due giri insieme: una sola conversione
    {
      const db = dbCon(pronte(1));
      const cf = ambiente();
      await Promise.all([1, 2, 3].map(() => inviaConversioniAds(db.comeClient(), { ...reale, DEMO_ADS_REAL_FROM: "2026-11-01T00:00:00Z" }, ADESSO, cf.fetch)));
      atteso("tre esecuzioni in contemporanea della stessa richiesta (senza nemmeno il blocco del ciclo): UNA sola chiamata, grazie alla prenotazione condizionata", ingerimenti(cf).length === 1 && db.da("demo_leads")[0].ads_attempts === 1, String(ingerimenti(cf).length));
    }
    // incerta nel cron
    {
      const db = dbCon(pronte(1));
      const cf = ambiente({ ingest: () => ({ status: 502 }) });
      const r = await inviaConversioniAds(db.comeClient(), { ...reale, DEMO_ADS_REAL_FROM: "2026-11-01T00:00:00Z" }, ADESSO, cf.fetch);
      atteso("nel cron un 5xx è INCERTO: contato come tale (non «fallito»), resta «sent» senza id, non si rimanda", r.incerti === 1 && r.falliti === 0 && r.inviati === 0 && db.da("demo_leads")[0].ads_import_status === "sent" && db.da("demo_leads")[0].ads_last_error === "ESITO_INCERTO:HTTP_502");
    }
    // in «solo verifica» non si prenota e non si invia niente di vero
    {
      const db = dbCon(pronte(1));
      let durante: Riga | null = null;
      const cf = ambiente({ durante: () => (durante = { ...db.da("demo_leads")[0] }) });
      const r = await inviaConversioniAds(db.comeClient(), envAds, ADESSO, cf.fetch);
      atteso("in «solo verifica» (predefinita) la richiesta NON si prenota: validateOnly=true, resta pronta → «validated», nessun identificativo", r.modalita === "solo_verifica" && (durante as Riga | null)?.ads_import_status === "ready" && JSON.parse(ingerimenti(cf)[0].corpo ?? "{}").validateOnly === true && db.da("demo_leads")[0].ads_import_status === "validated" && db.da("demo_leads")[0].ads_attempts === 0);
    }
    // una conversione con identificativo di richiesta non rientra mai tra le «da inviare»
    {
      const db = dbCon([richiesta({ ads_import_status: "failed", ads_request_id: "req-elaborata-ma-fallita", ads_attempts: 1, ads_next_attempt_at: new Date(ADESSO - 1000).toISOString() })]);
      const cf = ambiente();
      await inviaConversioniAds(db.comeClient(), { ...reale, DEMO_ADS_REAL_FROM: "2026-11-01T00:00:00Z" }, ADESSO, cf.fetch);
      atteso("una richiesta già passata da Google (ha un identificativo) non si rimanda dal cron nemmeno se è «failed» con un tentativo scaduto", ingerimenti(cf).length === 0);
    }
  }

  // ═════════════════════════ 7. Elenco e controllo dell'esito (console) ═════════════════════════
  console.log("\n--- Console: elenco e controllo ---");
  {
    const db = dbCon(
      [
        richiesta(),
        richiesta({ id: "00000000-0000-4000-8000-000000000021", ads_import_status: "sent", ads_request_id: "req-21", ads_sent_at: new Date(ADESSO - 3_600_000).toISOString(), ads_attempts: 1, created_at: "2026-11-08T10:00:00.000Z" }),
        richiesta({ id: "00000000-0000-4000-8000-000000000022", ads_import_status: "sent", ads_last_error: "ESITO_INCERTO:RETE_O_TIMEOUT", ads_sent_at: new Date(ADESSO - 3_600_000).toISOString(), ads_attempts: 1, created_at: "2026-11-07T10:00:00.000Z" }),
        richiesta({ id: "00000000-0000-4000-8000-000000000023", ads_import_status: "accepted", ads_request_id: "req-23", created_at: "2026-11-06T10:00:00.000Z" }),
        richiesta({ id: "00000000-0000-4000-8000-000000000024", ads_import_status: "skipped_no_consent", created_at: "2026-11-05T10:00:00.000Z" }),
        richiesta({ id: "00000000-0000-4000-8000-000000000025", ads_import_status: "ready", gclid: null, created_at: "2026-11-04T10:00:00.000Z" }),
      ],
    );
    const { valore: el, log } = await conLog(() => leggiInvioAds(db.comeClient(), envAds, ADESSO));
    if (!el.ok) throw new Error("elenco non letto");
    const per = (id: string) => el.righe.find((r) => r.leadId === id)!;
    atteso("l'elenco comprende pronte, verificate, inviate, accettate; non le scartate né le non pronte", el.righe.length === 5 && !el.righe.some((r) => r.leadId.endsWith("24")));
    const a = per(ASCOT);
    atteso("Ascot: «da inviare», inviabile, con l'anteprima di ciò che partirebbe (ora della prenotazione, transazione, clic, niente email, personalizzazione negata, validateOnly=false)", a.fase === "da_inviare" && a.inviabile && a.motivi.length === 0 && a.anteprima?.conversionTime === "2026-11-09T19:37:04.000Z" && a.anteprima.transactionId === `omnia-demo-${ASCOT}` && a.anteprima.usaClic === "gclid" && a.anteprima.usaEmail === false && a.anteprima.adPersonalization === "CONSENT_DENIED" && a.anteprima.validateOnly === false && a.azienda === "Ascot Ristorazione srl", JSON.stringify(a));
    atteso("le fasi: inviata con id = in elaborazione; senza id e col codice = INCERTA (non inviabile); accettata", per("00000000-0000-4000-8000-000000000021").fase === "in_elaborazione" && !per("00000000-0000-4000-8000-000000000021").inviabile && per("00000000-0000-4000-8000-000000000022").fase === "incerta" && !per("00000000-0000-4000-8000-000000000022").inviabile && per("00000000-0000-4000-8000-000000000023").fase === "accettata");
    atteso("una richiesta pronta ma senza clic non è inviabile e lo dice (senza_identificativo)", !per("00000000-0000-4000-8000-000000000025").inviabile && per("00000000-0000-4000-8000-000000000025").motivi.includes("senza_identificativo"));
    atteso("lo stato dell'integrazione mostra account e azione SOLO con le ultime tre cifre, il cron in «solo verifica» e nessuna data minima", el.gate.attivo && el.gate.contoMascherato === "•••647" && el.gate.azioneMascherata === "•••345" && el.gate.modalitaCron === "solo_verifica" && el.gate.dataMinimaCron === null && !JSON.stringify(el.gate).includes("9976567647") && !JSON.stringify(el.gate).includes("7889474345"));
    atteso("l'elenco non contiene email, telefono, token, segreti né identificativi di clic; nei log non c'è niente", !SEGRETI.some((s) => JSON.stringify(el).includes(s) || log.includes(s)) && !JSON.stringify(el).includes("full_name"));
    const spento = await leggiInvioAds(db.comeClient(), { ...envAds, DEMO_CONSENT_SIGNING_SECRET: undefined }, ADESSO);
    atteso("senza il segreto della firma i consensi NON valgono (nessuna richiesta inviabile) e il gate dice cosa manca", spento.ok && !spento.gate.attivo && spento.gate.mancanti.includes("segreto_firma_mancante") && spento.righe.every((r) => !r.inviabile));
    const gate2 = statoGateInvioAds({ ...envAds, DEMO_ADS_VALIDATE_ONLY: "0", DEMO_ADS_REAL_FROM: "2026-11-10T12:00:00Z" });
    atteso("il gate riporta la modalità reale del cron e la data minima valida", gate2.modalitaCron === "reale" && gate2.dataMinimaCron === "2026-11-10T12:00:00.000Z");
    const dbErr = new FintoDatabase();
    dbErr.errori.demo_leads = { code: "42P01", message: "x" };
    const elErr = await leggiInvioAds(dbErr.comeClient(), envAds, ADESSO);
    atteso("tabelle non create: «schema_assente»", !elErr.ok && elErr.motivo === "schema_assente");

    // controllo dell'esito
    const dbC = dbCon([richiesta({ ads_import_status: "sent", ads_request_id: "req-ascot-001", ads_sent_at: new Date(ADESSO - 30_000).toISOString(), ads_attempts: 1 })]);
    const cfP = ambiente({ stato: () => ({ status: 200, json: { requestStatusPerDestination: [{ requestStatus: "PROCESSING" }] } }) });
    const cP = await controllaEsitoAds(dbC.comeClient(), envAds, { leadId: ASCOT }, ADESSO, cfP.fetch);
    atteso("controllo dell'esito: una GET, anche meno di un minuto dopo l'invio; PROCESSING = in corso, la richiesta resta «sent»", cP.ok && cP.esito === "in_corso" && letture(cfP).length === 1 && letture(cfP)[0].metodo === "GET" && ingerimenti(cfP).length === 0 && lead(dbC).ads_import_status === "sent");
    const cfS = ambiente();
    const cS = await controllaEsitoAds(dbC.comeClient(), envAds, { leadId: ASCOT }, ADESSO + 60_000, cfS.fetch);
    atteso("SUCCESS → «accepted» (solo ora è acquisita)", cS.ok && cS.esito === "accettata" && lead(dbC).ads_import_status === "accepted" && ingerimenti(cfS).length === 0);
    const dbK = dbCon([richiesta({ ads_import_status: "sent", ads_request_id: "req-ascot-001", ads_sent_at: new Date(ADESSO - 120_000).toISOString(), ads_attempts: 1 })]);
    const cK = await controllaEsitoAds(dbK.comeClient(), envAds, { leadId: ASCOT }, ADESSO, ambiente({ stato: () => ({ status: 200, json: { requestStatusPerDestination: [{ requestStatus: "FAILED", errorInfo: { errorCounts: [{ reason: "GCLID_NOT_FOUND", recordCount: "1" }] } }] } }) }).fetch);
    atteso("FAILED → «failed» con il motivo, senza riprovare; il risultato riporta i motivi (nomi di errore, mai dati)", cK.ok && cK.esito === "fallita" && cK.ragioni.includes("GCLID_NOT_FOUND") && lead(dbK).ads_import_status === "failed" && /GCLID_NOT_FOUND/.test(String(lead(dbK).ads_last_error)) && lead(dbK).ads_next_attempt_at === null);
    const dbN = dbCon([richiesta(), richiesta({ id: ALTRO, ads_import_status: "sent", ads_last_error: "ESITO_INCERTO:RETE_O_TIMEOUT", ads_sent_at: ADESSO_ISO })]);
    const cfN = ambiente();
    const cN1 = await controllaEsitoAds(dbN.comeClient(), envAds, { leadId: ASCOT }, ADESSO, cfN.fetch);
    const cN2 = await controllaEsitoAds(dbN.comeClient(), envAds, { leadId: ALTRO }, ADESSO, cfN.fetch);
    const cN3 = await controllaEsitoAds(dbN.comeClient(), envAds, { leadId: "x" }, ADESSO, cfN.fetch);
    const cN4 = await controllaEsitoAds(dbN.comeClient(), envAds, { leadId: "11111111-2222-4333-8444-555555555555" }, ADESSO, cfN.fetch);
    atteso("non si controlla ciò che non ha un invio con identificativo (pronta, incerta), né un id non valido o inesistente: nessuna chiamata", !cN1.ok && cN1.motivo === "non_controllabile" && !cN2.ok && cN2.motivo === "non_controllabile" && !cN3.ok && cN3.motivo === "id_non_valido" && !cN4.ok && cN4.motivo === "non_trovata" && cfN.chiamate.length === 0);
    const cOff = await controllaEsitoAds(dbC.comeClient(), { ...envAds, DEMO_ADS_IMPORT_ENABLED: undefined }, { leadId: ASCOT }, ADESSO, cfN.fetch);
    atteso("con l'integrazione spenta non si controlla niente", !cOff.ok && cOff.motivo === "invio_spento" && cfN.chiamate.length === 0);
  }

  // ═════════════════════════ 7b. 429 esplicito, concorrenza a 20, nessuna sovrascrittura ═════════════════════════
  console.log("\n--- 429 esplicito, 20 tentativi simultanei, cron senza sovrascritture ---");
  {
    const q = (stato: number, json: unknown) => esitoDaRispostaIngest({ stato, json }).tipo;
    atteso("un 429 è «riprovabile» SOLO se Google lo dichiara: stato 429 E codice RESOURCE_EXHAUSTED nel corpo", q(429, { error: { status: "RESOURCE_EXHAUSTED" } }) === "non_elaborata");
    atteso("un 429 ambiguo (senza corpo, corpo non leggibile, altro codice, codice scritto in minuscolo, solo un messaggio) è INCERTO e resta bloccato", [null, {}, "testo", { error: { status: "UNAVAILABLE" } }, { error: { status: "resource_exhausted" } }, { error: { message: "Too Many Requests" } }].every((j) => q(429, j) === "incerta"));
    atteso("il codice RESOURCE_EXHAUSTED con uno stato diverso da 429 non rende niente riprovabile (500 → incerto, 400 → rifiutato)", q(500, { error: { status: "RESOURCE_EXHAUSTED" } }) === "incerta" && q(400, { error: { status: "RESOURCE_EXHAUSTED" } }) === "rifiutata");
    atteso("timeout, rete interrotta, 5xx e risposta senza id restano INCERTI (nessuna eccezione per nessuno)", q(500, null) === "incerta" && esitoDaRispostaIngest(null).tipo === "incerta" && q(200, {}) === "incerta" && q(503, { error: { status: "UNAVAILABLE" } }) === "incerta");

    const reale = { ...envAds, DEMO_ADS_VALIDATE_ONLY: "0", DEMO_ADS_REAL_FROM: "2026-11-01T00:00:00Z" };
    {
      const db = dbCon([richiesta({ ads_import_status: "ready" })]);
      const cf = ambiente({ ingest: () => ({ status: 429 }) });
      const r1 = await inviaConversioniAds(db.comeClient(), reale, ADESSO, cf.fetch);
      await inviaConversioniAds(db.comeClient(), reale, ADESSO + 7 * 86_400_000, cf.fetch);
      atteso("cron: un 429 senza il codice di Google è INCERTO: resta «sent» senza id, contato come incerto, mai riprovato (una sola chiamata anche dopo una settimana)", r1.incerti === 1 && ingerimenti(cf).length === 1 && lead(db).ads_import_status === "sent" && lead(db).ads_request_id === null && lead(db).ads_next_attempt_at === null && lead(db).ads_last_error === "ESITO_INCERTO:HTTP_429");
      const dbE = dbCon([richiesta({ ads_import_status: "ready" })]);
      const cfE = ambiente({ ingest: () => ({ status: 429, json: { error: { status: "RESOURCE_EXHAUSTED" } } }) });
      const rE = await inviaConversioniAds(dbE.comeClient(), reale, ADESSO, cfE.fetch);
      atteso("cron: un 429 con RESOURCE_EXHAUSTED invece è «failed» con un nuovo tentativo fra 10 minuti (l'unico caso riprovato da solo)", rE.falliti === 1 && rE.incerti === 0 && lead(dbE).ads_import_status === "failed" && lead(dbE).ads_next_attempt_at === new Date(ADESSO + 600_000).toISOString());
      const dbM = dbCon([richiesta()]);
      const rM = await inviaConversioneAds(dbM.comeClient(), envAds, { leadId: ASCOT, frase: frasePer(ASCOT) }, ADESSO, ambiente({ ingest: () => ({ status: 429 }) }).fetch);
      atteso("invio manuale: un 429 senza il codice di Google è INCERTO (non «rifiutato»)", rM.ok && rM.fase === "incerta" && lead(dbM).ads_import_status === "sent" && lead(dbM).ads_last_error === "ESITO_INCERTO:HTTP_429");
    }

    // ── 20 tentativi simultanei ──
    const N = 20;
    {
      const db = dbCon([richiesta()]);
      const istantanea = { ...lead(db) } as { id: string; ads_import_status: "validated"; ads_attempts: number };
      const esiti = await Promise.all(Array.from({ length: N }, () => riservaInvioAds(db.comeClient(), istantanea, ADESSO_ISO)));
      atteso(`${N} prenotazioni simultanee della stessa richiesta (stessa lettura, come ${N} istanze di Vercel): UNA sola riesce, le altre ${N - 1} no, un solo tentativo contato`, esiti.filter((e) => e === "riservata").length === 1 && esiti.filter((e) => e === "non_riservata").length === N - 1 && lead(db).ads_attempts === 1 && lead(db).ads_import_status === "sent");
    }
    {
      const db = dbCon([richiesta({ ads_import_status: "ready" })]);
      const cf = ambiente();
      await Promise.all(Array.from({ length: N }, () => inviaConversioniAds(db.comeClient(), reale, ADESSO, cf.fetch)));
      atteso(`${N} giri del cron simultanei (senza nemmeno il blocco del ciclo): UNA sola chiamata a Google, un tentativo, un identificativo di richiesta`, ingerimenti(cf).length === 1 && lead(db).ads_attempts === 1 && /^req-/.test(String(lead(db).ads_request_id)), String(ingerimenti(cf).length));
    }
    {
      const db = dbCon([richiesta()]);
      const cf = ambiente();
      const esiti = await Promise.all(Array.from({ length: N }, () => inviaConversioneAds(db.comeClient(), envAds, { leadId: ASCOT, frase: frasePer(ASCOT) }, ADESSO, cf.fetch)));
      const riusciti = esiti.filter((r) => r.ok);
      atteso(`${N} invii manuali simultanei: UNA sola chiamata a Google, un solo invio «ok»; gli altri ${N - 1} sono rifiutati (occupato, già prenotata o non inviabile) e non toccano niente`, ingerimenti(cf).length === 1 && riusciti.length === 1 && esiti.filter((r) => !r.ok && ["occupato", "gia_prenotata", "non_inviabile"].includes(r.motivo)).length === N - 1 && lead(db).ads_attempts === 1 && db.da("demo_sync_stato")[0].lock_until === null, `${ingerimenti(cf).length} chiamate, ${riusciti.length} riusciti`);
    }
    {
      const db = dbCon([richiesta({ ads_import_status: "ready" })]);
      const cf = ambiente();
      const lavori: Promise<unknown>[] = [];
      for (let i = 0; i < N / 2; i++) {
        lavori.push(inviaConversioniAds(db.comeClient(), reale, ADESSO, cf.fetch));
        lavori.push(inviaConversioneAds(db.comeClient(), envAds, { leadId: ASCOT, frase: frasePer(ASCOT) }, ADESSO, cf.fetch));
      }
      await Promise.all(lavori);
      atteso(`${N} tentativi misti simultanei (${N / 2} giri del cron e ${N / 2} invii manuali): UNA sola chiamata a Google e un solo tentativo contato`, ingerimenti(cf).length === 1 && lead(db).ads_attempts === 1 && lead(db).ads_import_status === "sent", String(ingerimenti(cf).length));
    }
    {
      // lo stesso, ma l'esito è incerto: nemmeno questa volta nessuno rimanda
      const db = dbCon([richiesta({ ads_import_status: "ready" })]);
      const cf = ambiente({ ingest: () => ({ status: 503 }) });
      const lavori: Promise<unknown>[] = [];
      for (let i = 0; i < N / 2; i++) {
        lavori.push(inviaConversioniAds(db.comeClient(), reale, ADESSO, cf.fetch));
        lavori.push(inviaConversioneAds(db.comeClient(), envAds, { leadId: ASCOT, frase: frasePer(ASCOT) }, ADESSO, cf.fetch));
      }
      await Promise.all(lavori);
      await inviaConversioniAds(db.comeClient(), reale, ADESSO + 86_400_000, cf.fetch);
      atteso(`${N} tentativi simultanei con esito incerto (503): UNA sola chiamata e, dopo un giorno, ancora una sola: l'incerto non si rimanda`, ingerimenti(cf).length === 1 && lead(db).ads_attempts === 1 && lead(db).ads_last_error === "ESITO_INCERTO:HTTP_503", String(ingerimenti(cf).length) + " " + lead(db).ads_last_error);
    }

    // ── il cron in «solo verifica» non modifica né sovrascrive conversioni già riservate o inviate ──
    {
      const uuid = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
      const minutiFa = (m: number) => new Date(ADESSO - m * 60_000).toISOString();
      const db = dbCon([
        richiesta({ id: uuid(1), ads_import_status: "sent", ads_request_id: "req-1", ads_sent_at: new Date(ADESSO - 30_000).toISOString(), ads_attempts: 1 }),
        richiesta({ id: uuid(2), ads_import_status: "sent", ads_last_error: "ESITO_INCERTO:HTTP_503", ads_sent_at: minutiFa(60), ads_attempts: 1 }),
        richiesta({ id: uuid(3), ads_import_status: "sent", ads_sent_at: minutiFa(1), ads_attempts: 1 }),
        richiesta({ id: uuid(4), ads_import_status: "accepted", ads_request_id: "req-4", ads_attempts: 1 }),
        richiesta({ id: uuid(5), ads_import_status: "failed", ads_request_id: "req-5", ads_last_error: "ELABORAZIONE_FAILED", ads_attempts: 1 }),
        richiesta({ id: uuid(6), ads_import_status: "failed", ads_last_error: "HTTP_400 INVALID_ARGUMENT", ads_attempts: 1 }),
        richiesta({ id: uuid(7), ads_import_status: "validated" }),
      ]);
      const prima = JSON.stringify(db.da("demo_leads"));
      const cf = ambiente();
      const r = await inviaConversioniAds(db.comeClient(), envAds, ADESSO, cf.fetch);
      atteso("cron in «solo verifica»: conversioni prenotate, inviate (anche da meno di un minuto), incerte, accettate, rifiutate o già verificate restano IDENTICHE, nessuna chiamata di invio", JSON.stringify(db.da("demo_leads")) === prima && ingerimenti(cf).length === 0 && r.verificati === 0 && letture(cf).length === 0);

      // gara: «ready» quando il giro la legge, ma mentre Google valida la richiesta viene INVIATA DAVVERO da un altro processo
      const db2 = dbCon([richiesta({ ads_import_status: "ready" })]);
      const cf2 = ambiente({
        durante: () => {
          Object.assign(lead(db2), { ads_import_status: "sent", ads_request_id: "req-vero", ads_sent_at: ADESSO_ISO, ads_attempts: 1, ads_transaction_id: `omnia-demo-${ASCOT}` });
        },
      });
      const r2 = await inviaConversioniAds(db2.comeClient(), envAds, ADESSO, cf2.fetch);
      atteso("gara in «solo verifica»: se mentre Google valida la richiesta un altro processo la invia davvero, il giro NON la riporta a «validated», non cancella l'identificativo di richiesta e non la conta come verificata", lead(db2).ads_import_status === "sent" && lead(db2).ads_request_id === "req-vero" && lead(db2).ads_attempts === 1 && lead(db2).ads_sent_at === ADESSO_ISO && r2.verificati === 0);

      // stessa gara, ma la validazione fallisce (500): il «failed» del giro non sovrascrive l'invio vero
      const db3 = dbCon([richiesta({ ads_import_status: "ready" })]);
      const cf3 = ambiente({
        durante: () => {
          Object.assign(lead(db3), { ads_import_status: "sent", ads_request_id: "req-vero", ads_sent_at: ADESSO_ISO, ads_attempts: 1 });
        },
        ingest: () => ({ status: 500 }),
      });
      const r3 = await inviaConversioniAds(db3.comeClient(), envAds, ADESSO, cf3.fetch);
      atteso("gara con validazione fallita: il «failed» del giro non sovrascrive lo stato «sent» di un invio vero e non lo conta come errore", lead(db3).ads_import_status === "sent" && lead(db3).ads_request_id === "req-vero" && lead(db3).ads_attempts === 1 && r3.falliti === 0);

      // gara: l'altro processo ha solo PRENOTATO l'invio (stato «sent», ancora nessun identificativo di richiesta): vale la condizione sullo stato
      const db5 = dbCon([richiesta({ ads_import_status: "ready" })]);
      const cf5 = ambiente({
        durante: () => {
          Object.assign(lead(db5), { ads_import_status: "sent", ads_request_id: null, ads_sent_at: ADESSO_ISO, ads_attempts: 1 });
        },
      });
      const r5 = await inviaConversioniAds(db5.comeClient(), envAds, ADESSO, cf5.fetch);
      atteso("gara con l'invio solo PRENOTATO (stato «sent», nessun identificativo): il giro in «solo verifica» non lo riporta a «validated»", lead(db5).ads_import_status === "sent" && lead(db5).ads_attempts === 1 && lead(db5).ads_sent_at === ADESSO_ISO && r5.verificati === 0);

      // gara: lo stato non è cambiato ma la richiesta ha ricevuto un identificativo di Google: vale la condizione sull'identificativo
      const db6 = dbCon([richiesta({ ads_import_status: "ready" })]);
      const cf6 = ambiente({
        durante: () => {
          lead(db6).ads_request_id = "req-arrivato";
        },
      });
      const r6 = await inviaConversioniAds(db6.comeClient(), envAds, ADESSO, cf6.fetch);
      atteso("gara con un identificativo di richiesta comparso nel frattempo: il giro non scrive sulla richiesta (resta com'è, con l'identificativo)", lead(db6).ads_import_status === "ready" && lead(db6).ads_request_id === "req-arrivato" && r6.verificati === 0);

      // senza gara: la validazione scrive normalmente
      const db4 = dbCon([richiesta({ ads_import_status: "ready" })]);
      const r4 = await inviaConversioniAds(db4.comeClient(), envAds, ADESSO, ambiente().fetch);
      atteso("senza gara la validazione scrive come sempre: «validated», contata come verificata", lead(db4).ads_import_status === "validated" && r4.verificati === 1);
    }
  }

  // ═════════════════════════ 8. Struttura del codice ═════════════════════════
  console.log("\n--- Struttura del codice ---");
  {
    const azione = leggi("src/app/site-console/azioni/demo-ads-invio.ts");
    const invioIntero = leggi("src/lib/demo-ads-invio.ts");
    // solo la funzione di invio (le altre funzioni del file leggono le stesse cose in un altro ordine)
    const invio = invioIntero.slice(invioIntero.indexOf("export async function inviaConversioneAds("), invioIntero.indexOf("// ── Controllo dell'esito"));
    const dataManager = leggi("src/lib/demo-ads-data-manager.ts");
    const vista = leggi("src/app/site-console/_componenti/demo-vista.tsx");
    const componente = leggi("src/app/site-console/_componenti/invio-ads-reale.tsx");
    const catena = leggi("package.json");
    const guida = leggi("GUIDA-DEMO-TRACCIAMENTO.md");
    const esportate = azione.match(/export async function (\w+)\([^)]*\)[^{]*\{\n([^\n]*\n[^\n]*)/g) ?? [];
    atteso("azioni: sono tre e ognuna controlla l'amministratore come PRIMA operazione (richiediAdminAzione)", esportate.length === 3 && esportate.every((s) => /richiediAdminAzione\(\)/.test(s)) && azione.startsWith('"use server"'), String(esportate.length));
    atteso("azione di invio: una alla volta (segnale per istanza), nessun ritentativo, la pagina si aggiorna sempre; l'errore imprevisto dice di NON ripetere l'invio", /invioInCorso/.test(azione) && /finally \{\s*invioInCorso = false;\s*revalidatePath/.test(azione) && /NON ripetere l'invio/.test(azione) && !/for \(|while \(/.test(azione));
    atteso("modulo di invio: l'ordine è interruttori → id → frase → blocco → lettura → richiesta costruita → token → PRENOTAZIONE → UNA chiamata → esito, e il blocco si rilascia sempre (finally)", ["statoGateInvioAds(env)", "idRichiestaValido(input.leadId)", "fraseCorretta(input.frase", "acquisisciBlocco(", "leggiConsensi(", "costruisciRichiestaAds(", "ottieniTokenAccesso(", "riservaInvioAds(", "chiamaGoogle(URL_DATA_MANAGER_INGEST", "registraEsitoInvioAds("].every((s, i, tutti) => invio.includes(s) && (i === 0 || invio.indexOf(s) > invio.indexOf(tutti[i - 1]))) && /finally \{\s*await rilasciaBlocco\(admin\);\s*\}/.test(invio));
    atteso("modulo di invio: una sola chiamata di invio, forza validateOnly=false e rifiuta una richiesta che non lo dichiara; non dipende da DEMO_ADS_VALIDATE_ONLY", (invio.match(/URL_DATA_MANAGER_INGEST, token/g) ?? []).length === 1 && /soloVerifica: false/.test(invio) && /richiesta\.validateOnly !== false/.test(invio) && !/DEMO_ADS_VALIDATE_ONLY\s*[=!]==/.test(invio.replace(/\/\/[^\n]*/g, "")));
    atteso("cron: in modalità reale la prenotazione precede la chiamata, la richiesta dichiara validateOnly=false, l'esito passa dalla classificazione e non c'è nessun ritento sull'esito incerto", dataManager.indexOf("riservaInvioAds(admin, lead, adessoIso)") > 0 && dataManager.indexOf("riservaInvioAds(admin, lead, adessoIso)") < dataManager.indexOf("esitoDaRispostaIngest(await chiamaGoogle(URL_DATA_MANAGER_INGEST") && /costruzione\.richiesta\.validateOnly !== false/.test(dataManager) && /registraEsitoInvioAds\(admin, lead\.id, esitoChiamata, tentativi, adessoMs, true\)/.test(dataManager));
    atteso("cron: in modalità reale senza data minima valida si esce prima di leggere le richieste da inviare; la lettura è filtrata per data e identificativo", dataManager.indexOf('motivo: "data_minima_mancante"') > 0 && dataManager.indexOf('motivo: "data_minima_mancante"') < dataManager.indexOf("const stati = config.soloVerifica") && /gte\("prima_prenotazione_il", dataMinima\.iso\)/.test(dataManager) && /LIMITE_INVII_REALI_PER_GIRO/.test(dataManager));
    atteso("requestStatus si legge PRIMA e in qualunque modalità (non solo in quella reale)", dataManager.indexOf("riconciliaInviata(admin, token, lead, adessoMs, fetchFn)") > 0 && !/if \(!config\.soloVerifica\) \{\s*const \{ data: inviate/.test(dataManager));
    atteso("la scrittura dell'esito è mirata (solo la riga «sent» senza id) e la prenotazione è condizionata a stato, tentativi, conferma e assenza di id", /eq\("ads_import_status", "sent"\)\s*\.is\("ads_request_id", null\)\s*\.select\("id"\)/.test(dataManager) && /eq\("booking_status", "confirmed"\)\s*\.eq\("ads_import_status", lead\.ads_import_status\)\s*\.eq\("ads_attempts", lead\.ads_attempts\)\s*\.is\("ads_request_id", null\)/.test(dataManager));
    atteso("la pagina DEMO comprende il pannello; il componente chiama solo le tre azioni e non scrive la frase da solo (la prende dal modulo)", /<InvioAdsReale \/>/.test(vista) && /demo-ads-invio"/.test(componente) && /fraseInvioAds\(riga\.leadId\)/.test(componente) && !/fetch\(|datamanager|googleapis/.test(componente));
    atteso("il test è nella catena verifica:livello1", catena.includes("scripts/verifica-demo-ads-invio-omnia-ai.ts"));
    atteso("la guida ha la sezione «Invio reale a Google Ads» con la procedura, l'esito incerto e il controllo in Google Ads, e la variabile DEMO_ADS_REAL_FROM nella tabella delle variabili", /Invio reale a Google Ads/.test(guida) && /ESITO_INCERTO/.test(guida) && /DEMO_ADS_REAL_FROM/.test(guida) && /requestStatus/.test(guida) && /\| `DEMO_ADS_REAL_FROM` \|/.test(guida));
  }

  if (fallimenti.length > 0) {
    console.error(`\n${fallimenti.length} controlli falliti:\n- ${fallimenti.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\nTutti i controlli sono andati a buon fine.");
}

main().catch((errore) => {
  console.error(errore);
  process.exit(1);
});
