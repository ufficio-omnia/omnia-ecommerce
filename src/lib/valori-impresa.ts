// R9 — nessun dato d'impresa inventato, come controllo DETERMINISTICO.
//
// Ogni valore numerico riferito a prodotti, attrezzature, prestazioni o
// organico che non trova riscontro nel profilo dell'azienda, nei documenti
// di gara, nei dati estratti o in ciò che il cliente ha scritto in chat deve
// essere marcato come proposta da confermare (valore + asterisco, la
// convenzione già usata dal resto del codice: confronto-tagli.ts,
// ripristino-verificato.ts). Non dipende dal giudizio di un modello: il
// prompt (R9) e l'AI di verifica (verificaDatiAziendali) restano, ma un
// valore senza fonte scappato a entrambi viene marcato qui, in codice, a ogni
// generazione reale — e un controllo di livello 2 verifica che non ne resti
// nessuno.
//
// Un valore RICAVATO sommando dati noti (l'organico complessivo = dipendenti
// del profilo + personale uscente di gara) non è inventato: viene
// riconosciuto, dichiarato come derivato con l'indicazione di come è stato
// ottenuto, e non marcato.
//
// Modulo PURO (nessun modello, nessun DB): l'evidenza arriva da fuori
// (evidenza-dati.ts in produzione, i dati già letti nel livello 2).

export type CategoriaValore = "organico" | "attrezzature" | "prodotti" | "prestazioni";

export type UscenteNoto = { etichetta: string; addetti: number; oreSettimanali: number | null };
export type FattoNoto = { valore: number; etichetta: string };

export type EvidenzaDati = {
  // Dipendenti dichiarati nel profilo azienda (dato d'impresa).
  dipendenti: number | null;
  // Personale uscente di gara, una voce per livello contrattuale.
  uscente: UscenteNoto[];
  // Altri dati strutturati noti (sedi, superfici, fatturato...).
  fatti: FattoNoto[];
  // Testi liberi in cui cercare i valori: profilo, documenti di gara, dati
  // estratti, messaggi del cliente.
  testi: string[];
};

type ProfiloEvidenza = {
  numero_dipendenti?: number | null;
  fatturato_medio_annuo?: number | null;
  certificazioni?: string | null;
  referenze?: string | null;
  settori_attivita?: string | null;
  presentazione?: string | null;
} | null;

type GaraEvidenza = {
  importo?: number | null;
  criteri_valutazione?: string | null;
  requisiti?: string | null;
  limiti_formattazione?: string | null;
  sedi?: { denominazione: string; superficie_mq?: number | null; orari_apertura?: string | null; frequenze?: string | null }[] | null;
  personale_uscente?: { livello_contrattuale: string; numero_addetti: number; ore_settimanali?: number | null; anzianita?: string | null; note?: string | null }[] | null;
};

export function costruisciEvidenza(params: {
  profilo: ProfiloEvidenza;
  gara: GaraEvidenza;
  testiDocumenti?: string[];
  messaggiCliente?: string[];
  testiAggiuntivi?: string[];
}): EvidenzaDati {
  const { profilo, gara } = params;
  const uscente: UscenteNoto[] = (gara.personale_uscente ?? []).map((p) => ({
    etichetta: `addetti di livello ${p.livello_contrattuale}`,
    addetti: p.numero_addetti,
    oreSettimanali: p.ore_settimanali ?? null,
  }));
  const fatti: FattoNoto[] = [];
  const totaleAddetti = uscente.reduce((t, u) => t + u.addetti, 0);
  const totaleOre = uscente.reduce((t, u) => t + (u.oreSettimanali ?? 0), 0);
  if (uscente.length > 0) fatti.push({ valore: totaleAddetti, etichetta: "unità di personale uscente complessivo" });
  if (totaleOre > 0) fatti.push({ valore: totaleOre, etichetta: "ore settimanali del personale uscente complessivo" });
  if (gara.sedi?.length) fatti.push({ valore: gara.sedi.length, etichetta: "numero di sedi" });
  for (const s of gara.sedi ?? []) {
    if (s.superficie_mq) fatti.push({ valore: s.superficie_mq, etichetta: `superficie mq della sede ${s.denominazione}` });
  }
  if (profilo?.fatturato_medio_annuo) fatti.push({ valore: profilo.fatturato_medio_annuo, etichetta: "fatturato medio annuo dell'impresa" });
  if (gara.importo) fatti.push({ valore: gara.importo, etichetta: "importo della gara" });

  const testi = [
    profilo?.certificazioni,
    profilo?.referenze,
    profilo?.settori_attivita,
    profilo?.presentazione,
    gara.criteri_valutazione,
    gara.requisiti,
    gara.limiti_formattazione,
    ...(gara.sedi ?? []).flatMap((s) => [s.orari_apertura, s.frequenze]),
    ...(gara.personale_uscente ?? []).flatMap((p) => [p.anzianita, p.note]),
    ...(params.testiDocumenti ?? []),
    ...(params.messaggiCliente ?? []),
    ...(params.testiAggiuntivi ?? []),
  ].filter((t): t is string => typeof t === "string" && t.trim() !== "");

  return { dipendenti: profilo?.numero_dipendenti ?? null, uscente, fatti, testi };
}

// ————————————————————————————————————————————————————————————————
// Numeri e contesto
// ————————————————————————————————————————————————————————————————

type NumeroTrovato = { inizio: number; fine: number; raw: string; valore: number; unita: string; fineUnita: number };

// Numeri in formato italiano: "1.500" = 1500, "144,5" = 144,5. Senza
// lookbehind (il progetto compila per ES2017): il carattere che precede si
// controlla a mano.
const NUMERO_REGEX = /\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?/g;
const UNITA_REGEX = /^(\s*%|\s*per\s?cento\b|\s*mq\/h\b|\s*m²\/h\b|\s*mq\/ora\b|\s*giri\/min\b|\s*l\/min\b|\s*dB\(A\)|\s*dB\b|\s*kW\b|\s*kg\b|\s*litri\b|\s*mq\b|\s*m²\b|\s*Ah\b|\s*bar\b)/i;

function parseValore(raw: string): number {
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(raw)) return parseFloat(raw.replace(/\./g, "").replace(",", "."));
  return parseFloat(raw.replace(",", "."));
}

function classeUnita(testoUnita: string): string {
  const u = testoUnita.trim().toLowerCase().replace(/\s+/g, "");
  if (u === "%" || u.startsWith("percent")) return "%";
  if (u === "mq/h" || u === "m²/h" || u === "mq/ora") return "mq/h";
  if (u.startsWith("db")) return "dB";
  return u;
}

export function estraiNumeri(testo: string): NumeroTrovato[] {
  const risultato: NumeroTrovato[] = [];
  for (const m of testo.matchAll(NUMERO_REGEX)) {
    const inizio = m.index ?? 0;
    const fine = inizio + m[0].length;
    const prima = inizio > 0 ? testo[inizio - 1] : "";
    const dopo = testo[fine] ?? "";
    // Dentro un altro token (codice, versione, data, frazione): non è un valore.
    if (/[\w.,/\\-]/.test(prima)) continue;
    if (dopo === "/" && /\d/.test(testo[fine + 1] ?? "")) continue;
    if ((dopo === "." || dopo === ",") && /\d/.test(testo[fine + 1] ?? "")) continue;
    const unitaMatch = testo.slice(fine).match(UNITA_REGEX);
    risultato.push({
      inizio,
      fine,
      raw: m[0],
      valore: parseValore(m[0]),
      unita: unitaMatch ? classeUnita(unitaMatch[0]) : "",
      fineUnita: fine + (unitaMatch ? unitaMatch[0].length : 0),
    });
  }
  return risultato;
}

const STOP = new Set([
  "della", "dello", "delle", "degli", "dalla", "dalle", "dagli", "nella", "nelle", "negli", "sono", "essere", "viene", "vengono",
  "anche", "ogni", "tutti", "tutte", "tutto", "entro", "oltre", "almeno", "circa", "pari", "nonché", "quale", "quali", "questo",
  "questa", "questi", "queste", "previsto", "prevista", "presso", "tramite", "mediante", "fino", "come", "dove", "quando", "sulla",
  "sulle", "sugli", "alla", "alle", "agli", "dell", "nell", "sull", "dall", "cioè", "inoltre", "dopo", "prima", "senza", "oltre",
  "ogni", "più", "meno", "stesso", "stessa", "propri", "proprie", "proprio", "propria", "nostri", "nostre", "nostro", "nostra",
]);

function stemsDi(testo: string): Set<string> {
  const stems = new Set<string>();
  for (const p of testo.toLowerCase().match(/[a-zàèéìòù]{4,}/g) ?? []) {
    if (!STOP.has(p)) stems.add(p.slice(0, 5));
  }
  return stems;
}

function finestra(testo: string, inizio: number, fine: number, caratteri = 80): Set<string> {
  return stemsDi(`${testo.slice(Math.max(0, inizio - caratteri), inizio)} ${testo.slice(fine, fine + caratteri)}`);
}

// ————————————————————————————————————————————————————————————————
// Categoria del valore
// ————————————————————————————————————————————————————————————————

const CONNETTIVI = new Set(["di", "del", "dei", "delle", "della", "dello", "e", "ed", "ulteriori", "nuove", "nuovi", "altri", "altre", "propri", "proprie", "nostri", "nostre"]);

const RE_PERSONE = /^(?:unit[àa]|addett\w*|operator\w*|operai\w*|operatric\w*|risors\w*|person[ae]|dipendent\w*|lavorator\w*|figur[ae]|caposquadr\w*|squadr\w*|fte|collaborator\w*|supervisor\w*)$/i;
const RE_ATTREZZATURE = /^(?:macchin\w*|lavasciuga\w*|lavapavimenti|monospazzol\w*|aspirapolver\w*|aspirator\w*|idropulitric\w*|carrell\w*|attrezzatur\w*|mezz[oi]|automezz\w*|scal[ae]|batteri\w*|postazion\w*|dispositiv\w*|veicol\w*|furgon\w*|apparecchi\w*|vaporett\w*|nebulizzator\w*|spazzol\w*)$/i;
const RE_PRODOTTI = /^(?:prodott\w*|detergent\w*|detersiv\w*|panni|panno|microfibr\w*|sacchi\w*|dispenser|erogator\w*|confezion\w*|disinfettant\w*|sanificant\w*|rotol\w*|ricaric\w*|cartucc\w*)$/i;
const RE_PRESTAZIONI = /^(?:cicl\w*|lavagg\w*|riutilizz\w*|passagg\w*)$/i;
const RE_CONTESTO_PRODOTTI = /prodott|detergent|detersiv|ecolabel|etichett|riciclat|biodegradabil|concentrat|microfibr|panni|carta\b|saponi/i;
const RE_CONTESTO_PRESTAZIONI = /riduzion|risparmi|abbattiment|efficienz|\bresa\b|rendiment|consum|emission|recuper|differenziat|autonomi|rumorosit|durata/i;
const UNITA_ATTREZZATURE = new Set(["mq/h", "dB", "kW", "giri/min", "l/min", "ah", "bar", "litri"]);

type DatiContesto = { dopo: string[]; precede: string[]; testoPrima: string; testoDopo: string };

function parolaSignificativa(parole: string[]): string | null {
  for (const p of parole.slice(0, 3)) {
    if (!CONNETTIVI.has(p)) return p;
  }
  return null;
}

function categoriaDi(num: NumeroTrovato, c: DatiContesto): CategoriaValore | null {
  const nome = parolaSignificativa(c.dopo);
  const unita = num.unita;

  // Monte ore e ore settimanali/annue sono organico; "entro 8 ore" è un impegno di servizio, non un dato d'impresa.
  if (c.dopo[0] === "ore" && /^(?:settimanal|annu|mensil|giornalier|al\b|a\b|alla\b|di\s+present)/.test(c.dopo.slice(1, 3).join(" "))) return "organico";
  if (c.precede.slice(-3).includes("monte") && c.precede.slice(-3).includes("ore")) return "organico";
  if (unita === "%") {
    if (RE_CONTESTO_PRODOTTI.test(c.testoPrima.slice(-90) + " " + c.testoDopo.slice(0, 40))) return "prodotti";
    if (RE_CONTESTO_PRESTAZIONI.test(c.testoPrima.slice(-90) + " " + c.testoDopo.slice(0, 40))) return "prestazioni";
    return null;
  }
  if (nome && RE_PERSONE.test(nome)) return "organico";
  if (c.precede.slice(-2).some((p) => /^(?:organico|team|squadra|personale|staff|gruppo)$/.test(p))) return "organico";
  if (nome && RE_ATTREZZATURE.test(nome)) return "attrezzature";
  if (UNITA_ATTREZZATURE.has(unita.toLowerCase()) || UNITA_ATTREZZATURE.has(unita)) return "attrezzature";
  if (nome && RE_PRODOTTI.test(nome)) return "prodotti";
  if (nome && RE_PRESTAZIONI.test(nome)) return "prestazioni";
  return null;
}

// Riferimenti, non valori: "art. 13.4", "UNI EN ISO 14001", "D.Lgs. 36/2023",
// "punto 3", "criterio 2", "CAM 2021"...
const RE_PRECEDE_RIFERIMENTO = /^(?:art|artt|articolo|articoli|comma|commi|c|par|paragrafo|paragrafi|punto|punti|lett|allegato|all|tabella|tab|figura|fig|criterio|sub-criterio|sotto-criterio|d\.lgs|dlgs|dpr|l|legge|n|nr|n°|uni|en|iso|iec|cam|reg|regolamento|ce|ue|decreto|dm|ohsas|sa|pdr|capitolo|cap|sezione|pag|pagina|pagine)\.?$/i;

function eRiferimento(c: DatiContesto, testoPrima: string): boolean {
  const ultima = c.precede[c.precede.length - 1];
  if (ultima && RE_PRECEDE_RIFERIMENTO.test(ultima)) return true;
  return /(?:§|#|n\.\s?|n°\s?)\s*$/.test(testoPrima);
}

// ————————————————————————————————————————————————————————————————
// Indice dell'evidenza
// ————————————————————————————————————————————————————————————————

type Occorrenza = { unita: string; stems: Set<string> };
export type IndiceEvidenza = { perValore: Map<string, Occorrenza[]>; evidenza: EvidenzaDati };

function chiaveValore(v: number): string {
  return String(Math.round(v * 1000) / 1000);
}

const STEMS_PERSONE = ["dipen", "organ", "perso", "addet", "opera", "risor", "lavor", "unita", "forza", "squad"];

export function indicizzaEvidenza(evidenza: EvidenzaDati): IndiceEvidenza {
  const perValore = new Map<string, Occorrenza[]>();
  const aggiungi = (valore: number, occ: Occorrenza) => {
    const k = chiaveValore(valore);
    const lista = perValore.get(k);
    if (lista) lista.push(occ);
    else perValore.set(k, [occ]);
  };
  for (const testo of evidenza.testi) {
    for (const n of estraiNumeri(testo)) aggiungi(n.valore, { unita: n.unita, stems: finestra(testo, n.inizio, n.fineUnita) });
  }
  const persone = new Set(STEMS_PERSONE);
  if (evidenza.dipendenti != null) aggiungi(evidenza.dipendenti, { unita: "", stems: new Set([...persone, ...stemsDi("dipendenti dell'impresa profilo azienda")]) });
  for (const u of evidenza.uscente) {
    aggiungi(u.addetti, { unita: "", stems: new Set([...persone, ...stemsDi(`personale uscente clausola sociale ${u.etichetta}`)]) });
    if (u.oreSettimanali) aggiungi(u.oreSettimanali, { unita: "", stems: new Set([...stemsDi("ore settimanali monte ore personale uscente"), "ore"]) });
  }
  for (const f of evidenza.fatti) aggiungi(f.valore, { unita: "", stems: new Set([...stemsDi(f.etichetta), ...(/personale|unità|addett/i.test(f.etichetta) ? persone : [])]) });
  return { perValore, evidenza };
}

function eSupportato(valore: number, unita: string, stems: Set<string>, indice: IndiceEvidenza): boolean {
  const occorrenze = indice.perValore.get(chiaveValore(valore));
  if (!occorrenze) return false;
  return occorrenze.some((o) => {
    if ((o.unita === "%") !== (unita === "%")) return false;
    if (unita && o.unita && o.unita !== unita) return false;
    for (const s of stems) if (o.stems.has(s)) return true;
    return false;
  });
}

// ————————————————————————————————————————————————————————————————
// Valori derivati
// ————————————————————————————————————————————————————————————————

export type Derivazione = { testo: string; componenti: number[] };

// Un valore è derivato se è la somma di dati noti dello stesso tipo: i
// dipendenti del profilo più il personale uscente (tutto o per livelli), o
// più livelli del personale uscente fra loro. Si preferisce la spiegazione con
// meno termini.
export function cercaDerivazione(valore: number, categoria: CategoriaValore, unita: string, evidenza: EvidenzaDati): Derivazione | null {
  if (categoria !== "organico" || unita === "ore") return null;
  const righe = evidenza.uscente;
  const n = righe.length;
  const dip = evidenza.dipendenti;
  type Combinazione = { somma: number; testo: string; componenti: number[]; termini: number };
  const combinazioni: Combinazione[] = [];

  // Tutto il personale uscente come un unico dato (anche con molte righe: il
  // personale uscente di una gara reale può essere una riga per addetto).
  if (n > 0 && dip != null) {
    const totale = righe.reduce((t, r) => t + r.addetti, 0);
    combinazioni.push({
      somma: dip + totale,
      testo: `${dip} dipendenti dell'impresa + ${totale} unità di personale uscente`,
      componenti: [dip, totale],
      termini: 2,
    });
  }

  // Livelli del personale uscente presi singolarmente: solo se sono pochi,
  // altrimenti le combinazioni sono troppe e le coincidenze casuali.
  if (n > 0 && n <= 12) {
    for (let maschera = 1; maschera < 1 << n; maschera++) {
      const scelte = righe.filter((_, i) => maschera & (1 << i));
      const somma = scelte.reduce((t, r) => t + r.addetti, 0);
      const descrizione = scelte.map((r) => `${r.addetti} ${r.etichetta}`).join(" + ");
      if (dip != null) {
        combinazioni.push({
          somma: dip + somma,
          testo: `${dip} dipendenti dell'impresa + ${descrizione}`,
          componenti: [dip, ...scelte.map((r) => r.addetti)],
          termini: 1 + scelte.length,
        });
      }
      if (scelte.length >= 2) {
        combinazioni.push({ somma, testo: descrizione, componenti: scelte.map((r) => r.addetti), termini: scelte.length });
      }
    }
  }

  let migliore: Combinazione | null = null;
  for (const c of combinazioni) {
    if (Math.abs(c.somma - valore) < 1e-9 && (!migliore || c.termini < migliore.termini)) migliore = c;
  }
  return migliore ? { testo: migliore.testo, componenti: migliore.componenti } : null;
}

// ————————————————————————————————————————————————————————————————
// Analisi di una riga o di una cella
// ————————————————————————————————————————————————————————————————

export type StatoValore = "marcato" | "supportato" | "derivato" | "senza-riscontro";

export type ValoreAnalizzato = {
  stato: StatoValore;
  categoria: CategoriaValore;
  raw: string;
  valore: number;
  inizio: number;
  // Fine della frase del valore: numero, unità e nome ("21 unità", "300 cicli di lavaggio").
  fineFrase: number;
  derivazione?: Derivazione;
};

const PAROLA = /^(\s+)([A-Za-zÀ-ÿ]+)/;

function fineFraseDel(testo: string, num: NumeroTrovato): number {
  let fine = num.fineUnita;
  const prima = testo.slice(fine).match(PAROLA);
  if (!prima) return fine;
  const nome = prima[2].toLowerCase();
  // "132,5 ore settimanali": il monte ore è un valore a sé, con il suo qualificativo.
  if (nome === "ore") {
    const qualificativo = testo.slice(fine + prima[0].length).match(/^(\s+(?:settimanali|annue|annuali|mensili|giornaliere))/i);
    if (qualificativo) return fine + prima[0].length + qualificativo[1].length;
  }
  const eNome = RE_PERSONE.test(nome) || RE_ATTREZZATURE.test(nome) || RE_PRODOTTI.test(nome) || RE_PRESTAZIONI.test(nome);
  if (!eNome) return fine;
  fine += prima[0].length;
  // "cicli di lavaggio", "unità di personale": il complemento fa parte della frase.
  const complemento = testo.slice(fine).match(/^(\s+(?:di|del|dei|delle|della|dello)\s+[A-Za-zÀ-ÿ]+)/i);
  if (complemento) fine += complemento[1].length;
  return fine;
}

// Il valore è già marcato se dopo la sua frase (ed eventuale chiusura di
// grassetto/evidenziazione) c'è un asterisco isolato: la convenzione
// "valore *" — oppure se la frase è dentro un segnaposto tra parentesi quadre.
function eMarcato(testo: string, fineNumero: number): boolean {
  // Come la lettura inversa di valoreDelMarcatoreProsa (confronto-tagli.ts):
  // il marcatore sta dopo il numero e al più tre parole, con un'eventuale
  // chiusura di grassetto in mezzo ("**132,5 ore settimanali** *").
  const resto = testo.slice(fineNumero);
  return /^(?:\s?[A-Za-zÀ-ÿ°²/]+){0,3}(?:\*\*|!!)?\s?\\?\*(?![*\w])/.test(resto);
}

function dentroSegnaposto(testo: string, posizione: number): boolean {
  const apertura = testo.lastIndexOf("[", posizione);
  return apertura >= 0 && testo.indexOf("]", apertura) >= posizione;
}

export function analizzaValori(testo: string, indice: IndiceEvidenza): ValoreAnalizzato[] {
  const risultato: ValoreAnalizzato[] = [];
  for (const num of estraiNumeri(testo)) {
    if (dentroSegnaposto(testo, num.inizio)) continue;
    const parole = (s: string) => (s.toLowerCase().match(/[a-zà-ÿ0-9°./()²-]+/g) ?? []).map((p) => p.replace(/^[.(]+|[.)]+$/g, ""));
    // I tag di formattazione ("[C]", "[G]", "[ICONA:x]"...) non sono parole del
    // testo: senza toglierli "[C]" diventava il token "c" (abbreviazione di
    // "comma") e il valore veniva scambiato per un riferimento normativo.
    const senzaTag = (s: string) => s.replace(/\[(?:C|G|ICONA:[^\]]*|RIGA:[^\]]*|CELLA:[^\]]*)\]/gi, " ");
    const testoPrima = senzaTag(testo.slice(Math.max(0, num.inizio - 140), num.inizio));
    const testoDopo = senzaTag(testo.slice(num.fineUnita, num.fineUnita + 140));
    const contesto: DatiContesto = { dopo: parole(testoDopo.slice(0, 60)), precede: parole(testoPrima.slice(-60)), testoPrima, testoDopo };
    if (eRiferimento(contesto, testoPrima)) continue;
    const categoria = categoriaDi(num, contesto);
    if (!categoria) continue;

    const fineFrase = fineFraseDel(testo, num);
    const base = { categoria, raw: num.raw, valore: num.valore, inizio: num.inizio, fineFrase };
    if (eMarcato(testo, num.fineUnita)) {
      risultato.push({ ...base, stato: "marcato" });
      continue;
    }
    if (eSupportato(num.valore, num.unita, finestra(testo, num.inizio, num.fineUnita), indice)) {
      risultato.push({ ...base, stato: "supportato" });
      continue;
    }
    const derivazione = cercaDerivazione(num.valore, categoria, num.unita, indice.evidenza);
    if (derivazione) {
      risultato.push({ ...base, stato: "derivato", derivazione });
      continue;
    }
    risultato.push({ ...base, stato: "senza-riscontro" });
  }
  return risultato;
}

// ————————————————————————————————————————————————————————————————
// Applicazione al testo
// ————————————————————————————————————————————————————————————————

export type ValoreMarcato = { valore: string; categoria: CategoriaValore; riga: string };
export type ValoreDerivato = { valore: string; derivazione: string; dichiaratoNelTesto: boolean; riga: string };

export type EsitoGuardiaValori = {
  testo: string;
  marcati: ValoreMarcato[];
  derivati: ValoreDerivato[];
  notaAggiunta: boolean;
};

export const NOTA_VALORI_PROPOSTI =
  "*Valori proposti dall'impresa: non presenti nei dati confermati del profilo azienda né nei documenti di gara, da confermare prima della consegna.";

const RIGA_SEPARATORE_TABELLA = /^\|?[\s:|-]+\|?$/;

// Un'inserzione dentro "**...**" o "!!...!!" romperebbe il grassetto: si
// sposta alla fine di quel tratto.
function postoDiInserzione(testo: string, posizione: number): number {
  for (const re of [/\*\*[^*]+\*\*/g, /!![^!]+!!/g]) {
    for (const m of testo.matchAll(re)) {
      const inizio = m.index ?? 0;
      const fine = inizio + m[0].length;
      if (posizione > inizio && posizione < fine) return fine;
    }
  }
  return posizione;
}

function numeriDelTesto(testo: string): number[] {
  return estraiNumeri(testo).map((n) => n.valore);
}

function elaboraTesto(
  testo: string,
  indice: IndiceEvidenza,
  inCella: boolean,
  marcati: ValoreMarcato[],
  derivati: ValoreDerivato[],
  rigaOriginale: string,
): string {
  const valori = analizzaValori(testo, indice);
  if (valori.length === 0) return testo;

  const inserzioni: { posizione: number; testo: string }[] = [];
  let daMarcare = false;
  for (const v of valori) {
    if (v.stato === "derivato" && v.derivazione) {
      const numeri = numeriDelTesto(testo);
      const dichiarato = v.derivazione.componenti.every((c) => numeri.includes(c));
      derivati.push({ valore: v.raw, derivazione: v.derivazione.testo, dichiaratoNelTesto: dichiarato, riga: rigaOriginale.trim() });
      if (!dichiarato) inserzioni.push({ posizione: postoDiInserzione(testo, v.fineFrase), testo: ` (${v.derivazione.testo})` });
    } else if (v.stato === "senza-riscontro") {
      marcati.push({ valore: v.raw, categoria: v.categoria, riga: rigaOriginale.trim() });
      if (inCella) daMarcare = true;
      else inserzioni.push({ posizione: postoDiInserzione(testo, v.fineFrase), testo: " *" });
    }
  }

  let nuovo = testo;
  for (const ins of inserzioni.sort((a, b) => b.posizione - a.posizione)) {
    nuovo = nuovo.slice(0, ins.posizione) + ins.testo + nuovo.slice(ins.posizione);
  }
  if (daMarcare) nuovo = `${nuovo.replace(/\s+$/, "")} *`;
  return nuovo;
}

export function applicaGuardiaValori(testo: string, evidenza: EvidenzaDati, indicePronto?: IndiceEvidenza): EsitoGuardiaValori {
  const indice = indicePronto ?? indicizzaEvidenza(evidenza);
  const marcati: ValoreMarcato[] = [];
  const derivati: ValoreDerivato[] = [];
  let dentroOrganigramma = false;

  const righe = testo.split("\n").map((riga) => {
    const t = riga.trim();
    if (/^\[ORGANIGRAMMA\]/i.test(t)) dentroOrganigramma = true;
    if (dentroOrganigramma) {
      if (/\[\/ORGANIGRAMMA\]/i.test(t)) dentroOrganigramma = false;
      return riga;
    }
    if (t === "" || /^#{1,3}\s/.test(t) || /^\[TABELLA:/i.test(t) || /^\[\/?BOX/i.test(t) || RIGA_SEPARATORE_TABELLA.test(t)) return riga;
    // Le note esplicative del marcatore ("*Valori proposti...") non si toccano.
    if (/^\s*\\?\*[^*\s]/.test(riga)) return riga;

    if (t.startsWith("|")) {
      const celle = riga.split("|");
      const nuove = celle.map((cella, i) => (i === 0 || i === celle.length - 1 ? cella : elaboraCella(cella, indice, marcati, derivati, riga)));
      return nuove.join("|");
    }
    return elaboraTesto(riga, indice, false, marcati, derivati, riga);
  });

  let nuovoTesto = righe.join("\n");
  let notaAggiunta = false;
  if (marcati.length > 0 && !/^\s*\\?\*[^*\s]/m.test(testo)) {
    nuovoTesto = `${nuovoTesto.replace(/\s+$/, "")}\n\n${NOTA_VALORI_PROPOSTI}\n`;
    notaAggiunta = true;
  }
  return { testo: nuovoTesto, marcati, derivati, notaAggiunta };
}

function elaboraCella(cella: string, indice: IndiceEvidenza, marcati: ValoreMarcato[], derivati: ValoreDerivato[], rigaOriginale: string): string {
  const spazioFinale = cella.match(/\s*$/)?.[0] ?? "";
  const corpo = cella.slice(0, cella.length - spazioFinale.length);
  if (corpo.trim() === "") return cella;
  // Convenzione delle celle: l'asterisco isolato a fine cella marca il valore
  // della cella ("30 minuti *", "**1.500 mq/h** *").
  if (/\s\*\s*$|^\s*\*\s*$/.test(corpo.replace(/\*\*(?!\s*$)/g, "").replace(/\*\*$/, ""))) return cella;
  return elaboraTesto(corpo, indice, true, marcati, derivati, rigaOriginale) + spazioFinale;
}

// Per i controlli: i valori che, nel testo dato, risultano ancora senza
// riscontro e NON marcati — dopo la guardia devono essere zero.
export function trovaValoriSenzaRiscontro(testo: string, evidenza: EvidenzaDati, indicePronto?: IndiceEvidenza): ValoreMarcato[] {
  const indice = indicePronto ?? indicizzaEvidenza(evidenza);
  const trovati: ValoreMarcato[] = [];
  let dentroOrganigramma = false;
  for (const riga of testo.split("\n")) {
    const t = riga.trim();
    if (/^\[ORGANIGRAMMA\]/i.test(t)) dentroOrganigramma = true;
    if (dentroOrganigramma) {
      if (/\[\/ORGANIGRAMMA\]/i.test(t)) dentroOrganigramma = false;
      continue;
    }
    if (t === "" || /^#{1,3}\s/.test(t) || /^\[TABELLA:/i.test(t) || /^\[\/?BOX/i.test(t) || RIGA_SEPARATORE_TABELLA.test(t) || /^\s*\\?\*[^*\s]/.test(riga)) continue;
    const pezzi = t.startsWith("|") ? t.split("|").slice(1, -1) : [riga];
    for (const pezzo of pezzi) {
      const cellaMarcata = t.startsWith("|") && /\s\*\s*$/.test(pezzo.replace(/\*\*/g, ""));
      for (const v of analizzaValori(pezzo, indice)) {
        if (v.stato === "senza-riscontro" && !cellaMarcata) trovati.push({ valore: v.raw, categoria: v.categoria, riga: riga.trim() });
      }
    }
  }
  return trovati;
}

// Testo per il modello che risponde in chat: cosa il sistema ha marcato o
// dichiarato come derivato, da dire al cliente.
export function testoValoriPerModello(marcati: ValoreMarcato[], derivati: ValoreDerivato[]): string {
  const parti: string[] = [];
  if (marcati.length > 0) {
    const elenco = [...new Set(marcati.map((m) => m.valore))].join(", ");
    parti.push(
      `NOTA: ${marcati.length} valore/i numerico/i su prodotti, attrezzature, prestazioni o organico (${elenco}) non trovano riscontro nel profilo azienda né nei documenti di gara: il sistema li ha marcati con un asterisco come PROPOSTE DA CONFERMARE. Dillo al cliente in una frase e invitalo a confermarli o correggerli prima di consegnare.`,
    );
  }
  if (derivati.length > 0) {
    parti.push(`Valori ricavati da dati noti (non inventati): ${derivati.map((d) => `${d.valore} = ${d.derivazione}`).join("; ")}.`);
  }
  return parti.length > 0 ? `${parti.join(" ")} ` : "";
}
