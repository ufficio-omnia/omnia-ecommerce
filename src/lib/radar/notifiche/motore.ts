// Fase B4 (20/11/2026, B2) — MOTORE delle notifiche email di Tender Intelligence: letture e scritture a blocchi, fase «eventi» (una volta
// per giorno di Roma) e fase «invio» (a ogni passaggio). Solo server, chiave di servizio. Le regole stanno nei moduli puri (calendario,
// eventi-calcoli, destinatari-calcoli, coda-calcoli); qui solo il database, l'ordine dei passi e le guardie.
//
// Guardie, in quest'ordine, PRIMA di qualunque lettura: interruttore unico (interruttore.ts: «attivo», mai anteprime, solo staging), origine
// dei collegamenti (origine.ts). Provider: in tutta la B4 SOLO il finto (provider.ts, resendConsentito sempre false).
// Nessun N+1: le letture sono a blocchi (per insiemi di imprese, gare o consegne), mai una richiesta per persona, gara o evento. L'unica
// eccezione dichiarata è lo stato dell'abbonamento (N1), letto con la stessa funzione delle pagine, una volta per impresa e per passaggio.
// Gli indirizzi email non si salvano mai: si leggono con la funzione del database (0125) al momento della creazione e dell'invio.

import { createHash } from "node:crypto";
import type { StatoClassificazione } from "../classificazioni-calcoli";
import { fontiNascosteDa } from "../fonti-gara-calcoli";
import { profiloDaRiga, COLONNE_PROFILO, POSIZIONE_PROFILO, TABELLA_PROFILI, type RigaProfilo } from "../profilo-calcoli";
import type { ProfiloRadar } from "../radar-personalizzato-contratto";
import { aggiungiGiorni, giornoRoma, versioniAttive } from "./calendario";
import { chiaveRaggruppamento, esitoDopoInvio, pianoInvioCompleto, PRIORITA_DEL_TIPO, type AggiornamentoConsegna, type ConsegnaInCoda } from "./coda-calcoli";
import { personaDaRiga, riceve, type PersonaImpresa, type PreferenzePersona, type StatoImpresaNotifiche } from "./destinatari-calcoli";
import {
  annullamentiScadenze,
  COLONNE_AGGIUNTA,
  COLONNE_GARA,
  COLONNE_LOTTO,
  COLONNE_MODIFICA,
  COLONNE_SALVATA,
  consegneDegliEventi,
  eventiModifica,
  eventiRavvicinati,
  eventiScadenza,
  eventoRiepilogo,
  gareDelleListe,
  nuovaPerIlGiro,
  nuoveDaValutare,
  type EventoAttivo,
  type EventoNuovo,
  type GaraInLista,
  type RigaAggiunta,
  type RigaGara,
  type RigaLotto,
  type RigaModifica,
  type RigaNuova,
  type RigaSalvata,
} from "./eventi-calcoli";
import { statoInvioEmail } from "./interruttore";
import { ambienteDb } from "../ambiente";

// pacchetto P: l'ambiente scritto nei giri del motore (la 0125 ammette staging, produzione e locale)
function ambienteDelGiro(env: Record<string, string | undefined>): "staging" | "produzione" {
  return ambienteDb(env.NEXT_PUBLIC_SUPABASE_URL) === "produzione" ? "produzione" : "staging";
}
import { origineAreaClienti, urlPreferenze } from "./origine";
import {
  AFFITTO_MINUTI,
  ATTESE_TENTATIVI_MINUTI,
  BLOCCO_GIRO_MINUTI,
  BLOCCO_INVIO,
  BLOCCO_SCRITTURA,
  FINESTRA_IDEMPOTENZA_ORE,
  FINESTRA_NUOVE_GIORNI,
  INVII_AL_SECONDO,
  RIPROVE_RAGGRUPPATA,
  TEMPO_MASSIMO_GIRO_MS,
  type ParametriNotifiche,
} from "./parametri";
import type { EsitoProvider, ProviderEmail } from "./provider";
import { CATEGORIA_DEL_TIPO, MASSIMO_EMAIL_SINGOLE_PER_PASSAGGIO, type ComponiEmailRadar, type EventoModifica, type EventoRadar, type EventoRaggruppato, type EventoScadenza, type TipoEvento } from "./tipi";
import type { EsitoRavvicinata, GaraEntrataInLista } from "./ravvicinata";

export const T = {
  impostazioni: "omnia_ai_radar_impostazioni",
  impresa: "omnia_ai_radar_notifiche_impresa",
  persone: "omnia_ai_radar_notifiche_persone",
  eventi: "omnia_ai_radar_eventi",
  consegne: "omnia_ai_radar_email_consegne",
  giri: "radar_notifiche_giri",
  salvate: "omnia_ai_radar_salvate",
  aggiunte: "omnia_ai_radar_gare_aggiunte",
  procedure: "radar_procedure",
  lotti: "radar_lotti",
  registro: "radar_aggiornamenti",
  fonti: "radar_fonti_stato",
  stato: "radar_classificazioni_stato",
  classificazioni: "radar_classificazioni",
} as const;

/** Stato d'accesso dell'impresa (getOmniaAiAccessState di omnia-ai-access.ts): «attivo» o «prova» = abbonamento valido (N1). */
export type StatoAccesso = "attivo" | "prova" | "sola_lettura" | "cessato";

/** Tutto ciò che il motore usa dal mondo esterno: iniettato, così le prove girano su un database in memoria e con l'orologio fermo. */
export type DipendenzeMotore = {
  admin: ClientDb;
  env: Record<string, string | undefined>;
  provider: ProviderEmail;
  componi: ComponiEmailRadar;
  parametri: ParametriNotifiche;
  statoAccesso: (impresaId: string) => Promise<StatoAccesso>;
  adesso: () => Date;
  nuovoId: () => string;
  /** pausa tra due invii (al più INVII_AL_SECONDO); nelle prove nessuna attesa */
  attendi: (ms: number) => Promise<void>;
  /** è l'ultimo passaggio del giorno di Roma? (dopo non ce n'è un altro lo stesso giorno) */
  ultimoPassaggio: (adesso: Date) => boolean;
  /** cursore delle «nuove» al primissimo giro (nessun giro precedente): di base 24 ore prima */
  cursoreNuoveIniziale?: (adesso: Date) => string;
  /**
   * Fonti da trattare come NASCOSTE ai clienti in aggiunta a quelle che il database indica (radar_fonti_stato.nascosta_ai_clienti).
   * FACOLTATIVO, di base nessuna: la rotta, l'aggancio e il giro del collaudo Z8 non lo impostano. Resta per le sole prove (la PVL
   * nascosta del collaudo Z8 è superata dalla direttiva 48A: le gare PVL sono visibili come quelle delle altre fonti).
   */
  fontiNascosteAggiunte?: readonly string[];
};

/** Ultimo passaggio del giorno con la programmazione consigliata (ogni 30 minuti dalle 05:30 alle 19:30 UTC, decisione 1). */
export function ultimoPassaggioProgrammato(adesso: Date): boolean {
  return adesso.getUTCHours() * 60 + adesso.getUTCMinutes() >= 19 * 60 + 15;
}

export type Conteggi = Record<string, number>;

export type EsitoPassaggio =
  | { eseguito: false; motivo: string }
  | { eseguito: true; eventi: Conteggi | { saltata: string }; invio: Conteggi; erroreInvio: string | null; durataMs: number };

class ErroreDb extends Error {
  constructor(readonly passo: string, readonly codice: string) {
    super(`${passo}: ${codice}`);
  }
}

/** La risposta di PostgREST come la usa il motore. */
export type RispostaDb = { data: unknown; error: { code?: string; message?: string } | null };
/**
 * Il SOLO sottoinsieme del client di Supabase che il motore usa (stessi nomi e argomenti di supabase-js). Il motore non dipende dai tipi
 * generati: il controllo dei tipi resta veloce e le prove usano un database in memoria con la stessa interfaccia.
 */
export interface CostruttoreDb extends PromiseLike<RispostaDb> {
  select(colonne?: string): CostruttoreDb;
  eq(c: string, v: unknown): CostruttoreDb;
  neq(c: string, v: unknown): CostruttoreDb;
  gt(c: string, v: string): CostruttoreDb;
  gte(c: string, v: string): CostruttoreDb;
  lt(c: string, v: string): CostruttoreDb;
  lte(c: string, v: string): CostruttoreDb;
  in(c: string, v: readonly unknown[]): CostruttoreDb;
  is(c: string, v: null): CostruttoreDb;
  not(c: string, op: "is", v: null): CostruttoreDb;
  /** filtro «or» di PostgREST, es. «and(stato.eq.in_coda,prossimo_tentativo_il.lte.<istante>),and(…)» (solo valori senza virgole né parentesi) */
  or(filtri: string): CostruttoreDb;
  order(c: string, o?: { ascending?: boolean }): CostruttoreDb;
  limit(n: number): CostruttoreDb;
  update(v: Record<string, unknown>): CostruttoreDb;
  insert(v: Record<string, unknown> | Record<string, unknown>[]): CostruttoreDb;
  upsert(v: Record<string, unknown>[], o?: { onConflict?: string; ignoreDuplicates?: boolean }): CostruttoreDb;
  delete(): CostruttoreDb;
}
export interface ClientDb {
  from(tabella: string): CostruttoreDb;
  rpc(funzione: string, argomenti: Record<string, unknown>): PromiseLike<RispostaDb>;
}

function controlla<T>(passo: string, r: RispostaDb): T {
  if (r.error) throw new ErroreDb(passo, String(r.error.code ?? "errore").slice(0, 40));
  return (r.data ?? ([] as unknown)) as T;
}

function blocchi<T>(xs: readonly T[], n: number): T[][] {
  const esito: T[][] = [];
  for (let i = 0; i < xs.length; i += n) esito.push(xs.slice(i, i + n));
  return esito;
}

/** Le letture per insiemi di identificativi vanno a blocchi di 150 (lunghezza dell'indirizzo di PostgREST). */
const BLOCCO_ID = 150;

async function leggiPer<T>(passo: string, ids: readonly string[], leggi: (b: string[]) => PromiseLike<RispostaDb>): Promise<T[]> {
  const esito: T[] = [];
  for (const b of blocchi([...new Set(ids)], BLOCCO_ID)) esito.push(...controlla<T[]>(passo, await leggi(b)));
  return esito;
}

const impronta = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);

// ───────────────────────── stato delle imprese, persone e preferenze ─────────────────────────

type QuadroImprese = {
  imprese: Map<string, StatoImpresaNotifiche>;
  persone: PersonaImpresa[];
  preferenze: Map<string, PreferenzePersona>;
};

/** Le imprese con le email accese E il Radar attivo in console, con persone (funzione 0125) e preferenze. Nessuna impresa: nessuna lettura in più. */
async function leggiQuadro(d: DipendenzeMotore, soloImprese: readonly string[] | null, conteggi: Conteggi): Promise<QuadroImprese> {
  const q = d.admin.from(T.impresa).select("impresa_id, email_attive").eq("email_attive", true);
  const accese = controlla<{ impresa_id: string }[]>("imprese con le email accese", await (soloImprese ? q.in("impresa_id", [...soloImprese]) : q));
  const ids = accese.map((r) => r.impresa_id);
  const imprese = new Map<string, StatoImpresaNotifiche>();
  if (!ids.length) return { imprese, persone: [], preferenze: new Map() };
  const attive = await leggiPer<{ user_id: string; attivo: boolean }>("radar attivo", ids, (b) => d.admin.from(T.impostazioni).select("user_id, attivo").in("user_id", b));
  const radar = new Map(attive.map((r) => [r.user_id, r.attivo === true]));
  for (const id of ids) {
    if (!radar.get(id)) continue;
    let abbonamentoValido: boolean | null = null;
    if (d.parametri.abbonamentoRichiesto) {
      const s = await d.statoAccesso(id);
      conteggi.letture_abbonamento = (conteggi.letture_abbonamento ?? 0) + 1;
      abbonamentoValido = s === "attivo" || s === "prova";
    }
    imprese.set(id, { impresaId: id, radarAttivo: true, emailAttive: true, abbonamentoValido });
  }
  const valide = [...imprese.keys()];
  if (!valide.length) return { imprese, persone: [], preferenze: new Map() };
  const righePref = await leggiPer<PreferenzePersona & { impresa_id: string; user_id: string }>("preferenze", valide, (b) =>
    d.admin.from(T.persone).select("impresa_id, user_id, nuove_opportunita, scadenze, rettifiche, email_bloccata_il, motivo_blocco").in("impresa_id", b),
  );
  const preferenze = new Map<string, PreferenzePersona>();
  for (const r of righePref) preferenze.set(r.user_id, r);
  const persone: PersonaImpresa[] = [];
  for (const b of blocchi(valide, 1000)) {
    const righe = controlla<unknown[]>("destinatari", (await d.admin.rpc("radar_notifiche_destinatari", { p_imprese: b })) as { data: unknown[] | null; error: { code?: string } | null });
    for (const r of righe) {
      const p = personaDaRiga(r);
      // solo persone delle imprese richieste (la funzione lo garantisce; qui si ricontrolla)
      if (p && imprese.has(p.impresaId)) persone.push(p);
    }
  }
  return { imprese, persone, preferenze };
}

/** Le fonti nascoste ai clienti (0120): nessuna email da queste fonti. */
async function leggiNascoste(d: DipendenzeMotore): Promise<Set<string>> {
  // la STESSA regola delle pagine (fonti-gara-calcoli.ts): la riga del database se c'è, altrimenti la predefinita (SardegnaCAT e PVL, L5a)
  const r = controlla<{ fonte: string; nascosta_ai_clienti: boolean | null }[]>("fonti nascoste", await d.admin.from(T.fonti).select("fonte, nascosta_ai_clienti"));
  return new Set<string>([...fontiNascosteDa(r), ...(d.fontiNascosteAggiunte ?? [])]);
}

/** Le liste delle imprese date (salvate ∪ monitorate) con le gare dell'archivio, i lotti e le gare aggiunte a mano. */
async function leggiListe(d: DipendenzeMotore, imprese: readonly string[], nascoste: ReadonlySet<string>, origine: string): Promise<GaraInLista[]> {
  if (!imprese.length) return [];
  const salvate = await leggiPer<RigaSalvata>("liste", imprese, (b) => d.admin.from(T.salvate).select(COLONNE_SALVATA).in("user_id", b));
  const aggiunteIds = salvate.map((s) => s.aggiunta_id).filter((x): x is string => !!x);
  const aggiunte = await leggiPer<RigaAggiunta>("gare aggiunte", aggiunteIds, (b) => d.admin.from(T.aggiunte).select(COLONNE_AGGIUNTA).in("id", b));
  const procIds = [...salvate.map((s) => s.procedura_id), ...aggiunte.map((a) => a.procedura_id)].filter((x): x is string => !!x);
  const procedure = await leggiPer<RigaGara>("gare delle liste", procIds, (b) => d.admin.from(T.procedure).select(COLONNE_GARA).in("id", b));
  // gare collegate a un'altra (0117): si legge anche quella che resta (una sola risalita, nessuna catena)
  const mancanti = procedure.map((p) => p.unita_a).filter((x): x is string => !!x && !procedure.some((p) => p.id === x));
  if (mancanti.length) procedure.push(...(await leggiPer<RigaGara>("gare che restano", mancanti, (b) => d.admin.from(T.procedure).select(COLONNE_GARA).in("id", b))));
  const lotti = await leggiPer<RigaLotto>("lotti", procedure.map((p) => p.id), (b) => d.admin.from(T.lotti).select(COLONNE_LOTTO).in("procedura_id", b));
  const perProcedura = new Map<string, RigaLotto[]>();
  for (const l of lotti) perProcedura.set(l.procedura_id, [...(perProcedura.get(l.procedura_id) ?? []), l]);
  return gareDelleListe({
    salvate,
    procedure: new Map(procedure.map((p) => [p.id, p])),
    lotti: perProcedura,
    aggiunte: new Map(aggiunte.map((a) => [a.id, a])),
    nascoste,
    origine,
  });
}

// ───────────────────────── giri ─────────────────────────

type RigaGiro = { id: string; giorno_roma: string; fase: string; esito: string; iniziato_il: string; cursore_modifiche: string | null; cursore_nuove: string | null; nuove_in_sospeso: string[] | null; conteggi: Conteggi };

async function ultimiGiriEventi(d: DipendenzeMotore): Promise<RigaGiro[]> {
  return controlla<RigaGiro[]>(
    "ultimi giri",
    await d.admin.from(T.giri).select("id, giorno_roma, fase, esito, iniziato_il, cursore_modifiche, cursore_nuove, nuove_in_sospeso, conteggi").eq("fase", "eventi").eq("esito", "riuscito").order("giorno_roma", { ascending: false }).order("iniziato_il", { ascending: false }).limit(1),
  );
}

/** Blocco «uno alla volta»: libera i blocchi scaduti, poi prova a scrivere il giro in corso. null = un altro giro è in corso. */
async function apriGiro(d: DipendenzeMotore, fase: "eventi" | "invio", oggi: string): Promise<string | null> {
  const adesso = d.adesso();
  controlla(
    "blocchi scaduti",
    await d.admin.from(T.giri).update({ esito: "fallito", finito_il: adesso.toISOString(), errore: "blocco_scaduto" }).eq("esito", "in_corso").lt("in_corso_fino_il", adesso.toISOString()),
  );
  const id = d.nuovoId();
  const r = await d.admin.from(T.giri).insert({
    id,
    giorno_roma: oggi,
    fase,
    esito: "in_corso",
    iniziato_il: adesso.toISOString(),
    in_corso_fino_il: new Date(adesso.getTime() + BLOCCO_GIRO_MINUTI * 60_000).toISOString(),
    ambiente: ambienteDelGiro(d.env),
    provider: d.provider.nome,
  });
  if (r.error?.code === "23505") return null;
  controlla("apertura del giro", r);
  return id;
}

async function chiudiGiro(
  d: DipendenzeMotore,
  id: string,
  esito: "riuscito" | "fallito" | "fermato",
  dati: { conteggi: Conteggi; errore?: string | null; cursore_modifiche?: string | null; cursore_nuove?: string | null; nuove_in_sospeso?: string[] },
): Promise<void> {
  const valori: Record<string, unknown> = { esito, finito_il: d.adesso().toISOString(), conteggi: dati.conteggi, errore: dati.errore ?? null };
  if (dati.cursore_modifiche !== undefined) valori.cursore_modifiche = dati.cursore_modifiche;
  if (dati.cursore_nuove !== undefined) valori.cursore_nuove = dati.cursore_nuove;
  if (dati.nuove_in_sospeso !== undefined) valori.nuove_in_sospeso = dati.nuove_in_sospeso;
  controlla("chiusura del giro", await d.admin.from(T.giri).update(valori).eq("id", id));
}

// ───────────────────────── scritture di eventi e consegne ─────────────────────────

/** Inserisce gli eventi con la chiave unica NON parziale: tornano SOLO quelli nuovi (un doppione non ferma il blocco). */
async function inserisciEventi(d: DipendenzeMotore, eventi: readonly EventoNuovo[]): Promise<EventoNuovo[]> {
  const perId = new Map(eventi.map((e) => [e.id, e]));
  const nuovi: EventoNuovo[] = [];
  for (const b of blocchi(eventi, BLOCCO_SCRITTURA)) {
    const righe = b.map((e) => ({
      id: e.id,
      impresa_id: e.impresaId,
      categoria: e.categoria,
      tipo: e.tipo,
      gara_chiave: e.garaChiave,
      procedura_id: e.proceduraId,
      aggiunta_id: e.aggiuntaId,
      aggiornamento_id: e.aggiornamentoId,
      versione: e.versione,
      dati: e.dati,
    }));
    const scritti = controlla<{ id: string }[]>(
      "eventi",
      await d.admin.from(T.eventi).upsert(righe, { onConflict: "impresa_id,gara_chiave,tipo,versione", ignoreDuplicates: true }).select("id"),
    );
    for (const s of scritti) {
      const e = perId.get(s.id);
      if (e) nuovi.push(e);
    }
  }
  return nuovi;
}

async function inserisciConsegne(d: DipendenzeMotore, eventi: readonly EventoNuovo[], quadro: QuadroImprese): Promise<number> {
  const consegne = consegneDegliEventi(eventi, quadro.persone, quadro.preferenze, quadro.imprese);
  let n = 0;
  for (const b of blocchi(consegne, BLOCCO_SCRITTURA)) {
    const scritte = controlla<{ id: string }[]>(
      "consegne",
      await d.admin.from(T.consegne).upsert(b.map((c) => ({ ...c, id: d.nuovoId(), prossimo_tentativo_il: d.adesso().toISOString() })), { onConflict: "chiave", ignoreDuplicates: true }).select("id"),
    );
    n += scritte.length;
  }
  return n;
}

// ───────────────────────── fase «eventi» ─────────────────────────

async function faseEventi(d: DipendenzeMotore, origine: string, oggi: string, precedente: RigaGiro | null): Promise<{ conteggi: Conteggi; cursori: { modifiche: string; nuove: string }; inSospeso: string[] }> {
  const c: Conteggi = {};
  const adesso = d.adesso();
  const contesto = { nuovoId: d.nuovoId, adessoIso: adesso.toISOString() };
  const quadro = await leggiQuadro(d, null, c);
  // N1: con l'abbonamento richiesto, un'impresa senza abbonamento valido non ha eventi (decisione D-E8: creazione E invio)
  const imprese = [...quadro.imprese.values()].filter((i) => i.abbonamentoValido !== false).map((i) => i.impresaId);
  c.imprese = imprese.length;
  const nascoste = await leggiNascoste(d);
  const liste = await leggiListe(d, imprese, nascoste, origine);
  c.gare_in_lista = liste.length;

  // 1) promemoria delle scadenze (con il recupero breve dei giri saltati)
  const ultimoRiuscito = precedente?.giorno_roma ?? null;
  const scadenze = eventiScadenza({ oggi, liste, ultimoGiroRiuscito: ultimoRiuscito, ...contesto });

  // 2) modifiche verificate dopo il cursore (indice parziale radar_aggiornamenti_email_idx), a pagine
  const cursoreModifiche = precedente?.cursore_modifiche ?? new Date(adesso.getTime() - 2 * 86_400_000).toISOString();
  const modifiche: RigaModifica[] = [];
  let dopo = cursoreModifiche;
  for (let pagina = 0; pagina < 20; pagina++) {
    const r = controlla<RigaModifica[]>(
      "modifiche",
      await d.admin.from(T.registro).select(COLONNE_MODIFICA).eq("notifica_email", true).gt("rilevato_il", dopo).order("rilevato_il", { ascending: true }).order("id", { ascending: true }).limit(1000),
    );
    modifiche.push(...r);
    if (r.length < 1000) break;
    dopo = r[r.length - 1].rilevato_il;
  }
  const nuovoCursoreModifiche = modifiche.length ? modifiche[modifiche.length - 1].rilevato_il : cursoreModifiche;
  const m = eventiModifica({ modifiche, liste, nascoste, env: d.env, ...contesto });
  for (const [k, v] of Object.entries(m.saltate)) c[`modifiche_saltate_${k}`] = v ?? 0;

  // 3) riepilogo delle nuove opportunità: solo per le imprese con almeno una persona che lo vuole e con un profilo
  const cursoreNuove = precedente?.cursore_nuove ?? (d.cursoreNuoveIniziale ? d.cursoreNuoveIniziale(adesso) : new Date(adesso.getTime() - 86_400_000).toISOString());
  const vogliono = imprese.filter((i) => quadro.persone.some((p) => p.impresaId === i && quadro.preferenze.get(p.userId)?.nuove_opportunita === true));
  const riepiloghi: EventoNuovo[] = [];
  let nuovoCursoreNuove = cursoreNuove;
  // difetto 3.3 (proposta A): le gare lette dal giro riuscito prima quando non erano ancora classificate. Se oggi il riepilogo non si
  // calcola (nessuno lo vuole, nessun profilo) restano com'erano: nulla si perde.
  const idsSospesi = (precedente?.nuove_in_sospeso ?? []).filter((x): x is string => typeof x === "string");
  let inSospeso: string[] = idsSospesi;
  if (vogliono.length) {
    const profili = controlla<RigaProfilo[]>("profili", await d.admin.from(TABELLA_PROFILI).select(COLONNE_PROFILO as string).in("user_id", vogliono).eq("posizione", POSIZIONE_PROFILO));
    const perImpresa = new Map<string, ProfiloRadar>();
    for (const r of profili) {
      const p = profiloDaRiga(r, r.user_id);
      if (p) perImpresa.set(r.user_id, p);
    }
    if (perImpresa.size) {
      const nuove = controlla<RigaGara[]>(
        "gare nuove",
        await d.admin.from(T.procedure).select(COLONNE_GARA).gt("prima_rilevazione_il", cursoreNuove).gte("data_pubblicazione", aggiungiGiorni(oggi, -FINESTRA_NUOVE_GIORNI)).eq("stato", "aperta").is("unita_a", null).order("prima_rilevazione_il", { ascending: true }).limit(2000),
      ).filter((r) => nuovaPerIlGiro(r, cursoreNuove, oggi));
      if (nuove.length) nuovoCursoreNuove = nuove[nuove.length - 1].prima_rilevazione_il;
      // le gare in sospeso, rilette per identificativo: UNA richiesta in più, e solo se l'elenco non è vuoto
      const sospese = await leggiPer<RigaGara>("gare in sospeso", idsSospesi, (b) => d.admin.from(T.procedure).select(COLONNE_GARA).in("id", b));
      const ids = [...new Set([...nuove.map((r) => r.id), ...sospese.map((r) => r.id)])];
      const stati = await leggiPer<{ procedura_id: string; stato: StatoClassificazione }>("stato delle classificazioni", ids, (b) => d.admin.from(T.stato).select("procedura_id, stato").in("procedura_id", b));
      const righe = await leggiPer<{ procedura_id: string; settore: string; rilevanza: "A" | "B" | "C"; sottocategorie: string[] | null; attiva: boolean }>("classificazioni", ids, (b) =>
        d.admin.from(T.classificazioni).select("procedura_id, settore, rilevanza, sottocategorie, attiva").in("procedura_id", b).eq("attiva", true),
      );
      const stato = new Map(stati.map((s) => [s.procedura_id, s]));
      const valutare = nuoveDaValutare({ nuove, idsSospesi, sospese, statoDi: new Map(stati.map((s) => [s.procedura_id, s.stato])), oggi });
      inSospeso = valutare.inSospeso;
      c.nuove_in_sospeso = valutare.inSospeso.length;
      c.nuove_rivalutate = valutare.rivalutate;
      c.nuove_sospese_uscite = valutare.uscite;
      if (valutare.oltreIlMassimo) c.nuove_sospese_oltre_il_massimo = valutare.oltreIlMassimo;
      const conClassi: RigaNuova[] = valutare.candidate.map((r) => ({
        ...r,
        classificazione_stato: stato.get(r.id) ? { stato: stato.get(r.id)!.stato } : null,
        classificazioni: righe.filter((x) => x.procedura_id === r.id).map((x) => ({ settore: x.settore, rilevanza: x.rilevanza, sottocategorie: x.sottocategorie, attiva: x.attiva })),
      }));
      for (const impresa of vogliono) {
        const giaInLista = new Set(liste.filter((g) => g.impresaId === impresa && g.gara.proceduraId).map((g) => g.gara.proceduraId as string));
        const e = eventoRiepilogo({ oggi, adesso, impresaId: impresa, profilo: perImpresa.get(impresa) ?? null, nuove: conClassi, giaInLista, parametri: d.parametri, nascoste, env: d.env, origine, ...contesto });
        if (e) riepiloghi.push(e);
      }
    }
  }

  // 4) annullamenti dei promemoria che non valgono più (proroga, gara chiusa o tolta dalla lista): eventi creati negli ultimi 15 giorni
  const attivi = imprese.length
    ? await leggiPer<{ id: string; impresa_id: string; gara_chiave: string; tipo: TipoEvento; versione: string }>("promemoria attivi", imprese, (b) =>
        d.admin.from(T.eventi).select("id, impresa_id, gara_chiave, tipo, versione").in("impresa_id", b).eq("categoria", "scadenze").eq("stato", "attivo").gte("creato_il", aggiungiGiorni(oggi, -15)),
      )
    : [];
  const daAnnullare = annullamentiScadenze(
    liste,
    attivi.map((a): EventoAttivo => ({ id: a.id, impresaId: a.impresa_id, garaChiave: a.gara_chiave, tipo: a.tipo, versione: a.versione })),
  );
  c.annullati = await annullaEventi(d, daAnnullare);

  // 5) inserimento (solo i nuovi tornano) e consegne
  const tutti = [...scadenze, ...m.eventi, ...riepiloghi];
  c.eventi_calcolati = tutti.length;
  const nuovi = await inserisciEventi(d, tutti);
  c.eventi_nuovi = nuovi.length;
  c.consegne_nuove = await inserisciConsegne(d, nuovi, quadro);

  // 6) conservazione (D-E7, N6): compattazione dei dati e cancellazione dopo 12 mesi, a blocchi
  Object.assign(c, await conservazione(d));
  return { conteggi: c, cursori: { modifiche: nuovoCursoreModifiche, nuove: nuovoCursoreNuove }, inSospeso };
}

async function annullaEventi(d: DipendenzeMotore, a: readonly { id: string; motivo: string }[]): Promise<number> {
  let n = 0;
  const ora = d.adesso().toISOString();
  const perMotivo = new Map<string, string[]>();
  for (const x of a) perMotivo.set(x.motivo, [...(perMotivo.get(x.motivo) ?? []), x.id]);
  for (const [motivo, ids] of perMotivo) {
    for (const b of blocchi(ids, BLOCCO_ID)) {
      const fatti = controlla<{ id: string }[]>("annullamento dei promemoria", await d.admin.from(T.eventi).update({ stato: "annullato", annullato_il: ora, motivo_annullamento: motivo }).in("id", b).eq("stato", "attivo").select("id"));
      n += fatti.length;
      // le loro consegne non ancora partite non partono più (quelle già inviate restano com'erano)
      controlla(
        "annullamento delle consegne",
        await d.admin.from(T.consegne).update({ stato: "annullata", motivo: "non_piu_valida", chiusa_il: ora, aggiornata_il: ora }).in("evento_id", b).eq("stato", "in_coda"),
      );
    }
  }
  return n;
}

async function conservazione(d: DipendenzeMotore): Promise<Conteggi> {
  const adesso = d.adesso().getTime();
  const prima = (giorni: number) => new Date(adesso - giorni * 86_400_000).toISOString();
  const ora = d.adesso().toISOString();
  const c: Conteggi = {};
  const r1 = controlla<{ id: string }[]>(
    "compattazione dei riepiloghi",
    await d.admin.from(T.eventi).update({ dati: null, dati_compattati_il: ora }).eq("tipo", "riepilogo_opportunita").not("dati", "is", null).lt("creato_il", prima(d.parametri.giorniCompattazioneRiepiloghi)).select("id"),
  );
  const r2 = controlla<{ id: string }[]>(
    "compattazione degli altri eventi",
    await d.admin.from(T.eventi).update({ dati: null, dati_compattati_il: ora }).neq("tipo", "riepilogo_opportunita").not("dati", "is", null).lt("creato_il", prima(d.parametri.giorniCompattazioneAltri)).select("id"),
  );
  c.compattati = r1.length + r2.length;
  const limite = prima(d.parametri.giorniConservazione);
  const k1 = controlla<{ id: string }[]>("cancellazione delle consegne", await d.admin.from(T.consegne).delete().lt("creata_il", limite).select("id"));
  const k2 = controlla<{ id: string }[]>("cancellazione degli eventi", await d.admin.from(T.eventi).delete().lt("creato_il", limite).select("id"));
  const k3 = controlla<{ id: string }[]>("cancellazione dei giri", await d.admin.from(T.giri).delete().lt("iniziato_il", limite).neq("esito", "in_corso").select("id"));
  c.cancellati = k1.length + k2.length + k3.length;
  return c;
}

// ───────────────────────── fase «invio» ─────────────────────────

/** Una consegna con TUTTE le colonne scrivibili: gli esiti si scrivono con un upsert a blocchi e righe sempre complete (mai un campo azzerato). */
type RigaConsegna = {
  id: string;
  tipo_consegna: "singola" | "raggruppata";
  evento_id: string | null;
  inclusa_in: string | null;
  impresa_id: string;
  destinatario_id: string;
  ruolo: "titolare" | "ufficio_gare";
  chiave: string;
  priorita: number;
  stato: string;
  tentativi: number;
  primo_tentativo_il: string | null;
  prossimo_tentativo_il: string;
  in_invio_fino_il: string | null;
  provider: string | null;
  provider_id: string | null;
  ultimo_errore: string | null;
  motivo: string | null;
  inviata_il: string | null;
  chiusa_il: string | null;
  creata_il: string;
  aggiornata_il: string;
};
const COLONNE_CONSEGNA: string =
  "id, tipo_consegna, evento_id, inclusa_in, impresa_id, destinatario_id, ruolo, chiave, priorita, stato, tentativi, primo_tentativo_il, prossimo_tentativo_il, in_invio_fino_il, provider, provider_id, ultimo_errore, motivo, inviata_il, chiusa_il, creata_il, aggiornata_il";
const COLONNE_SCRIVIBILI = COLONNE_CONSEGNA.split(", ").filter((c) => c !== "creata_il");

type RigaEvento = { id: string; impresa_id: string; categoria: string; tipo: TipoEvento; gara_chiave: string; versione: string; stato: string; dati: EventoRadar | null; creato_il: string };

/**
 * Le consegne che si possono prendere ORA (O1, approvata dall'utente il 20/11): quelle in coda con il tentativo dovuto, e quelle «in_invio»
 * il cui affitto è scaduto (il processo che le aveva prese è caduto prima di scrivere l'esito) con lo stesso tentativo dovuto. Prima il
 * recupero degli affitti era una richiesta a parte che le rimetteva in coda; ora si riprendono direttamente, nello stesso ordine (priorità,
 * poi tentativo dovuto, che il recupero non cambia). Filtro «or» di PostgREST: valori senza virgole né parentesi (istanti ISO).
 */
function filtroPrendibili(ora: string): string {
  return `and(stato.eq.in_coda,prossimo_tentativo_il.lte.${ora}),and(stato.eq.in_invio,in_invio_fino_il.lt.${ora},prossimo_tentativo_il.lte.${ora})`;
}

/**
 * Prende in carico al più BLOCCO_INVIO consegne pronte, in ordine di priorità: UNA lettura degli identificativi (in coda e dovute, oppure con
 * l'affitto scaduto), poi UN aggiornamento CONDIZIONATO con la stessa condizione, che restituisce solo quelle prese davvero. Due processi
 * insieme non prendono mai la stessa riga: Postgres rilegge la condizione nel secondo aggiornamento (provato su Postgres isolato con due
 * sessioni); una riga appena presa da un altro processo ha l'affitto nel futuro e non passa più. L'indice parziale
 * omnia_ai_radar_email_consegne_da_inviare_idx copre già «in_coda» e «in_invio» (EXPLAIN nella prova isolata). Passaggio a vuoto: 1 lettura.
 * Con `soloIds` (avviso «ravvicinato», consegne appena nate) solo quelle in coda, come prima. Esportata SOLO per le prove (ordine e concorrenza).
 */
export async function prendiInCarico(d: DipendenzeMotore, soloIds: readonly string[] | null): Promise<{ prese: RigaConsegna[]; affittiScaduti: number }> {
  const ora = d.adesso().toISOString();
  const condizione = (q: CostruttoreDb): CostruttoreDb => {
    const t = q.in("stato", ["in_coda", "in_invio"]);
    return soloIds ? t.in("id", [...soloIds]).eq("stato", "in_coda").lte("prossimo_tentativo_il", ora) : t.or(filtroPrendibili(ora));
  };
  const candidate = controlla<{ id: string; stato: string }[]>(
    "consegne pronte",
    await condizione(d.admin.from(T.consegne).select("id, stato")).order("priorita", { ascending: true }).order("prossimo_tentativo_il", { ascending: true }).limit(BLOCCO_INVIO),
  );
  if (!candidate.length) return { prese: [], affittiScaduti: 0 };
  const prese = controlla<RigaConsegna[]>(
    "presa in carico",
    await condizione(
      d.admin
        .from(T.consegne)
        .update({ stato: "in_invio", in_invio_fino_il: new Date(d.adesso().getTime() + AFFITTO_MINUTI * 60_000).toISOString(), aggiornata_il: ora })
        .in("id", candidate.map((x) => x.id)),
    ).select(COLONNE_CONSEGNA),
  );
  const eranoInInvio = new Set(candidate.filter((x) => x.stato === "in_invio").map((x) => x.id));
  return { prese, affittiScaduti: prese.filter((x) => eranoInInvio.has(x.id)).length };
}

async function scriviEsiti(d: DipendenzeMotore, righe: readonly RigaConsegna[]): Promise<void> {
  // una riga per consegna (l'ultima vince): upsert sulla chiave primaria, una richiesta per blocco anche se ogni riga ha valori diversi
  const ultime = [...new Map(righe.map((r) => [r.id, r])).values()];
  for (const b of blocchi(ultime, BLOCCO_SCRITTURA)) {
    const complete = b.map((r) => Object.fromEntries(COLONNE_SCRIVIBILI.map((k) => [k, (r as Record<string, unknown>)[k] ?? null])));
    controlla("esiti", await d.admin.from(T.consegne).upsert(complete, { onConflict: "id" }));
  }
}

/** La riga dopo un cambiamento: si parte SEMPRE dalla riga letta (completa) e si cambiano solo i campi dati. */
function con(x: RigaConsegna, cambi: Partial<RigaConsegna> | AggiornamentoConsegna): RigaConsegna {
  return { ...x, ...(cambi as Partial<RigaConsegna>) };
}

type Validita = { valida: true; persona: PersonaImpresa } | { valida: false; motivo: string };

/**
 * Il ricontrollo AL MOMENTO DELL'INVIO, per un blocco di consegne SINGOLE (anche quelle incluse in un raggruppamento): persona dell'impresa
 * con email valida e categoria accesa (regola unica «riceve»), evento ancora attivo e della stessa impresa; per i promemoria, la gara
 * ancora nella lista, aperta e con la stessa scadenza.
 */
async function ricontrollo(d: DipendenzeMotore, singole: readonly RigaConsegna[], eventi: ReadonlyMap<string, RigaEvento>, origine: string, c: Conteggi): Promise<Map<string, Validita>> {
  const esito = new Map<string, Validita>();
  if (!singole.length) return esito;
  const imprese = [...new Set(singole.map((x) => x.impresa_id))];
  const quadro = await leggiQuadro(d, imprese, c);
  const conScadenze = singole.some((x) => {
    const e = eventi.get(x.evento_id ?? "");
    return !!e && CATEGORIA_DEL_TIPO[e.tipo] === "scadenze";
  });
  const liste = conScadenze ? await leggiListe(d, imprese.filter((i) => quadro.imprese.has(i)), await leggiNascoste(d), origine) : [];
  const perChiave = new Map(liste.map((g) => [`${g.impresaId}|${g.chiave}`, g]));
  for (const x of singole) {
    const impresa = quadro.imprese.get(x.impresa_id);
    const persona = quadro.persone.find((p) => p.userId === x.destinatario_id && p.impresaId === x.impresa_id);
    const e = eventi.get(x.evento_id ?? "");
    let motivo: string | null = null;
    if (!impresa) motivo = "impresa_non_attiva";
    else if (!persona) motivo = "persona_non_valida";
    else if (!e || e.stato !== "attivo" || !e.dati) motivo = "evento_non_attivo";
    else if (e.impresa_id !== x.impresa_id) motivo = "altra_impresa";
    else if (CATEGORIA_DEL_TIPO[e.tipo] === "scadenze") {
      const g = perChiave.get(`${e.impresa_id}|${e.gara_chiave}`);
      if (!g) motivo = "gara_fuori_lista";
      else if (!g.aperta) motivo = "gara_non_aperta";
      else if (!versioniAttive(g.gara.scadenze).has(e.versione)) motivo = "scadenza_cambiata";
    }
    if (!motivo && impresa && persona && e) {
      const r = riceve(persona, quadro.preferenze.get(persona.userId) ?? null, impresa, CATEGORIA_DEL_TIPO[e.tipo]);
      if (!r.riceve) motivo = r.motivo;
    }
    esito.set(x.id, motivo || !persona ? { valida: false, motivo: motivo ?? "persona_non_valida" } : { valida: true, persona });
  }
  return esito;
}

function ordineEventi(a: RigaEvento, b: RigaEvento): number {
  return PRIORITA_DEL_TIPO[a.tipo] - PRIORITA_DEL_TIPO[b.tipo] || a.creato_il.localeCompare(b.creato_il) || a.id.localeCompare(b.id);
}

/** Il contenuto di un'email raggruppata: sempre gli stessi eventi nello stesso ordine (stesso contenuto a ogni tentativo). */
function contenutoRaggruppato(r: Pick<RigaConsegna, "id" | "impresa_id" | "chiave" | "creata_il">, eventi: readonly RigaEvento[]): EventoRaggruppato {
  return {
    tipo: "raggruppamento_urgenti",
    id: r.id,
    impresaId: r.impresa_id,
    nomeImpresa: null,
    versione: r.chiave.split(":").pop() ?? r.chiave,
    creatoIl: r.creata_il,
    eventi: [...eventi].sort(ordineEventi).map((e) => e.dati as EventoScadenza | EventoModifica),
  };
}

type DaInviare = { consegna: RigaConsegna; contenuto: EventoRadar | EventoRaggruppato; persona: PersonaImpresa; incluse: RigaConsegna[] };

/**
 * Una fase «invio»: affitti scaduti, poi blocchi di consegne fino al tempo massimo. Per ogni persona il piano d'invio (tetto di 15 singole
 * per passaggio, urgenti mai rinviati ma raggruppati, riepilogo mai raggruppato), composizione con il modello di B1, provider, esiti a
 * blocchi. `soloIds` limita alle consegne date (avviso «ravvicinato» subito dopo il salvataggio).
 */
/** I conteggi della fase «invio» quando non c'è nulla da prendere (anche quelli del passaggio che, con O2, la salta). */
function conteggiInvioVuoti(): Conteggi {
  // O1: gli affitti scaduti si riprendono dentro la presa in carico (nessuna richiesta a parte); qui solo il conteggio
  return { prese: 0, inviate: 0, raggruppate: 0, incluse: 0, rinviate: 0, scartate: 0, riprova: 0, quota: 0, fallite: 0, incerte: 0, affitti_scaduti: 0 };
}

async function faseInvio(d: DipendenzeMotore, origine: string, oggi: string, soloIds: readonly string[] | null): Promise<Conteggi> {
  const c: Conteggi = conteggiInvioVuoti();
  const inizio = d.adesso().getTime();
  const inviatePerPersona = new Map<string, number>();
  const ultimo = d.ultimoPassaggio(d.adesso());
  const ora = () => d.adesso().toISOString();
  let fermo: string | null = null;
  for (let blocco = 0; blocco < 100 && !fermo; blocco++) {
    if (d.adesso().getTime() - inizio > TEMPO_MASSIMO_GIRO_MS) break;
    const presa = await prendiInCarico(d, soloIds);
    const prese = presa.prese;
    if (!prese.length) break;
    c.prese += prese.length;
    c.affitti_scaduti += presa.affittiScaduti;
    const raggr = prese.filter((x) => x.tipo_consegna === "raggruppata");
    // per i raggruppamenti già creati e da ritentare: le loro incluse, per ricomporre lo stesso contenuto
    const incluseDi = raggr.length ? controlla<RigaConsegna[]>("consegne incluse", await d.admin.from(T.consegne).select(COLONNE_CONSEGNA).in("inclusa_in", raggr.map((x) => x.id)).eq("stato", "inclusa")) : [];
    const singole = [...prese.filter((x) => x.tipo_consegna === "singola"), ...incluseDi];
    const idEventi = singole.map((x) => x.evento_id).filter((x): x is string => !!x);
    const righeEventi = await leggiPer<RigaEvento>("eventi delle consegne", idEventi, (b) => d.admin.from(T.eventi).select("id, impresa_id, categoria, tipo, gara_chiave, versione, stato, dati, creato_il").in("id", b));
    const eventi = new Map(righeEventi.map((e) => [e.id, e]));
    const validita = await ricontrollo(d, singole, eventi, origine, c);
    const struttura: RigaConsegna[] = [];
    const daInviare: DaInviare[] = [];

    // 1) singole non più valide: scartate (mai inviate)
    const pronte: RigaConsegna[] = [];
    for (const x of prese.filter((y) => y.tipo_consegna === "singola")) {
      const v = validita.get(x.id);
      if (v?.valida) pronte.push(x);
      else {
        struttura.push(con(x, { stato: "scartata", motivo: v && !v.valida ? v.motivo : "non_valida", chiusa_il: ora(), in_invio_fino_il: null, aggiornata_il: ora() }));
        c.scartate++;
      }
    }

    // 2) piano per persona
    const perPersona = new Map<string, RigaConsegna[]>();
    for (const x of pronte) perPersona.set(x.destinatario_id, [...(perPersona.get(x.destinatario_id) ?? []), x]);
    for (const [destinatario, xs] of [...perPersona.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const perId = new Map(xs.map((x) => [x.id, x]));
      const coda: ConsegnaInCoda[] = xs.map((x) => {
        const e = eventi.get(x.evento_id!)!;
        return { id: x.id, tipo: e.tipo, creataIl: x.creata_il, giornoEvento: giornoRoma(e.creato_il) };
      });
      const gia = inviatePerPersona.get(destinatario) ?? 0;
      const piano = pianoInvioCompleto(coda, { oggi, ultimoPassaggioDelGiorno: ultimo, quotaResidua: d.provider.quotaResidua(), tetto: Math.max(0, MASSIMO_EMAIL_SINGOLE_PER_PASSAGGIO - gia) });
      for (const id of piano.rinviate) {
        struttura.push(con(perId.get(id)!, { stato: "in_coda", in_invio_fino_il: null, prossimo_tentativo_il: new Date(d.adesso().getTime() + 30 * 60_000).toISOString(), aggiornata_il: ora() }));
        c.rinviate++;
      }
      for (const id of piano.singole) {
        const x = perId.get(id)!;
        daInviare.push({ consegna: x, contenuto: eventi.get(x.evento_id!)!.dati!, persona: (validita.get(id) as { valida: true; persona: PersonaImpresa }).persona, incluse: [] });
      }
      if (piano.raggruppate.length) {
        const incluse = piano.raggruppate.map((id) => perId.get(id)!);
        const primo = incluse[0];
        const chiave = chiaveRaggruppamento(destinatario, incluse.map((x) => x.id), impronta).slice(0, 300);
        const riga: RigaConsegna = {
          ...primo,
          id: d.nuovoId(),
          tipo_consegna: "raggruppata",
          evento_id: null,
          inclusa_in: null,
          chiave,
          priorita: 1,
          stato: "in_invio",
          tentativi: 0,
          primo_tentativo_il: null,
          prossimo_tentativo_il: ora(),
          in_invio_fino_il: new Date(d.adesso().getTime() + AFFITTO_MINUTI * 60_000).toISOString(),
          provider: null,
          provider_id: null,
          ultimo_errore: null,
          motivo: null,
          inviata_il: null,
          chiusa_il: null,
          creata_il: ora(),
          aggiornata_il: ora(),
        };
        // la raggruppata prima (le incluse la citano con inclusa_in: chiave esterna e trigger della 0125); stessa chiave = stesso insieme
        const { creata_il: _creata, ...nuova } = riga;
        void _creata;
        const scritta = controlla<{ id: string }[]>("consegna raggruppata", await d.admin.from(T.consegne).upsert([nuova], { onConflict: "chiave", ignoreDuplicates: true }).select("id"));
        if (!scritta.length) {
          // lo stesso insieme era già stato raggruppato: le incluse restano a quello (partirà con il suo tentativo)
          for (const x of incluse) struttura.push(con(x, { stato: "in_coda", in_invio_fino_il: null, aggiornata_il: ora() }));
          continue;
        }
        for (const x of incluse) struttura.push(con(x, { stato: "inclusa", inclusa_in: riga.id, in_invio_fino_il: null, aggiornata_il: ora() }));
        c.raggruppate++;
        c.incluse += incluse.length;
        daInviare.push({
          consegna: riga,
          contenuto: contenutoRaggruppato(riga, incluse.map((x) => eventi.get(x.evento_id!)!)),
          persona: (validita.get(primo.id) as { valida: true; persona: PersonaImpresa }).persona,
          incluse,
        });
      }
    }

    // 3) raggruppamenti già esistenti da ritentare: si ricompongono con le incluse ancora valide, nello stesso ordine
    for (const x of raggr) {
      const incl = incluseDi.filter((y) => y.inclusa_in === x.id);
      const valide = incl.filter((y) => validita.get(y.id)?.valida);
      for (const y of incl.filter((z) => !validita.get(z.id)?.valida)) {
        const v = validita.get(y.id);
        struttura.push(con(y, { stato: "scartata", inclusa_in: null, motivo: v && !v.valida ? v.motivo : "non_valida", chiusa_il: ora(), aggiornata_il: ora() }));
        c.scartate++;
      }
      if (!valide.length) {
        struttura.push(con(x, { stato: "scartata", motivo: "incluse_non_valide", chiusa_il: ora(), in_invio_fino_il: null, aggiornata_il: ora() }));
        c.scartate++;
        continue;
      }
      daInviare.push({ consegna: x, contenuto: contenutoRaggruppato(x, valide.map((y) => eventi.get(y.evento_id!)!)), persona: (validita.get(valide[0].id) as { valida: true; persona: PersonaImpresa }).persona, incluse: valide });
    }

    // le scritture della struttura (scarti, rinvii, raggruppamenti) PRIMA degli invii: se il processo cade dopo, nulla parte due volte
    await scriviEsiti(d, struttura);

    // 4) invii
    const esiti: RigaConsegna[] = [];
    for (let i = 0; i < daInviare.length; i++) {
      const { consegna, contenuto, persona, incluse } = daInviare[i];
      if (fermo) {
        esiti.push(con(consegna, { stato: "in_coda", in_invio_fino_il: null, aggiornata_il: ora() }));
        continue;
      }
      let email: { oggetto: string; html: string; testo: string };
      try {
        email = d.componi(contenuto, { userId: persona.userId, impresaId: persona.impresaId, ruolo: persona.ruolo, email: persona.email!, nome: null, urlPreferenze: urlPreferenze(origine) });
      } catch {
        esiti.push(con(consegna, { stato: "fallita", motivo: "composizione_rifiutata", ultimo_errore: "composizione", chiusa_il: ora(), in_invio_fino_il: null, aggiornata_il: ora() }));
        c.fallite++;
        continue;
      }
      const raggruppata = contenuto.tipo === "raggruppamento_urgenti";
      const esito: EsitoProvider = await d.provider.invia({
        a: persona.email!,
        oggetto: email.oggetto,
        html: email.html,
        testo: email.testo,
        chiaveIdempotenza: `omnia-radar/${consegna.id}`,
        tags: [
          { name: "categoria", value: raggruppata ? "urgenti" : (contenuto as EventoRadar).categoria },
          { name: "tipo", value: raggruppata ? "raggruppamento" : (contenuto as EventoRadar).tipo },
        ],
      });
      const agg = esitoDopoInvio({ tentativi: consegna.tentativi, primoTentativoIl: consegna.primo_tentativo_il }, esito, d.provider.nome, d.adesso(), { attesaMinuti: ATTESE_TENTATIVI_MINUTI, finestraOre: FINESTRA_IDEMPOTENZA_ORE });
      esiti.push(con(consegna, agg));
      if (agg.stato === "inviata") {
        c.inviate++;
        inviatePerPersona.set(persona.userId, (inviatePerPersona.get(persona.userId) ?? 0) + 1);
      } else if (agg.stato === "in_coda") c[esito.esito === "quota" ? "quota" : "riprova"]++;
      else if (agg.stato === "esito_incerto") c.incerte++;
      else c.fallite++;
      if (esito.esito === "fallita" && esito.configurazione) fermo = "configurazione_provider";
      if (esito.esito === "quota") fermo = "quota_provider";
      // una raggruppata fallita in modo definitivo rimette in coda le incluse (al più RIPROVE_RAGGRUPPATA volte, poi falliscono anche loro)
      if (raggruppata && agg.stato === "fallita") {
        for (const y of incluse) {
          const volte = y.tentativi + 1;
          esiti.push(
            volte >= RIPROVE_RAGGRUPPATA
              ? con(y, { stato: "fallita", inclusa_in: null, tentativi: volte, motivo: "raggruppamento_fallito", chiusa_il: ora(), aggiornata_il: ora() })
              : con(y, { stato: "in_coda", inclusa_in: null, tentativi: volte, prossimo_tentativo_il: ora(), aggiornata_il: ora() }),
          );
        }
      }
      if (i < daInviare.length - 1) await d.attendi(Math.ceil(1000 / INVII_AL_SECONDO));
    }
    await scriviEsiti(d, esiti);
    if (soloIds) break;
  }
  if (fermo) c[`fermo_${fermo}`] = 1;
  return c;
}

// ───────────────────────── il passaggio ─────────────────────────

/**
 * Un passaggio del processo: guardie, poi la fase «eventi» se oggi (a Roma) non c'è ancora un giro «eventi» riuscito, poi la fase «invio».
 * Rieseguito lo stesso giorno non crea nulla di nuovo: chiavi uniche su eventi e consegne.
 */
export async function eseguiPassaggio(d: DipendenzeMotore): Promise<EsitoPassaggio> {
  const stato = statoInvioEmail(d.env);
  if (!stato.acceso) return { eseguito: false, motivo: stato.motivo };
  // pacchetto P: sullo staging SOLO il provider finto; in produzione SOLO Resend (un finto in produzione segnerebbe «inviate» email mai
  // spedite). Qualunque altro abbinamento: nessun passaggio, nessuna richiesta al database
  if (d.provider.nome !== (stato.ambiente === "produzione" ? "resend" : "finto")) return { eseguito: false, motivo: "provider_non_autorizzato" };
  const o = origineAreaClienti(d.env);
  if (!o.ok) return { eseguito: false, motivo: "origine_non_valida" };
  const inizio = d.adesso().getTime();
  const oggi = giornoRoma(d.adesso());

  let eventi: Conteggi | { saltata: string };
  // lo STATO DEL PASSAGGIO serve a tutte e due le fasi: c'è già un giro «eventi» riuscito oggi? c'è già il battito «invio» (N7)?
  //   - O1: UNA lettura dei giri di oggi; se c'è lavoro lo dice la presa in carico;
  //   - O2 (parametro esplicito, in valutazione): UNA chiamata alla funzione SQL, che dice anche se c'è lavoro da prendere (stessa condizione
  //     di filtroPrendibili). Nulla da fare = 1 richiesta.
  let eventiFatti: boolean;
  let battitoScritto: boolean;
  let lavoroDaPrendere: boolean | null = null;
  if (d.parametri.statoPassaggioInUnaChiamata) {
    const [s] = controlla<{ eventi_fatti: boolean; battito_invio: boolean; lavoro: boolean }[]>(
      "stato del passaggio",
      await d.admin.rpc("radar_notifiche_stato_passaggio", { p_giorno: oggi, p_adesso: d.adesso().toISOString() }),
    );
    if (!s) throw new ErroreDb("stato del passaggio", "vuoto");
    eventiFatti = s.eventi_fatti === true;
    battitoScritto = s.battito_invio === true;
    lavoroDaPrendere = s.lavoro === true;
  } else {
    const diOggi = controlla<{ fase: string; esito: string }[]>("giri di oggi", await d.admin.from(T.giri).select("fase, esito").in("fase", ["eventi", "invio"]).eq("giorno_roma", oggi).limit(500));
    eventiFatti = diOggi.some((g) => g.fase === "eventi" && g.esito === "riuscito");
    battitoScritto = diOggi.some((g) => g.fase === "invio");
  }
  // la fase «eventi» è stata eseguita IN QUESTO passaggio (riuscita o no): può aver creato consegne, quindi la fase «invio» si fa sempre
  let eventiInQuestoPassaggio = false;
  if (eventiFatti) {
    eventi = { saltata: "gia_eseguita_oggi" };
  } else {
    // solo una volta al giorno: l'ultimo giro «eventi» riuscito, per i cursori e il recupero breve
    const [precedente] = await ultimiGiriEventi(d);
    const id = await apriGiro(d, "eventi", oggi);
    if (!id) eventi = { saltata: "altro_giro_in_corso" };
    else {
      eventiInQuestoPassaggio = true;
      try {
        const f = await faseEventi(d, o.origine, oggi, precedente ?? null);
        await chiudiGiro(d, id, "riuscito", { conteggi: f.conteggi, cursore_modifiche: f.cursori.modifiche, cursore_nuove: f.cursori.nuove, nuove_in_sospeso: f.inSospeso });
        eventi = f.conteggi;
      } catch (e) {
        const codice = e instanceof ErroreDb ? `${e.passo}:${e.codice}` : "eccezione";
        await chiudiGiro(d, id, "fallito", { conteggi: {}, errore: codice.slice(0, 200) }).catch(() => undefined);
        eventi = { saltata: `errore:${codice}`.slice(0, 120) };
      }
    }
  }

  let invio: Conteggi;
  let erroreInvio: string | null = null;
  if (lavoroDaPrendere === false && !eventiInQuestoPassaggio) {
    // O2: la chiamata ha già guardato la coda con la stessa condizione della presa in carico: nulla da prendere, nessuna richiesta in più
    invio = conteggiInvioVuoti();
  } else {
    try {
      invio = await faseInvio(d, o.origine, oggi, null);
    } catch (e) {
      invio = { errore: 1 };
      erroreInvio = e instanceof ErroreDb ? `${e.passo}:${e.codice}` : "eccezione";
    }
  }
  // N7: il giro «invio» si registra solo con del lavoro, più un battito al giorno (con il parametro spento, sempre)
  const lavoro = (invio.prese ?? 0) + (invio.affitti_scaduti ?? 0) > 0 || !!invio.errore;
  let registra = !d.parametri.giroInvioSoloConLavoro || lavoro;
  if (!registra) registra = !battitoScritto;
  if (registra) {
    const ora = d.adesso().toISOString();
    controlla(
      "giro «invio»",
      await d.admin.from(T.giri).insert({
        id: d.nuovoId(),
        giorno_roma: oggi,
        fase: "invio",
        esito: invio.errore ? "fallito" : invio.fermo ? "fermato" : "riuscito",
        iniziato_il: new Date(inizio).toISOString(),
        in_corso_fino_il: ora,
        finito_il: ora,
        ambiente: ambienteDelGiro(d.env),
        provider: d.provider.nome,
        conteggi: invio,
        errore: erroreInvio,
      }),
    );
  }
  return { eseguito: true, eventi, invio, erroreInvio, durataMs: d.adesso().getTime() - inizio };
}

// ───────────────────────── avviso «ravvicinato» (aggancio di ravvicinata.ts) ─────────────────────────

/** Il corpo dell'aggancio: legge la sola gara entrata nella lista, crea l'evento e le consegne, e le invia subito (finto sullo staging, Resend in produzione). */
export async function eseguiRavvicinata(d: DipendenzeMotore, g: GaraEntrataInLista): Promise<EsitoRavvicinata> {
  const stato = statoInvioEmail(d.env);
  if (!stato.acceso) return { esito: "spento" };
  // pacchetto P: la stessa regola del passaggio giornaliero (finto sullo staging, Resend in produzione)
  if (d.provider.nome !== (stato.ambiente === "produzione" ? "resend" : "finto")) return { esito: "non_dovuta", motivo: "provider_non_autorizzato" };
  const o = origineAreaClienti(d.env);
  if (!o.ok) return { esito: "non_dovuta", motivo: "origine_non_valida" };
  const c: Conteggi = {};
  const quadro = await leggiQuadro(d, [g.impresaId], c);
  if (!quadro.imprese.has(g.impresaId)) return { esito: "non_dovuta", motivo: "email_impresa_spente" };
  const oggi = giornoRoma(d.adesso());
  const liste = await leggiListe(d, [g.impresaId], await leggiNascoste(d), o.origine);
  const gara = liste.find((x) => x.impresaId === g.impresaId && (g.proceduraId ? x.gara.proceduraId === g.proceduraId : x.gara.aggiuntaId === g.aggiuntaId));
  if (!gara) return { esito: "non_dovuta", motivo: "gara_non_in_lista" };
  const uno = controlla<{ versione: string }[]>(
    "promemoria a 1 giorno già nati",
    await d.admin.from(T.eventi).select("versione").eq("impresa_id", g.impresaId).eq("gara_chiave", gara.chiave).eq("tipo", "scadenza_1"),
  );
  const nuovi = eventiRavvicinati({ oggi, adesso: d.adesso(), gara, versioniScadenza1: new Set(uno.map((u) => u.versione)), nuovoId: d.nuovoId, adessoIso: d.adesso().toISOString() });
  if (!nuovi.length) return { esito: "non_dovuta", motivo: "scadenza_non_ravvicinata" };
  const inseriti = await inserisciEventi(d, nuovi);
  if (!inseriti.length) return { esito: "non_dovuta", motivo: "gia_avvisata" };
  const consegne = consegneDegliEventi(inseriti, quadro.persone, quadro.preferenze, quadro.imprese);
  const ids: string[] = [];
  for (const b of blocchi(consegne, BLOCCO_SCRITTURA)) {
    const righe = b.map((x) => ({ ...x, id: d.nuovoId(), prossimo_tentativo_il: d.adesso().toISOString() }));
    const scritte = controlla<{ id: string }[]>("consegne ravvicinate", await d.admin.from(T.consegne).upsert(righe, { onConflict: "chiave", ignoreDuplicates: true }).select("id"));
    ids.push(...scritte.map((s) => s.id));
  }
  if (ids.length) await faseInvio(d, o.origine, oggi, ids);
  return { esito: "accodata", eventi: inseriti.length, consegne: ids.length };
}

/** Le dipendenze reali (rotta e aggancio): client di servizio, provider finto, modello di B1, stato d'accesso delle pagine. */
export async function dipendenzeReali(env: Record<string, string | undefined>, parametri: ParametriNotifiche): Promise<DipendenzeMotore> {
  const [{ createAdminClient }, { componiEmailRadar }, { sceltaProvider }, { creaProviderResend }, { getOmniaAiAccessState }] = await Promise.all([
    import("@/lib/supabase/admin"),
    import("../email-modelli"),
    import("./provider"),
    import("./provider-resend"),
    import("@/lib/omnia-ai-access"),
  ]);
  const client = createAdminClient();
  const admin = client as unknown as ClientDb;
  return {
    admin,
    env,
    // pacchetto P: il finto ovunque, Resend solo in produzione con l'interruttore acceso (resendConsentito)
    provider: sceltaProvider(env, (chiave) => creaProviderResend(chiave, fetch as unknown as Parameters<typeof creaProviderResend>[1], env)),
    componi: componiEmailRadar,
    parametri,
    statoAccesso: async (id) => (await getOmniaAiAccessState(id, client)).stato as StatoAccesso,
    adesso: () => new Date(),
    nuovoId: () => crypto.randomUUID(),
    attendi: (ms) => new Promise((r) => setTimeout(r, ms)),
    ultimoPassaggio: ultimoPassaggioProgrammato,
  };
}

