// Riclassificazione delle gare GIÀ in archivio con le regole correnti e POPOLAMENTO delle classificazioni della 0121 (fase B2b, 17/11/2026).
// Logica pura: nessun database. Lo script unico scripts/radar-riclassifica-settori.ts legge l'archivio (riclassificazione.ts), calcola qui
// il piano gara per gara e, solo con un'autorizzazione registrata, lo scrive. Dalla fase B2b questo file e lo script sono di B2 (decisione
// del coordinamento): le REGOLE restano in settori.ts (PVL).
//
// Regole (autorizzazione dell'utente «FASE B2b» del 17/11):
//   - UN SOLO CALCOLO, quello del classificatore unico (classificaPerArchivio di classificazione-unita.ts, lo stesso degli importatori):
//     CPV della gara e dei lotti, testo = oggetto della gara + oggetti dei lotti, i lotti per i servizi autonomi; una parola chiave da sola
//     non basta (la gara deve essere un servizio, altrimenti C con il motivo);
//   - la riclassificazione può TOGLIERE e AGGIUNGERE settori (prima toglieva soltanto); cambia anche il metodo se cambia;
//   - colonna «settori» (legacy) e righe della 0121 COERENTI: i settori della gara sono quelli con una riga attiva di rilevanza A o B; una
//     decisione dell'AMMINISTRATORE vale più del calcolo (mai sostituita, e decide anche la colonna);
//   - esclusione ≠ cancellazione: le gare C restano nell'archivio; gare, lotti, CIG, provenienze, gare salvate e monitorate non si toccano;
//   - ogni cambio della colonna si traccia nel registro dei cambiamenti (correzione_dati, campo «settori», MAI notificabile), con il valore
//     di prima, la versione delle regole e l'ESECUZIONE, così si può annullare;
//   - idempotenza: una gara già classificata con le regole correnti e non cambiata dopo («classificata_il» non precedente ad
//     «aggiornata_il») non si ricalcola; una gara invariata non si riscrive.
import { MOTIVO_NON_RICONOSCIUTO, REGOLA_NON_RICONOSCIUTO, VERSIONE_REGOLE_SETTORI, nomeSettore, type Esclusione, type SettoreRadar } from "./settori";
import { classificaPerArchivio, type ClassificazioneArchivio, type LottoDaClassificare } from "./classificazione-unita";
import { aggiornamentoClassificazioni, erroriRiga, righeDaClassificazione, statoDopoTentativo, type Aggiornamento, type RigaClassificazione, type RigaStato } from "./classificazioni-calcoli";

export type GaraDaRiclassificare = {
  id: string;
  oggetto: string | null;
  cpv_principale: string | null;
  cpv_tutti: readonly string[] | null;
  settori: readonly string[];
  metodo_settore: string | null;
  natura_contratto: string | null;
};
export type LottoDaRiclassificare = LottoDaClassificare;

export type StatoSettori = { settori: string[]; metodo: string | null };

export type Riclassificazione = {
  // «correzione» = cambiano i settori o il metodo della gara
  tipo: "invariata" | "correzione";
  prima: StatoSettori;
  dopo: StatoSettori;
  aggiunti: string[];
  tolti: string[];
  // stessi settori, cambia solo il metodo (cpv / parole chiave)
  soloMetodo: boolean;
  // perché i settori tolti sono stati tolti
  esclusioni: Esclusione[];
  classificazione: ClassificazioneArchivio;
};

export const FONTE_REGISTRO = "regole_settori";
const PREFISSO = "regole-settori-";
const pertinente = (l: string) => l === "A" || l === "B";
const stessi = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

// Le decisioni dell'amministratore (righe attive con origine «amministratore») decidono la colonna per il loro settore.
function conDecisioni(dopo: StatoSettori, decisioni: readonly Pick<RigaClassificazione, "settore" | "rilevanza" | "attiva" | "origine">[], prima: StatoSettori): StatoSettori {
  const attive = decisioni.filter((d) => d.attiva && d.origine === "amministratore");
  if (attive.length === 0) return dopo;
  const settori = dopo.settori.filter((s) => !attive.some((d) => d.settore === s && !pertinente(d.rilevanza)));
  for (const d of attive) if (pertinente(d.rilevanza) && !settori.includes(d.settore)) settori.push(d.settore);
  return { settori, metodo: settori.length ? (dopo.metodo ?? prima.metodo ?? "cpv") : null };
}

/** La gara con le regole correnti: settori e metodo dopo, che cosa si aggiunge e che cosa si toglie (e perché). */
export function riclassificaGara(g: GaraDaRiclassificare, lotti: readonly LottoDaRiclassificare[], decisioni: readonly Pick<RigaClassificazione, "settore" | "rilevanza" | "attiva" | "origine">[] = []): Riclassificazione {
  const c = classificaPerArchivio(g, lotti);
  const prima: StatoSettori = { settori: [...g.settori], metodo: g.metodo_settore };
  const dopo = conDecisioni(c.settori.length ? { settori: [...c.settori], metodo: c.metodo } : { settori: [], metodo: null }, decisioni, prima);
  const aggiunti = dopo.settori.filter((s) => !prima.settori.includes(s));
  const tolti = prima.settori.filter((s) => !dopo.settori.includes(s));
  const soloMetodo = aggiunti.length === 0 && tolti.length === 0 && dopo.settori.length > 0 && (dopo.metodo ?? null) !== (prima.metodo ?? null);
  const esclusioni: Esclusione[] = tolti.map((s) => {
    const v = c.perSettore[s as SettoreRadar];
    if (v && v.livello === "C") return { settore: s as SettoreRadar, regola: v.regola, motivo: v.motivi[0] ?? v.regola };
    if (decisioni.some((d) => d.attiva && d.origine === "amministratore" && d.settore === s)) return { settore: s as SettoreRadar, regola: "decisione_amministratore", motivo: "Decisione dell'amministratore" };
    // regola e motivo di settori.ts (nome scelto con la PVL il 17/11)
    return { settore: s as SettoreRadar, regola: REGOLA_NON_RICONOSCIUTO, motivo: MOTIVO_NON_RICONOSCIUTO };
  });
  const tipo = aggiunti.length || tolti.length || soloMetodo || (!stessi(prima.settori, dopo.settori)) ? "correzione" : "invariata";
  // un settore tolto che le regole non vedono più affatto (né CPV né parole chiave): riga C con il motivo, così ogni esclusione è spiegata
  // anche nelle righe e la gara è «fuori dai settori monitorati», mai una gara classificata senza righe (prova a vuoto del 17/11: 26 gare)
  const perSettore = { ...c.perSettore };
  for (const e of esclusioni) {
    if (e.regola !== REGOLA_NON_RICONOSCIUTO || perSettore[e.settore]) continue;
    const da = prima.metodo === "parole_chiave" ? "parole_chiave" : "cpv";
    perSettore[e.settore] = { livello: "C", sottocategoria: null, regola: e.regola, sottocategorie: [], regole: [e.regola], motivi: [e.motivo], da, cpv: [] };
  }
  const classificazione = perSettore === c.perSettore || Object.keys(perSettore).length === Object.keys(c.perSettore).length ? c : { ...c, perSettore, livello: c.livello ?? "C" };
  return { tipo, prima, dopo, aggiunti, tolti, soloMetodo, esclusioni, classificazione };
}

// Identificativo dell'esecuzione: l'istante con i millisecondi, senza «:» (il registro separa con «:» versione, regole ed esecuzione).
export function idEsecuzione(adessoIso: string): string {
  return adessoIso.replace(/[-:]/g, "").replace(".", "");
}
export function isoDaEsecuzione(esecuzione: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z$/.exec(esecuzione);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.${m[7]}Z` : null;
}

/**
 * Identificativo della correzione nel registro: «regole-settori-<versione>:<regole>:<esecuzione>» (al massimo 200 caratteri). Il secondo
 * pezzo restano le regole (la frase per il cliente le legge); «aggiunta» per i settori aggiunti, «metodo» se cambia solo il metodo.
 */
export function idFonteRiclassificazione(r: Pick<Riclassificazione, "esclusioni" | "aggiunti" | "soloMetodo">, esecuzione: string, versione = VERSIONE_REGOLE_SETTORI): string {
  const regole = [...new Set([...r.esclusioni.map((e) => e.regola), ...(r.aggiunti.length ? ["aggiunta"] : []), ...(r.soloMetodo ? ["metodo"] : [])])].sort();
  const testa = `${PREFISSO}${versione}:`;
  const coda = `:${esecuzione}`;
  return testa + (regole.join("+") || REGOLA_NON_RICONOSCIUTO).slice(0, Math.max(1, 200 - testa.length - coda.length)) + coda;
}

// Valore per il registro dei cambiamenti: settori e metodo, per poterli ripristinare entrambi.
export function valoreRegistro(s: StatoSettori): string {
  return JSON.stringify({ settori: s.settori, metodo: s.metodo });
}

export function statoDaRegistro(v: string | null): StatoSettori | null {
  try {
    const o: unknown = JSON.parse(v ?? "");
    if (Array.isArray(o)) return { settori: o.filter((x): x is string => typeof x === "string"), metodo: null };
    if (o && typeof o === "object" && Array.isArray((o as { settori?: unknown }).settori)) {
      const m = (o as { metodo?: unknown }).metodo;
      return { settori: ((o as { settori: unknown[] }).settori).filter((x): x is string => typeof x === "string"), metodo: m === "cpv" || m === "parole_chiave" ? m : null };
    }
  } catch {
    // valore non leggibile: nessun ripristino
  }
  return null;
}

const nome = (s: string) => nomeSettore(s as SettoreRadar).toLowerCase();

// La nota del registro: che cosa cambia e perché, in parole semplici (massimo 1000 caratteri, il limite della colonna).
export function notaCorrezione(r: Pick<Riclassificazione, "esclusioni" | "aggiunti" | "soloMetodo" | "dopo"> & { classificazione?: ClassificazioneArchivio }): string {
  const parti: string[] = [];
  if (r.esclusioni.length) parti.push(`Tolta da: ${r.esclusioni.map((e) => `${nome(e.settore)} (${e.motivo})`).join(" · ")}`);
  if (r.aggiunti.length) parti.push(`Aggiunta a: ${r.aggiunti.map((s) => `${nome(s)}${r.classificazione?.perSettore[s as SettoreRadar]?.motivi[0] ? ` (${r.classificazione.perSettore[s as SettoreRadar]?.motivi[0]})` : ""}`).join(" · ")}`);
  if (r.soloMetodo) parti.push(`Settori invariati, riconosciuti ora ${r.dopo.metodo === "cpv" ? "dai CPV" : "dalle parole chiave"}`);
  return `Regole di classificazione aggiornate (${VERSIONE_REGOLE_SETTORI}). ${parti.join(". ") || "Parole chiave delle regole aggiornate"}.`.slice(0, 1000);
}

// ───── piano gara per gara (prova a vuoto e applicazione usano lo stesso piano) ─────

export type GaraArchivio = GaraDaRiclassificare & { chiave: string; fonti: readonly string[] | null; aggiornata_il: string | null; unita_a: string | null };

export type PianoGara = {
  proceduraId: string;
  chiave: string;
  oggetto: string;
  // «gia_classificata» = già classificata con le regole correnti e non cambiata dopo: nessuna scrittura
  tipo: "gia_classificata" | "da_scrivere";
  ric: Riclassificazione | null;
  // la colonna «settori» cambia (scrittura condizionata più la traccia nel registro)
  cambiaSettori: boolean;
  calcolate: RigaClassificazione[];
  righe: Aggiornamento | null;
  // righe che non rispettano i vincoli della 0121: la gara va in stato «fallita» e la colonna non cambia
  errori: string[];
  registro: Record<string, unknown> | null;
  statoPrima: RigaStato | null;
  stato: RigaStato | null;
};

/** Già classificata con queste regole e non cambiata dopo (idempotenza: la seconda esecuzione non scrive nulla). */
export function giaClassificata(stato: Pick<RigaStato, "stato" | "versione_regole" | "classificata_il"> | null, aggiornataIl: string | null, versione = VERSIONE_REGOLE_SETTORI): boolean {
  if (!stato || stato.stato !== "classificata" || stato.versione_regole !== versione || !stato.classificata_il) return false;
  if (!aggiornataIl) return true;
  return Date.parse(stato.classificata_il) >= Date.parse(aggiornataIl);
}

export function fontiDellaGaraArchivio(g: Pick<GaraArchivio, "fonti" | "chiave">): string[] {
  return g.fonti && g.fonti.length ? [...new Set(g.fonti)].sort() : [g.chiave.split(":")[0]];
}

export function pianoGara(x: {
  gara: GaraArchivio;
  lotti: readonly LottoDaRiclassificare[];
  attive: readonly RigaClassificazione[];
  stato: RigaStato | null;
  esecuzione: string;
  adessoIso: string;
  nuovoId: () => string;
}): PianoGara {
  const g = x.gara;
  const base = { proceduraId: g.id, chiave: g.chiave, oggetto: (g.oggetto ?? "").replace(/\s+/g, " ").trim() };
  if (giaClassificata(x.stato, g.aggiornata_il)) return { ...base, tipo: "gia_classificata", ric: null, cambiaSettori: false, calcolate: [], righe: null, errori: [], registro: null, statoPrima: x.stato, stato: null };
  const ric = riclassificaGara(g, x.lotti, x.attive);
  const calcolate = righeDaClassificazione(ric.classificazione, {
    proceduraId: g.id,
    origine: "riclassificazione",
    fonti: fontiDellaGaraArchivio(g),
    autore: `riclassificazione:${x.esecuzione}`,
    adessoIso: x.adessoIso,
    nuovoId: x.nuovoId,
    settoriColonna: ric.dopo.settori,
  });
  const errori = calcolate.flatMap((r) => erroriRiga(r).map((e) => `${r.settore}: ${e}`));
  const righe = errori.length ? null : aggiornamentoClassificazioni(x.attive, calcolate, x.adessoIso);
  const cambiaSettori = errori.length === 0 && ric.tipo === "correzione";
  const registro = cambiaSettori
    ? {
        procedura_id: g.id,
        tipo: "correzione_dati",
        campo: "settori",
        valore_precedente: valoreRegistro(ric.prima),
        valore_nuovo: valoreRegistro(ric.dopo),
        fonte: FONTE_REGISTRO,
        id_fonte: idFonteRiclassificazione(ric, x.esecuzione),
        nota: notaCorrezione(ric),
        notificabile: false,
      }
    : null;
  const stato = statoDopoTentativo(x.stato, errori.length ? { ok: false, errore: `Righe non valide: ${errori.join("; ")}` } : { ok: true, versione: ric.classificazione.versione }, g.id, x.adessoIso);
  return { ...base, tipo: "da_scrivere", ric, cambiaSettori, calcolate, righe, errori, registro, statoPrima: x.stato, stato };
}

// ───── riepilogo per la prova a vuoto (le righe ESATTE da scrivere) ─────

export type CategoriaGara = "A" | "B" | "misti" | "C" | "nessun_settore";

export function categoriaGara(righe: readonly Pick<RigaClassificazione, "rilevanza">[]): CategoriaGara {
  const a = righe.some((r) => r.rilevanza === "A");
  const b = righe.some((r) => r.rilevanza === "B");
  if (a && b) return "misti";
  if (a) return "A";
  if (b) return "B";
  return righe.length ? "C" : "nessun_settore";
}

export type Riepilogo = {
  versione: string;
  gare: number;
  giaClassificate: number;
  daScrivere: number;
  fallite: number;
  categorie: Record<CategoriaGara, number>;
  colonna: { invariate: number; cambiate: number; perdono: number; acquisiscono: number; fuoriDaTutti: number; soloMetodo: number };
  multisettore: number;
  // righe segnate «ambigua»: CONFLITTO TRA FONTI (le fonti della stessa gara danno rilevanze diverse). Da non confondere con i «casi da
  // confermare» della PVL, che sono giudizi sulle regole da far confermare all'utente (pacchetto 16, punto 11)
  conflittiTraFonti: number;
  righe: {
    radar_procedure: { aggiorna: number };
    radar_aggiornamenti: { inserisce: number };
    radar_classificazioni: { inserisce: number; disattiva: number; invariate: number; protette: number };
    radar_classificazioni_stato: { inserisce: number; aggiorna: number };
  };
};

export function riepilogoPiani(piani: readonly PianoGara[]): Riepilogo {
  const r: Riepilogo = {
    versione: VERSIONE_REGOLE_SETTORI,
    gare: piani.length,
    giaClassificate: 0,
    daScrivere: 0,
    fallite: 0,
    categorie: { A: 0, B: 0, misti: 0, C: 0, nessun_settore: 0 },
    colonna: { invariate: 0, cambiate: 0, perdono: 0, acquisiscono: 0, fuoriDaTutti: 0, soloMetodo: 0 },
    multisettore: 0,
    conflittiTraFonti: 0,
    righe: {
      radar_procedure: { aggiorna: 0 },
      radar_aggiornamenti: { inserisce: 0 },
      radar_classificazioni: { inserisce: 0, disattiva: 0, invariate: 0, protette: 0 },
      radar_classificazioni_stato: { inserisce: 0, aggiorna: 0 },
    },
  };
  for (const p of piani) {
    if (p.tipo === "gia_classificata") {
      r.giaClassificate++;
      continue;
    }
    r.daScrivere++;
    if (p.errori.length) r.fallite++;
    r.categorie[categoriaGara(p.calcolate)]++;
    const ric = p.ric as Riclassificazione;
    if (ric.dopo.settori.length >= 2) r.multisettore++;
    r.conflittiTraFonti += p.calcolate.filter((x) => x.ambigua).length;
    if (p.cambiaSettori) {
      r.colonna.cambiate++;
      if (ric.tolti.length) r.colonna.perdono++;
      if (ric.aggiunti.length) r.colonna.acquisiscono++;
      if (ric.dopo.settori.length === 0 && ric.prima.settori.length > 0) r.colonna.fuoriDaTutti++;
      if (ric.soloMetodo) r.colonna.soloMetodo++;
      r.righe.radar_procedure.aggiorna++;
      r.righe.radar_aggiornamenti.inserisce++;
    } else r.colonna.invariate++;
    if (p.righe) {
      r.righe.radar_classificazioni.inserisce += p.righe.inserisci.length;
      r.righe.radar_classificazioni.disattiva += p.righe.disattiva.length;
      r.righe.radar_classificazioni.invariate += p.righe.invariate;
      r.righe.radar_classificazioni.protette += p.righe.protette.length;
    }
    if (p.statoPrima) r.righe.radar_classificazioni_stato.aggiorna++;
    else r.righe.radar_classificazioni_stato.inserisce++;
  }
  return r;
}

// Una riga per gara, per il confronto con l'elenco della PVL (gara per gara) e per il resoconto.
export function rigaElenco(p: PianoGara) {
  const ric = p.ric;
  return {
    id: p.proceduraId,
    chiave: p.chiave,
    oggetto: p.oggetto.slice(0, 160),
    tipo: p.tipo,
    prima: ric?.prima ?? null,
    dopo: ric?.dopo ?? null,
    aggiunti: ric?.aggiunti ?? [],
    tolti: ric?.tolti ?? [],
    soloMetodo: ric?.soloMetodo ?? false,
    categoria: p.tipo === "da_scrivere" ? categoriaGara(p.calcolate) : null,
    valutazioni: Object.fromEntries(p.calcolate.map((r) => [r.settore, { rilevanza: r.rilevanza, sottocategorie: r.sottocategorie, regole: r.regole }])),
    errori: p.errori,
  };
}
