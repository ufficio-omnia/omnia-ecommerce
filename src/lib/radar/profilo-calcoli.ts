// Fase B4 (B1), grado 1 — Profilo di ricerca dell'impresa e «Per te». Logica pura: nessun database, nessuna rete.
// Decisioni dell'utente del 19/11/2026 (26 e approvazione definitiva): un profilo per impresa, lo modifica SOLO il titolare; «Per te» non conta
// nelle ricerche; gare senza luogo mostrate in «Per te»; scartati rimandati. Tabella: omnia_ai_radar_profili (bozza 0122 di B2, 26B §3.1).
//
// Regole:
//   - il profilo si valida sul catalogo: settori di SETTORI_RADAR, sottocategorie con normalizzaSottocategorieProfilo (catalogo stabile della
//     PVL, alias tradotti), regioni di REGIONI, procedure di PROCEDURE_RICERCA, importi ≥ 0 con minimo ≤ massimo. Un valore fuori catalogo
//     arrivato da un modulo è un errore, mai un salvataggio parziale in silenzio;
//   - anche in lettura il profilo si ripulisce sul catalogo (un identificativo rinominato non rompe «Per te»);
//   - «Per te» = la stessa cercaGare di Cerca con i filtri del profilo (UNA richiesta), più le regole del contratto in memoria (solo A, B a
//     richiesta, mai C) prima di ordinamento e paginazione. Regioni, procedure e importi li applica il database: in memoria restano settori e
//     sottocategorie (soloSettori), così le gare SENZA luogo non si perdono.
import { SETTORI_RADAR, nomeSettore, nomeSottocategoria, type SettoreRadar } from "./settori";
import { eSettore, normalizzaSottocategorieProfilo } from "./settori-catalogo";
import { REGIONI, isRegione, nomeRegione, type IdRegione } from "./territorio";
import { ORDINAMENTI, PAGINE_MASSIME, PROCEDURE_RICERCA, type FiltriRicerca, type Ordinamento, type ProceduraRicerca } from "./ricerca-calcoli";
import type { GaraPerRadar, LivelloRilevanza, OpportunitaRadar, ProfiloRadar } from "./radar-personalizzato-contratto";
import type { ConClassificazioni } from "./classificazioni-lettura";

export const TABELLA_PROFILI = "omnia_ai_radar_profili";
export const COLONNE_PROFILO = "user_id, posizione, settori, sottocategorie, regioni, tipi_procedura, importo_min, importo_max, vedere_correlate, aggiornato_il";
/** Nella prima versione un solo profilo per impresa (decisione del 19/11): posizione 1. */
export const POSIZIONE_PROFILO = 1;
export const IMPORTO_MASSIMO = 1e12;

/** La riga come la legge PostgREST (numeric arriva come testo o numero). */
export type RigaProfilo = {
  user_id: string;
  posizione: number;
  settori: string[] | null;
  sottocategorie: unknown;
  regioni: string[] | null;
  tipi_procedura: string[] | null;
  importo_min: number | string | null;
  importo_max: number | string | null;
  vedere_correlate: boolean | null;
  aggiornato_il: string | null;
};

export type ProfiloLetto = ProfiloRadar & { aggiornatoIl: string | null };

const ID_PROCEDURE = new Set<string>(PROCEDURE_RICERCA.map((p) => p.id));

function numeroOppureNull(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 && n < IMPORTO_MASSIMO ? n : null;
}

/** Dalla riga del database al profilo, ripulito sul catalogo (valori sconosciuti tolti, alias tradotti). null se la riga non c'è. */
export function profiloDaRiga(r: RigaProfilo | null | undefined, impresaId: string): ProfiloLetto | null {
  if (!r || r.user_id !== impresaId) return null;
  const settori = [...new Set((r.settori ?? []).filter(eSettore))];
  const { sottocategorie } = normalizzaSottocategorieProfilo(r.sottocategorie, settori);
  const importoMin = numeroOppureNull(r.importo_min);
  const importoMax = numeroOppureNull(r.importo_max);
  return {
    impresaId,
    settori,
    sottocategorie,
    regioni: [...new Set((r.regioni ?? []).filter(isRegione))],
    procedure: [...new Set((r.tipi_procedura ?? []).filter((p) => ID_PROCEDURE.has(p)))],
    importoMin,
    // un massimo sotto il minimo (dato rovinato) non restringe nulla: si ignora
    importoMax: importoMax !== null && importoMin !== null && importoMax < importoMin ? null : importoMax,
    vedereCorrelate: r.vedere_correlate === true,
    aggiornatoIl: r.aggiornato_il ?? null,
  };
}

/** Un profilo senza settori non produce «Per te» (nessuna richiesta al Radar). */
export function profiloVuoto(p: Pick<ProfiloRadar, "settori"> | null | undefined): boolean {
  return !p || p.settori.length === 0;
}

// ───── modulo → valori validati ─────

/** I campi del modulo del profilo. Sottocategorie: caselle «sottocategoria» con valore «<settore>:<id>». */
export type InputProfilo = {
  settori: string[];
  sottocategorie: string[];
  regioni: string[];
  procedure: string[];
  importoMin: string;
  importoMax: string;
  vedereCorrelate: boolean;
};

type LettoreModulo = { getAll(nome: string): unknown[]; get(nome: string): unknown };

export function inputProfiloDaModulo(fd: LettoreModulo): InputProfilo {
  const tutti = (n: string) => fd.getAll(n).map((v) => String(v ?? ""));
  return {
    settori: tutti("settore"),
    sottocategorie: tutti("sottocategoria"),
    regioni: tutti("regione"),
    procedure: tutti("procedura"),
    importoMin: String(fd.get("min") ?? ""),
    importoMax: String(fd.get("max") ?? ""),
    vedereCorrelate: String(fd.get("correlate") ?? "") === "si",
  };
}

export type ValoriProfilo = {
  settori: SettoreRadar[];
  sottocategorie: Partial<Record<SettoreRadar, string[]>>;
  regioni: IdRegione[];
  procedure: ProceduraRicerca[];
  importoMin: number | null;
  importoMax: number | null;
  vedereCorrelate: boolean;
};

export type EsitoProfilo = { ok: true; valori: ValoriProfilo; avvisi: string[] } | { ok: false; errore: string };

/** Un importo scritto in italiano («1.250.000», «1250000,50», «€ 500 000»); "" = nessun limite; altro = non valido (undefined). */
export function importoDaTesto(v: string): number | null | undefined {
  const t = v.trim().replace(/[.\s€]/g, "").replace(",", ".");
  if (t === "") return null;
  if (!/^\d{1,13}(\.\d{1,2})?$/.test(t)) return undefined;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n < IMPORTO_MASSIMO ? n : undefined;
}

/**
 * Valida il profilo arrivato dal modulo. Valori fuori catalogo = errore (il modulo li offre solo dal catalogo: altrimenti è un invio
 * manomesso). Le sottocategorie di un settore tolto nello stesso invio si lasciano cadere con un avviso.
 */
export function validaProfiloRadar(input: InputProfilo): EsitoProfilo {
  const avvisi: string[] = [];
  const settoriTesto = [...new Set(input.settori.map((s) => s.trim()).filter(Boolean))];
  if (settoriTesto.some((s) => !eSettore(s))) return { ok: false, errore: "Settore non valido." };
  // ordine stabile: quello di SETTORI_RADAR
  const settori = SETTORI_RADAR.map((s) => s.id).filter((id) => settoriTesto.includes(id));

  const scelte: Record<string, string[]> = {};
  for (const voce of input.sottocategorie) {
    const [settore, id, ...resto] = voce.split(":");
    if (!settore || !id || resto.length) return { ok: false, errore: "Sottocategoria non valida." };
    (scelte[settore] ??= []).push(id);
  }
  const { sottocategorie, scartate } = normalizzaSottocategorieProfilo(scelte, settori);
  if (scartate.some((s) => s.motivo !== "settore_non_scelto")) return { ok: false, errore: "Sottocategoria non valida." };
  if (scartate.length) avvisi.push("Le sottocategorie dei settori non scelti non sono state salvate.");

  const regioniTesto = [...new Set(input.regioni.map((r) => r.trim()).filter(Boolean))];
  if (regioniTesto.some((r) => !isRegione(r))) return { ok: false, errore: "Regione non valida." };
  const regioni = REGIONI.map((r) => r.id).filter((id) => regioniTesto.includes(id));

  const procedureTesto = [...new Set(input.procedure.map((p) => p.trim()).filter(Boolean))];
  if (procedureTesto.some((p) => !ID_PROCEDURE.has(p))) return { ok: false, errore: "Procedura non valida." };
  const procedure = PROCEDURE_RICERCA.map((p) => p.id).filter((id) => procedureTesto.includes(id));

  const importoMin = importoDaTesto(input.importoMin);
  const importoMax = importoDaTesto(input.importoMax);
  if (importoMin === undefined || importoMax === undefined) return { ok: false, errore: "Importo non valido: scrivi solo cifre, per esempio 150000." };
  if (importoMin !== null && importoMax !== null && importoMin > importoMax) return { ok: false, errore: "L'importo minimo supera il massimo." };

  return { ok: true, valori: { settori, sottocategorie, regioni, procedure, importoMin, importoMax, vedereCorrelate: input.vedereCorrelate }, avvisi };
}

/** La riga da scrivere (upsert su user_id, posizione). L'impresa e l'autore li passa il server dalla sessione, MAI dal modulo. */
export function rigaDaValori(valori: ValoriProfilo, impresaId: string, autoreId: string, adesso: string) {
  return {
    user_id: impresaId,
    posizione: POSIZIONE_PROFILO,
    settori: valori.settori,
    sottocategorie: valori.sottocategorie,
    regioni: valori.regioni,
    tipi_procedura: valori.procedure,
    importo_min: valori.importoMin,
    importo_max: valori.importoMax,
    vedere_correlate: valori.vedereCorrelate,
    aggiornato_il: adesso,
    aggiornato_da: autoreId,
  };
}

// ───── profilo → ricerca ─────

/** I filtri di Cerca presi dal profilo: solo gare aperte, nessun testo, nessun filtro di date. */
export function filtriDaProfilo(p: ProfiloRadar, ordina: Ordinamento, pagina: number): FiltriRicerca {
  return {
    q: "",
    settori: p.settori.filter(eSettore),
    regioni: p.regioni.filter(isRegione),
    importoMin: p.importoMin,
    importoMax: p.importoMax,
    scadenzaEntroGiorni: null,
    pubblicataNegliUltimiGiorni: null,
    procedure: p.procedure.filter((x): x is ProceduraRicerca => ID_PROCEDURE.has(x)),
    // «Per te» mostra tutti i tipi, ognuno con la sua etichetta (C5)
    tipi: [],
    stato: "aperte",
    ordina,
    pagina,
  };
}

/** Condizione PostgREST per le regioni di «Per te»: luogo in una delle regioni OPPURE luogo non indicato (decisione del 19/11). */
export function condizioneRegioniOSenzaLuogo(regioni: readonly string[]): string {
  const valide = regioni.filter(isRegione);
  return `luogo_regioni.ov.{${valide.join(",")}},luogo_regioni.eq.{}`;
}

/** In memoria restano solo settori, sottocategorie e correlate: regioni, procedure e importi li ha già applicati il database. */
export function soloSettori(p: ProfiloRadar): ProfiloRadar {
  return { ...p, regioni: [], procedure: [], importoMin: null, importoMax: null };
}

type RigaConClassificazioni = ConClassificazioni & { id: string; unita_a: string | null; tipo_procedura: string | null; luogo_regioni: string[] | null; valore_stimato: number | string | null };

/** Dalla riga letta da cercaGare (con le classificazioni incorporate) alla gara come la vede il contratto. Le righe sono già solo aperte. */
export function garaPerRadarDaRiga(r: RigaConClassificazioni): GaraPerRadar {
  const s = Array.isArray(r.classificazione_stato) ? (r.classificazione_stato[0] ?? null) : (r.classificazione_stato ?? null);
  return {
    id: r.id,
    unitaA: r.unita_a,
    statoClassificazione: s?.stato ?? null,
    righe: (r.classificazioni ?? []).map((x) => ({ settore: x.settore, rilevanza: x.rilevanza as LivelloRilevanza, sottocategorie: x.sottocategorie ?? [], attiva: x.attiva !== false })),
    tipoProcedura: r.tipo_procedura,
    regioni: r.luogo_regioni ?? [],
    valore: numeroOppureNull(r.valore_stimato),
    aperta: true,
  };
}

/** Le opportunità in ordine: prima le pertinenti, poi le correlate, mantenendo l'ordine scelto dentro ciascun gruppo. */
export function pertinentiPrima<T extends { id: string }>(righe: readonly T[], opportunita: ReadonlyMap<string, OpportunitaRadar>): T[] {
  const a = righe.filter((r) => opportunita.get(r.id)?.tipo === "pertinente");
  const b = righe.filter((r) => opportunita.get(r.id)?.tipo === "correlata");
  return [...a, ...b];
}

/** «Perché compare»: il settore e le sottocategorie del profilo, più il luogo (o la sua mancanza). Mai il nome di un'altra impresa. */
export function motivoPerTe(o: OpportunitaRadar, p: ProfiloRadar, regioniGara: readonly string[]): string {
  const settori = o.settori
    .filter((s) => eSettore(s.settore))
    .map((s) => {
      const settore = s.settore as SettoreRadar;
      const preferite = p.sottocategorie[settore] ?? [];
      const comuni = preferite.length ? s.sottocategorie.filter((x) => preferite.includes(x)) : [];
      const nomi = comuni.map((x) => nomeSottocategoria(settore, x) ?? x);
      return nomi.length ? `${nomeSettore(settore)} › ${nomi.join(", ")}` : nomeSettore(settore);
    });
  const luogo = regioniGara.length === 0 ? "luogo non indicato dalla fonte" : p.regioni.length ? regioniGara.filter((r) => p.regioni.includes(r as IdRegione)).map((r) => nomeRegione(r) ?? r).join(", ") : "";
  const tipo = o.tipo === "correlata" ? "correlata, " : "";
  return `Nel profilo: ${tipo}${settori.join(" · ")}${luogo ? ` · ${luogo}` : ""}`;
}

// ───── indirizzo della pagina «Per te» ─────

type Parametri = Record<string, string | string[] | undefined>;

export function ordinaEPaginaDaParametri(p: Parametri): { ordina: Ordinamento; pagina: number } {
  const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : (v ?? "")).trim();
  const ordina = uno(p.ordina);
  const pagina = /^\d{1,3}$/.test(uno(p.pagina)) ? Number(uno(p.pagina)) : 1;
  return {
    ordina: (ORDINAMENTI as readonly string[]).includes(ordina) ? (ordina as Ordinamento) : "rilevanza",
    pagina: pagina >= 1 && pagina <= PAGINE_MASSIME ? pagina : 1,
  };
}

export function parametriPerTe(ordina: Ordinamento, pagina: number): string {
  const p = new URLSearchParams();
  if (ordina !== "rilevanza") p.set("ordina", ordina);
  if (pagina > 1) p.set("pagina", String(pagina));
  const s = p.toString();
  return s ? `?${s}` : "";
}
