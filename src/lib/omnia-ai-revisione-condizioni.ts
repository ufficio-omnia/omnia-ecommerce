import { REVISIONE } from "@/lib/omnia-ai-revisione-calcoli";

// Condizioni del servizio di «revisione umana» della relazione tecnica. Testo in vigore, versionato: la
// versione e l'impronta (sha256 del testo canonico) si registrano insieme all'accettazione del cliente
// (tabella omnia_ai_revisioni). Se si cambia anche una sola parola si aumenta la versione.
//
// BOZZA: il testo va fatto verificare dal legale dell'azienda prima di venderlo per davvero.

export const VERSIONE_CONDIZIONI_REVISIONE = 1;

export type ClausolaRevisione = { numero: number; titolo: string; testo: string; specifica: boolean };

const e = (centesimi: number) => `${centesimi / 100} euro`;

export const CLAUSOLE_REVISIONE: ClausolaRevisione[] = [
  {
    numero: 1,
    titolo: "Oggetto del servizio",
    specifica: false,
    testo:
      "La revisione umana consiste nell'esame, da parte di un consulente umano, della Relazione tecnica finale generata con OMNIA AI per la gara indicata, e nella sua finalizzazione. La revisione comprende intestazione, piè di pagina e copertina grafica personalizzata. Il servizio è rivolto a imprese e professionisti e non sostituisce la verifica finale del cliente sull'offerta da presentare.",
  },
  {
    numero: 2,
    titolo: "Contatto e tempi di consegna",
    specifica: false,
    testo: `Entro ${REVISIONE.oreContattoLavorative} ore lavorative dal pagamento un consulente umano contatta personalmente il referente indicato dal cliente. OMNIA AI consegna la Relazione tecnica revisionata, completa di intestazione, piè di pagina e copertina grafica, entro ${REVISIONE.oreConsegnaLavorative} ore lavorative dall'invio della richiesta, cioè dal pagamento. Per ore lavorative si intendono quelle dei giorni dal lunedì al venerdì, esclusi i festivi, in orario d'ufficio.`,
  },
  {
    numero: 3,
    titolo: "Informazioni e collaborazione del cliente",
    specifica: true,
    testo:
      "Il cliente si impegna a fornire tempestivamente tutte le informazioni, i dati e i materiali necessari alla revisione (per esempio logo, dati per l'intestazione e il piè di pagina, indicazioni grafiche, chiarimenti sulla gara) e a rendere effettivamente raggiungibile il referente indicato. I termini dell'articolo 2 sono sospesi finché le informazioni necessarie non sono state fornite.",
  },
  {
    numero: 4,
    titolo: "Segreto professionale e riservatezza",
    specifica: false,
    testo:
      "OMNIA AI si impegna al segreto professionale e alla riservatezza su tutti i documenti, i dati e le informazioni ricevuti per il servizio, che sono usati solo per eseguirlo e sono accessibili solo ai consulenti incaricati, a loro volta vincolati al segreto. I dati personali sono trattati secondo la Privacy policy.",
  },
  {
    numero: 5,
    titolo: "Corrispettivo e pagamento",
    specifica: false,
    testo: `Il corrispettivo è determinato automaticamente dal sistema in base al numero di pagine: da ${e(REVISIONE.prezzoBaseCentesimi)} per relazioni fino a ${REVISIONE.pagineBase} pagine a ${e(REVISIONE.prezzoMassimoCentesimi)} per ${REVISIONE.pagineMassimo} pagine o più, in proporzione tra i due estremi. Le pagine sono quelle prescritte dal disciplinare di gara oppure, se il disciplinare non indica un limite, quelle della Relazione tecnica finale generata da OMNIA AI. Se la gara scade entro ${REVISIONE.oreMaggiorazione25} ore il corrispettivo è maggiorato del ${REVISIONE.maggiorazione25}%; se scade entro ${REVISIONE.oreMaggiorazione50} ore è maggiorato del ${REVISIONE.maggiorazione50}%. Le gare che scadono entro ${REVISIONE.oreMinimePerGestire} ore non possono essere gestite da consulenti umani. Gli importi sono IVA inclusa. Il pagamento è anticipato, con carta tramite Stripe.`,
  },
  {
    numero: 6,
    titolo: "Limitazione di responsabilità",
    specifica: true,
    testo:
      "La revisione non garantisce l'ammissione, il punteggio o l'aggiudicazione della gara. Il cliente resta responsabile dei contenuti dell'offerta, della veridicità dei dati forniti e della presentazione dell'offerta entro i termini del bando. La responsabilità di OMNIA AI per il servizio è limitata, salvo dolo o colpa grave, al corrispettivo pagato.",
  },
  {
    numero: 7,
    titolo: "Relazione oggetto della revisione",
    specifica: false,
    testo:
      "La richiesta riguarda la Relazione tecnica finale indicata al momento dell'acquisto. Modifiche sostanziali successive del contenuto, o la revisione di una relazione diversa, richiedono una nuova richiesta.",
  },
];

export const CLAUSOLE_SPECIFICHE_REVISIONE = CLAUSOLE_REVISIONE.filter((c) => c.specifica);

// Il testo canonico su cui si calcola l'impronta: versione, numeri, titoli e testi, nell'ordine.
export function testoCanonicoCondizioniRevisione(): string {
  return [`versione ${VERSIONE_CONDIZIONI_REVISIONE}`, ...CLAUSOLE_REVISIONE.map((c) => `${c.numero}. ${c.titolo}${c.specifica ? " [specifica]" : ""}\n${c.testo}`)].join("\n\n");
}
