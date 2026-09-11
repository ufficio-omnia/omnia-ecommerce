import "pdf-parse/worker";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";

// Estensioni supportate per l'estrazione testo: solo formati da cui è
// possibile estrarre testo in modo affidabile.
export function isIndexableFile(nomeFile: string): boolean {
  const lower = nomeFile.toLowerCase();
  return lower.endsWith(".pdf") || lower.endsWith(".docx");
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function extractText(nomeFile: string, buffer: Buffer): Promise<string> {
  if (nomeFile.toLowerCase().endsWith(".docx")) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  const parser = new PDFParse({ data: buffer });
  // Di default pdf-parse inserisce tra le pagine un separatore testuale
  // ("-- 1 of 30 --"): niente valore semantico, ma finisce indicizzato
  // come se fosse contenuto reale del documento. Un semplice a capo è
  // sufficiente a separare le pagine per il nostro chunking.
  const parsed = await parser.getText({ pageJoiner: "\n\n" });
  await parser.destroy();
  return parsed.text;
}
