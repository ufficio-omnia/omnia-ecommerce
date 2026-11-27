// Verifica dei connettori EmPULIA e SIAPS (Fase 2; istanze del connettore AF Soluzioni; decisioni del coordinamento del 26–27/11): feed
// PUBBLICATI (indirizzi della ricognizione del 27/11), pagine EmPULIA cambiando SOLO nPag, feed delle consultazioni, regole estese SOLO per
// queste due istanze (SardegnaCAT e SATER identiche), identità «empulia:<IdMsg>» e «siaps:<IdMsg>», collegamento SIAPS ufficiale dei BT-15,
// suggerimenti SIAPS per stesso IdMsg (mai unioni), reindirizzamenti contati come richieste, 0138 e 0139 PROPOSTE (mai applicate); dal 27/11
// in produzione come SATER e TuttoGare, tutto spento di base (variabile RADAR_<FONTE>_PRODUZIONE, interruttore del cron, riga spenta e nascosta). Dati [SINTETICI] (feed inventati con la forma vista il 27/11, enti e
// CIG di prova: «Comune di Provasintetica», «PRVAF00001»); nessuna rete (fetch vietato), database in memoria.
// Uso: npx tsx scripts/verifica-radar-empulia-siaps.ts → codice 0 se passa.
import fs from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ISTANZE_AFLINK, NAMESPACE_AFLINK, idSiapsDaUrl, leggiElementoAflink, opportunitaAflinkEstesa, urlPaginaAflink, type BandoAflink, type ElementoAflink, type EsclusioneAflink, type IstanzaAflink } from "../src/lib/radar/fonti/aflink-calcoli";
import { LettoreAflink } from "../src/lib/radar/fonti/aflink";
import { SessioneFonte } from "../src/lib/radar/fonti/sessione-fonte";
import { FONTI_RADAR, VARIABILI_PRODUZIONE, fonteAutorizzata } from "../src/lib/radar/ambiente";
import { FONTI_REGIONALI, bandoDaAflink, rigaDaBandoRegionale } from "../src/lib/radar/importa-regionali-calcoli";
import { FONTI_ESECUZIONI, FONTI_REGISTRO } from "../src/lib/radar/esecuzioni-calcoli";
import { FONTI_ACCENDIBILI } from "./c8/accendi-regionale-staging";
import { CRON_PROPOSTI, INTERRUTTORI_CRON, ORARI_GIRI, ROTTE_CRON } from "../src/lib/radar/programmazione-calcoli";
import { FONTI_UNITE, PRECEDENZA_FONTI, SEDE_DELL_ENTE, provenienzaDa, type VersioneFonte } from "../src/lib/radar/unione-calcoli";
import { ATTRIBUZIONE_FONTE, NOME_FONTE, descriviAvvisoLetto } from "../src/lib/radar/fonti-gara-calcoli";
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
const ADESSO = new Date("2026-11-27T10:00:00Z");
const OGGI = "2026-11-27";
const EMPULIA = ISTANZE_AFLINK.empulia;
const SIAPS = ISTANZE_AFLINK.siaps;
const URL_CONSULTAZIONI = "https://eproc.empulia.it/portale/rss_bandi_consultazione.asp";

// ───── feed [SINTETICI] con la forma vista il 27/11 ─────
type Voce = Partial<ElementoAflink> & { IdMsg: string; Oggetto: string };
const xml = (voci: readonly Voce[], totale: number | null) =>
  `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:afs="${NAMESPACE_AFLINK}"><channel><title>Feed di prova [SINTETICO]</title>${totale === null ? "" : `<afs:totRecord>${totale}</afs:totRecord>`}${voci
    .map((v) => `<item>${Object.entries(v).filter(([k]) => k !== "link").map(([k, x]) => `<afs:${k}><![CDATA[${x}]]></afs:${k}>`).join("")}${v.link ? `<link><![CDATA[${v.link}]]></link>` : ""}</item>`)
    .join("")}</channel></rss>`;
const ENTE = "Comune di Provasintetica";
const voceEmpulia = (id: number, oggetto: string, extra: Partial<ElementoAflink> = {}): Voce => ({
  IdMsg: String(id),
  Oggetto: oggetto,
  Tipo: "Bando",
  DenominazioneEnte: ENTE,
  DtScadenzaBandoTecnical: "2026-12-15T12:00:00",
  DtPubblicazioneTecnical: "2026-11-20T09:00:00",
  dataUltimaModifica: "2026-11-25T10:00:00",
  statoFunzionale: "PresOfferte",
  Contratto: "Servizi",
  CPV: "90911200-8 - Servizi di pulizia di edifici",
  a_base_asta: "100.000,00",
  link: `http://www.empulia.it/tno-a/empulia/Empulia/SitePages/New_Dettaglio Bando di Gara.aspx?getdettaglio=yes&bando=${id}&tipobando=Bando&RicQ=NO&VisQ=SI&tipoDoc=BANDO_GARA_PORTALE&xslt=XSLT_BANDO_GARA_PORTALE`,
  ...extra,
});
const voceConsultazione = (id: number, oggetto: string, scadenza = "2026-12-09T10:00:00"): Voce => ({
  IdMsg: String(id),
  Oggetto: oggetto,
  Tipo: "Consultazione Preliminare di Mercato",
  DenominazioneEnte: "ASL di prova [SINTETICA]",
  DtScadenzaBandoTecnical: scadenza,
  DtPubblicazioneTecnical: "2026-11-20T09:00:00",
  dataUltimaModifica: "2026-11-21T10:00:00",
  link: `https://eproc.empulia.it/portale/index.php/?getdettaglio=yes&bando=${id}&tipobando=Consultazione Preliminare di Mercato&RicQ=NO&VisQ=SI&tipoDoc=BANDO_CONSULTAZIONE`,
});
const voceSiaps = (id: number, oggetto: string, tipo = "Bando"): Voce => ({
  IdMsg: String(id),
  Oggetto: oggetto,
  Tipo: tipo,
  DenominazioneEnte: "Azienda sanitaria di prova [SINTETICA]",
  DtScadenzaBandoTecnical: "2026-12-10T12:00:00",
  DtPubblicazioneTecnical: "2026-11-20T09:00:00",
  statoFunzionale: tipo === "Bando" ? "PresOfferte" : "",
  Contratto: tipo === "Bando" ? "Servizi" : "",
  CPV: tipo === "Bando" ? "55320000-9 - Servizi di distribuzione pasti" : "",
  a_base_asta: tipo === "Bando" ? "250.000,00" : "",
  // il link del feed (http, risultava rotto): NON si usa
  link: `http://siaps.soresa.it/portale/index.php/bandi?getdettaglio=yes&bando=${id}&tipobando=${tipo}&RicQ=NO&VisQ=SI&tipoDoc=BANDO_GARA&xslt=XSLT_BANDO`,
});

// ═════ A. istanze: indirizzi pubblicati, regole SOLO per EmPULIA e SIAPS ═════
function provaIstanze(): void {
  controlla("EmPULIA: indirizzi PUBBLICATI della pagina «Feed Rss» (bandi a pagine con nPag, consultazioni), Puglia, identità dall'IdMsg, http solo verso www.empulia.it", EMPULIA.urlFeed === "https://eproc.empulia.it/portale/rss_bandi.asp?FilterHide=bScaduto=0+and+tipo<>'Esito'+&numRowForPag=20&nPag=1" && EMPULIA.paginaFeed === "http://www.empulia.it/tno-a/empulia/Empulia/SitePages/Feed%20Rss.aspx" && JSON.stringify(EMPULIA.feedAggiuntivi) === JSON.stringify([URL_CONSULTAZIONI]) && EMPULIA.regione === "puglia" && EMPULIA.idMsgEIdPiattaforma && EMPULIA.collegamentiHttp && EMPULIA.host === "www.empulia.it" && EMPULIA.paginazione?.perPagina === 20 && EMPULIA.regoleEstese === true && EMPULIA.contaReindirizzamenti === true);
  controlla("SIAPS: indirizzo PUBBLICATO del feed (stessa forma di SardegnaCAT), Campania, identità dall'IdMsg, niente http, collegamento ufficiale ricostruito dall'IdMsg", SIAPS.urlFeed === "https://siaps.soresa.it/portale/rss_bandi.asp?FilterHide=bScaduto%3D0+and+tipo%3C%3E%27Esito%27+&sort=DtScadenzaBandoTecnical&sortorder=asc" && SIAPS.paginaFeed === "https://siaps.soresa.it/portalegare/index.php/feed-rss" && SIAPS.regione === "campania" && SIAPS.idMsgEIdPiattaforma && !SIAPS.collegamentiHttp && SIAPS.collegamentoDaIdMsg?.("4827562") === "https://portale.soresa.it/aflink/direct/link/?id=4827562" && !SIAPS.paginazione && SIAPS.regoleEstese === true);
  const s = ISTANZE_AFLINK.sardegnacat;
  const t = ISTANZE_AFLINK.sater;
  controlla("SardegnaCAT e SATER IDENTICHE: niente pagine, feed aggiuntivi, regole estese o conteggio dei reindirizzamenti", [s, t].every((x) => !x.paginazione && !x.feedAggiuntivi && !x.regoleEstese && !x.contaReindirizzamenti) && s.urlFeed?.startsWith("https://sardegnacat.regione.sardegna.it/portale/rss_bandi.asp?FilterHide=") === true && t.urlFeed === null);
}

// ═════ B. pagine: SOLO nPag cambia ═════
function provaPagine(): void {
  const p2 = urlPaginaAflink(EMPULIA.urlFeed as string, 2);
  controlla("pagina 2: l'indirizzo pubblicato con il solo nPag cambiato (FilterHide e numRowForPag identici)", p2 === "https://eproc.empulia.it/portale/rss_bandi.asp?FilterHide=bScaduto=0+and+tipo<>'Esito'+&numRowForPag=20&nPag=2" && urlPaginaAflink(EMPULIA.urlFeed as string, 1) === EMPULIA.urlFeed, p2);
  controlla("senza nPag nell'indirizzo (SIAPS, SardegnaCAT) o con un numero fuori misura: nessuna pagina", urlPaginaAflink(SIAPS.urlFeed as string, 2) === null && urlPaginaAflink(EMPULIA.urlFeed as string, 0) === null && urlPaginaAflink(EMPULIA.urlFeed as string, 51) === null && urlPaginaAflink(EMPULIA.urlFeed as string, 1.5) === null);
}

// ═════ C. regole estese delle opportunità ═════
function provaRegole(): void {
  const t = (istanza: IstanzaAflink, tipo: string, testo: string, procedura = "Aperta") => opportunitaAflinkEstesa(istanza, tipo, procedura, testo)?.tipo ?? null;
  const casi: [IstanzaAflink, string, string, string, string | null][] = [
    ["empulia", "Consultazione Preliminare di Mercato", "CONSULTAZIONE PRELIMINARE DI MERCATO, EX ART. 77 DEL D.LGS. N. 36/2023, FINALIZZATA ALL'INDIZIONE DI UNA GARA", "", "consultazione_preliminare"],
    ["empulia", "Consultazione Preliminare di Mercato", "AVVISO PUBBLICO DI MANIFESTAZIONE DI INTERESSE DA PARTE DEGLI ENTI DEL TERZO SETTORE", "", "manifestazione_interesse"],
    ["empulia", "Consultazione Preliminare di Mercato", "Richiesta preventivo medicinale infungibile", "", "indagine_mercato"],
    ["siaps", "Consultazione Preliminare di Mercato", "INDAGINE ESPLORATIVA DI MERCATO PER L'INDIVIDUAZIONE DELL'OPERATORE", "", "indagine_mercato"],
    ["siaps", "Consultazione Preliminare di Mercato", "Indagine conoscitiva di mercato per la fornitura con posa in opera", "", "indagine_mercato"],
    ["siaps", "Consultazione Preliminare di Mercato", "Consultazione preliminare di mercato per il servizio di ristorazione", "", "consultazione_preliminare"],
    ["empulia", "Bando", "Procedura di affidamento, ex art. 50, comma 1, lett. b) del D. Lgs 36/2023, mediante richiesta di preventivi", "Aperta", "indagine_mercato"],
    ["empulia", "Bando", "Affidamento diretto ex art. 50 comma 1 lett. b) per la fornitura di lettini", "Affidamento diretto", "affidamento_diretto"],
    ["empulia", "Bando", "AFFIDAMENTO DIRETTO, PREVIA CONSULTAZIONE DI TRE OPERATORI ECONOMICI", "Affidamento diretto", "affidamento_diretto"],
    ["empulia", "Bando", "Procedura negoziata ai sensi dell'art. 76, comma 2, del Dlgs 36/2023", "Negoziata", "riservata"],
    ["empulia", "Bando", "Procedura negoziata previa pubblicazione del bando per il servizio di pulizia", "Negoziata", "bando"],
    ["empulia", "Bando", "Procedura aperta per l'affidamento della fornitura di carta", "Aperta", "bando"],
    ["siaps", "Bando", "Indagine di mercato/avviso esplorativo su piattaforma SIAPS/So.Re.Sa.", "Aperta", "indagine_mercato"],
    ["siaps", "Bando", "BATTERIE MONOUSO", "Aperta", "bando"],
    ["siaps", "Avviso", "Avviso esplorativo per il servizio di portierato", "", "manifestazione_interesse"],
    // fuori dall'interruttore per fonte: una consultazione vera NON prende il tipo nuovo
    ["sardegnacat", "Consultazione Preliminare di Mercato", "Consultazione preliminare di mercato per il servizio di pulizia", "", null],
  ];
  const diversi = casi.filter(([i, ti, o, p, atteso]) => t(i, ti, o, p) !== atteso).map(([i, ti, o, p, atteso]) => ({ i, ti, o, p, atteso, avuto: t(i, ti, o, p) }));
  controlla("regole estese (decisioni del 26–27/11): consultazioni col tipo nuovo, candidature e affidamenti dichiarati nell'oggetto, richiesta di preventivo = indagine, negoziata riservata salvo previa pubblicazione; fuori dall'interruttore nessun tipo nuovo", diversi.length === 0, diversi);
}

// ═════ D. un elemento → bando o esclusione ═════
function provaElementi(): void {
  const sia = leggiElementoAflink("siaps", voceSiaps(4827562, "Procedura aperta per il servizio di ristorazione degenti") as ElementoAflink, ADESSO) as BandoAflink;
  controlla("SIAPS: chiave e piattaforma_id «siaps:<IdMsg>»; collegamento UFFICIALE dei BT-15 (mai il link http del feed); nessun CIG (mai inventato), nessun codice fiscale; scadenza con l'ora; Campania", sia.tipo === "bando" && sia.record.chiaveProcedura === "siaps:4827562" && sia.meta.idPiattaforma === "siaps:4827562" && sia.record.urlDocumenti === "https://portale.soresa.it/aflink/direct/link/?id=4827562" && sia.record.lotti.length === 0 && sia.mancanti.includes("cig") && sia.record.ente.codiceFiscale === null && sia.record.scadenzaOraIndicata && sia.record.scadenzaOfferte === "2026-12-10T11:00:00.000Z" && sia.regioni[0] === "campania", sia.tipo === "bando" ? { chiave: sia.record.chiaveProcedura, url: sia.record.urlDocumenti, mancanti: sia.mancanti } : sia);
  const emp = leggiElementoAflink("empulia", voceEmpulia(9000001, "Procedura aperta per il servizio di pulizia degli uffici comunali", { CIG: "PRVAF00001" }) as ElementoAflink, ADESSO) as BandoAflink;
  controlla("EmPULIA: chiave «empulia:<IdMsg>»; il link http della vetrina ammesso (solo www.empulia.it); il CIG fa il lotto; Puglia", emp.tipo === "bando" && emp.record.chiaveProcedura === "empulia:9000001" && emp.meta.idPiattaforma === "empulia:9000001" && emp.record.urlDocumenti?.startsWith("http://www.empulia.it/tno-a/empulia/Empulia/SitePages/New_Dettaglio") === true && emp.record.lotti[0]?.cig === "PRVAF00001" && emp.regioni[0] === "puglia", emp.tipo === "bando" ? { chiave: emp.record.chiaveProcedura, url: emp.record.urlDocumenti } : emp);
  const altroHost = leggiElementoAflink("empulia", voceEmpulia(9000002, "Procedura aperta per il servizio di pulizia", { link: "http://altro.esempio.invalid/gara?bando=9000002" }) as ElementoAflink, ADESSO) as BandoAflink;
  controlla("EmPULIA: un link http verso un altro host non si usa (collegamento mancante, mai ricostruito per analogia)", altroHost.tipo === "bando" && altroHost.record.urlDocumenti === null && altroHost.mancanti.includes("collegamento"));
  const cons = leggiElementoAflink("empulia", voceConsultazione(8000001, "Avviso di consultazione preliminare di mercato propedeutica all'affidamento del servizio di vigilanza armata") as ElementoAflink, ADESSO) as BandoAflink;
  controlla("EmPULIA, consultazione: tipo «consultazione_preliminare», collegamento https su eproc.empulia.it, procedura non indicata (non è un bando)", cons.tipo === "bando" && cons.opportunita.tipo === "consultazione_preliminare" && cons.record.urlDocumenti?.startsWith("https://eproc.empulia.it/portale/index.php/") === true && !cons.mancanti.includes("tipo_procedura"), cons.tipo === "bando" ? { opp: cons.opportunita, url: cons.record.urlDocumenti, mancanti: cons.mancanti } : cons);
  const scaduta = leggiElementoAflink("empulia", voceConsultazione(8000002, "Consultazione preliminare di mercato per il servizio di vigilanza", "2025-03-01T12:00:00") as ElementoAflink, ADESSO) as EsclusioneAflink;
  controlla("feed delle consultazioni con tutto lo storico: le voci scadute si escludono («scaduta»)", scaduta.tipo === "esclusione" && scaduta.motivo === "scaduta");
  const reg = bandoDaAflink(sia, OGGI);
  const riga = reg ? rigaDaBandoRegionale(reg, ADESSO) : null;
  controlla("per l'archivio: piattaforma_id «siaps:<IdMsg>» (rispetta la 0120), versione del giorno (il feed SIAPS non dà dataUltimaModifica)", !!riga && riga.piattaforma_id === "siaps:4827562" && riga.chiave === "siaps:4827562" && reg?.versione.giorno === OGGI && new RegExp(leggi("supabase/migrations/0120_radar_multifonte.sql").match(/piattaforma_id ~ '([^']+)'/)?.[1] ?? "^$").test("siaps:4827562"), riga);
}

// ═════ E. id SIAPS nei collegamenti (solo suggerimenti) ═════
function provaIdSiaps(): void {
  const casi: [string, string | null][] = [
    ["https://portale.soresa.it/aflink/direct/link/?id=4827562", "4827562"],
    ["http://siaps.soresa.it/application/CustomDoc/DettaglioProcedura.asp?ID=4460257", "4460257"],
    ["https://portale.soresa.it/aflink/document/4828165/BANDO_GARA_PORTALE/XSLT_BANDO_GARA_PORTALE?ch=x", null],
    ["https://altro.esempio.invalid/aflink/direct/link/?id=4827562", null],
    ["https://webs.rete.toscana.it/sitat/trasparenza/#/procedura?uuid=4827562", null],
    ["http://www.empulia.it/tno-a/empulia/SitePages/Home.aspx", null],
  ];
  controlla("IdMsg SIAPS riconosciuto SOLO nelle due forme ufficiali (BT-15 e DettaglioProcedura); mai la pagina /aflink/document/", casi.every(([u, id]) => idSiapsDaUrl(u) === id), casi.filter(([u, id]) => idSiapsDaUrl(u) !== id));
}

// ═════ F. lettore (rete finta) ═════
type Risposta = { stato?: number; testo: string; reindirizzato?: boolean };
function reteFinta(risposte: Record<string, Risposta>, richieste: string[]): typeof fetch {
  return (async (url: string | URL | Request) => {
    const u = String(url);
    richieste.push(u);
    const r = risposte[u] ?? { stato: 404, testo: "non trovata" };
    return { status: r.stato ?? 200, url: u, redirected: r.reindirizzato === true, headers: new Headers({ "content-type": "text/xml" }), text: async () => r.testo } as unknown as Response;
  }) as typeof fetch;
}
const sessione = (fetchFn: typeof fetch, nome: string, conta: boolean, richiesteMassime = 18) => new SessioneFonte(nome, { pausaMs: 0, timeoutMs: 5_000, tentativi: 1, richiesteMassime }, fetchFn, undefined, undefined, conta);
const pagineEmpulia = (totale: number, perPagina = 20, partenza = 9100000) => {
  const out: Record<string, Risposta> = {};
  const n = Math.ceil(totale / perPagina);
  for (let p = 1; p <= n; p++) {
    const voci = Array.from({ length: Math.min(perPagina, totale - (p - 1) * perPagina) }, (_, i) => voceEmpulia(partenza + (p - 1) * perPagina + i, `Procedura aperta per il servizio di pulizia numero ${p}-${i}`));
    out[urlPaginaAflink(EMPULIA.urlFeed as string, p) as string] = { testo: xml(voci, totale), reindirizzato: true };
  }
  return out;
};

async function provaLettore(): Promise<void> {
  const primaRete = richiesteDiRete;
  const r1: string[] = [];
  const s1 = sessione(reteFinta({ ...pagineEmpulia(45), [URL_CONSULTAZIONI]: { testo: xml([voceConsultazione(8000001, "Consultazione preliminare di mercato")], 1), reindirizzato: true } }, r1), "EmPULIA", true);
  const l1 = await new LettoreAflink("empulia", s1).leggiFeed();
  controlla("EmPULIA: 3 pagine (totRecord 45) cambiando SOLO nPag, poi le consultazioni; 46 elementi; completo; ogni reindirizzamento contato (8 richieste)", l1.completo && l1.pagine === 3 && l1.elementi.length === 46 && JSON.stringify(r1) === JSON.stringify([EMPULIA.urlFeed, urlPaginaAflink(EMPULIA.urlFeed as string, 2), urlPaginaAflink(EMPULIA.urlFeed as string, 3), URL_CONSULTAZIONI]) && s1.richieste === 8, { completo: l1.completo, pagine: l1.pagine, n: l1.elementi.length, r1, richieste: s1.richieste });
  // pagina ripetuta (il numero di pagina non è quello vero): ferma, NON completo, nessun doppione
  const ripetuta = pagineEmpulia(45);
  ripetuta[urlPaginaAflink(EMPULIA.urlFeed as string, 2) as string] = ripetuta[EMPULIA.urlFeed as string];
  const l2 = await new LettoreAflink("empulia", sessione(reteFinta({ ...ripetuta, [URL_CONSULTAZIONI]: { testo: xml([], 0) } }, []), "EmPULIA", true)).leggiFeed();
  controlla("pagina 2 uguale alla 1: lettura NON completa, nessun doppione", !l2.completo && l2.elementi.length === 20, { completo: l2.completo, n: l2.elementi.length });
  // oltre le pagine massime: si leggono le prime 8, NON completo
  const r3: string[] = [];
  const l3 = await new LettoreAflink("empulia", sessione(reteFinta({ ...pagineEmpulia(200), [URL_CONSULTAZIONI]: { testo: xml([], 0) } }, r3), "EmPULIA", false, 30)).leggiFeed();
  controlla("totRecord oltre 8 pagine: lette le prime 8, NON completo", !l3.completo && l3.pagine === 8 && r3.filter((u) => u.includes("rss_bandi.asp")).length === 8, { completo: l3.completo, pagine: l3.pagine });
  // SardegnaCAT: una lettura sola, come prima (nessun conteggio dei reindirizzamenti)
  const rs: string[] = [];
  const sS = sessione(reteFinta({ [ISTANZE_AFLINK.sardegnacat.urlFeed as string]: { testo: xml([{ IdMsg: "1031830", Oggetto: "Prova", Tipo: "Bando", TipoProcedura: "Aperta", DenominazioneEnte: ENTE, DtScadenzaBandoTecnical: "2026-12-10T10:00:00", statoFunzionale: "Pubblicato", dataUltimaModifica: "2026-11-20T09:00:00" }], 1), reindirizzato: true } }, rs), "SardegnaCAT", false);
  const lS = await new LettoreAflink("sardegnacat", sS).leggiFeed();
  controlla("SardegnaCAT IDENTICA: una lettura, una richiesta contata, completo", lS.completo && lS.pagine === 1 && rs.length === 1 && sS.richieste === 1 && lS.elementi.length === 1);
  const rsi: string[] = [];
  const sSi = sessione(reteFinta({ [SIAPS.urlFeed as string]: { testo: xml([voceSiaps(4827562, "Procedura aperta per il servizio di ristorazione")], 1), reindirizzato: true } }, rsi), "SIAPS", true, 2);
  const lSi = await new LettoreAflink("siaps", sSi).leggiFeed();
  controlla("SIAPS: una lettura dell'indirizzo pubblicato, il reindirizzamento contato (2 richieste, il tetto)", lSi.completo && rsi.length === 1 && sSi.richieste === 2);
  controlla("nessuna richiesta alla rete vera nel lettore", richiesteDiRete === primaRete);
}

// ═════ G. guardie, nomi, 0138 e 0139 ═════
function provaGuardie(): void {
  const tutte = Object.fromEntries(Object.values(VARIABILI_PRODUZIONE).map((v) => [v as string, "autorizzata"]));
  // 27/11 (decisione dell'utente: EmPULIA e SIAPS in produzione): come SATER e TuttoGare, la SUA variabile di produzione; START no
  for (const f of ["empulia", "siaps"] as const) {
    const sua = `RADAR_${f.toUpperCase()}_PRODUZIONE`;
    const altre = Object.fromEntries(Object.entries(tutte).filter(([k]) => k !== sua));
    controlla(`ambiente: ${f} con la SUA variabile ${sua}: staging sì; produzione solo dal deploy di produzione con «autorizzata»; senza (anche con tutte le altre) mai`, (FONTI_RADAR as readonly string[]).includes(f) && VARIABILI_PRODUZIONE[f] === sua && fonteAutorizzata(f, "importazione", STAGING).ok && fonteAutorizzata(f, "importazione", { ...PROD_DEPLOY, [sua]: "autorizzata" }).ok && !fonteAutorizzata(f, "importazione", { ...PROD_DEPLOY, ...altre }).ok && !fonteAutorizzata(f, "notifiche", { ...PROD_DEPLOY, ...altre }).ok && !fonteAutorizzata(f, "importazione", { ...PROD_DEPLOY, [sua]: "si" }).ok);
  }
  controlla("START resta senza variabile di produzione (dormiente)", !("start" in VARIABILI_PRODUZIONE) && !fonteAutorizzata("start", "importazione", { ...PROD_DEPLOY, ...tutte }).ok);
  const cron = (JSON.parse(leggi("vercel.json")) as { crons: { path: string; schedule: string }[] }).crons;
  controlla("in console, allarmi, cron e programmatore come SATER e TuttoGare (tutto spento di base: interruttori RADAR_<FONTE>_CRON); START resta fuori da tutto, solo negli script dello staging", ["empulia", "siaps"].every((f) => (FONTI_REGIONALI as readonly string[]).includes(f) && (FONTI_ESECUZIONI as readonly string[]).includes(f) && (FONTI_REGISTRO as readonly string[]).includes(f) && (FONTI_ACCENDIBILI as readonly string[]).includes(f) && ORARI_GIRI[f as "empulia"].length === 4 && CRON_PROPOSTI[f as "empulia"].length === 1 && ROTTE_CRON[f as "empulia"] === `/api/cron/radar-${f}` && INTERRUTTORI_CRON[f as "empulia"] === `RADAR_${f.toUpperCase()}_CRON` && cron.filter((c) => c.path === `/api/cron/radar-${f}`).length === 1 && cron.find((c) => c.path === `/api/cron/radar-${f}`)?.schedule === CRON_PROPOSTI[f as "empulia"][0]) && !(FONTI_ESECUZIONI as readonly string[]).includes("start") && !("start" in ORARI_GIRI) && !cron.some((c) => /start/i.test(c.path)) && (FONTI_REGISTRO as readonly string[]).includes("start") && /\[\.\.\.FONTI_REGIONALI, "start"\]/.test(leggi("scripts/radar-importa-regionale.ts")), cron.map((c) => c.path));
  controlla("motore di unione: precedenza e sede come SardegnaCAT; nomi e attribuzioni uguali a quelli delle istanze; scheda «EmPULIA, procedura <IdMsg>»", ["empulia", "siaps"].every((f) => FONTI_UNITE.includes(f as "empulia") && PRECEDENZA_FONTI[f as "empulia"] === PRECEDENZA_FONTI.sardegnacat && SEDE_DELL_ENTE[f as "empulia"] === true) && NOME_FONTE.empulia === "EmPULIA" && NOME_FONTE.siaps === "SIAPS" && ATTRIBUZIONE_FONTE.empulia === EMPULIA.attribuzione && ATTRIBUZIONE_FONTE.siaps === SIAPS.attribuzione && descriviAvvisoLetto({ fonte: "empulia", id_fonte: "9000001", tipo_avviso: "Bando" }) === "EmPULIA, procedura 9000001");
  for (const [num, fonte, file] of [["0138", "empulia", "0138_radar_fonte_empulia.sql"], ["0139", "siaps", "0139_radar_fonte_siaps.sql"]] as const) {
    const sql = leggi(`supabase/migrations/${file}`);
    const istruzioni = sql.split("\n").filter((r) => !/^\s*--/.test(r)).join("\n");
    controlla(`${num} proposta: valori del vincolo RICAVATI dalla definizione corrente + «${fonte}», controllo finale, riga spenta/nascosta/2099, idempotente, nessuna istruzione distruttiva`, /regexp_matches\(vincolo\.d, '''\(\[a-z0-9_\]\+\)''', 'g'\)/.test(istruzioni) && istruzioni.includes(`valori := valori || '${fonte}'::text;`) && istruzioni.includes(`values ('${fonte}', false, true, '2099-01-01T00:00:00Z')`) && /on conflict \(fonte\) do nothing/.test(istruzioni) && istruzioni.includes(`like '%''${fonte}''%'`) && new RegExp(`raise exception '${num}: il vincolo ricreato non ammette`).test(istruzioni) && /^begin;$/m.test(istruzioni) && /^commit;$/m.test(istruzioni) && !/fonte in \('/.test(istruzioni) && !/\bdelete\b|\btruncate\b|\bupdate\b|drop table|radar_procedure\b|piattaforma_id/i.test(istruzioni));
  }
}

// ═════ H. giri col database in memoria ═════
function mondo(fonte: "empulia" | "siaps", stato: "assente" | "accesa" | "accesa_migrazione"): DbFinto {
  const db = new DbFinto();
  const altre = FONTI_ESECUZIONI.filter((f) => f !== fonte).map((f) => ({ fonte: f, attiva: false, ultimo_successo_il: null, cursore: null, blocco_fino_a: null, conteggi: {}, nascosta_ai_clienti: false, dati_aggiornati_al: null }));
  db.tabelle.radar_fonti_stato = stato === "assente" ? altre : [...altre, { fonte, attiva: true, ultimo_successo_il: null, cursore: null, blocco_fino_a: stato === "accesa_migrazione" ? "2099-01-01T00:00:00.000Z" : null, conteggi: {}, nascosta_ai_clienti: true, dati_aggiornati_al: null }];
  // il trigger della 0120: radar_procedure.fonti = le fonti della provenienza
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

// una gara PVL (CIG PRVAF00001, codice fiscale) e una gara TED col collegamento SIAPS di un IdMsg
function archivio(db: DbFinto): void {
  const b = leggiElementoAflink("empulia", voceEmpulia(9000001, "Procedura aperta per il servizio di pulizia degli uffici comunali", { CIG: "PRVAF00001" }) as ElementoAflink, ADESSO) as BandoAflink;
  const base = rigaDaBandoRegionale(bandoDaAflink(b, OGGI)!, ADESSO);
  const v: VersioneFonte = { fonte: "pvl", id: "PVL-SINTETICO-AF", giorno: "2026-11-20", istante: "2026-11-20T10:00:00.000Z", ted: null };
  const prov = Object.fromEntries(["scadenza", "oggetto", "ente", "url_documenti"].map((g) => [g, provenienzaDa(v)]));
  db.tabelle.radar_procedure = [
    { ...base, id: "G-PVL", chiave: "pvl:PRV-AF-0001", piattaforma_id: null, sa_codice_fiscale: "00000000002", oggetto: "Servizio di pulizia degli uffici comunali (avviso PVL sintetico)", url_documenti: "https://pvl.example.invalid/avviso", provenienza_campi: prov, unita_a: null, fonti: ["pvl"] } as Riga,
    { ...base, id: "G-TED", chiave: "ted:700002-2026", piattaforma_id: null, sa_codice_fiscale: "00000000003", oggetto: "Servizio di ristorazione degenti (bando TED sintetico)", url_documenti: "https://portale.soresa.it/aflink/direct/link/?id=4827562", provenienza_campi: {}, unita_a: null, fonti: ["ted"] } as Riga,
  ];
  db.tabelle.radar_lotti = [{ id: "L-PVL", procedura_id: "G-PVL", numero_lotto: "LOT-0001", cig: "PRVAF00001", oggetto: null, cpv_principale: null, cpv_tutti: [], valore_stimato: null, durata_mesi: null, scadenza_giorno: "2026-12-15", scadenza_offerte: "2026-12-15T11:00:00.000Z", scadenza_ora_indicata: true, scadenza_fonte: "PVL sintetica", url_documenti: "https://pvl.example.invalid/avviso" }];
  db.tabelle.radar_procedure_fonti = [
    { id: "F-PVL", procedura_id: "G-PVL", fonte: "pvl", id_fonte: "PVL-SINTETICO-AF", id_procedura_fonte: "PVL-PROC-AF", url: "https://pvl.example.invalid/avviso", impronta: "pvl", rilevato_il: "2026-11-20T10:00:00Z" },
    { id: "F-TED", procedura_id: "G-TED", fonte: "ted", id_fonte: "700002-2026", id_procedura_fonte: "700002-2026", url: "https://ted.example.invalid/700002-2026", impronta: "ted", rilevato_il: "2026-11-19T10:00:00Z" },
  ];
}

async function provaGiri(): Promise<void> {
  const primaRete = richiesteDiRete;
  const tutte = Object.fromEntries(Object.values(VARIABILI_PRODUZIONE).map((v) => [v as string, "autorizzata"]));
  for (const fonte of ["empulia", "siaps"] as const) {
    const a = mondo(fonte, "assente");
    const ra = await eseguiImportazioneRegionale(a as unknown as SupabaseClient, fonte, { env: STAGING, adesso: () => ADESSO });
    controlla(`${fonte}: staging SENZA la sua riga (migrazione non applicata): «fonte_spenta», nessuna gara, nessuna richiesta`, !ra.eseguita && ra.motivo === "fonte_spenta" && a.t("radar_procedure").length === 0);
    const b = mondo(fonte, "accesa");
    const senzaLaSua = Object.fromEntries(Object.entries(tutte).filter(([k]) => k !== `RADAR_${fonte.toUpperCase()}_PRODUZIONE`));
    const rb = await eseguiImportazioneRegionale(b as unknown as SupabaseClient, fonte, { env: { ...PROD_DEPLOY, ...senzaLaSua, RADAR_CONTATTO_FONTI: "contatto@esempio.invalid" }, adesso: () => ADESSO });
    controlla(`${fonte}: produzione SENZA la sua variabile (anche con tutte le altre): «ambiente_non_consentito», zero accessi al database`, !rb.eseguita && rb.motivo === "ambiente_non_consentito" && b.richieste.length === 0);
    const o = mondo(fonte, "accesa_migrazione");
    const ro = await eseguiImportazioneRegionale(o as unknown as SupabaseClient, fonte, { env: STAGING, adesso: () => ADESSO });
    controlla(`${fonte}: accesa col semaforo 2099 della sua migrazione: «occupata»`, !ro.eseguita && ro.motivo === "occupata");
  }
  // EmPULIA: 3 pagine (45 bandi sintetici, uno col CIG della gara PVL) + 2 consultazioni (una vera, una manifestazione)
  const d = mondo("empulia", "accesa");
  archivio(d);
  const pagine = pagineEmpulia(45);
  const prima = urlPaginaAflink(EMPULIA.urlFeed as string, 1) as string;
  const voci1 = Array.from({ length: 20 }, (_, i) => (i === 0 ? voceEmpulia(9000001, "Procedura aperta per il servizio di pulizia degli uffici comunali", { CIG: "PRVAF00001" }) : voceEmpulia(9100000 + i, `Procedura aperta per il servizio di pulizia numero 1-${i}`)));
  pagine[prima] = { testo: xml(voci1, 45), reindirizzato: true };
  const consultazioni = xml([voceConsultazione(8000001, "Avviso di consultazione preliminare di mercato propedeutica all'affidamento del servizio di vigilanza armata"), voceConsultazione(8000002, "AVVISO PUBBLICO DI MANIFESTAZIONE DI INTERESSE PER IL SERVIZIO DI PORTIERATO"), voceConsultazione(8000003, "Consultazione preliminare per il servizio di vigilanza", "2025-01-10T12:00:00")], 3);
  const richieste: string[] = [];
  const r = await eseguiImportazioneRegionale(d as unknown as SupabaseClient, "empulia", { env: STAGING, adesso: () => ADESSO, fetchFn: reteFinta({ ...pagine, [URL_CONSULTAZIONI]: { testo: consultazioni, reindirizzato: true } }, richieste), origine: "script", limiti: { pausaMs: 3_000, tentativi: 1 } });
  const gare = d.t("radar_procedure");
  const gp = gare.find((x) => x.id === "G-PVL");
  controlla("EmPULIA, giro (staging simulato): 4 letture (3 pagine + consultazioni), 8 richieste contate coi reindirizzamenti, nessun errore, nessun allarme di lettura incompleta", r.eseguita && !r.errore && richieste.length === 4 && r.statistiche.fonte.richieste === 8 && !r.allarmi.includes("elenco_non_completo"), r.eseguita ? { errore: r.errore, allarmi: r.allarmi, richieste: r.statistiche.fonte.richieste } : r);
  controlla("EmPULIA: il bando col CIG della PVL si UNISCE alla gara PVL (nessuna gara «empulia:9000001»); il codice fiscale della PVL resta", !gare.some((x) => x.chiave === "empulia:9000001") && (gp?.fonti as string[] | undefined)?.includes("empulia") === true && gp?.sa_codice_fiscale === "00000000002", { fonti: gp?.fonti, cf: gp?.sa_codice_fiscale });
  const cons = gare.find((x) => x.chiave === "empulia:8000001");
  const mani = gare.find((x) => x.chiave === "empulia:8000002");
  controlla("EmPULIA: consultazione vera col tipo «consultazione_preliminare» (nel database vero solo dopo la 0140), manifestazione come candidatura, consultazione scaduta esclusa", cons?.tipo_opportunita === "consultazione_preliminare" && mani?.tipo_opportunita === "manifestazione_interesse" && !gare.some((x) => x.chiave === "empulia:8000003") && r.eseguita && (r.statistiche.esclusi.scaduta ?? 0) >= 1, { cons: cons?.tipo_opportunita, mani: mani?.tipo_opportunita });
  controlla("EmPULIA: nessuna email né evento delle notifiche; nessuna riga notificabile (fonte nascosta)", d.t("omnia_ai_radar_eventi").length === 0 && d.t("omnia_ai_radar_email_consegne").length === 0 && !d.t("radar_aggiornamenti").some((x) => x.notificabile === true));
  // EmPULIA: pagina 2 in errore → il giro non scrive nulla (si riprova al giro dopo)
  const e2 = mondo("empulia", "accesa");
  const guaste = { ...pagineEmpulia(45), [urlPaginaAflink(EMPULIA.urlFeed as string, 2) as string]: { stato: 500, testo: "errore" } };
  const r2 = await eseguiImportazioneRegionale(e2 as unknown as SupabaseClient, "empulia", { env: STAGING, adesso: () => ADESSO, fetchFn: reteFinta(guaste, []), origine: "script", limiti: { pausaMs: 3_000, tentativi: 1 } });
  controlla("EmPULIA: una pagina che non si legge (500) ferma il giro senza scritture parziali; errore detto", r2.eseguita && !!r2.errore && e2.t("radar_procedure").length === 0, r2.eseguita ? r2.errore : r2);

  // SIAPS: un bando senza CIG con l'IdMsg della gara TED → gara SIAPS nuova + SUGGERIMENTO (mai unione)
  const s = mondo("siaps", "accesa");
  archivio(s);
  const rs: string[] = [];
  const feedSiaps = xml([voceSiaps(4827562, "Procedura aperta per il servizio di ristorazione degenti"), voceSiaps(4827563, "Consultazione preliminare di mercato per l'affidamento del servizio di ristorazione ospedaliera", "Consultazione Preliminare di Mercato")], 2);
  const rS = await eseguiImportazioneRegionale(s as unknown as SupabaseClient, "siaps", { env: STAGING, adesso: () => ADESSO, fetchFn: reteFinta({ [SIAPS.urlFeed as string]: { testo: feedSiaps, reindirizzato: true } }, rs), origine: "script" });
  const gs = s.t("radar_procedure").find((x) => x.chiave === "siaps:4827562");
  const proposte = s.t("radar_aggiornamenti").filter((x) => x.campo === "collegamento_proposto");
  controlla("SIAPS, giro: una lettura (2 richieste contate), gara «siaps:4827562» col collegamento ufficiale e piattaforma_id, SUGGERIMENTO con la gara TED dello stesso IdMsg, nessuna unione", rS.eseguita && !rS.errore && rs.length === 1 && rS.statistiche.fonte.richieste === 2 && gs?.piattaforma_id === "siaps:4827562" && gs?.url_documenti === "https://portale.soresa.it/aflink/direct/link/?id=4827562" && proposte.length === 2 && proposte.every((x) => x.fonte === "siaps") && proposte.some((x) => x.procedura_id === gs?.id && x.valore_nuovo === "G-TED") && !s.t("radar_procedure").some((x) => x.unita_a), { r: rS.eseguita ? { errore: rS.errore, richieste: rS.statistiche.fonte.richieste, proposte: rS.statistiche.proposte } : rS, gs: gs?.url_documenti, proposte: proposte.length });
  controlla("SIAPS: la consultazione vera col tipo nuovo", s.t("radar_procedure").find((x) => x.chiave === "siaps:4827563")?.tipo_opportunita === "consultazione_preliminare");
  controlla("nessuna richiesta alla rete vera nei giri", richiesteDiRete === primaRete);
}

async function principale(): Promise<void> {
  provaIstanze();
  provaPagine();
  provaRegole();
  provaElementi();
  provaIdSiaps();
  await provaLettore();
  provaGuardie();
  await provaGiri();
}
principale()
  .catch((e) => falliti.push(`eccezione: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`))
  .finally(() => {
    console.log(`Verifica dei connettori EmPULIA e SIAPS (Fase 2): ${ok} ok, ${falliti.length} falliti`);
    for (const f of falliti) console.log(`  FALLITO: ${f}`);
    process.exit(falliti.length ? 1 : 0);
  });
