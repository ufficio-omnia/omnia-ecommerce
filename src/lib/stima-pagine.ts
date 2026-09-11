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

function caratteriPerRigaPiena(dimensioneCarattere: number): number {
  return CARATTERI_PER_RIGA_PIENA_A_12PT * (12 / dimensioneCarattere);
}

function righePerPagina(dimensioneCarattere: number, interlinea: number): number {
  return (RIGHE_PER_PAGINA_A_12PT_INTERLINEA_1 * (12 / dimensioneCarattere)) / interlinea;
}

function pulisciTagFormattazione(testo: string): string {
  return testo
    .replace(/^\[(C|G)\]\s*/, "")
    .replace(/^\[ICONA:[a-zA-Z]+\]\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/!!/g, "");
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
      }
    }
  }

  const numOrganigrammi = (testo.match(/\[ORGANIGRAMMA\]/gi) || []).length;
  const numImmagini = (testo.match(/\[IMMAGINE\]/gi) || []).length;

  return righeTotali / righePagina + numOrganigrammi * PAGINE_PER_ORGANIGRAMMA + numImmagini * PAGINE_PER_IMMAGINE;
}
