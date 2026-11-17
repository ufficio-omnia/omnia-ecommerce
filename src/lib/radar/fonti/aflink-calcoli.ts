// Feed RSS dei bandi delle piattaforme AF Soluzioni («aflink»), a partire da SardegnaCAT (fase B2-0). Logica pura: nessuna rete, nessun
// database. La scrittura nell'archivio arriva in B2a, con il motore di unione della fase B1-bis.
//
// Regole (decisioni del 16/11/2026, documento 09):
//   - si usa SOLO il feed PUBBLICATO sulla pagina «Feed RSS» dell'istanza, all'indirizzo pubblicato (mai modificato: contiene un filtro);
//     un'istanza non si aggiunge perché usa lo stesso software: GIADA e AURA restano fuori finché non decidi la S10;
//   - la licenza del feed non è dichiarata: sviluppo e prove sullo staging, ai clienti solo dopo il parere legale; solo dati di fatto
//     (oggetto, ente, CPV, importo, scadenza, CIG) con il collegamento alla pagina ufficiale e la citazione della fonte; mai allegati
//     (il link «Scarica Allegati» passa dal login e non si segue);
//   - affidamenti diretti e procedure negoziate (su invito) NON sono opportunità aperte: non entrano.
//
// Come è fatto il feed (letto il 16/11/2026): RSS 2.0 con campi del fornitore nello spazio «afs» (http://www.aflink.it/XMLBANDI), tutti gli
// elementi in una sola lettura; IdMsg (identificativo stabile), Oggetto (con HTML), DenominazioneEnte, CPV («45233140-2 - Lavori stradali»),
// a_base_asta («200.221,44»), DtScadenzaBandoTecnical e DtPubblicazioneTecnical (data e ora SENZA fuso: ora italiana), CIG (a volte vuoto o
// «CIG VARI»), Tipo (Bando/Avviso), TipoProcedura, Contratto, statoFunzionale (PresOfferte, Pubblicato, InRettifica, Revocato),
// dataUltimaModifica.
import { istanteScadenza } from "../../omnia-ai-revisione-calcoli";
import { classificaGara, normalizzaCpv, type SettoreRadar } from "../settori";
import { maiuscoleIniziali, type IdRegione } from "../territorio";
import { entraInOpportunita, opportunitaAflink, type Opportunita } from "../opportunita-calcoli";
import { idPiattaforma, type PiattaformaNota } from "./piattaforme-calcoli";
import { cigSintel } from "./sintel-calcoli";
import { giornoDiRoma, impronta, type ScadenzaTed } from "./ted-calcoli";
import type { LimitiFonte } from "./sessione-fonte";
import type { RecordLotto, RecordProcedura } from "./tipi";

export const NAMESPACE_AFLINK = "http://www.aflink.it/XMLBANDI";

export type IstanzaAflink = "sardegnacat";

export type DescrizioneIstanzaAflink = { nome: string; piattaforma: PiattaformaNota; urlFeed: string; paginaFeed: string; regione: IdRegione; attribuzione: string };

// L'indirizzo è quello pubblicato nella pagina «Feed RSS» (link relativo «/portalegare/../portale/rss_bandi.asp?…», risolto).
export const ISTANZE_AFLINK: Record<IstanzaAflink, DescrizioneIstanzaAflink> = {
  sardegnacat: {
    nome: "SardegnaCAT",
    piattaforma: "sardegnacat",
    urlFeed: "https://sardegnacat.regione.sardegna.it/portale/rss_bandi.asp?FilterHide=bScaduto%3D0+and+tipo%3C%3E%27Esito%27+&sort=DtScadenzaBandoTecnical&sortorder=asc",
    paginaFeed: "https://sardegnacat.regione.sardegna.it/portalegare/index.php/feed-rss",
    regione: "sardegna",
    attribuzione: "Regione Autonoma della Sardegna – SardegnaCAT (feed RSS pubblico dei bandi)",
  },
};

// Una lettura del feed per giro; la pagina dei feed chiede una frequenza bassa.
export const LIMITI_AFLINK_PREDEFINITI: LimitiFonte = { pausaMs: 5_000, timeoutMs: 45_000, tentativi: 2, richiesteMassime: 2 };
export const LIMITI_AFLINK_INTERVALLI: Record<keyof LimitiFonte, { min: number; max: number }> = {
  pausaMs: { min: 2_000, max: 60_000 },
  timeoutMs: { min: 5_000, max: 120_000 },
  tentativi: { min: 1, max: 3 },
  richiesteMassime: { min: 1, max: 4 },
};

// Campi senza i quali un elemento non si legge: se mancano in TUTTI gli elementi il formato è cambiato e la fonte si sospende.
export const CAMPI_AFLINK_OBBLIGATORI = ["IdMsg", "Oggetto", "DenominazioneEnte", "DtScadenzaBandoTecnical", "Tipo", "TipoProcedura", "statoFunzionale", "dataUltimaModifica"] as const;

// ───── lettura dell'XML (minima, senza dipendenze: il formato è noto e controllato) ─────

const ENTITA: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodificaEntita(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,6});/gi, (tutto, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : tutto;
    }
    return ENTITA[e.toLowerCase()] ?? tutto;
  });
}

// Valore di un campo: contenuto CDATA così com'è, oppure testo con le entità decodificate.
function valoreXml(grezzo: string): string {
  const cdata = [...grezzo.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)];
  if (cdata.length > 0) return cdata.map((m) => m[1]).join("");
  return decodificaEntita(grezzo);
}

export type ElementoAflink = Record<string, string>;

export type FeedAflink = { elementi: ElementoAflink[]; totaleDichiarato: number | null };

// L'XML del feed → elementi con i campi «afs:*» (senza prefisso) più «link». Formato inatteso → errore (la fonte si sospende).
export function leggiFeedAflink(xml: string): FeedAflink | { errore: string } {
  if (!/^\s*(<\?xml[^>]*>\s*)?<rss\b/i.test(xml)) return { errore: "la risposta non è un feed RSS" };
  if (!xml.includes(NAMESPACE_AFLINK)) return { errore: "il feed non usa più i campi del fornitore attesi" };
  const totale = Number(xml.match(/<afs:totRecord>\s*(\d+)\s*<\/afs:totRecord>/)?.[1] ?? NaN);
  const elementi: ElementoAflink[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const corpo = m[1];
    const e: ElementoAflink = {};
    for (const c of corpo.matchAll(/<afs:([A-Za-z_][A-Za-z0-9_]*)>([\s\S]*?)<\/afs:\1>/g)) e[c[1]] = valoreXml(c[2]).trim();
    const link = corpo.match(/<link>([\s\S]*?)<\/link>/)?.[1];
    if (link !== undefined) e.link = valoreXml(link).trim();
    elementi.push(e);
  }
  if (elementi.length > 0 && elementi.every((e) => CAMPI_AFLINK_OBBLIGATORI.some((k) => !e[k]))) return { errore: "agli elementi mancano i campi attesi" };
  if (elementi.length === 0 && Number.isFinite(totale) && totale > 0) return { errore: "il feed dichiara elementi ma non ne contiene" };
  return { elementi, totaleDichiarato: Number.isFinite(totale) ? totale : null };
}

// ───── campi ─────

// Oggetto: HTML tolto, avvisi di stato del portale riconosciuti e tolti dal testo.
export type OggettoAflink = { testo: string; rettificato: boolean; revocato: boolean; ripristinato: boolean };

export function oggettoAflink(grezzo: string | null | undefined): OggettoAflink {
  const conTag = decodificaEntita(grezzo ?? "");
  const rettificato = /bando\s+(rettificato|in\s+rettifica)/i.test(conTag);
  const revocato = /bando\s+revocato/i.test(conTag);
  const ripristinato = /procedura\s+ripristinata/i.test(conTag);
  // nel feed: «<strong>Bando Rettificato - </strong> Oggetto…»; si tolgono anche le forme senza grassetto
  const avviso = /(bando\s+(rettificato|in\s+rettifica|revocato)|procedura\s+ripristinata)[\s\-–:]*/;
  const testo = decodificaEntita(
    conTag
      .replace(new RegExp(`<strong>\\s*${avviso.source}<\\/strong>`, "gi"), " ")
      .replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\bscarica allegati\b/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–:]+/, "")
    .replace(new RegExp(`^${avviso.source}`, "i"), "")
    .trim();
  return { testo, rettificato, revocato, ripristinato };
}

// «200.221,44» → 200221.44; «35086» → 35086. Formati diversi → null (mai un importo indovinato).
export function importoAflink(x: string | null | undefined): number | null {
  const s = (x ?? "").replace(/[€\s]/g, "");
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,4})?$|^\d+(,\d{1,4})?$/.test(s)) return null;
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

export function cpvAflink(x: string | null | undefined): string | null {
  return normalizzaCpv((x ?? "").trim().match(/^(\d{8}(?:-\d)?)/)?.[1] ?? null);
}

// Data e ora del feed («2026-12-10T10:00:00», senza fuso = ora italiana) → giorno e istante. Una mezzanotte esatta è un giorno senza ora
// (stessa regola della PVL): l'ora non si presume mai.
export function scadenzaAflink(x: string | null | undefined): ScadenzaTed | null {
  const s = (x ?? "").trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const g = m[1];
  if (!m[2] || (m[2] === "00" && m[3] === "00" && (m[4] ?? "00") === "00")) return { giorno: g, iso: null, oraIndicata: false, fonte: `${g} (ora non indicata)` };
  const istante = istanteScadenza(g, `${m[2]}:${m[3]}`);
  if (!istante) return { giorno: g, iso: null, oraIndicata: false, fonte: s };
  const conSecondi = new Date(istante.getTime() + Number(m[4] ?? 0) * 1000);
  return { giorno: g, iso: conSecondi.toISOString(), oraIndicata: true, fonte: `${s} (ora italiana)` };
}

// Istante (ISO) di una data e ora del feed, per ordinare le versioni («dataUltimaModifica»); null se manca l'ora o il formato non è quello
// atteso (allora si ordina sul testo originale, che è comunque in ora italiana).
export function istanteAflink(x: string | null | undefined): string | null {
  return scadenzaAflink(x)?.iso ?? null;
}

export function naturaAflink(x: string | null | undefined): RecordProcedura["natura"] {
  const t = (x ?? "").trim().toLowerCase();
  if (t.startsWith("serviz")) return "servizi";
  if (t.startsWith("fornitur")) return "forniture";
  if (t.startsWith("lavor")) return "lavori";
  return null;
}

const PROCEDURE_AFLINK: [RegExp, string][] = [
  [/^aperta/i, "Procedura aperta"],
  [/^ristretta/i, "Procedura ristretta"],
  [/^negoziata/i, "Procedura negoziata"],
  [/^affidamento diretto/i, "Affidamento diretto"],
];

export function tipoProceduraAflink(x: string | null | undefined): string | null {
  const t = (x ?? "").trim();
  return t ? (PROCEDURE_AFLINK.find(([r]) => r.test(t))?.[1] ?? null) : null;
}

function urlSicuro(x: string | null | undefined): string | null {
  const s = (x ?? "").trim();
  if (!/^https:\/\//i.test(s) || s.length > 2000) return null;
  try {
    return new URL(s).toString();
  } catch {
    return null;
  }
}

export function chiaveProceduraAflink(istanza: IstanzaAflink, idMsg: string): string {
  return `${istanza}:${idMsg}`;
}

// ───── un elemento del feed → bando o esclusione ─────

export type MotivoEsclusioneAflink = "elemento_malformato" | "senza_oggetto" | "fuori_settore" | "tipo_sconosciuto" | "riservata" | "affidamento" | "scaduta";

export type MetaAflink = {
  istanza: IstanzaAflink;
  idMsg: string;
  idPiattaforma: string | null;
  // versione dell'elemento: data dell'ultima modifica (ora italiana) e il suo istante
  ultimaModifica: string;
  istanteModifica: string | null;
  stato: string;
};

export type BandoAflink = {
  tipo: "bando";
  fonte: IstanzaAflink;
  meta: MetaAflink;
  record: RecordProcedura;
  opportunita: Opportunita;
  rettificato: boolean;
  settori: SettoreRadar[];
  metodoSettore: "cpv" | "parole_chiave";
  // regione dell'ENTE (il feed non indica il luogo di esecuzione)
  regioni: IdRegione[];
  scadenzaFonte: string | null;
  lottiScadenze: (ScadenzaTed | null)[];
  lottiDocumenti: (string | null)[];
  mancanti: string[];
};

export type EsclusioneAflink = { tipo: "esclusione"; fonte: IstanzaAflink; meta: MetaAflink | null; motivo: MotivoEsclusioneAflink };

export type ElementoAflinkLetto = BandoAflink | EsclusioneAflink;

export function leggiElementoAflink(istanza: IstanzaAflink, e: ElementoAflink, adesso: Date): ElementoAflinkLetto {
  const desc = ISTANZE_AFLINK[istanza];
  const idMsg = (e.IdMsg ?? "").trim();
  const ultimaModifica = (e.dataUltimaModifica ?? "").trim();
  if (!/^\d{1,12}$/.test(idMsg) || !ultimaModifica) return { tipo: "esclusione", fonte: istanza, meta: null, motivo: "elemento_malformato" };
  const meta: MetaAflink = { istanza, idMsg, idPiattaforma: idPiattaforma(desc.piattaforma, idMsg), ultimaModifica, istanteModifica: istanteAflink(ultimaModifica), stato: (e.statoFunzionale ?? "").trim().slice(0, 40) };
  const esclusione = (motivo: MotivoEsclusioneAflink): EsclusioneAflink => ({ tipo: "esclusione", fonte: istanza, meta, motivo });

  const ogg = oggettoAflink(e.Oggetto);
  const titoloBreve = oggettoAflink(e.TitoloDocumento).testo;
  if (!ogg.testo && !titoloBreve) return esclusione("senza_oggetto");

  const opp = opportunitaAflink(e.Tipo, e.TipoProcedura, ogg.testo);
  if (!opp) return esclusione("tipo_sconosciuto");
  if (opp.tipo === "affidamento_diretto") return esclusione("affidamento");
  if (!entraInOpportunita(opp)) return esclusione("riservata");

  const scadenza = scadenzaAflink(e.DtScadenzaBandoTecnical);
  const mancanti: string[] = ["luogo_esecuzione", "codice_fiscale_ente"];
  if (!scadenza) mancanti.push("scadenza");
  else if (scadenza.iso ? scadenza.iso < adesso.toISOString() : scadenza.giorno < giornoDiRoma(adesso)) return esclusione("scaduta");

  const cpv = cpvAflink(e.CPV);
  const classificazione = classificaGara({ cpvPrincipale: cpv, cpvTutti: cpv ? [cpv] : [], testo: [ogg.testo, titoloBreve].filter(Boolean).join(" ") });
  const natura = naturaAflink(e.Contratto);
  if (classificazione.settori.length === 0) return esclusione("fuori_settore");
  if (classificazione.metodo === "parole_chiave" && natura !== null && natura !== "servizi") return esclusione("fuori_settore");

  const valoreBase = importoAflink(e.a_base_asta);
  if (valoreBase === null) mancanti.push("valore");
  const cig = cigSintel(e.CIG);
  // un CIG = un lotto noto; senza CIG («CIG VARI» o vuoto) i lotti stanno negli allegati e non si conoscono
  const lotti: RecordLotto[] = cig ? [{ cig, numero: "LOT-0001", oggetto: null, cpvPrincipale: cpv, cpvTutti: cpv ? [cpv] : [], valoreStimato: null, valoreBase, oneriSicurezza: null, durataMesi: null, opzioniRinnovi: null }] : [];
  if (!cig) mancanti.push("cig");
  const url = urlSicuro(e.link);
  if (!url) mancanti.push("collegamento");

  const denominazione = oggettoAflink(e.DenominazioneEnte).testo.slice(0, 500) || null;
  const comune = denominazione?.match(/^comune di\s+(.+)$/i)?.[1] ?? null;
  const pubblicazione = scadenzaAflink(e.DtPubblicazioneTecnical);
  const annullata = ogg.revocato || /^revocat/i.test(meta.stato);

  const record: RecordProcedura = {
    fonte: "regionale",
    idFonte: idMsg,
    chiaveProcedura: chiaveProceduraAflink(istanza, idMsg),
    oggetto: (ogg.testo || titoloBreve).slice(0, 4000),
    descrizione: null,
    ente: { codiceFiscale: null, denominazione, comune: comune ? maiuscoleIniziali(comune) : null, provincia: null, regione: desc.regione, luogoIstat: null, nuts: null },
    tipoAvviso: (e.Tipo ?? "").trim().slice(0, 60) || null,
    tipoProcedura: tipoProceduraAflink(e.TipoProcedura),
    criterioAggiudicazione: null,
    natura,
    settoriSpeciali: null,
    dataPubblicazione: pubblicazione?.giorno ?? null,
    scadenzaGiorno: scadenza?.giorno ?? null,
    scadenzaOfferte: scadenza?.iso ?? null,
    scadenzaOraIndicata: scadenza?.oraIndicata ?? false,
    valoreStimato: null,
    valoreBase,
    oneriSicurezza: null,
    durataMesi: null,
    annullata,
    urlAvviso: url,
    urlDocumenti: url,
    cpvPrincipale: cpv,
    cpvTutti: cpv ? [cpv] : [],
    lotti,
    impronta: "",
  };
  // l'indirizzo della pagina contiene la scadenza (cambia con le proroghe): l'impronta lo esclude, la scadenza è già nei campi
  record.impronta = impronta({ ...record, impronta: null, urlAvviso: null, urlDocumenti: null, settori: classificazione.settori, stato: meta.stato, opportunita: opp.tipo });

  return {
    tipo: "bando",
    fonte: istanza,
    meta,
    record,
    opportunita: opp,
    rettificato: ogg.rettificato,
    settori: classificazione.settori,
    metodoSettore: classificazione.metodo ?? "cpv",
    regioni: [desc.regione],
    scadenzaFonte: scadenza?.fonte ?? null,
    lottiScadenze: lotti.map(() => scadenza),
    lottiDocumenti: lotti.map(() => url),
    mancanti,
  };
}

export function leggiElementiAflink(istanza: IstanzaAflink, elementi: readonly ElementoAflink[], adesso: Date): ElementoAflinkLetto[] {
  return elementi.map((e) => leggiElementoAflink(istanza, e, adesso));
}
