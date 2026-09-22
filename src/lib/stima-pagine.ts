// Stima quante pagine A4 reali occuperà un contenuto (markdown OMNIA:
// paragrafi, tabelle, organigrammi, immagini) una volta impaginato in
// Word — NON un conteggio a parole (bug corretto: un conteggio a parole
// ignora completamente quanto spazio occupano le tabelle, che vanno a
// capo molto più spesso del testo normale perché le colonne sono
// strette. Verificato in pratica: un contenuto con molte tabelle stimato
// a ~42 pagine a parole occupava in realtà ~60 pagine renderizzate).
//
// Calcolo basato sulla larghezza utile della pagina (A4, margini 2.5cm)
// e sulla larghezza media di un carattere Times New Roman: quante
// battute stanno su una riga a piena larghezza, quante su una riga
// divisa in N colonne di tabella, quante righe stanno su una pagina data
// l'interlinea richiesta dal bando. Le costanti sono calibrate su un
// documento reale (23 tabelle, 1 organigramma, 3 immagini, font Times
// New Roman 12, interlinea 1.5) confrontando la stima con l'altezza
// resa in un rendering HTML reale del documento: scarto finale 0.7%.
const CARATTERI_PER_RIGA_PIENA_A_12PT = 73;
const RIGHE_PER_PAGINA_A_12PT_INTERLINEA_1 = 57;
const PAGINE_PER_ORGANIGRAMMA = 0.6;
const PAGINE_PER_IMMAGINE = 0.2;

// Ingombri introdotti dall'impaginazione (docx-generator.ts) che la
// calibrazione originale non conosceva: l'intestazione di pagina compare
// su ogni pagina del corpo (assunta sempre presente: sottostimare le
// pagine è il verso sbagliato in cui sbagliare, vedi MARGINE_SICUREZZA_PAGINE
// nei chiamanti), le bande dei titoli di criterio/sotto-criterio hanno
// spaziatura/bordo in più rispetto a un paragrafo normale. Misurati in
// "righe equivalenti" alla dimensione carattere corrente, come il resto
// del calcolo.
const RIGHE_INTESTAZIONE_PER_PAGINA = 1.6;
const RIGHE_EXTRA_BANDA_CRITERIO = 1.7;
const RIGHE_EXTRA_BANDA_SOTTOCRITERIO = 1.2;

function caratteriPerRigaPiena(dimensioneCarattere: number): number {
  return CARATTERI_PER_RIGA_PIENA_A_12PT * (12 / dimensioneCarattere);
}

function righePerPagina(dimensioneCarattere: number, interlinea: number): number {
  const righeLorde = (RIGHE_PER_PAGINA_A_12PT_INTERLINEA_1 * (12 / dimensioneCarattere)) / interlinea;
  return Math.max(1, righeLorde - RIGHE_INTESTAZIONE_PER_PAGINA);
}

// Stessa numerazione puntata usata in docx-generator.ts (livelloTitolo)
// per decidere se un titolo è banda di criterio o di sotto-criterio a
// prescindere da quanti "#" ha scritto l'AI (es. "# 2.1 ..." è comunque
// un sotto-criterio): le due funzioni vanno tenute allineate, altrimenti
// la stima e il documento reso non concordano su cosa costa cosa.
const NUMERAZIONE_PUNTATA_REGEX = /^\s*(?:[A-Za-z]|\d+)((?:\.\d+)+)/;

function livelloTitoloStimato(livelloMarkdown: 1 | 2 | 3, testo: string): 1 | 2 | 3 {
  const match = testo.match(NUMERAZIONE_PUNTATA_REGEX);
  if (!match) return livelloMarkdown;
  return Math.min(match[1].split(".").length, 3) as 1 | 2 | 3;
}

function pulisciTagFormattazione(testo: string): string {
  return testo
    .replace(/^\[(C|G)\]\s*/, "")
    .replace(/^\[ICONA:[a-zA-Z]+\]\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/!!/g, "");
}

// Margine di sicurezza tra il limite dichiarato dal disciplinare e
// l'obiettivo reale usato per ripartizione/correzione: la stima resta
// comunque una stima (non un conteggio Word reale, vedi commento in
// testa al file), quindi puntare esattamente al limite significa
// rischiare di sforarlo. Il ciclo automatico punta sempre ad almeno una
// pagina sotto il limite dichiarato — su un limite di 12 l'obiettivo
// reale è 11 — usata sia per la ripartizione in chat (gara-chat.ts) sia
// per la correzione finale (relazione-tecnica.ts), le stesse in ogni
// punto in cui viene stabilito un target di pagine.
const MARGINE_SICUREZZA_PAGINE = 1;

export function limitePagineConMargine(limiteDichiarato: number): number {
  return Math.max(1, limiteDichiarato - MARGINE_SICUREZZA_PAGINE);
}

export function stimaPagineContenuto(
  testo: string,
  formattazione: { dimensioneCarattere?: number; interlinea?: number } = {},
): number {
  const dimensioneCarattere = formattazione.dimensioneCarattere ?? 12;
  const interlinea = formattazione.interlinea ?? 1;
  const caratteriRigaPiena = caratteriPerRigaPiena(dimensioneCarattere);
  const righePagina = righePerPagina(dimensioneCarattere, interlinea);

  const blocchi = testo.split(/\n\s*\n/);
  let righeTotali = 0;

  for (const blocco of blocchi) {
    const righeGrezze = blocco.split("\n").map((r) => r.trim()).filter(Boolean);
    const senzaColore = /^\[TABELLA:/i.test(righeGrezze[0] ?? "") ? righeGrezze.slice(1) : righeGrezze;
    const eTabella = senzaColore.length > 0 && senzaColore.every((r) => /^\|.*\|$/.test(r));

    if (eTabella) {
      const righeDati = senzaColore.filter((r) => !/^\|[-:\s|]+\|$/.test(r));
      for (const riga of righeDati) {
        const celle = riga.split("|").slice(1, -1);
        const numColonne = celle.length || 1;
        // *0.85 per il padding orizzontale delle celle, che riduce lo
        // spazio utile per il testo rispetto a una riga a piena pagina.
        const caratteriRigaCella = Math.max(8, Math.floor((caratteriRigaPiena * 0.85) / numColonne));
        let righeMassimeCella = 1;
        for (const cella of celle) {
          const pulito = pulisciTagFormattazione(cella.trim());
          righeMassimeCella = Math.max(righeMassimeCella, Math.max(1, Math.ceil(pulito.length / caratteriRigaCella)));
        }
        righeTotali += righeMassimeCella;
      }
      righeTotali += 1; // spaziatura dopo la tabella
    } else {
      for (const riga of righeGrezze) {
        const pulito = pulisciTagFormattazione(riga.replace(/^#{1,3}\s*/, ""));
        righeTotali += Math.max(1, Math.ceil(pulito.length / caratteriRigaPiena));

        // Le bande dei titoli di criterio/sotto-criterio occupano più
        // spazio di una riga di testo normale (spaziatura verticale e
        // bordo intorno al testo) — vedi paragrafoTitolo in
        // docx-generator.ts, che è la stessa fonte di questi costi.
        if (riga.startsWith("# ")) {
          righeTotali += livelloTitoloStimato(1, riga.slice(2)) === 1 ? RIGHE_EXTRA_BANDA_CRITERIO : RIGHE_EXTRA_BANDA_SOTTOCRITERIO;
        } else if (riga.startsWith("## ")) {
          righeTotali += livelloTitoloStimato(2, riga.slice(3)) === 1 ? RIGHE_EXTRA_BANDA_CRITERIO : RIGHE_EXTRA_BANDA_SOTTOCRITERIO;
        }
      }
    }
  }

  const numOrganigrammi = (testo.match(/\[ORGANIGRAMMA\]/gi) || []).length;
  const numImmagini = (testo.match(/\[IMMAGINE\]/gi) || []).length;

  return righeTotali / righePagina + numOrganigrammi * PAGINE_PER_ORGANIGRAMMA + numImmagini * PAGINE_PER_IMMAGINE;
}
