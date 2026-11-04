// Autotest della VERIFICA della Data Manager API di Google Ads in sola validazione (richiesta dell'utente, 04/11/2026): credenziali,
// account, azione di conversione, schema della richiesta, requestStatus, e assenza di conversioni registrate. Nessuna rete e nessun
// database vero: un Google finto che si comporta come ci si aspetta (e come NON ci si aspetta). Si controlla in particolare che:
//   - OGNI richiesta mandata a Google abbia validateOnly = true, anche se l'ambiente è in modalità reale;
//   - non si tocchi nessun database e non si usino lead o identificativi pubblicitari veri;
//   - nessun token, segreto, email, identificativo di clic o identificativo di account/azione compaia nel risultato o nei log;
//   - i controlli negativi distinguano «Google ha validato davvero» da «la validazione non controlla questo punto»;
//   - un'autenticazione fallita, una configurazione incompleta o una rete caduta non diano eccezioni né invii.
import fs from "fs";
import path from "path";
import { fetchFinto, type ChiamataFinta, type RispostaFinta } from "./demo-finto-supabase";
import { ID_CLIC_SINTETICO, verificaDataManager } from "../src/lib/demo-ads-verifica";
import { classificaCampi, costruisciRiepilogo, leggiErroreGoogle, mascheraId, type ProvaVerifica, type RisultatoVerifica } from "../src/lib/demo-ads-verifica-calcoli";
import { sha256Hex } from "../src/lib/demo-hash";

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

const ADESSO = Date.parse("2026-11-10T10:00:00.000Z");
const ENV = {
  DEMO_ADS_IMPORT_ENABLED: "1",
  DEMO_ADS_VALIDATE_ONLY: "1",
  GOOGLE_ADS_CUSTOMER_ID: "123-456-7890",
  GOOGLE_ADS_DEMO_CONVERSION_ACTION_ID: "987654321",
  GOOGLE_OAUTH_CLIENT_ID: "client-id-xyz",
  GOOGLE_OAUTH_CLIENT_SECRET: "client-segreto-xyz",
  GOOGLE_ADS_REFRESH_TOKEN: "rt-segreto-xyz",
};
// valori che non devono MAI comparire in uscita
const RISERVATI = ["at-segreto-xyz", "rt-segreto-xyz", "client-segreto-xyz", "client-id-xyz", "1234567890", "987654321", "verifica.validazione", sha256Hex("verifica.validazione@omnia-ai.invalid"), ID_CLIC_SINTETICO, "req-verifica-1", "non trovata", "does not have access"];

type Corpo = { validateOnly?: boolean; destinations?: { operatingAccount?: { accountId?: string }; productDestinationId?: string }[]; events?: { adIdentifiers?: unknown; userData?: unknown; transactionId?: string }[] };
type Comportamento = { token?: () => RispostaFinta; ingest?: (corpo: Corpo, n: number) => RispostaFinta; stato?: (id: string) => RispostaFinta };

const OK_TOKEN: RispostaFinta = { status: 200, json: { access_token: "at-segreto-xyz", scope: "https://www.googleapis.com/auth/datamanager", expires_in: 3600 } };
const campiViolati = (campo: string): RispostaFinta => ({ status: 400, json: { error: { code: 400, status: "INVALID_ARGUMENT", message: "Azione non trovata: 987654321", details: [{ "@type": "type.googleapis.com/google.rpc.BadRequest", fieldViolations: [{ field: campo, description: "valore 987654321 non valido" }] }] } } });

// Google finto: riconosce solo l'account e l'azione di ENV (con le cifre senza trattini)
function googleFinto(c: Comportamento = {}) {
  let n = 0;
  return fetchFinto((chiamata: ChiamataFinta) => {
    if (chiamata.url.startsWith("https://oauth2.googleapis.com/token")) return (c.token ?? (() => OK_TOKEN))();
    if (chiamata.url === "https://datamanager.googleapis.com/v1/events:ingest") {
      const corpo = JSON.parse(chiamata.corpo ?? "{}") as Corpo;
      if (c.ingest) return c.ingest(corpo, n++);
      n++;
      const d = corpo.destinations?.[0];
      if (d?.operatingAccount?.accountId !== "1234567890") return { status: 403, json: { error: { code: 403, status: "PERMISSION_DENIED", message: "User does not have access to account 0000000001" } } };
      if (d?.productDestinationId !== "987654321") return campiViolati("destinations[0].productDestinationId");
      return { status: 200, json: { requestId: "req-verifica-1" } };
    }
    if (chiamata.url.startsWith("https://datamanager.googleapis.com/v1/requestStatus:retrieve")) return (c.stato ?? (() => ({ status: 404, json: { error: { code: 404, status: "NOT_FOUND", message: "richiesta non trovata" } } })))(new URL(chiamata.url).searchParams.get("requestId") ?? "");
    return { status: 404 };
  });
}
const ingerimenti = (cf: { chiamate: ChiamataFinta[] }) => cf.chiamate.filter((x) => x.url.endsWith("events:ingest"));
const corpi = (cf: { chiamate: ChiamataFinta[] }) => ingerimenti(cf).map((x) => JSON.parse(x.corpo ?? "{}") as Corpo);
const pulito = (testo: string) => !RISERVATI.some((r) => testo.includes(r));
const provaDi = (r: RisultatoVerifica, id: string) => r.prove.find((p) => p.id === id);

async function main() {
  // ═════════════════════════ 1. Regole pure ═════════════════════════
  console.log("--- Regole pure: mascheramento, lettura degli errori, riepilogo ---");
  atteso("identificativi mascherati: solo le ultime tre cifre, nessuna cifra intera", mascheraId("1234567890") === "•••••••890" && mascheraId("123-456-7890") === "•••••••890" && mascheraId("987") === "987" && mascheraId("") === null && mascheraId(undefined) === null && !(mascheraId("1234567890") ?? "").includes("1234"));
  const g = leggiErroreGoogle({ error: { status: "INVALID_ARGUMENT", message: "mario@esempio.it non valido", details: [{ reason: "FIELD_INVALID", fieldViolations: [{ field: "events[0].adIdentifiers.gclid", description: "gclid TEST_ABC non valido" }, { field: "campo con spazi e email@x.it" }] }, { reason: "testo libero con spazi" }] } });
  atteso("dagli errori di Google si leggono solo il codice, i motivi in maiuscolo e i percorsi dei campi: niente messaggi liberi, niente valori", g.codice === "INVALID_ARGUMENT" && JSON.stringify(g.ragioni) === '["FIELD_INVALID"]' && JSON.stringify(g.campi) === '["events[0].adIdentifiers.gclid"]' && !JSON.stringify(g).includes("mario") && !JSON.stringify(g).includes("TEST_ABC"));
  atteso("corpi d'errore anomali (null, testo, codice minuscolo) non rompono nulla", leggiErroreGoogle(null).codice === "" && leggiErroreGoogle("boh").campi.length === 0 && leggiErroreGoogle({ error: { status: "invalid argument" } }).codice === "");
  const cl = classificaCampi(["destinations[0].productDestinationId", "destinations[0].operatingAccount.accountId", "events[0].adIdentifiers.gclid"]);
  atteso("i campi contestati si attribuiscono ad azione, account o resto della richiesta", cl.azione && cl.account && cl.altri && !classificaCampi(["events[0].userData"]).azione && !classificaCampi(["events[0].userData"]).account);

  const p = (id: ProvaVerifica["id"], extra: Partial<ProvaVerifica> = {}): ProvaVerifica => ({ id, titolo: id, atteso: "accettata", inviata: true, httpStato: 200, codiceGoogle: "", campi: [], ragioni: [], accettata: true, requestIdPresente: true, coerente: true, ...extra });
  const oauthOk = { riuscita: true, httpStato: 200, codice: "", scopeDataManager: true };
  const r1 = costruisciRiepilogo(oauthOk, [p("clic"), p("email", { atteso: "informativa" }), p("controllo_azione", { atteso: "rifiutata", accettata: false, httpStato: 400, codiceGoogle: "INVALID_ARGUMENT" }), p("controllo_account", { atteso: "rifiutata", accettata: false, httpStato: 403, codiceGoogle: "PERMISSION_DENIED" })]);
  atteso("riepilogo: validazione riuscita con controlli negativi rifiutati → account e azione RICONOSCIUTI, schema valido, nessuna conversione registrata", r1.autenticazione === "ok" && r1.permessi === "ok" && r1.account === "riconosciuto" && r1.azione === "riconosciuta" && r1.schema === "valido" && r1.conversioniRegistrate === "nessuna", JSON.stringify(r1));
  const r2 = costruisciRiepilogo(oauthOk, [p("clic"), p("controllo_azione", { atteso: "rifiutata" }), p("controllo_account", { atteso: "rifiutata" })]);
  atteso("riepilogo: se i controlli negativi vengono ACCETTATI, account e azione sono INCONCLUDENTI (la validazione non li controlla), mai «riconosciuti»", r2.account === "inconcludente" && r2.azione === "inconcludente" && r2.schema === "valido");
  const rifiuto = (httpStato: number | null, codiceGoogle: string) => ({ atteso: "rifiutata" as const, accettata: false, httpStato, codiceGoogle });
  const conControlli = (a: Partial<ProvaVerifica>, b: Partial<ProvaVerifica>) => costruisciRiepilogo(oauthOk, [p("clic"), p("controllo_azione", a), p("controllo_account", b)]);
  atteso("controlli negativi rifiutati con un errore di richiesta CHIARO (400/403/404 con INVALID_ARGUMENT, PERMISSION_DENIED, NOT_FOUND o FAILED_PRECONDITION) → riconosciuti", (["INVALID_ARGUMENT", "PERMISSION_DENIED", "NOT_FOUND", "FAILED_PRECONDITION"] as const).every((c) => { const x = conControlli(rifiuto(400, c), rifiuto(403, c)); return x.azione === "riconosciuta" && x.account === "riconosciuto"; }) && conControlli(rifiuto(404, "NOT_FOUND"), rifiuto(403, "PERMISSION_DENIED")).account === "riconosciuto");
  atteso("controlli negativi falliti per un motivo NON legato ad account o azione (rete caduta, quota 429, errore del server 500/503, credenziali 401) → INCONCLUDENTI, mai «riconosciuti»", [rifiuto(null, "RETE"), rifiuto(429, "RESOURCE_EXHAUSTED"), rifiuto(500, "INTERNAL"), rifiuto(503, "UNAVAILABLE"), rifiuto(401, "UNAUTHENTICATED"), rifiuto(400, ""), rifiuto(403, "HTTP_403")].every((f) => { const x = conControlli(f, f); return x.azione === "inconcludente" && x.account === "inconcludente"; }));
  atteso("un controllo rifiutato bene e l'altro no: ognuno ha il suo esito (azione riconosciuta, account inconcludente)", conControlli(rifiuto(400, "INVALID_ARGUMENT"), rifiuto(503, "UNAVAILABLE")).azione === "riconosciuta" && conControlli(rifiuto(400, "INVALID_ARGUMENT"), rifiuto(503, "UNAVAILABLE")).account === "inconcludente");
  atteso("se la richiesta vera è rifiutata SENZA che Google indichi il campo (es. PERMISSION_DENIED generico), account e azione sono INCONCLUDENTI e non «non riconosciuti»", (() => { const x = costruisciRiepilogo(oauthOk, [p("clic", { accettata: false, httpStato: 403, codiceGoogle: "PERMISSION_DENIED" })]); return x.account === "inconcludente" && x.azione === "inconcludente" && x.permessi === "negati"; })());
  atteso("se la richiesta vera è rifiutata per un campo che non riguarda account o azione (es. il clic), account e azione sono INCONCLUDENTI (la validazione si è fermata prima)", (() => { const x = costruisciRiepilogo(oauthOk, [p("clic", { accettata: false, httpStato: 400, codiceGoogle: "INVALID_ARGUMENT", campi: ["events[0].adIdentifiers.gclid"] })]); return x.account === "inconcludente" && x.azione === "inconcludente" && x.schema === "non_valido"; })());
  const r3 = costruisciRiepilogo({ riuscita: false, httpStato: 400, codice: "invalid_grant", scopeDataManager: null }, []);
  atteso("riepilogo: autenticazione fallita → nient'altro è provato", r3.autenticazione === "fallita" && r3.permessi === "non_verificabile" && r3.account === "non_provato" && r3.azione === "non_provata" && r3.schema === "non_provato");
  atteso("riepilogo: token senza l'ambito della Data Manager → permessi NEGATI", costruisciRiepilogo({ ...oauthOk, scopeDataManager: false }, [p("clic")]).permessi === "negati");
  atteso("riepilogo: un 401 o un 403 SENZA codice di Google (corpo vuoto) negano i permessi lo stesso; un 400 o un 500 no", costruisciRiepilogo(oauthOk, [p("clic", { accettata: false, httpStato: 401, codiceGoogle: "HTTP_401" })]).permessi === "negati" && costruisciRiepilogo(oauthOk, [p("clic", { accettata: false, httpStato: 403, codiceGoogle: "HTTP_403" })]).permessi === "negati" && costruisciRiepilogo(oauthOk, [p("clic", { accettata: false, httpStato: 500, codiceGoogle: "HTTP_500" })]).permessi === "ok");
  atteso("riepilogo: 401/403/PERMISSION_DENIED sulla richiesta vera → permessi negati", costruisciRiepilogo(oauthOk, [p("clic", { accettata: false, httpStato: 401, codiceGoogle: "UNAUTHENTICATED" })]).permessi === "negati" && costruisciRiepilogo(oauthOk, [p("clic", { accettata: false, httpStato: 403, codiceGoogle: "PERMISSION_DENIED" })]).permessi === "negati");

  // ═════════════════════════ 2. Verifica con un Google finto ═════════════════════════
  console.log("\n--- Verifica: il caso normale ---");
  {
    const cf = googleFinto();
    const { valore: r, log } = await conLog(() => verificaDataManager(ENV, cf.fetch, ADESSO));
    const testo = JSON.stringify(r);
    atteso("la verifica parte con credenziali e configurazione, ottiene il token e fa QUATTRO richieste di validazione e UNA lettura di stato", r.eseguita && r.oauth.riuscita && r.oauth.scopeDataManager === true && ingerimenti(cf).length === 4 && cf.chiamate.filter((x) => x.url.includes("requestStatus:retrieve")).length === 1, JSON.stringify([r.eseguita, ingerimenti(cf).length]));
    atteso("OGNI richiesta mandata a Google ha validateOnly = true", corpi(cf).length === 4 && corpi(cf).every((c) => c.validateOnly === true));
    atteso("riepilogo sui sei punti: OAuth ok, permessi ok, account riconosciuto, azione riconosciuta, schema valido, nessuna conversione registrata", JSON.stringify(r.riepilogo) === JSON.stringify({ autenticazione: "ok", permessi: "ok", account: "riconosciuto", azione: "riconosciuta", schema: "valido", conversioniRegistrate: "nessuna" }), JSON.stringify(r.riepilogo));
    atteso("la richiesta vera è accettata, i due controlli negativi (azione sbagliata, account sbagliato) sono RIFIUTATI da Google con i codici giusti", provaDi(r, "clic")?.accettata === true && provaDi(r, "controllo_azione")?.codiceGoogle === "INVALID_ARGUMENT" && JSON.stringify(provaDi(r, "controllo_azione")?.campi) === '["destinations[0].productDestinationId"]' && provaDi(r, "controllo_account")?.codiceGoogle === "PERMISSION_DENIED" && r.prove.every((x) => x.coerente));
    atteso("la prova «solo email» (senza clic) è riportata come informativa; usa solo l'email cifrata", provaDi(r, "email")?.atteso === "informativa" && provaDi(r, "email")?.accettata === true && corpi(cf)[1].events?.[0]?.adIdentifiers === undefined && !!corpi(cf)[1].events?.[0]?.userData);
    atteso("la richiesta vera usa l'account e l'azione della configurazione e un identificativo di clic INVENTATO e marcato; l'identificativo di transazione è marcato come verifica", corpi(cf)[0].destinations?.[0]?.operatingAccount?.accountId === "1234567890" && corpi(cf)[0].destinations?.[0]?.productDestinationId === "987654321" && JSON.stringify(corpi(cf)[0].events?.[0]?.adIdentifiers) === JSON.stringify({ gclid: ID_CLIC_SINTETICO }) && String(corpi(cf)[0].events?.[0]?.transactionId).startsWith("omnia-demo-verifica-"));
    atteso("requestStatus: si riporta com'è (qui «non trovata»: per una sola validazione è normale e non è un errore)", r.statoRichiesta?.httpStato === 404 && r.statoRichiesta?.esito === "NOT_FOUND");
    atteso("le richieste usano il token ottenuto in POST autenticato; lo stato in GET", ingerimenti(cf).every((x) => x.metodo === "POST" && x.intestazioni.authorization === "Bearer at-segreto-xyz") && cf.chiamate.filter((x) => x.url.includes("requestStatus")).every((x) => x.metodo === "GET"));
    atteso("l'ambiente è descritto con identificativi MASCHERATI (ultime tre cifre) e nessun valore segreto", r.ambiente.account === "•••••••890" && r.ambiente.azione === "••••••321" && r.ambiente.importazioneAccesa && r.ambiente.modalitaConfigurata === "solo_verifica" && r.ambiente.configurazioneCompleta && r.ambiente.credenzialiPresenti);
    atteso("NESSUN token, segreto, email, identificativo di clic, id di account/azione, id di richiesta o testo libero di Google compare nel risultato né nei log", pulito(testo) && pulito(log), `${RISERVATI.filter((x) => testo.includes(x) || log.includes(x)).join(", ")}`);
    atteso("le note distinguono validazione e attribuzione: la validazione non registra né attribuisce, e l'attribuzione vera richiede un gclid vero con l'invio reale", r.note.some((n) => /SOLA VALIDAZIONE/.test(n) && /Nessun lead reale/.test(n)) && r.note.some((n) => /NON è un'attribuzione pubblicitaria/.test(n) && /gclid/.test(n)));
  }

  console.log("\n--- Verifica: modalità reale e importazione spenta ---");
  {
    const cf = googleFinto();
    const r = await verificaDataManager({ ...ENV, DEMO_ADS_VALIDATE_ONLY: "0" }, cf.fetch, ADESSO);
    atteso("anche con DEMO_ADS_VALIDATE_ONLY=0 (importazione REALE accesa in produzione) la verifica manda SOLO validazioni, e lo segnala con un'avvertenza", corpi(cf).length === 4 && corpi(cf).every((c) => c.validateOnly === true) && r.ambiente.modalitaConfigurata === "reale" && r.note.some((n) => /ATTENZIONE/.test(n) && /REALE/.test(n)));
    const cf2 = googleFinto();
    const r2 = await verificaDataManager({ ...ENV, DEMO_ADS_IMPORT_ENABLED: undefined, DEMO_ADS_VALIDATE_ONLY: undefined }, cf2.fetch, ADESSO);
    atteso("con l'importazione spenta la verifica funziona lo stesso (indipendente dal cron) e lo dice; senza DEMO_ADS_VALIDATE_ONLY la modalità è «solo verifica»", r2.eseguita && !r2.ambiente.importazioneAccesa && r2.ambiente.modalitaConfigurata === "solo_verifica" && r2.note.some((n) => /DEMO_ADS_IMPORT_ENABLED non è «1»/.test(n)) && corpi(cf2).every((c) => c.validateOnly === true));
  }

  console.log("\n--- Verifica: quando qualcosa non va ---");
  {
    // la validazione di Google non controlla account e azione: accetta tutto
    const cf = googleFinto({ ingest: () => ({ status: 200, json: { requestId: "req-verifica-1" } }) });
    const r = await verificaDataManager(ENV, cf.fetch, ADESSO);
    atteso("se Google accetta ANCHE i controlli sbagliati, account e azione risultano INCONCLUDENTI e la nota dice che NON sono provati", r.riepilogo?.account === "inconcludente" && r.riepilogo?.azione === "inconcludente" && r.riepilogo?.schema === "valido" && r.note.some((n) => /INCONCLUDENTE/.test(n) && /NON è provato/.test(n) && /account/.test(n)) && r.note.some((n) => /INCONCLUDENTE/.test(n) && /NON è provato/.test(n) && /azione/.test(n)) && r.prove.filter((x) => x.atteso === "rifiutata").every((x) => !x.coerente));
    const cfServer = googleFinto({ ingest: (corpo) => (corpo.destinations?.[0]?.operatingAccount?.accountId !== "1234567890" ? { status: 503, json: { error: { code: 503, status: "UNAVAILABLE", message: "servizio non disponibile" } } } : corpo.destinations?.[0]?.productDestinationId !== "987654321" ? campiViolati("destinations[0].productDestinationId") : { status: 200, json: { requestId: "req-verifica-1" } }) });
    const rServer = await verificaDataManager(ENV, cfServer.fetch, ADESSO);
    atteso("se il controllo con l'account sbagliato fallisce per un errore del SERVER (503) e non per l'account, l'account è INCONCLUDENTE; l'azione, rifiutata bene, resta riconosciuta", rServer.riepilogo?.account === "inconcludente" && rServer.riepilogo?.azione === "riconosciuta" && rServer.note.some((n) => /INCONCLUDENTE sull'account/.test(n)));
  }
  {
    const cf = googleFinto({ token: () => ({ status: 400, json: { error: "invalid_grant", error_description: "Token has been expired or revoked per mario@esempio.it" } }) });
    const { valore: r, log } = await conLog(() => verificaDataManager(ENV, cf.fetch, ADESSO));
    atteso("autenticazione fallita (refresh token scaduto o revocato): nessuna richiesta a Google, motivo «oauth_fallita» con il solo codice, nessun testo libero", !r.eseguita && r.motivo === "oauth_fallita" && r.oauth.codice === "invalid_grant" && r.oauth.httpStato === 400 && ingerimenti(cf).length === 0 && r.riepilogo === null && pulito(JSON.stringify(r)) && !JSON.stringify(r).includes("mario") && !log.includes("mario"));
    const cfRete = fetchFinto(() => ({ status: 200 }));
    const rete = { ...cfRete, fetch: (async () => { throw new Error("rete caduta con at-segreto-xyz"); }) as unknown as typeof fetch };
    const rr = await conLog(() => verificaDataManager(ENV, rete.fetch, ADESSO));
    atteso("rete caduta già al token: nessuna eccezione, codice «RETE», niente nei log", !rr.valore.eseguita && rr.valore.oauth.codice === "RETE" && pulito(rr.log) && pulito(JSON.stringify(rr.valore)));
    const cfScope = googleFinto({ token: () => ({ status: 200, json: { access_token: "at-segreto-xyz", scope: "https://www.googleapis.com/auth/calendar.readonly" } }) });
    const rs = await verificaDataManager(ENV, cfScope.fetch, ADESSO);
    atteso("token senza l'ambito della Data Manager: lo si vede (oauth.scopeDataManager false) e i permessi risultano negati", rs.oauth.scopeDataManager === false && rs.riepilogo?.permessi === "negati");
  }
  {
    const cfAz = googleFinto({ ingest: (corpo) => (corpo.destinations?.[0]?.productDestinationId === "987654321" ? campiViolati("destinations[0].productDestinationId") : campiViolati("destinations[0].productDestinationId")) });
    const r = await verificaDataManager(ENV, cfAz.fetch, ADESSO);
    atteso("azione di conversione che Google non riconosce: azione «NON riconosciuta», schema NON dichiarato valido né non valido (si dice solo che non è provato)", r.riepilogo?.azione === "non_riconosciuta" && r.riepilogo?.schema === "non_provato" && !r.prove[0].accettata && pulito(JSON.stringify(r)));
    const cfAc = googleFinto({ ingest: () => ({ status: 403, json: { error: { code: 403, status: "PERMISSION_DENIED", message: "User does not have access to account 0000000001" } } }) });
    const r2 = await verificaDataManager(ENV, cfAc.fetch, ADESSO);
    atteso("account che Google non lascia usare (PERMISSION_DENIED senza indicare il campo): permessi NEGATI e account INCONCLUDENTE (non si afferma «non riconosciuto» senza una risposta chiara)", r2.riepilogo?.permessi === "negati" && r2.riepilogo?.account === "inconcludente");
    const cfAcc = googleFinto({ ingest: () => campiViolati("destinations[0].operatingAccount.accountId") });
    const r2b = await verificaDataManager(ENV, cfAcc.fetch, ADESSO);
    atteso("se Google indica esso stesso il campo dell'account che non torna, l'account è «NON riconosciuto»", r2b.riepilogo?.account === "non_riconosciuto" && r2b.riepilogo?.azione === "inconcludente");
    const cfSc = googleFinto({ ingest: (corpo, n) => (n === 0 ? campiViolati("events[0].adIdentifiers.gclid") : { status: 200, json: { requestId: "x" } }) });
    const r3 = await verificaDataManager(ENV, cfSc.fetch, ADESSO);
    atteso("richiesta con un campo non valido (es. l'identificativo di clic): schema «NON valido» e il campo contestato è riportato", r3.riepilogo?.schema === "non_valido" && JSON.stringify(provaDi(r3, "clic")?.campi) === '["events[0].adIdentifiers.gclid"]');
    const cfNet = googleFinto({ ingest: () => ({ status: 500, json: null }) });
    const r4 = await verificaDataManager(ENV, ((u: RequestInfo | URL, i?: RequestInit) => (String(u).includes("events:ingest") ? Promise.reject(new Error("rete")) : cfNet.fetch(u, i))) as typeof fetch, ADESSO);
    atteso("rete caduta durante le richieste: codice «RETE» su ogni prova, nessuna eccezione, nessuna lettura di stato", r4.eseguita && r4.prove.every((x) => x.codiceGoogle === "RETE" && x.httpStato === null) && r4.statoRichiesta === null);
  }
  {
    const cf = googleFinto();
    const senzaAzione = await verificaDataManager({ ...ENV, GOOGLE_ADS_DEMO_CONVERSION_ACTION_ID: undefined }, cf.fetch, ADESSO);
    const senzaCredenziali = await verificaDataManager({ ...ENV, GOOGLE_ADS_REFRESH_TOKEN: undefined }, cf.fetch, ADESSO);
    const senzaAccount = await verificaDataManager({ ...ENV, GOOGLE_ADS_CUSTOMER_ID: undefined }, cf.fetch, ADESSO);
    atteso("configurazione incompleta (senza azione o account) o credenziali mancanti: non parte, nessuna chiamata di rete, motivo chiaro", !senzaAzione.eseguita && senzaAzione.motivo === "configurazione_incompleta" && !senzaAccount.eseguita && senzaAccount.motivo === "configurazione_incompleta" && !senzaCredenziali.eseguita && senzaCredenziali.motivo === "credenziali_mancanti" && cf.chiamate.length === 0);
  }

  // ═════════════════════════ 3. Codice ═════════════════════════
  console.log("\n--- Codice: nessun database, nessuna scrittura, solo l'admin ---");
  const lib = leggi("src/lib/demo-ads-verifica.ts");
  const calc = leggi("src/lib/demo-ads-verifica-calcoli.ts");
  const azione = leggi("src/app/site-console/azioni/demo-ads.ts");
  const comp = leggi("src/app/site-console/_componenti/verifica-data-manager.tsx");
  const cli = leggi("scripts/verifica-data-manager.ts");
  atteso("la verifica NON usa il database: nessun client Supabase, nessuna tabella, né nella libreria né nell'azione né nello script", ![lib, calc, azione, comp, cli].some((t) => /supabase|createAdminClient|\.from\(["'`]|demo_leads|demo_contatti|demo_consensi|demo_prenotazioni/.test(t)));
  atteso("c'è UN solo punto da cui si manda una richiesta a Google e RIFIUTA ciò che non è validateOnly = true", (lib.match(/URL_DATA_MANAGER_INGEST/g) ?? []).length === 2 && /async function inviaValidazione\([\s\S]*?\n  if \(richiesta\.validateOnly !== true\) throw new Error/.test(lib) && !/validateOnly:\s*false/.test(lib + calc + azione + cli));
  atteso("la configurazione per la verifica forza la sola validazione (soloVerifica: true), qualunque sia l'ambiente", /const reale: ConfigurazioneAds = \{ \.\.\.configurazione, soloVerifica: true \};/.test(lib) && !/DEMO_ADS_VALIDATE_ONLY[^;]*soloVerifica/.test(lib.replace(/modalitaConfigurata:[^\n]*\n/, "")));
  atteso("i dati sono INVENTATI: email del dominio «.invalid», identificativo di clic marcato TEST_, nessun lead letto", /@omnia-ai\.invalid/.test(lib) && /ID_CLIC_SINTETICO = "TEST_/.test(lib));
  atteso("nessun console.* nella libreria né nell'azione (nessun log che possa contenere dati)", !/console\./.test(lib + calc + azione));
  atteso("la libreria non restituisce mai il token: il token resta dentro la funzione e non compare in nessun oggetto restituito", !/token:\s*t\.token|oauth\s*=\s*\{[^}]*token:/.test(lib) && /const oauth = \{ riuscita: t\.token !== null, httpStato: t\.httpStato, codice: t\.codice, scopeDataManager: t\.scopeDataManager \};/.test(lib));
  atteso("l'azione della console controlla l'admin come PRIMA operazione (lato server) e SOLO DOPO le protezioni contro le esecuzioni ripetute: una alla volta, un minuto di pausa, dieci all'ora; la verifica parte per ultima e il blocco si rilascia sempre", /^"use server";/.test(azione) && azione.indexOf("await richiediAdminAzione()") > 0 && azione.indexOf("await richiediAdminAzione()") < azione.indexOf("if (inEsecuzione)") && azione.indexOf("if (inEsecuzione)") < azione.indexOf("await verificaDataManager(") && /if \(inEsecuzione\) return \{ ok: false, errore: "Una verifica è già in corso/.test(azione) && /const PAUSA_MINIMA_MS = 60_000;/.test(azione) && /if \(adesso - ultimaEsecuzioneMs < PAUSA_MINIMA_MS\) return \{ ok: false, errore: "Attendi un minuto/.test(azione) && /const MASSIMO_ALL_ORA = 10;/.test(azione) && /if \(esecuzioniRecenti\.length >= MASSIMO_ALL_ORA\) return \{ ok: false, errore: "Troppe verifiche/.test(azione) && /inEsecuzione = true;\s*ultimaEsecuzioneMs = adesso;\s*esecuzioniRecenti\.push\(adesso\);/.test(azione) && /\} finally \{\s*inEsecuzione = false;\s*\}/.test(azione) && /catch \{\s*\/\/[^\n]*\n\s*return \{ ok: false, errore: "La verifica non è riuscita \(errore imprevisto\)\." \};/.test(azione));
  atteso("il pulsante sta nella pagina DEMO della console (solo admin), con la spiegazione che non registra conversioni", /<VerificaDataManager \/>/.test(leggi("src/app/site-console/_componenti/demo-vista.tsx")) && /sola validazione/.test(comp) && /senza registrare nessuna conversione/.test(comp) && /INCONCLUDENTE/.test(comp) && /disabled=\{inCorso \|\| inPausa\}/.test(comp) && /setTimeout\(\(\) => setInPausa\(false\), 60_000\)/.test(comp));
  atteso("lo script locale usa la stessa funzione, non stampa mai valori dell'ambiente e funziona con --env-file", /verificaDataManager\(process\.env\)/.test(cli) && !/console\.log\([^)]*process\.env\.[A-Z]/.test(cli) && /--env-file=\.env\.local/.test(cli));
  atteso("nessun file del tracciamento esistente è stato toccato (modulo, azione della richiesta, cron, GA4, sincronizzazione, banner)", ["src/components/omnia-ai/demo-form.tsx", "src/app/actions/omnia-ai-demo.ts", "src/lib/demo-calendario-sync.ts", "src/lib/demo-ga4.ts", "src/lib/demo-ads-data-manager.ts", "src/components/omnia-ai/cookie-consent.tsx", "src/app/api/cron/omnia-ai-demo-sync/route.ts"].every((f) => !/demo-ads-verifica|verificaDataManager/.test(leggi(f))));
  atteso("il test è nella catena verifica:livello1", /tsx scripts\/verifica-data-manager-demo\.ts/.test(leggi("package.json")));
  atteso("la guida descrive la verifica e come leggerne l'esito (validazione ≠ attribuzione)", /Verifica della Data Manager/i.test(leggi("GUIDA-DEMO-TRACCIAMENTO.md")) && /validazione/i.test(leggi("GUIDA-DEMO-TRACCIAMENTO.md")) && /attribuzione/i.test(leggi("GUIDA-DEMO-TRACCIAMENTO.md")));

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
