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
} from "docx";
import { generateOrgChartPng, type LoghiOrganigramma } from "@/lib/org-chart";
import type { StileOrganigramma } from "@/lib/org-chart-style";
import { renderIconePng, NOMI_ICONE } from "@/lib/icons";
import {
  COLORE_PIENO,
  COLORE_PRIMARIO,
  COLORE_SECONDARIO,
  COLORE_SEGNALE_TABELLARE,
  ETICHETTA_LEGENDA,
  TIPI_SEMANTICI,
  analizzaEvidenziazioniTabella,
  riconosciTipoSemantico,
  schiarisciColore,
  tintaEvidenziazione,
  tintaRiquadro,
  togliMarcatoriEvidenziazione,
  type TipoSemantico,
} from "@/lib/colori-semantici";

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

// Colore "primario" del documento (azzurro, richiesto esplicitamente al
// posto del verde di brand OMNIA usato nell'interfaccia della piattaforma):
// bande dei titoli di criterio, filetto dell'intestazione di pagina,
// intestazioni di tabella. Palette, tipi e tinte vivono in
// colori-semantici.ts: qui si usano soltanto.
const COLORE_BRAND = COLORE_PRIMARIO;

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
const TABELLA_COLORE_REGEX = /^(\*\*)?\[TABELLA:([A-ZÀ-Ý_]+)\](\*\*)?$/i;

// Tema dichiarato da "[TABELLA:TIPO]": l'intestazione è SEMPRE nel colore
// primario, salvo che l'intera tabella tratti un tema ambientale
// (AMBIENTE → verde) o di sicurezza (SICUREZZA → arancio). Qualunque altra
// parola — CAPITOLATO (il primario è già il colore del capitolato), una
// parola di colore delle versioni precedenti (BLU, ROSSA, VERDE,
// ARANCIONE...), un refuso — lascia il primario: il colore non lo sceglie
// il modello, e le tabelle verdi/arancio/rosse "senza criterio" delle
// generazioni precedenti non si riproducono nemmeno rigenerando il Word da
// testo già salvato.
function risolviTemaTabella(parola: string): TipoSemantico | null {
  const tipo = riconosciTipoSemantico(parola);
  return tipo === "AMBIENTE" || tipo === "SICUREZZA" ? tipo : null;
}

// Trova il tag "[TABELLA:tipo]" e l'inizio vero della tabella (la
// prima riga che comincia con "|") dentro le righe di un blocco,
// tollerando righe "decorative" scritte per errore tra il tag e/o prima
// di esso (es. un "[ICONA:...]" isolato senza etichetta) — vedi il
// commento al punto di chiamata per il bug reale che ha reso necessario
// questo controllo invece del semplice "guarda solo la prima riga".
function estraiTagTemaTabella(righeIn: string[]): { tema: TipoSemantico | null; righe: string[] } {
  const indiceInizioTabella = righeIn.findIndex((r) => r.startsWith("|"));
  let tema: TipoSemantico | null = null;
  let righe = righeIn;

  if (indiceInizioTabella === -1) {
    const match = righe[0]?.match(TABELLA_COLORE_REGEX);
    tema = match ? risolviTemaTabella(match[2]) : null;
    righe = match ? righe.slice(1) : righe;
  } else {
    const rigaTag = righe.slice(0, indiceInizioTabella).find((r) => TABELLA_COLORE_REGEX.test(r));
    const match = rigaTag?.match(TABELLA_COLORE_REGEX);
    tema = match ? risolviTemaTabella(match[2]) : null;
    righe = righe.slice(indiceInizioTabella);
  }

  // L'AI a volte scrive "[TABELLA:tipo]" DOPO la tabella invece che
  // prima (osservato in pratica): senza questo controllo la riga non
  // veniva mai tolta e parseTableBlock la interpretava come un'ulteriore
  // riga di dati, producendo il tag letterale in una cella in fondo alla
  // tabella. Usato solo se non è già stato trovato un tema prima:
  // un'unica tabella non ha bisogno di due tag.
  const ultima = righe[righe.length - 1];
  const matchFinale = ultima?.match(TABELLA_COLORE_REGEX);
  if (matchFinale) {
    tema = tema ?? risolviTemaTabella(matchFinale[2]);
    righe = righe.slice(0, -1);
  }

  return { tema, righe };
}

// "[BOX]" (riquadro generico, nel primario) oppure "[BOX:TIPO]" con il tipo
// di impegno; il parametro vale anche per gli altri blocchi speciali ma lì
// non ha effetto.
const BLOCCO_SPECIALE_REGEX = /\[(ORGANIGRAMMA|IMMAGINE|BOX)(?::([A-Za-zÀ-ÿ_]+))?\]([\s\S]*?)\[\/\1\]/gi;
// Grassetto isolato in una prima passata su TUTTO il testo (vedi
// parseInlineRuns): "*corsivo*"/"!!testo!!" si cercano SOLO nei frammenti
// che restano dopo aver tolto i "**grassetto**", non nello stesso passaggio.
const BOLD_REGEX = /(\*\*[^*]+\*\*)/g;
// "*corsivo*" o "!!testo colorato!!", cercati SOLO dentro un frammento già
// privato dei "**grassetto**" (vedi BOLD_REGEX sopra).
const ITALICO_O_COLORE_REGEX = /(\*[^*]+\*|!!.+?!!)/g;
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

// tipoSemantico: solo per i riquadri "[BOX:TIPO]" con un tipo riconosciuto;
// un "[BOX]" senza tipo (o con una parola che non è un tipo) resta un
// riquadro nel colore primario.
type Segment = { type: "testo" | "organigramma" | "immagine" | "box"; contenuto: string; tipoSemantico?: TipoSemantico | null };

const TIPO_SEGMENTO_PER_TAG: Record<string, Segment["type"]> = {
  ORGANIGRAMMA: "organigramma",
  IMMAGINE: "immagine",
  BOX: "box",
};

const TAG_APERTURA_REGEX = /\[(ORGANIGRAMMA|IMMAGINE|BOX)(?::([A-Za-zÀ-ÿ_]+))?\]/i;

function tipoSemanticoDelTag(tag: string, parametro: string | undefined): TipoSemantico | null {
  return tag.toUpperCase() === "BOX" ? riconosciTipoSemantico(parametro) : null;
}

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
        tipoSemantico: tipoSemanticoDelTag(match[1], match[2]),
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
      contenuto: match[3],
      tipoSemantico: tipoSemanticoDelTag(match[1], match[2]),
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

// Guardia di lunghezza minima (bug osservato in pratica, entrambe le
// passate sotto): un pezzo VERAMENTE prodotto da un match della regex ha
// sempre contenuto (il "+"/".+?" tra i delimitatori non è mai vuoto), ma
// .split() restituisce anche i pezzi NON abbinati tra un match e l'altro, e
// un pezzo non abbinato può COINCIDERE per forma con un delimitatore senza
// esserlo — un singolo "*" isolato (es. una cella con solo l'asterisco R9
// "nessun valore da proporre") supera "startsWith('*') && endsWith('*')"
// pur essendo un solo carattere: slice(1,-1) lo svuota e l'asterisco
// sparisce dal documento invece di restare visibile. La lunghezza minima
// (5 per "**x**"/"!!x!!", 3 per "*x*") distingue un match vero da un
// avanzo troppo corto per contenere qualcosa: sotto quella soglia si ricade
// nel ramo finale (testo letterale), che il "*"/"**"/"!!" isolato deve
// percorrere.
function eRunGrassetto(parte: string): boolean {
  return parte.length >= 5 && parte.startsWith("**") && parte.endsWith("**");
}
function eRunCorsivo(parte: string): boolean {
  return parte.length >= 3 && parte.startsWith("*") && parte.endsWith("*");
}
function eRunColorato(parte: string): boolean {
  return parte.length >= 5 && parte.startsWith("!!") && parte.endsWith("!!");
}

// Interpreta "**grassetto**", "*corsivo*" e "!!testo colorato!!" dentro
// una riga di testo e produce i run Word corrispondenti, invece di
// mostrare i marcatori letterali (bug precedente: il markdown non veniva
// mai convertito). Il colore del testo evidenziato segue il tema del
// contesto (colore intestazione della tabella, o brand altrove) — come
// le parole/termini chiave colorati visti nei progetti di riferimento.
// Un asterisco con escape ("\*", markdown valido) è un asterisco LETTERALE:
// il modello lo scrive in pratica quando riscrive/condensa una sezione
// (es. "**Entro 7 giorni lavorativi \***"), e senza questo il backslash
// restava visibile nel Word ("Entro 7 giorni lavorativi \*"). Un segnaposto
// (carattere privato) lo tiene fuori dal riconoscimento di grassetto/corsivo
// e viene riportato ad "*" solo al momento di creare il testo del run.
// ATTENZIONE: la stringa qui sotto contiene un carattere INVISIBILE (area a
// uso privato Unicode, U+E000), non è vuota — appare vuota in ogni editor e
// terminale. Non riscrivere questa riga a mano nè copiarla come testo
// visibile: un carattere invisibile perso silenziosamente la trasforma in
// una stringa VERAMENTE vuota, e "x".split("") spezza ogni singolo
// carattere del testo invece di dividerlo sul segnaposto — bug osservato
// in pratica proprio su questa riga. Dopo qualunque modifica qui,
// verificare con un dump a byte, mai a occhio.
const ASTERISCO_ESCAPATO = "";
function proteggiAsterischiEscapati(testo: string): string {
  return testo.replace(/\\\*/g, ASTERISCO_ESCAPATO);
}
function ripristinaAsterischi(testo: string): string {
  return testo.split(ASTERISCO_ESCAPATO).join("*");
}

// Due passate, non una sola: il grassetto va isolato su TUTTO il testo
// PRIMA di cercare corsivo/evidenziazione, non nello stesso passaggio a
// scansione unica — bug osservato in pratica. Un asterisco singolo che
// precede un "**grassetto**" più avanti nella stessa frase (es. una nota
// che inizia con "*" seguita più avanti da "**144,5 ore settimanali***",
// dove il "*" finale è il marcatore R9) veniva letto come apertura di un
// (finto) corsivo dalla vecchia scansione a una sola regex combinata: il
// motore regex, non trovando "**" in apertura, ripiegava sul corsivo e
// "rubava" il PRIMO dei due asterischi del grassetto successivo per
// chiuderlo, lasciando un "**" orfano che finiva come testo letterale nel
// documento invece che come grassetto riconosciuto. Isolando prima tutti i
// "**...**" su tutta la frase (una regex che non può MAI confondersi con un
// singolo asterisco, dato che richiede sempre la coppia), il grassetto è
// sempre riconosciuto correttamente indipendentemente da un asterisco
// isolato altrove nella stessa frase; il corsivo/l'evidenziazione si
// cercano poi solo nei frammenti che restano, dove un asterisco isolato
// senza partner (come il marcatore R9 sopra) ricade correttamente nel ramo
// finale (testo letterale, resta visibile) invece di essere confuso con
// un grassetto vicino.
function parseInlineRuns(
  testo: string,
  runProps: { font?: string; size?: number; color?: string; bold?: boolean },
  coloreAccento: string = COLORE_BRAND,
): TextRun[] {
  const pulito = proteggiAsterischiEscapati(rimuoviGrassettoRidondante(testo));

  return pulito
    .split(BOLD_REGEX)
    .filter((p) => p.length > 0)
    .flatMap((parte): TextRun[] => {
      if (eRunGrassetto(parte)) {
        const interno = ripristinaAsterischi(parte.slice(2, -2));
        // L'AI a volte avvolge nel grassetto una frase INTERA che contiene
        // al suo interno un "!!testo!!" (es. "**valutata dall'!!Ispettore
        // Qualità!!**") invece di lasciarlo fuori dal grassetto — osservato
        // in pratica. Senza questo controllo il "!!...!!" annidato non
        // viene mai ri-analizzato e resta testo letterale. Qui il
        // grassetto resta su tutta la frase, ma la porzione tra "!!"
        // riceve anche il colore.
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

      // Frammento SENZA grassetto (già tolto sopra): qui, e solo qui, si
      // cerca corsivo/evidenziazione.
      return parte
        .split(ITALICO_O_COLORE_REGEX)
        .filter((s) => s.length > 0)
        .flatMap((sotto): TextRun[] => {
          if (eRunCorsivo(sotto)) {
            return [new TextRun({ text: ripristinaAsterischi(sotto.slice(1, -1)), italics: true, ...runProps })];
          }
          if (eRunColorato(sotto)) {
            return [new TextRun({ text: ripristinaAsterischi(sotto.slice(2, -2)), bold: true, ...runProps, color: coloreAccento })];
          }
          return [new TextRun({ text: ripristinaAsterischi(sotto), ...runProps })];
        });
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

// Ogni immagine del documento dichiara nel proprio testo alternativo (name
// + description in <wp:docPr>) che cos'è — "organigramma" oppure
// "icona:<nome>" — così un'anomalia sul numero/tipo di immagini si
// diagnostica dal file Word stesso, senza rigenerare (vedi
// scripts/lib/controlli-relazione.ts, che legge questi attributi). Le
// uniche immagini che il renderer può produrre sono queste due: nessun
// altro tipo di figura è ammesso (R16, niente fotografie).
export const NOME_IMMAGINE_ORGANIGRAMMA = "organigramma";
export const PREFISSO_NOME_IMMAGINE_ICONA = "icona:";

function descrizioneImmagineIcona(nome: string, colore: string): { name: string; description: string } {
  return { name: `${PREFISSO_NOME_IMMAGINE_ICONA}${nome}`, description: `Icona ${nome} (colore ${colore})` };
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
    return [new TextRun({ text: MARCATORE_TABELLARE, bold: true, ...runProps, color: COLORE_SEGNALE_TABELLARE })];
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
    new ImageRun({
      type: "png",
      data: iconaBuffer,
      transformation: { width: 16, height: 16 },
      altText: descrizioneImmagineIcona(estratto.nome.toLowerCase(), colore),
    }),
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
    const testoPulito = (estratto ? estratto.resto : testo).replace(/\*\*/g, "").replace(/\\\*/g, "*");
    return [new TextRun({ text: testoPulito, ...testoBase })];
  }

  const iconaBuffer = await renderIconePng(estratto.nome.toLowerCase(), "FFFFFF");
  if (!iconaBuffer) return [new TextRun({ text: estratto.resto.replace(/\*\*/g, "").replace(/\\\*/g, "*"), ...testoBase })];

  return [
    new ImageRun({
      type: "png",
      data: iconaBuffer,
      transformation: { width: 16, height: 16 },
      altText: descrizioneImmagineIcona(estratto.nome.toLowerCase(), "FFFFFF"),
    }),
    new TextRun({ text: "  ", ...runProps }),
    new TextRun({ text: estratto.resto.replace(/\*\*/g, "").replace(/\\\*/g, "*"), ...testoBase }),
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
  return normalizzaOrdineTagCella(togliMarcatoriEvidenziazione(cella))
    .replace(CELLA_ALLINEAMENTO_REGEX, "")
    .replace(/^\[ICONA:[a-zA-Z]+\]\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/!!/g, "");
}

// Larghezza minima assoluta: evita che una colonna di soli numeri/sigle
// collassi a pochi millimetri.
const LARGHEZZA_MINIMA_COLONNA_TWIP = 850;

// Margine interno delle celle (sinistra/destra più ampio del sopra/sotto,
// come da convenzione tipografica): il testo prima toccava i bordi.
const MARGINE_CELLA_TWIP = { top: 40, bottom: 40, left: 100, right: 100 };

// Twip per carattere a corpo 12: stessa calibrazione di
// CARATTERI_PER_RIGA_PIENA_A_12PT in stima-pagine.ts (73 caratteri su
// LARGHEZZA_UTILE_TWIP), qui invertita per andare da lunghezza testo a
// larghezza invece che da larghezza pagina a righe — le due vanno tenute
// coerenti se una cambia.
const TWIP_PER_CARATTERE_A_12PT = LARGHEZZA_UTILE_TWIP / 73;

function larghezzaTestoTwip(numeroCaratteri: number, dimensioneCarattere: number): number {
  return numeroCaratteri * TWIP_PER_CARATTERE_A_12PT * (dimensioneCarattere / 12);
}

// Larghezza di ogni colonna proporzionale al contenuto più lungo che
// contiene (intestazione inclusa), non equidistribuita sul totale: prima
// le colonne avevano tutte la stessa larghezza qualunque fosse il
// contenuto, causando testo compresso in colonne strette accanto a
// colonne larghe quasi vuote. A questo si aggiunge un PAVIMENTO per
// colonna pari alla larghezza della sua parola più lunga (più il margine
// interno): il problema delle parole spezzate a metà non dipendeva dalla
// sillabazione (ora riattivata, vedi buildDocxBuffer) ma da colonne più
// strette della parola più lunga che contenevano — es. "periferi-/ci" in
// una colonna da poche battute. Se i pavimenti sommati non ci stanno
// nella larghezza utile della pagina (raro: richiede più colonne con
// parole singole molto lunghe), si scala tutto in proporzione invece di
// sforare il margine destro.
function calcolaLarghezzeColonneTwip(tabella: string[][], dimensioneCarattereHalfPt: number | undefined): number[] {
  const dimensioneCarattere = (dimensioneCarattereHalfPt ?? 24) / 2;
  const numColonne = Math.max(...tabella.map((riga) => riga.length));

  const pesi = Array.from({ length: numColonne }, (_, colonna) =>
    Math.max(6, ...tabella.map((riga) => testoCellaPerPeso(riga[colonna] ?? "").length)),
  );
  const pesoTotale = pesi.reduce((somma, p) => somma + p, 0);

  const paddingOrizzontaleTwip = MARGINE_CELLA_TWIP.left + MARGINE_CELLA_TWIP.right;
  const pavimentoParola = Array.from({ length: numColonne }, (_, colonna) => {
    const parolaMassima = tabella
      .flatMap((riga) => testoCellaPerPeso(riga[colonna] ?? "").split(/\s+/))
      .reduce((max, parola) => Math.max(max, parola.length), 0);
    return Math.ceil(larghezzaTestoTwip(parolaMassima, dimensioneCarattere)) + paddingOrizzontaleTwip;
  });

  let larghezze = pesi.map((peso, i) =>
    Math.max(LARGHEZZA_MINIMA_COLONNA_TWIP, pavimentoParola[i], Math.round((LARGHEZZA_UTILE_TWIP * peso) / pesoTotale)),
  );

  const totale = larghezze.reduce((somma, l) => somma + l, 0);
  if (totale > LARGHEZZA_UTILE_TWIP) {
    const fattore = LARGHEZZA_UTILE_TWIP / totale;
    larghezze = larghezze.map((l) => Math.max(LARGHEZZA_MINIMA_COLONNA_TWIP, Math.round(l * fattore)));
  } else {
    // L'arrotondamento per colonna può far restare sotto il totale di
    // qualche twip: la differenza va tutta sull'ultima colonna, così la
    // somma corrisponde sempre esattamente alla larghezza utile della
    // pagina (Word non gradisce che le colonne non tornino).
    const scarto = LARGHEZZA_UTILE_TWIP - larghezze.reduce((somma, l) => somma + l, 0);
    larghezze[larghezze.length - 1] += scarto;
  }

  return larghezze;
}

// Centrato per contenuto breve che sta su una o due righe (numeri, ore,
// frequenze, quantità, sigle, codici, date, singole parole), giustificato
// per il testo descrittivo che occupa più righe — calcolato dalla
// larghezza REALE della colonna, non da un tag "[C]"/"[G]" scelto
// dall'AI (che sceglieva in modo incoerente, causando testo allineato a
// sinistra di fatto): la stessa lunghezza di testo sta su una riga in una
// colonna larga e su più righe in una stretta, la soglia non può essere
// fissa.
function allineamentoCella(
  testoPulito: string,
  larghezzaColonnaTwip: number,
  dimensioneCarattereHalfPt: number | undefined,
): (typeof AlignmentType)[keyof typeof AlignmentType] {
  const dimensioneCarattere = (dimensioneCarattereHalfPt ?? 24) / 2;
  const larghezzaUtileCella = Math.max(1, larghezzaColonnaTwip - MARGINE_CELLA_TWIP.left - MARGINE_CELLA_TWIP.right);
  const caratteriPerRiga = Math.max(1, Math.floor(larghezzaUtileCella / (TWIP_PER_CARATTERE_A_12PT * (dimensioneCarattere / 12))));
  const righeStimate = Math.max(1, Math.ceil(testoPulito.length / caratteriPerRiga));
  return righeStimate <= 2 ? AlignmentType.CENTER : AlignmentType.JUSTIFIED;
}

const TAG_TABELLA_IN_PROSA_REGEX = /\[(?:TABELLA|RIGA|CELLA):[^\]]*\]\s*/gi;

// Spessore del bordo sinistro in colore pieno: riquadri d'impegno e righe
// di tabella evidenziate per intero (ottavi di punto).
const BORDO_SINISTRO_RIQUADRO = 24;
const BORDO_SINISTRO_RIGA_EVIDENZIATA = 18;

async function renderTextSegment(
  contenuto: string,
  runProps: { font?: string; size?: number },
  paragraphSpacing: { line: number } | undefined,
  tipiUsati: Set<TipoSemantico>,
): Promise<(Paragraph | Table)[]> {
  const children: (Paragraph | Table)[] = [];
  const blocchi = contenuto.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);

  for (const blocco of blocchi) {
    const righeGrezze = blocco.split("\n").map((r) => r.trim()).filter(Boolean);

    // Un tag "[TABELLA:tipo]" dichiara che l'INTERA tabella che segue
    // tratta un tema ambientale o di sicurezza (vedi risolviTemaTabella);
    // senza tag l'intestazione è nel colore primario. Non basta controllare
    // solo la primissima riga del blocco: l'AI a volte inserisce righe
    // "decorative" prima del tag (osservato in pratica: un "[ICONA:...]"
    // isolato su una riga a sé, senza etichetta, invece che dentro una
    // cella) — se il tag non è la primissima riga, l'intero blocco falliva
    // il riconoscimento come tabella e appariva come testo markdown
    // letterale (bug serio: azzera completamente la formattazione).
    // estraiTagTemaTabella cerca il tag in tutte le righe prima
    // dell'inizio vero della tabella (la prima che comincia con "|") e
    // scarta ciò che precede.
    const { tema, righe } = estraiTagTemaTabella(righeGrezze);
    const coloreIntestazione = tema ? COLORE_PIENO[tema] : COLORE_BRAND;

    const tabellaGrezza = parseTableBlock(righe);
    if (tabellaGrezza) {
      // Marcatori "[RIGA:TIPO]"/"[CELLA:TIPO]" separati dal testo, con le
      // regole di R22-bis già applicate (mai in una tabella di soli dati,
      // al massimo due righe, mai un'intera colonna): vedi
      // analizzaEvidenziazioniTabella. Da qui in poi la tabella non contiene
      // più nessun marcatore.
      const evidenziazioni = analizzaEvidenziazioniTabella(tabellaGrezza);
      const tabella = evidenziazioni.tabella;
      if (tema) tipiUsati.add(tema);
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
      const larghezzeColonne = calcolaLarghezzeColonneTwip(tabella, runProps.size);
      const larghezzaColonna = (indiceColonna: number) => ({
        size: larghezzeColonne[indiceColonna],
        type: WidthType.DXA,
      });

      const righeCorpo = await Promise.all(
        corpo.map(async (riga, indice) => {
          const tipoRiga = evidenziazioni.riga[indice] ?? null;
          const celle = await Promise.all(
            riga.map(async (celleGrezza, indiceColonna) => {
              const primaColonna = indiceColonna === 0;
              // L'evidenziazione di riga (o di cella) SOSTITUISCE i fondi
              // della tabella su quelle celle — alternanza delle righe e
              // tinta della prima colonna — non vi si somma.
              const tipoEvidenziato = tipoRiga ?? evidenziazioni.cella[indice]?.[indiceColonna] ?? null;
              if (tipoEvidenziato) tipiUsati.add(tipoEvidenziato);
              const coloreContenuto = tipoEvidenziato ? COLORE_PIENO[tipoEvidenziato] : coloreIntestazione;
              // "[C]"/"[G]" in testa alla cella sceglie l'allineamento
              // orizzontale (centrato/giustificato). Se manca il tag —
              // succede sistematicamente sulla prima colonna, che l'AI
              // tratta come etichetta di riga e non marca mai — il
              // default è comunque centrato, MAI sinistra: nessuna
              // colonna deve restare "spaiata" rispetto alle altre.
              const celleGrezzaNormalizzata = normalizzaOrdineTagCella(celleGrezza);
              const allineamentoMatch = celleGrezzaNormalizzata.match(CELLA_ALLINEAMENTO_REGEX);
              // Il tag va comunque tolto dal testo (contenuto già generato
              // con "[C]"/"[G]" in testa), ma non decide più l'allineamento
              // — vedi allineamentoCella.
              const cella = allineamentoMatch
                ? ricomponiTestoDopoTag(celleGrezzaNormalizzata.slice(allineamentoMatch[0].length), Boolean(allineamentoMatch[1]))
                : celleGrezzaNormalizzata;
              const alignment = allineamentoCella(testoCellaPerPeso(celleGrezza), larghezzeColonne[indiceColonna], runProps.size);

              // Le icone e il testo colorato nel corpo tabella usano il
              // colore dell'intestazione (primario, o il tema ambientale/
              // di sicurezza della tabella) — e, su una riga o cella
              // evidenziata, il colore del suo tipo.
              const runsCella = await costruisciRunConIcona(
                cella,
                coloreContenuto,
                primaColonna ? { ...runProps, bold: true } : runProps,
              );
              return new TableCell({
                // Righe alternate (pari/dispari) come nei progetti di
                // riferimento, per leggibilità su tabelle lunghe; la
                // prima colonna ha sempre la propria tinta più marcata.
                // Una riga/cella evidenziata ha invece solo la tinta tenue
                // del proprio tipo.
                shading: tipoEvidenziato
                  ? { type: ShadingType.CLEAR, fill: tintaEvidenziazione(tipoEvidenziato) }
                  : primaColonna
                    ? { type: ShadingType.CLEAR, fill: coloreColonnaEvidenziata }
                    : indice % 2 === 1
                      ? { type: ShadingType.CLEAR, fill: coloreRigaAlternata }
                      : undefined,
                // Riga evidenziata per intero: bordo sinistro spesso nel
                // colore pieno, sulla prima cella.
                borders:
                  tipoRiga && primaColonna
                    ? { left: { style: BorderStyle.SINGLE, size: BORDO_SINISTRO_RIGA_EVIDENZIATA, color: COLORE_PIENO[tipoRiga] } }
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
          margins: MARGINE_CELLA_TWIP,
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

    for (const rigaGrezza of righe) {
      // Un tag di tabella ("[TABELLA:..]", "[RIGA:..]", "[CELLA:..]") dentro
      // una riga di testo non ha nessun significato (osservato in pratica: il
      // modello ha scritto una frase che inizia con "[TABELLA:AMBIENTE] non
      // si applica qui", commentando i tag invece di usarli): non deve mai
      // restare come testo letterale nel documento.
      const riga = rigaGrezza.replace(TAG_TABELLA_IN_PROSA_REGEX, "").trim();
      if (riga === "") continue;
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

// Titolo della legenda dei colori semantici: esportato perché i controlli
// la riconoscono nel documento (scripts/lib/controlli-colori.ts).
export const TITOLO_LEGENDA_COLORI = "Legenda dei colori";

// Legenda compatta: titolo e una riga con un quadrato pieno per ciascuno dei
// tre colori e la sua etichetta. Va in coda all'indice (vedi buildDocxBuffer).
function costruisciLegenda(runProps: { font?: string; size?: number }): Paragraph[] {
  const voci = TIPI_SEMANTICI.flatMap((tipo, indice): TextRun[] => [
    new TextRun({ text: indice === 0 ? "■ " : "     ■ ", color: COLORE_PIENO[tipo], ...runProps }),
    new TextRun({ text: ETICHETTA_LEGENDA[tipo], ...runProps }),
  ]);
  return [
    new Paragraph({ spacing: { before: 240, after: 60 }, children: [new TextRun({ text: TITOLO_LEGENDA_COLORI, bold: true, ...runProps })] }),
    new Paragraph({ spacing: { after: 0 }, children: voci }),
  ];
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

  // Lingua italiana su ogni run: necessaria perché la sillabazione
  // automatica (sotto) usi le regole italiane invece del default
  // dell'applicazione che apre il file (spesso inglese) — senza questa
  // dichiarazione esplicita la sillabazione, quando innescata, spezzerebbe
  // le parole nei punti sbagliati.
  const runProps = { font, size, language: { value: "it-IT" } };
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
  // Tipi semantici effettivamente usati nel corpo (riquadri, righe e celle
  // evidenziate, intestazioni a tema): decide se serve la legenda.
  const tipiUsati = new Set<TipoSemantico>();

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
                altText: { name: NOME_IMMAGINE_ORGANIGRAMMA, description: "Organigramma" },
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
      // Disattivato: le relazioni tecniche non contengono più fotografie o
      // illustrazioni (R16 in regole-omnia.md) — solo figure schematiche
      // (organigramma, tabelle). Nessuna chiamata all'API a pagamento,
      // nessun elemento nel documento: un blocco "[IMMAGINE]" nel testo
      // (contenuto già generato prima di questa regola, o un modello che
      // ignorasse l'istruzione) viene silenziosamente scartato invece di
      // produrre una foto generica scollegata dai dati dichiarati.
      console.warn('Blocco "[IMMAGINE]" ignorato (generazione fotografie disattivata):', segment.contenuto.slice(0, 80));
      continue;
    }

    if (segment.type === "box") {
      // Riquadro d'impegno: bordo sinistro spesso nel colore pieno del TIPO
      // dichiarato dal modello e fondo molto tenue dello stesso colore —
      // il modello dichiara solo il tipo ([BOX:AMBIENTE|SICUREZZA|
      // CAPITOLATO]), il colore lo decide il codice. Un "[BOX]" senza tipo
      // resta nel colore primario (stessa resa del colore del capitolato).
      // Realizzato con una tabella a cella singola perché "docx" non
      // supporta uno sfondo di paragrafo diretto.
      const tipoBox: TipoSemantico = segment.tipoSemantico ?? "CAPITOLATO";
      tipiUsati.add(tipoBox);
      const paragrafiBox = segment.contenuto
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map(
          (paragrafo) =>
            new Paragraph({
              spacing: paragraphSpacing,
              alignment: AlignmentType.JUSTIFIED,
              children: parseInlineRuns(paragrafo, runProps, COLORE_PIENO[tipoBox]),
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
                  shading: { type: ShadingType.CLEAR, fill: tintaRiquadro(tipoBox) },
                  borders: {
                    left: { style: BorderStyle.SINGLE, size: BORDO_SINISTRO_RIQUADRO, color: COLORE_PIENO[tipoBox] },
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

    children.push(...(await renderTextSegment(segment.contenuto, runProps, paragraphSpacing, tipiUsati)));
  }

  // Più di due colori semantici in uso → legenda compatta in coda
  // all'indice (sulla pagina del titolo, fuori dal conteggio delle pagine
  // di contenuto): senza, un lettore che vede tre colori non sa cosa
  // significhino.
  if (tipiUsati.size > 2) paginaTitolo.push(...costruisciLegenda(runProps));

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
    // Sillabazione automatica attiva (lingua italiana, vedi runProps
    // sopra): serve soprattutto nelle celle di tabella, dove le colonne
    // sono più strette del corpo del testo — l'impaginazione a piena
    // pagina raramente ne ha bisogno. docx non espone un modo per
    // limitarla alle sole tabelle (nessuna proprietà per sopprimerla per
    // singolo paragrafo): attiva ovunque, ma scatta solo dove una riga
    // altrimenti non ci starebbe, quindi nella pratica interviene quasi
    // solo nelle celle. Le parole intere che non entrano in una colonna
    // sono già risolte a monte dalle larghezze di colonna (vedi
    // calcolaLarghezzeColonneTwip): la sillabazione qui è un aiuto in
    // più, non il correttivo principale.
    hyphenation: { autoHyphenation: true },
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
