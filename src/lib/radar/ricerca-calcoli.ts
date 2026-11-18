// Ricerca delle gare del Radar: filtri dall'indirizzo della pagina, domanda testuale con i sinonimi, rilevanza spiegabile. Logica pura,
// provata da scripts/verifica-radar-b1.ts. Nessuna chiamata a un modello: tutto è deterministico e si legge nei motivi.
import { SETTORI_RADAR, testoPerConfronto, type SettoreRadar } from "./settori";
import { isRegione, type IdRegione } from "./territorio";
import { espandiDomanda, type Espansione } from "./sinonimi";
import { giorniAllaScadenza } from "./sintesi-calcoli";

export const RISULTATI_PER_PAGINA = 25;
// Tetto dei candidati letti dal database per una ricerca: oltre si chiede di restringere i filtri (nessun conteggio esatto costoso).
export const CANDIDATI_MASSIMI = 500;
export const PAGINE_MASSIME = Math.ceil(CANDIDATI_MASSIMI / RISULTATI_PER_PAGINA);

export const ORDINAMENTI = ["rilevanza", "recenti", "scadenza", "importo"] as const;
export type Ordinamento = (typeof ORDINAMENTI)[number];

export const STATI_RICERCA = ["aperte", "storico", "tutte"] as const;
export type StatoRicerca = (typeof STATI_RICERCA)[number];

export const PROCEDURE_RICERCA = [
  { id: "aperta", etichetta: "Procedura aperta", valori: ["Procedura aperta"] },
  { id: "ristretta", etichetta: "Procedura ristretta", valori: ["Procedura ristretta"] },
  { id: "negoziata", etichetta: "Negoziata o competitiva con negoziazione", valori: ["Procedura competitiva con negoziazione", "Procedura negoziata senza pubblicazione"] },
  { id: "altra", etichetta: "Altre procedure", valori: ["Dialogo competitivo", "Partenariato per l'innovazione", "Altra procedura a una fase", "Altra procedura a più fasi"] },
] as const;
export type ProceduraRicerca = (typeof PROCEDURE_RICERCA)[number]["id"];

export const SCADENZE_RAPIDE = [7, 15, 30] as const;

export type FiltriRicerca = {
  q: string;
  settori: SettoreRadar[];
  regioni: IdRegione[];
  importoMin: number | null;
  importoMax: number | null;
  scadenzaEntroGiorni: number | null;
  pubblicataNegliUltimiGiorni: number | null;
  procedure: ProceduraRicerca[];
  stato: StatoRicerca;
  ordina: Ordinamento;
  pagina: number;
};

type Parametri = Record<string, string | string[] | undefined>;

function lista(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  return (Array.isArray(v) ? v : [v]).flatMap((x) => x.split(",")).map((x) => x.trim()).filter(Boolean);
}

function uno(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v ?? "").trim();
}

function importo(v: string): number | null {
  const t = v.replace(/[.\s€]/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n < 1e12 ? n : null;
}

function interoTra(v: string, min: number, max: number): number | null {
  if (!/^\d{1,4}$/.test(v)) return null;
  const n = Number(v);
  return n >= min && n <= max ? n : null;
}

// I filtri arrivano dall'indirizzo: tutto ciò che non è valido si ignora (mai un errore per un parametro scritto male).
export function filtriDaParametri(p: Parametri): FiltriRicerca {
  const idSettori = new Set<string>(SETTORI_RADAR.map((s) => s.id));
  const idProcedure = new Set<string>(PROCEDURE_RICERCA.map((x) => x.id));
  const ordina = uno(p.ordina) as Ordinamento;
  const stato = uno(p.stato) as StatoRicerca;
  return {
    q: uno(p.q).replace(/\s+/g, " ").slice(0, 120),
    settori: [...new Set(lista(p.settore).filter((s) => idSettori.has(s)))] as SettoreRadar[],
    regioni: [...new Set(lista(p.regione).filter(isRegione))],
    importoMin: importo(uno(p.min)),
    importoMax: importo(uno(p.max)),
    scadenzaEntroGiorni: interoTra(uno(p.scadenza), 1, 365),
    pubblicataNegliUltimiGiorni: interoTra(uno(p.pubblicata), 1, 400),
    procedure: [...new Set(lista(p.procedura).filter((x) => idProcedure.has(x)))] as ProceduraRicerca[],
    stato: (STATI_RICERCA as readonly string[]).includes(stato) ? stato : "aperte",
    ordina: (ORDINAMENTI as readonly string[]).includes(ordina) ? ordina : "rilevanza",
    pagina: interoTra(uno(p.pagina), 1, PAGINE_MASSIME) ?? 1,
  };
}

// L'indirizzo che riproduce i filtri (per «filtri attivi» rimovibili, ordinamento, pagina): solo i valori diversi dai predefiniti.
export function parametriDaFiltri(f: FiltriRicerca, modifiche: Partial<FiltriRicerca> = {}): string {
  const x = { ...f, ...modifiche };
  const p = new URLSearchParams();
  if (x.q) p.set("q", x.q);
  for (const s of x.settori) p.append("settore", s);
  for (const r of x.regioni) p.append("regione", r);
  if (x.importoMin !== null) p.set("min", String(x.importoMin));
  if (x.importoMax !== null) p.set("max", String(x.importoMax));
  if (x.scadenzaEntroGiorni !== null) p.set("scadenza", String(x.scadenzaEntroGiorni));
  if (x.pubblicataNegliUltimiGiorni !== null) p.set("pubblicata", String(x.pubblicataNegliUltimiGiorni));
  for (const pr of x.procedure) p.append("procedura", pr);
  if (x.stato !== "aperte") p.set("stato", x.stato);
  if (x.ordina !== "rilevanza") p.set("ordina", x.ordina);
  if (x.pagina > 1) p.set("pagina", String(x.pagina));
  const s = p.toString();
  return s ? `?${s}` : "";
}

// Le condizioni sul database per «aperte» e «storico», con la regola del giorno (una gara senza ora è aperta per tutto il suo giorno; un giorno
// già finito è scaduto). oggi = giorno di Roma (AAAA-MM-GG), adesso = istante ISO. Sintassi dei filtri «or» di PostgREST.
export function condizioneAperte(oggi: string, adesso: string): string {
  return `scadenza_giorno.is.null,scadenza_giorno.gt.${oggi},and(scadenza_giorno.eq.${oggi},or(scadenza_offerte.is.null,scadenza_offerte.gt.${adesso}))`;
}

export function condizioneStorico(oggi: string, adesso: string): string {
  return `stato.neq.aperta,scadenza_giorno.lt.${oggi},and(scadenza_giorno.eq.${oggi},scadenza_offerte.lte.${adesso})`;
}

export function filtriAttivi(f: FiltriRicerca): number {
  return f.settori.length + f.regioni.length + (f.importoMin !== null ? 1 : 0) + (f.importoMax !== null ? 1 : 0) + (f.scadenzaEntroGiorni !== null ? 1 : 0) + (f.pubblicataNegliUltimiGiorni !== null ? 1 : 0) + f.procedure.length + (f.stato !== "aperte" ? 1 : 0);
}

// ───── domanda testuale ─────

const PAROLE_VUOTE = new Set(
  "a ad al alla alle agli ai all anche che chi con da dal dalla dalle dei degli del della delle dello di e ed gli i il in la le lo nel nella nelle nei negli o per su sul sulla tra fra un una uno servizio servizi gara gare appalto appalti affidamento procedura".split(" "),
);

export type DomandaAnalizzata = {
  // CIG esatto (10 caratteri, almeno una cifra e una lettera)
  cig: string | null;
  // codice fiscale o partita IVA dell'ente (11 cifre)
  codiceFiscale: string | null;
  parole: string[];
  espansioni: Espansione[];
  // per to_tsquery con dizionario italiano: «(pulizia | sanificazione | igiene & ambientale) & scuole»
  tsquery: string | null;
};

function solo(t: string): string {
  return testoPerConfronto(t).replace(/[^a-z0-9 ]/g, "");
}

export function analizzaDomanda(q: string): DomandaAnalizzata {
  const grezza = q.trim();
  const maiuscola = grezza.toUpperCase().replace(/\s+/g, "");
  if (/^[0-9A-Z]{10}$/.test(maiuscola) && /\d/.test(maiuscola) && /[A-Z]/.test(maiuscola)) return { cig: maiuscola, codiceFiscale: null, parole: [], espansioni: [], tsquery: null };
  if (/^\d{11}$/.test(maiuscola)) return { cig: null, codiceFiscale: maiuscola, parole: [], espansioni: [], tsquery: null };

  const parole = [...new Set(solo(grezza).split(" ").filter((p) => p.length >= 2 && !PAROLE_VUOTE.has(p)))].slice(0, 8);
  if (parole.length === 0) return { cig: null, codiceFiscale: null, parole: [], espansioni: [], tsquery: null };
  const espansioni = espandiDomanda(parole);

  const termineTs = (t: string) => solo(t).split(" ").filter((p) => p && !PAROLE_VUOTE.has(p)).join(" & ");
  const gruppiUsati = new Set<string>();
  const pezzi: string[] = [];
  for (const p of parole) {
    const gruppo = espansioni.find((e) => testoPerConfronto(e.parolaUtente).split(" ").some((w) => w.slice(0, 5) === p.slice(0, 5)));
    if (gruppo) {
      if (gruppiUsati.has(gruppo.settore)) continue;
      gruppiUsati.add(gruppo.settore);
      const alternative = [p, ...gruppo.aggiunti.map((t) => termineTs(t.termine))].filter(Boolean).map((a) => (a.includes("&") ? `(${a})` : a));
      pezzi.push(`(${[...new Set(alternative)].join(" | ")})`);
    } else {
      pezzi.push(p);
    }
  }
  return { cig: null, codiceFiscale: null, parole, espansioni, tsquery: pezzi.join(" & ") };
}

// ───── rilevanza spiegabile ─────

export type CandidatoRicerca = {
  id: string;
  oggetto: string;
  oggetto_breve: string | null;
  sa_denominazione: string | null;
  settori: string[];
  metodo_settore: string | null;
  scadenza_giorno: string | null;
  scadenza_offerte: string | null;
  data_pubblicazione: string | null;
  valore_stimato: number | null;
  rettificata: boolean;
  // fase B2b (pacchetto 16, punto 7), solo con le classificazioni accese: lo stato della classificazione e la rilevanza per settore
  // (A pertinente, B correlata, C non pertinente). Assente = come prima (settori e metodo della colonna).
  rilevanza?: RilevanzaRicerca | null;
};

export type RilevanzaRicerca = { stato: "classificata" | "in_attesa" | "fallita"; perSettore: Partial<Record<string, "A" | "B" | "C">> };

// I livelli dei settori che contano per questa ricerca (quelli scelti nei filtri, o tutti). Solo per una gara CLASSIFICATA.
function livelliCercati(c: CandidatoRicerca, filtri: Pick<FiltriRicerca, "settori">): ("A" | "B" | "C")[] | null {
  const r = c.rilevanza;
  if (!r || r.stato !== "classificata") return null;
  const settori = filtri.settori.length ? filtri.settori : Object.keys(r.perSettore);
  return settori.map((s) => r.perSettore[s]).filter((l): l is "A" | "B" | "C" => !!l);
}

/**
 * L'etichetta della rilevanza nella riga del risultato: le correlate (B) NON valgono come le pertinenti (A). Solo con la classificazione:
 * A → nessuna etichetta; solo B → «Correlata…»; solo C (gara classificata fuori dai settori) → «Fuori dai settori monitorati»; classificazione
 * fallita → «Classificazione da verificare». In attesa o senza classificazione → nessuna etichetta (mai «non pertinente»).
 */
export function etichettaRicerca(c: CandidatoRicerca, filtri: Pick<FiltriRicerca, "settori">): string | null {
  if (c.rilevanza?.stato === "fallita") return "Classificazione da verificare";
  const l = livelliCercati(c, filtri);
  if (!l || l.length === 0 || l.includes("A")) return null;
  if (l.includes("B")) return "Correlata: appalto misto o servizio accessorio";
  return "Fuori dai settori monitorati";
}

// Fascia per l'ordinamento «per rilevanza»: le gare correlate (B) e quelle fuori dai settori (C) vengono DOPO le pertinenti e quelle non
// ancora classificate (che restano come prima).
export function fasciaRilevanza(c: CandidatoRicerca, filtri: Pick<FiltriRicerca, "settori">): number {
  const l = livelliCercati(c, filtri);
  if (!l || l.length === 0 || l.includes("A")) return 0;
  return l.includes("B") ? 1 : 2;
}

export type Punteggio = { punti: number; motivi: string[] };

// Corrispondenza del testo (oggetto più dell'ente), settore riconosciuto dal CPV o solo per parola chiave, tempo utile per preparare l'offerta,
// novità. Ogni componente diventa un motivo leggibile.
export function punteggioRilevanza(c: CandidatoRicerca, domanda: DomandaAnalizzata, filtri: Pick<FiltriRicerca, "settori">, adesso: Date): Punteggio {
  let punti = 0;
  const motivi: string[] = [];
  const oggetto = testoPerConfronto(`${c.oggetto} ${c.oggetto_breve ?? ""}`);
  const ente = testoPerConfronto(c.sa_denominazione);
  const presente = (testo: string, parola: string) => testo.split(" ").some((w) => w.startsWith(parola.length > 5 ? parola.slice(0, 5) : parola));

  if (domanda.parole.length > 0) {
    const nellOggetto = domanda.parole.filter((p) => presente(oggetto, p));
    const nellEnte = domanda.parole.filter((p) => !nellOggetto.includes(p) && presente(ente, p));
    if (nellOggetto.length) {
      punti += 30 * (nellOggetto.length / domanda.parole.length);
      motivi.push(`«${nellOggetto.join("», «")}» nell'oggetto`);
    }
    if (nellEnte.length) {
      punti += 8;
      motivi.push(`«${nellEnte.join("», «")}» nel nome dell'ente`);
    }
    const sinonimi = domanda.espansioni.flatMap((e) => e.aggiunti).filter((t) => testoPerConfronto(t.termine).split(" ").every((w) => presente(oggetto, w)));
    if (!nellOggetto.length && sinonimi.length) {
      punti += 15;
      motivi.push(`sinonimo nell'oggetto: «${sinonimi[0].termine}»`);
    }
  }

  const settoriCercati = filtri.settori.length > 0 ? c.settori.filter((s) => filtri.settori.includes(s as SettoreRadar)) : c.settori;
  const livelli = livelliCercati(c, filtri);
  if (livelli) {
    // gara classificata (0121): decide la rilevanza, non il metodo; le correlate valgono meno delle pertinenti
    if (livelli.includes("A")) {
      punti += 10;
      motivi.push("pertinente al settore");
    } else if (livelli.includes("B")) {
      punti += 3;
      motivi.push("correlata al settore (appalto misto o servizio accessorio)");
    }
  } else if (settoriCercati.length > 0) {
    if (c.metodo_settore === "cpv") {
      punti += 10;
      motivi.push("settore riconosciuto dal CPV");
    } else {
      punti += 3;
      motivi.push("settore trovato per parola chiave");
    }
  }

  const giorni = giorniAllaScadenza(c.scadenza_giorno, adesso);
  if (giorni !== null) {
    if (giorni < 0) punti -= 40;
    else if (giorni === 0) motivi.push("scade oggi");
    else if (giorni >= 10) {
      punti += 10;
      motivi.push(`${giorni} giorni per preparare l'offerta`);
    } else if (giorni >= 5) {
      punti += 5;
      motivi.push(`${giorni} giorni alla scadenza`);
    } else motivi.push(giorni === 1 ? "scade domani" : `scade tra ${giorni} giorni`);
  }

  if (c.data_pubblicazione) {
    const giorniDaPubblicazione = Math.floor((adesso.getTime() - Date.parse(`${c.data_pubblicazione}T12:00:00Z`)) / 86_400_000);
    if (giorniDaPubblicazione >= 0 && giorniDaPubblicazione <= 7) {
      punti += 5;
      motivi.push("pubblicata negli ultimi 7 giorni");
    }
  }
  return { punti: Math.round(punti * 10) / 10, motivi };
}

export function ordinaCandidati<T extends CandidatoRicerca>(righe: (T & { punteggio: Punteggio })[], ordina: Ordinamento, filtri: Pick<FiltriRicerca, "settori"> = { settori: [] }): (T & { punteggio: Punteggio })[] {
  // per giorno, poi per ora (a parità di giorno, quella con l'ora prima di quella senza); senza scadenza in fondo
  const scad = (x: CandidatoRicerca) => `${x.scadenza_giorno ?? "9999-99-99"}|${x.scadenza_offerte ?? "~"}`;
  const pub = (x: CandidatoRicerca) => x.data_pubblicazione ?? "";
  const copia = [...righe];
  copia.sort((a, b) => {
    if (ordina === "recenti") return pub(b).localeCompare(pub(a)) || a.id.localeCompare(b.id);
    if (ordina === "scadenza") return scad(a).localeCompare(scad(b)) || a.id.localeCompare(b.id);
    if (ordina === "importo") return (b.valore_stimato ?? -1) - (a.valore_stimato ?? -1) || a.id.localeCompare(b.id);
    // per rilevanza: prima la fascia (le correlate dopo le pertinenti, solo per le gare classificate), poi il punteggio
    return fasciaRilevanza(a, filtri) - fasciaRilevanza(b, filtri) || b.punteggio.punti - a.punteggio.punti || scad(a).localeCompare(scad(b)) || a.id.localeCompare(b.id);
  });
  return copia;
}
