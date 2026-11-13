// Catalogo piani e crediti OMNIA AI: 3 piani + 2 pacchetti crediti, dati
// finali (non più segnaposto). Costante tipata, non una tabella DB — sono
// valori fissi, non serve un pannello admin editabile per così pochi
// piani. "Accesso multiutente" (Professional) non è elencato: non esiste
// ancora, non si vende qualcosa che non c'è. L'accesso API di Enterprise
// è elencato come "in arrivo": il piano è predisposto, la funzione no.

export type PianoSlug = "starter" | "professional" | "enterprise";

// I servizi extra della gara (copertina della relazione tecnica, servizi del settore come il piano di lavoro): con Starter in un riquadro in evidenza
// («acquistabili dall'area riservata»), con Professional come voci dell'elenco, compresi (e quindi con Enterprise, che ha «Tutto il piano Professional").
// Richiesta dell'utente del 13/11/2026: SOLO testo della pagina dei piani; chi può usarli lo decide la console, non questa costante.
export type ServiziPiano = { titolo: string; intro: string; punti: string[] };

export type Piano = {
  slug: PianoSlug;
  nome: string;
  prezzoCentesimi: number;
  gareIncluse: number;
  descrizione: string;
  voci: string[];
  servizi: ServiziPiano | null;
  // la nota con l'asterisco, sotto i servizi
  nota: string | null;
  inEvidenza: boolean;
};

const PUNTI_SERVIZI = [
  "Copertina della relazione tecnica in PDF e PNG: 6 proposte automatiche + 3 su misura, chiedendo le modifiche all'assistente in chat",
  "Servizi dedicati al tuo settore*",
];
export const NOTA_SERVIZI_SETTORE = "* Per esempio, per i servizi di pulizia: il piano di lavoro della gara in Excel.";

export const PIANI: Record<PianoSlug, Piano> = {
  starter: {
    slug: "starter",
    nome: "Starter",
    prezzoCentesimi: 69900,
    gareIncluse: 3,
    descrizione: "Per chi partecipa a poche gare e vuole provare il metodo.",
    voci: [
      "3 gare incluse ogni mese",
      "Generazione relazione tecnica in Word",
      "Estrazione automatica dei criteri di valutazione",
    ],
    servizi: {
      titolo: "Servizi extra, quando ti servono",
      intro: "Li acquisti in autonomia dalla tua area riservata:",
      punti: PUNTI_SERVIZI,
    },
    nota: NOTA_SERVIZI_SETTORE,
    inEvidenza: false,
  },
  professional: {
    slug: "professional",
    nome: "Professional",
    prezzoCentesimi: 149000,
    gareIncluse: 8,
    descrizione: "Per chi partecipa a gare con regolarità.",
    voci: [
      "8 gare incluse ogni mese",
      "Tutto il piano Starter",
      "Supporto prioritario",
      // i servizi extra compresi, in elenco dopo le voci di prima (scelta dell'utente del 13/11/2026: niente riquadro sul Professional)
      "Copertina della relazione tecnica compresa in ogni gara: PDF e PNG, 6 proposte automatiche + 3 su misura chiedendo le modifiche in chat",
      "Servizi dedicati al tuo settore* compresi in ogni gara",
    ],
    servizi: null,
    nota: NOTA_SERVIZI_SETTORE,
    inEvidenza: true,
  },
  enterprise: {
    slug: "enterprise",
    nome: "Enterprise",
    prezzoCentesimi: 290000,
    gareIncluse: 20,
    descrizione: "Per studi di consulenza e uffici gare con volumi alti.",
    voci: [
      "20 gare incluse ogni mese",
      "Tutto il piano Professional",
      "Revisione umana Omnia Consulting a condizioni dedicate",
      "Accesso API (in arrivo)",
    ],
    servizi: null,
    nota: null,
    inEvidenza: false,
  },
};

export const PIANI_ORDINE: PianoSlug[] = ["starter", "professional", "enterprise"];

// Riconosce un valore grezzo (dal DB, da un form, da Stripe) come uno dei
// piani noti, tollerando maiuscole/spazi — bug osservato in pratica:
// subscriptions.plan impostato da admin tramite un form di testo libero
// (nessuna validazione, solo un trim) come "Enterprise" invece di
// "enterprise": il confronto/lookup con PIANI è case-sensitive, quindi il
// piano non veniva riconosciuto e il cliente vedeva "0/0 gare disponibili"
// nonostante l'abbonamento fosse attivo. Va usata ovunque si legga
// subscription.plan per un confronto/lookup, non solo dove si è già
// manifestato il problema.
export function normalizzaPianoSlug(valore: string | null | undefined): PianoSlug | null {
  const pulito = (valore ?? "").trim().toLowerCase();
  return pulito in PIANI ? (pulito as PianoSlug) : null;
}

export type PacchettoCreditiSlug = "singola" | "pacchetto5";

export type PacchettoCrediti = {
  slug: PacchettoCreditiSlug;
  nome: string;
  prezzoCentesimi: number;
  crediti: number;
};

export const PACCHETTI_CREDITI: Record<PacchettoCreditiSlug, PacchettoCrediti> = {
  singola: {
    slug: "singola",
    nome: "Credito singolo",
    prezzoCentesimi: 29000,
    crediti: 1,
  },
  pacchetto5: {
    slug: "pacchetto5",
    nome: "Pacchetto 5 gare",
    prezzoCentesimi: 125000,
    crediti: 5,
  },
};

function formatNumeroEuro(centesimi: number): string {
  return (centesimi / 100).toLocaleString("it-IT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    // "auto" (il default) non raggruppa le migliaia quando sono anche
    // impostati min/maxFractionDigits (verificato: 1490 -> "1490,00"
    // invece di "1.490,00") — va forzato esplicitamente.
    useGrouping: true,
  });
}

export function formatEuro(centesimi: number): string {
  return formatNumeroEuro(centesimi) + " €";
}

// Solo la cifra, senza simbolo: per le schede piano, dove il simbolo va
// reso a parte con un font e un corpo diversi dalla cifra (la forma del
// simbolo € in Syne è troppo larga e sbilanciata rispetto ai numeri).
export function formatEuroCifra(centesimi: number): string {
  return formatNumeroEuro(centesimi);
}
