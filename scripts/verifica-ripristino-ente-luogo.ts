// Verifica dello script che ripristina sede dell'ente e regioni delle gare dello staging dopo il giro di prova PVL del 24/11/2026: su un
// database IN MEMORIA, senza rete, con le righe costruite dal piano (gli stessi id e i valori lasciati dal giro; per la parte B il NUTS e le
// fonti lette sullo staging il 24/11). Controlla anche che la parte A sia quella che il motore CORRETTO produce dai valori di prima e da
// quelli del giro, che un nuovo giro PVL non la riporti indietro, e che le regioni della parte B siano quelle degli importatori TED e Sintel.
// Uso: npx tsx scripts/verifica-ripristino-ente-luogo.ts
import { CARTELLA_ESITO, REGIONI_SINTEL, diarioSuFile, lancia, leggiPiano, pianoRipristino, ripristinaEnteLuogo, verificaDopo, type FileEsito, type GaraParteA, type GaraParteB } from "./ente-luogo/ripristina-ente-luogo-staging";
import { FermoCollaudo } from "./collaudo-z8/collaudo-motore-z8";
import { DbFinto } from "./lib/db-finto-motore";
import type { ClientDb } from "../src/lib/radar/notifiche/motore";
import { unisciVersione, versioneDa, type ProvenienzaCampi } from "../src/lib/radar/unione-calcoli";
import { rigaDaBandoPvl } from "../src/lib/radar/importa-pvl-calcoli";
import { leggiAvvisoPvl, type BandoPvl } from "../src/lib/radar/fonti/pvl-calcoli";
import { leggiProceduraSintel, type BandoSintel } from "../src/lib/radar/fonti/sintel-calcoli";
import { regioneDaNuts } from "../src/lib/radar/territorio";
import type { RigaProcedura } from "../src/lib/radar/importa-calcoli";
import fs from "fs";
import os from "os";
import path from "path";

let ok = 0;
const falliti: string[] = [];
function controlla(nome: string, condizione: boolean, dettaglio?: unknown): void {
  if (condizione) ok++;
  else falliti.push(`${nome}${dettaglio === undefined ? "" : ` → ${JSON.stringify(dettaglio).slice(0, 500)}`}`);
}
const chiamate: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => {
  chiamate.push(String(input instanceof URL ? input.href : typeof input === "string" ? input : input.url));
  return new Response(JSON.stringify({ code: "XX000", message: "finto" }), { status: 500, headers: { "content-type": "application/json" } });
}) as typeof fetch;

const ORA = new Date("2026-11-25T08:00:00Z");
const AGGIORNATA = "2026-11-24T14:32:58.000+00:00";
const piano = leggiPiano();
const GARE = piano.gare;
const GARE_A = GARE.filter((g): g is GaraParteA => g.parte === "A");
const GARE_B = GARE.filter((g): g is GaraParteB => g.parte === "B");
type SedePiano = GaraParteA["atteso"];
const sedeDi = (r: Record<string, unknown>) => JSON.stringify([r.sa_comune ?? null, r.sa_provincia ?? null, r.sa_regione ?? null, r.luogo_regioni ?? []]);
const sedePiano = (s: SedePiano) => JSON.stringify([s.sa_comune, s.sa_provincia, s.sa_regione, s.luogo_regioni]);
// parte B: NUTS letto sullo staging il 24/11 (sola lettura) e regione attesa
const NUTS_B: Record<string, [string, string]> = { "2d30227b": ["ITH36", "veneto"], "43efcd03": ["ITC41", "lombardia"], "86f0633c": ["ITC4D", "lombardia"], dcacc017: ["ITC41", "lombardia"], fb3cfbf0: ["ITI12", "toscana"] };
const PV_PVL = { f: "pvl", id: "avviso-vecchio", g: "2026-11-16", t: "2026-11-16T07:00:00.000Z", ted: null };
const pvTed = (id: string) => ({ f: "ted", id, g: "2026-11-05", t: null, ted: id });
const PV_SINTEL = { f: "sintel", id: "219294960@2026-11-23", g: "2026-11-23", t: null, ted: null };
const rigaB = (g: GaraParteB) => {
  const nuts = NUTS_B[g.id.slice(0, 8)];
  return {
    id: g.id,
    sa_comune: "Comune sintetico",
    sa_provincia: null,
    sa_regione: null,
    luogo_regioni: [],
    codice_nuts: g.fonte === "ted" ? nuts[0] : null,
    fonti: ["pvl", g.fonte],
    provenienza_campi: g.fonte === "ted" ? { _versione: PV_PVL, luogo: PV_PVL, ente: PV_PVL, codice_nuts: pvTed("769589-2026") } : { _versione: PV_SINTEL, luogo: PV_PVL, ente: PV_PVL, valore_base: PV_SINTEL },
    aggiornata_il: AGGIORNATA,
    oggetto: "(gara sintetica B)",
  };
};
function mondo(modifica?: (db: DbFinto) => void): DbFinto {
  const db = new DbFinto();
  db.tabelle.radar_procedure = [
    ...GARE_A.map((g) => ({ id: g.id, sa_comune: g.giro.sa_comune, sa_provincia: g.giro.sa_provincia, sa_regione: g.giro.sa_regione, luogo_regioni: [...g.giro.luogo_regioni], codice_nuts: "ITC4C", fonti: ["pvl", g.provenienza.luogo.f], provenienza_campi: { _versione: g.giro.luogo, luogo: g.giro.luogo, ente: g.giro.luogo, oggetto: { f: "ted", id: "000001-2026", g: "2026-11-17", t: null, ted: "000001-2026" } }, aggiornata_il: AGGIORNATA, oggetto: "(gara sintetica)" })),
    ...GARE_B.map(rigaB),
    { id: "altra-gara", sa_comune: "Taino", sa_provincia: null, sa_regione: null, luogo_regioni: [], codice_nuts: "ITC41", fonti: ["pvl", "ted"], provenienza_campi: { luogo: PV_PVL, codice_nuts: pvTed("700000-2026") }, aggiornata_il: AGGIORNATA, oggetto: "(fuori dal piano)" },
  ];
  db.tabelle.radar_aggiornamenti = [];
  modifica?.(db);
  return db;
}
const gara = (db: DbFinto, id: string) => db.t("radar_procedure").find((r) => r.id === id)!;
const scritture = (db: DbFinto) => db.richieste.filter((r) => r.metodo !== "select");
const attesoB = (g: GaraParteB) => (g.fonte === "ted" ? [NUTS_B[g.id.slice(0, 8)][1]] : ["lombardia"]);

async function principale(): Promise<void> {
  // ───── il piano ─────
  controlla("piano: 33 gare; parte A 26 (11 con valori, 15 solo provenienza), parte B 7 (5 TED, 2 Sintel)", piano.conteggi.gare === 33 && GARE_A.length === 26 && GARE_A.filter((g) => g.valori).length === 11 && GARE_B.length === 7 && GARE_B.filter((g) => g.fonte === "ted").length === 5 && GARE_B.filter((g) => g.fonte === "sintel").length === 2, piano.conteggi);
  controlla("piano B: esattamente le 7 gare senza regioni indicate dal coordinamento", JSON.stringify(GARE_B.map((g) => `${g.id.slice(0, 8)}:${g.fonte}`)) === JSON.stringify(["2d30227b:ted", "43efcd03:ted", "86f0633c:ted", "dcacc017:ted", "fb3cfbf0:ted", "5f6adcdd:sintel", "865c1977:sintel"]));
  controlla("piano A: valori diversi dal giro esattamente nelle 11 gare «con valori»", GARE_A.every((g) => (sedePiano(g.giro) !== sedePiano(g.atteso)) === g.valori));
  controlla("piano A: il giro aveva sempre la sede della PVL; il ripristino la dà a TED o Sintel (mai alla PVL)", GARE_A.every((g) => g.giro.luogo.f === "pvl" && ["ted", "sintel"].includes(g.provenienza.luogo.f)));
  const regioniSvuotate = GARE_A.filter((g) => g.giro.luogo_regioni.length === 0).map((g) => g.id.slice(0, 8)).sort();
  controlla("piano A: le 3 gare con le regioni svuotate tornano con le regioni di prima", JSON.stringify(regioniSvuotate) === JSON.stringify(["56a35499", "aa7b73ba", "d1e67ebf"]) && GARE_A.filter((g) => g.giro.luogo_regioni.length === 0).every((g) => JSON.stringify(g.atteso.luogo_regioni) === JSON.stringify(g.prima.luogo_regioni) && g.atteso.luogo_regioni.length > 0), regioniSvuotate);
  controlla("piano A: nessuna gara perde un valore che aveva prima del giro", GARE_A.every((g) => (["sa_comune", "sa_regione", "sa_provincia"] as const).every((c) => !g.prima[c] || g.atteso[c] === g.prima[c])));
  // la regione della parte B è quella degli importatori: TED con regioneDaNuts, Sintel sempre «lombardia» (lettore Sintel vero)
  const ted = fs.readFileSync(path.join(process.cwd(), "src/lib/radar/fonti/ted-calcoli.ts"), "utf8");
  controlla("parte B TED: l'importatore TED ricava le regioni con regioneDaNuts (stessa funzione dello script)", /import \{[^}]*\bregioneDaNuts\b[^}]*\} from "\.\.\/territorio"/.test(ted) && /\.map\(regioneDaNuts\)/.test(ted));
  controlla("parte B TED: ITH36 veneto, ITC41 e ITC4D lombardia, ITI12 toscana", Object.values(NUTS_B).every(([n, r]) => regioneDaNuts(n) === r));
  const sintel = (stazione: string) => (leggiProceduraSintel("900000001", [{ id_procedura: "900000001", id_lotto: "N/D", multilotto: "NO", cig: "PRV0000001", codice_cpv: "90910000-9", data_inizio_negoziazione: "2026-11-10T00:00:00.000", data_fine_negoziazione: "2026-12-15T00:00:00.000", modalita_scelta_contraente: "Procedura Aperta", ambito_merceologico: "Procedura per forniture/servizi", stato_procedura: "Pubblicata", stato_lotto: "N/D", valore_economico_procedura: "120000", cf_stazione_appaltante: "00000000002", stazione_appaltante: stazione, nome_procedura: "Servizio di pulizia (prova sintetica)", link_procedura: { url: "http://www.sintel.regione.lombardia.it/eprocdata/auctionDetail.xhtml?id=900000001" } }] as never, "2026-11-12") as BandoSintel).regioni;
  controlla("parte B Sintel: il lettore Sintel assegna di suo «lombardia» a ogni bando (comune o altro ente), uguale allo script", [sintel("COMUNE DI SINTETICO"), sintel("ASST SINTETICA"), [...REGIONI_SINTEL]].every((r) => JSON.stringify(r) === JSON.stringify(["lombardia"])));

  // la parte A è quella del motore corretto: riga di prima (sede della fonte di prima) + riga PVL del giro → valori attesi; e un nuovo giro
  // della stessa versione PVL sul valore ripristinato non cambia nulla
  const campione = JSON.parse(fs.readFileSync(path.join(process.cwd(), "scripts/dati/radar-pvl-campione.json"), "utf8")) as { avvisi: Record<string, unknown>[] };
  const base = rigaDaBandoPvl(leggiAvvisoPvl(campione.avvisi[1]) as BandoPvl, ORA);
  const conSede = (s: SedePiano, p: Partial<RigaProcedura> = {}): RigaProcedura => ({ ...base, ...p, sa_comune: s.sa_comune, sa_provincia: s.sa_provincia, sa_regione: s.sa_regione, luogo_regioni: [...s.luogo_regioni] });
  const ricalcolate = GARE_A.map((g) => {
    const provPrima: ProvenienzaCampi = { _versione: g.provenienza.luogo, luogo: g.provenienza.luogo };
    const prima = conSede(g.prima, { chiave: `${g.provenienza.luogo.f}:sintetica`, ultima_versione_id: g.provenienza.luogo.id });
    const u = unisciVersione(prima, provPrima, conSede(g.giro), versioneDa(g.giro.luogo), "2026-11-24T14:32:30.000Z");
    const ancora = unisciVersione({ ...conSede(g.atteso), chiave: "x" }, { ...u.provenienza, luogo: g.provenienza.luogo, luogo_regioni: g.provenienza.luogo_regioni }, conSede(g.giro), versioneDa(g.giro.luogo), "2026-11-25T08:05:00.000Z");
    return { id: g.id, motore: sedeDi(u.riga as unknown as Record<string, unknown>), piano: sedePiano(g.atteso), stabile: sedeDi(ancora.riga as unknown as Record<string, unknown>) === sedePiano(g.atteso) && ancora.provenienza.luogo?.f === g.provenienza.luogo.f };
  });
  const diverse = ricalcolate.filter((r) => r.motore !== r.piano);
  controlla("piano A = motore corretto (unisciVersione) per tutte le 26 gare", diverse.length === 0, diverse.slice(0, 3));
  controlla("un nuovo giro della stessa versione PVL non riporta indietro nessuna gara della parte A", ricalcolate.every((r) => r.stabile), ricalcolate.filter((r) => !r.stabile).map((r) => r.id));

  // ───── prima: solo letture, valore attuale → valore ripristinato e motivo ─────
  const dbP = mondo();
  const piani = await pianoRipristino(dbP as unknown as ClientDb, GARE);
  controlla("prima: 33 piani, nessuna scrittura, nessuna già a posto, un motivo per ognuna", piani.length === 33 && scritture(dbP).length === 0 && piani.every((p) => !p.giaAPosto && p.motivo.length > 10), { n: piani.length, scritture: scritture(dbP).length });
  controlla("prima: i motivi dicono che cosa si corregge (sede, regioni svuotate, provincia tolta, solo provenienza, NUTS, Sintel)", ["56a35499", "a8f5c7db", "39d1677f", "2d30227b", "5f6adcdd"].every((x) => !!piani.find((p) => p.gara.startsWith(x))) &&
    /regioni svuotate dal giro/.test(piani.find((p) => p.gara.startsWith("56a35499"))!.motivo) && /regione svuotata dal giro/.test(piani.find((p) => p.gara.startsWith("d1e67ebf"))?.motivo ?? "") && /sede presa dal luogo di esecuzione PVL → sede TED/.test(piani.find((p) => p.gara.startsWith("63e0b112"))?.motivo ?? "") &&/provincia di un altro comune tolta/.test(piani.find((p) => p.gara.startsWith("a8f5c7db"))!.motivo) && /valori già giusti/.test(piani.find((p) => p.gara.startsWith("39d1677f"))!.motivo) && /regioneDaNuts del codice_nuts registrato ITH36 \(primo NUTS della procedura o dell.ente\): approssimazione deterministica, una sola regione/.test(piani.find((p) => p.gara.startsWith("2d30227b"))!.motivo) && /importatore Sintel/.test(piani.find((p) => p.gara.startsWith("5f6adcdd"))!.motivo));
  let dopoPrima = false;
  try {
    await verificaDopo(dbP as unknown as ClientDb, GARE);
  } catch (x) {
    dopoPrima = x instanceof FermoCollaudo && /non ripristinate/.test(x.message);
  }
  controlla("dopo, lanciato PRIMA del ripristino: si ferma (33 gare non ripristinate)", dopoPrima);

  // ───── applica ─────
  const db = mondo();
  const altraPrima = JSON.stringify(gara(db, "altra-gara"));
  const fogli: FileEsito[] = [];
  let minuto = 0;
  const orologio = () => new Date(ORA.getTime() + 1000 * minuto++);
  const e = await ripristinaEnteLuogo(db as unknown as ClientDb, orologio, GARE, (f) => fogli.push(structuredClone(f)));
  controlla("applica: 33 gare riscritte", e.cambiate === 33 && e.giaAPosto === 0, { cambiate: e.cambiate });
  controlla("applica A: ogni gara ha sede e regioni del piano", GARE_A.every((g) => sedeDi(gara(db, g.id)) === sedePiano(g.atteso)), GARE_A.filter((g) => sedeDi(gara(db, g.id)) !== sedePiano(g.atteso)).map((g) => g.id));
  controlla("applica A: provenienza della sede e delle regioni del piano; gli altri campi della provenienza intatti", GARE_A.every((g) => {
    const p = gara(db, g.id).provenienza_campi as ProvenienzaCampi;
    return JSON.stringify(p.luogo) === JSON.stringify(g.provenienza.luogo) && JSON.stringify(p.luogo_regioni) === JSON.stringify(g.provenienza.luogo_regioni) && p.oggetto?.id === "000001-2026" && JSON.stringify(p.ente) === JSON.stringify(g.giro.luogo);
  }));
  controlla("applica B: solo le regioni (TED dal NUTS, Sintel lombardia); la sede NON si tocca", GARE_B.every((g) => sedeDi(gara(db, g.id)) === JSON.stringify(["Comune sintetico", null, null, attesoB(g)])), GARE_B.map((g) => sedeDi(gara(db, g.id))));
  controlla("applica B: provenienza delle regioni = quella del NUTS TED o della versione Sintel; sede e resto della provenienza intatti", GARE_B.every((g) => {
    const p = gara(db, g.id).provenienza_campi as ProvenienzaCampi;
    return JSON.stringify(p.luogo_regioni) === JSON.stringify(g.fonte === "ted" ? pvTed("769589-2026") : PV_SINTEL) && JSON.stringify(p.luogo) === JSON.stringify(PV_PVL) && JSON.stringify(p.ente) === JSON.stringify(PV_PVL);
  }));
  controlla("applica: aggiornata_il e gli altri campi delle gare non cambiano", GARE.every((g) => gara(db, g.id).aggiornata_il === AGGIORNATA && String(gara(db, g.id).oggetto).startsWith("(gara sintetica")));
  controlla("applica: una gara fuori dal piano (senza regioni anche lei) non cambia", JSON.stringify(gara(db, "altra-gara")) === altraPrima);
  // rilievo 1 di B2: NESSUNA riga nel registro dei cambiamenti (i clienti la vedrebbero nella cronologia della scheda)
  controlla("applica: nessuna riga in radar_aggiornamenti; solo 33 aggiornamenti di radar_procedure", db.t("radar_aggiornamenti").length === 0 && scritture(db).length === 33 && scritture(db).every((r) => r.tabella === "radar_procedure" && r.metodo === "update"));
  // l'esito su file: piano prima della prima scrittura, una riga per gara con prima, dopo, provenienza e ora, «completato» alla fine
  const ultimo = fogli[fogli.length - 1];
  controlla("esito: scritto prima della prima scrittura (33 «da scrivere», stato «in corso»), dopo ogni gara e alla fine (35 volte)", fogli.length === 35 && fogli[0].stato === "in corso" && fogli[0].gare.length === 33 && fogli[0].gare.every((r) => r.esito === "da scrivere" && r.ora === null) && fogli[1].conteggi.scritte === 1, { n: fogli.length });
  controlla("esito finale: «completato», 33 gare scritte, ognuna con l'ora della sua scrittura", ultimo.stato === "completato" && ultimo.motivo_fermo === null && ultimo.conteggi.scritte === 33 && ultimo.gare.every((r) => r.esito === "scritta" && typeof r.ora === "string") && new Set(ultimo.gare.map((r) => r.ora)).size === 33);
  controlla("esito: per ogni gara id, parte, motivo, valori prima e dopo, provenienza prima e scritta", ultimo.gare.every((r) => {
    const g = GARE.find((x) => x.id === r.id)!;
    const sedeOk = g.parte === "A" ? sedePiano(r.dopo) === sedePiano(g.atteso) && sedePiano(r.prima) === sedePiano(g.giro) && r.provenienza_scritta.luogo?.f === g.provenienza.luogo.f && r.provenienza_prima.luogo?.f === "pvl" : JSON.stringify(r.dopo.luogo_regioni) === JSON.stringify(attesoB(g)) && r.prima.luogo_regioni.length === 0 && !!r.provenienza_scritta.luogo_regioni;
    return sedeOk && r.parte === g.parte && r.motivo.length > 10;
  }));
  const testoEsito = JSON.stringify(ultimo);
  controlla("esito: solo dati pubblici delle gare (nessun utente, email, impresa, chiave)", Object.keys(ultimo.gare[0]).join(",") === "id,parte,motivo,prima,dopo,provenienza_prima,provenienza_scritta,esito,ora" && !/[\w.+-]+@[\w-]+\.[a-z]{2,}|user_id|utente|impresa|email|secret|sb_secret|sb_publishable/i.test(testoEsito));
  const d1 = await verificaDopo(db as unknown as ClientDb, GARE);
  controlla("dopo: tutte le 33 gare ripristinate, nessuna riga «ente_luogo» nel registro", d1.piani.length === 33 && d1.piani.every((p) => p.giaAPosto));
  const foto = JSON.stringify(db.tabelle);
  const fogli2: FileEsito[] = [];
  const e2 = await ripristinaEnteLuogo(db as unknown as ClientDb, () => new Date("2026-11-26T08:00:00Z"), GARE, (f) => fogli2.push(f));
  controlla("ripetuto: idempotente (0 gare cambiate, 33 già a posto, nulla cambia; l'esito dice «già a posto»)", e2.cambiate === 0 && e2.giaAPosto === 33 && JSON.stringify(db.tabelle) === foto && fogli2[fogli2.length - 1].stato === "completato" && fogli2[fogli2.length - 1].conteggi.gia_a_posto === 33, { cambiate: e2.cambiate, giaAPosto: e2.giaAPosto });
  {
    // il diario vero: file JSON nella cartella indicata (qui una cartella temporanea), creata solo alla prima scrittura, riscritto a ogni passo
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "ti-esito-"));
    const cartella = path.join(base, "allegati", "ente-luogo");
    const { diario, file } = diarioSuFile(cartella, new Date("2026-11-25T08:30:00.000Z"));
    const primaDellaScrittura = fs.existsSync(cartella);
    const dF = mondo();
    await ripristinaEnteLuogo(dF as unknown as ClientDb, orologio, GARE, diario);
    const letto = JSON.parse(fs.readFileSync(file, "utf8")) as FileEsito;
    controlla("diario su file: cartella creata solo scrivendo, nome con l'ora del lancio, contenuto = esito finale", !primaDellaScrittura && path.basename(file) === "esito-ripristino-ente-luogo-20261125T083000000Z.json" && letto.stato === "completato" && letto.gare.length === 33 && letto.conteggi.scritte === 33);
    fs.rmSync(base, { recursive: true, force: true });
  }
  {
    // CARTELLA_ESITO: quella degli allegati del coordinamento
    controlla("cartella dell'esito: TENDER_INTELLIGENCE_FASE0/allegati/ente-luogo", CARTELLA_ESITO.replace(/\\/g, "/").endsWith("/TENDER_INTELLIGENCE_FASE0/allegati/ente-luogo"));
  }
  const dopoRotto = async (nome: string, rompi: (d: DbFinto) => void, motivo: RegExp) => {
    const d = mondo();
    await ripristinaEnteLuogo(d as unknown as ClientDb, orologio, GARE);
    rompi(d);
    let fermo = false;
    try {
      await verificaDopo(d as unknown as ClientDb, GARE);
    } catch (x) {
      fermo = x instanceof FermoCollaudo && motivo.test(x.message);
    }
    controlla(`dopo: si ferma con ${nome}`, fermo);
  };
  await dopoRotto("una riga «ente_luogo» nel registro dei cambiamenti di una gara del piano", (d) => d.t("radar_aggiornamenti").push({ procedura_id: GARE[0].id, tipo: "correzione_dati", campo: "ente_luogo", id_fonte: "x", notificabile: false }), /registro dei cambiamenti/);
  await dopoRotto("una gara tornata al valore del giro", (d) => { Object.assign(d.t("radar_procedure").find((r) => String(r.id).startsWith("a092afc1"))!, { sa_comune: "Trieste", sa_provincia: "TS", sa_regione: "friuli_venezia_giulia" }); }, /non sono quelle lasciate dal giro|non ripristinate/);
  {
    // una riga «ente_luogo» su una gara FUORI dal piano non riguarda il ripristino: «dopo» non si ferma
    const d = mondo();
    await ripristinaEnteLuogo(d as unknown as ClientDb, orologio, GARE);
    d.t("radar_aggiornamenti").push({ procedura_id: "altra-gara", tipo: "correzione_dati", campo: "ente_luogo", id_fonte: "x", notificabile: false });
    let fermo = false;
    try {
      await verificaDopo(d as unknown as ClientDb, GARE);
    } catch {
      fermo = true;
    }
    controlla("dopo: le righe di gare fuori dal piano non contano", !fermo);
  }

  // FERMO: qualunque differenza dallo stato lasciato dal giro, senza scrivere nulla per NESSUNA gara
  const quale = (prefisso: string) => (d: DbFinto) => d.t("radar_procedure").find((r) => String(r.id).startsWith(prefisso))!;
  const casi: [string, (d: DbFinto) => void][] = [
    ["una gara mancante", (d) => { d.tabelle.radar_procedure = d.t("radar_procedure").filter((r) => !String(r.id).startsWith("63e0b112")); }],
    ["un comune diverso da quello del giro", (d) => { quale("a092afc1")(d).sa_comune = "Gorizia"; }],
    ["regioni diverse da quelle del giro", (d) => { quale("d1e67ebf")(d).luogo_regioni = ["lazio", "umbria"]; }],
    ["la sede già passata a un'altra versione PVL", (d) => { (quale("dc2b688a")(d).provenienza_campi as ProvenienzaCampi).luogo = { f: "pvl", id: "altro-avviso", g: "2026-11-25", t: null, ted: null }; }],
    ["la sede tornata a TED ma con valori diversi dal piano", (d) => { Object.assign(quale("f66becb6")(d), { sa_comune: "Verbania", sa_provincia: null }); }],
    ["parte B: il NUTS non viene da TED", (d) => { (quale("43efcd03")(d).provenienza_campi as ProvenienzaCampi).codice_nuts = { f: "pvl", id: "x", g: "2026-11-16", t: null, ted: null }; }],
    ["parte B: NUTS non riconosciuto", (d) => { quale("fb3cfbf0")(d).codice_nuts = "ITZZZ"; }],
    ["parte B: regioni non più vuote (date da un altro giro)", (d) => { quale("86f0633c")(d).luogo_regioni = ["piemonte"]; }],
    ["parte B: la fonte Sintel non è più tra le fonti della gara", (d) => { quale("865c1977")(d).fonti = ["pvl"]; }],
    ["parte B: nessuna provenienza Sintel nella gara", (d) => { quale("5f6adcdd")(d).provenienza_campi = { luogo: { f: "pvl", id: "x", g: "2026-11-16", t: null, ted: null } }; }],
  ];
  for (const [nome, rompi] of casi) {
    const d = mondo(rompi);
    let fermo = false;
    try {
      await ripristinaEnteLuogo(d as unknown as ClientDb, () => ORA, GARE);
    } catch (x) {
      fermo = x instanceof FermoCollaudo;
    }
    controlla(`FERMO con ${nome}: nessuna scrittura per nessuna gara`, fermo && scritture(d).length === 0);
  }
  {
    // la gara riscritta tra la lettura e la scrittura (aggiornata_il cambiata): la scrittura condizionata non colpisce nulla → FERMO
    const d = mondo();
    const originale = d.from.bind(d);
    let letture = 0;
    d.from = (nome: string) => {
      if (nome === "radar_procedure" && ++letture === GARE.length + 1) quale("a0c6c4b0")(d).aggiornata_il = "2026-11-25T07:00:00.000+00:00";
      return originale(nome);
    };
    let fermo = false;
    const foglio: FileEsito[] = [];
    try {
      await ripristinaEnteLuogo(d as unknown as ClientDb, () => ORA, GARE, (f) => foglio.push(structuredClone(f)));
    } catch (x) {
      fermo = x instanceof FermoCollaudo && /cambiate 0 righe/.test(x.message);
    }
    controlla("FERMO se una gara è riscritta tra lettura e scrittura (aggiornata_il diversa): quella gara non cambia", fermo && quale("a0c6c4b0")(d).sa_comune === "Firenze");
    const f = foglio[foglio.length - 1];
    const scritteDavvero = d.t("radar_procedure").filter((r) => GARE.some((g) => g.id === r.id) && r.aggiornata_il === AGGIORNATA && JSON.stringify((r.provenienza_campi as ProvenienzaCampi).luogo_regioni ?? null) !== "null").map((r) => r.id).sort();
    controlla("esito fermato a metà: stato «fermato» col motivo, e le gare già scritte sono esattamente quelle segnate «scritta»", f.stato === "fermato" && /cambiate 0 righe/.test(f.motivo_fermo ?? "") && JSON.stringify(f.gare.filter((r) => r.esito === "scritta").map((r) => r.id).sort()) === JSON.stringify(scritteDavvero) && scritteDavvero.length > 0, { scritte: f.conteggi.scritte, davvero: scritteDavvero.length });
  }
  {
    // il database risponde «1 riga» ma non salva nulla (per esempio un trigger che riporta i valori): solo la verifica finale lo vede
    const d = mondo();
    const originale = d.from.bind(d);
    d.from = (nome: string) => {
      const q = originale(nome);
      if (nome === "radar_procedure") {
        const aggiorna = q.update.bind(q);
        q.update = (v: Record<string, unknown>) => aggiorna(v.sa_comune === "Roma" ? {} : v);
      }
      return q;
    };
    let fermo = false;
    try {
      await ripristinaEnteLuogo(d as unknown as ClientDb, () => ORA, GARE);
    } catch (x) {
      fermo = x instanceof FermoCollaudo && /dopo la scrittura/.test(x.message);
    }
    controlla("FERMO se dopo la scrittura una gara non ha il valore del piano (verifica finale)", fermo);
  }

  // guardie del lancio vero
  const ambiente = { NEXT_PUBLIC_SUPABASE_URL: "https://ryawdldqiumqsskrnyps.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "sb_secret_finto_per_la_prova", VERCEL_ENV: undefined as string | undefined };
  const porta = { controllaPorta: () => undefined };
  const rifiuta = async (nome: string, f: () => Promise<unknown>, motivo?: RegExp) => {
    const n = chiamate.length;
    let errore = false;
    try {
      await f();
    } catch (x) {
      errore = !motivo || (x instanceof FermoCollaudo && motivo.test(x.message));
    }
    controlla(`${nome} → rifiutato senza nessuna richiesta`, errore && chiamate.length === n);
  };
  await rifiuta("applica senza autorizzazione registrata (FERMO esplicito)", () => lancia("applica", ambiente, null, GARE), /autorizzazione registrata/);
  await rifiuta("applica con la porta che nega", () => lancia("applica", ambiente, { controllaPorta: () => { throw new Error("negata"); } }, GARE));
  await rifiuta("database di produzione", () => lancia("prima", { ...ambiente, NEXT_PUBLIC_SUPABASE_URL: "https://bihfrzspqxsrzlbqqvqa.supabase.co" }, porta, GARE));
  await rifiuta("su Vercel", () => lancia("applica", { ...ambiente, VERCEL_ENV: "production" }, porta, GARE));
  let nomeScript = "";
  await lancia("applica", ambiente, { controllaPorta: ({ script }) => { nomeScript = script; } }, GARE).catch(() => undefined);
  controlla("la porta del registro riceve il nome esatto dello script", nomeScript === "ripristina-ente-luogo-staging.ts", nomeScript);
  const n = chiamate.length;
  let fermato = false;
  try {
    await lancia("prima", ambiente, null, GARE);
  } catch {
    fermato = true;
  }
  controlla("prima: guardie superate, una lettura solo verso lo staging (qui fallisce e si ferma)", fermato && chiamate.slice(n).length === 1 && chiamate.slice(n).every((u) => u.startsWith("https://ryawdldqiumqsskrnyps.supabase.co/rest/v1/radar_procedure?select")), chiamate.slice(n));
}
principale()
  .catch((e) => falliti.push(`eccezione: ${e instanceof Error ? e.stack ?? e.message : String(e)}`))
  .finally(() => {
    console.log(`Verifica del ripristino di ente e luogo (giro PVL del 24/11): ${ok} ok, ${falliti.length} falliti`);
    for (const f of falliti) console.log(`  FALLITO: ${f}`);
    process.exit(falliti.length ? 1 : 0);
  });
