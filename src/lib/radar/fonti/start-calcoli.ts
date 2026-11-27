// START Toscana (Fase 2, terza priorità del documento 60; mandato del coordinamento del 26/11): lettura dell'ELENCO HTML pubblico delle
// procedure aperte di START (Sistema Telematico Acquisti Regionale della Toscana), UNA fonte «start» per tutti gli enti toscani che lo usano.
// Logica pura: nessuna rete, nessun database. La rete è in start.ts, la scrittura nel motore di unione unico (importa-regionali.ts).
//
// Decisioni del coordinamento del 26/11 (proposta di B2 confermata):
//   - SCADENZA: l'elenco non la dà. NESSUNA richiesta nuova ad ANAC: la gara START con i suoi CIG si unisce per CIG alla gara PVL/TED già in
//     archivio (in tutti e due gli ordini), e scadenza, ora e codice fiscale arrivano da lì; un valore vuoto non cancella mai quello di
//     un'altra fonte (unione-calcoli.ts). Senza CIG o fuori dalla PVL la scadenza resta VUOTA («non indicata»): mai 23:59, mai un'ora
//     presunta. L'API interna della scheda (applicazione Angular) NON è usata da nessun codice;
//   - CODICE FISCALE DELL'ENTE: solo dall'unione per CIG; per le gare solo START resta vuoto (come TuttoGare); nessuna deduzione dal nome;
//   - IDENTITÀ: la CHIAVE della gara è «start:NNNNNN-AAAA» (il numero START dei collegamenti ufficiali). piattaforma_id resta VUOTO: il
//     trattino non rispetta il vincolo della 0120 (decisione (b), come TuttoGare). Doppioni con le gare TED senza CIG: solo un SUGGERIMENTO
//     in console per stesso numero START nel collegamento (mai un'unione automatica, regola del 17/11);
//   - FINESTRA: robots.txt di start.toscana.it «Visit-time: 2300-0400», in UTC (oggi 00–05 ora italiana, d'estate 01–06). La guardia la
//     impone IN UTC a ogni giro, anche manuale, e prima di OGNI richiesta; mai /awards/ (esiti, vietati) né start.e.toscana.it (Disallow /);
//   - USCITA DALLE APERTE (1c): una gara SOLO START senza scadenza che non compare più nell'elenco delle aperte dopo un giro COMPLETO e
//     interamente RIUSCITO passa allo stato interno «sconosciuto» (etichetta «Stato non indicato», già esistente; mai «scaduta»); torna
//     «aperta» se riappare nell'elenco o se un'altra fonte le dà una scadenza. Funzione transizioniStatoStart.
//
// STRUTTURA DELL'ELENCO DA TARARE nella finestra notturna (letture autorizzate dal coordinamento): la ricognizione R2 (26/11) dà i campi
// (ente, numero START, oggetto, procedura, tipo, CIG «n/a», importo, stato, data di pubblicazione, collegamento), 10 per pagina, 154 aperte;
// NON dà i nomi esatti dei parametri di pagina e di filtro né il markup. Finché CANALE_START.confermato è false il lettore si ferma PRIMA di
// qualunque richiesta. Il parser è difensivo: tabella con intestazioni, oppure blocchi con «etichetta: valore» attorno al numero START.
import { classificaGara, type SettoreRadar } from "../settori";
import { maiuscoleIniziali, type IdRegione } from "../territorio";
import { entraInOpportunita, opportunita, type Opportunita } from "../opportunita-calcoli";
import { decodificaEntita, naturaAflink } from "./aflink-calcoli";
import { settoriDopoNatura } from "./natura-contratto";
import { giornoDiRoma, impronta, type ScadenzaTed } from "./ted-calcoli";
import { cigTuttoGare, giornoTuttoGare, importoTuttoGare, righeHtml, testoHtml } from "./tuttogare-calcoli";
import type { LimitiFonte } from "./sessione-fonte";
import type { RecordLotto, RecordProcedura } from "./tipi";

export const HOST_START = "start.toscana.it";

export const CANALE_START = {
  // struttura dell'elenco (parametri, markup, valori di procedura e tipo) DA CONFERMARE sulle pagine vere nella finestra notturna. Con false il
  // lettore si ferma prima di qualunque richiesta. Le altre guardie restano: solo staging (nessuna variabile di produzione), fuori da
  // console, cron e programmatore, e senza la riga accesa in radar_fonti_stato (0137 proposta, non applicata) il giro esce con «fonte_spenta»
  confermato: false as boolean,
  // l'elenco pubblico delle iniziative (R2)
  percorsoElenco: "/initiatives/list/",
  // filtro delle sole procedure aperte e parametro della pagina: DA CONFERMARE (nessun parametro indovinato viene mai chiesto: senza conferma
  // il lettore non parte)
  parametriAperte: {} as Readonly<Record<string, string>>,
  parametroPagina: "page",
  perPagina: 10,
  // robots.txt: «Visit-time: 2300-0400» (UTC). Un giro non parte se la finestra si chiude entro il margine (non finirebbe dentro)
  finestraUtc: { daOra: 23, aOra: 4 },
  margineChiusuraMinuti: 10,
  // una pagina dell'elenco di START nomina la piattaforma o la Regione Toscana: altrimenti non è la pagina attesa (verifica anti-robot, errore
  // travestito, cambio di software) → sospensione. DA CONFERMARE sulle pagine vere
  impronta: /start\.toscana\.it|regione toscana|sistema telematico acquisti/i,
  // ricognizione R2: licenza dei dati non dichiarata (regola regionale generale CC BY da ricerca, non specifica di START): da confermare
  attribuzione: "Regione Toscana – START, Sistema Telematico Acquisti Regionale della Toscana (dati pubblicati dagli enti)",
  licenza: "Da confermare: licenza dei dati di START non dichiarata (regola generale della Regione Toscana CC BY, non verificata per START)",
};

// circa 16 pagine per giro (154 aperte, 10 per pagina) più margine; pausa larga (lettura notturna, nessuna fretta)
export const LIMITI_START_PREDEFINITI: LimitiFonte = { pausaMs: 4_000, timeoutMs: 30_000, tentativi: 2, richiesteMassime: 24 };
export const LIMITI_START_INTERVALLI: Record<keyof LimitiFonte, { min: number; max: number }> = {
  pausaMs: { min: 3_000, max: 60_000 },
  timeoutMs: { min: 5_000, max: 60_000 },
  tentativi: { min: 1, max: 3 },
  richiesteMassime: { min: 2, max: 30 },
};

// ───── finestra di lettura (robots.txt, in UTC) ─────

/** Dentro la finestra «Visit-time: 2300-0400» del robots.txt, in UTC (dalle 23:00 incluse alle 04:00 escluse). */
export function dentroFinestraStart(adesso: Date): boolean {
  const h = adesso.getUTCHours();
  const { daOra, aOra } = CANALE_START.finestraUtc;
  return daOra > aOra ? h >= daOra || h < aOra : h >= daOra && h < aOra;
}

/** Un giro può PARTIRE: dentro la finestra e la finestra non si chiude entro il margine. Vale per ogni giro, anche manuale. */
export function giroAmmessoStart(adesso: Date): boolean {
  return dentroFinestraStart(adesso) && dentroFinestraStart(new Date(adesso.getTime() + CANALE_START.margineChiusuraMinuti * 60_000));
}

// ───── indirizzi: SOLO l'elenco pubblico delle aperte ─────

export function urlElencoStart(pagina: number): string | null {
  if (!Number.isInteger(pagina) || pagina < 1 || pagina > 200) return null;
  const q = new URLSearchParams(CANALE_START.parametriAperte);
  if (pagina > 1) q.set(CANALE_START.parametroPagina, String(pagina));
  const s = q.toString();
  return `https://${HOST_START}${CANALE_START.percorsoElenco}${s ? `?${s}` : ""}`;
}

/**
 * Un indirizzo si chiede SOLO se è https, sull'host esatto start.toscana.it, ed è l'elenco con i soli parametri dichiarati (filtro delle
 * aperte e numero di pagina). Mai /awards/ (esiti), mai start.e.toscana.it né altri host, mai download, mai la scheda (API interna).
 */
export function percorsoAmmessoStart(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.hostname.toLowerCase() !== HOST_START || u.port !== "" || u.username || u.password) return false;
  const p = u.pathname.toLowerCase();
  if (p.includes("..") || p.includes("/awards") || p.includes("download") || p.includes("/api/")) return false;
  if (p !== CANALE_START.percorsoElenco && `${p}/` !== CANALE_START.percorsoElenco) return false;
  for (const [k, v] of u.searchParams) {
    if (k === CANALE_START.parametroPagina) {
      if (!/^\d{1,3}$/.test(v)) return false;
    } else if (CANALE_START.parametriAperte[k] !== v) return false;
  }
  // ogni parametro del filtro dichiarato deve esserci (mai l'elenco completo di 25.000 iniziative per sbaglio)
  return Object.entries(CANALE_START.parametriAperte).every(([k, v]) => u.searchParams.get(k) === v);
}

/** La risposta è una pagina dell'elenco di START: HTML con l'impronta della piattaforma. */
export function sembraPaginaStart(testo: string): boolean {
  return /<html[\s>]/i.test(testo) && CANALE_START.impronta.test(testo);
}

// ───── numero START e collegamento ufficiale ─────

/** «038448-2026» (anche «038448/2026» come si scrive a volte) → «038448-2026»; altro → null. Anni dal 2000 al 2099. */
export function numeroStart(v: string | null | undefined): string | null {
  const m = (v ?? "").match(/(?<![\d])(\d{6})\s*[-/]\s*(20\d{2})(?![\d])/);
  return m ? `${m[1]}-${m[2]}` : null;
}

export function chiaveStart(numero: string): string {
  return `start:${numero}`;
}

/** Il collegamento ufficiale alla scheda, nella forma degli avvisi PVL e TED (43 su 59 nell'archivio dello staging il 26/11). */
export function urlSchedaStart(numero: string): string {
  return `https://${HOST_START}/tendering/tenders/${numero}/view/detail/1`;
}

/**
 * Il numero START di un collegamento alla scheda («…/tendering/tenders/038448-2026/view/detail/1»), anche negli avvisi TED e PVL (host con
 * «www.» o con il punto finale, http). Solo per i SUGGERIMENTI in console: mai un'unione automatica. Altro → null.
 */
export function numeroStartDaUrl(url: string | null | undefined): string | null {
  let u: URL;
  try {
    u = new URL((url ?? "").trim());
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (host !== HOST_START && host !== `www.${HOST_START}`) return null;
  const m = u.pathname.match(/^\/tendering\/tenders\/(\d{6})-(20\d{2})(?:\/|$)/);
  return m ? `${m[1]}-${m[2]}` : null;
}

// ───── elenco: le righe delle procedure ─────

export type RigaElencoStart = {
  numero: string;
  collegamento: string | null;
  ente: string | null;
  oggetto: string | null;
  procedura: string | null;
  tipo: string | null;
  cig: string | null;
  importo: string | null;
  stato: string | null;
  pubblicazione: string | null;
  // impronta dei campi letti: una riga uguale non riscrive nulla
  impronta: string;
};

export type ElencoStart = { righe: RigaElencoStart[]; totaleDichiarato: number | null; formato: "tabella" | "blocchi" | "nessuno" };

type Campo = Exclude<keyof RigaElencoStart, "numero" | "collegamento" | "impronta">;

// le intestazioni e le etichette dei campi (R2: ente, numero, oggetto, procedura, tipo, CIG, importo, stato, data di pubblicazione). DA
// CONFERMARE i testi esatti; l'ordine conta (la prima che combacia vince)
const ETICHETTE_START: readonly [RegExp, Campo | "numero"][] = [
  [/^cig\b/, "cig"],
  [/^(numero|n\.?|n°|codice|identificativo)\b/, "numero"],
  [/^(ente|amministrazione|stazione appaltante|committente)\b/, "ente"],
  [/^(oggetto|descrizione|titolo)\b/, "oggetto"],
  [/^(procedura|tipo di procedura|tipologia di procedura)\b/, "procedura"],
  [/^(tipo|tipologia)\b/, "tipo"],
  [/^(importo|valore|base)\b/, "importo"],
  [/^stato\b/, "stato"],
  [/^(data( di)? pubblicazione|pubblicat[oa]|pubblicazione|data)\b/, "pubblicazione"],
];

const norm = (t: string | null | undefined): string =>
  (t ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

function etichetta(cella: string): Campo | "numero" | null {
  const t = norm(cella).replace(/[:.]\s*$/, "");
  if (!t || t.length > 40) return null;
  for (const [re, campo] of ETICHETTE_START) if (re.test(t)) return campo;
  return null;
}

const HREF = /href\s*=\s*(["'])([^"']*)\1/gi;

// il collegamento alla scheda dentro un pezzo di HTML (solo sull'host di START, nella forma ufficiale)
function collegamentoNelBlocco(html: string): { url: string; numero: string } | null {
  for (const m of html.matchAll(HREF)) {
    try {
      const u = new URL(decodificaEntita(m[2].trim()), `https://${HOST_START}/`);
      const numero = numeroStartDaUrl(u.toString());
      if (numero && u.hostname.toLowerCase() === HOST_START) return { url: urlSchedaStart(numero), numero };
    } catch {
      // un collegamento illeggibile non è una scheda
    }
  }
  return null;
}

function rigaDaCampi(campi: Partial<Record<Campo, string>>, numero: string, collegamento: string | null): RigaElencoStart {
  const v = (c: Campo) => (campi[c] ?? "").trim().slice(0, c === "oggetto" ? 2000 : 300) || null;
  const r: Omit<RigaElencoStart, "impronta"> = { numero, collegamento, ente: v("ente"), oggetto: v("oggetto"), procedura: v("procedura"), tipo: v("tipo"), cig: v("cig"), importo: v("importo"), stato: v("stato"), pubblicazione: v("pubblicazione") };
  return { ...r, impronta: impronta(r) };
}

// tabella con le intestazioni: le colonne per nome (l'ordine può cambiare); il numero dalla sua colonna o dal collegamento della riga
function righeDaTabelle(html: string): RigaElencoStart[] {
  const out: RigaElencoStart[] = [];
  for (const t of html.matchAll(/<table\b[\s\S]*?<\/table\s*>/gi)) {
    const tabella = t[0];
    const intestazioni = [...tabella.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th\s*>/gi)].map((m) => etichetta(testoHtml(m[1], 200)));
    if (intestazioni.filter((x) => x).length < 3 || !intestazioni.includes("oggetto")) continue;
    for (const tr of tabella.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)) {
      const celle = [...tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td\s*>/gi)].map((m) => testoHtml(m[1], 2000));
      if (celle.length === 0) continue;
      const campi: Partial<Record<Campo, string>> = {};
      let numero: string | null = null;
      intestazioni.forEach((c, i) => {
        if (!c || celle[i] === undefined) return;
        if (c === "numero") numero = numeroStart(celle[i]);
        else campi[c] = celle[i];
      });
      const link = collegamentoNelBlocco(tr[1]);
      const n = numero ?? link?.numero ?? null;
      if (n) out.push(rigaDaCampi(campi, n, link && link.numero === n ? link.url : null));
    }
  }
  return out;
}

// blocchi (schede, voci di elenco): «Etichetta: valore» nella stessa cella o etichetta e valore in due celle vicine; il blocco è il più
// piccolo elemento attorno al collegamento della scheda che non contiene un'altra scheda
function numeroDaHref(href: string): string | null {
  try {
    return numeroStartDaUrl(new URL(decodificaEntita(href.trim()), `https://${HOST_START}/`).toString());
  } catch {
    return null;
  }
}

function righeDaBlocchi(html: string): RigaElencoStart[] {
  // per ogni numero, il blocco PIÙ PICCOLO che lo contiene da solo (mai il contenitore della pagina se ce n'è uno più stretto)
  const migliori = new Map<string, string>();
  const basso = html.toLowerCase();
  for (const m of html.matchAll(/<(div|li|article|section)\b[^>]*>/gi)) {
    const inizio = m.index ?? 0;
    const nome = m[1].toLowerCase();
    const fine = chiusura(basso, nome, inizio);
    if (fine < 0 || fine - inizio > 8_000) continue;
    const blocco = html.slice(inizio, fine);
    const schede = new Set([...blocco.matchAll(HREF)].map((h) => numeroDaHref(h[2])).filter((x): x is string => !!x));
    if (schede.size !== 1) continue;
    const numero = [...schede][0];
    const prima = migliori.get(numero);
    if (!prima || blocco.length < prima.length) migliori.set(numero, blocco);
  }
  const out: RigaElencoStart[] = [];
  for (const [numero, blocco] of migliori) {
    const campi: Partial<Record<Campo, string>> = {};
    const celle = righeHtml(blocco).flat();
    for (let i = 0; i < celle.length; i++) {
      const c = celle[i];
      const coppia = c.match(/^([^:]{1,40}):\s*(.+)$/);
      const e = coppia ? etichetta(coppia[1]) : etichetta(c);
      if (!e || e === "numero") continue;
      // «Etichetta: valore» nella stessa cella: il valore è quello («Procedura: Procedura negoziata», «CIG: n/a»); etichetta da sola: il
      // valore è la cella dopo, purché non sia a sua volta un'etichetta
      const valore = coppia ? coppia[2] : celle[i + 1] && !etichetta(celle[i + 1]) ? celle[i + 1] : null;
      if (valore && campi[e] === undefined) campi[e] = valore;
    }
    // senza un oggetto etichettato: il testo del collegamento alla scheda (il titolo della riga), se non è «dettaglio», «vedi»…
    if (!campi.oggetto) {
      for (const a of blocco.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
        const href = a[1].match(/href\s*=\s*(["'])([^"']*)\1/i)?.[2];
        const t = testoHtml(a[2], 2000);
        if (href && numeroDaHref(href) === numero && t.length > 15 && !/^(vedi|dettagli?|apri|scheda)\b/i.test(t)) {
          campi.oggetto = t;
          break;
        }
      }
    }
    if (!campi.oggetto) continue;
    out.push(rigaDaCampi(campi, numero, urlSchedaStart(numero)));
  }
  return out;
}

// La chiusura dell'elemento «nome» aperto in «inizio» (tag annidati dello stesso nome contati); -1 se non si chiude.
function chiusura(basso: string, nome: string, inizio: number): number {
  const re = new RegExp(`<(/?)${nome}\\b[^>]*>`, "g");
  re.lastIndex = inizio;
  let livello = 0;
  for (let m = re.exec(basso); m; m = re.exec(basso)) {
    livello += m[1] ? -1 : 1;
    if (livello === 0) return m.index + m[0].length;
  }
  return -1;
}

// «154 risultati», «Risultati 1 - 10 di 154», «154 iniziative trovate»: il totale dichiarato dall'elenco (DA CONFERMARE la forma); altro → null
export function totaleDichiaratoStart(html: string): number | null {
  const t = testoHtml(html, 200_000);
  const m = t.match(/\bdi\s+(\d{1,3}(?:\.\d{3})*|\d+)\s+(?:risultat|iniziativ|procedur|element)/i) ?? t.match(/(\d{1,3}(?:\.\d{3})*|\d+)\s+(?:risultati|iniziative|procedure|elementi)\s+(?:trovat|totali)/i);
  if (!m) return null;
  const n = Number(m[1].replace(/\./g, ""));
  return Number.isInteger(n) && n >= 0 && n < 1_000_000 ? n : null;
}

/** Le righe di una pagina dell'elenco: prima la tabella con intestazioni, poi i blocchi. Doppioni (stesso numero) tolti. */
export function leggiElencoStart(html: string): ElencoStart {
  const totaleDichiarato = totaleDichiaratoStart(html);
  const unici = (r: RigaElencoStart[]) => r.filter((x, i) => r.findIndex((y) => y.numero === x.numero) === i);
  const tabella = unici(righeDaTabelle(html));
  if (tabella.length > 0) return { righe: tabella, totaleDichiarato, formato: "tabella" };
  const blocchi = unici(righeDaBlocchi(html));
  return { righe: blocchi, totaleDichiarato, formato: blocchi.length > 0 ? "blocchi" : "nessuno" };
}

// ───── tipo di opportunità (regole comuni, decisioni del coordinamento) ─────

/**
 * Procedura e tipo dell'elenco, e oggetto → tipo di opportunità. Stesse regole delle altre fonti:
 *   - affidamento diretto → affidamento (fuori dalle opportunità);
 *   - manifestazione d'interesse, avviso esplorativo → manifestazione di interesse; indagine di mercato → indagine di mercato (candidature,
 *     spesso SENZA CIG: il valore principale di START);
 *   - aperta, ristretta, competitiva con negoziazione, dialogo competitivo, negoziata CON previa pubblicazione → bando;
 *   - negoziata senza previa pubblicazione → riservata (fuori), salvo che procedura, tipo o oggetto dichiarino la raccolta di candidature;
 *   - albo, elenco, sistema di qualificazione, SDA istitutivo → iscrizione; appalto specifico di un SDA → riservata;
 *   - «richiesta di preventivi»: candidatura SOLO se dichiarata aperta o pubblica; altrimenti sconosciuta (mai presentata come aperta a tutti
 *     una richiesta che può essere su invito: da confermare sui valori veri);
 *   - consultazione preliminare di mercato: NESSUN tipo di opportunità esistente la descrive (non è una gara né una candidatura): null,
 *     contata a parte («consultazione_preliminare»), decisione da chiedere;
 *   - valori sconosciuti → null (la gara non entra finché la regola non si aggiorna; mai indovinare).
 */
export function opportunitaStart(procedura: string | null | undefined, tipo: string | null | undefined, oggetto: string | null | undefined): Opportunita | null {
  const p = norm(procedura);
  const t = norm(tipo);
  const o = norm(oggetto);
  const candidatura = (x: string): Opportunita | null => {
    if (/manifestazion[ei] d[i']\s*interesse|avviso esplorativo|expressions? of interest/.test(x)) return opportunita("manifestazione_interesse");
    if (/indagin[ei] di mercato/.test(x)) return opportunita("indagine_mercato");
    return null;
  };
  if (consultazionePreliminare(procedura, tipo, oggetto)) return null;
  const pt = `${p} ${t}`.trim();
  if (/affidamento diretto/.test(pt)) return candidatura(o) ?? opportunita("affidamento_diretto");
  // la raccolta di candidature dichiarata da procedura o tipo («Manifestazione di interesse», «Indagine di mercato»)
  const dichiarata = candidatura(t) ?? (/negoziata/.test(p) ? null : candidatura(p));
  if (dichiarata) return dichiarata;
  if (/richiesta di preventiv/.test(pt)) return /apert|pubblic/.test(pt) ? opportunita("indagine_mercato") : null;
  if (/appalto specifico/.test(pt)) return opportunita("riservata");
  if (/negoziata/.test(p)) return /previa (pubblicazione|indizione)|con bando/.test(p) ? opportunita("bando") : (candidatura(o) ?? opportunita("riservata"));
  if (/aperta|ristretta|competitiva con negoziazione|dialogo competitivo|partenariato per l.innovazione/.test(p)) return opportunita("bando");
  if (/\balbo\b|\belenco\b|sistema di qualificazione|sistema dinamico/.test(pt)) return opportunita("sistema_qualificazione");
  if (!p) return candidatura(o);
  return null;
}

export function consultazionePreliminare(procedura: string | null | undefined, tipo: string | null | undefined, oggetto: string | null | undefined): boolean {
  return /consultazion[ei] preliminar/.test(`${norm(procedura)} ${norm(tipo)} ${norm(oggetto)}`);
}

/** La procedura nella forma dell'archivio (come le altre piattaforme); null se non riconosciuta. */
export function tipoProceduraStart(procedura: string | null | undefined): string | null {
  const p = norm(procedura);
  if (/competitiva con negoziazione/.test(p)) return "Procedura competitiva con negoziazione";
  if (/dialogo competitivo/.test(p)) return "Dialogo competitivo";
  if (/ristretta/.test(p)) return "Procedura ristretta";
  if (/negoziata/.test(p)) return "Procedura negoziata";
  if (/affidamento diretto/.test(p)) return "Affidamento diretto";
  if (/aperta/.test(p) && !/preventiv/.test(p)) return "Procedura aperta";
  return null;
}

/** Lo stato dell'elenco dice che la procedura NON è aperta (chiusa, scaduta, aggiudicata, revocata, annullata, sospesa)? Vuoto = aperta. */
export function statoNonApertoStart(stato: string | null | undefined): boolean {
  return /chius|scadut|aggiudicat|revocat|annullat|sospes|conclus|esitat|deserta/.test(norm(stato));
}

// L'ente: il nome com'è scritto, SENZA codice fiscale (solo dall'unione per CIG); il comune solo da «Comune di …». Regione: Toscana (START è
// la piattaforma regionale degli enti toscani, R2).
export function enteStart(nome: string | null | undefined): { denominazione: string | null; comune: string | null } {
  const d = (nome ?? "").replace(/\s+/g, " ").trim().slice(0, 300) || null;
  const comune = d?.match(/^comune di\s+(.+)$/i)?.[1] ?? null;
  return { denominazione: d, comune: comune ? maiuscoleIniziali(comune) : null };
}

export const REGIONE_START: IdRegione = "toscana";

// ───── una riga → bando o esclusione ─────

export type MotivoEsclusioneStart =
  | "senza_identificativo" | "senza_oggetto" | "esclusa_per_oggetto" | "fuori_settore" | "riservata" | "affidamento" | "tipo_sconosciuto" | "consultazione_preliminare" | "non_aperta";

export type MetaStart = {
  // «038448-2026»: identificativo della procedura nella fonte (id_fonte)
  numero: string;
  // «start:038448-2026»: identità della gara, cioè la sua CHIAVE. NON va in piattaforma_id (vincolo della 0120; decisione (b))
  chiave: string;
};

export type BandoStart = {
  tipo: "bando";
  meta: MetaStart;
  record: RecordProcedura;
  opportunita: Opportunita;
  procedura: string | null;
  settori: SettoreRadar[];
  metodoSettore: "cpv" | "parole_chiave";
  regioni: IdRegione[];
  scadenzaFonte: string | null;
  lottiScadenze: (ScadenzaTed | null)[];
  lottiDocumenti: (string | null)[];
  mancanti: string[];
};

export type EsclusioneStart = { tipo: "esclusione"; meta: MetaStart | null; motivo: MotivoEsclusioneStart; regole?: string[] };

export type GaraStartLetta = BandoStart | EsclusioneStart;

export function leggiGaraStart(riga: RigaElencoStart, adesso: Date): GaraStartLetta {
  const numero = numeroStart(riga.numero);
  if (!numero || numero !== riga.numero) return { tipo: "esclusione", meta: null, motivo: "senza_identificativo" };
  const meta: MetaStart = { numero, chiave: chiaveStart(numero) };
  const esclusione = (motivo: MotivoEsclusioneStart): EsclusioneStart => ({ tipo: "esclusione", meta, motivo });

  const titolo = (riga.oggetto ?? "").replace(/\s+/g, " ").trim().slice(0, 4000);
  if (!titolo) return esclusione("senza_oggetto");
  if (statoNonApertoStart(riga.stato)) return esclusione("non_aperta");
  if (consultazionePreliminare(riga.procedura, riga.tipo, titolo)) return esclusione("consultazione_preliminare");
  const opp = opportunitaStart(riga.procedura, riga.tipo, titolo);
  if (!opp) return esclusione("tipo_sconosciuto");
  if (opp.tipo === "affidamento_diretto") return esclusione("affidamento");
  if (!entraInOpportunita(opp)) return esclusione("riservata");

  // nessun CPV nell'elenco: classificazione sul testo dell'oggetto con le regole comuni (natura dal tipo, se è lavori/servizi/forniture)
  const natura = naturaAflink(riga.tipo) ?? naturaAflink(riga.procedura);
  const classificazione = classificaGara({ cpvPrincipale: null, cpvTutti: [], testo: titolo });
  if (classificazione.settori.length === 0) return classificazione.esclusioni.length > 0 ? { ...esclusione("esclusa_per_oggetto"), regole: [...new Set(classificazione.esclusioni.map((x) => x.regola))] } : esclusione("fuori_settore");
  const settoriTenuti = settoriDopoNatura(classificazione, natura);
  if (settoriTenuti.length === 0) return esclusione("fuori_settore");

  // la scadenza NON è nell'elenco: resta vuota (mai presunta); arriva dalla PVL con l'unione per CIG
  const mancanti: string[] = ["scadenza", "cpv", "luogo_esecuzione", "codice_fiscale_ente"];
  const importo = importoTuttoGare(riga.importo);
  if (importo === null) mancanti.push("valore");
  // «n/a» o vuoto: nessun CIG (le candidature spesso non lo hanno), mai inventato
  const cig = cigTuttoGare(riga.cig);
  if (cig.length === 0) mancanti.push("cig");
  const lotti: RecordLotto[] = cig.map((c, i) => ({ cig: c, numero: `LOT-${String(i + 1).padStart(4, "0")}`, oggetto: null, cpvPrincipale: null, cpvTutti: [], valoreStimato: null, valoreBase: null, oneriSicurezza: null, durataMesi: null, opzioniRinnovi: null }));
  const ente = enteStart(riga.ente);
  if (!ente.denominazione) mancanti.push("ente");
  const pagina = riga.collegamento ?? urlSchedaStart(numero);
  const procedura = (riga.procedura ?? "").trim().slice(0, 200) || null;

  const record: RecordProcedura = {
    fonte: "regionale",
    idFonte: numero,
    chiaveProcedura: meta.chiave,
    oggetto: titolo,
    descrizione: null,
    ente: { codiceFiscale: null, denominazione: ente.denominazione, comune: ente.comune, provincia: null, regione: REGIONE_START, luogoIstat: null, nuts: null },
    tipoAvviso: opp.tipo === "bando" || opp.tipo === "sistema_qualificazione" ? "Bando" : "Avviso",
    tipoProcedura: tipoProceduraStart(procedura),
    criterioAggiudicazione: null,
    natura,
    settoriSpeciali: null,
    dataPubblicazione: giornoTuttoGare(riga.pubblicazione),
    scadenzaGiorno: null,
    scadenzaOfferte: null,
    scadenzaOraIndicata: false,
    valoreStimato: null,
    valoreBase: importo,
    oneriSicurezza: null,
    durataMesi: null,
    annullata: false,
    // la scheda ufficiale della procedura (stessa forma dei collegamenti di PVL e TED); mai documenti, esiti o API
    urlAvviso: pagina,
    urlDocumenti: pagina,
    cpvPrincipale: null,
    cpvTutti: [],
    lotti,
    impronta: "",
  };
  record.impronta = impronta({ ...record, impronta: null, settori: settoriTenuti, opportunita: opp.tipo });
  void adesso;

  return {
    tipo: "bando",
    meta,
    record,
    opportunita: opp,
    procedura,
    settori: settoriTenuti,
    metodoSettore: classificazione.metodo ?? "parole_chiave",
    regioni: [REGIONE_START],
    scadenzaFonte: null,
    lottiScadenze: lotti.map(() => null),
    lottiDocumenti: lotti.map(() => pagina),
    mancanti,
  };
}

// ───── giro completo e uscita dalle aperte (1c) ─────

/**
 * Un giro è COMPLETO solo se tutte le pagine dell'elenco sono state lette senza errori: con il totale dichiarato, i numeri distinti letti
 * sono almeno quel totale; senza, l'ultima pagina letta è più corta di una pagina piena. Una pagina che ripete solo numeri già visti (la pagina
 * non è cambiata: parametro non riconosciuto) NON chiude l'elenco: il giro non è completo.
 */
export function elencoCompletoStart(e: { pagine: number; numeri: number; ultimaPaginaRighe: number; totaleDichiarato: number | null; paginaRipetuta: boolean; errore: boolean }): boolean {
  if (e.errore || e.paginaRipetuta || e.pagine < 1) return false;
  if (e.totaleDichiarato !== null) return e.numeri >= e.totaleDichiarato;
  return e.ultimaPaginaRighe < CANALE_START.perPagina;
}

export type GaraStartInArchivio = { id: string; chiave: string; stato: string; scadenza_giorno: string | null; fonti: readonly string[] | null };

/**
 * Le transizioni di stato dopo un giro (decisione 1c del coordinamento, tre paletti):
 *   - ESCONO dalle aperte (stato «sconosciuto», etichetta «Stato non indicato»; mai «scaduta») SOLO dopo un giro COMPLETO e interamente
 *     RIUSCITO, e SOLO le gare nate da START (chiave «start:…»), con START come UNICA fonte, senza scadenza, aperte e non più nell'elenco;
 *   - RIENTRANO («aperta») le gare in «sconosciuto» con START tra le fonti che riappaiono nell'elenco o che hanno ora una scadenza (data da
 *     un'altra fonte unita dopo): reversibile, anche dopo un giro non completo (è un'evidenza positiva).
 * Lo stato «sconosciuto» lo scrive solo questa regola (nessun importatore lo produce), quindi il rientro tocca solo ciò che lei ha fatto uscire.
 */
export function transizioniStatoStart(gare: readonly GaraStartInArchivio[], numeriInElenco: ReadonlySet<string>, giroCompletoERiuscito: boolean): { escono: string[]; rientrano: string[] } {
  const escono: string[] = [];
  const rientrano: string[] = [];
  for (const g of gare) {
    const fonti = g.fonti ?? [];
    if (!fonti.includes("start")) continue;
    const numero = g.chiave.startsWith("start:") ? g.chiave.slice("start:".length) : null;
    const inElenco = !!numero && numeriInElenco.has(numero);
    if (g.stato === "sconosciuto") {
      if (inElenco || g.scadenza_giorno) rientrano.push(g.id);
    } else if (g.stato === "aperta" && giroCompletoERiuscito && numero && !inElenco && !g.scadenza_giorno && fonti.length === 1) {
      escono.push(g.id);
    }
  }
  return { escono, rientrano };
}

/** Il giorno di oggi per la versione (come TuttoGare: l'elenco non dà una data di modifica). */
export function giornoVersioneStart(adesso: Date): string {
  return giornoDiRoma(adesso);
}
