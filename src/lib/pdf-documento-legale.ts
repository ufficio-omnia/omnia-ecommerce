import fs from "fs";
import path from "path";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { Blocco, DocumentoLegale, Inline } from "./legal-markdown";

// Generatore di PDF per i documenti legali (condizioni, privacy, cookie, Allegato A).
// Parte dal documento già interpretato (src/lib/legal-markdown.ts), lo stesso da cui
// nasce la pagina web: testo e PDF non possono divergere. In fondo al PDF si stampa
// l'impronta SHA-256 del testo versionato, così il file scaricato si può ricondurre a
// quello registrato in legal_documents.
//
// Font: Liberation Sans (Regular e Bold) già presenti in src/assets/fonts e incluse nel
// pacchetto di Vercel. Incorporato (non uno dei font standard del PDF) per avere tutte le
// lettere accentate e la punteggiatura tipografica senza limiti di codifica. Non c'è la
// variante corsiva: il corsivo del testo si rende in grigio.

const A4 = { larghezza: 595.28, altezza: 841.89 };
const MARGINE = { sinistro: 56, destro: 56, alto: 62, basso: 66 };
const LARGHEZZA_UTILE = A4.larghezza - MARGINE.sinistro - MARGINE.destro;

const COLORE_TESTO = rgb(0.09, 0.09, 0.11);
const COLORE_FIOCO = rgb(0.42, 0.42, 0.47);
const COLORE_LINEA = rgb(0.8, 0.8, 0.84);
const COLORE_FONDO_TESTATA = rgb(0.94, 0.94, 0.96);

export type OpzioniPdfLegale = {
  // titolo del documento, per le proprietà del file e per il piè di pagina
  titolo: string;
  versione: number;
  // SHA-256 del testo versionato (legal_documents.sha256)
  impronta: string | null;
  // «14 ottobre 2026 alle 10:32:15»: quando il cliente ha accettato questa versione; null se non si sa
  accettatoIl: string | null;
  // «14 ottobre 2026»: giorno in cui il PDF viene generato
  generatoIl: string;
};

// ───── Font ─────

let fontCache: { regolare: Uint8Array; grassetto: Uint8Array } | null = null;
function leggiFont() {
  if (!fontCache) {
    const cartella = path.join(process.cwd(), "src", "assets", "fonts");
    fontCache = {
      regolare: fs.readFileSync(path.join(cartella, "LiberationSans-Regular.ttf")),
      grassetto: fs.readFileSync(path.join(cartella, "LiberationSans-Bold.ttf")),
    };
  }
  return fontCache;
}

// ───── Parole e righe ─────

type Parola = { testo: string; grassetto: boolean; corsivo: boolean; spazioPrima: boolean };

// Divide i segmenti in parole, ricordando se tra una parola e la precedente c'era uno
// spazio: «**[X]**, P.IVA» deve restare «[X], P.IVA» (la virgola attaccata), non «[X] , P.IVA».
export function dividiInParole(inline: Inline[], tuttoGrassetto = false): Parola[] {
  const parole: Parola[] = [];
  let spazio = false;
  for (const segmento of inline) {
    for (const m of segmento.testo.matchAll(/(\s+)|(\S+)/g)) {
      if (m[1] !== undefined) {
        spazio = true;
        continue;
      }
      parole.push({
        testo: m[2],
        grassetto: tuttoGrassetto || segmento.tipo === "grassetto",
        corsivo: segmento.tipo === "corsivo",
        spazioPrima: spazio && parole.length > 0,
      });
      spazio = false;
    }
  }
  return parole;
}

type Caratteri = { regolare: PDFFont; grassetto: PDFFont };

function larghezzaParola(p: Parola, size: number, f: Caratteri): number {
  return (p.grassetto ? f.grassetto : f.regolare).widthOfTextAtSize(p.testo, size);
}

// Una parola più larga della riga (un indirizzo lungo, un'impronta) si spezza a caratteri.
function spezzaParolaLunga(p: Parola, size: number, f: Caratteri, massimo: number): Parola[] {
  if (larghezzaParola(p, size, f) <= massimo) return [p];
  const pezzi: Parola[] = [];
  let corrente = "";
  for (const c of p.testo) {
    if (larghezzaParola({ ...p, testo: corrente + c }, size, f) > massimo && corrente !== "") {
      pezzi.push({ ...p, testo: corrente, spazioPrima: pezzi.length === 0 ? p.spazioPrima : false });
      corrente = c;
    } else corrente += c;
  }
  if (corrente) pezzi.push({ ...p, testo: corrente, spazioPrima: pezzi.length === 0 ? p.spazioPrima : false });
  return pezzi;
}

// Righe di testo che stanno nella larghezza data (a capo «avido»).
export function impaginaRighe(parole: Parola[], larghezza: number, size: number, f: Caratteri): Parola[][] {
  const spazio = f.regolare.widthOfTextAtSize(" ", size);
  const righe: Parola[][] = [];
  let riga: Parola[] = [];
  let usata = 0;
  for (const originale of parole.flatMap((p) => spezzaParolaLunga(p, size, f, larghezza))) {
    const w = larghezzaParola(originale, size, f);
    const conSpazio = riga.length > 0 && originale.spazioPrima ? spazio : 0;
    if (riga.length > 0 && usata + conSpazio + w > larghezza) {
      righe.push(riga);
      riga = [{ ...originale, spazioPrima: false }];
      usata = w;
    } else {
      riga.push(riga.length === 0 ? { ...originale, spazioPrima: false } : originale);
      usata += conSpazio + w;
    }
  }
  if (riga.length > 0) righe.push(riga);
  return righe;
}

// ───── Contesto di disegno ─────

type Contesto = {
  pdf: PDFDocument;
  f: Caratteri;
  pagina: PDFPage;
  y: number;
  // numero di pagine create (le pagine sono già in pdf, qui solo per sapere se si è in cima)
  inCima: boolean;
};

function nuovaPagina(c: Contesto) {
  c.pagina = c.pdf.addPage([A4.larghezza, A4.altezza]);
  c.y = A4.altezza - MARGINE.alto;
  c.inCima = true;
}

// Se non c'è spazio per `altezza`, si passa alla pagina successiva.
function assicuraSpazio(c: Contesto, altezza: number) {
  if (c.y - altezza < MARGINE.basso) nuovaPagina(c);
}

function disegnaRiga(c: Contesto, riga: Parola[], x0: number, size: number, grassettoBase: boolean) {
  const spazio = c.f.regolare.widthOfTextAtSize(" ", size);
  let x = x0;
  for (const p of riga) {
    if (p.spazioPrima) x += spazio;
    const font = p.grassetto || grassettoBase ? c.f.grassetto : c.f.regolare;
    c.pagina.drawText(p.testo, { x, y: c.y, size, font, color: p.corsivo ? COLORE_FIOCO : COLORE_TESTO });
    x += font.widthOfTextAtSize(p.testo, size);
  }
}

// Paragrafo: righe a capo, con salto pagina se serve. Restituisce la y finale.
function scriviTesto(c: Contesto, inline: Inline[], opz: { size: number; interlinea: number; x?: number; larghezza?: number; grassetto?: boolean; dopo: number }) {
  const x = opz.x ?? MARGINE.sinistro;
  const larghezza = opz.larghezza ?? LARGHEZZA_UTILE - (x - MARGINE.sinistro);
  const righe = impaginaRighe(dividiInParole(inline, opz.grassetto), larghezza, opz.size, c.f);
  for (const riga of righe) {
    assicuraSpazio(c, opz.interlinea);
    c.y -= opz.size;
    disegnaRiga(c, riga, x, opz.size, opz.grassetto ?? false);
    c.y -= opz.interlinea - opz.size;
    c.inCima = false;
  }
  c.y -= opz.dopo;
}

// ───── Blocchi ─────

function titolo(c: Contesto, blocco: Extract<Blocco, { tipo: "h1" | "h2" | "h3" }>) {
  const stile = { h1: { size: 20, prima: 0, dopo: 8, riservaRighe: 4 }, h2: { size: 13.5, prima: 18, dopo: 6, riservaRighe: 3 }, h3: { size: 11.5, prima: 14, dopo: 4, riservaRighe: 2 } }[blocco.tipo];
  // un titolo non resta mai solo in fondo alla pagina: ci deve stare almeno qualche riga dopo
  const prima = c.inCima ? 0 : stile.prima;
  assicuraSpazio(c, prima + stile.size * 1.3 + stile.riservaRighe * 14.5);
  c.y -= c.inCima ? 0 : prima;
  scriviTesto(c, blocco.inline, { size: stile.size, interlinea: stile.size * 1.3, grassetto: true, dopo: stile.dopo });
}

function elenco(c: Contesto, voci: Inline[][]) {
  const rientro = 16;
  for (const voce of voci) {
    assicuraSpazio(c, 14.5);
    c.pagina.drawText("•", { x: MARGINE.sinistro + 4, y: c.y - 10, size: 10, font: c.f.regolare, color: COLORE_TESTO });
    scriviTesto(c, voce, { size: 10, interlinea: 14.5, x: MARGINE.sinistro + rientro, dopo: 3 });
  }
  c.y -= 4;
}

function tabella(c: Contesto, intestazione: Inline[][], righe: Inline[][][]) {
  const n = intestazione.length;
  const size = 9;
  const interlinea = 12;
  const pad = 4;
  const testoCella = (cella: Inline[]) => cella.map((s) => s.testo).join("");
  // larghezza delle colonne in proporzione alla lunghezza media dei contenuti (con un minimo e un massimo)
  const pesi = intestazione.map((_, col) => {
    const lunghezze = [intestazione[col], ...righe.map((r) => r[col] ?? [])].map((cella) => testoCella(cella).length);
    const media = lunghezze.reduce((a, b) => a + b, 0) / lunghezze.length;
    return Math.min(Math.max(media, 10), 38);
  });
  const somma = pesi.reduce((a, b) => a + b, 0);
  const larghezze = pesi.map((p) => (LARGHEZZA_UTILE * p) / somma);

  const righeCella = (celle: Inline[][], testata: boolean) => celle.map((cella, col) => impaginaRighe(dividiInParole(cella, testata), larghezze[col] - 2 * pad, size, c.f));
  const altezzaRiga = (celle: Parola[][][]) => Math.max(...celle.map((l) => l.length)) * interlinea + 2 * pad;

  const disegna = (celle: Inline[][], testata: boolean) => {
    const impaginate = righeCella(celle, testata);
    const h = altezzaRiga(impaginate);
    if (c.y - h < MARGINE.basso) {
      nuovaPagina(c);
      if (!testata) disegna(intestazione, true);
    }
    const alto = c.y;
    if (testata) c.pagina.drawRectangle({ x: MARGINE.sinistro, y: alto - h, width: LARGHEZZA_UTILE, height: h, color: COLORE_FONDO_TESTATA });
    let x = MARGINE.sinistro;
    impaginate.forEach((righeDellaCella, col) => {
      righeDellaCella.forEach((riga, i) => {
        c.y = alto - pad - size - i * interlinea;
        disegnaRiga(c, riga, x + pad, size, testata);
      });
      x += larghezze[col];
    });
    c.y = alto - h;
    c.pagina.drawLine({ start: { x: MARGINE.sinistro, y: c.y }, end: { x: MARGINE.sinistro + LARGHEZZA_UTILE, y: c.y }, thickness: testata ? 0.9 : 0.5, color: COLORE_LINEA });
    c.inCima = false;
  };

  assicuraSpazio(c, 60);
  c.y -= 4;
  c.pagina.drawLine({ start: { x: MARGINE.sinistro, y: c.y }, end: { x: MARGINE.sinistro + LARGHEZZA_UTILE, y: c.y }, thickness: 0.9, color: COLORE_LINEA });
  disegna(intestazione.slice(0, n), true);
  for (const riga of righe) disegna(riga, false);
  c.y -= 10;
}

// ───── Documento ─────

export async function generaPdfLegale(documento: DocumentoLegale, opzioni: OpzioniPdfLegale): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const bytes = leggiFont();
  const f: Caratteri = {
    regolare: await pdf.embedFont(bytes.regolare, { subset: true }),
    grassetto: await pdf.embedFont(bytes.grassetto, { subset: true }),
  };

  pdf.setTitle(`${opzioni.titolo} — versione ${opzioni.versione}`);
  pdf.setAuthor("Omnia Consulting SRLS");
  pdf.setSubject("OMNIA AI");
  pdf.setCreator("OMNIA AI");
  pdf.setProducer("OMNIA AI");

  const c: Contesto = { pdf, f, pagina: pdf.addPage([A4.larghezza, A4.altezza]), y: A4.altezza - MARGINE.alto, inCima: true };

  for (const blocco of documento.blocchi) {
    switch (blocco.tipo) {
      case "h1":
      case "h2":
      case "h3":
        titolo(c, blocco);
        break;
      case "paragrafo":
        scriviTesto(c, blocco.inline, { size: 10, interlinea: 14.5, dopo: 7 });
        break;
      case "elenco":
        elenco(c, blocco.voci);
        break;
      case "tabella":
        tabella(c, blocco.intestazione, blocco.righe);
        break;
    }
  }

  // Nota finale: da dove viene il file. L'impronta lo lega al testo registrato; la riga
  // sull'accettazione compare solo per la versione che il cliente ha davvero accettato.
  const nota: string[] = [];
  if (opzioni.accettatoIl) nota.push(`Versione accettata dal Titolare il ${opzioni.accettatoIl} (ora di Roma).`);
  if (opzioni.impronta) nota.push(`Impronta SHA-256 del testo versionato: ${opzioni.impronta}`);
  nota.push(`Documento generato dall'area riservata di OMNIA AI il ${opzioni.generatoIl}.`);
  assicuraSpazio(c, 12 + nota.length * 13);
  c.y -= 14;
  c.pagina.drawLine({ start: { x: MARGINE.sinistro, y: c.y + 6 }, end: { x: MARGINE.sinistro + LARGHEZZA_UTILE, y: c.y + 6 }, thickness: 0.5, color: COLORE_LINEA });
  for (const riga of nota) scriviTesto(c, [{ tipo: "corsivo", testo: riga }], { size: 8.5, interlinea: 12.5, dopo: 2 });

  // Piè di pagina su ogni pagina, a numerazione completa («Pagina 2 di 5»).
  const pagine = pdf.getPages();
  pagine.forEach((pagina, i) => {
    pagina.drawLine({ start: { x: MARGINE.sinistro, y: 46 }, end: { x: MARGINE.sinistro + LARGHEZZA_UTILE, y: 46 }, thickness: 0.5, color: COLORE_LINEA });
    pagina.drawText(`${opzioni.titolo} — versione ${opzioni.versione}`, { x: MARGINE.sinistro, y: 32, size: 8, font: f.regolare, color: COLORE_FIOCO });
    const numero = `Pagina ${i + 1} di ${pagine.length}`;
    pagina.drawText(numero, { x: A4.larghezza - MARGINE.destro - f.regolare.widthOfTextAtSize(numero, 8), y: 32, size: 8, font: f.regolare, color: COLORE_FIOCO });
  });

  return pdf.save();
}
