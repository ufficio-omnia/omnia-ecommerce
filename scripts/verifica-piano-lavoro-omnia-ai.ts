// Autotest del «piano di lavoro» di OMNIA AI (Excel con formule attive generato dai documenti di gara):
//   - la normalizzazione di ciò che arriva dal modello (numeri, testi, nomi unici, limiti, quote);
//   - i calcoli, provati contro un piano fatto a mano (Milanosport): ore calcolate e adottate di tutte le 28 sedi,
//     totale dei macchinari, personale da riassorbire, sedi senza metrature segnalate;
//   - l'Excel: ogni formula viene RICALCOLATA da un motore indipendente (fast-formula-parser) e confrontata col
//     valore in cache scritto dal nostro codice; cambiando un input nel file e ricalcolando, i totali seguono come
//     nei calcoli (le formule sono davvero attive); niente collegamenti esterni, né errori;
//   - le avvertenze obbligatorie (prezzi standard da sostituire) e le celle gialle dei dati mancanti.
// Gratuito e senza rete: gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import type ExcelJS from "exceljs";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { LIMITI, PARAMETRI_STANDARD, normalizzaPianoLavoro, testoSicuro } from "../src/lib/piano-lavoro-dati";
import { calcolaPianoLavoro, elencoDatiMancanti } from "../src/lib/piano-lavoro-calcoli";
import { AVVERTENZE_FISSE, FOGLI, TESTO_AVVISO_PREZZI, costruisciExcelPianoLavoro } from "../src/lib/piano-lavoro-excel";
import { caricaCartella, ricalcola, vicino } from "./ricalcolo-formule";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale<T>(nome: string, ottenuto: T, previsto: T) {
  atteso(nome, JSON.stringify(ottenuto) === JSON.stringify(previsto), `ottenuto ${JSON.stringify(ottenuto)}, previsto ${JSON.stringify(previsto)}`);
}

// ───── dati di prova ─────
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "test", "fixtures", "piano-lavoro-milanosport.json"), "utf-8")) as {
  dati: unknown;
  attesi: {
    oreCalcolate: number[];
    oreAdottate: number[];
    mqTotali: number[];
    totaleOreCalcolate: number;
    totaleOreAdottate: number;
    totaleMacchinari: number;
    unitaUscenti: number;
    oreSettimanaliUscenti: number;
  };
};

// Un piano nello stile di «Teatro alla Scala»: presìdi con parametri, tre livelli, budget dei macchinari.
const sintetico = {
  appalto: { titolo: "Servizio di pulizia di prova", stazioneAppaltante: "Ente di prova", cig: "ABC123", importoBase: 1000000 },
  parametri: [
    { chiave: "durata_mesi", valore: 48, origine: "documento", fonte: "Capitolato art. 3" },
    { chiave: "ore_fte", valore: 1600, origine: "ipotesi" },
    { chiave: "monte_ore_dichiarato", valore: 65000, origine: "documento", fonte: "Stima economica" },
    { chiave: "n_prestazioni_serali", etichetta: "Prestazioni serali all'anno", valore: 390, unita: "n.", origine: "documento", fonte: "Capitolato art. 7" },
  ],
  tipologie: [
    {
      nome: "Aree monumentali",
      lavorazioni: [
        { nome: "Ripasso giornaliero", resa: 100, frequenza: { param: "giorni_anno" }, origineResa: "ipotesi", origineFrequenza: "documento" },
        { nome: "Pulizia periodica", resa: 150, frequenza: 12, origineResa: "ipotesi", origineFrequenza: "ipotesi" },
      ],
    },
    {
      nome: "Uffici",
      lavorazioni: [
        { nome: "Ripasso giornaliero", resa: 220, frequenza: { param: "giorni_anno" } },
        // svolto dagli addetti dei presìdi (foglio Presidi): non aggiunge ore dalle metrature
        { nome: "Pulizia svolta dal presidio fisso", resa: 100, frequenza: { param: "giorni_anno" }, esclusaDaMq: true },
      ],
    },
    { nome: "Magazzini", unita: "mq", lavorazioni: [{ nome: "Passaggio bisettimanale", resa: 500, frequenza: 104 }] },
  ],
  sedi: [
    { nome: "Teatro", indirizzo: "Via Prova 1", mq: { "Aree monumentali": 27000, Uffici: 3800, Magazzini: 0 }, oreDichiarate: null },
    { nome: "Magazzino Pero", mq: { "Aree monumentali": 0, Uffici: 0, Magazzini: 15000 }, aCanone: true },
    { nome: "Sede senza metrature", mq: {} },
    { nome: "Lavori extra canone", mq: { Uffici: 500 }, aCanone: false },
  ],
  presidi: [
    { gruppo: "Teatro (ordinario)", descrizione: "Capocantiere", addetti: 2, oreAddetto: 8, periodi: { param: "giorni_anno" }, origine: "documento", fonte: "Art. 9" },
    { gruppo: "Teatro (ordinario)", descrizione: "Addetti serali", addetti: 2, oreAddetto: 5, periodi: { param: "n_prestazioni_serali" }, origine: "documento" },
    { gruppo: "Laboratori", descrizione: "Presidio feriale", addetti: 3, oreAddetto: 55, periodi: { param: "settimane_anno" }, origine: "documento" },
  ],
  organico: [
    { livello: "2°", ruolo: "Addetti polivalenti", quota: 0.8, origine: "documento" },
    { livello: "3°", ruolo: "Operai qualificati", quota: 0.15, origine: "ipotesi" },
    { livello: "4°", ruolo: "Capisquadra", quota: 0.05, origine: "ipotesi" },
  ],
  macchinari: [
    { categoria: "Macchinari", descrizione: "Lavasciuga a spinta", riferimento: "FIMAP Maxima 50", quantita: 6, prezzoUnitario: 3200, vitaUtileMesi: 72, origine: "catalogo", fontePrezzo: "Listino di riferimento 10/2026" },
    { categoria: "Macchinari", descrizione: "Monospazzola", riferimento: "IPC", quantita: 5, prezzoUnitario: 1800, vitaUtileMesi: 36, origine: "ricerca_web", fontePrezzo: "https://esempio.test/monospazzola" },
    { categoria: "Attrezzature", descrizione: "Carrello multiservizio", quantita: 40, prezzoUnitario: 280, origine: "ipotesi" },
    { categoria: "Attrezzature", descrizione: "Attrezzo senza prezzo", quantita: 3, prezzoUnitario: null, origine: "ipotesi" },
  ],
  budgetMacchinari: 50000,
  avvertenze: ["Le superfici del magazzino sono quelle dell'art. 2 del capitolato."],
};

async function main() {
  // ═════ 1. normalizzazione ═════
  {
    const vuoto = normalizzaPianoLavoro(null);
    atteso("un input nullo dà comunque un piano valido: parametri standard, una tipologia, un livello", vuoto.dati.parametri.length === 6 && vuoto.dati.tipologie.length === 1 && vuoto.dati.organico.length === 1);
    const durata = vuoto.dati.parametri.find((p) => p.chiave === PARAMETRI_STANDARD.durataMesi);
    atteso("la durata assente resta un dato mancante (non un valore inventato)", durata?.valore === null && durata?.origine === "mancante");

    const sporco = normalizzaPianoLavoro({
      appalto: { titolo: "=CMD|' /C calc'!A0", stazioneAppaltante: "@Ente\u0007 con controllo" },
      parametri: [{ chiave: "Durata Mesi", valore: "24" }, { chiave: "monte_ore_dichiarato", valore: "1.234,5" }, { chiave: "tolleranza_quadratura", valore: 5 }],
      tipologie: [
        { nome: "Uffici*?", lavorazioni: [{ nome: "A", resa: -3, frequenza: "x" }, { nome: "B", resa: "250", frequenza: 365 }] },
        { nome: "Uffici*", lavorazioni: [] },
      ],
      sedi: [{ nome: "S1", mq: { Uffici: "100,5", t2: -4, inesistente: 9 } }],
      organico: [{ livello: "2°", quota: 85 }, { livello: "3°", quota: 15 }],
    });
    atteso("un titolo che inizia con «=» perde il segno (non diventa mai una formula)", !/^[=+@]/.test(sporco.dati.appalto.titolo), sporco.dati.appalto.titolo);
    atteso("i caratteri di controllo si tolgono dai testi", !/[\u0000-\u0008]/.test(sporco.dati.appalto.stazioneAppaltante));
    uguale("la durata si riconosce anche con la chiave scritta in modo diverso (testo «24» → 24)", sporco.dati.parametri.find((p) => p.chiave === "durata_mesi")?.valore, 24);
    uguale("un numero all'italiana («1.234,5») si legge giusto", sporco.dati.parametri.find((p) => p.chiave === "monte_ore_dichiarato")?.valore, 1234.5);
    uguale("la tolleranza scritta come 5 diventa 5%", sporco.dati.parametri.find((p) => p.chiave === "tolleranza_quadratura")?.valore, 0.05);
    uguale("i nomi delle tipologie perdono i caratteri jolly di SUMIF e restano unici", sporco.dati.tipologie.map((t) => t.nome), ["Uffici", "Uffici (2)"]);
    uguale("una resa negativa diventa dato mancante; una valida resta", sporco.dati.tipologie[0].lavorazioni.map((l) => l.resa), [null, 250]);
    uguale("una frequenza non numerica diventa dato mancante", sporco.dati.tipologie[0].lavorazioni[0].frequenza, null);
    atteso("una tipologia senza lavorazioni ne riceve una da compilare (celle gialle)", sporco.dati.tipologie[1].lavorazioni.length === 1 && sporco.dati.tipologie[1].lavorazioni[0].resa === null);
    uguale("le metrature si leggono per nome o per id, con la virgola; negativi e tipologie inesistenti si scartano", sporco.dati.sedi[0].mq, { t1: 100.5, t2: null });
    uguale("le quote scritte come 85 e 15 diventano 0,85 e 0,15 e il fatto è segnalato", [sporco.dati.organico.map((l) => l.quota), sporco.avvisi.length], [[0.85, 0.15], 1]);

    const enorme = normalizzaPianoLavoro({
      tipologie: Array.from({ length: 100 }, (_, i) => ({ nome: `T${i}`, lavorazioni: [] })),
      sedi: Array.from({ length: 1000 }, (_, i) => ({ nome: `Sede ${i}` })),
      macchinari: Array.from({ length: 500 }, () => ({ descrizione: "x" })),
    });
    atteso("i limiti di grandezza valgono (tipologie, sedi, macchinari)", enorme.dati.tipologie.length === LIMITI.tipologie && enorme.dati.sedi.length === LIMITI.sedi && enorme.dati.macchinari.length === LIMITI.macchinari);
    uguale("testoSicuro taglia con i puntini", testoSicuro("a".repeat(300), 10), "aaaaaaaaa…");
  }

  // ═════ 2. calcoli contro il piano fatto a mano (Milanosport) ═════
  const milano = normalizzaPianoLavoro(fixture.dati);
  const datiMilano = milano.dati;
  const rMilano = calcolaPianoLavoro(datiMilano);
  {
    uguale("Milanosport: 12 tipologie, 28 sedi, 15 macchinari, 4 livelli del personale uscente", [datiMilano.tipologie.length, datiMilano.sedi.length, datiMilano.macchinari.length, datiMilano.personaleUscente.length], [12, 28, 15, 4]);
    const e = fixture.attesi;
    const oreCalc = rMilano.sedi.map((s) => s.oreCalcolate);
    const peggioreCalc = Math.max(...oreCalc.map((x, i) => Math.abs(x - e.oreCalcolate[i])));
    atteso("Milanosport: le ore calcolate dalle metrature di tutte le 28 sedi coincidono col piano fatto a mano", peggioreCalc < 1e-6, `scarto massimo ${peggioreCalc}`);
    const peggioreMq = Math.max(...rMilano.sedi.map((s, i) => Math.abs(s.mqTotali - e.mqTotali[i])));
    atteso("Milanosport: i mq totali di ogni sede coincidono", peggioreMq < 1e-6, `scarto massimo ${peggioreMq}`);
    const peggioreAdottate = Math.max(...rMilano.sedi.map((s, i) => Math.abs(s.oreAdottate - e.oreAdottate[i])));
    atteso("Milanosport: le ore adottate (dichiarate, altrimenti ripartite per peso del canone) coincidono per tutte le sedi", peggioreAdottate < 1e-6, `scarto massimo ${peggioreAdottate}`);
    atteso("Milanosport: totale ore calcolate e totale ore adottate coincidono", vicino(rMilano.totaliSedi.oreCalcolate, e.totaleOreCalcolate, 1e-9) && vicino(rMilano.oreSedi, e.totaleOreAdottate, 1e-9));
    atteso("Milanosport: totale macchinari 81.505 €", vicino(rMilano.totaleMacchinari, e.totaleMacchinari));
    uguale("Milanosport: personale da riassorbire (58 unità, 1.606,5 ore settimanali)", [rMilano.clausola.unita, rMilano.clausola.oreSettimanali], [e.unitaUscenti, e.oreSettimanaliUscenti]);
    atteso("Milanosport: l'impianto a misura (Allianz) non porta ore a canone", rMilano.sedi[0].oreAdottate === 0);
    const mancanti = elencoDatiMancanti(datiMilano).join(" | ");
    atteso("Milanosport: le sedi senza metrature sono segnalate (4, non l'impianto a misura)", /Metrature non trovate per 4 sedi/.test(mancanti) && !/Allianz/.test(mancanti), mancanti);
    atteso("Milanosport: lo scostamento rispetto al monte ore dichiarato è calcolato (non «n.d.»)", typeof rMilano.scostamentoPct === "number");
  }

  // ═════ 3. piano sintetico: calcoli a mano ═════
  const sint = normalizzaPianoLavoro(sintetico).dati;
  const rSint = calcolaPianoLavoro(sint);
  {
    uguale("sintetico: presìdi = 2×8×365 + 2×5×390 + 3×55×52 = 18.320 ore", rSint.orePresidi, 5840 + 3900 + 8580);
    uguale("sintetico: i presìdi si raggruppano per gruppo consecutivo", rSint.subtotaliGruppo, [{ gruppo: "Teatro (ordinario)", ore: 9740 }, { gruppo: "Laboratori", ore: 8580 }]);
    // coefficienti: aree 365/100 + 12/150 = 3,73; uffici 365/220; magazzini 104/500
    atteso("sintetico: coefficienti per tipologia (3,73 / 1,659090… / 0,208)", vicino(rSint.coefficientiTipologia[0], 3.73) && vicino(rSint.coefficientiTipologia[1], 365 / 220) && vicino(rSint.coefficientiTipologia[2], 0.208));
    // Teatro: ore dichiarate assenti, canone assente → ore calcolate; il monte dichiarato c'è ma senza canoni non si ripartisce
    atteso("sintetico: senza canoni, le ore adottate sono quelle calcolate dalle metrature", vicino(rSint.sedi[0].oreAdottate, 27000 * 3.73 + 3800 * (365 / 220)) && vicino(rSint.sedi[1].oreAdottate, 15000 * 0.208));
    uguale("sintetico: una sede senza metrature non produce ore (e resta da compilare)", rSint.sedi[2].oreAdottate, 0);
    uguale("sintetico: la sede extra canone non produce ore a canone", rSint.sedi[3].oreAdottate, 0);
    atteso("sintetico: FTE = monte ore ÷ 1.600", vicino(rSint.fte, rSint.oreTotali / 1600));
    atteso("sintetico: quote 80/15/5 → controllo OK", /^OK/.test(rSint.controlloQuote));
    atteso("sintetico: macchinari — importo 6×3200 + 5×1800 + 40×280 = 39.400; quota durata con vita utile", vicino(rSint.totaleMacchinari, 39400) && vicino(rSint.macchinari[0].quotaDurata, 19200 * (48 / 72)) && vicino(rSint.macchinari[1].quotaDurata, 9000) && vicino(rSint.macchinari[2].quotaDurata, 11200));
    uguale("sintetico: differenza dal budget dei macchinari", rSint.differenzaBudget, 39400 - 50000);
    const mancanti = elencoDatiMancanti(sint).join(" | ");
    atteso("sintetico: segnala la sede senza metrature e il prezzo mancante", /1 sede \(Sede senza metrature\)/.test(mancanti) && /1 macchinario/.test(mancanti), mancanti);
  }

  // ═════ 4. l'Excel: struttura, avvertenze, formule ricalcolate da un motore indipendente ═════
  const quando = new Date("2026-10-30T10:00:00Z");
  const exMilano = await costruisciExcelPianoLavoro(datiMilano, { generatoIl: quando });
  const exSint = await costruisciExcelPianoLavoro(sint, { generatoIl: quando });
  const exVuoto = await costruisciExcelPianoLavoro(normalizzaPianoLavoro({}).dati, { generatoIl: quando });
  for (const [nome, ex] of [["Milanosport", exMilano], ["sintetico", exSint], ["vuoto", exVuoto]] as const) {
    const wb = await caricaCartella(ex.buffer);
    const confronto = ricalcola(wb);
    atteso(`${nome}: nessuna formula dà errore nel motore indipendente`, confronto.errori.length === 0, confronto.errori.slice(0, 5).join(" | "));
    atteso(`${nome}: tutte le ${confronto.controllate} formule ricalcolate coincidono col valore in cache`, confronto.differenze.length === 0 && confronto.controllate > 40, confronto.differenze.slice(0, 6).join(" | "));
    let esterni = 0;
    let errori = 0;
    for (const ws of wb.worksheets) {
      ws.eachRow((riga) =>
        riga.eachCell((c) => {
          const v = c.value as { formula?: string; result?: unknown } | null;
          if (v && typeof v === "object" && "formula" in v) {
            if (/\[\d+\]/.test(v.formula ?? "")) esterni++;
            if (/#REF!|#NAME\?|#DIV\/0!|#VALUE!/.test(`${v.formula} ${String(v.result)}`)) errori++;
          }
        }),
      );
    }
    atteso(`${nome}: nessun collegamento a file esterni né errore nelle formule`, esterni === 0 && errori === 0, `esterni ${esterni}, errori ${errori}`);
    atteso(`${nome}: nomi dei fogli validi (≤ 31 caratteri, senza caratteri vietati)`, wb.worksheets.every((w) => w.name.length <= 31 && !/[\\/?*[\]:]/.test(w.name)));
  }

  {
    const wb = await caricaCartella(exMilano.buffer);
    uguale("Milanosport: fogli nell'ordine previsto, con la clausola sociale", wb.worksheets.map((w) => w.name), [FOGLI.copertina, FOGLI.parametri, FOGLI.rese, FOGLI.sedi, FOGLI.calcolo, FOGLI.presidi, FOGLI.riepilogo, FOGLI.organico, FOGLI.clausola, FOGLI.macchinari]);
    const wbS = await caricaCartella(exSint.buffer);
    atteso("sintetico (senza personale uscente): il foglio della clausola sociale non c'è", !wbS.getWorksheet(FOGLI.clausola));

    const testoFoglio = (nome: string) => {
      const ws = wb.getWorksheet(nome)!;
      const t: string[] = [];
      ws.eachRow((riga) => riga.eachCell((c) => typeof c.value === "string" && t.push(c.value)));
      return t.join("\n");
    };
    atteso("l'avvertenza «prezzi standard da sostituire con quelli dei propri fornitori» è nel foglio Macchinari", testoFoglio(FOGLI.macchinari).includes(TESTO_AVVISO_PREZZI) && /propri fornitori/.test(TESTO_AVVISO_PREZZI) && /IPC e FIMAP/.test(TESTO_AVVISO_PREZZI));
    atteso("l'avvertenza compare anche nella copertina, insieme alle altre avvertenze fisse", AVVERTENZE_FISSE.every((a) => testoFoglio(FOGLI.copertina).includes(a)));
    atteso("la copertina elenca i dati mancanti (sedi senza metrature)", /Metrature non trovate per 4 sedi/.test(testoFoglio(FOGLI.copertina)));

    // le metrature mancanti sono celle gialle e vuote, quelle presenti no
    const sedi = wb.getWorksheet(FOGLI.sedi)!;
    const rigaCarella = 6 + datiMilano.sedi.findIndex((s) => s.nome.startsWith("Piscina Carella"));
    const cellaVuota = sedi.getCell(rigaCarella, 3);
    const cellaPiena = sedi.getCell(6 + 1, 3);
    const riempimento = (c: ExcelJS.Cell) => (c.fill as ExcelJS.FillPattern | undefined)?.fgColor?.argb;
    atteso("metrature mancanti: cella vuota con sfondo giallo", cellaVuota.value === null && riempimento(cellaVuota) === "FFFFFF66");
    atteso("metrature presenti: valore numerico senza sfondo", typeof cellaPiena.value === "number" && riempimento(cellaPiena) === undefined);

    // il menu SI/NO per «a canone» e il totale del riepilogo
    const calcolo = wb.getWorksheet(FOGLI.calcolo)!;
    atteso("«A canone?» ha il menu a tendina SI/NO", calcolo.getCell(5, 4).dataValidation?.type === "list");
    const riep = wb.getWorksheet(FOGLI.riepilogo)!;
    const risultatoRiep = (riep.getCell(7, 2).value as { result: number }).result;
    atteso("il riepilogo riporta il monte ore totale calcolato", vicino(risultatoRiep, rMilano.oreTotali));

    // il file dichiara il ricalcolo completo all'apertura, ed è leggibile anche da un altro lettore (SheetJS)
    const zip = await JSZip.loadAsync(exMilano.buffer);
    const xmlCartella = await zip.file("xl/workbook.xml")!.async("string");
    atteso("il file chiede il ricalcolo completo all'apertura", /fullCalcOnLoad="1"/.test(xmlCartella));
    const sheetjs = XLSX.read(exMilano.buffer, { type: "buffer", cellFormula: true });
    uguale("un lettore diverso (SheetJS) trova gli stessi fogli", sheetjs.SheetNames, wb.worksheets.map((w) => w.name));
    atteso("lo stesso lettore vede le formule", String(sheetjs.Sheets[FOGLI.riepilogo]["B7"]?.f ?? "") === "B5+B6");
  }

  // ═════ 5. le formule sono ATTIVE: cambio un input nel file, ricalcolo, e i totali seguono ═════
  {
    const wb = await caricaCartella(exSint.buffer);
    const base = ricalcola(wb);
    const totale = (ric: ReturnType<typeof ricalcola>) => ric.valore(FOGLI.riepilogo, 7, 2) as number;
    atteso("sintetico: il totale del riepilogo ricalcolato dal motore coincide coi calcoli", vicino(totale(base), rSint.oreTotali));

    // 1) resa delle aree monumentali (Rese_Frequenze!C5) da 100 a 200: le ore della prima lavorazione si dimezzano
    const datiB = structuredClone(sint);
    datiB.tipologie[0].lavorazioni[0].resa = 200;
    const sovr = new Map<string, number | string | null>([[`${FOGLI.rese}!5,3`, 200]]);
    const dopoResa = ricalcola(wb, sovr);
    atteso("cambiando una resa nel file il monte ore ricalcolato segue i calcoli", vicino(totale(dopoResa), calcolaPianoLavoro(datiB).oreTotali), `${totale(dopoResa)} contro ${calcolaPianoLavoro(datiB).oreTotali}`);
    atteso("…e cambia davvero (le formule non sono valori fissi)", !vicino(totale(dopoResa), totale(base)));

    // 2) giorni all'anno da 365 a 300: cambiano frequenze e presìdi collegati al parametro
    const datiC = structuredClone(sint);
    datiC.parametri.find((p) => p.chiave === "giorni_anno")!.valore = 300;
    const rigaGiorni = 5 + datiC.parametri.findIndex((p) => p.chiave === "giorni_anno");
    const dopoGiorni = ricalcola(wb, new Map([[`${FOGLI.parametri}!${rigaGiorni},2`, 300]]));
    atteso("cambiando il parametro «giorni all'anno» si aggiornano rese e presìdi collegati", vicino(totale(dopoGiorni), calcolaPianoLavoro(datiC).oreTotali));

    // 3) monte ore dichiarato tolto: lo scostamento diventa «n.d.»
    const rigaMonte = 5 + sint.parametri.findIndex((p) => p.chiave === PARAMETRI_STANDARD.monteOreDichiarato);
    const senzaMonte = ricalcola(wb, new Map([[`${FOGLI.parametri}!${rigaMonte},2`, null]]));
    uguale("senza monte ore dichiarato l'esito dice che non è dichiarato", senzaMonte.valore(FOGLI.riepilogo, 11, 2), "Monte ore non dichiarato dal bando");
    uguale("…e lo scostamento è «n.d.»", senzaMonte.valore(FOGLI.riepilogo, 10, 2), "n.d.");

    // 4) una sede messa «NO» a canone esce dal monte ore
    const dopoNo = ricalcola(wb, new Map([[`${FOGLI.calcolo}!6,4`, "NO"]]));
    atteso("mettendo NO a «a canone» la sede esce dal monte ore", vicino(totale(dopoNo), totale(base) - rSint.sedi[1].oreAdottate));

    // 5) metratura inserita in una sede che non l'aveva: le ore calcolate crescono
    const dopoMq = ricalcola(wb, new Map([[`${FOGLI.sedi}!8,3`, 1000]]));
    atteso("inserendo i mq mancanti di una sede, le ore della sede crescono", totale(dopoMq) > totale(base) + 3000, `${totale(dopoMq)} vs ${totale(base)}`);

    // 6a) una lavorazione «coperta dai presìdi» non aggiunge ore; rimessa a NO nel file le aggiunge
    atteso("una lavorazione coperta dai presìdi ha coefficiente 0 e la cella ha il menu SI/NO", rSint.coefficientiLavorazione[1][1] === 0 && wb.getWorksheet(FOGLI.rese)!.getCell(8, 5).dataValidation?.type === "list" && wb.getWorksheet(FOGLI.rese)!.getCell(8, 5).value === "SI");
    const datiD = structuredClone(sint);
    datiD.tipologie[1].lavorazioni[1].esclusaDaMq = false;
    const dopoCopertura = ricalcola(wb, new Map<string, number | string | null>([[`${FOGLI.rese}!8,5`, "NO"]]));
    atteso("rimettendo NO a «coperta dai presìdi» le ore delle metrature crescono, come nei calcoli", totale(dopoCopertura) > totale(base) + 1000 && vicino(totale(dopoCopertura), calcolaPianoLavoro(datiD).oreTotali), `${totale(dopoCopertura)} vs ${calcolaPianoLavoro(datiD).oreTotali}`);

    // 6) un macchinario nelle righe libere entra nel totale
    const wbMac = wb.getWorksheet(FOGLI.macchinari)!;
    let rigaLibera = 0;
    wbMac.eachRow((riga, nr) => {
      const prima = riga.getCell(1).value;
      if (typeof prima === "string" && /^ALTRE DOTAZIONI/.test(prima)) rigaLibera = nr + 1;
    });
    const dopoMac = ricalcola(wb, new Map<string, number | string | null>([[`${FOGLI.macchinari}!${rigaLibera},4`, 2], [`${FOGLI.macchinari}!${rigaLibera},5`, 1000]]));
    atteso("un macchinario aggiunto nelle righe libere entra nel totale del riepilogo", vicino(dopoMac.valore(FOGLI.riepilogo, 21, 2) as number, rSint.totaleMacchinari + 2000));
  }

  console.log("");
  if (fallimenti.length > 0) {
    console.error(`${fallimenti.length} controlli falliti:\n - ${fallimenti.join("\n - ")}`);
    process.exit(1);
  }
  console.log("Tutti i controlli sono andati a buon fine.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

