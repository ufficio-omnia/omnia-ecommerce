// Verifica del connettore TuttoGare (Fase 2, seconda priorità del documento 60): un adattatore per molte istanze «TuttoGare PA», canale home
// HTML + dettaglio (JSON interno predisposto e spento), mappa dei campi DICHIARATA e non confermata (il lettore si ferma prima di qualunque
// richiesta), fonte «tuttogare» fuori da console, cron, programmatore e registro dei giri, mai in produzione. Tutti i dati sono [SINTETICI]
// (pagine HTML inventate con la forma dichiarata, enti e CIG di prova: «Comune di Provasintetica»); nessuna rete (fetch vietato), database
// in memoria. Uso: npx tsx scripts/verifica-radar-tuttogare.ts → codice 0 se passa.
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
import { FONTI_ESECUZIONI } from "../src/lib/radar/esecuzioni-calcoli";
import { CRON_PROPOSTI, INTERRUTTORI_CRON, ORARI_GIRI, ROTTE_CRON } from "../src/lib/radar/programmazione-calcoli";
import { FONTI_UNITE, PRECEDENZA_FONTI } from "../src/lib/radar/unione-calcoli";
import { ATTRIBUZIONE_FONTE, FONTI_NASCOSTE_PREDEFINITE, NOME_FONTE } from "../src/lib/radar/fonti-gara-calcoli";
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

// ───── pagine [SINTETICHE] con la forma dichiarata (R4): home con la tabella delle gare, dettaglio con etichette e valori ─────
const PIEDE = `<footer>Piattaforma realizzata con <a href="https://app.tuttogare.it">TuttoGare</a></footer>`;
const pagina = (corpo: string) => `<!DOCTYPE html><html lang="it"><head><title>Gare (prova sintetica)</title><style>@font-face{font-family:x;src:url(/font/StudioAmica.woff2)}</style><script>var codice=999;</script></head><body><header>Menu · Stato · Oggetto</header>${corpo}${PIEDE}</body></html>`;
const rigaHome = (codice: number, oggetto: string, extra = "", href = `/gare/dettaglio.php?codice=${codice}`) =>
  `<tr><td>Pubblicato</td><td>Gara #${codice + 9000}</td><td><a href="${href}">${oggetto}</a>${extra}</td><td>15/12/2026 12:00</td></tr>`;
const HOME_ROMA = pagina(
  `<table class="gare"><thead><tr><th>Stato</th><th>Gara</th><th>Oggetto</th><th>Scadenza</th></tr></thead><tbody>` +
    rigaHome(101, "Servizio di pulizia degli uffici comunali (prova sintetica)", `<br><small>Procedura aperta</small> <a href="/gare/dettaglio.php?codice=101">Vedi</a>`) +
    rigaHome(102, "Servizio di portierato presso le sedi comunali (prova sintetica)", "<br>Affidamento con indagine di mercato", "https://appalti.comune.roma.it/gare/dettaglio.php?codice=102") +
    rigaHome(103, "Fornitura di cancelleria (prova sintetica)", "<br>Affidamento diretto", "/gare/dettaglio.php?codice=103&amp;lang=it") +
    rigaHome(104, "Servizio di vigilanza (prova sintetica)", "<br>Contratto applicativo dell'accordo quadro") +
    rigaHome(105, "Lavori di rifacimento del manto stradale (prova sintetica)", `<br><a href="/documenti/bando-105.pdf">Bando</a>`) +
    `<tr><td>Pubblicato</td><td><a href="https://altro.esempio.invalid/gare/dettaglio.php?codice=777">Altra piattaforma</a></td></tr>` +
    `</tbody></table>`,
);
const HOME_VUOTA = pagina(`<table class="gare"><tbody><tr><td>Nessuna gara pubblicata</td></tr></tbody></table>`);
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
    [E.cig]: "B11111111A<br>B22222222B",
    [E.cup]: "J11J26000000001",
    [E.pubblicazione]: "20/11/2026",
    [E.scadenza]: "15/12/2026 12:00",
    [E.categorie]: "<ul><li>90910000-9 - Servizi di pulizia</li><li>9091 - Servizi di pulizia (codice troncato)</li></ul>",
    [E.beneficiario]: "Roma Capitale – Dipartimento sintetico",
    [E.stato]: "Pubblicato",
  }),
  102: pagina(
    `<p><strong>${E.oggetto}:</strong> Servizio di portierato presso le sedi comunali (prova sintetica)</p><p><strong>${E.procedura}:</strong> Affidamento con indagine di mercato</p><p><strong>${E.scadenza}:</strong> 10/12/2026 ore 12.00</p><p><strong>${E.stato}:</strong> Pubblicato</p>`,
  ),
  105: dettaglio({ [E.oggetto]: "Lavori di rifacimento del manto stradale (prova sintetica)", [E.procedura]: "Procedura aperta", [E.tipologia]: "Lavori", [E.scadenza]: "15/12/2026 12:00", [E.cig]: "B55555555E" }),
};

// ═════ A. anagrafica e identità ═════
function provaAnagrafica(): void {
  const attive = istanzeAttiveTuttoGare();
  controlla("pilota: 5 istanze attive (Roma, Uniba, Regione Siciliana da R4; due centrali di committenza da D3), host unici e minuscoli", attive.length === 5 && new Set(attive.map((i) => i.host)).size === 5 && attive.every((i) => i.host === i.host.toLowerCase()) && attive.filter((i) => i.scoperta === "R4").length === 3, attive.map((i) => i.host));
  controlla("anagrafica: NESSUN codice fiscale scritto (vengono dall'IPA o dal CIG via PVL, mai indovinati) e mappe dei beneficiari vuote finché il campione non le conferma", ISTANZE_TUTTOGARE.every((i) => i.ente.codiceFiscale === null && Object.keys(i.beneficiari).length === 0));
  controlla("anagrafica: Roma e Uniba enti singoli, le centrali a più enti; regione da confermare dove non è certa (null, mai presunta)", !ROMA.multiEnte && !UNIBA.multiEnte && SICILIA.multiEnte && ROMA.regione === "lazio" && UNIBA.regione === "puglia" && SICILIA.regione === "sicilia" && istanzaDaHost("cuccastellidellasapienza.tuttogare.it")?.regione === null);
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
  controlla("JSON interno: spento e senza indirizzo; canale «html»; mappa NON confermata", !CANALE_TUTTOGARE.jsonInterno.acceso && urlTabellaTuttoGare(ROMA) === null && CANALE_TUTTOGARE.canale === "html" && CANALE_TUTTOGARE.confermato === false);
  controlla("impronte del software: pagina con app.tuttogare.it o StudioAmica sì; pagina qualsiasi o testo non HTML no", sembraPaginaTuttoGare(HOME_ROMA) && sembraPaginaTuttoGare("<html><body>font StudioAmica.woff2</body></html>") && !sembraPaginaTuttoGare("<html><body>Verifica di sicurezza</body></html>") && !sembraPaginaTuttoGare('{"data":[]}'));
}

// ═════ C. home ═════
function provaHome(): void {
  const righe = leggiHomeTuttoGare(HOME_ROMA, ROMA);
  controlla("home: i 5 codici delle gare nell'ordine della pagina (un codice una volta, anche con due collegamenti; mai altre piattaforme, documenti o script)", JSON.stringify(righe.map((r) => r.codice)) === JSON.stringify(["101", "102", "103", "104", "105"]), righe.map((r) => r.codice));
  controlla("home: il testo della riga è quello della sua riga di tabella (oggetto e procedura), non della testata", /pulizia/.test(righe[0]?.testo ?? "") && /Procedura aperta/.test(righe[0]?.testo ?? "") && !/Menu/.test(righe[0]?.testo ?? "") && !/portierato/.test(righe[0]?.testo ?? ""), righe[0]);
  controlla("home: affidamenti dichiarati nella riga (affidamento diretto, contratto applicativo) → dettaglio non letto; gli altri sì", JSON.stringify(righe.map((r) => affidamentoNellaRiga(r.testo))) === JSON.stringify([false, false, true, true, false]) && !affidamentoNellaRiga("Affidamento diretto previa indagine di mercato"));
  controlla("home vuota: nessuna riga", leggiHomeTuttoGare(HOME_VUOTA, ROMA).length === 0);
  const aBlocchi = pagina(`<div class="gara"><h3><a href="/gare/dettaglio.php?codice=201">Pulizia A (prova sintetica)</a></h3><p>Scadenza 01/12/2026</p></div><div class="gara"><h3><a href="/gare/dettaglio.php?codice=202">Pulizia B (prova sintetica)</a></h3></div>`);
  const rb = leggiHomeTuttoGare(aBlocchi, ROMA);
  controlla("home senza tabella: il tratto tra i collegamenti vicini (nessuna riga confusa con la gara accanto)", rb.length === 2 && /Pulizia A/.test(rb[0].testo) && !/Pulizia B/.test(rb[0].testo) && /Pulizia B/.test(rb[1].testo) && !/Pulizia A/.test(rb[1].testo), rb);
  const json = leggiTabellaTuttoGare(JSON.stringify({ recordsTotal: 2, data: [["Pubblicato", "#9101", "B11111111A", '<a href="/gare/dettaglio.php?codice=101">Pulizia (prova sintetica)</a>'], { stato: "Pubblicato", link: '<a href="/gare/dettaglio.php?codice=102">Portierato</a>' }] }), ROMA);
  controlla("JSON interno (predisposto, spento): stessa forma di righe della home; formato inatteso → errore", "righe" in json && json.righe.map((r) => r.codice).join() === "101,102" && json.totale === 2 && "errore" in leggiTabellaTuttoGare("<html>", ROMA) && "errore" in leggiTabellaTuttoGare('{"rows":[]}', ROMA), json);
}

// ═════ D. dettaglio e campi ═════
function provaDettaglio(): void {
  const d = leggiDettaglioTuttoGare(DETTAGLI_ROMA[101]);
  controlla("dettaglio: i campi dichiarati dalle etichette (tabella), il valore fino all'etichetta seguente", d.oggetto === "Servizio di pulizia degli uffici comunali (prova sintetica)" && d.procedura === "Procedura aperta" && d.scadenza === "15/12/2026 12:00" && d.cig === "B11111111A | B22222222B" && /90910000-9/.test(d.categorie ?? "") && /9091 - /.test(d.categorie ?? ""), d);
  controlla("dettaglio: nessun campo fuori dalla mappa (referenti, email, telefoni scartati; la parola «Stato» del menu non è un'etichetta della gara)", !JSON.stringify(d).includes("esempio.invalid") && !JSON.stringify(d).includes("Persona Sintetica") && d.stato === "Pubblicato" && Object.keys(d).every((k) => k in ETICHETTE_TUTTOGARE), d);
  const d2 = leggiDettaglioTuttoGare(DETTAGLI_ROMA[102]);
  controlla("dettaglio: anche «Etichetta: valore» nella stessa riga", d2.oggetto === "Servizio di portierato presso le sedi comunali (prova sintetica)" && d2.procedura === "Affidamento con indagine di mercato" && d2.scadenza === "10/12/2026 ore 12.00", d2);
  controlla("dettaglio completo solo con oggetto e procedura (i campi obbligatori dichiarati)", dettaglioCompleto(d) && dettaglioCompleto(d2) && !dettaglioCompleto(leggiDettaglioTuttoGare(pagina("<p>Pagina senza etichette</p>"))));
  const s = scadenzaTuttoGare("15/12/2026 12:00");
  controlla("scadenza con l'ora italiana (inverno: 11:00 UTC), anche «ore 12.00» e data e ora in due celle", s?.iso === "2026-12-15T11:00:00.000Z" && s.oraIndicata && scadenzaTuttoGare("10/12/2026 ore 12.00")?.iso === "2026-12-10T11:00:00.000Z" && scadenzaTuttoGare("10/12/2026 | 12:00")?.iso === "2026-12-10T11:00:00.000Z" && scadenzaTuttoGare("1/7/2027 10:30")?.iso === "2027-07-01T08:30:00.000Z", s);
  controlla("scadenza senza ora o a mezzanotte: solo il giorno (l'ora non si presume mai); date impossibili o altre forme → null", scadenzaTuttoGare("15/12/2026")?.iso === null && scadenzaTuttoGare("15/12/2026 00:00")?.oraIndicata === false && scadenzaTuttoGare("31/02/2026") === null && scadenzaTuttoGare("2026-12-15") === null && scadenzaTuttoGare("15/12/2026 25:00") === null);
  controlla("importo: «€»/«euro» o con i decimali; un numero qualunque no", importoTuttoGare("€ 120.000,00") === 120000 && importoTuttoGare("Euro 35.000") === 35000 && importoTuttoGare("Lotto 1: 48.500,50 oltre IVA") === 48500.5 && importoTuttoGare("Lotto 1") === null && importoTuttoGare("") === null);
  controlla("CIG: uno per lotto, validi, senza doppioni", JSON.stringify(cigTuttoGare("B11111111A | B22222222B, B11111111A; AAAAAAAAAA")) === JSON.stringify(["B11111111A", "B22222222B"]));
  controlla("categorie → CPV (regola dichiarata): 8 cifre tali e quali, codici troncati completati con zeri; senza codice niente", cpvDaCategoriaTuttoGare("90910000-9 - Servizi di pulizia") === "90910000" && cpvDaCategoriaTuttoGare("9091 - Pulizia") === "90910000" && cpvDaCategoriaTuttoGare("45 - Lavori") === "45000000" && cpvDaCategoriaTuttoGare("Servizi di pulizia") === null && cpvDaCategoriaTuttoGare("1 - x") === null && JSON.stringify(cpvTuttoGare(d.categorie)) === JSON.stringify(["90910000"]));
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
  const castelli = leggiGaraTuttoGare(istanzaDaHost("cuccastellidellasapienza.tuttogare.it") as IstanzaTuttoGare, "9", leggiDettaglioTuttoGare(DETTAGLI_ROMA[101]), ADESSO) as BandoTuttoGare;
  controlla("istanza con la regione da confermare: gara senza regione, «regione» tra i mancanti (mai una regione presunta)", castelli.tipo === "bando" && castelli.regioni.length === 0 && castelli.record.ente.regione === null && castelli.mancanti.includes("regione"));
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
    await new LettoreTuttoGare(sessione(reteFinta(RISPOSTE_ROMA, richieste))).leggiIstanze([ROMA], {}, OGGI);
  } catch (e) {
    fermato = e instanceof ErroreFonte && /non confermata/.test(e.message) && !e.sospendi;
  }
  controlla("mappa NON confermata: il lettore si ferma PRIMA di qualunque richiesta", fermato && richieste.length === 0);
  try {
    canale.confermato = true;
    const r1: string[] = [];
    const l1 = await new LettoreTuttoGare(sessione(reteFinta(RISPOSTE_ROMA, r1))).leggiIstanze([ROMA], {}, OGGI);
    const roma = l1.istanze[0];
    controlla("lettura (simulata): home + 3 dettagli (101, 102, 105); affidamento diretto e contratto applicativo esclusi dalla riga senza dettaglio", r1.length === 4 && r1[0] === "https://appalti.comune.roma.it/" && roma.dettagli.map((d) => d.codice).join() === "101,102,105" && roma.esclusiDallaRiga.join() === "103,104" && l1.errori.length === 0, { r1, esclusi: roma?.esclusiDallaRiga });
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

// ═════ H. guardie: fuori da console, cron, programmatore e registro; mai in produzione ═════
function provaGuardie(): void {
  const tutte = Object.fromEntries(Object.values(VARIABILI_PRODUZIONE).map((v) => [v, "autorizzata"]));
  controlla("ambiente: «tuttogare» autorizzata sullo staging; in produzione MAI (nessuna variabile, nemmeno con tutte le altre)", (FONTI_RADAR as readonly string[]).includes("tuttogare") && !("tuttogare" in VARIABILI_PRODUZIONE) && fonteAutorizzata("tuttogare", "importazione", STAGING).ok && !fonteAutorizzata("tuttogare", "importazione", { ...PROD_DEPLOY, ...tutte, RADAR_TUTTOGARE_PRODUZIONE: "autorizzata" }).ok && !fonteAutorizzata("tuttogare", "notifiche", { ...PROD_DEPLOY, ...tutte }).ok);
  controlla("fuori dalle fonti regionali gestite (console, script dei giri) e dal registro dei giri (vincolo 0128: serve la sua migrazione)", !(FONTI_REGIONALI as readonly string[]).includes("tuttogare") && !(FONTI_ESECUZIONI as readonly string[]).includes("tuttogare"));
  controlla("nessun giro programmato: niente orari, righe cron, rotta o interruttore", !("tuttogare" in ORARI_GIRI) && !("tuttogare" in CRON_PROPOSTI) && !("tuttogare" in ROTTE_CRON) && !("tuttogare" in INTERRUTTORI_CRON) && !/tuttogare/i.test(leggi("vercel.json")) && !fs.existsSync(path.join(radice, "src/app/api/cron/radar-tuttogare")));
  const fuori = ["src/app/site-console", "src/lib/console", "src/components", "scripts/pianificazione", "supabase/migrations"].flatMap((d) => {
    const trovati: string[] = [];
    const giro = (rel: string) => {
      for (const v of fs.readdirSync(path.join(radice, rel), { withFileTypes: true })) {
        const r = `${rel}/${v.name}`;
        if (v.isDirectory()) giro(r);
        else if (/tuttogare/i.test(fs.readFileSync(path.join(radice, r), "utf8"))) trovati.push(r);
      }
    };
    giro(d);
    return trovati;
  });
  controlla("nessuna traccia in console, pagine dei clienti, programmatore e migrazioni (la migrazione si prepara DOPO)", fuori.length === 0, fuori);
  controlla("motore di unione: «tuttogare» tra le fonti unite, precedenza delle piattaforme; nessuna fonte nascosta di base (regola 48A/48E invariata)", FONTI_UNITE.includes("tuttogare") && PRECEDENZA_FONTI.tuttogare === PRECEDENZA_FONTI.sater && FONTI_NASCOSTE_PREDEFINITE.length === 0);
  controlla("nome e attribuzione della fonte uguali a quelli del connettore", NOME_FONTE.tuttogare === "TuttoGare" && ATTRIBUZIONE_FONTE.tuttogare === CANALE_TUTTOGARE.attribuzione);
  // decisione (b) del coordinamento (26/11): il vincolo di piattaforma_id della 0120 non si tocca; la forma TuttoGare non lo rispetta, quindi
  // piattaforma_id resta vuoto e l'identità sta nella chiave (3–200 caratteri, vincolo della 0109), che ci sta anche con l'host più lungo
  const vincolo0120 = leggi("supabase/migrations/0120_radar_multifonte.sql").match(/piattaforma_id ~ '([^']+)'/)?.[1] ?? "";
  controlla("schema invariato: la chiave TuttoGare non entra nel vincolo di piattaforma_id della 0120 (per questo resta vuoto) e sta nei 200 caratteri della chiave", vincolo0120 === "^[a-z0-9_]{2,40}:[0-9]{1,12}$" && !new RegExp(vincolo0120).test("tuttogare:appalti.comune.roma.it:101") && ISTANZE_TUTTOGARE.every((i) => `tuttogare:${i.host}:999999999999`.length <= 200), vincolo0120);
}

// ═════ I. giri col database in memoria ═════
async function provaGiri(): Promise<void> {
  const mondo = (tuttogare: "assente" | "accesa") => {
    const db = new DbFinto();
    const altre = FONTI_ESECUZIONI.map((f) => ({ fonte: f, attiva: false, ultimo_successo_il: null, cursore: null, blocco_fino_a: null, conteggi: {}, nascosta_ai_clienti: false, dati_aggiornati_al: null }));
    db.tabelle.radar_fonti_stato = tuttogare === "assente" ? altre : [...altre, { fonte: "tuttogare", attiva: true, ultimo_successo_il: null, cursore: null, blocco_fino_a: null, conteggi: {}, nascosta_ai_clienti: true, dati_aggiornati_al: null }];
    return db;
  };
  const primaRete = richiesteDiRete;
  const a = mondo("assente");
  const ra = await eseguiImportazioneRegionale(a as unknown as SupabaseClient, "tuttogare", { env: STAGING, adesso: () => ADESSO });
  controlla("staging SENZA la riga di TuttoGare: «fonte_spenta», nessuna gara, nessuna riga nel registro dei giri (fonte non ancora ammessa)", !ra.eseguita && ra.motivo === "fonte_spenta" && a.t("radar_procedure").length === 0 && a.t("radar_esecuzioni").length === 0 && !ra.esecuzione.scritta, ra);
  const tutte = Object.fromEntries(Object.values(VARIABILI_PRODUZIONE).map((v) => [v, "autorizzata"]));
  const b = mondo("accesa");
  const rb = await eseguiImportazioneRegionale(b as unknown as SupabaseClient, "tuttogare", { env: { ...PROD_DEPLOY, ...tutte, RADAR_CONTATTO_FONTI: "contatto@esempio.invalid" }, adesso: () => ADESSO });
  controlla("produzione, anche con la riga accesa e tutte le variabili: «ambiente_non_consentito», zero accessi al database", !rb.eseguita && rb.motivo === "ambiente_non_consentito" && b.richieste.length === 0, rb);
  const c = mondo("accesa");
  const rc = await eseguiImportazioneRegionale(c as unknown as SupabaseClient, "tuttogare", { env: STAGING, adesso: () => ADESSO });
  controlla("staging con la riga accesa ma mappa NON confermata: errore detto, nessuna gara, nessuna richiesta di rete", rc.eseguita && /non confermata/.test(rc.errore ?? "") && c.t("radar_procedure").length === 0 && richiesteDiRete === primaRete, rc.eseguita ? rc.errore : rc);

  const canale = CANALE_TUTTOGARE;
  const prima = canale.confermato;
  const attiveDiPrima = ISTANZE_TUTTOGARE.map((i) => i.attiva);
  try {
    canale.confermato = true;
    // solo Roma attiva (meno pause tra le richieste); le altre istanze tornano come prima nel finally
    for (const i of ISTANZE_TUTTOGARE) i.attiva = i.host === ROMA.host;
    const richieste: string[] = [];
    const vuote = Object.fromEntries(istanzeAttiveTuttoGare().filter((i) => i.host !== ROMA.host).map((i) => [`https://${i.host}/`, { testo: HOME_VUOTA }]));
    const rete = reteFinta({ ...RISPOSTE_ROMA, ...vuote }, richieste);
    const d = mondo("accesa");
    const r = await eseguiImportazioneRegionale(d as unknown as SupabaseClient, "tuttogare", { env: STAGING, adesso: () => ADESSO, fetchFn: rete, origine: "script", limiti: { pausaMs: 2_000, tentativi: 1 } });
    const gare = d.t("radar_procedure");
    controlla("giro (simulato, staging, solo Roma attiva): home + 3 dettagli, nessun errore; registro dei giri non scritto (fonte non ammessa dalla 0128)", r.eseguita && !r.errore && richieste.length === 4 && !r.esecuzione.scritta && d.t("radar_esecuzioni").length === 0, { r: r.eseguita ? { errore: r.errore, allarmi: r.allarmi } : r, richieste: richieste.length });
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
