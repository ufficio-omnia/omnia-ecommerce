// Quando due avvisi TED con lo stesso identificativo di procedura (BT-04, «procedure-identifier») sono davvero la STESSA gara.
// Difetto del 25/11/2026 (collaudo TED su fd741e0, documento 59): alcune piattaforme riusano lo stesso BT-04 per gare diverse, anche di enti
// diversi (Unione dei Comuni Montedoro, SUA di Cosenza, Rosolini e Serino, Catania e Maddaloni, Atripalda e Zumpano…), e l'importatore univa
// tutto per BT-04: una gara ne sovrascriveva un'altra con «rettifiche» e «proroghe» false, e l'esito di un'altra gara chiudeva una gara aperta.
// Regola approvata dal coordinamento il 25/11/2026, verificata sui 34 casi dello staging e sui 175 esiti (logica pura, nessuna rete):
//   - riferimento interno dell'ente (BT-22, «internal-identifier-proc»): se è significativo in entrambi e DIVERSO, sono gare diverse; uguale
//     da solo NON basta (la CUC di Salerno usa lo stesso riferimento per due gare diverse);
//   - avviso di modifica DICHIARATO (change-reason-code): stessa gara se è lo stesso ente oppure il titolo è compatibile;
//   - ogni altro avviso, compresi gli esiti: stessa gara se il titolo è compatibile E (stesso ente OPPURE stesso CPV principale). L'ente può
//     cambiare tra bando ed esito quando una centrale di committenza pubblica per conto di un comune (Assisi/Bastia Umbra, Brescia/Nembro);
//   - titolo compatibile: le parole significative del titolo più corto stanno TUTTE nel più lungo (titolo della procedura o di un lotto, in
//     qualunque combinazione), con almeno 3 parole significative; le proroghe e le rettifiche ripubblicate come avvisi nuovi aggiungono parole
//     («AVVISO DI PROROGA DEL TERMINE…» + il titolo di prima) ma non ne tolgono;
//   - nessuna gara compatibile: gara NUOVA con chiave «ted:<BT-04>~<numero del primo avviso>» (deterministica, nessuna migrazione).
import type { RigaProcedura } from "../importa-calcoli";

export type IdentitaTed = {
  // codici fiscali o partite IVA dell'ente (11 cifre, o 16 caratteri), da «organisation-identifier-buyer»
  cf: string[];
  // nome dell'ente («buyer-name»)
  ente: string | null;
  // CPV principale della procedura («main-classification-proc»), solo le 8 cifre
  cpv: string | null;
  // titolo della procedura e dei lotti (al più 6, tagliati)
  titoli: string[];
  // riferimento interno dell'ente (BT-22)
  rif: string | null;
};

const MAX_TITOLI = 6;
const MAX_TITOLO = 600;

// Parole che non distinguono una gara da un'altra: articoli e preposizioni, e le parole comuni a quasi tutti i titoli di gara.
const PAROLE_VUOTE = new Set([
  "del", "della", "dello", "dei", "delle", "degli", "per", "con", "nel", "nella", "nello", "nei", "nelle", "negli", "alla", "alle", "allo", "agli",
  "dal", "dalla", "dalle", "dai", "dagli", "sul", "sulla", "sulle", "sui", "tra", "fra", "che", "the", "and", "for", "with",
  "lotto", "lotti", "servizio", "servizi", "procedura", "aperta", "gara", "affidamento", "appalto",
]);

const RIFERIMENTI_VUOTI = /^(default|n\/?a|n\.?d\.?|nessun[oa]?|non\s+applicabile|-+|0+)$|default_value|generic/i;

export function testoTed(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.trim() || null;
  if (Array.isArray(v)) return testoTed(v[0]);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return testoTed(o.ita ?? o.eng ?? Object.values(o)[0]);
  }
  return null;
}

function testi(v: unknown): string[] {
  if (v === null || v === undefined) return [];
  if (typeof v === "string") return v.trim() ? [v.trim()] : [];
  if (Array.isArray(v)) return v.flatMap(testi);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return testi(o.ita ?? o.eng ?? Object.values(o)[0]);
  }
  return [];
}

/** Codici dell'ente: partite IVA e codici fiscali numerici (11 cifre, anche dentro «IT00146330733 | …») o alfanumerici (16). */
export function codiciEnte(v: unknown): string[] {
  const out = new Set<string>();
  for (const t of testi(v)) {
    const s = t.toUpperCase();
    for (const m of s.matchAll(/(?<![0-9A-Z])(?:IT)?(\d{11})(?![0-9A-Z])/g)) out.add(m[1]);
    for (const m of s.matchAll(/(?<![0-9A-Z])([A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z])(?![0-9A-Z])/g)) out.add(m[1]);
  }
  return [...out].sort();
}

export function nomeNormalizzato(s: string | null | undefined): string {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function paroleSignificative(s: string | null | undefined): Set<string> {
  return new Set(nomeNormalizzato(s).split(" ").filter((w) => w.length >= 3 && !PAROLE_VUOTE.has(w)));
}

/** Il riferimento interno solo se distingue una gara: mai «1», «01», «100 - Generica», «DEFAULT_VALUE_CHANGE_ME»… */
export function riferimentoSignificativo(rif: string | null | undefined): string | null {
  const r = String(rif ?? "").trim();
  if (r.length < 3 || /^\d{1,3}$/.test(r) || RIFERIMENTI_VUOTI.test(r)) return null;
  return r.toUpperCase().replace(/\s+/g, " ");
}

function cpv8(v: unknown): string | null {
  const s = testoTed(v);
  const m = s?.match(/\d{8}/);
  return m ? m[0] : null;
}

/** L'identità di un avviso TED (bando, rettifica o esito) dai campi grezzi dell'API. */
export function identitaDaAvviso(n: Record<string, unknown>): IdentitaTed {
  const titoli = [...testi(n["title-proc"]).slice(0, 1), ...testi(n["title-lot"])]
    .map((t) => t.slice(0, MAX_TITOLO))
    .filter((t, i, a) => a.indexOf(t) === i)
    .slice(0, MAX_TITOLI);
  return {
    cf: codiciEnte(n["organisation-identifier-buyer"]),
    ente: testoTed(n["buyer-name"])?.slice(0, 300) ?? null,
    cpv: cpv8(n["main-classification-proc"]),
    titoli,
    rif: testoTed(n["internal-identifier-proc"])?.slice(0, 200) ?? null,
  };
}

/** L'identità di ripiego di una gara già in archivio senza identità salvate (gare scritte prima di questa regola). */
export function identitaDaRiga(r: Pick<RigaProcedura, "sa_codice_fiscale" | "sa_denominazione" | "cpv_principale" | "oggetto">): IdentitaTed {
  return {
    cf: r.sa_codice_fiscale ? codiciEnte(r.sa_codice_fiscale) : [],
    ente: r.sa_denominazione,
    cpv: cpv8(r.cpv_principale),
    titoli: r.oggetto ? [r.oggetto.slice(0, MAX_TITOLO)] : [],
    rif: null,
  };
}

/** Identità valida letta dal database (colonna «foto» della provenienza TED: { identita_ted: … }), altrimenti null. */
export function identitaValida(x: unknown): IdentitaTed | null {
  const f = x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>).identita_ted : null;
  if (!f || typeof f !== "object" || Array.isArray(f)) return null;
  const o = f as Record<string, unknown>;
  const stringhe = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);
  const testoOpz = (v: unknown) => (typeof v === "string" ? v : null);
  return { cf: stringhe(o.cf), ente: testoOpz(o.ente), cpv: testoOpz(o.cpv), titoli: stringhe(o.titoli), rif: testoOpz(o.rif) };
}

/** true = stesso ente, false = enti diversi, null = non si sa (manca il dato da una parte). */
export function stessoEnte(a: IdentitaTed, b: IdentitaTed): boolean | null {
  if (a.cf.length > 0 && b.cf.length > 0) return a.cf.some((c) => b.cf.includes(c));
  const na = nomeNormalizzato(a.ente);
  const nb = nomeNormalizzato(b.ente);
  if (!na || !nb) return null;
  return na === nb;
}

/** Il titolo più corto (almeno 3 parole significative) sta tutto nel più lungo, per almeno una coppia di titoli. */
export function titoliCompatibili(a: readonly string[], b: readonly string[]): boolean {
  for (const x of a) {
    const px = paroleSignificative(x);
    for (const y of b) {
      const py = paroleSignificative(y);
      const [corto, lungo] = px.size <= py.size ? [px, py] : [py, px];
      if (corto.size < 3) continue;
      if ([...corto].every((w) => lungo.has(w))) return true;
    }
  }
  return false;
}

export function stessaProcedura(nuovo: IdentitaTed, esistente: IdentitaTed, opzioni: { modificaDichiarata: boolean }): boolean {
  const ra = riferimentoSignificativo(nuovo.rif);
  const rb = riferimentoSignificativo(esistente.rif);
  if (ra && rb && ra !== rb) return false;
  const titolo = titoliCompatibili(nuovo.titoli, esistente.titoli);
  const ente = stessoEnte(nuovo, esistente);
  if (opzioni.modificaDichiarata) return ente === true || titolo;
  return titolo && (ente === true || (!!nuovo.cpv && nuovo.cpv === esistente.cpv));
}

export type CandidataTed<T> = { gara: T; identita: readonly IdentitaTed[]; recente: string };

/**
 * La gara a cui appartiene l'avviso, tra quelle con lo stesso BT-04: quella compatibile più recente (una qualunque delle sue identità basta).
 * null = nessuna: l'avviso apre una gara nuova.
 */
export function garaCompatibile<T>(nuovo: IdentitaTed, candidate: readonly CandidataTed<T>[], opzioni: { modificaDichiarata: boolean }): T | null {
  const buone = candidate.filter((c) => c.identita.some((i) => stessaProcedura(nuovo, i, opzioni)));
  if (buone.length === 0) return null;
  return [...buone].sort((a, b) => b.recente.localeCompare(a.recente))[0].gara;
}

/** La chiave di una gara NUOVA con un BT-04 già usato da un'altra gara: «ted:<BT-04>~<numero del primo avviso>». */
export function chiaveSeparata(procedureId: string, numero: string): string {
  return `ted:${procedureId}~${numero}`;
}

/** Il BT-04 di una chiave TED (anche separata), oppure null. */
export function procedureIdDaChiave(chiave: string): string | null {
  const m = chiave.match(/^ted:([^~]+)(?:~\d{1,8}-\d{4})?$/);
  return m ? m[1] : null;
}

/** La riga «foto» della provenienza TED: l'identità dell'avviso (per riconoscere le versioni dopo). */
export function fotoIdentita(i: IdentitaTed): { identita_ted: IdentitaTed } {
  return { identita_ted: i };
}
