// La sezione della pagina dei piani «scopri cosa puoi elaborare in una gara oltre alla relazione tecnica» (richiesta dell'utente, 09/11/2026): il
// visitatore sceglie a quale categoria appartiene da un menu a tendina e vede, per quella categoria, il servizio aggiuntivo che OMNIA AI propone
// DENTRO la gara. Questi servizi non si comprano con l'abbonamento: solo nella singola gara. Modulo senza dipendenze di server (lo usa un
// componente client); i testi del piano di lavoro e di OMNIA FOOD MENU stanno in piano-lavoro-testi.ts e gara-settore.ts, uno solo per posto.
// Test: scripts/verifica-servizi-settore-omnia-ai.ts.

// «disponibile»: il servizio c'è (piano di lavoro); «in_arrivo»: ha un nome e una descrizione ma non è ancora disponibile (OMNIA FOOD MENU);
// «in_lavorazione»: la categoria è in programma, senza altro da dire («Stiamo lavorando»).
export type StatoCategoria = "disponibile" | "in_arrivo" | "in_lavorazione";
export type CategoriaServizio = { valore: string; etichetta: string; stato: StatoCategoria };

// Le due categorie del menu che hanno qualcosa da mostrare oggi sono le prime due: i valori coincidono con i settori che l'analisi dei documenti
// assegna alle gare (src/lib/gara-settore.ts). Le altre sono categorie in programma: per esse la pagina dice solo «Stiamo lavorando». L'elenco è un
// dato: aggiungere o togliere una categoria è una riga.
export const CATEGORIE_SERVIZI: readonly CategoriaServizio[] = [
  { valore: "pulizie", etichetta: "Servizi di pulizia", stato: "disponibile" },
  { valore: "ristorazione_collettiva", etichetta: "Ristorazione collettiva", stato: "in_arrivo" },
  { valore: "verde", etichetta: "Manutenzione del verde", stato: "in_lavorazione" },
  { valore: "vigilanza_portierato", etichetta: "Vigilanza e portierato", stato: "in_lavorazione" },
  { valore: "manutenzione_edifici_impianti", etichetta: "Manutenzione di edifici e impianti", stato: "in_lavorazione" },
  { valore: "trasporti_logistica", etichetta: "Trasporti e logistica", stato: "in_lavorazione" },
  { valore: "servizi_socio_assistenziali", etichetta: "Servizi socio-assistenziali", stato: "in_lavorazione" },
  { valore: "altri_servizi", etichetta: "Altri servizi", stato: "in_lavorazione" },
];

// Quello che si legge accanto al nome della categoria nel menu a tendina.
export const SUFFISSO_STATO_NEL_MENU: Record<StatoCategoria, string> = {
  disponibile: "",
  in_arrivo: " — sta arrivando",
  in_lavorazione: " — stiamo lavorando",
};

export function etichettaNelMenu(categoria: CategoriaServizio): string {
  return `${categoria.etichetta}${SUFFISSO_STATO_NEL_MENU[categoria.stato]}`;
}

export const SEZIONE_SERVIZI = {
  etichetta: "Oltre alla relazione tecnica",
  titolo: "Inserisci a quale categoria appartieni e scopri cosa puoi elaborare all'interno di una gara, oltre alla relazione tecnica.",
  etichettaMenu: "La tua categoria",
  segnaposto: "Seleziona una categoria…",
} as const;

export const IN_LAVORAZIONE = {
  stato: "Stiamo lavorando",
  titolo: "Per questa categoria stiamo lavorando.",
  testo:
    "I servizi che OMNIA AI potrà elaborare dentro una gara di questa categoria, oltre alla relazione tecnica, non sono ancora disponibili. La relazione tecnica, invece, OMNIA AI la genera per ogni gara, di qualunque categoria.",
} as const;
