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
  punti: number;
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
const RIGA_SOTTO_CRITERIO = /^\s*([A-Za-z]?\d+(?:\.\d+)+)[.)]?\s+(.+?)\s*[-–—]\s*(\d+(?:[.,]\d+)?)\s*punt[oi]\b(.*)$/i;
const RIGA_INTESTAZIONE_ECONOMICA = /^\s*(?:CRITERI\s+)?OFFERTA\s+ECONOMICA/i;
const RIGA_DETTAGLIO = /^\s+(?:[a-z]\)|[-•*])\s+\S/i;

// Sotto-criteri dell'offerta TECNICA: si ferma alla sezione dell'offerta
// economica, che può avere numerazioni analoghe ma non entra nel budget
// della relazione tecnica.
export function parseSottoCriteri(criteriValutazione: string | null | undefined, subCriteriTabellari: string[] | null = null): SottoCriterio[] {
  if (!criteriValutazione) return [];
  const tabellari = new Set((subCriteriTabellari ?? []).map((s) => s.trim().toLowerCase()));
  const risultati: SottoCriterio[] = [];
  let corrente: SottoCriterio | null = null;

  for (const riga of criteriValutazione.split("\n")) {
    if (risultati.length > 0 && RIGA_INTESTAZIONE_ECONOMICA.test(riga)) break;

    const m = riga.match(RIGA_SOTTO_CRITERIO);
    if (m) {
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
        tabellare: tabellari.has(chiave.toLowerCase()) || (tabellari.size === 0 && tipoTabellare),
      };
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

// Budget per sotto-criterio: le pagine totali (limite dichiarato meno il
// margine di sicurezza) sono ripartite prima tra i criteri di primo livello
// in proporzione ai loro punti, poi dentro ciascun criterio tra i suoi
// sotto-criteri in proporzione ai punti. I sotto-criteri tabellari non
// hanno testo (una riga, "CRITERIO TABELLARE - COMPILARE"): occupano il
// loro ingombro reale e ciò che avanza va agli altri, non resta inutilizzato.
// Il titolo del criterio (banda "# ...") ha un costo proprio, sottratto
// prima di ripartire, così la somma dei tetti più i titoli coincide con il
// limite con margine.
//
// Ritorna null se dal disciplinare non si ricava nessun sotto-criterio con
// punti: in quel caso resta in vigore il solo budget per criterio.
export function calcolaBudgetSottoCriteri(params: {
  criteriValutazione: string | null | undefined;
  criteriRiepilogo: CriterioPunti[] | null | undefined;
  punteggioTecnicoMax: number | null | undefined;
  limitePagineTotale: number | null | undefined;
  subCriteriTabellari: string[] | null | undefined;
  formattazione?: { dimensioneCarattere?: number; interlinea?: number };
}): BudgetGara | null {
  const { criteriValutazione, criteriRiepilogo, punteggioTecnicoMax, limitePagineTotale, subCriteriTabellari } = params;
  const formattazione = params.formattazione ?? {};
  if (!limitePagineTotale) return null;

  const sotto = parseSottoCriteri(criteriValutazione, subCriteriTabellari ?? null).filter((s) => s.punti > 0);
  if (sotto.length === 0) return null;

  const avvisi: string[] = [];
  const limiteConMargine = limitePagineConMargine(limitePagineTotale);
  const paroleXPagina = paroleProsaPerPagina(formattazione);

  // Punti per criterio: quelli del riepilogo strutturato se presenti,
  // altrimenti la somma dei sotto-criteri; il denominatore è il punteggio
  // tecnico massimo dichiarato, altrimenti la somma dei criteri.
  const numeriCriteri = [...new Set(sotto.map((s) => s.criterio))];
  const puntiCriterio = new Map<string, number>();
  const titoloCriterio = new Map<string, string>();
  for (const numero of numeriCriteri) {
    const dalRiepilogo = criteriRiepilogo?.find((c) => c.numero.trim().toLowerCase() === numero.toLowerCase());
    const sommaSotto = sotto.filter((s) => s.criterio === numero).reduce((t, s) => t + s.punti, 0);
    puntiCriterio.set(numero, dalRiepilogo?.punti_max ?? sommaSotto);
    titoloCriterio.set(numero, dalRiepilogo?.titolo ?? `Criterio ${numero}`);
    if (dalRiepilogo && Math.abs(dalRiepilogo.punti_max - sommaSotto) > 0.5) {
      avvisi.push(
        `Criterio ${numero}: i sotto-criteri sommano ${sommaSotto} punti ma il criterio ne vale ${dalRiepilogo.punti_max}; i pesi interni sono normalizzati.`,
      );
    }
  }
  const denominatore = punteggioTecnicoMax && punteggioTecnicoMax > 0 ? punteggioTecnicoMax : [...puntiCriterio.values()].reduce((t, p) => t + p, 0);

  const pagineCriterio = new Map<string, number>();
  const risultati: BudgetSottoCriterio[] = [];

  for (const numero of numeriCriteri) {
    const pagineDelCriterio = (puntiCriterio.get(numero)! / denominatore) * limiteConMargine;
    pagineCriterio.set(numero, pagineDelCriterio);

    const suoi = sotto.filter((s) => s.criterio === numero);
    const costoTitolo = stimaPagineContenuto(`# ${numero}. ${titoloCriterio.get(numero)}`, formattazione);
    const costoTabellari = suoi.filter((s) => s.tabellare).reduce((t, s) => t + ingombroTabellare(s, formattazione), 0);
    const daRipartire = Math.max(0, pagineDelCriterio - costoTitolo - costoTabellari);
    const puntiTesto = suoi.filter((s) => !s.tabellare).reduce((t, s) => t + s.punti, 0);

    for (const s of suoi) {
      const pagine = s.tabellare
        ? ingombroTabellare(s, formattazione)
        : puntiTesto > 0
          ? (s.punti / puntiTesto) * daRipartire
          : 0;
      risultati.push({ ...s, paginePreviste: pagine, parolePreviste: Math.round(pagine * paroleXPagina) });
    }
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
          ? `  - ${s.chiave} ${s.titolo} (${s.punti} punti): tabellare, solo la dicitura prescritta`
          : `  - ${s.chiave} ${s.titolo} (${s.punti} punti): TETTO ${pagineIt(s.paginePreviste)} pagine ≈ ${s.parolePreviste} parole`,
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
