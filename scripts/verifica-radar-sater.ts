// Verifica del connettore SATER (Fase 2, documento 60): lettore AF Soluzioni a più istanze, fonte «sater» spenta e fuori da console, cron e
// registro dei giri, riconoscimento «trovabando» solo nei connettori, NON REGRESSIONE di SardegnaCAT. Tutti i dati sono [SINTETICI] (enti,
// CIG, identificativi e importi inventati: «Comune di Provasintetica»); nessuna rete (fetch vietato), database in memoria.
// Uso: npx tsx scripts/verifica-radar-sater.ts → codice 0 se passa.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CAMPI_AFLINK_ESSENZIALI,
  CAMPI_AFLINK_OBBLIGATORI,
  ISTANZE_AFLINK,
  chiaveProceduraAflink,
  leggiElementoAflink,
  leggiFeedAflink,
  proceduraDallOggettoAflink,
  type BandoAflink,
  type EsclusioneAflink,
} from "../src/lib/radar/fonti/aflink-calcoli";
import { LettoreAflink } from "../src/lib/radar/fonti/aflink";
import { SessioneFonte } from "../src/lib/radar/fonti/sessione-fonte";
import { idPiattaformaDaUrl, idPiattaformaDaUrlConnettore } from "../src/lib/radar/fonti/piattaforme-calcoli";
import { FONTI_RADAR, VARIABILI_PRODUZIONE, fonteAutorizzata } from "../src/lib/radar/ambiente";
import { FONTI_REGIONALI, bandoDaAflink } from "../src/lib/radar/importa-regionali-calcoli";
import { FONTI_ESECUZIONI, FONTI_REGISTRO } from "../src/lib/radar/esecuzioni-calcoli";
import { ORARI_GIRI, CRON_PROPOSTI, ROTTE_CRON, INTERRUTTORI_CRON } from "../src/lib/radar/programmazione-calcoli";
import { FONTI_UNITE, PRECEDENZA_FONTI } from "../src/lib/radar/unione-calcoli";
import { ATTRIBUZIONE_FONTE, FONTI_NASCOSTE_PREDEFINITE, NOME_FONTE } from "../src/lib/radar/fonti-gara-calcoli";
import { descrizioneFonte } from "../src/lib/radar/fonti/tipi";
import { eseguiImportazioneRegionale } from "../src/lib/radar/importa-regionali";
import {
  CAMPI_INTERCENTER,
  CANALE_INTERCENTER,
  cigIntercenter,
  collegamentoTrovabando,
  leggiElementoIntercenter,
  numeroDallaPagina,
  paginaSeguenteIntercenter,
  PAGINE_MASSIME_INTERCENTER,
  leggiElencoIntercenter,
  numeroIntercenter,
  paginaIntercenter,
  scadenzaIntercenter,
  tipologiaIntercenter,
  urlCartellaIntercenter,
  type BandoIntercenter,
  type CartellaIntercenter,
  type EsclusioneIntercenter,
} from "../src/lib/radar/fonti/intercenter-calcoli";
import { LettoreIntercenter } from "../src/lib/radar/fonti/intercenter";
import { bandoDaIntercenter } from "../src/lib/radar/importa-regionali-calcoli";
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

const STAGING = { NEXT_PUBLIC_SUPABASE_URL: "https://ryawdldqiumqsskrnyps.supabase.co" };
const PROD_DEPLOY = { NEXT_PUBLIC_SUPABASE_URL: "https://bihfrzspqxsrzlbqqvqa.supabase.co", VERCEL_ENV: "production" };
const ADESSO = new Date("2026-11-26T10:00:00Z");
const OGGI = "2026-11-26";
const leggi = (f: string) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

// ───── [SINTETICO] elemento del feed AF Soluzioni come lo darebbe SATER (campi facoltativi assenti) ─────
const elementoSater = (id: string, p: Record<string, string> = {}): Record<string, string> => ({
  IdMsg: id,
  Oggetto: "Servizio di pulizia degli edifici comunali (prova sintetica)",
  DenominazioneEnte: "COMUNE DI PROVASINTETICA",
  CPV: "90910000-9 - Servizi di pulizia",
  a_base_asta: "80.000,00",
  DtScadenzaBandoTecnical: "2026-12-15T12:00:00",
  DtPubblicazioneTecnical: "2026-11-24T09:00:00",
  Tipo: "Bando",
  link: `https://intercenter.regione.emilia-romagna.it/trovabando/BANDO_GARA_PORTALE@1${id}`,
  ...p,
});
const feedXml = (els: Record<string, string>[]) =>
  `<?xml version="1.0"?><rss version="2.0" xmlns:afs="http://www.aflink.it/XMLBANDI"><channel><afs:totRecord>${els.length}</afs:totRecord>${els
    .map((e) => `<item>${Object.entries(e).filter(([k]) => k !== "link").map(([k, v]) => `<afs:${k}><![CDATA[${v}]]></afs:${k}>`).join("")}<link>${e.link ?? ""}</link></item>`)
    .join("")}</channel></rss>`;

function provaIstanze(): void {
  controlla("istanze: SardegnaCAT e SATER", JSON.stringify(Object.keys(ISTANZE_AFLINK)) === JSON.stringify(["sardegnacat", "sater"]));
  controlla("SardegnaCAT: campi obbligatori invariati (8, compresi TipoProcedura e dataUltimaModifica)", ISTANZE_AFLINK.sardegnacat.campiObbligatori === CAMPI_AFLINK_OBBLIGATORI && CAMPI_AFLINK_OBBLIGATORI.length === 8);
  controlla("SardegnaCAT: solo https, IdMsg = identificativo, nessuna ricostruzione, procedura obbligatoria", !ISTANZE_AFLINK.sardegnacat.collegamentiHttp && ISTANZE_AFLINK.sardegnacat.idMsgEIdPiattaforma && ISTANZE_AFLINK.sardegnacat.collegamentoDaIdMsg === null && !ISTANZE_AFLINK.sardegnacat.proceduraFacoltativa);
  controlla("SATER: indirizzo del feed NON confermato (null), nessuna pagina, nessun collegamento ricavato per analogia", ISTANZE_AFLINK.sater.urlFeed === null && ISTANZE_AFLINK.sater.paginaFeed === null && ISTANZE_AFLINK.sater.collegamentoDaIdMsg === null);
  controlla("SATER: campi essenziali (TipoProcedura, CIG, statoFunzionale e dataUltimaModifica facoltativi)", ISTANZE_AFLINK.sater.campiObbligatori === CAMPI_AFLINK_ESSENZIALI && !CAMPI_AFLINK_ESSENZIALI.some((c) => ["TipoProcedura", "CIG", "statoFunzionale", "dataUltimaModifica"].includes(c)));
  controlla("SATER: regione Emilia-Romagna, piattaforma «sater»", ISTANZE_AFLINK.sater.regione === "emilia_romagna" && ISTANZE_AFLINK.sater.piattaforma === "sater");
}

async function provaLettore(): Promise<void> {
  const richieste: string[] = [];
  const reteFinta = (async (url: string | URL | Request) => {
    richieste.push(String(url));
    return new Response(feedXml([elementoSater("2001")]), { status: 200, headers: { "content-type": "application/rss+xml" } });
  }) as typeof fetch;
  let errore: unknown = null;
  try {
    await new LettoreAflink("sater", new SessioneFonte("SATER", { pausaMs: 0, timeoutMs: 1000, tentativi: 1, richiesteMassime: 2 }, reteFinta)).leggiFeed();
  } catch (e) {
    errore = e;
  }
  const er = errore as { message?: string; sospendi?: boolean } | null;
  controlla("SATER: senza indirizzo confermato il lettore si ferma PRIMA di qualunque richiesta, senza sospendere", richieste.length === 0 && !!er && /non confermato/.test(er.message ?? "") && er.sospendi === false, { richieste, errore: er?.message });
}

function provaFeed(): void {
  const xml = feedXml([elementoSater("2001"), elementoSater("2002", { CIG: "B999999991" })]);
  const conSater = leggiFeedAflink(xml, ISTANZE_AFLINK.sater.campiObbligatori);
  controlla("feed SATER senza TipoProcedura, statoFunzionale e dataUltimaModifica: si legge con i campi dell'istanza", !("errore" in conSater) && conSater.elementi.length === 2, conSater);
  const conSardegna = leggiFeedAflink(xml);
  controlla("lo STESSO feed con i campi di SardegnaCAT (predefiniti, come prima): formato non riconosciuto", "errore" in conSardegna, conSardegna);
}

function provaElementi(): void {
  const bando = (x: ReturnType<typeof leggiElementoAflink>) => (x.tipo === "bando" ? (x as BandoAflink) : null);
  const esclusione = (x: ReturnType<typeof leggiElementoAflink>) => (x.tipo === "esclusione" ? (x as EsclusioneAflink).motivo : null);

  const aperta = bando(leggiElementoAflink("sater", elementoSater("2101", { Oggetto: "Procedura aperta per il servizio di pulizia delle scuole (prova sintetica)" }), ADESSO));
  controlla("procedura dichiarata nell'oggetto: bando, «Procedura aperta», nessun mancante «tipo_procedura»", !!aperta && aperta.record.tipoProcedura === "Procedura aperta" && !aperta.mancanti.includes("tipo_procedura"), aperta?.mancanti);
  const ignota = bando(leggiElementoAflink("sater", elementoSater("2102"), ADESSO));
  controlla("nessuna procedura (né campo né oggetto): la gara entra, procedura NON scritta, mancante «tipo_procedura»", !!ignota && ignota.record.tipoProcedura === null && ignota.mancanti.includes("tipo_procedura") && ignota.opportunita.tipo === "bando", ignota?.mancanti);
  controlla("negoziata nell'oggetto: riservata, non entra", esclusione(leggiElementoAflink("sater", elementoSater("2103", { Oggetto: "Procedura negoziata per il servizio di pulizia (prova sintetica)" }), ADESSO)) === "riservata");
  controlla("affidamento diretto nell'oggetto: non entra", esclusione(leggiElementoAflink("sater", elementoSater("2104", { Oggetto: "Affidamento diretto del servizio di pulizia (prova sintetica)" }), ADESSO)) === "affidamento");
  controlla("TipoProcedura del feed, se c'è, vale come prima (Negoziata → riservata)", esclusione(leggiElementoAflink("sater", elementoSater("2105", { TipoProcedura: "Negoziata" }), ADESSO)) === "riservata");
  const indagine = bando(leggiElementoAflink("sater", elementoSater("2106", { Tipo: "Avviso", Oggetto: "Avviso di indagine di mercato per il servizio di portierato (prova sintetica)", CPV: "98341140-8 - Servizi di portineria" }), ADESSO));
  controlla("avviso di indagine di mercato: entra come indagine, senza mancante «tipo_procedura»", !!indagine && indagine.opportunita.tipo === "indagine_mercato" && !indagine.mancanti.includes("tipo_procedura"), indagine?.opportunita);
  controlla("procedura dall'oggetto: solo forme dichiarate, mai presunte", proceduraDallOggettoAflink("Servizio di pulizia") === null && proceduraDallOggettoAflink("procedura ristretta per…") === "Ristretta" && proceduraDallOggettoAflink("") === null);

  // collegamenti e identificativi
  const conTrova = bando(leggiElementoAflink("sater", elementoSater("2201"), ADESSO));
  controlla("collegamento «trovabando»: identificativo di piattaforma «sater:<numero>» dal collegamento (non dall'IdMsg)", conTrova?.meta.idPiattaforma === "sater:12201", conTrova?.meta);
  controlla("chiave della gara dal feed: «sater:feed-<IdMsg>» (mai confusa con un identificativo di piattaforma)", conTrova?.record.chiaveProcedura === "sater:feed-2201" && chiaveProceduraAflink("sater", "2201") === "sater:feed-2201" && chiaveProceduraAflink("sardegnacat", "2201") === "sardegnacat:2201");
  const http = bando(leggiElementoAflink("sater", elementoSater("2202", { link: "http://sater.regione.emilia-romagna.it/portale/index.php/bandi?id=2202" }), ADESSO));
  controlla("http verso l'host di SATER: ammesso; nessun identificativo (forma non riconosciuta)", http?.record.urlAvviso === "http://sater.regione.emilia-romagna.it/portale/index.php/bandi?id=2202" && http?.meta.idPiattaforma === null, http?.record.urlAvviso);
  const altroHost = bando(leggiElementoAflink("sater", elementoSater("2203", { link: "http://altro.esempio.invalid/bando/2203" }), ADESSO));
  controlla("http verso un altro host: scartato, mancante «collegamento»", altroHost?.record.urlAvviso === null && !!altroHost?.mancanti.includes("collegamento"), altroHost?.record.urlAvviso);
  const httpsAltro = bando(leggiElementoAflink("sater", elementoSater("2204", { link: "https://altro.esempio.invalid/bando/2204" }), ADESSO));
  controlla("https verso qualunque host: ammesso come prima", httpsAltro?.record.urlAvviso === "https://altro.esempio.invalid/bando/2204");
  const sardHttp = bando(leggiElementoAflink("sardegnacat", { ...elementoSater("2205"), TipoProcedura: "Aperta", statoFunzionale: "PresOfferte", dataUltimaModifica: "2026-11-24T09:00:00", link: "http://sardegnacat.regione.sardegna.it/x?id=2205" }, ADESSO));
  controlla("SardegnaCAT: http verso il suo host resta scartato (come prima)", sardHttp !== null && sardHttp.record.urlAvviso === null && sardHttp.mancanti.includes("collegamento"), sardHttp?.record.urlAvviso);

  // versione senza «dataUltimaModifica»
  const senzaVersione = bando(leggiElementoAflink("sater", elementoSater("2301"), ADESSO));
  const b = senzaVersione ? bandoDaAflink(senzaVersione, OGGI) : null;
  controlla("senza «dataUltimaModifica»: versione = giorno in cui OMNIA la vede (come Sintel)", !!b && b.versione.id === `2301@${OGGI}` && b.versione.giorno === OGGI && b.versione.istante === null && b.idCambiamento === `2301@${OGGI}`, b?.versione);
  controlla("SardegnaCAT senza «dataUltimaModifica»: elemento malformato (come prima)", esclusione(leggiElementoAflink("sardegnacat", { ...elementoSater("2302"), TipoProcedura: "Aperta", statoFunzionale: "PresOfferte" }, ADESSO)) === "elemento_malformato");
  controlla("regione dell'ente: Emilia-Romagna", senzaVersione?.record.ente.regione === "emilia_romagna" && JSON.stringify(senzaVersione?.regioni) === JSON.stringify(["emilia_romagna"]));
  controlla("una gara scaduta non entra", esclusione(leggiElementoAflink("sater", elementoSater("2303", { DtScadenzaBandoTecnical: "2026-11-20T10:00:00" }), ADESSO)) === "scaduta");
}

function provaPiattaforme(): void {
  const trova = "https://intercenter.regione.emilia-romagna.it/trovabando/BANDO_GARA_PORTALE@17652665";
  controlla("TED e PVL (idPiattaformaDaUrl): «trovabando» NON riconosciuto, nessun cambio per le fonti online", idPiattaformaDaUrl(trova) === null);
  controlla("connettori: «trovabando» → «sater:17652665»", idPiattaformaDaUrlConnettore(trova) === "sater:17652665" && idPiattaformaDaUrlConnettore(trova.replace("https:", "http:")) === "sater:17652665");
  controlla("connettori: altre forme o altri host → nessun identificativo", [
    "https://intercenter.regione.emilia-romagna.it/trovabando/ESITO_GARA@17652665",
    "https://intercenter.regione.emilia-romagna.it/trovabando/BANDO_GARA_PORTALE@abc",
    "https://altro.esempio.invalid/trovabando/BANDO_GARA_PORTALE@17652665",
    "https://intercenter.regione.emilia-romagna.it/altro/trovabando/BANDO_GARA_PORTALE@17652665",
  ].every((u) => idPiattaformaDaUrlConnettore(u) === null));
  const sard = "https://sardegnacat.regione.sardegna.it/Application/CustomDoc/DettaglioProcedura.asp?ID=1031830";
  controlla("SardegnaCAT e Sintel: stesse forme di prima in tutte e due le funzioni", idPiattaformaDaUrl(sard) === "sardegnacat:1031830" && idPiattaformaDaUrlConnettore(sard) === "sardegnacat:1031830" && idPiattaformaDaUrl("https://www.sintel.regione.lombardia.it/eprocdata/auctionDetail.xhtml?id=123") === "sintel:123");
}

async function provaGuardie(): Promise<void> {
  controlla("fonte «sater» riconosciuta (FONTI_RADAR, FONTI_UNITE), precedenza come SardegnaCAT", (FONTI_RADAR as readonly string[]).includes("sater") && FONTI_UNITE.includes("sater") && PRECEDENZA_FONTI.sater === PRECEDENZA_FONTI.sardegnacat);
  controlla("nessuna variabile di produzione per SATER", !("sater" in VARIABILI_PRODUZIONE));
  controlla("staging: SATER ammessa (importazione e notifiche)", fonteAutorizzata("sater", "importazione", STAGING).ok && fonteAutorizzata("sater", "notifiche", STAGING).ok);
  const prod = fonteAutorizzata("sater", "importazione", { ...PROD_DEPLOY, RADAR_SATER_PRODUZIONE: "autorizzata", RADAR_SARDEGNACAT_PRODUZIONE: "autorizzata" });
  controlla("produzione, deploy di produzione, anche con variabili: SATER NON ammessa", !prod.ok && /solo sullo staging/.test(prod.ok ? "" : prod.motivo), prod);
  controlla("anteprima: SATER non ammessa", !fonteAutorizzata("sater", "importazione", { ...STAGING, VERCEL_ENV: "preview" }).ok);
  controlla("console e cron: SATER fuori dalle fonti regionali gestite", !(FONTI_REGIONALI as readonly string[]).includes("sater"));
  controlla("registro dei giri: SATER si registra (dopo la 0134) ma resta fuori da console e allarmi", (FONTI_REGISTRO as readonly string[]).includes("sater") && !(FONTI_ESECUZIONI as readonly string[]).includes("sater"));
  controlla("nessun orario, cron, rotta o interruttore per SATER", !("sater" in ORARI_GIRI) && !("sater" in CRON_PROPOSTI) && !("sater" in ROTTE_CRON) && !("sater" in INTERRUTTORI_CRON));
  controlla("nessuna rotta cron di SATER e nessuna riga in vercel.json", !fs.existsSync(path.join(__dirname, "..", "src/app/api/cron/radar-sater")) && !/sater/i.test(leggi("vercel.json")));
  controlla("console: nessuna voce SATER nelle viste e nelle azioni", !/["']sater["']/.test(leggi("src/app/site-console/_componenti/tender-intelligence-vista.tsx")) && !/sater:/.test(leggi("src/app/site-console/azioni/tender-intelligence.ts")));
  controlla("nessuna fonte nascosta di base (regola 48A/48E invariata)", FONTI_NASCOSTE_PREDEFINITE.length === 0);
  controlla("descrizione della fonte: in costruzione, senza giri previsti, licenza CC BY 4.0 con la citazione della fonte", descrizioneFonte("sater").stato === "in_costruzione" && /non ancora previsti/.test(descrizioneFonte("sater").aggiornamento) && /CC BY 4\.0/.test(descrizioneFonte("sater").licenza) && /citando la fonte/.test(descrizioneFonte("sater").licenza));
  controlla("attribuzione (obbligo CC BY 4.0) presente come per SardegnaCAT: nome, ente e licenza", NOME_FONTE.sater === "SATER" && /Intercent-ER/.test(ATTRIBUZIONE_FONTE.sater) && /CC BY 4\.0/.test(ATTRIBUZIONE_FONTE.sater) && ATTRIBUZIONE_FONTE.sater === CANALE_INTERCENTER.attribuzione && !!ATTRIBUZIONE_FONTE.sardegnacat);

  // giri con il database in memoria: senza la riga della fonte nulla parte; in produzione zero accessi
  const mondo = (conRiga: boolean) => {
    const db = new DbFinto();
    db.tabelle.radar_fonti_stato = [...FONTI_ESECUZIONI, ...(conRiga ? ["sater"] : [])].map((f) => ({ fonte: f, attiva: f === "sater", ultimo_successo_il: null, cursore: null, blocco_fino_a: null, conteggi: {}, nascosta_ai_clienti: f === "sater" }));
    return db;
  };
  const prima = richiesteDiRete;
  const a = mondo(false);
  const ra = await eseguiImportazioneRegionale(a as unknown as SupabaseClient, "sater", { env: STAGING, adesso: () => ADESSO });
  const regA = a.t("radar_esecuzioni");
  controlla("staging SENZA la riga di SATER: «fonte_spenta», nessuna gara, nessuna richiesta; nel registro solo la riga «inerte»", !ra.eseguita && ra.motivo === "fonte_spenta" && (a.tabelle.radar_procedure ?? []).length === 0 && regA.length === 1 && regA[0].fonte === "sater" && regA[0].esito === "inerte", { ra, regA });
  const c = mondo(true);
  const rc = await eseguiImportazioneRegionale(c as unknown as SupabaseClient, "sater", { env: { ...PROD_DEPLOY, RADAR_SATER_PRODUZIONE: "autorizzata", RADAR_CONTATTO_FONTI: "contatto@esempio.invalid" }, adesso: () => ADESSO });
  controlla("produzione: «ambiente_non_consentito», zero accessi al database", !rc.eseguita && rc.motivo === "ambiente_non_consentito" && c.richieste.length === 0, rc);
  controlla("nessuna richiesta di rete in tutti i giri", richiesteDiRete === prima, richiesteDiRete - prima);
}

// ───── canale dell'API del portale Intercent-ER: struttura CONFERMATA sul campione vero (addendum 60C); elementi [SINTETICI] con quella
// struttura (id_intercenter = solo il numero, «@id» = pagina HTML con «BANDO_GARA_PORTALE@<numero>», date con «+00:00», cig = testi) ─────
const BANDI: CartellaIntercenter = { nome: "bandi_altri_enti", tipo: "Bando", percorso: null };
const AVVISI: CartellaIntercenter = { nome: "avvisi_altri_enti", tipo: "Avviso", percorso: null };
const trovabando = (n: number) => `https://intercenter.regione.emilia-romagna.it/trovabando/BANDO_GARA_PORTALE@${n}`;
const pagina = (n: number) => `https://intercenter.regione.emilia-romagna.it/bandi-e-strumenti-di-acquisto/bandi-altri-enti/altri-enti-bandi-e-procedure-di-gara/bandi-altri-enti-aperti/BANDO_GARA_PORTALE@${n}`;
const voce = (n: number, p: Record<string, unknown> = {}): Record<string, unknown> => ({
  "@id": pagina(n),
  "@type": "Bando",
  title: "Servizio di pulizia degli edifici comunali (prova sintetica)",
  description: "Affidamento del servizio di pulizia (prova sintetica)",
  // pubblicazione a mezzanotte di Roma, come sul campione
  effective: "2026-11-23T23:00:00+00:00",
  modified: "2026-11-25T09:00:00+00:00",
  id_intercenter: String(n),
  ente_bando: "COMUNE DI PROVASINTETICA",
  cig: ["B11111111A", "B22222222B"],
  scadenza_bando: "2026-12-15T11:00:00+00:00",
  tipologia_bando_intercenter: "Bando",
  bando_state: "aperto",
  // [SINTETICO] dati di un referente (come nell'XML del dettaglio): NON devono mai uscire dalla lettura
  referenti: [{ nome: "Persona Sintetica", email: "persona.sintetica@esempio.invalid", telefono: "000 0000000" }],
  ...p,
});
const elencoJson = (voci: Record<string, unknown>[], totale = voci.length) => JSON.stringify({ "@id": "https://intercenter.regione.emilia-romagna.it/++api++/prova", items: voci, items_total: totale });

function provaCanaleDichiarato(): void {
  controlla("canale del portale CONFERMATO (60C): le altre guardie restano (solo staging, nessun cron, console senza SATER)", CANALE_INTERCENTER.confermato === true);
  controlla("3 cartelle degli avvisi APERTI: bandi di altri enti, avvisi e indagini di altri enti, bandi di Intercent-ER", JSON.stringify(CANALE_INTERCENTER.cartelle.map((c) => [c.nome, c.tipo])) === JSON.stringify([["bandi_altri_enti", "Bando"], ["avvisi_altri_enti", "Avviso"], ["bandi_intercenter", "Bando"]]) && CANALE_INTERCENTER.cartelle.every((c) => /-aperti$/.test(c.percorso ?? "")));
  controlla("indirizzo dell'elenco: API di Plone, b_size=500, metadata_fields=_all", urlCartellaIntercenter(CANALE_INTERCENTER.cartelle[0]) === "https://intercenter.regione.emilia-romagna.it/++api++/bandi-e-strumenti-di-acquisto/bandi-altri-enti/altri-enti-bandi-e-procedure-di-gara/bandi-altri-enti-aperti?b_size=500&metadata_fields=_all");
  controlla("campi: di Plone e del portale (confermati); niente importo né CPV (non nell'elenco), niente referenti", (["url", "titolo", "descrizione", "pubblicazione", "modifica"] as const).every((k) => CAMPI_INTERCENTER[k].origine === "plone") && (["id", "ente", "cig", "scadenza", "tipologia", "stato"] as const).every((k) => CAMPI_INTERCENTER[k].origine === "portale") && !Object.values(CAMPI_INTERCENTER).some((c) => /importo|cpv|referent|email|telefon/i.test(c.nome)));
  const base = urlCartellaIntercenter(CANALE_INTERCENTER.cartelle[0]) as string;
  const seguente = base.replace("?b_size=500", "?b_start=500&b_size=500");
  controlla("pagina seguente: solo il «batching.next» dello STESSO indirizzo con i soli parametri di paginazione", paginaSeguenteIntercenter(base, seguente) === new URL(seguente).toString()
    && [base.replace("intercenter.regione", "altro.regione"), base.replace("bandi-altri-enti-aperti", "bandi-altri-enti-chiusi") + "&b_start=500", `${base}&b_start=500&q=x`, base.replace("https:", "http:") + "&b_start=500", seguente.replace("b_start=500", "b_start=-1"), 42].every((x) => paginaSeguenteIntercenter(base, x) === null)
    && PAGINE_MASSIME_INTERCENTER >= 5);
  controlla("percorso con «..» o caratteri strani: nessun indirizzo", urlCartellaIntercenter({ ...BANDI, percorso: "../etc" }) === null && urlCartellaIntercenter({ ...BANDI, percorso: "Bandi?x=1" }) === null && urlCartellaIntercenter({ ...BANDI, percorso: null }) === null);
  controlla("citazione della fonte uguale a quella mostrata nelle schede", ATTRIBUZIONE_FONTE.sater === CANALE_INTERCENTER.attribuzione);
}

async function provaLettoreIntercenter(): Promise<void> {
  const richieste: string[] = [];
  // risposte per percorso: la cartella dei bandi in DUE pagine (il portale ne dà 2 per pagina e indica la seguente in «batching.next»)
  const pagine: Record<string, string> = {
    "prova/bandi?b_size=500&metadata_fields=_all": JSON.stringify({ items: [voce(19000001), voce(19000002)], items_total: 3, batching: { next: "https://intercenter.regione.emilia-romagna.it/++api++/prova/bandi?b_start=2&b_size=500&metadata_fields=_all" } }),
    "prova/bandi?b_start=2&b_size=500&metadata_fields=_all": JSON.stringify({ items: [voce(19000003)], items_total: 3 }),
    "prova/avvisi?b_size=500&metadata_fields=_all": elencoJson([voce(19000004, { tipologia_bando_intercenter: "Avviso" })]),
    // un «next» verso un ALTRO percorso non si segue: la cartella resta incompleta (l'importatore accende l'allarme)
    "prova/intercenter?b_size=500&metadata_fields=_all": JSON.stringify({ items: [voce(19000005)], items_total: 2, batching: { next: "https://intercenter.regione.emilia-romagna.it/++api++/prova/altro?b_start=1" } }),
  };
  const reteFinta = (async (url: string | URL | Request) => {
    const u = String(url);
    richieste.push(u);
    const chiave = u.replace("https://intercenter.regione.emilia-romagna.it/++api++/", "");
    return new Response(pagine[chiave] ?? elencoJson([]), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const sessione = () => new SessioneFonte("SATER", { pausaMs: 0, timeoutMs: 1000, tentativi: 1, richiesteMassime: 10 }, reteFinta);
  const canale = CANALE_INTERCENTER as unknown as { confermato: boolean; cartelle: CartellaIntercenter[] };
  const prima = { confermato: canale.confermato, cartelle: canale.cartelle };
  let errore: { message?: string; sospendi?: boolean } | null = null;
  try {
    // canale NON confermato (solo per la prova): nessuna richiesta
    canale.confermato = false;
    try {
      await new LettoreIntercenter(sessione()).leggiCartelle();
    } catch (e) {
      errore = e as { message?: string; sospendi?: boolean };
    }
    controlla("API del portale: canale non confermato → nessuna richiesta, nessuna sospensione", richieste.length === 0 && /non confermato/.test(errore?.message ?? "") && errore?.sospendi === false, errore?.message);
    canale.confermato = true;
    canale.cartelle = [{ ...BANDI, percorso: "prova/bandi" }, { ...AVVISI, percorso: null }, { nome: "bandi_intercenter", tipo: "Bando", percorso: "prova/intercenter" }];
    errore = null;
    try {
      await new LettoreIntercenter(sessione()).leggiCartelle();
    } catch (e) {
      errore = e as { message?: string; sospendi?: boolean };
    }
    controlla("un solo percorso mancante: nessuna richiesta (mai letture parziali)", richieste.length === 0 && /avvisi_altri_enti/.test(errore?.message ?? ""), errore?.message);
    canale.cartelle = [{ ...BANDI, percorso: "prova/bandi" }, { ...AVVISI, percorso: "prova/avvisi" }, { nome: "bandi_intercenter", tipo: "Bando", percorso: "prova/intercenter" }];
    const letto = await new LettoreIntercenter(sessione()).leggiCartelle();
    const [bandi, avvisi, intercenter] = letto.cartelle;
    controlla("pagine: la seguente letta dal «batching.next» del portale fino a «items_total»; 4 richieste, solo verso l'API", richieste.length === 4 && richieste.every((u) => u.startsWith("https://intercenter.regione.emilia-romagna.it/++api++/prova/")) && bandi.elementi.length === 3 && bandi.pagine === 2 && bandi.totaleDichiarato === 3, { richieste, pagine: letto.cartelle.map((c) => c.pagine) });
    controlla("un «next» verso un altro percorso NON si segue: cartella incompleta (1 su 2), dichiarata dal totale", intercenter.elementi.length === 1 && intercenter.totaleDichiarato === 2 && intercenter.pagine === 1 && avvisi.elementi.length === 1);
    controlla("i dati dei referenti non escono mai dalla lettura", !JSON.stringify(letto).includes("esempio.invalid") && !JSON.stringify(letto).includes("Persona Sintetica"));
  } finally {
    canale.confermato = prima.confermato;
    canale.cartelle = prima.cartelle;
  }
  controlla("canale rimesso com'era dopo la prova", CANALE_INTERCENTER.confermato === true && CANALE_INTERCENTER.cartelle.every((c) => /^bandi-e-strumenti-di-acquisto\//.test(c.percorso ?? "")));
}

function provaElenco(): void {
  const ok1 = leggiElencoIntercenter(elencoJson([voce(19000001), voce(19000002)]));
  controlla("elenco: elementi ridotti ai soli campi dichiarati", !("errore" in ok1) && ok1.elementi.length === 2 && ok1.totaleDichiarato === 2 && !("referenti" in (ok1.elementi[0] as object)) && Object.keys(ok1.elementi[0]).every((k) => k in CAMPI_INTERCENTER), ok1);
  controlla("non JSON, senza «items», senza i campi dichiarati, vuoto con totale > 0: formato non riconosciuto", ["<html>verifica</html>", JSON.stringify({ risultati: [] }), elencoJson([{ "@id": "https://x.invalid/1", titolo: "altro formato" }]), elencoJson([], 5)].every((t) => "errore" in leggiElencoIntercenter(t)));
  controlla("elenco vuoto e coerente: zero elementi, nessun errore", !("errore" in leggiElencoIntercenter(elencoJson([]))));
}

function provaElementiIntercenter(): void {
  // l'elemento in prova insieme a uno completo: un solo elemento incompleto non è un cambio di formato dell'elenco
  const el = (c: CartellaIntercenter, v: Record<string, unknown>) => {
    const r = leggiElencoIntercenter(elencoJson([v, voce(19009999)]));
    return "errore" in r ? null : leggiElementoIntercenter(c, r.elementi[0], ADESSO);
  };
  const bando = (x: ReturnType<typeof el>) => (x?.tipo === "bando" ? (x as BandoIntercenter) : null);
  const motivo = (x: ReturnType<typeof el>) => (x?.tipo === "esclusione" ? (x as EsclusioneIntercenter).motivo : null);

  const b = bando(el(BANDI, voce(19000001)));
  controlla("bando: chiave e identificativo da «id_intercenter» (sater:<numero>); collegamento mostrato = pagina del bando, mai il «trovabando» (rotta non provata)", !!b && b.record.chiaveProcedura === "sater:19000001" && b.meta.idPiattaforma === "sater:19000001" && b.record.urlAvviso === pagina(19000001) && b.record.urlDocumenti === pagina(19000001) && b.lottiDocumenti.every((x) => x === pagina(19000001)) && !JSON.stringify(b.record).includes("/trovabando/"), b?.record.urlDocumenti);
  controlla("bando: un lotto per CIG, nell'ordine dato", JSON.stringify(b?.record.lotti.map((l) => [l.numero, l.cig])) === JSON.stringify([["LOT-0001", "B11111111A"], ["LOT-0002", "B22222222B"]]));
  controlla("bando: scadenza UTC → giorno di Roma e istante; ente e regione", b?.record.scadenzaGiorno === "2026-12-15" && b?.record.scadenzaOfferte === "2026-12-15T11:00:00.000Z" && b?.record.scadenzaOraIndicata === true && b?.record.ente.denominazione === "COMUNE DI PROVASINTETICA" && b?.record.ente.regione === "emilia_romagna");
  controlla("bando: senza procedura nell'oggetto entra, procedura non scritta, mancanti dichiarati (cpv, tipo_procedura)", b?.record.tipoProcedura === null && !!b?.mancanti.includes("tipo_procedura") && !!b?.mancanti.includes("cpv") && b?.opportunita.tipo === "bando");
  controlla("bando: nessun importo (l'elenco non lo dà: mancante «valore», mai dal dettaglio); pubblicazione al giorno di Roma", b?.record.valoreBase === null && !!b?.mancanti.includes("valore") && b?.record.dataPubblicazione === "2026-11-24");
  controlla("bando: lo stato del portale entra nell'impronta, senza essere interpretato", !!b && b.meta.stato === "aperto" && bando(el(BANDI, voce(19000001, { bando_state: "altro_valore" })))?.record.impronta !== b.record.impronta && bando(el(BANDI, voce(19000001, { bando_state: "altro_valore" })))?.record.annullata === false);
  controlla("tipologia dell'elemento: vale più della cartella («Avviso» in una cartella di bandi)", bando(el(BANDI, voce(19000012, { tipologia_bando_intercenter: "Avviso", title: "Avviso di indagine di mercato. Servizio di pulizia degli edifici comunali (prova sintetica)" })))?.opportunita.tipo === "indagine_mercato" && tipologiaIntercenter("bando") === "Bando" && tipologiaIntercenter("Esito") === null);
  controlla("pagina del portale: solo https sul suo host, senza «/++api++»", paginaIntercenter("https://intercenter.regione.emilia-romagna.it/++api++/bandi/x") === "https://intercenter.regione.emilia-romagna.it/bandi/x" && paginaIntercenter("http://intercenter.regione.emilia-romagna.it/bandi/x") === null && paginaIntercenter("https://altro.esempio.invalid/bandi/x") === null && motivo(el(BANDI, voce(19000013, { "@id": "https://altro.esempio.invalid/bandi/x" }))) === "elemento_malformato");
  controlla("identificativo: SOLO il numero (come sul campione); «trovabando» calcolato coerente con la regola dei connettori", numeroIntercenter("18703298") === "18703298" && numeroIntercenter(18703298) === "18703298" && numeroIntercenter("BANDO_GARA_PORTALE@18703298") === null && numeroIntercenter("12a") === null && numeroIntercenter(-5) === null && collegamentoTrovabando("18703298") === trovabando(18703298) && idPiattaformaDaUrlConnettore(collegamentoTrovabando("18703298")) === "sater:18703298");
  controlla("numero nella pagina del bando: letto dall'«@id»", numeroDallaPagina(pagina(18703298)) === "18703298" && numeroDallaPagina("https://intercenter.regione.emilia-romagna.it/bandi/altro") === null);
  controlla("numero dell'«@id» diverso da «id_intercenter»: elemento incoerente, non si scrive", motivo(el(BANDI, voce(19000014, { "@id": pagina(19000099) }))) === "identificativo_incoerente");
  controlla("procedura aperta nell'oggetto: scritta", bando(el(BANDI, voce(19000003, { title: "Procedura aperta per il servizio di pulizia delle scuole (prova sintetica)" })))?.record.tipoProcedura === "Procedura aperta");
  controlla("negoziata nell'oggetto: non entra", motivo(el(BANDI, voce(19000004, { title: "Procedura negoziata per il servizio di pulizia (prova sintetica)" }))) === "riservata");
  // (classificazione sul solo testo: il classificatore comune vuole il servizio affidato come attività principale; «Indagine di mercato per
  // il servizio di …» da solo resta «citato», regola parola_chiave_citata, invariata)
  const avviso = bando(el(AVVISI, voce(19000005, { title: "Avviso di indagine di mercato. Servizio di pulizia degli edifici comunali (prova sintetica)", description: "", cig: [], tipologia_bando_intercenter: "Avviso" })));
  controlla("cartella degli avvisi: indagine di mercato, senza CIG (mancante «cig», nessun lotto)", avviso?.opportunita.tipo === "indagine_mercato" && avviso?.record.lotti.length === 0 && !!avviso?.mancanti.includes("cig") && !avviso?.mancanti.includes("tipo_procedura"), avviso?.opportunita);
  controlla("senza «id_intercenter» o con un identificativo di altra forma: nessuna chiave inventata, non si scrive", motivo(el(BANDI, voce(19000006, { id_intercenter: "" }))) === "senza_identificativo" && motivo(el(BANDI, voce(19000007, { id_intercenter: "BANDO_GARA_PORTALE@19000007" }))) === "senza_identificativo");
  controlla("scaduta: non entra", motivo(el(BANDI, voce(19000008, { scadenza_bando: "2026-11-20T10:00:00+00:00" }))) === "scaduta");
  controlla("fuori dai settori: non entra", ["fuori_settore", "esclusa_per_oggetto"].includes(motivo(el(BANDI, voce(19000009, { title: "Lavori di manutenzione straordinaria delle strade comunali (prova sintetica)", description: "Lavori stradali (prova sintetica)" }))) ?? ""));
  controlla("scadenza: mezzanotte di Roma = giorno senza ora; senza fuso = nessuna scadenza (mai interpretata)", JSON.stringify(scadenzaIntercenter("2026-12-14T23:00:00Z")) === JSON.stringify({ giorno: "2026-12-15", iso: null, oraIndicata: false, fonte: "2026-12-14T23:00:00Z (UTC; mezzanotte: ora non indicata)" }) && scadenzaIntercenter("2026-12-15T12:00:00") === null);
  const senzaFuso = bando(el(BANDI, voce(19000010, { scadenza_bando: "2026-12-15T12:00:00" })));
  controlla("scadenza senza fuso: la gara entra con il mancante «scadenza»", !!senzaFuso?.mancanti.includes("scadenza") && senzaFuso?.record.scadenzaGiorno === null);
  controlla("CIG: elenco o testo, solo validi, senza doppioni", JSON.stringify(cigIntercenter(["b11111111a", "B11111111A", "N/D", "AAAAAAAAAA"])) === JSON.stringify(["B11111111A"]) && JSON.stringify(cigIntercenter("B11111111A; B22222222B")) === JSON.stringify(["B11111111A", "B22222222B"]));

  const r1 = b ? bandoDaIntercenter(b, OGGI) : null;
  controlla("bando regionale: fonte «sater», versione = data di modifica del portale", r1?.fonte === "sater" && r1.piattaformaId === "sater:19000001" && r1.versione.id === "19000001@2026-11-25T09:00:00.000Z" && r1.versione.giorno === "2026-11-25" && r1.dichiarazione === null, r1?.versione);
  const senzaModifica = bando(el(BANDI, voce(19000011, { modified: undefined })));
  const r2 = senzaModifica ? bandoDaIntercenter(senzaModifica, OGGI) : null;
  controlla("senza data di modifica: versione = giorno in cui OMNIA la vede", r2?.versione.id === `19000011@${OGGI}` && r2?.versione.istante === null);
}

async function provaGiroIntercenter(): Promise<void> {
  // canale confermato SOLO per la prova, riga di SATER accesa (simulata), staging: il giro scrive con il motore di unione unico
  const canale = CANALE_INTERCENTER as unknown as { confermato: boolean; cartelle: CartellaIntercenter[] };
  const prima = { confermato: canale.confermato, cartelle: canale.cartelle };
  const richieste: string[] = [];
  const risposte: Record<string, Record<string, unknown>[]> = {
    "prova/bandi": [voce(19000101), voce(19000102, { title: "Lavori stradali (prova sintetica)", description: "" })],
    "prova/avvisi": [voce(19000103, { title: "Manifestazione di interesse per il servizio di portierato (prova sintetica)", description: "", cig: [], tipologia_bando_intercenter: "Avviso" })],
    // la stessa procedura anche nella terza cartella: si legge una volta sola
    "prova/intercenter": [voce(19000101)],
  };
  const reteFinta = (async (url: string | URL | Request) => {
    const u = String(url);
    richieste.push(u);
    const chiave = Object.keys(risposte).find((k) => u.includes(`/++api++/${k}?`)) ?? "";
    return new Response(elencoJson(risposte[chiave] ?? []), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const db = new DbFinto();
  db.tabelle.radar_fonti_stato = [...FONTI_ESECUZIONI, "sater"].map((f) => ({ fonte: f, attiva: f === "sater", ultimo_successo_il: null, cursore: null, blocco_fino_a: null, conteggi: {}, nascosta_ai_clienti: f === "sater", dati_aggiornati_al: null }));
  try {
    canale.confermato = true;
    canale.cartelle = [{ ...BANDI, percorso: "prova/bandi" }, { ...AVVISI, percorso: "prova/avvisi" }, { nome: "bandi_intercenter", tipo: "Bando", percorso: "prova/intercenter" }];
    const r = await eseguiImportazioneRegionale(db as unknown as SupabaseClient, "sater", { env: STAGING, adesso: () => ADESSO, fetchFn: reteFinta, origine: "script", limiti: { tentativi: 1 } });
    const gare = db.t("radar_procedure");
    const reg = db.t("radar_esecuzioni");
    controlla("giro (simulato): 3 richieste, nessun errore; una riga «ok» di «sater» nel registro dei giri (dopo la 0134)", r.eseguita && !r.errore && richieste.length === 3 && r.esecuzione.scritta && reg.length === 1 && reg[0].fonte === "sater" && reg[0].esito === "ok", { r, reg });
    controlla("giro: 2 gare scritte (bando di pulizia e manifestazione di portierato), lavori stradali esclusi, doppione tra cartelle contato", gare.length === 2 && r.eseguita && (r.statistiche.esclusi.doppione_tra_cartelle ?? 0) === 1, { gare: gare.map((g) => g.chiave), esclusi: r.eseguita ? r.statistiche.esclusi : null });
    controlla("gare con chiave e piattaforma_id «sater:<numero>»", gare.every((g) => typeof g.chiave === "string" && /^sater:\d+$/.test(g.chiave) && g.piattaforma_id === g.chiave), gare.map((g) => [g.chiave, g.piattaforma_id]));
    controlla("provenienza: righe della fonte «sater»", db.t("radar_procedure_fonti").length > 0 && db.t("radar_procedure_fonti").every((f) => f.fonte === "sater"));
    controlla("nessun dato dei referenti nel database", !JSON.stringify(db.tabelle).includes("esempio.invalid"));
    const r2 = await eseguiImportazioneRegionale(db as unknown as SupabaseClient, "sater", { env: STAGING, adesso: () => ADESSO, fetchFn: reteFinta, origine: "script", limiti: { tentativi: 1 } });
    controlla("secondo giro con gli stessi dati: nessuna gara nuova (stessa impronta)", r2.eseguita && !r2.errore && db.t("radar_procedure").length === 2 && r2.statistiche.nuove === 0, r2.eseguita ? { nuove: r2.statistiche.nuove, invariati: r2.statistiche.invariati } : r2);
  } finally {
    canale.confermato = prima.confermato;
    canale.cartelle = prima.cartelle;
  }
}

// ───── NON REGRESSIONE di SardegnaCAT: le stesse uscite del codice di 95fa929 su elementi [SINTETICI] ─────
// L'impronta è stata calcolata con aflink-calcoli.ts e importa-regionali-calcoli.ts di 95fa929 (copiati a parte, poi cancellati) sugli
// STESSI elementi qui sotto, con lo stesso istante e lo stesso giorno: «67861d9dccbb184c». Qualunque differenza nelle uscite la cambia.
const IMPRONTA_SARDEGNACAT_95FA929 = "67861d9dccbb184c";
const baseSardegna = (id: string, p: Record<string, string> = {}): Record<string, string> => ({
  IdMsg: id,
  Oggetto: "Servizio di pulizia degli uffici comunali (prova sintetica)",
  TitoloDocumento: "Pulizia uffici (prova sintetica)",
  DenominazioneEnte: "COMUNE DI PROVASINTETICA",
  CPV: "90910000-9 - Servizi di pulizia",
  a_base_asta: "120.000,00",
  DtScadenzaBandoTecnical: "2026-12-10T12:00:00",
  DtPubblicazioneTecnical: "2026-11-20T09:30:00",
  CIG: "B123456789",
  Tipo: "Bando",
  TipoProcedura: "Aperta",
  Contratto: "Servizi",
  statoFunzionale: "PresOfferte",
  dataUltimaModifica: "2026-11-21T08:00:00",
  link: `https://sardegnacat.regione.sardegna.it/portale/index.php/bandi?scadenzaBando=2026-12-10T12:00:00&id=${id}`,
  ...p,
});
const ELEMENTI_SARDEGNACAT: Record<string, string>[] = [
  baseSardegna("900001"),
  baseSardegna("900002", { CIG: "CIG VARI" }),
  baseSardegna("900003", { CIG: "" }),
  baseSardegna("900004", { Oggetto: "<strong>Bando Rettificato - </strong> Servizio di pulizia scuole (prova sintetica)" }),
  baseSardegna("900005", { Oggetto: "<strong>Bando Revocato - </strong> Servizio di vigilanza (prova sintetica)", CPV: "79713000-5 - Servizi di guardia" }),
  baseSardegna("900006", { Oggetto: "<strong>Procedura Ripristinata - </strong> Servizio di pulizia (prova sintetica)" }),
  baseSardegna("900007", { TipoProcedura: "Negoziata" }),
  baseSardegna("900008", { TipoProcedura: "Affidamento diretto" }),
  baseSardegna("900009", { Tipo: "Avviso", TipoProcedura: "", Oggetto: "Avviso di indagine di mercato per il servizio di pulizia (prova sintetica)" }),
  baseSardegna("900010", { Tipo: "Avviso", TipoProcedura: "", Oggetto: "Manifestazione di interesse per il servizio di portierato (prova sintetica)", CPV: "98341140-8 - Servizi di portineria" }),
  baseSardegna("900011", { DtScadenzaBandoTecnical: "2026-11-20T10:00:00" }),
  baseSardegna("900012", { DtScadenzaBandoTecnical: "2026-12-10T00:00:00" }),
  baseSardegna("900013", { link: "" }),
  baseSardegna("900014", { link: "http://sardegnacat.regione.sardegna.it/portale/index.php/bandi?id=900014" }),
  baseSardegna("900015", { dataUltimaModifica: "" }),
  baseSardegna("900016", { TipoProcedura: "" }),
  baseSardegna("900017", { statoFunzionale: "" }),
  baseSardegna("900018", { Oggetto: "Fornitura di arredi per uffici (prova sintetica)", CPV: "39130000-2 - Mobili per ufficio", Contratto: "Forniture" }),
  baseSardegna("900019", { Oggetto: "Servizio di ristorazione scolastica (prova sintetica)", CPV: "55524000-9 - Servizi di ristorazione scolastica", a_base_asta: "35086" }),
  baseSardegna("900020", { TipoProcedura: "Ristretta", a_base_asta: "non indicato" }),
  baseSardegna("abc", {}),
  baseSardegna("900021", { Tipo: "Esito" }),
  baseSardegna("900022", { Oggetto: "", TitoloDocumento: "Pulizia palestra (prova sintetica)" }),
  baseSardegna("900023", { DenominazioneEnte: "Comune di Provasintetica di Sopra" }),
];

function provaNonRegressione(): void {
  const uscite = ELEMENTI_SARDEGNACAT.map((e) => {
    const a = leggiElementoAflink("sardegnacat", e, ADESSO);
    return [a, a.tipo === "bando" ? bandoDaAflink(a as BandoAflink, OGGI) : null];
  });
  const impronta = createHash("sha256").update(JSON.stringify(uscite)).digest("hex").slice(0, 16);
  controlla(`SardegnaCAT: le ${ELEMENTI_SARDEGNACAT.length} gare sintetiche danno le STESSE uscite di 95fa929 (impronta ${IMPRONTA_SARDEGNACAT_95FA929})`, impronta === IMPRONTA_SARDEGNACAT_95FA929, impronta);
}

async function principale(): Promise<void> {
  provaIstanze();
  await provaLettore();
  provaFeed();
  provaElementi();
  provaPiattaforme();
  await provaGuardie();
  provaCanaleDichiarato();
  await provaLettoreIntercenter();
  provaElenco();
  provaElementiIntercenter();
  await provaGiroIntercenter();
  provaNonRegressione();
}
principale()
  .catch((e) => falliti.push(`eccezione: ${e instanceof Error ? e.stack ?? e.message : String(e)}`))
  .finally(() => {
    console.log(`Verifica del connettore SATER (Fase 2): ${ok} ok, ${falliti.length} falliti`);
    for (const f of falliti) console.log(`  FALLITO: ${f}`);
    process.exit(falliti.length ? 1 : 0);
  });
