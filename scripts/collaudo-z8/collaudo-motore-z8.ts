// COLLAUDO Z8 (documento 46, B2, 23/11/2026): il motore delle notifiche email di Tender Intelligence, lanciato a mano, con il provider FINTO.
// Una sola funzione (collaudo) per due modi, nelle STESSE condizioni:
//   prova <replica.json> [--adesso ISO] [--cursore-nuove-giorni N] [--cartella DIR]
//       → NESSUNA rete (fetch bloccato), database IN MEMORIA (scripts/lib/db-finto-motore.ts) caricato con la replica in sola lettura dello
//         staging scritta da TENDER_INTELLIGENCE_FASE0/46_controlli_z8.mjs prima. Dà gli ATTESI (eventi, consegne, email, richieste).
//   giro [--attesi FILE] [--cartella DIR]
//       → SOLO sullo staging e SOLO con esegui-autorizzato.mjs (autorizzazione «scrittura_prova» registrata). Scrive i 3 dati sintetici,
//         fa DUE passaggi del motore nello stesso giorno e confronta con gli attesi della prova del giorno.
// Guardie del giro: autorizzazione (controllaPorta) · guardia anti-produzione (.env.staging) · RADAR_NOTIFICHE_EMAIL=attivo SOLO
// nell'ambiente del lancio · provider «finto» (resendConsentito() falso) · osservatore di rete: un host diverso dallo staging FERMA tutto ·
// destinatari solo @prova.test · tabelle del motore vuote prima · tetti per tabella controllati prima del secondo passaggio.
// Le email «inviate» dal finto si scrivono, testo e HTML, nella cartella del collaudo (solo indirizzi di prova, nessun dato reale).
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { eseguiPassaggio, ultimoPassaggioProgrammato, type ClientDb, type DipendenzeMotore, type EsitoPassaggio, type StatoAccesso } from "../../src/lib/radar/notifiche/motore";
import { PARAMETRI_PROPOSTI } from "../../src/lib/radar/notifiche/parametri";
import { ProviderFinto, resendConsentito, type EsitoProvider, type MessaggioEmail, type ProviderEmail } from "../../src/lib/radar/notifiche/provider";
import { componiEmailRadar } from "../../src/lib/radar/email-modelli";
import { aggiungiGiorni, giornoRoma, oraRoma } from "../../src/lib/radar/notifiche/calendario";
import { getOmniaAiAccessState } from "../../src/lib/omnia-ai-access";
import { DbFinto, type Riga } from "../lib/db-finto-motore";

export const STAGING_REF = "ryawdldqiumqsskrnyps";
export const PRODUZIONE_REF = "bihfrzspqxsrzlbqqvqa";
export const ETICHETTA = "SINTETICA — Z8";
/** Tetti del collaudo (rapporto 38 §2, riga B5): oltre, ci si ferma prima del secondo passaggio. */
export const TETTI = { giri: 6, eventi: 12, consegne: 20, aggiunte: 3, salvate: 3 } as const;
/** Le persone di prova delle due imprese del collaudo Z3 (parte locale dell'indirizzo @prova.test). */
export const PERSONE = { titolareA: "titolare-benchmark", ufficioA: "ufficio-benchmark", titolareB: "ti-titolare" } as const;
// Fonti nascoste in aggiunta al database: NESSUNA nel giro. La PVL nascosta del primo collaudo (decisione 7.14) è superata dalla direttiva
// 48A dell'utente: le gare PVL sono visibili come quelle delle altre fonti. La prova può ancora nasconderne una per mostrare la differenza.

export class FermoCollaudo extends Error {}

/** Un istante a Roma (giorno AAAA-MM-GG, ora HH:MM) in ISO, con l'ora legale giusta. */
export function istanteRoma(giorno: string, ora: string): string {
  for (const fuso of ["+01:00", "+02:00"]) {
    const d = new Date(`${giorno}T${ora}:00${fuso}`);
    if (giornoRoma(d) === giorno && oraRoma(d) === ora) return d.toISOString();
  }
  throw new Error(`istante non valido a Roma: ${giorno} ${ora}`);
}

/** I 3 dati sintetici: gare aggiunte a mano, entrate in lista IERI (il motore manda un promemoria solo per gare già in lista). */
export function datiSintetici(oggi: string, id: { titolareA: string; ufficioA: string; titolareB: string }, nuovoId: () => string) {
  const ieri = istanteRoma(aggiungiGiorni(oggi, -1), "08:00");
  const gara = (n: 10 | 5 | 1, impresa: string, autore: string, ora: string | null, monitorata: boolean) => {
    const giorno = aggiungiGiorni(oggi, n);
    const aggiunta = {
      id: nuovoId(),
      user_id: impresa,
      creata_da: autore,
      cig: null,
      url: `https://esempio.invalid/z8/gara-${n}-giorni`,
      oggetto: `${ETICHETTA} promemoria a ${n} ${n === 1 ? "giorno" : "giorni"} (dato di prova)`,
      ente: "ENTE SINTETICO Z8 (dato di prova)",
      scadenza_giorno: giorno,
      scadenza_offerte: ora ? istanteRoma(giorno, ora) : null,
      scadenza_ora_indicata: ora !== null,
      importo: null,
      creata_il: ieri,
      aggiornata_il: ieri,
    };
    const salvata = { user_id: impresa, procedura_id: null, aggiunta_id: aggiunta.id, monitorata, salvata_da: autore, creata_il: ieri, aggiornata_il: ieri };
    return { aggiunta, salvata };
  };
  return [
    // impresa A (titolare e Ufficio Gare con le scadenze accese): +10 con l'ora, salvata dal titolare
    gara(10, id.titolareA, id.titolareA, "12:00", false),
    // impresa B (il titolare ha le scadenze SPENTE): +5 senza ora, monitorata → evento sì, nessuna consegna
    gara(5, id.titolareB, id.titolareB, null, true),
    // impresa A: +1 senza ora (urgente), aggiunta e monitorata dall'Ufficio Gare
    gara(1, id.titolareA, id.ufficioA, null, true),
  ];
}

type Contesto = {
  modo: "prova" | "giro";
  admin: ClientDb;
  env: Record<string, string | undefined>;
  statoAccesso: (id: string) => Promise<StatoAccesso>;
  adesso: () => Date;
  nuovoId: () => string;
  attendi: (ms: number) => Promise<void>;
  richieste: () => number;
  cartella: string;
  cursoreNuoveIniziale?: (adesso: Date) => string;
  /** SOLO nella prova, per mostrare la differenza: fonti nascoste in più. Di base (e sempre nel giro) nessuna */
  fontiNascoste?: readonly string[];
  /** chiamata dalle guardie: il giro si ferma al primo controllo */
  fermo: { motivo: string | null };
};

/** Il provider finto che, in più, scrive ogni email «inviata» (testo e HTML) nella cartella del collaudo. Mai un indirizzo non di prova. */
export class ProviderSuCartella implements ProviderEmail {
  readonly nome = "finto" as const;
  private readonly interno = new ProviderFinto();
  readonly indice: { n: number; a: string; oggetto: string; categoria: string; tipo: string; providerId: string; file: string }[] = [];
  constructor(private readonly cartella: string, private readonly fermo: { motivo: string | null }) {}
  quotaResidua(): number | null {
    return this.interno.quotaResidua();
  }
  async invia(m: MessaggioEmail): Promise<EsitoProvider> {
    if (!/^[a-z0-9._+-]+@prova\.test$/i.test(m.a)) {
      this.fermo.motivo ??= "destinatario_non_di_prova";
      return { esito: "fallita", codice: "destinatario_non_di_prova", configurazione: true };
    }
    const e = await this.interno.invia(m);
    if (e.esito === "inviata" && !this.indice.some((x) => x.providerId === e.providerId)) {
      const tag = (k: string) => m.tags.find((t) => t.name === k)?.value ?? "";
      const n = this.indice.length + 1;
      const base = `${String(n).padStart(2, "0")}_${tag("tipo")}_${m.a.split("@")[0]}`.replace(/[^a-z0-9_.-]/gi, "-");
      fs.mkdirSync(this.cartella, { recursive: true });
      fs.writeFileSync(path.join(this.cartella, `${base}.txt`), `A: ${m.a}\nOggetto: ${m.oggetto}\nChiave: ${m.chiaveIdempotenza}\n\n${m.testo}`);
      fs.writeFileSync(path.join(this.cartella, `${base}.html`), m.html);
      this.indice.push({ n, a: m.a, oggetto: m.oggetto, categoria: tag("categoria"), tipo: tag("tipo"), providerId: e.providerId, file: base });
    }
    return e;
  }
}

async function leggi<T>(passo: string, q: PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>): Promise<T> {
  const r = await q;
  if (r.error) throw new FermoCollaudo(`${passo}: ${r.error.code ?? ""} ${r.error.message ?? ""}`.trim());
  return r.data as T;
}

type Conteggio = { eventi: Riga[]; consegne: Riga[]; giri: Riga[]; aggiunte: Riga[]; salvate: Riga[] };

async function contaTutto(c: Contesto, imprese: readonly string[]): Promise<Conteggio> {
  const a = c.admin;
  const [eventi, consegne, giri, aggiunte] = [
    await leggi<Riga[]>("eventi", a.from("omnia_ai_radar_eventi").select("id, impresa_id, tipo, categoria, gara_chiave, aggiunta_id, stato")),
    await leggi<Riga[]>("consegne", a.from("omnia_ai_radar_email_consegne").select("id, evento_id, impresa_id, destinatario_id, ruolo, tipo_consegna, stato, provider, provider_id, inclusa_in")),
    await leggi<Riga[]>("giri", a.from("radar_notifiche_giri").select("id, fase, esito, provider, ambiente")),
    await leggi<Riga[]>("gare aggiunte", a.from("omnia_ai_radar_gare_aggiunte").select("id, user_id, oggetto").in("user_id", [...imprese])),
  ];
  const sintetiche = aggiunte.filter((r) => String(r.oggetto ?? "").startsWith(ETICHETTA));
  const salvate = sintetiche.length
    ? await leggi<Riga[]>("salvate", a.from("omnia_ai_radar_salvate").select("user_id, aggiunta_id, monitorata").in("aggiunta_id", sintetiche.map((r) => String(r.id))))
    : [];
  return { eventi, consegne, giri, aggiunte: sintetiche, salvate };
}

export type EsitoCollaudo = {
  modo: "prova" | "giro";
  oggi: string;
  fermo: string | null;
  richieste: { prerequisiti: number; dati: number; passaggio1: number; controlli1: number; passaggio2: number; controlli2: number };
  passaggio1: EsitoPassaggio | null;
  passaggio2: EsitoPassaggio | null;
  dopo1: Record<string, number>;
  dopo2: Record<string, number>;
  /** chiave «impresa|tipo» → eventi */
  eventi: Record<string, number>;
  /** chiave «persona|tipo» → consegne (persona = parte locale dell'indirizzo di prova) */
  consegne: Record<string, number>;
  email: { a: string; oggetto: string; tipo: string; file: string }[];
  controlli: [string, boolean][];
};

/** IL COLLAUDO: prerequisiti, dati sintetici, passaggio 1, tetti, passaggio 2 nello stesso giorno, conteggi. */
export async function collaudo(c: Contesto): Promise<EsitoCollaudo> {
  const oggi = giornoRoma(c.adesso());
  const controlli: [string, boolean][] = [];
  const verifica = (nome: string, ok: boolean) => controlli.push([nome, ok]);
  const r0 = c.richieste();
  const esito: EsitoCollaudo = {
    modo: c.modo, oggi, fermo: null, richieste: { prerequisiti: 0, dati: 0, passaggio1: 0, controlli1: 0, passaggio2: 0, controlli2: 0 },
    passaggio1: null, passaggio2: null, dopo1: {}, dopo2: {}, eventi: {}, consegne: {}, email: [], controlli,
  };
  const ferma = (motivo: string): EsitoCollaudo => {
    c.fermo.motivo ??= motivo;
    esito.fermo = c.fermo.motivo;
    return esito;
  };

  // ───── 1. prerequisiti (sola lettura) ─────
  if (resendConsentito(c.env)) return ferma("resend_consentito");
  const accese = await leggi<{ impresa_id: string }[]>("imprese con le email accese", c.admin.from("omnia_ai_radar_notifiche_impresa").select("impresa_id").eq("email_attive", true));
  const destinatari = await leggi<{ impresa_id: string; user_id: string; ruolo: string; email: string | null }[]>(
    "destinatari", c.admin.rpc("radar_notifiche_destinatari", { p_imprese: accese.map((r) => r.impresa_id) }) as PromiseLike<{ data: unknown; error: { message?: string } | null }>,
  );
  const nonDiProva = destinatari.filter((d) => !/^[a-z0-9._+-]+@prova\.test$/i.test(String(d.email ?? "")));
  verifica("prerequisiti: ogni destinatario delle imprese con le email accese è un indirizzo @prova.test", nonDiProva.length === 0);
  if (nonDiProva.length) return ferma("destinatario_non_di_prova");
  const idDi = (locale: string) => destinatari.find((d) => String(d.email).toLowerCase() === `${locale}@prova.test`)?.user_id ?? null;
  const ids = { titolareA: idDi(PERSONE.titolareA), ufficioA: idDi(PERSONE.ufficioA), titolareB: idDi(PERSONE.titolareB) };
  const ruoloGiusto = (id: string | null, ruolo: string, impresa: string | null) => !!id && !!impresa && destinatari.some((d) => d.user_id === id && d.ruolo === ruolo && d.impresa_id === impresa);
  verifica("prerequisiti: le due imprese del collaudo Z3 con le email accese (titolare A con il suo Ufficio Gare, titolare B)",
    ruoloGiusto(ids.titolareA, "titolare", ids.titolareA) && ruoloGiusto(ids.ufficioA, "ufficio_gare", ids.titolareA) && ruoloGiusto(ids.titolareB, "titolare", ids.titolareB));
  if (!ids.titolareA || !ids.ufficioA || !ids.titolareB || controlli.some(([, ok]) => !ok)) return ferma("imprese_del_collaudo_assenti");
  const imprese = [ids.titolareA, ids.titolareB];
  const prima = await contaTutto(c, imprese);
  verifica("prerequisiti: eventi, consegne e giri del motore VUOTI prima del collaudo", prima.eventi.length === 0 && prima.consegne.length === 0 && prima.giri.length === 0);
  verifica("prerequisiti: nessuna gara sintetica Z8 già presente (collaudo mai fatto)", prima.aggiunte.length === 0);
  if (controlli.some(([, ok]) => !ok)) return ferma("prerequisiti_non_soddisfatti");
  esito.richieste.prerequisiti = c.richieste() - r0;

  // ───── 2. i 3 dati sintetici ─────
  const r1 = c.richieste();
  const dati = datiSintetici(oggi, { titolareA: ids.titolareA, ufficioA: ids.ufficioA, titolareB: ids.titolareB }, c.nuovoId);
  await leggi("scrittura delle gare sintetiche", c.admin.from("omnia_ai_radar_gare_aggiunte").insert(dati.map((d) => d.aggiunta)));
  await leggi("scrittura delle salvate sintetiche", c.admin.from("omnia_ai_radar_salvate").insert(dati.map((d) => d.salvata)));
  esito.richieste.dati = c.richieste() - r1;

  // ───── 3. passaggio 1 ─────
  const provider = new ProviderSuCartella(path.join(c.cartella, "email"), c.fermo);
  const d: DipendenzeMotore = {
    admin: c.admin,
    env: c.env,
    provider,
    componi: componiEmailRadar,
    parametri: PARAMETRI_PROPOSTI,
    statoAccesso: c.statoAccesso,
    adesso: c.adesso,
    nuovoId: c.nuovoId,
    attendi: c.attendi,
    ultimoPassaggio: ultimoPassaggioProgrammato,
    cursoreNuoveIniziale: c.cursoreNuoveIniziale,
    fontiNascosteAggiunte: c.modo === "giro" ? undefined : c.fontiNascoste,
  };
  if (d.provider.nome !== "finto") return ferma("provider_non_finto");
  const r2 = c.richieste();
  esito.passaggio1 = await eseguiPassaggio(d);
  esito.richieste.passaggio1 = c.richieste() - r2;
  if (c.fermo.motivo) return ferma(c.fermo.motivo);

  // ───── 4. tetti, prima del secondo passaggio ─────
  const r3 = c.richieste();
  const dopo1 = await contaTutto(c, imprese);
  esito.richieste.controlli1 = c.richieste() - r3;
  esito.dopo1 = { eventi: dopo1.eventi.length, consegne: dopo1.consegne.length, giri: dopo1.giri.length, aggiunte: dopo1.aggiunte.length, salvate: dopo1.salvate.length };
  const persona = new Map(destinatari.map((x) => [x.user_id, String(x.email).split("@")[0]]));
  const tetti = (k: keyof typeof TETTI) => (esito.dopo1[k] ?? 0) <= TETTI[k];
  for (const k of Object.keys(TETTI) as (keyof typeof TETTI)[]) verifica(`tetto: ${k} ≤ ${TETTI[k]} (${esito.dopo1[k]})`, tetti(k));
  verifica("passaggio 1: ogni consegna a una persona della STESSA impresa dell'evento, solo destinatari @prova.test", dopo1.consegne.every((x) => {
    const ev = dopo1.eventi.find((e) => e.id === x.evento_id);
    return persona.has(String(x.destinatario_id)) && (x.tipo_consegna !== "singola" || (ev && ev.impresa_id === x.impresa_id)) && destinatari.some((p) => p.user_id === x.destinatario_id && p.impresa_id === x.impresa_id);
  }));
  verifica("passaggio 1: consegne chiuse («inviata» o «inclusa»), provider «finto»", dopo1.consegne.every((x) => (x.stato === "inviata" && x.provider === "finto" && String(x.provider_id).startsWith("finto-")) || x.stato === "inclusa"));
  verifica("passaggio 1: giri con il provider «finto» sullo staging", dopo1.giri.every((g) => g.provider === "finto" && g.ambiente === "staging"));
  if (controlli.some(([, ok]) => !ok)) return ferma("tetti_o_controlli_superati");

  // ───── 5. passaggio 2, stesso giorno: nessuna riga nuova ─────
  const r4 = c.richieste();
  esito.passaggio2 = await eseguiPassaggio(d);
  esito.richieste.passaggio2 = c.richieste() - r4;
  const r5 = c.richieste();
  const dopo2 = await contaTutto(c, imprese);
  esito.richieste.controlli2 = c.richieste() - r5;
  esito.dopo2 = { eventi: dopo2.eventi.length, consegne: dopo2.consegne.length, giri: dopo2.giri.length, aggiunte: dopo2.aggiunte.length, salvate: dopo2.salvate.length };
  verifica("passaggio 2 (stesso giorno): 0 righe nuove in eventi, consegne e giri", JSON.stringify(esito.dopo2) === JSON.stringify(esito.dopo1));
  verifica("passaggio 2: fase «eventi» saltata (già eseguita oggi)", JSON.stringify(esito.passaggio2 && "eventi" in esito.passaggio2 ? esito.passaggio2.eventi : null).includes("gia_eseguita_oggi"));
  verifica("passaggio 2: O2, stato del passaggio in 1 richiesta e nient'altro", esito.richieste.passaggio2 === 1);
  if (c.fermo.motivo) return ferma(c.fermo.motivo);

  // ───── 6. tabelle per persona e tipo ─────
  const nomeImpresa = (id: unknown) => persona.get(String(id)) ?? "?";
  for (const e of dopo2.eventi) esito.eventi[`${nomeImpresa(e.impresa_id)}|${e.tipo}`] = (esito.eventi[`${nomeImpresa(e.impresa_id)}|${e.tipo}`] ?? 0) + 1;
  for (const x of dopo2.consegne) {
    const tipo = x.tipo_consegna === "singola" ? String(dopo2.eventi.find((e) => e.id === x.evento_id)?.tipo) : "raggruppata";
    const k = `${nomeImpresa(x.destinatario_id)}|${tipo}|${x.stato}`;
    esito.consegne[k] = (esito.consegne[k] ?? 0) + 1;
  }
  esito.email = provider.indice.map((x) => ({ a: x.a, oggetto: x.oggetto, tipo: x.tipo, file: x.file }));
  return esito;
}

// ═══════════════════════════════ i due modi ═══════════════════════════════

function argomento(nome: string): string | null {
  const i = process.argv.indexOf(nome);
  return i > 0 ? (process.argv[i + 1] ?? null) : null;
}

/** La prova: database in memoria con la replica dello staging, NESSUNA rete. */
export async function prova(replica: Record<string, Riga[]>, opzioni: { adesso: Date; cartella: string; cursoreNuoveGiorni?: number; fontiNascoste?: readonly string[] }): Promise<EsitoCollaudo> {
  const db = new DbFinto();
  for (const [t, righe] of Object.entries(replica)) db.tabelle[t] = righe.map((r) => ({ ...r }));
  db.orologio = () => opzioni.adesso;
  let n = 0;
  return collaudo({
    modo: "prova",
    admin: db as unknown as ClientDb,
    env: { NEXT_PUBLIC_SUPABASE_URL: `https://${STAGING_REF}.supabase.co`, RADAR_NOTIFICHE_EMAIL: "attivo", RADAR_EMAIL_ORIGINE: "http://localhost:3000" },
    statoAccesso: async (id) => (await getOmniaAiAccessState(id, db as unknown as SupabaseClient)).stato as StatoAccesso,
    adesso: () => opzioni.adesso,
    nuovoId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    attendi: async () => undefined,
    richieste: () => db.conta(),
    cartella: opzioni.cartella,
    cursoreNuoveIniziale: opzioni.cursoreNuoveGiorni ? (a) => new Date(a.getTime() - opzioni.cursoreNuoveGiorni! * 86_400_000).toISOString() : undefined,
    fontiNascoste: opzioni.fontiNascoste,
    fermo: { motivo: null },
  });
}

/** Il giro vero sullo staging, con tutte le guardie. Restituisce l'esito; non scrive mai fuori dallo staging. */
export async function giro(opzioni: { cartella: string; ambiente: Record<string, string | undefined>; registro: { controllaPorta: (x: { script: string }) => unknown } }): Promise<EsitoCollaudo> {
  const amb = opzioni.ambiente;
  // 1) autorizzazione «scrittura_prova» registrata (lanciatore esegui-autorizzato.mjs)
  opzioni.registro.controllaPorta({ script: "collaudo-motore-z8.ts" });
  // 2) interruttore SOLO nell'ambiente del lancio, mai su un'anteprima
  if (amb.RADAR_NOTIFICHE_EMAIL !== "attivo") throw new FermoCollaudo("RADAR_NOTIFICHE_EMAIL non è «attivo» nell'ambiente del lancio");
  if (amb.VERCEL_ENV) throw new FermoCollaudo("VERCEL_ENV presente: il collaudo non gira su Vercel");
  // 3) staging soltanto (guardia anti-produzione già superata da chi chiama, qui il secondo controllo)
  const url = String(amb.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  if (url !== `https://${STAGING_REF}.supabase.co` || Object.values(amb).some((v) => typeof v === "string" && v.includes(PRODUZIONE_REF))) throw new FermoCollaudo("non è lo staging");
  // 4) osservatore di rete: SOLO lo staging; tutto il resto ferma il giro
  const fermo = { motivo: null as string | null };
  const osservatore = installaOsservatore(url, fermo);
  const richieste = () => osservatore.richieste;
  const client = createClient(url, String(amb.SUPABASE_SERVICE_ROLE_KEY ?? ""), { auth: { autoRefreshToken: false, persistSession: false } });
  try {
    return await collaudo({
      modo: "giro",
      admin: client as unknown as ClientDb,
      env: { NEXT_PUBLIC_SUPABASE_URL: url, RADAR_NOTIFICHE_EMAIL: "attivo", RADAR_EMAIL_ORIGINE: amb.RADAR_EMAIL_ORIGINE ?? "http://localhost:3000" },
      statoAccesso: async (id) => (await getOmniaAiAccessState(id, client)).stato as StatoAccesso,
      adesso: () => new Date(),
      nuovoId: () => randomUUID(),
      attendi: (ms) => new Promise((r) => setTimeout(r, ms)),
      richieste,
      cartella: opzioni.cartella,
      fermo,
    });
  } finally {
    osservatore.ripristina();
  }
}

/** Sostituisce fetch: lascia passare SOLO l'origine data (lo staging) e conta le richieste; qualunque altro host ferma il collaudo. */
export function installaOsservatore(origine: string, fermo: { motivo: string | null }): { readonly richieste: number; ripristina: () => void } {
  const originale = globalThis.fetch;
  const stato = { richieste: 0 };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const indirizzo = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (indirizzo.origin !== origine) {
      fermo.motivo ??= `rete_fuori_dallo_staging:${indirizzo.host}`;
      throw new FermoCollaudo(`RETE FUORI DALLO STAGING: ${indirizzo.host}`);
    }
    stato.richieste++;
    return originale(input, init);
  }) as typeof fetch;
  return {
    get richieste() {
      return stato.richieste;
    },
    ripristina: () => {
      globalThis.fetch = originale;
    },
  };
}

function stampa(e: EsitoCollaudo): void {
  console.log(`Collaudo Z8 (${e.modo}), giorno ${e.oggi}${e.fermo ? ` — FERMATO: ${e.fermo}` : ""}`);
  console.log(`  richieste: ${JSON.stringify(e.richieste)}`);
  console.log(`  dopo il passaggio 1: ${JSON.stringify(e.dopo1)}; dopo il passaggio 2: ${JSON.stringify(e.dopo2)}`);
  console.log(`  eventi per impresa e tipo: ${JSON.stringify(e.eventi)}`);
  console.log(`  consegne per persona, tipo e stato: ${JSON.stringify(e.consegne)}`);
  for (const m of e.email) console.log(`  email: ${m.a} · ${m.tipo} · «${m.oggetto}» → ${m.file}`);
  for (const [nome, ok] of e.controlli) console.log(`${ok ? "ok      " : "FALLITO "} ${nome}`);
}

async function principale(): Promise<number> {
  const modo = process.argv[2];
  const cartella = path.resolve(argomento("--cartella") ?? path.join(process.cwd(), `collaudo-z8-${modo ?? "?"}`));
  if (modo === "prova") {
    // nessuna rete nella prova
    globalThis.fetch = (async () => {
      throw new Error("RETE VIETATA nella prova del collaudo Z8");
    }) as typeof fetch;
    const file = process.argv[3];
    if (!file || !fs.existsSync(file)) {
      console.error("uso: npx tsx scripts/collaudo-z8/collaudo-motore-z8.ts prova <replica.json> [--adesso ISO] [--cursore-nuove-giorni N] [--cartella DIR]");
      return 2;
    }
    const replica = JSON.parse(fs.readFileSync(file, "utf8")) as { tabelle: Record<string, Riga[]> };
    const adesso = new Date(argomento("--adesso") ?? new Date().toISOString());
    const giorni = argomento("--cursore-nuove-giorni");
    // --nascondi-pvl: SOLO nella prova, per mostrare la differenza con la PVL nascosta (mai nel giro)
    const e = await prova(replica.tabelle, { adesso, cartella, cursoreNuoveGiorni: giorni ? Number(giorni) : undefined, fontiNascoste: process.argv.includes("--nascondi-pvl") ? ["pvl"] : undefined });
    fs.mkdirSync(cartella, { recursive: true });
    fs.writeFileSync(path.join(cartella, "esito.json"), JSON.stringify(e, null, 1));
    stampa(e);
    return e.fermo || e.controlli.some(([, ok]) => !ok) ? 1 : 0;
  }
  if (modo === "giro") {
    const registro = process.env.TI_REGISTRO;
    if (!registro) {
      console.error("STOP: il giro scrive sullo staging: solo con esegui-autorizzato.mjs e un'autorizzazione «scrittura_prova» registrata");
      return 2;
    }
    const { controllaPorta } = (await import(new URL(`file:///${registro.replace(/\\/g, "/").replace(/^\/+/, "")}/registro.mjs`).href)) as { controllaPorta: (x: { script: string }) => unknown };
    // la guardia anti-produzione condivisa da tutti gli script dello staging (fuori dal repository: percorso calcolato, non risolto da tsc)
    const GUARDIA = "file:///C:/Users/Dell/AppData/Local/Temp/claude/abcfdf0028fd8393/e334def8-d832-4558-942a-9241c500a45d/scratchpad/staging/guardia-staging.mjs";
    const { caricaStaging } = (await import(GUARDIA)) as {
      caricaStaging: () => Record<string, string>;
    };
    const v = caricaStaging();
    if (v.STAGING_PROJECT_REF !== STAGING_REF) throw new FermoCollaudo("guardia: non è lo staging");
    const ambiente = { NEXT_PUBLIC_SUPABASE_URL: v.STAGING_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: v.STAGING_SECRET_KEY, RADAR_NOTIFICHE_EMAIL: process.env.RADAR_NOTIFICHE_EMAIL, RADAR_EMAIL_ORIGINE: process.env.RADAR_EMAIL_ORIGINE, VERCEL_ENV: process.env.VERCEL_ENV };
    const e = await giro({ cartella, ambiente, registro: { controllaPorta } });
    fs.mkdirSync(cartella, { recursive: true });
    fs.writeFileSync(path.join(cartella, "esito.json"), JSON.stringify(e, null, 1));
    stampa(e);
    const attesi = argomento("--attesi");
    if (attesi && fs.existsSync(attesi)) {
      const a = JSON.parse(fs.readFileSync(attesi, "utf8")) as EsitoCollaudo;
      const uguali = (k: "eventi" | "consegne" | "dopo1" | "dopo2") => JSON.stringify(Object.entries(a[k]).sort()) === JSON.stringify(Object.entries(e[k]).sort());
      for (const k of ["eventi", "consegne", "dopo1", "dopo2"] as const) console.log(`${uguali(k) ? "ok      " : "DIVERSO "} confronto con la prova del giorno: ${k}`);
      console.log(`  richieste: prova ${JSON.stringify(a.richieste)} · giro ${JSON.stringify(e.richieste)}`);
    }
    return e.fermo || e.controlli.some(([, ok]) => !ok) ? 1 : 0;
  }
  console.error("uso: collaudo-motore-z8.ts prova <replica.json> … | giro [--attesi FILE] [--cartella DIR]");
  return 2;
}

if (process.argv[1] && /collaudo-motore-z8\.ts$/.test(process.argv[1].replace(/\\/g, "/"))) {
  principale()
    .then((codice) => process.exit(codice))
    .catch((e) => {
      console.error(`FERMATO: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(e instanceof FermoCollaudo ? 3 : 1);
    });
}
