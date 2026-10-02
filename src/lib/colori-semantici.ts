// Colori semantici dei documenti Word generati. Modulo PURO (nessun docx,
// nessun DB, nessun modello): lo usano il renderer (docx-generator.ts), i
// prompt (prompts.ts) e i controlli di livello 1.
//
// Corrispondenza FISSA, applicata dal codice e mai scelta dal modello: il
// modello dichiara soltanto il TIPO di un impegno (AMBIENTE, SICUREZZA,
// CAPITOLATO); il colore è una conseguenza del tipo, decisa qui. Nessun
// altro colore esiste nel documento oltre ai tre (più le sole tinte
// derivate da essi e i neutri strutturali elencati sotto).

export type TipoSemantico = "AMBIENTE" | "SICUREZZA" | "CAPITOLATO";

export const TIPI_SEMANTICI: readonly TipoSemantico[] = ["AMBIENTE", "SICUREZZA", "CAPITOLATO"];

// Blu primario: colore del documento (bande dei titoli, intestazioni di
// tabella) E colore degli impegni verso la stazione appaltante e dei
// richiami al capitolato.
export const COLORE_PRIMARIO = "2E86C1";

export const COLORE_PIENO: Record<TipoSemantico, string> = {
  AMBIENTE: "27974C", // verde: CAM, Ecolabel, riduzione dei consumi, gestione rifiuti
  SICUREZZA: "D68910", // arancio: sicurezza, DPI, formazione e salute del personale
  CAPITOLATO: COLORE_PRIMARIO, // blu primario: stazione appaltante e capitolato
};

export const ETICHETTA_LEGENDA: Record<TipoSemantico, string> = {
  AMBIENTE: "Impegni ambientali",
  SICUREZZA: "Sicurezza, formazione e salute del personale",
  CAPITOLATO: "Impegni verso la stazione appaltante e richiami al capitolato",
};

// Neutri e colori strutturali che NON sono colori semantici:
// - bianco: testo sulle bande/intestazioni colorate;
// - nero e grigio: testo e intestazione di pagina;
// - blu profondo: filetto sotto i titoli di sotto-criterio (variante scura
//   del primario, non un quarto significato);
// - rosso: SOLO il segnaposto dei criteri tabellari ("CRITERIO TABELLARE -
//   COMPILARE"), un avviso "da compilare" che non appartiene a nessun tipo
//   di impegno; i controlli lo ammettono unicamente su quel testo.
export const COLORE_SECONDARIO = "1B4F72";
export const COLORE_SEGNALE_TABELLARE = "C0392B";
export const COLORI_NEUTRI = ["FFFFFF", "000000", "595959"] as const;

// Il renderer supporta riquadri tipizzati, evidenziazione di riga/cella,
// intestazioni a tema e legenda: le regole R20 e R22-bis di
// prompts/regole-omnia.md vengono inviate al modello SOLO finché questa
// costante è vera (vedi prompts.ts). Va tenuta vera soltanto se il renderer
// continua a interpretare quei tag — lo verifica scripts/verifica-colori.ts.
export const RENDERER_SUPPORTA_COLORI_SEMANTICI = true;

// "Fondo molto tenue" dello stesso colore: frazione di bianco mescolata al
// colore pieno (0,90 = il colore pesa il 10%).
export const FRAZIONE_TINTA_EVIDENZIAZIONE = 0.9;
export const FRAZIONE_TINTA_RIQUADRO = 0.92;
// Tinte delle tabelle derivate dal colore dell'intestazione (righe
// alternate, prima colonna, bordi sottili).
export const FRAZIONI_TINTE_TABELLA = [0.85, 0.72, 0.55] as const;

// Schiarisce un colore esadecimale (senza #) verso il bianco di una
// frazione (0-1).
export function schiarisciColore(hex: string, frazione: number): string {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const mix = (canale: number) => Math.round(canale + (255 - canale) * frazione);
  return [mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export function tintaEvidenziazione(tipo: TipoSemantico): string {
  return schiarisciColore(COLORE_PIENO[tipo], FRAZIONE_TINTA_EVIDENZIAZIONE);
}

export function tintaRiquadro(tipo: TipoSemantico): string {
  return schiarisciColore(COLORE_PIENO[tipo], FRAZIONE_TINTA_RIQUADRO);
}

// Tutti i colori che possono comparire in un documento generato (testo,
// riempimenti, bordi), esclusi il rosso del segnaposto tabellare (ammesso
// solo su quel testo) e "auto".
export function coloriAmmessi(): Set<string> {
  const ammessi = new Set<string>(COLORI_NEUTRI);
  ammessi.add(COLORE_SECONDARIO);
  for (const tipo of TIPI_SEMANTICI) {
    const pieno = COLORE_PIENO[tipo];
    ammessi.add(pieno);
    ammessi.add(tintaEvidenziazione(tipo));
    ammessi.add(tintaRiquadro(tipo));
    for (const frazione of FRAZIONI_TINTE_TABELLA) ammessi.add(schiarisciColore(pieno, frazione));
  }
  return ammessi;
}

// Il modello dichiara un TIPO, mai un colore. Parole di tipo e qualche
// variante di forma; una parola di colore ("VERDE", "ROSSA"...) NON è un
// tipo e non viene riconosciuta: il colore non si sceglie.
const ALIAS_TIPO: Record<string, TipoSemantico> = {
  AMBIENTE: "AMBIENTE",
  AMBIENTALE: "AMBIENTE",
  AMBIENTALI: "AMBIENTE",
  SOSTENIBILITA: "AMBIENTE",
  CAM: "AMBIENTE",
  ECOLABEL: "AMBIENTE",
  SICUREZZA: "SICUREZZA",
  SALUTE: "SICUREZZA",
  FORMAZIONE: "SICUREZZA",
  DPI: "SICUREZZA",
  PROTEZIONE: "SICUREZZA",
  CAPITOLATO: "CAPITOLATO",
  STAZIONE: "CAPITOLATO",
  STAZIONE_APPALTANTE: "CAPITOLATO",
  COMMITTENTE: "CAPITOLATO",
  CSA: "CAPITOLATO",
};

export function riconosciTipoSemantico(parola: string | null | undefined): TipoSemantico | null {
  if (!parola) return null;
  const chiave = parola
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return ALIAS_TIPO[chiave] ?? null;
}

// "[RIGA:TIPO]" = l'intera riga della tabella, "[CELLA:TIPO]" = la sola
// cella in cui compare. Il marcatore va tolto SEMPRE dal testo, anche con un
// tipo sconosciuto: un tag non riconosciuto non deve mai restare come testo
// letterale nella cella.
export const MARCATORE_EVIDENZIAZIONE_REGEX = /\[(RIGA|CELLA):\s*([^\]]*?)\s*\]\s*/gi;

export function togliMarcatoriEvidenziazione(testo: string): string {
  return testo.replace(MARCATORE_EVIDENZIAZIONE_REGEX, "");
}

export function estraiEvidenziazioneCella(cellaGrezza: string): { testo: string; riga: TipoSemantico | null; cella: TipoSemantico | null } {
  let riga: TipoSemantico | null = null;
  let cella: TipoSemantico | null = null;
  for (const m of cellaGrezza.matchAll(new RegExp(MARCATORE_EVIDENZIAZIONE_REGEX.source, "gi"))) {
    const tipo = riconosciTipoSemantico(m[2]);
    if (!tipo) continue;
    if (m[1].toUpperCase() === "RIGA") riga = riga ?? tipo;
    else cella = cella ?? tipo;
  }
  return { testo: togliMarcatoriEvidenziazione(cellaGrezza), riga, cella };
}

function testoSenzaTag(cella: string): string {
  return togliMarcatoriEvidenziazione(cella)
    .replace(/\[(?:C|G)\]/g, "")
    .replace(/\[ICONA:[^\]]*\]/g, "")
    .replace(/\*\*/g, "")
    .replace(/\\\*/g, "")
    .replace(/\*/g, "")
    .replace(/!!/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const VALORI_DATO = new Set(["SI", "SÌ", "NO", "N.A.", "N/A", "NA", "—", "-", "–"]);

// Una cella è un "dato" se è un numero/quantità (almeno una cifra, al più tre
// parole: "1.500 mq/h", "144,5 ore", "Entro 2 ore") o un valore secco come
// SI/NO. Un testo descrittivo, anche breve ("Giornaliera", "Raccolta
// differenziata"), non è un dato: descrive un impegno.
export function eCellaDato(cella: string): boolean {
  const pulito = testoSenzaTag(cella);
  if (pulito === "") return true;
  if (VALORI_DATO.has(pulito.toUpperCase())) return true;
  const parole = pulito.split(/\s+/).filter(Boolean);
  return /\d/.test(pulito) && parole.length <= 3;
}

// Tabella "di soli dati": ogni cella del corpo FUORI dalla prima colonna
// (che è l'etichetta di riga) è un dato. Una griglia di numeri non contiene
// impegni da evidenziare per tipo.
export function eTabellaDiSoliDati(corpo: string[][]): boolean {
  if (corpo.length === 0) return false;
  return corpo.every((riga) => riga.slice(1).every((cella) => eCellaDato(cella)));
}

export const MAX_RIGHE_EVIDENZIATE_PER_TABELLA = 2;

export type EvidenziazioniTabella = {
  // Tabella con intestazione e corpo senza alcun marcatore.
  tabella: string[][];
  // Per ogni riga del CORPO (indice 0 = prima riga dopo l'intestazione).
  riga: (TipoSemantico | null)[];
  cella: (TipoSemantico | null)[][];
  // Dichiarazioni del modello NON applicate, con il motivo.
  scartate: string[];
};

// Applica le regole di R22-bis alle dichiarazioni del modello — nel
// renderer, quindi in ogni documento prodotto, non solo nei prompt:
// - mai in una tabella di soli dati;
// - al massimo due righe evidenziate per tabella (le prime due);
// - mai un'intera colonna (celle evidenziate su tutte le righe del corpo);
// - dentro una riga evidenziata la cella singola non aggiunge nulla.
export function analizzaEvidenziazioniTabella(tabellaGrezza: string[][]): EvidenziazioniTabella {
  const [intestazioneGrezza, ...corpoGrezzo] = tabellaGrezza;
  const intestazione = intestazioneGrezza.map(togliMarcatoriEvidenziazione);
  const estratte = corpoGrezzo.map((riga) => riga.map(estraiEvidenziazioneCella));
  const corpo = estratte.map((riga) => riga.map((c) => c.testo));

  const riga: (TipoSemantico | null)[] = estratte.map((r) => r.find((c) => c.riga)?.riga ?? null);
  const cella: (TipoSemantico | null)[][] = estratte.map((r) => r.map((c) => c.cella));
  const scartate: string[] = [];
  const dichiarate = riga.some(Boolean) || cella.some((r) => r.some(Boolean));

  if (dichiarate && eTabellaDiSoliDati(corpo)) {
    scartate.push("evidenziazione in una tabella di soli dati");
    return { tabella: [intestazione, ...corpo], riga: riga.map(() => null), cella: cella.map((r) => r.map(() => null)), scartate };
  }

  let righeTenute = 0;
  riga.forEach((tipo, i) => {
    if (!tipo) return;
    if (righeTenute < MAX_RIGHE_EVIDENZIATE_PER_TABELLA) {
      righeTenute++;
    } else {
      riga[i] = null;
      scartate.push(`riga ${i + 1}: oltre ${MAX_RIGHE_EVIDENZIATE_PER_TABELLA} righe evidenziate`);
    }
  });

  // Una colonna è "intera" se OGNI riga del corpo è evidenziata in quella
  // colonna — per riga o per cella — e almeno una lo è per sola cella
  // (evidenziare per riga tutte le righe di una tabella di due righe non è
  // una colonna evidenziata). Le celle dichiarate in quella colonna cadono.
  const numColonne = Math.max(...corpo.map((r) => r.length), 0);
  if (corpo.length >= 2) {
    for (let colonna = 0; colonna < numColonne; colonna++) {
      const tutteEvidenziate = corpo.every((_, i) => riga[i] || cella[i][colonna]);
      const almenoUnaPerCella = corpo.some((_, i) => !riga[i] && cella[i][colonna]);
      if (tutteEvidenziate && almenoUnaPerCella) {
        for (let i = 0; i < corpo.length; i++) cella[i][colonna] = null;
        scartate.push(`colonna ${colonna + 1}: intera colonna evidenziata`);
      }
    }
  }

  for (let i = 0; i < corpo.length; i++) {
    if (!riga[i]) continue;
    for (let colonna = 0; colonna < cella[i].length; colonna++) cella[i][colonna] = null;
  }

  return { tabella: [intestazione, ...corpo], riga, cella, scartate };
}

// Analisi del TESTO SORGENTE (markdown con i tag del modello), per
// riferire quanto il modello ha rispettato le regole: serve ai controlli di
// livello 2; il documento resta comunque corretto perché il renderer applica
// le stesse regole.
export type UsoColoriSorgente = {
  // Parole di colore al posto di un tipo ([TABELLA:VERDE], [BOX:ROSSA]...).
  tagColore: string[];
  // Dichiarazioni di evidenziazione non applicate dal renderer.
  evidenziazioniScartate: string[];
  tipiDichiarati: Set<TipoSemantico>;
};

const TAG_TIPIZZATO_REGEX = /\[(TABELLA|BOX|RIGA|CELLA):\s*([^\]]*?)\s*\]/gi;
const SEPARATORE_TABELLA = /^\|?[\s:|-]+\|?$/;

function parseRigaTabella(riga: string): string[] {
  return riga.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

export function analizzaColoriSorgente(markdown: string): UsoColoriSorgente {
  const tagColore: string[] = [];
  const tipiDichiarati = new Set<TipoSemantico>();
  for (const m of markdown.matchAll(TAG_TIPIZZATO_REGEX)) {
    const tipo = riconosciTipoSemantico(m[2]);
    if (tipo) tipiDichiarati.add(tipo);
    else if (m[2] !== "") tagColore.push(`[${m[1].toUpperCase()}:${m[2]}]`);
  }

  const evidenziazioniScartate: string[] = [];
  for (const blocco of markdown.split(/\n\s*\n/)) {
    const righe = blocco.split("\n").map((r) => r.trim()).filter(Boolean);
    const inizio = righe.findIndex((r) => r.startsWith("|"));
    if (inizio === -1) continue;
    const tabellaRighe = righe.slice(inizio).filter((r) => r.startsWith("|"));
    if (tabellaRighe.length < 2 || !SEPARATORE_TABELLA.test(tabellaRighe[1])) continue;
    const grezza = [parseRigaTabella(tabellaRighe[0]), ...tabellaRighe.slice(2).map(parseRigaTabella)];
    for (const motivo of analizzaEvidenziazioniTabella(grezza).scartate) {
      evidenziazioniScartate.push(`«${grezza[0].map(togliMarcatoriEvidenziazione).join(" | ").slice(0, 60)}»: ${motivo}`);
    }
  }

  return { tagColore, evidenziazioniScartate, tipiDichiarati };
}
