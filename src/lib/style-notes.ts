import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import "pdf-parse/worker";
import type Anthropic from "@anthropic-ai/sdk";
import { createAnthropicClient } from "@/lib/anthropic";
import { logAiUsage } from "@/lib/ai-usage";

const MODEL = "claude-sonnet-5";
const MAX_IMMAGINI = 6;
const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

const INIZIO_NOTE = "<<<NOTE_STILE>>>";
const FINE_NOTE = "<<<FINE_NOTE_STILE>>>";
const INIZIO_DID = "<<<DIDASCALIE>>>";
const FINE_DID = "<<<FINE_DIDASCALIE>>>";

const ISTRUZIONE = `Osserva la struttura e la formattazione di questo documento (impaginazione, uso di titoli/sottotitoli, tabelle, elenchi, elementi in grassetto, eventuali immagini/loghi/schemi/organigrammi, tono generale, struttura delle sezioni).

Rispondi in due parti, usando ESATTAMENTE questi marcatori, senza nient'altro prima, dopo o intorno:

${INIZIO_NOTE}
(nota di stile: 100-150 parole di prosa semplice senza markdown — niente #, **, elenchi puntati — che descriva le convenzioni di stile e struttura del documento, come guida per generare in futuro documenti con lo stesso livello di qualità e impostazione. Non riportare contenuti specifici, nomi, dati o informazioni identificative: solo osservazioni sullo stile e sulla struttura)
${FINE_NOTE}
${INIZIO_DID}
(una riga per ogni immagine allegata, nello stesso ordine, formato "N. descrizione visiva breve": es. "1. tabella a 4 colonne con intestazione azzurra e testo bianco" oppure "2. organigramma a tre livelli con caselle azzurre arrotondate e linee di collegamento verticali". Descrivi SOLO l'aspetto grafico — colori, forme, layout — mai contenuti/nomi/dati specifici. Se non ci sono immagini allegate lascia questa sezione vuota)
${FINE_DID}`;

export type ImmagineEstratta = {
  contentType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  buffer: Buffer;
  descrizione: string;
};

export type NoteStile = {
  notaStile: string;
  immagini: ImmagineEstratta[];
};

function estraiTraMarcatori(testo: string, inizio: string, fine: string): string | null {
  const i = testo.indexOf(inizio);
  const f = testo.indexOf(fine);
  if (i === -1 || f === -1 || f <= i) return null;
  return testo.slice(i + inizio.length, f).trim();
}

function parseDidascalie(blocco: string | null): string[] {
  if (!blocco) return [];
  return blocco
    .split("\n")
    .map((riga) => riga.trim())
    .filter(Boolean)
    .map((riga) => riga.replace(/^\d+[.)]\s*/, ""));
}

function parseRisposta(testoRisposta: string): { notaStile: string; didascalie: string[] } {
  const notaStile = estraiTraMarcatori(testoRisposta, INIZIO_NOTE, FINE_NOTE) ?? testoRisposta.trim();
  const didascalie = parseDidascalie(estraiTraMarcatori(testoRisposta, INIZIO_DID, FINE_DID));
  return { notaStile, didascalie };
}

// Cattura alcune pagine del PDF come immagini PNG reali (non solo testo
// OCR), campionate in modo distribuito lungo tutto il documento: servono
// per costruire una libreria di immagini riutilizzabili nella generazione
// (tabelle, organigrammi, schemi visti realmente), non solo per la nota
// di stile testuale ricavata più sotto.
async function catturaScreenshotPagine(buffer: Buffer): Promise<Buffer[]> {
  const parser = new PDFParse({ data: buffer });
  try {
    const info = await parser.getInfo();
    const totale = info.total ?? 0;
    if (totale === 0) return [];

    const numPagine = Math.min(MAX_IMMAGINI, totale);
    const pagine = [
      ...new Set(
        Array.from({ length: numPagine }, (_, i) =>
          Math.max(1, Math.round(((i + 1) * totale) / (numPagine + 1))),
        ),
      ),
    ];

    const screenshot = await parser.getScreenshot({
      partial: pagine,
      imageBuffer: true,
      imageDataUrl: false,
      scale: 1.3,
    });
    return screenshot.pages.map((p) => Buffer.from(p.data));
  } finally {
    await parser.destroy();
  }
}

// Per i PDF chiediamo a Claude di "vedere" il documento intero (il blocco
// document della Messages API include la resa visiva nativa delle pagine)
// per la nota di stile con la massima fedeltà, e in aggiunta alleghiamo le
// stesse pagine come immagini PNG reali estratte a parte: un blocco
// "document" non è riusabile come immagine autonoma in generazioni
// successive, mentre i PNG catturati qui sì.
async function noteStilePdf(buffer: Buffer): Promise<NoteStile> {
  const anthropic = createAnthropicClient();
  const paginePng = await catturaScreenshotPagine(buffer);

  const content: Anthropic.ContentBlockParam[] = [
    {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: buffer.toString("base64") },
    },
    ...paginePng.map(
      (png): Anthropic.ContentBlockParam => ({
        type: "image",
        source: { type: "base64", media_type: "image/png", data: png.toString("base64") },
      }),
    ),
    {
      type: "text",
      text: `${ISTRUZIONE}${
        paginePng.length
          ? `\n\nOltre al documento completo, ti sono allegate anche ${paginePng.length} pagine come immagini a parte, nello stesso ordine: usale per scrivere le didascalie richieste sopra.`
          : ""
      }`,
    },
  ];

  const response = await anthropic.messages.create({
    model: MODEL,
    // La nota di stile (100-150 parole) più fino a 6 didascalie dettagliate
    // possono superare 800 token in output: con quel limite la risposta
    // veniva troncata (stop_reason "max_tokens") prima del marcatore
    // finale delle didascalie, che quindi non si estraevano mai — bug
    // osservato: TUTTE le immagini della knowledge base finivano con la
    // didascalia generica di fallback, rendendo inutile la ricerca per
    // pertinenza (embedding identico per ogni immagine).
    max_tokens: 2000,
    thinking: { type: "disabled" },
    messages: [{ role: "user", content }],
  });
  await logAiUsage({
    userId: null,
    garaId: null,
    operazione: "kb_nota_stile",
    provider: "anthropic",
    model: MODEL,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });
  const testoRisposta = response.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
  const { notaStile, didascalie } = parseRisposta(testoRisposta);

  const immagini: ImmagineEstratta[] = paginePng.map((buf, i) => ({
    contentType: "image/png",
    buffer: buf,
    descrizione: didascalie[i] ?? "Pagina del documento",
  }));

  return { notaStile, immagini };
}

// Per i .docx Claude non può "vedere" il file impaginato: usiamo l'HTML
// strutturato (titoli, tabelle, grassetti) prodotto da mammoth come
// proxy della formattazione, ed estraiamo separatamente le immagini
// incorporate (loghi, schemi, organigrammi) per mandarle a Claude come
// immagini vere — non come testo base64 inline nell'HTML, che Claude
// leggerebbe come una stringa senza senso invece di "vederla" — e per
// conservarle riusabili nella generazione.
async function noteStileDocx(buffer: Buffer): Promise<NoteStile> {
  const immaginiEstratte: { contentType: string; base64: string }[] = [];

  const { value: html } = await mammoth.convertToHtml(
    { buffer },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        if (immaginiEstratte.length < MAX_IMMAGINI && SUPPORTED_IMAGE_TYPES.has(image.contentType)) {
          const base64 = await image.read("base64");
          immaginiEstratte.push({ contentType: image.contentType, base64 });
        }
        return { src: "" };
      }),
    },
  );

  const anthropic = createAnthropicClient();

  const content: Anthropic.ContentBlockParam[] = [
    ...immaginiEstratte.map(
      (img): Anthropic.ContentBlockParam => ({
        type: "image",
        source: {
          type: "base64",
          media_type: img.contentType as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
          data: img.base64,
        },
      }),
    ),
    {
      type: "text",
      text: `${ISTRUZIONE}${
        immaginiEstratte.length
          ? `\n\nSono allegate anche ${immaginiEstratte.length} immagini estratte dal documento (loghi, schemi, organigrammi, tabelle), nello stesso ordine: usale per scrivere le didascalie richieste sopra.`
          : ""
      }\n\nStruttura HTML del testo del documento (titoli, tabelle, grassetti riflettono la formattazione originale):\n\n${html.slice(0, 20000)}`,
    },
  ];

  const response = await anthropic.messages.create({
    model: MODEL,
    // La nota di stile (100-150 parole) più fino a 6 didascalie dettagliate
    // possono superare 800 token in output: con quel limite la risposta
    // veniva troncata (stop_reason "max_tokens") prima del marcatore
    // finale delle didascalie, che quindi non si estraevano mai — bug
    // osservato: TUTTE le immagini della knowledge base finivano con la
    // didascalia generica di fallback, rendendo inutile la ricerca per
    // pertinenza (embedding identico per ogni immagine).
    max_tokens: 2000,
    thinking: { type: "disabled" },
    messages: [{ role: "user", content }],
  });
  await logAiUsage({
    userId: null,
    garaId: null,
    operazione: "kb_nota_stile",
    provider: "anthropic",
    model: MODEL,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });
  const testoRisposta = response.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
  const { notaStile, didascalie } = parseRisposta(testoRisposta);

  const immagini: ImmagineEstratta[] = immaginiEstratte.map((img, i) => ({
    contentType: img.contentType as ImmagineEstratta["contentType"],
    buffer: Buffer.from(img.base64, "base64"),
    descrizione: didascalie[i] ?? "Immagine del documento",
  }));

  return { notaStile, immagini };
}

export async function extractStyleNotes(nomeFile: string, buffer: Buffer): Promise<NoteStile> {
  if (nomeFile.toLowerCase().endsWith(".docx")) {
    return noteStileDocx(buffer);
  }
  return noteStilePdf(buffer);
}
