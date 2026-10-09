import { avvolgi, C, Disegno, INTERLINEA, testoSu, tinta } from "@/lib/figure-base";
import { COLORE_PRIMARIO } from "@/lib/colori-semantici";
import type { DatiCruscotto, StatoRiga } from "@/lib/figure-dati";

// Layout del CRUSCOTTO ILLUSTRATIVO (archetipo 4): la schermata di una
// piattaforma gestionale che l'impresa dichiara di avere, disegnata con dati
// di esempio. Regole fisse, applicate dal codice e non dal modello:
//  - la striscia «Dati di esempio — schermata illustrativa» è sempre presente;
//  - il valore «Rilevato» è sempre un trattino: la figura mostra gli obiettivi
//    che vengono dai documenti, mai misure inventate;
//  - il rosso compare solo qui, solo nel semaforo, sempre con un simbolo
//    (✓ ! ✕ disegnati con tratti, non con caratteri che il font potrebbe non avere).
// Opera su un Disegno e un'area (x, y, w); ritorna l'altezza usata.

export const STRISCIA_ILLUSTRATIVA = "Dati di esempio — schermata illustrativa";

const H_INTESTAZIONE = 30;
const H_STRISCIA = 22;
const PAD = 14;
const GAP = 12;
const H_RIGA_MIN = 28;
const H_TESTATA_TABELLA = 24;
const R_STATO = 8.5;

const COLORI_STATO: Record<StatoRiga, string> = { conforme: C.ambiente, attenzione: C.sicurezza, scostamento: C.rosso };
const ETICHETTE_STATO: Record<StatoRiga, string> = { conforme: "conforme", attenzione: "attenzione", scostamento: "scostamento" };

function disegnaBadgeStato(d: Disegno, stato: StatoRiga, cx: number, cy: number, r = R_STATO) {
  const fill = COLORI_STATO[stato];
  const segno = testoSu(fill);
  const k = r / R_STATO;
  d.cerchio(cx, cy, r, fill);
  if (stato === "conforme") d.linea([[cx - 4 * k, cy + 0.2 * k], [cx - 1.2 * k, cy + 3.2 * k], [cx + 4.4 * k, cy - 3.4 * k]], segno, 1.9 * k);
  else if (stato === "scostamento") {
    d.linea([[cx - 3.4 * k, cy - 3.4 * k], [cx + 3.4 * k, cy + 3.4 * k]], segno, 1.9 * k);
    d.linea([[cx + 3.4 * k, cy - 3.4 * k], [cx - 3.4 * k, cy + 3.4 * k]], segno, 1.9 * k);
  } else {
    d.linea([[cx, cy - 4.6 * k], [cx, cy + 1.2 * k]], segno, 2 * k);
    d.cerchio(cx, cy + 4 * k, 1.2 * k, segno);
  }
}

export function disegnaCruscotto(d: Disegno, dati: DatiCruscotto, area: { x: number; y: number; w: number }): number {
  const misura = d.misura;
  const xi = area.x + PAD;
  const wi = area.w - 2 * PAD;
  const conStato = dati.righe.some((r) => !!r.stato);

  // ── Misure ──
  const wTabella = dati.laterale ? Math.round(wi * 0.66) : wi;
  const wLaterale = dati.laterale ? wi - wTabella - GAP : 0;
  const wObiettivo = 112;
  const wRilevato = 62;
  const wStato = conStato ? 50 : 0;
  const wIndicatore = wTabella - wObiettivo - wRilevato - wStato;
  const righeTesto = dati.righe.map((r) => avvolgi(r.indicatore, wIndicatore - 18, 12, false, misura, 2));
  const righeObiettivo = dati.righe.map((r) => avvolgi(r.obiettivo, wObiettivo - 8, 12, true, misura, 3));
  const hRiga = righeTesto.map((t, q) => Math.max(H_RIGA_MIN, 12 + Math.max(t.length, righeObiettivo[q].length) * 12 * INTERLINEA));
  const hLegenda = conStato ? 24 : 0;
  const hTabella = H_TESTATA_TABELLA + hRiga.reduce((t, h) => t + h, 0) + hLegenda;

  const vociLaterale = (dati.laterale?.voci ?? []).map((v) => avvolgi(v, wLaterale - 24, 12, false, misura, 2));
  const hVoceLaterale = vociLaterale.map((t) => t.length * 12 * INTERLINEA + 6 + 8 + 12);
  const hLateraleTotale = dati.laterale ? 28 + hVoceLaterale.reduce((t, h) => t + h, 0) + 6 : 0;

  const nInd = dati.indicatori.length;
  const wTessera = nInd ? (wi - (nInd - 1) * 10) / nInd : 0;
  const tessere = dati.indicatori.map((ind) => {
    const etichetta = avvolgi(ind.etichetta, wTessera - 18, 11, false, misura, 2);
    let size = 19;
    while (size > 12 && misura(ind.obiettivo, size, true) > wTessera - 18) size -= 1;
    const obiettivo = misura(ind.obiettivo, size, true) > wTessera - 18 ? avvolgi(ind.obiettivo, wTessera - 18, size, true, misura, 2) : [ind.obiettivo];
    return { etichetta, obiettivo, size };
  });
  const hTessera = nInd ? Math.max(...tessere.map((t) => 10 + t.etichetta.length * 11 * INTERLINEA + 4 + t.obiettivo.length * t.size * 1.2 + 4 + 11 * INTERLINEA + 8)) : 0;

  const hCorpo = Math.max(hTabella, hLateraleTotale);
  // l'intestazione va a capo (al massimo due righe) invece di troncare il profilo
  const titolo = [dati.piattaforma, `Profilo: ${dati.profilo}`].filter(Boolean).join("  ·  ");
  const righeTitolo = avvolgi(titolo, wi - 20, 13, true, misura, 2);
  const hIntestazione = Math.max(H_INTESTAZIONE, 14 + righeTitolo.length * 13 * INTERLINEA);
  const hTot = hIntestazione + H_STRISCIA + GAP + (nInd ? hTessera + GAP : 0) + hCorpo + PAD;

  // ── Cornice e intestazione ──
  d.rect({ x: area.x, y: area.y, w: area.w, h: hTot, r: 10, fill: C.bianco, stroke: C.lineaScura, sw: 1.6 });
  d.rect({ x: area.x, y: area.y, w: area.w, h: hIntestazione, r: 10, fill: C.navy });
  d.rect({ x: area.x, y: area.y + hIntestazione - 10, w: area.w, h: 10, fill: C.navy });
  righeTitolo.forEach((t, q) => d.testo(xi, area.y + hIntestazione / 2 + (q - (righeTitolo.length - 1) / 2) * 13 * INTERLINEA, t, 13, true, testoSu(C.navy), "inizio"));
  // striscia fissa: non dipende dal modello
  d.rect({ x: area.x, y: area.y + hIntestazione, w: area.w, h: H_STRISCIA, fill: C.bannerFill });
  d.testo(area.x + area.w / 2, area.y + hIntestazione + H_STRISCIA / 2, STRISCIA_ILLUSTRATIVA, 11, true, C.testoScuro);

  let y = area.y + hIntestazione + H_STRISCIA + GAP;

  // ── Tessere degli indicatori ──
  if (nInd) {
    dati.indicatori.forEach((_, q) => {
      const x = xi + q * (wTessera + 10);
      const t = tessere[q];
      d.rect({ x, y, w: wTessera, h: hTessera, r: 8, fill: C.bandaFill, stroke: C.bandaBordo, sw: 1.2 });
      let cur = y + 10;
      for (const riga of t.etichetta) {
        d.testo(x + 9, cur + (11 * INTERLINEA) / 2, riga, 11, false, C.grigioTesto, "inizio");
        cur += 11 * INTERLINEA;
      }
      cur += 4;
      for (const riga of t.obiettivo) {
        d.testo(x + 9, cur + (t.size * 1.2) / 2, riga, t.size, true, C.testoBlu, "inizio");
        cur += t.size * 1.2;
      }
      d.testo(x + 9, y + hTessera - 8 - (11 * INTERLINEA) / 2, "Rilevato: —", 11, false, C.grigioTesto, "inizio");
    });
    y += hTessera + GAP;
  }

  // ── Tabella ──
  const yTabella = y;
  d.rect({ x: xi, y, w: wTabella, h: H_TESTATA_TABELLA, r: 5, fill: tinta(COLORE_PRIMARIO, 0.82) });
  const xObiettivo = xi + wIndicatore;
  const xRilevato = xObiettivo + wObiettivo;
  const xStato = xRilevato + wRilevato;
  d.testo(xi + 9, y + H_TESTATA_TABELLA / 2, "Indicatore", 11, true, C.testoBlu, "inizio");
  d.testo(xObiettivo + 4, y + H_TESTATA_TABELLA / 2, "Obiettivo", 11, true, C.testoBlu, "inizio");
  d.testo(xRilevato + 4, y + H_TESTATA_TABELLA / 2, "Rilevato", 11, true, C.testoBlu, "inizio");
  if (conStato) d.testo(xStato + wStato / 2, y + H_TESTATA_TABELLA / 2, "Stato", 11, true, C.testoBlu);
  y += H_TESTATA_TABELLA;
  dati.righe.forEach((r, q) => {
    const h = hRiga[q];
    if (q % 2 === 1) d.rect({ x: xi, y, w: wTabella, h, fill: C.bandaFill });
    let cur = y + (h - righeTesto[q].length * 12 * INTERLINEA) / 2;
    for (const t of righeTesto[q]) {
      d.testo(xi + 9, cur + (12 * INTERLINEA) / 2, t, 12, false, C.testoScuro, "inizio");
      cur += 12 * INTERLINEA;
    }
    const ob = righeObiettivo[q];
    ob.forEach((t, k) => d.testo(xObiettivo + 4, y + h / 2 + (k - (ob.length - 1) / 2) * 12 * INTERLINEA, t, 12, true, C.testoBlu, "inizio"));
    d.testo(xRilevato + 4, y + h / 2, "—", 12, false, C.grigioTesto, "inizio");
    if (r.stato) disegnaBadgeStato(d, r.stato, xStato + wStato / 2, y + h / 2);
    y += h;
  });
  d.linea([[xi, y], [xi + wTabella, y]], C.bandaBordo, 1.2);
  // legenda del semaforo
  if (conStato) {
    let xl = xi + 9;
    for (const stato of ["conforme", "attenzione", "scostamento"] as StatoRiga[]) {
      disegnaBadgeStato(d, stato, xl + 6, y + hLegenda / 2 + 1, 6);
      d.testo(xl + 16, y + hLegenda / 2 + 1, ETICHETTE_STATO[stato], 11, false, C.grigioTesto, "inizio");
      xl += 16 + misura(ETICHETTE_STATO[stato], 11, false) + 16;
    }
  }

  // ── Elenco laterale: aree con barre vuote ──
  if (dati.laterale) {
    const xL = xi + wTabella + GAP;
    d.rect({ x: xL, y: yTabella, w: wLaterale, h: hLateraleTotale, r: 8, fill: C.bandaFill, stroke: C.bandaBordo, sw: 1.2 });
    d.testo(xL + 10, yTabella + 14, avvolgi(dati.laterale.titolo, wLaterale - 20, 12, true, misura, 1)[0], 12, true, C.testoBlu, "inizio");
    let cur = yTabella + 28;
    vociLaterale.forEach((righe) => {
      for (const t of righe) {
        d.testo(xL + 10, cur + (12 * INTERLINEA) / 2, t, 12, false, C.testoScuro, "inizio");
        cur += 12 * INTERLINEA;
      }
      cur += 6;
      d.rect({ x: xL + 10, y: cur, w: wLaterale - 20 - 18, h: 8, r: 4, fill: C.bianco, stroke: C.bandaBordo, sw: 1 });
      d.testo(xL + wLaterale - 10, cur + 4, "—", 11, false, C.grigioTesto, "fine");
      cur += 8 + 12;
    });
  }

  return hTot;
}
