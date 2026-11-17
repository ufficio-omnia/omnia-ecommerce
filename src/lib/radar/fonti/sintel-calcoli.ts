// Sintel (Regione Lombardia): lettura dei dati aperti «Procedure di gara gestite tramite Sintel» (dataset 8txy-zjw2 di dati.lombardia.it,
// interfaccia SODA documentata). Logica pura: nessuna rete, nessun database. Fase B2-0 (solo file nuovi); la scrittura nell'archivio
// arriva in B2a, con il motore di unione della fase B1-bis.
//
// Verifica del 16/11/2026 (documento 09, §2.5):
//   - licenza CC0 1.0 nei metadati; le note legali del portale chiedono di citare SEMPRE la fonte (ATTRIBUZIONE_SINTEL);
//   - robots.txt: «Crawl-delay: 1», i dati (/resource/) e i metadati (/api/views/) sono consentiti;
//   - una riga per LOTTO (id_procedura + id_lotto; monolotto con id_lotto «N/D»); il dataset è ricaricato da zero ogni giorno verso le 7:
//     le novità si riconoscono confrontando le letture (impronta), non con la data di modifica delle righe;
//   - scadenza («data_fine_negoziazione») SOLO come giorno (l'ora è sempre 00:00): si salva il giorno, l'ora non si presume;
//   - CIG segnaposto («XXXXXXXXXX», «^^^^^^^^^^») per manifestazioni, indagini, affidamenti: non sono CIG;
//   - CPV della categoria merceologica interna di Sintel (non quello del bando): classificazione con le regole di sempre;
//   - le colonne degli aggiudicatari contengono anche codici fiscali di persone: NON si chiedono mai (elenco esplicito delle colonne) e una
//     risposta che le contiene viene rifiutata.
import { classificaGara, normalizzaCpv, type SettoreRadar } from "../settori";
import { maiuscoleIniziali, type IdRegione } from "../territorio";
import { entraInOpportunita, opportunitaSintel, type Opportunita } from "../opportunita-calcoli";
import { idPiattaforma } from "./piattaforme-calcoli";
import { cigPvl, codiceFiscaleSa } from "./pvl-calcoli";
import { confrontaScadenze, impronta, type ScadenzaTed } from "./ted-calcoli";
import type { LimitiFonte } from "./sessione-fonte";
import type { RecordLotto, RecordProcedura } from "./tipi";

export const URL_DATI_SINTEL = "https://www.dati.lombardia.it/resource/8txy-zjw2.json";
export const URL_METADATI_SINTEL = "https://www.dati.lombardia.it/api/views/8txy-zjw2.json";
export const ATTRIBUZIONE_SINTEL = "Regione Lombardia – Open Data Lombardia (Sintel), licenza CC0 1.0";

// Le sole colonne utili. MAI le colonne degli aggiudicatari (ragione sociale e identificativo fiscale: anche persone fisiche).
export const COLONNE_SINTEL = [
  "id_procedura",
  "id_lotto",
  "multilotto",
  "cig",
  "codice_cpv",
  "data_inizio_negoziazione",
  "data_fine_negoziazione",
  "modalita_scelta_contraente",
  "ambito_merceologico",
  "stato_procedura",
  "stato_lotto",
  "accordo_quadro",
  "valore_economico_procedura",
  "base_asta_lotto",
  "cf_stazione_appaltante",
  "stazione_appaltante",
  "nome_procedura",
  "nome_lotto",
  "link_procedura",
  "link_lotto",
] as const;

export const COLONNA_VIETATA_SINTEL = /aggiudicatar/i;

// Una richiesta ogni 2 secondi (il robots.txt chiede almeno 1), tetto di 6 richieste per giro: un giro normale ne usa 1 o 2.
export const LIMITI_SINTEL_PREDEFINITI: LimitiFonte = { pausaMs: 2_000, timeoutMs: 30_000, tentativi: 2, richiesteMassime: 6 };
export const LIMITI_SINTEL_INTERVALLI: Record<keyof LimitiFonte, { min: number; max: number }> = {
  pausaMs: { min: 1_000, max: 60_000 },
  timeoutMs: { min: 5_000, max: 120_000 },
  tentativi: { min: 1, max: 3 },
  richiesteMassime: { min: 1, max: 20 },
};
export const RIGHE_PER_PAGINA_SINTEL = 1_000;

const GIORNO = /^\d{4}-\d{2}-\d{2}$/;

// Parametri della richiesta: righe con scadenza da «daGiorno» in poi (tutti gli stati: servono anche sospensioni e chiusure anticipate),
// solo le colonne utili, ordine stabile per la paginazione.
export function parametriSintel(p: { daGiorno: string; limite: number; offset: number }): Record<string, string> {
  if (!GIORNO.test(p.daGiorno)) throw new Error("Giorno non valido");
  if (!Number.isInteger(p.limite) || p.limite < 1 || p.limite > 5_000) throw new Error("Limite non valido");
  if (!Number.isInteger(p.offset) || p.offset < 0) throw new Error("Offset non valido");
  return {
    $select: COLONNE_SINTEL.join(","),
    $where: `data_fine_negoziazione >= '${p.daGiorno}T00:00:00'`,
    $order: "id_procedura,id_lotto",
    $limit: String(p.limite),
    $offset: String(p.offset),
  };
}

// Data dell'ultimo caricamento del dataset (metadati, campo «rowsUpdatedAt» in secondi): una richiesta leggera prima di leggere i dati.
export function dataAggiornamentoSintel(metadati: unknown): string | null {
  const m = metadati && typeof metadati === "object" ? (metadati as Record<string, unknown>) : null;
  const s = Number(m?.rowsUpdatedAt);
  if (!Number.isFinite(s) || s <= 0) return null;
  return new Date(s * 1000).toISOString();
}

export type RigaSintel = Record<string, unknown>;

// Controllo del formato di una pagina: un elenco di oggetti, senza colonne vietate. null = formato inatteso (la fonte si sospende).
export function righeSintelValide(j: unknown): { righe: RigaSintel[] } | { errore: string } {
  if (!Array.isArray(j)) return { errore: "la risposta non è un elenco di righe" };
  for (const r of j) {
    if (!r || typeof r !== "object" || Array.isArray(r)) return { errore: "una riga non è un oggetto" };
    const vietata = Object.keys(r).find((k) => COLONNA_VIETATA_SINTEL.test(k));
    if (vietata) return { errore: `la risposta contiene una colonna vietata (${vietata})` };
  }
  return { righe: j as RigaSintel[] };
}

function testo(x: unknown): string | null {
  if (typeof x === "number" && Number.isFinite(x)) return String(x);
  if (typeof x !== "string") return null;
  const t = x.replace(/\s+/g, " ").trim();
  return t && t.toUpperCase() !== "N/D" ? t : null;
}

function numero(x: unknown): number | null {
  const t = testo(x);
  if (!t || !/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

function giorno(x: unknown): string | null {
  return testo(x)?.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
}

// Il collegamento arriva come oggetto {url} (tipo «URL» del portale) o come testo.
function collegamento(x: unknown): string | null {
  const s = x && typeof x === "object" ? (x as Record<string, unknown>).url : x;
  const t = typeof s === "string" ? s.trim() : "";
  if (!/^https?:\/\//i.test(t) || t.length > 2000) return null;
  try {
    return new URL(t).toString();
  } catch {
    return null;
  }
}

// CIG vero: 10 caratteri alfanumerici con almeno una cifra e non tutti uguali (i segnaposto non sono CIG).
export function cigSintel(x: unknown): string | null {
  const c = cigPvl(x);
  if (!c || !/\d/.test(c) || /^(.)\1{9}$/.test(c)) return null;
  return c;
}

export function cpvSintel(x: unknown): string | null {
  return normalizzaCpv(testo(x)?.match(/^(\d{8}(?:-\d)?)/)?.[1] ?? null);
}

// «Procedura per lavori» → lavori; farmaci e dispositivi → forniture; incarichi professionali e servizi sociali → servizi;
// «forniture/servizi» e concessioni → non indicata (mai indovinare).
export function naturaSintel(ambito: unknown): RecordProcedura["natura"] {
  const a = (testo(ambito) ?? "").toLowerCase();
  if (/lavori/.test(a)) return "lavori";
  if (/farmac|dispositivi medici/.test(a)) return "forniture";
  if (/liberi professionisti|servizi sociali/.test(a)) return "servizi";
  return null;
}

const PROCEDURE_SINTEL: [RegExp, string][] = [
  [/^procedura aperta/i, "Procedura aperta"],
  [/^procedura ristretta/i, "Procedura ristretta"],
  [/^(procedura )?negoziata con previa (indizione|pubblicazione)/i, "Procedura competitiva con negoziazione"],
];

export function tipoProceduraSintel(modalita: string | null): string | null {
  if (!modalita) return null;
  return PROCEDURE_SINTEL.find(([r]) => r.test(modalita))?.[1] ?? null;
}

// Stato della procedura nei dati aperti: «Pubblicata» e «Aperta pre-qualifica» = in corso; «Sospesa»; tutto il resto = chiusa.
export type StatoSintel = "in_corso" | "sospesa" | "chiusa";

export function statoSintel(x: unknown): StatoSintel {
  const s = (testo(x) ?? "").toLowerCase();
  if (/^pubblicat|^aperta/.test(s)) return "in_corso";
  if (/^sospes/.test(s)) return "sospesa";
  return "chiusa";
}

export function chiaveProceduraSintel(idProcedura: string): string {
  return `sintel:${idProcedura}`;
}

export function scadenzaSintel(x: unknown): ScadenzaTed | null {
  const g = giorno(x);
  return g ? { giorno: g, iso: null, oraIndicata: false, fonte: `${g} (Sintel indica solo il giorno)` } : null;
}

export type MotivoEsclusioneSintel =
  | "riga_malformata"
  | "esclusa_per_oggetto"
  | "senza_oggetto"
  | "fuori_settore"
  | "modalita_sconosciuta"
  | "riservata" // negoziata senza indizione, appalto specifico di un SDA, inviti
  | "affidamento" // affidamenti diretti
  | "chiusa" // stato diverso da in corso o sospesa (anche prima della scadenza: in B2a si confronta con la lettura precedente)
  | "scaduta";

export type MetaSintel = { idProcedura: string; idPiattaforma: string | null; modalita: string | null; stato: StatoSintel };

export type BandoSintel = {
  tipo: "bando";
  fonte: "sintel";
  meta: MetaSintel;
  record: RecordProcedura;
  opportunita: Opportunita;
  settori: SettoreRadar[];
  metodoSettore: "cpv" | "parole_chiave";
  // regione dell'ENTE (Sintel non indica il luogo di esecuzione)
  regioni: IdRegione[];
  scadenzaFonte: string | null;
  lottiScadenze: (ScadenzaTed | null)[];
  lottiDocumenti: (string | null)[];
  // inizio della presentazione delle offerte: Sintel non indica la data di pubblicazione e non si sostituisce con questa
  inizioOfferte: string | null;
  mancanti: string[];
};

export type EsclusioneSintel = { tipo: "esclusione"; fonte: "sintel"; meta: MetaSintel | null; motivo: MotivoEsclusioneSintel; regole?: string[] };

export type ProceduraSintelLetta = BandoSintel | EsclusioneSintel;

// Le righe (una per lotto) raggruppate per procedura, nell'ordine di arrivo.
export function raggruppaSintel(righe: readonly RigaSintel[]): Map<string, RigaSintel[]> {
  const gruppi = new Map<string, RigaSintel[]>();
  for (const r of righe) {
    const id = testo(r.id_procedura);
    if (!id || !/^\d{1,12}$/.test(id)) continue;
    const g = gruppi.get(id) ?? [];
    g.push(r);
    gruppi.set(id, g);
  }
  return gruppi;
}

function numeroLottoSintel(r: RigaSintel, i: number): string {
  const id = testo(r.id_lotto);
  return id && /^\d{1,12}$/.test(id) ? `SINTEL-${id}` : `LOT-${String(i + 1).padStart(4, "0")}`;
}

// Una procedura (le sue righe) → bando normalizzato oppure il motivo per cui non entra. «oggi» = giorno di Roma della lettura.
export function leggiProceduraSintel(idProcedura: string, righe: readonly RigaSintel[], oggi: string): ProceduraSintelLetta {
  const prima = righe[0];
  if (!prima || !/^\d{1,12}$/.test(idProcedura)) return { tipo: "esclusione", fonte: "sintel", meta: null, motivo: "riga_malformata" };
  const modalita = testo(prima.modalita_scelta_contraente)?.slice(0, 60) ?? null;
  const stato = statoSintel(prima.stato_procedura);
  const meta: MetaSintel = { idProcedura, idPiattaforma: idPiattaforma("sintel", idProcedura), modalita, stato };
  const esclusione = (motivo: MotivoEsclusioneSintel): EsclusioneSintel => ({ tipo: "esclusione", fonte: "sintel", meta, motivo });

  const titolo = testo(prima.nome_procedura);
  if (!titolo) return esclusione("senza_oggetto");

  const opp = opportunitaSintel(modalita);
  if (!opp) return esclusione("modalita_sconosciuta");
  if (opp.tipo === "affidamento_diretto") return esclusione("affidamento");
  if (!entraInOpportunita(opp)) return esclusione("riservata");
  if (stato === "chiusa") return esclusione("chiusa");

  // lotti: nelle procedure multilotto una riga per lotto (id_lotto numerico); nelle monolotto una sola riga
  const multilotto = righe.length > 1 || /^si$/i.test(testo(prima.multilotto) ?? "");
  // un lotto già chiuso di una procedura ancora in corso non è più un'opportunità
  const lottoAperto = (r: RigaSintel) => {
    const s = testo(r.stato_lotto);
    return !s || statoSintel(s) !== "chiusa";
  };
  const righeLotti = multilotto ? righe.filter((r) => testo(r.id_lotto) && lottoAperto(r)) : [prima];
  if (righeLotti.length === 0) return esclusione("chiusa");
  const lottiScadenze = righeLotti.map((r) => scadenzaSintel(r.data_fine_negoziazione));
  const scadenza = lottiScadenze.filter((s): s is ScadenzaTed => !!s).sort(confrontaScadenze)[0] ?? null;
  const mancanti: string[] = ["ora_scadenza", "luogo_esecuzione", "data_pubblicazione"];
  if (!scadenza) mancanti.push("scadenza");
  else if (lottiScadenze.every((s) => !s || s.giorno < oggi)) return esclusione("scaduta");

  const cpvLotti = righeLotti.map((r) => cpvSintel(r.codice_cpv));
  const cpvTutti = [...new Set(cpvLotti.filter((c): c is string => !!c))];
  const testoOggetto = [titolo, ...righeLotti.map((r) => testo(r.nome_lotto))].filter(Boolean).join(" ");
  // i lotti (nome e CPV) servono solo a riconoscere un servizio AUTONOMO (lotto dedicato): cambiano il livello, mai i settori
  const classificazione = classificaGara({ cpvPrincipale: cpvLotti[0] ?? null, cpvTutti, testo: testoOggetto, lotti: righeLotti.map((r, i) => ({ testo: testo(r.nome_lotto), cpv: [cpvLotti[i]] })) });
  const natura = naturaSintel(prima.ambito_merceologico);
  // esclusa dalle regole per oggetto (settori.ts, regole della PVL): si conta a parte, con le regole applicate
  if (classificazione.settori.length === 0) return classificazione.esclusioni.length > 0 ? { ...esclusione("esclusa_per_oggetto"), regole: [...new Set(classificazione.esclusioni.map((e) => e.regola))] } : esclusione("fuori_settore");
  // stessa regola di TED e PVL: una gara trovata solo per parola chiave deve essere di servizi (o di natura non indicata)
  if (classificazione.metodo === "parole_chiave" && natura !== null && natura !== "servizi") return esclusione("fuori_settore");

  const documentiLotti = righeLotti.map((r) => collegamento(r.link_lotto) ?? collegamento(r.link_procedura));
  const urlProcedura = collegamento(prima.link_procedura);
  if (!urlProcedura) mancanti.push("collegamento");

  const lotti: RecordLotto[] = righeLotti.map((r, i) => ({
    cig: cigSintel(r.cig),
    numero: numeroLottoSintel(r, i),
    oggetto: multilotto ? (testo(r.nome_lotto)?.slice(0, 4000) ?? null) : null,
    cpvPrincipale: cpvLotti[i],
    cpvTutti: cpvLotti[i] ? [cpvLotti[i] as string] : [],
    valoreStimato: null,
    // il dizionario dei campi indica la base d'asta (per lotto nelle multilotto)
    valoreBase: multilotto ? numero(r.base_asta_lotto) : numero(r.valore_economico_procedura),
    oneriSicurezza: null,
    durataMesi: null,
    opzioniRinnovi: null,
  }));
  if (lotti.some((l) => !l.cig)) mancanti.push("cig");
  const valoreBase = numero(prima.valore_economico_procedura) ?? (lotti.every((l) => l.valoreBase !== null) && lotti.length > 0 ? Math.round(lotti.reduce((s, l) => s + (l.valoreBase as number), 0) * 100) / 100 : null);
  if (valoreBase === null) mancanti.push("valore");

  const denominazione = testo(prima.stazione_appaltante)?.slice(0, 500) ?? null;
  const comune = denominazione?.match(/^comune di\s+(.+)$/i)?.[1] ?? null;

  const record: RecordProcedura = {
    fonte: "regionale",
    idFonte: idProcedura,
    chiaveProcedura: chiaveProceduraSintel(idProcedura),
    oggetto: titolo.slice(0, 4000),
    descrizione: null,
    ente: {
      codiceFiscale: codiceFiscaleSa(prima.cf_stazione_appaltante),
      denominazione,
      comune: comune ? maiuscoleIniziali(comune) : null,
      provincia: null,
      regione: "lombardia",
      luogoIstat: null,
      nuts: null,
    },
    tipoAvviso: modalita,
    tipoProcedura: tipoProceduraSintel(modalita),
    criterioAggiudicazione: null,
    natura,
    settoriSpeciali: null,
    dataPubblicazione: null,
    scadenzaGiorno: scadenza?.giorno ?? null,
    scadenzaOfferte: null,
    scadenzaOraIndicata: false,
    valoreStimato: null,
    valoreBase,
    oneriSicurezza: null,
    durataMesi: null,
    annullata: false,
    urlAvviso: urlProcedura,
    urlDocumenti: urlProcedura,
    cpvPrincipale: cpvLotti[0] ?? cpvTutti[0] ?? null,
    cpvTutti,
    lotti,
    impronta: "",
  };
  record.impronta = impronta({ ...record, impronta: null, settori: classificazione.settori, stato, opportunita: opp.tipo });

  return {
    tipo: "bando",
    fonte: "sintel",
    meta,
    record,
    opportunita: opp,
    settori: classificazione.settori,
    metodoSettore: classificazione.metodo ?? "cpv",
    regioni: ["lombardia"],
    scadenzaFonte: scadenza?.fonte ?? null,
    lottiScadenze,
    lottiDocumenti: documentiLotti,
    inizioOfferte: giorno(prima.data_inizio_negoziazione),
    mancanti,
  };
}

// Tutte le righe lette → procedure normalizzate (una per procedura) e righe senza identificativo scartate.
export function leggiRigheSintel(righe: readonly RigaSintel[], oggi: string): { procedure: ProceduraSintelLetta[]; righeScartate: number } {
  const gruppi = raggruppaSintel(righe);
  const usate = [...gruppi.values()].reduce((s, g) => s + g.length, 0);
  return { procedure: [...gruppi.entries()].map(([id, g]) => leggiProceduraSintel(id, g, oggi)), righeScartate: righe.length - usate };
}
