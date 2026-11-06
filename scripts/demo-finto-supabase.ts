// Strumento dei test (NON fa parte dell'applicazione): un database finto in memoria che si comporta come le chiamate a Supabase usate
// dal tracciamento della demo (select / insert / update / upsert / delete con eq, neq, in, is, not, lt, lte, gt, gte, limit, count,
// maybeSingle) e un «fetch» finto che registra le chiamate. Serve a provare, senza rete e senza toccare il database vero, che il
// salvataggio, la sincronizzazione del calendario, gli invii a GA4 e a Google Ads e la conservazione facciano ciò che devono.
//
// Imita anche i vincoli della migrazione 0098 che contano per la logica: indici unici (contatto per email, richiesta per chiave di
// idempotenza, prenotazione per evento, caso per evento), chiavi esterne con cancellazione a cascata, controlli sugli stati, il
// divieto di modificare il registro dei consensi (UPDATE) e la riga unica dello stato di sincronizzazione.
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type Riga = Record<string, unknown>;
type Errore = { code: string; message: string } | null;
type Risultato = { data: unknown; error: Errore; count: number | null };

type IndiceUnico = { tabella: string; colonne: string[]; dove?: (r: Riga) => boolean };

const PREDEFINITI: Record<string, (ora: string) => Riga> = {
  demo_contatti: (ora) => ({ id: randomUUID(), created_at: ora, updated_at: ora, phone: null, ultima_richiesta_il: ora }),
  demo_leads: (ora) => ({
    id: randomUUID(),
    created_at: ora,
    updated_at: ora,
    phone: null,
    gclid: null, gbraid: null, wbraid: null, utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, utm_term: null,
    landing_path: null, ga_client_id: null, ga_session_id: null, attribution_consent: false,
    ads_measurement_consent: false, ads_measurement_consent_at: null, ip_hash: null,
    booking_status: "pending", superseded_by: null, prima_prenotazione_il: null,
    ga4_sent_at: null, ga4_attempts: 0,
    ads_import_status: "not_ready", ads_transaction_id: null, ads_request_id: null, ads_sent_at: null, ads_attempts: 0, ads_next_attempt_at: null, ads_last_error: null,
  }),
  demo_prenotazioni: (ora) => ({ id: randomUUID(), created_at: ora, updated_at: ora, stato: "confirmed", starts_at: null, starts_at_originale: null, riprogrammata_il: null, cancelled_at: null, match_note: null }),
  demo_consensi: (ora) => ({ id: randomUUID(), registrato_il: ora, dichiarato_dal_browser: false, ip_hash: null, firma: null }),
  demo_calendar_casi: (ora) => ({ id: randomUUID(), created_at: ora, risolto: false, attendee_email_norm: null, event_created_at: null, event_starts_at: null, note: null }),
  demo_sync_stato: () => ({ sync_token: null, last_run_at: null, last_success_at: null, last_error: null, lock_until: null }),
  demo_ga4_prove: (ora) => ({ origine: "prova", riservata_il: ora, riservata_da: null, inviata_il: null, esito_codice: null, http_status: null, risolta_il: null, risolta_da: null, aggiornata_il: ora }),
};

const INDICI_UNICI: IndiceUnico[] = [
  { tabella: "demo_contatti", colonne: ["email_norm"] },
  { tabella: "demo_leads", colonne: ["idempotency_key"] },
  { tabella: "demo_prenotazioni", colonne: ["calendar_id", "calendar_event_id"] },
  { tabella: "demo_calendar_casi", colonne: ["calendar_event_id"] },
  { tabella: "demo_sync_stato", colonne: ["id"] },
  // migrazione 0099: una sola prova (una sola prenotazione dell'invio) per richiesta
  { tabella: "demo_ga4_prove", colonne: ["lead_id"] },
];

// chiave esterna: la colonna `colonna` di `tabella` punta all'id di `verso`; «cascata» = si cancella con la riga a cui punta,
// «azzera» = diventa null
const CHIAVI_ESTERNE: { tabella: string; colonna: string; verso: string; alla: "cascata" | "azzera" }[] = [
  { tabella: "demo_leads", colonna: "contatto_id", verso: "demo_contatti", alla: "cascata" },
  { tabella: "demo_prenotazioni", colonna: "lead_id", verso: "demo_leads", alla: "cascata" },
  { tabella: "demo_consensi", colonna: "lead_id", verso: "demo_leads", alla: "cascata" },
  { tabella: "demo_leads", colonna: "superseded_by", verso: "demo_leads", alla: "azzera" },
];

const STATI_RICHIESTA = ["pending", "confirmed", "cancelled", "superseded"];
const STATI_ADS = ["not_ready", "ready", "validated", "sent", "accepted", "failed", "skipped_no_consent", "skipped_no_identifier", "skipped_cancelled"];

// controlli (CHECK) della migrazione: restituiscono il motivo della violazione, o null
const CONTROLLI: Record<string, (r: Riga) => string | null> = {
  demo_leads: (r) => {
    if (!STATI_RICHIESTA.includes(r.booking_status as string)) return "booking_status";
    if (!STATI_ADS.includes(r.ads_import_status as string)) return "ads_import_status";
    if (r.booking_status === "confirmed" && r.prima_prenotazione_il == null) return "demo_leads_confermata_ha_data";
    const chiave = r.idempotency_key;
    if (typeof chiave !== "string" || chiave.length < 16 || chiave.length > 80) return "idempotency_key";
    return null;
  },
  demo_prenotazioni: (r) => (["confirmed", "cancelled"].includes(r.stato as string) ? null : "stato"),
  demo_consensi: (r) => {
    if (!["informativa_privacy", "misurazione_pubblicitaria", "cookie_pubblicitari"].includes(r.tipo as string)) return "tipo";
    if (!["granted", "denied"].includes(r.valore as string)) return "valore";
    if (typeof r.testo_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(r.testo_sha256)) return "testo_sha256";
    if (r.firma != null && !/^[0-9a-f]{64}$/.test(String(r.firma))) return "firma";
    return null;
  },
  // migrazione 0099: stati, origine, modalità dell'ora, codici d'esito
  demo_ga4_prove: (r) => {
    if (!STATI_PROVA.includes(r.stato as string)) return "stato";
    if (!["prova", "cron"].includes(r.origine as string)) return "origine";
    if (!["prenotazione", "invio"].includes(r.timestamp_modalita as string)) return "timestamp_modalita";
    if (r.esito_codice != null && !["http_2xx", "http_4xx", "http_altro", "timeout", "rete"].includes(r.esito_codice as string)) return "esito_codice";
    if (r.http_status != null && ((r.http_status as number) < 100 || (r.http_status as number) > 599)) return "http_status";
    return null;
  },
};

const STATI_PROVA = ["reserved", "sent_unverified", "uncertain", "rejected", "verified", "not_received"];

// il trigger demo_ga4_prove_regole della migrazione 0099: dati della prenotazione immutabili, stati finali, transizioni ammesse
function regoleProveGa4(vecchia: Riga, nuova: Riga): string | null {
  for (const c of ["lead_id", "origine", "transaction_id", "id_misurazione", "timestamp_evento", "timestamp_modalita", "riservata_il", "riservata_da"]) {
    if (vecchia[c] !== nuova[c]) return "demo_ga4_prove: i dati della prenotazione dell'invio non si modificano";
  }
  const da = vecchia.stato as string;
  const a = nuova.stato as string;
  if (da === "verified" || da === "not_received") return `demo_ga4_prove: lo stato ${da} è finale`;
  if (da === "reserved" && a === "reserved") return "demo_ga4_prove: da reserved non si va in reserved";
  if ((da === "sent_unverified" || da === "uncertain" || da === "rejected") && a !== "verified" && a !== "not_received") return `demo_ga4_prove: da ${da} si può andare solo in verified o not_received`;
  return null;
}

export class FintoDatabase {
  tabelle: Record<string, Riga[]> = {};
  // errore da restituire per OGNI operazione su una tabella (per provare «tabella non creata» o «database fuori uso»)
  errori: Record<string, { code: string; message: string }> = {};
  // guasto mirato: riceve tabella, tipo di operazione e dati; se restituisce un errore l'operazione fallisce (per provare «il secondo
  // salvataggio non riesce» e simili)
  guasto: ((tabella: string, tipo: string, dati: Riga | Riga[] | null) => Errore) | null = null;
  operazioni: { tabella: string; tipo: string }[] = [];
  // l'ora che il «database» assegna alle righe nuove (created_at): nei test si imposta alla data di prova
  ora: () => string = () => new Date().toISOString();

  constructor(iniziale: Record<string, Riga[]> = {}) {
    this.tabelle = Object.fromEntries(Object.entries(iniziale).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
    // la migrazione inserisce la riga unica dello stato di sincronizzazione
    if (!this.tabelle.demo_sync_stato) this.tabelle.demo_sync_stato = [{ id: 1, ...PREDEFINITI.demo_sync_stato("") }];
  }
  da(tabella: string): Riga[] {
    return (this.tabelle[tabella] ??= []);
  }
  from(tabella: string) {
    return new Interrogazione(this, tabella);
  }
  comeClient(): SupabaseClient {
    return this as unknown as SupabaseClient;
  }
  violaUnicita(tabella: string, riga: Riga, escludi?: Riga): boolean {
    return INDICI_UNICI.filter((i) => i.tabella === tabella).some((indice) => {
      if (indice.dove && !indice.dove(riga)) return false;
      if (indice.colonne.some((c) => riga[c] == null)) return false;
      return this.da(tabella).some((altra) => altra !== escludi && (!indice.dove || indice.dove(altra)) && indice.colonne.every((c) => altra[c] === riga[c]));
    });
  }
  // chiave esterna violata: la colonna punta a una riga che non esiste
  violaChiaveEsterna(tabella: string, riga: Riga): boolean {
    return CHIAVI_ESTERNE.filter((f) => f.tabella === tabella).some((f) => riga[f.colonna] != null && !this.da(f.verso).some((r) => r.id === riga[f.colonna]));
  }
  // cancella le righe indicate e ciò che dipende da loro (cascata) o le azzera
  cancella(tabella: string, daTogliere: Riga[]): void {
    if (daTogliere.length === 0) return;
    const ids = new Set(daTogliere.map((r) => r.id));
    this.tabelle[tabella] = this.da(tabella).filter((r) => !daTogliere.includes(r));
    for (const f of CHIAVI_ESTERNE.filter((x) => x.verso === tabella)) {
      const figli = this.da(f.tabella).filter((r) => ids.has(r[f.colonna]));
      if (f.alla === "cascata") this.cancella(f.tabella, figli);
      else for (const r of figli) r[f.colonna] = null;
    }
  }
}

class Interrogazione implements PromiseLike<Risultato> {
  private filtri: ((r: Riga) => boolean)[] = [];
  private tipo: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private dati: Riga | Riga[] | null = null;
  private restituisce = false;
  private conteggio = false;
  private soloConteggio = false;
  private limite: number | null = null;
  private singolo = false;
  private suColonna: string | null = null;
  private ordine: { colonna: string; crescente: boolean }[] = [];

  constructor(private db: FintoDatabase, private tabella: string) {}

  select(_colonne?: string, opzioni?: { count?: string; head?: boolean }) {
    if (this.tipo === "select") {
      this.conteggio = opzioni?.count === "exact";
      this.soloConteggio = opzioni?.head === true;
    } else this.restituisce = true;
    return this;
  }
  insert(dati: Riga | Riga[]) { this.tipo = "insert"; this.dati = dati; return this; }
  update(dati: Riga) { this.tipo = "update"; this.dati = dati; return this; }
  upsert(dati: Riga, opzioni?: { onConflict?: string }) { this.tipo = "upsert"; this.dati = dati; this.suColonna = opzioni?.onConflict ?? null; return this; }
  delete(opzioni?: { count?: string }) { this.tipo = "delete"; this.conteggio = opzioni?.count === "exact"; return this; }
  eq(c: string, v: unknown) { this.filtri.push((r) => r[c] === v); return this; }
  neq(c: string, v: unknown) { this.filtri.push((r) => r[c] !== v); return this; }
  in(c: string, v: unknown[]) { this.filtri.push((r) => v.includes(r[c])); return this; }
  is(c: string, v: null) { this.filtri.push((r) => (v === null ? r[c] == null : r[c] === v)); return this; }
  not(c: string, op: string, v: unknown) {
    if (op === "is" && v === null) this.filtri.push((r) => r[c] != null);
    return this;
  }
  lt(c: string, v: unknown) { this.filtri.push((r) => r[c] != null && (r[c] as string | number) < (v as string | number)); return this; }
  lte(c: string, v: unknown) { this.filtri.push((r) => r[c] != null && (r[c] as string | number) <= (v as string | number)); return this; }
  gt(c: string, v: unknown) { this.filtri.push((r) => r[c] != null && (r[c] as string | number) > (v as string | number)); return this; }
  gte(c: string, v: unknown) { this.filtri.push((r) => r[c] != null && (r[c] as string | number) >= (v as string | number)); return this; }
  limit(n: number) { this.limite = n; return this; }
  order(colonna: string, opzioni?: { ascending?: boolean }) { this.ordine.push({ colonna, crescente: opzioni?.ascending !== false }); return this; }
  returns<T = unknown>(): this & { __tipo?: T } { return this; }
  maybeSingle<T = unknown>(): PromiseLike<{ data: T | null; error: Errore; count: number | null }> {
    this.singolo = true;
    return this as unknown as PromiseLike<{ data: T | null; error: Errore; count: number | null }>;
  }

  private errorePerRiga(nuova: Riga): Errore {
    const controllo = CONTROLLI[this.tabella]?.(nuova);
    if (controllo) return { code: "23514", message: `check violation: ${controllo}` };
    if (this.db.violaChiaveEsterna(this.tabella, nuova)) return { code: "23503", message: "foreign key violation" };
    return null;
  }

  private esegui(): Risultato {
    this.db.operazioni.push({ tabella: this.tabella, tipo: this.tipo });
    const errore = this.db.errori[this.tabella];
    if (errore) return { data: null, error: errore, count: null };
    const guasto = this.db.guasto?.(this.tabella, this.tipo, this.dati);
    if (guasto) return { data: null, error: guasto, count: null };
    const righe = this.db.da(this.tabella);
    const corrispondenti = () => {
      const trovate = righe.filter((r) => this.filtri.every((f) => f(r)));
      if (this.ordine.length === 0) return trovate;
      return [...trovate].sort((a, b) => {
        for (const o of this.ordine) {
          const x = a[o.colonna] as string | number | null;
          const y = b[o.colonna] as string | number | null;
          if (x === y) continue;
          if (x == null) return o.crescente ? 1 : -1;
          if (y == null) return o.crescente ? -1 : 1;
          return (x < y ? -1 : 1) * (o.crescente ? 1 : -1);
        }
        return 0;
      });
    };
    const uscita = (insieme: Riga[]): Risultato => {
      const limitate = this.limite === null ? insieme : insieme.slice(0, this.limite);
      return { data: this.singolo ? (limitate[0] ? { ...limitate[0] } : null) : limitate.map((r) => ({ ...r })), error: null, count: this.conteggio ? insieme.length : null };
    };

    if (this.tipo === "select") {
      const trovate = corrispondenti();
      if (this.soloConteggio) return { data: null, error: null, count: trovate.length };
      return uscita(trovate);
    }
    if (this.tipo === "insert") {
      const daInserire = (Array.isArray(this.dati) ? this.dati : [this.dati as Riga]).map((d) => ({ ...(PREDEFINITI[this.tabella]?.(this.db.ora()) ?? {}), ...d }));
      // tutto o niente: si controlla ogni riga (anche rispetto a quelle inserite prima nello stesso comando)
      const inserite: Riga[] = [];
      for (const nuova of daInserire) {
        const e = this.errorePerRiga(nuova);
        if (e) return { data: null, error: e, count: null };
        if (this.db.violaUnicita(this.tabella, nuova) || inserite.some((i) => INDICI_UNICI.filter((x) => x.tabella === this.tabella).some((x) => x.colonne.every((c) => i[c] === nuova[c])))) {
          return { data: null, error: { code: "23505", message: "duplicate key" }, count: null };
        }
        inserite.push(nuova);
      }
      righe.push(...inserite);
      return this.restituisce ? uscita(inserite) : { data: null, error: null, count: null };
    }
    if (this.tipo === "update") {
      if (this.tabella === "demo_consensi") return { data: null, error: { code: "P0001", message: "demo_consensi si aggiunge soltanto" }, count: null };
      const trovate = corrispondenti();
      for (const r of trovate) {
        const aggiornata = { ...r, ...(this.dati as Riga) };
        if (this.tabella === "demo_ga4_prove") {
          const regola = regoleProveGa4(r, aggiornata);
          if (regola) return { data: null, error: { code: "P0001", message: regola }, count: null };
        }
        const e = this.errorePerRiga(aggiornata);
        if (e) return { data: null, error: e, count: null };
        if (this.db.violaUnicita(this.tabella, aggiornata, r)) return { data: null, error: { code: "23505", message: "duplicate key" }, count: null };
        Object.assign(r, this.dati);
      }
      return this.restituisce ? uscita(trovate) : { data: null, error: null, count: null };
    }
    if (this.tipo === "upsert") {
      const chiave = this.suColonna as string;
      const esistente = righe.find((r) => r[chiave] === (this.dati as Riga)[chiave]);
      if (esistente) Object.assign(esistente, this.dati);
      else righe.push({ ...(PREDEFINITI[this.tabella]?.(this.db.ora()) ?? {}), ...(this.dati as Riga) });
      return { data: null, error: null, count: null };
    }
    // delete
    if (this.tabella === "demo_ga4_prove") return { data: null, error: { code: "P0001", message: "demo_ga4_prove non si cancella" }, count: null };
    const daTogliere = corrispondenti();
    this.db.cancella(this.tabella, daTogliere);
    return { data: null, error: null, count: this.conteggio ? daTogliere.length : null };
  }

  then<A = Risultato, B = never>(onfulfilled?: ((v: Risultato) => A | PromiseLike<A>) | null, onrejected?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve(this.esegui()).then(onfulfilled, onrejected);
  }
}

// ── fetch finto ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export type ChiamataFinta = { url: string; metodo: string; intestazioni: Record<string, string>; corpo: string | null };
export type RispostaFinta = { status: number; json?: unknown };
export type Instradatore = (chiamata: ChiamataFinta) => RispostaFinta;

export function fetchFinto(instrada: Instradatore): { fetch: typeof fetch; chiamate: ChiamataFinta[] } {
  const chiamate: ChiamataFinta[] = [];
  const finto = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const intestazioni: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) intestazioni[k.toLowerCase()] = v;
    const corpo = init?.body == null ? null : typeof init.body === "string" ? init.body : init.body instanceof URLSearchParams ? init.body.toString() : String(init.body);
    const chiamata: ChiamataFinta = { url: String(input), metodo: init?.method ?? "GET", intestazioni, corpo };
    chiamate.push(chiamata);
    const r = instrada(chiamata);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => (r.json === undefined ? {} : r.json) } as unknown as Response;
  }) as typeof fetch;
  return { fetch: finto, chiamate };
}
