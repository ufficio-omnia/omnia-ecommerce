// Strumento dei test (NON fa parte dell'applicazione): un database finto in memoria che si comporta come le chiamate a Supabase usate
// dal tracciamento della demo (select / insert / update / upsert / delete con eq, neq, in, is, not, lt, lte, gt, gte, limit, count,
// maybeSingle) e un «fetch» finto che registra le chiamate. Serve a provare, senza rete e senza toccare il database vero, che il
// salvataggio, la sincronizzazione del calendario, gli invii a GA4 e a Google Ads e la conservazione facciano ciò che devono.
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type Riga = Record<string, unknown>;
type Errore = { code: string; message: string } | null;
type Risultato = { data: unknown; error: Errore; count: number | null };

type IndiceUnico = { tabella: string; colonne: string[]; dove?: (r: Riga) => boolean };

const PREDEFINITI: Record<string, (ora: string) => Riga> = {
  demo_leads: (ora) => ({
    id: randomUUID(),
    created_at: ora,
    updated_at: ora,
    phone: null,
    gclid: null, gbraid: null, wbraid: null, utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, utm_term: null,
    landing_path: null, ga_client_id: null, ga_session_id: null, attribution_consent: false,
    ads_measurement_consent: false, ads_measurement_consent_at: null, ip_hash: null,
    booking_status: "pending", calendar_event_id: null, calendar_id: null, booked_at: null, booking_starts_at: null, booking_match_note: null,
    ga4_sent_at: null, ga4_attempts: 0,
    ads_import_status: "not_ready", ads_transaction_id: null, ads_request_id: null, ads_sent_at: null, ads_attempts: 0, ads_next_attempt_at: null, ads_last_error: null,
  }),
  demo_calendar_casi: (ora) => ({ id: randomUUID(), created_at: ora, risolto: false, attendee_email_norm: null, event_created_at: null, event_starts_at: null, note: null }),
};

const INDICI_UNICI: IndiceUnico[] = [
  { tabella: "demo_leads", colonne: ["calendar_event_id"], dove: (r) => r.calendar_event_id != null },
  { tabella: "demo_leads", colonne: ["email_norm"], dove: (r) => r.booking_status === "pending" },
  { tabella: "demo_calendar_casi", colonne: ["calendar_event_id"] },
];

export class FintoDatabase {
  tabelle: Record<string, Riga[]> = {};
  // errore da restituire per OGNI operazione su una tabella (per provare «tabella non creata» o «database fuori uso»)
  errori: Record<string, { code: string; message: string }> = {};
  operazioni: { tabella: string; tipo: string }[] = [];
  // l'ora che il «database» assegna alle righe nuove (created_at): nei test si imposta alla data di prova
  ora: () => string = () => new Date().toISOString();

  constructor(iniziale: Record<string, Riga[]> = {}) {
    this.tabelle = Object.fromEntries(Object.entries(iniziale).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
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
}

class Interrogazione implements PromiseLike<Risultato> {
  private filtri: ((r: Riga) => boolean)[] = [];
  private tipo: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private dati: Riga | null = null;
  private restituisce = false;
  private conteggio = false;
  private soloConteggio = false;
  private limite: number | null = null;
  private singolo = false;
  private suColonna: string | null = null;

  constructor(private db: FintoDatabase, private tabella: string) {}

  select(_colonne?: string, opzioni?: { count?: string; head?: boolean }) {
    if (this.tipo === "select") {
      this.conteggio = opzioni?.count === "exact";
      this.soloConteggio = opzioni?.head === true;
    } else this.restituisce = true;
    return this;
  }
  insert(dati: Riga) { this.tipo = "insert"; this.dati = dati; return this; }
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
  maybeSingle<T = unknown>(): PromiseLike<{ data: T | null; error: Errore; count: number | null }> {
    this.singolo = true;
    return this as unknown as PromiseLike<{ data: T | null; error: Errore; count: number | null }>;
  }

  private esegui(): Risultato {
    this.db.operazioni.push({ tabella: this.tabella, tipo: this.tipo });
    const errore = this.db.errori[this.tabella];
    if (errore) return { data: null, error: errore, count: null };
    const righe = this.db.da(this.tabella);
    const corrispondenti = () => righe.filter((r) => this.filtri.every((f) => f(r)));
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
      const nuova = { ...(PREDEFINITI[this.tabella]?.(this.db.ora()) ?? {}), ...(this.dati as Riga) };
      if (this.db.violaUnicita(this.tabella, nuova)) return { data: null, error: { code: "23505", message: "duplicate key" }, count: null };
      righe.push(nuova);
      return this.restituisce ? uscita([nuova]) : { data: null, error: null, count: null };
    }
    if (this.tipo === "update") {
      const trovate = corrispondenti();
      for (const r of trovate) {
        const aggiornata = { ...r, ...(this.dati as Riga) };
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
    const daTogliere = corrispondenti();
    this.db.tabelle[this.tabella] = righe.filter((r) => !daTogliere.includes(r));
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
