// Voci della barra laterale, nell'ordine di priorità del lavoro. `pronto: false`
// = sezione prevista ma non ancora costruita: appare spenta, con "presto", e
// non è un link. Ogni blocco che la realizza porta la voce a `pronto: true`.

export type VoceNavigazione = { href: string; etichetta: string; pronto: boolean };
export type GruppoNavigazione = { titolo: string | null; voci: VoceNavigazione[] };

export const NAVIGAZIONE: GruppoNavigazione[] = [
  {
    titolo: null,
    voci: [{ href: "/", etichetta: "Panoramica", pronto: true }],
  },
  {
    titolo: "Da fare",
    voci: [
      { href: "/bonifici", etichetta: "Bonifici", pronto: true },
      { href: "/fatturazione", etichetta: "Da fatturare", pronto: true },
    ],
  },
  {
    titolo: "Numeri",
    voci: [
      { href: "/costi", etichetta: "Costi e margini", pronto: true },
      { href: "/ricavi", etichetta: "Ricavi", pronto: true },
      { href: "/abbonamenti", etichetta: "Abbonamenti", pronto: true },
      { href: "/crediti", etichetta: "Crediti", pronto: true },
    ],
  },
  {
    titolo: "Anagrafiche",
    voci: [
      { href: "/ordini", etichetta: "Ordini", pronto: true },
      { href: "/utenti", etichetta: "Utenti", pronto: false },
      { href: "/prodotti", etichetta: "Prodotti e sconti", pronto: false },
    ],
  },
  {
    titolo: "Sistema",
    voci: [
      { href: "/knowledge-base", etichetta: "Knowledge base AI", pronto: false },
      { href: "/impostazioni", etichetta: "Impostazioni", pronto: false },
    ],
  },
];
