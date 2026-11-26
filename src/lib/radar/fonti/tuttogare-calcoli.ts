// TuttoGare (Fase 2, seconda priorità del documento 60): lettura delle istanze «TuttoGare PA» (Studio Amica) con UNA fonte «tuttogare» per
// molti enti. Logica pura: nessuna rete, nessun database. La rete è in tuttogare.ts, la scrittura nel motore di unione unico
// (importa-regionali.ts). Anagrafica delle istanze in tuttogare-istanze.ts.
//
// Canale (decisione del coordinamento del 26/11, ricognizione R4): la HOME HTML di ogni istanza (tutte le gare «Pubblicato», resa dal server,
// senza JavaScript) dà i codici delle gare; il DETTAGLIO HTML «/gare/dettaglio.php?codice=N» dà i campi. robots.txt (identico sulle tre
// istanze di R4): «Disallow /documenti/», «Disallow /allegati/», «Allow /»: si leggono SOLO la home e il dettaglio (percorsoAmmessoTuttoGare),
// mai documenti o allegati. Il JSON interno «/gare/table.php» (DataTables) NON è documentato: è predisposto e SPENTO (jsonInterno.acceso).
//
// MAPPA DEI CAMPI CONFERMATA sul campione del coordinamento del 26/11 (Roma, Uniba, CUC Terra di Leuca; come il 60C di SATER): etichette del
// dettaglio (ETICHETTE_TUTTOGARE), date, importo, CPV delle categorie merceologiche, schede della home con il badge della procedura. Se le
// etichette obbligatorie mancano in TUTTI i dettagli letti, il formato è cambiato: la fonte si sospende e non si scrive nulla. NON verificato
// sul campione: più CIG nella stessa gara (nessuna gara a più lotti): la lettura resta difensiva (tutti i CIG del campo).
//
// Cosa NON si legge mai: documenti e allegati (robots.txt), referenti, email e telefoni (le celle non dichiarate si scartano subito).
import { classificaGara, normalizzaCpv, type SettoreRadar } from "../settori";
import { maiuscoleIniziali, type IdRegione } from "../territorio";
import { entraInOpportunita, opportunita, type Opportunita } from "../opportunita-calcoli";
import { decodificaEntita, importoAflink, naturaAflink, proceduraDallOggettoAflink } from "./aflink-calcoli";
import { idPiattaformaDaUrlConnettore } from "./piattaforme-calcoli";
import { cigSintel } from "./sintel-calcoli";
import { giornoDiRoma, impronta, type ScadenzaTed } from "./ted-calcoli";
import { settoriDopoNatura } from "./natura-contratto";
import { ISTANZE_TUTTOGARE, PERCORSO_DETTAGLIO_TUTTOGARE, type EnteTuttoGare, type IstanzaTuttoGare } from "./tuttogare-istanze";
import { istanteScadenza } from "../../omnia-ai-revisione-calcoli";
import type { LimitiFonte } from "./sessione-fonte";
import type { RecordLotto, RecordProcedura } from "./tipi";

export const CANALE_TUTTOGARE = {
  // mappa dei campi CONFERMATA sul campione del coordinamento del 26/11 (Roma, Uniba, CUC Terra di Leuca; 16 richieste, robots rispettato),
  // con le correzioni applicate (etichette «Importo base», «Pubblicazione», «Scadenza presentazione»; nessun campo «Stato»; impronta
  // StudioAmica; schede della home con il badge della procedura). Con false il lettore si ferma prima di qualunque richiesta. Le altre
  // guardie restano: solo staging (nessuna variabile di produzione), fuori da console, cron e programmatore, e senza la riga accesa in
  // radar_fonti_stato (migrazione proposta, non applicata) il giro esce con «fonte_spenta»
  confermato: true as boolean,
  // «html» = home + dettaglio (decisione del coordinamento del 26/11); «json» solo se l'HTML non basta, con jsonInterno acceso
  canale: "html" as "html" | "json",
  // il JSON interno della tabella delle gare: NON documentato (rischio: può cambiare o sparire senza avviso). Spento: non si chiama mai
  jsonInterno: { acceso: false as boolean, percorso: "/gare/table.php" },
  // impronta del software: «StudioAmica» (carattere StudioAmica.woff2), presente su tutte le istanze del campione. Una pagina senza non è una
  // pagina TuttoGare (verifica anti-robot, errore travestito, cambio di software) → sospensione. Il collegamento ad app.tuttogare.it NON
  // basta e non serve: manca nelle istanze personalizzate (Roma, campione del 26/11)
  impronta: /studioamica/i,
  // una gara già letta si rilegge se la sua riga della home cambia, o comunque dopo questi giorni (proroghe non visibili nella home)
  rileggiDopoGiorni: 7,
  // R4: norme tecniche senza licenza dei dati né divieto di riuso; riuso commerciale da far confermare all'avvocato (D.Lgs. 33/2013 art. 7)
  // per il cliente senza il nome del software (indicazione del coordinamento del 26/11)
  attribuzione: "Piattaforme telematiche delle stazioni appaltanti (dati pubblicati dagli enti)",
  licenza: "Da confermare: nessuna licenza dei dati né divieto di riuso nelle norme tecniche delle piattaforme (parere legale richiesto)",
};

// richieste per giro su TUTTE le istanze (home + dettagli); il tetto di ogni istanza è in anagrafica. Le gare non lette si leggono ai giri
// seguenti (allarme «dettagli_rimandati»)
export const LIMITI_TUTTOGARE_PREDEFINITI: LimitiFonte = { pausaMs: 2_500, timeoutMs: 30_000, tentativi: 2, richiesteMassime: 30 };
export const LIMITI_TUTTOGARE_INTERVALLI: Record<keyof LimitiFonte, { min: number; max: number }> = {
  pausaMs: { min: 2_000, max: 60_000 },
  timeoutMs: { min: 5_000, max: 60_000 },
  tentativi: { min: 1, max: 3 },
  richiesteMassime: { min: 2, max: 40 },
};

export function istanzeAttiveTuttoGare(): IstanzaTuttoGare[] {
  return ISTANZE_TUTTOGARE.filter((i) => i.attiva);
}

// ───── indirizzi: SOLO home e dettaglio (robots.txt), sull'host canonico dell'istanza ─────

export function urlHomeTuttoGare(istanza: IstanzaTuttoGare): string {
  return `https://${istanza.host}/`;
}

export function urlDettaglioTuttoGare(istanza: IstanzaTuttoGare, codice: string): string | null {
  return /^\d{1,12}$/.test(codice) ? `https://${istanza.host}${PERCORSO_DETTAGLIO_TUTTOGARE}?codice=${codice}` : null;
}

// il JSON interno: null finché è spento (nessun indirizzo, nessuna richiesta)
export function urlTabellaTuttoGare(istanza: IstanzaTuttoGare): string | null {
  return CANALE_TUTTOGARE.jsonInterno.acceso ? `https://${istanza.host}${CANALE_TUTTOGARE.jsonInterno.percorso}` : null;
}

/** Un indirizzo si chiede SOLO se è https, sull'host canonico dell'istanza, ed è la home, il dettaglio o (se acceso) il JSON interno. */
export function percorsoAmmessoTuttoGare(url: string, istanza: IstanzaTuttoGare): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.hostname.toLowerCase() !== istanza.host || u.port !== "" || u.username || u.password) return false;
  const p = u.pathname.toLowerCase();
  // robots.txt delle istanze: «Disallow /documenti/», «Disallow /allegati/» (controllo esplicito, anche se le altre regole già li escludono)
  if (p.startsWith("/documenti/") || p.startsWith("/allegati/") || p.includes("..")) return false;
  if (p === "/") return u.search === "";
  if (p === PERCORSO_DETTAGLIO_TUTTOGARE) return /^\?codice=\d{1,12}$/.test(u.search);
  if (p === CANALE_TUTTOGARE.jsonInterno.percorso) return CANALE_TUTTOGARE.jsonInterno.acceso;
  return false;
}

/** La risposta è una pagina TuttoGare: HTML con l'impronta del software (StudioAmica). */
export function sembraPaginaTuttoGare(testo: string): boolean {
  return /<html[\s>]/i.test(testo) && CANALE_TUTTOGARE.impronta.test(testo);
}

// ───── HTML: testo e celle (senza dipendenze; il formato è quello dichiarato e controllato) ─────

const BLOCCHI = /<\/?(?:td|th|tr|thead|tbody|table|div|p|li|ul|ol|dl|dt|dd|h[1-6]|label|strong|b|section|article|header|footer|span|br|hr)\b[^>]*>/gi;

function senzaScript(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|head|noscript|svg)\b[\s\S]*?<\/\1\s*>/gi, " ");
}

/** Il testo di un pezzo di HTML: tag tolti, entità decodificate, spazi ridotti. */
export function testoHtml(html: string, max = 4000): string {
  return decodificaEntita(senzaScript(html).replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Le celle di testo di una pagina, nell'ordine: ogni elemento di blocco (cella, riga, paragrafo, etichetta…) chiude una cella. */
export function celleHtml(html: string): string[] {
  return righeHtml(html).flat();
}

// fine di una «riga» della pagina: riga di tabella, paragrafo, voce di una lista di definizioni, fine tabella, titolo, piè o testata
const FINE_RIGA = /<\/(?:tr|p|dd|dl|table|h[1-6]|section|article)\s*>|<(?:hr|footer|header)\b[^>]*>/gi;

/** Le righe della pagina (riga di tabella, paragrafo…), ognuna con le sue celle: il valore di un'etichetta non esce dalla sua riga. */
export function righeHtml(html: string): string[][] {
  return senzaScript(html)
    .split(FINE_RIGA)
    .map((r) =>
      decodificaEntita(r.replace(BLOCCHI, "\u0001").replace(/<[^>]+>/g, " "))
        .split("\u0001")
        .map((c) => c.replace(/\s+/g, " ").trim())
        .filter(Boolean),
    )
    .filter((r) => r.length > 0);
}

// ───── home: i codici delle gare pubblicate, con il testo della loro riga ─────

// La gara nella home (campione del 26/11): una scheda Bootstrap («div.card») con due collegamenti al dettaglio (titolo = oggetto, «Vedi
// dettagli»), il badge della PROCEDURA («badge-primary»), quello della TIPOLOGIA («badge-info») e la scadenza. Nessun campo «Stato»: la
// home elenca solo le gare pubblicate (esiti e aggiudicazioni non compaiono).
export type RigaHomeTuttoGare = { codice: string; testo: string; impronta: string; oggetto: string | null; procedura: string | null; tipologia: string | null };

// il testo del primo elemento con la classe data (badge della scheda), o null
function testoConClasse(html: string, classe: string): string | null {
  const m = html.match(new RegExp(`<(span|div|a|small|label|strong)\\b[^>]*class\\s*=\\s*["'][^"']*\\b${classe}\\b[^"']*["'][^>]*>([\\s\\S]*?)</\\1\\s*>`, "i"));
  return m ? testoHtml(m[2], 200) || null : null;
}

// il testo del primo collegamento al dettaglio con un testo (il titolo della scheda = l'oggetto); «Vedi dettagli» non è un oggetto
function oggettoDellaRiga(html: string, istanza: IstanzaTuttoGare): string | null {
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const href = m[1].match(/href\s*=\s*(["'])([^"']*)\1/i)?.[2];
    const t = testoHtml(m[2], 1000);
    if (href && codiceDaHref(href, istanza) && t && !/^vedi\b/i.test(t)) return t;
  }
  return null;
}

const HREF_DETTAGLIO = /href\s*=\s*(["'])([^"']*dettaglio\.php\?[^"']*)\1/gi;

function codiceDaHref(href: string, istanza: IstanzaTuttoGare): string | null {
  try {
    const u = new URL(decodificaEntita(href.trim()), urlHomeTuttoGare(istanza));
    if (u.hostname.toLowerCase() !== istanza.host && !istanza.alias.includes(u.hostname.toLowerCase())) return null;
    if (u.pathname !== PERCORSO_DETTAGLIO_TUTTOGARE) return null;
    const c = u.searchParams.getAll("codice");
    return c.length === 1 && /^\d{1,12}$/.test(c[0]) ? c[0] : null;
  } catch {
    return null;
  }
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

// La riga della gara nella home: la SCHEDA («div.card», confermata sul campione del 26/11) che contiene il collegamento e nessun collegamento
// a un'altra gara; in mancanza (difesa per istanze diverse) la riga di tabella o la voce di elenco, poi un blocco di al più 6.000 caratteri;
// altrimenti il tratto tra i collegamenti vicini.
function rigaAttorno(html: string, basso: string, pos: number, fine: number, prima: number, dopo: number): string {
  for (const [nomi, soloSchede] of [[["div"], true], [["tr", "li"], false], [["div", "article", "section"], false]] as const) {
    let scelto: [number, number] | null = null;
    for (const m of basso.slice(Math.max(prima, 0), pos).matchAll(new RegExp(`<(${nomi.join("|")})\\b[^>]*>`, "g"))) {
      if (soloSchede && !/\bclass\s*=\s*["'](?:[^"']*\s)?card(?:\s[^"']*)?["']/.test(m[0])) continue;
      const a = Math.max(prima, 0) + (m.index ?? 0);
      const c = chiusura(basso, m[1], a);
      if (c >= fine && c <= dopo && (nomi[0] === "tr" || c - a <= 6000) && (!scelto || a < scelto[0])) scelto = [a, c];
    }
    if (scelto) return html.slice(scelto[0], scelto[1]);
  }
  // nessun elemento adatto: il tratto tra i collegamenti vicini (tag tagliati esclusi), al più 1.500 caratteri per parte
  const da = prima >= 0 ? basso.indexOf(">", prima) + 1 : 0;
  const a = basso.lastIndexOf("<", dopo);
  return html.slice(Math.max(da, pos - 1500), Math.min(a > fine ? a : dopo, fine + 1500));
}

/** La home di un'istanza → le righe delle gare (una per codice, nell'ordine della pagina). */
export function leggiHomeTuttoGare(html: string, istanza: IstanzaTuttoGare): RigaHomeTuttoGare[] {
  const pulito = senzaScript(html);
  const basso = pulito.toLowerCase();
  const link: { codice: string; pos: number; fine: number }[] = [];
  for (const m of pulito.matchAll(HREF_DETTAGLIO)) {
    const codice = codiceDaHref(m[2], istanza);
    if (codice) link.push({ codice, pos: m.index ?? 0, fine: (m.index ?? 0) + m[0].length });
  }
  const righe: RigaHomeTuttoGare[] = [];
  const visti = new Set<string>();
  for (let i = 0; i < link.length; i++) {
    const l = link[i];
    if (visti.has(l.codice)) continue;
    visti.add(l.codice);
    // confini: l'ultimo collegamento a un'ALTRA gara prima e il primo dopo (più collegamenti alla stessa gara stanno nella stessa riga)
    const primaAltra = [...link.slice(0, i)].reverse().find((x) => x.codice !== l.codice);
    const dopoAltra = link.slice(i + 1).find((x) => x.codice !== l.codice);
    const html = rigaAttorno(pulito, basso, l.pos, l.fine, primaAltra ? primaAltra.fine : -1, dopoAltra ? dopoAltra.pos : pulito.length);
    const testo = testoHtml(html, 2000);
    righe.push({ codice: l.codice, testo, impronta: impronta({ codice: l.codice, testo }), oggetto: oggettoDellaRiga(html, istanza), procedura: testoConClasse(html, "badge-primary"), tipologia: testoConClasse(html, "badge-info") });
  }
  return righe.slice(0, 2000);
}

// Il JSON interno (DataTables) → le stesse righe della home. PREDISPOSTO E SPENTO: si usa solo con jsonInterno.acceso. Forma attesa (R4,
// non documentata): { data: [ [celle…] | {…} ], recordsTotal? }; il codice dalla cella con il collegamento al dettaglio.
export function leggiTabellaTuttoGare(testo: string, istanza: IstanzaTuttoGare): { righe: RigaHomeTuttoGare[]; totale: number | null } | { errore: string } {
  let j: unknown;
  try {
    j = JSON.parse(testo);
  } catch {
    return { errore: "la risposta non è JSON" };
  }
  const dati = j && typeof j === "object" ? (j as { data?: unknown }).data : null;
  if (!Array.isArray(dati)) return { errore: "la risposta non è la tabella delle gare (manca «data»)" };
  const righe: RigaHomeTuttoGare[] = [];
  for (const r of dati.slice(0, 2000)) {
    const celle = (Array.isArray(r) ? r : r && typeof r === "object" ? Object.values(r) : []).filter((c): c is string | number => typeof c === "string" || typeof c === "number").map(String);
    const html = celle.join(" </td><td> ");
    const codice = [...html.matchAll(HREF_DETTAGLIO)].map((m) => codiceDaHref(m[2], istanza)).find((c) => c !== null) ?? null;
    if (!codice || righe.some((x) => x.codice === codice)) continue;
    const t = celle.map((c) => testoHtml(c, 500)).filter(Boolean).join(" | ").slice(0, 2000);
    // il JSON (spento) non ha il badge della procedura in una colonna propria: senza esclusione dalla riga, decide il dettaglio
    righe.push({ codice, testo: t, impronta: impronta({ codice, testo: t }), oggetto: null, procedura: null, tipologia: null });
  }
  const totale = Number((j as { recordsTotal?: unknown }).recordsTotal);
  if (righe.length === 0 && Number.isFinite(totale) && totale > 0) return { errore: "la tabella dichiara gare ma non ne contiene di leggibili" };
  return { righe, totale: Number.isFinite(totale) ? totale : null };
}

// ───── dettaglio: le etichette dichiarate → i campi ─────

// UNA etichetta per campo (nessun nome alternativo provato a caso), CONFERMATA sul campione del 26/11 (coppie etichetta-valore del
// dettaglio). Si confronta il testo intero della cella (minuscole, senza accenti, senza i due punti finali); anche «Etichetta: valore» nella
// stessa cella. Il campo «Stato» NON esiste nell'HTML (né in home né nel dettaglio): non si legge. Il CIG è il testo di un collegamento ai
// dati di ANAC (si legge il testo, mai l'indirizzo); il beneficiario non ha codice fiscale.
export const ETICHETTE_TUTTOGARE = {
  oggetto: "Oggetto",
  procedura: "Procedura",
  tipologia: "Tipologia",
  importo: "Importo base",
  cig: "CIG",
  cup: "CUP",
  pubblicazione: "Pubblicazione",
  scadenza: "Scadenza presentazione",
  categorie: "Categorie merceologiche",
  beneficiario: "Beneficiario",
} as const;
export type CampoTuttoGare = keyof typeof ETICHETTE_TUTTOGARE;

// senza questi un dettaglio non si legge; se mancano in TUTTI i dettagli letti il formato non è quello dichiarato e la fonte si sospende
export const CAMPI_TUTTOGARE_OBBLIGATORI: readonly CampoTuttoGare[] = ["oggetto", "procedura"];

export type DettaglioTuttoGare = Partial<Record<CampoTuttoGare, string>>;

const norm = (t: string | null | undefined): string =>
  (t ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const ETICHETTE_NORMALI = Object.entries(ETICHETTE_TUTTOGARE).map(([campo, e]) => [campo as CampoTuttoGare, norm(e)] as const);

function etichettaDi(cella: string): { campo: CampoTuttoGare; resto: string } | null {
  const n = norm(cella).replace(/\s*:\s*$/, "");
  for (const [campo, e] of ETICHETTE_NORMALI) {
    if (n === e) return { campo, resto: "" };
    if (n.startsWith(`${e}:`)) return { campo, resto: cella.slice(cella.indexOf(":") + 1).trim() };
  }
  return null;
}

/**
 * Il dettaglio di una gara → i SOLI campi dichiarati. Il valore = le celle dopo l'etichetta nella STESSA riga (riga di tabella, paragrafo…),
 * fino all'etichetta seguente, al più 20; un'etichetta da sola nella sua riga prende la riga seguente, se quella non ha etichette.
 */
export function leggiDettaglioTuttoGare(html: string): DettaglioTuttoGare {
  const righe = righeHtml(html);
  const d: DettaglioTuttoGare = {};
  for (let r = 0; r < righe.length; r++) {
    const celle = righe[r];
    for (let i = 0; i < celle.length; i++) {
      const e = etichettaDi(celle[i]);
      if (!e || d[e.campo] !== undefined) continue;
      const valori = e.resto ? [e.resto] : [];
      for (let j = i + 1; j < celle.length && j <= i + 20 && !etichettaDi(celle[j]); j++) valori.push(celle[j]);
      if (valori.length === 0 && i === celle.length - 1 && righe[r + 1] && !righe[r + 1].some((c) => etichettaDi(c))) valori.push(...righe[r + 1].slice(0, 20));
      d[e.campo] = valori.join(" | ").slice(0, 4000);
    }
  }
  return d;
}

/** Il dettaglio ha i campi obbligatori dichiarati? */
export function dettaglioCompleto(d: DettaglioTuttoGare): boolean {
  return CAMPI_TUTTOGARE_OBBLIGATORI.every((k) => (d[k] ?? "").trim() !== "");
}

// ───── campi ─────

// «Scadenza presentazione»: «gg/mm/aaaa hh:mm» (campione del 26/11: ora reale e variabile, 12:00, 23:45), ora italiana → giorno e istante;
// tollerati «ore 12.00» e data e ora in due celle. Senza ora, o a mezzanotte esatta: giorno senza ora (la stessa regola delle altre fonti:
// l'ora non si presume mai). «Pubblicazione»: «gg/mm/aaaa» senza ora (giornoTuttoGare).
export function scadenzaTuttoGare(v: string | null | undefined): ScadenzaTed | null {
  const s = (v ?? "").trim();
  // data e ora anche in due celle («10/12/2026 | 12:00», le celle del valore unite da « | »)
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s*(?:ore|alle|-|,|\|)?\s*(\d{1,2})[:.](\d{2}))?(?=\s|$|\|)/i);
  if (!m) return null;
  const [g, me, a] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (me < 1 || me > 12 || g < 1 || g > 31) return null;
  const giorno = `${a}-${String(me).padStart(2, "0")}-${String(g).padStart(2, "0")}`;
  if (Number.isNaN(Date.parse(`${giorno}T12:00:00Z`)) || new Date(`${giorno}T12:00:00Z`).getUTCDate() !== g) return null;
  if (!m[4] || (Number(m[4]) === 0 && m[5] === "00")) return { giorno, iso: null, oraIndicata: false, fonte: `${s.slice(0, 40)} (ora non indicata)` };
  const ora = `${String(Number(m[4])).padStart(2, "0")}:${m[5]}`;
  if (Number(m[4]) > 23 || Number(m[5]) > 59) return null;
  const istante = istanteScadenza(giorno, ora);
  if (!istante) return { giorno, iso: null, oraIndicata: false, fonte: s.slice(0, 40) };
  return { giorno, iso: istante.toISOString(), oraIndicata: true, fonte: `${s.slice(0, 40)} (ora italiana)` };
}

/** «03/11/2026» → «2026-11-03»; altro → null. */
export function giornoTuttoGare(v: string | null | undefined): string | null {
  return scadenzaTuttoGare(v)?.giorno ?? null;
}

// L'importo: il primo importo preceduto da «€» o «euro» («€ 1.234.567,89», «Euro 35.000,00»); altrimenti il primo con i decimali
// («35.000,00»). Un numero qualunque («Lotto 1») non è un importo. Altro → null (mai indovinato). «Importo base» sul campione del 26/11:
// «€ 69.600,00», «€ 4.176.978,42».
export function importoTuttoGare(v: string | null | undefined): number | null {
  const s = v ?? "";
  const m = s.match(/(?:€|\beuro\b)\s*(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?)/i) ?? s.match(/(?<![\d.,])(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2})(?![\d,])/);
  return m ? importoAflink(m[1]) : null;
}

// I CIG del campo (uno per lotto): solo CIG validi, senza doppioni, nell'ordine.
export function cigTuttoGare(v: string | null | undefined): string[] {
  const out: string[] = [];
  for (const g of (v ?? "").toUpperCase().split(/[^0-9A-Z]+/)) {
    const c = cigSintel(g);
    if (c && !out.includes(c)) out.push(c);
  }
  return out.slice(0, 200);
}

// Categorie merceologiche → CPV: per ogni voce del campo, il codice numerico all'inizio. Campione del 26/11: 8 cifre, « - » e la descrizione
// («45233142 - Lavori di riparazione stradale»). Per difesa (R4 parlava di codici troncati): da 2 a 7 cifre = codice troncato, completato con
// zeri a destra (il gruppo o la classe del CPV). Si tiene solo se è un CPV valido; la classificazione usa comunque solo le voci del file approvato.
export function cpvDaCategoriaTuttoGare(voce: string): string | null {
  const m = voce.trim().match(/^(\d{2,8})(?:-\d)?(?=\D|$)/);
  if (!m) return null;
  return normalizzaCpv(m[1].length === 8 ? m[1] : m[1].padEnd(8, "0"));
}

export function cpvTuttoGare(v: string | null | undefined): string[] {
  const out: string[] = [];
  for (const voce of (v ?? "").split(/\s*\|\s*|\s*;\s*|\n/)) {
    const c = cpvDaCategoriaTuttoGare(voce);
    if (c && !out.includes(c)) out.push(c);
  }
  return out.slice(0, 50);
}

// Chiave di un beneficiario per la mappa dell'anagrafica: minuscole, senza accenti né punteggiatura.
export function chiaveBeneficiario(v: string | null | undefined): string {
  return norm(v).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

// Procedura (campo «Procedura») e oggetto → tipo di opportunità (decisioni del coordinamento del 26/11):
//   - contratti applicativi e affidamenti diretti, anche se «Pubblicato» → affidamento (fuori dalle opportunità);
//   - «Affidamento con indagine di mercato» e «Richiesta di preventivo aperta» → indagine di mercato (candidatura); manifestazioni di
//     interesse e avvisi esplorativi → manifestazione di interesse;
//   - aperta, ristretta, competitiva con negoziazione, dialogo competitivo, negoziata con previa pubblicazione → bando;
//   - negoziata senza pubblicazione, appalto specifico di un SDA → riservata (fuori);
//   - albo, elenco, sistema di qualificazione, SDA istitutivo → iscrizione;
//   - consultazione preliminare di mercato e valori sconosciuti → null (la gara non entra finché la regola non si aggiorna).
// Valori del badge e del campo «Procedura» visti sul campione del 26/11: «Affidamento diretto / RDO», «Affidamento con indagine di mercato»,
// «Richiesta di preventivo aperta», «Aperta», «Negoziata», «Ristretta». «Negoziata» senza «previa pubblicazione» resta RISERVATA, come per le
// altre fonti (nessuna gara su invito presentata come aperta a tutti): da confermare con il coordinamento, che l'ha indicata tra i bandi.
export function opportunitaTuttoGare(procedura: string | null | undefined, oggetto: string | null | undefined): Opportunita | null {
  const p = norm(procedura);
  const o = norm(oggetto);
  const candidatura = (t: string): Opportunita | null => {
    if (/indagine di mercato|richiesta di preventiv\w* apert\w*/.test(t)) return opportunita("indagine_mercato");
    if (/manifestazion[ei] d[i']\s*interesse|avviso esplorativo/.test(t)) return opportunita("manifestazione_interesse");
    return null;
  };
  if (/contratt\w* applicativ\w*/.test(p) || /contratt\w* applicativ\w*/.test(o)) return opportunita("affidamento_diretto");
  if (!p) {
    // senza la procedura: SOLO una candidatura o un affidamento diretto dichiarati nell'oggetto; altrimenti sconosciuta (mai presunta)
    const c = candidatura(o);
    if (c) return c;
    return /\baffidamento diretto\b/.test(o) ? opportunita("affidamento_diretto") : null;
  }
  const c = candidatura(p);
  if (c) return c;
  // come D2 di SATER: un affidamento diretto o una negoziata il cui OGGETTO dichiara una candidatura (indagine di mercato, manifestazione di
  // interesse, avviso esplorativo) è l'avviso che raccoglie le candidature: entra come candidatura
  if (/affidamento diretto/.test(p)) return candidatura(o) ?? opportunita("affidamento_diretto");
  if (/appalto specifico/.test(p)) return opportunita("riservata");
  if (/negoziata/.test(p)) return /previa (pubblicazione|indizione)|con bando/.test(p) ? opportunita("bando") : (candidatura(o) ?? opportunita("riservata"));
  if (/aperta|ristretta|competitiva con negoziazione|dialogo competitivo|partenariato per l.innovazione/.test(p)) return opportunita("bando");
  if (/\balbo\b|\belenco\b|sistema di qualificazione|sistema dinamico/.test(p)) return opportunita("sistema_qualificazione");
  return null;
}

// La procedura nella forma dell'archivio (come le altre piattaforme); null se non riconosciuta.
export function tipoProceduraTuttoGare(procedura: string | null | undefined): string | null {
  const p = norm(procedura);
  if (/competitiva con negoziazione/.test(p)) return "Procedura competitiva con negoziazione";
  if (/dialogo competitivo/.test(p)) return "Dialogo competitivo";
  if (/aperta/.test(p) && !/preventiv/.test(p)) return "Procedura aperta";
  if (/ristretta/.test(p)) return "Procedura ristretta";
  if (/negoziata/.test(p)) return "Procedura negoziata";
  if (/affidamento diretto/.test(p)) return "Affidamento diretto";
  return null;
}

// Un affidamento dichiarato già nella scheda della home: il dettaglio non si legge (risparmio di richieste). SOLO dal badge della procedura
// (campione del 26/11: «Affidamento diretto / RDO»), con la stessa regola del dettaglio (opportunitaTuttoGare, oggetto della scheda
// compreso: un affidamento il cui oggetto dichiara una candidatura si legge). Senza badge: decide il dettaglio.
export function affidamentoNellaRiga(riga: Pick<RigaHomeTuttoGare, "procedura" | "oggetto">): boolean {
  if (!riga.procedura) return false;
  return opportunitaTuttoGare(riga.procedura, riga.oggetto)?.tipo === "affidamento_diretto";
}

// L'ente della gara (decisione del coordinamento: nessun codice fiscale dalla fonte, solo dall'anagrafica):
//   - istanza di un solo ente: l'ente dell'anagrafica; un beneficiario DIVERSO (R4: «Uniba» con sedi di un liceo fiorentino) si scrive com'è,
//     senza codice fiscale, e si segnala («ente_da_verificare»);
//   - istanza a più enti: il beneficiario mappato in anagrafica; fuori mappa com'è scritto, senza codice fiscale; senza beneficiario l'ente
//     titolare (la centrale).
export function enteTuttoGare(istanza: IstanzaTuttoGare, beneficiario: string | null | undefined): { ente: EnteTuttoGare; daVerificare: boolean } {
  const b = (beneficiario ?? "").split("|")[0].trim().slice(0, 300);
  const k = chiaveBeneficiario(b);
  if (!k) return { ente: istanza.ente, daVerificare: false };
  const mappato = istanza.beneficiari[k];
  if (mappato) return { ente: mappato, daVerificare: false };
  // lo stesso ente, anche con l'ufficio dopo il nome («Roma Capitale – Dipartimento …»)
  const titolare = chiaveBeneficiario(istanza.ente.denominazione);
  if (k === titolare || k.startsWith(`${titolare} `)) return { ente: istanza.ente, daVerificare: false };
  const comune = b.match(/^comune di\s+(.+)$/i)?.[1] ?? null;
  return { ente: { denominazione: b, codiceFiscale: null, comune: comune ? maiuscoleIniziali(comune) : null, provincia: null }, daVerificare: !istanza.multiEnte };
}

// ───── una gara → bando o esclusione ─────

export type MotivoEsclusioneTuttoGare =
  | "senza_identificativo" | "senza_oggetto" | "esclusa_per_oggetto" | "fuori_settore" | "riservata" | "affidamento" | "tipo_sconosciuto" | "scaduta";

export type MetaTuttoGare = {
  host: string;
  codice: string;
  // «tuttogare:<host>:<codice>»: identità della gara, cioè la sua CHIAVE. NON va in piattaforma_id (vincolo della 0120; decisione (b) del
  // coordinamento del 26/11: piattaforma_id vuoto per TuttoGare, bandoDaTuttoGare)
  idPiattaforma: string;
  // identificativo della procedura nella fonte (id_fonte): «<host>:<codice>»
  idProcedura: string;
};

export type BandoTuttoGare = {
  tipo: "bando";
  meta: MetaTuttoGare;
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

export type EsclusioneTuttoGare = { tipo: "esclusione"; meta: MetaTuttoGare | null; motivo: MotivoEsclusioneTuttoGare; regole?: string[] };

export type GaraTuttoGareLetta = BandoTuttoGare | EsclusioneTuttoGare;

const breve = (v: string | null | undefined, max = 4000): string => (v ?? "").split(" | ").map((x) => x.trim()).filter(Boolean).join(" ").slice(0, max);

export function leggiGaraTuttoGare(istanza: IstanzaTuttoGare, codice: string, d: DettaglioTuttoGare, adesso: Date): GaraTuttoGareLetta {
  // identità: il codice dell'URL del dettaglio (non il «Gara #» mostrato), riconosciuto dalla regola dei connettori sull'host canonico
  const pagina = urlDettaglioTuttoGare(istanza, codice);
  const idPiattaforma = idPiattaformaDaUrlConnettore(pagina);
  if (!pagina || idPiattaforma !== `tuttogare:${istanza.host}:${codice}`) return { tipo: "esclusione", meta: null, motivo: "senza_identificativo" };
  const meta: MetaTuttoGare = { host: istanza.host, codice, idPiattaforma, idProcedura: `${istanza.host}:${codice}` };
  const esclusione = (motivo: MotivoEsclusioneTuttoGare): EsclusioneTuttoGare => ({ tipo: "esclusione", meta, motivo });

  const titolo = breve(d.oggetto);
  if (!titolo) return esclusione("senza_oggetto");
  const procedura = breve(d.procedura, 200) || null;
  const opp = opportunitaTuttoGare(procedura, titolo);
  if (!opp) return esclusione("tipo_sconosciuto");
  if (opp.tipo === "affidamento_diretto") return esclusione("affidamento");
  if (!entraInOpportunita(opp)) return esclusione("riservata");

  const scadenza = scadenzaTuttoGare(d.scadenza);
  const mancanti: string[] = ["luogo_esecuzione"];
  if (!scadenza) mancanti.push("scadenza");
  else if (scadenza.iso ? scadenza.iso < adesso.toISOString() : scadenza.giorno < giornoDiRoma(adesso)) return esclusione("scaduta");

  // CPV dalle categorie merceologiche (regola dichiarata); senza, classificazione sul testo con le regole comuni
  const cpv = cpvTuttoGare(d.categorie);
  if (cpv.length === 0) mancanti.push("cpv");
  const natura = naturaAflink(breve(d.tipologia, 60));
  const classificazione = classificaGara({ cpvPrincipale: cpv[0] ?? null, cpvTutti: cpv, testo: titolo });
  if (classificazione.settori.length === 0) return classificazione.esclusioni.length > 0 ? { ...esclusione("esclusa_per_oggetto"), regole: [...new Set(classificazione.esclusioni.map((x) => x.regola))] } : esclusione("fuori_settore");
  const settoriTenuti = settoriDopoNatura(classificazione, natura);
  if (settoriTenuti.length === 0) return esclusione("fuori_settore");

  const importo = importoTuttoGare(d.importo);
  if (importo === null) mancanti.push("valore");
  const cig = cigTuttoGare(d.cig);
  // le candidature spesso non hanno CIG (R4: a Roma 13 su 25): CIG mancante, mai inventato
  if (cig.length === 0) mancanti.push("cig");
  const lotti: RecordLotto[] = cig.map((c, i) => ({ cig: c, numero: `LOT-${String(i + 1).padStart(4, "0")}`, oggetto: null, cpvPrincipale: null, cpvTutti: [], valoreStimato: null, valoreBase: null, oneriSicurezza: null, durataMesi: null, opzioniRinnovi: null }));

  const { ente, daVerificare } = enteTuttoGare(istanza, d.beneficiario);
  if (!ente.codiceFiscale) mancanti.push("codice_fiscale_ente");
  if (daVerificare) mancanti.push("ente_da_verificare");
  if (!istanza.regione) mancanti.push("regione");

  const record: RecordProcedura = {
    fonte: "regionale",
    idFonte: meta.idProcedura,
    chiaveProcedura: idPiattaforma,
    oggetto: titolo,
    descrizione: null,
    ente: { codiceFiscale: ente.codiceFiscale, denominazione: ente.denominazione, comune: ente.comune, provincia: ente.provincia, regione: istanza.regione, luogoIstat: null, nuts: null },
    tipoAvviso: opp.tipo === "bando" || opp.tipo === "sistema_qualificazione" ? "Bando" : "Avviso",
    tipoProcedura: tipoProceduraTuttoGare(procedura) ?? tipoProceduraTuttoGare(proceduraDallOggettoAflink(titolo)),
    criterioAggiudicazione: null,
    natura,
    settoriSpeciali: null,
    dataPubblicazione: giornoTuttoGare(d.pubblicazione),
    scadenzaGiorno: scadenza?.giorno ?? null,
    scadenzaOfferte: scadenza?.iso ?? null,
    scadenzaOraIndicata: scadenza?.oraIndicata ?? false,
    valoreStimato: null,
    valoreBase: importo,
    oneriSicurezza: null,
    durataMesi: null,
    annullata: false,
    // la pagina del dettaglio (mai documenti o allegati, che robots.txt esclude)
    urlAvviso: pagina,
    urlDocumenti: pagina,
    cpvPrincipale: cpv[0] ?? null,
    cpvTutti: cpv,
    lotti,
    impronta: "",
  };
  record.impronta = impronta({ ...record, impronta: null, settori: settoriTenuti, opportunita: opp.tipo });

  return {
    tipo: "bando",
    meta,
    record,
    opportunita: opp,
    procedura,
    settori: settoriTenuti,
    metodoSettore: classificazione.metodo ?? "parole_chiave",
    regioni: istanza.regione ? [istanza.regione] : [],
    scadenzaFonte: scadenza?.fonte ?? null,
    lottiScadenze: lotti.map(() => scadenza),
    lottiDocumenti: lotti.map(() => pagina),
    mancanti,
  };
}

// ───── cursore: che cosa è già stato letto (per rileggere solo le gare nuove o cambiate) ─────

// per istanza: codice → impronta della riga della home e giorno dell'ultima lettura del dettaglio (o dell'esclusione dalla riga)
export type VoceCursoreTuttoGare = { r: string; l: string };
export type CursoreTuttoGare = Record<string, Record<string, VoceCursoreTuttoGare>>;

export function cursoreTuttoGare(x: unknown): CursoreTuttoGare {
  const out: CursoreTuttoGare = {};
  if (!x || typeof x !== "object" || Array.isArray(x)) return out;
  for (const [host, voci] of Object.entries(x as Record<string, unknown>)) {
    if (!ISTANZE_TUTTOGARE.some((i) => i.host === host) || !voci || typeof voci !== "object" || Array.isArray(voci)) continue;
    const m: Record<string, VoceCursoreTuttoGare> = {};
    for (const [codice, v] of Object.entries(voci as Record<string, unknown>)) {
      const r = v && typeof v === "object" ? (v as { r?: unknown; l?: unknown }) : null;
      if (/^\d{1,12}$/.test(codice) && r && typeof r.r === "string" && typeof r.l === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.l)) m[codice] = { r: r.r, l: r.l };
    }
    out[host] = m;
  }
  return out;
}

/** Il dettaglio va letto? Sì se la gara è nuova, se la sua riga è cambiata o se l'ultima lettura è più vecchia di rileggiDopoGiorni. */
export function dettaglioDaLeggere(riga: RigaHomeTuttoGare, voce: VoceCursoreTuttoGare | undefined, oggi: string): boolean {
  if (!voce || voce.r !== riga.impronta) return true;
  const giorni = (Date.parse(`${oggi}T12:00:00Z`) - Date.parse(`${voce.l}T12:00:00Z`)) / 86_400_000;
  return !(giorni < CANALE_TUTTOGARE.rileggiDopoGiorni);
}

/**
 * Il cursore dopo un giro: per ogni istanza LETTA, le sole gare ancora nella home (le altre escono); quelle lette o escluse dalla riga in
 * questo giro con la riga e il giorno di oggi, le altre come prima (le rimandate restano senza voce: si leggono al giro dopo). Le istanze
 * non lette restano come prima.
 */
export function aggiornaCursoreTuttoGare(prima: CursoreTuttoGare, lette: readonly { host: string; righe: readonly RigaHomeTuttoGare[]; trattati: ReadonlySet<string> }[], oggi: string): CursoreTuttoGare {
  const out: CursoreTuttoGare = { ...prima };
  for (const l of lette) {
    const vecchio = prima[l.host] ?? {};
    const nuovo: Record<string, VoceCursoreTuttoGare> = {};
    for (const r of l.righe) {
      if (l.trattati.has(r.codice)) nuovo[r.codice] = { r: r.impronta, l: oggi };
      else if (vecchio[r.codice]) nuovo[r.codice] = vecchio[r.codice];
    }
    out[l.host] = nuovo;
  }
  return out;
}
