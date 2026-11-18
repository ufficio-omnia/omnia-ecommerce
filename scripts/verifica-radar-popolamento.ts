// Verifica della fase B2b (17/11/2026): classificatore completo, script UNICO e idempotente di riclassificazione e popolamento della 0121,
// importatori collegati alla classificazione (SPENTI). Nessuna rete e nessun database vero: dati SINTETICI e database in memoria.
//   A. motore: aggiunge e toglie settori, metodo, natura, decisioni dell'amministratore, registro, esecuzione;
//   B. piano gara per gara: righe coerenti con la colonna, stato, idempotenza, riepilogo con le righe esatte;
//   C. script sul database in memoria: prova senza scritture, applicazione, seconda esecuzione SENZA scritture, modifica concorrente,
//      cambio delle regole con lo storico, ripristino controllato (e ripetuto), tetto; gare, lotti, provenienze e salvate intatti;
//   D. importatori: spenti di base; accesi (solo staging) tengono coerenti colonna, righe, stato, provenienze e storico; lo script dopo
//      un'importazione non scrive nulla;
//   E. testo dello script e delle librerie (porta, solo staging, sola lettura della prova, nessuna cancellazione, registro mai notificabile).
// Controlli spostati dalla qualità della PVL (sezioni 8 e 9) e aggiornati: dalla fase B2b lo script è di B2.
import fs from "fs";
import os from "os";
import path from "path";
import { databaseInMemoria, type RigaMem } from "./lib/db-in-memoria";
import { MOTIVO_NON_RICONOSCIUTO, REGOLA_NON_RICONOSCIUTO, VERSIONE_REGOLE_SETTORI, descriviCorrezioneSettori } from "../src/lib/radar/settori";
import { REGOLA_NATURA } from "../src/lib/radar/classificazione-unita";
import {
  categoriaGara,
  giaClassificata,
  idEsecuzione,
  idFonteRiclassificazione,
  isoDaEsecuzione,
  notaCorrezione,
  pianoGara,
  riclassificaGara,
  riepilogoPiani,
  statoDaRegistro,
  valoreRegistro,
  type GaraArchivio,
} from "../src/lib/radar/riclassifica-settori";
import { annullaEsecuzione, applicaPiani, diarioDaPiani, leggiArchivio, pianiDaArchivio, TroppeGare } from "../src/lib/radar/riclassificazione";
import { classificaImportazione, lottiDopoScrittura, rigaRegistroImportazione } from "../src/lib/radar/classificazioni-importazione";
import { classificazioniAttive } from "../src/lib/radar/ambiente";
import { applicaPaginaBandi } from "../src/lib/radar/importa";
import { applicaPaginaBandiRegionali } from "../src/lib/radar/importa-regionali-pagina";
import { bandoDaAflink, statisticheRegionaliVuote, type BandoRegionale } from "../src/lib/radar/importa-regionali-calcoli";
import { leggiElementoAflink, type BandoAflink } from "../src/lib/radar/fonti/aflink-calcoli";
import { eEsclusione, leggiBandoTed } from "../src/lib/radar/fonti/ted-calcoli";
import { etichettaRilevanza, gareSuggeribili, situazioneGara, type RigaClassificazione } from "../src/lib/radar/classificazioni-calcoli";
import { leggiRilevanze } from "../src/lib/radar/classificazioni";
import { analizzaDomanda, etichettaRicerca, ordinaCandidati, punteggioRilevanza } from "../src/lib/radar/ricerca-calcoli";
import { archivioDaFile, fetchSoloLettura } from "./radar-riclassifica-settori";

const RADICE = path.join(__dirname, "..");
const leggi = (r: string) => fs.readFileSync(path.join(RADICE, r), "utf8");
const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok || !dettaglio ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale(nome: string, reale: unknown, previsto: unknown) {
  const a = JSON.stringify(reale);
  const b = JSON.stringify(previsto);
  atteso(nome, a === b, `atteso ${b}, ottenuto ${a}`);
}

const OGGI = "2026-11-17";
const ADESSO = new Date("2026-11-17T12:00:00.000Z");
const ISO = ADESSO.toISOString();
const misure = () => ({ richiesteDb: 0, msDb: 0 });
let n = 0;
const nuovoId = () => `id-${++n}`;

// ───── dati SINTETICI ─────
const MENSA = "Servizio di ristorazione scolastica (prova sintetica)";
const PIZZA = "Fornitura pizza per le scuole (prova sintetica)";
const REFEZIONE = "Servizio di refezione scolastica (prova sintetica)";
const RSA = "Gestione dei servizi socio-assistenziali e di ristorazione della residenza per anziani (prova sintetica)";
function gara(id: string, p: Partial<RigaMem> = {}): RigaMem {
  return {
    id,
    chiave: `ted:proc-${id}`,
    oggetto: MENSA,
    oggetto_breve: "Prova sintetica",
    descrizione: null,
    sa_codice_fiscale: "00000000001",
    sa_denominazione: "COMUNE DI PROVASINTETICA",
    sa_comune: null,
    sa_provincia: null,
    sa_regione: "sardegna",
    codice_nuts: null,
    luogo_regioni: ["sardegna"],
    ente_tipo: null,
    tipo_avviso: "cn-standard",
    tipo_procedura: "Procedura aperta",
    criterio_aggiudicazione: null,
    natura_contratto: "servizi",
    settori_speciali: false,
    data_pubblicazione: "2026-11-01",
    scadenza_giorno: "2026-12-10",
    scadenza_offerte: "2026-12-10T09:00:00.000Z",
    scadenza_ora_indicata: true,
    scadenza_fonte: "2026-12-10+01:00 10:00:00+01:00",
    valore_stimato: 2000000,
    durata_mesi: null,
    n_lotti: 1,
    stato: "aperta",
    rettificata: false,
    url_avviso: null,
    url_documenti: null,
    piattaforma_host: null,
    cpv_principale: "55524000",
    cpv_tutti: ["55524000"],
    settori: ["ristorazione"],
    metodo_settore: "cpv",
    ultima_versione_il: "2026-11-01",
    ultima_versione_id: "700001-2026",
    ultima_rilevazione_il: "2026-11-01T08:00:00.000Z",
    aggiornata_il: "2026-11-01T08:00:00.000Z",
    valore_base: null,
    piattaforma_id: null,
    tipo_opportunita: "bando",
    partecipazione: "libera",
    provenienza_campi: {},
    unita_a: null,
    unita_il: null,
    unita_motivo: null,
    unita_esclusa_con: [],
    fonti: ["ted"],
    prima_rilevazione_il: "2026-11-01T08:00:00.000Z",
    ...p,
  };
}
const lotto = (procedura_id: string, numero: string, p: Partial<RigaMem> = {}): RigaMem => ({ id: `${procedura_id}-${numero}`, procedura_id, numero_lotto: numero, cig: null, oggetto: null, cpv_principale: "55524000", cpv_tutti: ["55524000"], valore_stimato: 1000000, durata_mesi: null, scadenza_giorno: "2026-12-10", scadenza_offerte: "2026-12-10T09:00:00.000Z", scadenza_ora_indicata: true, scadenza_fonte: null, url_documenti: null, ...p });
const prov = (procedura_id: string, fonte: string, id_fonte: string, p: Partial<RigaMem> = {}): RigaMem => ({ procedura_id, fonte, id_fonte, impronta: `imp-${id_fonte}`, id_procedura_fonte: id_fonte, rif_ted: null, ...p });
const comeArchivio = (g: RigaMem): GaraArchivio => g as unknown as GaraArchivio;

function archivio() {
  return {
    radar_procedure: [
      gara("G1"),
      gara("G2", { oggetto: PIZZA }),
      gara("G3", { oggetto: REFEZIONE, settori: [], metodo_settore: null }),
      gara("G4", { oggetto: RSA }),
      gara("G5", { oggetto: "Servizi di pulizia e di vigilanza delle sedi (prova sintetica)", cpv_principale: "90910000", cpv_tutti: ["90910000", "79713000"], settori: ["pulizia", "vigilanza_portierato"] }),
      gara("G6", { unita_a: "G1" }),
      gara("G7", { chiave: "pvl:av-7", fonti: ["pvl", "ted"], oggetto: "Servizio di pulizia degli uffici (prova sintetica)", cpv_principale: "90919200", cpv_tutti: ["90919200"], settori: ["pulizia"], metodo_settore: "parole_chiave" }),
    ],
    radar_lotti: [lotto("G5", "LOT-0001", { oggetto: "Lotto 1: pulizia (prova sintetica)", cpv_principale: "90910000", cpv_tutti: ["90910000"] }), lotto("G5", "LOT-0002", { oggetto: "Lotto 2: vigilanza armata (prova sintetica)", cpv_principale: "79713000", cpv_tutti: ["79713000"] }), lotto("G7", "LOT-0001", { cig: "PRV0000007", cpv_principale: "90919200", cpv_tutti: ["90919200"] })],
    radar_procedure_fonti: [prov("G1", "ted", "700001-2026"), prov("G7", "pvl", "av-7"), prov("G7", "ted", "700007-2026")],
    radar_aggiornamenti: [{ procedura_id: "G1", tipo: "nuova", campo: null, valore_precedente: null, valore_nuovo: null, fonte: "ted", id_fonte: "700001-2026", notificabile: true }],
    radar_classificazioni: [] as RigaMem[],
    radar_classificazioni_stato: [] as RigaMem[],
    omnia_ai_radar_salvate: [{ id: "S1", procedura_id: "G2", monitorata: true }],
    omnia_ai_radar_gare_aggiunte: [],
  };
}
type Mem = ReturnType<typeof databaseInMemoria>;
const garaDi = (mem: Mem, id: string) => mem.tabelle.radar_procedure.find((g) => g.id === id) as RigaMem;
const attiveDi = (mem: Mem, id: string) => mem.tabelle.radar_classificazioni.filter((r) => r.procedura_id === id && r.attiva).map((r) => `${r.settore}=${r.rilevanza}`).sort();
const statoDi = (mem: Mem, id: string) => mem.tabelle.radar_classificazioni_stato.find((s) => s.procedura_id === id) as RigaMem | undefined;
const scritture = (mem: Mem) => Object.values(mem.scritture()).reduce((a, b) => a + b, 0);
// coerenza: per ogni gara classificata la colonna = i settori con una riga attiva A o B
function incoerenti(mem: Mem): string[] {
  return mem.tabelle.radar_procedure
    .filter((g) => statoDi(mem, g.id as string)?.stato === "classificata")
    .filter((g) => {
      const righe = mem.tabelle.radar_classificazioni.filter((r) => r.procedura_id === g.id && r.attiva && (r.rilevanza === "A" || r.rilevanza === "B")).map((r) => r.settore as string).sort();
      return JSON.stringify(righe) !== JSON.stringify([...((g.settori as string[]) ?? [])].sort());
    })
    .map((g) => String(g.id));
}
function doppie(mem: Mem): number {
  const k = mem.tabelle.radar_classificazioni.filter((r) => r.attiva).map((r) => `${r.procedura_id}|${r.settore}`);
  return k.length - new Set(k).size;
}

async function principale() {
  // ═════ A. motore ═════
  {
    const base = { id: "x", cpv_tutti: null, natura_contratto: "servizi" };
    const agg = riclassificaGara({ ...base, oggetto: REFEZIONE, cpv_principale: "55524000", settori: [], metodo_settore: null }, []);
    uguale("A. una gara che ACQUISISCE un settore si corregge (prima restava com'era)", [agg.tipo, agg.aggiunti, agg.tolti, agg.dopo], ["correzione", ["ristorazione"], [], { settori: ["ristorazione"], metodo: "cpv" }]);
    const tolta = riclassificaGara({ ...base, oggetto: PIZZA, cpv_principale: "55524000", settori: ["ristorazione"], metodo_settore: "cpv" }, []);
    uguale("A. una gara esclusa perde il settore, con la regola", [tolta.tipo, tolta.dopo, tolta.esclusioni.map((e) => e.regola)], ["correzione", { settori: [], metodo: null }, ["forniture_di_beni"]]);
    uguale("A. gara pertinente invariata", riclassificaGara({ ...base, oggetto: MENSA, cpv_principale: "55524000", settori: ["ristorazione"], metodo_settore: "cpv" }, []).tipo, "invariata");
    uguale("A. gara correlata (B) invariata nella colonna", riclassificaGara({ ...base, oggetto: RSA, cpv_principale: "55524000", settori: ["ristorazione"], metodo_settore: "cpv" }, []).tipo, "invariata");
    const metodo = riclassificaGara({ ...base, oggetto: MENSA, cpv_principale: "55524000", settori: ["ristorazione"], metodo_settore: "parole_chiave" }, []);
    uguale("A. stessi settori ma metodo diverso: correzione «solo metodo»", [metodo.tipo, metodo.soloMetodo, metodo.aggiunti, metodo.tolti], ["correzione", true, [], []]);
    const natura = riclassificaGara({ ...base, oggetto: "Fornitura di attrezzature con servizio di pulizia (prova sintetica)", cpv_principale: "39000000", natura_contratto: "forniture", settori: ["pulizia"], metodo_settore: "parole_chiave" }, []);
    uguale("A. parola chiave su una fornitura: fuori dalla colonna, ma considerata C con il motivo (mai senza righe)", [natura.dopo.settori, natura.classificazione.perSettore.pulizia?.livello, natura.classificazione.perSettore.pulizia?.regole], [[], "C", [REGOLA_NATURA]]);
    const sparito = riclassificaGara({ ...base, oggetto: "Servizi integrati di gestione documentale (prova sintetica)", cpv_principale: "79999100", settori: ["multiservizi"], metodo_settore: "parole_chiave" }, []);
    uguale("A. settore che le regole non vedono più affatto: tolto, con una riga C «non_riconosciuto» e il motivo (mai senza righe)", [sparito.dopo.settori, sparito.esclusioni.map((e) => e.regola), sparito.classificazione.perSettore.multiservizi?.livello, sparito.classificazione.perSettore.multiservizi?.motivi, sparito.classificazione.livello], [[], ["non_riconosciuto"], "C", ["Né i CPV né l'oggetto indicano più il settore"], "C"]);
    const lotti = riclassificaGara({ ...base, oggetto: "lotto1", cpv_principale: "90910000", cpv_tutti: ["90910000", "98341130"], settori: ["pulizia", "vigilanza_portierato"], metodo_settore: "cpv" }, [{ oggetto: "SERVIZIO DI CUSTODIA, SICUREZZA E PULIZIA AMBIENTALE DEGLI IMPIANTI SPORTIVI", cpv_principale: "90910000", cpv_tutti: null }]);
    uguale("A. legge anche gli oggetti dei lotti (come gli importatori)", lotti.tipo, "invariata");
    const admin = (settore: string, rilevanza: "A" | "B" | "C") => ({ settore: settore as RigaClassificazione["settore"], rilevanza, attiva: true, origine: "amministratore" as const });
    uguale("A. decisione dell'amministratore: vale più del calcolo, anche per la colonna (C toglie, A aggiunge)", [riclassificaGara({ ...base, oggetto: MENSA, cpv_principale: "55524000", settori: ["ristorazione"], metodo_settore: "cpv" }, [], [admin("ristorazione", "C")]).dopo.settori, riclassificaGara({ ...base, oggetto: PIZZA, cpv_principale: "55524000", settori: [], metodo_settore: null }, [], [admin("ristorazione", "A")]).dopo.settori], [[], ["ristorazione"]]);
    const es = idEsecuzione(ISO);
    uguale("A. esecuzione: dall'istante (con i millisecondi) e ritorno", [es, isoDaEsecuzione(es), isoDaEsecuzione("rotto")], ["20261117T120000000Z", ISO, null]);
    const id = idFonteRiclassificazione(tolta, es);
    uguale("A. identificativo nel registro: versione, regole ed esecuzione", id, `regole-settori-${VERSIONE_REGOLE_SETTORI}:forniture_di_beni:${es}`);
    atteso("A. identificativo entro 200 caratteri anche con molte regole, l'esecuzione resta in fondo", (() => { const i = idFonteRiclassificazione({ esclusioni: Array.from({ length: 40 }, (_, k) => ({ settore: "pulizia" as const, regola: `regola_lunga_${k}`, motivo: "" })), aggiunti: ["x"], soloMetodo: false }, es); return i.length <= 200 && i.endsWith(`:${es}`); })());
    uguale("A. la frase per il cliente legge le regole anche con l'esecuzione in fondo", descriviCorrezioneSettori("17/11/2026", valoreRegistro(tolta.prima), valoreRegistro(tolta.dopo), id), "Il 17/11/2026 abbiamo tolto la gara da: ristorazione collettiva (Fornitura di beni senza un servizio del settore). Resta consultabile nell'archivio.");
    // frase della PVL per i settori aggiunti (09034f2), con l'identificativo che lo script scrive davvero («aggiunta», senza motivo)
    uguale("A. la frase per il cliente quando lo script AGGIUNGE un settore (identificativo vero dello script)", descriviCorrezioneSettori("18/11/2026", valoreRegistro(agg.prima), valoreRegistro(agg.dopo), idFonteRiclassificazione(agg, es)), "Il 18/11/2026 abbiamo aggiunto la gara a: ristorazione collettiva. Ora è in: ristorazione collettiva.");
    atteso("A. nota del registro: tolte e aggiunte, entro 1000 caratteri anche con molte esclusioni", notaCorrezione(tolta).includes("Tolta da: ristorazione collettiva") && notaCorrezione(agg).includes("Aggiunta a: ristorazione collettiva") && notaCorrezione({ ...tolta, esclusioni: Array.from({ length: 50 }, () => ({ settore: "ristorazione" as const, regola: "x", motivo: "m".repeat(80) })) }).length <= 1000);
    // nome e motivo della regola del settore non più riconosciuto: quelli di settori.ts (scelti con la PVL), anche nella frase per il cliente
    const nr = riclassificaGara({ ...base, oggetto: "Servizi integrati di gestione documentale (prova sintetica)", cpv_principale: "79999100", settori: ["multiservizi"], metodo_settore: "parole_chiave" }, []);
    uguale("A. «non_riconosciuto»: regola e motivo di settori.ts nella riga, nel registro e nella frase per il cliente", [nr.esclusioni[0]?.regola === REGOLA_NON_RICONOSCIUTO, nr.esclusioni[0]?.motivo === MOTIVO_NON_RICONOSCIUTO, descriviCorrezioneSettori("18/11/2026", valoreRegistro(nr.prima), valoreRegistro(nr.dopo), idFonteRiclassificazione(nr, es))], [true, true, `Il 18/11/2026 abbiamo tolto la gara da: multiservizi e gestione edifici (${MOTIVO_NON_RICONOSCIUTO}). Resta consultabile nell'archivio.`]);
    const stato = { settori: ["ristorazione", "pulizia"], metodo: "cpv" };
    uguale("A. registro: valore di prima leggibile per il ripristino; forma breve; illeggibile = nessun ripristino", [statoDaRegistro(valoreRegistro(stato)), statoDaRegistro('["pulizia"]'), statoDaRegistro("{rotto")], [stato, { settori: ["pulizia"], metodo: null }, null]);
  }

  // ═════ B. piano gara per gara ═════
  {
    const es = idEsecuzione(ISO);
    const g2 = comeArchivio(gara("G2", { oggetto: PIZZA }));
    const p = pianoGara({ gara: g2, lotti: [], attive: [], stato: null, esecuzione: es, adessoIso: ISO, nuovoId });
    uguale("B. gara esclusa: colonna vuota, una riga C, stato classificato con la versione", [p.tipo, p.cambiaSettori, p.calcolate.map((r) => `${r.settore}=${r.rilevanza}`), p.stato?.stato, p.stato?.versione_regole], ["da_scrivere", true, ["ristorazione=C"], "classificata", VERSIONE_REGOLE_SETTORI]);
    uguale("B. traccia nel registro: correzione_dati sul campo settori, fonte delle regole, MAI notificabile, con l'esecuzione", [p.registro?.tipo, p.registro?.campo, p.registro?.fonte, p.registro?.notificabile, String(p.registro?.id_fonte).endsWith(`:${es}`)], ["correzione_dati", "settori", "regole_settori", false, true]);
    atteso("B. righe con la colonna DOPO: nessuna riga «ambigua» per la colonna; autore con l'esecuzione; origine riclassificazione", p.calcolate.every((r) => !r.ambigua && r.autore === `riclassificazione:${es}` && r.origine === "riclassificazione"));
    const g1 = comeArchivio(gara("G1"));
    const stato = { procedura_id: "G1", stato: "classificata" as const, versione_regole: VERSIONE_REGOLE_SETTORI, classificata_il: "2026-11-02T00:00:00.000Z", tentativi: 1, tentativo_il: "2026-11-02T00:00:00.000Z", errore: null, aggiornata_il: "2026-11-02T00:00:00.000Z" };
    uguale("B. idempotenza: già classificata con queste regole e non cambiata dopo → nessun calcolo", pianoGara({ gara: g1, lotti: [], attive: [], stato, esecuzione: es, adessoIso: ISO, nuovoId }).tipo, "gia_classificata");
    uguale("B. regole diverse, o gara cambiata dopo la classificazione → si ricalcola", [giaClassificata({ ...stato, versione_regole: "2026-11-17e" }, g1.aggiornata_il), giaClassificata(stato, "2026-11-03T00:00:00.000Z"), giaClassificata({ ...stato, stato: "fallita" }, g1.aggiornata_il), giaClassificata({ ...stato, stato: "in_attesa" }, null)], [false, false, false, false]);
    uguale("B. categorie della gara: A, B, misti, C, nessun settore", [categoriaGara([{ rilevanza: "A" }]), categoriaGara([{ rilevanza: "B" }]), categoriaGara([{ rilevanza: "A" }, { rilevanza: "B" }]), categoriaGara([{ rilevanza: "C" }]), categoriaGara([])], ["A", "B", "misti", "C", "nessun_settore"]);
  }

  // ═════ C. script sul database in memoria ═════
  {
    const mem = databaseInMemoria(archivio(), { fonti: "0121" });
    const conta = () => ({ gare: mem.tabelle.radar_procedure.length, lotti: mem.tabelle.radar_lotti.length, prov: mem.tabelle.radar_procedure_fonti.length, salvate: JSON.stringify(mem.tabelle.omnia_ai_radar_salvate) });
    const prima = conta();
    const a = await leggiArchivio(mem.client, misure());
    const es1 = idEsecuzione(ISO);
    const piani = pianiDaArchivio(a, es1, ISO, nuovoId);
    const r = riepilogoPiani(piani);
    uguale("C. prova: nessuna scrittura (solo letture)", scritture(mem), 0);
    uguale("C. riepilogo: 7 gare, tutte da scrivere, colonna che cambia per 3 (G2 perde, G3 acquisisce, G7 solo metodo)", [r.gare, r.daScrivere, r.colonna.cambiate, r.colonna.perdono, r.colonna.acquisiscono, r.colonna.fuoriDaTutti, r.colonna.soloMetodo], [7, 7, 3, 1, 1, 1, 1]);
    uguale("C. righe esatte: una scrittura della colonna e una traccia per gara che cambia; uno stato per gara", [r.righe.radar_procedure.aggiorna, r.righe.radar_aggiornamenti.inserisce, r.righe.radar_classificazioni_stato.inserisce], [3, 3, 7]);
    const righeAttese = piani.reduce((s, p) => s + p.calcolate.length, 0);
    uguale("C. righe esatte delle classificazioni = righe calcolate (nessuna attiva prima)", r.righe.radar_classificazioni.inserisce, righeAttese);
    const date = () => JSON.stringify(mem.tabelle.radar_procedure.map((g) => [g.id, g.aggiornata_il, g.data_pubblicazione, g.prima_rilevazione_il, g.ultima_rilevazione_il]));
    const datePrima = date();
    const e = await applicaPiani(mem.client, piani, misure(), ISO);
    uguale("C. applicazione: date della gara INVARIATE (aggiornata_il, pubblicazione, rilevazioni): nessuna gara vecchia sembra nuova", date(), datePrima);
    uguale("C. applicazione: 3 colonne cambiate con la traccia, 7 gare classificate, nessuna fallita", [e.settoriCambiati, e.tracce, e.classificazioni.classificate, e.classificazioni.fallite, e.classificazioni.inserite], [3, 3, 7, 0, righeAttese]);
    uguale("C. G2 esclusa: colonna vuota (resta nell'archivio, con la riga C); G3 acquisisce la ristorazione; G7 metodo dai CPV", [garaDi(mem, "G2").settori, garaDi(mem, "G2").metodo_settore, attiveDi(mem, "G2"), garaDi(mem, "G3").settori, garaDi(mem, "G7").metodo_settore], [[], null, ["ristorazione=C"], ["ristorazione"], "cpv"]);
    uguale("C. colonna e righe COERENTI per ogni gara; nessuna riga attiva doppia", [incoerenti(mem), doppie(mem)], [[], 0]);
    uguale("C. gare, lotti, provenienze, gare salvate e monitorate intatti (nulla cancellato)", conta(), prima);
    atteso("C. registro: le tracce non sono mai notificabili", mem.tabelle.radar_aggiornamenti.filter((x) => x.campo === "settori").length === 3 && mem.tabelle.radar_aggiornamenti.filter((x) => x.campo === "settori").every((x) => x.notificabile === false));
    atteso("C. gara collegata (unita_a) classificata anch'essa, senza toccare il collegamento", statoDi(mem, "G6")?.stato === "classificata" && garaDi(mem, "G6").unita_a === "G1");

    // seconda esecuzione: nulla da scrivere
    const ISO2 = "2026-11-17T13:00:00.000Z";
    const s0 = scritture(mem);
    const piani2 = pianiDaArchivio(await leggiArchivio(mem.client, misure()), idEsecuzione(ISO2), ISO2, nuovoId);
    const e2 = await applicaPiani(mem.client, piani2, misure(), ISO2);
    uguale("C. SECONDA esecuzione: tutte già classificate, NESSUNA scrittura", [piani2.every((p) => p.tipo === "gia_classificata"), e2.gare, scritture(mem) - s0], [true, 0, 0]);

    // cambio delle regole (simulato: righe e stato con la versione precedente): nuove righe, storico conservato
    for (const x of mem.tabelle.radar_classificazioni) if (x.procedura_id === "G1") x.versione_regole = "2026-11-17e";
    const st1 = statoDi(mem, "G1") as RigaMem;
    st1.versione_regole = "2026-11-17e";
    const ISO3 = "2026-11-17T14:00:00.000Z";
    const es3 = idEsecuzione(ISO3);
    const vecchiaG1 = mem.tabelle.radar_classificazioni.find((x) => x.procedura_id === "G1" && x.attiva) as RigaMem;
    const piani3 = pianiDaArchivio(await leggiArchivio(mem.client, misure()), es3, ISO3, nuovoId);
    const e3 = await applicaPiani(mem.client, piani3, misure(), ISO3);
    const nuovaG1 = mem.tabelle.radar_classificazioni.find((x) => x.procedura_id === "G1" && x.attiva) as RigaMem;
    uguale("C. regole nuove: solo G1 si ricalcola; la riga vecchia si chiude (storico), la nuova la sostituisce", [piani3.filter((p) => p.tipo === "da_scrivere").map((p) => p.proceduraId), e3.classificazioni.disattivate, e3.classificazioni.inserite, vecchiaG1.attiva, vecchiaG1.sostituita_da === nuovaG1.id, nuovaG1.versione_regole], [["G1"], 1, 1, false, true, VERSIONE_REGOLE_SETTORI]);

    // modifica concorrente della colonna: la gara non si scrive
    const mem2 = databaseInMemoria(archivio(), { fonti: "0121" });
    const pianiC = pianiDaArchivio(await leggiArchivio(mem2.client, misure()), es1, ISO, nuovoId);
    garaDi(mem2, "G2").settori = ["ristorazione", "pulizia"];
    const eC = await applicaPiani(mem2.client, pianiC, misure(), ISO);
    uguale("C. colonna cambiata dopo la lettura: niente colonna, niente righe, niente stato per quella gara", [eC.cambiateNelFrattempo, garaDi(mem2, "G2").settori, attiveDi(mem2, "G2"), statoDi(mem2, "G2")], [1, ["ristorazione", "pulizia"], [], undefined]);

    // ripristino controllato dell'esecuzione delle regole nuove (G1): torna la riga di prima, come riga NUOVA
    try {
      await annullaEsecuzione(mem.client, es1, 3, misure(), "2026-11-17T15:00:00.000Z", nuovoId);
      atteso("C. ripristino oltre il massimo: si ferma", false);
    } catch (x) {
      atteso("C. ripristino oltre il massimo: si ferma SENZA scrivere", x instanceof TroppeGare);
    }
    const righePrima = mem.tabelle.radar_classificazioni.length;
    const ann3 = await annullaEsecuzione(mem.client, es3, 10, misure(), "2026-11-17T15:00:00.000Z", nuovoId);
    const g1Attive = mem.tabelle.radar_classificazioni.filter((x) => x.procedura_id === "G1" && x.attiva) as RigaMem[];
    uguale("C. annullamento delle regole nuove: riga chiusa, la precedente torna come copia (versione di prima), stato in attesa", [ann3.righeChiuse, ann3.righeRipristinate, g1Attive.length, g1Attive[0]?.versione_regole, g1Attive[0]?.id !== vecchiaG1.id, statoDi(mem, "G1")?.stato], [1, 1, 1, "2026-11-17e", true, "in_attesa"]);
    atteso("C. annullare non cancella nulla: le righe crescono soltanto (una copia in più), nessuna attiva doppia", mem.tabelle.radar_classificazioni.length === righePrima + 1 && doppie(mem) === 0);
    // ripristino dell'esecuzione di popolamento: colonna di prima, righe chiuse, stato in attesa
    const ann1 = await annullaEsecuzione(mem.client, es1, 10, misure(), "2026-11-17T16:00:00.000Z", nuovoId);
    uguale("C. annullamento: date della gara ancora INVARIATE", date(), datePrima);
    uguale("C. annullamento del popolamento: colonne di prima (G2 di nuovo in ristorazione, G3 di nuovo vuota, G7 metodo di prima)", [garaDi(mem, "G2").settori, garaDi(mem, "G2").metodo_settore, garaDi(mem, "G3").settori, garaDi(mem, "G7").metodo_settore, ann1.colonnaRipristinata], [["ristorazione"], "cpv", [], "parole_chiave", 3]);
    uguale("C. dopo l'annullamento nessuna riga attiva dell'esecuzione, stati «in attesa» (mai «non pertinente»)", [mem.tabelle.radar_classificazioni.filter((x) => x.attiva && x.autore === `riclassificazione:${es1}`).length, ["G2", "G3", "G5"].map((g) => statoDi(mem, g)?.stato)], [0, ["in_attesa", "in_attesa", "in_attesa"]]);
    atteso("C. traccia del ripristino nel registro, mai notificabile", mem.tabelle.radar_aggiornamenti.filter((x) => x.campo === "settori_ripristinati").length === 3 && mem.tabelle.radar_aggiornamenti.filter((x) => x.campo === "settori_ripristinati").every((x) => x.notificabile === false));
    const s2 = mem.scritture();
    await annullaEsecuzione(mem.client, es1, 10, misure(), "2026-11-17T17:00:00.000Z", nuovoId);
    await annullaEsecuzione(mem.client, es3, 10, misure(), "2026-11-17T17:00:00.000Z", nuovoId);
    const s3 = mem.scritture();
    uguale("C. ripetere l'annullamento non scrive nulla", Object.fromEntries(Object.keys(s3).filter((k) => s3[k] !== s2[k]).map((k) => [k, s3[k] - (s2[k] ?? 0)])), {});
    // dopo l'annullamento la riapplicazione rifà tutto (le gare sono «in attesa»)
    const ISO4 = "2026-11-17T18:00:00.000Z";
    const e4 = await applicaPiani(mem.client, pianiDaArchivio(await leggiArchivio(mem.client, misure()), idEsecuzione(ISO4), ISO4, nuovoId), misure(), ISO4);
    uguale("C. riapplicare dopo l'annullamento: di nuovo coerente, nessuna riga doppia", [e4.settoriCambiati, incoerenti(mem), doppie(mem), garaDi(mem, "G2").settori], [3, [], 0, []]);
  }

  // ═════ D. importatori ═════
  {
    uguale("D. interruttore: spento di base, spento in produzione e su un database sconosciuto, acceso solo sullo staging con RADAR_CLASSIFICAZIONI=attive", [
      classificazioniAttive({ NEXT_PUBLIC_SUPABASE_URL: "https://ryawdldqiumqsskrnyps.supabase.co" }),
      classificazioniAttive({ NEXT_PUBLIC_SUPABASE_URL: "https://bihfrzspqxsrzlbqqvqa.supabase.co", RADAR_CLASSIFICAZIONI: "attive" }),
      classificazioniAttive({ NEXT_PUBLIC_SUPABASE_URL: "https://altro.supabase.co", RADAR_CLASSIFICAZIONI: "attive" }),
      classificazioniAttive({ NEXT_PUBLIC_SUPABASE_URL: "https://ryawdldqiumqsskrnyps.supabase.co", RADAR_CLASSIFICAZIONI: "attive" }),
    ], [false, false, false, true]);
    for (const f of ["src/lib/radar/importa-ted.ts", "src/lib/radar/importa-pvl.ts", "src/lib/radar/importa-regionali.ts"]) atteso(`D. ${f}: l'interruttore viene dall'ambiente (classificazioniAttive)`, leggi(f).includes("classificazioniAttive(opzioni.env ?? process.env)") && /\bclassificazioni\b/.test(leggi(f)));
    atteso("D. PVL e regionali passano l'interruttore alla scrittura unica", leggi("src/lib/radar/importa-pvl-pagina.ts").includes("classificazioni: opzioni.classificazioni") && leggi("src/lib/radar/importa-regionali-pagina.ts").includes("classificazioni: o.classificazioni"));
    uguale("D. lotti dopo la scrittura: quelli scritti sostituiscono per numero, gli altri restano", lottiDopoScrittura([{ numero_lotto: "1", x: "a" }, { numero_lotto: "2", x: "b" }], [{ numero_lotto: "2", x: "c" }, { numero_lotto: "3", x: "d" }]).map((l) => `${l.numero_lotto}${l.x}`), ["1a", "2c", "3d"]);
    const mensa = { oggetto: MENSA, cpv_principale: "55524000", cpv_tutti: ["55524000"], natura_contratto: "servizi" };
    const pizza = { oggetto: PIZZA, cpv_principale: "55524000", cpv_tutti: ["55524000"], natura_contratto: "servizi" };
    const ci = classificaImportazione({ dati: pizza, lotti: [], fonte: "pvl", versioneFonte: { dati: pizza, lotti: [] }, prima: { dati: mensa, lotti: [], fonti: ["ted"] } });
    uguale("D. più fonti (D3): la rilevanza migliore tra dati uniti, fonte e gara di prima; colonna = settori A/B; provenienze conservate", [ci.settori, ci.perFonte?.map((p) => p.fonte)], [["ristorazione"], ["pvl", "ted"]]);
    const sola = classificaImportazione({ dati: pizza, lotti: [], fonte: "ted", versioneFonte: { dati: pizza, lotti: [] }, prima: { dati: mensa, lotti: [], fonti: ["ted"] } });
    uguale("D. una sola fonte: decidono i dati uniti (nessuna provenienza da confrontare)", [sola.settori, sola.perFonte], [[], undefined]);
    uguale("D. traccia del cambio di colonna all'importazione: mai notificabile; nessuna se non cambia", [rigaRegistroImportazione("G", { settori: ["ristorazione"], metodo: "cpv" }, sola, "ted", "700002-2026")?.notificabile, rigaRegistroImportazione("G", { settori: ["ristorazione"], metodo: "cpv" }, ci, "pvl", "av-2")], [false, null]);

    // TED: avvisi sintetici
    const avviso = (numero: string, proc: string, p: Record<string, unknown> = {}): Record<string, unknown> => ({
      "publication-number": numero,
      "notice-identifier": `sintetico-${numero}`,
      "notice-version": 1,
      "notice-type": "cn-standard",
      "publication-date": "2026-11-10+01:00",
      "procedure-identifier": proc,
      "buyer-name": { ita: ["COMUNE DI PROVASINTETICA"] },
      "organisation-identifier-buyer": ["00000000001"],
      "buyer-country-sub": ["ITG2B"],
      "title-proc": { ita: MENSA },
      "title-lot": { ita: ["Ristorazione (prova sintetica)"] },
      "identifier-lot": ["LOT-0001"],
      "main-classification-proc": ["55524000"],
      "main-classification-lot": ["55524000"],
      "classification-cpv": ["55524000"],
      "estimated-value-proc": "2000000.00",
      "estimated-value-cur-proc": "EUR",
      "estimated-value-lot": ["2000000.00"],
      "estimated-value-cur-lot": ["EUR"],
      "deadline-receipt-tender-date-lot": ["2026-12-20+01:00"],
      "deadline-receipt-tender-time-lot": ["10:00:00+01:00"],
      "procedure-type": "open",
      "contract-nature-main-proc": "services",
      ...p,
    });
    const vuoto = () => ({ radar_procedure: [] as RigaMem[], radar_lotti: [] as RigaMem[], radar_procedure_fonti: [] as RigaMem[], radar_aggiornamenti: [] as RigaMem[], radar_classificazioni: [] as RigaMem[], radar_classificazioni_stato: [] as RigaMem[], omnia_ai_radar_gare_aggiunte: [] as RigaMem[] });
    const b1 = leggiBandoTed(avviso("700801-2026", "proc-801"));
    atteso("D. (preparazione) avviso TED sintetico valido", !eEsclusione(b1));
    // spento: nessuna scrittura nelle tabelle della 0121
    const spento = databaseInMemoria(vuoto(), { fonti: "0121" });
    await applicaPaginaBandi(spento.client, [b1], "incrementale", ADESSO, misure());
    uguale("D. interruttore SPENTO: l'importazione TED non tocca le tabelle della 0121", [spento.tabelle.radar_procedure.length, spento.scritture().radar_classificazioni ?? 0, spento.scritture().radar_classificazioni_stato ?? 0], [1, 0, 0]);
    // acceso: gara nuova classificata, coerente
    const acceso = databaseInMemoria(vuoto(), { fonti: "0121" });
    const esitoT = await applicaPaginaBandi(acceso.client, [b1], "incrementale", ADESSO, misure(), { classificazioni: true, nuovoId });
    const gT = acceso.tabelle.radar_procedure[0];
    uguale("D. ACCESO, gara TED nuova: righe e stato «classificata» nello stesso giro; colonna coerente; autore dell'importazione", [esitoT.classificazioni?.classificate, attiveDi(acceso, gT.id as string), statoDi(acceso, gT.id as string)?.stato, incoerenti(acceso), acceso.tabelle.radar_classificazioni[0]?.origine, acceso.tabelle.radar_classificazioni[0]?.autore], [1, ["ristorazione=A"], "classificata", [], "importazione", "importazione:ted"]);
    // lo script dopo l'importazione non scrive nulla
    const sA = scritture(acceso);
    const ISOs = "2026-11-17T19:00:00.000Z";
    const pianiA = pianiDaArchivio(await leggiArchivio(acceso.client, misure()), idEsecuzione(ISOs), ISOs, nuovoId);
    await applicaPiani(acceso.client, pianiA, misure(), ISOs);
    uguale("D. lo script dopo un'importazione con l'interruttore acceso: già classificata, nessuna scrittura", [pianiA.map((p) => p.tipo), scritture(acceso) - sA], [["gia_classificata"], 0]);
    // rettifica TED che aggiunge la pulizia dei refettori: colonna, traccia, righe (una rettifica fuori dai settori TED la scarta già alla
    // lettura, come sempre: la conservazione delle gare non pertinenti resta spenta)
    const b2 = leggiBandoTed(avviso("700802-2026", "proc-801", { "publication-date": "2026-11-12+01:00", "notice-version": 2, "title-proc": { ita: "Servizio di ristorazione scolastica e di pulizia dei refettori (prova sintetica)" }, "classification-cpv": ["55524000", "90919300"] }));
    atteso("D. (preparazione) rettifica TED sintetica valida, con due settori", !eEsclusione(b2) && JSON.stringify([...(b2 as { settori: string[] }).settori].sort()) === JSON.stringify(["pulizia", "ristorazione"]), JSON.stringify(b2));
    const esitoR = await applicaPaginaBandi(acceso.client, [b2], "incrementale", new Date("2026-11-17T20:00:00.000Z"), misure(), { classificazioni: true, nuovoId });
    const tracce = acceso.tabelle.radar_aggiornamenti.filter((x) => x.campo === "settori");
    uguale("D. rettifica che aggiunge un settore: colonna con i due settori, traccia mai notificabile, riga nuova per la pulizia, la ristorazione resta", [[...(gT.settori as string[])].sort(), tracce.map((x) => [x.fonte, x.notificabile]), attiveDi(acceso, gT.id as string).map((x) => x.split("=")[0]), esitoR.classificazioni?.classificate], [["pulizia", "ristorazione"], [["ted", false]], ["pulizia", "ristorazione"], 1]);
    uguale("D. dopo la rettifica: coerente e nessuna riga doppia; la gara resta nell'archivio", [incoerenti(acceso), doppie(acceso), acceso.tabelle.radar_procedure.length], [[], 0, 1]);

    // SardegnaCAT che si unisce alla gara TED (scrittura unica): provenienze e fonti nella riga
    const elemento = (id: string, p: Record<string, string> = {}): Record<string, string> => ({
      link: `https://sardegnacat.regione.sardegna.it/portale/index.php/bandi?getdettaglio=yes&bando=${id}&scadenzaBando=2026-12-10T10:00:00`,
      Oggetto: RSA,
      Tipo: "Bando",
      DenominazioneEnte: "COMUNE DI PROVASINTETICA",
      Contratto: "Servizi",
      a_base_asta: "1.900.000,00",
      DtScadenzaBandoTecnical: "2026-12-10T10:00:00",
      CIG: "PRV0000901",
      TipoProcedura: "Aperta",
      statoFunzionale: "PresOfferte",
      IdMsg: id,
      TitoloDocumento: "Prova sintetica",
      dataUltimaModifica: "2026-11-05T10:00:00",
      CPV: "55524000-9 - Servizi di ristorazione scolastica",
      DtPubblicazioneTecnical: "2026-11-03T11:00:00",
      ...p,
    });
    const bandoS = bandoDaAflink(leggiElementoAflink("sardegnacat", elemento("900901"), ADESSO) as BandoAflink, OGGI) as BandoRegionale;
    const memS = databaseInMemoria({ ...vuoto(), radar_procedure: [gara("T", { aggiornata_il: "2026-11-01T08:00:00.000Z" })], radar_lotti: [lotto("T", "LOT-0001", { cig: "PRV0000901" })], radar_procedure_fonti: [prov("T", "ted", "700901-2026")] }, { fonti: "0121" });
    const stat = statisticheRegionaliVuote();
    await applicaPaginaBandiRegionali(memS.client, [bandoS], { fonte: "sardegnacat", modo: "incrementale", adesso: ADESSO, misure: misure(), stat, nascoste: new Set(), proponi: false, classificazioni: true, nuovoId });
    const rS = memS.tabelle.radar_classificazioni.find((x) => x.procedura_id === "T" && x.attiva && x.settore === "ristorazione") as RigaMem | undefined;
    uguale("D. SardegnaCAT unita per CIG alla gara TED: riga con le due fonti e le provenienze (SardegnaCAT B, TED A), segnata ambigua, rilevanza migliore A", [rS?.fonti, Object.keys((rS?.per_fonte as object) ?? {}).sort(), rS?.ambigua, rS?.rilevanza, garaDi(memS, "T").fonti], [["sardegnacat", "ted"], ["dati_uniti", "sardegnacat", "ted"], true, "A", ["ted", "sardegnacat"]]);
    uguale("D. SardegnaCAT: colonna coerente con le righe, stato classificato", [incoerenti(memS), statoDi(memS, "T")?.stato], [[], "classificata"]);
  }

  // ═════ E. testo dello script e delle librerie ═════
  {
    const script = leggi("scripts/radar-riclassifica-settori.ts");
    const lib = leggi("src/lib/radar/riclassificazione.ts");
    atteso("E. script: porta delle autorizzazioni con il suo nome", script.includes('controllaPorta({ script: "radar-riclassifica-settori.ts" })'));
    atteso("E. script: la porta viene prima di ogni accesso al database per applica e annulla", script.indexOf('if (modo !== "prova") await porta();') > 0 && script.indexOf('if (modo !== "prova") await porta();') < script.indexOf("const db = createClient"));
    atteso("E. script: solo staging, mai produzione", script.includes("PROGETTO_PRODUZIONE") && script.includes("RADAR_STAGING_REF"));
    atteso("E. script: la prova legge con il client in SOLA LETTURA", /const lettura = createClient\([^)]*fetch: fetchSoloLettura\(\)/.test(script));
    atteso("E. script e librerie: nessuna cancellazione né funzione del database", [script, lib, leggi("src/lib/radar/riclassifica-settori.ts"), leggi("src/lib/radar/classificazioni-importazione.ts"), leggi("src/lib/radar/classificazioni.ts")].every((t) => !/\.delete\(|\.rpc\(|truncate|drop /i.test(t)));
    atteso("E. libreria: scritture della colonna condizionate ai settori trovati (contiene E contenuto)", /contains\("settori"/.test(lib) && /containedBy\("settori"/.test(lib));
    atteso("E. script: tetto di gare, si ferma prima di scrivere", script.includes("più del massimo autorizzato") && script.includes("MASSIMO_ASSOLUTO = 2000"));
    atteso("E. registro mai notificabile (script, libreria, piano, importazioni)", [lib, leggi("src/lib/radar/riclassifica-settori.ts"), leggi("src/lib/radar/classificazioni-importazione.ts")].every((t) => t.includes("notificabile: false") && !t.includes("notificabile: true")));
    atteso("E. libreria: cambia SOLO settori e metodo della gara (mai «aggiornata_il»: pacchetto 16, punti 8 e 11)", (lib.match(/from\("radar_procedure"\)\.update\(\{[^}]*\}/g) ?? []).every((u) => /\.update\(\{ settori: [^,]+, metodo_settore: [^,}]+ \}$/.test(u)) && (lib.match(/from\("radar_procedure"\)\.update/g) ?? []).length === 3);
    atteso("E. importatori: un cambio dovuto solo alla classificazione non tocca «aggiornata_il»", ["src/lib/radar/importa.ts", "src/lib/radar/importa-fonti-pagina.ts"].every((f) => { const t = leggi(f); const i = t.indexOf("settori: ci.settori, metodo_settore: ci.metodo"); return i > 0 && !t.slice(i, i + 160).includes("aggiornata_il"); }));
    const finto = (metodo: string) => fetchSoloLettura(((() => Promise.resolve(new Response("[]"))) as unknown) as typeof fetch)("https://esempio.test/rest/v1/radar_procedure", { method: metodo });
    const esiti = await Promise.all(["GET", "HEAD", "POST", "PATCH", "DELETE"].map((m) => finto(m).then(() => "ok", () => "rifiutata")));
    uguale("E. client della prova: GET e HEAD sì; POST, PATCH, DELETE rifiutate prima di partire", esiti, ["ok", "ok", "rifiutata", "rifiutata", "rifiutata"]);
    const cartella = fs.mkdtempSync(path.join(os.tmpdir(), "ti-popolamento-"));
    const file = path.join(cartella, "archivio.json");
    fs.writeFileSync(file, JSON.stringify({ gare: [gara("F1", { oggetto: PIZZA })], lotti: [lotto("F1", "LOT-0002"), lotto("F1", "LOT-0001", { oggetto: "Lotto 1 (prova sintetica)" })], classificazioni: [], stati: [] }));
    const daFile = archivioDaFile(file);
    fs.rmSync(cartella, { recursive: true, force: true });
    uguale("E. prova da un'esportazione: stesso archivio (lotti in ordine di numero), tabelle della 0121 presenti", [daFile.gare.length, daFile.lotti.get("F1")?.map((l) => l.oggetto), daFile.tabelle0121], [1, ["Lotto 1 (prova sintetica)", null], true]);
    const scheda = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/opportunita/gara/[id]/page.tsx");
    atteso("E. scheda della gara: la correzione dei settori ha la sua frase (non «Rettifica»)", scheda.includes("descriviCorrezioneSettori(quando, a.valore_precedente, a.valore_nuovo, a.id_fonte)"));
  }

  // ═════ F. Radar: pertinenti (A) e correlate (B) distinte; gare unite senza doppioni (pacchetto 16, punti 7 e 9) ═════
  {
    const d = analizzaDomanda("");
    const base = { oggetto_breve: null, sa_denominazione: null, metodo_settore: "cpv", scadenza_giorno: "2026-12-20", scadenza_offerte: null, valore_stimato: null, rettificata: false };
    const gA = { ...base, id: "A1", oggetto: "Servizio di pulizia degli uffici", settori: ["pulizia"], data_pubblicazione: "2026-11-01", rilevanza: { stato: "classificata" as const, perSettore: { pulizia: "A" as const } } };
    const gB = { ...base, id: "B1", oggetto: "Gestione integrata della struttura con pulizia", settori: ["pulizia"], data_pubblicazione: "2026-11-15", rilevanza: { stato: "classificata" as const, perSettore: { pulizia: "B" as const } } };
    const gN = { ...base, id: "N1", oggetto: "Servizio di pulizia", settori: ["pulizia"], data_pubblicazione: "2026-11-10" };
    const adesso = new Date("2026-11-18T09:00:00Z");
    const p = (g: typeof gA | typeof gB | typeof gN, settori: string[] = []) => punteggioRilevanza(g, d, { settori: settori as never[] }, adesso);
    uguale("F. punteggio: pertinente (A) +10, correlata (B) +3 con il suo motivo; senza classificazione come prima (metodo)", [p(gA).motivi[0], p(gB).motivi[0], p(gN).motivi[0], p(gA).punti - p({ ...gB, data_pubblicazione: gA.data_pubblicazione }).punti], ["pertinente al settore", "correlata al settore (appalto misto o servizio accessorio)", "settore riconosciuto dal CPV", 7]);
    const conPunti = [gB, gA, gN].map((g) => ({ ...g, punteggio: p(g) }));
    conPunti[0].punteggio = { punti: 99, motivi: ["testo molto vicino"] };
    uguale("F. ordinamento per rilevanza: la correlata (B) viene DOPO le pertinenti e le non classificate, anche con più punti", ordinaCandidati(conPunti, "rilevanza").map((x) => x.id), ["N1", "A1", "B1"]);
    uguale("F. ordinamento per data: l'ordine cronologico (data di pubblicazione) NON cambia con la classificazione", ordinaCandidati(conPunti, "recenti").map((x) => x.id), ["B1", "N1", "A1"]);
    const gAB = { ...gA, id: "AB", rilevanza: { stato: "classificata" as const, perSettore: { pulizia: "A" as const, vigilanza_portierato: "B" as const } } };
    const gC = { ...gA, id: "C1", settori: [], rilevanza: { stato: "classificata" as const, perSettore: { ristorazione: "C" as const } } };
    uguale("F. etichette: A nessuna; B «Correlata…»; C «Fuori dai settori monitorati»; fallita «da verificare»; in attesa e non classificata nessuna", [
      etichettaRicerca(gA, { settori: [] }),
      etichettaRicerca(gB, { settori: [] }),
      etichettaRicerca(gC, { settori: [] }),
      etichettaRicerca({ ...gA, rilevanza: { stato: "fallita", perSettore: {} } }, { settori: [] }),
      etichettaRicerca({ ...gA, rilevanza: { stato: "in_attesa", perSettore: {} } }, { settori: [] }),
      etichettaRicerca(gN, { settori: [] }),
    ], [null, "Correlata: appalto misto o servizio accessorio", "Fuori dai settori monitorati", "Classificazione da verificare", null, null]);
    uguale("F. con il filtro di un settore conta quel settore: A in pulizia ma B in vigilanza → «Correlata» se si cerca la vigilanza", [etichettaRicerca(gAB, { settori: ["pulizia"] }), etichettaRicerca(gAB, { settori: ["vigilanza_portierato"] })], [null, "Correlata: appalto misto o servizio accessorio"]);
    const ric = leggi("src/lib/radar/ricerca.ts");
    atteso("F. la ricerca legge le classificazioni SOLO con l'interruttore acceso, e mai le copie collegate (.is(\"unita_a\", null))", /opzioni\.classificazioni \? await leggiRilevanze\(/.test(ric) && ric.includes('.is("unita_a", null)'));
    atteso("F. la pagina Cerca passa l'interruttore dall'ambiente e mostra l'etichetta", leggi("src/app/site-omnia-ai/dashboard/omnia-ai/opportunita/cerca/page.tsx").includes("classificazioni: classificazioniAttive(process.env)") && leggi("src/app/site-omnia-ai/dashboard/omnia-ai/opportunita/cerca/page.tsx").includes("rilevanza: etichettaRicerca(r, filtri)") && leggi("src/components/omnia-ai/opportunita/riga-gara.tsx").includes("{d.rilevanza && "));
    // gare unite: la copia collegata C e la gara che resta T, entrambe classificate A
    const righe = [{ procedura_id: "T", settore: "pulizia" as const, rilevanza: "A" as const, attiva: true }, { procedura_id: "C", settore: "pulizia" as const, rilevanza: "A" as const, attiva: true }, { procedura_id: "B", settore: "pulizia" as const, rilevanza: "B" as const, attiva: true }];
    const stati = new Map([["T", { stato: "classificata" as const }], ["C", { stato: "classificata" as const }], ["B", { stato: "classificata" as const }]]);
    uguale("F. suggerimenti: solo A, e la gara unita UNA volta (la canonica); la copia collegata classificata non si suggerisce", gareSuggeribili(righe, stati, ["pulizia"], new Set(["C"])), ["T"]);
    const memR = databaseInMemoria({ radar_classificazioni: [{ id: "r1", procedura_id: "T", settore: "pulizia", rilevanza: "A", attiva: true }, { id: "r2", procedura_id: "T", settore: "vigilanza_portierato", rilevanza: "B", attiva: true }, { id: "r3", procedura_id: "T", settore: "ristorazione", rilevanza: "A", attiva: false }], radar_classificazioni_stato: [{ procedura_id: "T", stato: "classificata" }, { procedura_id: "W", stato: "in_attesa" }] });
    const lette = await leggiRilevanze(memR.client, ["T", "W", "N"]);
    uguale("F. lettura per la ricerca: solo righe ATTIVE, lo stato di ogni gara, nessuna voce per le gare mai classificate", [lette.get("T"), lette.get("W"), lette.has("N")], [{ stato: "classificata", perSettore: { pulizia: "A", vigilanza_portierato: "B" } }, { stato: "in_attesa", perSettore: {} }, false]);
    atteso("F. nessun doppione altrove (prove esistenti): Monitorate una riga per gara mostrata, la scheda di una copia porta alla canonica, la ricerca per CIG porta alla canonica", leggi("src/app/site-omnia-ai/dashboard/omnia-ai/opportunita/monitorate/page.tsx").includes("unoPerGaraMostrata(salvate,") && leggi("src/app/site-omnia-ai/dashboard/omnia-ai/opportunita/gara/[id]/page.tsx").includes("if (g.unita_a) redirect(") && ric.includes("idDaCig.map((id) => collegate?.find((c) => c.id === id)?.unita_a ?? id)"));
    atteso("F. notifiche: mai su una gara collegata a un'altra (importatori), mai dalle tracce della classificazione (notificabile: false)", leggi("src/lib/radar/importa.ts").includes("!prima?.unita_a") && leggi("src/lib/radar/importa-fonti-pagina.ts").includes("!s.iniziale?.unita_a") && !leggi("src/lib/radar/classificazioni-importazione.ts").includes("notificabile: true"));
  }

  // ═════ G. una gara C non si confonde con «in attesa» né con «fallita» (pacchetto 16, punto 11) ═════
  {
    const c = situazioneGara({ stato: "classificata", versione_regole: VERSIONE_REGOLE_SETTORI, errore: null }, [{ settore: "ristorazione", rilevanza: "C", attiva: true }]);
    const attesa = situazioneGara({ stato: "in_attesa", versione_regole: null, errore: null }, [{ settore: "ristorazione", rilevanza: "C", attiva: true }]);
    const fallita = situazioneGara({ stato: "fallita", versione_regole: null, errore: "Righe non valide" }, []);
    const senza = situazioneGara(null, []);
    uguale("G. codice: C = classificata con righe C (fuori dai settori); in attesa e fallita sono altri stati anche se ci sono righe C; senza stato = mai classificata", [c.tipo, c.tipo === "classificata" && c.fuoriDaiSettori, attesa.tipo, fallita.tipo, senza.tipo], ["classificata", true, "in_attesa", "fallita", "non_classificata"]);
    uguale("G. etichette diverse: C «Fuori dai settori monitorati», fallita «Classificazione da verificare», in attesa e mai classificata nessuna", [etichettaRilevanza(c), etichettaRilevanza(fallita), etichettaRilevanza(attesa), etichettaRilevanza(senza)], ["Fuori dai settori monitorati", "Classificazione da verificare", null, null]);
    const sql = leggi("supabase/migrations/0121_radar_classificazioni.sql");
    atteso("G. database (0121): stato solo «in_attesa», «classificata», «fallita»; fallita SE E SOLO SE c'è l'errore; classificata con versione e data; rilevanza solo A, B, C", sql.includes("stato text not null check (stato in ('in_attesa', 'classificata', 'fallita'))") && sql.includes("constraint radar_classificazioni_stato_errore check ((stato = 'fallita') = (errore is not null))") && sql.includes("constraint radar_classificazioni_stato_classificata check (stato <> 'classificata' or (versione_regole is not null and classificata_il is not null))") && sql.includes("rilevanza text not null check (rilevanza in ('A', 'B', 'C'))"));
    // dopo lo script: la gara esclusa è classificata con righe C; dopo l'annullamento è «in attesa» (e non più C)
    const memG = databaseInMemoria(archivio(), { fonti: "0121" });
    const isoG = "2026-11-18T08:00:00.000Z";
    const esG = idEsecuzione(isoG);
    await applicaPiani(memG.client, pianiDaArchivio(await leggiArchivio(memG.client, misure()), esG, isoG, nuovoId), misure(), isoG);
    const situazioneDi = (id: string) => situazioneGara((statoDi(memG, id) as never) ?? null, memG.tabelle.radar_classificazioni.filter((r) => r.procedura_id === id) as never);
    const dopo = situazioneDi("G2");
    await annullaEsecuzione(memG.client, esG, 10, misure(), "2026-11-18T09:00:00.000Z", nuovoId);
    const annullata = situazioneDi("G2");
    uguale("G. archivio: dopo lo script la gara esclusa è «classificata» e fuori dai settori; dopo l'annullamento è «in attesa», non C", [dopo.tipo, dopo.tipo === "classificata" && dopo.fuoriDaiSettori, annullata.tipo], ["classificata", true, "in_attesa"]);
  }

  // ═════ H. recupero sicuro: interruzione dopo OGNI scrittura, ripresa dal diario (pacchetto 16, punto 11) ═════
  {
    type MemH = ReturnType<typeof databaseInMemoria>;
    const ordina = (v: RigaMem[], campi: string[]) => v.map((r) => JSON.stringify(campi.map((c) => (Array.isArray(r[c]) ? [...(r[c] as string[])].sort() : (r[c] ?? null))))).sort();
    const foto = (m: MemH, conTentativi = true) =>
      JSON.stringify({
        gare: ordina(m.tabelle.radar_procedure, ["id", "settori", "metodo_settore", "aggiornata_il", "fonti", "unita_a"]),
        registro: ordina(m.tabelle.radar_aggiornamenti, ["procedura_id", "tipo", "campo", "valore_precedente", "valore_nuovo", "fonte", "id_fonte", "nota", "notificabile"]),
        righe: ordina(m.tabelle.radar_classificazioni, ["id", "procedura_id", "settore", "rilevanza", "sottocategorie", "regole", "motivi", "versione_regole", "origine", "autore", "attiva", "valida_dal", "sostituita_il", "sostituita_da", "per_fonte", "ambigua"]),
        stati: ordina(m.tabelle.radar_classificazioni_stato, ["procedura_id", "stato", "versione_regole", "classificata_il", ...(conTentativi ? ["tentativi"] : []), "tentativo_il", "errore"]),
      });
    // nessun registro «in anticipo»: ogni traccia di questa esecuzione corrisponde alla colonna che c'è davvero
    const inAnticipo = (m: MemH, es: string) =>
      m.tabelle.radar_aggiornamenti
        .filter((a) => a.campo === "settori" && String(a.id_fonte).endsWith(`:${es}`))
        .filter((a) => {
          const g = garaDi(m, a.procedura_id as string);
          const v = statoDaRegistro(a.valore_nuovo as string);
          return !g || !v || [...(g.settori as string[])].sort().join() !== [...v.settori].sort().join();
        }).length;
    const prova = async (nome: string, prepara: (m: MemH) => Promise<void>) => {
      const iso = "2026-11-18T10:00:00.000Z";
      const es = idEsecuzione(iso);
      const m0 = databaseInMemoria(archivio(), { fonti: "0121" });
      await prepara(m0);
      // il DIARIO: il piano calcolato una volta, prima di ogni scrittura (righe con i loro id, istante dell'esecuzione)
      const diario = diarioDaPiani(pianiDaArchivio(await leggiArchivio(m0.client, misure()), es, iso, nuovoId), es, iso, VERSIONE_REGOLE_SETTORI);
      const rif = databaseInMemoria(archivio(), { fonti: "0121" });
      await prepara(rif);
      const w0 = rif.richiesteScrittura();
      await applicaPiani(rif.client, diario.piani, misure(), iso);
      const W = rif.richiesteScrittura() - w0;
      const fotoRif = foto(rif);
      const s0 = rif.richiesteScrittura();
      await applicaPiani(rif.client, diario.piani, misure(), iso);
      const rilancio = rif.richiesteScrittura() - s0;
      const diversi: string[] = [];
      let anticipo = 0;
      let interrotte = 0;
      for (const modo of ["prima", "dopo"] as const) {
        for (let k = 1; k <= W; k++) {
          const m = databaseInMemoria(archivio(), { fonti: "0121" });
          await prepara(m);
          m.guasto(k, modo);
          try {
            await applicaPiani(m.client, diario.piani, misure(), iso);
          } catch {
            interrotte++;
          }
          m.guasto(null);
          anticipo += inAnticipo(m, es);
          await applicaPiani(m.client, diario.piani, misure(), iso);
          if (foto(m) !== fotoRif || doppie(m) > 0) diversi.push(`${modo}@${k}`);
        }
      }
      uguale(`H. ${nome}: processo fermato a OGNI scrittura (${W} scritture, prima e dopo di essere applicata: ${interrotte} interruzioni); la ripresa dal diario arriva allo STESSO stato finale, senza doppioni`, [diversi, interrotte], [[], 2 * W]);
      uguale(`H. ${nome}: dopo un'interruzione nessuna traccia nel registro «in anticipo» (la traccia segue sempre la colonna)`, anticipo, 0);
      // errore restituito da una sola richiesta (il processo continua): la gara resta com'era o va in «fallita» (mai «classificata» a metà);
      // la ripresa la completa. Stesso stato finale; solo il contatore dei tentativi è più alto (è giusto: c'è stato un tentativo in più)
      const diversiErrore: string[] = [];
      let mezze = 0;
      for (let k = 1; k <= W; k++) {
        const m = databaseInMemoria(archivio(), { fonti: "0121" });
        await prepara(m);
        m.guasto(k, "errore");
        try {
          await applicaPiani(m.client, diario.piani, misure(), iso);
        } catch {
          // un errore nello stato ferma l'esecuzione: va bene, la ripresa la completa
        }
        m.guasto(null);
        anticipo += inAnticipo(m, es);
        // nessuna gara «classificata» con questa esecuzione senza tutte le sue righe calcolate attive
        for (const p of diario.piani) {
          const st = statoDi(m, p.proceduraId);
          if (st?.stato === "classificata" && st.classificata_il === iso && !p.calcolate.every((r) => m.tabelle.radar_classificazioni.some((x) => x.attiva && x.procedura_id === r.procedura_id && x.settore === r.settore && x.rilevanza === r.rilevanza))) mezze++;
        }
        await applicaPiani(m.client, diario.piani, misure(), iso);
        if (foto(m, false) !== foto(rif, false) || doppie(m) > 0) diversiErrore.push(`errore@${k}`);
      }
      uguale(`H. ${nome}: errore restituito a OGNI scrittura: mai una gara «classificata» a metà, nessuna traccia in anticipo, la ripresa arriva allo stesso stato (tentativi a parte)`, [diversiErrore, mezze, anticipo], [[], 0, 0]);
      uguale(`H. ${nome}: rilanciare a esecuzione completa non scrive nulla`, rilancio, 0);
    };
    await prova("primo popolamento", async () => {});
    await prova("regole cambiate (righe da chiudere e da sostituire)", async (m) => {
      const isoP = "2026-11-18T09:00:00.000Z";
      await applicaPiani(m.client, pianiDaArchivio(await leggiArchivio(m.client, misure()), idEsecuzione(isoP), isoP, (() => { let i = 0; return () => `p-${++i}`; })()), misure(), isoP);
      for (const x of m.tabelle.radar_classificazioni) if (x.procedura_id === "G1" || x.procedura_id === "G4") x.versione_regole = "2026-11-17e";
      for (const x of m.tabelle.radar_classificazioni_stato) if (x.procedura_id === "G1" || x.procedura_id === "G4") x.versione_regole = "2026-11-17e";
      garaDi(m, "G3").settori = [];
      for (const x of m.tabelle.radar_classificazioni_stato) if (x.procedura_id === "G3") x.stato = "in_attesa";
    });
    // l'ANNULLAMENTO interrotto a ogni scrittura e ripetuto: stesso stato di un annullamento senza interruzioni (id delle copie a parte),
    // nessuna copia doppia, nessun riferimento a righe che non esistono
    const isoA = "2026-11-18T09:00:00.000Z";
    const isoB = "2026-11-18T10:00:00.000Z";
    const prepara = async (m: MemH) => {
      let i = 0;
      const id = () => `q-${++i}`;
      await applicaPiani(m.client, pianiDaArchivio(await leggiArchivio(m.client, misure()), idEsecuzione(isoA), isoA, id), misure(), isoA);
      for (const x of [...m.tabelle.radar_classificazioni, ...m.tabelle.radar_classificazioni_stato]) if (x.procedura_id === "G1" || x.procedura_id === "G4") x.versione_regole = "2026-11-17e";
      await applicaPiani(m.client, pianiDaArchivio(await leggiArchivio(m.client, misure()), idEsecuzione(isoB), isoB, id), misure(), isoB);
    };
    const fotoA = (m: MemH) =>
      JSON.stringify({
        gare: ordina(m.tabelle.radar_procedure, ["id", "settori", "metodo_settore", "aggiornata_il"]),
        registro: ordina(m.tabelle.radar_aggiornamenti, ["procedura_id", "tipo", "campo", "valore_precedente", "valore_nuovo", "id_fonte", "notificabile"]),
        righe: ordina(m.tabelle.radar_classificazioni, ["procedura_id", "settore", "rilevanza", "versione_regole", "autore", "nota", "attiva", "valida_dal", "sostituita_il"]),
        stati: ordina(m.tabelle.radar_classificazioni_stato, ["procedura_id", "stato", "versione_regole", "classificata_il", "tentativi"]),
      });
    const appese = (m: MemH) => m.tabelle.radar_classificazioni.filter((r) => r.sostituita_da && !m.tabelle.radar_classificazioni.some((x) => x.id === r.sostituita_da)).length;
    for (const [nome, esecuzioni] of [["regole cambiate", [idEsecuzione(isoB)]], ["regole cambiate e poi popolamento", [idEsecuzione(isoB), idEsecuzione(isoA)]]] as const) {
      const annullaTutto = async (m: MemH) => {
        for (const e of esecuzioni) await annullaEsecuzione(m.client, e, 50, misure(), "2026-11-18T11:00:00.000Z", (() => { let i = 0; return () => `a-${e}-${++i}-${Math.random()}`; })());
      };
      const rif = databaseInMemoria(archivio(), { fonti: "0121" });
      await prepara(rif);
      const w0 = rif.richiesteScrittura();
      await annullaTutto(rif);
      const W = rif.richiesteScrittura() - w0;
      const diversi: string[] = [];
      for (const modo of ["prima", "dopo"] as const) {
        for (let k = 1; k <= W; k++) {
          const m = databaseInMemoria(archivio(), { fonti: "0121" });
          await prepara(m);
          m.guasto(k, modo);
          try {
            await annullaTutto(m);
          } catch {
            // processo fermo
          }
          m.guasto(null);
          await annullaTutto(m);
          if (fotoA(m) !== fotoA(rif) || doppie(m) > 0 || appese(m) > 0) {
            const a = JSON.parse(fotoA(m)) as Record<string, string[]>;
            const b = JSON.parse(fotoA(rif)) as Record<string, string[]>;
            const dove = Object.keys(a).filter((x) => JSON.stringify(a[x]) !== JSON.stringify(b[x])).map((x) => `${x}: +${a[x].filter((y) => !b[x].includes(y)).join(" ")} -${b[x].filter((y) => !a[x].includes(y)).join(" ")}`);
            diversi.push(`${modo}@${k}${process.env.DETTAGLI_H ? ` ${dove.join(" | ")} doppie ${doppie(m)} appese ${appese(m)}` : ""}`);
          }
        }
      }
      uguale(`H. annullamento (${nome}) fermato a OGNI scrittura (${W}) e ripetuto: stesso stato, nessuna copia doppia, nessun riferimento appeso`, diversi, []);
    }

    // pacchetto 16, punto 5: ERRORE RESTITUITO (rete giù: supabase-js torna con un errore, il processo continua) a ogni SCRITTURA e a ogni
    // LETTURA di due annullamenti in catena. Ogni guasto va SEGNALATO (eccezione o «errori» > 0); rilanciare lo stesso comando arriva allo
    // stato giusto; nessuna copia riportata due volte; nessuna gara «classificata» senza righe attive
    {
      const catena = [idEsecuzione(isoB), idEsecuzione(isoA)];
      const comando = async (m: MemH, e: string) => {
        try {
          return (await annullaEsecuzione(m.client, e, 50, misure(), "2026-11-18T11:00:00.000Z", () => `c-${Math.random()}`)).errori > 0;
        } catch {
          return true;
        }
      };
      const copieDoppie = (m: MemH) => {
        const k = m.tabelle.radar_classificazioni.filter((r) => String(r.nota ?? "").includes("(annullata l'esecuzione")).map((r) => `${r.procedura_id}|${r.settore}|${String(r.nota)}`);
        return k.length - new Set(k).size;
      };
      const classificateSenzaRighe = (m: MemH) => m.tabelle.radar_classificazioni_stato.filter((s) => s.stato === "classificata" && !m.tabelle.radar_classificazioni.some((r) => r.attiva && r.procedura_id === s.procedura_id)).length;
      const rif = databaseInMemoria(archivio(), { fonti: "0121" });
      await prepara(rif);
      const w0 = rif.richiesteScrittura();
      const r0 = rif.richiesteLettura();
      for (const e of catena) await comando(rif, e);
      const W = rif.richiesteScrittura() - w0;
      const R = rif.richiesteLettura() - r0;
      const fotoRif = fotoA(rif);
      const casi: { tipo: "scrittura" | "lettura"; k: number }[] = [...Array.from({ length: W }, (_, i) => ({ tipo: "scrittura" as const, k: i + 1 })), ...Array.from({ length: R }, (_, i) => ({ tipo: "lettura" as const, k: i + 1 }))];
      const nonSegnalati: string[] = [];
      const diversi: string[] = [];
      let rilanci = 0;
      for (const c of casi) {
        const m = databaseInMemoria(archivio(), { fonti: "0121" });
        await prepara(m);
        if (c.tipo === "scrittura") m.guasto(c.k, "errore");
        else m.guastoLettura(c.k);
        let segnalato = false;
        for (const e of catena) {
          // lo stesso comando si rilancia finché non è completo (al massimo 3 volte)
          for (let tentativo = 0; tentativo < 3; tentativo++) {
            const incompleto = await comando(m, e);
            if (!incompleto) break;
            segnalato = true;
            rilanci++;
            m.guasto(null);
            m.guastoLettura(null);
          }
        }
        if (!segnalato) nonSegnalati.push(`${c.tipo}@${c.k}`);
        if (fotoA(m) !== fotoRif || doppie(m) > 0 || appese(m) > 0 || copieDoppie(m) > 0 || classificateSenzaRighe(m) > 0) diversi.push(`${c.tipo}@${c.k}`);
      }
      uguale(`H. annullamento, ERRORE RESTITUITO a ogni scrittura (${W}) e a ogni lettura (${R}) di due annullamenti in catena: ogni guasto è SEGNALATO (eccezione o errori > 0)`, nonSegnalati, []);
      uguale(`H. annullamento con errore restituito: rilanciando lo stesso comando (${rilanci} rilanci) si arriva allo stato giusto; nessuna copia riportata due volte; nessuna gara «classificata» senza righe attive`, diversi, []);
      uguale("H. riferimento: due annullamenti in catena senza guasti, nessuna copia doppia e nessuna gara «classificata» senza righe", [copieDoppie(rif), classificateSenzaRighe(rif)], [0, 0]);
    }
    // pacchetto 16, punto 5: ERRORE RESTITUITO a ogni LETTURA del popolamento, nella RIPRESA (colonna già scritta, traccia mancante) e nel
    // PRIMO popolamento (gara cambiata nel frattempo, così la lettura della colonna avviene davvero). Sempre un ERRORE che ferma l'esecuzione,
    // mai «cambiata nel frattempo»; rilanciando lo stesso comando con lo stesso diario si arriva allo stato giusto, con la traccia, senza doppioni
    {
      const iso = "2026-11-18T12:00:00.000Z";
      const es = idEsecuzione(iso);
      const m0 = databaseInMemoria(archivio(), { fonti: "0121" });
      const diario = diarioDaPiani(pianiDaArchivio(await leggiArchivio(m0.client, misure()), es, iso, (() => { let i = 0; return () => `d-${++i}`; })()), es, iso, VERSIONE_REGOLE_SETTORI);
      const ripresa = async (m: MemH) => {
        // il processo si ferma subito DOPO la prima scrittura della colonna: colonna nuova, traccia mancante
        m.guasto(1, "dopo");
        try {
          await applicaPiani(m.client, diario.piani, misure(), iso);
        } catch {
          // processo fermo
        }
        m.guasto(null);
      };
      const cambiata = async (m: MemH) => {
        garaDi(m, "G2").settori = ["ristorazione", "pulizia"];
      };
      for (const [nome, prepara] of [["ripresa", ripresa], ["primo popolamento con una gara cambiata nel frattempo", cambiata]] as const) {
        const rif = databaseInMemoria(archivio(), { fonti: "0121" });
        await prepara(rif);
        const r0 = rif.richiesteLettura();
        const esitoRif = await applicaPiani(rif.client, diario.piani, misure(), iso);
        const R = rif.richiesteLettura() - r0;
        const fotoRif = foto(rif);
        const nonSegnalati: string[] = [];
        const diversi: string[] = [];
        let etichetteSbagliate = 0;
        let colonnaColpita = 0;
        for (let n = 1; n <= R; n++) {
          const m = databaseInMemoria(archivio(), { fonti: "0121" });
          await prepara(m);
          m.guastoLettura(n);
          let segnalato = false;
          try {
            const e = await applicaPiani(m.client, diario.piani, misure(), iso);
            segnalato = e.errori > 0 || e.classificazioni.fallite > 0;
            if (e.cambiateNelFrattempo > esitoRif.cambiateNelFrattempo) etichetteSbagliate++;
          } catch (x) {
            segnalato = true;
            if (String(x).includes("colonna della gara")) colonnaColpita++;
          }
          m.guastoLettura(null);
          if (!segnalato) nonSegnalati.push(`lettura@${n}`);
          // lo stesso comando con lo stesso diario, finché non è completo
          for (let t = 0; t < 3; t++) {
            try {
              const e = await applicaPiani(m.client, diario.piani, misure(), iso);
              if (e.errori === 0 && e.classificazioni.fallite === 0) break;
            } catch {
              // si rilancia
            }
          }
          if (foto(m) !== fotoRif || doppie(m) > 0 || inAnticipo(m, es) > 0) diversi.push(`lettura@${n}`);
        }
        uguale(`H. popolamento (${nome}), ERRORE RESTITUITO a ogni lettura (${R}): sempre segnalato come errore, mai come «cambiata nel frattempo»; la lettura della colonna è tra quelle colpite`, [nonSegnalati, etichetteSbagliate, colonnaColpita > 0], [[], 0, true]);
        uguale(`H. popolamento (${nome}) con errore in lettura: rilanciando lo stesso comando con lo stesso diario, stato giusto con la traccia, senza doppioni né tracce in anticipo`, diversi, []);
      }
      const sc = leggi("scripts/radar-riclassifica-settori.ts");
      atteso("H. script: un popolamento con un'eccezione, con errori o con gare in «fallita» esce con codice 1 e «POPOLAMENTO INCOMPLETO: rilanciare lo stesso comando con lo stesso diario»", sc.includes('const INCOMPLETO = "POPOLAMENTO INCOMPLETO: rilanciare lo stesso comando con lo stesso diario"') && /if \(esitoApplica\.errori > 0 \|\| esitoApplica\.classificazioni\.fallite > 0\) \{\s*console\.error\(`\$\{INCOMPLETO\}[^`]*`\);\s*process\.exit\(1\);/.test(sc) && /const esitoApplica = await applicaPiani[\s\S]*\} catch \(e\) \{\s*console\.error\(`\$\{INCOMPLETO\} \(\$\{e instanceof Error \? e\.message : String\(e\)\}\)\.`\);\s*process\.exit\(1\);/.test(sc));
    }
    const scriptAnnulla = leggi("scripts/radar-riclassifica-settori.ts");
    atteso("H. script: un annullamento con errori o interrotto da un'eccezione esce con un codice di errore e «ANNULLAMENTO INCOMPLETO: rilanciare lo stesso comando»", /if \(esitoAnnulla\.errori > 0\) \{\s*console\.error\(`\$\{INCOMPLETO\}[^`]*`\);\s*process\.exit\(1\);/.test(scriptAnnulla) && /console\.error\(`\$\{INCOMPLETO\} \(\$\{e instanceof Error \? e\.message : String\(e\)\}\)\.`\);\s*process\.exit\(1\);/.test(scriptAnnulla) && scriptAnnulla.includes('const INCOMPLETO = "ANNULLAMENTO INCOMPLETO: rilanciare lo stesso comando"'));
    const annLib = leggi("src/lib/radar/riclassificazione.ts").slice(leggi("src/lib/radar/riclassificazione.ts").indexOf("export async function annullaEsecuzione"));
    atteso("H. annullamento: nessuna lettura con l'errore ignorato (ogni «.select(» controlla il suo errore) e l'errore della traccia si conta", (annLib.match(/\.select\(/g) ?? []).length === (annLib.match(/if \((e\w*|error)\) throw new/g) ?? []).length + (annLib.match(/\.update\([^)]*\)[^;]*\.select\("id"\)/g) ?? []).length && annLib.includes("if (eTraccia) esito.errori++;"));

    const s = leggi("scripts/radar-riclassifica-settori.ts");
    atteso("H. script: il diario è obbligatorio per «applica», si salva PRIMA di ogni scrittura (file temporaneo e rinomina) e la ripresa lo rilegge", s.includes('const fileDiario = opzione("--diario")') && s.indexOf("fs.renameSync(`${fileDiario}.tmp`, fileDiario)") > 0 && s.indexOf("fs.renameSync(`${fileDiario}.tmp`, fileDiario)") < s.indexOf("await applicaPiani(db, diario.piani") && s.includes("RIPRESA dell'esecuzione"));
  }

  console.log("");
  if (fallimenti.length) {
    console.log(`Verifica della fase B2b: ${fallimenti.length} controlli falliti:`);
    for (const f of fallimenti) console.log(` - ${f}`);
    process.exit(1);
  }
  console.log("Verifica della fase B2b (riclassificazione, popolamento della 0121, importatori): tutto a posto.");
}

principale().catch((e) => {
  console.error(e);
  process.exit(1);
});
