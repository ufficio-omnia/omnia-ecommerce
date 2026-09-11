import mammoth from "mammoth";
import * as XLSX from "xlsx";

// Tipi di allegato accettati in chat (immagini, PDF, Word, Excel/CSV):
// ciascuno ha un modo diverso di "arrivare" al modello — immagine e PDF
// vengono allegati come blocchi nativi (vision/documento) alla chiamata
// Claude, Word/Excel/CSV vengono invece convertiti in testo qui e inseriti
// come contesto nel messaggio, come i documenti di gara caricati altrove.
export type CategoriaAllegato = "immagine" | "pdf" | "word" | "excel" | "non_supportato";

const ESTENSIONI_IMMAGINE = ["png", "jpg", "jpeg", "gif", "webp"];
const ESTENSIONI_EXCEL = ["xlsx", "xls", "csv"];

export function categorizzaAllegato(nomeFile: string): CategoriaAllegato {
  const estensione = nomeFile.toLowerCase().split(".").pop() ?? "";
  if (ESTENSIONI_IMMAGINE.includes(estensione)) return "immagine";
  if (estensione === "pdf") return "pdf";
  if (estensione === "docx") return "word";
  if (ESTENSIONI_EXCEL.includes(estensione)) return "excel";
  return "non_supportato";
}

// Limiti per categoria: le immagini/PDF vengono inviati per intero in
// base64 alla API (che ha i propri limiti), Word/Excel vengono letti
// interamente in memoria per estrarne il testo — meglio un limite
// prudente lato nostro che un errore poco chiaro dall'API o un file che
// blocca il processo.
export const LIMITE_BYTE_PER_CATEGORIA: Record<CategoriaAllegato, number> = {
  immagine: 5 * 1024 * 1024,
  pdf: 20 * 1024 * 1024,
  word: 10 * 1024 * 1024,
  excel: 10 * 1024 * 1024,
  non_supportato: 0,
};

export const MAX_ALLEGATI_PER_MESSAGGIO = 5;

const MEDIA_TYPE_PER_ESTENSIONE_IMMAGINE: Record<string, "image/png" | "image/jpeg" | "image/gif" | "image/webp"> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

export function mediaTypeImmagine(nomeFile: string): "image/png" | "image/jpeg" | "image/gif" | "image/webp" {
  const estensione = nomeFile.toLowerCase().split(".").pop() ?? "";
  return MEDIA_TYPE_PER_ESTENSIONE_IMMAGINE[estensione] ?? "image/png";
}

// Estrae il testo di un allegato Word o Excel/CSV caricato in chat, per
// includerlo come contesto testuale nel messaggio — immagini e PDF non
// passano da qui: vengono allegati come blocchi nativi (vedi
// categorizzaAllegato).
export async function estraiTestoAllegato(nomeFile: string, buffer: Buffer): Promise<string> {
  const categoria = categorizzaAllegato(nomeFile);

  if (categoria === "word") {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (categoria === "excel") {
    const estensione = nomeFile.toLowerCase().split(".").pop();
    if (estensione === "csv") {
      return buffer.toString("utf-8");
    }
    const workbook = XLSX.read(buffer, { type: "buffer" });
    return workbook.SheetNames.map((nomeFoglio) => {
      const foglio = workbook.Sheets[nomeFoglio];
      const csv = XLSX.utils.sheet_to_csv(foglio);
      return `--- Foglio "${nomeFoglio}" ---\n${csv}`;
    }).join("\n\n");
  }

  throw new Error(`estraiTestoAllegato chiamato su una categoria non testuale: ${categoria}`);
}
