// Feed RSS dei bandi delle piattaforme AF Soluzioni («aflink»), a partire da SardegnaCAT (fase B2-0). Logica pura: nessuna rete, nessun
// database. La scrittura nell'archivio arriva in B2a, con il motore di unione della fase B1-bis.
//
// Regole (decisioni del 16/11/2026, documento 09):
//   - si usa SOLO il feed PUBBLICATO sulla pagina «Feed RSS» dell'istanza, all'indirizzo pubblicato (mai modificato: contiene un filtro);
//     un'istanza non si aggiunge perché usa lo stesso software: GIADA e AURA restano fuori finché non decidi la S10;
//   - la licenza del feed non è dichiarata: per decisione dell'utente del 23/11 (48E, D4-bis) le gare sono visibili ai clienti senza
//     aspettare il parere legale; solo dati di fatto (oggetto, ente, CPV, importo, scadenza, CIG) con il collegamento alla pagina ufficiale
//     e la citazione della fonte; mai allegati (il link «Scarica Allegati» passa dal login e non si segue);
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
import { consultazioniAccese, entraInOpportunita, opportunita, opportunitaAflink, type Opportunita } from "../opportunita-calcoli";
import { idPiattaforma, idPiattaformaDaUrlConnettore, type PiattaformaNota } from "./piattaforme-calcoli";
import { cigSintel } from "./sintel-calcoli";
import { giornoDiRoma, impronta, type ScadenzaTed } from "./ted-calcoli";
import type { LimitiFonte } from "./sessione-fonte";
import { settoriDopoNatura } from "./natura-contratto";
import type { RecordLotto, RecordProcedura } from "./tipi";

export const NAMESPACE_AFLINK = "http://www.aflink.it/XMLBANDI";

// Fase 2 (documento 60, connettore SATER): il lettore vale per PIÙ istanze dello stesso software. Ogni istanza dichiara qui come è fatto il
// suo feed; SardegnaCAT resta esattamente com'era (stessi campi obbligatori, solo collegamenti https, IdMsg = identificativo della procedura).
// Fase 2 (27/11): anche EmPULIA (InnovaPuglia) e SIAPS (So.Re.Sa.), in costruzione e SPENTE (nessuna variabile di produzione, fuori da console
// e cron); autorizzazione dell'utente del 26/11 (richiesta di consenso inviata, responsabilità assunta dall'utente).
export type IstanzaAflink = "sardegnacat" | "sater" | "empulia" | "siaps";

export type DescrizioneIstanzaAflink = {
  nome: string;
  piattaforma: PiattaformaNota;
  // host della piattaforma: un collegamento http (collegamentiHttp) è ammesso solo verso questo host
  host: string;
  // indirizzo PUBBLICATO del feed, mai modificato (contiene un filtro). null = indirizzo NON confermato su una pagina ufficiale
  // dell'istanza: l'istanza non si legge (LettoreAflink si ferma prima di qualunque richiesta)
  urlFeed: string | null;
  // la pagina ufficiale che pubblica l'indirizzo del feed (null finché non si conosce)
  paginaFeed: string | null;
  regione: IdRegione;
  attribuzione: string;
  licenza: string;
  // campi senza i quali un elemento non si legge (se mancano in TUTTI gli elementi il formato è cambiato e la fonte si sospende)
  campiObbligatori: readonly string[];
  // TipoProcedura facoltativo: se manca, la procedura si ricava dall'oggetto e la gara entra comunque (mancante «tipo_procedura»)
  proceduraFacoltativa: boolean;
  // collegamenti http ammessi, solo verso l'host dell'istanza (SardegnaCAT: solo https, verso qualunque host, come prima)
  collegamentiHttp: boolean;
  // l'IdMsg del feed È l'identificativo della procedura nei collegamenti ufficiali (verificato per SardegnaCAT il 16/11). Se no, il
  // piattaforma_id si prende SOLO dal collegamento dell'elemento riconosciuto, e la chiave della gara ha un prefisso a sé («<istanza>:feed-»)
  idMsgEIdPiattaforma: boolean;
  // collegamento alla pagina ufficiale ricostruito dall'IdMsg quando il feed non ne dà uno valido; null = mai ricostruito (nessun indirizzo
  // si ricava per analogia)
  collegamentoDaIdMsg: ((idMsg: string) => string) | null;
  // Fase 2 (EmPULIA): il feed pubblicato dà una pagina per volta e contiene già il numero di pagina («nPag=1»). Si scorrono le pagine
  // cambiando SOLO quel numero (decisione §6.4 confermata dal coordinamento il 26/11: mai FilterHide, mai numRowForPag), fino al totRecord,
  // entro pagineMassime. Assente = una sola lettura (SardegnaCAT, come prima)
  paginazione?: { perPagina: number; pagineMassime: number };
  // Fase 2 (EmPULIA): altri feed PUBBLICATI della stessa istanza, letti dopo il principale (consultazioni); gli elementi si uniscono per IdMsg
  feedAggiuntivi?: readonly string[];
  // Fase 2 (EmPULIA, SIAPS): regole delle opportunità estese (opportunitaAflinkEstesa): consultazioni preliminari, candidature e affidamenti
  // dichiarati nell'oggetto, richieste di preventivo. Assente = la regola AF di sempre (SardegnaCAT e SATER IDENTICHE)
  regoleEstese?: boolean;
  // Fase 2: ogni reindirizzamento seguito conta come una richiesta (budget in richieste HTTP, decisione del coordinamento del 27/11)
  contaReindirizzamenti?: boolean;
};

// Campi obbligatori di SardegnaCAT (fase B2-0): invariati.
export const CAMPI_AFLINK_OBBLIGATORI = ["IdMsg", "Oggetto", "DenominazioneEnte", "DtScadenzaBandoTecnical", "Tipo", "TipoProcedura", "statoFunzionale", "dataUltimaModifica"] as const;
// Campi indispensabili per le istanze nuove: TipoProcedura, CIG, statoFunzionale e dataUltimaModifica sono facoltativi (ricognizione R2:
// non tutte le istanze li danno).
export const CAMPI_AFLINK_ESSENZIALI = ["IdMsg", "Oggetto", "DenominazioneEnte", "DtScadenzaBandoTecnical", "Tipo"] as const;

// L'indirizzo di SardegnaCAT è quello pubblicato nella pagina «Feed RSS» (link relativo «/portalegare/../portale/rss_bandi.asp?…», risolto).
export const ISTANZE_AFLINK: Record<IstanzaAflink, DescrizioneIstanzaAflink> = {
  sardegnacat: {
    nome: "SardegnaCAT",
    piattaforma: "sardegnacat",
    host: "sardegnacat.regione.sardegna.it",
    urlFeed: "https://sardegnacat.regione.sardegna.it/portale/rss_bandi.asp?FilterHide=bScaduto%3D0+and+tipo%3C%3E%27Esito%27+&sort=DtScadenzaBandoTecnical&sortorder=asc",
    paginaFeed: "https://sardegnacat.regione.sardegna.it/portalegare/index.php/feed-rss",
    regione: "sardegna",
    attribuzione: "Regione Autonoma della Sardegna – SardegnaCAT (feed RSS pubblico dei bandi)",
    licenza: "licenza del feed non dichiarata (decisione 48E, D4-bis: solo dati di fatto, con il collegamento e la citazione della fonte)",
    campiObbligatori: CAMPI_AFLINK_OBBLIGATORI,
    proceduraFacoltativa: false,
    collegamentiHttp: false,
    idMsgEIdPiattaforma: true,
    collegamentoDaIdMsg: null,
  },
  // SATER (Intercent-ER, Emilia-Romagna): stesso software. L'indirizzo del feed NON è stato visto pubblicato su una pagina ufficiale di SATER
  // (ricognizione R2: ricavato per analogia): resta null e il feed non si legge. Il canale di SATER è l'API del portale Intercent-ER
  // (intercenter-calcoli.ts); questo resta predisposto, SPENTO, finché l'indirizzo non è confermato da una pagina ufficiale.
  sater: {
    nome: "SATER",
    piattaforma: "sater",
    host: "sater.regione.emilia-romagna.it",
    urlFeed: null,
    paginaFeed: null,
    regione: "emilia_romagna",
    attribuzione: "Agenzia regionale Intercent-ER – SATER, piattaforma di e-procurement della Regione Emilia-Romagna",
    licenza: "licenza specifica del feed SATER non verificata",
    campiObbligatori: CAMPI_AFLINK_ESSENZIALI,
    proceduraFacoltativa: true,
    collegamentiHttp: true,
    idMsgEIdPiattaforma: false,
    collegamentoDaIdMsg: null,
  },
  // EmPULIA (InnovaPuglia, Puglia). Ricognizione del 27/11 (17 richieste, sola lettura): pagina «Feed Rss» PUBBLICATA sulla vetrina
  // http://www.empulia.it/tno-a/empulia/Empulia/SitePages/Feed%20Rss.aspx; feed dei bandi in corso con 20 elementi per pagina (totRecord 116,
  // pagine 1 e 2 senza sovrapposizioni) e feed delle consultazioni (694 elementi, tutto lo storico: le scadute si escludono qui). Nessun
  // robots.txt. Mai TipoProcedura; CIG in 13 elementi su 40; dataUltimaModifica sempre; nessun dato personale nei campi. I collegamenti dei
  // bandi sono la pagina pubblica di dettaglio sulla vetrina (http, host www.empulia.it) con l'IdMsg; quelli delle consultazioni sono https su
  // eproc.empulia.it. Identità «empulia:<IdMsg>» (confermata dal coordinamento il 27/11).
  empulia: {
    nome: "EmPULIA",
    piattaforma: "empulia",
    host: "www.empulia.it",
    urlFeed: "https://eproc.empulia.it/portale/rss_bandi.asp?FilterHide=bScaduto=0+and+tipo<>'Esito'+&numRowForPag=20&nPag=1",
    paginaFeed: "http://www.empulia.it/tno-a/empulia/Empulia/SitePages/Feed%20Rss.aspx",
    regione: "puglia",
    attribuzione: "InnovaPuglia – EmPULIA, piattaforma di e-procurement della Regione Puglia (feed RSS pubblici)",
    licenza: "Note legali: riproduzione solo con consenso scritto; consenso richiesto con PEC il 26/11, collegamento autorizzato dall'utente che se ne assume la responsabilità",
    campiObbligatori: CAMPI_AFLINK_ESSENZIALI,
    proceduraFacoltativa: true,
    collegamentiHttp: true,
    idMsgEIdPiattaforma: true,
    collegamentoDaIdMsg: null,
    paginazione: { perPagina: 20, pagineMassime: 8 },
    feedAggiuntivi: ["https://eproc.empulia.it/portale/rss_bandi_consultazione.asp"],
    regoleEstese: true,
    contaReindirizzamenti: true,
  },
  // SIAPS (So.Re.Sa., Campania, enti sanitari). Ricognizione del 27/11: pagina «Feed RSS» PUBBLICATA
  // https://siaps.soresa.it/portalegare/index.php/feed-rss; feed con lo stesso indirizzo di SardegnaCAT, tutto in una lettura (73 elementi:
  // Bando 45, Consultazione Preliminare di Mercato 25, Avviso 3). Nessun robots.txt. Mai CIG, TipoProcedura né dataUltimaModifica; nessun dato
  // personale nei campi. L'IdMsg è l'id dei collegamenti ufficiali (2 su 2 uguali ai BT-15 di PVL e TED in archivio). I link del feed sono http
  // e risultavano rotti (R3): il collegamento per il cliente è quello UFFICIALE dei BT-15, ricostruito dall'IdMsg (confermato dal
  // coordinamento il 27/11); mai la pagina /aflink/document/ (dettaglio con dati personali, non si legge mai).
  siaps: {
    nome: "SIAPS",
    piattaforma: "siaps",
    host: "siaps.soresa.it",
    urlFeed: "https://siaps.soresa.it/portale/rss_bandi.asp?FilterHide=bScaduto%3D0+and+tipo%3C%3E%27Esito%27+&sort=DtScadenzaBandoTecnical&sortorder=asc",
    paginaFeed: "https://siaps.soresa.it/portalegare/index.php/feed-rss",
    regione: "campania",
    attribuzione: "So.Re.Sa. – SIAPS, piattaforma di e-procurement della sanità della Regione Campania (feed RSS pubblico)",
    licenza: "Note legali: riproduzione solo con autorizzazione scritta; consenso richiesto con PEC il 26/11, collegamento autorizzato dall'utente che se ne assume la responsabilità",
    campiObbligatori: CAMPI_AFLINK_ESSENZIALI,
    proceduraFacoltativa: true,
    collegamentiHttp: false,
    idMsgEIdPiattaforma: true,
    collegamentoDaIdMsg: (idMsg) => `https://portale.soresa.it/aflink/direct/link/?id=${idMsg}`,
    regoleEstese: true,
    contaReindirizzamenti: true,
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

// Fase 2 (EmPULIA): istanze con le pagine del feed. Circa 6 pagine dei bandi più il feed delle consultazioni, ognuna con il reindirizzamento
// del portale (contato come richiesta): circa 14 richieste HTTP a giro (budget confermato dal coordinamento il 27/11), distanziate
export const LIMITI_AFLINK_PAGINATI_PREDEFINITI: LimitiFonte = { pausaMs: 5_000, timeoutMs: 60_000, tentativi: 2, richiesteMassime: 18 };
export const LIMITI_AFLINK_PAGINATI_INTERVALLI: Record<keyof LimitiFonte, { min: number; max: number }> = {
  pausaMs: { min: 3_000, max: 60_000 },
  timeoutMs: { min: 5_000, max: 120_000 },
  tentativi: { min: 1, max: 3 },
  richiesteMassime: { min: 2, max: 24 },
};

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

/** Il giorno di pubblicazione più vecchio tra gli elementi del feed (AAAA-MM-GG), o null se nessuno lo indica. */
export function pubblicazionePiuVecchiaAflink(elementi: readonly ElementoAflink[]): string | null {
  let piuVecchia: string | null = null;
  for (const e of elementi) {
    const g = scadenzaAflink(e.DtPubblicazioneTecnical)?.giorno ?? null;
    if (g && (!piuVecchia || g < piuVecchia)) piuVecchia = g;
  }
  return piuVecchia;
}

/**
 * Feed «scivolato» (K6, 48C §3.3): il feed contiene solo gli avvisi correnti. Se l'avviso più vecchio è stato pubblicato DOPO il giorno
 * dell'ultimo giro riuscito, gli avvisi usciti nel frattempo possono essere andati persi: allarme «buco_possibile». Oltre il feed non si
 * recupera, e non si aggira nulla. Senza un giro riuscito prima (primo giro) o senza date nel feed: nessun allarme.
 */
export function bucoPossibileFeed(piuVecchia: string | null, giornoUltimoSuccesso: string | null): boolean {
  return !!piuVecchia && !!giornoUltimoSuccesso && piuVecchia > giornoUltimoSuccesso;
}

// L'XML del feed → elementi con i campi «afs:*» (senza prefisso) più «link». Formato inatteso → errore (la fonte si sospende). I campi
// obbligatori sono quelli dell'istanza (di base quelli di SardegnaCAT, come prima).
export function leggiFeedAflink(xml: string, campiObbligatori: readonly string[] = CAMPI_AFLINK_OBBLIGATORI): FeedAflink | { errore: string } {
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
  if (elementi.length > 0 && elementi.every((e) => campiObbligatori.some((k) => !e[k]))) return { errore: "agli elementi mancano i campi attesi" };
  if (elementi.length === 0 && Number.isFinite(totale) && totale > 0) return { errore: "il feed dichiara elementi ma non ne contiene" };
  return { elementi, totaleDichiarato: Number.isFinite(totale) ? totale : null };
}

// ───── campi ─────

// Oggetto: HTML tolto, avvisi di stato del portale riconosciuti e tolti dal testo.
export type OggettoAflink = { testo: string; rettificato: boolean; revocato: boolean; ripristinato: boolean; sospeso: boolean };

export function oggettoAflink(grezzo: string | null | undefined): OggettoAflink {
  const conTag = decodificaEntita(grezzo ?? "");
  const rettificato = /bando\s+(rettificato|in\s+rettifica)/i.test(conTag);
  const revocato = /bando\s+revocato/i.test(conTag);
  const ripristinato = /procedura\s+ripristinata/i.test(conTag);
  // «<strong>Procedura Sospesa - </strong> Oggetto…» (correzione «Sospeso» del 27/11: SardegnaCAT, EmPULIA e SIAPS, sempre insieme a
  // statoFunzionale «Sospeso»). SOLO in testa all'oggetto: le parole «procedura sospesa» dentro il testo non dicono che QUESTA lo è.
  const sospeso = /^\s*(<strong>\s*)?procedura\s+sospes[ao]\b/i.test(conTag);
  // nel feed: «<strong>Bando Rettificato - </strong> Oggetto…»; si tolgono anche le forme senza grassetto
  const avviso = /(bando\s+(rettificato|in\s+rettifica|revocato)|procedura\s+(ripristinata|sospes[ao]))[\s\-–:]*/;
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
  return { testo, rettificato, revocato, ripristinato, sospeso };
}

// La procedura è sospesa? statoFunzionale «Sospeso» oppure il prefisso «Procedura Sospesa» in testa all'oggetto (nei feed salvati dal 16/11 al
// 27/11 i due segnali compaiono sempre insieme; il prefisso basta dove statoFunzionale è vuoto). Una revoca prevale: annullata, non sospesa.
export function sospesaAflink(statoFunzionale: string | null | undefined, ogg: Pick<OggettoAflink, "sospeso" | "revocato">): boolean {
  if (ogg.revocato || /^revocat/i.test((statoFunzionale ?? "").trim())) return false;
  return ogg.sospeso || /^sospes/i.test((statoFunzionale ?? "").trim());
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

// Istanze con TipoProcedura facoltativo: la procedura DICHIARATA nell'oggetto («procedura aperta per…»), nella forma del campo del feed.
// Nessuna indicazione → null (mai una procedura presunta).
const PROCEDURE_NELL_OGGETTO: [RegExp, string][] = [
  [/\baffidamento\s+diretto\b/i, "Affidamento diretto"],
  [/\bprocedura\s+negoziata\b|\bnegoziata\s+senza\b/i, "Negoziata"],
  [/\bcompetitiva\s+con\s+negoziazione\b/i, "Competitiva con negoziazione"],
  [/\bdialogo\s+competitivo\b/i, "Dialogo competitivo"],
  [/\bprocedura\s+ristretta\b/i, "Ristretta"],
  [/\bprocedura\s+aperta\b/i, "Aperta"],
];

export function proceduraDallOggettoAflink(testo: string | null | undefined): string | null {
  const t = (testo ?? "").trim();
  return t ? (PROCEDURE_NELL_OGGETTO.find(([r]) => r.test(t))?.[1] ?? null) : null;
}

// Collegamento alla pagina ufficiale: https verso qualunque host (come prima); http SOLO se l'istanza lo ammette e SOLO verso il suo host.
function urlSicuro(x: string | null | undefined, httpVersoHost: string | null = null): string | null {
  const s = (x ?? "").trim();
  if (s.length > 2000) return null;
  const https = /^https:\/\//i.test(s);
  const http = !https && httpVersoHost !== null && /^http:\/\//i.test(s);
  if (!https && !http) return null;
  try {
    const u = new URL(s);
    if (http && u.hostname.toLowerCase() !== httpVersoHost.toLowerCase()) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function collegamentoAflink(istanza: IstanzaAflink, link: string | null | undefined, idMsg: string): string | null {
  const desc = ISTANZE_AFLINK[istanza];
  const httpVersoHost = desc.collegamentiHttp ? desc.host : null;
  const dalFeed = urlSicuro(link, httpVersoHost);
  if (dalFeed) return dalFeed;
  return desc.collegamentoDaIdMsg && /^\d{1,12}$/.test(idMsg) ? urlSicuro(desc.collegamentoDaIdMsg(idMsg), httpVersoHost) : null;
}

// Chiave della gara nata dal feed: «<istanza>:<IdMsg>» dove l'IdMsg è l'identificativo della procedura (SardegnaCAT); altrove
// «<istanza>:feed-<IdMsg>», che non si confonde mai con un identificativo di piattaforma («sater:<numero>»).
export function chiaveProceduraAflink(istanza: IstanzaAflink, idMsg: string): string {
  return ISTANZE_AFLINK[istanza].idMsgEIdPiattaforma ? `${istanza}:${idMsg}` : `${istanza}:feed-${idMsg}`;
}

// Identificativo della procedura sulla piattaforma: dall'IdMsg dove coincide (SardegnaCAT); altrove SOLO dal collegamento dell'elemento,
// se è una forma riconosciuta della STESSA piattaforma (piattaforme-calcoli.ts).
export function idPiattaformaAflink(istanza: IstanzaAflink, idMsg: string, url: string | null): string | null {
  const desc = ISTANZE_AFLINK[istanza];
  if (desc.idMsgEIdPiattaforma) return idPiattaforma(desc.piattaforma, idMsg);
  const id = idPiattaformaDaUrlConnettore(url);
  return id && id.startsWith(`${desc.piattaforma}:`) ? id : null;
}

// ───── Fase 2 (EmPULIA, SIAPS): pagine del feed, regole estese, id nei collegamenti ─────

/**
 * L'indirizzo PUBBLICATO con il solo numero di pagina cambiato («nPag=1» → «nPag=<n>»), tutto il resto identico carattere per carattere
 * (decisione §6.4: mai FilterHide, mai numRowForPag). Senza «nPag» nell'indirizzo, o con un numero fuori misura → null (nessuna pagina).
 */
export function urlPaginaAflink(urlPubblicato: string, pagina: number): string | null {
  if (!Number.isInteger(pagina) || pagina < 1 || pagina > 50) return null;
  const m = urlPubblicato.match(/([?&]nPag=)(\d*)(?=&|$)/);
  if (!m || m.index === undefined) return null;
  return `${urlPubblicato.slice(0, m.index)}${m[1]}${pagina}${urlPubblicato.slice(m.index + m[0].length)}`;
}

// candidature dichiarate nell'oggetto: indagine di mercato (anche «conoscitiva» o «esplorativa»), avviso esplorativo, manifestazione d'interesse
function candidaturaDichiarata(testo: string): Opportunita | null {
  if (/indagin[ei]\s+(?:conoscitiv[ao]\s+|esplorativ[ao]\s+)?di\s+mercato/i.test(testo)) return opportunita("indagine_mercato");
  if (/manifestazion[ei]\s+d[i'’]\s*interesse|avviso\s+esplorativo/i.test(testo)) return opportunita("manifestazione_interesse");
  return null;
}

/**
 * Le regole delle opportunità per le istanze con regoleEstese (EmPULIA, SIAPS; decisioni del coordinamento del 26–27/11). SardegnaCAT e SATER
 * NON passano di qui (opportunitaAflink invariata):
 *   - Tipo «Consultazione Preliminare di Mercato»: un oggetto che dichiara una candidatura (indagine di mercato, avviso esplorativo,
 *     manifestazione d'interesse) → CANDIDATURA; una richiesta di preventivo → indagine di mercato; un affidamento diretto → fuori; altrimenti
 *     il tipo nuovo «consultazione_preliminare», SOLO se la fonte è nell'interruttore per fonte (FONTI_CON_CONSULTAZIONI), altrimenti nessuna;
 *   - Tipo «Bando» senza TipoProcedura: affidamento diretto nell'oggetto → fuori (salvo candidatura dichiarata); negoziata → riservata salvo
 *     previa pubblicazione o candidatura dichiarata (come le altre fonti); richiesta di preventivo → indagine di mercato; candidatura dichiarata
 *     → candidatura; il resto come la regola AF (bando);
 *   - altri tipi («Avviso»): la regola AF.
 */
export function opportunitaAflinkEstesa(istanza: IstanzaAflink, tipo: string | null | undefined, procedura: string | null | undefined, testo: string): Opportunita | null {
  const t = (tipo ?? "").trim().toLowerCase();
  const affidamento = /\baffidamento\s+diretto\b/i.test(testo);
  const preventivo = /richiest[ae]\s+(?:di\s+)?preventiv/i.test(testo);
  if (/^consultazion/.test(t)) {
    const c = candidaturaDichiarata(testo);
    if (c) return c;
    if (affidamento) return opportunita("affidamento_diretto");
    if (preventivo) return opportunita("indagine_mercato");
    return consultazioniAccese(istanza) ? opportunita("consultazione_preliminare") : null;
  }
  if (t === "bando") {
    const c = candidaturaDichiarata(testo);
    if (affidamento) return c ?? opportunita("affidamento_diretto");
    if (/^negoziata/i.test((procedura ?? "").trim()) || /\bprocedura\s+negoziata\b/i.test(testo)) {
      return /previa\s+(pubblicazione|indizione)|con\s+bando/i.test(testo) ? opportunita("bando") : (c ?? opportunita("riservata"));
    }
    if (preventivo) return opportunita("indagine_mercato");
    if (c) return c;
  }
  return opportunitaAflink(tipo, procedura, testo);
}

/**
 * L'IdMsg SIAPS in un collegamento ufficiale: «https://portale.soresa.it/aflink/direct/link/?id=<n>» (BT-15 di PVL e TED) o
 * «http(s)://siaps.soresa.it/application/CustomDoc/DettaglioProcedura.asp?ID=<n>» (TED più vecchi). Solo per i SUGGERIMENTI in console.
 */
export function idSiapsDaUrl(url: string | null | undefined): string | null {
  let u: URL;
  try {
    u = new URL((url ?? "").trim());
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  const id = host === "portale.soresa.it" && /^\/aflink\/direct\/link\/?$/i.test(u.pathname) ? u.searchParams.get("id") : host === "siaps.soresa.it" && /^\/application\/customdoc\/dettaglioprocedura\.asp$/i.test(u.pathname) ? (u.searchParams.get("ID") ?? u.searchParams.get("id")) : null;
  return id && /^\d{1,12}$/.test(id) ? id : null;
}

// ───── un elemento del feed → bando o esclusione ─────

export type MotivoEsclusioneAflink = "elemento_malformato"
  | "esclusa_per_oggetto" | "senza_oggetto" | "fuori_settore" | "tipo_sconosciuto" | "riservata" | "affidamento" | "scaduta";

export type MetaAflink = {
  istanza: IstanzaAflink;
  idMsg: string;
  idPiattaforma: string | null;
  // versione dell'elemento: data dell'ultima modifica (ora italiana) e il suo istante. null solo nelle istanze dove il campo è facoltativo:
  // la versione è allora il giorno in cui OMNIA vede il contenuto cambiato (come Sintel, importa-regionali-calcoli.ts)
  ultimaModifica: string | null;
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
  // «Procedura Ripristinata» nell'oggetto del feed (dopo una revoca): decisione dell'utente del 23/11, scelta (a)
  ripristinato: boolean;
  settori: SettoreRadar[];
  metodoSettore: "cpv" | "parole_chiave";
  // regione dell'ENTE (il feed non indica il luogo di esecuzione)
  regioni: IdRegione[];
  scadenzaFonte: string | null;
  lottiScadenze: (ScadenzaTed | null)[];
  lottiDocumenti: (string | null)[];
  mancanti: string[];
};

export type EsclusioneAflink = { tipo: "esclusione"; fonte: IstanzaAflink; meta: MetaAflink | null; motivo: MotivoEsclusioneAflink; regole?: string[] };

export type ElementoAflinkLetto = BandoAflink | EsclusioneAflink;

export function leggiElementoAflink(istanza: IstanzaAflink, e: ElementoAflink, adesso: Date): ElementoAflinkLetto {
  const desc = ISTANZE_AFLINK[istanza];
  const idMsg = (e.IdMsg ?? "").trim();
  const ultimaModifica = (e.dataUltimaModifica ?? "").trim() || null;
  if (!/^\d{1,12}$/.test(idMsg) || (!ultimaModifica && desc.campiObbligatori.includes("dataUltimaModifica"))) return { tipo: "esclusione", fonte: istanza, meta: null, motivo: "elemento_malformato" };
  const url = collegamentoAflink(istanza, e.link, idMsg);
  const meta: MetaAflink = {
    istanza,
    idMsg,
    idPiattaforma: idPiattaformaAflink(istanza, idMsg, url),
    ultimaModifica,
    istanteModifica: ultimaModifica ? istanteAflink(ultimaModifica) : null,
    stato: (e.statoFunzionale ?? "").trim().slice(0, 40),
  };
  const esclusione = (motivo: MotivoEsclusioneAflink): EsclusioneAflink => ({ tipo: "esclusione", fonte: istanza, meta, motivo });

  const ogg = oggettoAflink(e.Oggetto);
  const titoloBreve = oggettoAflink(e.TitoloDocumento).testo;
  if (!ogg.testo && !titoloBreve) return esclusione("senza_oggetto");

  // TipoProcedura: quello del feed; dove è facoltativo e manca, quello dichiarato nell'oggetto; se l'oggetto non lo dice, un «Bando» del feed
  // pubblico entra comunque (procedura non indicata: mancante «tipo_procedura», mai una procedura scritta nella gara)
  const proceduraFeed = (e.TipoProcedura ?? "").trim();
  const proceduraOggetto = !proceduraFeed && desc.proceduraFacoltativa ? proceduraDallOggettoAflink([ogg.testo, titoloBreve].filter(Boolean).join(" ")) : null;
  const proceduraIgnota = !proceduraFeed && !proceduraOggetto && desc.proceduraFacoltativa;
  const proceduraRegola = proceduraFeed || proceduraOggetto || (proceduraIgnota ? "Aperta" : e.TipoProcedura);
  // Fase 2: regole estese SOLO per le istanze che le dichiarano (EmPULIA, SIAPS); SardegnaCAT e SATER: la regola AF di sempre, identica
  const opp = desc.regoleEstese ? opportunitaAflinkEstesa(istanza, e.Tipo, proceduraRegola, [ogg.testo, titoloBreve].filter(Boolean).join(" ")) : opportunitaAflink(e.Tipo, proceduraRegola, ogg.testo);
  if (!opp) return esclusione("tipo_sconosciuto");
  if (opp.tipo === "affidamento_diretto") return esclusione("affidamento");
  if (!entraInOpportunita(opp)) return esclusione("riservata");

  const scadenza = scadenzaAflink(e.DtScadenzaBandoTecnical);
  const mancanti: string[] = ["luogo_esecuzione", "codice_fiscale_ente"];
  if (proceduraIgnota && opp.tipo === "bando") mancanti.push("tipo_procedura");
  if (!scadenza) mancanti.push("scadenza");
  else if (scadenza.iso ? scadenza.iso < adesso.toISOString() : scadenza.giorno < giornoDiRoma(adesso)) return esclusione("scaduta");

  const cpv = cpvAflink(e.CPV);
  const classificazione = classificaGara({ cpvPrincipale: cpv, cpvTutti: cpv ? [cpv] : [], testo: [ogg.testo, titoloBreve].filter(Boolean).join(" ") });
  const natura = naturaAflink(e.Contratto);
  // esclusa dalle regole per oggetto (settori.ts, regole della PVL): si conta a parte, con le regole applicate
  if (classificazione.settori.length === 0) return classificazione.esclusioni.length > 0 ? { ...esclusione("esclusa_per_oggetto"), regole: [...new Set(classificazione.esclusioni.map((e) => e.regola))] } : esclusione("fuori_settore");
  // la regola della natura, una per tutte le fonti, con l'eccezione D2 dei buoni pasto (fonti/natura-contratto.ts)
  const settoriTenuti = settoriDopoNatura(classificazione, natura);
  if (settoriTenuti.length === 0) return esclusione("fuori_settore");

  const valoreBase = importoAflink(e.a_base_asta);
  if (valoreBase === null) mancanti.push("valore");
  const cig = cigSintel(e.CIG);
  // un CIG = un lotto noto; senza CIG («CIG VARI» o vuoto) i lotti stanno negli allegati e non si conoscono
  const lotti: RecordLotto[] = cig ? [{ cig, numero: "LOT-0001", oggetto: null, cpvPrincipale: cpv, cpvTutti: cpv ? [cpv] : [], valoreStimato: null, valoreBase, oneriSicurezza: null, durataMesi: null, opzioniRinnovi: null }] : [];
  if (!cig) mancanti.push("cig");
  if (!url) mancanti.push("collegamento");

  const denominazione = oggettoAflink(e.DenominazioneEnte).testo.slice(0, 500) || null;
  const comune = denominazione?.match(/^comune di\s+(.+)$/i)?.[1] ?? null;
  const pubblicazione = scadenzaAflink(e.DtPubblicazioneTecnical);
  const annullata = ogg.revocato || /^revocat/i.test(meta.stato);
  const sospesa = sospesaAflink(meta.stato, ogg);

  const record: RecordProcedura = {
    fonte: "regionale",
    idFonte: idMsg,
    chiaveProcedura: chiaveProceduraAflink(istanza, idMsg),
    oggetto: (ogg.testo || titoloBreve).slice(0, 4000),
    descrizione: null,
    ente: { codiceFiscale: null, denominazione, comune: comune ? maiuscoleIniziali(comune) : null, provincia: null, regione: desc.regione, luogoIstat: null, nuts: null },
    tipoAvviso: (e.Tipo ?? "").trim().slice(0, 60) || null,
    tipoProcedura: tipoProceduraAflink(proceduraFeed || proceduraOggetto),
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
    // solo quando vale: le procedure non sospese hanno il record (e l'impronta) di prima
    ...(sospesa ? { sospesa: true as const } : {}),
    urlAvviso: url,
    urlDocumenti: url,
    cpvPrincipale: cpv,
    cpvTutti: cpv ? [cpv] : [],
    lotti,
    impronta: "",
  };
  // l'indirizzo della pagina contiene la scadenza (cambia con le proroghe): l'impronta lo esclude, la scadenza è già nei campi
  record.impronta = impronta({ ...record, impronta: null, urlAvviso: null, urlDocumenti: null, settori: settoriTenuti, stato: meta.stato, opportunita: opp.tipo });

  return {
    tipo: "bando",
    fonte: istanza,
    meta,
    record,
    opportunita: opp,
    rettificato: ogg.rettificato,
    ripristinato: ogg.ripristinato,
    settori: settoriTenuti,
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
