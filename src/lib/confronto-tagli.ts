// Confronto prima/dopo dei tagli di lunghezza (assicuraBudgetPagine),
// sotto-criterio per sotto-criterio. Il contratto del prompt di
// compressione (prompts/compressione-omnia.md) dice cosa NON va mai
// toccato: impegni e loro valori numerici, indicatori misurabili,
// citazioni di articoli del capitolato, figure, elementi richiesti dal
// sub-criterio anche se trattati brevemente. Questo modulo verifica in
// modo deterministico (nessuna chiamata a modelli) che il testo dopo il
// taglio conservi quegli elementi rispetto al testo prima, e produce un
// elenco di cosa è stato tolto, così un revisore può giudicare se ciò che
// manca valeva punti.
import { stimaPagineContenuto } from "@/lib/stima-pagine";

export type Sezione = { titolo_sezione: string; contenuto: string };

export type BloccoSubCriterio = {
  chiave: string; // "1.2" (o il numero della sezione se il testo non ha '## ')
  titolo: string;
  testo: string;
  sezione: string;
};

export type RigaPersa = { tabella: string; riga: string };

export type ConfrontoSubCriterio = {
  chiave: string;
  titolo: string;
  presentePrima: boolean;
  presenteDopo: boolean;
  paroleInizio: number;
  paroleFine: number;
  paginePrima: number;
  pagineDopo: number;
  struttura: { prima: Strutturale; dopo: Strutturale };
  sottotitoliPersi: string[];
  numeriPersi: { numero: string; contesto: string }[];
  numeriNuovi: string[];
  riferimentiPersi: string[];
  riferimentiNuovi: string[];
  marcatoriRimossi: string[];
  marcatoriPrima: number;
  marcatoriDopo: number;
  grassettiPersi: string[];
  righeTabellaPerse: RigaPersa[];
  etichetteElencoPerse: string[];
  requisitiDisciplinare: { termine: string; prima: boolean; dopo: boolean }[];
  segnapostoPrima: number;
  segnapostoDopo: number;
};

export type Strutturale = { tabelle: number; righeTabella: number; elenchi: number; box: number; organigrammi: number };

export type RequisitoDisciplinare = { chiave: string; titolo: string; termini: string[] };

export function contaParole(testo: string): number {
  return testo.split(/\s+/).filter(Boolean).length;
}

// Divide le sezioni in blocchi per sotto-criterio ("## 1.2 Titolo").
export function suddividiInSubCriteri(sezioni: Sezione[]): Map<string, BloccoSubCriterio> {
  const blocchi = new Map<string, BloccoSubCriterio>();
  for (const sezione of sezioni) {
    const numeroSezione = sezione.titolo_sezione.match(/^\s*(\d+)/)?.[1] ?? sezione.titolo_sezione;
    const parti = sezione.contenuto.split(/\n(?=##\s)/);
    for (const parte of parti) {
      const m = parte.match(/^##\s+(\d+(?:\.\d+)+)\s*(.*)$/m);
      const testo = parte;
      if (m && parte.trimStart().startsWith("##")) {
        blocchi.set(m[1], { chiave: m[1], titolo: m[2].trim(), testo, sezione: sezione.titolo_sezione });
      } else if (parte.trim()) {
        const chiave = `${numeroSezione}.(senza titolo)`;
        const esistente = blocchi.get(chiave);
        blocchi.set(chiave, {
          chiave,
          titolo: "(testo prima del primo sotto-criterio)",
          testo: esistente ? `${esistente.testo}\n${testo}` : testo,
          sezione: sezione.titolo_sezione,
        });
      }
    }
  }
  return blocchi;
}

function pulisciCella(cella: string): string {
  return cella
    .replace(/\[(?:C|G)\]/g, "")
    .replace(/\[ICONA:[^\]]*\]/g, "")
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/!!/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

type TabellaEstratta = { intestazione: string[]; righe: string[][] };

function estraiTabelle(testo: string): TabellaEstratta[] {
  const tabelle: TabellaEstratta[] = [];
  let corrente: string[] = [];
  const chiudi = () => {
    if (corrente.length >= 3) {
      const celle = corrente
        .filter((r) => !/^\s*\|[-:\s|]+\|\s*$/.test(r))
        .map((r) => r.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(pulisciCella));
      if (celle.length >= 2) tabelle.push({ intestazione: celle[0], righe: celle.slice(1) });
    }
    corrente = [];
  };
  for (const riga of testo.split("\n")) {
    if (riga.trim().startsWith("|")) corrente.push(riga);
    else chiudi();
  }
  chiudi();
  return tabelle;
}

function strutturale(testo: string): Strutturale {
  const tabelle = estraiTabelle(testo);
  return {
    tabelle: tabelle.length,
    righeTabella: tabelle.reduce((t, x) => t + x.righe.length, 0),
    elenchi: (testo.match(/^\s*-\s+/gm) || []).length,
    box: (testo.match(/\[BOX\]/g) || []).length,
    organigrammi: (testo.match(/\[ORGANIGRAMMA\]/g) || []).length,
  };
}

const UNITA = "%|ore|ora|minuti|minuto|min|giorni|giorno|mesi|mese|settimane|settimana|anni|anno|mq|m²|litri|dB\\(A\\)|dB|giri\\/min|kg|addetti|sedi|volte|persone|risorse";
const REGEX_NUMERO = new RegExp(`(?<![\\w.,])(\\d+(?:[.,]\\d+)*)(?:\\s?(${UNITA})\\b)?`, "g");

const MESI: Record<string, string> = {
  gennaio: "01", febbraio: "02", marzo: "03", aprile: "04", maggio: "05", giugno: "06",
  luglio: "07", agosto: "08", settembre: "09", ottobre: "10", novembre: "11", dicembre: "12",
};

// Rende confrontabili due scritture equivalenti prima di ogni confronto:
// asterisco con escape ("\*" = "*") e date in lettere ("29 gennaio 2021" =
// "29/01/2021"): senza questo la stessa data o lo stesso marcatore, scritti
// in modo diverso dopo una riscrittura, risultavano "persi".
export function normalizzaTesto(testo: string): string {
  return testo
    .replace(/\\\*/g, "*")
    .replace(
      /\b(\d{1,2})°?\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(\d{4})\b/gi,
      (_, g: string, m: string, a: string) => `${g.padStart(2, "0")}/${MESI[m.toLowerCase()]}/${a}`,
    );
}

// Numeri-valore del testo (quantità, tempi, percentuali, superfici...). Non
// sono valori — e si confrontano altrove — le date (un solo valore), le
// citazioni di articolo/comma (controllate come riferimenti) e i richiami
// interni ("punto 1.1", "sub-criterio 2.1", "criterio 2").
function estraiNumeri(testo: string): { chiave: string; contesto: string }[] {
  let pulito = normalizzaTesto(testo).replace(/\*\*/g, "").replace(/\[(?:C|G)\]/g, "");
  const risultati: { chiave: string; contesto: string }[] = [];

  pulito = pulito.replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, (data, offset: number) => {
    risultati.push({ chiave: `data ${data}`, contesto: pulito.slice(Math.max(0, offset - 35), offset + data.length + 25).replace(/\s+/g, " ") });
    return " ".repeat(data.length);
  });
  pulito = pulito
    .replace(new RegExp(REGEX_ARTICOLI.source, REGEX_ARTICOLI.flags), (m) => " ".repeat(m.length))
    .replace(/\b(?:punto|punti|sub-criterio|sub-criteri|criterio|criteri|par\.|paragrafo)\s+\d+(?:\.\d+)*/gi, (m) => " ".repeat(m.length));

  for (const m of pulito.matchAll(REGEX_NUMERO)) {
    const numero = m[1].replace(/,/g, ".");
    // Salta i numeri di titolo ("## 3.4 Riduzione rifiuti").
    const inizio = m.index ?? 0;
    if (/#\s*$/.test(pulito.slice(Math.max(0, inizio - 3), inizio))) continue;
    const contesto = pulito.slice(Math.max(0, inizio - 35), inizio + m[0].length + 25).replace(/\s+/g, " ");
    risultati.push({ chiave: `${numero}${m[2] ? ` ${m[2]}` : ""}`, contesto });
  }
  return risultati;
}

// Citazioni di articoli del capitolato e di norme: le sole che il
// contratto di compressione vieta di togliere. Le sigle generiche (CSA,
// Capitolato, DEC, CAM, Ecolabel...) NON sono citazioni di articolo e non
// entrano qui: tra i primi controlli un "DEC" perso segnalava un falso
// positivo (il ruolo DEC/RUP, non un riferimento normativo).
export const REGEX_ARTICOLI = /\bartt?\.?\s*(\d+(?:[.,]\d+)?(?:\s*(?:,|e|-|–)\s*\d+(?:[.,]\d+)?)*)(?:\s*,?\s*comma\s*(\d+))?/gi;
export const REGEX_NORME: RegExp[] = [
  /D\.?\s?Lgs\.?\s*\d+\/\d+/gi,
  /D\.?\s?M\.?\s*\d{1,2}[/ ]\d{1,2}[/ ]\d{2,4}/gi,
  /D\.?\s?M\.?\s*\d{1,2}\s+\w+\s+\d{4}/gi,
  /\bDec\.?\s*\d{4}\/\d+\/CE/gi,
  /\bUNI(?:\/PdR)?(?:\s+EN)?(?:\s+ISO)?\s*[\d:.\-/]+/gi,
  /\b(?:ISO|OHSAS|SA)\s*\d+(?::\d+)?/gi,
];

// Un riferimento è un articolo ("art. 13.1"), un articolo con comma
// ("art. 14 comma 3") o una norma. Gli elenchi ("artt. 13.1, 13.2 e 13.4")
// sono espansi in un riferimento per articolo.
export function estraiRiferimenti(testo: string): string[] {
  const pulito = testo.replace(/\*\*/g, "").replace(/\s+/g, " ");
  const trovati = new Set<string>();
  for (const m of pulito.matchAll(new RegExp(REGEX_ARTICOLI.source, REGEX_ARTICOLI.flags))) {
    const articoli = m[1].split(/\s*(?:,|e|-|–)\s*/).filter(Boolean).map((a) => a.replace(",", "."));
    const comma = m[2];
    for (const a of articoli) {
      trovati.add(`art. ${a}`);
      if (comma && articoli.length === 1) trovati.add(`art. ${a} comma ${comma}`);
    }
  }
  for (const re of REGEX_NORME) {
    for (const m of pulito.matchAll(new RegExp(re.source, re.flags))) {
      trovati.add(m[0].trim().replace(/\s+/g, " ").toLowerCase());
    }
  }
  return [...trovati].sort();
}

// Un riferimento del testo prima è ancora soddisfatto se il testo dopo
// contiene lo stesso riferimento (o uno più specifico dello stesso
// articolo: "art. 14" è soddisfatto da "art. 14 comma 3").
export function riferimentoConservato(riferimento: string, dopo: string[]): boolean {
  return dopo.some((d) => d === riferimento || d.startsWith(`${riferimento} `));
}

// Valori segnati come proposta da confermare ("48 ore *", "**1.500 mq/h ***",
// "[C]2 *"): il testo prima li marca con un asterisco perché non hanno
// fonte confermata dall'impresa (R9). Restituisce i valori (senza asterisco)
// delle CELLE DI TABELLA che finiscono con un asterisco isolato.
export function estraiValoriMarcati(testo: string): string[] {
  const valori: string[] = [];
  for (const riga of testo.split("\n")) {
    if (!riga.trim().startsWith("|") || /^\s*\|[-:\s|]+\|\s*$/.test(riga)) continue;
    for (const cella of riga.trim().replace(/^\|/, "").replace(/\|$/, "").split("|")) {
      const senzaTag = cella.replace(/\[(?:C|G)\]/g, "").replace(/\[ICONA:[^\]]*\]/g, "");
      const senzaGrassetto = senzaTag.replace(/\*\*([^*]*?)\*\*/g, "$1");
      const m = senzaGrassetto.trim().match(/^(.*?\S)\s*\*$/);
      if (m) valori.push(m[1].replace(/\s+/g, " ").trim().toLowerCase());
    }
  }
  return valori;
}

// Un asterisco di conferma dentro un paragrafo (non in una cella): isolato,
// preceduto da uno spazio e seguito da fine riga o punteggiatura ("propone
// un monte ore di **150 ore settimanali** *, distribuito..."). Un asterisco
// d'apertura di corsivo (" *parola") e un asterisco di chiusura ("parola*")
// non soddisfano queste condizioni, quindi non si confondono con esso.
export const REGEX_MARCATORE_PROSA = /(?<=\S)\s\*(?=[\s.,;:)\]]|$)/g;

// Valore (senza asterisco, in minuscolo) a cui si riferisce il marcatore in
// posizione `indice` della riga: il grassetto che lo precede se c'è
// ("**150 ore settimanali** *"), altrimenti l'ultimo numero con le poche
// parole di unità che lo seguono ("entro 48 ore *"). Null se non si
// riconosce un valore: in quel caso il marcatore non si può ripristinare né
// confrontare in modo affidabile.
export function valoreDelMarcatoreProsa(riga: string, indice: number): string | null {
  const prima = riga.slice(0, indice);
  let valore: string | null = null;
  if (prima.endsWith("**")) {
    const apertura = prima.lastIndexOf("**", prima.length - 3);
    if (apertura >= 0) valore = prima.slice(apertura + 2, prima.length - 2);
  } else {
    const m = prima.match(/(\d[\d.,]*(?:\s?[A-Za-zÀ-ÿ%°²/]+){0,3})\s*$/);
    if (m) valore = m[1];
  }
  if (!valore) return null;
  const pulito = valore.replace(/\[(?:C|G)\]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  return pulito || null;
}

// Valori marcati con asterisco nei paragrafi (fuori dalle tabelle e dalle
// righe che iniziano con '*', cioè le note esplicative del marcatore).
export function estraiValoriMarcatiProsa(testo: string): string[] {
  const valori: string[] = [];
  for (const riga of testo.split("\n")) {
    if (riga.trim().startsWith("|") || /^\s*\*[^*\s]/.test(riga)) continue;
    for (const m of riga.matchAll(REGEX_MARCATORE_PROSA)) {
      const v = valoreDelMarcatoreProsa(riga, m.index ?? 0);
      if (v) valori.push(v);
    }
  }
  return valori;
}

// Tutti i valori marcati con asterisco, in tabella o in un paragrafo.
export function estraiTuttiValoriMarcati(testo: string): string[] {
  return [...estraiValoriMarcati(testo), ...estraiValoriMarcatiProsa(testo)];
}

// Valori marcati prima che nel testo dopo compaiono ancora, ma SENZA
// asterisco: l'unica etichetta che li distingueva da un dato confermato è
// stata tolta. Un valore sparito del tutto non è un problema di questo tipo.
export function marcatoriRimossi(prima: string, dopo: string): string[] {
  const marcatiPrima = estraiTuttiValoriMarcati(prima);
  const marcatiDopo = new Set(estraiTuttiValoriMarcati(dopo));
  const dopoPulito = dopo.replace(/\*/g, "").replace(/\[(?:C|G)\]/g, "").replace(/\s+/g, " ").toLowerCase();
  return [...new Set(marcatiPrima)].filter((v) => !marcatiDopo.has(v) && dopoPulito.includes(v));
}

function estraiGrassetti(testo: string): string[] {
  const set = new Set<string>();
  for (const m of testo.matchAll(/\*\*([^*]+)\*\*/g)) set.add(m[1].trim().toLowerCase());
  return [...set];
}

function estraiEtichetteElenco(testo: string): string[] {
  const etichette: string[] = [];
  for (const m of testo.matchAll(/^\s*-\s+(?:\[ICONA:[^\]]*\]\s*)?\*\*([^*]+?)\*\*/gm)) {
    etichette.push(m[1].replace(/[:\s]+$/, "").trim().toLowerCase());
  }
  return etichette;
}

function estraiSottotitoli(testo: string): string[] {
  return [...testo.matchAll(/^###\s+(.+)$/gm)].map((m) => m[1].trim().toLowerCase());
}

const STOPWORD = new Set([
  "della", "delle", "dello", "degli", "dell", "nelle", "nella", "negli", "sulle", "sulla", "siano", "quali", "quale", "questo", "questa", "presente", "previsto", "prevista", "proposto", "proposta", "proposte", "punto", "punti",
]);

// Estrae i termini richiesti dal sub-criterio dalla riga del disciplinare
// ("1.1 Organigramma e qualifiche (adeguatezza struttura organizzativa e
// gruppo di lavoro) - 10 punti (D)"): parole di almeno 6 lettere, ridotte
// a radice di 6 caratteri per tollerare le flessioni.
export function estraiRequisitiDaCriteri(criteriValutazione: string): RequisitoDisciplinare[] {
  const requisiti: RequisitoDisciplinare[] = [];
  const ultimoIndice = new Map<string, number>();
  for (const riga of criteriValutazione.split("\n")) {
    // Con o senza punti propri: "- 10 punti", "- max 6 punti", oppure solo
    // "1.1 Modalità di organizzazione" (punti solo del criterio). Senza
    // punti il titolo si ferma al primo trattino o parentesi (il resto è
    // descrizione, non il nome del sotto-criterio), e la riga è accettata
    // solo se prosegue la numerazione del criterio (N.1, N.2, ...): un
    // "2.5 volte il valore" a inizio riga non è un sotto-criterio.
    const conPunti = riga.match(/^\s*(\d+\.\d+)\s+(.+?)\s*-\s*(?:max(?:imo)?\.?\s+|fino\s+a\s+(?:un\s+massimo\s+di\s+)?)?\d+\s*punt/i);
    const m = conPunti ?? riga.match(/^\s*(\d+\.\d+)[.)]?\s+(?!punt[oi]\b)([A-Za-zÀ-ÿ][^(]*?)\s*(?:[(]|\s-\s|$)/);
    if (!m) continue;
    const [numeroCriterio, indice] = m[1].split(".");
    if (!conPunti && Number(indice) !== (ultimoIndice.get(numeroCriterio) ?? 0) + 1) continue;
    ultimoIndice.set(numeroCriterio, Number(indice));
    const parole = m[2]
      .toLowerCase()
      .replace(/[()/,;:]/g, " ")
      .split(/\s+/)
      .filter((p) => p.length >= 6 && !STOPWORD.has(p))
      .map((p) => p.slice(0, 6));
    requisiti.push({ chiave: m[1], titolo: m[2], termini: [...new Set(parole)] });
  }
  return requisiti;
}

function contieneRadice(testo: string, radice: string): boolean {
  return testo.toLowerCase().includes(radice);
}

// Un numero è "sparito" solo se non compare PIÙ da nessuna parte nel
// sotto-criterio dopo il taglio (confronto a livello di insieme, non di
// molteplicità: lo stesso valore ripetuto tre volte e poi scritto una volta
// sola non è un valore perso). Un numero è "nuovo" se prima non c'era.
function multisetDifferenza(prima: { chiave: string; contesto: string }[], dopo: { chiave: string; contesto: string }[]) {
  const chiaviDopo = new Set(dopo.map((n) => n.chiave));
  const chiaviPrima = new Set(prima.map((n) => n.chiave));
  const visti = new Set<string>();
  const persi: { numero: string; contesto: string }[] = [];
  for (const n of prima) {
    if (chiaviDopo.has(n.chiave) || visti.has(n.chiave)) continue;
    visti.add(n.chiave);
    persi.push({ numero: n.chiave, contesto: n.contesto });
  }
  const nuovi = [...new Set(dopo.filter((n) => !chiaviPrima.has(n.chiave)).map((n) => n.chiave))];
  return { persi, nuovi };
}

export function confrontaSubCriteri(
  prima: Sezione[],
  dopo: Sezione[],
  formattazione: { dimensioneCarattere?: number; interlinea?: number },
  requisiti: RequisitoDisciplinare[],
): ConfrontoSubCriterio[] {
  const bPrima = suddividiInSubCriteri(prima);
  const bDopo = suddividiInSubCriteri(dopo);
  const chiavi = [...new Set([...bPrima.keys(), ...bDopo.keys(), ...requisiti.map((r) => r.chiave)])].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );

  return chiavi.map((chiave) => {
    const p = bPrima.get(chiave);
    const d = bDopo.get(chiave);
    const testoP = normalizzaTesto(p?.testo ?? "");
    const testoD = normalizzaTesto(d?.testo ?? "");
    const req = requisiti.find((r) => r.chiave === chiave);

    const numeri = multisetDifferenza(estraiNumeri(testoP), estraiNumeri(testoD));
    const riferimentiP = estraiRiferimenti(testoP);
    const riferimentiD = estraiRiferimenti(testoD);
    const grassettiP = estraiGrassetti(testoP);
    const grassettiD = new Set(estraiGrassetti(testoD));

    // Righe di tabella perse: l'etichetta di riga (prima cella) non è più
    // riconoscibile nelle tabelle del sotto-criterio. Il confronto è per
    // parole significative (radici di 6 lettere, almeno il 60% ritrovato
    // nel testo delle tabelle dopo), non per stringa esatta: una riga
    // riscritta ("Report di sintesi periodico" → "Report di sintesi periodico
    // (KPI di servizio)") è la stessa riga, non una riga persa.
    const tabelleD = estraiTabelle(testoD);
    const testoTabelleD = tabelleD.flatMap((t) => t.righe.flat()).join(" ").toLowerCase();
    const etichetteD = new Set(tabelleD.flatMap((t) => t.righe.map((r) => (r[0] ?? "").toLowerCase())));
    const righeTabellaPerse: RigaPersa[] = [];
    for (const t of estraiTabelle(testoP)) {
      for (const r of t.righe) {
        const etichetta = (r[0] ?? "").toLowerCase();
        if (etichetteD.has(etichetta)) continue;
        const radici = [...new Set(etichetta.split(/[^a-zà-ÿ]+/).filter((w) => w.length >= 5).map((w) => w.slice(0, 6)))];
        const ritrovata = radici.length > 0 && radici.filter((rad) => testoTabelleD.includes(rad)).length / radici.length >= 0.6;
        if (!ritrovata) righeTabellaPerse.push({ tabella: t.intestazione.join(" | "), riga: r.join(" | ") });
      }
    }

    const etichetteElencoD = new Set(estraiEtichetteElenco(testoD));

    return {
      chiave,
      titolo: p?.titolo ?? d?.titolo ?? req?.titolo ?? "",
      presentePrima: !!p,
      presenteDopo: !!d,
      paroleInizio: contaParole(testoP),
      paroleFine: contaParole(testoD),
      paginePrima: testoP ? stimaPagineContenuto(testoP, formattazione) : 0,
      pagineDopo: testoD ? stimaPagineContenuto(testoD, formattazione) : 0,
      struttura: { prima: strutturale(testoP), dopo: strutturale(testoD) },
      sottotitoliPersi: estraiSottotitoli(testoP).filter((s) => !estraiSottotitoli(testoD).includes(s)),
      numeriPersi: numeri.persi,
      numeriNuovi: numeri.nuovi,
      riferimentiPersi: riferimentiP.filter((r) => !riferimentoConservato(r, riferimentiD)),
      riferimentiNuovi: riferimentiD.filter((r) => !riferimentoConservato(r, riferimentiP)),
      marcatoriRimossi: marcatoriRimossi(testoP, testoD),
      marcatoriPrima: estraiTuttiValoriMarcati(testoP).length,
      marcatoriDopo: estraiTuttiValoriMarcati(testoD).length,
      grassettiPersi: grassettiP.filter((g) => !grassettiD.has(g)),
      righeTabellaPerse,
      etichetteElencoPerse: estraiEtichetteElenco(testoP).filter((e) => !etichetteElencoD.has(e)),
      requisitiDisciplinare: (req?.termini ?? []).map((t) => ({ termine: t, prima: contieneRadice(testoP, t), dopo: contieneRadice(testoD, t) })),
      segnapostoPrima: (testoP.match(/\[DATO DA CONFERMARE/g) || []).length,
      segnapostoDopo: (testoD.match(/\[DATO DA CONFERMARE/g) || []).length,
    };
  });
}

// Errori = violazioni del contratto di compressione (prompts/
// compressione-omnia.md: "cosa non toccare mai"): un sotto-criterio
// richiesto non c'è più o è stato svuotato, sono spariti riferimenti ad
// articoli del capitolato o a norme, una figura, oppure un valore che il
// testo prima marcava con asterisco (proposta non confermata dall'impresa,
// R9) compare ancora ma senza l'asterisco: presentato come dato confermato.
// Avvisi = elementi persi che possono o no valere punti e che un revisore
// deve giudicare (termini del disciplinare non più presenti, numeri,
// righe di tabella, box): una tabella ridondante tolta li fa sparire
// legittimamente, quindi non sono errori automatici.
export function problemiContratto(
  confronti: ConfrontoSubCriterio[],
  soglieSvuotamento = 0.4,
  // Tetto di parole per sotto-criterio (chiave → parole) dal budget della
  // gara: se un blocco è stato ridotto fino al proprio tetto non è
  // "svuotato" anche quando l'originale era molto più lungo (un blocco da
  // 288 parole con tetto 123 e ridotto a 112 è ridotto come richiesto, non
  // svuotato).
  paroleTetto?: Map<string, number>,
): { errori: string[]; avvisi: string[] } {
  const errori: string[] = [];
  const avvisi: string[] = [];
  for (const c of confronti) {
    const nome = `Sotto-criterio ${c.chiave} (${c.titolo})`;
    if (c.presentePrima && !c.presenteDopo) {
      errori.push(`${nome} presente prima del taglio e assente dopo.`);
      continue;
    }
    if (!c.presentePrima && !c.presenteDopo) {
      errori.push(`${nome} richiesto dal disciplinare ma assente sia prima sia dopo il taglio.`);
      continue;
    }
    const riferimentoSvuotamento = Math.min(c.paroleInizio, paroleTetto?.get(c.chiave) ?? Number.POSITIVE_INFINITY);
    if (c.presentePrima && c.paroleInizio > 0 && c.paroleFine / riferimentoSvuotamento < soglieSvuotamento) {
      errori.push(
        `${nome} svuotato dal taglio: ${c.paroleInizio} → ${c.paroleFine} parole (${Math.round((c.paroleFine / c.paroleInizio) * 100)}%).`,
      );
    }
    if (c.riferimentiPersi.length > 0) {
      errori.push(`${nome}: riferimenti al capitolato/norme spariti dopo il taglio: ${c.riferimentiPersi.join("; ")}.`);
    }
    if (c.marcatoriRimossi.length > 0) {
      errori.push(
        `${nome}: valori marcati con asterisco (proposta da confermare) prima del taglio che compaiono dopo SENZA asterisco, cioè presentati come dati confermati: ${c.marcatoriRimossi.join("; ")}.`,
      );
    }
    if (c.struttura.prima.organigrammi > c.struttura.dopo.organigrammi) {
      errori.push(`${nome}: figura (organigramma) presente prima del taglio e assente dopo.`);
    }

    const terminiPersi = c.requisitiDisciplinare.filter((t) => t.prima && !t.dopo).map((t) => t.termine);
    if (terminiPersi.length > 0) {
      avvisi.push(
        `${nome}: termini del disciplinare presenti prima e non più dopo (verificare se l'elemento è ancora trattato con altre parole): ${terminiPersi.join(", ")}.`,
      );
    }
    if (c.numeriPersi.length > 0) {
      avvisi.push(`${nome}: ${c.numeriPersi.length} numero/i sparito/i: ${c.numeriPersi.map((n) => n.numero).join(", ")}.`);
    }
    if (c.righeTabellaPerse.length > 0) {
      avvisi.push(`${nome}: ${c.righeTabellaPerse.length} riga/righe di tabella sparita/e.`);
    }
    if (c.struttura.prima.box > c.struttura.dopo.box) {
      avvisi.push(`${nome}: riquadri [BOX] passati da ${c.struttura.prima.box} a ${c.struttura.dopo.box}.`);
    }
  }
  return { errori, avvisi };
}

// Violazioni del contratto per UN blocco compresso, nella forma che serve
// alla compressione mirata: sono ciò che fa RIFIUTARE (o rifare) una
// riduzione. Rispetto a problemiContratto conta anche come violazione la
// perdita di un termine richiesto dal disciplinare per quel sotto-criterio
// ("mai rimuovere un elemento espressamente richiesto"): il confronto è per
// radici di 6 lettere, quindi tollera le flessioni ma non la scomparsa
// dell'argomento. Numeri e righe di tabella sparite restano avvisi: una
// tabella ridondante tolta li fa sparire legittimamente.
export function violazioniBlocco(
  c: ConfrontoSubCriterio,
  opzioni: { paroleTetto?: number; soglieSvuotamento?: number } = {},
): { violazioni: string[]; avvisi: string[] } {
  const violazioni: string[] = [];
  const avvisi: string[] = [];
  const soglia = opzioni.soglieSvuotamento ?? 0.4;

  if (!c.presenteDopo) {
    violazioni.push(`Il testo ridotto non contiene più il titolo "## ${c.chiave}" del sotto-criterio.`);
    return { violazioni, avvisi };
  }
  const riferimento = Math.min(c.paroleInizio, opzioni.paroleTetto ?? Number.POSITIVE_INFINITY);
  if (c.paroleInizio > 0 && c.paroleFine / riferimento < soglia) {
    violazioni.push(`Il sotto-criterio è stato svuotato: ${c.paroleInizio} → ${c.paroleFine} parole, troppo poco per trattare ciò che il disciplinare richiede.`);
  }
  if (c.riferimentiPersi.length > 0) {
    violazioni.push(`Sono spariti riferimenti al capitolato/norme che vanno conservati: ${c.riferimentiPersi.join("; ")}.`);
  }
  if (c.marcatoriRimossi.length > 0) {
    violazioni.push(`Questi valori erano marcati con asterisco (proposta da confermare) e ora compaiono senza: ${c.marcatoriRimossi.join("; ")}.`);
  }
  if (c.struttura.prima.organigrammi > c.struttura.dopo.organigrammi) {
    violazioni.push("La figura [ORGANIGRAMMA] è sparita.");
  }
  const termini = c.requisitiDisciplinare.filter((t) => t.prima && !t.dopo).map((t) => t.termine);
  if (termini.length > 0) {
    violazioni.push(`Non compaiono più questi elementi richiesti dal disciplinare per il sotto-criterio (radici dei termini): ${termini.join(", ")}.`);
  }
  if (c.numeriPersi.length > 0) avvisi.push(`${c.numeriPersi.length} numero/i sparito/i: ${c.numeriPersi.map((n) => n.numero).join(", ")}`);
  if (c.righeTabellaPerse.length > 0) avvisi.push(`${c.righeTabellaPerse.length} riga/righe di tabella sparita/e`);
  if (c.struttura.prima.box > c.struttura.dopo.box) avvisi.push(`riquadri [BOX] ${c.struttura.prima.box} → ${c.struttura.dopo.box}`);
  return { violazioni, avvisi };
}

export function formattaConfronto(confronti: ConfrontoSubCriterio[]): string {
  const righe: string[] = [];
  for (const c of confronti) {
    righe.push(`\n### ${c.chiave} ${c.titolo}`);
    if (!c.presentePrima && !c.presenteDopo) {
      righe.push("  ASSENTE sia prima sia dopo il taglio.");
      continue;
    }
    righe.push(
      `  parole ${c.paroleInizio} → ${c.paroleFine} (${c.paroleInizio ? Math.round((c.paroleFine / c.paroleInizio) * 100) : 0}%) | pagine ${c.paginePrima.toFixed(2)} → ${c.pagineDopo.toFixed(2)}`,
    );
    const s = c.struttura;
    righe.push(
      `  struttura prima→dopo: tabelle ${s.prima.tabelle}→${s.dopo.tabelle}, righe di tabella ${s.prima.righeTabella}→${s.dopo.righeTabella}, elenchi ${s.prima.elenchi}→${s.dopo.elenchi}, box ${s.prima.box}→${s.dopo.box}, organigrammi ${s.prima.organigrammi}→${s.dopo.organigrammi}, segnaposto ${c.segnapostoPrima}→${c.segnapostoDopo}`,
    );
    if (c.sottotitoliPersi.length) righe.push(`  sottotitoli (###) spariti: ${c.sottotitoliPersi.join(" | ")}`);
    if (c.riferimentiPersi.length) righe.push(`  RIFERIMENTI spariti: ${c.riferimentiPersi.join("; ")}`);
    if (c.riferimentiNuovi.length) righe.push(`  riferimenti nuovi: ${c.riferimentiNuovi.join("; ")}`);
    if (c.marcatoriRimossi.length) righe.push(`  ASTERISCO DI CONFERMA RIMOSSO da valori ancora presenti: ${c.marcatoriRimossi.join("; ")}`);
    if (c.marcatoriPrima || c.marcatoriDopo) righe.push(`  valori marcati con asterisco (tabelle e paragrafi): ${c.marcatoriPrima} → ${c.marcatoriDopo}`);
    if (c.numeriPersi.length) {
      righe.push(`  numeri spariti (${c.numeriPersi.length}):`);
      for (const n of c.numeriPersi) righe.push(`    - ${n.numero}   «…${n.contesto}…»`);
    }
    if (c.numeriNuovi.length) righe.push(`  numeri nuovi: ${c.numeriNuovi.join(", ")}`);
    if (c.righeTabellaPerse.length) {
      righe.push(`  righe di tabella sparite (${c.righeTabellaPerse.length}):`);
      for (const r of c.righeTabellaPerse) righe.push(`    - [${r.tabella}] ${r.riga}`);
    }
    if (c.etichetteElencoPerse.length) righe.push(`  voci di elenco (etichetta in grassetto) sparite: ${c.etichetteElencoPerse.join(" | ")}`);
    if (c.grassettiPersi.length) righe.push(`  termini in grassetto spariti (${c.grassettiPersi.length}): ${c.grassettiPersi.join(" | ")}`);
    const persiReq = c.requisitiDisciplinare.filter((t) => t.prima && !t.dopo);
    const nonCoperti = c.requisitiDisciplinare.filter((t) => !t.prima && !t.dopo);
    if (c.requisitiDisciplinare.length) {
      righe.push(
        `  termini del disciplinare: ${c.requisitiDisciplinare.filter((t) => t.dopo).length}/${c.requisitiDisciplinare.length} presenti dopo${persiReq.length ? `; PERSI: ${persiReq.map((t) => t.termine).join(", ")}` : ""}${nonCoperti.length ? `; mai presenti: ${nonCoperti.map((t) => t.termine).join(", ")}` : ""}`,
      );
    }
  }
  return righe.join("\n");
}
