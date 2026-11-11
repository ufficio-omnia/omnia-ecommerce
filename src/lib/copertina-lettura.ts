import { PDFDocument } from "pdf-lib";
import type { SupabaseClient } from "@supabase/supabase-js";
import { extractText } from "@/lib/document-text";
import { ErroreOpenAI, postaAOpenAI } from "@/lib/copertina-openai";
import { usoDaRisposta, type UsoImmagine } from "@/lib/copertina-relazione-calcoli";
import {
  ISTRUZIONI_LETTURA,
  LETTURA_MODELLO_PREDEFINITO,
  LETTURA_PAGINE,
  SCHEMA_LETTURA,
  leggiRispostaLettura,
  testoDaRisposta,
  verificaLettura,
  type EsitoLettura,
  type LetturaGara,
} from "@/lib/copertina-lettura-calcoli";

// La lettura del disciplinare/capitolato per la copertina: scarica il PDF scelto, ne prende le prime pagine, lo fa leggere a OpenAI (titolo, CIG,
// indicazioni per lo sfondo) e controlla titolo e CIG sul testo del PDF. Regole, istruzioni e controlli: copertina-lettura-calcoli.ts.

const URL_RISPOSTE = "https://api.openai.com/v1/responses";
const TEMPO_MASSIMO_MS = 120_000;
// Se il PDF non si riesce a tagliare (es. struttura che pdf-lib non riapre) lo si manda intero solo se è di dimensioni ragionevoli
const DIMENSIONE_MASSIMA_INTERO = 15 * 1024 * 1024;

export function modelloLettura(env: Record<string, string | undefined> = process.env): string {
  return env.OPENAI_LETTURA_MODEL?.trim() || LETTURA_MODELLO_PREDEFINITO;
}

// Le prime pagine del PDF come PDF a sé (il frontespizio e l'oggetto dell'appalto stanno lì; il resto costerebbe soltanto)
export async function primePagine(pdf: Buffer, quante: number = LETTURA_PAGINE): Promise<Buffer> {
  try {
    const sorgente = await PDFDocument.load(pdf, { ignoreEncryption: true });
    if (sorgente.getPageCount() <= quante) return pdf;
    const taglio = await PDFDocument.create();
    const pagine = await taglio.copyPages(sorgente, Array.from({ length: quante }, (_, i) => i));
    for (const pagina of pagine) taglio.addPage(pagina);
    return Buffer.from(await taglio.save());
  } catch (err) {
    console.error("Copertina: non riesco a tagliare il PDF alle prime pagine", err instanceof Error ? err.message : err);
    if (pdf.length > DIMENSIONE_MASSIMA_INTERO) throw new ErroreOpenAI("Il PDF è troppo grande per essere letto.");
    return pdf;
  }
}

// Una richiesta a OpenAI (Responses API) con il PDF in allegato e la risposta vincolata allo schema. Il PDF arriva già tagliato.
export async function chiediLetturaAOpenAI(params: {
  pdf: Buffer;
  apiKey: string;
  modello: string;
  fetchFn?: typeof fetch;
}): Promise<{ lettura: LetturaGara; uso: UsoImmagine }> {
  const { pdf, apiKey, modello } = params;
  const corpo = await postaAOpenAI({
    url: URL_RISPOSTE,
    apiKey,
    tempoMassimoMs: TEMPO_MASSIMO_MS,
    fetchFn: params.fetchFn,
    corpo: {
      model: modello,
      reasoning: { effort: "low" },
      input: [
        {
          role: "user",
          content: [
            { type: "input_file", filename: "documento-di-gara.pdf", file_data: `data:application/pdf;base64,${pdf.toString("base64")}` },
            { type: "input_text", text: ISTRUZIONI_LETTURA },
          ],
        },
      ],
      text: { format: { type: "json_schema", name: "dati_copertina", strict: true, schema: SCHEMA_LETTURA } },
    },
  });
  const lettura = leggiRispostaLettura(testoDaRisposta(corpo));
  if (!lettura) throw new ErroreOpenAI("OpenAI non ha restituito una lettura utilizzabile del documento.");
  return { lettura, uso: usoDaRisposta(corpo) };
}

export type DocumentoDaLeggere = { file_path: string; nome_file: string };

export type LetturaDocumento = { lettura: LetturaGara; esito: EsitoLettura; uso: UsoImmagine; modello: string };

// Dal file nel bucket «gare» alla lettura verificata. Il testo del PDF (le stesse pagine mandate a OpenAI) serve solo a controllare titolo e CIG.
export async function leggiDocumentoPerCopertina(params: {
  admin: SupabaseClient;
  documento: DocumentoDaLeggere;
  apiKey: string;
  titoloGara: string;
  cigGara: string | null;
  modello?: string;
  fetchFn?: typeof fetch;
  // sostituibile per provare senza storage
  scarica?: (percorso: string) => Promise<Buffer | null>;
}): Promise<LetturaDocumento> {
  const scarica =
    params.scarica ??
    (async (percorso: string) => {
      const { data, error } = await params.admin.storage.from("gare").download(percorso);
      if (error || !data) return null;
      return Buffer.from(await data.arrayBuffer());
    });

  const intero = await scarica(params.documento.file_path);
  if (!intero) throw new ErroreOpenAI("Non riesco a scaricare il documento dallo spazio di archiviazione.");
  const pdf = await primePagine(intero);

  // il testo per i controlli: se non si riesce a estrarre il PDF è come una scansione (controlli non possibili, e si avvisa)
  let testoPdf = "";
  try {
    testoPdf = await extractText(params.documento.nome_file, pdf);
  } catch (err) {
    console.error("Copertina: estrazione del testo dal PDF non riuscita", err instanceof Error ? err.message : err);
  }

  const modello = params.modello ?? modelloLettura();
  const { lettura, uso } = await chiediLetturaAOpenAI({ pdf, apiKey: params.apiKey, modello, fetchFn: params.fetchFn });
  const esito = verificaLettura({ lettura, testoPdf, titoloGara: params.titoloGara, cigGara: params.cigGara });
  return { lettura, esito, uso, modello };
}
