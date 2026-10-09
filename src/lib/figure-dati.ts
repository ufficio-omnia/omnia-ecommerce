import { riconosciTipoSemantico, type TipoSemantico } from "@/lib/colori-semantici";
import { pulisciTesto } from "@/lib/organigramma-dati";

// Figure schematiche come DATI strutturati (archetipi): flusso di processo,
// livelli di controllo, cronoprogramma, cruscotto illustrativo, rete. Il
// modello dichiara contenuto e relazioni; colori, posizioni e stile li decide
// il disegnatore (R20). Stesso meccanismo dell'organigramma: nel testo il
// segnaposto "[FIGURA:n]" (n = posizione nell'elenco "figure" dello
// strumento), il blocco "[FIGURA]{json}[/FIGURA]" costruito dal codice DOPO
// ogni riscrittura e invisibile a compressione ed espansione. La numerazione
// «Figura N» la assegna il codice nel documento, mai il modello.
//
// Modulo PURO: tipi, lettura difensiva di ciò che arriva dal modello,
// serializzazione, segnaposto e maschere.

export const ARCHETIPI = ["flusso", "livelli", "cronoprogramma", "cruscotto", "rete"] as const;
export type Archetipo = (typeof ARCHETIPI)[number];

export const LIMITI_FIGURE = {
  figurePerSezione: 4,
  stadiFlusso: 12,
  ramiPerStadio: 5,
  livelli: 6,
  vociPannello: 8,
  righeCronoprogramma: 14,
  barrePerRiga: 4,
  traguardi: 6,
  indicatori: 4,
  righeCruscotto: 8,
  vociLaterale: 5,
  nodiRete: 8,
  originiRete: 3,
  vociCentro: 8,
  chip: 6,
  titolo: 70,
  dettaglio: 110,
  descrizione: 160,
  didascalia: 220,
} as const;

// ─── Flusso ───
export type RamoFlusso = { titolo: string; dettaglio?: string; etichetta?: string; semantico?: TipoSemantico };
export type PassoFlusso = {
  tipo: "passo";
  titolo: string;
  dettaglio?: string;
  responsabile?: string;
  semantico?: TipoSemantico;
  ramoLaterale?: { titolo: string; etichetta?: string; semantico?: TipoSemantico };
};
export type StadioFlusso =
  | PassoFlusso
  | { tipo: "alternative"; rami: RamoFlusso[] }
  | { tipo: "paralleli"; rami: RamoFlusso[] }
  | { tipo: "banda"; titolo: string; dettaglio?: string };
export type DatiFlusso = {
  stadi: StadioFlusso[];
  ritorno?: { da: number; a: number; etichetta?: string };
  nota?: string;
  numerato?: boolean;
};

// ─── Livelli di controllo ───
export type LivelloControllo = { titolo: string; responsabile?: string; descrizione?: string };
export type DatiLivelli = {
  // dal livello 1 (in basso) verso l'alto
  livelli: LivelloControllo[];
  pannello?: { titolo: string; forma: "elenco" | "flusso"; voci?: string[]; flusso?: DatiFlusso; collegaLivelli?: boolean };
  banda?: { titolo: string; descrizione?: string };
};

// ─── Cronoprogramma ───
export const UNITA_TEMPO = ["minuti", "ore", "giorni", "settimane", "mesi"] as const;
export type UnitaTempo = (typeof UNITA_TEMPO)[number];
export type BarraCronoprogramma = { da: number; a: number; etichetta?: string; semantico?: TipoSemantico };
export type RigaCronoprogramma = {
  titolo: string;
  responsabile?: string;
  fase?: string;
  barre: BarraCronoprogramma[];
  pietre?: { posizione: number; etichetta?: string }[];
};
export type DatiCronoprogramma = {
  unita: UnitaTempo;
  durata: number;
  traguardi?: { posizione: number; titolo: string; dettaglio?: string; finale?: boolean }[];
  righe: RigaCronoprogramma[];
  banda?: { titolo: string; descrizione?: string };
  nota?: string;
};

// ─── Cruscotto illustrativo ───
export const STATI_RIGA = ["conforme", "attenzione", "scostamento"] as const;
export type StatoRiga = (typeof STATI_RIGA)[number];
export type DatiCruscotto = {
  // Non lo scrive il modello: lo inserisce il codice dal profilo aziendale.
  piattaforma?: string;
  profilo: string;
  // etichetta + obiettivo ricavato dai documenti; il rilevato non c'è mai.
  indicatori: { etichetta: string; obiettivo: string }[];
  righe: { indicatore: string; obiettivo: string; stato?: StatoRiga }[];
  laterale?: { titolo: string; voci: string[] };
};

// ─── Rete ───
export type DatiRete = {
  centro: { titolo: string; sottotitolo?: string; voci?: string[] };
  nodi: { titolo: string; dettaglio?: string; semantico?: TipoSemantico }[];
  origini?: { titolo: string; dettaglio?: string; voci?: string[]; semantico?: TipoSemantico }[];
  chip?: { titolo: string; voci: string[] };
  banda?: { titolo: string; dettaglio?: string };
  collegamento?: "bidirezionale" | "verso_centro" | "da_centro";
  nota?: string;
};

export type DatiFigura = { v: 1; didascalia: string } & (
  | { archetipo: "flusso"; flusso: DatiFlusso }
  | { archetipo: "livelli"; livelli: DatiLivelli }
  | { archetipo: "cronoprogramma"; cronoprogramma: DatiCronoprogramma }
  | { archetipo: "cruscotto"; cruscotto: DatiCruscotto }
  | { archetipo: "rete"; rete: DatiRete }
);

// ─── Lettura difensiva di ciò che dichiara il modello ───
function elenco(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function oggetto(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
const T = LIMITI_FIGURE;
const titolo = (v: unknown) => pulisciTesto(v, T.titolo);
const dettaglio = (v: unknown) => pulisciTesto(v, T.dettaglio);
const descrizione = (v: unknown) => pulisciTesto(v, T.descrizione);
const semantico = (v: unknown): TipoSemantico | undefined => (typeof v === "string" ? riconosciTipoSemantico(v) ?? undefined : undefined);
const numero = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
function con<T extends object>(base: T, extra: Record<string, unknown>): T {
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && !(Array.isArray(v) && v.length === 0)) (base as Record<string, unknown>)[k] = v;
  return base;
}

function leggiRami(v: unknown, avvisi: string[], nome: string): RamoFlusso[] {
  const rami: RamoFlusso[] = [];
  for (const r of elenco(v)) {
    const o = oggetto(r);
    const t = o ? titolo(o.titolo) : undefined;
    if (!o || !t) continue;
    rami.push(con<RamoFlusso>({ titolo: t }, { dettaglio: dettaglio(o.dettaglio), etichetta: pulisciTesto(o.etichetta, 40), semantico: semantico(o.semantico) }));
  }
  if (rami.length > T.ramiPerStadio) {
    avvisi.push(`${nome}: oltre ${T.ramiPerStadio} rami, i restanti non sono stati disegnati.`);
    rami.length = T.ramiPerStadio;
  }
  return rami;
}

export function leggiFlusso(raw: unknown, avvisi: string[]): DatiFlusso | null {
  const o = oggetto(raw);
  if (!o) return null;
  const stadi: StadioFlusso[] = [];
  for (const s of elenco(o.stadi)) {
    const so = oggetto(s);
    if (!so) continue;
    const tipoGrezzo = typeof so.tipo === "string" ? so.tipo : Array.isArray(so.rami) ? "alternative" : "passo";
    if (tipoGrezzo === "alternative" || tipoGrezzo === "paralleli") {
      const rami = leggiRami(so.rami, avvisi, tipoGrezzo === "alternative" ? "Alternative" : "Rami paralleli");
      if (rami.length >= 2) stadi.push({ tipo: tipoGrezzo, rami });
      else avvisi.push("Uno stadio con meno di due rami è stato scartato.");
    } else if (tipoGrezzo === "banda") {
      const t = titolo(so.titolo);
      if (t) stadi.push(con<StadioFlusso>({ tipo: "banda", titolo: t }, { dettaglio: dettaglio(so.dettaglio) }));
    } else {
      const t = titolo(so.titolo);
      if (!t) continue;
      const lat = oggetto(so.ramo_laterale);
      const latTitolo = lat ? titolo(lat.titolo) : undefined;
      stadi.push(
        con<PassoFlusso>(
          { tipo: "passo", titolo: t },
          {
            dettaglio: dettaglio(so.dettaglio),
            responsabile: pulisciTesto(so.responsabile, 60),
            semantico: semantico(so.semantico),
            ramoLaterale: lat && latTitolo ? con({ titolo: latTitolo } as { titolo: string; etichetta?: string; semantico?: TipoSemantico }, { etichetta: pulisciTesto(lat.etichetta, 40), semantico: semantico(lat.semantico) }) : undefined,
          },
        ),
      );
    }
  }
  if (stadi.length > T.stadiFlusso) {
    avvisi.push(`Flusso con oltre ${T.stadiFlusso} stadi: i restanti non sono stati disegnati.`);
    stadi.length = T.stadiFlusso;
  }
  if (stadi.length < 2) return null;
  const flusso: DatiFlusso = { stadi };
  const rit = oggetto(o.ritorno);
  if (rit) {
    const da = numero(rit.da);
    const a = numero(rit.a);
    // numeri 1-based come li scrive il modello ("dallo stadio 5 al 2")
    if (da !== null && a !== null && Number.isInteger(da) && Number.isInteger(a) && da >= 1 && a >= 1 && da <= stadi.length && a < da) {
      flusso.ritorno = con({ da: da - 1, a: a - 1 } as { da: number; a: number; etichetta?: string }, { etichetta: pulisciTesto(rit.etichetta, 40) });
    } else avvisi.push("Ritorno a monte scartato: gli stadi indicati non sono validi (deve tornare da uno stadio successivo a uno precedente).");
  }
  const nota = descrizione(o.nota);
  if (nota) flusso.nota = nota;
  if (o.numerato === true) flusso.numerato = true;
  return flusso;
}

export function leggiLivelli(raw: unknown, avvisi: string[]): DatiLivelli | null {
  const o = oggetto(raw);
  if (!o) return null;
  const livelli: LivelloControllo[] = [];
  for (const l of elenco(o.livelli)) {
    const lo = oggetto(l);
    const t = lo ? titolo(lo.titolo) : undefined;
    if (!lo || !t) continue;
    livelli.push(con<LivelloControllo>({ titolo: t }, { responsabile: pulisciTesto(lo.responsabile, 70), descrizione: descrizione(lo.descrizione) }));
  }
  if (livelli.length > T.livelli) {
    avvisi.push(`Oltre ${T.livelli} livelli: i restanti non sono stati disegnati.`);
    livelli.length = T.livelli;
  }
  if (livelli.length < 2) return null;
  const dati: DatiLivelli = { livelli };
  const p = oggetto(o.pannello);
  const pt = p ? titolo(p.titolo) : undefined;
  if (p && pt) {
    if (p.forma === "flusso") {
      const flusso = leggiFlusso(p.flusso, avvisi);
      if (flusso) dati.pannello = { titolo: pt, forma: "flusso", flusso, ...(p.collega_livelli === true ? { collegaLivelli: true } : {}) };
    } else {
      const voci = elenco(p.voci).map((v) => titolo(v)).filter((v): v is string => !!v).slice(0, T.vociPannello);
      if (voci.length) dati.pannello = { titolo: pt, forma: "elenco", voci, collegaLivelli: p.collega_livelli !== false };
    }
  }
  const b = oggetto(o.banda);
  const bt = b ? titolo(b.titolo) : undefined;
  if (b && bt) dati.banda = con({ titolo: bt } as { titolo: string; descrizione?: string }, { descrizione: descrizione(b.descrizione) });
  return dati;
}

export function leggiCronoprogramma(raw: unknown, avvisi: string[]): DatiCronoprogramma | null {
  const o = oggetto(raw);
  if (!o) return null;
  const unita = (UNITA_TEMPO as readonly string[]).includes(String(o.unita)) ? (o.unita as UnitaTempo) : "settimane";
  const righe: RigaCronoprogramma[] = [];
  let massimo = 0;
  for (const r of elenco(o.righe)) {
    const ro = oggetto(r);
    const t = ro ? titolo(ro.titolo) : undefined;
    if (!ro || !t) continue;
    const barre: BarraCronoprogramma[] = [];
    for (const b of elenco(ro.barre)) {
      const bo = oggetto(b);
      let da = bo ? numero(bo.da) : null;
      let a = bo ? numero(bo.a) : null;
      if (!bo || da === null || a === null) continue;
      if (da > a) [da, a] = [a, da];
      if (a - da <= 0 || da < 0) continue;
      massimo = Math.max(massimo, a);
      barre.push(con<BarraCronoprogramma>({ da, a }, { etichetta: pulisciTesto(bo.etichetta, 50), semantico: semantico(bo.semantico) }));
    }
    const pietre = elenco(ro.pietre)
      .map((p) => {
        const po = oggetto(p);
        const pos = po ? numero(po.posizione) : null;
        if (!po || pos === null || pos < 0) return null;
        massimo = Math.max(massimo, pos);
        return con({ posizione: pos } as { posizione: number; etichetta?: string }, { etichetta: pulisciTesto(po.etichetta, 40) });
      })
      .filter((p): p is { posizione: number; etichetta?: string } => !!p);
    if (barre.length === 0 && pietre.length === 0) continue;
    righe.push(con<RigaCronoprogramma>({ titolo: t, barre: barre.slice(0, T.barrePerRiga) }, { responsabile: pulisciTesto(ro.responsabile, 60), fase: pulisciTesto(ro.fase, 50), pietre }));
  }
  if (righe.length > T.righeCronoprogramma) {
    avvisi.push(`Oltre ${T.righeCronoprogramma} attività: le ultime non sono state disegnate.`);
    righe.length = T.righeCronoprogramma;
  }
  if (righe.length < 1) return null;
  let durata = numero(o.durata) ?? massimo;
  if (durata < massimo) durata = massimo;
  if (!(durata > 0)) return null;
  const traguardi = elenco(o.traguardi)
    .map((t) => {
      const to = oggetto(t);
      const pos = to ? numero(to.posizione) : null;
      const tt = to ? titolo(to.titolo) : undefined;
      if (!to || pos === null || !tt || pos < 0 || pos > durata) return null;
      return con({ posizione: pos, titolo: tt } as { posizione: number; titolo: string; dettaglio?: string; finale?: boolean }, { dettaglio: dettaglio(to.dettaglio), finale: to.finale === true ? true : undefined });
    })
    .filter((t): t is { posizione: number; titolo: string; dettaglio?: string; finale?: boolean } => !!t)
    .slice(0, T.traguardi);
  const dati: DatiCronoprogramma = { unita, durata, righe };
  if (traguardi.length) dati.traguardi = traguardi;
  const b = oggetto(o.banda);
  const bt = b ? titolo(b.titolo) : undefined;
  if (b && bt) dati.banda = con({ titolo: bt } as { titolo: string; descrizione?: string }, { descrizione: descrizione(b.descrizione) });
  const nota = descrizione(o.nota);
  if (nota) dati.nota = nota;
  return dati;
}

export function leggiCruscotto(raw: unknown, avvisi: string[]): DatiCruscotto | null {
  const o = oggetto(raw);
  if (!o) return null;
  const profilo = pulisciTesto(o.profilo, 40);
  const indicatori = elenco(o.indicatori)
    .map((i) => {
      const io = oggetto(i);
      const e = io ? titolo(io.etichetta) : undefined;
      const ob = io ? pulisciTesto(io.obiettivo, 30) : undefined;
      return io && e && ob ? { etichetta: e, obiettivo: ob } : null;
    })
    .filter((i): i is { etichetta: string; obiettivo: string } => !!i)
    .slice(0, T.indicatori);
  const righe = elenco(o.righe)
    .map((r) => {
      const ro = oggetto(r);
      const ind = ro ? titolo(ro.indicatore) : undefined;
      const ob = ro ? pulisciTesto(ro.obiettivo, 30) : undefined;
      if (!ro || !ind || !ob) return null;
      const stato = (STATI_RIGA as readonly string[]).includes(String(ro.stato)) ? (ro.stato as StatoRiga) : undefined;
      return con({ indicatore: ind, obiettivo: ob } as { indicatore: string; obiettivo: string; stato?: StatoRiga }, { stato });
    })
    .filter((r): r is { indicatore: string; obiettivo: string; stato?: StatoRiga } => !!r);
  if (righe.length > T.righeCruscotto) {
    avvisi.push(`Cruscotto con oltre ${T.righeCruscotto} indicatori: i restanti non sono stati disegnati.`);
    righe.length = T.righeCruscotto;
  }
  if (!profilo || righe.length < 2) return null;
  const dati: DatiCruscotto = { profilo, indicatori, righe };
  const l = oggetto(o.laterale);
  const lt = l ? titolo(l.titolo) : undefined;
  const lv = l ? elenco(l.voci).map((v) => titolo(v)).filter((v): v is string => !!v).slice(0, T.vociLaterale) : [];
  if (l && lt && lv.length) dati.laterale = { titolo: lt, voci: lv };
  return dati;
}

export function leggiRete(raw: unknown, avvisi: string[]): DatiRete | null {
  const o = oggetto(raw);
  if (!o) return null;
  const c = oggetto(o.centro);
  const ct = c ? titolo(c.titolo) : undefined;
  if (!c || !ct) return null;
  const centro = con({ titolo: ct } as DatiRete["centro"], {
    sottotitolo: pulisciTesto(c.sottotitolo, 60),
    voci: elenco(c.voci).map((v) => titolo(v)).filter((v): v is string => !!v).slice(0, T.vociCentro),
  });
  const nodi = elenco(o.nodi)
    .map((n) => {
      const no = oggetto(n);
      const t = no ? titolo(no.titolo) : undefined;
      return no && t ? con({ titolo: t } as DatiRete["nodi"][number], { dettaglio: dettaglio(no.dettaglio), semantico: semantico(no.semantico) }) : null;
    })
    .filter((n): n is DatiRete["nodi"][number] => !!n);
  if (nodi.length > T.nodiRete) {
    avvisi.push(`Rete con oltre ${T.nodiRete} nodi: i restanti non sono stati disegnati.`);
    nodi.length = T.nodiRete;
  }
  if (nodi.length < 2) return null;
  const dati: DatiRete = { centro, nodi };
  const origini = elenco(o.origini)
    .map((n) => {
      const no = oggetto(n);
      const t = no ? titolo(no.titolo) : undefined;
      return no && t
        ? con({ titolo: t } as NonNullable<DatiRete["origini"]>[number], { dettaglio: dettaglio(no.dettaglio), voci: elenco(no.voci).map((v) => titolo(v)).filter((v): v is string => !!v).slice(0, 5), semantico: semantico(no.semantico) })
        : null;
    })
    .filter((n): n is NonNullable<DatiRete["origini"]>[number] => !!n)
    .slice(0, T.originiRete);
  if (origini.length) dati.origini = origini;
  const ch = oggetto(o.chip);
  const cht = ch ? titolo(ch.titolo) : undefined;
  const chv = ch ? elenco(ch.voci).map((v) => titolo(v)).filter((v): v is string => !!v).slice(0, T.chip) : [];
  if (ch && cht && chv.length) dati.chip = { titolo: cht, voci: chv };
  const b = oggetto(o.banda);
  const bt = b ? titolo(b.titolo) : undefined;
  if (b && bt) dati.banda = con({ titolo: bt } as { titolo: string; dettaglio?: string }, { dettaglio: dettaglio(b.dettaglio) });
  if (o.collegamento === "verso_centro" || o.collegamento === "da_centro" || o.collegamento === "bidirezionale") dati.collegamento = o.collegamento;
  const nota = descrizione(o.nota);
  if (nota) dati.nota = nota;
  return dati;
}

// Il contenuto di una figura sta nel campo omonimo all'archetipo ("flusso":
// {stadi…}). Osservato con il modello vero: a volte i campi dell'archetipo
// (stadi, righe, nodi…) vengono scritti direttamente al livello della figura, o
// come elenco al posto dell'oggetto ("livelli": [...]). Una lettura tollerante
// recupera entrambe le forme: i campi di ogni archetipo hanno nomi diversi, quindi
// non c'è ambiguità.
function corpoArchetipo(o: Record<string, unknown>, chiave: Archetipo): unknown {
  const annidato = o[chiave];
  if (Array.isArray(annidato) && chiave === "livelli") return { ...o, livelli: annidato };
  return oggetto(annidato) ?? o;
}

// Una figura dichiarata dal modello → dati puliti, oppure null con un avviso.
export function leggiFiguraModello(raw: unknown): { figura: DatiFigura | null; avvisi: string[] } {
  const avvisi: string[] = [];
  const o = oggetto(raw);
  if (!o) return { figura: null, avvisi: ["Figura non valida: dati mancanti."] };
  const archetipo = (ARCHETIPI as readonly string[]).includes(String(o.archetipo)) ? (o.archetipo as Archetipo) : null;
  if (!archetipo) return { figura: null, avvisi: [`Figura scartata: archetipo «${String(o.archetipo)}» sconosciuto (ammessi: ${ARCHETIPI.join(", ")}).`] };
  const didascalia = pulisciTesto(o.didascalia, T.didascalia);
  if (!didascalia) return { figura: null, avvisi: ["Figura scartata: manca la didascalia (cosa dimostra la figura)."] };
  const base = { v: 1 as const, didascalia };
  let figura: DatiFigura | null = null;
  if (archetipo === "flusso") {
    const f = leggiFlusso(corpoArchetipo(o, "flusso"), avvisi);
    if (f) figura = { ...base, archetipo, flusso: f };
  } else if (archetipo === "livelli") {
    const l = leggiLivelli(corpoArchetipo(o, "livelli"), avvisi);
    if (l) figura = { ...base, archetipo, livelli: l };
  } else if (archetipo === "cronoprogramma") {
    const c = leggiCronoprogramma(corpoArchetipo(o, "cronoprogramma"), avvisi);
    if (c) figura = { ...base, archetipo, cronoprogramma: c };
  } else if (archetipo === "cruscotto") {
    const c = leggiCruscotto(corpoArchetipo(o, "cruscotto"), avvisi);
    if (c) figura = { ...base, archetipo, cruscotto: c };
  } else {
    const r = leggiRete(corpoArchetipo(o, "rete"), avvisi);
    if (r) figura = { ...base, archetipo, rete: r };
  }
  if (!figura) avvisi.push(`Figura «${archetipo}» scartata: i dati non bastano a disegnarla.`);
  return { figura, avvisi };
}

// ─── Blocco nel testo ───
export function serializzaBloccoFigura(d: DatiFigura): string {
  return `[FIGURA]\n${JSON.stringify(d)}\n[/FIGURA]`;
}

export const SEGNAPOSTO_FIGURA_REGEX = /\[FIGURA:(\d+)\]/gi;

export function trovaSegnapostiFigura(testo: string): number[] {
  return [...testo.matchAll(/\[FIGURA:(\d+)\]/gi)].map((m) => Number(m[1]));
}

export function sostituisciSegnapostoFigura(testo: string, n: number, blocco: string): string {
  return testo.replace(new RegExp(`\\[FIGURA:${n}\\]`, "i"), () => blocco);
}

export function togliSegnapostiFigura(testo: string): string {
  return testo.replace(/\[FIGURA:@?\d+\]\s*/gi, "");
}

// Sostituisce i segnaposti "[FIGURA:n]" (n parte da 1, come l'ordine delle
// figure dichiarate) con i blocchi costruiti dal codice. Un segnaposto che non
// ha una figura valida, o che ripete una figura già inserita, si toglie.
// Ritorna anche i numeri dei segnaposti senza figura e quelli delle figure
// dichiarate ma non richiamate nel testo.
export function inserisciFigure(testo: string, blocchi: (string | null)[]): { testo: string; inserite: number; senzaFigura: number[]; nonRichiamate: number[] } {
  const usati = new Set<number>();
  const senzaFigura: number[] = [];
  const out = testo.replace(/\[FIGURA:(\d+)\]\s*/gi, (_m, ns: string) => {
    const n = Number(ns);
    const blocco = blocchi[n - 1];
    if (blocco && !usati.has(n)) {
      usati.add(n);
      return `${blocco}\n\n`;
    }
    if (!blocco) senzaFigura.push(n);
    return "";
  });
  const nonRichiamate = blocchi.map((b, i) => (b && !usati.has(i + 1) ? i + 1 : 0)).filter((n) => n > 0);
  return { testo: out, inserite: usati.size, senzaFigura, nonRichiamate };
}

export function leggiBloccoFigura(contenutoBlocco: string): DatiFigura | null {
  const t = contenutoBlocco.trim();
  if (!t.startsWith("{")) return null;
  try {
    const d = JSON.parse(t) as Partial<DatiFigura> & Record<string, unknown>;
    if (d.v !== 1 || typeof d.didascalia !== "string" || !(ARCHETIPI as readonly string[]).includes(String(d.archetipo)) || !d[String(d.archetipo)]) return null;
    return d as DatiFigura;
  } catch {
    return null;
  }
}

const BLOCCO_FIGURA_REGEX = /\[FIGURA\]([\s\S]*?)\[\/FIGURA\]/gi;

export function trovaBlocchiFigura(testo: string): { contenuto: string; dati: DatiFigura | null }[] {
  return [...testo.matchAll(BLOCCO_FIGURA_REGEX)].map((m) => ({ contenuto: m[1], dati: leggiBloccoFigura(m[1]) }));
}

export function estraiBlocchiFigura(testo: string): string[] {
  return trovaBlocchiFigura(testo).map((b) => b.contenuto.trim());
}

// Le figure sono invariate se i blocchi costruiti sono identici e i segnaposti
// "[FIGURA:n]" (ancora da costruire) sono gli stessi, nello stesso numero.
export function figureInvariate(prima: string, dopo: string): boolean {
  const segnaposti = (t: string) => JSON.stringify(trovaSegnapostiFigura(t).sort((a, b) => a - b));
  return JSON.stringify(estraiBlocchiFigura(prima)) === JSON.stringify(estraiBlocchiFigura(dopo)) && segnaposti(prima) === segnaposti(dopo);
}

// Maschera per compressione/espansione: i blocchi costruiti si sostituiscono
// con "[FIGURA:@k]" e si rimettono dopo; il modello non vede mai i dati.
export function mascheraFigure(testo: string): { testo: string; blocchi: string[] } {
  const blocchi: string[] = [];
  const mascherato = testo.replace(BLOCCO_FIGURA_REGEX, (intero, corpo: string) => {
    if (!leggiBloccoFigura(corpo)) return intero;
    blocchi.push(intero);
    return `[FIGURA:@${blocchi.length}]`;
  });
  return { testo: mascherato, blocchi };
}

export function ripristinaFigure(testo: string, blocchi: string[]): string {
  if (blocchi.length === 0) return testo;
  return testo.replace(/\[FIGURA:@(\d+)\]/gi, (intero, k: string) => blocchi[Number(k) - 1] ?? intero);
}

// ─── Testi liberi di una figura (per la guardia R9) ───
export type CampoTesto = { leggi: () => string; scrivi: (v: string) => void };

const CHIAVI_NON_TESTO = new Set(["v", "archetipo", "tipo", "unita", "stato", "semantico", "forma", "collegamento", "durata", "da", "a", "posizione", "finale", "numerato", "collegaLivelli", "profilo", "piattaforma"]);

// Tutti i campi di testo (didascalia inclusa), in ordine stabile. Le stringhe
// in un elenco di stringhe (voci, addetti) contano una per una.
export function campiDiTestoFigura(d: DatiFigura): CampoTesto[] {
  const campi: CampoTesto[] = [];
  const visita = (nodo: unknown, padre: Record<string, unknown> | unknown[] | null, chiave: string | number | null) => {
    if (typeof nodo === "string") {
      if (padre && chiave !== null && !(typeof chiave === "string" && CHIAVI_NON_TESTO.has(chiave)) && nodo.trim()) {
        campi.push({ leggi: () => (padre as Record<string | number, string>)[chiave], scrivi: (v) => { (padre as Record<string | number, string>)[chiave] = v; } });
      }
      return;
    }
    if (Array.isArray(nodo)) {
      nodo.forEach((v, i) => visita(v, nodo, i));
      return;
    }
    if (nodo && typeof nodo === "object") {
      for (const [k, v] of Object.entries(nodo as Record<string, unknown>)) visita(v, nodo as Record<string, unknown>, k);
    }
  };
  visita(d, null, null);
  return campi;
}

// Pagine stimate di una figura già costruita: vedi stima-pagine.ts (usa il
// layout); qui solo il conteggio dei segnaposto/blocchi.
export function contaFigure(testo: string): number {
  return trovaBlocchiFigura(testo).length + trovaSegnapostiFigura(testo).length;
}
