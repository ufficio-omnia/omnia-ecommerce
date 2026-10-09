import { avvolgi, C, Disegno, INTERLINEA, stileSemantico, testoSu, type Riga } from "@/lib/figure-base";
import type { DatiRete } from "@/lib/figure-dati";

// Layout della RETE / HUB (archetipo 5): un centro (piattaforma, magazzino,
// centrale operativa) collegato a più nodi (sedi, presìdi, depositi). Due
// disposizioni, scelte dal codice:
//  - «colonne»: se ci sono origini (es. magazzino centrale) → origini → nodi ↔
//    centro, da sinistra a destra;
//  - «stella»: senza origini, il centro sta in mezzo e i nodi si dividono a
//    sinistra e a destra.
// Facoltativi: una fascia di profili di accesso (chip) sotto il centro, una
// banda finale e una nota. Il centro è la casella blu primario con le sue voci
// come etichette bianche; i nodi e le origini sono neutri salvo tipo semantico
// (R20). La direzione delle frecce fra nodi e centro la decide `collegamento`.
// Opera su un Disegno e un'area (x, y, w); ritorna l'altezza usata.

const GAP_COLONNA = 52;
const GAP_BOX = 12;
const H_PILLOLA = 20;

type Box = { titolo: string; dettaglio?: string; voci?: string[]; semantico?: Parameters<typeof stileSemantico>[0] };
type BoxMisurata = { box: Box; w: number; h: number; righe: Riga[]; voci: string[][]; stile: { fill: string; stroke?: string; testo: string; dettaglio: string } };

export function disegnaRete(d: Disegno, dati: DatiRete, area: { x: number; y: number; w: number }): number {
  const misura = d.misura;
  const colonne = !!dati.origini?.length;
  const collegamento = dati.collegamento ?? "bidirezionale";

  // larghezze delle colonne
  const wOrigini = colonne ? 150 : 0;
  const wNodi = colonne ? 178 : 176;
  const wCentro = colonne ? area.w - wOrigini - wNodi - 2 * GAP_COLONNA : area.w - 2 * wNodi - 2 * GAP_COLONNA;

  // ── Misura delle caselle ──
  const stile = (sem: Box["semantico"]) => {
    const s = stileSemantico(sem, { fill: C.bianco, stroke: C.linea, testo: C.testoScuro, dettaglio: C.grigioTesto });
    return sem ? { ...s, stroke: undefined } : s;
  };
  const misuraBox = (box: Box, w: number, neutroFill?: string): BoxMisurata => {
    const s = stile(box.semantico);
    const st = !box.semantico && neutroFill ? { ...s, fill: neutroFill } : s;
    const righe = d.righeTitoloDettaglio(box.titolo, box.dettaglio, w, { titolo: st.testo, dettaglio: st.dettaglio }, { maxTitolo: 2, maxDettaglio: 3 });
    const voci = (box.voci ?? []).map((v) => avvolgi(v, w - 16 - 14, 11, false, misura, 2));
    const hVoci = voci.reduce((t, v) => t + v.length * 11 * INTERLINEA + 3, 0);
    const h = 18 + righe.reduce((t, r) => t + r.size * INTERLINEA, 0) + (voci.length ? 6 + hVoci : 0);
    return { box, w, h, righe, voci, stile: st };
  };
  const origini = (dati.origini ?? []).map((o) => misuraBox(o, wOrigini, C.neutroFill));
  const nodi = dati.nodi.map((n) => misuraBox(n, wNodi));
  const meta = colonne ? nodi.length : Math.ceil(nodi.length / 2);
  const nodiSinistra = colonne ? [] : nodi.slice(0, meta);
  const nodiDestra = colonne ? nodi : nodi.slice(meta);

  // centro: titolo, sottotitolo e voci come etichette bianche
  const titoloC = avvolgi(dati.centro.titolo, wCentro - 24, 14, true, misura, 3);
  const sottoC = dati.centro.sottotitolo ? avvolgi(dati.centro.sottotitolo, wCentro - 24, 12, false, misura, 2) : [];
  const vociC = (dati.centro.voci ?? []).map((v) => avvolgi(v, wCentro - 24 - 16, 11.5, false, misura, 2));
  const hPillola = vociC.map((r) => 10 + r.length * 11.5 * INTERLINEA);
  const hTestoC = titoloC.length * 14 * INTERLINEA + sottoC.length * 12 * INTERLINEA;
  const hCentroNaturale = 28 + hTestoC + (vociC.length ? 10 + hPillola.reduce((t, h) => t + h, 0) + (vociC.length - 1) * 6 : 0);

  const altezzaColonna = (lista: BoxMisurata[]) => lista.reduce((t, b) => t + b.h, 0) + Math.max(0, lista.length - 1) * GAP_BOX;
  const H = Math.max(hCentroNaturale, 96, altezzaColonna(origini), altezzaColonna(nodiSinistra), altezzaColonna(nodiDestra));

  // posizioni orizzontali
  const xOrigini = area.x;
  const xNodiSx = area.x;
  const xCentro = colonne ? area.x + wOrigini + GAP_COLONNA + wNodi + GAP_COLONNA : area.x + wNodi + GAP_COLONNA;
  const xNodiColonne = area.x + wOrigini + GAP_COLONNA;
  const xNodiDx = colonne ? xNodiColonne : xCentro + wCentro + GAP_COLONNA;

  // ── Disegno di una colonna di caselle distribuite sull'altezza H ──
  const disegnaColonna = (lista: BoxMisurata[], x: number): { y: number; h: number }[] => {
    // spazi uguali fra le caselle e ai margini; la colonna più alta ha solo lo spazio minimo
    const somma = lista.reduce((t, b) => t + b.h, 0);
    const gap = lista.length ? Math.max(GAP_BOX, (H - somma) / (lista.length + 1)) : 0;
    let y = area.y + (H - (somma + gap * Math.max(0, lista.length - 1))) / 2;
    const pos: { y: number; h: number }[] = [];
    for (const b of lista) {
      d.rect({ x, y, w: b.w, h: b.h, r: 8, fill: b.stile.fill, stroke: b.stile.stroke, sw: 1.2 });
      let cur = y + 9;
      for (const r of b.righe) {
        const hr = r.size * INTERLINEA;
        d.testo(x + b.w / 2, cur + hr / 2, r.testo, r.size, r.bold, r.colore);
        cur += hr;
      }
      if (b.voci.length) {
        cur += 6;
        for (const righe of b.voci) {
          d.cerchio(x + 13, cur + (11 * INTERLINEA) / 2, 1.9, b.stile.dettaglio);
          for (const t of righe) {
            d.testo(x + 21, cur + (11 * INTERLINEA) / 2, t, 11, false, b.stile.dettaglio, "inizio");
            cur += 11 * INTERLINEA;
          }
          cur += 3;
        }
      }
      pos.push({ y, h: b.h });
      y += b.h + gap;
    }
    return pos;
  };

  const posOrigini = colonne ? disegnaColonna(origini, xOrigini) : [];
  const posSx = disegnaColonna(nodiSinistra, xNodiSx);
  const posDx = disegnaColonna(nodiDestra, xNodiDx);

  // ── Centro ──
  d.rect({ x: xCentro, y: area.y, w: wCentro, h: H, r: 10, fill: C.primario });
  const coloreC = testoSu(C.primario);
  const hBloccoC = hTestoC + (vociC.length ? 10 + hPillola.reduce((t, h) => t + h, 0) + (vociC.length - 1) * 6 : 0);
  let curC = area.y + (H - hBloccoC) / 2;
  for (const t of titoloC) {
    d.testo(xCentro + wCentro / 2, curC + (14 * INTERLINEA) / 2, t, 14, true, coloreC);
    curC += 14 * INTERLINEA;
  }
  for (const t of sottoC) {
    d.testo(xCentro + wCentro / 2, curC + (12 * INTERLINEA) / 2, t, 12, false, coloreC);
    curC += 12 * INTERLINEA;
  }
  if (vociC.length) {
    curC += 10;
    vociC.forEach((righe, q) => {
      d.rect({ x: xCentro + 12, y: curC, w: wCentro - 24, h: hPillola[q], r: 7, fill: C.bianco });
      righe.forEach((t, r) => d.testo(xCentro + wCentro / 2, curC + 5 + (r + 0.5) * 11.5 * INTERLINEA, t, 11.5, false, C.testoBlu));
      curC += hPillola[q] + 6;
    });
  }

  // ── Collegamenti nodi ↔ centro: frecce orizzontali all'altezza di ogni nodo ──
  const col = C.lineaScura;
  const collega = (xNodo: number, xCentroBordo: number, y: number) => {
    const dir = xNodo < xCentroBordo ? 1 : -1;
    const pNodo: [number, number] = [xNodo + dir * 2, y];
    const pCentro: [number, number] = [xCentroBordo - dir * 2, y];
    if (collegamento === "bidirezionale") d.linea([pNodo, pCentro], col, 1.4, undefined, "entrambe");
    else if (collegamento === "verso_centro") d.linea([pNodo, pCentro], col, 1.4, undefined, "fine");
    else d.linea([pCentro, pNodo], col, 1.4, undefined, "fine");
  };
  posSx.forEach((p) => collega(xNodiSx + wNodi, xCentro, p.y + p.h / 2));
  posDx.forEach((p) => collega(colonne ? xNodiColonne + wNodi : xNodiDx, colonne ? xCentro : xCentro + wCentro, p.y + p.h / 2));

  // ── Origini → nodi: un bus che alimenta ogni nodo ──
  if (colonne && posOrigini.length) {
    const xBus = xOrigini + wOrigini + GAP_COLONNA / 2;
    const centriO = posOrigini.map((p) => p.y + p.h / 2);
    const centriN = posDx.map((p) => p.y + p.h / 2);
    for (const cy of centriO) d.linea([[xOrigini + wOrigini, cy], [xBus, cy]], col, 1.4);
    d.linea([[xBus, Math.min(...centriO, ...centriN)], [xBus, Math.max(...centriO, ...centriN)]], col, 1.4);
    for (const cy of centriN) d.linea([[xBus, cy], [xNodiColonne - 2, cy]], col, 1.4, undefined, "fine");
  }

  let fine = area.y + H;

  // ── Profili di accesso (chip) ──
  if (dati.chip) {
    const yBlocco = fine + 22;
    const wInterna = area.w - 28;
    const pillole = dati.chip.voci.map((v) => {
      const t = avvolgi(v, 220, 11.5, false, misura, 1)[0];
      return { t, w: misura(t, 11.5, false) + 20 };
    });
    // distribuzione a capo delle etichette
    const righe: (typeof pillole)[] = [[]];
    let usata = 0;
    for (const p of pillole) {
      if (righe[righe.length - 1].length && usata + 8 + p.w > wInterna) {
        righe.push([]);
        usata = 0;
      }
      usata += (righe[righe.length - 1].length ? 8 : 0) + p.w;
      righe[righe.length - 1].push(p);
    }
    const hBlocco = 12 + 14 * INTERLINEA + 8 + righe.length * (H_PILLOLA + 7) + 5;
    // il blocco è legato al centro da una linea
    const xCentroC = xCentro + wCentro / 2;
    d.linea([[xCentroC, fine + 1], [xCentroC, yBlocco - 2]], col, 1.4, undefined, "fine");
    d.rect({ x: area.x, y: yBlocco, w: area.w, h: hBlocco, r: 8, fill: C.bandaFill, stroke: C.bandaBordo, sw: 1.2 });
    d.testo(area.x + 14, yBlocco + 12 + 7, dati.chip.titolo, 12, true, C.testoBlu, "inizio");
    let yp = yBlocco + 12 + 14 * INTERLINEA + 8;
    for (const riga of righe) {
      let xp = area.x + 14;
      for (const p of riga) {
        d.rect({ x: xp, y: yp, w: p.w, h: H_PILLOLA, r: H_PILLOLA / 2, fill: C.bianco, stroke: C.navy, sw: 1.2 });
        d.testo(xp + p.w / 2, yp + H_PILLOLA / 2, p.t, 11.5, false, C.testoScuro);
        xp += p.w + 8;
      }
      yp += H_PILLOLA + 7;
    }
    fine = yBlocco + hBlocco;
  }

  if (dati.banda) fine += 16 + d.banda(area.x, fine + 16, area.w, dati.banda.titolo, dati.banda.dettaglio);
  if (dati.nota) {
    const righeNota = avvolgi(dati.nota, area.w, 12, false, misura, 3);
    righeNota.forEach((t, i) => d.testo(area.x, fine + 16 + i * 12 * INTERLINEA, t, 12, false, C.grigioTesto, "inizio"));
    fine += 16 + righeNota.length * 12 * INTERLINEA;
  }
  return fine - area.y;
}
