import { pienoSemantico, avvolgi, altezzaRighe, C, Disegno, INTERLINEA, tinta, testoSu, type Posizione, type Riga } from "@/lib/figure-base";
import { COLORE_PRIMARIO, type TipoSemantico } from "@/lib/colori-semantici";
import type { DatiFlusso, PassoFlusso, RamoFlusso, StadioFlusso } from "@/lib/figure-dati";

// Layout del FLUSSO DI PROCESSO (archetipo 1). Sequenza di stadi in ordine:
// passi, alternative (una sola si attiva), rami paralleli (tutti si attivano)
// e bande a piena larghezza. Gli stadi vanno a capo da soli quando non
// entrano in una riga, collegati da una serpentina; un passo può avere un
// ramo laterale; un ritorno a monte è un tratteggio che torna indietro.
// Un gruppo di rami che sta in riga con altri stadi è una colonna; un gruppo
// che resta da solo su una riga si dispone in orizzontale, con un bus sopra e
// uno sotto. Opera su un Disegno e un'area (x, y, w): serve anche dentro il
// pannello di uno schema a livelli. Ritorna l'altezza usata.

type Item =
  | { k: "passo"; stadio: PassoFlusso; indiceStadio: number; numero?: number }
  | { k: "gruppo"; semantica: "alternative" | "paralleli"; rami: RamoFlusso[]; indiceStadio: number; orizzontale?: boolean }
  | { k: "banda"; titolo: string; dettaglio?: string; indiceStadio: number };

type Collocato = Item & { x: number; y: number; w: number; h: number; ramiPos?: Posizione[] };

const GAP = 16;
const GAP_GRUPPO = 30;
const GAP_RIGHE = 40;
const GAP_RAMI_ORIZZONTALI = 12;
const H_LATERALE_MIN = 34;
// Spazio fra il ramo laterale e il suo passo (la freccia e la sua etichetta).
const GAP_LATERALE = 30;
const H_CHIP = 17;
const GAP_CHIP = 6;
// Spazio in più per far passare il tratteggio di un ritorno fra una riga e l'altra.
const EXTRA_RITORNO = 24;

// larghezzaPasso: fissa la larghezza dei passi (un passo largo quanto l'area
// dispone il flusso in verticale); gapRighe: spazio fra le righe.
export type OpzioniFlusso = { larghezzaPasso?: number; gapRighe?: number };

export function disegnaFlusso(d: Disegno, dati: DatiFlusso, area: { x: number; y: number; w: number }, opzioni: OpzioniFlusso = {}): number {
  const misura = d.misura;
  let wPasso = opzioni.larghezzaPasso ?? (area.w >= 500 ? 146 : Math.max(88, Math.floor((area.w - GAP) / 2)));
  let wGruppo = Math.min(area.w, wPasso + 30);

  // ── Stadi → item ──
  let contaPassi = 0;
  const items: Item[] = dati.stadi.map((s: StadioFlusso, i: number): Item => {
    if (s.tipo === "passo") return { k: "passo", stadio: s, indiceStadio: i, numero: dati.numerato ? ++contaPassi : undefined };
    if (s.tipo === "banda") return { k: "banda", titolo: s.titolo, dettaglio: s.dettaglio, indiceStadio: i };
    return { k: "gruppo", semantica: s.tipo, rami: s.rami, indiceStadio: i };
  });

  const larghezzaItem = (it: Item) => (it.k === "banda" || (it.k === "gruppo" && it.orizzontale) ? area.w : it.k === "gruppo" ? wGruppo : wPasso);
  const gapTra = (a: Item, b: Item) => (a.k === "gruppo" || b.k === "gruppo" ? GAP_GRUPPO : GAP);

  // Un flusso corto sta su una riga: si restringono i passi (fino a 112) pur di
  // non andare a capo; se nemmeno così entra, si torna alla larghezza piena e
  // si va a capo a serpentina.
  if (opzioni.larghezzaPasso === undefined && area.w >= 500) {
    const segmenti: Item[][] = [];
    let seg: Item[] = [];
    for (const it of items) {
      if (it.k === "banda") {
        if (seg.length) segmenti.push(seg);
        seg = [];
      } else seg.push(it);
    }
    if (seg.length) segmenti.push(seg);
    const entra = () => segmenti.every((s) => s.reduce((t, it, i) => t + larghezzaItem(it) + (i ? gapTra(s[i - 1], it) : 0), 0) <= area.w + 0.5);
    let trovato = false;
    for (let w = 146; w >= 112; w -= 6) {
      wPasso = w;
      wGruppo = Math.min(area.w, w + 40);
      if (entra()) {
        trovato = true;
        break;
      }
    }
    if (!trovato) {
      wPasso = 146;
      wGruppo = Math.min(area.w, 186);
    }
  }

  // ── Misure dei testi e altezze delle caselle ──
  const stile = (sem: TipoSemantico | undefined, predefinito: { fill: string; stroke?: string; testo: string; dettaglio: string }) => {
    if (!sem) return predefinito;
    const fill = pienoSemantico(sem);
    const t = testoSu(fill);
    return { fill, stroke: undefined, testo: t, dettaglio: t };
  };
  const stilePasso = (it: Extract<Item, { k: "passo" }>) => {
    const primo = it.indiceStadio === 0;
    const ultimo = it.indiceStadio === dati.stadi.length - 1;
    if (primo && !it.stadio.semantico) return { fill: C.primario, testo: testoSu(C.primario), dettaglio: testoSu(C.primario) } as const;
    if (ultimo && !it.stadio.semantico) return { fill: C.bianco, stroke: C.primario, testo: C.testoBlu, dettaglio: C.dettaglioBlu, sw: 1.8 } as const;
    return stile(it.stadio.semantico, { fill: tinta(COLORE_PRIMARIO, 0.82), testo: C.testoBlu, dettaglio: C.dettaglioBlu });
  };
  const righePasso = (it: Extract<Item, { k: "passo" }>): Riga[] => {
    const st = stilePasso(it);
    return d.righeTitoloDettaglio(it.stadio.titolo, it.stadio.dettaglio, wPasso, { titolo: st.testo, dettaglio: st.dettaglio }, { maxTitolo: 3, maxDettaglio: 3 });
  };
  // Il responsabile è un'etichetta bianca in fondo alla casella, distinta dal dettaglio.
  // Se il ruolo non entra in una riga va a capo (al massimo due), mai troncato a metà.
  const chipPasso = (it: Extract<Item, { k: "passo" }>) => {
    if (!it.stadio.responsabile) return null;
    const testi = avvolgi(it.stadio.responsabile, wPasso - 30, 12, false, misura, 2);
    return { testi, w: Math.min(wPasso - 16, Math.max(...testi.map((t) => misura(t, 12, false))) + 16), h: testi.length === 1 ? H_CHIP : 8 + testi.length * 14 };
  };
  const altezzaTestoPasso = (it: Extract<Item, { k: "passo" }>) => altezzaRighe(righePasso(it)) + (chipPasso(it) ? GAP_CHIP + (chipPasso(it)?.h ?? 0) : 0);
  const stileRamo = (r: RamoFlusso) => stile(r.semantico, { fill: C.bianco, stroke: C.linea, testo: C.testoScuro, dettaglio: C.grigioTesto });
  // larghezza di un ramo: in colonna quella del gruppo, in orizzontale divisa fra i rami
  const larghezzaRamo = (it: Extract<Item, { k: "gruppo" }>) =>
    it.orizzontale ? Math.min(230, (area.w - GAP_RAMI_ORIZZONTALI * (it.rami.length - 1)) / it.rami.length) : wGruppo;
  const righeRamo = (it: Extract<Item, { k: "gruppo" }>, r: RamoFlusso): Riga[] => {
    const st = stileRamo(r);
    return d.righeTitoloDettaglio(r.titolo, r.dettaglio, larghezzaRamo(it), { titolo: st.testo, dettaglio: st.dettaglio }, { maxTitolo: 2, maxDettaglio: 3 });
  };
  const hCasella = (righe: Riga[]) => 18 + altezzaRighe(righe);
  const hRamoMax = (it: Extract<Item, { k: "gruppo" }>) => Math.max(...it.rami.map((r) => hCasella(righeRamo(it, r))));

  const hItem = (it: Item): number => {
    if (it.k === "passo") return 18 + altezzaTestoPasso(it);
    if (it.k === "banda") {
      const righe: Riga[] = avvolgi(it.titolo, area.w - 28, 14, true, misura, 2).map((t) => ({ testo: t, size: 14, bold: true, colore: C.testoScuro }));
      if (it.dettaglio) for (const t of avvolgi(it.dettaglio, area.w - 28, 12, false, misura, 3)) righe.push({ testo: t, size: 12, bold: false, colore: C.testoScuro });
      return hCasella(righe);
    }
    const h = hRamoMax(it);
    return it.orizzontale ? h : it.rami.length * h + (it.rami.length - 1) * 10;
  };

  // ── Righe: si va a capo quando non si entra, le bande hanno una riga sola ──
  const righe: Item[][] = [];
  let corrente: Item[] = [];
  let larghezzaCorrente = 0;
  for (const it of items) {
    if (it.k === "banda") {
      if (corrente.length) righe.push(corrente);
      righe.push([it]);
      corrente = [];
      larghezzaCorrente = 0;
      continue;
    }
    const w = larghezzaItem(it);
    const extra = corrente.length ? gapTra(corrente[corrente.length - 1], it) : 0;
    if (corrente.length && larghezzaCorrente + extra + w > area.w + 0.5) {
      righe.push(corrente);
      corrente = [];
      larghezzaCorrente = 0;
    }
    larghezzaCorrente += (corrente.length ? gapTra(corrente[corrente.length - 1], it) : 0) + w;
    corrente.push(it);
  }
  if (corrente.length) righe.push(corrente);
  // un gruppo rimasto solo su una riga si dispone in orizzontale
  for (const riga of righe) if (riga.length === 1 && riga[0].k === "gruppo") riga[0].orizzontale = true;

  // ── Posizionamento ──
  // Il ramo laterale sta sopra il passo, nella metà destra: la metà sinistra
  // resta libera per la freccia che arriva dalla riga precedente.
  const wLaterale = () => Math.round(wPasso * 0.68);
  const hLaterale = (it: Extract<Item, { k: "passo" }>) => {
    if (!it.stadio.ramoLaterale) return 0;
    const r = avvolgi(it.stadio.ramoLaterale.titolo, wLaterale() - 14, 12, true, misura, 3);
    return Math.max(H_LATERALE_MIN, 16 + r.length * 12 * INTERLINEA);
  };
  const collocati: Collocato[][] = [];
  const ritorno = dati.ritorno;
  const rigaDi = new Map<number, number>();
  righe.forEach((riga, ri) => riga.forEach((it) => rigaDi.set(it.indiceStadio, ri)));
  const rigaDa = ritorno ? rigaDi.get(ritorno.da) : undefined;
  const rigaA = ritorno ? rigaDi.get(ritorno.a) : undefined;
  const ritornoTraRighe = rigaDa !== undefined && rigaA !== undefined && rigaDa !== rigaA;
  const ritornoInRiga = rigaDa !== undefined && rigaDa === rigaA ? rigaDa : -1;
  // Il tratteggio del ritorno passa sotto la riga di partenza (e sopra quella di
  // arrivo, o sotto la stessa riga): lì lo spazio fra le righe cresce.
  const extraDopo = (g: number) => (ritornoInRiga === g || (ritornoTraRighe && (g === rigaDa || g + 1 === rigaA)) ? EXTRA_RITORNO : 0);
  let y = area.y + (ritornoTraRighe && rigaA === 0 ? EXTRA_RITORNO : 0);

  righe.forEach((riga, ri) => {
    const topExtra = riga.reduce((m, it) => (it.k === "passo" ? Math.max(m, hLaterale(it) ? hLaterale(it) + GAP_LATERALE : 0) : m), 0);
    const hRiga = Math.max(...riga.map(hItem));
    const larghezzaRiga = riga.reduce((t, it, i) => t + larghezzaItem(it) + (i ? gapTra(riga[i - 1], it) : 0), 0);
    let x = area.x + (area.w - larghezzaRiga) / 2;
    const yCorpo = y + topExtra;
    const lista: Collocato[] = [];
    riga.forEach((it, i) => {
      if (i) x += gapTra(riga[i - 1], it);
      const w = larghezzaItem(it);
      const h = hItem(it);
      // passi: tutti alti quanto il più alto fra i passi della riga; gruppi centrati
      const hVis = it.k === "passo" ? Math.max(...riga.filter((q) => q.k === "passo").map(hItem)) : h;
      const yI = yCorpo + (hRiga - hVis) / 2;
      lista.push({ ...it, x, y: yI, w, h: hVis });
      x += w;
    });
    collocati.push(lista);
    y = yCorpo + hRiga + (ri < righe.length - 1 ? (opzioni.gapRighe ?? GAP_RIGHE) + extraDopo(ri) : 0);
  });

  // ── Disegno delle caselle ──
  const bottomDi = (c: Collocato) => (c.k === "gruppo" ? Math.max(...(c.ramiPos ?? []).map((p) => p.y + p.h)) : c.y + c.h);
  const topDi = (c: Collocato) => (c.k === "gruppo" ? Math.min(...(c.ramiPos ?? []).map((p) => p.y)) : c.y);
  for (const lista of collocati) {
    for (const c of lista) {
      if (c.k === "passo") {
        const st = stilePasso(c);
        d.rect({ x: c.x, y: c.y, w: c.w, h: c.h, r: 8, fill: st.fill, stroke: st.stroke, sw: "sw" in st ? st.sw : 1.2 });
        const righeT = righePasso(c);
        const chip = chipPasso(c);
        let cur = c.y + (c.h - altezzaTestoPasso(c)) / 2;
        for (const r of righeT) {
          const hr = r.size * INTERLINEA;
          d.testo(c.x + c.w / 2, cur + hr / 2, r.testo, r.size, r.bold, r.colore);
          cur += hr;
        }
        if (chip) {
          d.rect({ x: c.x + (c.w - chip.w) / 2, y: cur + GAP_CHIP, w: chip.w, h: chip.h, r: Math.min(chip.h / 2, 10), fill: C.bianco, stroke: C.bandaBordo, sw: 1 });
          chip.testi.forEach((t, q) => d.testo(c.x + c.w / 2, cur + GAP_CHIP + chip.h / 2 + (q - (chip.testi.length - 1) / 2) * 14, t, 12, false, C.testoBlu));
        }
        // il numero del passo sta in un cerchio sull'angolo, così non toglie spazio al titolo
        if (c.numero) {
          d.cerchio(c.x + 16, c.y, 10, C.bianco, C.primario, 1.6);
          d.testo(c.x + 16, c.y + 0.5, String(c.numero), 11, true, C.testoBlu);
        }
        const lat = c.stadio.ramoLaterale;
        if (lat) {
          const hL = hLaterale(c);
          const yL = c.y - GAP_LATERALE - hL;
          const stL = stile(lat.semantico, { fill: C.bianco, stroke: C.linea, testo: C.testoScuro, dettaglio: C.grigioTesto });
          const wL = wLaterale();
          const xL = c.x + c.w - wL;
          d.rect({ x: xL, y: yL, w: wL, h: hL, r: 8, fill: stL.fill, stroke: stL.stroke, sw: 1.2 });
          const rl = avvolgi(lat.titolo, wL - 14, 12, true, misura, 3);
          rl.forEach((t, q) => d.testo(xL + wL / 2, yL + hL / 2 + (q - (rl.length - 1) / 2) * 12 * INTERLINEA, t, 12, true, stL.testo));
          // dal passo verso il ramo (se la condizione è vera si va lì)
          d.linea([[xL + wL / 2, c.y - 2], [xL + wL / 2, yL + hL + 2]], C.lineaScura, 1.4, undefined, "fine");
          // l'etichetta sta in alto, sopra la zona del numero del passo vicino
          if (lat.etichetta) d.testo(xL + wL / 2 + 8, c.y - 21, lat.etichetta, 12, true, C.grigioTesto, "inizio");
        }
      } else if (c.k === "banda") {
        d.rect({ x: c.x, y: c.y, w: c.w, h: c.h, r: 8, fill: C.bannerFill });
        const righeT: Riga[] = avvolgi(c.titolo, c.w - 28, 14, true, misura, 2).map((t) => ({ testo: t, size: 14, bold: true, colore: C.testoScuro }));
        if (c.dettaglio) for (const t of avvolgi(c.dettaglio, c.w - 28, 12, false, misura, 3)) righeT.push({ testo: t, size: 12, bold: false, colore: C.testoScuro });
        let cur = c.y + (c.h - altezzaRighe(righeT)) / 2;
        for (const r of righeT) {
          const hr = r.size * INTERLINEA;
          d.testo(c.x + c.w / 2, cur + hr / 2, r.testo, r.size, r.bold, r.colore);
          cur += hr;
        }
      } else {
        const hRamo = hRamoMax(c);
        const wRamo = larghezzaRamo(c);
        const totaleOrizz = c.rami.length * wRamo + (c.rami.length - 1) * GAP_RAMI_ORIZZONTALI;
        const ramiPos: Posizione[] = [];
        c.rami.forEach((r, q) => {
          const pos: Posizione = c.orizzontale
            ? { x: area.x + (area.w - totaleOrizz) / 2 + q * (wRamo + GAP_RAMI_ORIZZONTALI), y: c.y, w: wRamo, h: hRamo }
            : { x: c.x, y: c.y + q * (hRamo + 10), w: c.w, h: hRamo };
          ramiPos.push(pos);
          const st = stileRamo(r);
          d.rect({ ...pos, r: 8, fill: st.fill, stroke: st.stroke, sw: 1.2 });
          const righeT = righeRamo(c, r);
          let cur = pos.y + (pos.h - altezzaRighe(righeT)) / 2;
          for (const rr of righeT) {
            const hr = rr.size * INTERLINEA;
            d.testo(pos.x + pos.w / 2, cur + hr / 2, rr.testo, rr.size, rr.bold, rr.colore);
            cur += hr;
          }
          if (c.orizzontale && r.etichetta) d.testo(pos.x + pos.w / 2 + 6, pos.y - 8, r.etichetta, 12, true, C.grigioTesto, "inizio");
        });
        c.ramiPos = ramiPos;
      }
    }
  }

  // ── Connettori ──
  const col = C.lineaScura;
  collocati.forEach((lista, ri) => {
    for (let i = 0; i + 1 < lista.length; i++) {
      const a = lista[i];
      const b = lista[i + 1];
      const yc = a.y + a.h / 2;
      const ycB = b.y + b.h / 2;
      const xFineA = a.x + a.w;
      if (a.k === "gruppo" && b.k === "gruppo") {
        const xBus2 = xFineA + 14;
        const xBus1 = b.x - 14;
        const centriA = (a.ramiPos ?? []).map((p) => p.y + p.h / 2);
        const centriB = (b.ramiPos ?? []).map((p) => p.y + p.h / 2);
        for (const cy of centriA) d.linea([[xFineA, cy], [xBus2, cy]], col, 1.4);
        d.linea([[xBus2, Math.min(...centriA)], [xBus2, Math.max(...centriA)]], col, 1.4);
        d.linea([[xBus2, yc], [xBus1, ycB]], col, 1.4);
        d.linea([[xBus1, Math.min(...centriB)], [xBus1, Math.max(...centriB)]], col, 1.4);
        for (const cy of centriB) d.linea([[xBus1, cy], [b.x - 2, cy]], col, 1.4, undefined, "fine");
      } else if (b.k === "gruppo") {
        const xBus = b.x - 14;
        const centriB = (b.ramiPos ?? []).map((p) => p.y + p.h / 2);
        d.linea([[xFineA, yc], [xBus, yc]], col, 1.4);
        d.linea([[xBus, Math.min(...centriB, yc)], [xBus, Math.max(...centriB, yc)]], col, 1.4);
        centriB.forEach((cy, q) => {
          d.linea([[xBus, cy], [b.x - 2, cy]], col, 1.4, undefined, "fine");
          const et = b.rami[q].etichetta;
          if (et) d.testo(xBus + 3, cy - 9, et, 12, true, C.grigioTesto, "inizio");
        });
      } else if (a.k === "gruppo") {
        const xBus = xFineA + 14;
        const centriA = (a.ramiPos ?? []).map((p) => p.y + p.h / 2);
        for (const cy of centriA) d.linea([[xFineA, cy], [xBus, cy]], col, 1.4);
        d.linea([[xBus, Math.min(...centriA, ycB)], [xBus, Math.max(...centriA, ycB)]], col, 1.4);
        d.linea([[xBus, ycB], [b.x - 2, ycB]], col, 1.4, undefined, "fine");
      } else {
        d.linea([[xFineA, yc], [b.x - 2, ycB]], col, 1.4, undefined, "fine");
      }
    }
    // collegamento con la riga successiva (serpentina o bus dei gruppi orizzontali)
    if (ri + 1 < collocati.length) {
      const ultimo = lista[lista.length - 1];
      const prossimo = collocati[ri + 1][0];
      let bottomUltimo = bottomDi(ultimo);
      let xA = ultimo.x + ultimo.w / 2;
      if (ultimo.k === "gruppo" && ultimo.orizzontale) {
        // dai rami a un bus sotto, poi giù dal centro del gruppo
        const centri = (ultimo.ramiPos ?? []).map((p) => p.x + p.w / 2);
        const bus2 = bottomUltimo + 16;
        for (const cx of centri) d.linea([[cx, bottomUltimo], [cx, bus2]], col, 1.4);
        if (centri.length > 1) d.linea([[Math.min(...centri), bus2], [Math.max(...centri), bus2]], col, 1.4);
        xA = (Math.min(...centri) + Math.max(...centri)) / 2;
        bottomUltimo = bus2;
      }
      if (prossimo.k === "gruppo" && prossimo.orizzontale) {
        // bus sopra il gruppo: la linea scende fino al bus, che alimenta ogni ramo
        const centri = (prossimo.ramiPos ?? []).map((p) => p.x + p.w / 2);
        const busY = topDi(prossimo) - 16;
        d.linea([[xA, bottomUltimo + 1], [xA, busY]], col, 1.4);
        d.linea([[Math.min(xA, ...centri), busY], [Math.max(xA, ...centri), busY]], col, 1.4);
        for (const cx of centri) d.linea([[cx, busY], [cx, topDi(prossimo) - 2]], col, 1.4, undefined, "fine");
      } else {
        const topProssimo = topDi(prossimo);
        // con un ramo laterale sopra il primo passo la freccia arriva nella metà sinistra
        const laterale = prossimo.k === "passo" && !!prossimo.stadio.ramoLaterale;
        const xB = laterale ? prossimo.x + prossimo.w * 0.2 : prossimo.x + prossimo.w / 2;
        let lane = bottomUltimo + (topProssimo - bottomUltimo) / 2;
        // i rami laterali della riga che segue occupano la parte bassa dello spazio: la corsia sta in alto
        if (collocati[ri + 1].some((q) => q.k === "passo" && !!q.stadio.ramoLaterale)) lane = bottomUltimo + 14;
        // dove passa un ritorno la serpentina si sposta, per non toccare il tratteggio
        if (extraDopo(ri)) lane = ritornoInRiga === ri ? topProssimo - 14 : ritornoTraRighe && ri === rigaDa ? bottomUltimo + 44 : topProssimo - 34;
        const laneY = Math.min(Math.max(lane, bottomUltimo + 10), topProssimo - 12);
        d.linea(Math.abs(xA - xB) < 0.5 ? [[xA, bottomUltimo + 1], [xB, topProssimo - 2]] : [[xA, bottomUltimo + 1], [xA, laneY], [xB, laneY], [xB, topProssimo - 2]], col, 1.4, undefined, "fine");
      }
    }
  });

  // ── Ritorno a monte ──
  if (ritorno) {
    const trova = (indiceStadio: number) => collocati.flat().find((c) => c.indiceStadio === indiceStadio);
    const da = trova(ritorno.da);
    const a = trova(ritorno.a);
    if (da && a) {
      const bottomDa = bottomDi(da);
      const bottomA = bottomDi(a);
      // se sotto la riga c'è la serpentina, il tratteggio parte e arriva sfalsato dal centro
      const sfalsato = rigaDa !== undefined && rigaDa < collocati.length - 1;
      const xDa = da.x + da.w * (sfalsato ? 0.7 : 0.5);
      const xA = a.x + a.w * (ritornoTraRighe || sfalsato ? 0.3 : 0.5);
      const fondoRiga = (r: number | undefined) => Math.max(...collocati[r ?? 0].map(bottomDi));
      if (!ritornoTraRighe) {
        const yPercorso = fondoRiga(rigaDa) + 16;
        d.linea([[xDa, bottomDa + 1], [xDa, yPercorso], [xA, yPercorso], [xA, bottomA + 2]], C.linea, 1.5, [5, 3], "fine");
        if (ritorno.etichetta) d.testo((xDa + xA) / 2, yPercorso + 11, ritorno.etichetta, 12, true, C.grigioTesto);
      } else {
        const yPercorso = fondoRiga(rigaDa) + 14;
        const xMargine = area.x - 10;
        const topA = topDi(a);
        d.linea([[xDa, bottomDa + 1], [xDa, yPercorso], [xMargine, yPercorso], [xMargine, topA - 16], [xA, topA - 16], [xA, topA - 2]], C.linea, 1.5, [5, 3], "fine");
        if (ritorno.etichetta) d.testo(xMargine + 6, yPercorso + 11, ritorno.etichetta, 12, true, C.grigioTesto, "inizio");
      }
    }
  }

  let fine = collocati.flat().reduce((m, c) => Math.max(m, bottomDi(c)), area.y);
  // il tratteggio di un ritorno che parte dall'ultima riga passa sotto di essa
  if (rigaDa === collocati.length - 1) fine += ritornoTraRighe && !ritorno?.etichetta ? 16 : 36;
  if (dati.nota) {
    const righeNota = avvolgi(dati.nota, area.w, 12, false, misura, 3);
    righeNota.forEach((t, i) => d.testo(area.x, fine + 18 + i * 12 * INTERLINEA, t, 12, false, C.grigioTesto, "inizio"));
    fine += 18 + righeNota.length * 12 * INTERLINEA;
  }
  return fine - area.y;
}
