import { createHash } from "crypto";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { PDFDocument } from "pdf-lib";
import { mediaTypeImmagine } from "@/lib/attachment-text";

// Piano di lavoro: preparazione dei documenti di gara da dare al modello. Funzioni senza rete e senza database.
//
// Un cliente carica di tutto: PDF, Word, Excel, immagini, e spesso anche moduli amministrativi, copie dello stesso
// file, versioni rettificate accanto a quelle originali, decine di planimetrie. Qui si decide cosa leggere e come:
//   - PDF → blocco documento nativo (il modello vede anche tabelle e pagine scansionate);
//   - Word (.docx) → testo con le tabelle riga per riga (mammoth.convertToHtml, non il testo grezzo che le sfascia);
//   - Excel/CSV → testo per foglio, senza righe e celle vuote, con un tetto di lunghezza;
//   - immagini → blocco immagine (fino a 5 MB);
//   - tutto il resto (vecchi .doc, .odt, .rtf, .xml) → non letto, come per il caricamento delle gare.
// Nulla viene scartato in silenzio: ogni documento non letto finisce nell'elenco con il motivo, che arriva in
// copertina nell'Excel.

export type DocumentoIn = { nome: string; buffer: Buffer };

export type Formato = "pdf" | "word" | "tabella" | "immagine" | "testo" | "non_supportato";
export type Rilevanza = "alta" | "media" | "bassa" | "esclusa";

export type Contenuto =
  | { tipo: "pdf"; base64: string }
  | { tipo: "immagine"; base64: string; mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp" }
  | { tipo: "testo"; testo: string };

export type DocumentoPreparato = {
  nome: string;
  formato: Formato;
  rilevanza: Rilevanza;
  // «scheda» = documento per singola sede (tipicamente un foglio Excel per impianto); «principale» = tutto il resto
  ruolo: "principale" | "scheda";
  tokenStimati: number;
  pagine: number | null;
  byte: number;
  contenuto: Contenuto;
};

export type DocumentoSaltato = { nome: string; motivo: string };

export type Preparazione = {
  principali: DocumentoPreparato[];
  schede: DocumentoPreparato[];
  saltati: DocumentoSaltato[];
  tokenStimati: number;
};

export const LIMITI_DOCUMENTI = {
  byteImmagine: 5 * 1024 * 1024,
  bytePdf: 20 * 1024 * 1024,
  byteOffice: 10 * 1024 * 1024,
  // caratteri di testo per documento (circa 20.000 token): oltre si tronca, e il documento lo dice
  caratteriPerDocumento: 70_000,
  tokenPerPagina: 2200,
  tokenPerImmagine: 1700,
  caratteriPerToken: 3.2,
  // oltre questa stima di token dei documenti letti si lasciano fuori i meno pertinenti
  tokenMassimiTotali: 750_000,
  // i documenti «bassa» (DUVRI, schema di contratto, capitolato generale…) si leggono solo se pesano poco in tutto
  tokenMassimiBassa: 60_000,
  // schede (un documento per sede) in un'unica richiesta al modello
  schedePerRichiesta: 14,
  tokenPerRichiestaSchede: 150_000,
  // documenti principali per richiesta
  tokenPerRichiestaPrincipali: 450_000,
  paginePerRichiesta: 280,
  bytePerRichiesta: 26 * 1024 * 1024,
} as const;

const ESTENSIONI_IMMAGINE = ["png", "jpg", "jpeg", "gif", "webp"];

function estensione(nome: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(nome.trim());
  return m ? m[1].toLowerCase() : "";
}

export function formatoDocumento(nome: string): Formato {
  const e = estensione(nome);
  if (e === "pdf") return "pdf";
  if (e === "docx") return "word";
  if (e === "xlsx" || e === "xls" || e === "csv") return "tabella";
  if (ESTENSIONI_IMMAGINE.includes(e)) return "immagine";
  if (e === "txt") return "testo";
  return "non_supportato";
}

const TESTO_NON_SUPPORTATO = "formato non letto (si leggono PDF, Word .docx, Excel, CSV, testo e immagini; un vecchio .doc va salvato come .docx)";

// ───── pertinenza, deduzione per nome ─────

const NORMALIZZA = (nome: string) =>
  nome
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,4}$/, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Moduli e dichiarazioni amministrative: non contengono nulla per il piano di lavoro.
const RE_ESCLUSA =
  /antimafia|dgue|domanda di partecipazione|istanza di partecipazione|modello istanza|informativa|privacy|trattamento dati|whistleblowing|segnalazioni|patto d ?integrit|protocollo (di )?(tutela|legalit)|avvalimento|segret|clausole vessatorie|certificat\w* (di )?(avvenuto )?sopralluogo|richiesta sopralluogo|modalita operative sopralluogh|dichiarazion\w* (sostitutiv|integrativ|conformit|assenza|titolare|tributi|legge|di equivalenza)|dichiarazione clausola sociale|titolare effettivo|conflitto di interessi|tracciabilit|tributi locali|soggetti.*art ?94|controlli antimafia|offerta economica|schema di offerta|tabella di ponderazione|stazione appaltante .*dichiarazione|ricevuta|cookie/;

// Utili ma generici o pesanti: si leggono se c'è posto.
const RE_BASSA = /duvri|schema di contratto|capitolato generale|\bcam\b|dichiarazione cam|modalita tecniche|decreto|gazzetta|gazz |ojs|estratto gu/;

const RE_ALTA = /capitolato|\bcsa\b|disciplinare|bando|relazione|stima|quadro economico|elenco (del )?personale|personale|clausola sociale|consistenza|monte ore|immobili|\bsedi\b|scheda|schede|programma attivita|cadenz|frequenz|chiarimenti|quesiti|rettific|errata|decisione (a|di) contrarre|determina|\bmq\b|superfic|progetto|lotto/;

export function rilevanzaDocumento(nome: string): Rilevanza {
  const n = NORMALIZZA(nome);
  if (RE_ESCLUSA.test(n)) return "esclusa";
  if (RE_BASSA.test(n)) return "bassa";
  if (RE_ALTA.test(n)) return "alta";
  return "media";
}

const RE_DISEGNO = /pianta|piante|planimetri|distributivo|prospett|tavola|elaborato grafico|sottovasca|sottotribuna|tribuna vasca|piano (terra|primo|secondo|interrato|seminterrato|rialzato|ammezzato)|\bquote\b/;

// Per riconoscere la stessa carta in due versioni (originale e rettificata, o la copia): il nome senza le parole che
// indicano la revisione e senza le date. Conservativo: due documenti diversi non devono mai avere la stessa chiave.
export function chiaveBaseDocumento(nome: string): string {
  // solo il nome del file: una cartella (es. «DOC. RETTIFICATA/») non deve far sembrare diverso lo stesso documento
  return NORMALIZZA(nome.split(/[\\/]/).pop() ?? nome)
    .replace(/\b(rev|revisione|revisionato|revisionata|rettificat[oa]|def|definitivo|signed|firmato|copia|agg|aggiornato|aggiornata|v\d+)\b/g, " ")
    .replace(/\b\d{1,2} \d{1,2}( \d{2,4})?\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ───── lettura dei formati ─────

function decodificaEntita(t: string): string {
  return t
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));
}

// Word → testo, con le tabelle riga per riga («cella | cella | cella») e senza le immagini incorporate.
export async function docxATesto(buffer: Buffer): Promise<string> {
  const risultato = await mammoth.convertToHtml({ buffer }, { convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: "" })) });
  const testo = decodificaEntita(
    risultato.value
      .replace(/<img[^>]*>/g, "")
      // dentro una cella i paragrafi non vanno a capo: la riga della tabella resta una riga
      .replace(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g, (_, interno: string) => `${interno.replace(/<\/p>|<br\s*\/?>/g, " ").replace(/<[^>]+>/g, "").trim()} | `)
      .replace(/<\/tr>/g, "\n")
      .replace(/<\/(p|h[1-6]|li|table)>/g, "\n")
      .replace(/<br\s*\/?>/g, "\n")
      .replace(/<li[^>]*>/g, "- ")
      .replace(/<[^>]+>/g, ""),
  );
  return testo
    .split("\n")
    .map((r) => r.replace(/(\s*\|\s*)+$/, "").trim())
    .filter((r, i, tutte) => r !== "" || (tutte[i - 1] ?? "") !== "")
    .join("\n")
    .trim();
}

function cella(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(4)));
  return String(v).replace(/\s+/g, " ").trim();
}

// Excel/CSV → testo per foglio: righe e celle vuote tolte, righe uguali di fila una sola volta, tetto di lunghezza.
export function tabellaATesto(nome: string, buffer: Buffer, maxCaratteri: number = LIMITI_DOCUMENTI.caratteriPerDocumento): { testo: string; troncato: boolean } {
  if (estensione(nome) === "csv") {
    const t = buffer.toString("utf-8").trim();
    return t.length > maxCaratteri ? { testo: t.slice(0, maxCaratteri), troncato: true } : { testo: t, troncato: false };
  }
  const wb = XLSX.read(buffer, { type: "buffer" });
  const parti: string[] = [];
  let lunghezza = 0;
  let troncato = false;
  for (const nomeFoglio of wb.SheetNames) {
    const ws = wb.Sheets[nomeFoglio];
    if (!ws["!ref"]) continue;
    const righe = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, raw: true, defval: "" });
    const out: string[] = [`--- Foglio "${nomeFoglio}" ---`];
    let precedente = "";
    for (const riga of righe) {
      const celle = riga.map(cella);
      while (celle.length > 0 && celle[celle.length - 1] === "") celle.pop();
      if (celle.length === 0) continue;
      const testo = celle.join(" | ");
      if (testo === precedente) continue;
      precedente = testo;
      out.push(testo);
      lunghezza += testo.length + 1;
      if (lunghezza > maxCaratteri) {
        troncato = true;
        break;
      }
    }
    parti.push(out.join("\n"));
    if (troncato) break;
  }
  return { testo: parti.join("\n\n"), troncato };
}

async function pagineDelPdf(buffer: Buffer): Promise<number> {
  try {
    const d = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
    return d.getPageCount();
  } catch {
    return Math.max(1, Math.round(buffer.length / 60_000));
  }
}

const stimaTokenTesto = (t: string) => Math.ceil(t.length / LIMITI_DOCUMENTI.caratteriPerToken);

// ───── preparazione ─────

export async function preparaDocumenti(documenti: DocumentoIn[]): Promise<Preparazione> {
  const saltati: DocumentoSaltato[] = [];
  const candidati: { doc: DocumentoIn; indice: number; formato: Formato; rilevanza: Rilevanza }[] = [];

  // formato, copie identiche, pertinenza
  // di più file identici si tiene quello senza «- Copia» nel nome (altrimenti il primo)
  const rappresentante = new Map<string, string>();
  for (const doc of documenti) {
    if (formatoDocumento(doc.nome) === "non_supportato") continue;
    const impronta = createHash("sha256").update(doc.buffer).digest("hex");
    const attuale = rappresentante.get(impronta);
    if (!attuale || (/\bcopia\b/i.test(attuale) && !/\bcopia\b/i.test(doc.nome))) rappresentante.set(impronta, doc.nome);
  }
  documenti.forEach((doc, indice) => {
    const formato = formatoDocumento(doc.nome);
    if (formato === "non_supportato") {
      saltati.push({ nome: doc.nome, motivo: TESTO_NON_SUPPORTATO });
      return;
    }
    const impronta = createHash("sha256").update(doc.buffer).digest("hex");
    const tenuto = rappresentante.get(impronta);
    if (tenuto !== doc.nome) {
      saltati.push({ nome: doc.nome, motivo: `copia identica di «${tenuto}»` });
      return;
    }
    const rilevanza = rilevanzaDocumento(doc.nome);
    if (rilevanza === "esclusa") {
      saltati.push({ nome: doc.nome, motivo: "modulo o documento amministrativo, non utile al piano di lavoro" });
      return;
    }
    candidati.push({ doc, indice, formato, rilevanza });
  });

  // la versione successiva sostituisce la precedente dello stesso documento (originale/rettificato, «- Copia» modificata)
  const perChiave = new Map<string, typeof candidati>();
  for (const c of candidati) {
    const k = `${c.formato}:${chiaveBaseDocumento(c.doc.nome)}`;
    perChiave.set(k, [...(perChiave.get(k) ?? []), c]);
  }
  const sostituiti = new Set<number>();
  for (const gruppo of perChiave.values()) {
    if (gruppo.length < 2) continue;
    const ultimo = gruppo.reduce((a, b) => (b.indice > a.indice ? b : a));
    for (const c of gruppo) {
      if (c === ultimo) continue;
      sostituiti.add(c.indice);
      saltati.push({ nome: c.doc.nome, motivo: `sostituito dalla versione successiva «${ultimo.doc.nome}»` });
    }
  }

  const preparati: DocumentoPreparato[] = [];
  for (const c of candidati) {
    if (sostituiti.has(c.indice)) continue;
    const { doc, formato, rilevanza } = c;
    const base = { nome: doc.nome, formato, rilevanza, byte: doc.buffer.length, pagine: null as number | null };
    try {
      if (formato === "pdf") {
        if (doc.buffer.length > LIMITI_DOCUMENTI.bytePdf) {
          saltati.push({ nome: doc.nome, motivo: `PDF troppo grande (${(doc.buffer.length / 1048576).toFixed(0)} MB, limite 20 MB)` });
          continue;
        }
        const pagine = await pagineDelPdf(doc.buffer);
        if (pagine <= 1 && RE_DISEGNO.test(NORMALIZZA(doc.nome))) {
          saltati.push({ nome: doc.nome, motivo: "planimetria o disegno: le superfici si leggono dalle tabelle e dalle schede" });
          continue;
        }
        preparati.push({ ...base, pagine, ruolo: "principale", tokenStimati: pagine * LIMITI_DOCUMENTI.tokenPerPagina, contenuto: { tipo: "pdf", base64: doc.buffer.toString("base64") } });
      } else if (formato === "immagine") {
        if (doc.buffer.length > LIMITI_DOCUMENTI.byteImmagine) {
          saltati.push({ nome: doc.nome, motivo: `immagine troppo grande (${(doc.buffer.length / 1048576).toFixed(1)} MB, limite 5 MB)` });
          continue;
        }
        if (RE_DISEGNO.test(NORMALIZZA(doc.nome))) {
          saltati.push({ nome: doc.nome, motivo: "planimetria o disegno: le superfici si leggono dalle tabelle e dalle schede" });
          continue;
        }
        preparati.push({ ...base, ruolo: "principale", tokenStimati: LIMITI_DOCUMENTI.tokenPerImmagine, contenuto: { tipo: "immagine", base64: doc.buffer.toString("base64"), mediaType: mediaTypeImmagine(doc.nome) } });
      } else {
        if (doc.buffer.length > LIMITI_DOCUMENTI.byteOffice) {
          saltati.push({ nome: doc.nome, motivo: `file troppo grande (${(doc.buffer.length / 1048576).toFixed(0)} MB, limite 10 MB)` });
          continue;
        }
        let testo: string;
        let troncato = false;
        if (formato === "word") testo = await docxATesto(doc.buffer);
        else if (formato === "tabella") ({ testo, troncato } = tabellaATesto(doc.nome, doc.buffer));
        else testo = doc.buffer.toString("utf-8");
        if (testo.length > LIMITI_DOCUMENTI.caratteriPerDocumento) {
          testo = testo.slice(0, LIMITI_DOCUMENTI.caratteriPerDocumento);
          troncato = true;
        }
        // le sole intestazioni dei fogli non sono contenuto
        if (testo.replace(/^--- Foglio .*? ---$/gm, "").trim().length < 20) {
          saltati.push({ nome: doc.nome, motivo: "nessun testo leggibile (documento vuoto o fatto di sole immagini)" });
          continue;
        }
        if (troncato) testo += "\n[... documento troncato: troppo lungo ...]";
        preparati.push({ ...base, ruolo: "principale", tokenStimati: stimaTokenTesto(testo), contenuto: { tipo: "testo", testo } });
      }
    } catch (e) {
      saltati.push({ nome: doc.nome, motivo: `non leggibile (${e instanceof Error ? e.message.slice(0, 80) : "errore"})` });
    }
  }

  // più fogli Excel = tipicamente una scheda per sede: si leggono a gruppi, dopo i documenti principali
  const tabelle = preparati.filter((d) => d.formato === "tabella");
  if (tabelle.length >= 3) for (const d of tabelle) d.ruolo = "scheda";

  // tetto sul totale: si lasciano fuori i meno pertinenti
  const ordineRilevanza: Record<Rilevanza, number> = { alta: 0, media: 1, bassa: 2, esclusa: 3 };
  const perPriorita = [...preparati].sort((a, b) => ordineRilevanza[a.rilevanza] - ordineRilevanza[b.rilevanza]);
  let totale = 0;
  let totaleBassa = 0;
  const tenuti = new Set<DocumentoPreparato>();
  // a pari pertinenza prima i più piccoli: nel budget dei «bassa» ne entrano di più
  perPriorita.sort((a, b) => ordineRilevanza[a.rilevanza] - ordineRilevanza[b.rilevanza] || (a.rilevanza === "bassa" ? a.tokenStimati - b.tokenStimati : 0));
  for (const d of perPriorita) {
    if (d.rilevanza === "bassa" && totaleBassa + d.tokenStimati > LIMITI_DOCUMENTI.tokenMassimiBassa) {
      saltati.push({ nome: d.nome, motivo: "documento generico o poco pertinente e pesante (DUVRI, capitolato generale…): non letto" });
      continue;
    }
    if (totale + d.tokenStimati > LIMITI_DOCUMENTI.tokenMassimiTotali) {
      saltati.push({ nome: d.nome, motivo: "oltre il limite di lettura della gara (documenti meno pertinenti lasciati fuori)" });
      continue;
    }
    totale += d.tokenStimati;
    if (d.rilevanza === "bassa") totaleBassa += d.tokenStimati;
    tenuti.add(d);
  }
  const finali = preparati.filter((d) => tenuti.has(d));
  return { principali: finali.filter((d) => d.ruolo === "principale"), schede: finali.filter((d) => d.ruolo === "scheda"), saltati, tokenStimati: totale };
}

// ───── gruppi di documenti per richiesta ─────

export function creaLotti(documenti: DocumentoPreparato[], limiti: { token: number; pagine: number; byte: number; documenti: number }): DocumentoPreparato[][] {
  const lotti: DocumentoPreparato[][] = [];
  let corrente: DocumentoPreparato[] = [];
  let token = 0;
  let pagine = 0;
  let byte = 0;
  for (const d of documenti) {
    const dopo = { token: token + d.tokenStimati, pagine: pagine + (d.pagine ?? 0), byte: byte + (d.contenuto.tipo === "testo" ? 0 : d.byte), n: corrente.length + 1 };
    if (corrente.length > 0 && (dopo.token > limiti.token || dopo.pagine > limiti.pagine || dopo.byte > limiti.byte || dopo.n > limiti.documenti)) {
      lotti.push(corrente);
      corrente = [];
      token = pagine = byte = 0;
    }
    corrente.push(d);
    token += d.tokenStimati;
    pagine += d.pagine ?? 0;
    byte += d.contenuto.tipo === "testo" ? 0 : d.byte;
  }
  if (corrente.length > 0) lotti.push(corrente);
  return lotti;
}
