// Fase B4 (B1), 23/11/2026 — «Monitorate» e le fonti nascoste ai clienti. Difetto trovato da B2 preparando la L5a (documento 47 §3.1): la
// lista delle gare seguite non filtrava la visibilità delle fonti; una gara salvata con SOLO fonti nascoste (dopo la L5a, una gara solo PVL)
// restava in lista con l'etichetta SBAGLIATA «TED» (ripiego fontiGare.get(p.id) ?? ["ted"]) e la sua scheda non si apriva.
//
// Esegue le pagine VERE («Monitorate» e «Gara aggiunta a mano») e la lettura vera della scheda (leggiGaraPubblica) su database IN MEMORIA:
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
  const c = /^([a-z_]+)\.(is|eq|neq|gt|gte|lt|lte|ov)\.(.+)$/.exec(t);
  if (!c) throw new Error(`or: condizione non prevista «${t}»`);
  const [, col, op, val] = c;
  if (op === "is" && val !== "null") throw new Error(`or: «is» solo con null («${t}»)`);
  return (r) => {
    const v = r[col];
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
  };
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
      return { data: null, error: null };
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
sostituisci(richiedi.resolve("next/cache"), { ...(richiedi("next/cache") as Record<string, unknown>), unstable_cache: (f: unknown) => f, revalidatePath: () => undefined, revalidateTag: () => undefined, updateTag: () => undefined });
const dopo: unknown[] = [];
sostituisci(richiedi.resolve("next/server"), { ...(richiedi("next/server") as Record<string, unknown>), after: (f: unknown) => void dopo.push(f) });

type Elemento = { type: unknown; props: Record<string, unknown> };
type DatiRiga = { href: string; titolo: string; fonte: string; motivi: string[]; monitorata?: boolean };
const PaginaMonitorate = (richiedi(src("app/site-omnia-ai/dashboard/omnia-ai/opportunita/monitorate/page.tsx")) as { default: () => Promise<unknown> }).default;
const PaginaAggiunta = (richiedi(src("app/site-omnia-ai/dashboard/omnia-ai/opportunita/aggiunta/[id]/page.tsx")) as { default: (p: unknown) => Promise<unknown> }).default;
const PaginaScheda = (richiedi(src("app/site-omnia-ai/dashboard/omnia-ai/opportunita/gara/[id]/page.tsx")) as { default: (p: unknown) => Promise<unknown> }).default;
const PaginaCerca = (richiedi(src("app/site-omnia-ai/dashboard/omnia-ai/opportunita/cerca/page.tsx")) as { default: (p: unknown) => Promise<unknown> }).default;
const PaginaPerTe = (richiedi(src("app/site-omnia-ai/dashboard/omnia-ai/opportunita/per-te/page.tsx")) as { default: (p: unknown) => Promise<unknown> }).default;
const RigaGara = (richiedi(src("components/omnia-ai/opportunita/riga-gara.tsx")) as { default: unknown }).default;
const { leggiGaraPubblica } = richiedi(src("lib/radar/gara.ts")) as { leggiGaraPubblica: (admin: unknown, id: string) => Promise<unknown> };
const calcoliFonti = richiedi(src("lib/radar/fonti-gara-calcoli.ts")) as Record<string, unknown>;
type Azione = (stato: unknown, formData: FormData) => Promise<{ errore?: string; ok?: boolean; messaggio?: string }>;
const azioniRadar = richiedi(src("app/actions/radar.ts")) as { aggiornaSalvataggio: Azione; aggiungiGaraAMano: Azione };
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
  controlla(
    "MN9. stato delle fonti non leggibile: valgono le fonti nascoste di base (FONTI_NASCOSTE_PREDEFINITE), SardegnaCAT mai in lista",
    !c.perHref.has(hrefG(G.sardegna)) && c.perHref.has(hrefG(G.pvl)) === !pvlDiBase && c.perHref.has(hrefG(G.ted)),
    { pvlDiBase, avute: ordinati(c.perHref.keys()) },
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
    return { testi: testi(albero), riquadroFonte, notaFonti: nota?.[1] };
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

  controlla("MN18. nessuna richiesta di rete in tutta la prova", chiamateRete === 0, chiamateRete);
}

principale()
  .catch((e) => falliti.push(`eccezione: ${e instanceof Error ? e.stack?.split("\n").slice(0, 3).join(" | ") : String(e)}`))
  .finally(() => {
    console.log(`Verifica «Monitorate» e fonti nascoste (pagine vere, database in memoria, dati sintetici): ${ok} ok, ${falliti.length} falliti`);
    for (const f of falliti) console.log(`FALLITO ${f}`);
    process.exit(falliti.length ? 1 : 0);
  });
