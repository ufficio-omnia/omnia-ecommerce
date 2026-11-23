// Database IN MEMORIA che imita PostgREST per le sole operazioni del motore delle notifiche (fase B4, B2). Estratto il 23/11/2026 dalla
// verifica del motore (scripts/verifica-radar-b4-db-motore.ts), SENZA cambiarne il comportamento, per usarlo anche nella prova preliminare del
// collaudo Z8 (scripts/collaudo-z8). Aggiunta sola: maybeSingle() (lettura dello stato dell'abbonamento, omnia-ai-access.ts).
// SOLO per prove: nessuna rete, nessun database vero.

// ═══════════════════════ database in memoria (imitazione di PostgREST per le operazioni del motore) ═══════════════════════

export type Riga = Record<string, unknown>;
export type Errore = { code: string; message: string };
export type Richiesta = { tabella: string; metodo: string };

const UNICI: Record<string, string[][]> = {
  omnia_ai_radar_eventi: [["id"], ["impresa_id", "gara_chiave", "tipo", "versione"]],
  omnia_ai_radar_email_consegne: [["id"], ["chiave"]],
  radar_notifiche_giri: [["id"]],
};

export class DbFinto {
  tabelle: Record<string, Riga[]> = {};
  richieste: Richiesta[] = [];
  /** errori iniettati: tabella|metodo → quante volte fallire */
  guasti = new Map<string, number>();
  orologio: () => Date = () => new Date("2026-10-20T06:00:00Z");
  contatore = 0;
  t(nome: string): Riga[] {
    return (this.tabelle[nome] ??= []);
  }
  from(nome: string) {
    return new QueryFinta(this, nome);
  }
  async rpc(nome: string, argomenti: Record<string, unknown>): Promise<{ data: unknown; error: Errore | null }> {
    this.richieste.push({ tabella: `rpc:${nome}`, metodo: "rpc" });
    const guasto = this.guasti.get(`rpc:${nome}|rpc`) ?? 0;
    if (guasto > 0) {
      this.guasti.set(`rpc:${nome}|rpc`, guasto - 1);
      return { data: null, error: { code: "XX000", message: "guasto simulato" } };
    }
    if (nome === "radar_notifiche_stato_passaggio") {
      // O2: la STESSA condizione della funzione SQL (provata su Postgres isolato contro le letture di O1)
      const giorno = String(argomenti.p_giorno), adesso = String(argomenti.p_adesso);
      const giri = this.t("radar_notifiche_giri");
      const lavoro = this.t("omnia_ai_radar_email_consegne").some(
        (c) =>
          (c.stato === "in_coda" && c.prossimo_tentativo_il != null && confronta(c.prossimo_tentativo_il, adesso) <= 0) ||
          (c.stato === "in_invio" && c.in_invio_fino_il != null && confronta(c.in_invio_fino_il, adesso) < 0 && c.prossimo_tentativo_il != null && confronta(c.prossimo_tentativo_il, adesso) <= 0),
      );
      return {
        data: [
          {
            eventi_fatti: giri.some((g) => g.fase === "eventi" && g.giorno_roma === giorno && g.esito === "riuscito"),
            battito_invio: giri.some((g) => g.fase === "invio" && g.giorno_roma === giorno),
            lavoro,
          },
        ],
        error: null,
      };
    }
    if (nome !== "radar_notifiche_destinatari") return { data: null, error: { code: "PGRST202", message: "funzione" } };
    const imprese = (argomenti.p_imprese as string[]) ?? [];
    const utenti = this.t("auth_users");
    const u = (id: string) => utenti.find((x) => x.id === id);
    const riga = (impresa: string, id: string, ruolo: string, attivo: boolean) => {
      const x = u(id);
      if (!x) return null;
      const bloccato = (x.banned_until && Date.parse(String(x.banned_until)) > this.orologio().getTime()) || !!x.deleted_at;
      return { impresa_id: impresa, user_id: id, ruolo, email: x.email, email_confermata: x.email_confermata_il != null, bloccato: !!bloccato, membro_attivo: attivo };
    };
    const esito: Riga[] = [];
    for (const i of imprese) {
      const t = riga(i, i, "titolare", true);
      if (t) esito.push(t);
    }
    for (const m of this.t("omnia_ai_membri")) {
      if (!imprese.includes(String(m.titolare_id))) continue;
      const r = riga(String(m.titolare_id), String(m.membro_id), "ufficio_gare", m.attivo === true);
      if (r) esito.push(r);
    }
    return { data: esito, error: null };
  }
  conta(filtro?: (r: Richiesta) => boolean): number {
    return filtro ? this.richieste.filter(filtro).length : this.richieste.length;
  }
}

const PREDEFINITI: Record<string, () => Riga> = {
  omnia_ai_radar_eventi: () => ({ stato: "attivo", annullato_il: null, motivo_annullamento: null, dati_compattati_il: null, aggiornamento_id: null, procedura_id: null, aggiunta_id: null }),
  omnia_ai_radar_email_consegne: () => ({
    tipo_consegna: "singola",
    evento_id: null,
    inclusa_in: null,
    stato: "in_coda",
    tentativi: 0,
    primo_tentativo_il: null,
    in_invio_fino_il: null,
    provider: null,
    provider_id: null,
    ultimo_errore: null,
    motivo: null,
    inviata_il: null,
    chiusa_il: null,
  }),
  radar_notifiche_giri: () => ({ cursore_modifiche: null, cursore_nuove: null, conteggi: {}, errore: null, finito_il: null }),
};
const ISTANTE_CREAZIONE: Record<string, string> = { omnia_ai_radar_eventi: "creato_il", omnia_ai_radar_email_consegne: "creata_il" };

export class QueryFinta implements PromiseLike<{ data: unknown; error: Errore | null }> {
  private op: "select" | "update" | "insert" | "upsert" | "delete" | null = null;
  private filtri: ((r: Riga) => boolean)[] = [];
  private ordini: [string, boolean][] = [];
  private lim: number | null = null;
  private colonne: string | null = null;
  private ritorna = false;
  private valori: Riga | Riga[] | null = null;
  private opzioni: { onConflict?: string; ignoreDuplicates?: boolean } = {};
  constructor(private db: DbFinto, private tabella: string) {}
  select(c = "*") {
    if (this.op === null) this.op = "select";
    else this.ritorna = true;
    this.colonne = c;
    return this;
  }
  update(v: Riga) {
    this.op = "update";
    this.valori = v;
    return this;
  }
  insert(v: Riga | Riga[]) {
    this.op = "insert";
    this.valori = v;
    return this;
  }
  upsert(v: Riga | Riga[], o: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    this.op = "upsert";
    this.valori = v;
    this.opzioni = o;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(c: string, v: unknown) { this.filtri.push((r) => r[c] === v); return this; }
  neq(c: string, v: unknown) { this.filtri.push((r) => r[c] !== v); return this; }
  gt(c: string, v: string) { this.filtri.push((r) => r[c] != null && confronta(r[c], v) > 0); return this; }
  gte(c: string, v: string) { this.filtri.push((r) => r[c] != null && confronta(r[c], v) >= 0); return this; }
  lt(c: string, v: string) { this.filtri.push((r) => r[c] != null && confronta(r[c], v) < 0); return this; }
  lte(c: string, v: string) { this.filtri.push((r) => r[c] != null && confronta(r[c], v) <= 0); return this; }
  in(c: string, vs: unknown[]) { const s = new Set(vs); this.filtri.push((r) => s.has(r[c])); return this; }
  is(c: string, v: null) { this.filtri.push((r) => (r[c] ?? null) === v); return this; }
  not(c: string, op: string, v: null) { if (op !== "is") throw new Error("not: solo «is»"); this.filtri.push((r) => (r[c] ?? null) !== v); return this; }
  /** filtro «or» di PostgREST: «and(c.op.v,…),c.op.v,…». Parser STRETTO: ogni sintassi non prevista è un errore (mai un filtro ignorato). */
  or(filtri: string) {
    const condizione = (s: string): ((r: Riga) => boolean) => {
      // «c.is.null»: il blocco dei giri degli importatori (blocco_fino_a libero o scaduto), aggiunto per il registro dei giri (K2)
      const nulla = /^([a-z_]+)\.is\.null$/.exec(s);
      if (nulla) return (r) => (r[nulla[1]] ?? null) === null;
      const m = /^([a-z_]+)\.(eq|lt|lte|gt|gte)\.([^,()]+)$/.exec(s);
      if (!m) throw new Error(`or: condizione non prevista «${s}»`);
      const [, c, op, v] = m;
      return (r) => {
        if (op === "eq") return String(r[c] ?? "") === v;
        if (r[c] == null) return false;
        const k = confronta(r[c], v);
        return op === "lt" ? k < 0 : op === "lte" ? k <= 0 : op === "gt" ? k > 0 : k >= 0;
      };
    };
    const rami: ((r: Riga) => boolean)[] = [];
    for (const ramo of filtri.match(/and\([^()]*\)|[^,]+/g) ?? []) {
      const e = /^and\(([^()]*)\)$/.exec(ramo);
      const parti = (e ? e[1].split(",") : [ramo]).map(condizione);
      rami.push((r) => parti.every((p) => p(r)));
    }
    if (rami.length === 0 || (filtri.match(/and\([^()]*\)|[^,]+/g) ?? []).join(",") !== filtri) throw new Error(`or: filtro non previsto «${filtri}»`);
    this.filtri.push((r) => rami.some((p) => p(r)));
    return this;
  }
  order(c: string, o: { ascending?: boolean } = {}) { this.ordini.push([c, o.ascending !== false]); return this; }
  limit(n: number) { this.lim = n; return this; }
  /** come PostgREST: al più una riga, null se nessuna (lettura dell'abbonamento in omnia-ai-access.ts) */
  private una = false;
  maybeSingle() { this.una = true; return this; }
  /** come supabase-js: solo un aiuto per i tipi, nessun effetto */
  returns() { return this; }
  then<A, B>(ok?: ((v: { data: unknown; error: Errore | null }) => A | PromiseLike<A>) | null, ko?: ((e: unknown) => B | PromiseLike<B>) | null): Promise<A | B> {
    return Promise.resolve().then(() => this.esegui()).then(ok, ko);
  }
  private progetta(r: Riga): Riga {
    if (!this.colonne || this.colonne === "*") return { ...r };
    return Object.fromEntries(this.colonne.split(",").map((s) => s.trim()).map((k) => [k, r[k] ?? null]));
  }
  private esegui(): { data: unknown; error: Errore | null } {
    this.db.richieste.push({ tabella: this.tabella, metodo: this.op ?? "?" });
    const chiaveGuasto = `${this.tabella}|${this.op}`;
    const g = this.db.guasti.get(chiaveGuasto) ?? 0;
    if (g > 0) {
      this.db.guasti.set(chiaveGuasto, g - 1);
      return { data: null, error: { code: "08006", message: "guasto iniettato" } };
    }
    const righe = this.db.t(this.tabella);
    const filtrate = () => righe.filter((r) => this.filtri.every((f) => f(r)));
    if (this.op === "select") {
      let x = filtrate();
      for (const [c, asc] of [...this.ordini].reverse()) x = [...x].sort((a, b) => (asc ? 1 : -1) * confronta(a[c], b[c]));
      if (this.lim !== null) x = x.slice(0, this.lim);
      if (this.una) return x.length > 1 ? { data: null, error: { code: "PGRST116", message: "più di una riga" } } : { data: x.length ? this.progetta(x[0]) : null, error: null };
      return { data: x.map((r) => this.progetta(r)), error: null };
    }
    if (this.op === "update") {
      const colpite = filtrate();
      for (const r of colpite) {
        const nuovo = { ...r, ...this.valori };
        const e = vincoli(this.db, this.tabella, nuovo, r);
        if (e) return { data: null, error: e };
      }
      for (const r of colpite) Object.assign(r, this.valori);
      return { data: this.ritorna ? colpite.map((r) => this.progetta(r)) : null, error: null };
    }
    if (this.op === "delete") {
      const colpite = filtrate();
      this.db.tabelle[this.tabella] = righe.filter((r) => !colpite.includes(r));
      if (this.tabella === "omnia_ai_radar_eventi") {
        const ids = new Set(colpite.map((r) => r.id));
        this.db.tabelle.omnia_ai_radar_email_consegne = this.db.t("omnia_ai_radar_email_consegne").filter((c) => !ids.has(c.evento_id));
      }
      return { data: this.ritorna ? colpite.map((r) => this.progetta(r)) : null, error: null };
    }
    // insert / upsert
    const lista = (Array.isArray(this.valori) ? this.valori : [this.valori!]).map((v) => ({ ...v }));
    const scritte: Riga[] = [];
    const ora = this.db.orologio().toISOString();
    for (const v of lista) {
      const completa: Riga = { ...(PREDEFINITI[this.tabella]?.() ?? {}), ...v };
      if (!completa.id) completa.id = `id-${++this.db.contatore}`;
      const creazione = ISTANTE_CREAZIONE[this.tabella];
      if (creazione && !completa[creazione]) completa[creazione] = ora;
      if (this.tabella === "omnia_ai_radar_email_consegne") {
        completa.aggiornata_il ??= ora;
        completa.chiave_idempotenza = `omnia-radar/${completa.id}`;
      }
      const conflitto = this.opzioni.onConflict?.split(",").map((s) => s.trim());
      const esistente = conflitto ? righe.find((r) => conflitto.every((k) => r[k] === completa[k])) : undefined;
      if (this.op === "upsert" && esistente) {
        if (this.opzioni.ignoreDuplicates) continue;
        const nuovo = { ...esistente, ...v };
        const e = vincoli(this.db, this.tabella, nuovo, esistente);
        if (e) return { data: null, error: e };
        Object.assign(esistente, v);
        scritte.push(esistente);
        continue;
      }
      // come PostgREST (ON CONFLICT sulle SOLE colonne indicate): un doppione su un'altra chiave unica è un errore, non si ignora
      const e = vincoli(this.db, this.tabella, completa, null);
      if (e) return { data: null, error: e };
      righe.push(completa);
      scritte.push(completa);
    }
    return { data: this.ritorna ? scritte.map((r) => this.progetta(r)) : null, error: null };
  }
}

export function confronta(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  const da = Date.parse(String(a)), db = Date.parse(String(b));
  if (/^\d{4}-\d{2}-\d{2}/.test(String(a)) && /^\d{4}-\d{2}-\d{2}/.test(String(b)) && Number.isFinite(da) && Number.isFinite(db) && da !== db) return da - db;
  return String(a) < String(b) ? -1 : 1;
}

/** I vincoli della 0125 che contano qui: chiavi uniche, «uno alla volta», separazione tra imprese, stato «inclusa». */
function vincoli(db: DbFinto, tabella: string, nuovo: Riga, vecchio: Riga | null): Errore | null {
  for (const chiave of UNICI[tabella] ?? []) {
    if (db.t(tabella).some((r) => r !== vecchio && chiave.every((k) => r[k] === nuovo[k]))) return { code: "23505", message: `unico ${chiave.join(",")}` };
  }
  if (tabella === "radar_notifiche_giri" && nuovo.esito === "in_corso" && db.t(tabella).some((r) => r !== vecchio && r.esito === "in_corso")) return { code: "23505", message: "uno alla volta" };
  if (tabella === "omnia_ai_radar_email_consegne") {
    if ((nuovo.stato === "inclusa") !== (nuovo.inclusa_in != null)) return { code: "23514", message: "inclusa" };
    if ((nuovo.tipo_consegna === "singola") !== (nuovo.evento_id != null)) return { code: "23514", message: "tipo_evento" };
    if (nuovo.ruolo === "titolare" && nuovo.destinatario_id !== nuovo.impresa_id) return { code: "23514", message: "separazione titolare" };
    if (nuovo.ruolo === "ufficio_gare" && !db.t("omnia_ai_membri").some((m) => m.membro_id === nuovo.destinatario_id && m.titolare_id === nuovo.impresa_id && m.attivo === true)) {
      return { code: "23514", message: "separazione membro" };
    }
    if (nuovo.evento_id) {
      const e = db.t("omnia_ai_radar_eventi").find((x) => x.id === nuovo.evento_id);
      if (!e || e.impresa_id !== nuovo.impresa_id) return { code: "23514", message: "separazione evento" };
    }
    if (nuovo.stato === "inviata" && (!nuovo.inviata_il || !nuovo.provider || !nuovo.provider_id)) return { code: "23514", message: "inviata" };
  }
  return null;
}
