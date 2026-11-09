// I testi che il cliente legge sul piano di lavoro, in UN solo posto: il riquadro nella gara, il modulo d'acquisto, l'opzione dell'abbonamento, la
// fascia nella pagina dei piani, la pagina delle condizioni e l'avviso in console. Così quello che si fa verificare al legale
// (scripts/genera-testi-legali-piano-lavoro.ts costruisce il Word da questi stessi testi) è quello che il cliente legge davvero.
//
// Modulo senza dipendenze di server: lo usano anche i componenti client.
//
// APPROVATI dal legale dell'azienda il 6 novembre 2026 (clausole versione 1). Il testo che si ACCETTA (le sei clausole, con versione e impronta
// registrate) sta in piano-lavoro-acquisto-calcoli.ts: cambiarne una parola vuol dire aumentare la versione E farla approvare di nuovo.

// ───── l'abbonamento con il piano di lavoro: SPENTO (decisione dell'utente, 09/11/2026) ─────
// Il piano di lavoro (e i servizi aggiuntivi che verranno) si compra SOLO dentro la singola gara, mai con l'abbonamento. Tutto il lavoro fatto
// sull'opzione nell'abbonamento (prezzi Stripe, moduli, azioni, console, webhook) resta nel codice ma non si offre: questo è l'interruttore. Con
// «false» la pagina dei piani non lo nomina, i moduli d'acquisto e di cambio piano non lo mostrano e le azioni sul server rifiutano di AGGIUNGERLO
// (chi lo ha già lo conserva: tenerlo o toglierlo resta possibile). Per riaccenderlo basta metterlo a true (e ripristinare i testi della pagina).
export const ABBONAMENTO_PIANO_LAVORO_OFFERTO: boolean = false;
export const MESSAGGIO_ABBONAMENTO_PIANO_LAVORO_NON_OFFERTO = "Il piano di lavoro non si acquista con l'abbonamento: lo trovi dentro la singola gara.";

export const PERCORSO_CONDIZIONI_PIANO_LAVORO = "/condizioni-piano-lavoro";
export const TITOLO_CONDIZIONI_PIANO_LAVORO = "Condizioni del servizio «Piano di lavoro»";
export const DESCRIZIONE_CONDIZIONI_PIANO_LAVORO = "Condizioni del servizio «Piano di lavoro» di OMNIA AI: un Excel con formule attive, costruito dai documenti di gara, per ogni gara.";

// Chi fornisce il servizio: gli stessi dati delle Condizioni di abbonamento (art. 1).
export const FORNITORE_PIANO_LAVORO = "OMNIA AI è un servizio di Omnia Consulting SRLS, P.IVA 02957590819, email info@omniaitalia.com, PEC omnia26@legalmail.it.";

// ───── il riquadro nella gara ─────

// Tre parti: la seconda va in grassetto.
export const RIQUADRO_PIANO_PARTI = [
  "Un Excel con formule attive e modificabile, costruito dai documenti di gara: monte ore per sede, organico per livello, quadratura con il monte ore dichiarato, macchinari e attrezzature. È un ",
  "dimensionamento di partenza",
  ", non un preventivo: le rese sono ipotesi da validare e i prezzi di macchinari e attrezzature sono standard di mercato, da sostituire con quelli dei tuoi fornitori.",
] as const;

// ───── l'acquisto della singola gara ─────

export const ACQUISTO_SINGOLO_DETTAGLIO = " Una generazione per gara; una seconda solo se i documenti indicano una proroga dei termini. Pagamento con carta su Stripe, senza abbonamento.";
export const TITOLO_AVVERTENZE_ACQUISTO = "Avvertenze e condizioni";
export const ETICHETTA_LINK_CONDIZIONI = "Leggi le condizioni del servizio in una pagina a parte";

// ───── l'opzione dell'abbonamento ─────

export const OPZIONE_ABBONAMENTO_DESCRIZIONE =
  "Per ogni gara inclusa nel piano ricevi un Excel con formule attive, costruito dai documenti di gara: monte ore, organico per livello, quadratura con il monte ore dichiarato, macchinari. Una generazione per gara (una seconda solo se i documenti indicano una proroga dei termini). Non comprende le gare acquistate con i crediti: per quelle puoi comprare il piano della singola gara. È un dimensionamento di partenza, non un preventivo.";

// ───── la fascia nella pagina dei piani ─────

export const BANDA_PIANO_LAVORO = {
  etichetta: "Piano di lavoro",
  titolo: "Dai documenti di gara a un piano di lavoro in Excel.",
  testo:
    "Per ogni gara OMNIA AI legge i documenti e costruisce un Excel con formule attive: monte ore per sede, organico per livello, quadratura con il monte ore dichiarato, macchinari e attrezzature. Lo scarichi, lo modifichi, lo fai tuo.",
  nota: "È un dimensionamento di partenza, non un preventivo: rese e prezzi standard dei macchinari vanno validati e sostituiti con i tuoi. Una generazione per gara (una seconda solo se i documenti indicano una proroga dei termini).",
  punti: {
    singola: { titolo: "Per una gara", dettaglio: (prezzo: string) => `${prezzo} IVA inclusa, senza abbonamento` },
    abbonamento: { titolo: "Nell'abbonamento", dettaglio: (prezzoStarter: string) => `da ${prezzoStarter} al mese in più, per ogni gara inclusa nel piano` },
    formule: { titolo: "Formule attive", dettaglio: "modifichi i valori e tutti i fogli si aggiornano" },
  },
} as const;

// ───── la console ─────

// L'approvazione del legale: quale versione delle clausole e quando. Se la versione delle clausole cambia, questa riga è da aggiornare dopo la nuova approvazione.
export const APPROVAZIONE_LEGALE_PIANO_LAVORO = { data: "6 novembre 2026", versioneClausole: 1 } as const;

export const NOTA_CONSOLE_TESTI = `Testi del piano di lavoro approvati dal legale il ${APPROVAZIONE_LEGALE_PIANO_LAVORO.data} (clausole, versione ${APPROVAZIONE_LEGALE_PIANO_LAVORO.versioneClausole}). Se cambi anche una sola parola delle clausole serve una nuova versione e una nuova approvazione. Il Word con tutti i testi si crea con «npm run testi-legali:piano-lavoro».`;

// ───── la pagina delle condizioni ─────

export const CONDIZIONI_INTRO = [
  "Queste condizioni regolano il piano di lavoro di una gara: l'Excel con formule attive che OMNIA AI costruisce dai documenti di gara caricati dal cliente. Valgono sia quando il piano di lavoro si compra per la singola gara, sia quando è incluso nell'abbonamento con l'opzione «piano di lavoro».",
  "Si accettano al momento dell'acquisto. Di ogni accettazione si conservano la versione e l'impronta del testo qui sotto, la data e l'ora, l'indirizzo IP e il browser. Per tutto ciò che non è detto qui valgono le Condizioni generali di abbonamento.",
] as const;

// ───── le accettazioni nei moduli ─────

// Seconda casella del modulo d'acquisto della singola gara (la prima ha anche il collegamento alla Privacy policy).
export function testoApprovazioneSpecifica(numeri: number[], titoli: string[]): string {
  return `Dichiaro di approvare specificamente, ai sensi di legge, le clausole n. ${numeri.join(", ")} (${titoli.join("; ")}).`;
}

// L'unica casella dell'opzione nell'abbonamento e nell'aggiunta del piano di lavoro a un abbonamento già attivo.
export function testoAccettazioneCompleta(numeri: number[], titoli: string[]): string {
  return `Dichiaro di aver letto e accettato le avvertenze sul piano di lavoro e di approvare specificamente, ai sensi di legge, le clausole n. ${numeri.join(", ")} (${titoli.join("; ")}).`;
}

// ───── le note nella gara ─────

// Da dove viene il diritto a generare, detto al cliente (nessuna nota per le prove in locale).
export const NOTA_FONTE_DIRITTO = {
  abbonamento: "Incluso nel tuo abbonamento: è una gara del piano.",
  concessione: "Concesso da OMNIA AI: per questa gara non ha costi per te.",
  prova: "Incluso gratuitamente durante la prova.",
  acquisto: "Acquistato per questa gara.",
} as const;

// ───── la pagina dei piani ─────

// La riga sotto ogni piano: due parti, la prima (con il prezzo del supplemento) in evidenza.
export function partiRigaPianoLavoroPerPiano(supplementoFormattato: string): { evidenza: string; seguito: string } {
  return {
    evidenza: `Con il piano di lavoro Excel: +${supplementoFormattato} € al mese.`,
    seguito: "Per ogni gara inclusa nel piano un Excel con formule attive, costruito dai documenti di gara.",
  };
}

export function rigaPianoLavoroPerPiano(supplementoFormattato: string): string {
  const p = partiRigaPianoLavoroPerPiano(supplementoFormattato);
  return `${p.evidenza} ${p.seguito}`;
}

// ───── home, «Come funziona» e domande frequenti ─────
// Senza prezzi: queste pagine sono statiche, i prezzi stanno solo nella pagina dei piani (che li legge dalla console).

export const SITO_HOME_PIANO_LAVORO = {
  titolo: "Dai documenti di gara anche il piano di lavoro.",
  guida: "Oltre alla relazione tecnica, per le gare di servizi di pulizia OMNIA AI costruisce un Excel con formule attive: il punto di partenza per dimensionare il servizio.",
  punti: [
    "Monte ore per sede e per tipologia di ambiente",
    "Organico per livello contrattuale",
    "Quadratura con il monte ore dichiarato dal bando",
    "Macchinari e attrezzature, con prezzi standard di mercato da sostituire con quelli dei tuoi fornitori",
    "Formule attive: cambi un valore e tutti i fogli si aggiornano",
  ],
  nota: "È un dimensionamento di partenza, non un preventivo. Lo compri dentro la singola gara, quando ti serve.",
  collegamento: "Vedi i piani e il prezzo",
} as const;

export const SITO_FAQ_PIANO_LAVORO = {
  domanda: "Genera anche il piano di lavoro?",
  risposta:
    "Sì, per le gare di servizi di pulizia. Oltre alla relazione tecnica in Word, OMNIA AI può costruire un piano di lavoro in Excel con formule attive: monte ore per sede, organico per livello, quadratura con il monte ore dichiarato dal bando, macchinari e attrezzature. È un dimensionamento di partenza, non un preventivo: le rese sono ipotesi da validare e i prezzi dei macchinari sono standard di mercato, da sostituire con quelli dei tuoi fornitori. Lo compri dentro la singola gara: il prezzo è nella pagina dei piani.",
} as const;

export const SITO_COME_FUNZIONA_PIANO_LAVORO = {
  titolo: "E poi, il piano di lavoro",
  guida: "Per le gare di servizi di pulizia, dagli stessi documenti OMNIA AI costruisce anche un Excel con formule attive, da cui partire per dimensionare il servizio.",
  passi: [
    {
      titolo: "Legge superfici, frequenze e personale",
      testo: "Dai documenti ricava sedi, metrature per tipologia di ambiente, frequenze degli interventi, monte ore dichiarato e personale uscente. Per ogni dato indica la fonte; ciò che manca resta in evidenza, da compilare.",
    },
    {
      titolo: "Calcola con formule attive",
      testo: "Le rese sono ipotesi di settore da validare. Monte ore per sede, organico per livello e quadratura con il monte ore del bando si calcolano nel foglio, non nel testo: cambi un valore e tutto si aggiorna.",
    },
    {
      titolo: "Dimensiona macchinari e attrezzature",
      testo: "Propone le dotazioni necessarie con prezzi standard di mercato di marche professionali di riferimento, da sostituire con quelli dei tuoi fornitori.",
    },
    {
      titolo: "Lo scarichi e lo fai tuo",
      testo: "Un file Excel modificabile, una generazione per gara (una seconda se i documenti indicano una proroga dei termini).",
    },
  ],
  nota: "È un dimensionamento di partenza, non un preventivo.",
  collegamento: "Il prezzo nella pagina dei piani",
} as const;
