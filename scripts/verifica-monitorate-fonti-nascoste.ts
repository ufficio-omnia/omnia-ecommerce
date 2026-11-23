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
  constructor(tabelle: Record<string, Riga[]>) {
    this.tabelle = structuredClone(tabelle);
  }
  from(tabella: string) {
    return new QueryProva(this, tabella);
  }
}

const confronta = (a: unknown, b: unknown) => String(a ?? "").localeCompare(String(b ?? ""));

class QueryProva implements PromiseLike<Esito> {
  private metodo: "select" | "update" = "select";
  private colonne = "*";
  private filtri: ((r: Riga) => boolean)[] = [];
  private ordini: [string, boolean][] = [];
  private lim: number | null = null;
  private una = false;
  private valori: Riga = {};
  constructor(
    private db: DbProva,
    private tabella: string,
  ) {}
  select(c = "*") {
    this.colonne = c;
    return this;
  }
  update(v: Riga) {
    this.metodo = "update";
    this.valori = v;
    return this;
  }
  eq(c: string, v: unknown) {
    this.filtri.push((r) => r[c] === v);
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
    // le tabelle della 0121 (classificazioni) non esistono nel finto: una lettura incorporata fallisce come in PostgREST
    if (this.colonne.includes("(")) return { data: null, error: { code: "PGRST200", message: "relazione non trovata (tabelle della 0121 assenti nel finto)" } };
    const righe = (this.db.tabelle[this.tabella] ??= []).filter((r) => this.filtri.every((f) => f(r)));
    if (this.metodo === "update") {
      for (const r of righe) Object.assign(r, this.valori);
      return { data: null, error: null };
    }
    let x = righe;
    for (const [c, asc] of [...this.ordini].reverse()) x = [...x].sort((a, b) => (asc ? 1 : -1) * confronta(a[c], b[c]));
    if (this.lim !== null) x = x.slice(0, this.lim);
    const proietta = (r: Riga): Riga =>
      this.colonne.trim() === "*"
        ? { ...r }
        : Object.fromEntries(
            this.colonne
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
              .map((k) => [k, r[k] ?? null]),
          );
    if (this.una) return x.length > 1 ? { data: null, error: { code: "PGRST116", message: "più di una riga" } } : { data: x.length ? proietta(x[0]) : null, error: null };
    return { data: x.map(proietta), error: null };
  }
}

// ═══════════════════════ mondo sintetico ═══════════════════════
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const IMPRESA = id(9001);
const G = { ted: id(1), pvl: id(2), mista: id(3), sintel: id(4), senzaProv: id(5), ignota: id(6), copia: id(7), copiaDiPvl: id(8), ted2: id(9), sardegna: id(10) };
const A = { pvl: id(101), ted2: id(102), libera: id(103), copia: id(104), copiaPvl: id(105) };
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
};
const NASCOSTI = [TITOLO.pvl, TITOLO.ignota, TITOLO.sardegna, TITOLO.copiaDiPvl];

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
    settori: [],
    metodo_settore: null,
    scadenza_giorno: "2026-12-15",
    scadenza_offerte: "2026-12-15T11:00:00Z",
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
    provenienza_campi: null,
  };
}
const avviso = (k: keyof typeof G, fonte: string) => ({ procedura_id: G[k], fonte, id_fonte: `SINT-${k}-${fonte}`, url: null, pubblicato_il: "2026-11-10", tipo_avviso: null, rilevato_il: "2026-11-10T06:00:00Z", aggiornato_il: null });
const aggiunta = (k: keyof typeof A, proceduraId: string | null) => ({
  id: A[k],
  impresa_id: IMPRESA,
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
  impresa_id: IMPRESA,
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
];
const AGGIUNTE = [aggiunta("pvl", G.pvl), aggiunta("ted2", G.ted2), aggiunta("libera", null), aggiunta("copia", G.copia), aggiunta("copiaPvl", G.copiaDiPvl)];

function statoFonti(pvlNascosta: boolean): Riga[] {
  return [
    { fonte: "ted", attiva: true, nascosta_ai_clienti: false, dati_aggiornati_al: null, ultimo_successo_il: "2026-11-22T06:00:00Z" },
    { fonte: "pvl", attiva: true, nascosta_ai_clienti: pvlNascosta, dati_aggiornati_al: null, ultimo_successo_il: "2026-11-22T06:00:00Z" },
    { fonte: "sintel", attiva: false, nascosta_ai_clienti: false, dati_aggiornati_al: null, ultimo_successo_il: null },
    { fonte: "sardegnacat", attiva: false, nascosta_ai_clienti: true, dati_aggiornati_al: null, ultimo_successo_il: null },
  ];
}

function nuovoMondo(pvlNascosta: boolean) {
  const admin = new DbProva({
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
    ],
    radar_procedure_fonti: [avviso("ted", "ted"), avviso("pvl", "pvl"), avviso("mista", "pvl"), avviso("mista", "ted"), avviso("sintel", "sintel"), avviso("ignota", "nuova"), avviso("copia", "pvl"), avviso("copiaDiPvl", "ted"), avviso("ted2", "ted"), avviso("sardegna", "sardegnacat")],
    radar_aggiornamenti: [],
    radar_lotti: [],
  });
  const sessione = new DbProva({ omnia_ai_radar_salvate: SALVATE, omnia_ai_radar_gare_aggiunte: AGGIUNTE });
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
sostituisci(src("lib/radar/guardie-opportunita.ts"), { richiediOpportunitaPagina: async () => ({ contesto: { accountId: IMPRESA, userId: IMPRESA } }) });
sostituisci(src("lib/radar/area-cliente.ts"), { RADICE_OPPORTUNITA, dirittoRadarOppure404: async () => ({ diritto: { operativo: true, messaggioSolaLettura: "" } }) });
// la cache dei dati di Next non esiste fuori da Next: la lettura delle fonti nascoste si esegue ogni volta (nessun ricordo tra gli scenari)
sostituisci(richiedi.resolve("next/cache"), { ...(richiedi("next/cache") as Record<string, unknown>), unstable_cache: (f: unknown) => f });
const dopo: unknown[] = [];
sostituisci(richiedi.resolve("next/server"), { ...(richiedi("next/server") as Record<string, unknown>), after: (f: unknown) => void dopo.push(f) });

type Elemento = { type: unknown; props: Record<string, unknown> };
type DatiRiga = { href: string; titolo: string; fonte: string; motivi: string[]; monitorata?: boolean };
const PaginaMonitorate = (richiedi(src("app/site-omnia-ai/dashboard/omnia-ai/opportunita/monitorate/page.tsx")) as { default: () => Promise<unknown> }).default;
const PaginaAggiunta = (richiedi(src("app/site-omnia-ai/dashboard/omnia-ai/opportunita/aggiunta/[id]/page.tsx")) as { default: (p: unknown) => Promise<unknown> }).default;
const RigaGara = (richiedi(src("components/omnia-ai/opportunita/riga-gara.tsx")) as { default: unknown }).default;
const { leggiGaraPubblica } = richiedi(src("lib/radar/gara.ts")) as { leggiGaraPubblica: (admin: unknown, id: string) => Promise<unknown> };
const calcoliFonti = richiedi(src("lib/radar/fonti-gara-calcoli.ts")) as Record<string, unknown>;
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
    ![G.pvl, G.sardegna, G.ignota, G.copiaDiPvl].some((g) => a.perHref.has(hrefG(g))),
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
  // (la fonte sconosciuta qui non si controlla: la scheda la tratta come visibile, la ricerca no; segnalato a parte, fuori da questa correzione)
  const nascosteSi = await Promise.all([G.pvl, G.sardegna].map(async (g) => (await leggiGaraPubblica(mondo.admin, g)) === null));
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
  const atteseB = ordinati([hrefG(G.ted), hrefG(G.pvl), hrefG(G.mista), hrefG(G.sintel), hrefG(G.senzaProv), hrefG(G.ted2), hrefA(A.libera)]);
  // la gara solo PVL ha una copia collegata pubblicata su TED: le fonti delle copie si attribuiscono alla gara che resta (leggiFontiGare)
  controlla(
    "MN8. PVL visibile: la gara solo PVL torna in lista, con l'aggiunta e la copia collegate raggruppate; SardegnaCAT e la fonte sconosciuta restano fuori",
    JSON.stringify(ordinati(b.perHref.keys())) === JSON.stringify(atteseB) && b.perHref.get(hrefG(G.pvl))?.fonte === "TED e PVL ANAC" && b.perHref.get(hrefG(G.mista))?.fonte === "TED e PVL ANAC" && b.perHref.get(hrefG(G.sintel))?.fonte === "Sintel",
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
  controlla("MN18. nessuna richiesta di rete in tutta la prova", chiamateRete === 0, chiamateRete);
}

principale()
  .catch((e) => falliti.push(`eccezione: ${e instanceof Error ? e.stack?.split("\n").slice(0, 3).join(" | ") : String(e)}`))
  .finally(() => {
    console.log(`Verifica «Monitorate» e fonti nascoste (pagine vere, database in memoria, dati sintetici): ${ok} ok, ${falliti.length} falliti`);
    for (const f of falliti) console.log(`FALLITO ${f}`);
    process.exit(falliti.length ? 1 : 0);
  });
