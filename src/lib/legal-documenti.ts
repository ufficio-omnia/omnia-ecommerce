import fs from "fs";
import path from "path";
import { createHash } from "crypto";

// Registro dei documenti legali di OMNIA AI scritti in markdown (legal/*.md) e
// caricamento del file. Le versioni pubblicate non si modificano mai: una revisione
// è un file NUOVO con una voce nuova qui e una riga nuova in legal_documents
// (migrazione). Il file viene letto a runtime: next.config.ts lo include nel pacchetto
// di Vercel (outputFileTracingIncludes), altrimenti in produzione non esisterebbe.

export type DocumentoMarkdownRegistrato = {
  // nome del file in legal/
  file: string;
  titolo: string;
  // valore di legal_documents.document_type
  tipoDb: string;
  // il testo contiene già la riga «Versione N — in vigore dal …» (non va ripetuta nell'intestazione)
  versioneNelTesto: boolean;
};

// Una voce per documento (slug dell'indirizzo) e per versione.
export const DOCUMENTI_MARKDOWN: Record<string, Record<string, DocumentoMarkdownRegistrato>> = {
  "condizioni-abbonamento": {
    "2": { file: "condizioni-abbonamento-v2.md", titolo: "Condizioni di abbonamento", tipoDb: "omnia_ai_condizioni_abbonamento", versioneNelTesto: false },
  },
  "allegato-a": {
    "1": { file: "allegato-a-nomina-responsabile-v1.md", titolo: "Allegato A — Atto di nomina a responsabile del trattamento", tipoDb: "omnia_ai_allegato_a", versioneNelTesto: true },
  },
};

// Slug dell'indirizzo ↔ tipo nel database, per tutti i documenti di OMNIA AI
// (anche quelli ancora scritti come componenti, v1).
export const SLUG_PER_TIPO_DB: Record<string, string> = {
  omnia_ai_condizioni_abbonamento: "condizioni-abbonamento",
  omnia_ai_privacy_policy: "privacy-policy",
  omnia_ai_cookie_policy: "cookie-policy",
  omnia_ai_allegato_a: "allegato-a",
};

export const TITOLO_PER_TIPO_DB: Record<string, string> = {
  omnia_ai_condizioni_abbonamento: "Condizioni di abbonamento",
  omnia_ai_privacy_policy: "Privacy policy",
  omnia_ai_cookie_policy: "Cookie policy",
  omnia_ai_allegato_a: "Allegato A — Atto di nomina a responsabile del trattamento",
};

export function leggiMarkdownLegale(file: string): string {
  // il nome arriva solo dal registro qui sopra, mai da un indirizzo: nessun percorso libero
  if (!/^[a-z0-9-]+\.md$/.test(file)) throw new Error(`Nome di documento legale non valido: ${file}`);
  return fs.readFileSync(path.join(process.cwd(), "legal", file), "utf-8").replace(/\r\n/g, "\n");
}

export function impronta(markdown: string): string {
  return createHash("sha256").update(markdown.replace(/\r\n/g, "\n")).digest("hex");
}
