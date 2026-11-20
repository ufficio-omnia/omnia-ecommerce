// Verifica della fase B4, MOTORE delle notifiche email (B2, Fase A del 20/11/2026). Livello 1: NESSUN database vero, NESSUNA rete (fetch
// bloccato). Il motore gira su un database IN MEMORIA che imita PostgREST per le sole operazioni che usa, con i vincoli che contano
// (chiavi uniche non parziali, «uno alla volta» dei giri, separazione tra imprese delle consegne) e il CONTEGGIO delle richieste.
// Provider: il FINTO del motore. Modello delle email: quello vero di B1 (componiEmailRadar), così la composizione è provata davvero.
// Uso: npx tsx scripts/verifica-radar-b4-db-motore.ts   → codice 0 se tutto passa, 1 altrimenti.
import fs from "fs";
import path from "path";
import { componiEmailRadar } from "../src/lib/radar/email-modelli";
import { dipendenzeReali, eseguiPassaggio, eseguiRavvicinata, ultimoPassaggioProgrammato, type DipendenzeMotore, type StatoAccesso } from "../src/lib/radar/notifiche/motore";
import { PARAMETRI_PROPOSTI, type ParametriNotifiche } from "../src/lib/radar/notifiche/parametri";
import { ProviderFinto, resendConsentito, sceltaProvider, type CopioneFinto } from "../src/lib/radar/notifiche/provider";
import { classificaRispostaResend, creaProviderResend, quotaDaIntestazioni, richiestaResend } from "../src/lib/radar/notifiche/provider-resend";
import { esitoDopoInvio, pianoInvioCompleto, type ConsegnaInCoda } from "../src/lib/radar/notifiche/coda-calcoli";
import { eventiModifica, gareDelleListe, eventoRiepilogo, chiaveAvviso, scadenzaDaRegistro, type RigaModifica, type RigaGara, type RigaNuova } from "../src/lib/radar/notifiche/eventi-calcoli";
import { dopoIngressoInLista } from "../src/lib/radar/notifiche/ravvicinata";
import { giornoRoma } from "../src/lib/radar/notifiche/calendario";
import type { EventoRiepilogo, TipoEvento } from "../src/lib/radar/notifiche/tipi";

// rete bloccata: qualunque fetch fa fallire la verifica
globalThis.fetch = (async () => {
  throw new Error("RETE VIETATA nella verifica del motore B4");
}) as typeof fetch;

let ok = 0;
const falliti: string[] = [];
function controlla(nome: string, condizione: boolean, dettaglio?: unknown): void {
  if (condizione) ok++;
  else falliti.push(`${nome}${dettaglio === undefined ? "" : ` → ${JSON.stringify(dettaglio).slice(0, 600)}`}`);
}

// ═══════════════════════ database in memoria (imitazione di PostgREST per le operazioni del motore) ═══════════════════════

type Riga = Record<string, unknown>;
type Errore = { code: string; message: string };
type Richiesta = { tabella: string; metodo: string };

const UNICI: Record<string, string[][]> = {
  omnia_ai_radar_eventi: [["id"], ["impresa_id", "gara_chiave", "tipo", "versione"]],
  omnia_ai_radar_email_consegne: [["id"], ["chiave"]],
  radar_notifiche_giri: [["id"]],
};

class DbFinto {
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

class QueryFinta implements PromiseLike<{ data: unknown; error: Errore | null }> {
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
  order(c: string, o: { ascending?: boolean } = {}) { this.ordini.push([c, o.ascending !== false]); return this; }
  limit(n: number) { this.lim = n; return this; }
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

function confronta(a: unknown, b: unknown): number {
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

// ═══════════════════════ dati SINTETICI (dichiarati come tali: imprese, persone e gare inventate) ═══════════════════════

const U = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const I1 = U(1), I2 = U(2), I3 = U(3), M1 = U(11), M2 = U(12), MB = U(21);
const STAGING = { NEXT_PUBLIC_SUPABASE_URL: "https://ryawdldqiumqsskrnyps.supabase.co", RADAR_NOTIFICHE_EMAIL: "attivo", RADAR_EMAIL_ORIGINE: "http://localhost:3000" };

type Mondo = { db: DbFinto; provider: ProviderFinto; d: DipendenzeMotore; ora: { t: Date }; accesso: Map<string, StatoAccesso> };

function giorno(base: string, n: number): string {
  const d = new Date(`${base}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Una gara sintetica dell'archivio. */
function gara(n: number, x: Partial<RigaGara> & { chiave?: string } = {}): RigaGara {
  return {
    id: U(100 + n),
    chiave: x.chiave ?? `ted:SINT-${n}`,
    oggetto: `Gara sintetica ${n} — servizi di pulizia (dati inventati)`,
    sa_denominazione: `Ente sintetico ${n}`,
    luogo_regioni: ["lombardia"],
    tipo_opportunita: "bando",
    tipo_procedura: "aperta",
    valore_stimato: 100000 + n,
    data_pubblicazione: "2026-10-18",
    scadenza_giorno: null,
    scadenza_offerte: null,
    scadenza_ora_indicata: false,
    stato: "aperta",
    unita_a: null,
    url_avviso: `https://esempio.invalid/avviso/${n}`,
    url_documenti: null,
    prima_rilevazione_il: "2026-10-18T08:00:00Z",
    ultima_rilevazione_il: "2026-10-19T08:00:00Z",
    fonti: [String(x.chiave ?? "ted").split(":")[0]],
    ...x,
  };
}

function mondo(opzioni: { parametri?: Partial<ParametriNotifiche>; copione?: CopioneFinto; quota?: number | null; env?: Record<string, string | undefined>; inizio?: string } = {}): Mondo {
  const db = new DbFinto();
  const ora = { t: new Date(opzioni.inizio ?? "2026-10-20T05:30:00Z") };
  db.orologio = () => ora.t;
  const accesso = new Map<string, StatoAccesso>([[I1, "attivo"], [I2, "prova"], [I3, "attivo"]]);
  db.tabelle.auth_users = [
    { id: I1, email: "titolare1@prova.test", email_confermata_il: "2026-01-01" },
    { id: I2, email: "titolare2@prova.test", email_confermata_il: "2026-01-01" },
    { id: I3, email: "titolare3@prova.test", email_confermata_il: "2026-01-01" },
    { id: M1, email: "ufficio1@prova.test", email_confermata_il: "2026-01-01" },
    { id: M2, email: "sospeso1@prova.test", email_confermata_il: "2026-01-01" },
    { id: MB, email: "bloccato2@prova.test", email_confermata_il: "2026-01-01", banned_until: "2099-01-01T00:00:00Z" },
  ];
  db.tabelle.omnia_ai_membri = [
    { membro_id: M1, titolare_id: I1, attivo: true },
    { membro_id: M2, titolare_id: I1, attivo: false },
    { membro_id: MB, titolare_id: I2, attivo: true },
  ];
  db.tabelle.omnia_ai_radar_impostazioni = [I1, I2, I3].map((u) => ({ user_id: u, attivo: true }));
  db.tabelle.omnia_ai_radar_notifiche_impresa = [
    { impresa_id: I1, email_attive: true },
    { impresa_id: I2, email_attive: true },
    { impresa_id: I3, email_attive: false },
  ];
  const tutte = { nuove_opportunita: true, scadenze: true, rettifiche: true, email_bloccata_il: null, motivo_blocco: null };
  db.tabelle.omnia_ai_radar_notifiche_persone = [
    { impresa_id: I1, user_id: I1, ...tutte },
    { impresa_id: I1, user_id: M1, ...tutte, nuove_opportunita: false },
    { impresa_id: I1, user_id: M2, ...tutte },
    { impresa_id: I2, user_id: I2, ...tutte, nuove_opportunita: false },
    { impresa_id: I2, user_id: MB, ...tutte },
    { impresa_id: I3, user_id: I3, ...tutte },
  ];
  db.tabelle.radar_fonti_stato = [{ fonte: "sardegnacat", nascosta_ai_clienti: true }, { fonte: "ted", nascosta_ai_clienti: false }];
  // archivio sintetico (giorni contati dal 20/10/2026, cambio dell'ora il 25/10/2026)
  db.tabelle.radar_procedure = [
    gara(1, { scadenza_giorno: "2026-10-30", scadenza_offerte: "2026-10-30T11:00:00Z", scadenza_ora_indicata: true }), // 10 giorni
    gara(2, { chiave: "pvl:SINT-2", scadenza_giorno: "2026-10-25" }), // 5 giorni, senza ora
    gara(3, { scadenza_giorno: "2026-10-21", scadenza_offerte: "2026-10-21T10:00:00Z", scadenza_ora_indicata: true }), // lotti con scadenze diverse
    gara(4, { chiave: "sardegnacat:SINT-4", scadenza_giorno: "2026-10-30" }), // fonte nascosta ai clienti
    gara(5, { stato: "annullata", scadenza_giorno: "2026-10-30" }),
  ];
  db.tabelle.radar_lotti = [
    { procedura_id: U(103), numero_lotto: "1", oggetto: "Lotto 1", cig: "AAAAAAAAA1", scadenza_giorno: "2026-10-21", scadenza_offerte: "2026-10-21T10:00:00Z", scadenza_ora_indicata: true },
    { procedura_id: U(103), numero_lotto: "2", oggetto: "Lotto 2", cig: "AAAAAAAAA2", scadenza_giorno: "2026-10-25", scadenza_offerte: null, scadenza_ora_indicata: false },
    { procedura_id: U(103), numero_lotto: "3", oggetto: "Lotto 3", cig: "AAAAAAAAA3", scadenza_giorno: null, scadenza_offerte: null, scadenza_ora_indicata: false },
  ];
  db.tabelle.omnia_ai_radar_gare_aggiunte = [
    { id: U(201), user_id: I1, cig: null, url: null, oggetto: "Gara aggiunta a mano (sintetica)", ente: "Ente sintetico A", scadenza_giorno: "2026-10-21", scadenza_offerte: null, scadenza_ora_indicata: false, procedura_id: null, creata_il: "2026-10-10T08:00:00Z", aggiornata_il: "2026-10-10T08:00:00Z" },
  ];
  db.tabelle.omnia_ai_radar_salvate = [
    { user_id: I1, procedura_id: U(101), aggiunta_id: null, creata_il: "2026-10-15T08:00:00Z" },
    { user_id: I1, procedura_id: U(103), aggiunta_id: null, creata_il: "2026-10-15T08:00:00Z" },
    { user_id: I1, procedura_id: U(104), aggiunta_id: null, creata_il: "2026-10-15T08:00:00Z" },
    { user_id: I1, procedura_id: U(105), aggiunta_id: null, creata_il: "2026-10-15T08:00:00Z" },
    { user_id: I1, procedura_id: null, aggiunta_id: U(201), creata_il: "2026-10-10T08:00:00Z" },
    { user_id: I2, procedura_id: U(102), aggiunta_id: null, creata_il: "2026-10-10T08:00:00Z" },
    // salvata OGGI: nessun promemoria a 10 giorni (nessun recupero per le gare salvate tardi)
    { user_id: I2, procedura_id: U(101), aggiunta_id: null, creata_il: "2026-10-20T05:00:00Z" },
    { user_id: I3, procedura_id: U(101), aggiunta_id: null, creata_il: "2026-10-01T08:00:00Z" },
  ];
  db.tabelle.radar_aggiornamenti = [];
  db.tabelle.omnia_ai_radar_profili = [
    { user_id: I1, posizione: 1, settori: ["pulizia"], sottocategorie: {}, regioni: ["lombardia"], tipi_procedura: [], importo_min: null, importo_max: null, vedere_correlate: true, aggiornato_il: "2026-10-01T00:00:00Z" },
  ];
  db.tabelle.radar_classificazioni_stato = [];
  db.tabelle.radar_classificazioni = [];
  const provider = new ProviderFinto({ copione: opzioni.copione, quota: opzioni.quota });
  let n = 0;
  const d: DipendenzeMotore = {
    admin: db as unknown as DipendenzeMotore["admin"],
    env: opzioni.env ?? STAGING,
    provider,
    componi: componiEmailRadar,
    parametri: { ...PARAMETRI_PROPOSTI, ...opzioni.parametri },
    statoAccesso: async (id) => {
      db.richieste.push({ tabella: "subscriptions", metodo: "select" });
      return accesso.get(id) ?? "cessato";
    },
    adesso: () => ora.t,
    nuovoId: () => U(900000 + ++n),
    attendi: async () => undefined,
    ultimoPassaggio: ultimoPassaggioProgrammato,
    cursoreNuoveIniziale: () => "2026-10-13T00:00:00Z",
  };
  return { db, provider, d, ora, accesso };
}

const consegne = (m: Mondo) => m.db.t("omnia_ai_radar_email_consegne");
const eventi = (m: Mondo) => m.db.t("omnia_ai_radar_eventi");
const di = (m: Mondo, f: (c: Riga) => boolean) => consegne(m).filter(f);
const tipoDi = (m: Mondo, c: Riga) => String(eventi(m).find((e) => e.id === c.evento_id)?.tipo ?? "");

async function principale(): Promise<void> {
  // ───── 1. guardie: spento, anteprima, produzione, provider ─────
  for (const [nome, env] of [
    ["interruttore spento", { NEXT_PUBLIC_SUPABASE_URL: STAGING.NEXT_PUBLIC_SUPABASE_URL }],
    ["anteprima", { ...STAGING, VERCEL_ENV: "preview" }],
    ["produzione", { ...STAGING, NEXT_PUBLIC_SUPABASE_URL: "https://bihfrzspqxsrzlbqqvqa.supabase.co", VERCEL_ENV: "production" }],
    ["origine di produzione", { ...STAGING, RADAR_EMAIL_ORIGINE: "https://omnia-ai.it" }],
  ] as const) {
    const m = mondo({ env });
    const e = await eseguiPassaggio(m.d);
    controlla(`guardia «${nome}»: nessun passaggio e 0 richieste al database`, e.eseguito === false && m.db.conta() === 0 && m.provider.consegnate.length === 0, { e, richieste: m.db.conta() });
  }
  {
    const m = mondo();
    const e = await eseguiPassaggio({ ...m.d, provider: { nome: "resend", invia: async () => ({ esito: "inviata", providerId: "x" }), quotaResidua: () => null } });
    controlla("guardia: un provider diverso dal finto non parte (Resend chiuso)", e.eseguito === false && m.db.conta() === 0);
    controlla("resendConsentito() è sempre falso", resendConsentito() === false);
    controlla("sceltaProvider() dà sempre il finto", sceltaProvider().nome === "finto");
    let lanciato = false;
    try {
      creaProviderResend("chiave-finta", async () => ({ status: 200, json: async () => ({}), headers: { get: () => null } }));
    } catch {
      lanciato = true;
    }
    controlla("creaProviderResend non si costruisce nella B4", lanciato);
    const dr = await dipendenzeReali({}, PARAMETRI_PROPOSTI).catch(() => null);
    controlla("dipendenzeReali usa il provider finto", !dr || dr.provider.nome === "finto");
  }

  // ───── 2. primo giro (20/10/2026 07:30 a Roma): eventi, consegne, invii ─────
  const m = mondo();
  const e1 = await eseguiPassaggio(m.d);
  controlla("primo passaggio eseguito", e1.eseguito === true, e1);
  const tipiEventi = eventi(m).map((e) => `${e.impresa_id === I1 ? "I1" : e.impresa_id === I2 ? "I2" : "I3"}:${e.gara_chiave}:${e.tipo}:${e.versione}`).sort();
  const attesi = [
    `I1:a:${U(201)}:scadenza_1:2026-10-21`, // gara aggiunta a mano, scadenza dell'impresa
    `I1:p:${U(101)}:scadenza_10:2026-10-30T11:00:00.000Z`,
    `I1:p:${U(103)}:scadenza_1:2026-10-21T10:00:00.000Z`, // lotto 1
    `I1:p:${U(103)}:scadenza_5:2026-10-25`, // lotto 2 (gruppo distinto, senza ora)
    `I2:p:${U(102)}:scadenza_5:2026-10-25`, // PVL sullo staging
  ].sort();
  controlla("eventi del primo giro: esattamente i promemoria attesi (gruppi di lotti, gara aggiunta, nessuna fonte nascosta, nessuna gara annullata, nessuna salvata oggi, impresa con le email spente esclusa)", JSON.stringify(tipiEventi.filter((t) => !t.includes("riepilogo"))) === JSON.stringify(attesi), tipiEventi);
  controlla("nessun evento per la gara della fonte nascosta (SardegnaCAT)", !eventi(m).some((e) => e.gara_chiave === `p:${U(104)}`));
  controlla("nessun evento per la gara annullata", !eventi(m).some((e) => e.gara_chiave === `p:${U(105)}`));
  controlla("nessun evento per l'impresa con le email spente", !eventi(m).some((e) => e.impresa_id === I3));
  const destinatari = new Set(consegne(m).map((c) => c.destinatario_id));
  controlla("consegne solo al titolare e all'Ufficio Gare ATTIVO (mai al membro sospeso né all'utente bloccato)", destinatari.has(I1) && destinatari.has(M1) && destinatari.has(I2) && !destinatari.has(M2) && !destinatari.has(MB) && !destinatari.has(I3), [...destinatari]);
  controlla("tutte le consegne inviate con il provider finto", consegne(m).every((c) => c.stato === "inviata" && c.provider === "finto" && String(c.provider_id).startsWith("finto-")), consegne(m).map((c) => c.stato));
  controlla("una email per consegna, nessun doppione", m.provider.consegnate.length === consegne(m).length && new Set(m.provider.consegnate.map((x) => x.chiave)).size === m.provider.consegnate.length);
  controlla("chiave di idempotenza = omnia-radar/<id della consegna>", consegne(m).every((c) => m.provider.consegnate.some((x) => x.chiave === `omnia-radar/${c.id}`)));
  controlla("nessun indirizzo email salvato nelle tabelle del motore", !JSON.stringify([eventi(m), consegne(m), m.db.t("radar_notifiche_giri")]).includes("@prova.test"));
  const giri1 = m.db.t("radar_notifiche_giri");
  controlla("giro «eventi» riuscito con i cursori, più il giro «invio»", giri1.some((g) => g.fase === "eventi" && g.esito === "riuscito" && g.cursore_nuove) && giri1.some((g) => g.fase === "invio" && g.esito === "riuscito"), giri1);
  const richiestePrimo = m.db.conta();
  controlla("richieste del primo passaggio (fase «eventi» completa e invio): ≤ 50", richiestePrimo <= 50, { richiestePrimo, dettaglio: m.db.richieste.map((r) => `${r.tabella}:${r.metodo}`) });
  // nessun N+1: con 40 gare in più nelle liste (e 40 promemoria in più) le richieste al database NON crescono con le gare
  {
    const grande = mondo();
    for (let i = 0; i < 40; i++) {
      const g = gara(800 + i, { scadenza_giorno: "2026-10-30" });
      grande.db.t("radar_procedure").push(g);
      grande.db.t("omnia_ai_radar_salvate").push({ user_id: I1, procedura_id: g.id, aggiunta_id: null, creata_il: "2026-10-01T08:00:00Z" });
    }
    await eseguiPassaggio(grande.d);
    const senzaInvii = (x: Mondo) => x.db.richieste.filter((r) => r.tabella !== "subscriptions").length;
    const nGrande = senzaInvii(grande), nPiccolo = senzaInvii(m) ;
    // le richieste crescono SOLO a blocchi di 50 consegne da inviare (ogni blocco: presa in carico, eventi, ricontrollo ≈ 12), mai per gara
    const blocchiInPiu = Math.ceil(consegne(grande).length / 50) - Math.ceil(consegne(m).length / 50);
    controlla("nessun N+1: 40 gare e 40 promemoria in più aggiungono richieste solo per blocchi di 50 consegne (≤ 12 a blocco, + 2)", nGrande - nPiccolo <= 12 * blocchiInPiu + 2 && eventi(grande).length >= eventi(m).length + 40, { nGrande, nPiccolo, blocchiInPiu, consegne: consegne(grande).length });
  }

  // ───── 3. stesso giorno di nuovo: 0 righe nuove, 0 email ─────
  const prima = { e: eventi(m).length, c: consegne(m).length, p: m.provider.consegnate.length };
  m.ora.t = new Date("2026-10-20T06:00:00Z");
  const richiestePrimaDelSecondo = m.db.conta();
  const e2 = await eseguiPassaggio(m.d);
  controlla("rieseguito lo stesso giorno: fase «eventi» saltata, 0 eventi, 0 consegne, 0 email", e2.eseguito && "saltata" in e2.eventi && eventi(m).length === prima.e && consegne(m).length === prima.c && m.provider.consegnate.length === prima.p, e2);
  const richiesteVuoto = m.db.conta() - richiestePrimaDelSecondo;
  controlla("passaggio vuoto (N7): ≤ 3 richieste e nessun giro «invio» in più dopo il battito", richiesteVuoto <= 3 && m.db.t("radar_notifiche_giri").filter((g) => g.fase === "invio").length === 1, { richiesteVuoto });

  // ───── 3-bis. fase «eventi» caduta prima della chiusura e rifatta lo stesso giorno: chiavi uniche, nessun doppione ─────
  {
    const k = mondo();
    await eseguiPassaggio(k.d);
    const n = { e: eventi(k).length, c: consegne(k).length, p: k.provider.consegnate.length };
    for (const g of k.db.t("radar_notifiche_giri")) if (g.fase === "eventi") Object.assign(g, { esito: "fallito", errore: "processo_caduto" });
    k.ora.t = new Date("2026-10-20T06:00:00Z");
    const e = await eseguiPassaggio(k.d);
    controlla("fase «eventi» rifatta dopo una caduta: 0 eventi, 0 consegne, 0 email in più", e.eseguito && !("saltata" in e.eventi) && eventi(k).length === n.e && consegne(k).length === n.c && k.provider.consegnate.length === n.p && n.e > 0, { prima: n, e });
  }

  // ───── 4. proroga TED e la stessa notizia dalla PVL: un solo evento, i promemoria della vecchia scadenza annullati ─────
  m.db.t("omnia_ai_radar_email_consegne").push(); // nulla
  const vecchia = "2026-10-30T11:00:00Z", nuova = "2026-11-06T11:00:00Z";
  const p1 = m.db.t("radar_procedure").find((p) => p.id === U(101))!;
  Object.assign(p1, { scadenza_giorno: "2026-11-06", scadenza_offerte: nuova, fonti: ["ted", "pvl"] });
  const base = { procedura_id: U(101), campo: "scadenza_offerte", valore_precedente: vecchia, valore_nuovo: nuova, notificabile: true, notifica_email: true, avviso_url: "https://esempio.invalid/rettifica", avviso_pubblicato_il: "2026-10-20", dichiarazione_fonte: "cor-buy" };
  m.db.t("radar_aggiornamenti").push(
    { id: U(301), tipo: "proroga", fonte: "ted", id_fonte: "123456-2026", avviso_ted: null, affidabilita: "avviso_ufficiale", rilevato_il: "2026-10-20T09:00:00Z", ...base },
    { id: U(302), tipo: "proroga", fonte: "pvl", id_fonte: "pvl-avviso-9", avviso_ted: null, affidabilita: "confronto_versioni", rilevato_il: "2026-10-20T10:00:00Z", ...base, valore_nuovo: "2026-11-06T12:00:00+01:00" },
    // mai email: cambio del solo collegamento, riclassificazione, fonte nascosta, Sintel non di scadenza
    { id: U(303), tipo: "rettifica", campo: "url_documenti", fonte: "ted", id_fonte: "123456-2026", procedura_id: U(101), valore_precedente: "a", valore_nuovo: "b", notificabile: true, notifica_email: true, affidabilita: "avviso_ufficiale", rilevato_il: "2026-10-20T09:00:00Z", avviso_url: null, avviso_pubblicato_il: null, avviso_ted: null, dichiarazione_fonte: null },
    { id: U(304), tipo: "correzione_dati", campo: "settori", fonte: "ted", id_fonte: "x", procedura_id: U(101), valore_precedente: null, valore_nuovo: null, notificabile: false, notifica_email: false, affidabilita: null, rilevato_il: "2026-10-20T09:00:00Z", avviso_url: null, avviso_pubblicato_il: null, avviso_ted: null, dichiarazione_fonte: null },
  );
  m.ora.t = new Date("2026-10-21T05:30:00Z");
  const e3 = await eseguiPassaggio(m.d);
  const proroghe = eventi(m).filter((e) => e.tipo === "proroga");
  controlla("proroga: un solo evento per impresa anche con TED e PVL (versione = nuova scadenza)", proroghe.length === 2 && proroghe.every((e) => e.versione === "scadenza:2026-11-06T11:00:00.000Z"), proroghe.map((e) => [e.impresa_id, e.versione]));
  controlla("proroga: I3 (email spente) senza evento; I2 la riceve (gara in lista)", proroghe.some((e) => e.impresa_id === I1) && proroghe.some((e) => e.impresa_id === I2) && !proroghe.some((e) => e.impresa_id === I3));
  const dieci = eventi(m).find((e) => e.tipo === "scadenza_10" && e.gara_chiave === `p:${U(101)}` && e.impresa_id === I1);
  controlla("proroga: il promemoria della vecchia scadenza è annullato («scadenza_cambiata»)", dieci?.stato === "annullato" && dieci?.motivo_annullamento === "scadenza_cambiata", dieci);
  const datiProroga = proroghe.find((e) => e.impresa_id === I1)?.dati as { cambioScadenza?: { precedente: { istante: string }; nuova: { istante: string } }; evidenza?: { motivoFonte: string | null; affidabilita: string } } | undefined;
  controlla("proroga: prima e dopo dall'evidenza, motivo della fonte tradotto, affidabilità ufficiale", datiProroga?.cambioScadenza?.precedente.istante === "2026-10-30T11:00:00.000Z" && datiProroga?.cambioScadenza?.nuova.istante === "2026-11-06T11:00:00.000Z" && datiProroga?.evidenza?.motivoFonte === "Correzione da parte dell'amministrazione aggiudicatrice" && datiProroga?.evidenza?.affidabilita === "avviso_ufficiale", datiProroga);
  controlla("nessun evento dal solo cambio del collegamento né dalla riclassificazione", !eventi(m).some((e) => e.aggiornamento_id === U(303) || e.aggiornamento_id === U(304)));
  controlla("cursore delle modifiche avanzato all'ultima letta", m.db.t("radar_notifiche_giri").some((g) => g.fase === "eventi" && g.giorno_roma === "2026-10-21" && g.cursore_modifiche === "2026-10-20T10:00:00Z"));
  controlla("conteggi del giro: modifiche saltate col motivo (il solo collegamento cambiato); la riclassificazione non si legge nemmeno (notifica_email falso)", e3.eseguito && !("saltata" in e3.eventi) && (e3.eventi as Record<string, number>).modifiche_saltate_documenti === 1 && !("modifiche_saltate_non_notificabile" in (e3.eventi as object)), e3);

  // ───── 5. stesso giro rieseguito domani di nuovo: la stessa proroga non rinasce ─────
  m.ora.t = new Date("2026-10-22T05:30:00Z");
  await eseguiPassaggio(m.d);
  controlla("la stessa proroga non dà un secondo evento nei giorni dopo", eventi(m).filter((e) => e.tipo === "proroga").length === 2);
  controlla("nessuna email doppia in tutto (chiavi distinte)", new Set(m.provider.consegnate.map((x) => x.chiave)).size === m.provider.consegnate.length);

  // ───── 6. riepilogo: solo A, B mai (anche con le correlate accese), gare senza luogo escluse con profilo regionale, N5 ─────
  await provaRiepilogo();

  // ───── 7. tetto per persona: 20 urgenti → 15 singole + 1 raggruppata con 5 incluse, nessun doppione ─────
  await provaTetto();

  // ───── 8. errori del provider, nuovi tentativi, affitti scaduti, caduta tra invio e scrittura ─────
  await provaErrori();

  // ───── 9. ricontrollo all'invio ─────
  await provaRicontrollo();

  // ───── 10. avviso «ravvicinato» ─────
  await provaRavvicinata();

  // ───── 11. parametri N1, N6, N7 e conservazione ─────
  await provaParametri();

  // ───── 11bis. difetto del 20/11: proroga di UN solo lotto ─────
  await provaLotti();

  // ───── 12. adattatore Resend (chiuso): classificazione delle risposte ─────
  provaResend();

  // ───── 13. guardia delle fonti nel calcolo delle modifiche (fonteAutorizzata, uso «notifiche») ─────
  provaD5();

  // ───── 14. simulazione di 10 giorni (con il cambio d'ora del 25/10/2026) ─────
  await provaSimulazione();

  // ───── 15. testo dei file e rotta ─────
  provaTesto();
  await provaRotta();
}

async function provaRotta(): Promise<void> {
  const { GET } = await import("../src/app/api/cron/radar-promemoria/route");
  const salvato = { segreto: process.env.CRON_SECRET, email: process.env.RADAR_NOTIFICHE_EMAIL };
  try {
    delete process.env.RADAR_NOTIFICHE_EMAIL;
    process.env.CRON_SECRET = "segreto-di-prova-sintetico";
    const richiesta = (h: Record<string, string>) => ({ headers: new Headers(h) }) as unknown as Parameters<typeof GET>[0];
    const senza = await GET(richiesta({}));
    controlla("rotta: senza il segreto del cron → 401", senza.status === 401);
    const sbagliato = await GET(richiesta({ authorization: "Bearer altro" }));
    controlla("rotta: segreto sbagliato → 401", sbagliato.status === 401);
    const giusto = await GET(richiesta({ authorization: "Bearer segreto-di-prova-sintetico" }));
    const corpo = (await giusto.json()) as { eseguito?: boolean; motivo?: string };
    controlla("rotta: segreto giusto e interruttore spento → nessun passaggio («spento»)", giusto.status === 200 && corpo.eseguito === false && corpo.motivo === "spento", corpo);
    delete process.env.CRON_SECRET;
    const vuoto = await GET(richiesta({ authorization: "Bearer undefined" }));
    controlla("rotta: senza CRON_SECRET impostato nessuna chiamata passa", vuoto.status === 401);
  } finally {
    if (salvato.segreto === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = salvato.segreto;
    if (salvato.email === undefined) delete process.env.RADAR_NOTIFICHE_EMAIL;
    else process.env.RADAR_NOTIFICHE_EMAIL = salvato.email;
  }
}

async function provaRiepilogo(): Promise<void> {
  const m = mondo();
  const nuove: RigaGara[] = [];
  for (let i = 0; i < 25; i++) nuove.push(gara(400 + i, { prima_rilevazione_il: `2026-10-19T${String(10 + (i % 10)).padStart(2, "0")}:00:00Z`, data_pubblicazione: i < 3 ? "2026-10-19" : "2026-10-18", scadenza_giorno: "2026-12-01" }));
  const b = gara(450, { prima_rilevazione_il: "2026-10-19T09:00:00Z", scadenza_giorno: "2026-12-01" });
  const senzaLuogo = gara(451, { prima_rilevazione_il: "2026-10-19T09:00:00Z", luogo_regioni: [], scadenza_giorno: "2026-12-01" });
  const salvata = gara(452, { prima_rilevazione_il: "2026-10-19T09:00:00Z", scadenza_giorno: "2026-12-01" });
  const vecchia = gara(453, { prima_rilevazione_il: "2026-10-19T09:00:00Z", data_pubblicazione: "2026-10-01", scadenza_giorno: "2026-12-01" });
  m.db.t("radar_procedure").push(...nuove, b, senzaLuogo, salvata, vecchia);
  for (const g of [...nuove, senzaLuogo, salvata, vecchia]) {
    m.db.t("radar_classificazioni_stato").push({ procedura_id: g.id, stato: "classificata" });
    m.db.t("radar_classificazioni").push({ procedura_id: g.id, settore: "pulizia", rilevanza: "A", sottocategorie: [], attiva: true });
  }
  m.db.t("radar_classificazioni_stato").push({ procedura_id: b.id, stato: "classificata" });
  m.db.t("radar_classificazioni").push({ procedura_id: b.id, settore: "pulizia", rilevanza: "B", sottocategorie: [], attiva: true });
  m.db.t("omnia_ai_radar_salvate").push({ user_id: I1, procedura_id: salvata.id, aggiunta_id: null, creata_il: "2026-10-19T12:00:00Z" });
  await eseguiPassaggio(m.d);
  const r = eventi(m).find((e) => e.tipo === "riepilogo_opportunita" && e.impresa_id === I1);
  const dati = r?.dati as EventoRiepilogo | undefined;
  const ids = new Set((dati?.gare ?? []).map((g) => g.proceduraId));
  controlla("riepilogo: un evento per l'impresa, versione = giorno di Roma", !!r && r.versione === "2026-10-20" && r.gara_chiave === "riepilogo");
  controlla("riepilogo: al più 20 gare più «altre 5»", dati?.gare.length === 20 && dati?.altreNonIncluse === 5, { n: dati?.gare.length, altre: dati?.altreNonIncluse });
  controlla("riepilogo: MAI una B, anche con le correlate accese nel profilo", !ids.has(b.id));
  controlla("riepilogo: ogni gara con rilevanza «A» (campo facoltativo N4)", (dati?.gare ?? []).every((g) => g.rilevanza === "A"));
  controlla("riepilogo: gara senza luogo esclusa con un profilo regionale", !ids.has(senzaLuogo.id));
  controlla("riepilogo: N5, gara già salvata dall'impresa esclusa", !ids.has(salvata.id));
  controlla("riepilogo: gara pubblicata da più di 7 giorni esclusa", !ids.has(vecchia.id));
  controlla("riepilogo: le più recenti prima", (dati?.gare ?? []).slice(0, 3).every((g) => nuove.slice(0, 3).some((n) => n.id === g.proceduraId)));
  controlla("riepilogo: solo a chi ha «nuove opportunità» accese (titolare sì, Ufficio Gare no)", di(m, (c) => c.evento_id === r?.id).map((c) => c.destinatario_id).join() === I1);
  controlla("riepilogo: I2 senza profilo non riceve nulla", !eventi(m).some((e) => e.tipo === "riepilogo_opportunita" && e.impresa_id === I2));
  // N5 spento: anche la gara già salvata entra
  const m2 = mondo({ parametri: { escludiGiaSalvateDalRiepilogo: false } });
  m2.db.t("radar_procedure").push(salvata);
  m2.db.t("radar_classificazioni_stato").push({ procedura_id: salvata.id, stato: "classificata" });
  m2.db.t("radar_classificazioni").push({ procedura_id: salvata.id, settore: "pulizia", rilevanza: "A", sottocategorie: [], attiva: true });
  m2.db.t("omnia_ai_radar_salvate").push({ user_id: I1, procedura_id: salvata.id, aggiunta_id: null, creata_il: "2026-10-19T12:00:00Z" });
  await eseguiPassaggio(m2.d);
  const r2 = eventi(m2).find((e) => e.tipo === "riepilogo_opportunita")?.dati as EventoRiepilogo | undefined;
  controlla("N5 spento: la gara già salvata entra nel riepilogo", !!r2?.gare.some((g) => g.proceduraId === salvata.id));
  // funzione pura: la B resta fuori anche passando direttamente le righe
  const soloB: RigaNuova[] = [{ ...b, classificazione_stato: { stato: "classificata" }, classificazioni: [{ settore: "pulizia", rilevanza: "B", sottocategorie: [], attiva: true }] }];
  const e = eventoRiepilogo({ oggi: "2026-10-20", adesso: new Date("2026-10-20T06:00:00Z"), impresaId: I1, profilo: { impresaId: I1, settori: ["pulizia"], sottocategorie: {}, procedure: [], regioni: [], importoMin: null, importoMax: null, vedereCorrelate: true }, nuove: soloB, giaInLista: new Set(), parametri: { escludiGiaSalvateDalRiepilogo: true }, nascoste: new Set(), env: STAGING, origine: "http://localhost:3000", nuovoId: () => U(1), adessoIso: "2026-10-20T06:00:00Z" });
  controlla("riepilogo (puro): solo B → nessun evento", e === null);
}

async function provaTetto(): Promise<void> {
  const m = mondo();
  // 20 gare salvate da I1 con il promemoria a 1 giorno OGGI (urgenti), entrate nella lista giorni fa
  for (let i = 0; i < 20; i++) {
    const g = gara(500 + i, { scadenza_giorno: "2026-10-21", scadenza_offerte: "2026-10-21T09:00:00Z", scadenza_ora_indicata: true });
    m.db.t("radar_procedure").push(g);
    m.db.t("omnia_ai_radar_salvate").push({ user_id: I1, procedura_id: g.id, aggiunta_id: null, creata_il: "2026-10-01T08:00:00Z" });
  }
  await eseguiPassaggio(m.d);
  const mie = di(m, (c) => c.destinatario_id === I1);
  const singoleInviate = mie.filter((c) => c.tipo_consegna === "singola" && c.stato === "inviata");
  const raggruppate = mie.filter((c) => c.tipo_consegna === "raggruppata");
  const incluse = mie.filter((c) => c.stato === "inclusa");
  controlla("tetto: al più 15 email singole per persona nel passaggio", singoleInviate.length === 15, singoleInviate.length);
  controlla("tetto: gli urgenti oltre il tetto partono SUBITO in una sola email raggruppata", raggruppate.length === 1 && raggruppate[0].stato === "inviata", raggruppate.map((r) => r.stato));
  const urgentiI1 = mie.filter((c) => c.tipo_consegna === "singola" && ["scadenza_1"].includes(tipoDi(m, c))).length;
  const urgentiInCoda = mie.filter((c) => c.stato === "in_coda" && ["scadenza_1", "scadenza_ravvicinata", "proroga", "modifica_scadenza", "annullamento", "rettifica"].includes(tipoDi(m, c)));
  const nonUrgentiInCoda = mie.filter((c) => c.stato === "in_coda" && ["scadenza_5", "scadenza_10"].includes(tipoDi(m, c)));
  controlla("tetto: urgenti = 15 singole + le altre incluse nel raggruppamento (nessuna persa, nessuna rinviata)", incluse.length + singoleInviate.length === urgentiI1 && incluse.every((c) => c.inclusa_in === raggruppate[0]?.id) && urgentiInCoda.length === 0, { incluse: incluse.length, urgentiI1 });
  controlla("tetto: i promemoria a 5 e 10 giorni oltre il tetto aspettano il passaggio dopo (30 minuti)", nonUrgentiInCoda.length === 2 && nonUrgentiInCoda.every((c) => c.prossimo_tentativo_il === "2026-10-20T06:00:00.000Z"), nonUrgentiInCoda.map((c) => c.prossimo_tentativo_il));
  m.ora.t = new Date("2026-10-20T06:00:00Z");
  await eseguiPassaggio(m.d);
  controlla("tetto: al passaggio dopo partono anche loro", di(m, (c) => c.destinatario_id === I1 && c.stato === "in_coda").length === 0);
  controlla("tetto: email consegnate a I1 nei due passaggi = 18 (15 singole + 1 raggruppata, poi i 2 promemoria non urgenti)", m.provider.consegnate.filter((x) => x.a === "titolare1@prova.test").length === 18);
  controlla("tetto: nessuna consegna inclusa partita da sola", incluse.every((c) => !m.provider.consegnate.some((x) => x.chiave === `omnia-radar/${c.id}`)));
  // l'email raggruppata, ritentata dopo una caduta della rete, ha lo STESSO contenuto (la chiave di idempotenza lo pretende)
  {
    const m2 = mondo();
    for (let i = 0; i < 20; i++) {
      const g = gara(500 + i, { scadenza_giorno: "2026-10-21", scadenza_offerte: "2026-10-21T09:00:00Z", scadenza_ora_indicata: true });
      m2.db.t("radar_procedure").push(g);
      m2.db.t("omnia_ai_radar_salvate").push({ user_id: I1, procedura_id: g.id, aggiunta_id: null, creata_il: "2026-10-01T08:00:00Z" });
    }
    const originale = m2.provider.invia.bind(m2.provider);
    let cadute = 0;
    m2.d.provider = {
      nome: "finto",
      quotaResidua: () => null,
      invia: async (x) => {
        const r = await originale(x);
        if (x.tags.some((t) => t.value === "raggruppamento") && cadute++ === 0) return { esito: "riprova", codice: "rete", attesaSecondi: null, dopoInvio: true };
        return r;
      },
    };
    await eseguiPassaggio(m2.d);
    const raggr = di(m2, (c) => c.tipo_consegna === "raggruppata" && c.destinatario_id === I1);
    controlla("raggruppata: dopo la caduta della rete resta in coda (nessuna perdita)", raggr.length === 1 && raggr[0].stato === "in_coda", raggr.map((c) => c.stato));
    m2.ora.t = new Date("2026-10-20T05:40:00Z");
    await eseguiPassaggio(m2.d);
    const dopo = di(m2, (c) => c.tipo_consegna === "raggruppata" && c.destinatario_id === I1);
    controlla("raggruppata: il nuovo tentativo ha lo stesso contenuto (inviata, non «esito_incerto») e nessuna email doppia", dopo.length === 1 && dopo[0].stato === "inviata" && new Set(m2.provider.consegnate.map((x) => x.chiave)).size === m2.provider.consegnate.length, dopo.map((c) => [c.stato, c.motivo]));
  }
  // pianoInvioCompleto: il riepilogo non entra mai in un raggruppamento
  const coda: ConsegnaInCoda[] = [...Array.from({ length: 16 }, (_, i) => ({ id: `u${i}`, tipo: "scadenza_1" as TipoEvento, creataIl: "2026-10-20T05:00:00Z", giornoEvento: "2026-10-20" })), { id: "r", tipo: "riepilogo_opportunita", creataIl: "2026-10-20T05:00:00Z", giornoEvento: "2026-10-20" }];
  const p = pianoInvioCompleto(coda, { oggi: "2026-10-20", ultimoPassaggioDelGiorno: false, quotaResidua: null });
  controlla("piano completo: riepilogo mai raggruppato, rinviato se non c'è posto", !p.raggruppate.includes("r") && p.rinviate.includes("r"), p);
  const pu = pianoInvioCompleto(coda, { oggi: "2026-10-20", ultimoPassaggioDelGiorno: true, quotaResidua: null });
  controlla("piano completo: all'ultimo passaggio del giorno il riepilogo parte comunque", pu.singole.includes("r") && !pu.raggruppate.includes("r"), pu);
  const pq = pianoInvioCompleto(coda, { oggi: "2026-10-20", ultimoPassaggioDelGiorno: true, quotaResidua: 0 });
  controlla("piano completo: senza quota tutto resta in coda", pq.singole.length === 0 && pq.raggruppate.length === 0 && pq.rinviate.length === 17);
}

async function provaErrori(): Promise<void> {
  // 429 di frequenza, poi successo con la STESSA chiave
  {
    const copione: CopioneFinto = (_m, n) => (n === 0 ? { esito: "riprova", codice: "rate_limit_exceeded", attesaSecondi: null, dopoInvio: false } : null);
    const m = mondo({ copione });
    await eseguiPassaggio(m.d);
    const tutte = consegne(m);
    controlla("429: tutte di nuovo in coda dopo 5 minuti, nessuna persa", tutte.length > 0 && tutte.every((c) => c.stato === "in_coda" && c.tentativi === 1 && c.prossimo_tentativo_il === "2026-10-20T05:35:00.000Z"), tutte.map((c) => [c.stato, c.prossimo_tentativo_il]));
    m.ora.t = new Date("2026-10-20T05:36:00Z");
    await eseguiPassaggio(m.d);
    controlla("429: al tentativo dopo partono, con la stessa chiave di idempotenza", consegne(m).every((c) => c.stato === "inviata" && c.tentativi === 2) && m.provider.consegnate.length === tutte.length);
  }
  // rete caduta DOPO l'invio: il finto aveva già consegnato; il nuovo tentativo con la stessa chiave NON consegna di nuovo
  {
    let caduta = true;
    const copione: CopioneFinto = () => null;
    const m = mondo({ copione });
    const originale = m.provider.invia.bind(m.provider);
    m.d.provider = {
      nome: "finto",
      quotaResidua: () => null,
      invia: async (x) => {
        const r = await originale(x);
        if (caduta) return { esito: "riprova", codice: "rete", attesaSecondi: null, dopoInvio: true };
        return r;
      },
    };
    await eseguiPassaggio(m.d);
    const n = m.provider.consegnate.length;
    caduta = false;
    m.ora.t = new Date("2026-10-20T05:40:00Z");
    await eseguiPassaggio(m.d);
    controlla("rete caduta dopo l'invio: il nuovo tentativo con la stessa chiave non duplica", m.provider.consegnate.length === n && consegne(m).every((c) => c.stato === "inviata"), { n, dopo: m.provider.consegnate.length });
  }
  // finestra di 24 ore: oltre, «esito_incerto» (mai un rinvio alla cieca)
  {
    const a = esitoDopoInvio({ tentativi: 3, primoTentativoIl: "2026-10-19T06:00:00Z" }, { esito: "riprova", codice: "rete", attesaSecondi: null, dopoInvio: true }, "finto", new Date("2026-10-20T05:50:00Z"), { attesaMinuti: [5, 30, 120, 360, 720], finestraOre: 24 });
    controlla("oltre la finestra di 24 ore con invio forse avvenuto: esito_incerto", a.stato === "esito_incerto" && a.motivo === "finestra_idempotenza_scaduta", a);
    const b = esitoDopoInvio({ tentativi: 5, primoTentativoIl: "2026-10-20T00:00:00Z" }, { esito: "riprova", codice: "rate_limit_exceeded", attesaSecondi: null, dopoInvio: false }, "finto", new Date("2026-10-20T05:50:00Z"), { attesaMinuti: [5, 30, 120, 360, 720], finestraOre: 24 });
    controlla("tentativi esauriti senza invio: fallita", b.stato === "fallita" && b.motivo === "tentativi_esauriti", b);
    const c = esitoDopoInvio({ tentativi: 0, primoTentativoIl: null }, { esito: "riprova", codice: "429", attesaSecondi: 90, dopoInvio: false }, "finto", new Date("2026-10-20T05:00:00Z"), { attesaMinuti: [5], finestraOre: 24 });
    controlla("retry-after del provider rispettato", c.stato === "in_coda" && c.prossimo_tentativo_il === "2026-10-20T05:01:30.000Z", c);
    const q = esitoDopoInvio({ tentativi: 1, primoTentativoIl: "2026-10-20T05:00:00Z" }, { esito: "quota", codice: "daily_quota_exceeded" }, "finto", new Date("2026-10-20T15:00:00Z"), { attesaMinuti: [5], finestraOre: 24 });
    controlla("quota esaurita: in coda per il giorno dopo, nessun tentativo contato", q.stato === "in_coda" && q.tentativi === 1 && q.prossimo_tentativo_il === "2026-10-21T05:30:00.000Z" && q.motivo === "quota_provider", q);
    const i = esitoDopoInvio({ tentativi: 0, primoTentativoIl: null }, { esito: "incerto", codice: "invalid_idempotent_request" }, "finto", new Date(), { attesaMinuti: [5], finestraOre: 24 });
    controlla("409 contenuto diverso: esito_incerto", i.stato === "esito_incerto");
  }
  // 401: fallita, la fase si ferma, il resto torna in coda
  {
    const copione: CopioneFinto = () => ({ esito: "fallita", codice: "invalid_api_key", configurazione: true });
    const m = mondo({ copione });
    const e = await eseguiPassaggio(m.d);
    const f = consegne(m).filter((c) => c.stato === "fallita");
    controlla("errore di configurazione: una sola fallita, la fase si ferma, le altre restano in coda", f.length === 1 && f[0].motivo === "configurazione_provider" && consegne(m).filter((c) => c.stato === "in_coda").length === consegne(m).length - 1 && e.eseguito && (e.invio as Record<string, number>).fermo_configurazione_provider === 1, { stati: consegne(m).map((c) => c.stato), e });
  }
  // quota esaurita: nulla parte, nulla si perde
  {
    const m = mondo({ quota: 0 });
    await eseguiPassaggio(m.d);
    controlla("quota 0: nessuna email, tutte in coda", m.provider.consegnate.length === 0 && consegne(m).every((c) => c.stato === "in_coda"), consegne(m).map((c) => c.stato));
  }
  // affitto scaduto e caduta tra l'invio e la scrittura dell'esito
  {
    const m = mondo();
    m.db.guasti.set("omnia_ai_radar_email_consegne|upsert", 0);
    // il primo passaggio crea eventi e consegne; facciamo cadere la scrittura degli ESITI (il secondo upsert del blocco)
    let upsert = 0;
    const da = m.d.admin.from.bind(m.d.admin);
    m.d.admin = {
      ...m.db,
      rpc: m.db.rpc.bind(m.db),
      from: (t: string) => {
        const q = da(t) as unknown as { upsert: (...a: unknown[]) => unknown };
        if (t === "omnia_ai_radar_email_consegne") {
          const orig = q.upsert.bind(q);
          q.upsert = (...a: unknown[]) => {
            const o = a[1] as { onConflict?: string } | undefined;
            if (o?.onConflict === "id" && (a[0] as { stato?: string }[]).some((r) => r.stato === "inviata") && ++upsert === 1) throw new Error("processo caduto");
            return orig(...a);
          };
        }
        return q;
      },
    } as unknown as DipendenzeMotore["admin"];
    await eseguiPassaggio(m.d);
    const inviateDalFinto = m.provider.consegnate.length;
    const appese = consegne(m).filter((c) => c.stato === "in_invio");
    controlla("caduta tra invio e scrittura: consegne rimaste «in_invio» con l'affitto", inviateDalFinto > 0 && appese.length === inviateDalFinto, { inviateDalFinto, appese: appese.length });
    m.ora.t = new Date("2026-10-20T05:50:00Z"); // affitto di 10 minuti scaduto
    await eseguiPassaggio(m.d);
    controlla("affitto scaduto: rimesse in coda e chiuse con la stessa chiave, NESSUNA email doppia", consegne(m).every((c) => c.stato === "inviata") && m.provider.consegnate.length === inviateDalFinto, { finto: m.provider.consegnate.length, stati: consegne(m).map((c) => c.stato) });
  }
  // un errore del database nella fase «eventi»: giro «fallito», la fase «invio» continua
  {
    const m = mondo();
    m.db.guasti.set("omnia_ai_radar_eventi|upsert", 1);
    const e = await eseguiPassaggio(m.d);
    controlla("errore del database negli eventi: giro «fallito» con il passo, nessuna eccezione", e.eseguito && "saltata" in e.eventi && String(e.eventi.saltata).startsWith("errore:eventi") && m.db.t("radar_notifiche_giri").some((g) => g.fase === "eventi" && g.esito === "fallito"), e);
    m.ora.t = new Date("2026-10-20T06:00:00Z");
    await eseguiPassaggio(m.d);
    controlla("il passaggio dopo rifà la fase «eventi» dello stesso giorno (nessun giro riuscito)", eventi(m).length > 0 && consegne(m).every((c) => c.stato === "inviata"));
  }
  // un giro in corso blocca il secondo; un blocco scaduto si libera
  {
    const m = mondo();
    m.db.t("radar_notifiche_giri").push({ id: "g-occupato", giorno_roma: "2026-10-20", fase: "eventi", esito: "in_corso", iniziato_il: "2026-10-20T05:29:00Z", in_corso_fino_il: "2026-10-20T05:44:00Z", ambiente: "staging", provider: "finto" });
    const e = await eseguiPassaggio(m.d);
    controlla("uno alla volta: con un giro «eventi» in corso il secondo non parte", e.eseguito && "saltata" in e.eventi && e.eventi.saltata === "altro_giro_in_corso" && eventi(m).length === 0, e);
    m.ora.t = new Date("2026-10-20T06:00:00Z");
    await eseguiPassaggio(m.d);
    controlla("uno alla volta: il blocco scaduto si libera («blocco_scaduto») e il giro riparte", m.db.t("radar_notifiche_giri").some((g) => g.id === "g-occupato" && g.esito === "fallito" && g.errore === "blocco_scaduto") && eventi(m).length > 0);
  }
}

async function provaRicontrollo(): Promise<void> {
  const copione: CopioneFinto = (_m, n) => (n === 0 ? { esito: "riprova", codice: "rate_limit_exceeded", attesaSecondi: null, dopoInvio: false } : null);
  const m = mondo({ copione });
  await eseguiPassaggio(m.d); // tutte in coda dopo il 429
  // tra la creazione e l'invio: M1 spegne le scadenze, I1 toglie la gara aggiunta dalla lista, I2 perde l'abbonamento
  Object.assign(m.db.t("omnia_ai_radar_notifiche_persone").find((p) => p.user_id === M1)!, { scadenze: false });
  m.db.tabelle.omnia_ai_radar_salvate = m.db.t("omnia_ai_radar_salvate").filter((s) => s.aggiunta_id !== U(201));
  m.accesso.set(I2, "cessato");
  m.ora.t = new Date("2026-10-20T05:36:00Z");
  await eseguiPassaggio(m.d);
  const m1 = di(m, (c) => c.destinatario_id === M1);
  controlla("ricontrollo: categoria spenta dopo la creazione → scartata («categoria_spenta»; la gara tolta dalla lista viene prima)", m1.length > 0 && m1.every((c) => c.stato === "scartata" && ["categoria_spenta", "gara_fuori_lista"].includes(String(c.motivo))) && m1.some((c) => c.motivo === "categoria_spenta"), m1.map((c) => [c.stato, c.motivo]));
  const aggiunta = di(m, (c) => c.destinatario_id === I1 && String(eventi(m).find((e) => e.id === c.evento_id)?.gara_chiave).startsWith("a:"));
  controlla("ricontrollo: gara tolta dalla lista → scartata («gara_fuori_lista»)", aggiunta.length === 1 && aggiunta[0].stato === "scartata" && aggiunta[0].motivo === "gara_fuori_lista", aggiunta.map((c) => [c.stato, c.motivo]));
  const i2 = di(m, (c) => c.impresa_id === I2);
  controlla("ricontrollo: abbonamento scaduto (N1) → scartata", i2.length > 0 && i2.every((c) => c.stato === "scartata" && c.motivo === "abbonamento_non_valido"), i2.map((c) => [c.stato, c.motivo]));
  controlla("ricontrollo: le scartate non partono mai", !m.provider.consegnate.some((x) => consegne(m).some((c) => c.stato === "scartata" && x.chiave === `omnia-radar/${c.id}`)));
  // la scadenza cambia nell'archivio mentre il promemoria aspetta in coda (stesso giorno: la fase «eventi» non rigira) → scartato all'invio
  const s = mondo({ copione });
  await eseguiPassaggio(s.d);
  Object.assign(s.db.t("radar_procedure").find((p) => p.id === U(101))!, { scadenza_giorno: "2026-11-06", scadenza_offerte: "2026-11-06T11:00:00Z" });
  s.ora.t = new Date("2026-10-20T05:36:00Z");
  await eseguiPassaggio(s.d);
  const dieci = di(s, (c) => tipoDi(s, c) === "scadenza_10" && c.impresa_id === I1);
  controlla("ricontrollo: scadenza cambiata dopo la nascita del promemoria → scartato («scadenza_cambiata»), mai inviato", dieci.length > 0 && dieci.every((c) => c.stato === "scartata" && c.motivo === "scadenza_cambiata"), dieci.map((c) => [c.stato, c.motivo]));
}

async function provaRavvicinata(): Promise<void> {
  const m = mondo({ inizio: "2026-10-20T14:00:00Z" });
  // una gara nuova salvata ORA con la scadenza domani alle 10 (1 giorno): avviso immediato una volta sola
  const g = gara(600, { scadenza_giorno: "2026-10-21", scadenza_offerte: "2026-10-21T08:00:00Z", scadenza_ora_indicata: true });
  m.db.t("radar_procedure").push(g);
  m.db.t("omnia_ai_radar_salvate").push({ user_id: I1, procedura_id: g.id, aggiunta_id: null, creata_il: "2026-10-20T13:59:00Z" });
  const ent = { impresaId: I1, proceduraId: g.id, aggiuntaId: null, autoreId: M1 };
  const r1 = await dopoIngressoInLista(ent, { env: STAGING, dipendenze: m.d });
  controlla("ravvicinata: evento e consegne creati e inviati subito (titolare e Ufficio Gare)", r1.esito === "accodata" && r1.eventi === 1 && r1.consegne === 2 && m.provider.consegnate.length === 2, r1);
  const r2 = await dopoIngressoInLista(ent, { env: STAGING, dipendenze: m.d });
  controlla("ravvicinata: la seconda volta niente (una volta sola per versione)", r2.esito === "non_dovuta" && m.provider.consegnate.length === 2, r2);
  const spento = await dopoIngressoInLista(ent, { env: {}, dipendenze: m.d });
  controlla("ravvicinata: interruttore spento → «spento»", spento.esito === "spento");
  // con il promemoria a 1 giorno già nato per quella versione: nessun avviso ravvicinato
  const m2 = mondo({ inizio: "2026-10-20T14:00:00Z" });
  m2.db.t("radar_procedure").push(g);
  m2.db.t("omnia_ai_radar_salvate").push({ user_id: I1, procedura_id: g.id, aggiunta_id: null, creata_il: "2026-10-20T13:59:00Z" });
  m2.db.t("omnia_ai_radar_eventi").push({ id: "e-1", impresa_id: I1, categoria: "scadenze", tipo: "scadenza_1", gara_chiave: `p:${g.id}`, versione: "2026-10-21T08:00:00.000Z", stato: "attivo", dati: {}, creato_il: "2026-10-20T05:30:00Z" });
  const r3 = await eseguiRavvicinata(m2.d, ent);
  controlla("ravvicinata: mai se il promemoria a 1 giorno è già nato", r3.esito === "non_dovuta" && r3.motivo === "scadenza_non_ravvicinata", r3);
  // scadenza lontana: nessun avviso
  const m3 = mondo({ inizio: "2026-10-20T14:00:00Z" });
  const r4 = await eseguiRavvicinata(m3.d, { ...ent, proceduraId: U(101) });
  controlla("ravvicinata: scadenza a 10 giorni → nessun avviso", r4.esito === "non_dovuta", r4);
}

// Difetto del 20/11 (Incarico 3): la proroga di UN solo lotto arriva all'email con il suo lotto anche senza CIG (TED «LOT-0001»); lo
// spostamento della scadenza «più vicina» della gara non apre una seconda serie; lo stesso lotto da TED (numero) e PVL (CIG) compare una volta
async function provaLotti(): Promise<void> {
  const m = mondo();
  m.db.t("radar_procedure").push(
    // dopo l'avviso: lotto 1 dal 05/11 al 20/11, lotto 2 fermo al 10/11; la gara («la più vicina») passa dal 05/11 al 10/11
    gara(6, { scadenza_giorno: "2026-11-10", scadenza_offerte: "2026-11-10T10:00:00Z", scadenza_ora_indicata: true }),
    gara(7, { scadenza_giorno: "2026-11-25", scadenza_offerte: "2026-11-25T10:00:00Z", scadenza_ora_indicata: true, fonti: ["ted", "pvl"] }),
  );
  m.db.t("radar_lotti").push(
    { procedura_id: U(106), numero_lotto: "LOT-0001", oggetto: "Lotto 1 (sintetico)", cig: null, scadenza_giorno: "2026-11-20", scadenza_offerte: "2026-11-20T10:00:00Z", scadenza_ora_indicata: true },
    { procedura_id: U(106), numero_lotto: "LOT-0002", oggetto: "Lotto 2 (sintetico)", cig: null, scadenza_giorno: "2026-11-10", scadenza_offerte: "2026-11-10T10:00:00Z", scadenza_ora_indicata: true },
    { procedura_id: U(107), numero_lotto: "LOT-0001", oggetto: "Lotto 1 (sintetico)", cig: "BBBBBBBBB1", scadenza_giorno: "2026-11-25", scadenza_offerte: "2026-11-25T10:00:00Z", scadenza_ora_indicata: true },
    { procedura_id: U(107), numero_lotto: "LOT-0002", oggetto: "Lotto 2 (sintetico)", cig: "BBBBBBBBB2", scadenza_giorno: "2026-11-30", scadenza_offerte: "2026-11-30T10:00:00Z", scadenza_ora_indicata: true },
  );
  m.db.t("omnia_ai_radar_salvate").push({ user_id: I1, procedura_id: U(106), aggiunta_id: null, creata_il: "2026-10-15T08:00:00Z" }, { user_id: I1, procedura_id: U(107), aggiunta_id: null, creata_il: "2026-10-15T08:00:00Z" });
  const riga = (n: number, p: Record<string, unknown>) => ({ id: U(n), tipo: "proroga", notificabile: true, notifica_email: true, avviso_url: null, avviso_pubblicato_il: "2026-10-19", dichiarazione_fonte: "cor-buy", affidabilita: "avviso_ufficiale", rilevato_il: "2026-10-19T09:00:00Z", avviso_ted: null, ...p });
  m.db.t("radar_aggiornamenti").push(
    riga(410, { procedura_id: U(106), campo: "scadenza_offerte", valore_precedente: "2026-11-05T10:00:00Z", valore_nuovo: "2026-11-10T10:00:00Z", fonte: "ted", id_fonte: "700900-2026" }),
    riga(411, { procedura_id: U(106), campo: "scadenza_offerte@LOT-0001", valore_precedente: "2026-11-05T10:00:00Z", valore_nuovo: "2026-11-20T10:00:00Z", fonte: "ted", id_fonte: "700900-2026" }),
    riga(412, { procedura_id: U(107), campo: "scadenza_offerte@LOT-0001", valore_precedente: "2026-11-15T10:00:00Z", valore_nuovo: "2026-11-25T10:00:00Z", fonte: "ted", id_fonte: "700901-2026" }),
    riga(413, { procedura_id: U(107), campo: "scadenza_offerte@BBBBBBBBB1", valore_precedente: "2026-11-15T10:00:00Z", valore_nuovo: "2026-11-25T10:00:00Z", fonte: "pvl", id_fonte: "pvl-avviso-7", avviso_ted: "700901-2026", affidabilita: "confronto_versioni" }),
  );
  await eseguiPassaggio(m.d);
  type DatiProroga = { cambioScadenza?: { lotti: { numero: string | null; titolo: string | null; cig: string | null }[] } };
  const proroghe = (n: number) => eventi(m).filter((e) => e.tipo === "proroga" && e.impresa_id === I1 && e.gara_chiave === `p:${U(n)}`);
  const p6 = proroghe(106);
  controlla("difetto lotto (motore): UNA proroga, alla nuova scadenza del lotto 1 (nessuna serie per il 10/11 della gara)", p6.length === 1 && p6[0].versione === "scadenza:2026-11-20T10:00:00.000Z", p6.map((e) => e.versione));
  const lotti6 = (p6[0]?.dati as DatiProroga | undefined)?.cambioScadenza?.lotti ?? [];
  controlla("difetto lotto (motore): il lotto senza CIG si riconosce dal numero, con il suo titolo", lotti6.length === 1 && lotti6[0].numero === "LOT-0001" && lotti6[0].titolo === "Lotto 1 (sintetico)" && lotti6[0].cig === null, lotti6);
  const p7 = proroghe(107);
  const lotti7 = (p7[0]?.dati as DatiProroga | undefined)?.cambioScadenza?.lotti ?? [];
  controlla("lotti (motore): lo stesso lotto da TED (numero) e PVL (CIG) → un evento con il lotto UNA volta", p7.length === 1 && lotti7.length === 1 && lotti7[0].cig === "BBBBBBBBB1" && lotti7[0].numero === "LOT-0001", { p7: p7.length, lotti7 });
}

async function provaParametri(): Promise<void> {
  // N1: abbonamento richiesto (proposta) contro non richiesto
  {
    const m = mondo();
    m.accesso.set(I2, "cessato");
    await eseguiPassaggio(m.d);
    controlla("N1 sì: impresa con l'abbonamento scaduto senza eventi né email", !eventi(m).some((e) => e.impresa_id === I2));
    const m2 = mondo({ parametri: { abbonamentoRichiesto: false } });
    m2.accesso.set(I2, "cessato");
    await eseguiPassaggio(m2.d);
    controlla("N1 no: l'impresa riceve comunque (decide solo il Radar attivo e le email accese)", eventi(m2).some((e) => e.impresa_id === I2));
    controlla("N1 no: lo stato dell'abbonamento non si legge nemmeno", !m2.db.richieste.some((r) => r.tabella === "subscriptions"));
  }
  // N6: compattazione dei riepiloghi a 7 giorni (proposta, non in uso) contro 30 (in uso, decisione 7); altri eventi a 30; conservazione 12 mesi
  for (const giorni of [7, 30]) {
    const m = mondo({ parametri: { giorniCompattazioneRiepiloghi: giorni } });
    m.db.t("omnia_ai_radar_eventi").push(
      { id: "r-8", impresa_id: I1, categoria: "nuove_opportunita", tipo: "riepilogo_opportunita", gara_chiave: "riepilogo", versione: "2026-10-12", stato: "attivo", dati: { x: 1 }, dati_compattati_il: null, creato_il: "2026-10-12T05:30:00Z" },
      { id: "s-8", impresa_id: I1, categoria: "scadenze", tipo: "scadenza_5", gara_chiave: `p:${U(109)}`, versione: "2026-10-17", stato: "attivo", dati: { x: 1 }, dati_compattati_il: null, creato_il: "2026-10-12T05:30:00Z" },
      { id: "s-40", impresa_id: I1, categoria: "scadenze", tipo: "scadenza_5", gara_chiave: `p:${U(108)}`, versione: "2026-09-15", stato: "attivo", dati: { x: 1 }, dati_compattati_il: null, creato_il: "2026-09-10T05:30:00Z" },
      { id: "vecchio", impresa_id: I1, categoria: "scadenze", tipo: "scadenza_5", gara_chiave: `p:${U(107)}`, versione: "2025-09-15", stato: "attivo", dati: null, dati_compattati_il: "2025-10-10T00:00:00Z", creato_il: "2025-09-10T05:30:00Z" },
    );
    m.db.t("omnia_ai_radar_email_consegne").push({ id: "c-vecchia", tipo_consegna: "singola", evento_id: "vecchio", inclusa_in: null, impresa_id: I1, destinatario_id: I1, ruolo: "titolare", chiave: "vecchia", priorita: 4, stato: "inviata", creata_il: "2025-09-10T05:30:00Z" });
    await eseguiPassaggio(m.d);
    const r8 = eventi(m).find((e) => e.id === "r-8");
    controlla(`N6 = ${giorni}: riepilogo di 8 giorni ${giorni === 7 ? "compattato" : "ancora intero"}`, giorni === 7 ? r8?.dati === null && !!r8?.dati_compattati_il : r8?.dati !== null, r8);
    controlla(`N6 = ${giorni}: gli altri eventi si compattano a 30 giorni`, eventi(m).find((e) => e.id === "s-8")?.dati !== null && eventi(m).find((e) => e.id === "s-40")?.dati === null);
    controlla(`conservazione: eventi e consegne di oltre 12 mesi cancellati`, !eventi(m).some((e) => e.id === "vecchio") && !consegne(m).some((c) => c.id === "c-vecchia"));
  }
  // Decisione 7 (approvata): con i parametri IN USO (quelli della rotta) anche i riepiloghi si compattano dopo 30 giorni, non 7
  {
    controlla("decisione 7: parametri in uso, riepiloghi e altri eventi compattati a 30 giorni", PARAMETRI_PROPOSTI.giorniCompattazioneRiepiloghi === 30 && PARAMETRI_PROPOSTI.giorniCompattazioneAltri === 30);
    const m = mondo();
    const riepilogo = (id: string, giorno: string) => ({ id, impresa_id: I1, categoria: "nuove_opportunita", tipo: "riepilogo_opportunita", gara_chiave: "riepilogo", versione: giorno, stato: "attivo", dati: { x: 1 }, dati_compattati_il: null, creato_il: `${giorno}T05:30:00Z` });
    m.db.t("omnia_ai_radar_eventi").push(riepilogo("r-8", "2026-10-12"), riepilogo("r-29", "2026-09-21"), riepilogo("r-31", "2026-09-19"));
    await eseguiPassaggio(m.d);
    const dati = (id: string) => eventi(m).find((e) => e.id === id)?.dati;
    controlla("decisione 7: riepiloghi di 8 e 29 giorni ancora interi", dati("r-8") !== null && dati("r-8") !== undefined && dati("r-29") !== null && dati("r-29") !== undefined);
    controlla("decisione 7: riepilogo di 31 giorni compattato", dati("r-31") === null && !!eventi(m).find((e) => e.id === "r-31")?.dati_compattati_il);
  }
  // N7: con il parametro spento ogni passaggio scrive il suo giro «invio»
  {
    const m = mondo({ parametri: { giroInvioSoloConLavoro: false } });
    await eseguiPassaggio(m.d);
    for (const t of ["06:00", "06:30", "07:00"]) {
      m.ora.t = new Date(`2026-10-20T${t}:00Z`);
      await eseguiPassaggio(m.d);
    }
    controlla("N7 no: un giro «invio» per ogni passaggio (4)", m.db.t("radar_notifiche_giri").filter((g) => g.fase === "invio").length === 4);
    const m2 = mondo();
    await eseguiPassaggio(m2.d);
    for (const t of ["06:00", "06:30", "07:00"]) {
      m2.ora.t = new Date(`2026-10-20T${t}:00Z`);
      await eseguiPassaggio(m2.d);
    }
    controlla("N7 sì: un solo giro «invio» (quello con lavoro); i passaggi vuoti non scrivono", m2.db.t("radar_notifiche_giri").filter((g) => g.fase === "invio").length === 1);
  }
}

function provaResend(): void {
  const h = (x: Record<string, string>) => (n: string) => x[n.toLowerCase()] ?? null;
  const casi: [number, unknown, Record<string, string>, string, string][] = [
    [200, { id: "re_1" }, {}, "inviata", "200 con id"],
    [200, {}, {}, "riprova", "200 senza id (incerto se partita: si riprova con la stessa chiave)"],
    [429, { name: "rate_limit_exceeded" }, { "retry-after": "7" }, "riprova", "429 frequenza"],
    [429, { name: "daily_quota_exceeded" }, {}, "quota", "429 quota giornaliera"],
    [429, { name: "monthly_quota_exceeded" }, {}, "quota", "429 quota mensile"],
    [409, { name: "invalid_idempotent_request" }, {}, "incerto", "409 contenuto diverso"],
    [409, { name: "concurrent_idempotent_requests" }, {}, "riprova", "409 richieste concorrenti"],
    [500, { name: "application_error" }, {}, "riprova", "500"],
    [503, {}, {}, "riprova", "503"],
    [400, { name: "validation_error" }, {}, "fallita", "400"],
    [422, { name: "validation_error" }, {}, "fallita", "422"],
    [401, { name: "missing_api_key" }, {}, "fallita", "401"],
    [403, { name: "invalid_api_key" }, {}, "fallita", "403"],
  ];
  for (const [stato, corpo, intestazioni, atteso, nome] of casi) {
    const e = classificaRispostaResend(stato, corpo, h(intestazioni));
    controlla(`Resend ${nome} → ${atteso}`, e.esito === atteso, e);
  }
  const r = classificaRispostaResend(429, { name: "rate_limit_exceeded" }, h({ "retry-after": "7" }));
  controlla("Resend 429: retry-after letto", r.esito === "riprova" && r.attesaSecondi === 7);
  const c = classificaRispostaResend(401, { name: "missing_api_key" }, h({}));
  controlla("Resend 401/403: errore di configurazione (la fase si ferma)", c.esito === "fallita" && c.configurazione === true);
  controlla("Resend: quota dalle intestazioni", quotaDaIntestazioni(h({ "x-resend-daily-quota": "42" })) === 42 && quotaDaIntestazioni(h({})) === null);
  const q = richiestaResend({ a: "x@prova.test", oggetto: "o", html: "<p>h</p>", testo: "t", chiaveIdempotenza: "omnia-radar/abc", tags: [{ name: "tipo", value: "scadenza_1" }] });
  controlla("Resend: Idempotency-Key nell'intestazione, mittente noreply, nessuna chiave nel corpo", q.intestazioni["Idempotency-Key"] === "omnia-radar/abc" && JSON.parse(q.corpo).from === "OMNIA AI <noreply@omniaitalia.com>" && !q.corpo.includes("Bearer"));
  let lungo = false;
  try {
    richiestaResend({ a: "x@prova.test", oggetto: "o", html: "h", testo: "t", chiaveIdempotenza: "x".repeat(257), tags: [] });
  } catch {
    lungo = true;
  }
  controlla("Resend: chiave di idempotenza oltre 256 caratteri rifiutata", lungo);
}

function provaD5(): void {
  const lista = gareDelleListe({
    salvate: [{ user_id: I1, procedura_id: U(101), aggiunta_id: null, creata_il: "2026-10-01T00:00:00Z" }],
    procedure: new Map([[U(101), gara(1, { fonti: ["ted", "pvl"], scadenza_giorno: "2026-11-06" })]]),
    lotti: new Map(),
    aggiunte: new Map(),
    nascoste: new Set(),
    origine: "http://localhost:3000",
  });
  const riga = (fonte: string, id: string): RigaModifica => ({
    id,
    procedura_id: U(101),
    tipo: "rettifica",
    campo: "valore_stimato",
    valore_precedente: "100",
    valore_nuovo: "200",
    fonte,
    id_fonte: `${fonte}-1`,
    rilevato_il: "2026-10-20T00:00:00Z",
    notificabile: true,
    notifica_email: true,
    avviso_url: null,
    avviso_pubblicato_il: null,
    avviso_ted: null,
    dichiarazione_fonte: "rettifica",
    affidabilita: "avviso_ufficiale",
  });
  const prod = { NEXT_PUBLIC_SUPABASE_URL: "https://bihfrzspqxsrzlbqqvqa.supabase.co", VERCEL_ENV: "production" };
  const x = eventiModifica({ modifiche: [riga("pvl", "r1"), riga("ted", "r2"), riga("sintel", "r3")], liste: lista, nascoste: new Set(), env: prod, nuovoId: () => U(77), adessoIso: "2026-10-20T00:00:00Z" });
  controlla("fonteAutorizzata nel motore: in produzione la PVL e Sintel non danno eventi, TED sì (dal deploy di produzione)", x.eventi.length === 1 && x.eventi[0].dati.categoria === "rettifiche" && (x.saltate.fonte_non_autorizzata ?? 0) === 2, x.saltate);
  const s = eventiModifica({ modifiche: [riga("pvl", "r1")], liste: lista, nascoste: new Set(), env: STAGING, nuovoId: () => U(78), adessoIso: "2026-10-20T00:00:00Z" });
  controlla("fonteAutorizzata nel motore: sullo staging la PVL dà l'evento", s.eventi.length === 1);
  const anteprima = eventiModifica({ modifiche: [riga("ted", "r2")], liste: lista, nascoste: new Set(), env: { ...STAGING, VERCEL_ENV: "preview" }, nuovoId: () => U(79), adessoIso: "2026-10-20T00:00:00Z" });
  controlla("fonteAutorizzata nel motore: sulle anteprime nessuna fonte", anteprima.eventi.length === 0);
  controlla("avviso: la PVL che cita il numero TED ha la stessa chiave dell'avviso TED", chiaveAvviso({ id: "a", fonte: "pvl", id_fonte: "p1", avviso_ted: "123456-2026" }) === chiaveAvviso({ id: "b", fonte: "ted", id_fonte: "123456-2026", avviso_ted: null }));
  controlla("scadenza dal registro: «Z» e «+01:00» dello stesso istante = stessa scadenza", JSON.stringify(scadenzaDaRegistro("2026-11-06T11:00:00Z")) === JSON.stringify(scadenzaDaRegistro("2026-11-06T12:00:00+01:00")));
  controlla("scadenza dal registro: solo il giorno → ora null (mai presunta)", scadenzaDaRegistro("2026-11-06")?.ora === null && scadenzaDaRegistro("2026-11-06")?.istante === null);
  const soloAvviso = eventiModifica({ modifiche: [{ ...riga("ted", "r9"), campo: "avviso", valore_precedente: null, valore_nuovo: null }], liste: lista, nascoste: new Set(), env: STAGING, nuovoId: () => U(80), adessoIso: "2026-10-20T00:00:00Z" });
  const dm = soloAvviso.eventi[0]?.dati as { modifiche?: unknown[]; evidenza?: { affidabilita: string } } | undefined;
  controlla("avviso ufficiale senza campi cambiati: evento «rettifica» con modifiche vuote (il modello rimanda all'avviso)", soloAvviso.eventi.length === 1 && dm?.modifiche?.length === 0 && dm?.evidenza?.affidabilita === "avviso_ufficiale", soloAvviso);
}

async function provaSimulazione(): Promise<void> {
  // 10 giorni, passaggi ogni 30 minuti dalle 05:30 alle 19:30 UTC (29 al giorno), con il cambio d'ora del 25/10/2026; il 27/10 nessun
  // passaggio (giro saltato: recupero breve); il 23/10 una proroga; il 24/10 una gara salvata tardi.
  const m = mondo({ inizio: "2026-10-20T05:30:00Z" });
  const g = gara(700, { scadenza_giorno: "2026-10-29", scadenza_offerte: "2026-10-29T11:00:00Z", scadenza_ora_indicata: true });
  m.db.t("radar_procedure").push(g);
  m.db.t("omnia_ai_radar_salvate").push({ user_id: I1, procedura_id: g.id, aggiunta_id: null, creata_il: "2026-10-01T08:00:00Z" });
  const tarda = gara(701, { scadenza_giorno: "2026-10-29" });
  m.db.t("radar_procedure").push(tarda);
  const richiestePerGiorno: number[] = [];
  for (let gi = 0; gi < 10; gi++) {
    const g0 = giorno("2026-10-20", gi);
    if (g0 === "2026-10-23") {
      Object.assign(m.db.t("radar_procedure").find((p) => p.id === g.id)!, { scadenza_giorno: "2026-11-03", scadenza_offerte: "2026-11-03T11:00:00Z" });
      m.db.t("radar_aggiornamenti").push({ id: U(390), procedura_id: g.id, tipo: "proroga", campo: "scadenza_offerte", valore_precedente: "2026-10-29T11:00:00Z", valore_nuovo: "2026-11-03T11:00:00Z", fonte: "ted", id_fonte: "999999-2026", rilevato_il: "2026-10-23T04:00:00Z", notificabile: true, notifica_email: true, avviso_url: null, avviso_pubblicato_il: "2026-10-23", avviso_ted: null, dichiarazione_fonte: "cor-buy", affidabilita: "avviso_ufficiale" });
    }
    if (g0 === "2026-10-24") m.db.t("omnia_ai_radar_salvate").push({ user_id: I1, procedura_id: tarda.id, aggiunta_id: null, creata_il: "2026-10-24T12:00:00Z" });
    if (g0 === "2026-10-27") continue; // nessun passaggio oggi
    const prima = m.db.conta();
    for (let p = 0; p < 29; p++) {
      m.ora.t = new Date(Date.parse(`${g0}T05:30:00Z`) + p * 30 * 60_000);
      const e = await eseguiPassaggio(m.d);
      if (!e.eseguito) falliti.push(`simulazione: passaggio non eseguito il ${g0}`);
    }
    richiestePerGiorno.push(m.db.conta() - prima);
  }
  const ev = eventi(m).filter((e) => e.gara_chiave === `p:${g.id}` && e.impresa_id === I1);
  const serie = ev.map((e) => `${e.tipo}@${e.versione}:${e.stato}`).sort();
  controlla("simulazione: nessun promemoria della vecchia scadenza (le sue soglie cadevano prima o dopo la proroga), la proroga una volta, poi 10 e 5 giorni della NUOVA scadenza alle loro date", JSON.stringify(serie) === JSON.stringify([
    "proroga@scadenza:2026-11-03T11:00:00.000Z:attivo",
    "scadenza_10@2026-11-03T11:00:00.000Z:attivo",
    "scadenza_5@2026-11-03T11:00:00.000Z:attivo",
  ].sort()), serie);
  const chiaviEv = eventi(m).map((e) => `${e.impresa_id}|${e.gara_chiave}|${e.tipo}|${e.versione}`);
  controlla("simulazione: nessun evento doppio (impresa, gara, tipo, versione)", new Set(chiaviEv).size === chiaviEv.length);
  controlla("simulazione: nessuna email doppia (una per chiave di idempotenza)", new Set(m.provider.consegnate.map((x) => x.chiave)).size === m.provider.consegnate.length);
  controlla("simulazione: nessuna consegna rimasta in invio o in coda alla fine", !consegne(m).some((c) => c.stato === "in_invio" || c.stato === "in_coda"), consegne(m).filter((c) => c.stato === "in_coda" || c.stato === "in_invio").map((c) => c.id));
  controlla("simulazione: la gara salvata tardi (a 5 giorni dalla scadenza, il giorno della soglia) non recupera i promemoria passati, riceve quello a 1 giorno", !eventi(m).some((e) => e.gara_chiave === `p:${tarda.id}` && ["scadenza_10", "scadenza_5"].includes(String(e.tipo))) && eventi(m).some((e) => e.gara_chiave === `p:${tarda.id}` && e.tipo === "scadenza_1"));
  const giorniEventi = new Set(m.db.t("radar_notifiche_giri").filter((g) => g.fase === "eventi" && g.esito === "riuscito").map((g) => g.giorno_roma));
  controlla("simulazione: un giro «eventi» al giorno (9 giorni con passaggi, il 27 senza)", giorniEventi.size === 9 && !giorniEventi.has("2026-10-27"), [...giorniEventi]);
  controlla("simulazione: giorno di Roma corretto anche dopo il cambio d'ora (25/10)", giornoRoma(new Date("2026-10-25T23:30:00Z")) === "2026-10-26" && giornoRoma(new Date("2026-10-24T22:30:00Z")) === "2026-10-25");
  const massimo = Math.max(...richiestePerGiorno);

  controlla("simulazione: richieste al giorno entro il limite (≤ 160) e mai a valanga", massimo <= 160, { richiestePerGiorno });
  console.log(`Simulazione di 10 giorni (2 imprese sintetiche, 29 passaggi al giorno): richieste al giorno ${richiestePerGiorno.join(", ")}; email ${m.provider.consegnate.length}, eventi ${eventi(m).length}, consegne ${consegne(m).length}`);
}

function provaTesto(): void {
  const cartella = path.join(__dirname, "..", "src", "lib", "radar", "notifiche");
  const leggi = (f: string) => fs.readFileSync(path.join(cartella, f), "utf8");
  const senzaCommenti = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const motore = senzaCommenti(leggi("motore.ts"));
  controlla("motore: l'interruttore unico prima di qualunque lettura", motore.indexOf("statoInvioEmail(d.env)") > 0 && motore.indexOf("statoInvioEmail(d.env)") < motore.indexOf("await ultimiGiriEventi(d)"));
  controlla("motore: provider diverso dal finto rifiutato", /d\.provider\.nome !== "finto"/.test(motore));
  const rotta = fs.readFileSync(path.join(__dirname, "..", "src", "app", "api", "cron", "radar-promemoria", "route.ts"), "utf8");
  const r = senzaCommenti(rotta);
  controlla("rotta: CRON_SECRET controllato prima dell'interruttore e prima di caricare il motore", r.indexOf("cronAutorizzato(") > 0 && r.indexOf("cronAutorizzato(") < r.indexOf("statoInvioEmail(") && r.indexOf("statoInvioEmail(") < r.indexOf('import("@/lib/radar/notifiche/motore")'));
  controlla("rotta: nessun import statico del database né del motore", !/^import .*(supabase\/admin|notifiche\/motore)/m.test(rotta));
  controlla("rotta: NON in vercel.json", !fs.readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8").includes("radar-promemoria"));
  const resend = senzaCommenti(leggi("provider-resend.ts"));
  controlla("provider-resend: nessuna chiamata di rete diretta (solo la funzione iniettata)", !/\bfetch\s*\(/.test(resend) && /richiedi\(r\.url/.test(resend));
  controlla("provider-resend: si costruisce solo con resendConsentito()", /if \(!resendConsentito\(\)\) throw/.test(resend));
  controlla("provider: resendConsentito restituisce false", /export function resendConsentito\(\): false \{\s*return false;/.test(leggi("provider.ts")));
  const ravv = senzaCommenti(leggi("ravvicinata.ts"));
  controlla("ravvicinata: il motore si carica solo dopo l'interruttore", ravv.indexOf("invioEmailAcceso(env)") > 0 && ravv.indexOf("invioEmailAcceso(env)") < ravv.indexOf('await import("./motore")'));
  for (const f of ["motore.ts", "eventi-calcoli.ts", "provider.ts", "provider-resend.ts", "parametri.ts"]) {
    const t = leggi(f);
    controlla(`${f}: nessun import di src/lib/email.ts`, !/lib\/email["']/.test(t));
    controlla(`${f}: righe con LF`, !t.includes("\r\n"));
  }
}

principale()
  .catch((e) => falliti.push(`eccezione: ${e instanceof Error ? `${e.message}\n${e.stack}` : String(e)}`))
  .finally(() => {
    console.log(`Verifica B4 motore delle notifiche: ${ok} ok, ${falliti.length} falliti`);
    for (const f of falliti) console.log(`  FALLITO: ${f}`);
    process.exit(falliti.length ? 1 : 0);
  });
