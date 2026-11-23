// Cursore PVL versione 2 (pacchetto K4 del piano 48C; L1 del piano 36 v2; riduzione della rilettura del 49C §4). Logica PURA: niente
// database, niente rete, niente orologio (il giorno e l'istante arrivano come argomenti). Sta nella stessa colonna di prima
// (radar_fonti_stato.cursore, jsonb): nessuna migrazione.
//
// Quattro parti:
//   - incrementale: la finestra del giro programmato. Il PRIMO giro del giorno legge dall'ultimo giorno letto MENO UNO a oggi (sovrapposizione:
//     gli avvisi pubblicati in ritardo); i giri dopo, nello stesso giorno, solo il giorno in corso (49C §4, con la condizione del
//     coordinamento del 23/11: almeno un giro al giorno con un giorno di sovrapposizione). Dopo un fermo di oltre 7 giorni il periodo
//     scoperto entra nei BUCHI: non si perde mai;
//   - recupero: l'obiettivo dei 90 giorni (dal più recente al più vecchio) e il blocco di 7 giorni in corso, con al massimo 5 richieste per
//     giro (dentro il tetto di 20); prima i buchi, poi l'obiettivo;
//   - buchi: periodi ancora da leggere (al massimo 50; oltre, si uniscono i più vicini);
//   - completezza: gli ultimi 30 blocchi letti, con l'esito. Un blocco è completo solo se gli avvisi letti sono uguali al conteggio dichiarato
//     dalla fonte alla prima pagina (attendibile sotto i 1.000; da 1.000 in su il blocco si dimezza). Un blocco incompleto si ritenta al
//     giro dopo, al massimo 3 volte; poi resta tra i buchi, il recupero si ferma (allarme «blocco_incompleto») e l'incrementale continua.
// La finestra controllata (a mano, dalla console o dallo script dello staging) resta com'era, in una parte sua.
import { aggiungiGiorni } from "./importa-ted-calcoli";
import { GIORNI_MASSIMI_INCREMENTALE, GIORNI_SOVRAPPOSIZIONE_PVL, cursorePvlValido, giorniFinestra } from "./importa-pvl-calcoli";

export const GIORNI_OBIETTIVO_RECUPERO = 90;
export const GIORNI_BLOCCO_RECUPERO = 7;
export const RICHIESTE_RECUPERO_PER_GIRO = 5;
export const TENTATIVI_BLOCCO = 3;
export const CONTEGGIO_ATTENDIBILE = 1000;
export const MASSIMO_BUCHI = 50;
export const MASSIMO_COMPLETEZZA = 30;

export type LetturaPvl = { da: string; a: string; token: string | null; pagine: number; dichiarati: number | null; letti: number };
export type BloccoRecuperoPvl = LetturaPvl & { origine: "buco" | "obiettivo"; tentativi: number };
export type BucoPvl = { da: string; a: string; motivo: "fermo" | "blocco_incompleto"; rilevato_il: string };
export type EsitoBloccoPvl = { da: string; a: string; dichiarati: number | null; letti: number; completo: boolean; il: string };
export type RecuperoPvl = {
  // obiettivo dei 90 giorni ancora da leggere: [obiettivoDa, prossimoA] (null = finito); si legge da prossimoA all'indietro
  obiettivoDa: string | null;
  prossimoA: string | null;
  blocco: BloccoRecuperoPvl | null;
  // recupero fermato dopo 3 tentativi incompleti dello stesso blocco: lo riprende solo un'azione esplicita (riprendiRecupero)
  fermo: { il: string; da: string; a: string } | null;
};
export type CursorePvlV2 = {
  versione: 2;
  // c'è una lettura (incrementale o finestra controllata) a metà; derivato, per la console
  inCorso: boolean;
  // ultimo giorno toccato da una lettura incrementale finita (o da una finestra controllata contigua)
  ultimoGiorno: string | null;
  incrementale: LetturaPvl | null;
  finestra: LetturaPvl | null;
  recupero: RecuperoPvl;
  buchi: BucoPvl[];
  completezza: EsitoBloccoPvl[];
};

// ───── validazione e conversione ─────

const GIORNO = /^\d{4}-\d{2}-\d{2}$/;
const ISTANTE = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;
const eGiorno = (x: unknown): x is string => typeof x === "string" && GIORNO.test(x) && !Number.isNaN(Date.parse(`${x}T12:00:00Z`));
const eIstante = (x: unknown): x is string => typeof x === "string" && x.length <= 40 && ISTANTE.test(x);
const eIntero = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= 1_000_000;
const oggetto = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const intervallo = (o: Record<string, unknown>) => eGiorno(o.da) && eGiorno(o.a) && o.da <= o.a;

function letturaValida(v: unknown): v is LetturaPvl {
  const o = oggetto(v);
  return !!o && intervallo(o) && (o.token === null || (typeof o.token === "string" && o.token.length > 0 && o.token.length <= 500)) && eIntero(o.pagine) && (o.dichiarati === null || eIntero(o.dichiarati)) && eIntero(o.letti);
}

/** Il cursore v2 salvato, se è valido in OGNI sua parte; altrimenti null. */
export function cursorePvlV2Valido(v: unknown): CursorePvlV2 | null {
  const c = oggetto(v);
  if (!c || c.versione !== 2 || typeof c.inCorso !== "boolean") return null;
  if (c.ultimoGiorno !== null && !eGiorno(c.ultimoGiorno)) return null;
  if (c.incrementale !== null && !letturaValida(c.incrementale)) return null;
  if (c.finestra !== null && !letturaValida(c.finestra)) return null;
  const r = oggetto(c.recupero);
  if (!r) return null;
  if ((r.obiettivoDa === null) !== (r.prossimoA === null)) return null;
  if (r.obiettivoDa !== null && (!eGiorno(r.obiettivoDa) || !eGiorno(r.prossimoA))) return null;
  if (r.blocco !== null) {
    const b = oggetto(r.blocco);
    if (!b || !letturaValida(r.blocco) || (b.origine !== "buco" && b.origine !== "obiettivo") || !eIntero(b.tentativi) || b.tentativi >= TENTATIVI_BLOCCO) return null;
  }
  if (r.fermo !== null) {
    const f = oggetto(r.fermo);
    if (!f || !eIstante(f.il) || !intervallo(f)) return null;
  }
  if (!Array.isArray(c.buchi) || c.buchi.length > MASSIMO_BUCHI) return null;
  for (const x of c.buchi) {
    const b = oggetto(x);
    if (!b || !intervallo(b) || (b.motivo !== "fermo" && b.motivo !== "blocco_incompleto") || !eIstante(b.rilevato_il)) return null;
  }
  if (!Array.isArray(c.completezza) || c.completezza.length > MASSIMO_COMPLETEZZA) return null;
  for (const x of c.completezza) {
    const e = oggetto(x);
    if (!e || !intervallo(e) || (e.dichiarati !== null && !eIntero(e.dichiarati)) || !eIntero(e.letti) || typeof e.completo !== "boolean" || !eIstante(e.il)) return null;
  }
  return v as CursorePvlV2;
}

const conStato = (c: Omit<CursorePvlV2, "inCorso"> & { inCorso?: boolean }): CursorePvlV2 => ({ ...c, inCorso: c.incrementale !== null || c.finestra !== null });

/** Un cursore nuovo: obiettivo di 90 giorni fino a oggi meno 2 (ieri e oggi li legge il primo giro incrementale). */
export function cursorePvlNuovo(oggi: string, ultimoGiorno: string | null = null): CursorePvlV2 {
  return conStato({
    versione: 2,
    ultimoGiorno,
    incrementale: null,
    finestra: null,
    recupero: { obiettivoDa: aggiungiGiorni(oggi, -(GIORNI_OBIETTIVO_RECUPERO - 1)), prossimoA: aggiungiGiorni(oggi, -2), blocco: null, fermo: null },
    buchi: [],
    completezza: [],
  });
}

/**
 * Il cursore da usare adesso, da quello salvato: v2 valido → lui; v1 valido → convertito senza perdere ultimoGiorno né la lettura a metà
 * (e con l'obiettivo dei 90 giorni); illeggibile o assente → nuovo.
 */
export function cursorePvlDaSalvato(salvato: unknown, oggi: string): CursorePvlV2 {
  const v2 = cursorePvlV2Valido(salvato);
  if (v2) return v2;
  const v1 = cursorePvlValido(salvato);
  if (!v1) return cursorePvlNuovo(oggi);
  const nuovo = cursorePvlNuovo(oggi, v1.ultimoGiorno);
  const aMeta: LetturaPvl | null = v1.inCorso ? { da: v1.da, a: v1.a, token: v1.token, pagine: v1.pagine, dichiarati: null, letti: 0 } : null;
  return conStato({ ...nuovo, incrementale: v1.modo === "incrementale" ? aMeta : null, finestra: v1.modo === "finestra" ? aMeta : null });
}

// ───── buchi ─────

const primo = (x: string, y: string) => (x < y ? x : y);
const ultimo = (x: string, y: string) => (x > y ? x : y);

/** Aggiunge un periodo ai buchi: ordinati, uniti se si toccano o si sovrappongono, al massimo 50 (oltre, si uniscono i due più vicini). */
export function aggiungiBuco(buchi: readonly BucoPvl[], nuovo: BucoPvl): BucoPvl[] {
  const tutti = [...buchi, nuovo].sort((x, y) => (x.da < y.da ? -1 : x.da > y.da ? 1 : 0));
  const uniti: BucoPvl[] = [];
  const unisci = (u: BucoPvl, b: BucoPvl): BucoPvl => ({ da: primo(u.da, b.da), a: ultimo(u.a, b.a), motivo: u.motivo === "blocco_incompleto" || b.motivo === "blocco_incompleto" ? "blocco_incompleto" : "fermo", rilevato_il: primo(u.rilevato_il, b.rilevato_il) });
  for (const b of tutti) {
    const u = uniti[uniti.length - 1];
    if (u && b.da <= aggiungiGiorni(u.a, 1)) uniti[uniti.length - 1] = unisci(u, b);
    else uniti.push({ ...b });
  }
  while (uniti.length > MASSIMO_BUCHI) {
    let migliore = 0;
    for (let i = 1; i < uniti.length - 1; i++) if (giorniFinestra({ da: uniti[i].a, a: uniti[i + 1].da }) < giorniFinestra({ da: uniti[migliore].a, a: uniti[migliore + 1].da })) migliore = i;
    uniti.splice(migliore, 2, unisci(uniti[migliore], uniti[migliore + 1]));
  }
  return uniti;
}

/** Toglie dai buchi un periodo letto per intero. */
export function togliDaiBuchi(buchi: readonly BucoPvl[], da: string, a: string): BucoPvl[] {
  const out: BucoPvl[] = [];
  for (const b of buchi) {
    if (b.a < da || b.da > a) {
      out.push(b);
      continue;
    }
    if (b.da < da) out.push({ ...b, a: aggiungiGiorni(da, -1) });
    if (b.a > a) out.push({ ...b, da: aggiungiGiorni(a, 1) });
  }
  return out;
}

export const giorniNeiBuchi = (c: Pick<CursorePvlV2, "buchi">) => c.buchi.reduce((n, b) => n + giorniFinestra(b), 0);
export const giorniObiettivoResidui = (c: Pick<CursorePvlV2, "recupero">) => (c.recupero.obiettivoDa && c.recupero.prossimoA && c.recupero.prossimoA >= c.recupero.obiettivoDa ? giorniFinestra({ da: c.recupero.obiettivoDa, a: c.recupero.prossimoA }) : 0);

// ───── letture (incrementale, finestra, blocco) ─────

/** La lettura dopo una pagina: continua solo con una pagina piena e un token; il conteggio dichiarato è quello della prima pagina. */
export function letturaDopoPagina(l: LetturaPvl, letti: number, dichiarati: number | null, token: string | null, avvisiPerPagina: number): { lettura: LetturaPvl; finita: boolean } {
  const nuova: LetturaPvl = { ...l, pagine: l.pagine + 1, letti: l.letti + letti, dichiarati: l.pagine === 0 ? dichiarati : l.dichiarati };
  if (letti >= avvisiPerPagina && token) return { lettura: { ...nuova, token }, finita: false };
  return { lettura: { ...nuova, token: null }, finita: true };
}

/**
 * Il giro incrementale da fare: quello a metà continua; altrimenti dal giorno giusto a oggi. Il primo giro del giorno parte dall'ultimo
 * giorno letto meno uno; se quel giorno è oggi (un giro di oggi è già finito) parte da oggi. Oltre 7 giorni indietro, il periodo in più
 * entra nei buchi e l'incrementale parte da oggi meno 7.
 */
export function conIncrementale(c: CursorePvlV2, oggi: string, adessoIso: string): CursorePvlV2 {
  if (c.incrementale) return c;
  const minimo = aggiungiGiorni(oggi, -GIORNI_MASSIMI_INCREMENTALE);
  const base = !c.ultimoGiorno ? aggiungiGiorni(oggi, -1) : c.ultimoGiorno >= oggi ? oggi : aggiungiGiorni(c.ultimoGiorno, -GIORNI_SOVRAPPOSIZIONE_PVL);
  const buchi = base < minimo ? aggiungiBuco(c.buchi, { da: base, a: aggiungiGiorni(minimo, -1), motivo: "fermo", rilevato_il: adessoIso }) : c.buchi;
  const da = base < minimo ? minimo : base;
  return conStato({ ...c, buchi, incrementale: { da, a: oggi, token: null, pagine: 0, dichiarati: null, letti: 0 } });
}

export function dopoPaginaIncrementale(c: CursorePvlV2, letti: number, dichiarati: number | null, token: string | null, avvisiPerPagina: number): CursorePvlV2 {
  if (!c.incrementale) return c;
  const { lettura, finita } = letturaDopoPagina(c.incrementale, letti, dichiarati, token, avvisiPerPagina);
  return conStato(finita ? { ...c, incrementale: null, ultimoGiorno: lettura.a } : { ...c, incrementale: lettura });
}

/** La finestra controllata [da, a]: la stessa finestra interrotta riprende dal suo token; altrimenti dall'inizio. */
export function conFinestra(c: CursorePvlV2, da: string, a: string): CursorePvlV2 {
  if (!eGiorno(da) || !eGiorno(a) || da > a) throw new Error("Finestra non valida");
  if (c.finestra && c.finestra.da === da && c.finestra.a === a) return c;
  return conStato({ ...c, finestra: { da, a, token: null, pagine: 0, dichiarati: null, letti: 0 } });
}

/** Dopo una pagina della finestra controllata: finita, sposta l'ultimo giorno in avanti solo se la finestra è CONTIGUA (nessun salto). */
export function dopoPaginaFinestra(c: CursorePvlV2, letti: number, dichiarati: number | null, token: string | null, avvisiPerPagina: number): CursorePvlV2 {
  if (!c.finestra) return c;
  const { lettura, finita } = letturaDopoPagina(c.finestra, letti, dichiarati, token, avvisiPerPagina);
  if (!finita) return conStato({ ...c, finestra: lettura });
  const u = c.ultimoGiorno;
  const ultimoGiorno = !u || lettura.da <= aggiungiGiorni(u, 1) ? (u && u > lettura.a ? u : lettura.a) : u;
  return conStato({ ...c, finestra: null, ultimoGiorno });
}

// ───── recupero ─────

/** Il blocco di recupero da leggere adesso (null = niente da recuperare o recupero fermo): quello a metà, poi il buco più recente, poi l'obiettivo. */
export function bloccoDaLeggere(c: CursorePvlV2): BloccoRecuperoPvl | null {
  if (c.recupero.fermo) return null;
  if (c.recupero.blocco) return c.recupero.blocco;
  const vuoto = { token: null, pagine: 0, dichiarati: null, letti: 0, tentativi: 0 };
  if (c.buchi.length) {
    const buco = c.buchi.reduce((x, y) => (y.a > x.a ? y : x));
    return { ...vuoto, origine: "buco", da: ultimo(aggiungiGiorni(buco.a, -(GIORNI_BLOCCO_RECUPERO - 1)), buco.da), a: buco.a };
  }
  const { obiettivoDa, prossimoA } = c.recupero;
  if (obiettivoDa && prossimoA && prossimoA >= obiettivoDa) return { ...vuoto, origine: "obiettivo", da: ultimo(aggiungiGiorni(prossimoA, -(GIORNI_BLOCCO_RECUPERO - 1)), obiettivoDa), a: prossimoA };
  return null;
}

export type EsitoPaginaRecupero = "continua" | "dimezzato" | "completo" | "incompleto" | "fermo";

/**
 * Dopo una pagina del blocco di recupero `blocco` (quello dato da bloccoDaLeggere). Prima pagina con 1.000 avvisi dichiarati o più: il
 * blocco si dimezza (si tiene la metà più recente; il resto resta da leggere). Blocco finito: completo solo se letti = dichiarati; incompleto
 * → si ritenta al giro dopo; al terzo tentativo resta tra i buchi e il recupero si ferma.
 */
export function dopoPaginaRecupero(
  c: CursorePvlV2,
  blocco: BloccoRecuperoPvl,
  letti: number,
  dichiarati: number | null,
  token: string | null,
  avvisiPerPagina: number,
  adessoIso: string,
): { cursore: CursorePvlV2; esito: EsitoPaginaRecupero; bloccoLetto: EsitoBloccoPvl | null } {
  const giorni = giorniFinestra(blocco);
  if (blocco.pagine === 0 && dichiarati !== null && dichiarati >= CONTEGGIO_ATTENDIBILE && giorni > 1) {
    const tieni = Math.ceil(giorni / 2);
    const meta: BloccoRecuperoPvl = { ...blocco, da: aggiungiGiorni(blocco.a, -(tieni - 1)), token: null, pagine: 0, dichiarati: null, letti: 0 };
    return { cursore: conStato({ ...c, recupero: { ...c.recupero, blocco: meta } }), esito: "dimezzato", bloccoLetto: null };
  }
  const { lettura, finita } = letturaDopoPagina(blocco, letti, dichiarati, token, avvisiPerPagina);
  if (!finita) return { cursore: conStato({ ...c, recupero: { ...c.recupero, blocco: { ...blocco, ...lettura } } }), esito: "continua", bloccoLetto: null };

  const completo = lettura.dichiarati !== null && lettura.dichiarati < CONTEGGIO_ATTENDIBILE && lettura.letti === lettura.dichiarati;
  const bloccoLetto: EsitoBloccoPvl = { da: blocco.da, a: blocco.a, dichiarati: lettura.dichiarati, letti: lettura.letti, completo, il: adessoIso };
  const completezza = [...c.completezza, bloccoLetto].slice(-MASSIMO_COMPLETEZZA);
  // l'obiettivo avanza (all'indietro) quando un suo blocco è letto per intero o passa tra i buchi
  const avanza = (r: RecuperoPvl): Pick<RecuperoPvl, "obiettivoDa" | "prossimoA"> => {
    if (blocco.origine !== "obiettivo" || !r.prossimoA || !r.obiettivoDa) return { obiettivoDa: r.obiettivoDa, prossimoA: r.prossimoA };
    const prossimoA = aggiungiGiorni(blocco.da, -1);
    return prossimoA < r.obiettivoDa ? { obiettivoDa: null, prossimoA: null } : { obiettivoDa: r.obiettivoDa, prossimoA };
  };
  if (completo) {
    return { cursore: conStato({ ...c, completezza, buchi: togliDaiBuchi(c.buchi, blocco.da, blocco.a), recupero: { ...c.recupero, ...avanza(c.recupero), blocco: null } }), esito: "completo", bloccoLetto };
  }
  const tentativi = blocco.tentativi + 1;
  if (tentativi >= TENTATIVI_BLOCCO) {
    const buchi = aggiungiBuco(c.buchi, { da: blocco.da, a: blocco.a, motivo: "blocco_incompleto", rilevato_il: adessoIso });
    return { cursore: conStato({ ...c, completezza, buchi, recupero: { ...c.recupero, ...avanza(c.recupero), blocco: null, fermo: { il: adessoIso, da: blocco.da, a: blocco.a } } }), esito: "fermo", bloccoLetto };
  }
  const daCapo: BloccoRecuperoPvl = { ...blocco, token: null, pagine: 0, dichiarati: null, letti: 0, tentativi };
  return { cursore: conStato({ ...c, completezza, recupero: { ...c.recupero, blocco: daCapo } }), esito: "incompleto", bloccoLetto };
}

/** Riprende il recupero fermato (azione esplicita, per la console): il blocco incompleto, che è tra i buchi, si ritenta da capo. */
export function riprendiRecupero(c: CursorePvlV2): CursorePvlV2 {
  return conStato({ ...c, recupero: { ...c.recupero, fermo: null } });
}

/** Gli allarmi del cursore, per il registro dei giri: buchi da recuperare; recupero fermo. */
export function allarmiCursorePvl(c: CursorePvlV2): string[] {
  return [...(c.buchi.length ? ["buco_in_recupero"] : []), ...(c.recupero.fermo ? ["blocco_incompleto"] : [])];
}
