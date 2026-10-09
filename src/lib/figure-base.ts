import { COLORE_PIENO, COLORE_PRIMARIO, schiarisciColore, type TipoSemantico } from "@/lib/colori-semantici";

// Base comune dei disegnatori di figure (organigramma e archetipi): primitive
// di disegno in "unità di disegno" su una griglia larga 680, colori R20,
// contrasto del testo, a capo del testo. PURO: nessun canvas. La misura del
// testo arriva da fuori (il disegno vero usa il font caricato, i test e la
// stima delle pagine una misura approssimata), così la stessa funzione di
// layout serve al disegno e alla stima di quante pagine occuperà.
//
// Regole comuni a tutte le figure: disegno da codice convertito in immagine;
// colori secondo la corrispondenza fissa R20 (verde ambiente, arancio
// sicurezza, blu primario, grigi neutri); il modello non indica mai colori,
// coordinate o dimensioni; contrasto verificato (testo bianco o scuro in base
// al fondo, mai chiaro su chiaro né scuro su scuro); adattamento automatico
// quando gli elementi superano lo spazio, riducendo corpo e larghezza invece
// di sforare.

export type Misura = (testo: string, size: number, bold: boolean) => number;

export type Prim =
  | { t: "rect"; x: number; y: number; w: number; h: number; r?: number; fill?: string; stroke?: string; sw?: number; dash?: [number, number] }
  | { t: "linea"; punti: [number, number][]; colore: string; sw: number; dash?: [number, number]; frecce?: "entrambe" | "fine" }
  | { t: "testo"; x: number; y: number; testo: string; size: number; bold: boolean; colore: string; ancora: "inizio" | "centro" | "fine" }
  | { t: "poligono"; punti: [number, number][]; fill: string; stroke?: string; sw?: number }
  | { t: "cerchio"; cx: number; cy: number; r: number; fill?: string; stroke?: string; sw?: number }
  | { t: "logo"; id: "impresa" | "committente"; x: number; y: number; w: number; h: number };

export const LARGHEZZA_DISEGNO = 680;

export const C = {
  primario: `#${COLORE_PRIMARIO}`,
  navy: "#1B4F72",
  testoScuro: "#1B2631",
  testoBlu: "#154360",
  dettaglioBlu: "#1F618D",
  linea: "#8A97A3",
  lineaScura: "#5D6D7E",
  grigioTesto: "#5D6D7E",
  bandaFill: "#F3F6F9",
  bandaBordo: "#DDE4EA",
  neutroFill: "#EEF1F4",
  bannerFill: "#E5E8EB",
  bianco: "#FFFFFF",
  sicurezza: `#${COLORE_PIENO.SICUREZZA}`,
  ambiente: `#${COLORE_PIENO.AMBIENTE}`,
  // Rosso: riservato a «da compilare» nel documento; nelle figure compare solo
  // nel badge di scostamento del cruscotto illustrativo, sempre con un simbolo.
  rosso: "#C0392B",
} as const;

export const tinta = (hex: string, frazione: number) => `#${schiarisciColore(hex.replace("#", ""), frazione)}`;

// Colore pieno di un tipo semantico (R20) per riempire una casella.
export function pienoSemantico(tipo: TipoSemantico): string {
  return `#${COLORE_PIENO[tipo]}`;
}

// ─── Contrasto ───
function luminanza(hex: string): number {
  const canali = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * canali[0] + 0.7152 * canali[1] + 0.0722 * canali[2];
}
export function contrasto(a: string, b: string): number {
  const la = luminanza(a);
  const lb = luminanza(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
// Fra bianco e testo scuro sceglie quello che contrasta di più con lo sfondo.
export function testoSu(fill: string): string {
  return contrasto(C.bianco, fill) >= contrasto(C.testoScuro, fill) ? C.bianco : C.testoScuro;
}

// ─── Testo ───
export type Riga = { testo: string; size: number; bold: boolean; colore: string };

// Parole che non vanno separate a capo: un numero (con eventuale segno di
// confronto) resta unito a ciò che lo segue («4 h», «30 giorni», «≥ 99 %»), e
// l'asterisco del valore proposto resta unito alla parola che lo precede.
const NUMERO_O_CONFRONTO = /^(?:[≤≥<>~±+]|[≤≥<>~±+]?\d[\d.,:/]*)$/;
const SEGNO_ATTACCATO = /^(?:%|‰|\*[,.;:)]?)$/;
function paroleUnite(testo: string): string[] {
  const parole: string[] = [];
  for (const p of testo.split(/[ \t\r\n]+/).filter(Boolean)) {
    const prec = parole[parole.length - 1];
    if (prec !== undefined && (SEGNO_ATTACCATO.test(p) || NUMERO_O_CONFRONTO.test(prec))) parole[parole.length - 1] = `${prec} ${p}`;
    else parole.push(p);
  }
  return parole;
}

export function avvolgi(testo: string, maxW: number, size: number, bold: boolean, misura: Misura, maxRighe: number): string[] {
  const parole = paroleUnite(testo);
  const righe: string[] = [];
  let corrente = "";
  let i = 0;
  while (i < parole.length && righe.length < maxRighe) {
    const candidata = corrente ? `${corrente} ${parole[i]}` : parole[i];
    if (misura(candidata, size, bold) <= maxW) {
      corrente = candidata;
      i++;
    } else if (!corrente) {
      // parola più larga della riga: si spezza
      let pezzo = parole[i];
      while (pezzo.length > 1 && misura(pezzo, size, bold) > maxW) pezzo = pezzo.slice(0, -1);
      righe.push(pezzo);
      parole[i] = parole[i].slice(pezzo.length);
      if (!parole[i]) i++;
    } else {
      righe.push(corrente);
      corrente = "";
    }
  }
  if (corrente && righe.length < maxRighe) righe.push(corrente);
  if (i < parole.length) {
    let ultima = righe[righe.length - 1] ?? "";
    while (ultima.length > 1 && misura(`${ultima}…`, size, bold) > maxW) ultima = ultima.slice(0, -1);
    righe[righe.length - 1] = `${ultima.replace(/[\s,;:]+$/, "")}…`;
  }
  return (righe.length ? righe : [""]).map((r) => r.replace(/ /g, " "));
}

export const INTERLINEA = 1.38;

export function altezzaRighe(righe: Riga[]): number {
  return righe.reduce((t, r) => t + r.size * INTERLINEA, 0);
}

// Misura approssimata (senza canvas): serve alla stima delle pagine, che non
// deve caricare il motore di disegno. Il disegno vero usa la misura del font.
export const misuraApprossimata: Misura = (testo, size, bold) => testo.length * size * (bold ? 0.58 : 0.53);

// ─── Costruzione ───
export class Disegno {
  prims: Prim[] = [];
  valoriProposti = false;
  constructor(public misura: Misura) {}

  rect(p: Omit<Extract<Prim, { t: "rect" }>, "t">) {
    this.prims.push({ t: "rect", ...p });
  }
  linea(punti: [number, number][], colore: string = C.linea, sw = 1.2, dash?: [number, number], frecce?: "entrambe" | "fine") {
    this.prims.push({ t: "linea", punti, colore, sw, dash, frecce });
  }
  poligono(punti: [number, number][], fill: string, stroke?: string, sw?: number) {
    this.prims.push({ t: "poligono", punti, fill, stroke, sw });
  }
  cerchio(cx: number, cy: number, r: number, fill?: string, stroke?: string, sw?: number) {
    this.prims.push({ t: "cerchio", cx, cy, r, fill, stroke, sw });
  }
  testo(x: number, y: number, testo: string, size: number, bold: boolean, colore: string, ancora: "inizio" | "centro" | "fine" = "centro") {
    if (/\s\*(?:\s|$)/.test(testo)) this.valoriProposti = true;
    this.prims.push({ t: "testo", x, y, testo, size, bold, colore, ancora });
  }

  // Banda grigia a tutta larghezza con un titolo e, facoltativa, una descrizione
  // (il principio che tiene insieme lo schema). Ritorna l'altezza.
  banda(x: number, y: number, w: number, titolo: string, descrizione?: string): number {
    const righe: Riga[] = [{ testo: titolo, size: 14, bold: true, colore: C.testoScuro }];
    if (descrizione) for (const t of avvolgi(descrizione, w - 28, 12, false, this.misura, 3)) righe.push({ testo: t, size: 12, bold: false, colore: C.testoScuro });
    const h = 18 + altezzaRighe(righe);
    this.rect({ x, y, w, h, r: 8, fill: C.bannerFill });
    let cursore = y + (h - altezzaRighe(righe)) / 2;
    for (const r of righe) {
      const hr = r.size * INTERLINEA;
      this.testo(x + w / 2, cursore + hr / 2, r.testo, r.size, r.bold, r.colore);
      cursore += hr;
    }
    return h;
  }

  // Casella con righe di testo centrate. Ritorna l'altezza.
  scatola(x: number, y: number, w: number, righe: Riga[], stile: { fill?: string; stroke?: string; sw?: number; r?: number; dash?: [number, number]; padV?: number }): number {
    const padV = stile.padV ?? 9;
    const h = padV * 2 + altezzaRighe(righe);
    this.rect({ x, y, w, h, r: stile.r ?? 7, fill: stile.fill, stroke: stile.stroke, sw: stile.sw ?? 1.2, dash: stile.dash });
    let cursore = y + padV;
    for (const r of righe) {
      const hr = r.size * INTERLINEA;
      this.testo(x + w / 2, cursore + hr / 2, r.testo, r.size, r.bold, r.colore);
      cursore += hr;
    }
    return h;
  }

  // Righe di una figura: denominazione (grassetto, a capo) e nominativo fra
  // parentesi in grassetto.
  righeFigura(denominazione: string, nominativo: string | undefined, w: number, size: number, colore: string, coloreDettaglio: string, maxRighe = 3): Riga[] {
    const righe: Riga[] = avvolgi(denominazione, w - 18, size, true, this.misura, maxRighe).map((t) => ({ testo: t, size, bold: true, colore }));
    if (nominativo) {
      for (const t of avvolgi(`(${nominativo})`, w - 18, size - 1, true, this.misura, 2)) righe.push({ testo: t, size: size - 1, bold: true, colore: coloreDettaglio });
    }
    return righe;
  }

  // Righe di una casella con titolo (grassetto) e dettaglio (regolare), a capo
  // nella larghezza data. Ritorna anche l'altezza totale del testo.
  righeTitoloDettaglio(titolo: string, dettaglio: string | undefined, w: number, colori: { titolo: string; dettaglio: string }, opzioni: { sizeTitolo?: number; sizeDettaglio?: number; maxTitolo?: number; maxDettaglio?: number } = {}): Riga[] {
    const sT = opzioni.sizeTitolo ?? 12;
    const sD = opzioni.sizeDettaglio ?? 12;
    const righe: Riga[] = avvolgi(titolo, w - 16, sT, true, this.misura, opzioni.maxTitolo ?? 3).map((t) => ({ testo: t, size: sT, bold: true, colore: colori.titolo }));
    if (dettaglio) for (const t of avvolgi(dettaglio, w - 16, sD, false, this.misura, opzioni.maxDettaglio ?? 4)) righe.push({ testo: t, size: sD, bold: false, colore: colori.dettaglio });
    return righe;
  }
}

export type Posizione = { x: number; y: number; w: number; h: number };
export const centroX = (p: Posizione) => p.x + p.w / 2;
export const centroY = (p: Posizione) => p.y + p.h / 2;

export type LayoutFigura = { larghezza: number; altezza: number; prims: Prim[]; valoriProposti: boolean };

// Stile di una casella per tipo semantico (R20): colore pieno con testo scelto
// dal contrasto. Senza tipo, lo stile neutro passato.
export function stileSemantico(tipo: TipoSemantico | undefined, neutro: { fill: string; stroke?: string; testo: string; dettaglio: string }): { fill: string; stroke?: string; testo: string; dettaglio: string } {
  if (!tipo) return neutro;
  const fill = pienoSemantico(tipo);
  const testo = testoSu(fill);
  return { fill, stroke: fill, testo, dettaglio: testo };
}

