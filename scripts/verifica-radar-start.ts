// Verifica del connettore START Toscana (Fase 2, terza priorità del documento 60; mandato del coordinamento del 26/11, proposta confermata):
// elenco HTML pubblico delle procedure aperte, nessun dettaglio; finestra del robots.txt in UTC (23:00–04:00) imposta a ogni giro e prima di
// ogni richiesta; scadenza e codice fiscale SOLO dall'unione per CIG con la PVL (nessuna richiesta nuova, il vuoto non sovrascrive);
// chiave «start:NNNNNN-AAAA» con piattaforma_id vuoto (decisione (b)); suggerimenti in console per stesso numero START (mai unioni); uscita
// dalle aperte (stato interno «sconosciuto») solo dopo un giro completo e riuscito, reversibile. Fuori da console, cron e programmatore;
// registro dei giri con la 0137 PROPOSTA (mai applicata). Tutti i dati sono [SINTETICI] (pagine HTML inventate con la forma descritta dalla
// ricognizione R2, enti e CIG di prova: «Comune di Provasintetica», «PRVSTART01»); nessuna rete (fetch vietato), database in memoria.
// Uso: npx tsx scripts/verifica-radar-start.ts → codice 0 se passa.
import fs from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CANALE_START,
  REGIONE_START,
  chiaveStart,
  consultazionePreliminare,
  dentroFinestraStart,
  elencoCompletoStart,
  enteStart,
  giroAmmessoStart,
  leggiElencoStart,
  leggiGaraStart,
  numeroStart,
  numeroStartDaUrl,
  opportunitaStart,
  percorsoAmmessoStart,
  sembraPaginaStart,
  statoNonApertoStart,
  tipoProceduraStart,
  totaleDichiaratoStart,
  transizioniStatoStart,
  urlElencoStart,
  urlSchedaStart,
  type BandoStart,
  type EsclusioneStart,
  type RigaElencoStart,
} from "../src/lib/radar/fonti/start-calcoli";
import { LettoreStart } from "../src/lib/radar/fonti/start";
import { SessioneFonte, ErroreFonte } from "../src/lib/radar/fonti/sessione-fonte";
import { idPiattaformaDaUrl, idPiattaformaDaUrlConnettore } from "../src/lib/radar/fonti/piattaforme-calcoli";
import { FONTI_RADAR, VARIABILI_PRODUZIONE, fonteAutorizzata } from "../src/lib/radar/ambiente";
import { FONTI_REGIONALI, bandoDaStart, rigaDaBandoRegionale } from "../src/lib/radar/importa-regionali-calcoli";
import { FONTI_ESECUZIONI, FONTI_REGISTRO, datiGiroRegionale } from "../src/lib/radar/esecuzioni-calcoli";
import { FONTI_ACCENDIBILI } from "./c8/accendi-regionale-staging";
import { CRON_PROPOSTI, INTERRUTTORI_CRON, ORARI_GIRI, ROTTE_CRON } from "../src/lib/radar/programmazione-calcoli";
import { FONTI_UNITE, PRECEDENZA_FONTI, SEDE_DELL_ENTE, provenienzaDa, unisciLotti, unisciVersione, type LottoUnito, type VersioneFonte } from "../src/lib/radar/unione-calcoli";
import { ATTRIBUZIONE_FONTE, FONTI_NASCOSTE_PREDEFINITE, NOME_FONTE, descriviAvvisoLetto } from "../src/lib/radar/fonti-gara-calcoli";
import { eseguiImportazioneRegionale } from "../src/lib/radar/importa-regionali";
import { DbFinto, type Riga } from "./lib/db-finto-motore";

let ok = 0;
const falliti: string[] = [];
function controlla(nome: string, condizione: boolean, dettaglio?: unknown): void {
  if (condizione) ok++;
  else falliti.push(`${nome}${dettaglio === undefined ? "" : ` → ${JSON.stringify(dettaglio).slice(0, 700)}`}`);
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
// dentro la finestra del robots.txt: 23:30 UTC (00:30 ora italiana d'inverno)
const NOTTE = new Date("2026-11-26T23:30:00Z");
const GIORNO = new Date("2026-11-26T12:00:00Z");
const OGGI_ROMA = "2026-11-27";

// ───── pagine [SINTETICHE] con i campi della ricognizione R2: tabella con intestazioni (ente, numero, oggetto, procedura, tipo, CIG, importo,
// stato, data di pubblicazione) e il collegamento alla scheda nella forma ufficiale; totale dichiarato «Risultati 1 - 10 di N» ─────
type RigaSintetica = { n: string; ente: string; oggetto: string; procedura: string; tipo: string; cig: string; importo: string; stato?: string; data?: string };
const pagina = (corpo: string) =>
  `<!DOCTYPE html><html lang="it"><head><title>START - Sistema Telematico Acquisti Regionale della Toscana (prova sintetica)</title></head><body><header>Regione Toscana · START · Iniziative</header>${corpo}<footer>Pagina di prova [SINTETICA]</footer></body></html>`;
const rigaTabella = (r: RigaSintetica) =>
  `<tr><td>${r.ente}</td><td>${r.n.replace("-", "/")}</td><td>${r.oggetto}</td><td>${r.procedura}</td><td>${r.tipo}</td><td>${r.cig}</td><td>${r.importo}</td><td>${r.stato ?? "In corso"}</td><td>${r.data ?? "20/11/2026"}</td><td><a href="/tendering/tenders/${r.n}/view/detail/1">Dettaglio</a></td></tr>`;
const tabella = (righe: readonly RigaSintetica[], totale: number | null, da = 1) =>
  pagina(
    `${totale === null ? "" : `<p class="risultati">Risultati ${da} - ${da + righe.length - 1} di ${totale} iniziative</p>`}<table class="table"><thead><tr><th>Ente</th><th>Numero</th><th>Oggetto</th><th>Procedura</th><th>Tipo</th><th>CIG</th><th>Importo</th><th>Stato</th><th>Data pubblicazione</th><th></th></tr></thead><tbody>${righe.map(rigaTabella).join("")}</tbody></table>`,
  );
const schedeBlocchi = (righe: readonly RigaSintetica[]) =>
  pagina(
    `<div class="lista">${righe
      .map((r) => `<div class="iniziativa"><h3><a href="https://start.toscana.it/tendering/tenders/${r.n}/view/detail/1">${r.oggetto}</a></h3><p>Ente: ${r.ente}</p><p>Procedura: ${r.procedura}</p><p>CIG: ${r.cig}</p><p>Importo: ${r.importo}</p></div>`)
      .join("")}</div>`,
  );

const ENTE = "Comune di Provasintetica";
// il giro: 12 righe (10 + 2 pagine), con ogni caso della regola delle opportunità
const ELENCO: RigaSintetica[] = [
  { n: "100001-2026", ente: ENTE, oggetto: "Servizio di pulizia degli uffici comunali", procedura: "Procedura aperta", tipo: "Servizi", cig: "PRVSTART01", importo: "€ 120.000,00" },
  { n: "100002-2026", ente: ENTE, oggetto: "Avviso di manifestazione di interesse per il servizio di ristorazione scolastica", procedura: "Procedura negoziata", tipo: "Manifestazione di interesse", cig: "n/a", importo: "€ 80.000,00" },
  { n: "100003-2026", ente: "Azienda sintetica di prova", oggetto: "Servizio di vigilanza armata delle sedi aziendali", procedura: "Procedura negoziata", tipo: "Servizi", cig: "PRVSTART03", importo: "€ 60.000,00" },
  { n: "100004-2026", ente: ENTE, oggetto: "Affidamento del servizio di facchinaggio per il trasloco degli uffici", procedura: "Affidamento diretto", tipo: "Servizi", cig: "PRVSTART04", importo: "€ 9.000,00" },
  { n: "100005-2026", ente: ENTE, oggetto: "Consultazione preliminare di mercato per il servizio di portierato", procedura: "Consultazione preliminare di mercato", tipo: "Servizi", cig: "n/a", importo: "" },
  { n: "100006-2026", ente: ENTE, oggetto: "Lavori di rifacimento della pavimentazione stradale di via Prova", procedura: "Procedura aperta", tipo: "Lavori", cig: "PRVSTART06", importo: "€ 900.000,00" },
  { n: "100007-2026", ente: ENTE, oggetto: "Servizio di portierato e reception della sede comunale", procedura: "Indagine di mercato", tipo: "Servizi", cig: "n/a", importo: "€ 40.000,00" },
  { n: "100008-2026", ente: ENTE, oggetto: "Servizio di pulizia e sanificazione delle scuole comunali", procedura: "Procedura negoziata previa pubblicazione del bando", tipo: "Servizi", cig: "PRVSTART08", importo: "€ 150.000,00" },
  { n: "100009-2026", ente: ENTE, oggetto: "Servizio di facchinaggio per le manifestazioni estive", procedura: "Richiesta di preventivi", tipo: "Servizi", cig: "PRVSTART09", importo: "€ 20.000,00" },
  { n: "100010-2026", ente: ENTE, oggetto: "Servizio di ristorazione aziendale per i dipendenti", procedura: "Procedura aperta", tipo: "Servizi", cig: "PRVSTART10", importo: "€ 300.000,00", stato: "Chiusa" },
  { n: "100011-2026", ente: ENTE, oggetto: "Concessione del servizio di bar e ristoro nel palazzo comunale", procedura: "Procedura aperta", tipo: "Servizi", cig: "PRVSTART11", importo: "€ 50.000,00" },
  { n: "100012-2026", ente: ENTE, oggetto: "Servizio di pulizia delle palestre comunali", procedura: "Procedura aperta", tipo: "Servizi", cig: "PRVSTART12", importo: "€ 70.000,00" },
];
const pagine = (righe: readonly RigaSintetica[], totale = righe.length): string[] => {
  const out: string[] = [];
  for (let i = 0; i < Math.max(righe.length, 1); i += 10) out.push(tabella(righe.slice(i, i + 10), totale, i + 1));
  return out;
};

// ═════ A. finestra del robots.txt, in UTC ═════
function provaFinestra(): void {
  const t = (iso: string) => dentroFinestraStart(new Date(iso));
  controlla("finestra: 23:00–04:00 UTC (dalle 23:00 incluse alle 04:00 escluse)", !t("2026-11-26T22:59:59Z") && t("2026-11-26T23:00:00Z") && t("2026-11-27T01:00:00Z") && t("2026-11-27T03:59:59Z") && !t("2026-11-27T04:00:00Z") && !t("2026-11-27T12:00:00Z"));
  controlla("finestra in UTC anche d'estate: 23:30 UTC di luglio (01:30 ora italiana) sì, 04:30 UTC (06:30 italiane) no", t("2026-07-01T23:30:00Z") && !t("2026-07-02T04:30:00Z"));
  controlla("un giro non parte a meno di 10 minuti dalla chiusura (03:51 UTC no, 03:49 UTC sì) né di giorno", !giroAmmessoStart(new Date("2026-11-27T03:51:00Z")) && giroAmmessoStart(new Date("2026-11-27T03:49:00Z")) && !giroAmmessoStart(GIORNO) && giroAmmessoStart(NOTTE));
}

// ═════ B. indirizzi ammessi: solo l'elenco delle aperte ═════
function provaIndirizzi(): void {
  controlla("indirizzi dell'elenco: pagina 1 senza parametri, pagina 2 con il parametro di pagina; pagine fuori misura → null", urlElencoStart(1) === "https://start.toscana.it/initiatives/list/" && urlElencoStart(2) === "https://start.toscana.it/initiatives/list/?page=2" && urlElencoStart(0) === null && urlElencoStart(201) === null && urlElencoStart(1.5) === null);
  controlla("ammessi: l'elenco e le sue pagine", percorsoAmmessoStart(urlElencoStart(1) as string) && percorsoAmmessoStart(urlElencoStart(16) as string));
  const vietati = [
    "http://start.toscana.it/initiatives/list/",
    "https://start.e.toscana.it/initiatives/list/",
    "https://www.start.toscana.it/initiatives/list/",
    "https://start.toscana.it/awards/list/",
    "https://start.toscana.it/initiatives/list/?page=2&stato=tutte",
    "https://start.toscana.it/initiatives/list/?page=due",
    urlSchedaStart("100001-2026"),
    "https://start.toscana.it/api/tenders/100001-2026",
    "https://start.toscana.it/initiatives/list/../awards/",
    "https://start.toscana.it:8443/initiatives/list/",
    "https://utente:segreto@start.toscana.it/initiatives/list/",
    "https://start.toscana.it/download/allegato.pdf",
    "non un indirizzo",
  ];
  controlla("vietati: http, start.e.toscana.it, www, esiti (/awards), parametri non dichiarati, la SCHEDA (API interna), /api/, porte, credenziali, download", vietati.every((u) => !percorsoAmmessoStart(u)), vietati.filter((u) => percorsoAmmessoStart(u)));
  // con un filtro delle aperte dichiarato (forma da confermare nella finestra): obbligatorio su ogni pagina
  const prima = CANALE_START.parametriAperte;
  (CANALE_START as { parametriAperte: Record<string, string> }).parametriAperte = { stato: "aperte" };
  try {
    const u1 = urlElencoStart(1) as string;
    const u2 = urlElencoStart(2) as string;
    controlla("con un filtro dichiarato: sempre presente, anche in pagina 2; senza il filtro l'elenco completo NON si chiede", u1 === "https://start.toscana.it/initiatives/list/?stato=aperte" && u2 === "https://start.toscana.it/initiatives/list/?stato=aperte&page=2" && percorsoAmmessoStart(u1) && percorsoAmmessoStart(u2) && !percorsoAmmessoStart("https://start.toscana.it/initiatives/list/") && !percorsoAmmessoStart("https://start.toscana.it/initiatives/list/?stato=tutte"), { u1, u2 });
  } finally {
    (CANALE_START as { parametriAperte: Record<string, string> }).parametriAperte = prima;
  }
  controlla("impronta della pagina: HTML che nomina START o la Regione Toscana; un JSON o una pagina qualunque no", sembraPaginaStart(tabella([], 0)) && !sembraPaginaStart('{"ok":true}') && !sembraPaginaStart("<html><body>Verifica di sicurezza</body></html>"));
}

// ═════ C. numero START, chiave e collegamenti (anche quelli di TED e PVL nell'archivio dello staging) ═════
function provaIdentita(): void {
  controlla("numero START: «NNNNNN-AAAA» o «NNNNNN/AAAA» → «NNNNNN-AAAA»; forme diverse no", numeroStart("038448-2026") === "038448-2026" && numeroStart("N. 038448/2026") === "038448-2026" && numeroStart("38448-2026") === null && numeroStart("0384489-2026") === null && numeroStart("038448-1999") === null && numeroStart("") === null);
  const forme: [string, string | null][] = [
    ["https://start.toscana.it/tendering/tenders/038448-2026/view/detail/1", "038448-2026"],
    ["http://start.toscana.it/tendering/tenders/025887-2026/view/detail/1", "025887-2026"],
    ["https://www.start.toscana.it/tendering/tenders/011426-2026/view/detail/1", "011426-2026"],
    ["https://start.toscana.it./tendering/tenders/006206-2026/view/detail/1", "006206-2026"],
    ["https://start.toscana.it/tendering/tenders/029996-2026/detail/create/1", "029996-2026"],
    ["https://start.toscana.it/tendering/tenders/xxxxx-2026/view/detail/1", null],
    ["https://start.toscana.it/tendering/tenders/025790/2026/view/detail/1", null],
    ["https://start.toscana.it/homepage", null],
    ["https://www.sanita.start.toscana.it/Application/CustomDoc/DettaglioProcedura.asp?ID=605003", null],
    ["https://start.e.toscana.it/tendering/tenders/038448-2026/view/detail/1", null],
    ["https://webs.rete.toscana.it/sitat/trasparenza/#/procedura?uuid=START_607ea271", null],
  ];
  controlla("numero dai collegamenti ufficiali (forme viste nell'archivio dello staging il 26/11): solo /tendering/tenders/NNNNNN-AAAA su start.toscana.it", forme.every(([u, n]) => numeroStartDaUrl(u) === n), forme.filter(([u, n]) => numeroStartDaUrl(u) !== n));
  // decisione (b): la chiave «start:NNNNNN-AAAA» NON rispetta il vincolo di piattaforma_id della 0120 → piattaforma_id vuoto, identità nella chiave
  const vincolo0120 = leggi("supabase/migrations/0120_radar_multifonte.sql").match(/piattaforma_id ~ '([^']+)'/)?.[1] ?? "";
  controlla("decisione (b): «start:038448-2026» non entra nel vincolo della 0120 (invariato); la chiave sta nei 3–200 caratteri della 0109", vincolo0120 === "^[a-z0-9_]{2,40}:[0-9]{1,12}$" && !new RegExp(vincolo0120).test(chiaveStart("038448-2026")) && chiaveStart("038448-2026") === "start:038448-2026", vincolo0120);
  controlla("i collegamenti START NON diventano piattaforma_id in TED, PVL e nei connettori (nessun cambiamento per le fonti online)", idPiattaformaDaUrl(urlSchedaStart("038448-2026")) === null && idPiattaformaDaUrlConnettore(urlSchedaStart("038448-2026")) === null);
}

// ═════ D. elenco: tabella con intestazioni, blocchi, totale dichiarato ═════
function provaElenco(): void {
  const e = leggiElencoStart(tabella(ELENCO.slice(0, 10), 12));
  const r1 = e.righe[0];
  controlla("tabella: 10 righe, totale dichiarato 12, formato «tabella»", e.formato === "tabella" && e.righe.length === 10 && e.totaleDichiarato === 12, { formato: e.formato, n: e.righe.length, totale: e.totaleDichiarato });
  controlla("riga: numero dalla colonna («100001/2026» → «100001-2026»), campi per intestazione, collegamento nella forma ufficiale", r1.numero === "100001-2026" && r1.ente === ENTE && r1.oggetto === "Servizio di pulizia degli uffici comunali" && r1.procedura === "Procedura aperta" && r1.tipo === "Servizi" && r1.cig === "PRVSTART01" && r1.importo === "€ 120.000,00" && r1.stato === "In corso" && r1.pubblicazione === "20/11/2026" && r1.collegamento === urlSchedaStart("100001-2026"), r1);
  controlla("impronta della riga: stessa riga stessa impronta, un campo diverso impronta diversa", leggiElencoStart(tabella(ELENCO.slice(0, 1), 1)).righe[0].impronta === r1.impronta && leggiElencoStart(tabella([{ ...ELENCO[0], importo: "€ 121.000,00" }], 1)).righe[0].impronta !== r1.impronta);
  // colonne in un altro ordine: si leggono per nome
  const invertita = pagina(`<table><tr><th>Oggetto</th><th>CIG</th><th>N°</th><th>Amministrazione</th><th>Tipo di procedura</th></tr><tr><td>Servizio di pulizia</td><td>PRVSTART01</td><td>100001/2026</td><td>${ENTE}</td><td>Procedura aperta</td></tr></table>`);
  const ri = leggiElencoStart(invertita).righe[0];
  controlla("colonne in un altro ordine e con altri nomi: lette per nome", ri?.numero === "100001-2026" && ri.oggetto === "Servizio di pulizia" && ri.cig === "PRVSTART01" && ri.ente === ENTE && ri.procedura === "Procedura aperta" && ri.collegamento === null, ri);
  const b = leggiElencoStart(schedeBlocchi(ELENCO.slice(0, 3)));
  controlla("blocchi senza tabella: oggetto dal collegamento alla scheda, campi «Etichetta: valore», un blocco per numero", b.formato === "blocchi" && b.righe.length === 3 && b.righe[1].numero === "100002-2026" && b.righe[1].oggetto === ELENCO[1].oggetto && b.righe[1].procedura === "Procedura negoziata" && b.righe[1].cig === "n/a" && b.righe[0].importo === "€ 120.000,00", b.righe);
  controlla("pagina senza procedure: nessuna riga, formato «nessuno»", leggiElencoStart(pagina("<p>Nessuna iniziativa</p>")).formato === "nessuno" && leggiElencoStart(tabella([], 0)).totaleDichiarato === 0);
  controlla("totale dichiarato: «di N iniziative», «N risultati trovati», migliaia col punto; senza → null", totaleDichiaratoStart(pagina("Risultati 1 - 10 di 1.154 iniziative")) === 1154 && totaleDichiaratoStart(pagina("154 risultati trovati")) === 154 && totaleDichiaratoStart(pagina("Elenco")) === null);
}

// ═════ E. tipo di opportunità e regole d'ingresso ═════
function provaOpportunita(): void {
  const t = (p: string, ti: string, o: string) => opportunitaStart(p, ti, o)?.tipo ?? null;
  const casi: [string, string, string, string | null][] = [
    ["Procedura aperta", "Servizi", "Servizio di pulizia", "bando"],
    ["Procedura ristretta", "Servizi", "Servizio di pulizia", "bando"],
    ["Procedura negoziata", "Servizi", "Servizio di vigilanza", "riservata"],
    ["Procedura negoziata previa pubblicazione del bando", "Servizi", "Servizio di pulizia", "bando"],
    ["Procedura negoziata previa indagine di mercato", "Servizi", "Servizio di pulizia", "riservata"],
    ["Procedura negoziata", "Manifestazione di interesse", "Servizio di ristorazione", "manifestazione_interesse"],
    ["Procedura negoziata", "Servizi", "Avviso di manifestazione di interesse per il servizio di ristorazione", "manifestazione_interesse"],
    ["Indagine di mercato", "Servizi", "Servizio di portierato", "indagine_mercato"],
    ["", "", "Avviso esplorativo per il servizio di portierato", "manifestazione_interesse"],
    ["", "", "Servizio di pulizia", null],
    ["Affidamento diretto", "Servizi", "Servizio di facchinaggio", "affidamento_diretto"],
    ["Affidamento diretto", "Servizi", "Indagine di mercato per il servizio di facchinaggio", "indagine_mercato"],
    ["Richiesta di preventivi", "Servizi", "Servizio di facchinaggio", null],
    ["Richiesta di preventivi aperta", "Servizi", "Servizio di facchinaggio", "indagine_mercato"],
    ["Albo fornitori", "Servizi", "Iscrizione all'elenco degli operatori", "sistema_qualificazione"],
    ["Appalto specifico SDA", "Servizi", "Servizio di pulizia", "riservata"],
    ["Consultazione preliminare di mercato", "Servizi", "Servizio di portierato", null],
    ["Concorso di progettazione", "Servizi", "Progettazione", null],
  ];
  const sbagliati = casi.filter(([p, ti, o, atteso]) => t(p, ti, o) !== atteso).map(([p, ti, o, atteso]) => ({ p, ti, o, atteso, avuto: t(p, ti, o) }));
  controlla("opportunità: aperte → bando; negoziata riservata salvo previa pubblicazione o candidatura dichiarata; manifestazioni e indagini → candidature; affidamenti fuori; richiesta di preventivi solo se aperta; albo → iscrizione; consultazioni preliminari e valori sconosciuti → nessuna (mai indovinare)", sbagliati.length === 0, sbagliati);
  controlla("consultazione preliminare riconosciuta in procedura, tipo o oggetto", consultazionePreliminare("Consultazione preliminare di mercato", "", "") && consultazionePreliminare("", "", "Avviso di consultazione preliminare") && !consultazionePreliminare("Procedura aperta", "Servizi", "Servizio di pulizia"));
  controlla("procedura nella forma dell'archivio", tipoProceduraStart("Procedura aperta") === "Procedura aperta" && tipoProceduraStart("Procedura negoziata previa pubblicazione") === "Procedura negoziata" && tipoProceduraStart("Richiesta di preventivi aperta") === null && tipoProceduraStart("") === null);
  controlla("stato dell'elenco: «In corso» e vuoto aperti; chiusa, scaduta, aggiudicata, revocata, sospesa no", !statoNonApertoStart("In corso") && !statoNonApertoStart(null) && ["Chiusa", "Scaduta", "Aggiudicata", "Revocata", "Sospesa", "Annullata"].every(statoNonApertoStart));
  controlla("ente: il nome com'è scritto, comune solo da «Comune di …», mai un codice fiscale", JSON.stringify(enteStart("COMUNE DI PROVASINTETICA")) === JSON.stringify({ denominazione: "COMUNE DI PROVASINTETICA", comune: "Provasintetica" }) && enteStart(ENTE).comune === "Provasintetica" && enteStart("Azienda USL di prova").comune === null && enteStart("").denominazione === null);
}

// ═════ F. una riga → bando o esclusione; la riga per l'archivio ═════
function provaGara(): void {
  const righe = leggiElencoStart(tabella(ELENCO.slice(0, 10), 12)).righe.concat(leggiElencoStart(tabella(ELENCO.slice(10), 12, 11)).righe);
  const lette = new Map(righe.map((r) => [r.numero, leggiGaraStart(r, NOTTE)]));
  const motivo = (n: string) => {
    const g = lette.get(n);
    return g?.tipo === "esclusione" ? g.motivo : g?.tipo;
  };
  const attesi: Record<string, string> = {
    "100001-2026": "bando",
    "100002-2026": "bando",
    "100003-2026": "riservata",
    "100004-2026": "affidamento",
    "100005-2026": "consultazione_preliminare",
    "100006-2026": "fuori_settore",
    "100007-2026": "bando",
    "100008-2026": "bando",
    "100009-2026": "tipo_sconosciuto",
    "100010-2026": "non_aperta",
    "100011-2026": "bando",
    "100012-2026": "bando",
  };
  const diversi = Object.entries(attesi).filter(([n, m]) => motivo(n) !== m).map(([n, m]) => ({ n, atteso: m, avuto: motivo(n), regole: (lette.get(n) as EsclusioneStart | undefined)?.regole }));
  controlla("le 12 righe sintetiche: 6 entrano (bandi e candidature nei settori), le altre escluse col motivo giusto", diversi.length === 0, diversi);
  const b1 = lette.get("100001-2026") as BandoStart;
  const r = b1.record;
  controlla("bando: chiave «start:100001-2026», id_fonte = numero, scadenza VUOTA senza ora (mai presunta), ente senza codice fiscale, Toscana, collegamento ufficiale, lotto dal CIG", r.chiaveProcedura === "start:100001-2026" && r.idFonte === "100001-2026" && r.scadenzaGiorno === null && r.scadenzaOfferte === null && r.scadenzaOraIndicata === false && r.ente.codiceFiscale === null && r.ente.denominazione === ENTE && r.ente.comune === "Provasintetica" && r.ente.regione === REGIONE_START && r.urlDocumenti === urlSchedaStart("100001-2026") && r.lotti.length === 1 && r.lotti[0].cig === "PRVSTART01" && r.valoreBase === 120000 && r.dataPubblicazione === "2026-11-20" && r.tipoAvviso === "Bando" && r.tipoProcedura === "Procedura aperta" && b1.lottiScadenze.every((s) => s === null) && b1.mancanti.includes("scadenza") && b1.mancanti.includes("codice_fiscale_ente"), { r, mancanti: b1.mancanti });
  const b2 = lette.get("100002-2026") as BandoStart;
  controlla("candidatura senza CIG («n/a»): manifestazione di interesse, nessun lotto, CIG mancante (mai inventato), tipo «Avviso»", b2.opportunita.tipo === "manifestazione_interesse" && b2.record.lotti.length === 0 && b2.mancanti.includes("cig") && b2.record.tipoAvviso === "Avviso", { opp: b2.opportunita, lotti: b2.record.lotti, mancanti: b2.mancanti });
  const reg = bandoDaStart(b1, OGGI_ROMA);
  const riga = reg ? rigaDaBandoRegionale(reg, NOTTE) : null;
  controlla("per l'archivio: piattaforma_id VUOTO (decisione (b)), chiave della gara «start:…», versione del giorno, scadenza vuota", !!reg && !!riga && reg.piattaformaId === null && reg.versione.giorno === OGGI_ROMA && reg.versione.fonte === "start" && riga.chiave === "start:100001-2026" && riga.piattaforma_id === null && riga.scadenza_giorno === null && riga.scadenza_offerte === null && riga.scadenza_ora_indicata === false && riga.sa_codice_fiscale === null && riga.tipo_opportunita === "bando", riga);
  const senzaNumero: RigaElencoStart = { ...righe[0], numero: "100001/2026" };
  controlla("riga con un numero non nella forma canonica: esclusa senza identificativo", (leggiGaraStart(senzaNumero, NOTTE) as EsclusioneStart).motivo === "senza_identificativo");
}

// ═════ G. INVARIANTE «il vuoto non sovrascrive»: una gara START senza scadenza non azzera la scadenza di una gara PVL ═════
function rigaPvlSintetica(): ReturnType<typeof rigaDaBandoRegionale> {
  const b = leggiGaraStart(leggiElencoStart(tabella(ELENCO.slice(0, 1), 1)).righe[0], NOTTE) as BandoStart;
  const base = rigaDaBandoRegionale(bandoDaStart(b, OGGI_ROMA)!, NOTTE);
  return { ...base, chiave: "pvl:PRV-SINTETICA-0001", oggetto: "Servizio di pulizia degli uffici comunali (avviso PVL sintetico)", sa_codice_fiscale: "00000000001", sa_denominazione: ENTE, sa_comune: "Provasintetica", sa_provincia: "Prova", sa_regione: "toscana", scadenza_giorno: "2026-12-15", scadenza_offerte: "2026-12-15T08:00:00.000Z", scadenza_ora_indicata: true, scadenza_fonte: "Bando (PVL sintetica)", valore_base: null, valore_stimato: 118000 };
}
const VERSIONE_PVL: VersioneFonte = { fonte: "pvl", id: "PVL-SINTETICO-1", giorno: "2026-11-20", istante: "2026-11-20T10:00:00.000Z", ted: null };

function provaInvariante(): void {
  const pvl = rigaPvlSintetica();
  const prov = Object.fromEntries(["scadenza", "valore_stimato", "oggetto", "ente", "luogo", "url_documenti", "tipo_procedura"].map((g) => [g, provenienzaDa(VERSIONE_PVL)]));
  const b = leggiGaraStart(leggiElencoStart(tabella(ELENCO.slice(0, 1), 1)).righe[0], NOTTE) as BandoStart;
  const reg = bandoDaStart(b, OGGI_ROMA)!;
  const nuova = rigaDaBandoRegionale(reg, NOTTE);
  // la versione START è del giorno dopo: PIÙ RECENTE della PVL (il caso peggiore per l'invariante)
  const e = unisciVersione(pvl, prov, nuova, reg.versione, NOTTE.toISOString());
  controlla("INVARIANTE (gara): la versione START più recente e SENZA scadenza lascia giorno, istante, ora indicata e fonte della scadenza della PVL", e.riga.scadenza_giorno === "2026-12-15" && e.riga.scadenza_offerte === "2026-12-15T08:00:00.000Z" && e.riga.scadenza_ora_indicata === true && e.riga.scadenza_fonte === "Bando (PVL sintetica)" && !e.campiPresi.includes("scadenza") && !e.cambiamenti.some((c) => c.campo === "scadenza_offerte"), { scad: [e.riga.scadenza_giorno, e.riga.scadenza_offerte, e.riga.scadenza_ora_indicata], presi: e.campiPresi, cambi: e.cambiamenti });
  controlla("INVARIANTE (ente): il codice fiscale della PVL resta, il nome dell'ente non si perde; il comune della PVL non si toglie (START non indica la sede)", e.riga.sa_codice_fiscale === "00000000001" && e.riga.sa_denominazione === ENTE && e.riga.sa_comune === "Provasintetica" && e.riga.sa_provincia === "Prova" && SEDE_DELL_ENTE.start === false, { cf: e.riga.sa_codice_fiscale, comune: e.riga.sa_comune, provincia: e.riga.sa_provincia });
  controlla("INVARIANTE (oggetto e valore): la PVL resta prima per l'oggetto (precedenza 4 > 3); il valore stimato della PVL resta; la base d'asta START riempie il vuoto", e.riga.oggetto === pvl.oggetto && e.riga.valore_stimato === 118000 && e.riga.valore_base === 120000 && PRECEDENZA_FONTI.start === 3 && PRECEDENZA_FONTI.pvl === 4, { oggetto: e.riga.oggetto, vs: e.riga.valore_stimato, vb: e.riga.valore_base });
  const lottoPvl: LottoUnito = { numero_lotto: "LOT-0001", cig: "PRVSTART01", oggetto: null, cpv_principale: null, cpv_tutti: [], valore_stimato: 118000, durata_mesi: null, scadenza_giorno: "2026-12-15", scadenza_offerte: "2026-12-15T08:00:00.000Z", scadenza_ora_indicata: true, scadenza_fonte: "Bando (PVL sintetica)", url_documenti: "https://pvl.example.invalid/avviso" };
  const lottoStart: LottoUnito = { ...lottoPvl, valore_stimato: null, scadenza_giorno: null, scadenza_offerte: null, scadenza_ora_indicata: false, scadenza_fonte: null, url_documenti: urlSchedaStart("100001-2026") };
  const l = unisciLotti([lottoPvl], [lottoStart], "start", true);
  controlla("INVARIANTE (lotto): lo stesso CIG da START senza scadenza non toglie la scadenza del lotto PVL (anche con la versione START più recente)", l.lotti.length === 1 && l.lotti[0].scadenza_giorno === "2026-12-15" && l.lotti[0].scadenza_offerte === "2026-12-15T08:00:00.000Z" && l.lotti[0].scadenza_ora_indicata === true, l.lotti);
}

// ═════ H. giro completo e uscita dalle aperte (1c) ═════
function provaTransizioni(): void {
  controlla("giro completo: totale dichiarato raggiunto, o ultima pagina corta senza totale; mai con un errore o una pagina ripetuta", elencoCompletoStart({ pagine: 2, numeri: 12, ultimaPaginaRighe: 2, totaleDichiarato: 12, paginaRipetuta: false, errore: false }) && !elencoCompletoStart({ pagine: 1, numeri: 10, ultimaPaginaRighe: 10, totaleDichiarato: 12, paginaRipetuta: false, errore: false }) && elencoCompletoStart({ pagine: 2, numeri: 12, ultimaPaginaRighe: 2, totaleDichiarato: null, paginaRipetuta: false, errore: false }) && !elencoCompletoStart({ pagine: 1, numeri: 10, ultimaPaginaRighe: 10, totaleDichiarato: null, paginaRipetuta: false, errore: false }) && !elencoCompletoStart({ pagine: 2, numeri: 12, ultimaPaginaRighe: 2, totaleDichiarato: 12, paginaRipetuta: false, errore: true }) && !elencoCompletoStart({ pagine: 2, numeri: 12, ultimaPaginaRighe: 2, totaleDichiarato: 12, paginaRipetuta: true, errore: false }) && !elencoCompletoStart({ pagine: 0, numeri: 0, ultimaPaginaRighe: 0, totaleDichiarato: 0, paginaRipetuta: false, errore: false }));
  const g = (id: string, chiave: string, stato: string, scadenza: string | null, fonti: string[]) => ({ id, chiave, stato, scadenza_giorno: scadenza, fonti });
  const gare = [
    g("A", "start:200001-2026", "aperta", null, ["start"]), // solo START, sparita → esce
    g("B", "start:200002-2026", "aperta", null, ["start"]), // solo START, ancora nell'elenco → resta
    g("C", "pvl:PRV-1", "aperta", "2026-12-15", ["pvl", "start"]), // unita alla PVL, sparita → resta (ha la scadenza e un'altra fonte)
    g("D", "start:200004-2026", "aperta", null, ["start", "ted"]), // con un'altra fonte, senza scadenza → resta
    g("E", "start:200005-2026", "aperta", "2026-12-20", ["start"]), // con una scadenza → resta
    g("F", "start:200006-2026", "sconosciuto", null, ["start"]), // uscita prima, riappare → rientra
    g("G", "start:200007-2026", "sconosciuto", "2026-12-30", ["start", "pvl"]), // uscita prima, ora ha una scadenza dalla PVL → rientra
    g("H", "start:200008-2026", "sconosciuto", null, ["start"]), // uscita prima, ancora assente → resta fuori
    g("I", "start:200009-2026", "annullata", null, ["start"]), // annullata: mai toccata
    g("J", "ted:700001-2026", "aperta", null, ["ted"]), // senza START: mai toccata
  ];
  const inElenco = new Set(["200002-2026", "200006-2026"]);
  const t = transizioniStatoStart(gare, inElenco, true);
  controlla("giro completo e riuscito: esce SOLO la gara nata da START, unica fonte, senza scadenza, sparita dall'elenco; rientrano quelle riapparse o con una scadenza", JSON.stringify(t) === JSON.stringify({ escono: ["A"], rientrano: ["F", "G"] }), t);
  const t2 = transizioniStatoStart(gare, inElenco, false);
  controlla("giro NON completo (una pagina in errore): nessuna gara esce; il rientro sì (evidenza positiva)", JSON.stringify(t2) === JSON.stringify({ escono: [], rientrano: ["F", "G"] }), t2);
}

// ═════ I. lettore (rete finta, pagine sintetiche) ═════
type Risposta = { stato?: number; testo: string; url?: string };
function reteFinta(risposte: Record<string, Risposta>, richieste: string[]): typeof fetch {
  return (async (url: string | URL | Request) => {
    const u = String(url);
    richieste.push(u);
    const r = risposte[u] ?? { stato: 404, testo: "non trovata" };
    return { status: r.stato ?? 200, url: r.url ?? u, headers: new Headers({ "content-type": "text/html" }), text: async () => r.testo } as unknown as Response;
  }) as typeof fetch;
}
const sessione = (fetchFn: typeof fetch, richiesteMassime = 24) => new SessioneFonte("START", { pausaMs: 0, timeoutMs: 5_000, tentativi: 1, richiesteMassime }, fetchFn);
const risposteDa = (htmls: readonly string[]): Record<string, Risposta> => Object.fromEntries(htmls.map((h, i) => [urlElencoStart(i + 1) as string, { testo: h }]));

async function provaLettore(): Promise<void> {
  const primaRete = richiesteDiRete;
  const prima = CANALE_START.confermato;
  // struttura non confermata: nessuna richiesta
  const r0: string[] = [];
  let fermo0 = "";
  try {
    CANALE_START.confermato = false;
    await new LettoreStart(sessione(reteFinta(risposteDa(pagine(ELENCO)), r0)), () => NOTTE).leggiElenco();
  } catch (e) {
    fermo0 = e instanceof Error ? e.message : String(e);
  }
  controlla("struttura NON confermata: il lettore si ferma prima di qualunque richiesta", /non confermata/.test(fermo0) && r0.length === 0, { fermo0, richieste: r0.length });
  CANALE_START.confermato = true;
  try {
    // fuori dalla finestra: nessuna richiesta
    const rg: string[] = [];
    let fermoG = "";
    try {
      await new LettoreStart(sessione(reteFinta(risposteDa(pagine(ELENCO)), rg)), () => GIORNO).leggiElenco();
    } catch (e) {
      fermoG = e instanceof Error ? e.message : String(e);
    }
    controlla("di giorno (12:00 UTC): il lettore si ferma prima di qualunque richiesta (robots.txt, Visit-time)", /finestra/.test(fermoG) && rg.length === 0, { fermoG, richieste: rg.length });
    // giro completo: 2 pagine (10 + 2), totale 12
    const r1: string[] = [];
    const l1 = await new LettoreStart(sessione(reteFinta(risposteDa(pagine(ELENCO)), r1)), () => NOTTE).leggiElenco();
    controlla("giro completo: 2 richieste (le 2 pagine dell'elenco, nient'altro), 12 righe, completo", l1.completo && l1.pagine === 2 && l1.righe.length === 12 && r1.length === 2 && r1[0] === urlElencoStart(1) && r1[1] === urlElencoStart(2) && l1.interruzione === null && l1.totaleDichiarato === 12, { completo: l1.completo, pagine: l1.pagine, righe: l1.righe.length, richieste: r1 });
    // senza totale dichiarato: si ferma alla pagina corta
    const r1b: string[] = [];
    const l1b = await new LettoreStart(sessione(reteFinta(risposteDa([tabella(ELENCO.slice(0, 10), null), tabella(ELENCO.slice(10), null)]), r1b)), () => NOTTE).leggiElenco();
    controlla("senza totale dichiarato: si ferma alla pagina corta, completo", l1b.completo && l1b.pagine === 2 && l1b.righe.length === 12, { completo: l1b.completo, pagine: l1b.pagine });
    // pagina 2 in errore (500): righe della pagina 1, NON completo
    const r2: string[] = [];
    const l2 = await new LettoreStart(sessione(reteFinta({ [urlElencoStart(1) as string]: { testo: pagine(ELENCO)[0] }, [urlElencoStart(2) as string]: { stato: 500, testo: "errore" } }, r2)), () => NOTTE).leggiElenco();
    controlla("pagina 2 in errore (500): 10 righe lette, giro NON completo, motivo detto", !l2.completo && l2.righe.length === 10 && /500/.test(l2.interruzione ?? ""), { completo: l2.completo, righe: l2.righe.length, interruzione: l2.interruzione });
    // pagina ripetuta (parametro di pagina ignorato dal sito): NON completo
    const r3: string[] = [];
    const l3 = await new LettoreStart(sessione(reteFinta({ [urlElencoStart(1) as string]: { testo: pagine(ELENCO)[0] }, [urlElencoStart(2) as string]: { testo: pagine(ELENCO)[0] } }, r3)), () => NOTTE).leggiElenco();
    controlla("pagina 2 uguale alla 1 (parametro non riconosciuto): ferma, NON completo, nessun doppione", !l3.completo && l3.paginaRipetuta && l3.righe.length === 10, { completo: l3.completo, ripetuta: l3.paginaRipetuta });
    // finestra che si chiude durante il giro: la pagina 2 non si chiede
    const orari = [new Date("2026-11-27T03:49:00Z"), new Date("2026-11-27T03:49:30Z"), new Date("2026-11-27T04:00:01Z")];
    let i = 0;
    const r4: string[] = [];
    const l4 = await new LettoreStart(sessione(reteFinta(risposteDa(pagine(ELENCO)), r4)), () => orari[Math.min(i++, orari.length - 1)]).leggiElenco();
    controlla("finestra chiusa a metà giro (04:00 UTC): la pagina 2 NON si chiede, giro non completo", !l4.completo && r4.length === 1 && /finestra/.test(l4.interruzione ?? ""), { richieste: r4.length, interruzione: l4.interruzione });
    // 403: sospensione (si ferma tutto il giro)
    let sosp = false;
    try {
      await new LettoreStart(sessione(reteFinta({ [urlElencoStart(1) as string]: { stato: 403, testo: "vietato" } }, [])), () => NOTTE).leggiElenco();
    } catch (e) {
      sosp = e instanceof ErroreFonte && e.sospendi;
    }
    controlla("403 dalla fonte: sospensione, nessun nuovo tentativo", sosp);
    // reindirizzamento all'accesso: sospensione
    let rinv = false;
    try {
      await new LettoreStart(sessione(reteFinta({ [urlElencoStart(1) as string]: { testo: pagine(ELENCO)[0], url: "https://start.toscana.it/login" } }, [])), () => NOTTE).leggiElenco();
    } catch (e) {
      rinv = e instanceof ErroreFonte && e.sospendi && /reindirizzato/.test(e.message);
    }
    controlla("reindirizzamento fuori dall'elenco (pagina di accesso): sospensione", rinv);
    // prima pagina senza procedure riconoscibili e senza totale zero: formato cambiato → sospensione
    let formato = false;
    try {
      await new LettoreStart(sessione(reteFinta({ [urlElencoStart(1) as string]: { testo: pagina("<div>START — nuova grafica</div>") } }, [])), () => NOTTE).leggiElenco();
    } catch (e) {
      formato = e instanceof ErroreFonte && e.sospendi && /formato/.test(e.message);
    }
    controlla("prima pagina senza procedure riconoscibili: sospensione (formato da confermare), nessuna scrittura", formato);
    // elenco vuoto dichiarato: nessuna sospensione, completo
    const l5 = await new LettoreStart(sessione(reteFinta({ [urlElencoStart(1) as string]: { testo: tabella([], 0) } }, [])), () => NOTTE).leggiElenco();
    controlla("elenco che si dichiara vuoto (0 iniziative): nessuna sospensione, completo", l5.completo && l5.righe.length === 0);
    // tetto delle richieste: non completo
    const molte = Array.from({ length: 40 }, (_, k) => ({ ...ELENCO[0], n: `3${String(k).padStart(5, "0")}-2026` }));
    const r6: string[] = [];
    const l6 = await new LettoreStart(sessione(reteFinta(risposteDa(pagine(molte)), r6), 2), () => NOTTE).leggiElenco();
    controlla("tetto delle richieste (2) prima della fine: si ferma, NON completo", !l6.completo && r6.length === 2 && /tetto/.test(l6.interruzione ?? ""), { richieste: r6.length, interruzione: l6.interruzione });
  } finally {
    CANALE_START.confermato = prima;
  }
  controlla("nessuna richiesta alla rete vera nel lettore", richiesteDiRete === primaRete, richiesteDiRete - primaRete);
}

// ═════ J. guardie: solo staging, fuori da console, cron e programmatore; 0137 proposta; testi ═════
function provaGuardie(): void {
  const tutte = Object.fromEntries(Object.values(VARIABILI_PRODUZIONE).map((v) => [v as string, "autorizzata"]));
  controlla("ambiente: «start» tra le fonti del radar SENZA variabile di produzione: staging sì, produzione MAI (nemmeno con tutte le variabili), anteprima e locale mai", (FONTI_RADAR as readonly string[]).includes("start") && VARIABILI_PRODUZIONE.start === undefined && fonteAutorizzata("start", "importazione", STAGING).ok && !fonteAutorizzata("start", "importazione", { ...PROD_DEPLOY, ...tutte, RADAR_START_PRODUZIONE: "autorizzata" }).ok && !fonteAutorizzata("start", "notifiche", { ...PROD_DEPLOY, ...tutte }).ok && !fonteAutorizzata("start", "importazione", { ...PROD_DEPLOY, VERCEL_ENV: "preview", ...tutte }).ok);
  controlla("fuori da console, allarmi e cron (FONTI_REGIONALI, FONTI_ESECUZIONI); nel registro dei giri (FONTI_REGISTRO, con la 0137) e negli script dello staging", !(FONTI_REGIONALI as readonly string[]).includes("start") && !(FONTI_ESECUZIONI as readonly string[]).includes("start") && (FONTI_REGISTRO as readonly string[]).includes("start") && (FONTI_ACCENDIBILI as readonly string[]).includes("start") && /\[\.\.\.FONTI_REGIONALI, "start"\]/.test(leggi("scripts/radar-importa-regionale.ts")));
  const vercel = JSON.parse(leggi("vercel.json")) as { crons: { path: string }[] };
  controlla("nessun cron: niente in vercel.json, nessuna rotta, niente in orari, cron proposti, rotte e interruttori del programmatore", !vercel.crons.some((c) => /start/i.test(c.path)) && !fs.existsSync(path.join(radice, "src/app/api/cron/radar-start")) && !("start" in ORARI_GIRI) && !("start" in CRON_PROPOSTI) && !("start" in ROTTE_CRON) && !("start" in INTERRUTTORI_CRON));
  controlla("motore di unione: «start» tra le fonti unite, precedenza delle piattaforme, NON indica la sede; nessuna fonte nascosta di base (regola 48A/48E invariata)", FONTI_UNITE.includes("start") && PRECEDENZA_FONTI.start === PRECEDENZA_FONTI.sater && SEDE_DELL_ENTE.start === false && FONTI_NASCOSTE_PREDEFINITE.length === 0);
  controlla("nome e attribuzione uguali a quelli del connettore; la scheda della gara «START, procedura NNNNNN-AAAA»", NOME_FONTE.start === "START" && ATTRIBUZIONE_FONTE.start === CANALE_START.attribuzione && descriviAvvisoLetto({ fonte: "start", id_fonte: "038448-2026", tipo_avviso: "Procedura aperta" }) === "START, procedura 038448-2026");
  // la 0137 PROPOSTA (mai applicata): vincolo del registro con TUTTE le fonti di prima più «start», riga spenta, nascosta, semaforo chiuso
  const sql = leggi("supabase/migrations/0137_radar_fonte_start.sql");
  const istruzioni = sql.split("\n").filter((r) => !/^\s*--/.test(r)).join("\n");
  controlla("0137 proposta: vincolo del registro = le 6 fonti + «start»; riga «start» spenta, nascosta, semaforo 2099, «on conflict do nothing»; niente su radar_procedure né su piattaforma_id; nessuna istruzione distruttiva", istruzioni.includes("check (fonte in ('ted', 'pvl', 'sintel', 'sardegnacat', 'sater', 'tuttogare', 'start'))") && istruzioni.includes("values ('start', false, true, '2099-01-01T00:00:00Z')") && /on conflict \(fonte\) do nothing/.test(istruzioni) && !/radar_procedure\b|piattaforma_id/.test(istruzioni) && /^begin;$/m.test(istruzioni) && /^commit;$/m.test(istruzioni) && !/\bdrop table\b|\bdelete\b|\btruncate\b|\bupdate\b/i.test(istruzioni) && /0137/.test(istruzioni));
  const conStart = fs.readdirSync(path.join(radice, "supabase/migrations")).filter((f) => /'start'/.test(fs.readFileSync(path.join(radice, "supabase/migrations", f), "utf8")));
  controlla("nessun'altra migrazione nomina la fonte «start»", JSON.stringify(conStart) === JSON.stringify(["0137_radar_fonte_start.sql"]), conStart);
  // nessun codice usa la scheda (API interna) né ore presunte
  const codice = ["src/lib/radar/fonti/start-calcoli.ts", "src/lib/radar/fonti/start.ts"].map(leggi).join("\n").split("\n").filter((r) => !/^\s*(\/\/|\*|\/\*\*)/.test(r)).join("\n");
  controlla("nessuna ora presunta (23:59, fine giornata) e nessuna lettura della scheda o dell'API interna nel connettore", !/23:59|fineGiornoRoma|T22:59|T21:59/.test(codice) && !/\/api\//.test(codice.replace('p.includes("/api/")', "")) && !/urlSchedaStart\([^)]*\)\s*\)?\s*;?\s*\n?[^\n]*sessione\.leggi/.test(codice));
  controlla("il registro dei giri: un giro chiesto fuori finestra non scrive nessuna riga", datiGiroRegionale({ eseguita: false, motivo: "fuori_finestra" }) === null);
}

// ═════ K. giri col database in memoria (staging simulato, pagine sintetiche) ═════
function mondo(start: "assente" | "accesa" | "spenta_0137" | "accesa_0137"): DbFinto {
  const db = new DbFinto();
  const altre = FONTI_ESECUZIONI.map((f) => ({ fonte: f, attiva: false, ultimo_successo_il: null, cursore: null, blocco_fino_a: null, conteggi: {}, nascosta_ai_clienti: false, dati_aggiornati_al: null }));
  const blocco = start.endsWith("_0137") ? "2099-01-01T00:00:00.000Z" : null;
  db.tabelle.radar_fonti_stato = start === "assente" ? altre : [...altre, { fonte: "start", attiva: start.startsWith("accesa"), ultimo_successo_il: null, cursore: null, blocco_fino_a: blocco, conteggi: {}, nascosta_ai_clienti: true, dati_aggiornati_al: null }];
  // il trigger della 0120: radar_procedure.fonti = le fonti della provenienza (si aggiungono, non si tolgono)
  db.dopoScrittura = (tabella) => {
    if (tabella !== "radar_procedure_fonti" && tabella !== "radar_procedure") return;
    for (const p of db.t("radar_procedure")) {
      const da = db.t("radar_procedure_fonti").filter((f) => f.procedura_id === p.id).map((f) => String(f.fonte));
      const prima = Array.isArray(p.fonti) ? (p.fonti as string[]) : [];
      const tutte = [...new Set([...prima, ...da])];
      if (tutte.length !== prima.length) p.fonti = tutte;
    }
  };
  return db;
}

// l'archivio: una gara PVL con il CIG PRVSTART01 (scadenza con ora, codice fiscale) e una gara TED senza CIG col collegamento START 100007-2026
function archivio(db: DbFinto): void {
  const pvl = rigaPvlSintetica();
  const prov = Object.fromEntries(["scadenza", "valore_stimato", "oggetto", "ente", "luogo", "url_documenti", "tipo_procedura"].map((g) => [g, provenienzaDa(VERSIONE_PVL)]));
  db.tabelle.radar_procedure = [
    { ...pvl, id: "G-PVL", url_documenti: "https://pvl.example.invalid/avviso", piattaforma_host: "pvl.example.invalid", provenienza_campi: prov, unita_a: null, fonti: ["pvl"], ultima_versione_il: "2026-11-20", ultima_versione_id: "pvl:PVL-SINTETICO-1" } as Riga,
    { ...pvl, id: "G-TED", chiave: "ted:700001-2026", oggetto: "Servizio di portierato e reception (bando TED sintetico)", sa_codice_fiscale: "00000000001", url_documenti: urlSchedaStart("100007-2026"), piattaforma_host: "start.toscana.it", scadenza_giorno: "2026-12-20", scadenza_offerte: "2026-12-20T11:00:00.000Z", provenienza_campi: {}, unita_a: null, fonti: ["ted"], ultima_versione_il: "2026-11-19", ultima_versione_id: "ted:700001-2026" } as Riga,
  ];
  db.tabelle.radar_lotti = [{ id: "L-PVL", procedura_id: "G-PVL", numero_lotto: "LOT-0001", cig: "PRVSTART01", oggetto: null, cpv_principale: null, cpv_tutti: [], valore_stimato: 118000, durata_mesi: null, scadenza_giorno: "2026-12-15", scadenza_offerte: "2026-12-15T08:00:00.000Z", scadenza_ora_indicata: true, scadenza_fonte: "Bando (PVL sintetica)", url_documenti: "https://pvl.example.invalid/avviso" }];
  db.tabelle.radar_procedure_fonti = [
    { id: "F-PVL", procedura_id: "G-PVL", fonte: "pvl", id_fonte: "PVL-SINTETICO-1", id_procedura_fonte: "PVL-PROC-1", url: "https://pvl.example.invalid/avviso", impronta: "pvl-sintetica", rilevato_il: "2026-11-20T10:00:00Z" },
    { id: "F-TED", procedura_id: "G-TED", fonte: "ted", id_fonte: "700001-2026", id_procedura_fonte: "700001-2026", url: "https://ted.example.invalid/700001-2026", impronta: "ted-sintetica", rilevato_il: "2026-11-19T10:00:00Z" },
  ];
}

async function provaGiri(): Promise<void> {
  const primaRete = richiesteDiRete;
  // fuori dalla finestra: nessun accesso al database, nessuna richiesta, nessuna riga del registro
  const g = mondo("accesa");
  const rg = await eseguiImportazioneRegionale(g as unknown as SupabaseClient, "start", { env: STAGING, adesso: () => GIORNO });
  controlla("giro di giorno (12:00 UTC, anche a mano): «fuori_finestra», zero accessi al database (nemmeno il registro), zero richieste", !rg.eseguita && rg.motivo === "fuori_finestra" && g.richieste.length === 0 && richiesteDiRete === primaRete, { rg, db: g.richieste.length });
  const a = mondo("assente");
  const ra = await eseguiImportazioneRegionale(a as unknown as SupabaseClient, "start", { env: STAGING, adesso: () => NOTTE });
  const regA = a.t("radar_esecuzioni");
  controlla("staging SENZA la riga di START (0137 non applicata): «fonte_spenta», nessuna gara, nessuna richiesta; nel registro la riga «inerte» (nel database vero solo dopo la 0137)", !ra.eseguita && ra.motivo === "fonte_spenta" && a.t("radar_procedure").length === 0 && regA.length === 1 && regA[0].fonte === "start" && regA[0].esito === "inerte", { ra, regA });
  const tutte = Object.fromEntries(Object.values(VARIABILI_PRODUZIONE).map((v) => [v as string, "autorizzata"]));
  const b = mondo("accesa");
  const rb = await eseguiImportazioneRegionale(b as unknown as SupabaseClient, "start", { env: { ...PROD_DEPLOY, ...tutte, RADAR_START_PRODUZIONE: "autorizzata", RADAR_CONTATTO_FONTI: "contatto@esempio.invalid" }, adesso: () => NOTTE });
  controlla("produzione (anche con tutte le variabili e una RADAR_START_PRODUZIONE inventata): «ambiente_non_consentito», zero accessi al database", !rb.eseguita && rb.motivo === "ambiente_non_consentito" && b.richieste.length === 0, rb);
  const o = mondo("accesa_0137");
  const ro = await eseguiImportazioneRegionale(o as unknown as SupabaseClient, "start", { env: STAGING, adesso: () => NOTTE });
  controlla("staging, START accesa ma con il semaforo 2099 della 0137: «occupata» (lo apre solo il lanciatore autorizzato)", !ro.eseguita && ro.motivo === "occupata", ro);
  const c = mondo("accesa");
  const rc = await eseguiImportazioneRegionale(c as unknown as SupabaseClient, "start", { env: STAGING, adesso: () => NOTTE });
  controlla("struttura NON confermata (com'è nel codice oggi): errore detto, nessuna gara, nessuna richiesta di rete", rc.eseguita && /non confermata/.test(rc.errore ?? "") && c.t("radar_procedure").length === 0 && richiesteDiRete === primaRete, rc.eseguita ? rc.errore : rc);

  const prima = CANALE_START.confermato;
  CANALE_START.confermato = true;
  try {
    const d = mondo("accesa");
    archivio(d);
    const limiti = { pausaMs: 3_000, tentativi: 1 };
    // ── giro 1: le 12 righe (2 pagine)
    const richieste1: string[] = [];
    const r1 = await eseguiImportazioneRegionale(d as unknown as SupabaseClient, "start", { env: STAGING, adesso: () => NOTTE, fetchFn: reteFinta(risposteDa(pagine(ELENCO)), richieste1), origine: "script", limiti });
    const gare = d.t("radar_procedure");
    const perChiave = (k: string) => gare.find((x) => x.chiave === k);
    const gp = perChiave("pvl:PRV-SINTETICA-0001");
    controlla("giro 1 (simulato, staging, notte): 2 richieste (solo le 2 pagine), nessun errore, una riga «ok» di «start» nel registro (nel database vero dopo la 0137)", r1.eseguita && !r1.errore && richieste1.length === 2 && r1.esecuzione.scritta && d.t("radar_esecuzioni").length === 1 && d.t("radar_esecuzioni")[0].fonte === "start" && d.t("radar_esecuzioni")[0].esito === "ok", { r1: r1.eseguita ? { errore: r1.errore, allarmi: r1.allarmi, esclusi: r1.statistiche.esclusi } : r1, richieste: richieste1.length, reg: d.t("radar_esecuzioni") });
    controlla("UNIONE PER CIG (nessuna richiesta nuova): la riga START col CIG PRVSTART01 entra nella gara PVL, nessuna gara «start:100001-2026»", !perChiave("start:100001-2026") && (gp?.fonti as string[] | undefined)?.includes("start") === true && d.t("radar_procedure_fonti").some((f) => f.fonte === "start" && f.procedura_id === "G-PVL"), { fonti: gp?.fonti });
    controlla("INVARIANTE nel giro: la gara PVL tiene scadenza, ora indicata, codice fiscale e comune (START non li ha)", gp?.scadenza_giorno === "2026-12-15" && gp?.scadenza_offerte === "2026-12-15T08:00:00.000Z" && gp?.scadenza_ora_indicata === true && gp?.sa_codice_fiscale === "00000000001" && gp?.sa_comune === "Provasintetica" && d.t("radar_lotti").find((l) => l.cig === "PRVSTART01")?.scadenza_offerte === "2026-12-15T08:00:00.000Z", { scad: gp?.scadenza_offerte, ora: gp?.scadenza_ora_indicata, cf: gp?.sa_codice_fiscale, lotto: d.t("radar_lotti").find((l) => l.cig === "PRVSTART01") });
    const nuove = gare.filter((x) => String(x.chiave).startsWith("start:")).map((x) => String(x.chiave)).sort();
    controlla("gare nuove solo START: le 5 righe nei settori senza gara già in archivio (candidature senza CIG comprese)", JSON.stringify(nuove) === JSON.stringify(["start:100002-2026", "start:100007-2026", "start:100008-2026", "start:100011-2026", "start:100012-2026"]), nuove);
    const g2 = perChiave("start:100002-2026");
    controlla("gara solo START: scadenza VUOTA senza ora, piattaforma_id vuoto, codice fiscale vuoto, Toscana, collegamento ufficiale, aperta, candidatura", g2?.scadenza_giorno === null && g2?.scadenza_offerte === null && g2?.scadenza_ora_indicata === false && g2?.piattaforma_id === null && g2?.sa_codice_fiscale === null && g2?.sa_regione === "toscana" && g2?.url_documenti === urlSchedaStart("100002-2026") && g2?.stato === "aperta" && g2?.tipo_opportunita === "manifestazione_interesse", g2);
    const proposte = d.t("radar_aggiornamenti").filter((x) => x.campo === "collegamento_proposto");
    const g7 = perChiave("start:100007-2026");
    controlla("SUGGERIMENTO (mai unione): la gara START 100007-2026 e la gara TED senza CIG con lo stesso numero START nel collegamento; nessuna unione automatica", proposte.length === 2 && proposte.every((x) => x.fonte === "start" && x.notificabile === false) && proposte.some((x) => x.procedura_id === g7?.id && x.valore_nuovo === "G-TED") && !gare.some((x) => x.unita_a) && r1.eseguita && r1.statistiche.proposte === 1, { proposte, g7: g7?.id });
    controlla("esclusi contati: riservata, affidamento, consultazione preliminare, tipo sconosciuto, non aperta, fuori settore", r1.eseguita && r1.statistiche.esclusi.riservata === 1 && r1.statistiche.esclusi.affidamento === 1 && r1.statistiche.esclusi.consultazione_preliminare === 1 && r1.statistiche.esclusi.tipo_sconosciuto === 1 && r1.statistiche.esclusi.non_aperta === 1 && (r1.statistiche.esclusi.fuori_settore ?? 0) + Object.entries(r1.statistiche.esclusi).filter(([k]) => k.startsWith("esclusa_per_oggetto")).reduce((n, [, v]) => n + v, 0) === 1, r1.eseguita ? r1.statistiche.esclusi : r1);
    controlla("nessuna email e nessun evento del motore delle notifiche; nessuna riga del registro notificabile", d.t("omnia_ai_radar_eventi").length === 0 && d.t("omnia_ai_radar_email_consegne").length === 0 && !d.t("radar_aggiornamenti").some((x) => x.notificabile === true || x.notifica_email === true));
    const stato1 = d.t("radar_fonti_stato").find((x) => x.fonte === "start") as { conteggi: { ultimo_giro?: { start?: unknown } }; ultimo_successo_il: string | null; blocco_fino_a: string | null };
    controlla("dopo il giro: blocco libero, ultimo successo scritto, esito START nei conteggi (nessuna uscita)", stato1.blocco_fino_a === null && !!stato1.ultimo_successo_il && JSON.stringify(stato1.conteggi.ultimo_giro?.start) === JSON.stringify({ escono: 0, rientrano: 0, proposte: 1, numeroStart: 1 }), stato1.conteggi.ultimo_giro?.start);

    // ── giro 2, COMPLETO: spariscono 100002 (solo START, senza scadenza) e 100001 (unita alla PVL, con scadenza)
    const elenco2 = ELENCO.filter((r) => r.n !== "100002-2026" && r.n !== "100001-2026");
    const registroPrima = d.t("radar_aggiornamenti").length;
    controlla("registro dopo il giro 1: una riga «nuova» per ognuna delle 5 gare nuove (NON notificabile: fonte nascosta) e i 2 lati del suggerimento", d.t("radar_aggiornamenti").filter((x) => x.tipo === "nuova").length === 5 && registroPrima === 7, d.t("radar_aggiornamenti").map((x) => [x.tipo, x.campo, x.notificabile]));
    const richieste2: string[] = [];
    const r2 = await eseguiImportazioneRegionale(d as unknown as SupabaseClient, "start", { env: STAGING, adesso: () => new Date(NOTTE.getTime() + 3 * 3600_000), fetchFn: reteFinta(risposteDa(pagine(elenco2)), richieste2), origine: "script", limiti });
    controlla("giro 2 completo: la gara SOLO START sparita esce dalle aperte («sconosciuto», etichetta «Stato non indicato»; mai «scaduta»); la gara PVL sparita da START resta aperta con la sua scadenza", r2.eseguita && !r2.errore && perChiave("start:100002-2026")?.stato === "sconosciuto" && gp?.stato === "aperta" && gp?.scadenza_offerte === "2026-12-15T08:00:00.000Z" && gare.filter((x) => x.stato === "sconosciuto").length === 1, { r2: r2.eseguita ? { errore: r2.errore, allarmi: r2.allarmi } : r2, stati: gare.map((x) => [x.chiave, x.stato]) });
    controlla("l'uscita non scrive nel registro e non notifica (nessuna riga nuova nel giro 2: righe invariate, suggerimento già registrato)", d.t("radar_aggiornamenti").length === registroPrima, d.t("radar_aggiornamenti").length - registroPrima);

    // ── giro 3, NON completo (pagina 2 in errore): 100002 riappare (rientra), 100011 manca ma NON esce
    const elenco3 = ELENCO.filter((r) => r.n !== "100011-2026");
    const p3 = pagine(elenco3);
    const richieste3: string[] = [];
    const r3 = await eseguiImportazioneRegionale(d as unknown as SupabaseClient, "start", { env: STAGING, adesso: () => new Date(NOTTE.getTime() + 24 * 3600_000), fetchFn: reteFinta({ [urlElencoStart(1) as string]: { testo: p3[0] }, [urlElencoStart(2) as string]: { stato: 500, testo: "errore" } }, richieste3), origine: "script", limiti });
    controlla("giro 3 NON completo (pagina 2 in errore): allarme «elenco_non_completo»; la gara riapparsa torna aperta; la gara mancante NON esce", r3.eseguita && r3.allarmi.includes("elenco_non_completo") && perChiave("start:100002-2026")?.stato === "aperta" && perChiave("start:100011-2026")?.stato === "aperta" && !gare.some((x) => x.stato === "sconosciuto"), { r3: r3.eseguita ? { errore: r3.errore, allarmi: r3.allarmi } : r3, stati: gare.map((x) => [x.chiave, x.stato]) });
    controlla("tre giri: 2 + 1 (10 righe, totale 10 raggiunto alla prima pagina) + 2 richieste, tutte all'elenco (mai schede, esiti o API)", richieste1.length === 2 && richieste2.length === 1 && richieste3.length === 2 && [...richieste1, ...richieste2, ...richieste3].every((u) => percorsoAmmessoStart(u)), [richieste1.length, richieste2.length, richieste3.length]);
  } finally {
    CANALE_START.confermato = prima;
  }
  controlla("nessuna richiesta alla rete vera in tutta la verifica", richiesteDiRete === primaRete, richiesteDiRete - primaRete);
}

async function principale(): Promise<void> {
  provaFinestra();
  provaIndirizzi();
  provaIdentita();
  provaElenco();
  provaOpportunita();
  provaGara();
  provaInvariante();
  provaTransizioni();
  await provaLettore();
  provaGuardie();
  await provaGiri();
}
principale()
  .catch((e) => falliti.push(`eccezione: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`))
  .finally(() => {
    console.log(`Verifica del connettore START Toscana (Fase 2): ${ok} ok, ${falliti.length} falliti`);
    for (const f of falliti) console.log(`  FALLITO: ${f}`);
    process.exit(falliti.length ? 1 : 0);
  });
