// Interprete minimo del markdown dei documenti legali (legal/*.md). Il file in
// legal/ è l'UNICA fonte del testo: la pagina web e il PDF scaricabile nascono dallo
// stesso interprete, quindi non possono divergere tra loro né dall'impronta SHA-256
// registrata in legal_documents.
//
// Supporta solo ciò che i documenti usano: titoli (#, ##, ###), paragrafi, elenchi
// puntati, tabelle a barre verticali, grassetto (**) e corsivo (*). Qualunque altra
// cosa non viene scartata in silenzio: finisce in `avvisi`, e l'autotest
// (scripts/verifica-legale-omnia-ai.ts) pretende zero avvisi per ogni documento
// pubblicato — così un testo futuro con una sintassi non prevista si scopre subito,
// non in produzione.

export type Inline = { tipo: "testo" | "grassetto" | "corsivo"; testo: string };

export type Blocco =
  | { tipo: "h1" | "h2" | "h3"; inline: Inline[]; testo: string; id: string | null }
  | { tipo: "paragrafo"; inline: Inline[] }
  | { tipo: "elenco"; voci: Inline[][] }
  | { tipo: "tabella"; intestazione: Inline[][]; righe: Inline[][][] };

export type DocumentoLegale = { blocchi: Blocco[]; avvisi: string[] };

// ───── Inline ─────

export function interpretaInline(testo: string, avvisi: string[] = []): Inline[] {
  const risultato: Inline[] = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  let ultimo = 0;
  for (const m of testo.matchAll(re)) {
    const inizio = m.index ?? 0;
    if (inizio > ultimo) risultato.push({ tipo: "testo", testo: testo.slice(ultimo, inizio) });
    if (m[1] !== undefined) risultato.push({ tipo: "grassetto", testo: m[1] });
    else risultato.push({ tipo: "corsivo", testo: m[2] });
    ultimo = inizio + m[0].length;
  }
  if (ultimo < testo.length) risultato.push({ tipo: "testo", testo: testo.slice(ultimo) });
  // un asterisco rimasto fuori da una coppia è quasi certamente un errore di battitura
  if (risultato.some((s) => s.testo.includes("*"))) avvisi.push(`asterisco non chiuso: «${testo.slice(0, 60)}»`);
  return risultato;
}

export function testoSemplice(inline: Inline[]): string {
  return inline.map((s) => s.testo).join("");
}

// ───── Blocchi ─────

// Identificativi per i collegamenti interni: «## 10. Titolo» → clausola-10 (usato dalla
// casella di approvazione specifica), «### Art. 3 — Titolo» → art-3.
function idIntestazione(tipo: "h1" | "h2" | "h3", testo: string): string | null {
  if (tipo === "h2") {
    const m = testo.match(/^(\d+)\.\s/);
    if (m) return `clausola-${m[1]}`;
  }
  if (tipo === "h3") {
    const m = testo.match(/^Art\.\s*(\d+)\b/);
    if (m) return `art-${m[1]}`;
  }
  return null;
}

function celleTabella(riga: string): string[] {
  return riga.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

export function interpretaMarkdown(markdown: string): DocumentoLegale {
  const avvisi: string[] = [];
  const blocchi: Blocco[] = [];
  const righe = markdown.replace(/\r\n/g, "\n").split("\n");

  let paragrafo: string[] = [];
  let elenco: string[] = [];

  const chiudiParagrafo = () => {
    if (paragrafo.length > 0) blocchi.push({ tipo: "paragrafo", inline: interpretaInline(paragrafo.join(" "), avvisi) });
    paragrafo = [];
  };
  const chiudiElenco = () => {
    if (elenco.length > 0) blocchi.push({ tipo: "elenco", voci: elenco.map((v) => interpretaInline(v, avvisi)) });
    elenco = [];
  };

  for (let i = 0; i < righe.length; i++) {
    const riga = righe[i];
    const pulita = riga.trim();

    if (pulita === "") {
      chiudiParagrafo();
      chiudiElenco();
      continue;
    }

    const titolo = pulita.match(/^(#{1,6})\s+(.+)$/);
    if (titolo) {
      chiudiParagrafo();
      chiudiElenco();
      if (titolo[1].length > 3) {
        avvisi.push(`titolo di livello ${titolo[1].length} non supportato: «${pulita.slice(0, 60)}»`);
        continue;
      }
      const tipo = `h${titolo[1].length}` as "h1" | "h2" | "h3";
      const inline = interpretaInline(titolo[2], avvisi);
      const testo = testoSemplice(inline);
      blocchi.push({ tipo, inline, testo, id: idIntestazione(tipo, testo) });
      continue;
    }

    if (pulita.startsWith("|")) {
      chiudiParagrafo();
      chiudiElenco();
      const gruppo: string[] = [];
      while (i < righe.length && righe[i].trim().startsWith("|")) gruppo.push(righe[i++].trim());
      i -= 1;
      const separatore = gruppo[1] !== undefined && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/.test(gruppo[1]);
      if (gruppo.length < 3 || !separatore) {
        avvisi.push(`tabella malformata (servono intestazione, separatore e almeno una riga): «${gruppo[0].slice(0, 60)}»`);
        continue;
      }
      const intestazione = celleTabella(gruppo[0]);
      const righeTabella = gruppo.slice(2).map(celleTabella);
      if (righeTabella.some((r) => r.length !== intestazione.length)) avvisi.push(`tabella con righe di larghezza diversa dall'intestazione: «${gruppo[0].slice(0, 60)}»`);
      blocchi.push({
        tipo: "tabella",
        intestazione: intestazione.map((c) => interpretaInline(c, avvisi)),
        righe: righeTabella.map((r) => r.map((c) => interpretaInline(c, avvisi))),
      });
      continue;
    }

    if (/^[-*]\s+\S/.test(pulita) && !pulita.startsWith("**")) {
      chiudiParagrafo();
      elenco.push(pulita.replace(/^[-*]\s+/, ""));
      continue;
    }

    if (/^---+$/.test(pulita)) {
      chiudiParagrafo();
      chiudiElenco();
      avvisi.push("linea orizzontale non supportata");
      continue;
    }

    if (/^(\d+[.)]\s|>\s|```)/.test(pulita)) avvisi.push(`sintassi non supportata (elenco numerato, citazione o codice): «${pulita.slice(0, 60)}»`);

    // un paragrafo che segue un elenco senza riga vuota è quasi certamente una continuazione
    if (elenco.length > 0) {
      avvisi.push(`riga dopo un elenco senza riga vuota: «${pulita.slice(0, 60)}»`);
      chiudiElenco();
    }
    paragrafo.push(pulita);
  }
  chiudiParagrafo();
  chiudiElenco();
  return { blocchi, avvisi };
}

// ───── Segnaposto dell'Allegato A ─────

export type ValoriSegnaposto = {
  // data di entrata in vigore, già in forma leggibile («14 ottobre 2026»)
  data?: string | null;
  ragioneSociale?: string | null;
  partitaIva?: string | null;
  codiceFiscale?: string | null;
  sede?: string | null;
};

// Cosa mettere al posto di un dato che manca: «mantieni» lascia il segnaposto
// com'è (la pagina web mostra il modello), «linea» una riga da compilare a mano (il
// PDF scaricato da chi non ha ancora i dati di fatturazione).
export type ModoVuoto = "mantieni" | "linea";

const LINEA_VUOTA = "__________________";

export const SEGNAPOSTO = {
  data: "[DATA]",
  ragioneSociale: "[RAGIONE SOCIALE CLIENTE]",
  partitaIva: "[PARTITA IVA CLIENTE]",
  sede: "[SEDE CLIENTE]",
} as const;

function pulito(v: string | null | undefined): string | null {
  const t = (v ?? "").replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
}

// Il testo versionato resta identico per tutti (è quello su cui si registra
// l'impronta): i dati del cliente si uniscono SOLO al momento della visualizzazione o
// del download. Senza partita IVA ma con codice fiscale (un professionista) la dicitura
// «P.IVA …» diventa «C.F. …».
export function compilaSegnaposto(markdown: string, valori: ValoriSegnaposto, vuoto: ModoVuoto): string {
  const dato = (v: string | null | undefined, segnaposto: string): string => pulito(v) ?? (vuoto === "linea" ? LINEA_VUOTA : segnaposto);

  let testo = markdown;
  testo = testo.split(SEGNAPOSTO.data).join(dato(valori.data, SEGNAPOSTO.data));
  testo = testo.split(SEGNAPOSTO.ragioneSociale).join(dato(valori.ragioneSociale, SEGNAPOSTO.ragioneSociale));
  testo = testo.split(SEGNAPOSTO.sede).join(dato(valori.sede, SEGNAPOSTO.sede));

  const piva = pulito(valori.partitaIva);
  const cf = pulito(valori.codiceFiscale);
  if (piva) testo = testo.split(SEGNAPOSTO.partitaIva).join(piva);
  else if (cf) testo = testo.split(`P.IVA ${SEGNAPOSTO.partitaIva}`).join(`C.F. ${cf}`);
  else testo = testo.split(SEGNAPOSTO.partitaIva).join(vuoto === "linea" ? LINEA_VUOTA : SEGNAPOSTO.partitaIva);
  return testo;
}

// Segnaposto ancora presenti nel testo (per i test e per sapere se il documento è completo).
export function segnapostoRimasti(markdown: string): string[] {
  return Object.values(SEGNAPOSTO).filter((s) => markdown.includes(s));
}

// «2026-10-14» → «14 ottobre 2026». Una data di calendario, senza fuso: non si sposta.
export function dataEstesa(giorno: string): string {
  const m = giorno.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return giorno;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).toLocaleDateString("it-IT", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });
}
