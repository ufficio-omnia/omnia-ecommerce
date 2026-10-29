import "pdf-parse/worker";
import { PDFParse } from "pdf-parse";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAiUsage } from "@/lib/ai-usage";
import { ordinaPerCaricamento, testoDataCaricamento } from "@/lib/gara-documenti-elenco";
import type { RisultatoScadenza } from "@/lib/gara-proroga";
import {
  MAX_BYTE_PDF_INTERO,
  NOME_STRUMENTO_PROROGA,
  OPERAZIONE_PROROGA,
  PROPRIETA_STRUMENTO_PROROGA,
  selezionaPassaggi,
  selezioneVuota,
  sembraUnAtto,
  testoSecondoPassaggio,
  type DocumentoPerPassaggio,
  type PaginaTesto,
  type SelezionePassaggi,
} from "@/lib/gara-proroga-passaggio";

// Secondo passaggio mirato sulla proroga dei termini (vedi src/lib/gara-proroga-passaggio.ts per il perché e le regole).
// Questo file legge i PDF e chiama il modello; le decisioni stanno nel file puro. NON è un file "use server" (esporta anche
// funzioni non async e tipi) e NON scrive mai sulle gare: l'unica scrittura è il costo della chiamata in ai_operazioni.

export const MODELLO_PROROGA = "claude-sonnet-5"; // lo stesso dell'analisi generale
const TEMPO_MAX_LETTURA_PDF_MS = 40_000;
const LETTURE_IN_PARALLELO = 4;

export type PdfDellaGara = { id: string; nome_file: string; file_path: string; created_at: string };
export type DocumentoLetto = { doc: DocumentoPerPassaggio; buffer: Buffer | null };

// Il testo di ogni pagina del PDF. null = non leggibile (errore o troppo lento): il documento non partecipa alla ricerca.
export async function leggiPagine(buffer: Buffer): Promise<{ pagine: PaginaTesto[]; totale: number } | null> {
  let parser: PDFParse | null = null;
  try {
    parser = new PDFParse({ data: buffer });
    const lettura = parser.getText({ pageJoiner: "\n\n" });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scaduto = new Promise<never>((_, rifiuta) => {
      timer = setTimeout(() => rifiuta(new Error("tempo di lettura del PDF scaduto")), TEMPO_MAX_LETTURA_PDF_MS);
    });
    try {
      const testo = await Promise.race([lettura, scaduto]);
      return { pagine: testo.pages.map((p) => ({ numero: p.num, testo: p.text })), totale: testo.total };
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch {
    return null;
  } finally {
    try {
      await parser?.destroy();
    } catch {
      // niente da fare: la lettura è comunque finita
    }
  }
}

// Un documento pronto per la selezione. Il file si tiene in memoria SOLO se potrebbe servire per intero (atto piccolo).
export async function leggiDocumento(indice: number, nome: string, caricatoIl: string, buffer: Buffer): Promise<DocumentoLetto> {
  const lettura = await leggiPagine(buffer);
  const piccoloAtto = sembraUnAtto(nome) && buffer.byteLength <= MAX_BYTE_PDF_INTERO;
  return {
    doc: { indice, nome, caricatoIl, pagine: lettura?.pagine ?? null, totalePagine: lettura?.totale ?? 0, byte: buffer.byteLength },
    buffer: piccoloAtto ? buffer : null,
  };
}

export type ValutazioneProroga = {
  esito: RisultatoScadenza | null;
  inputTokens: number;
  outputTokens: number;
};

// La chiamata al modello sui soli passaggi scelti (e sugli atti senza testo, per intero).
export async function valutaSecondoPassaggio(params: {
  anthropic: Anthropic;
  selezione: SelezionePassaggi;
  documenti: DocumentoLetto[];
}): Promise<ValutazioneProroga> {
  const { anthropic, selezione, documenti } = params;
  const elenco = documenti.map((d) => ({ indice: d.doc.indice, nome: d.doc.nome, caricatoIl: d.doc.caricatoIl }));

  const blocchi: Anthropic.DocumentBlockParam[] = [];
  for (const indice of selezione.pdfInteri) {
    const trovato = documenti.find((d) => d.doc.indice === indice);
    if (trovato?.buffer) blocchi.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: trovato.buffer.toString("base64") } });
  }

  const strumento: Anthropic.Tool = {
    name: NOME_STRUMENTO_PROROGA,
    description: "Registra se un atto dispone la proroga del termine di presentazione dell'offerta di questa gara.",
    input_schema: { type: "object" as const, properties: { ...PROPRIETA_STRUMENTO_PROROGA }, required: ["proroga_termini"] },
  };

  const risposta = await anthropic.messages.create({
    model: MODELLO_PROROGA,
    max_tokens: 1500,
    thinking: { type: "disabled" },
    tools: [strumento],
    tool_choice: { type: "tool", name: NOME_STRUMENTO_PROROGA },
    messages: [{ role: "user", content: [...blocchi, { type: "text", text: testoSecondoPassaggio(selezione, elenco, testoDataCaricamento) }] }],
  });

  const uso = risposta.content.find((b) => b.type === "tool_use" && b.name === NOME_STRUMENTO_PROROGA);
  return {
    esito: uso && uso.type === "tool_use" ? (uso.input as RisultatoScadenza) : null,
    inputTokens: risposta.usage.input_tokens,
    outputTokens: risposta.usage.output_tokens,
  };
}

// Per l'analisi dei documenti di una gara: scarica i PDF, cerca i passaggi sulla proroga, li fa valutare al modello, registra il
// costo. MAI un errore verso chi la chiama: se qualcosa non va (download, lettura, modello) restituisce null e l'analisi generale
// vale da sola, come prima. Senza passaggi pertinenti non chiama il modello (nessun costo).
export async function secondoPassaggioProroga(params: {
  anthropic: Anthropic;
  admin: SupabaseClient;
  documenti: PdfDellaGara[];
  accountId: string;
  garaId: string;
}): Promise<RisultatoScadenza | null> {
  try {
    const { anthropic, admin, accountId, garaId } = params;
    const pdf = ordinaPerCaricamento(params.documenti);
    const letti: DocumentoLetto[] = new Array(pdf.length);
    let prossimo = 0;
    const lavoratore = async () => {
      for (;;) {
        const i = prossimo++;
        if (i >= pdf.length) return;
        const d = pdf[i];
        const { data: file, error } = await admin.storage.from("gare").download(d.file_path);
        if (error || !file) {
          letti[i] = { doc: { indice: i + 1, nome: d.nome_file, caricatoIl: d.created_at, pagine: null, totalePagine: 0, byte: 0 }, buffer: null };
          continue;
        }
        letti[i] = await leggiDocumento(i + 1, d.nome_file, d.created_at, Buffer.from(await file.arrayBuffer()));
      }
    };
    await Promise.all(Array.from({ length: Math.min(LETTURE_IN_PARALLELO, pdf.length) }, lavoratore));

    const selezione = selezionaPassaggi(letti.map((l) => l.doc));
    if (selezioneVuota(selezione)) return null;

    const valutazione = await valutaSecondoPassaggio({ anthropic, selezione, documenti: letti });
    try {
      await logAiUsage({
        userId: accountId,
        garaId,
        operazione: OPERAZIONE_PROROGA,
        provider: "anthropic",
        model: MODELLO_PROROGA,
        inputTokens: valutazione.inputTokens,
        outputTokens: valutazione.outputTokens,
      });
    } catch {
      // il costo non registrato non deve togliere il risultato (logAiUsage non propaga errori, ma non ci si fida)
    }
    return valutazione.esito;
  } catch (errore) {
    console.warn("Secondo passaggio sulla proroga dei termini non riuscito:", errore instanceof Error ? errore.message : errore);
    return null;
  }
}
