import ExcelJS from "exceljs";
import { PARAMETRI_STANDARD, proteggiPianoDaAltreGare, type Origine, type OrigineMacchinario, type PianoLavoroDati, type Quantita } from "@/lib/piano-lavoro-dati";
import { NO, SI, calcolaPianoLavoro, elencoAnomalie, elencoDatiMancanti, valoreQuantita, type RisultatoPianoLavoro } from "@/lib/piano-lavoro-calcoli";

// Piano di lavoro: costruzione dell'Excel con formule attive. Ogni cella calcolata è una formula (che il cliente
// può cambiare) con il suo valore in cache, preso da piano-lavoro-calcoli.ts: Excel ricalcola comunque tutto
// all'apertura, ma le anteprime che non ricalcolano (Drive, telefono) mostrano così i numeri giusti.
// Le formule le scrive SOLO questo file, da fogli fissi: il modello di linguaggio non le vede mai.

export const FOGLI = {
  copertina: "Copertina",
  parametri: "Parametri",
  rese: "Rese_Frequenze",
  sedi: "Sedi_Superfici",
  calcolo: "Calcolo_Ore",
  presidi: "Presidi",
  riepilogo: "Riepilogo",
  organico: "Organico",
  clausola: "Clausola_Sociale",
  macchinari: "Macchinari",
} as const;

export const TESTO_AVVISO_PREZZI =
  "PREZZI STANDARD: i prezzi di macchinari e attrezzature sono prezzi standard di mercato (riferimento IPC e FIMAP o ricerca di mercato). Vanno sostituiti con i prezzi dei propri fornitori.";

// «Come leggere il file» nella copertina: il significato dei colori (i colori veri li mette il disegno del foglio).
export const LEGENDA_FILE: { nome: string; spiegazione: string }[] = [
  { nome: "Testo blu", spiegazione: "Dato letto dai documenti di gara, modificabile" },
  { nome: "Testo blu su azzurro", spiegazione: "Ipotesi di OMNIA AI (o prezzo standard): da validare" },
  { nome: "Cella gialla", spiegazione: "Dato mancante nei documenti: da inserire" },
  { nome: "Testo nero", spiegazione: "Formula: si aggiorna da sola, non va modificata" },
];

export const AVVERTENZE_FISSE = [
  "Questo file è un dimensionamento di partenza, costruito dai documenti di gara caricati: non è un preventivo e non sostituisce la valutazione del concorrente, che resta responsabile dei dati e delle scelte della propria offerta.",
  "Rese e frequenze: i valori con sfondo azzurro sono ipotesi di prassi di settore, da validare in sede di sopralluogo e di definizione dell'offerta.",
  TESTO_AVVISO_PREZZI,
  "Le formule sono attive: modificando i valori in blu o le celle gialle, tutti i fogli si aggiornano.",
];

const COLORI = {
  navy: "FF1F3864",
  sezione: "FFD9E1F2",
  azzurro: "FFDDEBF7",
  giallo: "FFFFFF66",
  arancio: "FFFCE4D6",
  totale: "FFF2F2F2",
  grigio: "FFBFBFBF",
  blu: "FF0000FF",
  bianco: "FFFFFFFF",
  nero: "FF000000",
} as const;

const FONT = "Calibri";
const FMT = {
  ore: "#,##0.00",
  intero: "#,##0",
  mq: "#,##0.0",
  euro: "#,##0.00",
  pct: "0.0%",
  coeff: "0.0000",
  fte: "#,##0.00",
} as const;

type Valore = number | string;

function lettera(n: number): string {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
const ref = (riga: number, col: number) => `${lettera(col)}${riga}`;
const assoluto = (riga: number, col: number) => `$${lettera(col)}$${riga}`;

const bordo: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: COLORI.grigio } },
  left: { style: "thin", color: { argb: COLORI.grigio } },
  bottom: { style: "thin", color: { argb: COLORI.grigio } },
  right: { style: "thin", color: { argb: COLORI.grigio } },
};

function riempi(argb: string): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

class Foglio {
  constructor(readonly ws: ExcelJS.Worksheet) {}

  private cella(riga: number, col: number) {
    return this.ws.getCell(riga, col);
  }

  // testo semplice (etichette, note)
  testo(riga: number, col: number, valore: string, opz: { grassetto?: boolean; corsivo?: boolean; sfondo?: string; colore?: string; wrap?: boolean; dimensione?: number; bordi?: boolean; centrato?: boolean } = {}) {
    const c = this.cella(riga, col);
    c.value = valore;
    c.font = { name: FONT, size: opz.dimensione ?? 10, bold: opz.grassetto, italic: opz.corsivo, color: { argb: opz.colore ?? COLORI.nero } };
    if (opz.sfondo) c.fill = riempi(opz.sfondo);
    if (opz.bordi) c.border = bordo;
    c.alignment = { vertical: "top", wrapText: opz.wrap ?? false, horizontal: opz.centrato ? "center" : undefined };
    return c;
  }

  testata(riga: number, col: number, valore: string) {
    const c = this.cella(riga, col);
    c.value = valore;
    c.font = { name: FONT, size: 10, bold: true, color: { argb: COLORI.bianco } };
    c.fill = riempi(COLORI.navy);
    c.border = bordo;
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    return c;
  }

  // valore inserito (modificabile): blu; con sfondo azzurro se è un'ipotesi, giallo (e vuoto) se manca
  input(riga: number, col: number, valore: Valore | null, origine: Origine, formato?: string, opz: { facoltativo?: boolean } = {}) {
    const c = this.cella(riga, col);
    if (valore === null) {
      c.value = null;
      if (!opz.facoltativo) c.fill = riempi(COLORI.giallo);
    } else {
      c.value = valore;
      if (origine === "ipotesi") c.fill = riempi(COLORI.azzurro);
      else if (origine === "mancante") c.fill = riempi(COLORI.giallo);
    }
    c.font = { name: FONT, size: 10, color: { argb: COLORI.blu } };
    c.border = bordo;
    c.alignment = { vertical: "top", horizontal: typeof valore === "string" ? "center" : undefined };
    if (formato) c.numFmt = formato;
    return c;
  }

  formula(riga: number, col: number, f: string, risultato: Valore, formato?: string, opz: { grassetto?: boolean; sfondo?: string; wrap?: boolean; centrato?: boolean } = {}) {
    const c = this.cella(riga, col);
    c.value = { formula: f, result: typeof risultato === "number" && !Number.isFinite(risultato) ? 0 : risultato };
    c.font = { name: FONT, size: 10, bold: opz.grassetto, color: { argb: COLORI.nero } };
    if (opz.sfondo) c.fill = riempi(opz.sfondo);
    c.border = bordo;
    c.alignment = { vertical: "top", wrapText: opz.wrap ?? false, horizontal: opz.centrato || typeof risultato === "string" ? "center" : undefined };
    if (formato) c.numFmt = formato;
    return c;
  }

  nota(riga: number, col: number, valore: string) {
    return this.testo(riga, col, valore, { wrap: true, bordi: true, dimensione: 9, colore: "FF595959" });
  }

  titolo(testo: string, sottotitolo?: string, colonne = 6) {
    const t = this.testo(1, 1, testo, { grassetto: true, dimensione: 14, colore: COLORI.navy });
    t.alignment = { vertical: "middle" };
    this.ws.getRow(1).height = 24;
    if (sottotitolo) this.testoLungo(2, 1, colonne, sottotitolo, { corsivo: true, dimensione: 9, colore: "FF595959" });
  }

  // testo lungo su più colonne unite, con altezza stimata
  testoLungo(riga: number, daCol: number, aCol: number, valore: string, opz: { grassetto?: boolean; corsivo?: boolean; sfondo?: string; colore?: string; dimensione?: number; caratteriPerRiga?: number } = {}) {
    this.ws.mergeCells(riga, daCol, riga, aCol);
    const c = this.testo(riga, daCol, valore, { ...opz, wrap: true });
    const caratteri = opz.caratteriPerRiga ?? Math.max(40, (aCol - daCol + 1) * 14);
    const righe = Math.max(1, Math.ceil(valore.length / caratteri));
    this.ws.getRow(riga).height = Math.max(15, righe * 13.5);
    return c;
  }

  larghezze(...w: number[]) {
    w.forEach((x, i) => (this.ws.getColumn(i + 1).width = x));
  }

  totale(riga: number, daCol: number, aCol: number) {
    for (let col = daCol; col <= aCol; col++) {
      const c = this.cella(riga, col);
      c.fill = riempi(COLORI.totale);
      c.font = { name: FONT, size: 10, bold: true, color: { argb: c.font?.color?.argb ?? COLORI.nero } };
      c.border = { ...bordo, top: { style: "medium", color: { argb: COLORI.navy } } };
    }
  }

  congela(colonne: number, righe: number) {
    this.ws.views = [{ state: "frozen", xSplit: colonne, ySplit: righe }];
  }
}

function impostaPagina(ws: ExcelJS.Worksheet) {
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
}

function etichettaOrigineMacchinario(o: OrigineMacchinario, fonte: string): string {
  const base = o === "catalogo" ? "Catalogo di riferimento" : o === "ricerca_web" ? "Ricerca di mercato" : "Stima";
  return fonte ? `${base} — ${fonte}` : base;
}

export type EsitoExcelPianoLavoro = { buffer: Buffer; risultato: RisultatoPianoLavoro };

export async function costruisciExcelPianoLavoro(datiIn: PianoLavoroDati, opzioni: { generatoIl: Date }): Promise<EsitoExcelPianoLavoro> {
  // Il piano di un cliente non parla MAI di un'altra gara, nemmeno nelle note: ultimo controllo prima di scrivere il file (vedi piano-lavoro-riservatezza.ts).
  // I dati normalizzati l'hanno già passato; qui si ripete perché vale per ogni via d'ingresso (dati riletti dal database, prove, strumenti).
  const dati = proteggiPianoDaAltreGare(datiIn);
  const r = calcolaPianoLavoro(dati);
  const wb = new ExcelJS.Workbook();
  wb.creator = "OMNIA AI";
  wb.created = opzioni.generatoIl;
  wb.title = `Piano di lavoro — ${dati.appalto.titolo}`.slice(0, 250);
  // Excel ricalcola tutto all'apertura: i valori in cache servono solo alle anteprime
  wb.calcProperties.fullCalcOnLoad = true;

  // l'ordine delle schede è quello di creazione
  const wsCopertina = wb.addWorksheet(FOGLI.copertina, { properties: { tabColor: { argb: COLORI.navy } } });
  const wsParametri = wb.addWorksheet(FOGLI.parametri);
  const wsRese = wb.addWorksheet(FOGLI.rese);
  const wsSedi = wb.addWorksheet(FOGLI.sedi);
  const wsCalcolo = wb.addWorksheet(FOGLI.calcolo);
  const wsPresidi = wb.addWorksheet(FOGLI.presidi);
  const wsRiepilogo = wb.addWorksheet(FOGLI.riepilogo, { properties: { tabColor: { argb: "FF2E7D32" } } });
  const wsOrganico = wb.addWorksheet(FOGLI.organico);
  const wsClausola = dati.personaleUscente.length > 0 ? wb.addWorksheet(FOGLI.clausola) : null;
  const wsMacchinari = wb.addWorksheet(FOGLI.macchinari);
  for (const ws of wb.worksheets) impostaPagina(ws);

  // ───────────── Parametri ─────────────
  const fP = new Foglio(wsParametri);
  fP.larghezze(58, 16, 12, 70);
  fP.titolo("Parametri generali di calcolo", "Celle blu = valori modificabili; sfondo azzurro = ipotesi da validare; sfondo giallo = dato mancante da inserire.", 4);
  ["Parametro", "Valore", "U.M.", "Fonte / note"].forEach((t, i) => fP.testata(4, i + 1, t));
  const rigaParametro: Record<string, number> = {};
  const indirizzoParametro = (chiave: string) => `${FOGLI.parametri}!${assoluto(rigaParametro[chiave], 2)}`;
  dati.parametri.forEach((p, i) => {
    const riga = 5 + i;
    rigaParametro[p.chiave] = riga;
    fP.testo(riga, 1, p.etichetta, { bordi: true, wrap: true });
    const facoltativo = p.chiave === PARAMETRI_STANDARD.monteOreDichiarato;
    const formato = p.unita === "%" ? FMT.pct : p.unita === "ore/anno" || p.unita === "ore" ? FMT.ore : "General";
    fP.input(riga, 2, p.valore, p.origine, formato, { facoltativo });
    fP.testo(riga, 3, p.unita, { bordi: true, centrato: true });
    fP.nota(riga, 4, p.fonte);
  });
  fP.congela(0, 4);

  // un valore fisso (input) o il rimando a un parametro (formula)
  const scriviQuantita = (f: Foglio, riga: number, col: number, q: Quantita | null, origine: Origine, formato: string) => {
    if (q === null) return f.input(riga, col, null, "mancante", formato);
    if (typeof q === "number") return f.input(riga, col, q, origine, formato);
    return f.formula(riga, col, indirizzoParametro(q.param), valoreQuantita(q, dati), formato);
  };

  // ───────────── Rese e frequenze ─────────────
  const fR = new Foglio(wsRese);
  fR.larghezze(38, 46, 14, 20, 18, 20, 60);
  fR.titolo(
    "Rese di produttività e frequenze",
    "AREA DI INPUT: i valori con sfondo azzurro sono ipotesi di prassi di settore (non fissati dal capitolato), da validare in sede di sopralluogo e di definizione dell'offerta; quelli senza sfondo sono letti dai documenti di gara; in giallo, ciò che manca. «Esclusa dal calcolo da mq» = SI: la lavorazione non si calcola dalle metrature perché è svolta dagli addetti dei presìdi fissi (le ore sono già nel foglio Presidi) oppure riguarda solo parti limitate dell'area e va stimata a forfait (righe libere del foglio Presidi).",
    7,
  );
  wsRese.getRow(2).height = 40;
  ["Tipologia di ambiente", "Attività", "Resa\n(mq/h)", "Frequenza\n(interventi/anno)", "Esclusa dal calcolo\nda mq? (SI/NO)", "Coefficiente\n(ore per unità/anno)", "Fonte / note"].forEach((t, i) => fR.testata(4, i + 1, t));
  wsRese.getRow(4).height = 32;
  let riga = 5;
  dati.tipologie.forEach((t, ti) => {
    t.lavorazioni.forEach((l, li) => {
      fR.testo(riga, 1, t.nome, { bordi: true, wrap: true });
      fR.testo(riga, 2, l.nome, { bordi: true, wrap: true });
      fR.input(riga, 3, l.resa, l.origineResa, "General");
      scriviQuantita(fR, riga, 4, l.frequenza, l.origineFrequenza, "General");
      fR.input(riga, 5, l.esclusaDaMq ? SI : NO, "documento", undefined).dataValidation = { type: "list", allowBlank: false, formulae: [`"${SI},${NO}"`] };
      fR.formula(riga, 6, `IF(${ref(riga, 5)}="${SI}",0,IFERROR(${ref(riga, 4)}/${ref(riga, 3)},0))`, r.coefficientiLavorazione[ti][li], FMT.coeff);
      const motivo = l.motivoEsclusione === "presidio" ? "Esclusa: svolta dai presìdi fissi (ore nel foglio Presidi)" : l.motivoEsclusione === "parte_limitata" ? "Esclusa: riguarda solo parti limitate dell'area, da stimare a forfait" : "";
      fR.nota(riga, 7, [l.notaFrequenza, motivo, l.fonte].filter(Boolean).join(" — "));
      riga++;
    });
  });
  const ultimaRese = riga - 1;
  riga += 2;
  fR.testo(riga, 1, "COEFFICIENTE TOTALE PER TIPOLOGIA (ore per unità/anno) — usato nel foglio Sedi_Superfici", { grassetto: true, colore: COLORI.navy });
  riga++;
  ["Tipologia di ambiente", "Coefficiente totale", "Unità"].forEach((t, i) => fR.testata(riga, i + 1, t));
  riga++;
  const rigaCoefficiente: number[] = [];
  dati.tipologie.forEach((t, ti) => {
    rigaCoefficiente.push(riga);
    fR.testo(riga, 1, t.nome, { bordi: true, wrap: true });
    fR.formula(riga, 2, `SUMIF($A$5:$A$${ultimaRese},${ref(riga, 1)},$F$5:$F$${ultimaRese})`, r.coefficientiTipologia[ti], FMT.coeff);
    fR.testo(riga, 3, t.unita, { bordi: true, centrato: true });
    riga++;
  });
  fR.congela(0, 4);

  // ───────────── Sedi e superfici ─────────────
  const T = dati.tipologie.length;
  const colPrimaTip = 3;
  const colUltimaTip = colPrimaTip + T - 1;
  const colTotMq = colUltimaTip + 1;
  const colIndirizzo = colTotMq + 1;
  const SPARE = 3;
  const nSedi = dati.sedi.length;
  const primaRigaSede = 6;
  const ultimaRigaSede = primaRigaSede + nSedi + SPARE - 1;
  const rigaTotaleSedi = ultimaRigaSede + 1;

  const fS = new Foglio(wsSedi);
  fS.larghezze(6, 42, ...dati.tipologie.map(() => 13), 14, 44);
  fS.titolo(
    "Sedi e superfici per tipologia di ambiente",
    "AREA DI INPUT: metrature (mq) di ogni sede per tipologia di ambiente. Sfondo giallo = dato non trovato nei documenti di gara: da inserire (finché manca, la sede non produce ore calcolate). Righe libere in fondo per aggiungere sedi.",
    colIndirizzo,
  );
  fS.testata(4, 1, "N.");
  fS.testata(4, 2, "Sede");
  dati.tipologie.forEach((t, i) => fS.testata(4, colPrimaTip + i, `${t.nome}\n(${t.unita})`));
  fS.testata(4, colTotMq, "Totale\nunità");
  fS.testata(4, colIndirizzo, "Indirizzo / fonte");
  wsSedi.getRow(4).height = 58;
  fS.testo(5, 2, "Coefficiente (ore per unità/anno)", { grassetto: true, bordi: true, sfondo: COLORI.sezione });
  fS.testo(5, 1, "", { bordi: true, sfondo: COLORI.sezione });
  dati.tipologie.forEach((t, i) => {
    fS.formula(5, colPrimaTip + i, `${FOGLI.rese}!${assoluto(rigaCoefficiente[i], 2)}`, r.coefficientiTipologia[i], FMT.coeff, { grassetto: true, sfondo: COLORI.sezione });
  });
  fS.testo(5, colTotMq, "", { bordi: true, sfondo: COLORI.sezione });
  fS.testo(5, colIndirizzo, "", { bordi: true, sfondo: COLORI.sezione });
  for (let i = 0; i < nSedi + SPARE; i++) {
    const rr = primaRigaSede + i;
    const s = dati.sedi[i];
    fS.testo(rr, 1, String(i + 1), { bordi: true, centrato: true });
    fS.input(rr, 2, s ? s.nome : null, "documento", undefined, { facoltativo: true }).alignment = { vertical: "top", wrapText: true };
    dati.tipologie.forEach((t, ti) => {
      const v = s ? s.mq[t.id] ?? null : null;
      fS.input(rr, colPrimaTip + ti, v, s ? s.origineMq : "documento", FMT.mq, { facoltativo: !s });
    });
    fS.formula(rr, colTotMq, `SUM(${ref(rr, colPrimaTip)}:${ref(rr, colUltimaTip)})`, s ? r.sedi[i].mqTotali : 0, FMT.mq);
    fS.nota(rr, colIndirizzo, s ? [s.indirizzo, s.fonte].filter(Boolean).join(" — ") : "");
  }
  fS.testo(rigaTotaleSedi, 2, "TOTALE", { grassetto: true, bordi: true });
  dati.tipologie.forEach((t, ti) => {
    const col = colPrimaTip + ti;
    const tot = dati.sedi.reduce((acc, s) => acc + (s.mq[t.id] ?? 0), 0);
    fS.formula(rigaTotaleSedi, col, `SUM(${ref(primaRigaSede, col)}:${ref(ultimaRigaSede, col)})`, tot, FMT.mq);
  });
  fS.formula(rigaTotaleSedi, colTotMq, `SUM(${ref(primaRigaSede, colTotMq)}:${ref(ultimaRigaSede, colTotMq)})`, r.totaliSedi.mq, FMT.mq);
  fS.totale(rigaTotaleSedi, 1, colIndirizzo);
  fS.congela(2, 5);

  // ───────────── Calcolo ore per sede ─────────────
  const fC = new Foglio(wsCalcolo);
  fC.larghezze(6, 42, 14, 12, 16, 16, 16, 16, 16, 14, 44);
  fC.titolo(
    "Monte ore per sede",
    "Ore calcolate = SUMPRODUCT(metrature per tipologia; coefficienti ore/unità/anno). Ore adottate: prima le ore dichiarate dalla stazione appaltante per la sede; altrimenti la ripartizione del monte ore dichiarato dal bando in proporzione al canone; altrimenti le ore calcolate dalle metrature. «A canone» = NO esclude la sede (pulizie a misura / extra canone).",
    11,
  );
  ["N.", "Sede", "Totale\nunità", "A canone?\n(SI/NO)", "Canone\n(€)", "Ore calcolate\n(da metrature)", "Ore dichiarate\ndalla S.A.", "Ore allocate\n(peso canone)", "Ore adottate", "Scostamento\ncalcolate/adottate", "Note"].forEach((t, i) => fC.testata(4, i + 1, t));
  wsCalcolo.getRow(4).height = 45;
  const primaRigaCalcolo = 5;
  const ultimaRigaCalcolo = primaRigaCalcolo + nSedi + SPARE - 1;
  const rigaTotaleCalcolo = ultimaRigaCalcolo + 1;
  const intervalloD = `$D$${primaRigaCalcolo}:$D$${ultimaRigaCalcolo}`;
  const intervalloE = `$E$${primaRigaCalcolo}:$E$${ultimaRigaCalcolo}`;
  const sommaCanoniFormula = `SUMIF(${intervalloD},"${SI}",${intervalloE})`;
  const monteRef = indirizzoParametro(PARAMETRI_STANDARD.monteOreDichiarato);
  for (let i = 0; i < nSedi + SPARE; i++) {
    const rr = primaRigaCalcolo + i;
    const rs = primaRigaSede + i;
    const s = dati.sedi[i];
    const rs_ = s ? r.sedi[i] : null;
    fC.testo(rr, 1, String(i + 1), { bordi: true, centrato: true });
    fC.formula(rr, 2, `IF(${FOGLI.sedi}!${ref(rs, 2)}="","",${FOGLI.sedi}!${ref(rs, 2)})`, s ? s.nome : "", undefined, { wrap: true });
    fC.formula(rr, 3, `${FOGLI.sedi}!${ref(rs, colTotMq)}`, rs_ ? rs_.mqTotali : 0, FMT.mq);
    fC.input(rr, 4, s ? (s.aCanone ? SI : NO) : SI, "documento", undefined).dataValidation = { type: "list", allowBlank: false, formulae: [`"${SI},${NO}"`] };
    fC.input(rr, 5, s && s.aCanone ? s.canone : null, "documento", FMT.euro, { facoltativo: true });
    fC.formula(rr, 6, `SUMPRODUCT(${FOGLI.sedi}!${ref(rs, colPrimaTip)}:${ref(rs, colUltimaTip)},${FOGLI.sedi}!${assoluto(5, colPrimaTip)}:${assoluto(5, colUltimaTip)})`, rs_ ? rs_.oreCalcolate : 0, FMT.ore);
    fC.input(rr, 7, s ? s.oreDichiarate : null, "documento", FMT.ore, { facoltativo: true });
    fC.formula(
      rr,
      8,
      `IF(AND(${ref(rr, 4)}="${SI}",ISNUMBER(${ref(rr, 5)}),ISNUMBER(${monteRef}),${sommaCanoniFormula}>0),${ref(rr, 5)}/${sommaCanoniFormula}*${monteRef},0)`,
      rs_ ? rs_.oreAllocate : 0,
      FMT.ore,
    );
    fC.formula(rr, 9, `IF(${ref(rr, 4)}="${NO}",0,IF(ISNUMBER(${ref(rr, 7)}),${ref(rr, 7)},IF(${ref(rr, 8)}>0,${ref(rr, 8)},${ref(rr, 6)})))`, rs_ ? rs_.oreAdottate : 0, FMT.ore, { grassetto: true });
    fC.formula(rr, 10, `IF(AND(${ref(rr, 9)}>0,${ref(rr, 6)}>0),${ref(rr, 6)}/${ref(rr, 9)}-1,"n.d.")`, rs_ ? rs_.scostamento : "n.d.", FMT.pct);
    fC.nota(rr, 11, s ? (s.aCanone ? "" : "Pulizie a misura / extra canone: non a canone") : "");
  }
  fC.testo(rigaTotaleCalcolo, 2, "TOTALE", { grassetto: true, bordi: true });
  const sommaColonna = (col: number, valore: number, formato: string, f?: string) => fC.formula(rigaTotaleCalcolo, col, f ?? `SUM(${ref(primaRigaCalcolo, col)}:${ref(ultimaRigaCalcolo, col)})`, valore, formato);
  sommaColonna(3, r.totaliSedi.mq, FMT.mq);
  sommaColonna(5, r.totaliSedi.canone, FMT.euro, sommaCanoniFormula);
  sommaColonna(6, r.totaliSedi.oreCalcolate, FMT.ore);
  sommaColonna(7, r.totaliSedi.oreDichiarate, FMT.ore);
  sommaColonna(8, r.totaliSedi.oreAllocate, FMT.ore);
  sommaColonna(9, r.totaliSedi.oreAdottate, FMT.ore);
  fC.totale(rigaTotaleCalcolo, 1, 11);
  fC.congela(2, 4);

  // ───────────── Presìdi e attività a forfait ─────────────
  const fPr = new Foglio(wsPresidi);
  fPr.larghezze(36, 54, 12, 16, 14, 16, 56);
  fPr.titolo("Presìdi fissi e attività a forfait", "Ore/anno = N. addetti × Ore per addetto a periodo × N. periodi/anno. Le quantità in nero sono collegate ai parametri; righe libere in fondo per aggiungere voci.", 7);
  ["Gruppo", "Presidio / attività", "N. addetti", "Ore per addetto\na periodo", "N. periodi\n/anno", "Ore/anno", "Fonte / note"].forEach((t, i) => fPr.testata(4, i + 1, t));
  wsPresidi.getRow(4).height = 32;
  let rp = 5;
  const celleSubtotali: string[] = [];
  const scriviRigaPresidio = (rr: number, p: (typeof dati.presidi)[number] | null, ore: number) => {
    fPr.testo(rr, 1, p ? p.gruppo : "Voci aggiuntive", { bordi: true, wrap: true });
    fPr.input(rr, 2, p ? p.descrizione : null, "documento", undefined, { facoltativo: true }).alignment = { vertical: "top", wrapText: true };
    if (p) {
      scriviQuantita(fPr, rr, 3, p.addetti, p.origine, "General");
      scriviQuantita(fPr, rr, 4, p.oreAddetto, p.origine, "General");
      scriviQuantita(fPr, rr, 5, p.periodi, p.origine, "General");
    } else {
      for (const col of [3, 4, 5]) fPr.input(rr, col, null, "documento", "General", { facoltativo: true });
    }
    fPr.formula(rr, 6, `${ref(rr, 3)}*${ref(rr, 4)}*${ref(rr, 5)}`, ore, FMT.ore, { grassetto: true });
    fPr.nota(rr, 7, p ? p.fonte : "");
  };
  let indice = 0;
  for (const sub of r.subtotaliGruppo) {
    const primo = rp;
    const gruppo = dati.presidi[indice].gruppo;
    let n = 0;
    while (indice + n < dati.presidi.length && dati.presidi[indice + n].gruppo === gruppo) {
      scriviRigaPresidio(rp, dati.presidi[indice + n], r.orePresidio[indice + n]);
      rp++;
      n++;
      // il blocco finisce al cambio di gruppo (calcoli: gruppi consecutivi)
    }
    indice += n;
    fPr.testo(rp, 1, `Subtotale — ${sub.gruppo}`, { grassetto: true, bordi: true, wrap: true });
    fPr.formula(rp, 6, `SUM(${ref(primo, 6)}:${ref(rp - 1, 6)})`, sub.ore, FMT.ore);
    fPr.totale(rp, 1, 7);
    celleSubtotali.push(ref(rp, 6));
    rp++;
  }
  const primoSpare = rp;
  for (let i = 0; i < 2; i++) {
    scriviRigaPresidio(rp, null, 0);
    rp++;
  }
  fPr.testo(rp, 1, "Subtotale — Voci aggiuntive", { grassetto: true, bordi: true });
  fPr.formula(rp, 6, `SUM(${ref(primoSpare, 6)}:${ref(rp - 1, 6)})`, 0, FMT.ore);
  fPr.totale(rp, 1, 7);
  celleSubtotali.push(ref(rp, 6));
  rp++;
  const rigaTotalePresidi = rp;
  fPr.testo(rigaTotalePresidi, 1, "TOTALE PRESÌDI E ATTIVITÀ A FORFAIT", { grassetto: true, bordi: true });
  fPr.formula(rigaTotalePresidi, 6, celleSubtotali.join("+"), r.orePresidi, FMT.ore);
  fPr.totale(rigaTotalePresidi, 1, 7);
  fPr.congela(0, 4);

  // ───────────── Macchinari e attrezzature (serve prima del riepilogo: ne richiama il totale) ─────────────
  const fM = new Foglio(wsMacchinari);
  fM.larghezze(6, 54, 38, 9, 16, 16, 12, 18, 42, 48);
  fM.titolo("Macchinari e attrezzature", undefined, 10);
  fM.testoLungo(2, 1, 10, TESTO_AVVISO_PREZZI, { grassetto: true, sfondo: COLORI.arancio, colore: "FF7F3F00", caratteriPerRiga: 150 });
  fM.testo(3, 1, "", {});
  ["N.", "Descrizione", "Marca / modello di riferimento", "Q.tà", "Prezzo unitario\n(€, IVA escl.)", "Importo\n(€, IVA escl.)", "Vita utile\n(mesi)", "Quota imputabile\nalla durata (€)", "Origine del prezzo", "Note / riferimento capitolato"].forEach((t, i) => fM.testata(4, i + 1, t));
  wsMacchinari.getRow(4).height = 45;
  const durataRef = indirizzoParametro(PARAMETRI_STANDARD.durataMesi);
  let rm = 5;
  const categorie: string[] = [];
  for (const m of dati.macchinari) if (!categorie.includes(m.categoria)) categorie.push(m.categoria);
  const primaRigaMacchinari = rm;
  let numero = 1;
  const scriviRigaMacchinario = (rr: number, idx: number | null) => {
    const m = idx === null ? null : dati.macchinari[idx];
    const res = idx === null ? { importo: 0, quotaDurata: 0 } : r.macchinari[idx];
    fM.testo(rr, 1, String(numero++), { bordi: true, centrato: true });
    fM.input(rr, 2, m ? m.descrizione : null, "documento", undefined, { facoltativo: true }).alignment = { vertical: "top", wrapText: true };
    fM.input(rr, 3, m ? m.riferimento : null, "documento", undefined, { facoltativo: true }).alignment = { vertical: "top", wrapText: true, horizontal: "left" };
    fM.input(rr, 4, m ? m.quantita : null, "documento", "General", { facoltativo: !m });
    // il prezzo è sempre standard: sfondo azzurro (da sostituire con quello del fornitore), giallo se manca
    fM.input(rr, 5, m ? m.prezzoUnitario : null, "ipotesi", FMT.euro, { facoltativo: !m });
    fM.formula(rr, 6, `${ref(rr, 4)}*${ref(rr, 5)}`, res.importo, FMT.euro, { grassetto: true });
    fM.input(rr, 7, m ? m.vitaUtileMesi : null, "ipotesi", "#,##0", { facoltativo: true });
    fM.formula(rr, 8, `IF(ISNUMBER(${ref(rr, 7)}),${ref(rr, 6)}*MIN(${durataRef}/${ref(rr, 7)},1),${ref(rr, 6)})`, res.quotaDurata, FMT.euro);
    fM.nota(rr, 9, m ? etichettaOrigineMacchinario(m.origine, m.fontePrezzo) : "");
    fM.nota(rr, 10, m ? [m.nota].filter(Boolean).join(" — ") : "");
  };
  for (const cat of categorie) {
    fM.testo(rm, 1, cat.toUpperCase(), { grassetto: true, bordi: true, sfondo: COLORI.sezione });
    for (let col = 2; col <= 10; col++) fM.testo(rm, col, "", { bordi: true, sfondo: COLORI.sezione });
    rm++;
    dati.macchinari.forEach((m, i) => {
      if (m.categoria !== cat) return;
      scriviRigaMacchinario(rm, i);
      rm++;
    });
  }
  fM.testo(rm, 1, "ALTRE DOTAZIONI (compilazione libera)", { grassetto: true, bordi: true, sfondo: COLORI.sezione });
  for (let col = 2; col <= 10; col++) fM.testo(rm, col, "", { bordi: true, sfondo: COLORI.sezione });
  rm++;
  for (let i = 0; i < SPARE; i++) {
    scriviRigaMacchinario(rm, null);
    rm++;
  }
  const ultimaRigaMacchinari = rm - 1;
  const rigaTotaleMacchinari = rm;
  fM.testo(rigaTotaleMacchinari, 2, "TOTALE DOTAZIONE MACCHINARI E ATTREZZATURE (IVA esclusa)", { grassetto: true, bordi: true });
  fM.formula(rigaTotaleMacchinari, 6, `SUM(${ref(primaRigaMacchinari, 6)}:${ref(ultimaRigaMacchinari, 6)})`, r.totaleMacchinari, FMT.euro);
  fM.formula(rigaTotaleMacchinari, 8, `SUM(${ref(primaRigaMacchinari, 8)}:${ref(ultimaRigaMacchinari, 8)})`, r.totaleQuotaDurata, FMT.euro);
  fM.totale(rigaTotaleMacchinari, 1, 10);
  if (dati.budgetMacchinari !== null) {
    fM.testo(rigaTotaleMacchinari + 1, 2, "Budget dotazioni dichiarato dal bando (€)", { bordi: true });
    fM.input(rigaTotaleMacchinari + 1, 6, dati.budgetMacchinari, "documento", FMT.euro);
    fM.testo(rigaTotaleMacchinari + 2, 2, "Differenza: totale − budget (€)", { bordi: true });
    fM.formula(rigaTotaleMacchinari + 2, 6, `${ref(rigaTotaleMacchinari, 6)}-${ref(rigaTotaleMacchinari + 1, 6)}`, r.differenzaBudget as number, FMT.euro);
  }
  fM.testoLungo(rigaTotaleMacchinari + (dati.budgetMacchinari !== null ? 4 : 2), 1, 10, "Quota imputabile alla durata = importo × (durata dell'appalto in mesi ÷ vita utile in mesi), al massimo l'importo intero; senza vita utile si considera l'importo intero.", { corsivo: true, dimensione: 9, colore: "FF595959", caratteriPerRiga: 150 });
  fM.congela(2, 4);

  // ───────────── Riepilogo e quadratura ─────────────
  const fRi = new Foglio(wsRiepilogo);
  fRi.larghezze(66, 22, 76);
  fRi.titolo("Riepilogo e quadratura del monte ore", "Tutti i valori di questo foglio sono formule: non vanno modificati qui, ma nei fogli di input.", 3);
  const toll = indirizzoParametro(PARAMETRI_STANDARD.tolleranza);
  const settimaneRef = indirizzoParametro(PARAMETRI_STANDARD.settimaneAnno);
  const oreFteRef = indirizzoParametro(PARAMETRI_STANDARD.oreFte);
  const righeRiepilogo: { riga: number; etichetta: string; f: string; v: Valore; fmt: string; nota?: string; forte?: boolean }[] = [
    { riga: 5, etichetta: "Ore annue dalle sedi (a canone)", f: `${FOGLI.calcolo}!${ref(rigaTotaleCalcolo, 9)}`, v: r.oreSedi, fmt: FMT.ore, nota: "Foglio Calcolo_Ore, colonna «Ore adottate»" },
    { riga: 6, etichetta: "Ore annue da presìdi e attività a forfait", f: `${FOGLI.presidi}!${ref(rigaTotalePresidi, 6)}`, v: r.orePresidi, fmt: FMT.ore, nota: "Foglio Presidi" },
    { riga: 7, etichetta: "TOTALE MONTE ORE ANNUO", f: "B5+B6", v: r.oreTotali, fmt: FMT.ore, forte: true },
    { riga: 8, etichetta: "Monte ore annuo dichiarato dal bando", f: `IF(ISNUMBER(${monteRef}),${monteRef},"n.d.")`, v: r.dichiarato, fmt: FMT.ore, nota: "Foglio Parametri (facoltativo)" },
    { riga: 9, etichetta: "Scostamento (ore)", f: `IF(ISNUMBER(B8),B7-B8,"n.d.")`, v: r.scostamentoOre, fmt: FMT.ore },
    { riga: 10, etichetta: "Scostamento (%)", f: `IF(ISNUMBER(B8),IFERROR(B7/B8-1,0),"n.d.")`, v: r.scostamentoPct, fmt: FMT.pct },
    {
      riga: 11,
      etichetta: "Esito della quadratura",
      f: `IF(ISNUMBER(B10),IF(ABS(B10)<=${toll},"In linea con il monte ore dichiarato","Scostamento oltre la tolleranza: verificare"),"Monte ore non dichiarato dal bando")`,
      v: r.esito,
      fmt: "General",
      nota: "La tolleranza si imposta nel foglio Parametri",
    },
    { riga: 13, etichetta: "Verifica incrociata: ore calcolate dalle metrature", f: `${FOGLI.calcolo}!${ref(rigaTotaleCalcolo, 6)}`, v: r.totaliSedi.oreCalcolate, fmt: FMT.ore, nota: "Somma delle ore calcolate da metrature × coefficienti" },
    { riga: 14, etichetta: "Scostamento: ore calcolate dalle metrature / ore delle sedi", f: `IF(AND(B5>0,B13>0),B13/B5-1,"n.d.")`, v: r.oreSedeVsCalcolate, fmt: FMT.pct, nota: "Utile a capire quanto il calcolo dalle metrature si discosta dalle ore adottate" },
    { riga: 16, etichetta: "Durata dell'appalto (mesi)", f: durataRef, v: r.durataMesi, fmt: "#,##0" },
    { riga: 17, etichetta: "Monte ore per l'intera durata", f: "B7*B16/12", v: r.oreDurata, fmt: FMT.ore },
    { riga: 18, etichetta: "Monte ore settimanale medio", f: `IFERROR(B7/${settimaneRef},0)`, v: r.oreSettimana, fmt: FMT.ore },
    { riga: 19, etichetta: "Monte ore mensile medio", f: "B7/12", v: r.oreMese, fmt: FMT.ore },
    { riga: 20, etichetta: "FTE equivalenti necessari", f: `IFERROR(B7/${oreFteRef},0)`, v: r.fte, fmt: FMT.fte, nota: "Monte ore annuo ÷ ore produttive annue per addetto (foglio Parametri)", forte: true },
    { riga: 21, etichetta: "Macchinari e attrezzature: importo totale (€)", f: `${FOGLI.macchinari}!${ref(rigaTotaleMacchinari, 6)}`, v: r.totaleMacchinari, fmt: FMT.euro, nota: "Prezzi standard di mercato: da sostituire con quelli dei propri fornitori" },
    { riga: 22, etichetta: "Macchinari e attrezzature: quota imputabile alla durata (€)", f: `${FOGLI.macchinari}!${ref(rigaTotaleMacchinari, 8)}`, v: r.totaleQuotaDurata, fmt: FMT.euro },
  ];
  ["Voce", "Valore", "Note"].forEach((t, i) => fRi.testata(4, i + 1, t));
  for (const x of righeRiepilogo) {
    fRi.testo(x.riga, 1, x.etichetta, { bordi: true, grassetto: x.forte, wrap: true });
    fRi.formula(x.riga, 2, x.f, x.v, x.fmt === "General" ? undefined : x.fmt, { grassetto: x.forte, wrap: x.fmt === "General" });
    fRi.nota(x.riga, 3, x.nota ?? "");
    if (x.forte) fRi.totale(x.riga, 1, 3);
  }

  // ───────────── Organico ─────────────
  const fO = new Foglio(wsOrganico);
  fO.larghezze(14, 62, 16, 16, 14, 14, 60);
  fO.titolo("Organico: ripartizione del monte ore per livello CCNL", "La quota per livello è modificabile (blu); ore, FTE e ore mensili si ricalcolano. Le quote devono sommare 100%.", 7);
  ["Livello", "Ruolo / mansione", "Quota del\nmonte ore", "Ore/anno", "FTE", "Ore/mese", "Fonte / note"].forEach((t, i) => fO.testata(4, i + 1, t));
  wsOrganico.getRow(4).height = 32;
  const primaRigaOrganico = 5;
  dati.organico.forEach((l, i) => {
    const rr = primaRigaOrganico + i;
    const x = r.organico[i];
    fO.testo(rr, 1, l.livello, { bordi: true, centrato: true });
    fO.testo(rr, 2, l.ruolo, { bordi: true, wrap: true });
    fO.input(rr, 3, l.quota, l.origine, FMT.pct);
    fO.formula(rr, 4, `${FOGLI.riepilogo}!$B$7*${ref(rr, 3)}`, x.ore, FMT.ore);
    fO.formula(rr, 5, `IFERROR(${ref(rr, 4)}/${oreFteRef},0)`, x.fte, FMT.fte);
    fO.formula(rr, 6, `${ref(rr, 4)}/12`, x.oreMese, FMT.ore);
    fO.nota(rr, 7, l.fonte);
  });
  const ultimaRigaOrganico = primaRigaOrganico + dati.organico.length - 1;
  const rigaTotaleOrganico = ultimaRigaOrganico + 1;
  fO.testo(rigaTotaleOrganico, 2, "TOTALE", { grassetto: true, bordi: true });
  fO.formula(rigaTotaleOrganico, 3, `SUM(${ref(primaRigaOrganico, 3)}:${ref(ultimaRigaOrganico, 3)})`, r.sommaQuote, FMT.pct);
  fO.formula(rigaTotaleOrganico, 4, `SUM(${ref(primaRigaOrganico, 4)}:${ref(ultimaRigaOrganico, 4)})`, r.oreOrganico, FMT.ore);
  fO.formula(rigaTotaleOrganico, 5, `SUM(${ref(primaRigaOrganico, 5)}:${ref(ultimaRigaOrganico, 5)})`, r.fteOrganico, FMT.fte);
  fO.formula(rigaTotaleOrganico, 6, `SUM(${ref(primaRigaOrganico, 6)}:${ref(ultimaRigaOrganico, 6)})`, r.oreOrganico / 12, FMT.ore);
  fO.totale(rigaTotaleOrganico, 1, 7);
  fO.testo(rigaTotaleOrganico + 2, 2, "Controllo delle quote", { grassetto: true });
  fO.formula(rigaTotaleOrganico + 2, 3, `IF(ABS(${ref(rigaTotaleOrganico, 3)}-1)<0.0001,"OK: le quote sommano 100%","Le quote per livello devono sommare 100%")`, r.controlloQuote);
  wsOrganico.mergeCells(rigaTotaleOrganico + 2, 3, rigaTotaleOrganico + 2, 5);
  fO.congela(0, 4);

  // ───────────── Clausola sociale ─────────────
  let rigaFteUscenti = 0;
  let rigaTotaleClausola = 0;
  if (wsClausola) {
    const fCl = new Foglio(wsClausola);
    fCl.larghezze(18, 14, 22, 22, 60);
    fCl.titolo("Personale da riassorbire (clausola sociale)", "Dati dell'elenco del personale uscente indicato dal bando, per livello. Le ore annue equivalenti usano le settimane all'anno del foglio Parametri.", 5);
    ["Livello", "Unità", "Ore settimanali\n(totali)", "Ore annue\nequivalenti", "Note"].forEach((t, i) => fCl.testata(4, i + 1, t));
    wsClausola.getRow(4).height = 32;
    dati.personaleUscente.forEach((p, i) => {
      const rr = 5 + i;
      fCl.testo(rr, 1, p.livello, { bordi: true, centrato: true });
      fCl.input(rr, 2, p.unita, "documento", "#,##0");
      fCl.input(rr, 3, p.oreSettimanali, "documento", FMT.ore, { facoltativo: true });
      fCl.formula(rr, 4, `${ref(rr, 3)}*${settimaneRef}`, r.clausola.oreAnnue[i], FMT.ore);
      fCl.nota(rr, 5, p.nota);
    });
    const ultima = 5 + dati.personaleUscente.length - 1;
    rigaTotaleClausola = ultima + 1;
    fCl.testo(rigaTotaleClausola, 1, "TOTALE", { grassetto: true, bordi: true });
    fCl.formula(rigaTotaleClausola, 2, `SUM(${ref(5, 2)}:${ref(ultima, 2)})`, r.clausola.unita, "#,##0");
    fCl.formula(rigaTotaleClausola, 3, `SUM(${ref(5, 3)}:${ref(ultima, 3)})`, r.clausola.oreSettimanali, FMT.ore);
    fCl.formula(rigaTotaleClausola, 4, `SUM(${ref(5, 4)}:${ref(ultima, 4)})`, r.clausola.oreAnnueTotali, FMT.ore);
    fCl.totale(rigaTotaleClausola, 1, 5);
    rigaFteUscenti = rigaTotaleClausola + 2;
    fCl.testo(rigaFteUscenti, 1, "FTE equivalenti del personale uscente", { bordi: true, wrap: true });
    wsClausola.mergeCells(rigaFteUscenti, 1, rigaFteUscenti, 3);
    fCl.formula(rigaFteUscenti, 4, `IFERROR(${ref(rigaTotaleClausola, 4)}/${oreFteRef},0)`, r.clausola.fteUscenti, FMT.fte);
    fCl.testo(rigaFteUscenti + 1, 1, "FTE necessari secondo il piano (foglio Organico)", { bordi: true, wrap: true });
    wsClausola.mergeCells(rigaFteUscenti + 1, 1, rigaFteUscenti + 1, 3);
    fCl.formula(rigaFteUscenti + 1, 4, `${FOGLI.organico}!${ref(rigaTotaleOrganico, 5)}`, r.fteOrganico, FMT.fte);
    fCl.testo(rigaFteUscenti + 2, 1, "Differenza (necessari − uscenti)", { bordi: true, grassetto: true });
    wsClausola.mergeCells(rigaFteUscenti + 2, 1, rigaFteUscenti + 2, 3);
    fCl.formula(rigaFteUscenti + 2, 4, `${ref(rigaFteUscenti + 1, 4)}-${ref(rigaFteUscenti, 4)}`, r.clausola.differenzaFte, FMT.fte, { grassetto: true });
    fCl.congela(0, 4);
  }

  // ───────────── Copertina ─────────────
  const fCo = new Foglio(wsCopertina);
  fCo.larghezze(3, 52, 70);
  fCo.testo(2, 2, "PIANO DI LAVORO — MODELLO DI CALCOLO", { grassetto: true, dimensione: 18, colore: COLORI.navy });
  wsCopertina.getRow(2).height = 30;
  fCo.testoLungo(3, 2, 3, dati.appalto.titolo, { grassetto: true, dimensione: 12, caratteriPerRiga: 100 });
  const anagrafica: [string, string][] = [
    ["Stazione appaltante", dati.appalto.stazioneAppaltante || "n.d."],
    ["CIG", dati.appalto.cig ?? "n.d."],
    ["Riferimento", dati.appalto.riferimentoGara ?? "n.d."],
    ["Criterio di aggiudicazione", dati.appalto.criterio ?? "n.d."],
    ["Importo a base di gara (€, IVA esclusa)", dati.appalto.importoBase !== null ? dati.appalto.importoBase.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "n.d."],
    ["Generato da OMNIA AI il", opzioni.generatoIl.toLocaleDateString("it-IT", { timeZone: "Europe/Rome", day: "2-digit", month: "long", year: "numeric" })],
  ];
  let rc = 5;
  for (const [k, v] of anagrafica) {
    fCo.testo(rc, 2, k, { bordi: true, grassetto: true, sfondo: COLORI.totale });
    fCo.testo(rc, 3, v, { bordi: true, wrap: true });
    rc++;
  }
  rc++;
  fCo.testo(rc, 2, "RISULTATI PRINCIPALI", { grassetto: true, colore: COLORI.navy, dimensione: 11 });
  rc++;
  const risultati: [string, string, Valore, string | undefined][] = [
    ["Monte ore annuo", `${FOGLI.riepilogo}!$B$7`, r.oreTotali, FMT.ore],
    ["FTE equivalenti necessari", `${FOGLI.riepilogo}!$B$20`, r.fte, FMT.fte],
    ["Scostamento dal monte ore dichiarato (%)", `${FOGLI.riepilogo}!$B$10`, r.scostamentoPct, FMT.pct],
    ["Esito della quadratura", `${FOGLI.riepilogo}!$B$11`, r.esito, undefined],
    ["Macchinari e attrezzature (€, IVA esclusa)", `${FOGLI.riepilogo}!$B$21`, r.totaleMacchinari, FMT.euro],
  ];
  for (const [k, f, v, fmt] of risultati) {
    fCo.testo(rc, 2, k, { bordi: true });
    const c = fCo.formula(rc, 3, f, v, fmt, { grassetto: true, wrap: true });
    c.alignment = { vertical: "top", horizontal: "left", wrapText: true };
    rc++;
  }
  rc++;
  fCo.testo(rc, 2, "AFFIDABILITÀ DEI DATI (alla generazione)", { grassetto: true, colore: COLORI.navy, dimensione: 11 });
  rc++;
  const conteggi: [string, number, string | undefined, string][] = [
    ["Dati letti dai documenti di gara", r.conteggiOrigine.documento, undefined, COLORI.blu],
    ["Ipotesi di OMNIA AI da validare", r.conteggiOrigine.ipotesi, COLORI.azzurro, COLORI.blu],
    ["Dati mancanti da inserire", r.conteggiOrigine.mancante, COLORI.giallo, COLORI.blu],
  ];
  for (const [k, n, sfondo] of conteggi) {
    const c = fCo.testo(rc, 2, k, { bordi: true });
    if (sfondo) c.fill = riempi(sfondo);
    fCo.testo(rc, 3, "", { bordi: true, centrato: false }).value = n;
    rc++;
  }
  const mancanti = [...elencoDatiMancanti(dati), ...elencoAnomalie(dati), ...dati.avvertenze];
  if (mancanti.length > 0) {
    rc++;
    fCo.testo(rc, 2, "DA COMPLETARE O VERIFICARE", { grassetto: true, colore: COLORI.navy, dimensione: 11 });
    rc++;
    for (const m of mancanti) {
      fCo.testoLungo(rc, 2, 3, `• ${m}`, { caratteriPerRiga: 115 });
      rc++;
    }
  }
  if (dati.documenti.letti.length > 0 || dati.documenti.nonLetti.length > 0) {
    rc++;
    fCo.testo(rc, 2, "DOCUMENTI DI GARA ANALIZZATI", { grassetto: true, colore: COLORI.navy, dimensione: 11 });
    rc++;
    if (dati.documenti.letti.length > 0) {
      fCo.testoLungo(rc, 2, 3, `Letti (${dati.documenti.letti.length}): ${dati.documenti.letti.join("; ")}`, { caratteriPerRiga: 115 });
      rc++;
    }
    if (dati.documenti.nonLetti.length > 0) {
      const righe = dati.documenti.nonLetti.map((d) => `${d.nome} (${d.motivo})`);
      fCo.testoLungo(rc, 2, 3, `Non letti (${righe.length}): ${righe.join("; ")}`, { caratteriPerRiga: 115, corsivo: true });
      rc++;
    }
  }
  rc++;
  fCo.testo(rc, 2, "COME LEGGERE IL FILE", { grassetto: true, colore: COLORI.navy, dimensione: 11 });
  rc++;
  // i testi della legenda stanno in LEGENDA_FILE (li legge anche il Word per il legale); qui solo i colori
  const colori: [string | undefined, string][] = [
    [undefined, COLORI.blu],
    [COLORI.azzurro, COLORI.blu],
    [COLORI.giallo, COLORI.blu],
    [undefined, COLORI.nero],
  ];
  const legenda: [string, string | undefined, string, string][] = LEGENDA_FILE.map((v, i) => [v.nome, colori[i][0], colori[i][1], v.spiegazione]);
  for (const [k, sfondo, colore, spiegazione] of legenda) {
    const c = fCo.testo(rc, 2, k, { bordi: true, colore });
    if (sfondo) c.fill = riempi(sfondo);
    fCo.testo(rc, 3, spiegazione, { bordi: true });
    rc++;
  }
  rc++;
  fCo.testo(rc, 2, "AVVERTENZE", { grassetto: true, colore: COLORI.navy, dimensione: 11 });
  rc++;
  AVVERTENZE_FISSE.forEach((a, i) => {
    fCo.testoLungo(rc, 2, 3, `${i + 1}. ${a}`, { caratteriPerRiga: 115, ...(a === TESTO_AVVISO_PREZZI ? { grassetto: true, sfondo: COLORI.arancio, colore: "FF7F3F00" } : {}) });
    rc++;
  });
  rc++;
  fCo.testo(rc, 2, "STRUTTURA DEL FILE", { grassetto: true, colore: COLORI.navy, dimensione: 11 });
  rc++;
  const indiceFogli: [string, string][] = [
    [FOGLI.parametri, "Durata, calendario, ore per addetto, monte ore dichiarato, tolleranza"],
    [FOGLI.rese, "Rese (mq/h) e frequenze per tipologia di ambiente e lavorazione"],
    [FOGLI.sedi, "Metrature di ogni sede per tipologia di ambiente"],
    [FOGLI.calcolo, "Monte ore per sede (calcolo dalle metrature, ore dichiarate, ripartizione per canone)"],
    [FOGLI.presidi, "Presìdi fissi e attività a forfait"],
    [FOGLI.riepilogo, "Totale, quadratura con il monte ore dichiarato, FTE"],
    [FOGLI.organico, "Ripartizione per livello CCNL"],
    ...(wsClausola ? ([[FOGLI.clausola, "Personale da riassorbire e confronto con il fabbisogno"]] as [string, string][]) : []),
    [FOGLI.macchinari, "Macchinari e attrezzature con prezzi standard di mercato"],
  ];
  for (const [nome, descr] of indiceFogli) {
    const c = fCo.testo(rc, 2, nome, { bordi: true });
    c.value = { text: nome, hyperlink: `#'${nome}'!A1` } as ExcelJS.CellHyperlinkValue;
    c.font = { name: FONT, size: 10, color: { argb: "FF0563C1" }, underline: true };
    fCo.testo(rc, 3, descr, { bordi: true, wrap: true });
    rc++;
  }
  wsCopertina.views = [{ showGridLines: false }];

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, risultato: r };
}
