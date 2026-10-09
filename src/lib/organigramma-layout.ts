import { COLORE_PIENO, COLORE_PRIMARIO, schiarisciColore } from "@/lib/colori-semantici";
import type { DatiOrganigramma, StaffGoverno, TipoStaff, VoceElenco, Zona } from "@/lib/organigramma-dati";

// Layout PURO dell'organigramma di commessa: da DatiOrganigramma a un elenco di
// primitive di disegno (rettangoli, linee, testi) in "unità di disegno" su una
// griglia larga 680. Nessun canvas qui: la misura del testo arriva da fuori
// (organigramma-disegno.ts usa il font vero, i test e la stima delle pagine
// una misura approssimata), così la stessa funzione serve al disegno e alla
// stima di quante pagine occuperà.
//
// Grammatica (specifica "organigramma di commessa", ricavata da organigrammi
// reali): fasce orizzontali con etichetta a sinistra — Direzione, Governo,
// Coordinamento e operativo; marchio dell'impresa al centro in alto e
// committente a destra, con linea tratteggiata etichettata RUP/DEC/RUP-DEC
// (interfaccia contrattuale, non gerarchia); riquadri elenco ai lati; figura
// apicale con lo staff AI LATI (mai sotto) collegato da connettori
// orizzontali; coordinatori di zona con capisquadra e addetti sotto; banda
// conclusiva a piena larghezza. Colori decisi dal codice con le regole R20
// (verde ambiente, arancio sicurezza, blu primario, grigio neutro per ciò che
// non è un ruolo); il modello non indica mai colori, coordinate o dimensioni.

export type Misura = (testo: string, size: number, bold: boolean) => number;

export type Prim =
  | { t: "rect"; x: number; y: number; w: number; h: number; r?: number; fill?: string; stroke?: string; sw?: number; dash?: [number, number] }
  | { t: "linea"; punti: [number, number][]; colore: string; sw: number; dash?: [number, number]; frecce?: "entrambe" }
  | { t: "testo"; x: number; y: number; testo: string; size: number; bold: boolean; colore: string; ancora: "inizio" | "centro" }
  | { t: "logo"; id: "impresa" | "committente"; x: number; y: number; w: number; h: number };

export type LayoutOrganigramma = { larghezza: number; altezza: number; prims: Prim[]; valoriProposti: boolean };

export type OpzioniLayout = {
  misura: Misura;
  // Dimensioni (in unità di disegno) dei loghi disponibili: se presenti
  // sostituiscono il nome dell'impresa / del committente.
  loghi?: { impresa?: { w: number; h: number }; committente?: { w: number; h: number } };
};

export const LARGHEZZA_DISEGNO = 680;
const AREA_X = 120;
const AREA_W = 552;
const PAD = 8;
const GAP_BANDE = 8;
const INTERNO_W = AREA_W - 2 * PAD;
const MARGINE_ALTO = 12;

const C = {
  primario: `#${COLORE_PRIMARIO}`,
  navy: "#1B4F72",
  testoScuro: "#1B2631",
  testoBlu: "#154360",
  dettaglioBlu: "#1F618D",
  linea: "#8A97A3",
  grigioTesto: "#5D6D7E",
  bandaFill: "#F3F6F9",
  bandaBordo: "#DDE4EA",
  neutroFill: "#EEF1F4",
  bannerFill: "#E5E8EB",
  bianco: "#FFFFFF",
  sicurezza: `#${COLORE_PIENO.SICUREZZA}`,
  ambiente: `#${COLORE_PIENO.AMBIENTE}`,
} as const;

const tinta = (hex: string, frazione: number) => `#${schiarisciColore(hex.replace("#", ""), frazione)}`;

// ─── Contrasto (il testo non è mai chiaro su fondo chiaro né scuro su scuro) ───
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
type Riga = { testo: string; size: number; bold: boolean; colore: string };

function avvolgi(testo: string, maxW: number, size: number, bold: boolean, misura: Misura, maxRighe: number): string[] {
  const parole = testo.split(/\s+/).filter(Boolean);
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
  return righe.length ? righe : [""];
}

const INTERLINEA = 1.38;

function altezzaRighe(righe: Riga[]): number {
  return righe.reduce((t, r) => t + r.size * INTERLINEA, 0);
}

// ─── Costruzione ───
class Disegno {
  prims: Prim[] = [];
  valoriProposti = false;
  constructor(public misura: Misura) {}

  rect(p: Omit<Extract<Prim, { t: "rect" }>, "t">) {
    this.prims.push({ t: "rect", ...p });
  }
  linea(punti: [number, number][], colore = C.linea, sw = 1.2, dash?: [number, number], frecce?: "entrambe") {
    this.prims.push({ t: "linea", punti, colore, sw, dash, frecce });
  }
  testo(x: number, y: number, testo: string, size: number, bold: boolean, colore: string, ancora: "inizio" | "centro" = "centro") {
    if (/\s\*(?:\s|$)/.test(testo)) this.valoriProposti = true;
    this.prims.push({ t: "testo", x, y, testo, size, bold, colore, ancora });
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
}

type Posizione = { x: number; y: number; w: number; h: number };
const centroX = (p: Posizione) => p.x + p.w / 2;

function etichettaFascia(d: Disegno, yFascia: number, hFascia: number, righe: string[]) {
  const altezzaTesto = righe.length * 17;
  const yCentro = yFascia + hFascia / 2;
  d.rect({ x: 8, y: yCentro - altezzaTesto / 2 - 3, w: 4, h: altezzaTesto + 6, fill: C.primario });
  righe.forEach((r, i) => d.testo(18, yCentro - altezzaTesto / 2 + 8.5 + i * 17, r, 12, true, C.navy, "inizio"));
}

function sfondoFascia(d: Disegno, y: number, h: number) {
  d.rect({ x: AREA_X, y, w: AREA_W, h, fill: C.bandaFill, stroke: C.bandaBordo, sw: 0.5, r: 0 });
}

// ─── Fascia di direzione ───
function fasciaDirezione(d: Disegno, dati: DatiOrganigramma, y0: number, loghi: OpzioniLayout["loghi"]): number {
  const imprese = dati.imprese;
  const committente = dati.committente;
  const riquadri = dati.riquadriElenco ?? [];
  const conLogo = !!(loghi?.impresa || loghi?.committente);
  if (!committente && riquadri.length === 0 && !conLogo) return 0;

  // Riga A: marchio/i dell'impresa al centro, committente a destra.
  const hA = 52;
  const yA = y0 + 14;
  const misura = d.misura;

  const dimensioniMarchi = imprese.map((im, i) => {
    if (i === 0 && loghi?.impresa) {
      const s = Math.min(44 / loghi.impresa.h, 130 / loghi.impresa.w, 1.6);
      return { w: loghi.impresa.w * s + 16, logo: { w: loghi.impresa.w * s, h: loghi.impresa.h * s } };
    }
    const nome = im.denominazione;
    return { w: Math.min(170, Math.max(110, misura(nome, 14, true) + 26)), logo: null };
  });
  const gapMarchi = 12;
  const larghezzaMarchi = dimensioniMarchi.reduce((t, m) => t + m.w, 0) + gapMarchi * Math.max(0, dimensioniMarchi.length - 1);

  let committenteBox: Posizione | null = null;
  let righeCommittente: Riga[] = [];
  let logoCommittente: { w: number; h: number } | null = null;
  if (committente) {
    const wC = 190;
    if (loghi?.committente) {
      const s = Math.min(38 / loghi.committente.h, 120 / loghi.committente.w, 1.6);
      logoCommittente = { w: loghi.committente.w * s, h: loghi.committente.h * s };
    }
    righeCommittente = avvolgi(committente.denominazione, wC - 20, 12, true, misura, 3).map((t) => ({ testo: t, size: 12, bold: true, colore: C.testoScuro }));
    righeCommittente.push({ testo: "committente", size: 12, bold: false, colore: C.grigioTesto });
    const hC = Math.max(hA, 18 + altezzaRighe(righeCommittente) + (logoCommittente ? logoCommittente.h + 4 : 0));
    committenteBox = { x: AREA_X + AREA_W - PAD - wC, y: yA, w: wC, h: hC };
  }

  // Marchi centrati sull'area, spostati a sinistra se invaderebbero il
  // committente (resta almeno una linea di interfaccia visibile).
  const centro = AREA_X + AREA_W / 2;
  let xMarchi = centro - larghezzaMarchi / 2;
  if (committenteBox) xMarchi = Math.min(xMarchi, committenteBox.x - 34 - larghezzaMarchi);
  xMarchi = Math.max(xMarchi, AREA_X + PAD);

  let xCorrente = xMarchi;
  let ultimoMarchio: Posizione | null = null;
  imprese.forEach((im, i) => {
    const dim = dimensioniMarchi[i];
    const box: Posizione = { x: xCorrente, y: yA, w: dim.w, h: hA };
    d.rect({ ...box, r: 8, fill: C.bianco, stroke: C.navy, sw: 1.2 });
    if (dim.logo) {
      d.prims.push({ t: "logo", id: "impresa", x: box.x + (box.w - dim.logo.w) / 2, y: box.y + (box.h - dim.logo.h) / 2, w: dim.logo.w, h: dim.logo.h });
    } else {
      const righe = avvolgi(im.denominazione, dim.w - 16, 14, true, misura, 2);
      const hTesto = righe.length * 14 * INTERLINEA + (im.ruolo ? 12 * INTERLINEA : 0);
      let cy = box.y + (box.h - hTesto) / 2;
      for (const r of righe) {
        d.testo(centroX(box), cy + (14 * INTERLINEA) / 2, r, 14, true, C.navy);
        cy += 14 * INTERLINEA;
      }
      if (im.ruolo) d.testo(centroX(box), cy + (12 * INTERLINEA) / 2, im.ruolo, 12, false, C.grigioTesto);
    }
    ultimoMarchio = box;
    xCorrente += dim.w + gapMarchi;
  });

  let bottomA = yA + hA;
  if (committenteBox) {
    const cb = committenteBox;
    d.rect({ ...cb, r: 8, fill: C.neutroFill, stroke: C.linea, sw: 1.2 });
    let cy = cb.y + 9;
    if (logoCommittente) {
      d.prims.push({ t: "logo", id: "committente", x: cb.x + (cb.w - logoCommittente.w) / 2, y: cy, w: logoCommittente.w, h: logoCommittente.h });
      cy += logoCommittente.h + 4;
    }
    for (const r of righeCommittente) {
      d.testo(centroX(cb), cy + (r.size * INTERLINEA) / 2, r.testo, r.size, r.bold, r.colore);
      cy += r.size * INTERLINEA;
    }
    bottomA = Math.max(bottomA, cb.y + cb.h);
    const ultimo = ultimoMarchio as Posizione | null;
    if (ultimo && committente?.tipoInterfaccia) {
      const yLinea = yA + hA / 2;
      d.linea([[ultimo.x + ultimo.w, yLinea], [cb.x, yLinea]], C.linea, 1.5, [5, 3]);
      d.testo((ultimo.x + ultimo.w + cb.x) / 2, bottomA + 13, committente.tipoInterfaccia, 12, true, C.grigioTesto);
      bottomA += 22;
    }
  }

  // Riga B: riquadri elenco ai lati, doppia freccia fra i due.
  let yFine = bottomA;
  if (riquadri.length > 0) {
    const yB = bottomA + 12;
    const sinistra = riquadri.find((r) => r.posizione === "sinistra");
    const destra = riquadri.find((r) => r.posizione === "destra");
    const gapFreccia = 36;
    const wR = sinistra && destra ? (INTERNO_W - gapFreccia) / 2 : Math.min(260, INTERNO_W / 2 - gapFreccia / 2);
    const disegna = (r: { titolo: string; voci: VoceElenco[] }, x: number): Posizione => {
      const hTitolo = 26;
      const hVoce = 18;
      const h = hTitolo + 10 + Math.max(1, r.voci.length) * hVoce + 4;
      d.rect({ x, y: yB, w: wR, h, r: 8, fill: C.bianco, stroke: C.primario, sw: 1.2 });
      d.rect({ x, y: yB, w: wR, h: hTitolo, r: 8, fill: C.primario });
      d.rect({ x, y: yB + hTitolo - 8, w: wR, h: 8, fill: C.primario });
      d.testo(x + wR / 2, yB + hTitolo / 2, r.titolo, 12, true, testoSu(C.primario));
      r.voci.forEach((v, i) => {
        const yv = yB + hTitolo + 10 + i * hVoce + hVoce / 2;
        const base = `• ${v.funzione}`;
        const wBase = d.misura(base, 12, false);
        if (v.nominativo) {
          const nom = ` (${v.nominativo})`;
          const disp = wR - 24;
          if (wBase + d.misura(nom, 12, true) <= disp) {
            d.testo(x + 12, yv, base, 12, false, C.testoBlu, "inizio");
            d.testo(x + 12 + wBase, yv, nom, 12, true, C.testoBlu, "inizio");
            return;
          }
        }
        d.testo(x + 12, yv, avvolgi(base, wR - 24, 12, false, d.misura, 1)[0], 12, false, C.testoBlu, "inizio");
      });
      return { x, y: yB, w: wR, h };
    };
    const xSx = AREA_X + PAD;
    const xDx = AREA_X + AREA_W - PAD - wR;
    const pS = sinistra ? disegna(sinistra, xSx) : null;
    const pD = destra ? disegna(destra, xDx) : null;
    if (pS && pD) {
      const yFreccia = yB + Math.min(pS.h, pD.h) / 2;
      d.linea([[pS.x + pS.w + 4, yFreccia], [pD.x - 4, yFreccia]], C.linea, 1.2, undefined, "entrambe");
    }
    yFine = yB + Math.max(pS?.h ?? 0, pD?.h ?? 0);
  }
  return yFine - y0 + 14;
}

// ─── Fascia di governo ───
const STAFF_SINISTRA: TipoStaff[] = ["sicurezza", "diversity", "tutor"];

type StaffDisegno = StaffGoverno | { denominazione: string; nominativo?: string; tipo: "vice" };

function stileStaff(tipo: TipoStaff | "vice"): { fill: string; stroke: string; testo: string; dettaglio: string } {
  if (tipo === "sicurezza") return { fill: C.sicurezza, stroke: C.sicurezza, testo: testoSu(C.sicurezza), dettaglio: testoSu(C.sicurezza) };
  if (tipo === "ambiente" || tipo === "cam") return { fill: C.ambiente, stroke: C.ambiente, testo: testoSu(C.ambiente), dettaglio: testoSu(C.ambiente) };
  if (tipo === "qualita" || tipo === "vice") return { fill: C.bianco, stroke: C.primario, testo: C.testoBlu, dettaglio: C.dettaglioBlu };
  return { fill: C.bianco, stroke: C.linea, testo: C.testoScuro, dettaglio: C.grigioTesto };
}

function ripartisciStaff(staff: StaffDisegno[]): { sinistra: StaffDisegno[]; destra: StaffDisegno[] } {
  const sinistra: StaffDisegno[] = [];
  const destra: StaffDisegno[] = [];
  for (const s of staff) (STAFF_SINISTRA.includes(s.tipo as TipoStaff) || s.tipo === "vice" ? sinistra : destra).push(s);
  while (sinistra.length - destra.length > 1) destra.push(sinistra.pop() as StaffDisegno);
  while (destra.length - sinistra.length > 1) sinistra.push(destra.pop() as StaffDisegno);
  return { sinistra, destra };
}

type UscitaGoverno = { x: number; y: number };

function fasciaGoverno(d: Disegno, dati: DatiOrganigramma, y0: number): { altezza: number; uscita: UscitaGoverno } {
  const misura = d.misura;
  const staff: StaffDisegno[] = [...(dati.staffGoverno ?? [])];
  if (dati.vice) staff.unshift({ ...dati.vice, tipo: "vice" });
  const { sinistra, destra } = ripartisciStaff(staff);

  const esterni: { denominazione: string; etichetta: string }[] = [];
  if (dati.referenteCommittente) esterni.push({ denominazione: dati.referenteCommittente.denominazione, etichetta: "Referente del committente" });
  for (const s of dati.strumentiEsterni ?? []) esterni.push({ denominazione: s.denominazione, etichetta: s.tipo === "call_center" ? "Call center" : "Piattaforma" });

  const gap = 22;
  // Larghezza di una colonna di caselle: quanto serve alla parola più lunga
  // (mai una parola spezzata a metà), fra un minimo e un massimo.
  const parolaPiuLunga = (testi: string[], size: number, bold: boolean) =>
    Math.max(0, ...testi.flatMap((t) => t.split(/\s+/).filter(Boolean)).map((p) => misura(p, size, bold)));
  const nominativi = (lista: StaffDisegno[]) => lista.filter((s) => s.nominativo).map((s) => `(${s.nominativo})`);
  let wStaff = Math.min(150, Math.max(96, parolaPiuLunga([...staff.map((s) => s.denominazione), ...nominativi(staff)], 12, true) + 22));
  let wEsterni = Math.min(130, Math.max(92, parolaPiuLunga(esterni.flatMap((e) => [e.denominazione, e.etichetta]), 12, true) + 20));
  const colonne = () => (sinistra.length ? wStaff + gap : 0) + (destra.length ? gap + wStaff : 0) + (esterni.length ? gap + wEsterni : 0);
  const titoloApicale = dati.figuraApicale.denominazione;
  const apicaleDesiderata = Math.min(230, Math.max(160, misura(titoloApicale, 14, true) + 28));
  // Le colonne laterali hanno la larghezza che serve alla parola più lunga:
  // è l'apicale, che può andare a capo, a cedere spazio. Solo se resterebbe
  // sotto il minimo (140) le colonne si stringono, fino a 88/84.
  while (INTERNO_W - colonne() < 140 && (wStaff > 88 || wEsterni > 84)) {
    wStaff = Math.max(88, wStaff - 4);
    wEsterni = Math.max(84, wEsterni - 4);
  }
  const wApicale = Math.max(140, Math.min(apicaleDesiderata, INTERNO_W - colonne()));

  // Altezze delle colonne.
  const righeStaff = (s: StaffDisegno) => {
    const st = stileStaff(s.tipo);
    return d.righeFigura(s.denominazione, s.nominativo, wStaff, 12, st.testo, st.dettaglio);
  };
  const hStaff = (s: StaffDisegno) => 16 + altezzaRighe(righeStaff(s));
  const stackH = (lista: StaffDisegno[]) => lista.reduce((t, s) => t + hStaff(s), 0) + Math.max(0, lista.length - 1) * 8;
  const righeApicale = d.righeFigura(titoloApicale, dati.figuraApicale.nominativo, wApicale, 14, testoSu(C.primario), testoSu(C.primario));
  const hApicale = 18 + altezzaRighe(righeApicale);
  const righeEsterno = (e: { denominazione: string; etichetta: string }): Riga[] => [
    ...avvolgi(e.etichetta, wEsterni - 14, 11, false, misura, 2).map((t) => ({ testo: t, size: 11, bold: false, colore: C.grigioTesto })),
    ...avvolgi(e.denominazione, wEsterni - 14, 12, true, misura, 3).map((t) => ({ testo: t, size: 12, bold: true, colore: C.testoScuro })),
  ];
  const hEsterno = (e: { denominazione: string; etichetta: string }) => 16 + altezzaRighe(righeEsterno(e));
  const stackE = esterni.reduce((t, e) => t + hEsterno(e), 0) + Math.max(0, esterni.length - 1) * 8;

  const hRiga = Math.max(hApicale, stackH(sinistra), stackH(destra), stackE);
  const lane = 24; // spazio sopra le caselle per il tratteggio verso il referente del committente
  const cy = y0 + lane + hRiga / 2;

  const larghezzaGruppo = (sinistra.length ? wStaff + gap : 0) + wApicale + (destra.length ? gap + wStaff : 0) + (esterni.length ? gap + wEsterni : 0);
  const centroArea = AREA_X + AREA_W / 2;
  const sinistraW = sinistra.length ? wStaff + gap : 0;
  let xInizio = centroArea - (sinistraW + wApicale / 2);
  xInizio = Math.min(Math.max(xInizio, AREA_X + PAD), AREA_X + AREA_W - PAD - larghezzaGruppo);

  const xApicale = xInizio + sinistraW;
  const apicale: Posizione = { x: xApicale, y: cy - hApicale / 2, w: wApicale, h: hApicale };

  // Connettori laterali (prima delle caselle, per stare sotto).
  const collega = (lista: StaffDisegno[], lato: "sx" | "dx") => {
    if (!lista.length) return;
    const xBordoApicale = lato === "sx" ? apicale.x : apicale.x + apicale.w;
    const xColonna = lato === "sx" ? apicale.x - gap - wStaff : apicale.x + apicale.w + gap;
    const xBordoStaff = lato === "sx" ? xColonna + wStaff : xColonna;
    const altezze = lista.map(hStaff);
    const totale = altezze.reduce((t, h) => t + h, 0) + (lista.length - 1) * 8;
    let yc = cy - totale / 2;
    const centri = altezze.map((h) => {
      const c = yc + h / 2;
      yc += h + 8;
      return c;
    });
    const xTronco = lato === "sx" ? xBordoApicale - gap / 2 : xBordoApicale + gap / 2;
    if (lista.length === 1) {
      d.linea([[xBordoStaff, centri[0]], [xBordoApicale, cy]]);
      return;
    }
    d.linea([[xTronco, centri[0]], [xTronco, centri[centri.length - 1]]]);
    d.linea([[xTronco, cy], [xBordoApicale, cy]]);
    for (const c of centri) d.linea([[xBordoStaff, c], [xTronco, c]]);
  };
  collega(sinistra, "sx");
  collega(destra, "dx");

  const disegnaStack = (lista: StaffDisegno[], xColonna: number) => {
    const altezze = lista.map(hStaff);
    let yc = cy - (altezze.reduce((t, h) => t + h, 0) + (lista.length - 1) * 8) / 2;
    lista.forEach((s, i) => {
      const st = stileStaff(s.tipo);
      d.scatola(xColonna, yc, wStaff, righeStaff(s), { fill: st.fill, stroke: st.stroke, sw: 1.2, padV: 8 });
      yc += altezze[i] + 8;
    });
  };
  if (sinistra.length) disegnaStack(sinistra, apicale.x - gap - wStaff);
  const xDestra = apicale.x + apicale.w + gap;
  if (destra.length) disegnaStack(destra, xDestra);

  d.rect({ ...apicale, r: 8, fill: C.primario });
  {
    let cur = apicale.y + 9;
    for (const r of righeApicale) {
      const hr = r.size * INTERLINEA;
      d.testo(centroX(apicale), cur + hr / 2, r.testo, r.size, r.bold, r.colore);
      cur += hr;
    }
  }

  // Colonna esterna (referente del committente, strumenti): tratteggiata,
  // collegata all'apicale con un percorso che passa SOPRA le caselle di staff.
  if (esterni.length) {
    const xE = xDestra + (destra.length ? wStaff + gap : 0);
    let yc = cy - stackE / 2;
    esterni.forEach((e, i) => {
      const h = hEsterno(e);
      const righe = righeEsterno(e);
      d.rect({ x: xE, y: yc, w: wEsterni, h, r: 7, fill: C.bianco, stroke: C.linea, sw: 1.2, dash: [4, 3] });
      let cur = yc + 8;
      for (const r of righe) {
        const hr = r.size * INTERLINEA;
        d.testo(xE + wEsterni / 2, cur + hr / 2, r.testo, r.size, r.bold, r.colore);
        cur += hr;
      }
      if (i === 0) {
        const yLane = y0 + 10;
        d.linea([[centroX(apicale), apicale.y], [centroX(apicale), yLane], [xE + wEsterni / 2, yLane], [xE + wEsterni / 2, yc]], C.linea, 1.2, [4, 3]);
      } else {
        d.linea([[xE + wEsterni / 2, yc - 8], [xE + wEsterni / 2, yc]], C.linea, 1.2, [4, 3]);
      }
      yc += h + 8;
    });
  }

  let uscita: UscitaGoverno = { x: centroX(apicale), y: apicale.y + apicale.h };
  let bottom = Math.max(cy + hRiga / 2, apicale.y + apicale.h);

  if (dati.centraleOperativa) {
    const c = dati.centraleOperativa;
    const wC = Math.max(wApicale, 170);
    const righe: Riga[] = avvolgi(c.denominazione, wC - 18, 12, true, misura, 2).map((t) => ({ testo: t, size: 12, bold: true, colore: C.testoBlu }));
    if (c.descrizione) for (const t of avvolgi(c.descrizione, wC - 18, 12, false, misura, 3)) righe.push({ testo: t, size: 12, bold: false, colore: C.dettaglioBlu });
    const yC = apicale.y + apicale.h + 18;
    const xC = centroX(apicale) - wC / 2;
    d.linea([[centroX(apicale), apicale.y + apicale.h], [centroX(apicale), yC]]);
    const hC = d.scatola(xC, yC, wC, righe, { fill: tinta(COLORE_PRIMARIO, 0.88), stroke: C.primario, sw: 1, padV: 8 });
    uscita = { x: centroX(apicale), y: yC + hC };
    bottom = Math.max(bottom, yC + hC);
  }
  return { altezza: bottom - y0 + 16, uscita };
}

// ─── Fascia di coordinamento ───
function fasciaCoordinamento(d: Disegno, dati: DatiOrganigramma, y0: number, uscita: UscitaGoverno): number {
  const misura = d.misura;
  const zone = dati.coordinamento;
  const righeZone: Zona[][] = zone.length > 6 ? [zone.slice(0, Math.ceil(zone.length / 2)), zone.slice(Math.ceil(zone.length / 2))] : [zone];
  const fillCoordinatore = tinta(COLORE_PRIMARIO, 0.45);
  const fillOperativo = tinta(COLORE_PRIMARIO, 0.82);

  let yRiga = y0 + 34;
  let busYPrecedente = -1;
  const centriBus: number[][] = [];
  let bottomTotale = yRiga;

  righeZone.forEach((riga, indiceRiga) => {
    const n = riga.length;
    const k = n >= 5 ? 0.86 : n === 4 ? 0.93 : 1;
    const tit = Math.max(11, Math.round(14 * k * 2) / 2);
    const det = Math.max(11, Math.round(12 * k * 2) / 2);
    const gapZona = 10;
    const wZona = (INTERNO_W - gapZona * (n - 1)) / n;
    const ySuperiore = yRiga;
    const centri: number[] = [];
    let altezzaRigaMax = 0;
    const annotazioniZona = (z: Zona): string[] => {
      const parti: string[] = [];
      const sedi = z.sedi ?? [];
      const conteggio = z.numeroSedi ?? sedi.length;
      if (z.presidio && conteggio) parti.push(`Presidio: ${z.presidio} (${conteggio} ${conteggio === 1 ? "sede" : "sedi"})`);
      else if (z.presidio) parti.push(`Presidio: ${z.presidio}`);
      else if (conteggio) parti.push(`${conteggio} ${conteggio === 1 ? "sede" : "sedi"}`);
      if (z.annotazione) parti.push(z.annotazione);
      else if (sedi.length > 0 && sedi.length <= 4) parti.push(sedi.join(" · "));
      return parti;
    };

    riga.forEach((z, i) => {
      const xZ = AREA_X + PAD + i * (wZona + gapZona);
      const unica = n === 1;
      const wCoord = unica ? Math.min(260, wZona) : wZona;
      const xCoord = unica ? xZ + (wZona - wCoord) / 2 : xZ;
      const righeCoord = d.righeFigura(z.denominazione, z.nominativo, wCoord, tit, C.testoBlu, C.dettaglioBlu);
      const hCoord = d.scatola(xCoord, ySuperiore, wCoord, righeCoord, { fill: fillCoordinatore, sw: 0, padV: 9 });
      const cx = xCoord + wCoord / 2;
      centri.push(cx);
      let yCorrente = ySuperiore + hCoord;

      const note = annotazioniZona(z);
      if (unica) {
        // annotazione a destra del tronco, il tronco scende fino alle caselle
        const righeNote = note.flatMap((testo) => avvolgi(testo, INTERNO_W / 2 - 12, det, false, misura, 3));
        const hNote = righeNote.length * det * INTERLINEA;
        const yBus = yCorrente + Math.max(30, hNote + 14);
        d.linea([[cx, yCorrente], [cx, yBus]]);
        righeNote.forEach((rg, q) => d.testo(cx + 10, yCorrente + 8 + (q + 0.5) * det * INTERLINEA, rg, det, false, C.grigioTesto, "inizio"));
        const m = z.sottolivelli.length;
        const gapS = 14;
        const wS = Math.min(210, (INTERNO_W - gapS * Math.max(0, m - 1)) / Math.max(1, m));
        const larghezzaTot = m * wS + gapS * Math.max(0, m - 1);
        const xS0 = AREA_X + AREA_W / 2 - larghezzaTot / 2;
        const ySub = yBus + 16;
        const hSub = z.sottolivelli.map((s) => altezzaSub(d, s, wS, tit, det));
        const hMax = Math.max(0, ...hSub);
        if (m > 0) {
          const cxs = z.sottolivelli.map((_, q) => xS0 + q * (wS + gapS) + wS / 2);
          if (m > 1) d.linea([[Math.min(cx, ...cxs), yBus], [Math.max(cx, ...cxs), yBus]]);
          for (const cs of cxs) d.linea([[cs, yBus], [cs, ySub]]);
        }
        z.sottolivelli.forEach((s, q) => disegnaSub(d, s, xS0 + q * (wS + gapS), ySub, wS, hMax, tit, det, fillOperativo));
        yCorrente = ySub + hMax;
      } else {
        // annotazione sotto il coordinatore, capisquadra in colonna con una dorsale
        let yAnn = yCorrente + 4;
        for (const testo of note) {
          for (const rg of avvolgi(testo, wZona - 18, det, false, misura, 3)) {
            d.testo(xZ + 14, yAnn + (det * INTERLINEA) / 2, rg, det, false, C.grigioTesto, "inizio");
            yAnn += det * INTERLINEA;
          }
        }
        yCorrente = note.length ? yAnn + 6 : yCorrente + 12;
        const xDorsale = xZ + 7;
        const wS = wZona - 14;
        let ySub = yCorrente;
        const centriSub: number[] = [];
        for (const s of z.sottolivelli) {
          const h = altezzaSub(d, s, wS, tit, det);
          disegnaSub(d, s, xZ + 14, ySub, wS, h, tit, det, fillOperativo);
          centriSub.push(ySub + h / 2);
          ySub += h + 8;
        }
        if (centriSub.length) {
          d.linea([[xDorsale, ySuperiore + hCoord], [xDorsale, centriSub[centriSub.length - 1]]]);
          for (const c of centriSub) d.linea([[xDorsale, c], [xZ + 14, c]]);
        }
        yCorrente = centriSub.length ? ySub - 8 : yCorrente;
      }
      altezzaRigaMax = Math.max(altezzaRigaMax, yCorrente - ySuperiore);
    });

    // Bus sopra i coordinatori (quando sono più d'uno o non sono sotto il tronco).
    const busY = ySuperiore - 14;
    centriBus.push(centri);
    const tuttiX = [...centri, ...(indiceRiga === 0 ? [uscita.x] : [])];
    if (indiceRiga === 0) {
      d.linea([[uscita.x, uscita.y], [uscita.x, busY]]);
      // Con due file di zone la dorsale di sinistra parte dal bus della prima.
      const xMin = righeZone.length > 1 ? AREA_X + 4 : Math.min(...tuttiX);
      if (tuttiX.length > 1 && (xMin !== Math.max(...tuttiX))) d.linea([[xMin, busY], [Math.max(...tuttiX), busY]]);
      for (const cx of centri) d.linea([[cx, busY], [cx, ySuperiore]]);
    } else {
      const xTronco = AREA_X + 4;
      d.linea([[xTronco, busYPrecedente], [xTronco, busY]]);
      d.linea([[xTronco, busY], [Math.max(...centri), busY]]);
      for (const cx of centri) d.linea([[cx, busY], [cx, ySuperiore]]);
    }
    busYPrecedente = indiceRiga === 0 ? busY : busYPrecedente;
    bottomTotale = ySuperiore + altezzaRigaMax;
    yRiga = bottomTotale + 28;
  });

  return bottomTotale - y0 + 16;
}

function righeSub(d: Disegno, s: { denominazione: string; nominativo?: string; dettaglio?: string; addetti?: string[] }, w: number, tit: number, det: number): Riga[] {
  const righe = d.righeFigura(s.denominazione, s.nominativo, w, tit, C.testoBlu, C.dettaglioBlu);
  if (s.dettaglio) for (const t of avvolgi(s.dettaglio, w - 18, det, false, d.misura, 3)) righe.push({ testo: t, size: det, bold: false, colore: C.dettaglioBlu });
  for (const a of s.addetti ?? []) for (const t of avvolgi(a, w - 18, det, false, d.misura, 2)) righe.push({ testo: t, size: det, bold: false, colore: C.dettaglioBlu });
  return righe;
}
function altezzaSub(d: Disegno, s: Parameters<typeof righeSub>[1], w: number, tit: number, det: number): number {
  return 18 + altezzaRighe(righeSub(d, s, w, tit, det));
}
function disegnaSub(d: Disegno, s: Parameters<typeof righeSub>[1], x: number, y: number, w: number, h: number, tit: number, det: number, fill: string) {
  d.rect({ x, y, w, h, r: 7, fill });
  let cur = y + (h - altezzaRighe(righeSub(d, s, w, tit, det))) / 2;
  for (const r of righeSub(d, s, w, tit, det)) {
    const hr = r.size * INTERLINEA;
    d.testo(x + w / 2, cur + hr / 2, r.testo, r.size, r.bold, r.colore);
    cur += hr;
  }
}

// ─── Banda conclusiva e risorse trasversali ───
function bandaConclusiva(d: Disegno, dati: DatiOrganigramma, y: number): number {
  const b = dati.bandaConclusiva;
  if (!b) return 0;
  const righeDesc = b.descrizione ? avvolgi(b.descrizione, AREA_W - 28, 12, false, d.misura, 3) : [];
  const h = 18 + 14 * INTERLINEA + righeDesc.length * 12 * INTERLINEA;
  d.rect({ x: AREA_X, y, w: AREA_W, h, r: 8, fill: C.bannerFill });
  let cur = y + 9;
  d.testo(AREA_X + AREA_W / 2, cur + (14 * INTERLINEA) / 2, b.titolo, 14, true, C.testoScuro);
  cur += 14 * INTERLINEA;
  for (const r of righeDesc) {
    d.testo(AREA_X + AREA_W / 2, cur + (12 * INTERLINEA) / 2, r, 12, false, C.testoScuro);
    cur += 12 * INTERLINEA;
  }
  return h;
}

function risorseTrasversali(d: Disegno, dati: DatiOrganigramma, y: number): number {
  const r = dati.risorseTrasversali;
  if (!r || r.voci.length === 0) return 0;
  const n = r.voci.length;
  const gap = 10;
  const w = (INTERNO_W - 16 - gap * (n - 1)) / n;
  const righe = r.voci.map((v) => avvolgi(v.denominazione, w - 16, 12, true, d.misura, 3));
  const hVoci = 14 + Math.max(...righe.map((rg) => rg.length)) * 12 * INTERLINEA;
  const h = 30 + hVoci + 10;
  d.rect({ x: AREA_X, y, w: AREA_W, h, r: 8, fill: C.bianco, stroke: C.linea, sw: 1 });
  d.testo(AREA_X + 12, y + 16, r.titolo, 12, true, C.grigioTesto, "inizio");
  r.voci.forEach((v, i) => {
    const x = AREA_X + 8 + 8 + i * (w + gap);
    d.rect({ x, y: y + 30, w, h: hVoci, r: 7, fill: tinta(COLORE_PRIMARIO, 0.82) });
    righe[i].forEach((rg, q) => d.testo(x + w / 2, y + 30 + 7 + (q + 0.5) * 12 * INTERLINEA, rg, 12, true, C.testoBlu));
  });
  return h;
}

// ─── Layout completo ───
export function calcolaLayout(dati: DatiOrganigramma, opzioni: OpzioniLayout): LayoutOrganigramma {
  const d = new Disegno(opzioni.misura);
  const y = MARGINE_ALTO;

  // Le fasce si disegnano in un Disegno separato per poter mettere gli
  // sfondi sotto: prima si calcola l'altezza con un disegno di prova.
  const prova = new Disegno(opzioni.misura);
  const hDirProva = fasciaDirezione(prova, dati, 0, opzioni.loghi);
  const govProva = fasciaGoverno(prova, dati, 0);
  const hCoordProva = fasciaCoordinamento(prova, dati, 0, { x: LARGHEZZA_DISEGNO / 2, y: 0 });

  const fasce: { y: number; h: number; etichetta: string[] }[] = [];
  let yFascia = y;
  if (hDirProva > 0) {
    fasce.push({ y: yFascia, h: hDirProva, etichetta: ["Livello di", "Direzione"] });
    yFascia += hDirProva + GAP_BANDE;
  }
  fasce.push({ y: yFascia, h: govProva.altezza, etichetta: ["Livello di", "Governo"] });
  const yGov = yFascia;
  yFascia += govProva.altezza + GAP_BANDE;
  fasce.push({ y: yFascia, h: hCoordProva + 6, etichetta: ["Livello di", "Coordinamento", "e operativo"] });
  const yCoord = yFascia;
  yFascia += hCoordProva + 6 + GAP_BANDE;

  for (const f of fasce) {
    sfondoFascia(d, f.y, f.h);
    etichettaFascia(d, f.y, f.h, f.etichetta);
  }

  if (hDirProva > 0) fasciaDirezione(d, dati, fasce[0].y, opzioni.loghi);
  const gov = fasciaGoverno(d, dati, yGov);
  fasciaCoordinamento(d, dati, yCoord, gov.uscita);

  let yFine = yFascia;
  yFine += risorseTrasversali(d, dati, yFine);
  if (dati.risorseTrasversali?.voci.length) yFine += GAP_BANDE;
  const hBanda = bandaConclusiva(d, dati, yFine);
  if (hBanda > 0) yFine += hBanda + GAP_BANDE;

  if (d.valoriProposti) {
    d.testo(AREA_X, yFine + 8, "* Valore proposto, da confermare.", 11, false, C.grigioTesto, "inizio");
    yFine += 22;
  }
  const altezza = yFine - GAP_BANDE + 12;
  return { larghezza: LARGHEZZA_DISEGNO, altezza: Math.max(altezza, 60), prims: d.prims, valoriProposti: d.valoriProposti };
}

// Misura approssimata (senza canvas): serve alla stima delle pagine, che non
// deve caricare il motore di disegno. Il disegno vero usa la misura del font.
export const misuraApprossimata: Misura = (testo, size, bold) => testo.length * size * (bold ? 0.58 : 0.53);
