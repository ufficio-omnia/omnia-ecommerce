// TED (Tenders Electronic Daily): interrogazioni e lettura degli avvisi restituiti dall'API ufficiale di ricerca
// (POST https://api.ted.europa.eu/v3/notices/search, accesso anonimo documentato). Logica pura: nessuna rete, nessun database.
// Provata da scripts/verifica-radar-ted.ts con avvisi reali (copie anonime dei soli campi pubblici).
//
// Come sono fatti gli avvisi (verificato su richieste reali il 16/11/2026, vedi 02_FONTI_E_SPIKE e allegati/ted):
//   - i campi «-lot» sono array paralleli, uno per lotto; un array più corto del numero dei lotti NON si attribuisce lotto per lotto
//     (gli indici potrebbero essere sfalsati): in quel caso il dato del lotto resta vuoto;
//   - i testi sono in più lingue ({"ita": "..."} oppure {"ita": ["..."]}); gli importi sono stringhe («334750.00»);
//   - date e ore hanno il fuso: «2026-12-14+01:00» e «13:00:00+01:00» (a volte «Z»);
//   - una rettifica o un annullamento è un NUOVO avviso con lo stesso «procedure-identifier» e i dati completi aggiornati
//     (change-reason-code «update-add», «cor-buy», «cancel»…); l'esito è un avviso «can-*» con lo stato del vincitore per lotto.
import { classificaGara, normalizzaCpv, REGOLE_PAROLE, testoPerConfronto, type SettoreRadar } from "../settori";
import { comuneEProvincia, regioneDaNuts, type IdRegione } from "../territorio";
import type { RecordLotto, RecordProcedura } from "./tipi";

export const URL_RICERCA_TED = "https://api.ted.europa.eu/v3/notices/search";
// Nome generico del programma: nessun dato dell'azienda o delle persone nelle richieste.
export const USER_AGENT_TED = "omnia-radar/1.0 (lettura avvisi pubblici)";
// Limite dell'API: 250 avvisi per pagina e al massimo 10.000 campi per pagina (250 × 40).
export const AVVISI_PER_PAGINA = 250;

export const TIPI_BANDO = ["cn-standard", "cn-social", "cn-desg", "pin-cfc-standard", "pin-cfc-social", "qu-sy"] as const;
export const TIPI_ESITO = ["can-standard", "can-social", "can-desg"] as const;

export const CAMPI_BANDO = [
  "publication-number",
  "notice-identifier",
  "notice-version",
  "notice-type",
  "publication-date",
  "procedure-identifier",
  "buyer-name",
  "organisation-identifier-buyer",
  "buyer-city",
  "buyer-country-sub",
  "buyer-legal-type",
  "title-proc",
  "description-proc",
  "title-lot",
  "identifier-lot",
  "main-classification-proc",
  "main-classification-lot",
  "classification-cpv",
  "estimated-value-proc",
  "estimated-value-cur-proc",
  "estimated-value-lot",
  "estimated-value-cur-lot",
  "deadline-receipt-tender-date-lot",
  "deadline-receipt-tender-time-lot",
  "deadline-receipt-request-date-lot",
  "deadline-receipt-request-time-lot",
  "procedure-type",
  "contract-nature-main-proc",
  "legal-basis",
  "document-url-lot",
  "duration-period-value-lot",
  "duration-period-unit-lot",
  "change-reason-code",
  "place-of-performance-subdiv-proc",
  "place-of-performance-subdiv-lot",
  "award-criterion-type-lot",
  "internal-identifier-proc",
] as const;

export const CAMPI_ESITO = ["publication-number", "notice-version", "notice-type", "publication-date", "procedure-identifier", "winner-selection-status", "result-lot-identifier", "change-reason-code"] as const;

// Parole cercate in TED oltre ai CPV (ricerca a testo pieno dell'API). Sono un sovrainsieme largo: la decisione vera la prende
// classificaGara sull'OGGETTO, con le esclusioni approvate. Ogni parola deve far scattare una regola di settori.ts (lo prova il test).
export const PAROLE_TED = [
  "ausiliariato",
  "servizi ausiliari",
  "multiservizi",
  "global service",
  "facility management",
  "servizi integrati",
  "portierato",
  "portineria",
  "guardiania",
  "vigilanza",
  "pulizia",
  "pulizie",
  "sanificazione",
  "disinfestazione",
  "igiene ambientale",
  "mensa",
  "mense",
  "refezione",
  "ristorazione",
  "facchinaggio",
  "trasloco",
  "traslochi",
] as const;

export function parolaTedCoperta(parola: string): boolean {
  const t = testoPerConfronto(parola);
  return REGOLE_PAROLE.some((r) => r.cerca.test(t));
}

// «20261116» dal giorno «2026-11-16».
export function giornoTed(giorno: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(giorno)) throw new Error(`Giorno non valido: ${giorno}`);
  return giorno.replaceAll("-", "");
}

function condizioneSettori(cpv: readonly string[]): string {
  const parole = PAROLE_TED.map((p) => (p.includes(" ") ? `FT~("${p}")` : `FT~(${p})`));
  return `(classification-cpv IN (${cpv.join(" ")}) OR ${parole.join(" OR ")})`;
}

// Gli avvisi italiani dei sei settori pubblicati tra «da» e «a» (giorni inclusi), in ordine di pubblicazione: i più vecchi prima, così una
// rettifica arriva sempre dopo il bando che corregge.
export function queryAvvisi(tipo: "bando" | "esito", cpv: readonly string[], da: string, a: string): string {
  if (cpv.length === 0 || cpv.some((c) => !/^\d{8}$/.test(c))) throw new Error("Elenco dei CPV non valido");
  const tipi = (tipo === "bando" ? TIPI_BANDO : TIPI_ESITO).join(" ");
  return `buyer-country=ITA AND notice-type IN (${tipi}) AND ${condizioneSettori(cpv)} AND publication-date>=${giornoTed(da)} AND publication-date<=${giornoTed(a)} SORT BY publication-number`;
}

export function corpoRichiesta(query: string, campi: readonly string[], pagina: number): Record<string, unknown> {
  if (campi.length * AVVISI_PER_PAGINA > 10_000) throw new Error("Troppi campi per pagina");
  return { query, fields: campi, limit: AVVISI_PER_PAGINA, page: pagina, scope: "ALL", paginationMode: "PAGE_NUMBER", onlyLatestVersions: false };
}

// ───── lettura dei campi ─────

type Avviso = Record<string, unknown>;

function comeArray(v: unknown): unknown[] {
  if (v === null || v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

// Testo nella lingua italiana se c'è, altrimenti il primo disponibile. Le entità HTML numeriche rimaste nei titoli si decodificano.
export function testoTed(v: unknown, indice = 0): string | null {
  let valore: unknown = v;
  if (valore && typeof valore === "object" && !Array.isArray(valore)) {
    const o = valore as Record<string, unknown>;
    const chiave = ["ita", "mul", "eng"].find((k) => o[k] !== undefined) ?? Object.keys(o)[0];
    valore = chiave ? o[chiave] : null;
  }
  const scelto = Array.isArray(valore) ? valore[indice] : indice === 0 ? valore : undefined;
  if (typeof scelto !== "string") return null;
  const pulito = scelto
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return pulito || null;
}

function stringhe(v: unknown): string[] {
  return comeArray(v).filter((x): x is string => typeof x === "string").map((x) => x.trim());
}

export function importoTed(v: unknown): number | null {
  const s = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim()) : NaN;
  if (!Number.isFinite(s) || s < 0 || s >= 1e14) return null;
  return Math.round(s * 100) / 100;
}

// «2026-12-14+01:00» → «2026-12-14».
export function dataTed(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

// Il giorno di calendario di Roma di un istante («2026-12-14»).
export function giornoDiRoma(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

// giorno: sempre, quando la fonte lo indica. iso: l'istante esatto SOLO con l'ora indicata (regola del progetto: l'ora non si presume mai;
// senza ora la gara è aperta per tutto il suo giorno). «fonte» conserva il testo originale, da mostrare se il fuso non è quello italiano.
export type ScadenzaTed = { giorno: string; iso: string | null; oraIndicata: boolean; fonte: string };

export function scadenzaTed(giorno: unknown, ora: unknown): ScadenzaTed | null {
  const g = typeof giorno === "string" ? giorno.trim() : "";
  const d = dataTed(g);
  if (!d) return null;
  const o = typeof ora === "string" ? ora.trim() : "";
  const m = o.match(/^(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?$/);
  if (!m) return { giorno: d, iso: null, oraIndicata: false, fonte: g };
  const fuso = m[4] ?? (g.match(/(Z|[+-]\d{2}:\d{2})$/)?.[1] ?? "+01:00");
  const istante = new Date(`${d}T${m[1]}:${m[2]}:${m[3] ?? "00"}${fuso}`);
  if (Number.isNaN(istante.getTime())) return { giorno: d, iso: null, oraIndicata: false, fonte: g };
  // con l'ora, il giorno è quello italiano dell'istante (un'ora in UTC a tarda sera può cadere nel giorno dopo a Roma)
  return { giorno: giornoDiRoma(istante), iso: istante.toISOString(), oraIndicata: true, fonte: `${g} ${o}` };
}

// Ordine delle scadenze: prima il giorno, poi l'ora (a parità di giorno, quella con l'ora viene prima di quella senza).
export function confrontaScadenze(a: Pick<ScadenzaTed, "giorno" | "iso">, b: Pick<ScadenzaTed, "giorno" | "iso">): number {
  return a.giorno !== b.giorno ? a.giorno.localeCompare(b.giorno) : (a.iso ?? "~").localeCompare(b.iso ?? "~");
}

// Il fuso della scadenza scritta dalla fonte è quello italiano? Se no (es. «Z»), l'interfaccia mostra anche il testo originale.
export function fusoItaliano(fonte: string | null | undefined): boolean {
  if (!fonte) return true;
  const fusi = fonte.match(/(Z|[+-]\d{2}:\d{2})/g) ?? [];
  return fusi.every((f) => f === "+01:00" || f === "+02:00");
}

const UNITA_MESI: Record<string, number> = { MONTH: 1, YEAR: 12 };

export function durataMesi(valore: unknown, unita: unknown): number | null {
  const n = importoTed(valore);
  const u = typeof unita === "string" ? UNITA_MESI[unita.trim().toUpperCase()] : undefined;
  if (n === null || !u) return null;
  const mesi = n * u;
  return Number.isInteger(mesi) && mesi > 0 && mesi <= 600 ? mesi : null;
}

const TIPI_PROCEDURA: Record<string, string> = {
  open: "Procedura aperta",
  restricted: "Procedura ristretta",
  "neg-w-call": "Procedura competitiva con negoziazione",
  "neg-wo-call": "Procedura negoziata senza pubblicazione",
  "comp-dial": "Dialogo competitivo",
  innovation: "Partenariato per l'innovazione",
  "oth-single": "Altra procedura a una fase",
  "oth-mult": "Altra procedura a più fasi",
};

export function tipoProceduraTed(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? (TIPI_PROCEDURA[s] ?? null) : null;
}

export function naturaTed(v: unknown): RecordProcedura["natura"] {
  const s = (stringhe(v)[0] ?? "").toLowerCase();
  if (s === "services") return "servizi";
  if (s === "supplies") return "forniture";
  if (s === "works") return "lavori";
  if (s === "combined" || s === "mixed") return "misto";
  return null;
}

export function settoriSpecialiTed(legalBasis: unknown): boolean | null {
  const basi = stringhe(legalBasis);
  if (basi.includes("32014L0025")) return true;
  if (basi.includes("32014L0024") || basi.includes("32014L0023")) return false;
  return null;
}

const ENTI_CENTRALI = new Set(["cga", "body-pl-cga", "pub-undert-cga"]);

export function tipoEnteTed(legalBasis: unknown, buyerLegalType: unknown): "centrale" | "sub_centrale" | "settori_speciali" {
  if (settoriSpecialiTed(legalBasis) === true) return "settori_speciali";
  return stringhe(buyerLegalType).some((t) => ENTI_CENTRALI.has(t)) ? "centrale" : "sub_centrale";
}

// Criterio di aggiudicazione dai tipi di criterio dichiarati: solo prezzo → minor prezzo; qualità o costo → offerta economicamente più
// vantaggiosa. Senza criteri dichiarati: non indicato.
export function criterioTed(v: unknown): string | null {
  const tipi = new Set(stringhe(v).map((s) => s.toLowerCase()));
  if (tipi.size === 0) return null;
  if ([...tipi].every((t) => t === "price")) return "Minor prezzo";
  if (tipi.has("quality") || tipi.has("cost")) return "Offerta economicamente più vantaggiosa";
  return null;
}

function urlSicuro(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (!/^https?:\/\//i.test(s) || s.length > 2000) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function codiceFiscaleEnte(v: unknown): string | null {
  const s = (stringhe(v)[0] ?? "").replace(/\s+/g, "").toUpperCase().replace(/^IT(?=\d{11}$)/, "");
  return /^[0-9A-Z]{11,16}$/.test(s) ? s : null;
}

// CIG scritti con l'etichetta «CIG» nei testi liberi (nei bandi TED quasi mai: 0,3% nello studio). Formato: 10 caratteri alfanumerici.
export function cigEtichettati(...testi: (string | null | undefined)[]): string[] {
  const trovati = new Set<string>();
  for (const t of testi) {
    for (const m of (t ?? "").toUpperCase().matchAll(/\bC\.?I\.?G\.?\s*(?:N\.?|N°|NUM\.?)?\s*[:.]?\s*([0-9A-Z]{10})\b/g)) {
      if (/\d/.test(m[1]) && /[A-Z]/.test(m[1])) trovati.add(m[1]);
    }
  }
  return [...trovati];
}

// Impronta stabile di un oggetto (FNV-1a a 64 bit su JSON con chiavi ordinate): due letture uguali danno la stessa impronta.
export function impronta(valore: unknown): string {
  const ordina = (x: unknown): unknown =>
    Array.isArray(x) ? x.map(ordina) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x as object).sort().map((k) => [k, ordina((x as Record<string, unknown>)[k])])) : x;
  const testo = JSON.stringify(ordina(valore));
  let h = BigInt("0xcbf29ce484222325");
  const primo = BigInt("0x100000001b3");
  const maschera = (BigInt(1) << BigInt(64)) - BigInt(1);
  for (const byte of new TextEncoder().encode(testo)) {
    h ^= BigInt(byte);
    h = (h * primo) & maschera;
  }
  return h.toString(16).padStart(16, "0");
}

// Il numero di pubblicazione «787530-2026» in forma confrontabile (anno, numero).
export function ordinePubblicazione(numero: string): [number, number] | null {
  const m = numero.trim().match(/^(\d{1,8})-(\d{4})$/);
  return m ? [Number(m[2]), Number(m[1])] : null;
}

export type MetaAvviso = {
  numero: string;
  data: string;
  versione: number | null;
  tipo: string;
  motivoModifica: string | null;
  procedureId: string;
};

function metaAvviso(n: Avviso): MetaAvviso | null {
  const numero = typeof n["publication-number"] === "string" ? n["publication-number"].trim() : "";
  const data = dataTed(n["publication-date"]);
  const procedureId = typeof n["procedure-identifier"] === "string" ? n["procedure-identifier"].trim() : "";
  if (!ordinePubblicazione(numero) || !data || !/^[0-9A-Za-z._:-]{3,120}$/.test(procedureId)) return null;
  const versione = typeof n["notice-version"] === "number" ? n["notice-version"] : Number(n["notice-version"]);
  return {
    numero,
    data,
    versione: Number.isInteger(versione) ? versione : null,
    tipo: typeof n["notice-type"] === "string" ? n["notice-type"] : "",
    motivoModifica: stringhe(n["change-reason-code"])[0] ?? null,
    procedureId,
  };
}

export function chiaveProceduraTed(procedureId: string): string {
  return `ted:${procedureId}`;
}

export function urlAvvisoTed(numero: string): string {
  return `https://ted.europa.eu/it/notice/-/detail/${numero}`;
}

export type BandoTed = {
  meta: MetaAvviso;
  record: RecordProcedura;
  settori: SettoreRadar[];
  metodoSettore: "cpv" | "parole_chiave";
  regioni: IdRegione[];
  enteTipo: string | null;
  scadenzaFonte: string | null;
  lottiScadenze: (ScadenzaTed | null)[];
  lottiDocumenti: (string | null)[];
};

export type EsclusioneTed = { meta: MetaAvviso | null; motivo: "avviso_malformato" | "fuori_settore" | "senza_oggetto" };

// Un avviso di gara (bando, rettifica o annullamento) → record normalizzato, oppure il motivo per cui non entra nell'archivio.
export function leggiBandoTed(n: Avviso): BandoTed | EsclusioneTed {
  const meta = metaAvviso(n);
  if (!meta) return { meta: null, motivo: "avviso_malformato" };

  const titolo = testoTed(n["title-proc"]) ?? testoTed(n["title-lot"]);
  if (!titolo) return { meta, motivo: "senza_oggetto" };
  const descrizione = testoTed(n["description-proc"]);

  const idLotti = stringhe(n["identifier-lot"]);
  const nLotti = idLotti.length;
  // attribuzione per lotto solo se l'array ha esattamente un valore per lotto
  const perLotto = <T>(v: unknown, f: (x: unknown, i: number) => T): (T | null)[] => {
    const arr = comeArray(v);
    return idLotti.map((_, i) => (arr.length === nLotti ? f(arr[i], i) : null));
  };

  const cpvPrincipale = normalizzaCpv(stringhe(n["main-classification-proc"])[0]);
  const cpvTutti = [...new Set(stringhe(n["classification-cpv"]).map(normalizzaCpv).filter((c): c is string => !!c))];
  const titoliLotti = idLotti.map((_, i) => {
    const t = n["title-lot"];
    const arr = t && typeof t === "object" && !Array.isArray(t) ? comeArray((t as Record<string, unknown>).ita ?? Object.values(t as Record<string, unknown>)[0]) : [];
    return arr.length === nLotti ? testoTed(t, i) : null;
  });

  const cpvLotti = perLotto(n["main-classification-lot"], (x) => normalizzaCpv(typeof x === "string" ? x : null));

  // Settore: CPV del file approvato su qualunque CPV; parole chiave solo sull'oggetto (procedura e lotti), mai sulla descrizione. I lotti
  // (titolo e CPV di ciascuno) servono solo a riconoscere un servizio AUTONOMO (lotto dedicato): cambiano il livello, mai i settori.
  const testoOggetto = [titolo, ...titoliLotti].filter(Boolean).join(" ");
  const classificazione = classificaGara({ cpvPrincipale, cpvTutti, testo: testoOggetto, lotti: idLotti.map((_, i) => ({ testo: titoliLotti[i], cpv: [cpvLotti[i]] })) });
  const natura = naturaTed(n["contract-nature-main-proc"]);
  if (classificazione.settori.length === 0) return { meta, motivo: "fuori_settore" };
  // trovata solo per parola chiave: deve essere un servizio (o natura non dichiarata), per non prendere lavori e forniture che «puliscono»
  if (classificazione.metodo === "parole_chiave" && natura !== null && natura !== "servizi" && natura !== "misto") return { meta, motivo: "fuori_settore" };

  const valoreProcEur = String(n["estimated-value-cur-proc"] ?? "EUR").toUpperCase() === "EUR";
  const valoriLotti = perLotto(n["estimated-value-lot"], (x) => importoTed(x));
  const valutaLotti = perLotto(n["estimated-value-cur-lot"], (x) => String(x ?? "").toUpperCase());
  const valoriLottiEur = valoriLotti.map((v, i) => (v !== null && (valutaLotti[i] ?? "EUR") === "EUR" ? v : null));
  let valoreStimato = valoreProcEur ? importoTed(n["estimated-value-proc"]) : null;
  if (valoreStimato === null && nLotti > 0 && valoriLottiEur.every((v) => v !== null)) {
    valoreStimato = Math.round(valoriLottiEur.reduce((s, v) => s + (v as number), 0) * 100) / 100;
  }

  const scadenzeOfferta = perLotto(n["deadline-receipt-tender-date-lot"], (x, i) => scadenzaTed(x, comeArray(n["deadline-receipt-tender-time-lot"])[i]));
  const scadenzeDomanda = perLotto(n["deadline-receipt-request-date-lot"], (x, i) => scadenzaTed(x, comeArray(n["deadline-receipt-request-time-lot"])[i]));
  // procedura a un solo lotto con array «sfalsato» assente: si legge comunque il primo valore (non c'è ambiguità)
  const singola = (campoData: string, campoOra: string) => (nLotti <= 1 ? scadenzaTed(comeArray(n[campoData])[0], comeArray(n[campoOra])[0]) : null);
  const lottiScadenze = idLotti.map((_, i) => scadenzeOfferta[i] ?? scadenzeDomanda[i] ?? (nLotti === 1 ? (singola("deadline-receipt-tender-date-lot", "deadline-receipt-tender-time-lot") ?? singola("deadline-receipt-request-date-lot", "deadline-receipt-request-time-lot")) : null));
  const scadenzaProc =
    lottiScadenze.filter((s): s is ScadenzaTed => !!s).sort(confrontaScadenze)[0] ??
    singola("deadline-receipt-tender-date-lot", "deadline-receipt-tender-time-lot") ??
    singola("deadline-receipt-request-date-lot", "deadline-receipt-request-time-lot") ??
    // più lotti con array sfalsati: la scadenza più vicina tra quelle dichiarate (la gara si chiude per il primo lotto che scade)
    (comeArray(n["deadline-receipt-tender-date-lot"]).length > 0
      ? comeArray(n["deadline-receipt-tender-date-lot"])
          .map((x) => scadenzaTed(x, null))
          .filter((s): s is ScadenzaTed => !!s)
          .sort(confrontaScadenze)[0] ?? null
      : null);

  const durateLotti = idLotti.map((_, i) => {
    const v = comeArray(n["duration-period-value-lot"]);
    const u = comeArray(n["duration-period-unit-lot"]);
    return v.length === nLotti && u.length === nLotti ? durataMesi(v[i], u[i]) : null;
  });
  const durateNote = durateLotti.filter((d): d is number => d !== null);
  const durataProc = durateNote.length > 0 && durateNote.length === nLotti && durateNote.every((d) => d === durateNote[0]) ? durateNote[0] : null;

  const documentiLotti = perLotto(n["document-url-lot"], (x) => urlSicuro(x));
  const urlDocumenti = documentiLotti.find((u) => !!u) ?? urlSicuro(comeArray(n["document-url-lot"])[0]);

  // CIG: solo se un'unica gara a un lotto riporta un unico CIG con l'etichetta (mai attribuito a caso tra più lotti)
  const cig = cigEtichettati(titolo, ...stringhe(n["internal-identifier-proc"]));
  const lotti: RecordLotto[] = idLotti.map((numero, i) => ({
    cig: nLotti === 1 && cig.length === 1 ? cig[0] : null,
    numero,
    oggetto: titoliLotti[i],
    cpvPrincipale: cpvLotti[i] ?? null,
    cpvTutti: cpvLotti[i] ? [cpvLotti[i] as string] : [],
    valoreStimato: valoriLottiEur[i] ?? null,
    valoreBase: null,
    oneriSicurezza: null,
    durataMesi: durateLotti[i],
    opzioniRinnovi: null,
  }));

  const regioniLuogo = [...stringhe(n["place-of-performance-subdiv-proc"]), ...stringhe(n["place-of-performance-subdiv-lot"])].map(regioneDaNuts).filter((r): r is IdRegione => !!r);
  const regioneEnte = regioneDaNuts(stringhe(n["buyer-country-sub"])[0]);
  const regioni = [...new Set(regioniLuogo.length > 0 ? regioniLuogo : regioneEnte ? [regioneEnte] : [])];
  const { comune, provincia } = comuneEProvincia(testoTed(n["buyer-city"]));
  const nuts = stringhe(n["place-of-performance-subdiv-proc"])[0] ?? stringhe(n["buyer-country-sub"])[0] ?? null;

  const record: RecordProcedura = {
    fonte: "ted",
    idFonte: meta.numero,
    chiaveProcedura: chiaveProceduraTed(meta.procedureId),
    oggetto: titolo.slice(0, 4000),
    descrizione: descrizione && descrizione !== titolo ? descrizione.slice(0, 20000) : null,
    ente: {
      codiceFiscale: codiceFiscaleEnte(n["organisation-identifier-buyer"]),
      denominazione: testoTed(n["buyer-name"])?.slice(0, 500) ?? null,
      comune,
      provincia,
      regione: regioneEnte,
      luogoIstat: null,
      nuts: nuts && /^IT[A-Z0-9]{1,3}$/.test(nuts) ? nuts : null,
    },
    tipoAvviso: meta.tipo || null,
    tipoProcedura: tipoProceduraTed(n["procedure-type"]),
    criterioAggiudicazione: criterioTed(n["award-criterion-type-lot"]),
    natura,
    settoriSpeciali: settoriSpecialiTed(n["legal-basis"]),
    dataPubblicazione: meta.data,
    scadenzaGiorno: scadenzaProc?.giorno ?? null,
    scadenzaOfferte: scadenzaProc?.iso ?? null,
    scadenzaOraIndicata: scadenzaProc?.oraIndicata ?? false,
    valoreStimato,
    valoreBase: null,
    oneriSicurezza: null,
    durataMesi: durataProc,
    annullata: meta.motivoModifica === "cancel",
    urlAvviso: urlAvvisoTed(meta.numero),
    urlDocumenti,
    cpvPrincipale,
    cpvTutti,
    lotti,
    impronta: "",
  };
  record.impronta = impronta({ ...record, impronta: null, settori: classificazione.settori });

  return {
    meta,
    record,
    settori: classificazione.settori,
    metodoSettore: classificazione.metodo ?? "cpv",
    regioni,
    enteTipo: stringhe(n["buyer-legal-type"])[0] ?? null,
    scadenzaFonte: scadenzaProc?.fonte ?? null,
    lottiScadenze,
    lottiDocumenti: documentiLotti,
  };
}

export function eEsclusione(x: BandoTed | EsclusioneTed): x is EsclusioneTed {
  return "motivo" in x;
}

export type EsitoTed = { meta: MetaAvviso; stato: "aggiudicata" | "chiusa_senza_aggiudicazione" | null; lotti: number };

// Avviso di esito: «selec-w» su almeno un lotto = aggiudicata; tutti i lotti «clos» = chiusa senza aggiudicazione; altrimenti (per esempio
// «open-nw», ancora aperta) lo stato non cambia.
export function leggiEsitoTed(n: Avviso): EsitoTed | null {
  const meta = metaAvviso(n);
  if (!meta) return null;
  const stati = stringhe(n["winner-selection-status"]).map((s) => s.toLowerCase());
  let stato: EsitoTed["stato"] = null;
  if (stati.includes("selec-w")) stato = "aggiudicata";
  else if (stati.length > 0 && stati.every((s) => s === "clos")) stato = "chiusa_senza_aggiudicazione";
  return { meta, stato, lotti: stati.length };
}
