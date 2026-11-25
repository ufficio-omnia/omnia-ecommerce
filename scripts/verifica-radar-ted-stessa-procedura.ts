// Verifica della deduplicazione TED (difetto del 25/11/2026, documento 59; regola approvata dal coordinamento): un avviso si unisce a una gara
// con lo stesso identificativo di procedura (BT-04) SOLO se è la stessa procedura (ted-stessa-procedura.ts); altrimenti apre una gara nuova.
// Casi REALI dello staging resi ANONIMI (scripts/dati/ted-stessa-procedura-casi.json: enti, codici e identificativi sintetici con le stesse
// uguaglianze; titoli e CPV degli avvisi pubblici di TED). Nessuna rete, nessun database vero: il VERO importatore su un database in memoria.
//   1. regole pure (riferimento interno, codici dell'ente, titoli, chiavi);
//   2. i 34 casi sospetti: 24 legittimi (proroghe e rettifiche ripubblicate come avvisi nuovi) restano UNA gara; 10 unioni sbagliate si
//      separano, comprese le due gare SAI di Montedoro; sia con tutti gli avvisi in una pagina sia con un avviso per giro;
//   3. i 175 esiti: chiudono la LORO gara (anche se l'esito è pubblicato da una centrale di committenza per conto del comune); i 3 esiti di
//      altre gare (Zumpano su Atripalda, 2 di KYMA) non chiudono nulla;
//   4. gare scritte PRIMA di questa regola (senza identità salvate): si riconoscono dai dati della gara;
//   5. la riga di provenienza salva l'identità; una gara separata nasce come «nuova», senza rettifiche di altre gare.
// Uso: npx tsx scripts/verifica-radar-ted-stessa-procedura.ts
import fs from "node:fs";
import path from "node:path";
import { databaseInMemoria, type RigaMem } from "./lib/db-in-memoria";
import { eEsclusione, leggiBandoTed, leggiEsitoTed, CAMPI_ESITO, type BandoTed, type EsitoTed } from "../src/lib/radar/fonti/ted-calcoli";
import { applicaPaginaBandi, applicaPaginaEsiti } from "../src/lib/radar/importa";
import { rigaDaBando } from "../src/lib/radar/importa-calcoli";
import {
  chiaveSeparata,
  codiciEnte,
  confrontoTitoli,
  identitaValida,
  procedureIdDaChiave,
  riferimentoSignificativo,
  stessaProcedura,
  titoliCompatibili,
  type IdentitaTed,
} from "../src/lib/radar/fonti/ted-stessa-procedura";

let ok = 0;
const fallimenti: string[] = [];
function controlla(nome: string, condizione: boolean, dettaglio?: unknown) {
  if (condizione) ok++;
  else {
    fallimenti.push(nome);
    console.log(`FALLITO ${nome}${dettaglio === undefined ? "" : ` — ${JSON.stringify(dettaglio).slice(0, 900)}`}`);
  }
}

type Avviso = Record<string, unknown>;
type Dati = { casi: { caso: string; avvisi: Avviso[] }[]; esiti: { gara: string; chiave: string; sa_codice_fiscale: string | null; sa_denominazione: string | null; cpv_principale: string | null; oggetto: string; esiti: Avviso[] }[] };
const dati = JSON.parse(fs.readFileSync(path.join(__dirname, "dati", "ted-stessa-procedura-casi.json"), "utf8")) as Dati;
const ADESSO = new Date("2026-11-25T16:00:00.000Z");
const misure = () => ({ richiesteDb: 0, msDb: 0 });
const vuoto = () => databaseInMemoria({ radar_procedure: [], radar_lotti: [], radar_procedure_fonti: [], radar_aggiornamenti: [], omnia_ai_radar_gare_aggiunte: [] });
const numero = (a: Avviso) => String(a["publication-number"]);
const eEsito = (a: Avviso) => /^can-/.test(String(a["notice-type"]));
// l'esito letto con CAMPI_BANDO non porta lo stato del vincitore: qui lo si aggiunge (dato SINTETICO, la prova è sull'abbinamento)
const comeEsito = (a: Avviso): EsitoTed => {
  const e = leggiEsitoTed({ ...a, "winner-selection-status": ["selec-w"] });
  if (!e) throw new Error(`esito non leggibile ${numero(a)}`);
  return e;
};

// ═════ 1. regole pure ═════
function regolePure() {
  controlla("riferimento interno: «1», «01», «100 - Generica», «DEFAULT_VALUE_CHANGE_ME» non distinguono una gara", ["1", "01", "100 - Generica", "DEFAULT_VALUE_CHANGE_ME", "-", "N/A"].every((r) => riferimentoSignificativo(r) === null));
  controlla("riferimento interno: «24/2026/ACQ», «SUA A284», «ID 1238», «07/2026» sì", ["24/2026/ACQ", "SUA A284", "ID 1238", "07/2026"].every((r) => riferimentoSignificativo(r) !== null));
  controlla("codici dell'ente: partita IVA anche dentro «IT… | …», niente dai nomi", JSON.stringify(codiciEnte(["IT90000000001 | 90000000001"])) === '["90000000001"]' && codiciEnte(["UNIONE DEI COMUNI - GESTIONE GARE"]).length === 0);
  controlla("titoli: una proroga ripubblicata («AVVISO DI PROROGA…» + il titolo di prima) è compatibile", titoliCompatibili(["GARA 24/2026/ACQ - PROCEDURA APERTA PER L'AFFIDAMENTO DEI SERVIZI DI PULIZIA ORDINARIA"], ["AVVISO DI PROROGA DEL TERMINE DI SCADENZA DELLE OFFERTE_GARA 24/2026/ACQ - PROCEDURA APERTA PER L'AFFIDAMENTO DEI SERVIZI DI PULIZIA ORDINARIA"]));
  controlla("titoli: due SAI di comuni diversi NON sono compatibili", !titoliCompatibili(["Servizio di accoglienza integrata SAI del comune di san marzano di san giuseppe per il triennio 2026-2028"], ["SERVIZIO DI ACCOGLIENZA INTEGRATA SAI DEL COMUNE DI MARUGGIO PER IL TRIENNIO 2026-2028"]));
  controlla("titoli: due titoli brevi IDENTICI sono compatibili («SERVIZIO DI LOGISTICA»)", confrontoTitoli(["SERVIZIO DI LOGISTICA"], ["Servizio di logistica"]) === "compatibili");
  controlla("titoli: brevi e diversi non si confrontano («Procedura aperta» contro «Lotto 1 - Servizi di pulizia»)", confrontoTitoli(["Procedura aperta"], ["Lotto 1 - Servizi di pulizia"]) === "non_confrontabili");
  controlla("titoli: lunghi e diversi sono incompatibili", confrontoTitoli(["Servizio di pulizia degli uffici comunali di Alfa"], ["Servizio di vigilanza armata del porto di Beta"]) === "incompatibili");
  const breve: IdentitaTed = { cf: ["90000000001"], ente: "Ente A", cpv: "63100000", titoli: ["Procedura aperta"], rif: null };
  controlla("regola: titoli non confrontabili → stessa gara solo con stesso ente E stesso CPV", stessaProcedura(breve, { ...breve, titoli: ["Lotto 1"] }, { modificaDichiarata: false }) && !stessaProcedura(breve, { ...breve, titoli: ["Lotto 1"], cpv: "90910000" }, { modificaDichiarata: false }) && !stessaProcedura(breve, { ...breve, titoli: ["Lotto 1"], cf: ["90000000002"], ente: "Ente B" }, { modificaDichiarata: false }));
  const base: IdentitaTed = { cf: ["90000000001"], ente: "Ente A", cpv: "90910000", titoli: ["Servizio di pulizia degli uffici comunali di Alfa"], rif: "12/2026" };
  controlla("regola: stesso ente, stesso titolo, stesso CPV → stessa procedura", stessaProcedura({ ...base }, base, { modificaDichiarata: false }));
  controlla("regola: riferimenti interni significativi DIVERSI → gare diverse, anche con lo stesso titolo", !stessaProcedura({ ...base, rif: "13/2026" }, base, { modificaDichiarata: false }));
  controlla("regola: stesso riferimento interno ma titolo diverso → gare diverse (CUC di Salerno)", !stessaProcedura({ ...base, titoli: ["Servizio di spazzamento manuale del territorio di Beta"] }, base, { modificaDichiarata: false }));
  controlla("regola: ente diverso, stesso titolo e stesso CPV → stessa procedura (centrale di committenza per conto del comune)", stessaProcedura({ ...base, cf: ["90000000002"], ente: "Centrale sintetica" }, base, { modificaDichiarata: false }));
  controlla("regola: ente diverso, stesso titolo, CPV diverso → gare diverse", !stessaProcedura({ ...base, cf: ["90000000002"], ente: "Centrale sintetica", cpv: "55524000" }, base, { modificaDichiarata: false }));
  controlla("regola: modifica DICHIARATA dello stesso ente → stessa procedura anche con il titolo cambiato", stessaProcedura({ ...base, titoli: ["Rettifica: servizio di igiene ambientale degli immobili"] }, base, { modificaDichiarata: true }));
  controlla("regola: modifica dichiarata ma riferimento interno in conflitto → gare diverse", !stessaProcedura({ ...base, rif: "99/2025" }, base, { modificaDichiarata: true }));
  controlla("chiave separata «ted:<BT-04>~<numero>» e ritorno al BT-04", chiaveSeparata("proc-x", "123-2026") === "ted:proc-x~123-2026" && procedureIdDaChiave("ted:proc-x~123-2026") === "proc-x" && procedureIdDaChiave("ted:proc-x") === "proc-x" && procedureIdDaChiave("pvl:abc") === null);
  controlla("CAMPI_ESITO: ente, titoli, CPV e riferimento interno, ben sotto il limite di 10.000 campi per pagina", ["buyer-name", "organisation-identifier-buyer", "title-proc", "title-lot", "main-classification-proc", "internal-identifier-proc"].every((c) => (CAMPI_ESITO as readonly string[]).includes(c)) && CAMPI_ESITO.length * 250 <= 10_000);
}

// ═════ 2. i 34 casi ═════
// gruppi ATTESI dei bandi (numeri degli avvisi) per i 10 casi con gare diverse; negli altri 24 tutti i bandi sono una gara sola
const SEPARATI: Record<string, string[][]> = {
  // 428368 e 429453, stesso giorno e stesso ente: pulizie per la Polizia di Stato e per l'Arma dei Carabinieri, due gare diverse
  "caso-01": [["859971-2025"], ["208402-2026"], ["237756-2026"], ["396218-2026"], ["428368-2026"], ["429453-2026"], ["478256-2026", "817611-2026"], ["708627-2026", "733016-2026"]],
  "caso-02": [["70031-2026"], ["128023-2026"], ["128882-2026"], ["230455-2026", "259399-2026"], ["295401-2026"], ["344179-2026"]],
  "caso-03": [["23928-2026", "118366-2026"], ["128281-2026", "243196-2026"], ["421619-2026"]],
  "caso-05": [["509830-2026"], ["524681-2026", "624319-2026"]],
  "caso-08": [["235323-2026"], ["263132-2026", "552137-2026"]],
  "caso-09": [["629474-2026"], ["629912-2026"]],
  "caso-11": [["548403-2026", "619469-2026"]],
  "caso-14": [["339541-2026"], ["770052-2026"]],
  "caso-31": [["244102-2026"], ["287973-2026"]],
  "caso-34": [["593740-2026"], ["667964-2026"]],
};
// esiti attesi: applicati alla gara del caso (true) oppure a nessuna gara (false)
const ESITI_ATTESI: Record<string, boolean> = { "809863-2026": false, "507688-2026": false, "623529-2026": false, "759292-2026": true, "761827-2026": true, "541280-2026": true };

const gruppi = (righe: RigaMem[], numeri: readonly string[]) => {
  const perGara = new Map<string, string[]>();
  for (const r of righe) if (r.fonte === "ted" && numeri.includes(String(r.id_fonte))) perGara.set(String(r.procedura_id), [...(perGara.get(String(r.procedura_id)) ?? []), String(r.id_fonte)]);
  return [...perGara.values()].map((g) => g.sort()).sort((a, b) => a[0].localeCompare(b[0]));
};
const normalizzaGruppi = (g: string[][]) => g.map((x) => [...x].sort()).sort((a, b) => a[0].localeCompare(b[0]));

async function casi() {
  let esclusi = 0;
  let separazioni = 0;
  let legittimi = 0;
  for (const c of dati.casi) {
    const bandi: BandoTed[] = [];
    for (const a of c.avvisi.filter((x) => !eEsito(x))) {
      const b = leggiBandoTed(a);
      if (eEsclusione(b)) esclusi++;
      else bandi.push(b);
    }
    const inclusi = bandi.map((b) => b.meta.numero);
    if (inclusi.length === 0) {
      console.log(`  (${c.caso}: tutti i bandi esclusi dal lettore per settore o forma: nulla da unire)`);
      continue;
    }
    const attesi = normalizzaGruppi((SEPARATI[c.caso] ?? [inclusi]).map((g) => g.filter((n) => inclusi.includes(n))).filter((g) => g.length > 0));
    // a) tutti i bandi in una pagina
    const una = vuoto();
    await applicaPaginaBandi(una.client, bandi, "incrementale", ADESSO, misure());
    const g1 = gruppi(una.tabelle.radar_procedure_fonti, inclusi);
    // b) un avviso per giro, in ordine di pubblicazione
    const giri = vuoto();
    for (const b of [...bandi].sort((x, y) => x.meta.data.localeCompare(y.meta.data) || x.meta.numero.localeCompare(y.meta.numero))) await applicaPaginaBandi(giri.client, [b], "incrementale", ADESSO, misure());
    const g2 = gruppi(giri.tabelle.radar_procedure_fonti, inclusi);
    const nome = SEPARATI[c.caso] ? `${c.caso}: ${attesi.length} gare diverse separate` : `${c.caso}: legittimo, ${inclusi.length} avvisi in UNA gara`;
    controlla(`${nome} (una pagina)`, JSON.stringify(g1) === JSON.stringify(attesi), { atteso: attesi, ottenuto: g1 });
    controlla(`${nome} (un avviso per giro)`, JSON.stringify(g2) === JSON.stringify(attesi), { atteso: attesi, ottenuto: g2 });
    // le chiavi: la prima gara di un BT-04 tiene «ted:<BT-04>», le altre «ted:<BT-04>~<numero del primo avviso>»
    const chiavi = una.tabelle.radar_procedure.map((r) => String(r.chiave)).sort();
    controlla(`${c.caso}: chiavi «ted:<BT-04>» per la prima gara e «~<numero>» per le altre, una per gara`, chiavi.length === attesi.length && chiavi.filter((k) => !k.includes("~")).length === 1 && chiavi.every((k) => procedureIdDaChiave(k) !== null), chiavi);
    if (SEPARATI[c.caso] && attesi.length > 1) separazioni++;
    if (!SEPARATI[c.caso]) legittimi++;
    // gli esiti del caso, dopo i bandi
    for (const a of c.avvisi.filter(eEsito)) {
      const atteso = ESITI_ATTESI[numero(a)];
      const prima = JSON.stringify(una.tabelle.radar_procedure.map((r) => r.stato));
      const r = await applicaPaginaEsiti(una.client, [comeEsito(a)], "incrementale", ADESSO, misure());
      const dopo = JSON.stringify(una.tabelle.radar_procedure.map((r) => r.stato));
      if (atteso === false) controlla(`${c.caso}: l'esito ${numero(a)} di un'ALTRA gara non chiude nessuna gara`, r.applicati === 0 && r.senzaBando === 1 && prima === dopo, { r, prima, dopo });
      // trovata la sua gara (un secondo esito su una gara già aggiudicata non cambia lo stato: «applicati» 0, ma non «senza bando»)
      else controlla(`${c.caso}: l'esito ${numero(a)} trova la sua gara e la chiude`, r.senzaBando === 0 && una.tabelle.radar_procedure.some((g) => g.stato === "aggiudicata"), r);
    }
    // la provenienza salva l'identità di ogni avviso
    const righeTed = una.tabelle.radar_procedure_fonti.filter((r) => r.fonte === "ted");
    controlla(`${c.caso}: ogni riga di provenienza TED salva l'identità dell'avviso`, righeTed.length > 0 && righeTed.every((r) => identitaValida(r.foto) !== null));
    // una gara separata nasce come «nuova»; nessuna rettifica o proroga tra gare diverse
    if (SEPARATI[c.caso]) {
      const nuove = una.tabelle.radar_aggiornamenti.filter((a) => a.tipo === "nuova").length;
      controlla(`${c.caso}: ogni gara separata ha la sua riga «nuova»`, nuove === attesi.length, { nuove, gare: attesi.length });
      const gruppoDi = new Map(attesi.flatMap((g, i) => g.map((n) => [n, i] as const)));
      const garaDi = new Map(una.tabelle.radar_procedure_fonti.filter((r) => r.fonte === "ted").map((r) => [String(r.id_fonte), String(r.procedura_id)]));
      const incrociate = una.tabelle.radar_aggiornamenti.filter((a) => ["rettifica", "proroga"].includes(String(a.tipo))).filter((a) => {
        const altri = [...garaDi].filter(([, g]) => g === a.procedura_id).map(([n]) => gruppoDi.get(n));
        return new Set(altri).size > 1;
      });
      controlla(`${c.caso}: nessuna rettifica o proroga tra gare diverse`, incrociate.length === 0, incrociate);
    }
  }
  controlla("34 casi: 10 con gare diverse e gli altri legittimi (riepilogo; i casi con tutti i bandi esclusi dal lettore non contano)", Object.keys(SEPARATI).length === 10 && legittimi + Object.keys(SEPARATI).length <= 34 && legittimi >= 20, { legittimi, separazioni });
  console.log(`  (avvisi esclusi dal lettore per settore o forma: ${esclusi}; casi con gare separate: ${separazioni})`);
}

// ═════ 3. i 175 esiti, sulle gare com'erano sullo staging (senza identità salvate: si riconoscono dai dati della gara) ═════
async function esiti() {
  const ALTRUI = new Set(["809863-2026", "507688-2026", "623529-2026"]);
  const gare: RigaMem[] = dati.esiti.map((g, i) => ({
    id: g.gara,
    chiave: g.chiave,
    stato: "aperta",
    unita_a: null,
    sa_codice_fiscale: g.sa_codice_fiscale,
    sa_denominazione: g.sa_denominazione,
    cpv_principale: g.cpv_principale,
    oggetto: g.oggetto,
    ultima_versione_il: "2026-06-01",
    fonti: ["ted"],
    indice: i,
  }));
  const fonti: RigaMem[] = dati.esiti.map((g) => ({ procedura_id: g.gara, fonte: "ted", id_fonte: `bando-${g.gara}`, impronta: "x", id_procedura_fonte: procedureIdDaChiave(g.chiave), rif_ted: null, foto: null }));
  const mem = databaseInMemoria({ radar_procedure: gare, radar_lotti: [], radar_procedure_fonti: fonti, radar_aggiornamenti: [], omnia_ai_radar_gare_aggiunte: [] });
  const tutti = dati.esiti.flatMap((g) => g.esiti.map((a) => ({ gara: g.gara, a })));
  const r = await applicaPaginaEsiti(mem.client, tutti.map((x) => comeEsito(x.a)), "incrementale", ADESSO, misure());
  const chiuse = new Set(mem.tabelle.radar_procedure.filter((g) => g.stato === "aggiudicata").map((g) => String(g.id)));
  const attesiChiusi = new Set(tutti.filter((x) => !ALTRUI.has(numero(x.a))).map((x) => x.gara));
  const sbagliate = [...chiuse].filter((g) => !attesiChiusi.has(g));
  const mancate = [...attesiChiusi].filter((g) => !chiuse.has(g));
  controlla(`175 esiti: ogni esito chiude la SUA gara (${attesiChiusi.size} gare), nessuna in più né in meno`, sbagliate.length === 0 && mancate.length === 0, { sbagliate, mancate: mancate.map((g) => dati.esiti.find((x) => x.gara === g)) });
  controlla("175 esiti: i 3 esiti di ALTRE gare (Zumpano su Atripalda, 2 di KYMA) non chiudono nulla e restano «senza bando»", r.senzaBando === 3, r);
  const kyma = dati.esiti.find((g) => g.esiti.some((a) => numero(a) === "507688-2026"));
  controlla("KYMA: la gara aperta (scadenza futura) NON diventa «aggiudicata» per gli esiti di altre procedure", !!kyma && mem.tabelle.radar_procedure.find((g) => g.id === kyma.gara)?.stato === "aperta");
  controlla("esiti applicati: la provenienza salva l'identità dell'esito", mem.tabelle.radar_procedure_fonti.filter((x) => String(x.id_fonte).match(/^\d+-\d{4}$/)).every((x) => identitaValida(x.foto) !== null));
}

// ═════ 4. gare scritte PRIMA della regola, unite per errore (come sullo staging) ═════
async function primaDellaRegola() {
  // caso-01 sullo staging: una sola gara «ted:<BT-04>» con 10 avvisi, i dati dell'ultimo (pulizie di Grottaglie); nessuna identità salvata
  const c = dati.casi.find((x) => x.caso === "caso-01")!;
  const bandi = c.avvisi.map((a) => leggiBandoTed(a)).filter((b): b is BandoTed => !eEsclusione(b));
  const ultimo = bandi.find((b) => b.meta.numero === "817611-2026")!;
  const vecchi = bandi.filter((b) => b.meta.numero !== "817611-2026" && b.meta.numero !== "478256-2026");
  const mem = databaseInMemoria({
    radar_procedure: [{ ...rigaDaBando(ultimo, null, ADESSO), id: "vecchia", unita_a: null, provenienza_campi: {}, fonti: ["ted"] }],
    radar_lotti: [],
    radar_procedure_fonti: [...vecchi, ultimo].map((b) => ({ procedura_id: "vecchia", fonte: "ted", id_fonte: b.meta.numero, impronta: "vecchia", id_procedura_fonte: b.meta.procedureId, rif_ted: null, foto: null })),
    radar_aggiornamenti: [],
    omnia_ai_radar_gare_aggiunte: [],
  });
  // un avviso della STESSA gara (Grottaglie, letto di nuovo con un'impronta diversa) va alla gara vecchia; uno di un'altra apre una gara nuova
  const grottaglie = bandi.find((b) => b.meta.numero === "478256-2026")!;
  const refezione = bandi.find((b) => b.meta.numero === "859971-2025")!;
  await applicaPaginaBandi(mem.client, [grottaglie, { ...refezione, record: { ...refezione.record, impronta: "nuova" } }], "incrementale", ADESSO, misure());
  const garaDi = (n: string) => mem.tabelle.radar_procedure_fonti.find((r) => r.id_fonte === n)?.procedura_id;
  controlla("prima della regola: un avviso compatibile con i dati della gara vecchia (senza identità salvate) si unisce a lei", garaDi("478256-2026") === "vecchia");
  controlla("prima della regola: un avviso NON compatibile, già unito per errore, si sposta su una gara nuova «~<numero>»", garaDi("859971-2025") !== "vecchia" && mem.tabelle.radar_procedure.some((g) => String(g.chiave).endsWith("~859971-2025")));
}

async function principale() {
  regolePure();
  await casi();
  await esiti();
  await primaDellaRegola();
  console.log(`\nVerifica della deduplicazione TED (stessa procedura, 25/11): ${ok} ok, ${fallimenti.length} falliti`);
  if (fallimenti.length > 0) process.exit(1);
}

principale().catch((e) => {
  console.error(e);
  process.exit(1);
});
