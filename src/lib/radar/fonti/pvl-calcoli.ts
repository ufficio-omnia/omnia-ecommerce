// PVL, Piattaforma di pubblicità a valore legale di ANAC: interrogazioni e lettura degli avvisi restituiti dalla ricerca avanzata del sito
// (GET https://pubblicitalegale.anticorruzione.it/api/v0/avvisi-full-text-specializzata). Logica pura: nessuna rete, nessun database.
// Provata da scripts/verifica-radar-pvl.ts con avvisi reali (copie dei soli campi pubblici, senza dati di persone).
//
// USO SPERIMENTALE SOLO SULLO STAGING (decisione del titolare del 16/11/2026, che aggiorna la D5): l'interfaccia è quella del sito pubblico,
// non è documentata come servizio per i programmi e non c'è ancora una conferma di ANAC; la produzione resta esclusa finché non arrivano le
// verifiche formali e legali (resoconto 08_VERIFICA_PVL).
//
// Come sono fatti gli avvisi (verificato su richieste reali il 16/11/2026):
//   - metadati: idAvviso (l'avviso), idAppalto (la procedura, uguale tra versioni), codiceScheda (P1_16 bando UE, P2_16 bando nazionale,
//     A1_29 esito…), dataPubblicazione e dataScadenza (istanti), nuovoAvviso/tipoNuovoAvviso (avviso che sostituisce questo), attivo, oscurato;
//   - un «template» a sezioni: A (enti: denominazione e codice fiscale), B (dati generali: documenti, procedura), C (un elemento per lotto:
//     CIG, CPV SCRITTO COME DESCRIZIONE, valore stimato, luogo con il NOME della provincia e del comune, termine di ricezione, criteri);
//   - i bandi sopra soglia citano l'avviso TED («TED:NOTICE:787530-2026»): è la chiave per riconoscere la stessa gara già letta da TED;
//   - la durata del contratto non ha unità (36 = mesi, 1095 = giorni, «3 ANNI SCOLASTICI»): non si legge (si prende da TED quando c'è);
//   - gli esiti elencano gli aggiudicatari: qui si legge SOLO lo stato della gara, mai i nomi (decisione D6).
import { classificaGara, normalizzaCpv, vociCpv, type SettoreRadar } from "../settori";
import { maiuscoleIniziali, type IdRegione } from "../territorio";
import { nomeDiConfronto, provinciaDaTesto } from "../province";
import { confrontaScadenze, giornoDiRoma, impronta, type ScadenzaTed } from "./ted-calcoli";
import type { RecordLotto, RecordProcedura } from "./tipi";

export const URL_PVL = "https://pubblicitalegale.anticorruzione.it/api/v0";
export const PERCORSO_RICERCA_PVL = "/avvisi-full-text-specializzata";
// Nome generico del programma, come per TED: nessun dato dell'azienda o delle persone nelle richieste.
export const USER_AGENT_PVL = "omnia-radar/1.0 (lettura avvisi pubblici)";

// Limiti di cortesia verso la fonte: modificabili dalla console entro questi intervalli, mai oltre.
export type LimitiPvl = { avvisiPerPagina: number; pausaMs: number; timeoutMs: number; tentativi: number; richiesteMassime: number };
export const LIMITI_PVL_PREDEFINITI: LimitiPvl = { avvisiPerPagina: 100, pausaMs: 3_000, timeoutMs: 30_000, tentativi: 2, richiesteMassime: 20 };
export const LIMITI_PVL_INTERVALLI: Record<keyof LimitiPvl, { min: number; max: number }> = {
  avvisiPerPagina: { min: 10, max: 100 },
  pausaMs: { min: 2_000, max: 60_000 },
  timeoutMs: { min: 5_000, max: 60_000 },
  tentativi: { min: 1, max: 3 },
  richiesteMassime: { min: 1, max: 60 },
};

// Dove stanno nella console (console_impostazioni): modificabili solo dagli amministratori, con registro delle modifiche.
export const CHIAVI_LIMITI_PVL: Record<keyof LimitiPvl, string> = {
  avvisiPerPagina: "radar_pvl_avvisi_per_pagina",
  pausaMs: "radar_pvl_pausa_ms",
  timeoutMs: "radar_pvl_timeout_ms",
  tentativi: "radar_pvl_tentativi",
  richiesteMassime: "radar_pvl_richieste_massime",
};

export function limitiPvlDaRighe(righe: readonly { chiave: string; valore: string }[] | null | undefined): LimitiPvl {
  const perChiave = new Map((righe ?? []).map((r) => [r.chiave, r.valore]));
  const parziali: Partial<Record<keyof LimitiPvl, unknown>> = {};
  for (const [k, chiave] of Object.entries(CHIAVI_LIMITI_PVL) as [keyof LimitiPvl, string][]) if (perChiave.has(chiave)) parziali[k] = perChiave.get(chiave);
  return limitiPvl(parziali);
}

export function limitiPvl(parziali: Partial<Record<keyof LimitiPvl, unknown>> | null | undefined): LimitiPvl {
  const out = { ...LIMITI_PVL_PREDEFINITI };
  for (const k of Object.keys(LIMITI_PVL_INTERVALLI) as (keyof LimitiPvl)[]) {
    const v = Number(parziali?.[k]);
    const { min, max } = LIMITI_PVL_INTERVALLI[k];
    if (Number.isInteger(v) && v >= min && v <= max) out[k] = v;
  }
  return out;
}

// ───── interrogazione ─────

// «2026-11-16» → «16/11/2026» (formato richiesto dalla ricerca avanzata).
export function dataPvl(giorno: string): string {
  const m = giorno.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`Giorno non valido: ${giorno}`);
  return `${m[3]}/${m[2]}/${m[1]}`;
}

// I codici CPV del file approvato, esatti a 8 cifre: la ricerca avanzata filtra per prefisso, e un prefisso di 8 cifre è il codice esatto
// (stessa regola di TED: solo i 50 codici del file, nessuna famiglia più larga).
export function cpvRicercaPvl(): string[] {
  return vociCpv().map((v) => v.cpv);
}

export function parametriRicercaPvl(p: { da: string; a: string; cpv: readonly string[]; avvisiPerPagina: number; token: string | null }): Record<string, string> {
  const out: Record<string, string> = {
    pageSize: String(p.avvisiPerPagina),
    dataPubblicazioneStart: dataPvl(p.da),
    dataPubblicazioneEnd: dataPvl(p.a),
    sortField: "dataPubblicazione",
    sortDirection: "asc",
    operatore: "AND",
    cpv: p.cpv.join(","),
  };
  if (p.token) {
    out.direzionePaginazione = "AVANTI";
    out.tokenPaginazione = p.token;
  }
  return out;
}

// La forma di una pagina della ricerca: se cambia, il connettore si ferma (mai interpretare dati che non si capiscono).
export type PaginaPvlGrezza = { content: Record<string, unknown>[]; count: number | null; token: string | null };

export function leggiPaginaGrezza(j: unknown): PaginaPvlGrezza | null {
  if (!j || typeof j !== "object" || Array.isArray(j)) return null;
  const o = j as Record<string, unknown>;
  // fine dei risultati: la risposta della ricerca senza elenco (o con elenco vuoto) ma con i suoi campi di paginazione o di conteggio
  if ((o.content === null || o.content === undefined) && ("count" in o || "lastPaginationToken" in o || "firstPaginationToken" in o)) {
    return { content: [], count: typeof o.count === "number" ? o.count : null, token: null };
  }
  if (!Array.isArray(o.content)) return null;
  if (o.content.some((x) => !x || typeof x !== "object" || typeof (x as Record<string, unknown>).idAvviso !== "string")) return null;
  const count = typeof o.count === "number" ? o.count : null;
  const token = typeof o.lastPaginationToken === "string" && o.lastPaginationToken ? o.lastPaginationToken : null;
  return { content: o.content as Record<string, unknown>[], count, token };
}

// ───── lettura di un avviso ─────

type Avviso = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Alcuni campi arrivano come {"value": …}.
export function valorePvl(x: unknown): unknown {
  return x && typeof x === "object" && !Array.isArray(x) && "value" in (x as Record<string, unknown>) ? (x as Record<string, unknown>).value : x;
}

function decodificaEntita(t: string): string {
  return t
    .replace(/&#(\d{2,5});/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function testoPvl(x: unknown): string | null {
  const v = valorePvl(x);
  if (typeof v !== "string") return null;
  const t = decodificaEntita(v).replace(/\s+/g, " ").trim();
  return t ? t : null;
}

function numeroPvl(x: unknown): number | null {
  const v = valorePvl(x);
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+(\.\d+)?$/.test(v.trim()) ? Number(v.trim()) : NaN;
  return Number.isFinite(n) && n >= 0 && n < 1e13 ? Math.round(n * 100) / 100 : null;
}

function urlSicuro(x: unknown): string | null {
  const s = testoPvl(x) ?? "";
  if (!/^https?:\/\//i.test(s) || s.length > 2000) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

// «https://ted.europa.eu/udl?uri=TED:NOTICE:787530-2026:TEXT:IT:HTML» → «787530-2026».
export function numeroTedDaLink(x: unknown): string | null {
  const s = testoPvl(x) ?? "";
  const m = s.match(/TED:NOTICE:(\d{1,8}-\d{4})/i);
  return m ? m[1] : null;
}

export function cigPvl(x: unknown): string | null {
  const s = (testoPvl(x) ?? "").toUpperCase();
  return /^[0-9A-Z]{10}$/.test(s) ? s : null;
}

// Codice fiscale di un ente: 11 cifre (o 16 caratteri). Gli identificativi interni di ANAC («CFAVCP-…») non sono codici fiscali.
export function codiceFiscaleSa(x: unknown): string | null {
  const s = (testoPvl(x) ?? "").replace(/\s+/g, "").toUpperCase();
  return /^\d{11}$/.test(s) || /^[A-Z0-9]{16}$/.test(s) ? s : null;
}

// Il CPV arriva come descrizione ufficiale («Servizi di pulizia di uffici»): si riconosce SOLO se è una delle voci del file approvato
// (stessa descrizione); altrimenti resta sconosciuto (mai un codice indovinato).
const CPV_PER_DESCRIZIONE = new Map(vociCpv().map((v) => [nomeDiConfronto(v.descrizione), v.cpv]));

export function cpvDaDescrizione(x: unknown): string | null {
  const t = testoPvl(x);
  if (!t) return null;
  const codice = normalizzaCpv(t.match(/^(\d{8}(?:-\d)?)/)?.[1] ?? null);
  if (codice) return codice;
  return CPV_PER_DESCRIZIONE.get(nomeDiConfronto(t)) ?? null;
}

const FMT_ORA_ROMA = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

// Scadenza di un lotto. Regole (mai un'ora presunta):
//   - termine di ricezione con l'ora («2026-12-11T09:00:00+01:00», bandi nazionali) → giorno e istante;
//   - termine con il solo giorno («2026-12-10+01:00», bandi UE) → giorno; l'istante viene da «dataScadenza» dell'avviso SOLO se cade nello
//     stesso giorno a Roma e non è la mezzanotte esatta (una mezzanotte su un termine scritto senza ora è un giorno salvato come istante);
//   - nessun termine → «dataScadenza», con la stessa regola della mezzanotte.
export function scadenzaPvl(dataScadenza: unknown, termine: unknown): ScadenzaTed | null {
  const t = testoPvl(termine) ?? "";
  const ds = testoPvl(dataScadenza) ?? "";
  const istanteAvviso = ds && !Number.isNaN(Date.parse(ds)) ? new Date(ds) : null;
  const mezzanotte = istanteAvviso ? FMT_ORA_ROMA.format(istanteAvviso) === "00:00:00" : false;

  const conOra = t.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/);
  if (conOra) {
    const istante = new Date(`${conOra[1]}T${conOra[2]}:${conOra[3]}:${conOra[4] ?? "00"}${conOra[5] ?? "+01:00"}`);
    if (!Number.isNaN(istante.getTime())) return { giorno: giornoDiRoma(istante), iso: istante.toISOString(), oraIndicata: true, fonte: t };
  }
  const soloGiorno = t.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
  if (soloGiorno) {
    if (istanteAvviso && !mezzanotte && giornoDiRoma(istanteAvviso) === soloGiorno) {
      return { giorno: soloGiorno, iso: istanteAvviso.toISOString(), oraIndicata: true, fonte: `${t} (ora da dataScadenza ${ds})` };
    }
    return { giorno: soloGiorno, iso: null, oraIndicata: false, fonte: t };
  }
  if (istanteAvviso) {
    const giorno = giornoDiRoma(istanteAvviso);
    return mezzanotte ? { giorno, iso: null, oraIndicata: false, fonte: ds } : { giorno, iso: istanteAvviso.toISOString(), oraIndicata: true, fonte: ds };
  }
  return null;
}

// Schede ammesse come bandi (gare a cui si può partecipare): bandi e avvisi di indizione, UE (P1) e nazionali (P2), compresi i settori
// speciali e la difesa (P*_18: mense e pulizie delle caserme). Esclusi: concorsi di progettazione (23, 24), sistemi di qualificazione (15).
export const SCHEDE_BANDO_PVL = /^P[12]_(1[0-4]|1[6-9]|2[01])$/;
// Esiti che cambiano lo stato di una gara già in archivio: aggiudicazioni (A1, A2) e mancata aggiudicazione sotto soglia (NAG).
export const SCHEDE_ESITO_PVL = /^(A[12]_(29|3[0-5])|NAG)$/;
const SCHEDE_SETTORI_SPECIALI = /^P[12]_(11|13|17|21)$/;

export type MotivoEsclusionePvl =
  | "avviso_malformato"
  | "oscurato"
  | "fuori_settore"
  | "senza_oggetto"
  | "indagine_o_negoziata" // P7: indagini di mercato e negoziate senza bando (non sono bandi pubblici)
  | "affidamento" // AD*, A3*, P3*, P5*, P6*: affidamenti diretti, esclusi, adesioni
  | "modifica_contrattuale" // M*
  | "altra_scheda"; // esecuzione, subappalti, elenchi, PPP…

export type MetaPvl = {
  idAvviso: string;
  idAppalto: string;
  scheda: string;
  // istante di pubblicazione (ISO) e giorno di Roma
  data: string;
  giorno: string;
  numeroTed: string | null;
  attivo: boolean;
  sostituitoDa: string | null;
  tipoSostituzione: string | null;
};

export type BandoPvl = {
  tipo: "bando";
  meta: MetaPvl;
  record: RecordProcedura;
  settori: SettoreRadar[];
  metodoSettore: "cpv" | "parole_chiave";
  regioni: IdRegione[];
  scadenzaFonte: string | null;
  lottiScadenze: (ScadenzaTed | null)[];
  lottiDocumenti: (string | null)[];
  // dati che la fonte non dà in modo leggibile (per le statistiche dell'importazione)
  mancanti: string[];
};

export type EsitoPvl = { tipo: "esito"; meta: MetaPvl; stato: "aggiudicata" | "chiusa_senza_aggiudicazione"; cig: string[] };

export type EsclusionePvl = { tipo: "esclusione"; meta: MetaPvl | null; motivo: MotivoEsclusionePvl };

export type AvvisoPvlLetto = BandoPvl | EsitoPvl | EsclusionePvl;

function metaPvl(a: Avviso, numeroTed: string | null): MetaPvl | null {
  const idAvviso = typeof a.idAvviso === "string" ? a.idAvviso.trim() : "";
  const idAppalto = typeof a.idAppalto === "string" ? a.idAppalto.trim() : "";
  const scheda = typeof a.codiceScheda === "string" ? a.codiceScheda.trim().toUpperCase() : "";
  const data = typeof a.dataPubblicazione === "string" ? a.dataPubblicazione : "";
  if (!UUID.test(idAvviso) || !UUID.test(idAppalto) || !/^[A-Z0-9_]{1,12}$/.test(scheda) || Number.isNaN(Date.parse(data))) return null;
  const istante = new Date(data);
  const sostituitoDa = typeof a.nuovoAvviso === "string" && UUID.test(a.nuovoAvviso) ? a.nuovoAvviso : null;
  return {
    idAvviso,
    idAppalto,
    scheda,
    data: istante.toISOString(),
    giorno: giornoDiRoma(istante),
    numeroTed,
    attivo: a.attivo !== false,
    sostituitoDa,
    tipoSostituzione: typeof a.tipoNuovoAvviso === "string" && a.tipoNuovoAvviso.trim() ? a.tipoNuovoAvviso.trim().slice(0, 60) : null,
  };
}

function motivoScheda(scheda: string): MotivoEsclusionePvl {
  if (/^P7/.test(scheda) || /^P8$/.test(scheda)) return "indagine_o_negoziata";
  if (/^(AD|A3|A4|A7|P3|P5|P6)/.test(scheda)) return "affidamento";
  if (/^M\d/.test(scheda)) return "modifica_contrattuale";
  return "altra_scheda";
}

function sezioni(a: Avviso): { metadata: Record<string, unknown>; b: Record<string, unknown>; enti: Record<string, unknown>[]; elementi: Record<string, unknown>[] } {
  const t = Array.isArray(a.templates) ? (a.templates[0] as Record<string, unknown> | undefined) : undefined;
  const tpl = (t?.template ?? {}) as Record<string, unknown>;
  const metadata = (tpl.metadata && typeof tpl.metadata === "object" ? tpl.metadata : {}) as Record<string, unknown>;
  const sez = (Array.isArray(tpl.sections) ? tpl.sections : []) as Record<string, unknown>[];
  const trova = (lettera: string) => sez.find((s) => typeof s.name === "string" && new RegExp(`^SEZ\\.\\s*${lettera}\\b`).test(s.name));
  const a_ = (trova("A")?.fields ?? {}) as Record<string, unknown>;
  const b = (trova("B")?.fields ?? {}) as Record<string, unknown>;
  const c = (trova("C")?.items ?? []) as Record<string, unknown>[];
  const enti = (Array.isArray(a_.soggetti_sa) ? a_.soggetti_sa : []) as Record<string, unknown>[];
  return { metadata, b, enti, elementi: Array.isArray(c) ? c.filter((x) => x && typeof x === "object") : [] };
}

const PROCEDURE_PVL: [RegExp, string][] = [
  [/^aperta/i, "Procedura aperta"],
  [/^ristretta/i, "Procedura ristretta"],
  [/competitiva con negoziazione|negoziata con previa (indizione|pubblicazione)/i, "Procedura competitiva con negoziazione"],
  [/negoziata senza/i, "Procedura negoziata senza pubblicazione"],
  [/dialogo competitivo/i, "Dialogo competitivo"],
  [/partenariato per l.innovazione/i, "Partenariato per l'innovazione"],
];

export function tipoProceduraPvl(x: unknown): string | null {
  const t = testoPvl(x);
  if (!t) return null;
  return PROCEDURE_PVL.find(([r]) => r.test(t))?.[1] ?? null;
}

export function criterioPvl(valori: unknown[]): string | null {
  const tipi = valori.map((v) => (testoPvl(v) ?? "").toLowerCase()).filter(Boolean);
  if (tipi.length === 0) return null;
  if (tipi.every((t) => /^prezzo/.test(t))) return "Minor prezzo";
  if (tipi.some((t) => /qualit|costo/.test(t))) return "Offerta economicamente più vantaggiosa";
  return null;
}

export function naturaPvl(x: unknown): RecordProcedura["natura"] {
  const t = (testoPvl(x) ?? "").toLowerCase();
  if (t.startsWith("serviz")) return "servizi";
  if (t.startsWith("fornitur")) return "forniture";
  if (t.startsWith("lavor")) return "lavori";
  return null;
}

export function chiaveProceduraPvl(idAppalto: string): string {
  return `pvl:${idAppalto}`;
}

// Pagina pubblica dell'avviso sul sito della PVL (la pubblicazione ufficiale con valore legale): «/bandi/<idAvviso>», verificata sul sito
// il 16/11/2026.
export function urlAvvisoPvl(idAvviso: string): string {
  return `https://pubblicitalegale.anticorruzione.it/bandi/${idAvviso}`;
}

export function numeroLottoPvl(i: number): string {
  return `LOT-${String(i + 1).padStart(4, "0")}`;
}

// Un avviso della ricerca → bando normalizzato, esito (solo lo stato), oppure il motivo per cui non entra nell'archivio.
export function leggiAvvisoPvl(a: Avviso): AvvisoPvlLetto {
  const { metadata, b, enti, elementi } = sezioni(a);
  const numeroTed = numeroTedDaLink(metadata.link_eform_ted) ?? elementi.map((e) => numeroTedDaLink(e.link_eform_ted)).find((n) => !!n) ?? null;
  const meta = metaPvl(a, numeroTed);
  if (!meta) return { tipo: "esclusione", meta: null, motivo: "avviso_malformato" };
  if (a.oscurato === true) return { tipo: "esclusione", meta, motivo: "oscurato" };

  if (SCHEDE_ESITO_PVL.test(meta.scheda)) {
    const cig = [...new Set(elementi.map((e) => cigPvl(e.cig)).filter((c): c is string => !!c))];
    return { tipo: "esito", meta, stato: meta.scheda === "NAG" ? "chiusa_senza_aggiudicazione" : "aggiudicata", cig };
  }
  if (!SCHEDE_BANDO_PVL.test(meta.scheda)) return { tipo: "esclusione", meta, motivo: motivoScheda(meta.scheda) };

  const lottiGrezzi = elementi.some((e) => testoPvl(e.tipo_oggetto) === "lotto") ? elementi.filter((e) => testoPvl(e.tipo_oggetto) === "lotto") : elementi;
  const titolo = testoPvl(metadata.titolo) ?? testoPvl(metadata.descrizione) ?? (lottiGrezzi.length === 1 ? testoPvl(lottiGrezzi[0].descrizione) : null);
  if (!titolo) return { tipo: "esclusione", meta, motivo: "senza_oggetto" };
  const descrizioneMeta = testoPvl(metadata.descrizione);
  const mancanti: string[] = [];

  const cpvLotti = lottiGrezzi.map((e) => cpvDaDescrizione(e.cpv));
  const cpvTutti = [...new Set(cpvLotti.filter((c): c is string => !!c))];
  if (lottiGrezzi.some((e) => testoPvl(e.cpv)) && cpvTutti.length === 0) mancanti.push("cpv_non_riconosciuto");
  const testoOggetto = [titolo, ...lottiGrezzi.map((e) => testoPvl(e.descrizione))].filter(Boolean).join(" ");
  const classificazione = classificaGara({ cpvPrincipale: cpvLotti[0] ?? null, cpvTutti, testo: testoOggetto });
  const natura = naturaPvl(lottiGrezzi[0]?.natura_principale);
  if (classificazione.settori.length === 0) return { tipo: "esclusione", meta, motivo: "fuori_settore" };
  if (classificazione.metodo === "parole_chiave" && natura !== null && natura !== "servizi") return { tipo: "esclusione", meta, motivo: "fuori_settore" };

  const lottiScadenze = lottiGrezzi.map((e) => scadenzaPvl(a.dataScadenza, e.termine_ricezione));
  const scadenzaProc = lottiScadenze.filter((s): s is ScadenzaTed => !!s).sort(confrontaScadenze)[0] ?? scadenzaPvl(a.dataScadenza, null);
  if (!scadenzaProc) mancanti.push("scadenza");

  const valoriLotti = lottiGrezzi.map((e) => numeroPvl(e.valore_complessivo_stimato));
  const valoreStimato = valoriLotti.length > 0 && valoriLotti.every((v) => v !== null) ? Math.round(valoriLotti.reduce((s, v) => s + (v as number), 0) * 100) / 100 : null;
  if (valoreStimato === null) mancanti.push("valore");

  const documentiLotti = lottiGrezzi.map((e) => urlSicuro(e.documenti_di_gara_link));
  const urlDocumenti = urlSicuro(b.documenti_di_gara_link) ?? documentiLotti.find((u) => !!u) ?? null;
  if (!urlDocumenti) mancanti.push("documenti");

  const lotti: RecordLotto[] = lottiGrezzi.map((e, i) => ({
    cig: cigPvl(e.cig),
    numero: numeroLottoPvl(i),
    oggetto: testoPvl(e.descrizione)?.slice(0, 4000) ?? null,
    cpvPrincipale: cpvLotti[i],
    cpvTutti: cpvLotti[i] ? [cpvLotti[i] as string] : [],
    valoreStimato: valoriLotti[i],
    valoreBase: null,
    oneriSicurezza: null,
    durataMesi: null,
    opzioniRinnovi: null,
  }));
  if (lotti.some((l) => !l.cig)) mancanti.push("cig");

  const luoghi = lottiGrezzi.map((e) => provinciaDaTesto(testoPvl(e.luogo_nuts)));
  const regioni = [...new Set(luoghi.map((l) => l.regione).filter((r): r is IdRegione => !!r))];
  if (regioni.length === 0) mancanti.push("regione");
  const comuneTesto = testoPvl(lottiGrezzi[0]?.luogo_istat);
  const ente = enti[0] ?? {};

  const record: RecordProcedura = {
    fonte: "pvl",
    idFonte: meta.idAvviso,
    chiaveProcedura: chiaveProceduraPvl(meta.idAppalto),
    oggetto: titolo.slice(0, 4000),
    descrizione: descrizioneMeta && descrizioneMeta !== titolo ? descrizioneMeta.slice(0, 20000) : null,
    ente: {
      codiceFiscale: codiceFiscaleSa(ente.codice_fiscale),
      denominazione: testoPvl(ente.denominazione_amministrazione)?.slice(0, 500) ?? null,
      // la PVL non indica la sede dell'ente: comune e provincia sono quelli del luogo di esecuzione del primo lotto
      comune: comuneTesto ? maiuscoleIniziali(comuneTesto) : null,
      provincia: luoghi[0]?.sigla ?? null,
      regione: luoghi[0]?.regione ?? null,
      luogoIstat: null,
      nuts: null,
    },
    tipoAvviso: meta.scheda,
    tipoProcedura: tipoProceduraPvl(b.tipo_procedura_aggiudicazione),
    criterioAggiudicazione: criterioPvl(lottiGrezzi.map((e) => e.criteri_aggiudicazione)),
    natura,
    settoriSpeciali: SCHEDE_SETTORI_SPECIALI.test(meta.scheda),
    dataPubblicazione: meta.giorno,
    scadenzaGiorno: scadenzaProc?.giorno ?? null,
    scadenzaOfferte: scadenzaProc?.iso ?? null,
    scadenzaOraIndicata: scadenzaProc?.oraIndicata ?? false,
    valoreStimato,
    valoreBase: null,
    oneriSicurezza: null,
    durataMesi: null,
    annullata: !!meta.tipoSostituzione && /annull|revoc/i.test(meta.tipoSostituzione),
    urlAvviso: urlAvvisoPvl(meta.idAvviso),
    urlDocumenti,
    cpvPrincipale: cpvLotti[0] ?? cpvTutti[0] ?? null,
    cpvTutti,
    lotti,
    impronta: "",
  };
  record.impronta = impronta({ ...record, impronta: null, settori: classificazione.settori, attivo: meta.attivo, sostituitoDa: meta.sostituitoDa });

  return {
    tipo: "bando",
    meta,
    record,
    settori: classificazione.settori,
    metodoSettore: classificazione.metodo ?? "cpv",
    regioni,
    scadenzaFonte: scadenzaProc?.fonte ?? null,
    lottiScadenze,
    lottiDocumenti: documentiLotti,
    mancanti,
  };
}

// Ordine delle versioni PVL della stessa procedura: istante di pubblicazione, poi identificativo (per avere un ordine stabile).
export function confrontaVersioniPvl(a: Pick<MetaPvl, "data" | "idAvviso">, b: Pick<MetaPvl, "data" | "idAvviso">): number {
  return a.data !== b.data ? a.data.localeCompare(b.data) : a.idAvviso.localeCompare(b.idAvviso);
}
