// Catalogo piani e crediti OMNIA AI: 3 piani + 2 pacchetti crediti, dati
// finali (non più segnaposto). Costante tipata, non una tabella DB — sono
// valori fissi, non serve un pannello admin editabile per così pochi
// piani. "Accesso multiutente" (Professional) non è elencato: non esiste
// ancora, non si vende qualcosa che non c'è. L'accesso API di Enterprise
// è elencato come "in arrivo": il piano è predisposto, la funzione no.

export type PianoSlug = "starter" | "professional" | "enterprise";

export type Piano = {
  slug: PianoSlug;
  nome: string;
  prezzoCentesimi: number;
  gareIncluse: number;
  descrizione: string;
  voci: string[];
  inEvidenza: boolean;
};

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
      "Intestazioni e piè di pagina con il tuo logo",
      "Supporto prioritario",
    ],
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
    inEvidenza: false,
  },
};

export const PIANI_ORDINE: PianoSlug[] = ["starter", "professional", "enterprise"];

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
