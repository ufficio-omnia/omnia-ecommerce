import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
  Table,
  TableRow,
  TableCell,
  ImageRun,
  WidthType,
  AlignmentType,
  ShadingType,
  TableOfContents,
  TableLayoutType,
  BorderStyle,
  VerticalAlign,
  Footer,
  Header,
  PageNumber,
  HorizontalPositionAlign,
  HorizontalPositionRelativeFrom,
  VerticalPositionRelativeFrom,
  TextWrappingType,
  TextWrappingSide,
} from "docx";
import { generateOrgChartPng, type LoghiOrganigramma } from "@/lib/org-chart";
import type { StileOrganigramma } from "@/lib/org-chart-style";
import { generateImagePng } from "@/lib/openai-image";
import { renderIconePng, NOMI_ICONE } from "@/lib/icons";

export type DocxFormatting = {
  font?: string;
  dimensioneCarattere?: number; // in punti (es. 12)
  interlinea?: number; // moltiplicatore (es. 1.5)
};

// Dati che compaiono nell'intestazione di ogni pagina del corpo: ciascuno
// è facoltativo, uno mancante viene semplicemente omesso dalla riga (mai
// un segnaposto visibile né un vuoto tra i separatori).
export type DatiIntestazione = {
  // Il soggetto che conduce la procedura di gara — in una gara tramite
  // centrale di committenza è la centrale stessa, non l'amministrazione
  // beneficiaria (vedi amministrazioneCommittente).
  stazioneAppaltante?: string | null;
  // L'amministrazione per cui si svolge il servizio, quando diversa dalla
  // stazione appaltante: è quella che il concorrente riconosce, quindi va
  // in testa alla riga (vedi costruisciIntestazione).
  amministrazioneCommittente?: string | null;
  cig?: string | null;
  concorrente?: string | null;
};

// Azzurro chiaro, colore usato per titoli e intestazioni di tabella nei
// documenti Word generati (richiesto esplicitamente al posto del verde
// di brand OMNIA usato nell'interfaccia della piattaforma). È il colore
// "primario" del documento: bande dei titoli di criterio, filetto
// dell'intestazione di pagina, intestazioni di tabella.
const COLORE_BRAND = "2E86C1";

// Colore "secondario": filetto sotto i titoli di sotto-criterio. Un blu
// più profondo del primario, così il filetto si distingue dal testo
// azzurro del titolo senza introdurre un terzo colore di famiglia diversa.
const COLORE_SECONDARIO = "1B4F72";

// Varianti di colore per intestazioni tabella, scelte dall'AI in base al
// contenuto (es. rossa per obblighi normativi, verde per aspetti
// ambientali) invece di un unico colore fisso per ogni tabella — come
// nei progetti di riferimento, che alternano colori diversi per dare
// significato visivo a tabelle di natura diversa.
const COLORI_TABELLA: Record<string, string> = {
  BLU: COLORE_BRAND,
  ROSSA: "C0392B",
  VERDE: "27974C",
  ARANCIONE: "D68910",
};

// Dicitura fissa usata per i sub-criteri "tabellari" (il disciplinare
// chiede solo di compilare una griglia/checklist, non una descrizione):
// il colore rosso è imposto qui in modo deterministico invece di
// affidarsi al tag "!!testo!!" scelto dall'AI (che segue il tema della
// tabella o il blu di brand, non necessariamente rosso) — l'AI scrive
// solo il testo, la formattazione esatta richiesta è garantita dal
// codice indipendentemente da come lo formatta lei.
const MARCATORE_TABELLARE = "CRITERIO TABELLARE - COMPILARE";

function eMarcatoreTabellare(testo: string): boolean {
  return (
    testo
      .replace(/^\[(C|G)\]\s*/, "")
      .replace(/\*\*/g, "")
      .replace(/!!/g, "")
      .trim()
      .toUpperCase() === MARCATORE_TABELLARE
  );
}
// Schiarisce un colore esadecimale (senza #) verso il bianco di una
// frazione (0-1) — usato per righe alternate e bordi di tabella intonati
// al colore dell'intestazione invece di un grigio neutro fisso: nei
// progetti di riferimento i bordi sono sottilissimi e la riga alternata
// ha una tinta azzurrina coerente col tema della tabella, non grigia.
function schiarisciColore(hex: string, frazione: number): string {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const mix = (canale: number) => Math.round(canale + (255 - canale) * frazione);
  return [mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, "0")).join("");
}

const TABLE_SEPARATOR_ROW = /^\|?[\s:|-]+\|?$/;
// Riconosce QUALSIASI parola dopo "[TABELLA:", non solo le 4 valide: se il
// tag non viene riconosciuto come tale (es. l'AI scrive un colore diverso
// da quelli previsti, osservato in pratica con "ARANGE" invece di
// "ARANCIONE"), la riga non veniva tolta dal blocco e l'intera tabella
// falliva il riconoscimento come tabella, apparendo come testo markdown
// letterale — bug serio perché azzera completamente la formattazione,
// non solo il colore. Il colore effettivo viene risolto a parte,
// con un fallback sicuro se la parola non è tra quelle note.
// Il "(\*\*)?...(\*\*)?" tollera che l'AI avvolga anche questo tag nel
// grassetto (stesso errore già visto su "[C]"/"[G]"/icone) — qui non
// serve ricomporre nulla dopo, il tag va comunque tolto per intero.
const TABELLA_COLORE_REGEX = /^(\*\*)?\[TABELLA:([A-ZÀ-Ý]+)\](\*\*)?$/i;
// Varianti/refusi osservati in pratica, oltre alle 4 parole valide in
// COLORI_TABELLA (che restano il riconoscimento primario).
const ALIAS_COLORE_TABELLA: Record<string, string> = {
  ARANGE: "ARANCIONE",
  ORANGE: "ARANCIONE",
  ARANCIO: "ARANCIONE",
  RED: "ROSSA",
  ROSSO: "ROSSA",
  GREEN: "VERDE",
  BLUE: "BLU",
  BLU_: "BLU",
};
function risolviColoreTabella(parola: string): string {
  const chiave = parola.toUpperCase();
  return COLORI_TABELLA[chiave] ?? COLORI_TABELLA[ALIAS_COLORE_TABELLA[chiave] ?? ""] ?? COLORE_BRAND;
}

// Trova il tag "[TABELLA:colore]" e l'inizio vero della tabella (la
// prima riga che comincia con "|") dentro le righe di un blocco,
// tollerando righe "decorative" scritte per errore tra il tag e/o prima
// di esso (es. un "[ICONA:...]" isolato senza etichetta) — vedi il
// commento al punto di chiamata per il bug reale che ha reso necessario
// questo controllo invece del semplice "guarda solo la prima riga".
function estraiTagColoreTabella(righeIn: string[]): { colore: string | null; righe: string[] } {
  const indiceInizioTabella = righeIn.findIndex((r) => r.startsWith("|"));
  let colore: string | null = null;
  let righe = righeIn;

  if (indiceInizioTabella === -1) {
    const match = righe[0]?.match(TABELLA_COLORE_REGEX);
    colore = match ? risolviColoreTabella(match[2]) : null;
    righe = match ? righe.slice(1) : righe;
  } else {
    const rigaColore = righe.slice(0, indiceInizioTabella).find((r) => TABELLA_COLORE_REGEX.test(r));
    const match = rigaColore?.match(TABELLA_COLORE_REGEX);
    colore = match ? risolviColoreTabella(match[2]) : null;
    righe = righe.slice(indiceInizioTabella);
  }

  // L'AI a volte scrive "[TABELLA:colore]" DOPO la tabella invece che
  // prima (osservato in pratica): senza questo controllo la riga non
  // veniva mai tolta e parseTableBlock la interpretava come un'ulteriore
  // riga di dati, producendo il tag letterale in una cella in fondo alla
  // tabella. Usata solo se non è già stato trovato un colore prima:
  // un'unica tabella non ha bisogno di due tag.
  const ultima = righe[righe.length - 1];
  const matchFinale = ultima?.match(TABELLA_COLORE_REGEX);
  if (matchFinale) {
    colore = colore ?? risolviColoreTabella(matchFinale[2]);
    righe = righe.slice(0, -1);
  }

  return { colore, righe };
}

const BLOCCO_SPECIALE_REGEX = /\[(ORGANIGRAMMA|IMMAGINE|BOX)\]([\s\S]*?)\[\/\1\]/gi;
// "**grassetto**", "*corsivo*" o "!!testo colorato!!" — un solo asterisco
// non seguito/preceduto da spazio per evitare falsi positivi su testo con
// asterischi isolati.
const INLINE_RUN_REGEX = /(\*\*[^*]+\*\*|\*[^*]+\*|!!.+?!!)/g;
// Allineamento di una singola cella tabella: "[C]" per centrato, "[G]"
// per giustificato, nessun tag per sinistra (default) — come nei
// progetti di riferimento, dove valori brevi/categorici sono centrati e
// testo descrittivo resta allineato a sinistra. Il "(\*\*)?" tollera che
// l'AI avvolga l'INTERA cella, tag incluso, nel grassetto
// ("**[C]testo**" invece di "[C]**testo**") — osservato massicciamente
// in pratica (50 occorrenze in una singola sezione reale): senza questo
// il tag non è più a inizio stringa una volta capitato dopo il "**" di
// apertura, e resta testo letterale invece di essere riconosciuto.
const CELLA_ALLINEAMENTO_REGEX = /^(\*\*)?\[(C|G)\]\s*/;

// L'AI a volte scrive l'icona prima del tag di allineamento
// ("[ICONA:x][C] testo" invece di "[C][ICONA:x] testo"): CELLA_ALLINEAMENTO_REGEX
// cerca "[C]"/"[G]" solo in testa alla cella, quindi in quest'ordine il
// tag non veniva riconosciuto e restava testo letterale dopo l'icona
// (bug osservato in pratica). Scambia i due tag di posto quando compaiono
// in quest'ordine, prima di qualunque altra elaborazione della cella.
const ICONA_PRIMA_DI_ALLINEAMENTO_REGEX = /^(\[ICONA:[a-zA-Z]+\])\s*(\[(?:C|G)\])/;
function normalizzaOrdineTagCella(testo: string): string {
  return testo.replace(ICONA_PRIMA_DI_ALLINEAMENTO_REGEX, "$2$1");
}

// Come CELLA_ALLINEAMENTO_REGEX, ma per righe di testo fuori tabella:
// "[C]"/"[G]" sono pensati per le celle, ma l'AI a volte li scrive anche
// su un paragrafo/elenco normale — onora comunque l'allineamento
// richiesto invece di mostrare il tag come testo letterale.
function estraiAllineamento(riga: string): { testo: string; alignment: (typeof AlignmentType)[keyof typeof AlignmentType] | undefined } {
  const match = riga.match(CELLA_ALLINEAMENTO_REGEX);
  if (!match) return { testo: riga, alignment: undefined };
  return {
    testo: ricomponiTestoDopoTag(riga.slice(match[0].length), Boolean(match[1])),
    alignment: match[2] === "C" ? AlignmentType.CENTER : AlignmentType.JUSTIFIED,
  };
}

// Se il tag di allineamento era avvolto nel grassetto insieme al testo
// (vedi CELLA_ALLINEAMENTO_REGEX), rimuovendo solo il tag resta un "**"
// di chiusura orfano a fine stringa: qui viene tolto e riapplicato a
// tutto il testo restante, così il grassetto resta corretto sul
// contenuto della cella/riga invece di comparire come asterischi
// letterali.
function ricomponiTestoDopoTag(resto: string, eraAvvoltoNelGrassetto: boolean): string {
  if (eraAvvoltoNelGrassetto && resto.endsWith("**")) {
    return `**${resto.slice(0, -2)}**`;
  }
  return resto;
}

type Segment = { type: "testo" | "organigramma" | "immagine" | "box"; contenuto: string };

const TIPO_SEGMENTO_PER_TAG: Record<string, Segment["type"]> = {
  ORGANIGRAMMA: "organigramma",
  IMMAGINE: "immagine",
  BOX: "box",
};

const TAG_APERTURA_REGEX = /\[(ORGANIGRAMMA|IMMAGINE|BOX)\]/i;

// L'AI a volte dimentica il tag di chiusura (es. "[IMMAGINE]descrizione"
// senza mai "[/IMMAGINE]"): senza questo recupero il blocco restava
// testo letterale non riconosciuto (bug osservato in produzione). Non
// potendo sapere dove l'AI intendeva chiuderlo, tratta come contenuto
// del blocco tutto ciò che segue fino alla prossima riga vuota — la
// stessa convenzione di separazione già richiesta nelle istruzioni.
function recuperaTagNonChiusi(segments: Segment[]): Segment[] {
  const risultato: Segment[] = [];
  for (const segment of segments) {
    if (segment.type !== "testo") {
      risultato.push(segment);
      continue;
    }
    let resto = segment.contenuto;
    let match: RegExpMatchArray | null;
    while ((match = resto.match(TAG_APERTURA_REGEX)) !== null) {
      const indice = match.index ?? 0;
      const prima = resto.slice(0, indice);
      if (prima.trim()) risultato.push({ type: "testo", contenuto: prima });

      const dopoTag = resto.slice(indice + match[0].length);
      const fineBlocco = dopoTag.search(/\n\s*\n/);
      const contenutoBlocco = fineBlocco === -1 ? dopoTag : dopoTag.slice(0, fineBlocco);
      risultato.push({
        type: TIPO_SEGMENTO_PER_TAG[match[1].toUpperCase()],
        contenuto: contenutoBlocco.trim(),
      });
      resto = fineBlocco === -1 ? "" : dopoTag.slice(fineBlocco);
    }
    if (resto.trim()) risultato.push({ type: "testo", contenuto: resto });
  }
  return risultato;
}

// Rimuove un'eventuale prima riga "# "/"## "/"### " che ripete alla
// lettera il titolo già passato a parte (parametro "titolo" di
// buildDocxBuffer): l'istruzione data all'AI dice esplicitamente di non
// scrivere "# " perché il titolo della sezione va nel campo dedicato, ma
// in pratica capita comunque — senza questa pulizia il titolo compare
// due volte di fila nel documento (e nell'indice), sia nel singolo file
// di un criterio sia nella relazione finale composta, dove ogni sezione
// riceve anche un "# " iniettato dal codice.
export function rimuoviTitoloRidondante(contenuto: string, titolo: string): string {
  const righe = contenuto.split("\n");
  let i = 0;
  while (i < righe.length && righe[i].trim() === "") i++;
  const match = righe[i]?.match(/^#{1,3}\s+(.+)$/);
  if (match && match[1].trim().toLowerCase() === titolo.trim().toLowerCase()) {
    return righe
      .slice(i + 1)
      .join("\n")
      .replace(/^\s*\n+/, "");
  }
  return contenuto;
}

function splitSegments(contenuto: string): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  BLOCCO_SPECIALE_REGEX.lastIndex = 0;
  while ((match = BLOCCO_SPECIALE_REGEX.exec(contenuto)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "testo", contenuto: contenuto.slice(lastIndex, match.index) });
    }
    segments.push({
      type: TIPO_SEGMENTO_PER_TAG[match[1].toUpperCase()],
      contenuto: match[2],
    });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < contenuto.length) {
    segments.push({ type: "testo", contenuto: contenuto.slice(lastIndex) });
  }

  return recuperaTagNonChiusi(segments);
}

// L'AI a volte avvolge "!!testo!!" o "[ICONA:nome]" in "**grassetto**"
// (es. "**!!Responsabile!!**"), nonostante le istruzioni — senza questa
// pulizia il "**...**" esterno viene riconosciuto per primo e il
// marcatore interno resta come testo letterale invece di essere
// interpretato (bug osservato: "!!" e "[ICONA:...]" visibili nel
// documento finale). Il grassetto esterno è comunque ridondante: "!!"
// applica già il grassetto, un'icona non lo usa.
function rimuoviGrassettoRidondante(testo: string): string {
  return testo.replace(/\*\*(!!.+?!!)\*\*/g, "$1").replace(/\*\*(\[ICONA:[a-zA-Z]+\])\*\*/gi, "$1");
}

// Interpreta "**grassetto**", "*corsivo*" e "!!testo colorato!!" dentro
// una riga di testo e produce i run Word corrispondenti, invece di
// mostrare i marcatori letterali (bug precedente: il markdown non veniva
// mai convertito). Il colore del testo evidenziato segue il tema del
// contesto (colore intestazione della tabella, o brand altrove) — come
// le parole/termini chiave colorati visti nei progetti di riferimento.
function parseInlineRuns(
  testo: string,
  runProps: { font?: string; size?: number; color?: string; bold?: boolean },
  coloreAccento: string = COLORE_BRAND,
): TextRun[] {
  const parti = rimuoviGrassettoRidondante(testo).split(INLINE_RUN_REGEX).filter((p) => p.length > 0);

  return parti.flatMap((parte) => {
    if (parte.startsWith("**") && parte.endsWith("**")) {
      const interno = parte.slice(2, -2);
      // L'AI a volte avvolge nel grassetto una frase INTERA che contiene
      // al suo interno un "!!testo!!" (es. "**valutata dall'!!Ispettore
      // Qualità!!**") invece di lasciarlo fuori dal grassetto — osservato
      // in pratica. INLINE_RUN_REGEX tratta '**[^*]+**' come un unico
      // blocco letterale, quindi senza questo controllo il "!!...!!"
      // annidato non viene mai ri-analizzato e resta testo letterale.
      // Qui il grassetto resta su tutta la frase, ma la porzione tra
      // "!!" riceve anche il colore.
      if (interno.includes("!!")) {
        return interno
          .split(/(!!.+?!!)/g)
          .filter((s) => s.length > 0)
          .map((segmento) =>
            segmento.startsWith("!!") && segmento.endsWith("!!")
              ? new TextRun({ text: segmento.slice(2, -2), bold: true, ...runProps, color: coloreAccento })
              : new TextRun({ text: segmento, bold: true, ...runProps }),
          );
      }
      return [new TextRun({ text: interno, bold: true, ...runProps })];
    }
    if (parte.startsWith("*") && parte.endsWith("*")) {
      return [new TextRun({ text: parte.slice(1, -1), italics: true, ...runProps })];
    }
    if (parte.startsWith("!!") && parte.endsWith("!!")) {
      return [
        new TextRun({
          text: parte.slice(2, -2),
          bold: true,
          ...runProps,
          color: coloreAccento,
        }),
      ];
    }
    return [new TextRun({ text: parte, ...runProps })];
  });
}

// Estrae un tag "[ICONA:nome]" in testa al testo, tollerando che l'AI lo
// avvolga in "**grassetto**" in due modi diversi osservati in pratica:
// "**[ICONA:x]** etichetta" (il grassetto chiude subito dopo il tag) e
// "**[ICONA:x] etichetta**" (il grassetto avvolge tag ed etichetta
// insieme) — un semplice strip regex non bastava a coprire entrambi i
// casi contemporaneamente (bug osservato due volte, uno per variante).
function estraiTagIcona(testo: string): { nome: string; resto: string; grassettoEtichetta: boolean } | null {
  const match = testo.match(/^(\*\*)?\[ICONA:([a-zA-Z]+)\]/);
  if (!match) return null;

  const nome = match[2];
  let resto = testo.slice(match[0].length);
  let grassettoEtichetta = false;

  if (match[1]) {
    if (resto.startsWith("**")) {
      // "**[ICONA:x]** etichetta": il grassetto chiudeva subito dopo il
      // tag, inutile una volta che il tag diventa un'immagine.
      resto = resto.slice(2);
    } else if (resto.trimEnd().endsWith("**")) {
      // "**[ICONA:x] etichetta**": il grassetto avvolgeva anche
      // l'etichetta, che resta quindi in grassetto.
      resto = resto.trimEnd().slice(0, -2);
      grassettoEtichetta = true;
    }
  }

  return { nome, resto: resto.replace(/^\s+/, ""), grassettoEtichetta };
}

// Se il testo inizia con "[ICONA:nome]" (una delle icone della libreria
// fissa in icons.ts), la renderizza come piccola immagine inline prima
// del testo — come le icone di attrezzature/certificazioni affiancate
// alle righe di tabella/elenchi nei progetti di riferimento. Se il nome
// non corrisponde a un'icona nota, il tag viene rimosso silenziosamente
// (l'AI a volte inventa nomi non presenti in libreria).
async function costruisciRunConIcona(
  testoGrezzo: string,
  colore: string,
  runProps: { font?: string; size?: number; color?: string; bold?: boolean },
): Promise<(TextRun | ImageRun)[]> {
  const testo = rimuoviGrassettoRidondante(testoGrezzo);
  if (eMarcatoreTabellare(testo)) {
    return [new TextRun({ text: MARCATORE_TABELLARE, bold: true, ...runProps, color: COLORI_TABELLA.ROSSA })];
  }
  const estratto = estraiTagIcona(testo);
  if (!estratto) return parseInlineRuns(testo, runProps, colore);

  if (!NOMI_ICONE.includes(estratto.nome.toLowerCase())) {
    return parseInlineRuns(estratto.resto, runProps, colore);
  }

  const iconaBuffer = await renderIconePng(estratto.nome.toLowerCase(), colore);
  if (!iconaBuffer) return parseInlineRuns(estratto.resto, runProps, colore);

  const testoConEventualeGrassetto = estratto.grassettoEtichetta ? `**${estratto.resto}**` : estratto.resto;

  return [
    new ImageRun({ type: "png", data: iconaBuffer, transformation: { width: 16, height: 16 } }),
    new TextRun({ text: "  ", ...runProps }),
    ...parseInlineRuns(testoConEventualeGrassetto, runProps, colore),
  ];
}

// Come costruisciRunConIcona, ma per l'intestazione di tabella: tutto il
// testo è SEMPRE grassetto bianco (a differenza del corpo, dove il
// grassetto dipende dai tag markdown dell'AI) — bug corretto: prima
// l'intestazione usava un TextRun grezzo senza alcuna elaborazione,
// quindi un'icona messa dall'AI in un'intestazione (osservato in
// pratica, non raro) restava testo letterale "[ICONA:nome]" invece di
// diventare un'icona.
async function costruisciRunIntestazione(
  testoGrezzo: string,
  runProps: { font?: string; size?: number },
): Promise<(TextRun | ImageRun)[]> {
  const testoBase = { bold: true, color: "FFFFFF", ...runProps };
  const testo = rimuoviGrassettoRidondante(testoGrezzo);
  const estratto = estraiTagIcona(testo);

  if (!estratto || !NOMI_ICONE.includes(estratto.nome.toLowerCase())) {
    const testoPulito = (estratto ? estratto.resto : testo).replace(/\*\*/g, "");
    return [new TextRun({ text: testoPulito, ...testoBase })];
  }

  const iconaBuffer = await renderIconePng(estratto.nome.toLowerCase(), "FFFFFF");
  if (!iconaBuffer) return [new TextRun({ text: estratto.resto.replace(/\*\*/g, ""), ...testoBase })];

  return [
    new ImageRun({ type: "png", data: iconaBuffer, transformation: { width: 16, height: 16 } }),
    new TextRun({ text: "  ", ...runProps }),
    new TextRun({ text: estratto.resto.replace(/\*\*/g, ""), ...testoBase }),
  ];
}

function parseTableRow(riga: string): string[] {
  const trimmed = riga.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cella) => cella.trim());
}

// Riconosce un blocco come tabella in stile markdown: prima riga con celle
// separate da "|", seconda riga di soli separatori (es. "|---|---|").
function parseTableBlock(righe: string[]): string[][] | null {
  if (righe.length < 2) return null;
  if (!righe[0].includes("|")) return null;
  if (!TABLE_SEPARATOR_ROW.test(righe[1])) return null;

  const intestazione = parseTableRow(righe[0]);
  const corpo = righe.slice(2).map(parseTableRow);
  return [intestazione, ...corpo];
}

// Numerazione puntata in testa a un titolo ("1.1", "A.1", "2.1.3"): dice a
// che livello del disciplinare appartiene quel titolo indipendentemente da
// quanti "#" ha scritto l'AI. Osservato in pratica: sotto-criteri "2.1"/
// "2.2" scritti con un solo "#", come il criterio "2." che li contiene —
// senza questo controllo riceverebbero la banda piena riservata ai titoli
// di criterio, e nell'indice comparirebbero allo stesso livello del
// criterio invece che sotto di esso.
const NUMERAZIONE_PUNTATA_REGEX = /^\s*(?:[A-Za-z]|\d+)((?:\.\d+)+)/;

type LivelloTitolo = 1 | 2 | 3;

function livelloTitolo(livelloMarkdown: LivelloTitolo, testo: string): LivelloTitolo {
  const match = testo.match(NUMERAZIONE_PUNTATA_REGEX);
  if (!match) return livelloMarkdown;
  return Math.min(match[1].split(".").length, 3) as LivelloTitolo;
}

// Titolo di criterio (livello 1): banda piena nel colore primario con testo
// bianco. Titolo di sotto-criterio (livello 2): testo primario con filetto
// sotto nel colore secondario. Terzo livello: solo testo primario in
// grassetto, invariato. La numerazione è quella scritta nel titolo (già
// quella del disciplinare, vedi le istruzioni di generazione): non c'è
// numerazione automatica di Word.
function paragrafoTitolo(
  testo: string,
  livelloMarkdown: LivelloTitolo,
  runProps: { font?: string; size?: number },
  paragraphSpacing: { line: number } | undefined,
): Paragraph {
  const livello = livelloTitolo(livelloMarkdown, testo);

  if (livello === 1) {
    // I bordi nello stesso colore del fondo danno l'imbottitura alla
    // banda (Word estende lo sfondo del paragrafo fin sotto il bordo). Il
    // rientro laterale (110 twip = 5,5 pt) compensa esattamente lo spazio
    // dei bordi laterali (5 pt + 0,5 pt di spessore): il bordo esterno
    // cade sul margine, così la banda ha la stessa larghezza del testo e
    // delle tabelle invece di sporgere.
    const bordoBanda = (space: number) => ({ style: BorderStyle.SINGLE, size: 4, color: COLORE_BRAND, space });
    return new Paragraph({
      heading: HeadingLevel.HEADING_2,
      keepNext: true,
      spacing: { ...paragraphSpacing, before: 280, after: 140 },
      indent: { left: 110, right: 110 },
      shading: { type: ShadingType.CLEAR, fill: COLORE_BRAND, color: "auto" },
      border: { top: bordoBanda(3), bottom: bordoBanda(3), left: bordoBanda(5), right: bordoBanda(5) },
      children: [new TextRun({ text: testo, bold: true, color: "FFFFFF", ...runProps })],
    });
  }

  if (livello === 2) {
    return new Paragraph({
      heading: HeadingLevel.HEADING_3,
      keepNext: true,
      spacing: { ...paragraphSpacing, before: 200, after: 100 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: COLORE_SECONDARIO, space: 2 } },
      children: [new TextRun({ text: testo, bold: true, color: COLORE_BRAND, ...runProps })],
    });
  }

  return new Paragraph({
    heading: HeadingLevel.HEADING_4,
    spacing: paragraphSpacing,
    children: [new TextRun({ text: testo, bold: true, color: COLORE_BRAND, ...runProps })],
  });
}

// Larghezza utile della pagina in twip (1/20 di punto): A4 (11906 twip)
// meno margini di 2.5cm per lato (1417 twip ciascuno) — stessa geometria
// dichiarata esplicitamente in buildDocxBuffer e assunta da
// stima-pagine.ts, non più un default implicito del motore che apre il
// file.
const LARGHEZZA_PAGINA_A4_TWIP = 11906;
const MARGINE_TWIP = 1417;
const LARGHEZZA_UTILE_TWIP = LARGHEZZA_PAGINA_A4_TWIP - 2 * MARGINE_TWIP;

// Testo "pulito" di una cella, solo per pesare la larghezza della colonna
// (non per il rendering): niente tag di allineamento/icona/evidenziazione,
// che altrimenti gonfierebbero il peso di una colonna senza motivo.
function testoCellaPerPeso(cella: string): string {
  return normalizzaOrdineTagCella(cella)
    .replace(CELLA_ALLINEAMENTO_REGEX, "")
    .replace(/^\[ICONA:[a-zA-Z]+\]\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/!!/g, "");
}

// Larghezza di ogni colonna proporzionale al contenuto più lungo che
// contiene (intestazione inclusa), non equidistribuita sul totale: prima
// le colonne avevano tutte la stessa larghezza qualunque fosse il
// contenuto, causando testo compresso in colonne strette (parole spezzate
// su più righe) accanto a colonne larghe quasi vuote (bug osservato in
// pratica, es. "periferi-/ci"). Una larghezza minima assoluta evita che
// una colonna di soli numeri/sigle collassi a pochi millimetri.
const LARGHEZZA_MINIMA_COLONNA_TWIP = 850;

function calcolaLarghezzeColonneTwip(tabella: string[][]): number[] {
  const numColonne = Math.max(...tabella.map((riga) => riga.length));
  const pesi = Array.from({ length: numColonne }, (_, colonna) =>
    Math.max(6, ...tabella.map((riga) => testoCellaPerPeso(riga[colonna] ?? "").length)),
  );
  const pesoTotale = pesi.reduce((somma, p) => somma + p, 0);

  const larghezze = pesi.map((peso) =>
    Math.max(LARGHEZZA_MINIMA_COLONNA_TWIP, Math.round((LARGHEZZA_UTILE_TWIP * peso) / pesoTotale)),
  );
  // L'arrotondamento per colonna può far sforare o restare sotto il
  // totale di qualche twip: la differenza va tutta sull'ultima colonna,
  // così la somma corrisponde sempre esattamente alla larghezza utile
  // della pagina (Word non gradisce che le colonne non tornino).
  const scarto = LARGHEZZA_UTILE_TWIP - larghezze.reduce((somma, l) => somma + l, 0);
  larghezze[larghezze.length - 1] += scarto;

  return larghezze;
}

async function renderTextSegment(
  contenuto: string,
  runProps: { font?: string; size?: number },
  paragraphSpacing: { line: number } | undefined,
): Promise<(Paragraph | Table)[]> {
  const children: (Paragraph | Table)[] = [];
  const blocchi = contenuto.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);

  for (const blocco of blocchi) {
    const righeGrezze = blocco.split("\n").map((r) => r.trim()).filter(Boolean);

    // Un tag "[TABELLA:colore]" sceglie il colore dell'intestazione della
    // tabella che segue (rossa per obblighi normativi, verde per aspetti
    // ambientali, ecc.). Non basta controllare solo la primissima riga
    // del blocco: l'AI a volte inserisce righe "decorative" prima del
    // tag (osservato in pratica: un "[ICONA:...]" isolato su una riga a
    // sé, senza etichetta, invece che dentro una cella) — se il tag
    // colore non è la primissima riga, l'intero blocco falliva il
    // riconoscimento come tabella e appariva come testo markdown
    // letterale (bug serio: azzera completamente la formattazione).
    // estraiTagColoreTabella cerca il tag in tutte le righe prima
    // dell'inizio vero della tabella (la prima che comincia con "|") e
    // scarta ciò che precede.
    const { colore: coloreMatch, righe } = estraiTagColoreTabella(righeGrezze);
    const coloreIntestazione = coloreMatch ?? COLORE_BRAND;

    const tabella = parseTableBlock(righe);
    if (tabella) {
      const [intestazione, ...corpo] = tabella;
      // Riga alternata e bordi intonati al colore dell'intestazione
      // (tinta chiara), non un grigio neutro fisso: come nei progetti di
      // riferimento, dove la riga alternata è una tinta azzurrina
      // coerente col tema della tabella e i bordi sono sottilissimi,
      // quasi assenti, mai la griglia nera spessa di default di Word.
      const coloreRigaAlternata = schiarisciColore(coloreIntestazione, 0.85);
      // Prima colonna (etichette di riga): tinta più marcata di quella
      // delle righe alternate, uguale su ogni riga — sulle righe
      // alternate prevale la tinta della colonna, non si sommano.
      const coloreColonnaEvidenziata = schiarisciColore(coloreIntestazione, 0.72);
      const coloreBordo = schiarisciColore(coloreIntestazione, 0.55);
      const bordoSottile = { style: BorderStyle.SINGLE, size: 2, color: coloreBordo };
      const larghezzeColonne = calcolaLarghezzeColonneTwip(tabella);
      const larghezzaColonna = (indiceColonna: number) => ({
        size: larghezzeColonne[indiceColonna],
        type: WidthType.DXA,
      });

      const righeCorpo = await Promise.all(
        corpo.map(async (riga, indice) => {
          const celle = await Promise.all(
            riga.map(async (celleGrezza, indiceColonna) => {
              const primaColonna = indiceColonna === 0;
              // "[C]"/"[G]" in testa alla cella sceglie l'allineamento
              // orizzontale (centrato/giustificato). Se manca il tag —
              // succede sistematicamente sulla prima colonna, che l'AI
              // tratta come etichetta di riga e non marca mai — il
              // default è comunque centrato, MAI sinistra: nessuna
              // colonna deve restare "spaiata" rispetto alle altre.
              const celleGrezzaNormalizzata = normalizzaOrdineTagCella(celleGrezza);
              const allineamentoMatch = celleGrezzaNormalizzata.match(CELLA_ALLINEAMENTO_REGEX);
              const cella = allineamentoMatch
                ? ricomponiTestoDopoTag(celleGrezzaNormalizzata.slice(allineamentoMatch[0].length), Boolean(allineamentoMatch[1]))
                : celleGrezzaNormalizzata;
              const alignment =
                allineamentoMatch?.[2] === "G" ? AlignmentType.JUSTIFIED : AlignmentType.CENTER;

              // Le icone e il testo colorato nel corpo tabella usano il
              // colore dell'intestazione: coerenza visiva con il tema
              // scelto per quella tabella (rossa/verde/arancione/blu).
              const runsCella = await costruisciRunConIcona(
                cella,
                coloreIntestazione,
                primaColonna ? { ...runProps, bold: true } : runProps,
              );
              return new TableCell({
                // Righe alternate (pari/dispari) come nei progetti di
                // riferimento, per leggibilità su tabelle lunghe; la
                // prima colonna ha sempre la propria tinta più marcata.
                shading: primaColonna
                  ? { type: ShadingType.CLEAR, fill: coloreColonnaEvidenziata }
                  : indice % 2 === 1
                    ? { type: ShadingType.CLEAR, fill: coloreRigaAlternata }
                    : undefined,
                width: larghezzaColonna(indiceColonna),
                verticalAlign: VerticalAlign.CENTER,
                children: [new Paragraph({ alignment, spacing: paragraphSpacing, children: runsCella })],
              });
            }),
          );
          // cantSplit: una riga non si spezza mai tra due pagine.
          return new TableRow({ cantSplit: true, children: celle });
        }),
      );

      const celleIntestazione = await Promise.all(
        intestazione.map(async (cella, indiceColonna) => {
          const runsCella = await costruisciRunIntestazione(cella, runProps);
          return new TableCell({
            shading: { type: ShadingType.CLEAR, fill: coloreIntestazione },
            width: larghezzaColonna(indiceColonna),
            verticalAlign: VerticalAlign.CENTER,
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: paragraphSpacing,
                // Tiene l'intestazione attaccata alla prima riga di dati:
                // mai un'intestazione sola in fondo a una pagina.
                keepNext: true,
                children: runsCella,
              }),
            ],
          });
        }),
      );

      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          // FIXED, non AUTOFIT: con AUTOFIT Word ridistribuisce le
          // colonne a proprio piacimento all'apertura, vanificando le
          // larghezze calcolate sul contenuto.
          layout: TableLayoutType.FIXED,
          columnWidths: larghezzeColonne,
          borders: {
            top: bordoSottile,
            bottom: bordoSottile,
            left: bordoSottile,
            right: bordoSottile,
            insideHorizontal: bordoSottile,
            insideVertical: bordoSottile,
          },
          rows: [
            // tableHeader: l'intestazione si ripete in cima a ogni pagina
            // su cui la tabella prosegue.
            new TableRow({ cantSplit: true, tableHeader: true, children: celleIntestazione }),
            ...righeCorpo,
          ],
        }),
      );
      children.push(new Paragraph({ text: "" }));
      continue;
    }

    for (const riga of righe) {
      if (riga.startsWith("### ")) {
        children.push(paragrafoTitolo(riga.slice(4), 3, runProps, paragraphSpacing));
      } else if (riga.startsWith("## ")) {
        children.push(paragrafoTitolo(riga.slice(3), 2, runProps, paragraphSpacing));
      } else if (riga.startsWith("# ")) {
        children.push(paragrafoTitolo(riga.slice(2), 1, runProps, paragraphSpacing));
      } else if (riga.startsWith("- ") || riga.startsWith("* ")) {
        // "[C]"/"[G]" sono pensati per le celle di tabella, ma l'AI a
        // volte li scrive anche su un elenco puntato: meglio onorare
        // l'allineamento richiesto che mostrare il tag come testo
        // letterale (bug osservato).
        const { testo: rigaSenzaTag, alignment } = estraiAllineamento(riga.slice(2));
        children.push(
          new Paragraph({
            children: await costruisciRunConIcona(rigaSenzaTag, COLORE_BRAND, runProps),
            bullet: { level: 0 },
            spacing: paragraphSpacing,
            alignment: alignment ?? AlignmentType.JUSTIFIED,
          }),
        );
      } else {
        // [ICONA:...] è pensato per celle/elenchi puntati, ma l'AI a
        // volte lo mette anche in un paragrafo normale: gestirlo qui
        // come nelle altre due varianti evita che resti testo letterale
        // (bug osservato in pratica, screenshot utente).
        const { testo: rigaSenzaTag, alignment } = estraiAllineamento(riga);
        children.push(
          new Paragraph({
            children: await costruisciRunConIcona(rigaSenzaTag, COLORE_BRAND, runProps),
            spacing: paragraphSpacing,
            alignment: alignment ?? AlignmentType.JUSTIFIED,
          }),
        );
      }
    }
  }

  return children;
}

// Intestazione di pagina del corpo: stazione appaltante, CIG e ragione
// sociale del concorrente su una riga sola, corpo ridotto, filetto sotto
// nel colore primario. Un dato mancante non lascia tracce (nessun
// segnaposto, nessun separatore orfano); senza alcun dato non c'è
// intestazione affatto, nemmeno il filetto.
function costruisciIntestazione(
  dati: DatiIntestazione | undefined,
  runProps: { font?: string; size?: number },
): Header | null {
  const cig = dati?.cig?.trim();
  const amministrazione = dati?.amministrazioneCommittente?.trim();
  const stazione = dati?.stazioneAppaltante?.trim();
  // L'amministrazione committente è quella che il concorrente riconosce:
  // va per prima. La stazione appaltante (che nelle gare tramite centrale
  // di committenza è un soggetto diverso, es. "IN.VA. S.p.A.") segue SOLO
  // se differisce dall'amministrazione — altrimenti sarebbe una ripetizione
  // dello stesso ente.
  const enti = amministrazione ? [amministrazione, stazione !== amministrazione ? stazione : undefined] : [stazione];
  const parti = [...enti, cig ? `CIG ${cig}` : undefined, dati?.concorrente?.trim()].filter(
    (parte): parte is string => Boolean(parte),
  );
  if (parti.length === 0) return null;

  // Corpo ridotto rispetto al testo, con un minimo leggibile in stampa.
  const size = runProps.size ? Math.max(14, Math.round(runProps.size * 0.7)) : 16;

  return new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: COLORE_BRAND, space: 4 } },
        children: [new TextRun({ text: parti.join("  |  "), font: runProps.font, size, color: "595959" })],
      }),
    ],
  });
}

// Interpreta un contenuto testuale semplice (paragrafi separati da riga
// vuota, righe che iniziano con "# "/"## "/"### " per tre livelli di
// titolo/sottotitolo/sotto-sottotitolo, "**grassetto**"/"*corsivo*"
// inline, righe che iniziano con "- " o "* " come elenco puntato,
// blocchi tabella markdown "| col | col |" con intestazione colorata, e
// blocchi "[ORGANIGRAMMA]...[/ORGANIGRAMMA]" con un elenco a rientri per
// gli schemi gerarchici) e produce un documento Word vero, con un vero
// indice Word (campo TOC, come nei progetti scritti a mano) generato dai
// titoli, tabelle, organigrammi e formattazione come elementi reali, non
// testo che li simula. Non un parser markdown completo: basta a rendere
// leggibili i contenuti che l'AI genera (criteri, piani di lavoro,
// offerte), rispettando eventuali requisiti di formattazione (font,
// dimensione, interlinea) indicati dal bando/disciplinare.
export async function buildDocxBuffer(
  titolo: string,
  contenuto: string,
  formatting?: DocxFormatting,
  stileOrganigramma?: StileOrganigramma,
  loghiOrganigramma?: LoghiOrganigramma,
  datiIntestazione?: DatiIntestazione,
): Promise<Buffer> {
  const font = formatting?.font;
  // docx esprime la dimensione carattere in "half-points" (12pt = 24).
  const size = formatting?.dimensioneCarattere
    ? Math.round(formatting.dimensioneCarattere * 2)
    : undefined;
  // docx esprime l'interlinea in "line" units dove 240 = interlinea singola.
  const lineSpacing = formatting?.interlinea
    ? Math.round(formatting.interlinea * 240)
    : undefined;

  const runProps = { font, size };
  const paragraphSpacing = lineSpacing ? { line: lineSpacing } : undefined;

  // Pagina del titolo/indice separata dal resto (sezione a sé): serve a
  // far ripartire la numerazione da 1 sulla prima pagina di contenuto
  // vero, non a metà dal 2 come capitava lasciando tutto in un'unica
  // sezione con "titlePage" — quella proprietà nasconde solo il piè di
  // pagina sulla prima pagina, ma il CONTATORE di Word continua a
  // considerarla la pagina 1, quindi la prima pagina di contenuto
  // risultava "2 di N".
  const paginaTitolo: (Paragraph | TableOfContents)[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: paragraphSpacing,
      children: [new TextRun({ text: titolo, bold: true, color: COLORE_BRAND, ...runProps })],
    }),
    new Paragraph({ text: "" }),
    // Indice Word vero (campo TOC): Word calcola i numeri di pagina e i
    // link quando il documento viene aperto/aggiornato (F9 o "Aggiorna
    // campo" se non si aggiorna da solo), come in un documento scritto a
    // mano — non un elenco statico senza numeri di pagina.
    new TableOfContents("Indice", {
      hyperlink: true,
      headingStyleRange: "1-4",
    }),
  ];

  const children: (Paragraph | Table)[] = [];

  const segments = splitSegments(rimuoviTitoloRidondante(contenuto, titolo));

  for (const segment of segments) {
    if (segment.type === "organigramma") {
      try {
        const { buffer, width, height } = await generateOrgChartPng(
          segment.contenuto,
          stileOrganigramma,
          loghiOrganigramma,
        );
        children.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new ImageRun({
                type: "png",
                data: buffer,
                transformation: { width, height },
              }),
            ],
          }),
        );
        children.push(new Paragraph({ text: "" }));
      } catch (err) {
        console.error("Errore generazione organigramma:", err);
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: "[Organigramma non generato correttamente]",
                italics: true,
                ...runProps,
              }),
            ],
          }),
        );
      }
      continue;
    }

    if (segment.type === "immagine") {
      try {
        const buffer = await generateImagePng(segment.contenuto);
        // gpt-image-1 genera immagini quadrate 1024x1024: le scaliamo
        // molto per l'inserimento nel documento Word — piccola, "annegata"
        // nel testo con il testo che le scorre attorno (floating, non un
        // blocco centrato che spezza il paragrafo), come nei progetti di
        // riferimento: mai una foto grande che interrompe il flusso.
        const displaySize = 180;
        children.push(
          new Paragraph({
            children: [
              new ImageRun({
                type: "png",
                data: buffer,
                transformation: { width: displaySize, height: displaySize },
                floating: {
                  horizontalPosition: {
                    relative: HorizontalPositionRelativeFrom.MARGIN,
                    align: HorizontalPositionAlign.RIGHT,
                  },
                  verticalPosition: {
                    relative: VerticalPositionRelativeFrom.PARAGRAPH,
                    offset: 0,
                  },
                  wrap: { type: TextWrappingType.SQUARE, side: TextWrappingSide.LEFT },
                  margins: { left: 200000, bottom: 100000, top: 50000, right: 0 },
                  allowOverlap: false,
                },
              }),
            ],
          }),
        );
      } catch (err) {
        console.error("Errore generazione immagine:", err);
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: "[Immagine non generata correttamente]",
                italics: true,
                ...runProps,
              }),
            ],
          }),
        );
      }
      continue;
    }

    if (segment.type === "box") {
      // Box evidenziato con sfondo colorato e bordo a sinistra, come i
      // riquadri per contenuti normativi/importanti visti nei progetti di
      // riferimento — realizzato con una tabella a cella singola perché
      // "docx" non supporta uno sfondo di paragrafo diretto.
      const paragrafiBox = segment.contenuto
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map(
          (paragrafo) =>
            new Paragraph({
              spacing: paragraphSpacing,
              alignment: AlignmentType.JUSTIFIED,
              children: parseInlineRuns(paragrafo, runProps),
            }),
        );
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              cantSplit: true,
              children: [
                new TableCell({
                  shading: { type: ShadingType.CLEAR, fill: "EAF2FA" },
                  borders: {
                    left: { style: BorderStyle.SINGLE, size: 24, color: COLORE_BRAND },
                    top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
                    bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
                    right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
                  },
                  children: paragrafiBox,
                }),
              ],
            }),
          ],
        }),
      );
      children.push(new Paragraph({ text: "" }));
      continue;
    }

    children.push(...(await renderTextSegment(segment.contenuto, runProps, paragraphSpacing)));
  }

  // "Pag. X di N" centrato nel piè di pagina — assente su copertina/indice,
  // che non si numerano mai in un documento professionale. Sia X sia N sono
  // campi Word (PAGE, SECTIONPAGES) calcolati da Word all'apertura, non un
  // numero stimato qui. TOTAL_PAGES_IN_SECTION (SECTIONPAGES) invece di
  // TOTAL_PAGES: conta solo le pagine della sezione di contenuto, senza
  // includere la pagina indice — se no l'ultima pagina reale mostrerebbe
  // "Pag. 9 di 10" invece di "Pag. 9 di 9".
  const footerConPaginazione = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: "Pag. ", ...runProps }),
          new TextRun({ children: [PageNumber.CURRENT], ...runProps }),
          new TextRun({ text: " di ", ...runProps }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES_IN_SECTION], ...runProps }),
        ],
      }),
    ],
  });

  const footerVuoto = new Footer({ children: [new Paragraph({ text: "" })] });

  const intestazioneCorpo = costruisciIntestazione(datiIntestazione, runProps);

  // Pagina A4 con margini di 2.5cm dichiarati esplicitamente, non lasciati
  // al default dell'applicazione che apre il file (che segue le
  // impostazioni regionali di Word, non necessariamente A4/2.5cm): la
  // geometria usata per calcolare le larghezze delle colonne di tabella
  // (LARGHEZZA_UTILE_TWIP) e quella assunta da stima-pagine.ts devono
  // corrispondere esattamente a quella del file reale, sempre, a
  // prescindere da chi lo apre.
  const paginaA4 = { size: { width: LARGHEZZA_PAGINA_A4_TWIP, height: 16838 }, margin: { top: MARGINE_TWIP, bottom: MARGINE_TWIP, left: MARGINE_TWIP, right: MARGINE_TWIP } };

  const doc = new Document({
    // Fa aggiornare automaticamente a Word l'indice (numeri di pagina)
    // all'apertura del file, invece di richiedere F9 manuale.
    features: { updateFields: true },
    // Mai andare a capo spezzando una parola con un trattino automatico:
    // richiesto esplicitamente, oltre a essere già il comportamento di
    // default di Word in assenza di questa impostazione.
    hyphenation: { autoHyphenation: false },
    sections: [
      {
        // Sezione 1: titolo + indice, senza numerazione — nessuna pagina
        // "0" o "1" qui, il conteggio riparte nella sezione successiva.
        properties: { page: paginaA4 },
        footers: { default: footerVuoto },
        children: paginaTitolo,
      },
      {
        // Sezione 2: contenuto vero, numerazione riparte da 1 sulla prima
        // pagina reale invece di continuare dal 2 come sezione unica.
        properties: { page: { ...paginaA4, pageNumbers: { start: 1 } } },
        // Solo questa sezione ha intestazione (copertina e indice no).
        headers: intestazioneCorpo ? { default: intestazioneCorpo } : undefined,
        footers: { default: footerConPaginazione },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
