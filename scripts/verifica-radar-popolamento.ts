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
import { VERSIONE_REGOLE_SETTORI, descriviCorrezioneSettori } from "../src/lib/radar/settori";
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
import { annullaEsecuzione, applicaPiani, leggiArchivio, pianiDaArchivio, TroppeGare } from "../src/lib/radar/riclassificazione";
import { classificaImportazione, lottiDopoScrittura, rigaRegistroImportazione } from "../src/lib/radar/classificazioni-importazione";
import { classificazioniAttive } from "../src/lib/radar/ambiente";
import { applicaPaginaBandi } from "../src/lib/radar/importa";
import { applicaPaginaBandiRegionali } from "../src/lib/radar/importa-regionali-pagina";
import { bandoDaAflink, statisticheRegionaliVuote, type BandoRegionale } from "../src/lib/radar/importa-regionali-calcoli";
import { leggiElementoAflink, type BandoAflink } from "../src/lib/radar/fonti/aflink-calcoli";
import { eEsclusione, leggiBandoTed } from "../src/lib/radar/fonti/ted-calcoli";
import type { RigaClassificazione } from "../src/lib/radar/classificazioni-calcoli";
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
    uguale("A. una gara esclusa perde il settore, con la regola", [tolta.tipo, tolta.dopo, tolta.esclusioni.map((e) => e.regola), tolta.idFonte], ["correzione", { settori: [], metodo: null }, ["forniture_di_beni"], `regole-settori-${VERSIONE_REGOLE_SETTORI}:forniture_di_beni`]);
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
    atteso("A. nota del registro: tolte e aggiunte, entro 1000 caratteri; anche dal solo elenco delle esclusioni", notaCorrezione(tolta).includes("Tolta da: ristorazione collettiva") && notaCorrezione(agg).includes("Aggiunta a: ristorazione collettiva") && notaCorrezione(Array.from({ length: 50 }, () => ({ settore: "ristorazione" as const, regola: "x", motivo: "m".repeat(80) }))).length <= 1000);
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
    const e = await applicaPiani(mem.client, piani, misure(), ISO);
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
    atteso("E. libreria: cambia solo settori, metodo e data della gara", (lib.match(/from\("radar_procedure"\)\.update\(\{[^}]*\}/g) ?? []).every((u) => /\.update\(\{ settori: [^,]+, metodo_settore: [^,]+, aggiornata_il: adessoIso \}$/.test(u)) && (lib.match(/from\("radar_procedure"\)\.update/g) ?? []).length === 3);
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
