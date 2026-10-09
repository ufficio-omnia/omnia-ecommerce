import { avvolgi, C, Disegno, INTERLINEA, pienoSemantico, testoSu, tinta } from "@/lib/figure-base";
import { COLORE_PRIMARIO } from "@/lib/colori-semantici";
import type { DatiCronoprogramma, RigaCronoprogramma } from "@/lib/figure-dati";

// Layout del CRONOPROGRAMMA (archetipo 3). Asse del tempo in alto (minuti,
// ore, giorni, settimane o mesi), una riga per attività con il responsabile
// sotto il titolo, barre colorate con l'etichetta dentro o accanto, pietre
// miliari a losanga, fasi come fasce di raggruppamento, traguardi come
// etichette in testa con una linea tratteggiata che attraversa le righe, banda
// finale e nota. Opera su un Disegno e un'area (x, y, w); ritorna l'altezza.

const H_RIGA_MIN = 32;
const H_BARRA = 16;
const H_FASE = 22;
const H_ASSE = 20;
const PAD_RIGA = 7;
const R_PIETRA = 7;
const DISTANZA_TICK_MIN = 46;
const PASSI = [0.25, 0.5, 1, 2, 5, 10, 15, 20, 25, 30, 50, 60, 100, 200, 250, 500, 1000, 5000];

const formatta = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "").replace(".", ","));

type Voce = { tipo: "fase"; nome: string } | { tipo: "riga"; riga: RigaCronoprogramma };

export function passoAsse(durata: number, larghezza: number): number {
  const massimoTick = Math.max(2, Math.floor(larghezza / DISTANZA_TICK_MIN));
  return PASSI.find((p) => durata / p <= massimoTick) ?? PASSI[PASSI.length - 1];
}

export function disegnaCronoprogramma(d: Disegno, dati: DatiCronoprogramma, area: { x: number; y: number; w: number }): number {
  const misura = d.misura;
  const conResponsabili = dati.righe.some((r) => !!r.responsabile);
  const wEtichette = conResponsabili ? 188 : 164;
  const x0 = area.x + wEtichette;
  const x1 = area.x + area.w - 10;
  const xDi = (t: number) => x0 + (Math.min(Math.max(t, 0), dati.durata) / dati.durata) * (x1 - x0);

  // ── Voci (fasi e righe) ──
  const voci: Voce[] = [];
  let faseCorrente: string | undefined;
  for (const riga of dati.righe) {
    if (riga.fase && riga.fase !== faseCorrente) {
      faseCorrente = riga.fase;
      voci.push({ tipo: "fase", nome: riga.fase });
    }
    voci.push({ tipo: "riga", riga });
  }

  const testiRiga = (r: RigaCronoprogramma) => {
    const titolo = avvolgi(r.titolo, wEtichette - 14, 12, true, misura, 2);
    const resp = r.responsabile ? avvolgi(r.responsabile, wEtichette - 14, 11, false, misura, 2) : [];
    return { titolo, resp, h: titolo.length * 12 * INTERLINEA + resp.length * 11 * INTERLINEA };
  };
  const hVoce = voci.map((v) => (v.tipo === "fase" ? H_FASE : Math.max(H_RIGA_MIN, 2 * PAD_RIGA + testiRiga(v.riga).h)));

  // ── Traguardi: etichette in testa, su più livelli se si sovrappongono ──
  const traguardi = [...(dati.traguardi ?? [])].sort((a, b) => a.posizione - b.posizione);
  const conDettaglio = traguardi.some((t) => !!t.dettaglio);
  const hChip = conDettaglio ? 33 : 19;
  type Chip = { t: (typeof traguardi)[number]; righe: string[]; dett: string[]; w: number; xl: number; livello: number };
  const chips: Chip[] = traguardi.map((t) => {
    const righe = avvolgi(t.titolo, 150, 11, true, misura, 1);
    const dett = t.dettaglio ? avvolgi(t.dettaglio, 150, 11, false, misura, 1) : [];
    const w = Math.min(160, Math.max(misura(righe[0], 11, true), dett[0] ? misura(dett[0], 11, false) : 0) + 16);
    const xl = Math.min(Math.max(xDi(t.posizione) - w / 2, area.x), area.x + area.w - w);
    return { t, righe, dett, w, xl, livello: 0 };
  });
  const fineLivello: number[] = [];
  for (const c of chips) {
    let l = 0;
    while (l < fineLivello.length && c.xl < fineLivello[l] + 6) l++;
    c.livello = l;
    fineLivello[l] = c.xl + c.w;
  }
  const livelli = chips.length ? Math.max(...chips.map((c) => c.livello)) + 1 : 0;
  const hTraguardi = livelli ? livelli * (hChip + 5) + 4 : 0;

  // ── Posizioni verticali ──
  const yAsse = area.y + hTraguardi;
  const yRighe = yAsse + H_ASSE;
  const hTotRighe = hVoce.reduce((t, h) => t + h, 0);
  const yFineRighe = yRighe + hTotRighe;

  // sfondi: fasce delle fasi e righe alternate
  let y = yRighe;
  let alterna = false;
  voci.forEach((v, i) => {
    if (v.tipo === "fase") {
      d.rect({ x: area.x, y, w: area.w, h: hVoce[i], fill: tinta(COLORE_PRIMARIO, 0.82) });
      alterna = false;
    } else {
      if (alterna) d.rect({ x: area.x, y, w: area.w, h: hVoce[i], fill: C.bandaFill });
      alterna = !alterna;
    }
    y += hVoce[i];
  });
  d.rect({ x: area.x, y: yRighe, w: area.w, h: hTotRighe, r: 0, stroke: C.bandaBordo, sw: 1 });

  // asse e griglia
  const passo = passoAsse(dati.durata, x1 - x0);
  d.testo(area.x + 4, yAsse + H_ASSE / 2, `Tempo (${dati.unita})`, 11, true, C.grigioTesto, "inizio");
  for (let t = 0; t <= dati.durata + 1e-9; t += passo) {
    const x = xDi(t);
    d.linea([[x, yAsse + H_ASSE - 3], [x, yFineRighe]], C.bandaBordo, 1);
    d.testo(x, yAsse + H_ASSE / 2 - 1, formatta(Math.round(t * 1000) / 1000), 11, false, C.grigioTesto);
  }
  // etichetta dell'ultimo valore, se non coincide con un tick e c'è posto
  const ultimoTick = Math.floor(dati.durata / passo + 1e-9) * passo;
  if (dati.durata - ultimoTick > passo * 0.4) {
    d.linea([[x1, yAsse + H_ASSE - 3], [x1, yFineRighe]], C.bandaBordo, 1);
    d.testo(x1, yAsse + H_ASSE / 2 - 1, formatta(dati.durata), 11, false, C.grigioTesto);
  }

  // righe: etichette, barre, pietre
  y = yRighe;
  voci.forEach((v, i) => {
    const h = hVoce[i];
    if (v.tipo === "fase") {
      d.testo(area.x + 8, y + h / 2, v.nome, 11.5, true, C.testoBlu, "inizio");
      y += h;
      return;
    }
    const r = v.riga;
    const { titolo, resp, h: hTesto } = testiRiga(r);
    let cur = y + (h - hTesto) / 2;
    for (const t of titolo) {
      d.testo(area.x + 8, cur + (12 * INTERLINEA) / 2, t, 12, true, C.testoScuro, "inizio");
      cur += 12 * INTERLINEA;
    }
    for (const t of resp) {
      d.testo(area.x + 8, cur + (11 * INTERLINEA) / 2, t, 11, false, C.grigioTesto, "inizio");
      cur += 11 * INTERLINEA;
    }
    const yc = y + h / 2;
    const barre = [...r.barre].sort((a, b) => a.da - b.da);
    barre.forEach((b, q) => {
      const xa = xDi(b.da);
      const xb = xDi(b.a);
      const fill = b.semantico ? pienoSemantico(b.semantico) : C.primario;
      d.rect({ x: xa, y: yc - H_BARRA / 2, w: Math.max(xb - xa, 3), h: H_BARRA, r: 4, fill });
      if (!b.etichetta) return;
      const wTesto = misura(b.etichetta, 11, true);
      if (wTesto + 10 <= xb - xa) {
        d.testo((xa + xb) / 2, yc, b.etichetta, 11, true, testoSu(fill));
        return;
      }
      const prossimo = barre[q + 1];
      const precedente = barre[q - 1];
      const limiteDestra = prossimo ? xDi(prossimo.da) - 4 : area.x + area.w;
      const limiteSinistra = precedente ? xDi(precedente.a) + 4 : x0;
      if (xb + 5 + wTesto <= limiteDestra) d.testo(xb + 5, yc, b.etichetta, 11, true, C.testoScuro, "inizio");
      else if (xa - 5 - wTesto >= limiteSinistra) d.testo(xa - 5, yc, b.etichetta, 11, true, C.testoScuro, "fine");
      else if (xb - xa >= 36) d.testo((xa + xb) / 2, yc, avvolgi(b.etichetta, xb - xa - 8, 11, true, misura, 1)[0], 11, true, testoSu(fill));
    });
    // l'etichetta di una pietra va a destra o a sinistra del simbolo, dove non copre una barra
    const copreBarra = (da: number, a: number) => barre.some((b) => xDi(b.da) < a && xDi(b.a) > da);
    const altrePietre = (r.pietre ?? []).map((p) => xDi(p.posizione));
    for (const p of r.pietre ?? []) {
      const xp = xDi(p.posizione);
      d.poligono([[xp, yc - R_PIETRA - 1], [xp + R_PIETRA + 1, yc], [xp, yc + R_PIETRA + 1], [xp - R_PIETRA - 1, yc]], C.navy, C.bianco, 1.2);
      if (!p.etichetta) continue;
      const wTesto = misura(p.etichetta, 11, false);
      const liberoDestra = (a: number, b: number) => b <= area.x + area.w && !copreBarra(a, b) && !altrePietre.some((q) => q !== xp && q > a - R_PIETRA && q < b + R_PIETRA);
      const destra: [number, number] = [xp + R_PIETRA + 6, xp + R_PIETRA + 6 + wTesto];
      const sinistra: [number, number] = [xp - R_PIETRA - 6 - wTesto, xp - R_PIETRA - 6];
      if (liberoDestra(destra[0], destra[1])) d.testo(destra[0], yc, p.etichetta, 11, false, C.testoScuro, "inizio");
      else if (sinistra[0] >= x0 && !copreBarra(sinistra[0], sinistra[1]) && !altrePietre.some((q) => q !== xp && q > sinistra[0] - R_PIETRA && q < sinistra[1] + R_PIETRA)) d.testo(sinistra[1], yc, p.etichetta, 11, false, C.testoScuro, "fine");
    }
    y += h;
  });

  // traguardi: linea tratteggiata attraverso le righe e etichetta in testa
  for (const c of chips) {
    const x = xDi(c.t.posizione);
    const yChip = area.y + c.livello * (hChip + 5);
    // la linea scende dall'etichetta, si interrompe sui numeri dell'asse e prosegue fra le righe
    d.linea([[x, yChip + hChip], [x, yAsse + 2]], C.navy, 1.4);
    d.linea([[x, yRighe], [x, yFineRighe]], C.navy, 1.4, [4, 3]);
    const fill = c.t.finale ? C.navy : C.bianco;
    d.rect({ x: c.xl, y: yChip, w: c.w, h: hChip, r: 6, fill, stroke: C.navy, sw: 1.2 });
    const colore = c.t.finale ? testoSu(C.navy) : C.testoScuro;
    if (c.dett.length) {
      d.testo(c.xl + c.w / 2, yChip + hChip / 2 - 7, c.righe[0], 11, true, colore);
      d.testo(c.xl + c.w / 2, yChip + hChip / 2 + 7, c.dett[0], 11, false, colore);
    } else d.testo(c.xl + c.w / 2, yChip + hChip / 2, c.righe[0], 11, true, colore);
  }

  let fine = yFineRighe;
  // ── Banda e nota ──
  if (dati.banda) fine += 16 + d.banda(area.x, fine + 16, area.w, dati.banda.titolo, dati.banda.descrizione);
  if (dati.nota) {
    const righeNota = avvolgi(dati.nota, area.w, 12, false, misura, 3);
    righeNota.forEach((t, i) => d.testo(area.x, fine + 16 + i * 12 * INTERLINEA, t, 12, false, C.grigioTesto, "inizio"));
    fine += 16 + righeNota.length * 12 * INTERLINEA;
  }
  return fine - area.y;
}
