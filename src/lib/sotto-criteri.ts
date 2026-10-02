import { limitePagineConMargine, stimaPagineContenuto } from "@/lib/stima-pagine";

// Sotto-criteri del disciplinare con i loro punti, e budget di pagine per
// ciascuno. Modulo PURO (nessuna lettura/scrittura DB, nessun modello): lo
// usano sia la generazione (il budget entra nel prompt come tetto) sia la
// compressione (sa quanto vale ogni blocco e cosa richiede) sia i test.
//
// Perché per sotto-criterio e non solo per criterio: la ripartizione a
// livello di criterio (vedi calcolaRipartizionePagine in gara-chat-prompt.ts)
// lasciava libero il modello di distribuire le pagine dentro il criterio, e
// in pratica scriveva a lungo dove era facile (un sotto-criterio da 2 punti
// occupava quanto uno da 10). Il documento nasceva a 16,5 pagine per un
// limite di 12: un terzo da buttare, e tagliato senza sapere cosa valesse.

export type SottoCriterio = {
  chiave: string; // "1.1"
  criterio: string; // "1" (numero del criterio di primo livello)
  titolo: string; // "Organigramma e qualifiche"
  requisito: string; // "adeguatezza struttura organizzativa e gruppo di lavoro" + eventuali punti a) b) c)
  // Dopo il parsing: i punti scritti nel disciplinare, oppure 0 se il
  // disciplinare li assegna solo al criterio (puntiEspliciti = false).
  // Nel budget calcolato è invece il PESO effettivo usato per ripartire le
  // pagine (per i sotto-criteri senza punti propri, una quota del criterio).
  punti: number;
  puntiEspliciti: boolean;
  tabellare: boolean;
};

export type BudgetSottoCriterio = SottoCriterio & {
  paginePreviste: number; // tetto in pagine (titolo del sotto-criterio incluso)
  parolePreviste: number; // lo stesso tetto espresso in parole di solo testo
};

export type BudgetGara = {
  limiteDichiarato: number;
  limiteConMargine: number;
  paroleProsaPerPagina: number;
  sottoCriteri: BudgetSottoCriterio[];
  // Pagine assegnate a ciascun criterio di primo livello (numero → pagine),
  // titolo del criterio incluso.
  pagineCriterio: Map<string, number>;
  avvisi: string[];
};

export type CriterioPunti = { numero: string; titolo: string; punti_max: number };

// "1.1 Organigramma e qualifiche (adeguatezza struttura organizzativa e
// gruppo di lavoro) - 10 punti (D)". Il numero può avere una lettera
// davanti ("A.1"), come nel resto del codice (applicaMarcatoriTabellari).
// Dopo il trattino può comparire "max"/"fino a (un massimo di)" prima del
// numero ("- max 6 punti (D)"): è la dicitura più comune nei disciplinari
// reali, e senza questo il parser non riconosceva nessun sotto-criterio (il
// budget per sotto-criterio non si attivava mai su una gara reale che la
// usava).
const RIGA_SOTTO_CRITERIO =
  /^\s*([A-Za-z]?\d+(?:\.\d+)+)[.)]?\s+(.+?)\s*[-–—]\s*(?:max(?:imo)?\.?\s+|fino\s+a\s+(?:un\s+massimo\s+di\s+)?)?(\d+(?:[.,]\d+)?)\s*punt[oi]\b(.*)$/i;
// "1.1 Modalità di organizzazione del servizio": un sotto-criterio che il
// disciplinare elenca SENZA punti propri (i punti sono solo del criterio che
// lo contiene — caso frequentissimo per i criteri discrezionali). Solo due
// livelli ("N.N") e il testo deve iniziare con una lettera diversa da
// "punti": una riga come "2.5 volte il valore" o "1.5 punti per ogni..." nel
// corpo di una descrizione non è un sotto-criterio.
const RIGA_SOTTO_CRITERIO_SENZA_PUNTI = /^\s*([A-Za-z]?\d+\.\d+)[.)]?\s+(?!punt[oi]\b)([A-Za-zÀ-ÿ].*)$/;
const RIGA_INTESTAZIONE_ECONOMICA = /^\s*(?:CRITERI\s+)?OFFERTA\s+ECONOMICA/i;
const RIGA_DETTAGLIO = /^\s+(?:[a-z]\)|[-•*])\s+\S/i;
const MAX_CARATTERI_REQUISITO_SENZA_PUNTI = 400;

function indiceDi(chiave: string): number {
  return Number(chiave.split(".").pop());
}

// Un sotto-criterio senza punti propri è accettato solo se prosegue la
// numerazione del suo criterio (N.1, poi N.2, ...): un "2.5 volte il valore"
// che per caso inizia una riga di descrizione non ha un N.4 prima e resta
// fuori.
function eSuccessivoNellaNumerazione(chiave: string, ultimoIndice: Map<string, number>): boolean {
  return indiceDi(chiave) === (ultimoIndice.get(chiave.split(".")[0]) ?? 0) + 1;
}

// Sotto-criteri dell'offerta TECNICA: si ferma alla sezione dell'offerta
// economica, che può avere numerazioni analoghe ma non entra nel budget
// della relazione tecnica.
export function parseSottoCriteri(criteriValutazione: string | null | undefined, subCriteriTabellari: string[] | null = null): SottoCriterio[] {
  if (!criteriValutazione) return [];
  const tabellari = new Set((subCriteriTabellari ?? []).map((s) => s.trim().toLowerCase()));
  const risultati: SottoCriterio[] = [];
  const viste = new Set<string>();
  const ultimoIndice = new Map<string, number>();
  let corrente: SottoCriterio | null = null;

  for (const riga of criteriValutazione.split("\n")) {
    if (risultati.length > 0 && RIGA_INTESTAZIONE_ECONOMICA.test(riga)) break;

    const m = riga.match(RIGA_SOTTO_CRITERIO);
    if (m && !viste.has(m[1].toLowerCase())) {
      const chiave = m[1];
      const testo = m[2].trim();
      const parentesi = testo.match(/^(.*?)\s*\((.*)\)\s*$/);
      const titolo = (parentesi ? parentesi[1] : testo).trim();
      const requisito = (parentesi ? parentesi[2] : "").trim();
      const punti = Number(m[3].replace(",", "."));
      const tipoTabellare = /\(\s*T\s*\)/.test(m[4] ?? "");
      corrente = {
        chiave,
        criterio: chiave.split(".")[0],
        titolo,
        requisito,
        punti,
        puntiEspliciti: true,
        tabellare: tabellari.has(chiave.toLowerCase()) || (tabellari.size === 0 && tipoTabellare),
      };
      viste.add(chiave.toLowerCase());
      ultimoIndice.set(corrente.criterio, indiceDi(chiave));
      risultati.push(corrente);
      continue;
    }

    const senzaPunti = m ? null : riga.match(RIGA_SOTTO_CRITERIO_SENZA_PUNTI);
    if (senzaPunti && !viste.has(senzaPunti[1].toLowerCase()) && eSuccessivoNellaNumerazione(senzaPunti[1], ultimoIndice)) {
      const chiave = senzaPunti[1];
      const testo = senzaPunti[2].trim();
      const [testa, ...coda] = testo.split(/\s[-–—]\s/);
      const parentesi = testa.match(/^(.*?)\s*\((.*)\)\s*$/);
      const titolo = (parentesi ? parentesi[1] : testa).trim();
      const requisito = [parentesi ? parentesi[2].trim() : "", ...coda.map((c) => c.trim())]
        .filter(Boolean)
        .join("; ")
        .slice(0, MAX_CARATTERI_REQUISITO_SENZA_PUNTI);
      corrente = {
        chiave,
        criterio: chiave.split(".")[0],
        titolo,
        requisito,
        punti: 0,
        puntiEspliciti: false,
        tabellare: tabellari.has(chiave.toLowerCase()) || (tabellari.size === 0 && /\(\s*T\s*\)/.test(testo)),
      };
      viste.add(chiave.toLowerCase());
      ultimoIndice.set(corrente.criterio, indiceDi(chiave));
      risultati.push(corrente);
      continue;
    }

    // Righe di dettaglio sotto un sotto-criterio ("   a) organigramma...",
    // "   - orari di reperibilità"): fanno parte di ciò che il disciplinare
    // richiede per quel sotto-criterio.
    if (corrente && RIGA_DETTAGLIO.test(riga)) {
      corrente.requisito = `${corrente.requisito}${corrente.requisito ? "; " : ""}${riga.trim()}`;
    } else if (riga.trim() === "" || /^\s*\d+\.\s+\S/.test(riga)) {
      corrente = null;
    }
  }
  return risultati;
}

// Parole di solo testo per pagina, coerente con la conversione già usata
// dalla correzione (450 parole equivalenti per pagina a 12pt e interlinea
// 1): scala con l'inverso del quadrato della dimensione del carattere (più
// righe e più battute per riga) e con l'inverso dell'interlinea.
export function paroleProsaPerPagina(formattazione: { dimensioneCarattere?: number; interlinea?: number } = {}): number {
  const dimensione = formattazione.dimensioneCarattere ?? 12;
  const interlinea = formattazione.interlinea ?? 1;
  return 450 * Math.pow(12 / dimensione, 2) * (1 / interlinea);
}

const TESTO_TABELLARE = "CRITERIO TABELLARE - COMPILARE";

function ingombroTabellare(sotto: SottoCriterio, formattazione: { dimensioneCarattere?: number; interlinea?: number }): number {
  return stimaPagineContenuto(`## ${sotto.chiave} ${sotto.titolo}\n\n${TESTO_TABELLARE}`, formattazione);
}

// Budget per sotto-criterio. Il costo FISSO di ogni criterio (il titolo
// "# ..." più l'ingombro reale dei suoi sotto-criteri tabellari, che hanno
// solo una riga, "CRITERIO TABELLARE - COMPILARE", non testo) si sottrae
// SUBITO dal totale pagine (limite dichiarato meno il margine di sicurezza),
// per TUTTI i criteri insieme. Ciò che resta si ripartisce tra TUTTI i
// sotto-criteri a prosa della gara in proporzione al loro peso — non solo
// quelli dello stesso criterio.
//
// Perché globale e non per-criterio: un criterio interamente tabellare
// (es. "Certificazioni", tre sotto-criteri tutti (T)) non ha, al proprio
// interno, nessun sotto-criterio a prosa a cui ridare lo spazio risparmiato
// — ripartire solo dentro quel criterio lo perderebbe, invece di restituirlo
// a un altro criterio più pesante e tutto a prosa. Bug osservato in pratica:
// su una gara con 28 punti (il 35% del totale) distribuiti su tre criteri
// interamente tabellari, il criterio più pesante (30 punti, quasi tutto
// prosa) riceveva comunque solo la propria quota nominale di punti — la
// relazione generata criterio per criterio si fermava a 23 pagine su un
// limite di 50, ben al di sotto dello spazio realmente disponibile.
//
// Peso di un sotto-criterio: i punti scritti nel disciplinare se ci sono;
// se il disciplinare dà punti solo al criterio (caso comune per i criteri
// discrezionali), i punti del criterio sono ripartiti in parti uguali tra i
// suoi sotto-criteri (nei criteri misti, il residuo tra quelli senza punti).
// Un criterio del riepilogo senza nessun sotto-criterio riconosciuto
// conserva la sua quota nominale di pagine, riservata a monte, così non
// viene né perso né finanziato dagli altri.
//
// Ritorna null se dal disciplinare non si ricava nessun sotto-criterio
// utilizzabile: in quel caso resta in vigore il solo budget per criterio.
export function calcolaBudgetSottoCriteri(params: {
  criteriValutazione: string | null | undefined;
  criteriRiepilogo: CriterioPunti[] | null | undefined;
  // Serve solo a riservare la quota nominale dei criteri senza sotto-criteri
  // riconosciuti: i punti dei criteri interamente tabellari non "diluiscono"
  // la quota di pagine a prosa degli altri.
  punteggioTecnicoMax: number | null | undefined;
  limitePagineTotale: number | null | undefined;
  subCriteriTabellari: string[] | null | undefined;
  formattazione?: { dimensioneCarattere?: number; interlinea?: number };
}): BudgetGara | null {
  const { criteriValutazione, criteriRiepilogo, punteggioTecnicoMax, limitePagineTotale, subCriteriTabellari } = params;
  const formattazione = params.formattazione ?? {};
  if (!limitePagineTotale) return null;

  const riepilogoDi = (numero: string) => criteriRiepilogo?.find((c) => c.numero.trim().toLowerCase() === numero.toLowerCase());

  // Un "N.N" il cui N non è un criterio del riepilogo non è un sotto-criterio
  // (può essere un numero decimale in una descrizione).
  const riconosciuti = parseSottoCriteri(criteriValutazione, subCriteriTabellari ?? null).filter((s) => {
    if (criteriRiepilogo?.length && !riepilogoDi(s.criterio)) return false;
    return s.puntiEspliciti ? s.punti > 0 : true;
  });
  if (riconosciuti.length === 0) return null;

  const avvisi: string[] = [];
  const limiteConMargine = limitePagineConMargine(limitePagineTotale);
  const paroleXPagina = paroleProsaPerPagina(formattazione);

  const numeriCriteri: string[] = [];
  const titoloCriterio = new Map<string, string>();
  const sotto: SottoCriterio[] = [];
  for (const numero of [...new Set(riconosciuti.map((s) => s.criterio))]) {
    const suoi = riconosciuti.filter((s) => s.criterio === numero);
    const dalRiepilogo = riepilogoDi(numero);
    const conPunti = suoi.filter((s) => s.puntiEspliciti);
    const senzaPunti = suoi.filter((s) => !s.puntiEspliciti);
    const sommaEspliciti = conPunti.reduce((t, s) => t + s.punti, 0);
    const puntiCriterio = dalRiepilogo?.punti_max ?? sommaEspliciti;
    if (!(puntiCriterio > 0)) continue;

    let pesi: number[];
    if (senzaPunti.length === 0) {
      const scala = sommaEspliciti > 0 && Math.abs(puntiCriterio - sommaEspliciti) > 0.5 ? puntiCriterio / sommaEspliciti : 1;
      if (scala !== 1) {
        avvisi.push(
          `Criterio ${numero}: i sotto-criteri sommano ${puntiIt(sommaEspliciti)} punti ma il criterio ne vale ${puntiIt(puntiCriterio)}; i pesi interni sono normalizzati.`,
        );
      }
      pesi = suoi.map((s) => s.punti * scala);
    } else if (conPunti.length === 0) {
      pesi = suoi.map(() => puntiCriterio / suoi.length);
      if (!suoi.every((s) => s.tabellare)) {
        avvisi.push(
          `Criterio ${numero}: il disciplinare assegna i ${puntiIt(puntiCriterio)} punti al criterio, non ai singoli sotto-criteri: ripartiti in parti uguali tra i suoi ${suoi.length} sotto-criteri.`,
        );
      }
    } else {
      const residuo = Math.max(0, puntiCriterio - sommaEspliciti);
      const quota = residuo > 0 ? residuo / senzaPunti.length : sommaEspliciti / conPunti.length;
      pesi = suoi.map((s) => (s.puntiEspliciti ? s.punti : quota));
      avvisi.push(
        `Criterio ${numero}: ai sotto-criteri senza punti propri è attribuita una quota di ${puntiIt(quota)} punti ciascuno.`,
      );
    }

    numeriCriteri.push(numero);
    titoloCriterio.set(numero, dalRiepilogo?.titolo ?? `Criterio ${numero}`);
    suoi.forEach((s, i) => sotto.push({ ...s, punti: pesi[i] }));
  }
  if (sotto.length === 0) return null;

  // Criteri del riepilogo senza nessun sotto-criterio riconosciuto: tengono
  // la quota nominale in proporzione ai punti.
  const sommaRiepilogo = (criteriRiepilogo ?? []).reduce((t, c) => t + c.punti_max, 0);
  const denominatoreNominale = punteggioTecnicoMax && punteggioTecnicoMax > 0 ? punteggioTecnicoMax : sommaRiepilogo;
  const pagineCriterio = new Map<string, number>();
  let costoRiservato = 0;
  for (const c of criteriRiepilogo ?? []) {
    const numero = c.numero.trim();
    if (numeriCriteri.some((n) => n.toLowerCase() === numero.toLowerCase())) continue;
    if (!(c.punti_max > 0) || !(denominatoreNominale > 0)) continue;
    const pagine = (c.punti_max / denominatoreNominale) * limiteConMargine;
    pagineCriterio.set(numero, pagine);
    costoRiservato += pagine;
    avvisi.push(`Criterio ${numero}: nessun sotto-criterio riconosciuto nel disciplinare; riservate ${pagineIt(pagine)} pagine in proporzione ai punti.`);
  }

  // Costo fisso di ogni criterio (titolo + tabellari), sommato su TUTTI i
  // criteri prima di ripartire: vedi la spiegazione sopra sul perché non si
  // ferma al singolo criterio.
  const costoTitoloCriterio = new Map<string, number>();
  const costoTabellariCriterio = new Map<string, number>();
  let costoFissoTotale = costoRiservato;
  for (const numero of numeriCriteri) {
    const suoi = sotto.filter((s) => s.criterio === numero);
    const costoTitolo = stimaPagineContenuto(`# ${numero}. ${titoloCriterio.get(numero)}`, formattazione);
    const costoTabellari = suoi.filter((s) => s.tabellare).reduce((t, s) => t + ingombroTabellare(s, formattazione), 0);
    costoTitoloCriterio.set(numero, costoTitolo);
    costoTabellariCriterio.set(numero, costoTabellari);
    costoFissoTotale += costoTitolo + costoTabellari;
  }

  const daRipartireGlobale = Math.max(0, limiteConMargine - costoFissoTotale);
  const puntiTestoTotali = sotto.filter((s) => !s.tabellare).reduce((t, s) => t + s.punti, 0);

  const risultati: BudgetSottoCriterio[] = [];
  for (const numero of numeriCriteri) {
    const suoi = sotto.filter((s) => s.criterio === numero);
    let totaleCriterio = costoTitoloCriterio.get(numero)! + costoTabellariCriterio.get(numero)!;

    for (const s of suoi) {
      const pagine = s.tabellare
        ? ingombroTabellare(s, formattazione)
        : puntiTestoTotali > 0
          ? (s.punti / puntiTestoTotali) * daRipartireGlobale
          : 0;
      if (!s.tabellare) totaleCriterio += pagine;
      risultati.push({ ...s, paginePreviste: pagine, parolePreviste: Math.round(pagine * paroleXPagina) });
    }

    pagineCriterio.set(numero, totaleCriterio);
  }

  risultati.sort((a, b) => a.chiave.localeCompare(b.chiave, undefined, { numeric: true }));
  return { limiteDichiarato: limitePagineTotale, limiteConMargine, paroleProsaPerPagina: paroleXPagina, sottoCriteri: risultati, pagineCriterio, avvisi };
}

export function trovaBudgetSottoCriterio(budget: BudgetGara | null, chiave: string): BudgetSottoCriterio | undefined {
  return budget?.sottoCriteri.find((s) => s.chiave.toLowerCase() === chiave.toLowerCase());
}

function pagineIt(n: number): string {
  return n.toFixed(1).replace(".", ",");
}

function puntiIt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ",");
}

// Tetti da mostrare al modello che genera la sezione. Volutamente in due
// unità (pagine e parole di solo testo): il modello conta male le pagine
// ma stima ragionevolmente bene una lunghezza in parole.
export function formattaBudgetPerPrompt(budget: BudgetGara, titoliCriteri?: Map<string, string>): string {
  const perCriterio = new Map<string, BudgetSottoCriterio[]>();
  for (const s of budget.sottoCriteri) perCriterio.set(s.criterio, [...(perCriterio.get(s.criterio) ?? []), s]);

  const blocchi: string[] = [];
  for (const [numero, elenco] of perCriterio) {
    const titolo = titoliCriteri?.get(numero);
    const totale = budget.pagineCriterio.get(numero) ?? elenco.reduce((t, s) => t + s.paginePreviste, 0);
    blocchi.push(`Criterio ${numero}${titolo ? ` "${titolo}"` : ""} — in tutto ${pagineIt(totale)} pagine:`);
    for (const s of elenco) {
      blocchi.push(
        s.tabellare
          ? `  - ${s.chiave} ${s.titolo} (${puntiIt(s.punti)} punti): tabellare, solo la dicitura prescritta`
          : `  - ${s.chiave} ${s.titolo} (${puntiIt(s.punti)} punti): TETTO ${pagineIt(s.paginePreviste)} pagine ≈ ${s.parolePreviste} parole`,
      );
    }
  }

  return `BUDGET PER SOTTO-CRITERIO — VINCOLO, NON INDICAZIONE (massima priorità sulla lunghezza)
Le ${budget.limiteConMargine} pagine complessive dell'offerta (il limite dichiarato di ${budget.limiteDichiarato} meno un margine di sicurezza) sono già ripartite tra i sotto-criteri IN PROPORZIONE AI PUNTI. Il numero indicato per ciascun sotto-criterio è un TETTO MASSIMO che non si supera, titolo, tabelle, elenchi e riquadri inclusi (le parole indicate sono di solo testo: una tabella occupa circa il doppio delle stesse parole in prosa, un organigramma [ORGANIGRAMMA] circa 0,6 pagine da sottrarre al tetto del suo sotto-criterio).
${blocchi.join("\n")}
Come applicarlo:
1. Il tetto non si sfora e non si compensa: una pagina in più in un sotto-criterio non è recuperabile in un altro. Punta al 85-95% del tetto: chiudere sotto il tetto è sempre preferibile a superarlo. Il tuo senso della lunghezza tende a sovrastimare: verificato su una gara reale, le bozze scritte senza questo vincolo superavano i tetti di circa il 50%, e i sotto-criteri di pochi punti erano i più sforati (fino a 3 volte il tetto).
2. Se ciò che vuoi scrivere non entra, decidi tu cosa sacrificare, in quest'ordine: frasi senza un fatto verificabile, ripetizioni, descrizioni di ciò che il capitolato già impone, premesse. Se non basta, riduci il DETTAGLIO (una frase o una riga di tabella al posto di un paragrafo), ma non eliminare mai un elemento espressamente richiesto dal sotto-criterio, una citazione di articolo del capitolato, un impegno con il suo valore o un indicatore misurabile.
3. Il sistema conosce questi tetti: ciò che li supera viene tagliato dopo da un algoritmo che non conosce il tuo testo e può togliere elementi che valgono punti. Tagliare tu, prima, è sempre meglio.
4. Prima di consegnare, ripercorri ogni sotto-criterio e controlla che sia entro il suo tetto; nei sotto-criteri di valore basso (pochi punti) scrivi il minimo che soddisfa il disciplinare, senza sviluppare temi di contorno.${budget.avvisi.length ? `\nNote: ${budget.avvisi.join(" ")}` : ""}`;
}

// Versione breve per la descrizione dello strumento: la regola "vicino al
// punto in cui il modello decide cosa scrivere" (vedi avvisoTabellare in
// gara-chat-prompt.ts) funziona meglio di una sola regola nel prompt di
// sistema.
export function formattaTettiPerStrumento(budget: BudgetGara): string {
  const elenco = budget.sottoCriteri
    .filter((s) => !s.tabellare)
    .map((s) => `${s.chiave} ≤ ${s.parolePreviste} parole (${pagineIt(s.paginePreviste)} pag.)`)
    .join("; ");
  return `VINCOLO DI LUNGHEZZA (prima di ogni altra istruzione sulla lunghezza, che qui è superata): ogni sotto-criterio ha un TETTO MASSIMO in parole di solo testo, ripartito in proporzione ai punti — ${elenco}. Il tetto non si sfora e non si compensa con un altro sotto-criterio; una tabella conta circa il doppio delle stesse parole. Se non entra tutto, riduci il dettaglio (una frase, una riga di tabella) senza mai omettere un elemento richiesto dal sotto-criterio, una citazione del capitolato o un impegno con il suo valore. Punta all'85-95% del tetto. `;
}
