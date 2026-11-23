// Fase B4 (B1), 23/11/2026 — «Monitorate» e le fonti nascoste ai clienti. Difetto trovato da B2 preparando la L5a (documento 47 §3.1): la
// lista delle gare seguite non filtrava la visibilità delle fonti; una gara salvata con SOLO fonti nascoste (dopo la L5a, una gara solo PVL)
// restava in lista con l'etichetta SBAGLIATA «TED» (ripiego fontiGare.get(p.id) ?? ["ted"]) e la sua scheda non si apriva.
//
// Seguiti: fonti sconosciute e azioni (punti a e b), scheda senza fonti riconosciute, PVL visibile (direttiva 48A), e nella sezione N i TIPI di
// opportunità (analisi 49: C4 tipo ricavato dall'avviso, C5 tipo nelle liste e filtro in «Cerca», C11 «Avviso di preinformazione»).
//
// Esegue le pagine VERE («Monitorate», «Cerca», «Per te», scheda, «Gara aggiunta a mano») e la lettura vera della scheda (leggiGaraPubblica) su database IN MEMORIA:
// i moduli della sessione, delle guardie e dei client di Supabase sono sostituiti nella cache dei moduli; nessuna rete (fetch rifiutata).
// Dati SINTETICI dichiarati come tali («[SINTETICO]» nei titoli, identificativi finti), nessun dato di clienti.
// Uso: npx tsx scripts/verifica-monitorate-fonti-nascoste.ts → codice 0 se tutto passa. Mutazioni: scripts/mutazioni-monitorate-fonti-nascoste.mjs
import fs from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";

const RADICE = path.resolve(__dirname, "..");
const richiedi = createRequire(path.join(RADICE, "package.json"));

let ok = 0;
const falliti: string[] = [];
function controlla(nome: string, condizione: boolean, dettaglio?: unknown): void {
  if (condizione) ok++;
  else falliti.push(`${nome}${dettaglio === undefined ? "" : ` → ${JSON.stringify(dettaglio).slice(0, 500)}`}`);
}

// ═══════════════════════ nessuna rete ═══════════════════════
let chiamateRete = 0;
globalThis.fetch = (async () => {
  chiamateRete++;
  throw new Error("rete vietata nella prova");
}) as typeof fetch;

// ═══════════════════════ database in memoria (imitazione di PostgREST per le sole operazioni di queste pagine) ═══════════════════════
type Riga = Record<string, unknown>;
type Esito = { data: unknown; error: { code: string; message: string } | null };

class DbProva {
  tabelle: Record<string, Riga[]>;
  richieste: { tabella: string; metodo: string; colonne: string }[] = [];
  /** tabelle la cui lettura fallisce (guasto simulato) */
  guasti = new Set<string>();
  contatore = 0;
  /** tabelle che NON esistono in questo database (come una migrazione non applicata): PostgREST risponde PGRST205 */
  assenti = new Set<string>();
  /** eseguita una volta, subito prima della prossima scrittura (simula un'altra scrittura arrivata nel frattempo) */
  primaDiScrivere: ((tabella: string, db: DbProva) => boolean | void) | null = null;
  constructor(tabelle: Record<string, Riga[]>) {
    this.tabelle = structuredClone(tabelle);
  }
  from(tabella: string) {
    return new QueryProva(this, tabella);
  }
}

const confronta = (a: unknown, b: unknown) => {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const x = String(a ?? ""),
    y = String(b ?? "");
  return x < y ? -1 : x > y ? 1 : 0;
};

// divide al primo livello (fuori da parentesi tonde e graffe) un elenco separato da virgole
function dividi(s: string): string[] {
  const out: string[] = [];
  let livello = 0,
    da = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(" || s[i] === "{") livello++;
    else if (s[i] === ")" || s[i] === "}") livello--;
    else if (s[i] === "," && livello === 0) {
      out.push(s.slice(da, i));
      da = i + 1;
    }
  }
  out.push(s.slice(da));
  return out.map((x) => x.trim()).filter(Boolean);
}

// filtro «or» di PostgREST con and()/or() annidati. Analizzatore STRETTO: una sintassi non prevista è un errore, mai un filtro ignorato.
function termineOr(t: string): (r: Riga) => boolean {
  const g = /^(and|or)\((.*)\)$/.exec(t);
  if (g) {
    const parti = dividi(g[2]).map(termineOr);
    return g[1] === "and" ? (r) => parti.every((p) => p(r)) : (r) => parti.some((p) => p(r));
  }
  const c = /^([a-z_]+)\.(not\.)?(is|eq|neq|gt|gte|lt|lte|ov|in|like|match)\.(.+)$/.exec(t);
  if (!c) throw new Error(`or: condizione non prevista «${t}»`);
  const [, col, not, op, val] = c;
  if (op === "is" && val !== "null") throw new Error(`or: «is» solo con null («${t}»)`);
  if (op === "in" && !/^\([^()]*\)$/.test(val)) throw new Error(`or: «in» senza elenco tra parentesi («${t}»)`);
  // come in SQL: un confronto con NULL non è vero, e nemmeno la sua negazione (NOT NULL resta NULL); «is null» invece è sempre vero o falso
  const base = (r: Riga): boolean => {
    const v = r[col];
    if (op === "in") return v !== null && v !== undefined && val.slice(1, -1).split(",").includes(String(v));
    if (op === "like") {
      const re = new RegExp(`^${[...val].map((ch) => (ch === "*" || ch === "%" ? ".*" : ch === "_" ? "." : ch.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))).join("")}$`, "s");
      return v !== null && v !== undefined && re.test(String(v));
    }
    if (op === "match") return v !== null && v !== undefined && new RegExp(val).test(String(v));
    return confrontoSemplice(v);
  };
  const nullo = (r: Riga) => r[col] === null || r[col] === undefined;
  if (not) return (r) => (op === "is" ? !base(r) : !nullo(r) && !base(r));
  if (["in", "like", "match"].includes(op)) return base;
  return (r) => confrontoSemplice(r[col]);
  function confrontoSemplice(v: unknown): boolean {
    if (op === "is") return (v ?? null) === null;
    if (val.startsWith("{")) {
      const insieme = val.slice(1, -1).split(",").filter(Boolean);
      if (!Array.isArray(v)) return false;
      if (op === "ov") return v.some((x) => insieme.includes(String(x)));
      if (op === "eq") return v.length === insieme.length && insieme.every((x) => v.map(String).includes(x));
      throw new Error(`or: operatore non previsto sugli insiemi «${t}»`);
    }
    if (v === null || v === undefined) return false;
    const k = confronta(String(v), val);
    return op === "eq" ? k === 0 : op === "neq" ? k !== 0 : op === "gt" ? k > 0 : op === "gte" ? k >= 0 : op === "lt" ? k < 0 : k <= 0;
  }
}

class QueryProva implements PromiseLike<Esito> {
  private metodo: "select" | "update" | "insert" | "upsert" | "delete" = "select";
  private colonne = "*";
  private filtri: ((r: Riga) => boolean)[] = [];
  private ordini: [string, boolean][] = [];
  private lim: number | null = null;
  private una = false;
  private ritorna = false;
  private valori: Riga = {};
  private nuove: Riga[] = [];
  private conflitto: string[] = [];
  /** filtri su una tabella incorporata («classificazioni.attiva»): come PostgREST senza !inner, filtrano le righe incorporate, non la gara */
  private filtriIncorporati: { alias: string; colonna: string; valore: unknown }[] = [];
  constructor(
    private db: DbProva,
    private tabella: string,
  ) {}
  select(c = "*") {
    if (this.metodo !== "select") this.ritorna = true;
    this.colonne = c;
    return this;
  }
  update(v: Riga) {
    this.metodo = "update";
    this.valori = v;
    return this;
  }
  insert(v: Riga | Riga[]) {
    this.metodo = "insert";
    this.nuove = Array.isArray(v) ? v : [v];
    return this;
  }
  upsert(v: Riga | Riga[], o: { onConflict?: string } = {}) {
    this.metodo = "upsert";
    this.nuove = Array.isArray(v) ? v : [v];
    this.conflitto = (o.onConflict ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return this;
  }
  delete() {
    this.metodo = "delete";
    return this;
  }
  single() {
    this.una = true;
    return this;
  }
  eq(c: string, v: unknown) {
    if (c.includes(".")) {
      const [alias, colonna] = c.split(".");
      this.filtriIncorporati.push({ alias, colonna, valore: v });
      return this;
    }
    this.filtri.push((r) => r[c] === v);
    return this;
  }
  gt(c: string, v: unknown) {
    this.filtri.push((r) => r[c] != null && confronta(r[c], v) > 0);
    return this;
  }
  gte(c: string, v: unknown) {
    this.filtri.push((r) => r[c] != null && confronta(r[c], v) >= 0);
    return this;
  }
  lt(c: string, v: unknown) {
    this.filtri.push((r) => r[c] != null && confronta(r[c], v) < 0);
    return this;
  }
  lte(c: string, v: unknown) {
    this.filtri.push((r) => r[c] != null && confronta(r[c], v) <= 0);
    return this;
  }
  or(espressione: string) {
    const parti = dividi(espressione).map(termineOr);
    this.filtri.push((r) => parti.some((p) => p(r)));
    return this;
  }
  in(c: string, vs: readonly unknown[]) {
    const s = new Set(vs);
    this.filtri.push((r) => s.has(r[c]));
    return this;
  }
  is(c: string, v: null) {
    this.filtri.push((r) => (r[c] ?? null) === v);
    return this;
  }
  not(c: string, op: string, v: null) {
    if (op !== "is") throw new Error(`not: solo «is» (${op})`);
    this.filtri.push((r) => (r[c] ?? null) !== v);
    return this;
  }
  // array che contiene tutti i valori / array contenuto nei valori (scrittura condizionata di riallineaSettoriGara, B2)
  contains(c: string, vs: readonly unknown[]) {
    this.filtri.push((r) => Array.isArray(r[c]) && vs.every((x) => (r[c] as unknown[]).includes(x)));
    return this;
  }
  containedBy(c: string, vs: readonly unknown[]) {
    this.filtri.push((r) => Array.isArray(r[c]) && (r[c] as unknown[]).every((x) => vs.includes(x)));
    return this;
  }
  overlaps(c: string, vs: readonly unknown[]) {
    const s = new Set(vs);
    this.filtri.push((r) => Array.isArray(r[c]) && (r[c] as unknown[]).some((x) => s.has(x)));
    return this;
  }
  order(c: string, o: { ascending?: boolean } = {}) {
    this.ordini.push([c, o.ascending !== false]);
    return this;
  }
  limit(n: number) {
    this.lim = n;
    return this;
  }
  returns() {
    return this;
  }
  maybeSingle() {
    this.una = true;
    return this;
  }
  then<A, B>(ok?: ((v: Esito) => A | PromiseLike<A>) | null, ko?: ((e: unknown) => B | PromiseLike<B>) | null): Promise<A | B> {
    return Promise.resolve().then(() => this.esegui()).then(ok, ko);
  }
  private esegui(): Esito {
    this.db.richieste.push({ tabella: this.tabella, metodo: this.metodo, colonne: this.colonne });
    if (this.db.guasti.has(this.tabella)) return { data: null, error: { code: "08006", message: "guasto simulato" } };
    if (this.db.assenti.has(this.tabella)) return { data: null, error: { code: "PGRST205", message: `Could not find the table 'public.${this.tabella}' in the schema cache` } };
    // una scrittura «concorrente» simulata subito prima di questa (prova delle scritture condizionate): il gancio resta finché non agisce
    if (this.metodo !== "select" && this.db.primaDiScrivere?.(this.tabella, this.db) === true) this.db.primaDiScrivere = null;
    // colonne semplici e tabelle incorporate («alias:tabella(colonne)»); una tabella incorporata assente dal mondo (le tabelle della 0121 nei
    // mondi senza classificazioni) fa fallire la lettura come in PostgREST
    const semplici: string[] = [];
    const incorporate: { alias: string; tabella: string; colonne: string[] }[] = [];
    if (this.metodo === "select" && this.colonne.trim() !== "*")
      for (const p of dividi(this.colonne)) {
        const m = /^(\w+):(\w+)\(([^()]*)\)$/.exec(p);
        if (m) incorporate.push({ alias: m[1], tabella: m[2], colonne: m[3].split(",").map((s) => s.trim()) });
        else if (p.includes("(")) throw new Error(`select: incorporazione non prevista «${p}»`);
        else semplici.push(p);
      }
    if (incorporate.some((i) => this.db.tabelle[i.tabella] === undefined)) return { data: null, error: { code: "PGRST200", message: "relazione non trovata (tabelle della 0121 assenti in questo mondo)" } };
    const tutte = (this.db.tabelle[this.tabella] ??= []);
    const righe = tutte.filter((r) => this.filtri.every((f) => f(r)));
    if (this.metodo === "update") {
      for (const r of righe) Object.assign(r, this.valori);
      // con .select(…) PostgREST restituisce le righe cambiate (scrittura condizionata: zero righe = cambiata nel frattempo)
      if (!this.ritorna) return { data: null, error: null };
      return { data: righe.map((r) => (this.colonne.trim() === "*" ? { ...r } : Object.fromEntries(this.colonne.split(",").map((k) => [k.trim(), r[k.trim()] ?? null])))), error: null };
    }
    if (this.metodo === "delete") {
      this.db.tabelle[this.tabella] = tutte.filter((r) => !righe.includes(r));
      return { data: null, error: null };
    }
    if (this.metodo === "insert" || this.metodo === "upsert") {
      const scritte: Riga[] = [];
      for (const v of this.nuove) {
        const esistente = this.metodo === "upsert" && this.conflitto.length ? tutte.find((r) => this.conflitto.every((k) => r[k] === v[k])) : undefined;
        if (esistente) scritte.push(Object.assign(esistente, v));
        else {
          const nuova = { id: id(7000 + ++this.db.contatore), ...v };
          tutte.push(nuova);
          scritte.push(nuova);
        }
      }
      if (!this.ritorna) return { data: null, error: null };
      const p = scritte.map((r) => (this.colonne.trim() === "*" ? { ...r } : Object.fromEntries(this.colonne.split(",").map((k) => [k.trim(), r[k.trim()] ?? null]))));
      return { data: this.una ? (p[0] ?? null) : p, error: null };
    }
    let x = righe;
    for (const [c, asc] of [...this.ordini].reverse()) x = [...x].sort((a, b) => (asc ? 1 : -1) * confronta(a[c], b[c]));
    if (this.lim !== null) x = x.slice(0, this.lim);
    const proietta = (r: Riga): Riga => {
      if (this.colonne.trim() === "*") return { ...r };
      const out: Riga = Object.fromEntries(semplici.map((k) => [k, r[k] ?? null]));
      for (const i of incorporate) {
        const filtri = this.filtriIncorporati.filter((f) => f.alias === i.alias);
        const righe = (this.db.tabelle[i.tabella] ?? [])
          .filter((e) => e.procedura_id === r.id && filtri.every((f) => e[f.colonna] === f.valore))
          .map((e) => Object.fromEntries(i.colonne.map((k) => [k, e[k] ?? null])));
        // relazione uno a uno (tabelle «…_stato»): un oggetto o null; uno a molti: un elenco
        out[i.alias] = i.tabella.endsWith("_stato") ? (righe[0] ?? null) : righe;
      }
      return out;
    };
    if (this.una) return x.length > 1 ? { data: null, error: { code: "PGRST116", message: "più di una riga" } } : { data: x.length ? proietta(x[0]) : null, error: null };
    return { data: x.map(proietta), error: null };
  }
}

// ═══════════════════════ mondo sintetico ═══════════════════════
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const IMPRESA = id(9001);
const G = { ted: id(1), pvl: id(2), mista: id(3), sintel: id(4), senzaProv: id(5), ignota: id(6), copia: id(7), copiaDiPvl: id(8), ted2: id(9), sardegna: id(10), chiaveIgnota: id(11), pvlPura: id(12) };
// scadenze relative al giorno della prova (la prova gira a ogni build: una data fissa la renderebbe scaduta col tempo)
const FRA_UN_MESE = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
const A = { pvl: id(101), ted2: id(102), libera: id(103), copia: id(104), copiaPvl: id(105), ignota: id(106) };
// CIG sintetici (10 caratteri) dei lotti: uno di una gara visibile, uno di una gara solo PVL
const CIG = { ted: "SINT00001A", pvl: "SINT00002A" };
const TITOLO: Record<keyof typeof G, string> = {
  ted: "[SINTETICO] Gara TED",
  pvl: "[SINTETICO] Gara solo PVL",
  mista: "[SINTETICO] Gara TED e PVL",
  sintel: "[SINTETICO] Gara Sintel",
  senzaProv: "[SINTETICO] Gara senza provenienza letta",
  ignota: "[SINTETICO] Gara di una fonte sconosciuta",
  copia: "[SINTETICO] Copia collegata della gara TED e PVL",
  copiaDiPvl: "[SINTETICO] Copia collegata della gara solo PVL",
  ted2: "[SINTETICO] Gara TED trovata dal CIG",
  sardegna: "[SINTETICO] Gara solo SardegnaCAT",
  chiaveIgnota: "[SINTETICO] Gara visibile con chiave di fonte non riconosciuta e senza avvisi letti",
  pvlPura: "[SINTETICO] Gara solo PVL senza copie collegate",
};
const NASCOSTI = [TITOLO.pvl, TITOLO.ignota, TITOLO.sardegna, TITOLO.copiaDiPvl, TITOLO.pvlPura];

function gara(k: keyof typeof G, chiave: string, fonti: string[], unitaA: string | null = null): Riga {
  return {
    id: G[k],
    chiave,
    fonti,
    unita_a: unitaA,
    oggetto: TITOLO[k],
    oggetto_breve: null,
    sa_denominazione: "[SINTETICO] Ente di prova",
    sa_codice_fiscale: null,
    sa_comune: null,
    sa_provincia: null,
    settori: ["pulizia"],
    metodo_settore: null,
    scadenza_giorno: FRA_UN_MESE,
    scadenza_offerte: `${FRA_UN_MESE}T11:00:00Z`,
    scadenza_ora_indicata: true,
    data_pubblicazione: "2026-11-10",
    valore_stimato: 100000,
    valore_base: null,
    durata_mesi: 12,
    n_lotti: 1,
    stato: "aperta",
    rettificata: false,
    luogo_regioni: [],
    tipo_procedura: "aperta",
    ultima_rilevazione_il: "2026-11-22T06:00:00Z",
    cpv_principale: null,
    cpv_tutti: [],
    provenienza_campi: null,
    prima_rilevazione_il: "2026-11-10T06:00:00Z",
  };
}
const avviso = (k: keyof typeof G, fonte: string) => ({ procedura_id: G[k], fonte, id_fonte: `SINT-${k}-${fonte}`, url: null, pubblicato_il: "2026-11-10", tipo_avviso: null, rilevato_il: "2026-11-10T06:00:00Z", aggiornato_il: null });
const aggiunta = (k: keyof typeof A, proceduraId: string | null) => ({
  id: A[k],
  user_id: IMPRESA,
  cig: null,
  url: null,
  oggetto: `[SINTETICO] Gara scritta da me (${k})`,
  ente: "[SINTETICO] Ente scritto da me",
  scadenza_giorno: "2026-12-20",
  scadenza_offerte: null,
  scadenza_ora_indicata: false,
  importo: 5000,
  procedura_id: proceduraId,
  collegata_il: proceduraId ? "2026-11-20T06:00:00Z" : null,
  creata_il: "2026-11-01T06:00:00Z",
});
// salvataggi in ordine di creazione decrescente: per la gara solo PVL il PIÙ RECENTE è il salvataggio della gara (non l'aggiunta), così una
// correzione che filtrasse solo dopo il raggruppamento (una riga per gara mostrata) perderebbe l'aggiunta a mano
let n = 0;
const salvata = (proceduraId: string | null, aggiuntaId: string | null, monitorata = false) => ({
  id: id(500 + ++n),
  user_id: IMPRESA,
  procedura_id: proceduraId,
  aggiunta_id: aggiuntaId,
  monitorata,
  ultimo_aggiornamento_visto_il: null,
  creata_il: `2026-11-${String(30 - n).padStart(2, "0")}T06:00:00Z`,
  salvata_da: IMPRESA,
});
const SALVATE = [
  salvata(G.pvl, null, true),
  salvata(null, A.pvl, true),
  salvata(G.copiaDiPvl, null),
  salvata(null, A.copiaPvl, true),
  salvata(G.ted, null),
  salvata(G.mista, null, true),
  salvata(G.copia, null),
  salvata(null, A.copia, true),
  salvata(G.sintel, null),
  salvata(G.senzaProv, null),
  salvata(G.ignota, null),
  salvata(null, A.ted2, true),
  salvata(null, A.libera, true),
  salvata(G.sardegna, null),
  salvata(G.pvlPura, null, true),
];
// l'aggiunta collegata alla gara di fonte sconosciuta non è tra le salvate: serve solo alla prova della sua pagina (sezione G)
const AGGIUNTE = [aggiunta("pvl", G.pvl), aggiunta("ted2", G.ted2), aggiunta("libera", null), aggiunta("copia", G.copia), aggiunta("copiaPvl", G.copiaDiPvl), aggiunta("ignota", G.ignota)];

function statoFonti(pvlNascosta: boolean): Riga[] {
  return [
    { fonte: "ted", attiva: true, nascosta_ai_clienti: false, dati_aggiornati_al: null, ultimo_successo_il: "2026-11-22T06:00:00Z" },
    { fonte: "pvl", attiva: true, nascosta_ai_clienti: pvlNascosta, dati_aggiornati_al: null, ultimo_successo_il: "2026-11-22T06:00:00Z" },
    { fonte: "sintel", attiva: false, nascosta_ai_clienti: false, dati_aggiornati_al: null, ultimo_successo_il: null },
    { fonte: "sardegnacat", attiva: false, nascosta_ai_clienti: true, dati_aggiornati_al: null, ultimo_successo_il: null },
  ];
}

// con «classificazioni»: le tabelle della 0121 esistono (stato «classificata», settore «pulizia» pertinente A per ogni gara che resta), come
// sullo staging con le classificazioni accese; senza, una lettura incorporata fallisce (scenario D)
function nuovoMondo(pvlNascosta: boolean, opzioni: { classificazioni?: boolean } = {}) {
  const gareCheRestano = Object.values(G).filter((g) => g !== G.copia && g !== G.copiaDiPvl);
  const classificazioni: Record<string, Riga[]> = opzioni.classificazioni
    ? {
        radar_classificazioni_stato: gareCheRestano.map((g) => ({ procedura_id: g, stato: "classificata" })),
        radar_classificazioni: gareCheRestano.map((g) => ({ procedura_id: g, settore: "pulizia", rilevanza: "A", sottocategorie: [], attiva: true })),
      }
    : {};
  const admin = new DbProva({
    ...classificazioni,
    radar_fonti_stato: statoFonti(pvlNascosta),
    radar_procedure: [
      gara("ted", "ted:SINT-1-2026", ["ted"]),
      gara("pvl", "pvl:SINT-2", ["pvl"]),
      gara("mista", "ted:SINT-3-2026", ["pvl", "ted"]),
      gara("sintel", "sintel:SINT-4", ["sintel"]),
      gara("senzaProv", "ted:SINT-5-2026", ["ted"]),
      gara("ignota", "nuova:SINT-6", ["nuova"]),
      gara("copia", "pvl:SINT-7", ["pvl"], G.mista),
      gara("copiaDiPvl", "ted:SINT-8-2026", ["ted"], G.pvl),
      gara("ted2", "ted:SINT-9-2026", ["ted"]),
      gara("sardegna", "sardegnacat:SINT-10", ["sardegnacat"]),
      // caso limite della scheda (seguito del punto c di B2): visibile per la colonna fonti, ma nessuna fonte riconosciuta da avvisi,
      // provenienza o chiave; ultima_versione_id di una fonte non riconosciuta, che non va mai citato come numero di avviso TED
      { ...gara("chiaveIgnota", "nuova:SINT-11", ["ted"]), ultima_versione_id: "SINT11VERSIONE" },
      gara("pvlPura", "pvl:SINT-12", ["pvl"]),
    ],
    radar_procedure_fonti: [avviso("ted", "ted"), avviso("pvl", "pvl"), avviso("mista", "pvl"), avviso("mista", "ted"), avviso("sintel", "sintel"), avviso("ignota", "nuova"), avviso("copia", "pvl"), avviso("copiaDiPvl", "ted"), avviso("ted2", "ted"), avviso("sardegna", "sardegnacat"), avviso("pvlPura", "pvl")],
    radar_aggiornamenti: [],
    radar_lotti: [
      { procedura_id: G.ted, numero_lotto: "1", cig: CIG.ted, oggetto: null, valore_stimato: null, cpv: null },
      { procedura_id: G.pvl, numero_lotto: "1", cig: CIG.pvl, oggetto: null, valore_stimato: null, cpv: null },
    ],
    omnia_ai_radar_utilizzi: [],
  });
  const sessione = new DbProva({
    omnia_ai_radar_salvate: SALVATE,
    omnia_ai_radar_gare_aggiunte: AGGIUNTE,
    // profilo di ricerca dell'impresa per «Per te»: settore «pulizia», tutta Italia, nessun importo né procedura
    omnia_ai_radar_profili: [{ user_id: IMPRESA, posizione: 1, settori: ["pulizia"], sottocategorie: null, regioni: [], tipi_procedura: [], importo_min: null, importo_max: null, vedere_correlate: false, aggiornato_il: "2026-11-20T06:00:00Z" }],
  });
  return { admin, sessione };
}
let mondo = nuovoMondo(true);

// ═══════════════════════ mondo dei TIPI di opportunità (analisi 49 §4-§5: C4, C5, C11) ═══════════════════════
// tipo_opportunita vuoto come sullo staging (C4: il tipo si ricava dal tipo dell'avviso), oppure già scritto dal motore; atteso = il tipo
// mostrato; categoria = il gruppo del filtro di «Cerca». C1 di B2 (decisione dell'utente del 23/11): la scheda PVL P7_1_3 (avvio
// dell'indagine di mercato) è un'indagine di mercato, cioè una candidatura, mai una gara aperta; P7_3 (costituzione di un elenco) è
// un'iscrizione.
type CasoTipo = { k: string; id: string; tipoOpp: string | null; avviso: string | null; fonte: string; atteso: string | null; categoria: string | null };
const TIPI: CasoTipo[] = [
  ["cn", null, "cn-standard", "ted", "bando", "bandi"],
  ["pin", null, "pin-cfc-standard", "ted", "preinformazione", "candidature"],
  ["qusy", null, "qu-sy", "ted", "sistema_qualificazione", "iscrizioni"],
  ["p116", null, "P1_16", "pvl", "bando", "bandi"],
  ["p112", null, "P1_12", "pvl", "preinformazione", "candidature"],
  ["p212", null, "P2_12", "pvl", "preinformazione", "candidature"],
  ["indagine", "indagine_mercato", null, "sintel", "indagine_mercato", "candidature"],
  ["manif", "manifestazione_interesse", null, "sintel", "manifestazione_interesse", "candidature"],
  ["sda", "sistema_qualificazione", null, "sintel", "sistema_qualificazione", "iscrizioni"],
  ["bandoCn", "bando", "cn-social", "ted", "bando", "bandi"],
  ["bandoPin", "bando", "pin-cfc-social", "ted", "preinformazione", "candidature"],
  ["bandoSintel", "bando", null, "sintel", "bando", "bandi"],
  ["ignoto", null, null, "ted", null, null],
  ["p713", null, "P7_1_3", "pvl", "indagine_mercato", "candidature"],
  ["p73", null, "P7_3", "pvl", "sistema_qualificazione", "iscrizioni"],
].map(([k, tipoOpp, avviso, fonte, atteso, categoria], i) => ({ k: k as string, id: id(300 + i), tipoOpp, avviso, fonte: fonte as string, atteso, categoria }));
const ETICHETTE_ATTESE: Record<string, string> = {
  bando: "Bando di gara",
  preinformazione: "Avviso di preinformazione",
  sistema_qualificazione: "Iscrizione a elenco o sistema di qualificazione",
  indagine_mercato: "Indagine di mercato",
  manifestazione_interesse: "Manifestazione di interesse",
};
function mondoTipi() {
  const gare = TIPI.map((t) => ({ ...gara("ted", `${t.fonte}:SINT-T-${t.k}`, [t.fonte]), id: t.id, oggetto: `[SINTETICO] Tipo ${t.k}`, tipo_opportunita: t.tipoOpp, tipo_avviso: t.avviso }));
  const admin = new DbProva({
    radar_fonti_stato: statoFonti(false),
    radar_procedure: gare,
    radar_procedure_fonti: TIPI.map((t) => ({ procedura_id: t.id, fonte: t.fonte, id_fonte: `SINT-T-${t.k}`, url: null, pubblicato_il: "2026-11-10", tipo_avviso: t.avviso, rilevato_il: "2026-11-10T06:00:00Z", aggiornato_il: null })),
    radar_aggiornamenti: [],
    radar_lotti: [],
    omnia_ai_radar_utilizzi: [],
    radar_classificazioni_stato: TIPI.map((t) => ({ procedura_id: t.id, stato: "classificata" })),
    radar_classificazioni: TIPI.map((t) => ({ procedura_id: t.id, settore: "pulizia", rilevanza: "A", sottocategorie: [], attiva: true })),
  });
  const sessione = new DbProva({
    omnia_ai_radar_salvate: TIPI.map((t, i) => ({ id: id(800 + i), user_id: IMPRESA, procedura_id: t.id, aggiunta_id: null, monitorata: true, ultimo_aggiornamento_visto_il: null, creata_il: "2026-11-20T06:00:00Z", salvata_da: IMPRESA })),
    omnia_ai_radar_gare_aggiunte: [],
    omnia_ai_radar_profili: [{ user_id: IMPRESA, posizione: 1, settori: ["pulizia"], sottocategorie: null, regioni: [], tipi_procedura: [], importo_min: null, importo_max: null, vedere_correlate: false, aggiornato_il: "2026-11-20T06:00:00Z" }],
  });
  return { admin, sessione };
}

// ═══════════════════════ moduli sostituiti (solo in questo processo) ═══════════════════════
function sostituisci(file: string, esporta: Record<string, unknown>): void {
  const m = new Module(file);
  m.filename = file;
  m.loaded = true;
  m.exports = esporta;
  richiedi.cache[file] = m;
}
const src = (rel: string) => path.join(RADICE, "src", ...rel.split("/"));
const { RADICE_AREA } = richiedi(src("lib/omnia-ai-account-calcoli.ts")) as { RADICE_AREA: string };
const RADICE_OPPORTUNITA = `${RADICE_AREA}/opportunita`;
sostituisci(src("lib/supabase/server.ts"), { createClient: async () => mondo.sessione });
sostituisci(src("lib/supabase/admin.ts"), { createAdminClient: () => mondo.admin });
sostituisci(src("lib/radar/guardie-opportunita.ts"), {
  richiediOpportunitaPagina: async () => ({ contesto: { accountId: IMPRESA, userId: IMPRESA, ruolo: "titolare" } }),
  richiediOpportunitaAzione: async () => ({ ok: true, user: { id: IMPRESA }, contesto: { accountId: IMPRESA, userId: IMPRESA, ruolo: "titolare" } }),
});
sostituisci(src("lib/radar/area-cliente.ts"), {
  RADICE_OPPORTUNITA,
  MESSAGGIO_RADAR_NON_DISPONIBILE: "[prova] modulo non disponibile",
  // limiti al minuto alti: la prova non deve mai fermarsi sul limite tecnico delle ricerche
  dirittoRadarOppure404: async () => ({ diritto: { operativo: true, messaggioSolaLettura: "" }, parametri: { limiti: { ricerche_minuto: 1000 }, costi: {} }, cliente: null }),
});
sostituisci(src("lib/radar/impostazioni.ts"), { leggiDirittoRadar: async () => ({ visibile: true, operativo: true, messaggioSolaLettura: "" }) });
// la cache dei dati di Next non esiste fuori da Next: la lettura delle fonti nascoste si esegue ogni volta (nessun ricordo tra gli scenari);
// lo svuotamento delle pagine delle azioni non fa nulla
// lo svuotamento delle cache per etichetta si registra (la console delle fonti deve svuotare subito quella delle fonti visibili)
const tagSvuotati: string[] = [];
sostituisci(richiedi.resolve("next/cache"), {
  ...(richiedi("next/cache") as Record<string, unknown>),
  unstable_cache: (f: unknown) => f,
  revalidatePath: () => undefined,
  revalidateTag: (t: string) => void tagSvuotati.push(t),
  updateTag: (t: string) => void tagSvuotati.push(t),
});
// la console: un amministratore sintetico (decisione 48E sulla visibilità di SardegnaCAT, sezione O)
const AMMINISTRATORE = { userId: id(9100), email: "amministratore@prova.test", scadeIl: "2026-12-31T00:00:00Z" };
let adminAutenticato = true;
sostituisci(src("lib/console/accesso.ts"), {
  richiediAdminAzione: async () => (adminAutenticato ? AMMINISTRATORE : null),
  richiediAdminPagina: async () => {
    if (!adminAutenticato) throw new Error("redirect al login (prova)");
    return AMMINISTRATORE;
  },
});
const dopo: unknown[] = [];
sostituisci(richiedi.resolve("next/server"), { ...(richiedi("next/server") as Record<string, unknown>), after: (f: unknown) => void dopo.push(f) });

type Elemento = { type: unknown; props: Record<string, unknown> };
type DatiRiga = {
  href: string;
  titolo: string;
  fonte: string;
  motivi: string[];
  monitorata?: boolean;
  tipo?: string | null;
  scadenzaGiorno?: string | null;
  scadenza?: string | null;
  rilevanza?: string | null;
  statoClassificazione?: string | null;
  settoriDettaglio?: { settore: string; livello: string | null }[];
};
const PaginaMonitorate = (richiedi(src("app/site-omnia-ai/dashboard/omnia-ai/opportunita/monitorate/page.tsx")) as { default: () => Promise<unknown> }).default;
const PaginaAggiunta = (richiedi(src("app/site-omnia-ai/dashboard/omnia-ai/opportunita/aggiunta/[id]/page.tsx")) as { default: (p: unknown) => Promise<unknown> }).default;
const PaginaScheda = (richiedi(src("app/site-omnia-ai/dashboard/omnia-ai/opportunita/gara/[id]/page.tsx")) as { default: (p: unknown) => Promise<unknown> }).default;
const PaginaCerca = (richiedi(src("app/site-omnia-ai/dashboard/omnia-ai/opportunita/cerca/page.tsx")) as { default: (p: unknown) => Promise<unknown> }).default;
const PaginaPerTe = (richiedi(src("app/site-omnia-ai/dashboard/omnia-ai/opportunita/per-te/page.tsx")) as { default: (p: unknown) => Promise<unknown> }).default;
const RigaGara = (richiedi(src("components/omnia-ai/opportunita/riga-gara.tsx")) as { default: unknown }).default;
const ClassificazioneGara = (richiedi(src("components/omnia-ai/opportunita/classificazione-gara.tsx")) as { default: unknown }).default;
const { leggiGaraPubblica } = richiedi(src("lib/radar/gara.ts")) as { leggiGaraPubblica: (admin: unknown, id: string) => Promise<unknown> };
const calcoliFonti = richiedi(src("lib/radar/fonti-gara-calcoli.ts")) as Record<string, unknown>;
type Azione = (stato: unknown, formData: FormData) => Promise<{ errore?: string; ok?: boolean; messaggio?: string }>;
const azioniRadar = richiedi(src("app/actions/radar.ts")) as { aggiornaSalvataggio: Azione; aggiungiGaraAMano: Azione };
type AzioneConsole = (stato: unknown, formData: FormData) => Promise<{ errore?: string; ok?: boolean; avviso?: string }>;
const azioniConsole = richiedi(src("app/site-console/azioni/tender-intelligence.ts")) as { impostaVisibilitaFonte: AzioneConsole };
const { TAG_FONTI_RADAR } = richiedi(src("lib/radar/fonti-nascoste.ts")) as { TAG_FONTI_RADAR: string };
const { FONTI_NASCOSTE_PREDEFINITE } = richiedi(src("lib/radar/fonti-nascoste.ts")) as { FONTI_NASCOSTE_PREDEFINITE: readonly string[] };

function elementi(nodo: unknown, out: Elemento[] = []): Elemento[] {
  if (Array.isArray(nodo)) for (const x of nodo) elementi(x, out);
  else if (nodo && typeof nodo === "object" && "type" in nodo && "props" in nodo) {
    const e = nodo as Elemento;
    out.push(e);
    elementi(e.props.children, out);
  }
  return out;
}
function testi(nodo: unknown, visti = new WeakSet<object>(), out: string[] = []): string[] {
  if (typeof nodo === "string") out.push(nodo);
  else if (nodo && typeof nodo === "object" && !visti.has(nodo)) {
    visti.add(nodo);
    for (const v of Array.isArray(nodo) ? nodo : Object.values(nodo)) testi(v, visti, out);
  }
  return out;
}
async function monitorate() {
  const albero = await PaginaMonitorate();
  const righe = elementi(albero)
    .filter((e) => e.type === RigaGara)
    .map((e) => e.props.d as DatiRiga);
  return { albero, righe, perHref: new Map(righe.map((r) => [r.href, r])), testi: testi(albero) };
}
async function apriAggiunta(aggiuntaId: string): Promise<{ redirect: string | null; notFound: boolean; testi: string[]; errore?: string }> {
  try {
    const albero = await PaginaAggiunta({ params: Promise.resolve({ id: aggiuntaId }), searchParams: Promise.resolve({}) });
    return { redirect: null, notFound: false, testi: testi(albero) };
  } catch (e) {
    const digest = String((e as { digest?: unknown }).digest ?? "");
    if (digest.startsWith("NEXT_REDIRECT")) return { redirect: digest.split(";")[2] ?? "", notFound: false, testi: [] };
    if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;404")) return { redirect: null, notFound: true, testi: [] };
    return { redirect: null, notFound: false, testi: [], errore: e instanceof Error ? e.message : String(e) };
  }
}
const hrefG = (gid: string) => `${RADICE_OPPORTUNITA}/gara/${gid}`;
const hrefA = (aid: string) => `${RADICE_OPPORTUNITA}/aggiunta/${aid}`;
const ordinati = (xs: Iterable<string>) => [...xs].sort();

async function principale(): Promise<void> {
  delete process.env.RADAR_CLASSIFICAZIONI;

  // ═════ A. PVL nascosta (come sullo staging dopo la L5a) ═════
  mondo = nuovoMondo(true);
  const salvatePrima = JSON.stringify(mondo.sessione.tabelle.omnia_ai_radar_salvate);
  const a = await monitorate();
  const hrefA1 = [...a.perHref.keys()];
  controlla(
    "MN1. Monitorate (PVL nascosta): nessuna riga per le gare con SOLO fonti nascoste (solo PVL, solo SardegnaCAT, copia collegata a una gara solo PVL) né di una fonte sconosciuta",
    ![G.pvl, G.pvlPura, G.sardegna, G.ignota, G.copiaDiPvl].some((g) => a.perHref.has(hrefG(g))),
    hrefA1,
  );
  controlla(
    "MN2. Monitorate: mai «TED» per una gara che TED non ha pubblicato; senza fonti visibili lette «Fonte non indicata»",
    a.perHref.get(hrefG(G.ted))?.fonte === "TED" &&
      a.perHref.get(hrefG(G.mista))?.fonte === "TED" &&
      a.perHref.get(hrefG(G.sintel))?.fonte === "Sintel" &&
      a.perHref.get(hrefG(G.senzaProv))?.fonte === "Fonte non indicata" &&
      a.perHref.get(hrefG(G.ted2))?.fonte === "TED" &&
      a.righe.every((r) => r.fonte !== "TED" || [G.ted, G.mista, G.ted2].some((g) => r.href === hrefG(g))),
    a.righe.map((r) => [r.href.slice(-3), r.fonte]),
  );
  const rigaAggPvl = a.perHref.get(hrefA(A.pvl));
  const rigaAggCopiaPvl = a.perHref.get(hrefA(A.copiaPvl));
  controlla(
    "MN3. Monitorate: un'aggiunta a mano collegata a una gara con sole fonti nascoste resta in lista come «Aggiunta a mano», con i dati scritti dall'impresa e la sua pagina",
    rigaAggPvl?.fonte === "Aggiunta a mano" && rigaAggPvl.titolo === "[SINTETICO] Gara scritta da me (pvl)" && rigaAggPvl.monitorata === true && rigaAggCopiaPvl?.fonte === "Aggiunta a mano" && rigaAggCopiaPvl.titolo === "[SINTETICO] Gara scritta da me (copiaPvl)",
    { rigaAggPvl, rigaAggCopiaPvl },
  );
  controlla(
    "MN4. Monitorate: nessun testo delle gare nascoste nella pagina (titoli di gare solo PVL, solo SardegnaCAT o di fonte sconosciuta)",
    !a.testi.some((t) => NASCOSTI.some((x) => t.includes(x))),
    a.testi.filter((t) => NASCOSTI.some((x) => t.includes(x))),
  );
  const attese = ordinati([hrefG(G.ted), hrefG(G.mista), hrefG(G.sintel), hrefG(G.senzaProv), hrefG(G.ted2), hrefA(A.pvl), hrefA(A.copiaPvl), hrefA(A.libera)]);
  controlla("MN5. Monitorate: le altre righe intatte, una per gara mostrata (copie collegate e aggiunte trovate nelle fonti raggruppate come prima)", JSON.stringify(ordinati(hrefA1)) === JSON.stringify(attese) && a.righe.length === attese.length, { avute: ordinati(hrefA1), attese });
  controlla(
    "MN5b. Monitorate: l'aggiunta trovata nelle fonti visibili si mostra come la gara pubblica, con il motivo",
    (a.perHref.get(hrefG(G.ted2))?.motivi ?? []).includes("aggiunta da te, poi trovata nelle fonti"),
    a.perHref.get(hrefG(G.ted2)),
  );
  // ogni riga che porta a una scheda deve aprirla (stessa lettura della pagina della gara)
  const schede = await Promise.all(a.righe.filter((r) => r.href.includes("/gara/")).map(async (r) => [r.href, (await leggiGaraPubblica(mondo.admin, r.href.split("/").pop()!)) !== null] as const));
  // (la fonte sconosciuta: dal punto a del coordinamento la scheda la tratta come «Cerca», vedi anche MN19 e MN20)
  const nascosteSi = await Promise.all([G.pvl, G.sardegna, G.ignota].map(async (g) => (await leggiGaraPubblica(mondo.admin, g)) === null));
  controlla("MN6. Monitorate: ogni riga che porta alla scheda la apre (leggiGaraPubblica vera); le gare nascoste non si aprono", schede.length === 5 && schede.every(([, aperta]) => aperta) && nascosteSi.every(Boolean), { schede, nascosteSi });
  controlla(
    "MN7. Monitorate: nessun salvataggio cancellato o modificato; i salvataggi si leggono solo con la sessione (mai con la chiave di servizio)",
    JSON.stringify(mondo.sessione.tabelle.omnia_ai_radar_salvate) === salvatePrima &&
      !mondo.sessione.richieste.some((r) => r.metodo !== "select") &&
      !mondo.admin.richieste.some((r) => r.metodo !== "select" || r.tabella.startsWith("omnia_ai_")),
  );

  // ═════ B. PVL visibile (come in produzione oggi): nessun filtro di troppo ═════
  mondo = nuovoMondo(false);
  const b = await monitorate();
  const atteseB = ordinati([hrefG(G.ted), hrefG(G.pvl), hrefG(G.mista), hrefG(G.sintel), hrefG(G.senzaProv), hrefG(G.ted2), hrefG(G.pvlPura), hrefA(A.libera)]);
  // la gara solo PVL ha una copia collegata pubblicata su TED: le fonti delle copie si attribuiscono alla gara che resta (leggiFontiGare)
  controlla(
    "MN8. PVL visibile: la gara solo PVL torna in lista, con l'aggiunta e la copia collegate raggruppate; SardegnaCAT e la fonte sconosciuta restano fuori",
    JSON.stringify(ordinati(b.perHref.keys())) === JSON.stringify(atteseB) && b.perHref.get(hrefG(G.pvl))?.fonte === "TED e PVL ANAC" && b.perHref.get(hrefG(G.mista))?.fonte === "TED e PVL ANAC" && b.perHref.get(hrefG(G.sintel))?.fonte === "Sintel" && b.perHref.get(hrefG(G.pvlPura))?.fonte === "PVL ANAC",
    { avute: ordinati(b.perHref.keys()), attese: atteseB, etichette: b.righe.map((r) => [r.href.slice(-3), r.fonte]) },
  );

  // ═════ C. lettura dello stato delle fonti in errore: si nascondono le fonti nascoste di base ═════
  mondo = nuovoMondo(false);
  mondo.admin.guasti.add("radar_fonti_stato");
  const c = await monitorate();
  const pvlDiBase = FONTI_NASCOSTE_PREDEFINITE.includes("pvl");
  // K11 di B2 (48E, D4-bis, 23/11): SardegnaCAT non è più nascosta di base; come la PVL, segue FONTI_NASCOSTE_PREDEFINITE (oggi vuota)
  const sardegnaDiBase = FONTI_NASCOSTE_PREDEFINITE.includes("sardegnacat");
  controlla(
    "MN9. stato delle fonti non leggibile: valgono le fonti nascoste di base (FONTI_NASCOSTE_PREDEFINITE), per la PVL e per SardegnaCAT",
    c.perHref.has(hrefG(G.sardegna)) === !sardegnaDiBase && c.perHref.has(hrefG(G.pvl)) === !pvlDiBase && c.perHref.has(hrefG(G.ted)),
    { pvlDiBase, sardegnaDiBase, avute: ordinati(c.perHref.keys()) },
  );

  // ═════ D. classificazioni accese ma tabelle della 0121 non leggibili: la seconda lettura filtra allo stesso modo ═════
  mondo = nuovoMondo(true);
  const ambientePrima = { RADAR_CLASSIFICAZIONI: process.env.RADAR_CLASSIFICAZIONI, NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL };
  const { PROGETTO_STAGING } = richiedi(src("lib/radar/ambiente.ts")) as { PROGETTO_STAGING: string };
  process.env.RADAR_CLASSIFICAZIONI = "attive";
  process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${PROGETTO_STAGING}.supabase.co`;
  let d: Awaited<ReturnType<typeof monitorate>>;
  try {
    d = await monitorate();
  } finally {
    for (const [k, v] of Object.entries(ambientePrima)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  const incorporate = mondo.admin.richieste.filter((r) => r.tabella === "radar_procedure" && r.colonne.includes("(")).length;
  controlla("MN10. classificazioni accese e tabelle della 0121 non leggibili: anche la seconda lettura delle gare toglie quelle con sole fonti nascoste", incorporate === 1 && JSON.stringify(ordinati(d.perHref.keys())) === JSON.stringify(attese), { incorporate, avute: ordinati(d.perHref.keys()) });

  // ═════ E. pagina dell'aggiunta a mano ═════
  mondo = nuovoMondo(true);
  const e1 = await apriAggiunta(A.pvl);
  controlla(
    "MN11. aggiunta collegata a una gara con sole fonti nascoste: la pagina NON porta alla scheda (che non si aprirebbe) e mostra i dati scritti dall'impresa",
    e1.redirect === null && !e1.notFound && !e1.errore && e1.testi.includes("[SINTETICO] Gara scritta da me (pvl)") && !e1.testi.some((t) => NASCOSTI.some((x) => t.includes(x))),
    e1,
  );
  const e2 = await apriAggiunta(A.copiaPvl);
  controlla("MN12. aggiunta collegata alla copia (0117) di una gara con sole fonti nascoste: nessun passaggio alla scheda", e2.redirect === null && !e2.notFound && !e2.errore, e2);
  const e3 = await apriAggiunta(A.ted2);
  const e4 = await apriAggiunta(A.copia);
  controlla("MN13. aggiunta collegata a una gara visibile, o alla copia collegata di una gara visibile: porta alla scheda come prima", e3.redirect === hrefG(G.ted2) && e4.redirect === hrefG(G.copia), { e3: e3.redirect, e4: e4.redirect });
  mondo = nuovoMondo(false);
  const e5 = await apriAggiunta(A.pvl);
  controlla("MN14. PVL visibile: l'aggiunta collegata alla gara solo PVL porta alla scheda", e5.redirect === hrefG(G.pvl), e5);
  mondo = nuovoMondo(false);
  mondo.admin.guasti.add("radar_procedure");
  const e6 = await apriAggiunta(A.ted2);
  controlla("MN15. lettura della gara collegata in errore: restano i dati scritti dall'impresa (mai una scheda che potrebbe non aprirsi)", e6.redirect === null && !e6.notFound && !e6.errore && e6.testi.includes("[SINTETICO] Gara scritta da me (ted2)"), e6);

  // ═════ F. etichetta delle fonti negli elenchi e codice delle pagine ═════
  const etichetta = calcoliFonti.etichettaFontiElenco as ((f: readonly string[] | undefined) => string) | undefined;
  controlla(
    "MN16. etichettaFontiElenco: senza fonti lette «Fonte non indicata» (mai TED), altrimenti i nomi delle fonti",
    typeof etichetta === "function" && etichetta(undefined) === "Fonte non indicata" && etichetta([]) === "Fonte non indicata" && etichetta(["pvl"]) === "PVL ANAC" && etichetta(["ted", "pvl"]) === "TED e PVL ANAC",
  );
  const sorgenti: string[] = [];
  const visita = (dir: string) => {
    for (const voce of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, voce.name);
      if (voce.isDirectory()) visita(p);
      else if (/\.tsx?$/.test(voce.name)) sorgenti.push(p);
    }
  };
  visita(path.join(RADICE, "src"));
  const conRipiego = sorgenti.filter((f) => /\?\?\s*\[\s*["']ted["']\s*\]/.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(RADICE, f));
  const pagine = ["cerca", "per-te", "monitorate"].map((p) => fs.readFileSync(src(`app/site-omnia-ai/dashboard/omnia-ai/opportunita/${p}/page.tsx`), "utf8"));
  controlla("MN17. nessun ripiego «?? [\"ted\"]» nel codice dell'app; Cerca, Per te e Monitorate usano etichettaFontiElenco", conRipiego.length === 0 && pagine.every((t) => /fonte: etichettaFontiElenco\(fontiGare\.get\((r|p)\.id\)\)/.test(t)), conRipiego);
  // ═════ G. (coordinamento, 23/11, punto a) la scheda tratta una fonte sconosciuta come «Cerca»: non visibile ═════
  const visibile = calcoliFonti.garaVisibileAiClienti as (g: { fonti?: readonly string[] | null; chiave: string }, nascoste: ReadonlySet<string>) => boolean;
  const nessuna = new Set<string>();
  const casi = [
    visibile({ fonti: ["nuova"], chiave: "nuova:1" }, nessuna),
    visibile({ fonti: [], chiave: "nuova:1" }, nessuna),
    visibile({ fonti: null, chiave: "nuova:1" }, nessuna),
    visibile({ fonti: ["nuova", "ted"], chiave: "nuova:1" }, nessuna),
    visibile({ fonti: [], chiave: "ted:1" }, nessuna),
    visibile({ fonti: ["pvl"], chiave: "pvl:1" }, new Set(["pvl"])),
    visibile({ fonti: ["sintel"], chiave: "sintel:1" }, new Set(["pvl", "sardegnacat"])),
  ];
  controlla(
    "MN19. garaVisibileAiClienti: una fonte che il codice non conosce vale come nascosta (anche dalla chiave); una fonte conosciuta e visibile basta",
    JSON.stringify(casi) === JSON.stringify([false, false, false, true, true, false, true]),
    casi,
  );
  mondo = nuovoMondo(false);
  const schedaIgnota = await leggiGaraPubblica(mondo.admin, G.ignota);
  const aggIgnota = await apriAggiunta(A.ignota);
  controlla(
    "MN20. la scheda di una gara di sola fonte sconosciuta non si apre (come in «Cerca»); l'aggiunta a mano collegata a lei mostra i dati dell'impresa",
    schedaIgnota === null && aggIgnota.redirect === null && !aggIgnota.notFound && !aggIgnota.errore && aggIgnota.testi.includes("[SINTETICO] Gara scritta da me (ignota)"),
    { schedaIgnota: schedaIgnota !== null, aggIgnota },
  );

  // ═════ H. (coordinamento, 23/11, punto b) «salva» e «monitora» rifiutano una gara con sole fonti nascoste come una gara che non c'è ═════
  const modulo = (campi: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(campi)) fd.set(k, v);
    return fd;
  };
  const salvataggio = (azione: string, proceduraId: string) => azioniRadar.aggiornaSalvataggio(undefined, modulo({ azione, proceduraId }));
  mondo = nuovoMondo(true);
  const salvatePrimaH = JSON.stringify(mondo.sessione.tabelle.omnia_ai_radar_salvate);
  const dopoPrima = dopo.length;
  const inesistente = id(999);
  const esiti: Record<string, string> = {};
  for (const azione of ["salva", "monitora", "non_monitorare"])
    for (const [nome, gid] of [["inesistente", inesistente], ["solo PVL", G.pvl], ["solo SardegnaCAT", G.sardegna], ["fonte sconosciuta", G.ignota], ["copia di una gara solo PVL", G.copiaDiPvl]] as const)
      esiti[`${azione} ${nome}`] = JSON.stringify(await salvataggio(azione, gid));
  const attesoNonTrovata = JSON.stringify({ errore: "Gara non trovata." });
  const diverse = Object.entries(esiti).filter(([, v]) => v !== attesoNonTrovata);
  controlla(
    "MN21. «salva», «monitora» e «non monitorare» di una gara con sole fonti nascoste (o sconosciute): stessa risposta di una gara che non c'è, nessuna scrittura né aggancio",
    diverse.length === 0 &&
      JSON.stringify(mondo.sessione.tabelle.omnia_ai_radar_salvate) === salvatePrimaH &&
      !mondo.sessione.richieste.some((r) => r.metodo !== "select") &&
      mondo.admin.tabelle.omnia_ai_radar_utilizzi.length === 0 &&
      dopo.length === dopoPrima,
    diverse,
  );
  const rimuoviNascosta = JSON.stringify(await salvataggio("rimuovi", G.pvl));
  const rimuoviInesistente = JSON.stringify(await salvataggio("rimuovi", inesistente));
  controlla("MN22. «rimuovi» resta sempre ammesso (dati dell'impresa), con la stessa risposta per una gara nascosta e una che non c'è", rimuoviNascosta === rimuoviInesistente && rimuoviNascosta.includes('"ok":true'), { rimuoviNascosta, rimuoviInesistente });
  mondo = nuovoMondo(true);
  const nuovaVisibile = await salvataggio("salva", G.ted2);
  const copiaVisibile = await salvataggio("monitora", G.copia);
  const salvataTed2 = mondo.sessione.tabelle.omnia_ai_radar_salvate.find((r) => r.procedura_id === G.ted2);
  mondo = nuovoMondo(false);
  const pvlVisibile = await salvataggio("monitora", G.pvl);
  controlla(
    "MN23. nessun rifiuto di troppo: gara visibile salvata, copia collegata di una gara visibile monitorata, gara solo PVL monitorata quando la PVL è visibile",
    nuovaVisibile.ok === true && !!salvataTed2 && copiaVisibile.ok === true && pvlVisibile.ok === true,
    { nuovaVisibile, copiaVisibile, pvlVisibile },
  );
  const aggiungi = async (cig: string) => {
    try {
      const r = await azioniRadar.aggiungiGaraAMano(undefined, modulo({ cig, url: "", oggetto: "", ente: "", scadenzaGiorno: "", scadenzaOra: "", importo: "" }));
      return { redirect: null as string | null, risposta: r };
    } catch (e) {
      const digest = String((e as { digest?: unknown }).digest ?? "");
      if (digest.startsWith("NEXT_REDIRECT")) return { redirect: digest.split(";")[2] ?? "", risposta: null };
      return { redirect: null, risposta: { errore: e instanceof Error ? e.message : String(e) } };
    }
  };
  mondo = nuovoMondo(true);
  const aggiuntePrima = mondo.sessione.tabelle.omnia_ai_radar_gare_aggiunte.length;
  const conCigNascosto = await aggiungi(CIG.pvl);
  const nuovaAggiunta = mondo.sessione.tabelle.omnia_ai_radar_gare_aggiunte.find((a) => a.cig === CIG.pvl);
  const salvataNascosta = mondo.sessione.tabelle.omnia_ai_radar_salvate.filter((r) => r.procedura_id === G.pvl).length;
  controlla(
    "MN24. «aggiungi a mano» con il CIG di una gara con sole fonti nascoste: il CIG vale come non ancora pubblicato (nasce un'aggiunta a mano, salvata), mai la scheda della gara nascosta",
    !!nuovaAggiunta &&
      mondo.sessione.tabelle.omnia_ai_radar_gare_aggiunte.length === aggiuntePrima + 1 &&
      conCigNascosto.redirect === `${hrefA(String(nuovaAggiunta.id))}?da=aggiungi` &&
      salvataNascosta === 1 &&
      mondo.sessione.tabelle.omnia_ai_radar_salvate.some((r) => r.aggiunta_id === nuovaAggiunta.id),
    { conCigNascosto, salvataNascosta },
  );
  mondo = nuovoMondo(true);
  const conCigVisibile = await aggiungi(CIG.ted);
  controlla(
    "MN25. «aggiungi a mano» con il CIG di una gara visibile: come prima, la gara pubblica salvata e monitorata e la sua scheda",
    conCigVisibile.redirect === `${hrefG(G.ted)}?da=aggiungi` && mondo.sessione.tabelle.omnia_ai_radar_salvate.some((r) => r.procedura_id === G.ted && r.monitorata === true) && !mondo.sessione.tabelle.omnia_ai_radar_gare_aggiunte.some((a) => a.cig === CIG.ted),
    conCigVisibile,
  );

  // ═════ I. scheda: con nessuna fonte riconosciuta, mai «TED» (sintesi, riquadro «Fonte», nota delle fonti) ═════
  const scheda = async (gid: string) => {
    let albero: unknown;
    try {
      albero = await PaginaScheda({ params: Promise.resolve({ id: gid }), searchParams: Promise.resolve({}) });
    } catch (e) {
      // la scheda che non si apre per il cliente («non trovata»)
      if (String((e as { digest?: unknown }).digest ?? "").startsWith("NEXT_HTTP_ERROR_FALLBACK;404")) return null;
      throw e;
    }
    const els = elementi(albero);
    const riquadroFonte = els.find((e) => e.props.etichetta === "Fonte" || e.props.etichetta === "Fonti")?.props.valore;
    const nota = els.find((e) => Array.isArray(e.props.children) && e.props.children[0] === "Fonti: ")?.props.children as unknown[] | undefined;
    // il riquadro della classificazione si disegna davvero (componente senza stato): il suo testo a schermo entra nei testi
    const classificazione = els.filter((e) => e.type === ClassificazioneGara).flatMap((e) => testi((ClassificazioneGara as (p: unknown) => unknown)(e.props)));
    return { testi: [...testi(albero), ...classificazione], riquadroFonte, notaFonti: nota?.[1] };
  };
  mondo = nuovoMondo(false);
  const s1 = (await scheda(G.chiaveIgnota)) ?? { testi: [], riquadroFonte: undefined, notaFonti: undefined };
  controlla(
    "MN26. scheda di una gara senza fonti riconosciute: mai «TED» né il numero di un avviso non riconosciuto; «fonte non riconosciuta» nella sintesi, nel riquadro e nella nota",
    !s1.testi.some((t) => /Fonte: TED/.test(t) || t.includes("SINT11VERSIONE")) &&
      s1.testi.some((t) => t.startsWith("Fonte: fonte non riconosciuta, avviso pubblicato il")) &&
      typeof s1.riquadroFonte === "string" && /fonte non riconosciuta/i.test(s1.riquadroFonte) &&
      typeof s1.notaFonti === "string" && /non riconosciuta/.test(s1.notaFonti),
    { sintesi: s1.testi.filter((t) => t.startsWith("Fonte")), riquadro: s1.riquadroFonte, nota: s1.notaFonti },
  );
  const s2 = (await scheda(G.ted)) ?? { testi: [], riquadroFonte: undefined, notaFonti: undefined };
  controlla(
    "MN27. scheda di una gara TED: sintesi, riquadro e nota come prima (nessun cambio per le fonti riconosciute)",
    s2.testi.some((t) => t.startsWith("Fonte: TED, avviso")) && typeof s2.notaFonti === "string" && s2.notaFonti.startsWith("TED, Ufficio delle pubblicazioni"),
    { sintesi: s2.testi.filter((t) => t.startsWith("Fonte")), nota: s2.notaFonti },
  );

  // ═════ J. direttiva 48A (23/11): PVL VISIBILE ai clienti come le altre fonti. Le gare solo PVL in «Cerca», «Per te» e «Monitorate» (MN8) ═════
  const righeDi = (albero: unknown) => new Map(elementi(albero).filter((e) => e.type === RigaGara).map((e) => [(e.props.d as DatiRiga).href, e.props.d as DatiRiga]));
  const cerca = async () => righeDi(await PaginaCerca({ searchParams: Promise.resolve({}) }));
  const perTe = async () => {
    const prima = { RADAR_PER_TE: process.env.RADAR_PER_TE, RADAR_CLASSIFICAZIONI: process.env.RADAR_CLASSIFICAZIONI, NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL };
    const { PROGETTO_STAGING: staging } = richiedi(src("lib/radar/ambiente.ts")) as { PROGETTO_STAGING: string };
    // «Per te» esiste solo con l'interruttore e le classificazioni accesi, solo sullo staging (finto: nessuna rete)
    Object.assign(process.env, { RADAR_PER_TE: "attivo", RADAR_CLASSIFICAZIONI: "attive", NEXT_PUBLIC_SUPABASE_URL: `https://${staging}.supabase.co` });
    try {
      return righeDi(await PaginaPerTe({ searchParams: Promise.resolve({}) }));
    } finally {
      for (const [k, v] of Object.entries(prima)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };
  const etichette = (m: Map<string, DatiRiga>) => [...m.values()].map((r) => [r.href.slice(-3), r.fonte]);
  const fuori = [G.copia, G.copiaDiPvl, G.sardegna, G.ignota];
  mondo = nuovoMondo(false);
  const cB = await cerca();
  controlla(
    "MN28. PVL visibile, «Cerca»: le gare solo PVL compaiono con le loro fonti («PVL ANAC»; con la copia TED collegata «TED e PVL ANAC»); copie collegate, SardegnaCAT e fonti sconosciute fuori",
    cB.get(hrefG(G.pvlPura))?.fonte === "PVL ANAC" && cB.get(hrefG(G.pvl))?.fonte === "TED e PVL ANAC" && cB.get(hrefG(G.mista))?.fonte === "TED e PVL ANAC" && cB.get(hrefG(G.ted))?.fonte === "TED" && !fuori.some((g) => cB.has(hrefG(g))),
    etichette(cB),
  );
  mondo = nuovoMondo(false, { classificazioni: true });
  const pB = await perTe();
  controlla(
    "MN29. PVL visibile, «Per te» (classificazioni e profilo dell'impresa): le gare solo PVL compaiono con «PVL ANAC», come le altre fonti; copie, SardegnaCAT e fonti sconosciute fuori",
    pB.get(hrefG(G.pvlPura))?.fonte === "PVL ANAC" && pB.get(hrefG(G.pvl))?.fonte === "TED e PVL ANAC" && pB.get(hrefG(G.ted))?.fonte === "TED" && !fuori.some((g) => pB.has(hrefG(g))),
    etichette(pB),
  );
  mondo = nuovoMondo(true);
  const cA = await cerca();
  mondo = nuovoMondo(true, { classificazioni: true });
  const pA = await perTe();
  controlla(
    "MN30. meccanismo delle fonti nascoste (oggi solo SardegnaCAT; qui la PVL nascosta per prova): in «Cerca» e «Per te» niente gare con sole fonti nascoste, le miste con le sole fonti visibili",
    ![G.pvl, G.pvlPura].some((g) => cA.has(hrefG(g)) || pA.has(hrefG(g))) && cA.get(hrefG(G.mista))?.fonte === "TED" && pA.get(hrefG(G.mista))?.fonte === "TED" && cA.has(hrefG(G.ted)) && pA.has(hrefG(G.ted)),
    { cerca: etichette(cA), perTe: etichette(pA) },
  );

  // ═════ L. PVL visibile: la scheda si apre; gare unite TED+PVL con fonti e provenienze corrette ═════
  const ATTRIB = calcoliFonti.ATTRIBUZIONE_FONTE as Record<string, string>;
  const fontiRiquadro = (v: unknown) => elementi(v).filter((e) => e.type === "li").map((e) => String((e as unknown as { key: unknown }).key));
  const nota = (s: { notaFonti?: unknown } | null) => String(s?.notaFonti ?? "").split("; ").sort();
  mondo = nuovoMondo(false);
  const sP = await scheda(G.pvlPura);
  controlla(
    "MN31. PVL visibile, scheda di una gara solo PVL: si apre; sintesi «Fonte: PVL di ANAC», l'avviso PVL nel riquadro, l'attribuzione di ANAC",
    !!sP && sP.testi.some((t) => t.startsWith("Fonte: PVL di ANAC, avviso pubblicato il")) && JSON.stringify(fontiRiquadro(sP.riquadroFonte)) === JSON.stringify(["pvl"]) && sP.notaFonti === ATTRIB.pvl,
    sP && { sintesi: sP.testi.filter((t) => t.startsWith("Font")), riquadro: fontiRiquadro(sP.riquadroFonte), nota: sP.notaFonti },
  );
  const sM = await scheda(G.mista);
  const sU = await scheda(G.pvl);
  controlla(
    "MN32. PVL visibile, gare su TED e PVL (stessa gara con due avvisi, e gara PVL con la copia TED collegata, 0117): «Fonti: TED e PVL ANAC», i due avvisi nel riquadro, le due attribuzioni",
    !!sM && !!sU &&
      [sM, sU].every((s) => s.testi.some((t) => t.startsWith("Fonti: TED e PVL ANAC; primo avviso pubblicato il")) && JSON.stringify(fontiRiquadro(s.riquadroFonte)) === JSON.stringify(["ted", "pvl"])) &&
      JSON.stringify(nota(sM)) === JSON.stringify([ATTRIB.pvl, ATTRIB.ted].sort()) &&
      JSON.stringify(nota(sU)) === JSON.stringify([ATTRIB.pvl, ATTRIB.ted].sort()),
    [sM, sU].map((s) => s && { sintesi: s.testi.filter((t) => t.startsWith("Font")), riquadro: fontiRiquadro(s.riquadroFonte), nota: s.notaFonti }),
  );
  mondo = nuovoMondo(true);
  const sMA = await scheda(G.mista);
  const sPA = await scheda(G.pvlPura);
  controlla(
    "MN33. meccanismo (PVL nascosta per prova): la gara su TED e PVL mostra solo l'avviso, la sintesi e l'attribuzione TED; la gara solo PVL non si apre",
    sPA === null && !!sMA && JSON.stringify(fontiRiquadro(sMA.riquadroFonte)) === JSON.stringify(["ted"]) && sMA.testi.some((t) => t.startsWith("Fonte: TED, avviso")) && sMA.notaFonti === ATTRIB.ted,
    { sPA: sPA === null, sMA: sMA && { sintesi: sMA.testi.filter((t) => t.startsWith("Font")), riquadro: fontiRiquadro(sMA.riquadroFonte), nota: sMA.notaFonti } },
  );

  // ═════ M. «Notifiche»: la pagina non dipende dalla visibilità delle fonti (né lei né ciò che importa) ═════
  const chiusura = new Set<string>();
  const daVisitare = [src("app/site-omnia-ai/dashboard/omnia-ai/opportunita/notifiche/page.tsx")];
  const risolvi = (da: string, spec: string): string | null => {
    const base = spec.startsWith("@/") ? path.join(RADICE, "src", spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(da), spec) : null;
    if (!base) return null;
    for (const est of ["", ".ts", ".tsx", path.join("/index.ts"), path.join("/index.tsx")]) {
      const f = base + est;
      if (fs.existsSync(f) && fs.statSync(f).isFile()) return f;
    }
    return null;
  };
  while (daVisitare.length) {
    const f = daVisitare.pop() as string;
    if (chiusura.has(f)) continue;
    chiusura.add(f);
    for (const m of fs.readFileSync(f, "utf8").matchAll(/(?:^|\n)\s*(?:import|export)\s+(?!type\s)[^;]*?\sfrom\s+"([^"]+)"/g)) {
      const g = risolvi(f, m[1]);
      if (g) daVisitare.push(g);
    }
  }
  const VISIBILITA = /fontiNascosteAiClienti|fontiVisibiliDa|garaVisibileAiClienti|FONTI_NASCOSTE_PREDEFINITE|fontiNascosteDa|nascosta_ai_clienti/;
  const dipendenti = [...chiusura].filter((f) => VISIBILITA.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(RADICE, f));
  controlla(
    `MN34. «Notifiche»: la pagina e i ${chiusura.size} file che importa non leggono la visibilità delle fonti, quindi la PVL visibile o nascosta non la cambia`,
    chiusura.size > 5 && [...chiusura].some((f) => f.endsWith(path.join("radar", "notifiche-preferenze.ts"))) && dipendenti.length === 0,
    { file: chiusura.size, dipendenti },
  );

  // ═════ N. tipi di opportunità (analisi 49, C4 C5 C11; decisione dell'utente: un'indagine di mercato non si confonde con una gara aperta) ═════
  const tipiDi = (m: Map<string, DatiRiga>) => Object.fromEntries(TIPI.map((t) => [t.k, m.get(hrefG(t.id))?.tipo ?? null]));
  const tipiAttesi = Object.fromEntries(TIPI.map((t) => [t.k, t.atteso]));
  mondo = mondoTipi();
  const cT = await cerca();
  controlla("MT1. «Cerca»: il tipo di ogni gara nella riga, ricavato dal tipo dell'avviso quando la colonna è vuota (C4), preinformazioni comprese (C11)", JSON.stringify(tipiDi(cT)) === JSON.stringify(tipiAttesi), tipiDi(cT));
  const pT = await perTe();
  controlla("MT2. «Per te»: lo stesso tipo nella riga", JSON.stringify(tipiDi(pT)) === JSON.stringify(tipiAttesi), tipiDi(pT));
  const mT = (await monitorate()).perHref;
  controlla("MT3. «Monitorate»: lo stesso tipo nella riga", JSON.stringify(tipiDi(mT)) === JSON.stringify(tipiAttesi), tipiDi(mT));
  // la riga disegnata (componente vero): etichetta del tipo, e per candidature e iscrizioni la scadenza detta come tale, mai come un'offerta
  const disegna = (r: DatiRiga | undefined) => (r ? testi((RigaGara as (p: unknown) => unknown)({ d: r, adesso: new Date() })) : []);
  const righeDisegnate = Object.fromEntries(TIPI.map((t) => [t.k, disegna(cT.get(hrefG(t.id)))]));
  const errate = TIPI.filter((t) => {
    const x = righeDisegnate[t.k];
    const etichetta = t.atteso ? ETICHETTE_ATTESE[t.atteso] : null;
    const conEtichetta = etichetta ? x.includes(etichetta) : !Object.values(ETICHETTE_ATTESE).some((e) => x.includes(e));
    const candidature = x.some((s) => s.startsWith("Candidature entro"));
    const iscrizioni = x.some((s) => s.startsWith("Iscrizioni entro"));
    return !conEtichetta || candidature !== (t.categoria === "candidature") || iscrizioni !== (t.categoria === "iscrizioni");
  }).map((t) => [t.k, righeDisegnate[t.k].filter((s) => /entro|Bando|Avviso|Iscrizione|Indagine|Manifestazione/.test(s))]);
  controlla(
    "MT4. la riga dice il tipo; indagini, manifestazioni e preinformazioni «Candidature entro», iscrizioni «Iscrizioni entro»: un'indagine non sembra mai una gara aperta",
    errate.length === 0 && !righeDisegnate.indagine.includes("Bando di gara"),
    errate,
  );
  const cercaTipo = async (tipo: string | string[]) => [...(righeDi(await PaginaCerca({ searchParams: Promise.resolve({ tipo }) })).keys())].sort();
  const diCategoria = (...c: string[]) => TIPI.filter((t) => t.categoria && c.includes(t.categoria)).map((t) => hrefG(t.id)).sort();
  const filtri = {
    bandi: await cercaTipo("bandi"),
    candidature: await cercaTipo("candidature"),
    iscrizioni: await cercaTipo("iscrizioni"),
    bandiEIscrizioni: await cercaTipo(["bandi", "iscrizioni"]),
    sconosciuto: await cercaTipo("altro"),
  };
  controlla(
    "MT5. «Cerca», filtro per tipo nel database: bandi, candidature (manifestazioni, indagini, preinformazioni), iscrizioni; più tipi insieme; un valore sconosciuto si ignora",
    JSON.stringify(filtri.bandi) === JSON.stringify(diCategoria("bandi")) &&
      JSON.stringify(filtri.candidature) === JSON.stringify(diCategoria("candidature")) &&
      JSON.stringify(filtri.iscrizioni) === JSON.stringify(diCategoria("iscrizioni")) &&
      JSON.stringify(filtri.bandiEIscrizioni) === JSON.stringify(diCategoria("bandi", "iscrizioni")) &&
      filtri.sconosciuto.length === TIPI.length,
    Object.fromEntries(Object.entries(filtri).map(([k, v]) => [k, v.map((h) => TIPI.find((t) => hrefG(t.id) === h)?.k)])),
  );
  // il filtro (condizione PostgREST) e l'etichetta (calcolo in memoria) devono dire la stessa cosa su ogni combinazione di colonna e avviso
  const tipoCalcoli = ((): Record<string, unknown> => {
    try {
      return richiedi(src("lib/radar/tipo-gara-calcoli.ts")) as Record<string, unknown>;
    } catch {
      return {};
    }
  })();
  const { opportunitaDaTipoAvviso } = richiedi(src("lib/radar/opportunita-calcoli.ts")) as { opportunitaDaTipoAvviso: (a: string | null) => { tipo: string } | null };
  const AVVISI = [null, "", "cn-standard", "cn-social", "cn-desg", "pin-cfc-standard", "pin-cfc-social", "pin-only", "qu-sy", "can-standard", "P7_1_3", "P7_3", "A1_29", "P10_1", "P1_15_1", ...[1, 2].flatMap((p) => Array.from({ length: 12 }, (_, i) => `P${p}_${10 + i}`))];
  const COLONNE = [null, "bando", "manifestazione_interesse", "indagine_mercato", "sistema_qualificazione"];
  const disaccordi: unknown[] = [];
  const tipoDellaGara = tipoCalcoli.tipoDellaGara as ((g: { tipo_opportunita: string | null; tipo_avviso: string | null }) => string | null) | undefined;
  const condizioneTipi = tipoCalcoli.condizioneTipi as ((c: readonly string[]) => string) | undefined;
  const categoriaDelTipo = tipoCalcoli.CATEGORIA_DEL_TIPO as Record<string, string> | undefined;
  if (tipoDellaGara && condizioneTipi && categoriaDelTipo)
    for (const colonna of COLONNE)
      for (const avviso of AVVISI) {
        const g = { tipo_opportunita: colonna, tipo_avviso: avviso };
        const tipo = tipoDellaGara(g);
        // senza colonna, il tipo è quello di opportunitaDaTipoAvviso (bando diventa preinformazione per pin-cfc e P1/P2_10-14)
        const daAvviso = colonna === null ? (opportunitaDaTipoAvviso(avviso)?.tipo ?? null) : colonna;
        if ((tipo === "preinformazione" ? "bando" : tipo) !== daAvviso) disaccordi.push({ colonna, avviso, tipo, daAvviso });
        for (const c of ["bandi", "candidature", "iscrizioni"]) {
          const nelFiltro = dividi(condizioneTipi([c])).map(termineOr).some((p) => p(g));
          if (nelFiltro !== (tipo !== null && categoriaDelTipo[tipo] === c)) disaccordi.push({ colonna, avviso, c, nelFiltro, tipo });
        }
      }
  controlla(
    "MT6. filtro nel database ed etichetta concordano su ogni combinazione (5 colonne × 39 tipi di avviso × 3 gruppi); il tipo ricavato è quello di opportunitaDaTipoAvviso",
    !!tipoDellaGara && !!condizioneTipi && !!categoriaDelTipo && disaccordi.length === 0,
    disaccordi.slice(0, 6),
  );
  const albCerca = await PaginaCerca({ searchParams: Promise.resolve({ tipo: "candidature" }) });
  const albSenza = await PaginaCerca({ searchParams: Promise.resolve({}) });
  const campiTipo = elementi(albCerca).filter((e) => e.type === "input" && e.props.name === "tipo").map((e) => String(e.props.value));
  const spuntata = elementi(albCerca).find((e) => e.type === "input" && e.props.name === "tipo" && e.props.value === "candidature")?.props.defaultChecked === true;
  const conta = (alb: unknown) => testi(alb).filter((t) => /^Candidature/.test(t)).length;
  controlla(
    "MT7. «Cerca»: nel pannello dei filtri le tre caselle del tipo; con un tipo scelto la casella è spuntata e il filtro attivo compare tra quelli da togliere",
    JSON.stringify(campiTipo) === JSON.stringify(["bandi", "candidature", "iscrizioni"]) && spuntata && conta(albCerca) > conta(albSenza),
    { campiTipo, spuntata, con: conta(albCerca), senza: conta(albSenza) },
  );
  const sQ = await scheda(TIPI.find((t) => t.k === "qusy")!.id);
  const sPin = await scheda(TIPI.find((t) => t.k === "pin")!.id);
  const sP112 = await scheda(TIPI.find((t) => t.k === "p112")!.id);
  const sCn = await scheda(TIPI.find((t) => t.k === "cn")!.id);
  const comeSiPartecipa = (s: typeof sQ) => (s?.testi ?? []).some((t) => /candidatura o (la )?domanda di partecipazione/.test(t));
  controlla(
    "MT8. scheda: tipo ricavato quando la colonna è vuota (iscrizione); «Avviso di preinformazione» con la riga sulla candidatura o domanda di partecipazione (TED e PVL); un bando come prima",
    !!sQ && sQ.testi.some((t) => t.includes(ETICHETTE_ATTESE.sistema_qualificazione)) &&
      [sPin, sP112].every((s) => !!s && s.testi.some((t) => t.includes("Avviso di preinformazione")) && comeSiPartecipa(s)) &&
      !!sCn && !comeSiPartecipa(sCn) && !sCn.testi.some((t) => t.includes("Avviso di preinformazione")),
    [sQ, sPin, sP112, sCn].map((s) => (s?.testi ?? []).filter((t) => /Iscrizione|preinformazione|candidatura|Bando di gara/.test(t))),
  );
  const rc = richiedi(src("lib/radar/ricerca-calcoli.ts")) as { filtriDaParametri: (p: Record<string, unknown>) => Record<string, unknown>; parametriDaFiltri: (f: unknown) => string; filtriAttivi: (f: unknown) => number };
  const fT = rc.filtriDaParametri({ tipo: ["candidature", "bandi", "altro", "bandi"] });
  controlla(
    "MT9. parametri: i tipi validi letti dall'indirizzo, senza doppioni né valori sconosciuti; l'indirizzo li riproduce; contano tra i filtri attivi",
    JSON.stringify(fT.tipi) === JSON.stringify(["candidature", "bandi"]) && /tipo=candidature/.test(rc.parametriDaFiltri(fT)) && /tipo=bandi/.test(rc.parametriDaFiltri(fT)) && rc.filtriAttivi(fT) === rc.filtriAttivi(rc.filtriDaParametri({})) + 2,
    { tipi: fT.tipi },
  );

  // ═════ O. decisione 48E dell'utente: SardegnaCAT visibile ai clienti SENZA aspettare il parere legale (console, azione vera) ═════
  const mondoConsole = (sardegnaNascosta: boolean) => {
    const admin = new DbProva({
      radar_fonti_stato: statoFonti(false).map((r) => (r.fonte === "sardegnacat" ? { ...r, nascosta_ai_clienti: sardegnaNascosta } : r)),
      radar_console_registro: [],
    });
    return { admin, sessione: new DbProva({}) };
  };
  const visibilita = async (campi: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(campi)) fd.set(k, v);
    return azioniConsole.impostaVisibilitaFonte(undefined, fd);
  };
  const statoDi = (fonte: string) => mondo.admin.tabelle.radar_fonti_stato.find((r) => r.fonte === fonte)?.nascosta_ai_clienti;
  const registro = () => mondo.admin.tabelle.radar_console_registro.map((r) => [r.oggetto, r.valore_precedente, r.valore_nuovo, r.autore_id === AMMINISTRATORE.userId, r.autore_email === AMMINISTRATORE.email]);
  mondo = mondoConsole(true);
  tagSvuotati.length = 0;
  const mostra = await visibilita({ fonte: "sardegnacat", azione: "mostra" });
  controlla(
    "MV1. console: «Mostra ai clienti» per SardegnaCAT SENZA la casella del parere legale è accettato; riga visibile, registro 0112 con chi e prima/dopo, cache delle fonti svuotata",
    mostra.ok === true && statoDi("sardegnacat") === false && JSON.stringify(registro()) === JSON.stringify([["fonte:sardegnacat:nascosta_ai_clienti", "true", "false", true, true]]) && tagSvuotati.includes(TAG_FONTI_RADAR),
    { mostra, stato: statoDi("sardegnacat"), registro: registro(), tagSvuotati },
  );
  // da SardegnaCAT visibile (indipendente da MV1)
  mondo = mondoConsole(false);
  tagSvuotati.length = 0;
  const nascondi = await visibilita({ fonte: "sardegnacat", azione: "nascondi" });
  controlla(
    "MV2. console: «Nascondi» sempre ammesso, senza conferme; registro e cache come per «mostra»",
    nascondi.ok === true && statoDi("sardegnacat") === true && JSON.stringify(registro()) === JSON.stringify([["fonte:sardegnacat:nascosta_ai_clienti", "false", "true", true, true]]) && tagSvuotati.includes(TAG_FONTI_RADAR),
    { nascondi, registro: registro() },
  );
  mondo = mondoConsole(true);
  const conVecchiaCasella = await visibilita({ fonte: "sardegnacat", azione: "mostra", parere: "si" });
  const sintelNascondi = await visibilita({ fonte: "sintel", azione: "nascondi" });
  const sintelMostra = await visibilita({ fonte: "sintel", azione: "mostra" });
  controlla(
    "MV3. un modulo vecchio con la casella resta accettato; Sintel come prima (nascondi e mostra, ognuno nel registro)",
    conVecchiaCasella.ok === true && statoDi("sardegnacat") === false && sintelNascondi.ok === true && sintelMostra.ok === true && statoDi("sintel") === false && registro().length === 3,
    { conVecchiaCasella, sintelNascondi, sintelMostra, registro: registro() },
  );
  mondo = mondoConsole(true);
  const rifiutate = [
    await visibilita({ fonte: "ted", azione: "nascondi" }),
    await visibilita({ fonte: "pvl", azione: "nascondi" }),
    await visibilita({ fonte: "sardegnacat", azione: "altro" }),
  ];
  mondo.admin.guasti.add("radar_console_registro");
  const senzaRegistro = await visibilita({ fonte: "sardegnacat", azione: "mostra" });
  mondo.admin.guasti.delete("radar_console_registro");
  adminAutenticato = false;
  const nonAdmin = await visibilita({ fonte: "sardegnacat", azione: "mostra" });
  adminAutenticato = true;
  controlla(
    "MV4. restano i rifiuti: TED e PVL non si nascondono dalla console, azione sconosciuta, registro assente (nessuna modifica senza registro), non amministratori",
    rifiutate.every((r) => !!r.errore) && !!senzaRegistro.errore && nonAdmin.errore === "Non autorizzato." && statoDi("sardegnacat") === true && registro().length === 0 && !mondo.admin.richieste.some((r) => r.metodo === "update"),
    { rifiutate, senzaRegistro, nonAdmin },
  );
  const testoAzioni = fs.readFileSync(src("app/site-console/azioni/tender-intelligence.ts"), "utf8");
  const testoVista = fs.readFileSync(src("app/site-console/_componenti/tender-intelligence-vista.tsx"), "utf8");
  const testoCerca = fs.readFileSync(src("app/site-omnia-ai/dashboard/omnia-ai/opportunita/cerca/page.tsx"), "utf8");
  const testoRicerca = fs.readFileSync(src("lib/radar/ricerca.ts"), "utf8");
  controlla(
    "MV5. nessun riferimento al parere legale nell'azione, nella vista della console (casella e nota), nel commento di «Cerca» e della ricerca",
    ![testoAzioni, testoVista, testoCerca, testoRicerca].some((t) => /parere/i.test(t)) && !/name="parere"/.test(testoVista),
    { azioni: /parere/i.test(testoAzioni), vista: /parere/i.test(testoVista), cerca: /parere/i.test(testoCerca), ricerca: /parere/i.test(testoRicerca) },
  );

  // ═════ P. S4 (49C §4.2): gare «da_verificare». Per i clienti mai «non pertinente», mai in «Per te»; in console l'elenco e «Decidi» ═════
  const modulo4 = (campi: Record<string, string | string[]>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(campi)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
    return fd;
  };
  const conClassificazioni = async <T,>(f: () => Promise<T>): Promise<T> => {
    const prima = { RADAR_CLASSIFICAZIONI: process.env.RADAR_CLASSIFICAZIONI, NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL };
    const { PROGETTO_STAGING: staging } = richiedi(src("lib/radar/ambiente.ts")) as { PROGETTO_STAGING: string };
    Object.assign(process.env, { RADAR_CLASSIFICAZIONI: "attive", NEXT_PUBLIC_SUPABASE_URL: `https://${staging}.supabase.co` });
    try {
      return await f();
    } finally {
      for (const [k, v] of Object.entries(prima)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };
  const V = { stabulari: id(401), biblioteca: id(402), classificata: id(403), senzaCaso: id(404), inAttesa: id(405), senzaCandidato: id(406) };
  let nRiga = 0;
  const rigaCl = (pid: string, settore: string, rilevanza: string, regole: string[], motivi: string[], extra: Riga = {}): Riga => ({
    id: id(4500 + ++nRiga),
    procedura_id: pid,
    settore,
    rilevanza,
    sottocategorie: [],
    regole,
    motivi,
    da: "cpv",
    cpv: [],
    versione_regole: "2026-11-23a",
    origine: "importazione",
    fonti: ["ted"],
    per_fonte: { dati_uniti: rilevanza },
    ambigua: false,
    nota: null,
    autore: null,
    attiva: true,
    valida_dal: "2026-11-23T08:00:00Z",
    sostituita_il: null,
    sostituita_da: null,
    ...extra,
  });
  const { MOTIVI_DA_VERIFICARE } = richiedi(src("lib/radar/settori.ts")) as { MOTIVI_DA_VERIFICARE: Record<string, string> };
  const MOTIVO_STABULARI = MOTIVI_DA_VERIFICARE.stabulari;
  const statoCl = (pid: string, stato: string): Riga => ({ procedura_id: pid, stato, versione_regole: stato === "in_attesa" ? null : "2026-11-23a", classificata_il: stato === "classificata" ? "2026-11-23T08:00:00Z" : null, tentativi: 1, tentativo_il: "2026-11-23T08:00:00Z", errore: null, aggiornata_il: "2026-11-23T08:00:00Z" });
  const mondoS4 = () => {
    nRiga = 0;
    // le gare da verificare non hanno settori nella colonna (nessuna A o B); la classificata ha «pulizia» (serve a «Per te»)
    const g = (pid: string, titolo: string) => ({
      ...gara("ted", `ted:SINT-V-${pid.slice(-3)}`, ["ted"]),
      id: pid,
      oggetto: `[SINTETICO] ${titolo}`,
      sa_denominazione: "[SINTETICO] Università di prova",
      url_avviso: `https://esempio.invalid/avviso-${pid.slice(-3)}`,
      ...(pid === V.classificata ? { settori: ["pulizia"], metodo_settore: "cpv" } : { settori: [], metodo_settore: null }),
    });
    const admin = new DbProva({
      radar_fonti_stato: statoFonti(false),
      radar_procedure: [g(V.stabulari, "Servizi per lo stabulario"), g(V.biblioteca, "Servizi integrati di biblioteca"), g(V.classificata, "Pulizia degli uffici"), g(V.senzaCaso, "Concessione del casone"), g(V.inAttesa, "Gara in attesa"), g(V.senzaCandidato, "Gara da verificare senza candidato")],
      radar_procedure_fonti: Object.values(V).map((pid) => ({ procedura_id: pid, fonte: "ted", id_fonte: `SINT-V-${pid.slice(-3)}`, url: null, pubblicato_il: "2026-11-10", tipo_avviso: "cn-standard", rilevato_il: "2026-11-10T06:00:00Z", aggiornato_il: null })),
      radar_aggiornamenti: [],
      radar_lotti: [],
      radar_console_registro: [],
      omnia_ai_radar_utilizzi: [],
      radar_classificazioni_stato: [statoCl(V.stabulari, "da_verificare"), statoCl(V.biblioteca, "da_verificare"), statoCl(V.classificata, "classificata"), statoCl(V.senzaCaso, "da_verificare"), statoCl(V.inAttesa, "in_attesa"), statoCl(V.senzaCandidato, "da_verificare")],
      radar_classificazioni: [
        // formato di B2 (classificazione-unita.ts): prima la regola «da_verificare» col motivo S4, poi la regola e il motivo di oggi
        rigaCl(V.stabulari, "pulizia", "C", ["da_verificare", "cura_degli_animali"], [MOTIVO_STABULARI, "Cura degli animali (dato sintetico)"]),
        rigaCl(V.stabulari, "ristorazione", "C", ["cpv_di_altro_settore"], ["CPV di un altro settore (dato sintetico)"]),
        rigaCl(V.biblioteca, "vigilanza_portierato", "C", ["da_verificare"], [MOTIVI_DA_VERIFICARE.biblioteca]),
        rigaCl(V.classificata, "pulizia", "A", ["cpv_pulizia"], ["CPV di pulizia (dato sintetico)"]),
        rigaCl(V.senzaCaso, "ristorazione", "C", ["da_verificare", "concessione_di_immobili"], ["Concessione di un immobile con un CPV di ristorazione (dato sintetico)", "Concessione di immobili (dato sintetico)"]),
        rigaCl(V.senzaCandidato, "pulizia", "C", ["cpv_di_altro_settore"], ["CPV di un altro settore (dato sintetico)"]),
      ],
    });
    const sessione = new DbProva({
      omnia_ai_radar_salvate: [V.stabulari, V.classificata].map((pid, i) => ({ id: id(4900 + i), user_id: IMPRESA, procedura_id: pid, aggiunta_id: null, monitorata: true, ultimo_aggiornamento_visto_il: null, creata_il: "2026-11-20T06:00:00Z", salvata_da: IMPRESA })),
      omnia_ai_radar_gare_aggiunte: [],
      omnia_ai_radar_profili: [{ user_id: IMPRESA, posizione: 1, settori: ["pulizia"], sottocategorie: null, regioni: [], tipi_procedura: [], importo_min: null, importo_max: null, vedere_correlate: true, aggiornato_il: "2026-11-20T06:00:00Z" }],
    });
    return { admin, sessione };
  };
  const lettura = richiedi(src("lib/radar/classificazioni-lettura.ts")) as { classificazioneDaRiga: (r: unknown) => { stato: string; settori: { settore: string; livello: string }[] }; messaggioStato: (c: unknown) => string | null };
  const ricercaCalcoli = richiedi(src("lib/radar/ricerca-calcoli.ts")) as { etichettaRicerca: (c: unknown, f: unknown) => string | null; etichettaStatoClassificazione: (c: unknown) => string | null; coerenteConFiltroSettori: (c: unknown, f: unknown) => boolean; settoriDellaRiga: (c: unknown) => unknown[] };
  const letta = lettura.classificazioneDaRiga({ classificazione_stato: { stato: "da_verificare", versione_regole: "2026-11-23a" }, classificazioni: [{ settore: "pulizia", rilevanza: "C", sottocategorie: [], attiva: true, regole: ["da_verificare_stabulari"], motivi: [MOTIVO_STABULARI] }, { settore: "ristorazione", rilevanza: "C", sottocategorie: [], attiva: true }] });
  const msg = lettura.messaggioStato(letta) ?? "";
  controlla(
    "MS1. lettura: lo stato «da_verificare» resta tale; nessun settore «non pertinente» (le righe C calcolate non si mostrano); il testo è «Classificazione in verifica», non quello di «fallita»",
    letta.stato === "da_verificare" && letta.settori.every((s) => s.livello !== "C") && msg.startsWith("Classificazione in verifica") && !/Classificazione da verificare/.test(msg),
    { letta, msg },
  );
  const candidatoRicerca = { settori: ["pulizia"], rilevanza: { stato: "da_verificare", perSettore: {}, sottocategorie: {} } };
  controlla(
    "MS2. riga dei risultati: distintivo «Classificazione in verifica», mai «Fuori dai settori monitorati» né «Classificazione da verificare»; col filtro di settore non si toglie",
    ricercaCalcoli.etichettaStatoClassificazione(candidatoRicerca) === "Classificazione in verifica" && ricercaCalcoli.etichettaRicerca(candidatoRicerca, { settori: ["pulizia"] }) === null && ricercaCalcoli.coerenteConFiltroSettori(candidatoRicerca, { settori: ["pulizia"] }) === true,
    { stato: ricercaCalcoli.etichettaStatoClassificazione(candidatoRicerca), rilevanza: ricercaCalcoli.etichettaRicerca(candidatoRicerca, { settori: ["pulizia"] }) },
  );
  mondo = mondoS4();
  const cS = await conClassificazioni(() => cerca());
  const rigaS = cS.get(hrefG(V.stabulari));
  const pS = await perTe();
  const sS = await conClassificazioni(() => scheda(V.stabulari));
  controlla(
    "MS3. «Cerca» la trova (senza filtro di settore) con «Classificazione in verifica»; «Per te» no (vuole «classificata»), la gara classificata sì; la scheda non dice «non pertinente»",
    !!rigaS && rigaS.statoClassificazione === "Classificazione in verifica" && rigaS.rilevanza !== "Fuori dai settori monitorati" && !pS.has(hrefG(V.stabulari)) && pS.has(hrefG(V.classificata)) && !!sS && !sS.testi.some((t) => /Non pertinente/.test(t)) && sS.testi.some((t) => t.startsWith("Classificazione in verifica")),
    { rigaS: rigaS && { stato: rigaS.statoClassificazione, rilevanza: rigaS.rilevanza }, perTe: [...pS.keys()].map((h) => h.slice(-3)), scheda: sS?.testi.filter((t) => /pertinente|verifica/i.test(t)) },
  );

  // la console: l'elenco
  const moduloGiv = ((): Record<string, unknown> => {
    try {
      return richiedi(src("lib/console/gare-in-verifica.ts")) as Record<string, unknown>;
    } catch {
      return {};
    }
  })();
  const leggiGareInVerifica = moduloGiv.leggiGareInVerifica as ((admin: unknown) => Promise<{ id: string; titolo: string; ente: string | null; urlAvviso: string | null; settoreCandidato: string | null; caso: string | null; motivo: string | null; righe: { settore: string; rilevanza: string }[]; sottocategorie: { id: string; nome: string }[] }[] | null>) | undefined;
  mondo = mondoS4();
  const elencoS4 = leggiGareInVerifica ? await leggiGareInVerifica(mondo.admin) : null;
  const vocePer = (pid: string) => elencoS4?.find((g) => g.id === pid);
  const vS = vocePer(V.stabulari);
  const { vociCatalogo } = richiedi(src("lib/radar/settori-catalogo.ts")) as { vociCatalogo: (s: string) => { id: string; nome: string }[] };
  controlla(
    "MS4. console, elenco: solo le gare «da_verificare» con oggetto, ente, collegamento all'avviso, settore candidato, caso, motivo, righe di oggi e sottocategorie del catalogo",
    !!elencoS4 &&
      JSON.stringify(elencoS4.map((g) => g.id).sort()) === JSON.stringify([V.stabulari, V.biblioteca, V.senzaCaso, V.senzaCandidato].sort()) &&
      !!vS && vS.titolo === "[SINTETICO] Servizi per lo stabulario" && vS.ente === "[SINTETICO] Università di prova" && vS.urlAvviso === `https://esempio.invalid/avviso-${V.stabulari.slice(-3)}` &&
      vS.settoreCandidato === "pulizia" && vS.caso === "stabulari" && vS.motivo === MOTIVO_STABULARI && vS.righe.length === 2 &&
      JSON.stringify(vS.sottocategorie.map((x) => x.id)) === JSON.stringify(vociCatalogo("pulizia").map((x) => x.id)) &&
      vocePer(V.biblioteca)?.settoreCandidato === "vigilanza_portierato" && vocePer(V.biblioteca)?.caso === "biblioteca" &&
      vocePer(V.senzaCaso)?.settoreCandidato === "ristorazione" && vocePer(V.senzaCaso)?.caso === null &&
      vocePer(V.senzaCandidato)?.settoreCandidato === null &&
      // la pagina della console legge davvero l'elenco e lo passa alla vista
      fs.readFileSync(src("lib/console/tender-intelligence.ts"), "utf8").includes("    leggiGareInVerifica(admin),\n") && /^    gareInVerifica,$/m.test(fs.readFileSync(src("lib/console/tender-intelligence.ts"), "utf8")),
    elencoS4?.map((g) => ({ id: g.id.slice(-3), settore: g.settoreCandidato, caso: g.caso, righe: g.righe.length })) ?? "modulo assente",
  );

  // la console: «Decidi»
  const decidi = (azioniConsole as Record<string, unknown>).decidiGaraInVerifica as AzioneConsole | undefined;
  const SOTTO = vociCatalogo("pulizia")[0]?.id ?? "x";
  const NOTA = "Verificato sui documenti: pulizia dei locali dello stabulario (prova sintetica)";
  const righeClassDi = (pid: string) => mondo.admin.tabelle.radar_classificazioni.filter((r) => r.procedura_id === pid);
  const statoDiGara = (pid: string) => mondo.admin.tabelle.radar_classificazioni_stato.find((r) => r.procedura_id === pid);
  mondo = mondoS4();
  tagSvuotati.length = 0;
  const esitoDecidi = decidi ? await decidi(undefined, modulo4({ gara: V.stabulari, settore: "pulizia", rilevanza: "B", sottocategoria: [SOTTO], nota: NOTA })) : { errore: "azione assente" };
  const vecchia = righeClassDi(V.stabulari).find((r) => r.settore === "pulizia" && r.origine === "importazione");
  const nuova = righeClassDi(V.stabulari).find((r) => r.settore === "pulizia" && r.origine === "amministratore");
  const st = statoDiGara(V.stabulari);
  const regDecidi = mondo.admin.tabelle.radar_console_registro;
  controlla(
    "MS5. «Decidi»: riga dell'amministratore (B, sottocategoria del catalogo, nota, autore) al posto di quella candidata, che resta nello storico; le altre righe intatte; stato di nuovo «classificata»; registro",
    esitoDecidi.ok === true && !!vecchia && vecchia.attiva === false && !!nuova && vecchia.sostituita_da === nuova.id && nuova.attiva === true && nuova.rilevanza === "B" && JSON.stringify(nuova.sottocategorie) === JSON.stringify([SOTTO]) &&
      nuova.nota === NOTA && nuova.autore === `console:${AMMINISTRATORE.email}` && JSON.stringify(nuova.regole) === JSON.stringify(["decisione_amministratore"]) &&
      righeClassDi(V.stabulari).filter((r) => r.attiva).length === 2 && righeClassDi(V.stabulari).some((r) => r.settore === "ristorazione" && r.attiva === true) &&
      st?.stato === "classificata" && typeof st?.classificata_il === "string" && st?.versione_regole === "2026-11-23a" && st?.errore === null &&
      regDecidi.length === 1 && regDecidi[0].oggetto === "gara:decisione_classificazione" && regDecidi[0].autore_id === AMMINISTRATORE.userId && String(regDecidi[0].valore_nuovo).includes("pulizia: B"),
    { esitoDecidi, nuova: nuova && { rilevanza: nuova.rilevanza, sotto: nuova.sottocategorie, autore: nuova.autore }, stato: st?.stato, registro: regDecidi.map((r) => r.oggetto) },
  );
  // la colonna «settori» si riallinea subito (riallineaSettoriGara di B2), DOPO lo stato «classificata», con la sua traccia mai notificabile
  const garaDecisa = mondo.admin.tabelle.radar_procedure.find((r) => r.id === V.stabulari);
  const tracce = mondo.admin.tabelle.radar_aggiornamenti.filter((r) => r.procedura_id === V.stabulari);
  const ordine = mondo.admin.richieste.map((r) => `${r.tabella}|${r.metodo}`);
  const iStato = ordine.indexOf("radar_classificazioni_stato|update");
  const iColonna = ordine.indexOf("radar_procedure|update");
  controlla(
    "MS12. «Decidi» riallinea subito i settori della gara (B per pulizia → «pulizia» nella colonna), con la traccia, SOLO dopo lo stato «classificata»; l'amministratore lo legge, il registro lo dice",
    JSON.stringify(garaDecisa?.settori) === JSON.stringify(["pulizia"]) && garaDecisa?.metodo_settore !== null && tracce.length === 1 && iStato >= 0 && iColonna > iStato &&
      String(esitoDecidi.avviso ?? "").includes("settori della gara aggiornati") && String(regDecidi[0]?.valore_nuovo ?? "").includes("colonna: settori della gara aggiornati"),
    { settori: garaDecisa?.settori, tracce: tracce.length, iStato, iColonna, avviso: esitoDecidi.avviso },
  );
  // e quindi una B decisa entra subito in «Per te» (il profilo vuole anche le correlate)
  const pDopo = await perTe();
  controlla("MS13. dopo «Decidi» B, la gara entra subito in «Per te» (prima no: MS3)", pDopo.has(hrefG(V.stabulari)), [...pDopo.keys()].map((h) => h.slice(-3)));
  // dopo la decisione la scheda è quella di una gara classificata (correlata), non più «in verifica»
  const sDopo = await conClassificazioni(() => scheda(V.stabulari));
  controlla("MS6. dopo «Decidi» la gara è classificata: la scheda mostra il settore deciso e non dice più «in verifica»", !!sDopo && sDopo.testi.some((t) => t === "Correlata") && !sDopo.testi.some((t) => t.startsWith("Classificazione in verifica")), sDopo?.testi.filter((t) => /Correlata|verifica|Pertinente/.test(t)));

  // rifiuti: nessuna scrittura
  const nessunaScrittura = () => !mondo.admin.richieste.some((r) => r.metodo !== "select" && r.tabella !== "radar_console_registro") && mondo.admin.tabelle.radar_console_registro.length === 0;
  const prova = async (campi: Record<string, string | string[]>, prepara?: () => void) => {
    mondo = mondoS4();
    prepara?.();
    const e = decidi ? await decidi(undefined, modulo4(campi)) : { errore: "azione assente" };
    return { e, pulito: nessunaScrittura(), statoInVerifica: statoDiGara(String(campi.gara))?.stato };
  };
  const base = { gara: V.stabulari, settore: "pulizia", rilevanza: "B", sottocategoria: [SOTTO], nota: NOTA };
  const rifiuti = {
    notaVuota: await prova({ ...base, nota: "   " }),
    notaTroppoLunga: await prova({ ...base, nota: "x".repeat(1001) }),
    rilevanzaSbagliata: await prova({ ...base, rilevanza: "D" }),
    sottocategoriaFuoriCatalogo: await prova({ ...base, sottocategoria: ["non_nel_catalogo"] }),
    cConSottocategorie: await prova({ ...base, rilevanza: "C" }),
    altroSettore: await prova({ ...base, settore: "ristorazione", sottocategoria: [] }),
    garaClassificata: await prova({ ...base, gara: V.classificata }),
    garaNonValida: await prova({ ...base, gara: "non-un-id" }),
    senzaRegistro: await prova(base, () => mondo.admin.guasti.add("radar_console_registro")),
  };
  adminAutenticato = false;
  const nonAdminS4 = await prova(base);
  adminAutenticato = true;
  const sbagliati = Object.entries(rifiuti).filter(([, r]) => !r.e.errore || !r.pulito || (r.statoInVerifica !== undefined && r.statoInVerifica !== "da_verificare" && r.statoInVerifica !== "classificata"));
  controlla(
    "MS7. «Decidi» rifiuta senza scrivere: nota vuota, rilevanza non valida, sottocategoria fuori catalogo, C con sottocategorie, settore diverso dal candidato, gara non da verificare, identificativo non valido, registro assente, non amministratori",
    sbagliati.length === 0 && nonAdminS4.e.errore === "Non autorizzato." && nonAdminS4.pulito,
    { sbagliati: sbagliati.map(([k, r]) => [k, r.e, r.pulito]), nonAdminS4 },
  );
  // concorrenza: la riga candidata cambia tra la lettura e la scrittura → nessuna riga nuova, stato invariato
  const concorrente = await prova(base, () => {
    mondo.admin.primaDiScrivere = (tabella, db) => {
      if (tabella !== "radar_classificazioni") return false;
      const r = db.tabelle.radar_classificazioni.find((x) => x.procedura_id === V.stabulari && x.settore === "pulizia" && x.attiva === true);
      if (r) r.attiva = false;
      return true;
    };
  });
  controlla(
    "MS8. «Decidi» con la riga cambiata nel frattempo: errore, nessuna riga nuova, stato ancora «da_verificare», niente registro",
    !!concorrente.e.errore && !righeClassDi(V.stabulari).some((r) => r.origine === "amministratore") && statoDiGara(V.stabulari)?.stato === "da_verificare" && mondo.admin.tabelle.radar_console_registro.length === 0,
    concorrente.e,
  );
  // senza caso o senza candidato
  mondo = mondoS4();
  const eCaso = decidi ? await decidi(undefined, modulo4({ gara: V.senzaCaso, settore: "ristorazione", rilevanza: "C", nota: "Concessione del solo immobile, nessun servizio di ristorazione (prova sintetica)" })) : { errore: "azione assente" };
  const eSenza = decidi ? await decidi(undefined, modulo4({ gara: V.senzaCandidato, settore: "pulizia", rilevanza: "A", sottocategoria: [SOTTO], nota: "Pulizia vera e propria (prova sintetica)" })) : { errore: "azione assente" };
  controlla(
    "MS9. «Decidi» anche per il casone (C: concessione del solo immobile, senza sottocategorie) e, senza riga candidata, per un settore scelto",
    eCaso.ok === true && eSenza.ok === true && statoDiGara(V.senzaCaso)?.stato === "classificata" && statoDiGara(V.senzaCandidato)?.stato === "classificata" && righeClassDi(V.senzaCaso).some((r) => r.origine === "amministratore" && r.rilevanza === "C" && JSON.stringify(r.sottocategorie) === "[]"),
    { eCaso, eSenza },
  );
  // riallineamento non riuscito: la decisione resta salvata, la colonna no, e l'amministratore lo legge chiaramente (errore, non «ok»)
  const salvataMaNonRiallineata = (e: { errore?: string; ok?: boolean }, motivo: RegExp) =>
    !e.ok && /Decisione salvata/.test(e.errore ?? "") && /NON sono stati riallineati/.test(e.errore ?? "") && motivo.test(e.errore ?? "") &&
    righeClassDi(V.stabulari).some((r) => r.origine === "amministratore" && r.attiva === true) && statoDiGara(V.stabulari)?.stato === "classificata";
  const colonnaDi = (pid: string) => mondo.admin.tabelle.radar_procedure.find((r) => r.id === pid)?.settori;
  // a) la traccia non si scrive: B2 rimette la colonna com'era → esito «errore»
  mondo = mondoS4();
  mondo.admin.guasti.add("radar_aggiornamenti");
  const eErrore = decidi ? await decidi(undefined, modulo4(base)) : { errore: "azione assente" };
  const okErrore = salvataMaNonRiallineata(eErrore, /errore:/) && JSON.stringify(colonnaDi(V.stabulari)) === "[]" && /colonna: errore/.test(String(mondo.admin.tabelle.radar_console_registro[0]?.valore_nuovo ?? ""));
  // b) la colonna cambia nel frattempo → «cambiata_nel_frattempo»
  mondo = mondoS4();
  mondo.admin.primaDiScrivere = (tabella, db) => {
    if (tabella !== "radar_procedure") return false;
    const g = db.tabelle.radar_procedure.find((r) => r.id === V.stabulari);
    if (g) g.settori = ["ristorazione"];
    return true;
  };
  const eCambiata = decidi ? await decidi(undefined, modulo4(base)) : { errore: "azione assente" };
  const okCambiata = salvataMaNonRiallineata(eCambiata, /cambiata nel frattempo/) && JSON.stringify(colonnaDi(V.stabulari)) === JSON.stringify(["ristorazione"]);
  // c) la gara sparisce tra lo stato e il riallineamento → «gara_assente»
  mondo = mondoS4();
  mondo.admin.primaDiScrivere = (tabella, db) => {
    if (tabella !== "radar_classificazioni_stato") return false;
    db.tabelle.radar_procedure = db.tabelle.radar_procedure.filter((r) => r.id !== V.stabulari);
    return true;
  };
  const eAssente = decidi ? await decidi(undefined, modulo4(base)) : { errore: "azione assente" };
  const okAssente = salvataMaNonRiallineata(eAssente, /gara non trovata/);
  controlla(
    "MS14. riallineamento non riuscito (traccia non scritta, colonna cambiata nel frattempo, gara sparita): la decisione resta salvata, l'amministratore legge un errore chiaro con il motivo, il registro lo dice",
    okErrore && okCambiata && okAssente,
    { eErrore, eCambiata, eAssente, colonna: colonnaDi(V.stabulari) },
  );
  // d) lo stato non torna «classificata» (cambiato nel frattempo): il riallineamento NON si chiama
  mondo = mondoS4();
  mondo.admin.primaDiScrivere = (tabella, db) => {
    if (tabella !== "radar_classificazioni_stato") return false;
    const s = db.tabelle.radar_classificazioni_stato.find((r) => r.procedura_id === V.stabulari);
    if (s) s.stato = "classificata";
    return true;
  };
  const eStato = decidi ? await decidi(undefined, modulo4(base)) : { errore: "azione assente" };
  controlla(
    "MS15. se lo stato non torna «classificata» il riallineamento non si chiama: nessuna lettura né scrittura della colonna, nessuna traccia; errore chiaro",
    /non è tornato «classificata»/.test(eStato.errore ?? "") &&
      !mondo.admin.richieste.some((r) => r.tabella === "radar_procedure" && r.metodo === "update") &&
      mondo.admin.tabelle.radar_aggiornamenti.length === 0 &&
      JSON.stringify(colonnaDi(V.stabulari)) === "[]",
    { eStato, richieste: mondo.admin.richieste.filter((r) => r.tabella === "radar_procedure" || r.tabella === "radar_aggiornamenti").map((r) => `${r.tabella}|${r.metodo}`) },
  );
  // la vista della console
  const componente = ((): ((p: unknown) => unknown) | null => {
    try {
      return (richiedi(src("app/site-console/_componenti/gare-in-verifica.tsx")) as { default: (p: unknown) => unknown }).default;
    } catch {
      return null;
    }
  })();
  const albV = componente && elencoS4 ? componente({ gare: elencoS4 }) : null;
  const elV = elementi(albV);
  const campiDi = (nome: string) => elV.filter((e) => (e.type === "input" || e.type === "textarea" || e.type === "select") && e.props.name === nome);
  const testoVistaTi = fs.readFileSync(src("app/site-console/_componenti/tender-intelligence-vista.tsx"), "utf8");
  controlla(
    "MS10. vista: per ogni gara il modulo «Decidi» (A/B/C, sottocategorie del catalogo, nota obbligatoria, gara e settore nascosti), collegamento all'avviso; il riquadro è nella pagina Tender Intelligence",
    !!albV && campiDi("rilevanza").length === 3 * 4 && campiDi("nota").length === 4 && campiDi("nota").every((e) => e.props.required === true) && campiDi("sottocategoria").length >= vociCatalogo("pulizia").length &&
      elV.some((e) => e.type === "a" && e.props.href === `https://esempio.invalid/avviso-${V.stabulari.slice(-3)}`) && /<GareInVerifica gare=\{dati\.gareInVerifica\}/.test(testoVistaTi),
    { rilevanza: campiDi("rilevanza").length, nota: campiDi("nota").length, sotto: campiDi("sottocategoria").length },
  );

  // ═════ Q. guardia del caso ricavato dal MOTIVO (coordinamento, 23/11): la riga di B2 non scrive il caso, la console lo ricava dal motivo con
  // casoDaRigaDaVerificare di B2, mai dal settore. Vale solo se i motivi dei casi sono uno per caso e tutti diversi: il giorno in cui due casi
  // hanno lo stesso motivo, o un caso nuovo non ha il suo motivo o il suo nome, questa prova cade. Si leggono i casi dal sorgente del
  // classificatore (settori.ts: il tipo DaVerificare e le righe di casiDaVerificare) e i motivi dalla costante MOTIVI_DA_VERIFICARE.
  const testoSettori = fs.readFileSync(src("lib/radar/settori.ts"), "utf8");
  const tipoCasi = /export type DaVerificare = \{[\s\S]*?\n\s*caso: ([^;]+);/.exec(testoSettori)?.[1] ?? "";
  const casiDelTipo = [...tipoCasi.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]).sort();
  const casiPrevisti = [...testoSettori.matchAll(/out\.push\(\{\s*settore:\s*"([a-z_]+)",\s*caso:\s*"([a-z0-9_]+)",\s*regola:\s*"da_verificare",\s*motivo:\s*MOTIVI_DA_VERIFICARE\.([a-z0-9_]+)\s*\}\)/g)].map((m) => ({ settore: m[1], caso: m[2], motivoDi: m[3] }));
  const calcoliConsole = richiedi(src("lib/console/gare-in-verifica-calcoli.ts")) as { CASO_DEL_SETTORE?: unknown; CASO_LEGGIBILE: Record<string, string> };
  const { casoDaRigaDaVerificare } = richiedi(src("lib/radar/classificazioni-calcoli.ts")) as { casoDaRigaDaVerificare: (r: { regole: string[]; motivi: string[] }) => string | null };
  const chiaviMotivi = Object.keys(MOTIVI_DA_VERIFICARE).sort();
  const testiMotivi = Object.values(MOTIVI_DA_VERIFICARE).map((m) => m.trim().slice(0, 300));
  const motiviDoppi = testiMotivi.filter((m, i) => testiMotivi.indexOf(m) !== i);
  const ritorno = casiDelTipo.map((c) => [c, casoDaRigaDaVerificare({ regole: ["da_verificare", "altra_regola"], motivi: [MOTIVI_DA_VERIFICARE[c] ?? "", "Altro motivo"] })]);
  controlla(
    "MS11. guardia: un motivo per ogni caso S4 del classificatore, tutti diversi, ogni riga del classificatore col motivo del suo caso, ogni caso col suo nome; il caso si ricava dal motivo (e torna), mai dal settore",
    casiDelTipo.length > 0 &&
      JSON.stringify(chiaviMotivi) === JSON.stringify(casiDelTipo) &&
      JSON.stringify(casiPrevisti.map((c) => c.caso).sort()) === JSON.stringify(casiDelTipo) &&
      casiPrevisti.every((c) => c.motivoDi === c.caso) &&
      motiviDoppi.length === 0 &&
      ritorno.every(([c, r]) => c === r) &&
      casoDaRigaDaVerificare({ regole: ["da_verificare"], motivi: ["Motivo che il classificatore non scrive (dato sintetico)"] }) === null &&
      casiDelTipo.every((c) => !!calcoliConsole.CASO_LEGGIBILE[c]) &&
      calcoliConsole.CASO_DEL_SETTORE === undefined,
    { casiDelTipo, chiaviMotivi, casiPrevisti, motiviDoppi, ritorno, corrispondenzaDalSettore: calcoliConsole.CASO_DEL_SETTORE !== undefined },
  );

  // ═════ S. pagina «Fonti» della console (48C §3.5–3.6, K3 di B2): stato calcolato, ultimi giri, allarmi, accendi e spegni con conferma ═════
  // Istante FISSO (mercoledì 25/11/2026, 13:00 a Roma): la lettura di B2 (leggiSituazioneFonti) è il riferimento; la pagina deve dire la stessa
  // cosa. Dati sintetici: nessuna gara, solo righe di stato e del registro dei giri.
  const ADESSO_F = new Date("2026-11-25T12:00:00Z");
  const giro = (fonte: string, iniziato: string, esito: string, extra: Riga = {}): Riga => ({
    fonte,
    modo: "incrementale",
    iniziato_il: iniziato,
    finito_il: new Date(Date.parse(iniziato) + 40_000).toISOString(),
    esito,
    finestre: null,
    fonte_richieste: 3,
    db_richieste: 20,
    avvisi: null,
    gare_nuove: esito === "ok" ? 2 : 0,
    allarmi: null,
    errore: esito === "errore" ? "risposta HTTP 500 dalla fonte (dato sintetico)" : null,
    ...extra,
  });
  const statoF = (fonte: string, attiva: boolean, extra: Riga = {}): Riga => ({ fonte, attiva, ultimo_avvio_il: null, ultimo_successo_il: null, ultimo_errore_il: null, ultimo_errore: null, conteggi: {}, nascosta_ai_clienti: false, ...extra });
  const mondoFonti = () => {
    const admin = new DbProva({
      radar_fonti_stato: [
        statoF("ted", true, { ultimo_successo_il: "2026-11-25T09:16:00Z" }),
        statoF("pvl", true, { ultimo_successo_il: "2026-11-24T12:06:00Z", ultimo_errore_il: "2026-11-25T07:06:00Z", ultimo_errore: "HTTP 500 (dato sintetico)" }),
        statoF("sintel", false, { ultimo_successo_il: "2026-11-23T06:41:00Z", conteggi: { sospensione: { il: "2026-11-24T06:41:00Z", motivo: "HTTP 429 (dato sintetico)" } } }),
        statoF("sardegnacat", false),
      ],
      radar_esecuzioni: [
        // ultimo giro TED pesante (avviso «risorse») e con due allarmi suoi: uno «avviso», uno «informazione» (fermata dalla console, K7)
        giro("ted", "2026-11-25T09:15:00Z", "ok", { db_richieste: 400, allarmi: ["fermata_dalla_console", "buco_possibile"] }),
        giro("ted", "2026-11-24T15:15:00Z", "ok", { gare_nuove: 40, modo: "manuale" }),
        giro("pvl", "2026-11-25T07:05:00Z", "errore"),
        giro("pvl", "2026-11-24T17:05:00Z", "errore"),
        giro("pvl", "2026-11-24T12:05:00Z", "ok", { allarmi: ["fermata_dalla_console"] }),
        giro("sintel", "2026-11-24T06:40:00Z", "sospesa"),
        ...Array.from({ length: 12 }, (_, i) => giro("ted", new Date(Date.parse("2026-11-20T09:15:00Z") - i * 86_400_000).toISOString(), "ok")),
      ],
      radar_console_registro: [],
    });
    return { admin, sessione: new DbProva({}) };
  };
  const moduloFonti = ((): Record<string, unknown> => {
    try {
      return richiedi(src("lib/console/fonti.ts")) as Record<string, unknown>;
    } catch {
      return {};
    }
  })();
  const vistaFonti = ((): ((p: unknown) => unknown) | null => {
    try {
      return (richiedi(src("app/site-console/_componenti/fonti-vista.tsx")) as { default: (p: unknown) => unknown }).default;
    } catch {
      return null;
    }
  })();
  type FonteConsoleProva = { fonte: string; nome: string; stato: string; attiva: boolean; allarmi: { codice: string; messaggio: string }[]; prossimoGiro: string | null; giri: { iniziatoIl: string; esito: string }[] };
  type DatiFontiProva = { fonti: FonteConsoleProva[]; registroAssente: boolean; errore: string | null };
  const leggiDatiFonti = moduloFonti.leggiDatiFonti as ((admin: unknown, adesso?: Date, env?: Record<string, string | undefined>) => Promise<DatiFontiProva>) | undefined;
  const { leggiSituazioneFonti } = richiedi(src("lib/radar/esecuzioni.ts")) as { leggiSituazioneFonti: (db: unknown, adesso: Date, env: Record<string, string | undefined>) => Promise<{ situazioni: { fonte: string; stato: string; attiva: boolean; allarmi: { codice: string; messaggio: string }[] }[]; registroAssente: boolean; errore: string | null }> };
  const { orariPrevisti, INTERRUTTORI_CRON, INTERRUTTORE_REGIONALI_VECCHIO, ORARI_GIRI, CRON_PROPOSTI } = richiedi(src("lib/radar/programmazione-calcoli.ts")) as {
    orariPrevisti: (f: string, da: Date, a: Date) => Date[];
    INTERRUTTORI_CRON: Record<string, string>;
    INTERRUTTORE_REGIONALI_VECCHIO: string;
    ORARI_GIRI: Record<string, { ora: string; giorni: string }[]>;
    CRON_PROPOSTI: Record<string, string[]>;
  };
  // K1 di B2: ogni fonte ha il suo interruttore (INTERRUTTORI_CRON, TED compreso); qui tutti accesi. Una fonte spenta non ha comunque un
  // prossimo giro
  const ENV_F: Record<string, string> = Object.fromEntries(Object.values(INTERRUTTORI_CRON).map((n) => [n, "attivo"]));
  mondo = mondoFonti();
  const rif = await leggiSituazioneFonti(mondo.admin, ADESSO_F, ENV_F);
  mondo = mondoFonti();
  const datiF = leggiDatiFonti ? await leggiDatiFonti(mondo.admin, ADESSO_F, ENV_F) : null;
  const scrittureLettura = mondo.admin.richieste.filter((r) => r.metodo !== "select").length;
  const albF = vistaFonti && datiF ? vistaFonti({ dati: datiF }) : null;
  const tF = testi(albF);
  const pannelli = elementi(albF).filter((e) => typeof e.props.titolo === "string" && ["TED", "PVL ANAC", "Sintel", "SardegnaCAT"].some((n) => String(e.props.titolo).startsWith(n)));
  const testiPannello = (i: number) => testi(pannelli[i]?.props.children);
  const STATO_LEGGIBILE: Record<string, RegExp> = { ok: /In funzione/, in_errore: /In errore/, sospesa: /Sospesa/, spenta: /Spenta/ };
  controlla(
    "FS1. pagina «Fonti»: le quattro fonti nell'ordine ted, pvl, sintel, sardegnacat, ciascuna con lo stato calcolato da B2 detto in chiaro (ok, in errore, sospesa, spenta) e accesa o spenta; la lettura non scrive nulla",
    !!datiF &&
      JSON.stringify(datiF.fonti.map((f) => f.fonte)) === JSON.stringify(["ted", "pvl", "sintel", "sardegnacat"]) &&
      JSON.stringify(datiF.fonti.map((f) => [f.stato, f.attiva])) === JSON.stringify(rif.situazioni.map((s) => [s.stato, s.attiva])) &&
      JSON.stringify(rif.situazioni.map((s) => s.stato)) === JSON.stringify(["ok", "in_errore", "sospesa", "spenta"]) &&
      pannelli.length === 4 &&
      datiF.fonti.every((f, i) => testiPannello(i).some((t) => STATO_LEGGIBILE[f.stato].test(t)) && testiPannello(i).some((t) => (f.attiva ? /^Accesa/ : /^Spenta/).test(t))) &&
      scrittureLettura === 0,
    { stati: datiF?.fonti.map((f) => f.stato), rif: rif.situazioni.map((s) => s.stato), pannelli: pannelli.length, scrittureLettura },
  );
  const messaggiRif = rif.situazioni.map((s) => s.allarmi.map((a) => a.messaggio));
  const messaggiPagina = (datiF?.fonti ?? []).map((_, i) => testiPannello(i).filter((t) => messaggiRif.flat().includes(t)));
  // TED: tre allarmi con due gravità diverse da «errore» (risorse e buco possibile «avviso», fermata dalla console «informazione»); la
  // gravità in pagina è il testo dei bollini degli allarmi, nell'ordine
  const gravitaRifTed = rif.situazioni[0]?.allarmi.map((a) => (a as { gravita?: string }).gravita) ?? [];
  const gravitaPaginaTed = elementi(pannelli[0]?.props.children)
    .filter((e) => typeof e.props.tono === "string" && ["errore", "avviso", "informazione"].includes(e.props.children as string))
    .map((e) => e.props.children as string);
  controlla(
    "FS2. allarmi: per ogni fonte quelli di B2, con il loro messaggio, la loro gravità e nello stesso ordine (per gravità), anche quelli non gravi («avviso», «informazione» della fermata dalla console); la PVL con due giri di fila in errore ha «errori_ripetuti»",
    JSON.stringify(messaggiPagina) === JSON.stringify(messaggiRif) &&
      rif.situazioni[1].allarmi.some((a) => a.codice === "errori_ripetuti") &&
      messaggiRif.flat().length >= 2 &&
      JSON.stringify(gravitaRifTed) === JSON.stringify(["avviso", "avviso", "informazione"]) &&
      rif.situazioni[0].allarmi.some((a) => a.codice === "fermata_dalla_console") &&
      JSON.stringify(gravitaPaginaTed) === JSON.stringify(gravitaRifTed),
    { messaggiPagina, messaggiRif, gravitaRifTed, gravitaPaginaTed },
  );
  const primoOrario = (f: string) => orariPrevisti(f, ADESSO_F, new Date(ADESSO_F.getTime() + 8 * 86_400_000))[0]?.toISOString() ?? null;
  const prossimoPvl = primoOrario("pvl");
  // stesse fonti con interruttori diversi: nessuno; solo quello della PVL (TED non ha più il cron «sempre acceso»); regionali accese col
  // proprio interruttore o col vecchio RADAR_REGIONALI_CRON
  const prossimiCon = async (env: Record<string, string>, regionaliAccese = false) => {
    mondo = mondoFonti();
    if (regionaliAccese) for (const r of mondo.admin.tabelle.radar_fonti_stato) if (r.fonte === "sintel" || r.fonte === "sardegnacat") Object.assign(r, { attiva: true, conteggi: {} });
    const d = leggiDatiFonti ? await leggiDatiFonti(mondo.admin, ADESSO_F, env) : null;
    return d?.fonti.map((f) => f.prossimoGiro) ?? [];
  };
  const pNessuno = await prossimiCon({});
  const pSoloPvl = await prossimiCon({ [INTERRUTTORI_CRON.pvl]: "attivo" });
  const pRegVecchio = await prossimiCon({ [INTERRUTTORE_REGIONALI_VECCHIO]: "attivo" }, true);
  const pSoloSintel = await prossimiCon({ [INTERRUTTORI_CRON.sintel]: "attivo" }, true);
  mondo = mondoFonti();
  const datiSenzaCron = leggiDatiFonti ? await leggiDatiFonti(mondo.admin, ADESSO_F, {}) : null;
  const tuttiNull = (xs: (string | null)[]) => xs.length === 4 && xs.every((x) => x === null);
  controlla(
    "FS3. prossimo giro: dagli orari di B2 solo per una fonte accesa col SUO interruttore acceso (K1: TED con RADAR_TED_CRON, regionali col proprio o col vecchio RADAR_REGIONALI_CRON; PVL 13:05 di Roma); nessuno per una fonte spenta o coi giri spenti; ultimo giro e ultimo successo nella pagina",
    !!datiF &&
      prossimoPvl === "2026-11-25T12:05:00.000Z" &&
      JSON.stringify(datiF.fonti.map((f) => f.prossimoGiro)) === JSON.stringify([primoOrario("ted"), prossimoPvl, null, null]) &&
      typeof primoOrario("ted") === "string" &&
      tuttiNull(pNessuno) &&
      JSON.stringify(pSoloPvl) === JSON.stringify([null, prossimoPvl, null, null]) &&
      JSON.stringify(pRegVecchio) === JSON.stringify([null, null, primoOrario("sintel"), primoOrario("sardegnacat")]) &&
      JSON.stringify(pSoloSintel) === JSON.stringify([null, null, primoOrario("sintel"), null]) &&
      typeof primoOrario("sintel") === "string" &&
      testiPannello(1).some((t) => /Ultimo giro/.test(t)) && testiPannello(1).some((t) => /Ultimo successo/.test(t)) && testiPannello(1).some((t) => /Prossimo giro/.test(t)),
    { prossimi: datiF?.fonti.map((f) => f.prossimoGiro), pNessuno, pSoloPvl, pRegVecchio, pSoloSintel },
  );
  // orari, interruttori e righe cron di ogni fonte nella pagina, dalla sola programmazione-calcoli.ts (K1). Il riferimento è scritto qui a
  // partire da ORARI_GIRI; la PVL anche per esteso, come chiesto (08:05, 13:05, 18:05 di Roma, tutti i giorni)
  const GIORNI_ATTESI: Record<string, string> = { tutti: "tutti i giorni", feriali: "dal lunedì al venerdì", fine_settimana: "il sabato e la domenica" };
  const orariAttesi = (f: string) => {
    const gruppi: [string, string[]][] = [];
    for (const o of ORARI_GIRI[f] ?? []) {
      const g = gruppi.find((x) => x[0] === o.giorni);
      if (g) g[1].push(o.ora);
      else gruppi.push([o.giorni, [o.ora]]);
    }
    return gruppi.map(([g, ore]) => `${ore.join(", ")} ${GIORNI_ATTESI[g]}`).join("; ");
  };
  const FONTI_ORDINE = ["ted", "pvl", "sintel", "sardegnacat"];
  const albSenzaCron = vistaFonti && datiSenzaCron ? vistaFonti({ dati: datiSenzaCron }) : null;
  const pannelliSenzaCron = elementi(albSenzaCron).filter((e) => typeof e.props.titolo === "string" && ["TED", "PVL ANAC", "Sintel", "SardegnaCAT"].some((n) => String(e.props.titolo).startsWith(n)));
  const fraseGiri = (pannello: { props: Record<string, unknown> } | undefined) => testi(pannello?.props.children).find((t) => t.startsWith("Giri programmati alle ")) ?? "";
  const giriAccesi = FONTI_ORDINE.map((_, i) => fraseGiri(pannelli[i]));
  const giriSpenti = FONTI_ORDINE.map((_, i) => fraseGiri(pannelliSenzaCron[i]));
  const regionale = (f: string) => f === "sintel" || f === "sardegnacat";
  controlla(
    "FS11. pagina «Fonti»: per ogni fonte gli orari di Roma da ORARI_GIRI (PVL 08:05, 13:05, 18:05 tutti i giorni), il suo interruttore (INTERRUTTORI_CRON; per le regionali anche RADAR_REGIONALI_CRON) e, coi giri spenti, le righe cron proposte (CRON_PROPOSTI)",
    orariAttesi("pvl") === "08:05, 13:05, 18:05 tutti i giorni" &&
      FONTI_ORDINE.every(
        (f, i) =>
          giriAccesi[i].startsWith(`Giri programmati alle ${orariAttesi(f)} (ora di Roma): accesi`) &&
          giriAccesi[i].includes(`${INTERRUTTORI_CRON[f]}=attivo`) &&
          giriAccesi[i].includes(INTERRUTTORE_REGIONALI_VECCHIO) === regionale(f) &&
          giriSpenti[i].startsWith(`Giri programmati alle ${orariAttesi(f)} (ora di Roma): spenti`) &&
          (CRON_PROPOSTI[f] ?? []).length > 0 &&
          (CRON_PROPOSTI[f] ?? []).every((riga) => giriSpenti[i].includes(`«${riga}»`)) &&
          giriSpenti[i].includes(`${INTERRUTTORI_CRON[f]}=attivo`) &&
          giriSpenti[i].includes(INTERRUTTORE_REGIONALI_VECCHIO) === regionale(f),
      ),
    { giriAccesi, giriSpenti },
  );
  const giriTed = datiF?.fonti[0].giri ?? [];
  controlla(
    "FS4. ultimi giri della fonte: al più 10, dal più recente, con modo, esito, durata, richieste, gare nuove e allarmi; nessun dato di gare",
    giriTed.length === 10 && giriTed.every((g, i) => i === 0 || Date.parse(giriTed[i - 1].iniziatoIl) >= Date.parse(g.iniziatoIl)) && giriTed[0].iniziatoIl === "2026-11-25T09:15:00Z" &&
      ["Modo", "Esito", "Durata", "Richieste", "Gare nuove", "Allarmi"].every((h) => testiPannello(0).includes(h)) &&
      (datiF?.fonti[1].giri ?? []).some((g) => (g as unknown as { allarmi: string[] }).allarmi.includes("fermata_dalla_console")),
    { giriTed: giriTed.map((g) => g.iniziatoIl) },
  );
  // registro dei giri assente (0128 non applicata) o guasto; stato illeggibile
  mondo = mondoFonti();
  mondo.admin.assenti.add("radar_esecuzioni");
  const datiAssente = leggiDatiFonti ? await leggiDatiFonti(mondo.admin, ADESSO_F, ENV_F) : null;
  const tAssente = testi(vistaFonti && datiAssente ? vistaFonti({ dati: datiAssente }) : null);
  mondo = mondoFonti();
  mondo.admin.guasti.add("radar_esecuzioni");
  const datiGuasto = leggiDatiFonti ? await leggiDatiFonti(mondo.admin, ADESSO_F, ENV_F) : null;
  const tGuasto = testi(vistaFonti && datiGuasto ? vistaFonti({ dati: datiGuasto }) : null);
  mondo = mondoFonti();
  mondo.admin.guasti.add("radar_fonti_stato");
  const datiStato = leggiDatiFonti ? await leggiDatiFonti(mondo.admin, ADESSO_F, ENV_F) : null;
  const tStato = testi(vistaFonti && datiStato ? vistaFonti({ dati: datiStato }) : null);
  controlla(
    "FS5. registro dei giri assente: avviso in pagina, stato dal solo radar_fonti_stato, nessun elenco di giri; registro guasto: errore in pagina, stato sì; stato illeggibile: errore, nessuna fonte inventata",
    !!datiAssente && datiAssente.registroAssente && datiAssente.fonti.length === 4 && datiAssente.fonti.every((f) => f.giri.length === 0) && tAssente.some((t) => /registro dei giri.*(non c'è|assente)/i.test(t)) &&
      !!datiGuasto && /registro dei giri/.test(datiGuasto.errore ?? "") && datiGuasto.fonti.length === 4 && tGuasto.some((t) => /registro dei giri/.test(t)) &&
      !!datiStato && /stato delle fonti/.test(datiStato.errore ?? "") && datiStato.fonti.length === 0 && tStato.some((t) => /stato delle fonti/.test(t)),
    { assente: datiAssente && { r: datiAssente.registroAssente, n: datiAssente.fonti.length }, guasto: datiGuasto?.errore, stato: datiStato && { e: datiStato.errore, n: datiStato.fonti.length } },
  );
  // accendi e spegni: le azioni ESISTENTI, con una conferma obbligatoria nel modulo
  const azioniTi = richiedi(src("app/site-console/azioni/tender-intelligence.ts")) as Record<string, unknown>;
  const ModuloAzioneConsole = (richiedi(src("app/site-console/_componenti/modulo-azione.tsx")) as { default: unknown }).default;
  const moduli = (i: number) => elementi(pannelli[i]?.props.children).filter((e) => e.type === ModuloAzioneConsole);
  const azioniAttese = [
    { azione: azioniTi.impostaFonteTed, campi: { azione: "spegni" } },
    { azione: azioniTi.impostaFontePvl, campi: { azione: "spegni" } },
    { azione: azioniTi.impostaFonteRegionale, campi: { fonte: "sintel", azione: "accendi" } },
    { azione: azioniTi.impostaFonteRegionale, campi: { fonte: "sardegnacat", azione: "accendi" } },
  ];
  const conferme = azioniAttese.map((a, i) => {
    const m = moduli(i).find((x) => x.props.azione === a.azione);
    const conferma = m ? elementi(m.props.children).find((e) => e.type === "input" && e.props.name === "conferma") : undefined;
    return !!m && JSON.stringify(m.props.campi) === JSON.stringify(a.campi) && conferma?.props.required === true && conferma?.props.type === "checkbox";
  });
  controlla(
    "FS6. accendi e spegni con le azioni esistenti (TED, PVL, regionali con la fonte) e una casella di conferma obbligatoria; una fonte sospesa si «riaccende» solo da qui",
    conferme.every(Boolean) && testiPannello(2).some((t) => /Riaccendi/.test(t)),
    conferme,
  );
  // Sintel e SardegnaCAT si fermano solo dal giro successivo (TED e PVL a metà giro, K7 di B2): la nota accanto a «Spegni» delle sole due
  // regionali accese. Vista con SardegnaCAT accesa (stessi dati, solo «attiva»)
  const NOTA_GIRO_SUCCESSIVO = /si ferma dal giro successivo/;
  const datiRegAccesa = datiF ? { ...datiF, fonti: datiF.fonti.map((f) => (f.fonte === "sardegnacat" ? { ...f, attiva: true, stato: "ok" } : f)) } : null;
  const albRegAccesa = vistaFonti && datiRegAccesa ? vistaFonti({ dati: datiRegAccesa }) : null;
  const pannelliRegAccesa = elementi(albRegAccesa).filter((e) => typeof e.props.titolo === "string" && ["TED", "PVL ANAC", "Sintel", "SardegnaCAT"].some((n) => String(e.props.titolo).startsWith(n)));
  const notaNelModulo = (pannello: { props: Record<string, unknown> } | undefined) =>
    elementi(pannello?.props.children)
      .filter((e) => e.type === ModuloAzioneConsole)
      .some((m) => testi(m.props.children).some((t) => NOTA_GIRO_SUCCESSIVO.test(t)));
  const note = { sardegnacatAccesa: notaNelModulo(pannelliRegAccesa[3]), ted: notaNelModulo(pannelli[0]), pvl: notaNelModulo(pannelli[1]), sintelSpenta: notaNelModulo(pannelli[2]), sardegnacatSpenta: notaNelModulo(pannelli[3]) };
  controlla(
    "FS8. «Spegni» di Sintel e SardegnaCAT accese dice che la fonte si ferma dal giro successivo; non lo dice per TED e PVL (si fermano a metà giro) né per una fonte già spenta",
    pannelliRegAccesa.length === 4 && note.sardegnacatAccesa && testi(pannelliRegAccesa[3]?.props.children).some((t) => /^SardegnaCAT si ferma dal giro successivo/.test(t)) && !note.ted && !note.pvl && !note.sintelSpenta && !note.sardegnacatSpenta,
    note,
  );

  // ── conferma dell'accensione controllata nel SERVER (decisione del coordinamento, 23/11): accendere e riaccendere avviano acquisizioni
  // vere e chiedono «conferma» = «si»; spegnere resta sempre ammesso senza conferma. Le azioni vere, col database in memoria ──
  const { ERRORE_CONFERMA_ACCENSIONE } = richiedi(src("lib/console/fonti-calcoli.ts")) as { ERRORE_CONFERMA_ACCENSIONE?: string };
  type EsitoAzioneFonte = { errore?: string; ok?: boolean; avviso?: string };
  const AZIONI_FONTE = [
    { fonte: "ted", azione: azioniTi.impostaFonteTed, campi: {} },
    { fonte: "pvl", azione: azioniTi.impostaFontePvl, campi: {} },
    { fonte: "sintel", azione: azioniTi.impostaFonteRegionale, campi: { fonte: "sintel" } },
    { fonte: "sardegnacat", azione: azioniTi.impostaFonteRegionale, campi: { fonte: "sardegnacat" } },
  ] as { fonte: string; azione: (s: unknown, fd: FormData) => Promise<EsitoAzioneFonte>; campi: Record<string, string> }[];
  const { PROGETTO_STAGING: stagingF } = richiedi(src("lib/radar/ambiente.ts")) as { PROGETTO_STAGING: string };
  // PVL e regionali si accendono solo sullo staging (regola invariata): la prova si mette sullo staging solo in memoria e poi ripristina
  const conStagingF = async <T,>(sullo: boolean, f: () => Promise<T>): Promise<T> => {
    const prima = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (sullo) process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${stagingF}.supabase.co`;
    else delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    try {
      return await f();
    } finally {
      if (prima === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      else process.env.NEXT_PUBLIC_SUPABASE_URL = prima;
    }
  };
  const provaAzioneFonte = async (fonte: string, campi: Record<string, string>, accese: boolean, staging = true) => {
    mondo = mondoFonti();
    for (const r of mondo.admin.tabelle.radar_fonti_stato) r.attiva = accese;
    const a = AZIONI_FONTE.find((x) => x.fonte === fonte)!;
    const fd = new FormData();
    for (const [k, v] of Object.entries({ ...a.campi, ...campi })) fd.append(k, v);
    const esito = typeof a.azione === "function" ? await conStagingF(staging, () => a.azione({}, fd)) : { errore: "azione assente" };
    return {
      esito,
      attiva: mondo.admin.tabelle.radar_fonti_stato.find((r) => r.fonte === fonte)?.attiva,
      richieste: mondo.admin.richieste.length,
      registro: mondo.admin.tabelle.radar_console_registro.filter((r) => r.oggetto === `fonte:${fonte}:attiva`).map((r) => r.valore_nuovo),
    };
  };
  const FONTI_Q = ["ted", "pvl", "sintel", "sardegnacat"];
  // una prova alla volta: ognuna ha il suo database in memoria («mondo» è condiviso dalle sostituzioni dei moduli)
  const inFila = async (campi: Record<string, string>, accese: boolean) => {
    const esiti = [] as Awaited<ReturnType<typeof provaAzioneFonte>>[];
    for (const f of FONTI_Q) esiti.push(await provaAzioneFonte(f, campi, accese));
    return esiti;
  };
  const senzaConferma = await inFila({ azione: "accendi" }, false);
  // «on» è il valore di una casella senza «value»: non vale come conferma
  const confermaSbagliata = await inFila({ azione: "accendi", conferma: "on" }, false);
  const conConferma = await inFila({ azione: "accendi", conferma: "si" }, false);
  const spegniSenza = await inFila({ azione: "spegni" }, true);
  // fuori dallo staging la PVL non si accende nemmeno con la conferma (regola dell'ambiente invariata, nessuna scrittura)
  const pvlFuoriStaging = await provaAzioneFonte("pvl", { azione: "accendi", conferma: "si" }, false, false);
  const rifiutata = (x: Awaited<ReturnType<typeof provaAzioneFonte>>) => x.esito.errore === ERRORE_CONFERMA_ACCENSIONE && x.richieste === 0 && x.attiva === false && x.registro.length === 0;
  controlla(
    "FS9. conferma nel server: accendere (e riaccendere la sospesa) senza «conferma» = «si» è rifiutato da tutte e tre le azioni prima di ogni lettura, senza scritture né registro; con la conferma si accende e si registra; spegnere senza conferma è accettato e registrato; fuori dallo staging la PVL resta non accendibile",
    typeof ERRORE_CONFERMA_ACCENSIONE === "string" &&
      senzaConferma.every(rifiutata) &&
      confermaSbagliata.every(rifiutata) &&
      conConferma.every((x) => x.esito.ok === true && !x.esito.errore && x.attiva === true && JSON.stringify(x.registro) === JSON.stringify(["true"])) &&
      spegniSenza.every((x) => x.esito.ok === true && !x.esito.errore && x.attiva === false && JSON.stringify(x.registro) === JSON.stringify(["false"])) &&
      !!pvlFuoriStaging.esito.errore && pvlFuoriStaging.esito.errore !== ERRORE_CONFERMA_ACCENSIONE && /staging/.test(pvlFuoriStaging.esito.errore) && pvlFuoriStaging.attiva === false && pvlFuoriStaging.registro.length === 0,
    {
      senzaConferma: senzaConferma.map((x) => [x.esito.errore?.slice(0, 40), x.richieste, x.attiva]),
      confermaSbagliata: confermaSbagliata.map((x) => [x.esito.errore?.slice(0, 40), x.richieste]),
      conConferma: conConferma.map((x) => [x.esito.ok, x.esito.errore?.slice(0, 60), x.attiva, x.registro]),
      spegniSenza: spegniSenza.map((x) => [x.esito.ok, x.esito.errore?.slice(0, 60), x.attiva, x.registro]),
      pvlFuoriStaging: [pvlFuoriStaging.esito.errore?.slice(0, 60), pvlFuoriStaging.attiva],
    },
  );

  // la pagina Tender Intelligence: i moduli «Accendi la fonte» di TED, PVL e regionali hanno la casella di conferma obbligatoria (altrimenti
  // il server li rifiuterebbe sempre); «Spegni la fonte» no. Vista vera con dati minimi sintetici, sezioni PVL e regionali disegnate
  const VistaTi = (richiedi(src("app/site-console/_componenti/tender-intelligence-vista.tsx")) as { default: (p: unknown) => unknown }).default;
  const { giriProgrammatiTutti } = richiedi(src("lib/console/fonti-calcoli.ts")) as { giriProgrammatiTutti?: (env: Record<string, string>, adesso: Date) => unknown };
  const datiTi = (accese: boolean, env: Record<string, string> = {}) => ({
    schemaPresente: true,
    parametri: { attivo: false, costi: {}, limiti: {} },
    fonti: ["ted", "pvl"].map((id) => ({ id, nome: id.toUpperCase(), stato: "attiva", limiti: [], licenza: "[prova]", copertura: "[prova]", aggiornamento: "[prova]", db: { attiva: accese } })),
    procedure: null,
    procedureAperte: null,
    gareCollegate: null,
    aggiudicazioni: null,
    coda: null,
    clientiAbilitati: null,
    utilizzi30Giorni: null,
    ted: null,
    imprese: null,
    registro: null,
    pvl: {
      accensioneConsentita: true,
      ambiente: "staging",
      sospensione: null,
      inCorso: false,
      ultimoGiorno: null,
      ultimoGiro: null,
      limiti: {},
      giriProgrammati: { attivi: false, orari: "", cronProposto: "", prossimo: "" },
      archivio: { avvisi: null, gareNateDallaPvl: null, avvisiCheCitanoTed: null, cambiamentiPvl: null },
      collegamenti: null,
    },
    regionali: {
      fonti: ["sintel", "sardegnacat"].map((fonte) => ({ fonte, attiva: accese, nascosta: false, accensioneConsentita: true, sospensione: null, ultimoSuccesso: null, datiAl: null, ultimoGiro: null, procedure: null })),
      proposte: null,
      classificazioni: null,
    },
    gareInVerifica: null,
    // i giri programmati come li calcola la console (fonti-calcoli.ts, dalla sola programmazione-calcoli.ts)
    giriProgrammati: giriProgrammatiTutti ? giriProgrammatiTutti(env, ADESSO_F) : undefined,
  });
  // la vista della console con le sezioni PVL e regionali disegnate (sono componenti: qui si chiamano a mano)
  const alberoTi = (accese: boolean, env: Record<string, string> = {}) => {
    const alb = VistaTi({ dati: datiTi(accese, env) });
    const sezioni = elementi(alb)
      .filter((e) => typeof e.type === "function" && ["SezionePvl", "SezioneRegionali"].includes((e.type as { name: string }).name))
      .map((e) => (e.type as (p: unknown) => unknown)(e.props));
    return [alb, ...sezioni];
  };
  const moduliAccensioneTi = (accese: boolean) => {
    try {
      const azioni = [azioniTi.impostaFonteTed, azioniTi.impostaFontePvl, azioniTi.impostaFonteRegionale];
      return elementi(alberoTi(accese))
        .filter((e) => e.type === ModuloAzioneConsole && azioni.includes(e.props.azione))
        .map((m) => {
          const c = elementi(m.props.children).find((e) => e.type === "input" && e.props.name === "conferma");
          return { azione: (m.props.campi as Record<string, string>).azione, conferma: !!c && c.props.type === "checkbox" && c.props.required === true && c.props.value === "si", casella: !!c };
        });
    } catch (e) {
      return [{ azione: `eccezione: ${e instanceof Error ? e.message : String(e)}`, conferma: false, casella: false }];
    }
  };
  const tiSpente = moduliAccensioneTi(false);
  const tiAccese = moduliAccensioneTi(true);
  controlla(
    "FS10. pagina Tender Intelligence: «Accendi la fonte» di TED, PVL, Sintel e SardegnaCAT con la casella di conferma obbligatoria («si»); «Spegni la fonte» senza",
    tiSpente.length === 4 && tiSpente.every((m) => m.azione === "accendi" && m.conferma) && tiAccese.length === 4 && tiAccese.every((m) => m.azione === "spegni" && !m.casella),
    { tiSpente, tiAccese },
  );

  // orari dei giri nella console: SOLO da programmazione-calcoli.ts. (1) schede TED, PVL, Sintel e SardegnaCAT della pagina Tender
  // Intelligence; (2) messaggi delle azioni dopo l'accensione (FS9); (3) guardia sui sorgenti: nessun orario, riga cron o interruttore
  // scritto a mano, nessun resto dei vecchi orari della PVL (ORE_GIRI_PVL, CRON_PVL_PROPOSTO, prossimoGiroPvl)
  const frasiGiriTi = (accese: boolean, env: Record<string, string>) => {
    try {
      return testi(alberoTi(accese, env)).filter((t) => t.startsWith("Giri programmati alle "));
    } catch (e) {
      return [`eccezione: ${e instanceof Error ? e.message : String(e)}`];
    }
  };
  const tiGiriSpenti = frasiGiriTi(false, {});
  const tiGiriAccesi = frasiGiriTi(true, ENV_F);
  const testiTi = (() => {
    try {
      return testi(alberoTi(false, {}));
    } catch {
      return [] as string[];
    }
  })();
  const fraseDi = (frasi: string[], f: string, stato: "accesi" | "spenti") => frasi.filter((t) => t.startsWith(`Giri programmati alle ${orariAttesi(f)} (ora di Roma): ${stato}`) && t.includes(`${INTERRUTTORI_CRON[f]}=attivo`));
  const avvisiAccensione = conConferma.map((x) => x.esito.avviso ?? "");
  const SORGENTI_CONSOLE = [
    "app/site-console/_componenti/tender-intelligence-vista.tsx",
    "app/site-console/_componenti/fonti-vista.tsx",
    "app/site-console/azioni/tender-intelligence.ts",
    "app/site-console/(app)/tender-intelligence/fonti/page.tsx",
    "lib/console/tender-intelligence.ts",
    "lib/console/fonti.ts",
    "lib/console/fonti-calcoli.ts",
  ];
  // i commenti non contano (possono citare un orario come esempio); contano stringhe, JSX e codice
  const senzaCommenti = (s: string) =>
    s
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((r) => !/^\s*\/\//.test(r))
      .join("\n");
  const scrittoAMano = SORGENTI_CONSOLE.flatMap((rel) => {
    const codice = senzaCommenti(fs.readFileSync(src(rel), "utf8"));
    const trovati: string[] = [];
    for (const [nome, re] of [
      ["orario", /\b([01]?\d|2[0-3])[:.][0-5]\d\b/],
      ["riga cron", /\*\s+\*\s+\*/],
      ["interruttore", /RADAR_[A-Z_]*CRON/],
      ["vecchi orari PVL", /ORE_GIRI_PVL|CRON_PVL_PROPOSTO|prossimoGiroPvl/],
      ["UTC", /\bUTC\b/],
    ] as [string, RegExp][]) {
      const m = codice.match(re);
      if (m) trovati.push(`${rel}: ${nome} «${m[0]}»`);
    }
    return trovati;
  });
  controlla(
    "FS12. orari dei giri SOLO da programmazione-calcoli.ts: schede TED, PVL, Sintel e SardegnaCAT della pagina Tender Intelligence (orari, interruttore per fonte, RADAR_REGIONALI_CRON per compatibilità, righe cron coi giri spenti); messaggi dopo l'accensione; nei sorgenti della console nessun orario, riga cron o interruttore scritto a mano",
    tiGiriSpenti.length === 4 &&
      tiGiriAccesi.length === 4 &&
      FONTI_ORDINE.every(
        (f) =>
          fraseDi(tiGiriSpenti, f, "spenti").length === 1 &&
          fraseDi(tiGiriSpenti, f, "spenti")[0].includes(INTERRUTTORE_REGIONALI_VECCHIO) === regionale(f) &&
          (CRON_PROPOSTI[f] ?? []).every((riga) => fraseDi(tiGiriSpenti, f, "spenti")[0].includes(`«${riga}»`)) &&
          fraseDi(tiGiriAccesi, f, "accesi").length === 1,
      ) &&
      !testiTi.some((t) => /\b(8:00|9:15|13:00|18:00)\b|ora italiana/.test(t)) &&
      avvisiAccensione.length === 4 &&
      FONTI_ORDINE.every((f, i) => avvisiAccensione[i].includes(`Giri programmati alle ${orariAttesi(f)} (ora di Roma)`) && avvisiAccensione[i].includes(`${INTERRUTTORI_CRON[f]}=attivo`)) &&
      scrittoAMano.length === 0,
    { tiGiriSpenti, tiGiriAccesi, avvisiAccensione: avvisiAccensione.map((a) => a.slice(0, 120)), scrittoAMano },
  );

  // ═════ «Riprendi il recupero» della PVL (K4 di B2, riprendiRecuperoPvl): pulsante solo con l'allarme «blocco_incompleto», conferma nel
  // server, registro 0112, ogni motivo di rifiuto detto in chiaro. Cursore v2 sintetico fermo sul blocco 01/10–07/10 ═════
  const { cursorePvlNuovo } = richiedi(src("lib/radar/importa-pvl-cursore.ts")) as { cursorePvlNuovo: (oggi: string) => { recupero: Record<string, unknown> } };
  const calcoliRipresa = richiedi(src("lib/console/fonti-calcoli.ts")) as { TESTO_MOTIVO_RIPRESA?: Record<string, string>; ERRORE_CONFERMA_RIPRESA?: string };
  const TESTO_MOTIVO = calcoliRipresa.TESTO_MOTIVO_RIPRESA ?? {};
  const BLOCCO_FERMO = { il: "2026-11-25T07:06:00.000Z", da: "2026-10-01", a: "2026-10-07" };
  const cursoreFermo = () => {
    const c = cursorePvlNuovo("2026-11-25");
    return { ...c, recupero: { ...c.recupero, fermo: { ...BLOCCO_FERMO } } };
  };
  const mondoRipresa = (o: { allarmeSu?: string | null; fermo?: boolean; bloccoFinoA?: string | null } = {}) => {
    const m = mondoFonti();
    const pvl = m.admin.tabelle.radar_fonti_stato.find((r) => r.fonte === "pvl")!;
    Object.assign(pvl, { cursore: o.fermo === false ? cursorePvlNuovo("2026-11-25") : cursoreFermo(), blocco_fino_a: o.bloccoFinoA ?? null, aggiornata_il: "2026-11-25T07:06:30.000Z" });
    const su = o.allarmeSu === undefined ? "pvl" : o.allarmeSu;
    if (su) {
      const ultimo = m.admin.tabelle.radar_esecuzioni.filter((r) => r.fonte === su).sort((x, y) => String(y.iniziato_il).localeCompare(String(x.iniziato_il)))[0];
      ultimo.allarmi = ["blocco_incompleto"];
    }
    return m;
  };
  const riprendi = azioniTi.riprendiRecuperoPvlConsole as ((s: unknown, fd: FormData) => Promise<{ errore?: string; ok?: boolean; avviso?: string }>) | undefined;
  type FonteConRipresa = FonteConsoleProva & { ripresaRecupero?: { stato: string; blocco?: { il: string; da: string; a: string } } | null };
  const vistaRipresa = async (o: Parameters<typeof mondoRipresa>[0]) => {
    mondo = mondoRipresa(o);
    const d = leggiDatiFonti ? ((await leggiDatiFonti(mondo.admin, ADESSO_F, ENV_F)) as unknown as Omit<DatiFontiProva, "fonti"> & { fonti: FonteConRipresa[] }) : null;
    const alb = vistaFonti && d ? vistaFonti({ dati: d }) : null;
    const pann = elementi(alb).filter((e) => typeof e.props.titolo === "string" && ["TED", "PVL ANAC", "Sintel", "SardegnaCAT"].some((n) => String(e.props.titolo).startsWith(n)));
    const moduli = pann.map((p) => elementi(p.props.children).filter((e) => e.type === ModuloAzioneConsole && e.props.azione === riprendi && !!riprendi));
    return { d, pann, moduli, testiPvl: testi(pann[1]?.props.children) };
  };
  const rFermo = await vistaRipresa({});
  const rSenza = await vistaRipresa({ allarmeSu: null });
  const rSuTed = await vistaRipresa({ allarmeSu: "ted" });
  const rGiaRipreso = await vistaRipresa({ fermo: false });
  const moduloPvl = rFermo.moduli[1]?.[0];
  const casellaRipresa = moduloPvl ? elementi(moduloPvl.props.children).find((e) => e.type === "input" && e.props.name === "conferma") : undefined;
  const nessunModulo = (r: Awaited<ReturnType<typeof vistaRipresa>>) => r.pann.length === 4 && r.moduli.every((m) => m.length === 0);
  controlla(
    "FS13. «Riprendi il recupero» SOLO per la PVL con l'allarme «blocco_incompleto» e il recupero fermo: il blocco fermo accanto (01/10/2026–07/10/2026), la nota «si ritenta al prossimo giro», la casella di conferma obbligatoria; nessun pulsante senza l'allarme, con l'allarme su un'altra fonte o col recupero già ripreso",
    !!riprendi &&
      rFermo.pann.length === 4 &&
      rFermo.moduli.map((m) => m.length).join(",") === "0,1,0,0" &&
      JSON.stringify(rFermo.d?.fonti[1].ripresaRecupero) === JSON.stringify({ stato: "fermo", blocco: BLOCCO_FERMO }) &&
      rFermo.testiPvl.some((t) => t.includes("01/10/2026") && t.includes("07/10/2026")) &&
      testi(moduloPvl?.props.children).some((t) => /si ritenta al prossimo giro/i.test(t)) &&
      casellaRipresa?.props.type === "checkbox" && casellaRipresa?.props.required === true && casellaRipresa?.props.value === "si" &&
      nessunModulo(rSenza) && rSenza.d?.fonti.every((f) => f.ripresaRecupero === null) === true &&
      nessunModulo(rSuTed) && rSuTed.d?.fonti.every((f) => f.ripresaRecupero === null) === true &&
      nessunModulo(rGiaRipreso) && rGiaRipreso.d?.fonti[1].ripresaRecupero?.stato === "gia_ripreso" && rGiaRipreso.testiPvl.some((t) => /già ripreso/.test(t)),
    {
      moduli: rFermo.moduli.map((m) => m.length),
      ripresa: rFermo.d?.fonti[1].ripresaRecupero,
      senza: rSenza.moduli.map((m) => m.length),
      suTed: rSuTed.moduli.map((m) => m.length),
      giaRipreso: rGiaRipreso.d?.fonti[1].ripresaRecupero,
    },
  );

  // l'azione vera, col database in memoria (sullo staging solo in memoria: la PVL si scrive solo lì)
  const provaRipresa = async (campi: Record<string, string>, prepara: (m: ReturnType<typeof mondoRipresa>) => void = () => undefined, o: Parameters<typeof mondoRipresa>[0] = {}, staging = true) => {
    mondo = mondoRipresa(o);
    prepara(mondo);
    const fd = new FormData();
    for (const [k, v] of Object.entries(campi)) fd.append(k, v);
    const esito = riprendi ? await conStagingF(staging, () => riprendi({}, fd)) : { errore: "azione assente" };
    const pvl = mondo.admin.tabelle.radar_fonti_stato?.find((r) => r.fonte === "pvl");
    return {
      esito,
      richieste: mondo.admin.richieste.length,
      fermo: ((pvl?.cursore as { recupero?: { fermo?: unknown } } | undefined)?.recupero?.fermo ?? null) as unknown,
      ripresa: (pvl?.conteggi as Record<string, unknown> | undefined)?.ultima_ripresa_recupero as { autore?: string; blocco?: unknown } | undefined,
      registro: (mondo.admin.tabelle.radar_console_registro ?? []).filter((r) => r.oggetto === "fonte:pvl:ripresa_recupero"),
    };
  };
  adminAutenticato = false;
  const rNonAdmin = await provaRipresa({ conferma: "si" });
  adminAutenticato = true;
  const rSenzaConferma = await provaRipresa({});
  const rConfermaOn = await provaRipresa({ conferma: "on" });
  const rRegistroAssente = await provaRipresa({ conferma: "si" }, (m) => m.admin.assenti.add("radar_console_registro"));
  const rOk = await provaRipresa({ conferma: "si" });
  const nonToccato = (x: Awaited<ReturnType<typeof provaRipresa>>) => JSON.stringify(x.fermo) === JSON.stringify(BLOCCO_FERMO) && x.ripresa === undefined && x.registro.length === 0;
  controlla(
    "FS14. azione «Riprendi il recupero»: senza amministratore nessuna richiesta al database; senza conferma «si» rifiutata prima di ogni lettura; senza registro 0112 nulla cambia; con la conferma il recupero riparte (cursore non più fermo, autore «console:<email>»), il registro scrive prima e dopo col blocco, il messaggio dice il blocco e il prossimo giro",
    !!riprendi &&
      rNonAdmin.esito.errore === "Non autorizzato." && rNonAdmin.richieste === 0 && nonToccato(rNonAdmin) &&
      typeof calcoliRipresa.ERRORE_CONFERMA_RIPRESA === "string" &&
      rSenzaConferma.esito.errore === calcoliRipresa.ERRORE_CONFERMA_RIPRESA && rSenzaConferma.richieste === 0 && nonToccato(rSenzaConferma) &&
      rConfermaOn.esito.errore === calcoliRipresa.ERRORE_CONFERMA_RIPRESA && rConfermaOn.richieste === 0 && nonToccato(rConfermaOn) &&
      /0112/.test(rRegistroAssente.esito.errore ?? "") && nonToccato(rRegistroAssente) &&
      rOk.esito.ok === true && !rOk.esito.errore &&
      rOk.fermo === null &&
      rOk.ripresa?.autore === `console:${AMMINISTRATORE.email}` &&
      rOk.registro.length === 1 &&
      rOk.registro[0].valore_precedente === "fermo sul blocco 2026-10-01..2026-10-07" &&
      rOk.registro[0].valore_nuovo === "ripreso: blocco 2026-10-01..2026-10-07 da ritentare al prossimo giro" &&
      rOk.registro[0].autore_email === AMMINISTRATORE.email &&
      /01\/10\/2026/.test(rOk.esito.avviso ?? "") && /07\/10\/2026/.test(rOk.esito.avviso ?? "") && /prossimo giro/.test(rOk.esito.avviso ?? ""),
    {
      nonAdmin: [rNonAdmin.esito.errore, rNonAdmin.richieste],
      senzaConferma: [rSenzaConferma.esito.errore?.slice(0, 50), rSenzaConferma.richieste],
      registroAssente: rRegistroAssente.esito.errore?.slice(0, 60),
      ok: [rOk.esito, rOk.fermo, rOk.ripresa?.autore?.slice(0, 12), rOk.registro.map((r) => [r.valore_precedente, r.valore_nuovo])],
    },
  );

  // ogni motivo di rifiuto di riprendiRecuperoPvl, con la sua frase; nessuna scrittura, nessuna riga di registro
  const secondaChiamataGuasta = (m: ReturnType<typeof mondoRipresa>) => {
    const da = m.admin.from.bind(m.admin);
    let n = 0;
    m.admin.from = (t: string) => {
      if (t === "radar_fonti_stato" && ++n === 2) m.admin.guasti.add(t);
      return da(t);
    };
  };
  // in fila: «mondo» è condiviso
  const esitiMotivi: Record<string, Awaited<ReturnType<typeof provaRipresa>>> = {};
  for (const [nome, p] of [
    ["ambiente_non_consentito", () => provaRipresa({ conferma: "si" }, undefined, {}, false)],
    ["schema_assente", () => provaRipresa({ conferma: "si" }, (m) => m.admin.assenti.add("radar_fonti_stato"))],
    ["errore_lettura", () => provaRipresa({ conferma: "si" }, (m) => m.admin.guasti.add("radar_fonti_stato"))],
    ["fonte_assente", () => provaRipresa({ conferma: "si" }, (m) => (m.admin.tabelle.radar_fonti_stato = m.admin.tabelle.radar_fonti_stato.filter((r) => r.fonte !== "pvl")))],
    ["non_fermo", () => provaRipresa({ conferma: "si" }, undefined, { fermo: false })],
    ["giro_in_corso", () => provaRipresa({ conferma: "si" }, undefined, { bloccoFinoA: "2099-01-01T00:00:00.000Z" })],
    [
      "cambiato_nel_frattempo",
      () =>
        provaRipresa({ conferma: "si" }, (m) => {
          m.admin.primaDiScrivere = (tabella, db) => {
            if (tabella !== "radar_fonti_stato") return false;
            const r = db.tabelle.radar_fonti_stato.find((x) => x.fonte === "pvl");
            if (r) r.aggiornata_il = "2026-11-25T08:00:00.000Z";
            return true;
          };
        }),
    ],
    ["errore_scrittura", () => provaRipresa({ conferma: "si" }, secondaChiamataGuasta)],
  ] as [string, () => Promise<Awaited<ReturnType<typeof provaRipresa>>>][])
    esitiMotivi[nome] = await p();
  const frasiMotivi = Object.values(TESTO_MOTIVO);
  const motiviOk = Object.entries(esitiMotivi).map(([nome, x]) => {
    const atteso = TESTO_MOTIVO[nome] ? `Recupero non ripreso: ${TESTO_MOTIVO[nome]}.` : null;
    // il recupero resta com'era (fermo; non fermo nel caso «non_fermo»; la riga PVL non c'è nel caso «fonte_assente»)
    const fermoRimasto = JSON.stringify(x.fermo) === JSON.stringify(nome === "non_fermo" || nome === "fonte_assente" ? null : BLOCCO_FERMO);
    return { nome, ok: !!atteso && x.esito.errore === atteso && x.registro.length === 0 && x.ripresa === undefined && fermoRimasto, errore: x.esito.errore?.slice(0, 70) };
  });
  controlla(
    "FS15. ogni motivo di rifiuto della ripresa (ambiente, schema, lettura, fonte assente, non fermo, giro in corso, cambiato nel frattempo, scrittura) ha la sua frase in chiaro, tutte diverse; nessuna scrittura né registro",
    motiviOk.length === 8 && motiviOk.every((m) => m.ok) && frasiMotivi.length === 8 && new Set(frasiMotivi).size === 8,
    motiviOk.filter((m) => !m.ok),
  );

  // ═════ K8: accendere TED dalla console solo dove TED si può scrivere (fonteAutorizzata, la regola di importatori e notifiche); il motivo
  // in chiaro all'amministratore; spegnere sempre. Ambienti SOLO in memoria (il database è quello finto, la rete è bloccata) ═════
  const { fonteAutorizzata, PROGETTO_PRODUZIONE: produzioneF } = richiedi(src("lib/radar/ambiente.ts")) as {
    fonteAutorizzata: (f: string, uso: string, env: Record<string, string | undefined>) => { ok: boolean; motivo?: string };
    PROGETTO_PRODUZIONE: string;
  };
  const CHIAVI_AMBIENTE = ["NEXT_PUBLIC_SUPABASE_URL", "VERCEL_ENV"] as const;
  const conAmbienteF = async <T,>(env: Partial<Record<(typeof CHIAVI_AMBIENTE)[number], string>>, f: () => Promise<T>): Promise<T> => {
    const prima = Object.fromEntries(CHIAVI_AMBIENTE.map((k) => [k, process.env[k]]));
    for (const k of CHIAVI_AMBIENTE) {
      if (env[k] === undefined) delete process.env[k];
      else process.env[k] = env[k];
    }
    try {
      return await f();
    } finally {
      for (const k of CHIAVI_AMBIENTE) {
        if (prima[k] === undefined) delete process.env[k];
        else process.env[k] = prima[k];
      }
    }
  };
  const AMBIENTI_TED = {
    locale: {},
    anteprima: { NEXT_PUBLIC_SUPABASE_URL: `https://${stagingF}.supabase.co`, VERCEL_ENV: "preview" },
    produzioneDaLocale: { NEXT_PUBLIC_SUPABASE_URL: `https://${produzioneF}.supabase.co` },
    deployProduzione: { NEXT_PUBLIC_SUPABASE_URL: `https://${produzioneF}.supabase.co`, VERCEL_ENV: "production" },
  } as const;
  const provaTed = async (ambiente: keyof typeof AMBIENTI_TED, campi: Record<string, string>, accesa: boolean) => {
    mondo = mondoFonti();
    for (const r of mondo.admin.tabelle.radar_fonti_stato) if (r.fonte === "ted") r.attiva = accesa;
    const fd = new FormData();
    for (const [k, v] of Object.entries(campi)) fd.append(k, v);
    const azione = azioniTi.impostaFonteTed as (s: unknown, fd: FormData) => Promise<{ errore?: string; ok?: boolean }>;
    const esito = await conAmbienteF(AMBIENTI_TED[ambiente], () => azione({}, fd));
    return {
      esito,
      richieste: mondo.admin.richieste.length,
      attiva: mondo.admin.tabelle.radar_fonti_stato.find((r) => r.fonte === "ted")?.attiva,
      registro: mondo.admin.tabelle.radar_console_registro.filter((r) => r.oggetto === "fonte:ted:attiva").map((r) => r.valore_nuovo),
      motivoAtteso: fonteAutorizzata("ted", "importazione", AMBIENTI_TED[ambiente]).motivo ?? null,
    };
  };
  const tedRifiutati = [] as (Awaited<ReturnType<typeof provaTed>> & { ambiente: string })[];
  for (const amb of ["locale", "anteprima", "produzioneDaLocale"] as const) tedRifiutati.push({ ambiente: amb, ...(await provaTed(amb, { azione: "accendi", conferma: "si" }, false)) });
  const tedDeploy = await provaTed("deployProduzione", { azione: "accendi", conferma: "si" }, false);
  const tedSpegni = [] as Awaited<ReturnType<typeof provaTed>>[];
  for (const amb of ["locale", "anteprima", "produzioneDaLocale"] as const) tedSpegni.push(await provaTed(amb, { azione: "spegni" }, true));
  // senza conferma vale prima la conferma (l'ordine: amministratore, conferma, ambiente)
  const tedSenzaConferma = await provaTed("locale", { azione: "accendi" }, false);
  controlla(
    "FS16. K8: accendere TED dalla console fuori dagli ambienti consentiti (computer locale, anteprima, database di produzione da locale) è rifiutato col motivo di fonteAutorizzata, prima di ogni lettura e senza scritture né registro; dal deploy di produzione si accende; spegnere è sempre ammesso; senza conferma vale prima la conferma",
    tedRifiutati.every((x) => !!x.motivoAtteso && x.esito.errore === x.motivoAtteso && x.richieste === 0 && x.attiva === false && x.registro.length === 0) &&
      new Set(tedRifiutati.map((x) => x.motivoAtteso)).size >= 2 &&
      tedDeploy.motivoAtteso === null && tedDeploy.esito.ok === true && tedDeploy.attiva === true && JSON.stringify(tedDeploy.registro) === JSON.stringify(["true"]) &&
      tedSpegni.every((x) => x.esito.ok === true && x.attiva === false && JSON.stringify(x.registro) === JSON.stringify(["false"])) &&
      tedSenzaConferma.esito.errore === ERRORE_CONFERMA_ACCENSIONE && tedSenzaConferma.richieste === 0,
    {
      rifiutati: tedRifiutati.map((x) => [x.ambiente, x.esito.errore?.slice(0, 60), x.richieste, x.attiva]),
      deploy: [tedDeploy.esito, tedDeploy.attiva, tedDeploy.registro],
      spegni: tedSpegni.map((x) => [x.esito.ok, x.esito.errore?.slice(0, 40), x.attiva]),
      senzaConferma: tedSenzaConferma.esito.errore?.slice(0, 40),
    },
  );
  // la pagina vera: guardia degli amministratori, lettura e vista; il collegamento dalla pagina Tender Intelligence
  const paginaFonti = ((): (() => Promise<unknown>) | null => {
    try {
      return (richiedi(src("app/site-console/(app)/tender-intelligence/fonti/page.tsx")) as { default: () => Promise<unknown> }).default;
    } catch {
      return null;
    }
  })();
  mondo = mondoFonti();
  const albPagina = paginaFonti ? await paginaFonti() : null;
  const elPagina = elementi(albPagina);
  adminAutenticato = false;
  let respinta = false;
  try {
    if (paginaFonti) await paginaFonti();
  } catch {
    respinta = true;
  }
  adminAutenticato = true;
  controlla(
    "FS7. pagina vera /tender-intelligence/fonti: solo amministratori, legge e passa i dati alla vista; collegata dalla pagina Tender Intelligence",
    !!paginaFonti && elPagina.some((e) => e.type === vistaFonti && Array.isArray((e.props.dati as DatiFontiProva | undefined)?.fonti) && (e.props.dati as DatiFontiProva).fonti.length === 4) && respinta &&
      /href="\/tender-intelligence\/fonti"/.test(fs.readFileSync(src("app/site-console/_componenti/tender-intelligence-vista.tsx"), "utf8")),
    { pagina: !!paginaFonti, respinta },
  );
  void tF;

  controlla("MN18. nessuna richiesta di rete in tutta la prova", chiamateRete === 0, chiamateRete);
}

principale()
  .catch((e) => falliti.push(`eccezione: ${e instanceof Error ? e.stack?.split("\n").slice(0, 3).join(" | ") : String(e)}`))
  .finally(() => {
    console.log(`Verifica «Monitorate» e fonti nascoste (pagine vere, database in memoria, dati sintetici): ${ok} ok, ${falliti.length} falliti`);
    for (const f of falliti) console.log(`FALLITO ${f}`);
    process.exit(falliti.length ? 1 : 0);
  });
