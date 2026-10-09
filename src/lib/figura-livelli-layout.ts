import { avvolgi, C, Disegno, INTERLINEA, testoSu, tinta } from "@/lib/figure-base";
import { COLORE_PRIMARIO } from "@/lib/colori-semantici";
import type { DatiLivelli, LivelloControllo } from "@/lib/figure-dati";
import { disegnaFlusso, type OpzioniFlusso } from "@/lib/figura-flusso-layout";

// Layout dello SCHEMA A LIVELLI DI CONTROLLO (archetipo 2). I livelli sono
// caselle impilate: il livello 1 (operativo) in basso, il più alto in cima, con
// il blu primario che si schiarisce verso il basso (il controllo più alto è il
// più scuro). Accanto, facoltativo, un pannello con un elenco o un flusso (es.
// la gestione delle non conformità), collegato ai livelli; in fondo, facoltativa,
// una banda con il principio che tiene insieme lo schema. Senza pannello i
// livelli occupano tutta la larghezza e la descrizione va a destra del titolo.
// Opera su un Disegno e un'area (x, y, w); ritorna l'altezza usata.

const GAP_LIVELLI = 20;
const GAP_COLONNE = 38;
const H_CHIP = 17;
const GAP_CHIP = 6;
const H_INTESTAZIONE = 28;
const PAD = 10;
const R_NUMERO = 12;
const X_TESTO = 46; // dopo il cerchio del numero
const W_TITOLO_LARGO = 232;
const FRAZIONE_PIU_CHIARA = 0.8;

type Contenuto = { titolo: string[]; chip: { testo: string; w: number } | null; desc: string[]; hTitolo: number; hDesc: number; hTesto: number };

export function disegnaLivelli(d: Disegno, dati: DatiLivelli, area: { x: number; y: number; w: number }): number {
  const misura = d.misura;
  const pannello = dati.pannello;
  const largo = !pannello;
  const wLiv = largo ? area.w : Math.round(area.w * 0.47);
  const xPan = area.x + wLiv + GAP_COLONNE;
  const wPan = area.w - wLiv - GAP_COLONNE;
  const n = dati.livelli.length;

  // dall'alto: il livello più alto per primo
  const dallAlto = dati.livelli.map((l, i) => ({ l, numero: i + 1 })).reverse();

  const contenuto = (l: LivelloControllo): Contenuto => {
    const wTesto = largo ? W_TITOLO_LARGO - 8 : wLiv - X_TESTO - 14;
    const titolo = avvolgi(l.titolo, wTesto, 13, true, misura, 3);
    const chipTesto = l.responsabile ? avvolgi(l.responsabile, wTesto - 16, 12, false, misura, 1)[0] : null;
    const chip = chipTesto ? { testo: chipTesto, w: Math.min(wTesto, misura(chipTesto, 12, false) + 16) } : null;
    const wDesc = largo ? wLiv - X_TESTO - W_TITOLO_LARGO - 20 : wTesto;
    const desc = l.descrizione ? avvolgi(l.descrizione, wDesc, 12, false, misura, 4) : [];
    const hTitolo = titolo.length * 13 * INTERLINEA + (chip ? GAP_CHIP + H_CHIP : 0);
    const hDesc = desc.length * 12 * INTERLINEA;
    const hTesto = largo ? Math.max(hTitolo, hDesc) : hTitolo + (desc.length ? 5 + hDesc : 0);
    return { titolo, chip, desc, hTitolo, hDesc, hTesto };
  };
  const contenuti = dallAlto.map(({ l }) => contenuto(l));
  const hBox = contenuti.map((c) => Math.max(46, 2 * PAD + c.hTesto));
  const hLivelli = hBox.reduce((t, h) => t + h, 0) + (n - 1) * GAP_LIVELLI;

  // ── Pannello: misura del contenuto ──
  const hIntestazione = pannello ? Math.max(H_INTESTAZIONE, 12 + avvolgi(pannello.titolo, wPan - 24, 13, true, misura, 2).length * 13 * INTERLINEA) : 0;
  const GAP_VOCI = 8;
  const righeVoce = pannello?.forma === "elenco" ? (pannello.voci ?? []).map((v) => avvolgi(v, wPan - 24 - 30, 12, false, misura, 3)) : [];
  const hVoce = righeVoce.map((r) => 2 * 8 + r.length * 12 * INTERLINEA);
  // Il flusso nel pannello: in orizzontale (a serpentina) oppure, se così resta
  // piccolo in un pannello alto, in verticale — un passo per riga — purché non
  // faccia crescere la figura oltre l'altezza dei livelli. Un margine in più
  // lascia passare il tratteggio di un eventuale ritorno dentro la cornice.
  const wFlusso = wPan - 44;
  let hFlusso = 0;
  let opzioniFlusso: OpzioniFlusso = {};
  if (pannello?.forma === "flusso" && pannello.flusso) {
    hFlusso = disegnaFlusso(new Disegno(misura), pannello.flusso, { x: 0, y: 0, w: wFlusso }, opzioniFlusso);
    const disponibile = hLivelli - hIntestazione - 28;
    if (hFlusso < disponibile * 0.9) {
      const verticale: OpzioniFlusso = { larghezzaPasso: Math.min(wFlusso, 210), gapRighe: 22 };
      const hVerticale = disegnaFlusso(new Disegno(misura), pannello.flusso, { x: 0, y: 0, w: wFlusso }, verticale);
      if (hVerticale <= disponibile) {
        opzioniFlusso = verticale;
        hFlusso = hVerticale;
      }
    }
  }
  const hContenutoPannello = pannello ? (pannello.forma === "elenco" ? hVoce.reduce((t, h) => t + h, 0) + Math.max(0, hVoce.length - 1) * GAP_VOCI : hFlusso) : 0;
  const hPannello = pannello ? hIntestazione + 14 + hContenutoPannello + 14 : 0;

  const H = Math.max(hLivelli, hPannello);
  const extra = (H - hLivelli) / n;

  // ── Livelli ──
  let y = area.y;
  const centri: number[] = [];
  dallAlto.forEach(({ l, numero }, i) => {
    const c = contenuti[i];
    const h = hBox[i] + extra;
    const frazione = n === 1 ? 0 : (FRAZIONE_PIU_CHIARA * (n - numero)) / (n - 1);
    const fill = frazione === 0 ? C.primario : tinta(COLORE_PRIMARIO, frazione);
    const colore = testoSu(fill);
    d.rect({ x: area.x, y, w: wLiv, h, r: 8, fill });
    d.cerchio(area.x + 8 + R_NUMERO + 2, y + h / 2, R_NUMERO, C.bianco);
    d.testo(area.x + 8 + R_NUMERO + 2, y + h / 2, String(numero), 13, true, C.testoBlu);
    const xT = area.x + X_TESTO;
    const scrivi = (righe: string[], yIniziale: number, size: number, bold: boolean, x: number) => {
      let cur = yIniziale;
      for (const t of righe) {
        const hr = size * INTERLINEA;
        d.testo(x, cur + hr / 2, t, size, bold, colore, "inizio");
        cur += hr;
      }
      return cur;
    };
    const disegnaChip = (yChip: number) => {
      if (!c.chip) return;
      d.rect({ x: xT, y: yChip, w: c.chip.w, h: H_CHIP, r: H_CHIP / 2, fill: C.bianco, stroke: C.bandaBordo, sw: 1 });
      d.testo(xT + c.chip.w / 2, yChip + H_CHIP / 2, c.chip.testo, 12, false, C.testoBlu);
    };
    if (largo) {
      const yS = y + (h - c.hTitolo) / 2;
      const dopoTitolo = scrivi(c.titolo, yS, 13, true, xT);
      disegnaChip(dopoTitolo + GAP_CHIP);
      scrivi(c.desc, y + (h - c.hDesc) / 2, 12, false, xT + W_TITOLO_LARGO + 10);
    } else {
      const yS = y + (h - c.hTesto) / 2;
      const dopoTitolo = scrivi(c.titolo, yS, 13, true, xT);
      let cur = dopoTitolo;
      if (c.chip) {
        disegnaChip(cur + GAP_CHIP);
        cur += GAP_CHIP + H_CHIP;
      }
      if (c.desc.length) scrivi(c.desc, cur + 5, 12, false, xT);
    }
    centri.push(y + h / 2);
    // freccia di salita: dal livello sotto a quello sopra (l'escalation)
    if (i + 1 < n) {
      const xF = area.x + wLiv / 2;
      d.linea([[xF, y + h + GAP_LIVELLI - 2], [xF, y + h + 3]], C.lineaScura, 1.4, undefined, "fine");
    }
    y += h + GAP_LIVELLI;
  });

  // ── Pannello ──
  if (pannello) {
    d.rect({ x: xPan, y: area.y, w: wPan, h: H, r: 8, fill: C.bianco, stroke: C.bandaBordo, sw: 1.4 });
    d.rect({ x: xPan, y: area.y, w: wPan, h: hIntestazione, r: 8, fill: C.navy });
    d.rect({ x: xPan, y: area.y + hIntestazione - 10, w: wPan, h: 10, fill: C.navy });
    const titoloP = avvolgi(pannello.titolo, wPan - 24, 13, true, misura, 2);
    titoloP.forEach((t, q) => d.testo(xPan + 12, area.y + hIntestazione / 2 + (q - (titoloP.length - 1) / 2) * 13 * INTERLINEA, t, 13, true, testoSu(C.navy), "inizio"));
    const spazio = H - hIntestazione;
    if (pannello.forma === "elenco") {
      // le voci si distribuiscono nello spazio, centrate in verticale
      const k = hVoce.length;
      const liberoTotale = spazio - hContenutoPannello;
      const gap = k > 1 ? Math.min(26, Math.max(GAP_VOCI, GAP_VOCI + (liberoTotale - 28) / (k - 1))) : 0;
      const hBlocco = hVoce.reduce((t, h) => t + h, 0) + Math.max(0, k - 1) * gap;
      let yV = area.y + hIntestazione + (spazio - hBlocco) / 2;
      righeVoce.forEach((righe, q) => {
        d.rect({ x: xPan + 12, y: yV, w: wPan - 24, h: hVoce[q], r: 6, fill: C.bandaFill, stroke: C.bandaBordo, sw: 1 });
        d.cerchio(xPan + 12 + 13, yV + hVoce[q] / 2, 4, C.primario);
        righe.forEach((t, r) => d.testo(xPan + 12 + 26, yV + 8 + (r + 0.5) * 12 * INTERLINEA, t, 12, false, C.testoScuro, "inizio"));
        yV += hVoce[q] + gap;
      });
    } else if (pannello.flusso) {
      const yFlusso = area.y + hIntestazione + (spazio - hFlusso) / 2;
      disegnaFlusso(d, pannello.flusso, { x: xPan + 22, y: yFlusso, w: wFlusso }, opzioniFlusso);
    }
    // i livelli alimentano il pannello: dalla destra di ogni livello a un bus, poi una freccia
    if (pannello.collegaLivelli) {
      const xBus = area.x + wLiv + 14;
      for (const cy of centri) d.linea([[area.x + wLiv, cy], [xBus, cy]], C.lineaScura, 1.4);
      d.linea([[xBus, Math.min(...centri)], [xBus, Math.max(...centri)]], C.lineaScura, 1.4);
      d.linea([[xBus, area.y + H / 2], [xPan - 2, area.y + H / 2]], C.lineaScura, 1.4, undefined, "fine");
    }
  }

  let fine = area.y + H;
  // ── Banda ──
  if (dati.banda) fine += 18 + d.banda(area.x, fine + 18, area.w, dati.banda.titolo, dati.banda.descrizione);
  return fine - area.y;
}
