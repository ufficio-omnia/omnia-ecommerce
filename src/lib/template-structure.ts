import mammoth from "mammoth";
import { createAnthropicClient } from "@/lib/anthropic";
import { logAiUsage } from "@/lib/ai-usage";

const MODEL = "claude-sonnet-5";
const MAX_VOCI = 60;

const HEADING_REGEX = /<h([1-4])[^>]*>([\s\S]*?)<\/h\1>/gi;
// Riga di indice testuale, es. "B.1 Premessa metodologica" o "A. Piano
// operativo..." — cattura il "numero" (lettere/cifre separate da punti)
// e il testo del titolo, ignorando i numeri di pagina finali.
const VOCE_INDICE_REGEX = /^([A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*)[.)]?\s+(.+)$/;

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, "").trim();
}

// Molti documenti reali non usano gli stili "Titolo 1/2/3" di Word per il
// corpo, ma hanno comunque un vero indice testuale (spesso generato con
// il campo Sommario di Word) con voci tipo "A. Titolo ... 1" o
// "B.1 Sottotitolo ... 2". Se non troviamo tag di intestazione, proviamo
// a ricavare la struttura da lì: è un segnale più affidabile di niente.
function parseIndiceTestuale(testoCompleto: string): string {
  const match = testoCompleto.match(/\b(indice|sommario|index)\b\s*\n([\s\S]*)/i);
  const corpo = match ? match[2] : testoCompleto;

  const voci: { livello: number; testo: string }[] = [];

  for (const rigaGrezza of corpo.split("\n")) {
    if (voci.length >= MAX_VOCI) break;
    // rimuove un eventuale numero di pagina finale (dopo tab/spazi multipli)
    const riga = rigaGrezza.trim().replace(/[\t .]{2,}\d+\s*$/, "").replace(/[\t ]+\d+\s*$/, "").trim();
    if (!riga || riga.length < 3) continue;

    const voceMatch = riga.match(VOCE_INDICE_REGEX);
    if (!voceMatch) continue;

    const [, token, testo] = voceMatch;
    // scarta token che sono in realtà numeri di pagina o frasi normali
    // senza numerazione gerarchica riconoscibile (es. inizia con lettera
    // minuscola seguita da testo comune)
    if (!/^[A-Za-z0-9]/.test(token)) continue;

    const livello = token.split(".").length - 1;
    voci.push({ livello, testo: testo.trim() });
  }

  if (voci.length < 3) return ""; // troppo poco per essere davvero un indice

  return voci.map((v) => `${"  ".repeat(v.livello)}${v.testo}`).join("\n");
}

// Estrae l'indice (titoli/sottotitoli, con livello) da un .docx. Prima
// prova con i tag di intestazione HTML prodotti da mammoth (riflettono
// gli stili "Titolo 1/2/3" del documento originale); se il documento non
// li usa (es. l'indice è un campo Sommario di Word, testo semplice senza
// stile Titolo), prova a ricavare la struttura dal testo dell'indice.
async function strutturaDocx(buffer: Buffer): Promise<string> {
  const { value: html } = await mammoth.convertToHtml({ buffer });

  const righe: string[] = [];
  let match: RegExpExecArray | null;
  HEADING_REGEX.lastIndex = 0;

  while ((match = HEADING_REGEX.exec(html)) !== null && righe.length < MAX_VOCI) {
    const livello = Number(match[1]) - 1; // h1 -> livello 0
    const testo = stripHtml(match[2]);
    if (testo) {
      righe.push(`${"  ".repeat(Math.max(livello, 0))}${testo}`);
    }
  }

  if (righe.length > 0) return righe.join("\n");

  const { value: testoCompleto } = await mammoth.extractRawText({ buffer });
  return parseIndiceTestuale(testoCompleto);
}

// Per i PDF non esistono tag di intestazione da leggere: chiediamo a
// Claude di ricavare l'indice osservando visivamente il documento
// (titoli, numerazione, gerarchia), nello stesso formato a rientri.
async function strutturaPdf(buffer: Buffer): Promise<string> {
  const anthropic = createAnthropicClient();

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1000,
    thinking: { type: "disabled" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: buffer.toString("base64"),
            },
          },
          {
            type: "text",
            text: `Ricava l'indice/struttura di questo documento: titoli e sottotitoli, nell'ordine in cui compaiono, con la loro gerarchia (cerca anche un'eventuale pagina "Indice" o "Sommario" con numerazione A./B./B.1 o 1)/1.1) e usala come riferimento principale). Restituisci SOLO un elenco a rientri (2 spazi per livello di profondità), un titolo per riga, senza numerazione propria, senza commenti, senza markdown. Esempio di formato:\nTitolo di primo livello\n  Sottotitolo\n    Sotto-sottotitolo\nAltro titolo di primo livello`,
          },
        ],
      },
    ],
  });

  await logAiUsage({
    userId: null,
    garaId: null,
    operazione: "kb_struttura_titoli",
    provider: "anthropic",
    model: MODEL,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });

  return response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n")
    .trim();
}

export async function extractStrutturaTitoli(
  nomeFile: string,
  buffer: Buffer,
): Promise<string> {
  if (nomeFile.toLowerCase().endsWith(".docx")) {
    return strutturaDocx(buffer);
  }
  return strutturaPdf(buffer);
}
