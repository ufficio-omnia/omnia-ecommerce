// Verifica del connettore TuttoGare (Fase 2, seconda priorità del documento 60): un adattatore per molte istanze «TuttoGare PA», canale home
// HTML + dettaglio (JSON interno predisposto e spento), mappa dei campi CONFERMATA sul campione del 26/11 (schede della home con il badge
// della procedura, etichette «Importo base», «Pubblicazione», «Scadenza presentazione», impronta StudioAmica), fonte «tuttogare» in console,
// cron e programmatore e nel registro dei giri (0135); in produzione solo con RADAR_TUTTOGARE_PRODUZIONE (decisione dell'utente del 26/11). Tutti i dati sono [SINTETICI] (pagine HTML
// inventate con la forma confermata, enti e CIG di prova: «Comune di Provasintetica»); nessuna rete (fetch vietato), database in memoria.
// Uso: npx tsx scripts/verifica-radar-tuttogare.ts → codice 0 se passa.
import fs from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CANALE_TUTTOGARE,
  ETICHETTE_TUTTOGARE,
  aggiornaCursoreTuttoGare,
  affidamentoNellaRiga,
  cigTuttoGare,
  cpvDaCategoriaTuttoGare,
  cpvTuttoGare,
  cursoreTuttoGare,
  dettaglioCompleto,
  dettaglioDaLeggere,
  enteTuttoGare,
  importoTuttoGare,
  istanzeAttiveTuttoGare,
  leggiDettaglioTuttoGare,
  leggiGaraTuttoGare,
  leggiHomeTuttoGare,
  leggiTabellaTuttoGare,
  opportunitaTuttoGare,
  percorsoAmmessoTuttoGare,
  scadenzaTuttoGare,
  sembraPaginaTuttoGare,
  urlDettaglioTuttoGare,
  urlHomeTuttoGare,
  urlTabellaTuttoGare,
  type BandoTuttoGare,
  type EsclusioneTuttoGare,
} from "../src/lib/radar/fonti/tuttogare-calcoli";
import { ISTANZE_CANDIDATE_TUTTOGARE, ISTANZE_TUTTOGARE, idTuttoGareDaUrl, istanzaDaHost, type IstanzaTuttoGare } from "../src/lib/radar/fonti/tuttogare-istanze";
import { LettoreTuttoGare } from "../src/lib/radar/fonti/tuttogare";
import { SessioneFonte, ErroreFonte } from "../src/lib/radar/fonti/sessione-fonte";
import { idPiattaformaDaUrl, idPiattaformaDaUrlConnettore } from "../src/lib/radar/fonti/piattaforme-calcoli";
import { FONTI_RADAR, VARIABILI_PRODUZIONE, fonteAutorizzata } from "../src/lib/radar/ambiente";
import { FONTI_REGIONALI, bandoDaTuttoGare, rigaDaBandoRegionale } from "../src/lib/radar/importa-regionali-calcoli";
import { FONTI_ESECUZIONI, FONTI_REGISTRO } from "../src/lib/radar/esecuzioni-calcoli";
import { FONTI_ACCENDIBILI } from "./c8/accendi-regionale-staging";
import { CRON_PROPOSTI, INTERRUTTORI_CRON, ORARI_GIRI, ROTTE_CRON } from "../src/lib/radar/programmazione-calcoli";
import { FONTI_UNITE, PRECEDENZA_FONTI } from "../src/lib/radar/unione-calcoli";
import { ATTRIBUZIONE_FONTE, FONTI_NASCOSTE_PREDEFINITE, NOME_FONTE, NOME_FONTE_ESTESO, descriviAvvisoLetto } from "../src/lib/radar/fonti-gara-calcoli";
import { descrizioneFonte } from "../src/lib/radar/fonti/tipi";
import { eseguiImportazioneRegionale } from "../src/lib/radar/importa-regionali";
import { DbFinto } from "./lib/db-finto-motore";

let ok = 0;
const falliti: string[] = [];
function controlla(nome: string, condizione: boolean, dettaglio?: unknown): void {
  if (condizione) ok++;
  else falliti.push(`${nome}${dettaglio === undefined ? "" : ` → ${JSON.stringify(dettaglio).slice(0, 600)}`}`);
}
let richiesteDiRete = 0;
globalThis.fetch = (async () => {
  richiesteDiRete++;
  throw new Error("rete vietata nella verifica");
}) as typeof fetch;

const radice = path.join(__dirname, "..");
const leggi = (f: string) => fs.readFileSync(path.join(radice, f), "utf8");
const STAGING = { NEXT_PUBLIC_SUPABASE_URL: "https://ryawdldqiumqsskrnyps.supabase.co" };
const PROD_DEPLOY = { NEXT_PUBLIC_SUPABASE_URL: "https://bihfrzspqxsrzlbqqvqa.supabase.co", VERCEL_ENV: "production" };
const ADESSO = new Date("2026-11-26T10:00:00Z");
const OGGI = "2026-11-26";
const ROMA = istanzaDaHost("appalti.comune.roma.it") as IstanzaTuttoGare;
const SICILIA = istanzaDaHost("appalti.regionesiciliana.lavoripubblici.sicilia.it") as IstanzaTuttoGare;
const UNIBA = istanzaDaHost("gareappalti.uniba.it") as IstanzaTuttoGare;

// ───── pagine [SINTETICHE] con la forma CONFERMATA sul campione del 26/11: home con le schede Bootstrap delle gare (due collegamenti al
// dettaglio, badge della procedura e della tipologia, scadenza), dettaglio con coppie etichetta-valore; impronta «StudioAmica» (Roma è
// un'istanza personalizzata: nessun collegamento ad app.tuttogare.it) ─────
const pagina = (corpo: string) => `<!DOCTYPE html><html lang="it"><head><title>Gare (prova sintetica)</title><link rel="preload" href="/font/StudioAmica.woff2" as="font"><script>var codice=999;</script></head><body><header>Menu · Gare · Oggetto</header>${corpo}<footer>Comune sintetico</footer></body></html>`;
const scheda = (codice: number, oggetto: string, procedura: string, tipologia: string, extra = "", href = `/gare/dettaglio.php?codice=${codice}`) =>
  `<div class="col-md-6"><div class="card h-100"><div class="card-body"><span class="badge badge-primary">${procedura}</span> <span class="badge badge-info">${tipologia}</span>` +
  `<h5 class="card-title"><a href="${href}">${oggetto}</a></h5><p class="card-text">Gara #${codice + 9000} · Scadenza: 15/12/2026 12:00</p>${extra}` +
  `<a class="btn btn-sm" href="/gare/dettaglio.php?codice=${codice}">Vedi dettagli</a></div></div></div>`;
const HOME_ROMA = pagina(
  `<div class="row">` +
    scheda(101, "Servizio di pulizia degli uffici comunali (prova sintetica)", "Aperta", "Servizi") +
    scheda(102, "Servizio di portierato presso le sedi comunali (prova sintetica)", "Affidamento con indagine di mercato", "Servizi", "", "https://appalti.comune.roma.it/gare/dettaglio.php?codice=102") +
    scheda(103, "Fornitura di cancelleria (prova sintetica)", "Affidamento diretto / RDO", "Forniture", "", "/gare/dettaglio.php?codice=103&amp;lang=it") +
    scheda(104, "Servizio di vigilanza (prova sintetica)", "Affidamento diretto / RDO", "Servizi") +
    scheda(105, "Lavori di rifacimento del manto stradale (prova sintetica)", "Aperta", "Lavori", `<a href="/documenti/bando-105.pdf">Bando</a>`) +
    `<div class="col-md-6"><div class="card"><a href="https://altro.esempio.invalid/gare/dettaglio.php?codice=777">Altra piattaforma</a></div></div>` +
    `</div>`,
);
const HOME_VUOTA = pagina(`<div class="row"><p>Nessuna gara pubblicata</p></div>`);
const dettaglio = (campi: Record<string, string>, coda = "") =>
  pagina(
    `<h1>Gara (prova sintetica)</h1><table class="dettaglio">${Object.entries(campi)
      .map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`)
      .join("")}</table><div class="referente">Responsabile del procedimento: Persona Sintetica, rup@esempio.invalid, 06 000000</div>${coda}`,
  );
const E = ETICHETTE_TUTTOGARE;
const DETTAGLI_ROMA: Record<number, string> = {
  101: dettaglio({
    [E.oggetto]: "Servizio di pulizia degli uffici comunali (prova sintetica)",
    [E.procedura]: "Procedura aperta",
    [E.tipologia]: "Servizi",
    [E.importo]: "€ 120.000,00",
    // il CIG è il testo di un collegamento ai dati di ANAC (campione del 26/11); due CIG per difesa (più lotti non visti sul campione)
    [E.cig]: `<a href="https://dati.anticorruzione.it/superset/dashboard/dettaglio_cig/?cig=B11111111A">B11111111A</a><br><a href="https://dati.anticorruzione.it/superset/dashboard/dettaglio_cig/?cig=B22222222B">B22222222B</a>`,
    [E.cup]: "J11J26000000001",
    [E.pubblicazione]: "20/11/2026",
    [E.scadenza]: "15/12/2026 12:00",
    [E.categorie]: "<ul><li>90910000 - Servizi di pulizia</li><li>90911200 - Servizi di pulizia di edifici</li></ul>",
    [E.beneficiario]: "Roma Capitale – Dipartimento sintetico",
  }),
  102: pagina(
    `<p><strong>${E.oggetto}:</strong> Servizio di portierato presso le sedi comunali (prova sintetica)</p><p><strong>${E.procedura}:</strong> Affidamento con indagine di mercato</p><p><strong>${E.scadenza}:</strong> 10/12/2026 23:45</p><p><strong>${E.pubblicazione}:</strong> 25/11/2026</p>`,
  ),
  105: dettaglio({ [E.oggetto]: "Lavori di rifacimento del manto stradale (prova sintetica)", [E.procedura]: "Procedura aperta", [E.tipologia]: "Lavori", [E.scadenza]: "15/12/2026 12:00", [E.cig]: "B55555555E" }),
};

// ═════ A. anagrafica e identità ═════
function provaAnagrafica(): void {
  const attive = istanzeAttiveTuttoGare();
  controlla("pilota: 5 istanze attive (Roma, Uniba, Regione Siciliana da R4; due centrali di committenza da D3), host unici e minuscoli", attive.length === 5 && new Set(attive.map((i) => i.host)).size === 5 && attive.every((i) => i.host === i.host.toLowerCase()) && attive.filter((i) => i.scoperta === "R4").length === 3, attive.map((i) => i.host));
  controlla("anagrafica: NESSUN codice fiscale scritto (vengono dall'IPA o dal CIG via PVL, mai indovinati) e mappe dei beneficiari vuote finché il campione non le conferma", ISTANZE_TUTTOGARE.every((i) => i.ente.codiceFiscale === null && Object.keys(i.beneficiari).length === 0));
  // CUC Castelli della Sapienza: Lazio, confermato dal collaudo del 26/11 (verbale 60G: gare unite di Castel Gandolfo e Marcellina)
  controlla("anagrafica: Roma e Uniba enti singoli, le centrali a più enti; regioni (Castelli della Sapienza nel Lazio dal collaudo del 26/11)", !ROMA.multiEnte && !UNIBA.multiEnte && SICILIA.multiEnte && ROMA.regione === "lazio" && UNIBA.regione === "puglia" && SICILIA.regione === "sicilia" && istanzaDaHost("cuccastellidellasapienza.tuttogare.it")?.regione === "lazio" && istanzaDaHost("cucterradileuca.tuttogare.it")?.regione === "puglia");
  controlla("le altre istanze di D3 sono candidate, fuori dal pilota", ISTANZE_CANDIDATE_TUTTOGARE.length === 5 && ISTANZE_CANDIDATE_TUTTOGARE.every((h) => istanzaDaHost(h) === null));
  controlla("tetti per istanza tra 2 e 12 richieste (home compresa)", ISTANZE_TUTTOGARE.every((i) => i.richiesteMassime >= 2 && i.richiesteMassime <= 12));
  const casi: [string, string | null][] = [
    ["https://appalti.comune.roma.it/gare/dettaglio.php?codice=4321", "tuttogare:appalti.comune.roma.it:4321"],
    ["https://romacapitale.tuttogare.it/gare/dettaglio.php?codice=4321", "tuttogare:appalti.comune.roma.it:4321"],
    ["https://APPALTI.COMUNE.ROMA.IT/gare/dettaglio.php?lang=it&amp;codice=12", "tuttogare:appalti.comune.roma.it:12"],
    ["https://cucterradileuca.tuttogare.it/gare/dettaglio.php?codice=7", "tuttogare:cucterradileuca.tuttogare.it:7"],
    ["https://atmspa.tuttogare.it/gare/dettaglio.php?codice=7", null],
    ["https://appalti.comune.roma.it/gare/dettaglio.php?codice=7&codice=8", null],
    ["https://appalti.comune.roma.it/gare/dettaglio.php?codice=abc", null],
    ["https://appalti.comune.roma.it/documenti/dettaglio.php?codice=7", null],
    ["https://appalti.comune.roma.it.esempio.invalid/gare/dettaglio.php?codice=7", null],
    ["ftp://appalti.comune.roma.it/gare/dettaglio.php?codice=7", null],
  ];
  const sbagliati = casi.filter(([u, atteso]) => idTuttoGareDaUrl(u) !== atteso);
  controlla("identità «tuttogare:<host canonico>:<codice dell'URL>»: alias, maiuscole, &amp; e altri parametri; null per host fuori anagrafica, codice doppio o non numerico, altro percorso, host simile", sbagliati.length === 0, sbagliati);
  controlla("riconoscimento SOLO nei connettori (come SATER): gli importatori di TED e PVL non lo usano; SATER e SardegnaCAT invariati", idPiattaformaDaUrlConnettore(casi[0][0]) === casi[0][1] && idPiattaformaDaUrl(casi[0][0]) === null && idPiattaformaDaUrlConnettore("https://intercenter.regione.emilia-romagna.it/trovabando/BANDO_GARA_PORTALE@17652665") === "sater:17652665" && idPiattaformaDaUrl("https://sardegnacat.regione.sardegna.it/Application/CustomDoc/DettaglioProcedura.asp?ID=1031830") === "sardegnacat:1031830");
}

// ═════ B. indirizzi: solo home e dettaglio (robots.txt), JSON interno spento ═════
function provaIndirizzi(): void {
  const ammessi = [urlHomeTuttoGare(ROMA), urlDettaglioTuttoGare(ROMA, "101") as string];
  const vietati = [
    "https://appalti.comune.roma.it/documenti/bando.pdf",
    "https://appalti.comune.roma.it/allegati/x.zip",
    "https://appalti.comune.roma.it/gare/table.php",
    "https://appalti.comune.roma.it/gare/dettaglio.php?codice=101&download=1",
    "https://appalti.comune.roma.it/gare/../documenti/x",
    "http://appalti.comune.roma.it/",
    "https://romacapitale.tuttogare.it/",
    "https://appalti.comune.roma.it:8443/",
    "https://appalti.comune.roma.it/?q=1",
    "https://appalti.comune.roma.it/robots.txt",
  ];
  controlla("indirizzi ammessi: home e dettaglio dell'host canonico, in https", ammessi.every((u) => percorsoAmmessoTuttoGare(u, ROMA)), ammessi);
  controlla("indirizzi vietati: documenti e allegati (robots.txt), JSON interno spento, parametri in più, http, alias, porta, altri percorsi", vietati.every((u) => !percorsoAmmessoTuttoGare(u, ROMA)), vietati.filter((u) => percorsoAmmessoTuttoGare(u, ROMA)));
  controlla("JSON interno: spento e senza indirizzo; canale «html»; mappa CONFERMATA sul campione del 26/11", !CANALE_TUTTOGARE.jsonInterno.acceso && urlTabellaTuttoGare(ROMA) === null && CANALE_TUTTOGARE.canale === "html" && CANALE_TUTTOGARE.confermato === true);
  controlla("impronta del software: StudioAmica sì (anche senza app.tuttogare.it, come Roma); app.tuttogare.it da solo NO; pagina qualsiasi o testo non HTML no", sembraPaginaTuttoGare(HOME_ROMA) && !/app\.tuttogare/.test(HOME_ROMA) && sembraPaginaTuttoGare("<html><body>font StudioAmica.woff2</body></html>") && !sembraPaginaTuttoGare('<html><body><a href="https://app.tuttogare.it">TuttoGare</a></body></html>') && !sembraPaginaTuttoGare("<html><body>Verifica di sicurezza</body></html>") && !sembraPaginaTuttoGare('{"data":[]}'));
}

// ═════ C. home ═════
function provaHome(): void {
  const righe = leggiHomeTuttoGare(HOME_ROMA, ROMA);
  controlla("home: i 5 codici delle gare nell'ordine della pagina (un codice una volta, anche con due collegamenti; mai altre piattaforme, documenti o script)", JSON.stringify(righe.map((r) => r.codice)) === JSON.stringify(["101", "102", "103", "104", "105"]), righe.map((r) => r.codice));
  controlla("home: la riga è la SCHEDA della gara (oggetto, badge, scadenza), non la testata né la scheda accanto", /pulizia/.test(righe[0]?.testo ?? "") && /15\/12\/2026 12:00/.test(righe[0]?.testo ?? "") && !/Menu/.test(righe[0]?.testo ?? "") && !/portierato/.test(righe[0]?.testo ?? ""), righe[0]);
  controlla("home: dalla scheda l'oggetto (titolo, non «Vedi dettagli»), il badge della procedura e quello della tipologia", righe[0]?.oggetto === "Servizio di pulizia degli uffici comunali (prova sintetica)" && righe[0]?.procedura === "Aperta" && righe[0]?.tipologia === "Servizi" && righe[2]?.procedura === "Affidamento diretto / RDO" && righe[1]?.procedura === "Affidamento con indagine di mercato", righe.map((r) => [r.oggetto, r.procedura, r.tipologia]));
  controlla("home: esclusi senza dettaglio SOLO gli affidamenti dal badge della procedura («Affidamento diretto / RDO»); un affidamento il cui oggetto dichiara una candidatura si legge; senza badge decide il dettaglio", JSON.stringify(righe.map((r) => affidamentoNellaRiga(r))) === JSON.stringify([false, false, true, true, false]) && !affidamentoNellaRiga({ procedura: "Affidamento diretto / RDO", oggetto: "Indagine di mercato per il servizio di vigilanza" }) && !affidamentoNellaRiga({ procedura: null, oggetto: "Affidamento diretto di cancelleria" }));
  controlla("home vuota: nessuna riga", leggiHomeTuttoGare(HOME_VUOTA, ROMA).length === 0);
  const aBlocchi = pagina(`<div class="gara"><h3><a href="/gare/dettaglio.php?codice=201">Pulizia A (prova sintetica)</a></h3><p>Scadenza 01/12/2026</p></div><div class="gara"><h3><a href="/gare/dettaglio.php?codice=202">Pulizia B (prova sintetica)</a></h3></div>`);
  const rb = leggiHomeTuttoGare(aBlocchi, ROMA);
  controlla("difesa, home senza schede: il blocco della gara (nessuna riga confusa con la gara accanto), senza badge", rb.length === 2 && /Pulizia A/.test(rb[0].testo) && !/Pulizia B/.test(rb[0].testo) && /Pulizia B/.test(rb[1].testo) && !/Pulizia A/.test(rb[1].testo) && rb[0].procedura === null, rb);
  const aTabella = pagina(`<table><tr><td><a href="/gare/dettaglio.php?codice=301">Pulizia C (prova sintetica)</a></td></tr><tr><td><a href="/gare/dettaglio.php?codice=302">Pulizia D (prova sintetica)</a></td></tr></table>`);
  const rt = leggiHomeTuttoGare(aTabella, ROMA);
  controlla("difesa, home a tabella: una riga per gara", rt.length === 2 && /Pulizia C/.test(rt[0].testo) && !/Pulizia D/.test(rt[0].testo), rt);
  const json = leggiTabellaTuttoGare(JSON.stringify({ recordsTotal: 2, data: [["Pubblicato", "#9101", "B11111111A", '<a href="/gare/dettaglio.php?codice=101">Pulizia (prova sintetica)</a>'], { stato: "Pubblicato", link: '<a href="/gare/dettaglio.php?codice=102">Portierato</a>' }] }), ROMA);
  controlla("JSON interno (predisposto, spento): stessa forma di righe della home; formato inatteso → errore", "righe" in json && json.righe.map((r) => r.codice).join() === "101,102" && json.totale === 2 && "errore" in leggiTabellaTuttoGare("<html>", ROMA) && "errore" in leggiTabellaTuttoGare('{"rows":[]}', ROMA), json);
}

// ═════ D. dettaglio e campi ═════
function provaDettaglio(): void {
  const d = leggiDettaglioTuttoGare(DETTAGLI_ROMA[101]);
  controlla("etichette confermate sul campione: «Importo base», «Pubblicazione», «Scadenza presentazione»; nessun campo «Stato» (non esiste nell'HTML)", E.importo === "Importo base" && E.pubblicazione === "Pubblicazione" && E.scadenza === "Scadenza presentazione" && !("stato" in ETICHETTE_TUTTOGARE));
  controlla("dettaglio: i campi dalle etichette, il valore fino all'etichetta seguente; CIG dal testo del collegamento ad ANAC (mai l'indirizzo)", d.oggetto === "Servizio di pulizia degli uffici comunali (prova sintetica)" && d.procedura === "Procedura aperta" && d.scadenza === "15/12/2026 12:00" && d.pubblicazione === "20/11/2026" && d.importo === "€ 120.000,00" && d.cig === "B11111111A | B22222222B" && /^90910000 - Servizi di pulizia/.test(d.categorie ?? "") && !JSON.stringify(d).includes("anticorruzione"), d);
  controlla("dettaglio: nessun campo fuori dalla mappa (referenti, email, telefoni scartati)", !JSON.stringify(d).includes("esempio.invalid") && !JSON.stringify(d).includes("Persona Sintetica") && Object.keys(d).every((k) => k in ETICHETTE_TUTTOGARE), d);
  const d2 = leggiDettaglioTuttoGare(DETTAGLI_ROMA[102]);
  controlla("dettaglio: anche «Etichetta: valore» nella stessa riga; ora reale della scadenza (23:45)", d2.oggetto === "Servizio di portierato presso le sedi comunali (prova sintetica)" && d2.procedura === "Affidamento con indagine di mercato" && d2.scadenza === "10/12/2026 23:45" && d2.pubblicazione === "25/11/2026" && scadenzaTuttoGare(d2.scadenza)?.iso === "2026-12-10T22:45:00.000Z", d2);
  controlla("dettaglio completo solo con oggetto e procedura (i campi obbligatori dichiarati)", dettaglioCompleto(d) && dettaglioCompleto(d2) && !dettaglioCompleto(leggiDettaglioTuttoGare(pagina("<p>Pagina senza etichette</p>"))));
  const s = scadenzaTuttoGare("15/12/2026 12:00");
  controlla("scadenza con l'ora italiana (inverno: 11:00 UTC), anche «ore 12.00» e data e ora in due celle", s?.iso === "2026-12-15T11:00:00.000Z" && s.oraIndicata && scadenzaTuttoGare("10/12/2026 ore 12.00")?.iso === "2026-12-10T11:00:00.000Z" && scadenzaTuttoGare("10/12/2026 | 12:00")?.iso === "2026-12-10T11:00:00.000Z" && scadenzaTuttoGare("1/7/2027 10:30")?.iso === "2027-07-01T08:30:00.000Z", s);
  controlla("scadenza senza ora o a mezzanotte: solo il giorno (l'ora non si presume mai); date impossibili o altre forme → null", scadenzaTuttoGare("15/12/2026")?.iso === null && scadenzaTuttoGare("15/12/2026 00:00")?.oraIndicata === false && scadenzaTuttoGare("31/02/2026") === null && scadenzaTuttoGare("2026-12-15") === null && scadenzaTuttoGare("15/12/2026 25:00") === null);
  controlla("importo: «€»/«euro» o con i decimali (campione: «€ 69.600,00», «€ 4.176.978,42»); un numero qualunque no", importoTuttoGare("€ 69.600,00") === 69600 && importoTuttoGare("€ 4.176.978,42") === 4176978.42 && importoTuttoGare("€ 120.000,00") === 120000 && importoTuttoGare("Euro 35.000") === 35000 && importoTuttoGare("Lotto 1: 48.500,50 oltre IVA") === 48500.5 && importoTuttoGare("Lotto 1") === null && importoTuttoGare("") === null);
  controlla("CIG: uno per lotto, validi, senza doppioni", JSON.stringify(cigTuttoGare("B11111111A | B22222222B, B11111111A; AAAAAAAAAA")) === JSON.stringify(["B11111111A", "B22222222B"]));
  controlla("categorie → CPV: «8 cifre - descrizione» come sul campione («45233142 - Lavori di riparazione stradale»); per difesa la cifra di controllo e i codici troncati; senza codice niente", cpvDaCategoriaTuttoGare("45233142 - Lavori di riparazione stradale") === "45233142" && cpvDaCategoriaTuttoGare("90910000-9 - Servizi di pulizia") === "90910000" && cpvDaCategoriaTuttoGare("9091 - Pulizia") === "90910000" && cpvDaCategoriaTuttoGare("45 - Lavori") === "45000000" && cpvDaCategoriaTuttoGare("Servizi di pulizia") === null && cpvDaCategoriaTuttoGare("1 - x") === null && JSON.stringify(cpvTuttoGare(d.categorie)) === JSON.stringify(["90910000", "90911200"]));
}

// ═════ E. opportunità ed ente ═════
function provaClassificazione(): void {
  const t = (p: string | null, o = "Servizio di pulizia (prova sintetica)") => opportunitaTuttoGare(p, o)?.tipo ?? null;
  const casi: [string | null, string, string | null][] = [
    ["Procedura aperta", "Servizio di pulizia", "bando"],
    ["Procedura ristretta", "Servizio di pulizia", "bando"],
    ["Procedura negoziata previa pubblicazione del bando", "Servizio di pulizia", "bando"],
    ["Procedura negoziata", "Servizio di pulizia", "riservata"],
    ["Procedura negoziata", "Avviso di manifestazione di interesse per il servizio di pulizia", "manifestazione_interesse"],
    ["Affidamento con indagine di mercato", "Servizio di pulizia", "indagine_mercato"],
    ["Richiesta di preventivo aperta", "Servizio di pulizia", "indagine_mercato"],
    ["Manifestazione di interesse", "Servizio di pulizia", "manifestazione_interesse"],
    ["Affidamento diretto", "Servizio di pulizia", "affidamento_diretto"],
    ["Affidamento diretto", "Indagine di mercato per il servizio di pulizia", "indagine_mercato"],
    ["Contratto applicativo", "Servizio di pulizia", "affidamento_diretto"],
    ["Procedura aperta", "Contratto applicativo dell'accordo quadro di pulizia", "affidamento_diretto"],
    ["Albo fornitori", "Iscrizione all'albo", "sistema_qualificazione"],
    ["Sistema dinamico di acquisizione – appalto specifico", "Servizio di pulizia", "riservata"],
    ["Consultazione preliminare di mercato", "Servizio di pulizia", null],
    ["Procedura sconosciuta", "Servizio di pulizia", null],
    [null, "Avviso esplorativo per il servizio di pulizia", "manifestazione_interesse"],
    [null, "Servizio di pulizia", null],
  ];
  const sbagliati = casi.filter(([p, o, atteso]) => t(p, o) !== atteso).map(([p, o, atteso]) => ({ p, o, atteso, avuto: t(p, o) }));
  controlla("procedura → opportunità (decisioni del 26/11): affidamenti diretti e contratti applicativi fuori; indagini e preventivi aperti = candidature; consultazioni e valori sconosciuti non entrano", sbagliati.length === 0, sbagliati);
  const roma = enteTuttoGare(ROMA, "Roma Capitale – Dipartimento sintetico");
  const altro = enteTuttoGare(UNIBA, "Liceo Sintetico di Firenze");
  const sic = enteTuttoGare(SICILIA, "Comune di Provasintetica | altro");
  const sicVuoto = enteTuttoGare(SICILIA, "");
  controlla("ente: un dipartimento dello stesso ente = l'ente dell'anagrafica; un beneficiario diverso in un'istanza di un solo ente si scrive com'è e si segnala (caso Uniba di R4)", roma.ente === ROMA.ente && !roma.daVerificare && altro.ente.denominazione === "Liceo Sintetico di Firenze" && altro.ente.codiceFiscale === null && altro.daVerificare, { roma, altro });
  controlla("ente nelle istanze a più enti: il beneficiario (comune riconosciuto da «Comune di …»), senza codice fiscale; senza beneficiario la centrale", sic.ente.denominazione === "Comune di Provasintetica" && sic.ente.comune === "Provasintetica" && sic.ente.codiceFiscale === null && !sic.daVerificare && sicVuoto.ente === SICILIA.ente, { sic, sicVuoto });

  const b = leggiGaraTuttoGare(ROMA, "101", leggiDettaglioTuttoGare(DETTAGLI_ROMA[101]), ADESSO) as BandoTuttoGare;
  controlla("gara di Roma (bando di pulizia): identità, opportunità, scadenza all'ora, importo, CIG dei lotti, CPV, ente e regione dall'anagrafica", b.tipo === "bando" && b.meta.idPiattaforma === "tuttogare:appalti.comune.roma.it:101" && b.record.chiaveProcedura === b.meta.idPiattaforma && b.meta.idProcedura === "appalti.comune.roma.it:101" && b.opportunita.tipo === "bando" && b.record.scadenzaOfferte === "2026-12-15T11:00:00.000Z" && b.record.valoreBase === 120000 && b.record.lotti.map((l) => l.cig).join() === "B11111111A,B22222222B" && b.record.cpvPrincipale === "90910000" && b.record.ente.denominazione === "Roma Capitale" && b.record.ente.regione === "lazio" && b.record.natura === "servizi" && b.record.tipoProcedura === "Procedura aperta" && b.record.dataPubblicazione === "2026-11-20" && b.settori.length > 0, b.tipo === "bando" ? { ...b, record: { ...b.record, lotti: b.record.lotti.length } } : b);
  controlla("gara di Roma: collegamento al dettaglio (mai documenti), codice fiscale mancante dichiarato, nessun dato dei referenti", b.record.urlAvviso === "https://appalti.comune.roma.it/gare/dettaglio.php?codice=101" && b.record.urlDocumenti === b.record.urlAvviso && b.mancanti.includes("codice_fiscale_ente") && !JSON.stringify(b).includes("esempio.invalid"), b.mancanti);
  const c = leggiGaraTuttoGare(ROMA, "102", leggiDettaglioTuttoGare(DETTAGLI_ROMA[102]), ADESSO) as BandoTuttoGare;
  controlla("candidatura senza CIG (indagine di mercato): entra come indagine, CIG e valore mancanti, tipo avviso «Avviso»", c.tipo === "bando" && c.opportunita.tipo === "indagine_mercato" && c.mancanti.includes("cig") && c.mancanti.includes("valore") && c.record.tipoAvviso === "Avviso" && c.record.lotti.length === 0, c);
  const strada = leggiGaraTuttoGare(ROMA, "105", leggiDettaglioTuttoGare(DETTAGLI_ROMA[105]), ADESSO) as EsclusioneTuttoGare;
  controlla("lavori stradali: esclusi dalla classificazione comune", strada.tipo === "esclusione" && (strada.motivo === "fuori_settore" || strada.motivo === "esclusa_per_oggetto"), strada);
  const scaduta = leggiGaraTuttoGare(ROMA, "101", { ...leggiDettaglioTuttoGare(DETTAGLI_ROMA[101]), scadenza: "25/11/2026 12:00" }, ADESSO);
  const affidamento = leggiGaraTuttoGare(ROMA, "101", { ...leggiDettaglioTuttoGare(DETTAGLI_ROMA[101]), procedura: "Affidamento diretto" }, ADESSO);
  const ignota = leggiGaraTuttoGare(ROMA, "101", { ...leggiDettaglioTuttoGare(DETTAGLI_ROMA[101]), procedura: "Consultazione preliminare di mercato" }, ADESSO);
  const senza = leggiGaraTuttoGare(ROMA, "abc", leggiDettaglioTuttoGare(DETTAGLI_ROMA[101]), ADESSO);
  controlla("esclusioni: scaduta, affidamento, tipo sconosciuto, codice non valido (nessuna identità inventata)", scaduta.tipo === "esclusione" && scaduta.motivo === "scaduta" && affidamento.tipo === "esclusione" && affidamento.motivo === "affidamento" && ignota.tipo === "esclusione" && ignota.motivo === "tipo_sconosciuto" && senza.tipo === "esclusione" && senza.motivo === "senza_identificativo");
  // la regola resta per le istanze future: un'istanza con la regione non confermata (qui una copia sintetica senza regione) dà una gara senza
  // regione, mai presunta
  const castelliIstanza = istanzaDaHost("cuccastellidellasapienza.tuttogare.it") as IstanzaTuttoGare;
  const senzaRegione = leggiGaraTuttoGare({ ...castelliIstanza, regione: null }, "9", leggiDettaglioTuttoGare(DETTAGLI_ROMA[101]), ADESSO) as BandoTuttoGare;
  controlla("istanza con la regione da confermare: gara senza regione, «regione» tra i mancanti (mai una regione presunta)", senzaRegione.tipo === "bando" && senzaRegione.regioni.length === 0 && senzaRegione.record.ente.regione === null && senzaRegione.mancanti.includes("regione"));
  const castelli = leggiGaraTuttoGare(castelliIstanza, "9", leggiDettaglioTuttoGare(DETTAGLI_ROMA[101]), ADESSO) as BandoTuttoGare;
  controlla("CUC Castelli della Sapienza: gara nel Lazio, «regione» non più tra i mancanti", castelli.tipo === "bando" && JSON.stringify(castelli.regioni) === '["lazio"]' && castelli.record.ente.regione === "lazio" && !castelli.mancanti.includes("regione"));
  const br = bandoDaTuttoGare(b, OGGI);
  controlla("bando per il motore: fonte «tuttogare», versione = giorno di lettura (come Sintel), piattaforma_id VUOTO (decisione (b)), nessuna dichiarazione", br?.fonte === "tuttogare" && br.versione.id === "appalti.comune.roma.it:101@2026-11-26" && br.piattaformaId === null && br.dichiarazione === null && br.tipoAvvisoFonte === "Procedura aperta", br);
  const riga = br ? rigaDaBandoRegionale(br, ADESSO) : null;
  controlla("riga della gara: CHIAVE «tuttogare:<host>:<codice>» e piattaforma_id vuoto (nessun valore fuori dal vincolo della 0120)", riga?.chiave === "tuttogare:appalti.comune.roma.it:101" && riga.piattaforma_id === null, riga && { chiave: riga.chiave, piattaforma_id: riga.piattaforma_id });
}

// ═════ F. cursore ═════
function provaCursore(): void {
  const righe = leggiHomeTuttoGare(HOME_ROMA, ROMA);
  const voce = { r: righe[0].impronta, l: "2026-11-25" };
  controlla("dettaglio da rileggere: gara nuova sì; riga uguale letta ieri no; riga cambiata sì; dopo 7 giorni sì", dettaglioDaLeggere(righe[0], undefined, OGGI) && !dettaglioDaLeggere(righe[0], voce, OGGI) && dettaglioDaLeggere(righe[0], { ...voce, r: "diversa" }, OGGI) && dettaglioDaLeggere(righe[0], { ...voce, l: "2026-11-19" }, OGGI) && !dettaglioDaLeggere(righe[0], { ...voce, l: "2026-11-20" }, OGGI));
  const prima = cursoreTuttoGare({ [ROMA.host]: { "101": voce, "999": { r: "x", l: "2026-11-01" } }, "altro.esempio.invalid": { "1": { r: "x", l: "2026-11-01" } }, [SICILIA.host]: { "5": { r: "y", l: "2026-11-01" } } });
  controlla("cursore letto: solo istanze dell'anagrafica e voci valide", Object.keys(prima).sort().join() === [ROMA.host, SICILIA.host].sort().join() && prima[ROMA.host]["101"].r === voce.r);
  const dopo = aggiornaCursoreTuttoGare(prima, [{ host: ROMA.host, righe, trattati: new Set(["102", "103"]) }], OGGI);
  controlla("cursore dopo il giro: le gare uscite dalla home spariscono, le trattate con la riga di oggi, le altre come prima, le rimandate senza voce; le istanze non lette invariate", JSON.stringify(Object.keys(dopo[ROMA.host]).sort()) === JSON.stringify(["101", "102", "103"]) && dopo[ROMA.host]["102"].l === OGGI && dopo[ROMA.host]["101"] === prima[ROMA.host]["101"] && dopo[SICILIA.host] === prima[SICILIA.host], dopo);
}

// ═════ G. lettore con la rete finta ═════
type Risposta = { stato?: number; testo: string; url?: string };
function reteFinta(risposte: Record<string, Risposta>, richieste: string[]): typeof fetch {
  return (async (url: string | URL | Request) => {
    const u = String(url);
    richieste.push(u);
    const r = risposte[u] ?? { stato: 404, testo: "non trovata" };
    return { status: r.stato ?? 200, url: r.url ?? u, headers: new Headers({ "content-type": "text/html" }), text: async () => r.testo } as unknown as Response;
  }) as typeof fetch;
}
const sessione = (fetchFn: typeof fetch, richiesteMassime = 30) => new SessioneFonte("TuttoGare", { pausaMs: 0, timeoutMs: 5_000, tentativi: 1, richiesteMassime }, fetchFn);
const RISPOSTE_ROMA: Record<string, Risposta> = {
  "https://appalti.comune.roma.it/": { testo: HOME_ROMA },
  ...Object.fromEntries(Object.entries(DETTAGLI_ROMA).map(([c, t]) => [`https://appalti.comune.roma.it/gare/dettaglio.php?codice=${c}`, { testo: t }])),
};

async function provaLettore(): Promise<void> {
  const canale = CANALE_TUTTOGARE;
  const prima = canale.confermato;
  const richieste: string[] = [];
  let fermato = false;
  try {
    // la guardia resta: con la mappa non confermata (per esempio dopo un cambio di formato) il lettore si ferma prima di qualunque richiesta
    canale.confermato = false;
    await new LettoreTuttoGare(sessione(reteFinta(RISPOSTE_ROMA, richieste))).leggiIstanze([ROMA], {}, OGGI);
  } catch (e) {
    fermato = e instanceof ErroreFonte && /non confermata/.test(e.message) && !e.sospendi;
  } finally {
    canale.confermato = prima;
  }
  controlla("guardia della conferma (provata spegnendola): il lettore si ferma PRIMA di qualunque richiesta", fermato && richieste.length === 0);
  try {
    const r1: string[] = [];
    const l1 = await new LettoreTuttoGare(sessione(reteFinta(RISPOSTE_ROMA, r1))).leggiIstanze([ROMA], {}, OGGI);
    const roma = l1.istanze[0];
    controlla("lettura (simulata): home + 3 dettagli (101, 102, 105); i due «Affidamento diretto / RDO» esclusi dal badge senza dettaglio", r1.length === 4 && r1[0] === "https://appalti.comune.roma.it/" && roma.dettagli.map((d) => d.codice).join() === "101,102,105" && roma.esclusiDallaRiga.join() === "103,104" && l1.errori.length === 0, { r1, esclusi: roma?.esclusiDallaRiga });
    controlla("lettura: SOLO indirizzi ammessi (mai documenti, allegati, altre piattaforme, alias)", r1.every((u) => percorsoAmmessoTuttoGare(u, ROMA)) && !r1.some((u) => /documenti|allegati|altro\.esempio/.test(u)));
    const cursore = aggiornaCursoreTuttoGare({}, l1.istanze.map((l) => ({ host: l.istanza.host, righe: l.righe, trattati: l.trattati })), OGGI);
    const r2: string[] = [];
    const l2 = await new LettoreTuttoGare(sessione(reteFinta(RISPOSTE_ROMA, r2))).leggiIstanze([ROMA], cursore, OGGI);
    controlla("secondo giro con le stesse righe: solo la home, nessun dettaglio", r2.length === 1 && l2.istanze[0].dettagli.length === 0, r2);
    const r3: string[] = [];
    const l3 = await new LettoreTuttoGare(sessione(reteFinta(RISPOSTE_ROMA, r3), 3)).leggiIstanze([ROMA], {}, OGGI);
    controlla("tetto del giro (3 richieste): home + 2 dettagli, la terza gara rimandata al giro dopo (senza voce nel cursore)", r3.length === 3 && l3.rimandati === 1 && l3.istanze[0].dettagli.length === 2 && !l3.istanze[0].trattati.has("105"), { r3, rimandati: l3.rimandati });
    const piccola: IstanzaTuttoGare = { ...ROMA, richiesteMassime: 2 };
    const r4: string[] = [];
    const l4 = await new LettoreTuttoGare(sessione(reteFinta(RISPOSTE_ROMA, r4))).leggiIstanze([piccola], {}, OGGI);
    controlla("tetto dell'istanza (2 richieste, home compresa): un dettaglio, due rimandati", r4.length === 2 && l4.rimandati === 2, { r4, rimandati: l4.rimandati });
    // un'istanza che reindirizza altrove non si legge (le altre sì); una pagina senza impronte del software sospende tutto
    const r5: string[] = [];
    const rete5 = reteFinta({ ...RISPOSTE_ROMA, "https://appalti.regionesiciliana.lavoripubblici.sicilia.it/": { testo: HOME_VUOTA, url: "https://altro.esempio.invalid/" } }, r5);
    const l5 = await new LettoreTuttoGare(sessione(rete5)).leggiIstanze([SICILIA, ROMA], {}, OGGI);
    controlla("reindirizzamento verso un altro host: l'istanza non si legge (errore, nessuna sospensione), le altre sì", l5.errori.length === 1 && l5.errori[0].host === SICILIA.host && /reindirizzato/.test(l5.errori[0].messaggio) && l5.istanze.length === 1 && l5.istanze[0].istanza.host === ROMA.host, l5.errori);
    const sospensione = async (risposte: Record<string, Risposta>) => {
      try {
        await new LettoreTuttoGare(sessione(reteFinta(risposte, []))).leggiIstanze([ROMA, SICILIA], {}, OGGI);
        return false;
      } catch (e) {
        return e instanceof ErroreFonte && e.sospendi;
      }
    };
    controlla("sospensione di tutta la fonte: pagina senza impronte (verifica anti-robot), risposta 403, dettagli senza i campi dichiarati", (await sospensione({ ...RISPOSTE_ROMA, "https://appalti.comune.roma.it/": { testo: "<html><body>Verifica di sicurezza</body></html>" } })) && (await sospensione({ ...RISPOSTE_ROMA, "https://appalti.comune.roma.it/": { stato: 403, testo: "vietato" } })) && (await sospensione({ ...RISPOSTE_ROMA, "https://appalti.comune.roma.it/gare/dettaglio.php?codice=101": { testo: pagina("<p>altro formato</p>") }, "https://appalti.comune.roma.it/gare/dettaglio.php?codice=102": { testo: pagina("<p>altro formato</p>") }, "https://appalti.comune.roma.it/gare/dettaglio.php?codice=105": { testo: pagina("<p>altro formato</p>") } })));
  } finally {
    canale.confermato = prima;
  }
}

// ═════ H. guardie di produzione (decisione dell'utente del 26/11: TuttoGare in produzione, tutto spento) ═════
function provaGuardie(): void {
  const tutte = Object.fromEntries(Object.values(VARIABILI_PRODUZIONE).map((v) => [v, "autorizzata"]));
  const senzaLaSua = Object.fromEntries(Object.entries(tutte).filter(([k]) => k !== "RADAR_TUTTOGARE_PRODUZIONE"));
  const senza = fonteAutorizzata("tuttogare", "importazione", PROD_DEPLOY);
  controlla("ambiente: variabile RADAR_TUTTOGARE_PRODUZIONE; staging sì; produzione SENZA la sua variabile (anche con tutte le altre) NO e il motivo la nomina; con la variabile sì; locale e anteprima mai", VARIABILI_PRODUZIONE.tuttogare === "RADAR_TUTTOGARE_PRODUZIONE" && fonteAutorizzata("tuttogare", "importazione", STAGING).ok && !senza.ok && senza.motivo.includes("RADAR_TUTTOGARE_PRODUZIONE=autorizzata") && !fonteAutorizzata("tuttogare", "importazione", { ...PROD_DEPLOY, ...senzaLaSua }).ok && !fonteAutorizzata("tuttogare", "notifiche", { ...PROD_DEPLOY, ...senzaLaSua }).ok && fonteAutorizzata("tuttogare", "importazione", { ...PROD_DEPLOY, RADAR_TUTTOGARE_PRODUZIONE: "autorizzata" }).ok && !fonteAutorizzata("tuttogare", "importazione", { NEXT_PUBLIC_SUPABASE_URL: PROD_DEPLOY.NEXT_PUBLIC_SUPABASE_URL, ...tutte }).ok && !fonteAutorizzata("tuttogare", "importazione", { ...PROD_DEPLOY, VERCEL_ENV: "preview", ...tutte }).ok, senza);
  controlla("console, cron e registro: TuttoGare tra le fonti regionali gestite, le fonti dei giri e del registro; script dello staging (accensione e giro a mano) compresi", (FONTI_REGIONALI as readonly string[]).includes("tuttogare") && (FONTI_ESECUZIONI as readonly string[]).includes("tuttogare") && (FONTI_REGISTRO as readonly string[]).includes("tuttogare") && (FONTI_ACCENDIBILI as readonly string[]).includes("tuttogare"));
  const vercel = JSON.parse(leggi("vercel.json")) as { crons: { path: string; schedule: string }[] };
  const righe = vercel.crons.filter((c) => c.path === "/api/cron/radar-tuttogare");
  const altreRadar = vercel.crons.filter((c) => c.path.startsWith("/api/cron/radar-") && c.path !== "/api/cron/radar-tuttogare");
  controlla("giri programmati: 09:35, 13:35, 17:35 feriali e 13:35 nel fine settimana; rotta e interruttore RADAR_TUTTOGARE_CRON; UNA riga in vercel.json uguale a CRON_PROPOSTI; il minuto :35 non è usato da altri cron del radar", JSON.stringify(ORARI_GIRI.tuttogare) === JSON.stringify([{ ora: "09:35", giorni: "feriali" }, { ora: "13:35", giorni: "feriali" }, { ora: "17:35", giorni: "feriali" }, { ora: "13:35", giorni: "fine_settimana" }]) && ROTTE_CRON.tuttogare === "/api/cron/radar-tuttogare" && INTERRUTTORI_CRON.tuttogare === "RADAR_TUTTOGARE_CRON" && righe.length === 1 && JSON.stringify([righe[0].schedule]) === JSON.stringify(CRON_PROPOSTI.tuttogare) && altreRadar.every((c) => !c.schedule.startsWith("35 ")), { righe, CRON: CRON_PROPOSTI.tuttogare });
  const rotta = leggi("src/app/api/cron/radar-tuttogare/route.ts");
  controlla("rotta del cron: segreto, poi porta oraria di TuttoGare, poi l'importatore con «tuttogare»", rotta.indexOf("cronAutorizzato(") > 0 && rotta.indexOf("cronAutorizzato(") < rotta.indexOf('portaGiroProgrammato("tuttogare"') && rotta.indexOf('portaGiroProgrammato("tuttogare"') < rotta.indexOf('eseguiImportazioneRegionale(createAdminClient(), "tuttogare"'));
  controlla("console: etichette del registro e TuttoGare tra le fonti della pagina «Fonti»", /"fonte:tuttogare:attiva"/.test(leggi("src/app/site-console/_componenti/tender-intelligence-vista.tsx")) && /"tuttogare"\]/.test(leggi("src/app/site-console/_componenti/tender-intelligence-vista.tsx")) && /tuttogare: "TuttoGare"/.test(leggi("src/app/site-console/azioni/tender-intelligence.ts")));
  // testi per il CLIENTE senza il nome del software delle piattaforme (indicazione del coordinamento del 26/11)
  const d = descrizioneFonte("tuttogare");
  const testiCliente = [NOME_FONTE.tuttogare, NOME_FONTE_ESTESO.tuttogare, ATTRIBUZIONE_FONTE.tuttogare, d.nome, d.copertura, d.aggiornamento, d.licenza, ...d.limiti, leggi("src/components/omnia-ai/opportunita/fonti-ricerca.tsx").match(/tuttogare: "([^"]+)"/)?.[1] ?? "MANCANTE"];
  controlla("testi per il cliente senza il nome del software (né «TuttoGare» né «Studio Amica»), con gli orari veri e la regione degli enti", testiCliente.every((t) => !/tutto\s*gare|studio\s*amica|MANCANTE/i.test(t)) && d.aggiornamento.startsWith("Giri previsti alle 09:35, 13:35 e 17:35 dal lunedì al venerdì; alle 13:35 il sabato e la domenica"), testiCliente);
  // la scheda della gara: «Piattaforma dell'ente, gara 13584» (l'indirizzo dell'istanza, che può contenere il nome del software, resta nel collegamento)
  controlla("scheda della gara: «Piattaforma dell'ente, gara <codice>», senza l'indirizzo dell'istanza", descriviAvvisoLetto({ fonte: "tuttogare", id_fonte: "cucterradileuca.tuttogare.it:12", tipo_avviso: "Aperta" }) === "Piattaforma dell'ente, gara 12");
  const fuori = ["supabase/migrations"].flatMap((d) => fs.readdirSync(path.join(radice, d)).filter((f) => /tuttogare/i.test(fs.readFileSync(path.join(radice, d, f), "utf8"))).map((f) => `${d}/${f}`));
  controlla("nessuna migrazione nuova: tra le migrazioni solo la 0135 nomina TuttoGare", JSON.stringify(fuori) === JSON.stringify(["supabase/migrations/0135_radar_fonte_tuttogare.sql"]), fuori);
  // la 0135 PROPOSTA (mai applicata): vincolo del registro con TUTTE le fonti di prima più «tuttogare», riga spenta, nascosta, semaforo chiuso;
  // nessuna istruzione su radar_procedure (piattaforma_id non si tocca, decisione (b))
  const sql = leggi("supabase/migrations/0135_radar_fonte_tuttogare.sql");
  const istruzioni = sql.split("\n").filter((r) => !/^\s*--/.test(r)).join("\n");
  controlla("0135 proposta: vincolo del registro = le 5 fonti online + «tuttogare»; riga «tuttogare» spenta, nascosta, semaforo 2099, «on conflict do nothing»; niente su radar_procedure né su piattaforma_id", istruzioni.includes("check (fonte in ('ted', 'pvl', 'sintel', 'sardegnacat', 'sater', 'tuttogare'))") && istruzioni.includes("values ('tuttogare', false, true, '2099-01-01T00:00:00Z')") && /on conflict \(fonte\) do nothing/.test(istruzioni) && !/radar_procedure\b|piattaforma_id/.test(istruzioni) && /^begin;$/m.test(istruzioni) && /^commit;$/m.test(istruzioni) && !/\bdrop table\b|\bdelete\b|\btruncate\b|\bupdate\b/i.test(istruzioni));
  controlla("motore di unione: «tuttogare» tra le fonti unite, precedenza delle piattaforme; nessuna fonte nascosta di base (regola 48A/48E invariata)", FONTI_UNITE.includes("tuttogare") && PRECEDENZA_FONTI.tuttogare === PRECEDENZA_FONTI.sater && FONTI_NASCOSTE_PREDEFINITE.length === 0);
  controlla("nome per il cliente e attribuzione uguali a quelli del connettore", NOME_FONTE.tuttogare === "Piattaforma dell'ente" && ATTRIBUZIONE_FONTE.tuttogare === CANALE_TUTTOGARE.attribuzione);
  // decisione (b) del coordinamento (26/11): il vincolo di piattaforma_id della 0120 non si tocca; la forma TuttoGare non lo rispetta, quindi
  // piattaforma_id resta vuoto e l'identità sta nella chiave (3–200 caratteri, vincolo della 0109), che ci sta anche con l'host più lungo
  const vincolo0120 = leggi("supabase/migrations/0120_radar_multifonte.sql").match(/piattaforma_id ~ '([^']+)'/)?.[1] ?? "";
  controlla("schema invariato: la chiave TuttoGare non entra nel vincolo di piattaforma_id della 0120 (per questo resta vuoto) e sta nei 200 caratteri della chiave", vincolo0120 === "^[a-z0-9_]{2,40}:[0-9]{1,12}$" && !new RegExp(vincolo0120).test("tuttogare:appalti.comune.roma.it:101") && ISTANZE_TUTTOGARE.every((i) => `tuttogare:${i.host}:999999999999`.length <= 200), vincolo0120);
}

// ═════ I. giri col database in memoria ═════
async function provaGiri(): Promise<void> {
  // la riga di TuttoGare: assente, accesa (blocco libero) o come la crea la 0135 (spenta, nascosta, blocco 2099), anche accesa senza sbloccarla
  const mondo = (tuttogare: "assente" | "accesa" | "spenta_0135" | "accesa_0135") => {
    const db = new DbFinto();
    const altre = FONTI_ESECUZIONI.filter((f) => f !== "tuttogare").map((f) => ({ fonte: f, attiva: false, ultimo_successo_il: null, cursore: null, blocco_fino_a: null, conteggi: {}, nascosta_ai_clienti: false, dati_aggiornati_al: null }));
    const blocco = tuttogare.endsWith("_0135") ? "2099-01-01T00:00:00.000Z" : null;
    db.tabelle.radar_fonti_stato = tuttogare === "assente" ? altre : [...altre, { fonte: "tuttogare", attiva: tuttogare.startsWith("accesa"), ultimo_successo_il: null, cursore: null, blocco_fino_a: blocco, conteggi: {}, nascosta_ai_clienti: true, dati_aggiornati_al: null }];
    return db;
  };
  const primaRete = richiesteDiRete;
  const a = mondo("assente");
  const ra = await eseguiImportazioneRegionale(a as unknown as SupabaseClient, "tuttogare", { env: STAGING, adesso: () => ADESSO });
  const regA = a.t("radar_esecuzioni");
  controlla("staging SENZA la riga di TuttoGare (0135 non applicata): «fonte_spenta», nessuna gara, nessuna richiesta; nel registro solo la riga «inerte» (nel database vero solo dopo la 0135)", !ra.eseguita && ra.motivo === "fonte_spenta" && a.t("radar_procedure").length === 0 && regA.length === 1 && regA[0].fonte === "tuttogare" && regA[0].esito === "inerte", { ra, regA });
  // produzione (go-live, come SATER): senza la SUA variabile nessun accesso; con la variabile e la riga della 0135 spenta solo «inerte»;
  // accesa senza liberare il blocco 2099 della 0135: «occupata» (il blocco si libera con una riga autorizzata prima dell'accensione)
  const tutte = Object.fromEntries(Object.values(VARIABILI_PRODUZIONE).map((v) => [v, "autorizzata"]));
  const senzaLaSua = Object.fromEntries(Object.entries(tutte).filter(([k]) => k !== "RADAR_TUTTOGARE_PRODUZIONE"));
  const b = mondo("accesa");
  const rb = await eseguiImportazioneRegionale(b as unknown as SupabaseClient, "tuttogare", { env: { ...PROD_DEPLOY, ...senzaLaSua, RADAR_CONTATTO_FONTI: "contatto@esempio.invalid" }, adesso: () => ADESSO });
  controlla("produzione SENZA RADAR_TUTTOGARE_PRODUZIONE (anche con la riga accesa e tutte le altre variabili): «ambiente_non_consentito», zero accessi al database (nemmeno il registro)", !rb.eseguita && rb.motivo === "ambiente_non_consentito" && b.richieste.length === 0, rb);
  const PROD_CON_VAR = { ...PROD_DEPLOY, RADAR_TUTTOGARE_PRODUZIONE: "autorizzata", RADAR_CONTATTO_FONTI: "contatto@esempio.invalid" };
  const bs = mondo("spenta_0135");
  const rbs = await eseguiImportazioneRegionale(bs as unknown as SupabaseClient, "tuttogare", { env: PROD_CON_VAR, adesso: () => ADESSO });
  controlla("produzione CON la variabile e TuttoGare spenta (riga della 0135): «fonte_spenta», solo la riga «inerte» nel registro, nessuna gara", !rbs.eseguita && rbs.motivo === "fonte_spenta" && bs.t("radar_esecuzioni").length === 1 && bs.t("radar_esecuzioni")[0].esito === "inerte" && bs.t("radar_procedure").length === 0, rbs);
  const bo = mondo("accesa_0135");
  const rbo = await eseguiImportazioneRegionale(bo as unknown as SupabaseClient, "tuttogare", { env: PROD_CON_VAR, adesso: () => ADESSO });
  controlla("produzione, TuttoGare accesa ma con il blocco 2099 della 0135: «occupata» (il blocco va liberato prima dell'accensione)", !rbo.eseguita && rbo.motivo === "occupata", rbo);
  const canale = CANALE_TUTTOGARE;
  const prima = canale.confermato;
  const c = mondo("accesa");
  canale.confermato = false;
  const rc = await eseguiImportazioneRegionale(c as unknown as SupabaseClient, "tuttogare", { env: STAGING, adesso: () => ADESSO }).finally(() => (canale.confermato = prima));
  controlla("guardia della conferma (provata spegnendola): con la riga accesa errore detto, nessuna gara, nessuna richiesta di rete", rc.eseguita && /non confermata/.test(rc.errore ?? "") && c.t("radar_procedure").length === 0 && richiesteDiRete === primaRete, rc.eseguita ? rc.errore : rc);

  const attiveDiPrima = ISTANZE_TUTTOGARE.map((i) => i.attiva);
  try {
    // solo Roma attiva (meno pause tra le richieste); le altre istanze tornano come prima nel finally
    for (const i of ISTANZE_TUTTOGARE) i.attiva = i.host === ROMA.host;
    const richieste: string[] = [];
    const vuote = Object.fromEntries(istanzeAttiveTuttoGare().filter((i) => i.host !== ROMA.host).map((i) => [`https://${i.host}/`, { testo: HOME_VUOTA }]));
    const rete = reteFinta({ ...RISPOSTE_ROMA, ...vuote }, richieste);
    const d = mondo("accesa");
    const r = await eseguiImportazioneRegionale(d as unknown as SupabaseClient, "tuttogare", { env: STAGING, adesso: () => ADESSO, fetchFn: rete, origine: "script", limiti: { pausaMs: 2_000, tentativi: 1 } });
    const gare = d.t("radar_procedure");
    const regD = d.t("radar_esecuzioni");
    controlla("giro (simulato, staging, solo Roma attiva): home + 3 dettagli, nessun errore; una riga «ok» di «tuttogare» nel registro dei giri (nel database vero dopo la 0135)", r.eseguita && !r.errore && richieste.length === 4 && r.esecuzione.scritta && regD.length === 1 && regD[0].fonte === "tuttogare" && regD[0].esito === "ok", { r: r.eseguita ? { errore: r.errore, allarmi: r.allarmi } : r, richieste: richieste.length, regD });
    controlla("giro: 2 gare scritte (bando di pulizia e indagine di portierato), lavori stradali esclusi, 2 affidamenti esclusi dalla riga", gare.length === 2 && r.eseguita && (r.statistiche.esclusi.affidamento ?? 0) === 2, { gare: gare.map((g) => g.chiave), esclusi: r.eseguita ? r.statistiche.esclusi : null });
    controlla("gare con la chiave «tuttogare:<host>:<codice>», piattaforma_id VUOTO (decisione (b)), ente e regione dall'anagrafica", gare.every((g) => /^tuttogare:appalti\.comune\.roma\.it:10[12]$/.test(String(g.chiave)) && g.piattaforma_id === null && g.sa_denominazione === "Roma Capitale"), gare.map((g) => [g.chiave, g.piattaforma_id, g.sa_denominazione]));
    controlla("provenienza: righe della fonte «tuttogare»; nessun dato dei referenti nel database", d.t("radar_procedure_fonti").length > 0 && d.t("radar_procedure_fonti").every((f) => f.fonte === "tuttogare") && !JSON.stringify(d.tabelle.radar_procedure).includes("esempio.invalid"));
    const stato = d.t("radar_fonti_stato").find((x) => x.fonte === "tuttogare") as { cursore: { tuttogare?: Record<string, Record<string, unknown>> } } | undefined;
    controlla("cursore salvato a giro finito: le 5 gare di Roma (lette o escluse dalla riga)", Object.keys(stato?.cursore?.tuttogare?.[ROMA.host] ?? {}).sort().join() === "101,102,103,104,105" && Object.keys(stato?.cursore?.tuttogare ?? {}).join() === ROMA.host, stato?.cursore);
    const richieste2: string[] = [];
    const r2 = await eseguiImportazioneRegionale(d as unknown as SupabaseClient, "tuttogare", { env: STAGING, adesso: () => ADESSO, fetchFn: reteFinta({ ...RISPOSTE_ROMA, ...vuote }, richieste2), origine: "script", limiti: { pausaMs: 2_000, tentativi: 1 } });
    controlla("secondo giro con la stessa home: 1 richiesta (solo la home), nessuna gara nuova", r2.eseguita && !r2.errore && richieste2.length === 1 && d.t("radar_procedure").length === 2 && r2.statistiche.nuove === 0, { richieste: richieste2.length, r2: r2.eseguita ? r2.statistiche.nuove : r2 });
  } finally {
    canale.confermato = prima;
    ISTANZE_TUTTOGARE.forEach((i, n) => (i.attiva = attiveDiPrima[n]));
  }
  controlla("nessuna richiesta alla rete vera in tutta la verifica", richiesteDiRete === primaRete, richiesteDiRete - primaRete);
}

async function principale(): Promise<void> {
  provaAnagrafica();
  provaIndirizzi();
  provaHome();
  provaDettaglio();
  provaClassificazione();
  provaCursore();
  await provaLettore();
  provaGuardie();
  await provaGiri();
}
principale()
  .catch((e) => falliti.push(`eccezione: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`))
  .finally(() => {
    console.log(`Verifica del connettore TuttoGare (Fase 2): ${ok} ok, ${falliti.length} falliti`);
    for (const f of falliti) console.log(`  FALLITO: ${f}`);
    process.exit(falliti.length ? 1 : 0);
  });
