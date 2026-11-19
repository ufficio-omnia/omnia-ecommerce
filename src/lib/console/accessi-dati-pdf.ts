import fs from "fs";
import path from "path";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { NOTA_ESTRATTO, SOTTOTITOLO_ESTRATTO, frasePrincipaleEstratto, testoCaso, type RigaAccesso } from "./accessi-dati-calcoli";

// PDF dell'estratto del registro degli accessi di UN cliente, generato dal server: è il file che si allega all'email al cliente.
// Prima l'estratto esisteva solo come pagina della console stampata dal browser, e la stampa tagliava la tabella a destra
// (colonna «Motivo»). Qui la tabella è disegnata a mano: A4 orizzontale, ogni cella va a capo, una riga che non entra passa alla
// pagina dopo con l'intestazione ripetuta. Stessi testi della pagina (accessi-dati-calcoli.ts): pagina e PDF non divergono.
// Font Liberation Sans incorporato (accenti, «», —), come i PDF dei documenti legali.

const PAGINA = { larghezza: 841.89, altezza: 595.28 }; // A4 orizzontale
const MARGINE = 40;
const LARGHEZZA_UTILE = PAGINA.larghezza - 2 * MARGINE;
const FONDO_UTILE = 48; // sotto si stampa il piè di pagina

const COLORE_TESTO = rgb(0.09, 0.09, 0.11);
const COLORE_FIOCO = rgb(0.38, 0.38, 0.43);
const COLORE_LINEA = rgb(0.8, 0.8, 0.84);
const COLORE_FONDO = rgb(0.95, 0.95, 0.97);

const CORPO = 9;
const INTERLINEA = 1.32;
const PADDING_CELLA = 5;

type Font = { regolare: PDFFont; grassetto: PDFFont };

// Proporzioni delle colonne (somma 1): i testi lunghi (cosa è stato guardato, motivo) hanno più spazio.
const COLONNE: { titolo: string; quota: number }[] = [
  { titolo: "DATA E ORA (ROMA)", quota: 0.12 },
  { titolo: "OPERATORE", quota: 0.15 },
  { titolo: "CASO", quota: 0.15 },
  { titolo: "RIGUARDA", quota: 0.1 },
  { titolo: "COSA È STATO GUARDATO", quota: 0.22 },
  { titolo: "MOTIVO", quota: 0.26 },
];

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

function dataOraRoma(iso: string | Date): string {
  return new Date(iso).toLocaleString("it-IT", { timeZone: "Europe/Rome", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// Una sola riga di testo: niente a capo né caratteri di controllo (il motivo è scritto da una persona).
function pulito(testo: string): string {
  return testo.replace(/[^\P{C}]/gu, " ").replace(/\s+/g, " ").trim();
}

// Spezza il testo in righe larghe al massimo `larghezza`. Una parola più lunga della riga (un indirizzo email, un id) si
// spezza a caratteri invece di uscire dalla cella.
export function aCapo(testo: string, font: PDFFont, size: number, larghezza: number): string[] {
  const righe: string[] = [];
  let corrente = "";
  const misura = (t: string) => font.widthOfTextAtSize(t, size);
  for (const parola of pulito(testo).split(" ").filter(Boolean)) {
    const prova = corrente ? `${corrente} ${parola}` : parola;
    if (misura(prova) <= larghezza) {
      corrente = prova;
      continue;
    }
    if (corrente) righe.push(corrente);
    corrente = "";
    let resto = parola;
    while (misura(resto) > larghezza) {
      let n = resto.length - 1;
      while (n > 1 && misura(resto.slice(0, n)) > larghezza) n--;
      righe.push(resto.slice(0, n));
      resto = resto.slice(n);
    }
    corrente = resto;
  }
  if (corrente) righe.push(corrente);
  return righe.length > 0 ? righe : [""];
}

type Cella = { righe: string[]; piccole?: string[] };

export async function creaPdfEstrattoAccessi(d: {
  cliente: { email: string | null };
  righe: RigaAccesso[]; // già filtrate per cliente e periodo, dal più recente
  periodo: { da: string | null; a: string | null }; // date già formattate (gg/mm/aaaa) o null
  emessoIl: Date;
  operatore: string;
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const bytes = leggiFont();
  const f: Font = { regolare: await pdf.embedFont(bytes.regolare, { subset: true }), grassetto: await pdf.embedFont(bytes.grassetto, { subset: true }) };
  pdf.setTitle("Estratto del registro degli accessi");
  pdf.setAuthor("Omnia Consulting SRLS — OMNIA AI");
  pdf.setLanguage("it-IT");
  pdf.setCreationDate(d.emessoIl);

  const pagine: PDFPage[] = [];
  let pagina!: PDFPage;
  let y = 0;
  const nuovaPagina = () => {
    pagina = pdf.addPage([PAGINA.larghezza, PAGINA.altezza]);
    pagine.push(pagina);
    y = PAGINA.altezza - MARGINE;
  };
  const testo = (t: string, x: number, size: number, font: PDFFont, colore = COLORE_TESTO) => pagina.drawText(t, { x, y, size, font, color: colore });
  const paragrafo = (t: string, size: number, font: PDFFont, colore = COLORE_TESTO, larghezza = LARGHEZZA_UTILE) => {
    for (const riga of aCapo(t, font, size, larghezza)) {
      if (y - size < FONDO_UTILE) nuovaPagina();
      y -= size;
      testo(riga, MARGINE, size, font, colore);
      y -= size * (INTERLINEA - 1);
    }
  };

  nuovaPagina();

  // Testata
  paragrafo("Estratto del registro degli accessi", 17, f.grassetto);
  y -= 4;
  paragrafo(SOTTOTITOLO_ESTRATTO, 8.5, f.regolare, COLORE_FIOCO);
  y -= 14;

  // Dati dell'estratto, su due colonne
  const periodoTesto = d.periodo.da || d.periodo.a ? `${d.periodo.da ?? "inizio del registro"} – ${d.periodo.a ?? "oggi"}` : "tutto il periodo coperto dal registro";
  const dati: [string, string][] = [
    ["CLIENTE", d.cliente.email ?? "(utente non più presente)"],
    ["PERIODO", periodoTesto],
    ["ESTRATTO EMESSO IL", `${dataOraRoma(d.emessoIl)} (ora di Roma) da ${d.operatore}`],
  ];
  const meta = LARGHEZZA_UTILE / 2;
  for (let i = 0; i < dati.length; i += 2) {
    const coppia = dati.slice(i, i + 2);
    const yInizio = y;
    let yMin = y;
    coppia.forEach(([etichetta, valore], j) => {
      y = yInizio;
      const x = MARGINE + j * meta;
      y -= 7.5;
      pagina.drawText(etichetta, { x, y, size: 7.5, font: f.grassetto, color: COLORE_FIOCO });
      y -= 5;
      for (const riga of aCapo(valore, f.regolare, 10, meta - 16)) {
        y -= 10;
        pagina.drawText(riga, { x, y, size: 10, font: f.regolare, color: COLORE_TESTO });
        y -= 3;
      }
      yMin = Math.min(yMin, y);
    });
    y = yMin - 10;
  }

  const generali = d.righe.filter((r) => r.tuttiIClienti).length;
  paragrafo(frasePrincipaleEstratto(d.righe.length, generali, d.periodo), 11, f.grassetto);
  y -= 14;

  // Tabella
  if (d.righe.length > 0) {
    const larghezze = COLONNE.map((c) => c.quota * LARGHEZZA_UTILE);
    const lineaRiga = CORPO * INTERLINEA;

    const disegnaRiga = (celle: Cella[], intestazione: boolean) => {
      const font = intestazione ? f.grassetto : f.regolare;
      const size = intestazione ? 7.5 : CORPO;
      const altezze = celle.map((c) => c.righe.length * (intestazione ? 7.5 * INTERLINEA : lineaRiga) + (c.piccole?.length ?? 0) * 7.5 * INTERLINEA);
      const altezza = Math.max(...altezze) + 2 * PADDING_CELLA;
      if (intestazione) pagina.drawRectangle({ x: MARGINE, y: y - altezza, width: LARGHEZZA_UTILE, height: altezza, color: COLORE_FONDO });
      let x = MARGINE;
      celle.forEach((c, i) => {
        let yc = y - PADDING_CELLA;
        for (const r of c.righe) {
          yc -= size;
          pagina.drawText(r, { x: x + PADDING_CELLA, y: yc, size, font, color: intestazione ? COLORE_FIOCO : COLORE_TESTO });
          yc -= size * (INTERLINEA - 1);
        }
        for (const r of c.piccole ?? []) {
          yc -= 7.5;
          pagina.drawText(r, { x: x + PADDING_CELLA, y: yc, size: 7.5, font: f.regolare, color: COLORE_FIOCO });
          yc -= 7.5 * (INTERLINEA - 1);
        }
        x += larghezze[i];
      });
      y -= altezza;
      pagina.drawLine({ start: { x: MARGINE, y }, end: { x: MARGINE + LARGHEZZA_UTILE, y }, thickness: 0.6, color: COLORE_LINEA });
    };

    const intestazione: Cella[] = COLONNE.map((c, i) => ({ righe: aCapo(c.titolo, f.grassetto, 7.5, larghezze[i] - 2 * PADDING_CELLA) }));
    const altezzaIntestazione = () => Math.max(...intestazione.map((c) => c.righe.length)) * 7.5 * INTERLINEA + 2 * PADDING_CELLA;
    const iniziaTabella = () => {
      pagina.drawLine({ start: { x: MARGINE, y }, end: { x: MARGINE + LARGHEZZA_UTILE, y }, thickness: 0.6, color: COLORE_LINEA });
      disegnaRiga(intestazione, true);
    };
    if (y - altezzaIntestazione() - 3 * lineaRiga < FONDO_UTILE) nuovaPagina();
    iniziaTabella();

    for (const r of d.righe) {
      const valori = [
        dataOraRoma(r.accessoIl),
        r.operatoreEmail,
        testoCaso(r.caso),
        r.tuttiIClienti ? "Accesso generale al database" : "I suoi dati",
        r.ambito,
        r.motivo,
      ];
      const celle: Cella[] = valori.map((v, i) => ({ righe: aCapo(v, f.regolare, CORPO, larghezze[i] - 2 * PADDING_CELLA) }));
      if (Math.abs(Date.parse(r.creatoIl) - Date.parse(r.accessoIl)) > 5 * 60_000) celle[0].piccole = aCapo(`registrato il ${dataOraRoma(r.creatoIl)}`, f.regolare, 7.5, larghezze[0] - 2 * PADDING_CELLA);
      const altezza = Math.max(...celle.map((c) => c.righe.length * lineaRiga + (c.piccole?.length ?? 0) * 7.5 * INTERLINEA)) + 2 * PADDING_CELLA;
      if (y - altezza < FONDO_UTILE) {
        nuovaPagina();
        iniziaTabella();
      }
      disegnaRiga(celle, false);
    }
    y -= 16;
  }

  paragrafo(NOTA_ESTRATTO, 8, f.regolare, COLORE_FIOCO);

  // Piè di pagina: chi, quando, pagina X di Y
  const piede = pulito(`Estratto del registro degli accessi · ${d.cliente.email ?? "cliente"} · emesso il ${dataOraRoma(d.emessoIl)}`);
  pagine.forEach((p, i) => {
    p.drawText(piede, { x: MARGINE, y: 24, size: 7.5, font: f.regolare, color: COLORE_FIOCO });
    const numero = `Pagina ${i + 1} di ${pagine.length}`;
    p.drawText(numero, { x: PAGINA.larghezza - MARGINE - f.regolare.widthOfTextAtSize(numero, 7.5), y: 24, size: 7.5, font: f.regolare, color: COLORE_FIOCO });
  });

  return pdf.save();
}
