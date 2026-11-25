// Testi pubblici di «Ricerca gare» su omnia-ai.it (25/11/2026). Decisioni dell'utente: nome pubblico «Ricerca gare»; compresa in TUTTI e tre
// i piani (Starter, Professional, Enterprise); pagina dedicata, rimando dalla home e riga nella tabella dei piani. L'apertura ai clienti la fa
// l'utente dalla console, abbonato per abbonato: questi sono solo testi.
// Ogni frase descrive una funzione che c'è nell'area riservata (Opportunità) e la prova scripts/verifica-testi-ricerca-gare.ts la confronta
// con il codice: filtri di «Cerca», «Per te», salvate e monitorate, avvisi email, gara aggiunta con il CIG, Ufficio Gare, settori.
// FONTI: mai nominate e mai contate nelle parti pubbliche (decisione dell'utente del 25/11: le fonti crescono e cambiano). Solo la frase
// generica qui sotto; la prova fallisce se una pagina pubblica nomina una fonte o un numero di fonti. Nell'area riservata la fonte di ogni
// gara resta indicata.
import { SETTORI_RADAR } from "@/lib/radar/settori";

export const PERCORSO_RICERCA_GARE = "/ricerca-gare";

export const SITO_RICERCA_GARE = {
  occhiello: "Ricerca gare",
  titolo: "Le gare dei tuoi servizi, da molte fonti ufficiali, in un unico posto",
  sotto:
    "Bandi, manifestazioni di interesse e avvisi per i servizi di facility management, aggiornati più volte al giorno e da cercare con i filtri che usi davvero. Compresa in tutti i piani.",
  funzioniTitolo: "Cosa puoi fare",
  funzioni: [
    {
      titolo: "Cerchi come lavori",
      testo:
        "Per oggetto, ente, codice fiscale dell'ente o CIG. Poi restringi per settore, tipo di avviso, regione, importo stimato, scadenza, data di pubblicazione e tipo di procedura; scegli tra gare aperte e storico e ordini per rilevanza, più recenti, scadenza più vicina o importo più alto.",
    },
    {
      titolo: "Bandi, candidature e iscrizioni",
      testo:
        "Il tipo di avviso distingue i bandi di gara, le candidature (manifestazioni di interesse, indagini di mercato, avvisi di preinformazione) e le iscrizioni a elenchi, sistemi di qualificazione e SDA.",
    },
    {
      titolo: "«Per te»: le gare in linea con il profilo",
      testo:
        "Indichi una volta settori, regioni e fascia di importo dell'impresa: «Per te» mostra le gare aperte in linea con il profilo e per ognuna dice perché compare, da quale fonte viene e quando è stata aggiornata.",
    },
    {
      titolo: "Salvi e monitori",
      testo:
        "Le gare che ti interessano finiscono in un elenco ordinato per scadenza, con le novità rilevate nelle fonti (rettifiche, proroghe, annullamenti, esiti) finché non apri la scheda.",
    },
    {
      titolo: "Avvisi email",
      testo:
        "Promemoria a 10, 5 e 1 giorno dalla scadenza delle gare salvate o monitorate, avvisi su rettifiche, proroghe, cambi di scadenza e annullamenti, e un riepilogo delle nuove gare in linea con il profilo. Il titolare li attiva e sceglie le categorie per ogni persona.",
    },
    {
      titolo: "Una gara che non trovi? La aggiungi con il CIG",
      testo:
        "Se la gara è già in archivio si apre quella; altrimenti resta riservata alla tua impresa e si collega da sola quando il CIG compare in una delle fonti.",
    },
    {
      titolo: "Con il tuo Ufficio Gare",
      testo:
        "Anche la persona del tuo Ufficio Gare usa la ricerca con il proprio accesso; nell'elenco delle gare seguite vedi chi le ha salvate, tu o l'Ufficio Gare.",
    },
  ],
  fontiTitolo: "Le fonti",
  fontiTesto: "Raccogliamo bandi e avvisi da fonti ufficiali nazionali, europee e regionali, aggiornate più volte al giorno; le fonti crescono nel tempo.",
  settoriTitolo: "I settori",
  settori: SETTORI_RADAR.map((s) => s.nome),
  limitiTitolo: "Cosa è e cosa non è",
  limiti: [
    {
      titolo: "Un servizio informativo",
      testo: "Ti aiuta a trovare e seguire le gare. Prima di partecipare verifica sempre i documenti ufficiali sulla piattaforma della stazione appaltante.",
    },
    {
      titolo: "Classificazione, non verifica dei requisiti",
      testo: "Indica se una gara riguarda i tuoi settori; non dice se la tua impresa ha i requisiti per partecipare.",
    },
    {
      titolo: "Copertura dichiarata",
      testo: "Una gara pubblicata solo su fonti che non consultiamo, o di un altro settore, può non comparire.",
    },
  ],
  chiusuraTitolo: "Compresa in tutti i piani",
  chiusuraTesto: "La ricerca gare è compresa in Starter, Professional ed Enterprise, insieme alla preparazione dell'offerta tecnica.",
} as const;

/** La sezione della home che rimanda alla pagina. */
export const SITO_HOME_RICERCA_GARE = {
  occhiello: "Ricerca gare",
  titolo: "Le gare dei tuoi servizi, in un unico posto",
  guida: "Bandi e avvisi da molte fonti ufficiali per i servizi di facility management: li cerchi, li salvi e ricevi gli avvisi email sulle scadenze. Compresa in tutti i piani.",
  collegamento: "Scopri la ricerca gare",
  punti: [
    "Ricerca per oggetto, ente, codice fiscale o CIG, con filtri per settore, regione e importo",
    "«Per te»: le gare aperte in linea con il profilo dell'impresa",
    "Promemoria email a 10, 5 e 1 giorno dalla scadenza",
    "Anche per il tuo Ufficio Gare",
  ],
} as const;

/** La riga della tabella dei piani. */
/** I metadati della pagina (description per i motori di ricerca e le anteprime). */
export const DESCRIZIONE_RICERCA_GARE =
  "Ricerca gare d'appalto per i servizi di facility management: bandi e avvisi da molte fonti ufficiali, filtri per settore, regione e importo, gare in linea con il profilo e avvisi email. Compresa in tutti i piani.";

/** La nota sotto la tabella dei piani, prima del collegamento «Come funziona». */
export const NOTA_PIANI_RICERCA_GARE = "Ricerca gare: bandi e avvisi da molte fonti ufficiali, con i filtri, le gare in linea con il profilo e gli avvisi email.";

/** La voce del menu in alto e del piè di pagina, subito dopo «Come funziona». */
export const VOCE_MENU_RICERCA_GARE = { href: PERCORSO_RICERCA_GARE, label: "Ricerca gare" } as const;

export const RIGA_PIANI_RICERCA_GARE = { voce: "Ricerca gare", valori: { starter: "Compresa", professional: "Compresa", enterprise: "Compresa" } } as const;
