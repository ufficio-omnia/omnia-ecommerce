// Controlli strutturali condivisi tra livello 1 (verifica-livello1.ts,
// gratuito/automatico, gira sul fixture già approvato) e livello 2
// (verifica-livello2.ts, a pagamento/manuale, gira su una generazione
// reale appena prodotta PRIMA di promuoverla a nuovo fixture). Stessa
// funzione in entrambi i casi: un fixture che il livello 2 promuove senza
// essere già passato per questi identici controlli non avrebbe alcun
// senso come riferimento del livello 1.
import { buildDocxBuffer, rimuoviTitoloRidondante } from "../../src/lib/docx-generator";
import { stimaPagineContenuto } from "../../src/lib/stima-pagine";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const JSZip = require("jszip");

export type FixtureRelazione = {
  titolo: string;
  sezioni: { titolo_sezione: string; contenuto: string }[];
  formattazione: { font?: string; dimensioneCarattere?: number; interlinea?: number };
  datiIntestazione: { stazioneAppaltante?: string | null; amministrazioneCommittente?: string | null; cig?: string | null; concorrente?: string | null };
  limitePagineTotale: number;
};

// Marcatori di sintassi che il renderer DEVE consumare (mai comparire come
// testo letterale): diverso da un segnaposto come "[DATO DA CONFERMARE:...]"
// o un asterisco "*", che sono contenuto VOLUTO, non sintassi residua.
const MARCATORI_RESIDUI: [string, RegExp][] = [
  ["[TABELLA:colore]", /\[TABELLA:\s*\w+\]/],
  ["[C] (tag allineamento cella)", /\[C\]/],
  ["[G] (tag allineamento cella)", /\[G\]/],
  ["[ICONA:nome]", /\[ICONA:[^\]]*\]/],
  ["[BOX]/[/BOX]", /\[\/?BOX\]/],
  ["[ORGANIGRAMMA]/[/ORGANIGRAMMA]", /\[\/?ORGANIGRAMMA\]/],
  ["** (grassetto markdown non convertito)", /\*\*/],
  ["!! (colore ruolo non convertito)", /!!/],
];

const FRASI_ECONOMICHE_VIETATE = [
  "a costo zero",
  "senza oneri aggiuntivi",
  "compreso nel prezzo",
  "incluso nel prezzo",
  "gratuitamente",
  "ribasso",
  "€",
];

function decodeEntitaXml(testo: string): string {
  return testo
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// Testo di OGNI nodo <w:t>, separatamente (non concatenato in una sola
// stringa): un marcatore di sintassi non convertito (es. "**testo**") vive
// SEMPRE interamente dentro un singolo nodo di testo, non a cavallo di due
// — la stessa sequenza di caratteri può comparire per puro accostamento
// tra due nodi indipendenti e corretti (es. un asterisco singolo a fine
// cella di tabella seguito, in un nodo completamente diverso, dall'asterisco
// singolo iniziale della nota sotto la tabella: "* " + "*Valori..." letti
// insieme sembrano "**" ma sono due marcatori legittimi, non uno residuo).
export function estraiTestiPerNodo(xml: string): string[] {
  const match = xml.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [];
  return match.map((m) => decodeEntitaXml(m.replace(/^<w:t[^>]*>/, "").replace(/<\/w:t>$/, "")));
}

export function estraiTestiVisibili(xml: string): string {
  // Solo il contenuto dei nodi <w:t>, nell'ordine: è il testo che un
  // lettore vede davvero, senza markup XML che genererebbe falsi positivi.
  // Usata per controlli su testo "letto per intero" (intestazione, celle,
  // frasi vietate) — per i marcatori residui vedi estraiTestiPerNodo sopra,
  // che non concatena nodi diversi tra loro.
  return estraiTestiPerNodo(xml).join("");
}

function contaOccorrenze(testo: string, pattern: RegExp): number {
  return (testo.match(new RegExp(pattern, "g")) || []).length;
}

export function componiMarkdown(fixture: Pick<FixtureRelazione, "sezioni">): string {
  return fixture.sezioni
    .map((s) => `# ${s.titolo_sezione}\n\n${rimuoviTitoloRidondante(s.contenuto, s.titolo_sezione)}`)
    .join("\n\n");
}

export async function eseguiControlliStrutturali(
  fixture: FixtureRelazione,
): Promise<{ errori: string[]; riepilogo: string; celle: number; immagini: number; pagineStimate: number }> {
  const errori: string[] = [];
  const contenutoMarkdown = componiMarkdown(fixture);

  // --- Rendering puro, nessuna chiamata esterna ---
  const buffer = await buildDocxBuffer(
    fixture.titolo,
    contenutoMarkdown,
    fixture.formattazione,
    undefined,
    undefined,
    fixture.datiIntestazione,
  );

  const zip = await JSZip.loadAsync(buffer);
  const nomiFile = Object.keys(zip.files);

  async function leggi(nome: string): Promise<string> {
    const file = zip.file(nome);
    return file ? file.async("string") : "";
  }

  const documentXml = await leggi("word/document.xml");
  const headerXml = (
    await Promise.all(nomiFile.filter((n: string) => /^word\/header\d+\.xml$/.test(n)).map((n: string) => leggi(n)))
  ).join("\n");
  const footerXml = (
    await Promise.all(nomiFile.filter((n: string) => /^word\/footer\d+\.xml$/.test(n)).map((n: string) => leggi(n)))
  ).join("\n");

  const testoIntestazione = estraiTestiVisibili(headerXml);
  const testoCorpo = estraiTestiVisibili(documentXml);
  const testoPiePagina = estraiTestiVisibili(footerXml);

  // 1. Intestazione con committente, centrale e CIG.
  const { stazioneAppaltante, amministrazioneCommittente, cig, concorrente } = fixture.datiIntestazione;
  for (const [etichetta, valore] of [
    ["stazione appaltante/centrale", stazioneAppaltante],
    ["amministrazione committente", amministrazioneCommittente],
    ["concorrente", concorrente],
  ] as const) {
    if (valore && !testoIntestazione.includes(valore)) {
      errori.push(`Intestazione: "${etichetta}" (${valore}) non trovato nel testo dell'intestazione.`);
    }
  }
  if (cig && !testoIntestazione.includes(cig)) {
    errori.push(`Intestazione: CIG (${cig}) non trovato nel testo dell'intestazione.`);
  }
  if (cig && !/CIG/.test(testoIntestazione)) {
    errori.push(`Intestazione: etichetta "CIG" non trovata accanto al codice.`);
  }

  // 2. Carattere e corpo corrispondenti ai vincoli della gara.
  const fontAtteso = fixture.formattazione.font ?? "Calibri";
  const halfPointsAttesi = String((fixture.formattazione.dimensioneCarattere ?? 12) * 2);
  if (!documentXml.includes(`w:ascii="${fontAtteso}"`)) {
    errori.push(`Font: "${fontAtteso}" non trovato nel documento (atteso da relazione_font/font_richiesto della gara).`);
  }
  if (!documentXml.includes(`w:val="${halfPointsAttesi}"`)) {
    errori.push(`Corpo carattere: valore half-point "${halfPointsAttesi}" (${fixture.formattazione.dimensioneCarattere ?? 12}pt) non trovato nel documento.`);
  }

  // 3. Numerazione "Pag. X di N".
  if (!/Pag\.\s*/.test(testoPiePagina)) {
    errori.push(`Numerazione pagine: testo "Pag. " non trovato nel piè di pagina.`);
  }
  if (!footerXml.includes("PAGE")) {
    errori.push(`Numerazione pagine: campo Word "PAGE" non trovato nel piè di pagina.`);
  }
  if (!footerXml.includes("SECTIONPAGES") && !footerXml.includes("NUMPAGES")) {
    errori.push(`Numerazione pagine: campo Word "SECTIONPAGES"/"NUMPAGES" (totale pagine) non trovato nel piè di pagina.`);
  }

  // 4. Nessun marcatore di formattazione residuo — controllato nodo per
  // nodo (non su testoCorpo concatenato): un marcatore non convertito vive
  // sempre interamente in un singolo <w:t>, mai a cavallo di due nodi
  // indipendenti (vedi estraiTestiPerNodo).
  const nodiCorpo = estraiTestiPerNodo(documentXml);
  for (const [nome, pattern] of MARCATORI_RESIDUI) {
    const occorrenze = nodiCorpo.reduce((tot, nodo) => tot + contaOccorrenze(nodo, pattern), 0);
    if (occorrenze > 0) {
      errori.push(`Marcatore residuo: "${nome}" compare ${occorrenze} volta/e come testo letterale nel corpo del documento.`);
    }
  }

  // 5. Nessuna cella di tabella vuota.
  const celle = documentXml.match(/<w:tc[ >][\s\S]*?<\/w:tc>/g) || [];
  let celleVuote = 0;
  for (const cella of celle) {
    const testoCella = estraiTestiVisibili(cella).trim();
    if (testoCella.length === 0) celleVuote++;
  }
  if (celleVuote > 0) {
    errori.push(`Tabelle: ${celleVuote} cella/e senza alcun testo (cella vuota) nel documento.`);
  }
  if (celle.length === 0) {
    errori.push(`Tabelle: nessuna cella trovata nel documento — atteso almeno una tabella.`);
  }

  // 6. Nessuna fotografia: l'unica fonte di immagini oggi è l'organigramma
  // (il codice che generava immagini AI è stato rimosso) — il numero di
  // immagini nel pacchetto deve combaciare esattamente con il numero di
  // blocchi [ORGANIGRAMMA] nel testo sorgente.
  const numeroOrganigrammi = (contenutoMarkdown.match(/\[ORGANIGRAMMA\]/g) || []).length;
  const numeroImmagini = nomiFile.filter((n: string) => n.startsWith("word/media/") && !n.endsWith("/")).length;
  if (numeroImmagini !== numeroOrganigrammi) {
    errori.push(
      `Immagini: ${numeroImmagini} immagine/i nel documento contro ${numeroOrganigrammi} blocco/hi [ORGANIGRAMMA] nel testo — l'unica fonte di immagini legittima è l'organigramma, un numero diverso indica un'immagine indebita o un organigramma non renderizzato.`,
    );
  }

  // 7. Nessuna frase sull'offerta economica (R8), solo nel corpo.
  for (const frase of FRASI_ECONOMICHE_VIETATE) {
    if (testoCorpo.toLowerCase().includes(frase.toLowerCase())) {
      errori.push(`Offerta economica: frase vietata "${frase}" trovata nel corpo del documento (R8).`);
    }
  }

  // 8. Pagine entro il limite del disciplinare.
  const pagineStimate = stimaPagineContenuto(contenutoMarkdown, fixture.formattazione);
  if (pagineStimate > fixture.limitePagineTotale) {
    errori.push(`Pagine: stima ${pagineStimate.toFixed(2)} supera il limite dichiarato di ${fixture.limitePagineTotale}.`);
  }

  const riepilogo = `${fixture.sezioni.length} sezioni, ${celle.length} celle, ${numeroImmagini} immagini, ${pagineStimate.toFixed(2)} pagine stimate (limite ${fixture.limitePagineTotale}).`;

  return { errori, riepilogo, celle: celle.length, immagini: numeroImmagini, pagineStimate };
}
