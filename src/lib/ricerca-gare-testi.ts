// Testi pubblici di «Ricerca gare» su omnia-ai.it (25/11/2026). Decisioni dell'utente: nome pubblico «Ricerca gare»; compresa in TUTTI e tre
// i piani (Starter, Professional, Enterprise); pagina dedicata, rimando dalla home e riga nella tabella dei piani. L'apertura ai clienti la fa
// l'utente dalla console, abbonato per abbonato: questi sono solo testi.
// Ogni frase descrive una funzione che c'è nell'area riservata (Opportunità) e la prova scripts/verifica-testi-ricerca-gare.ts la confronta
// con il codice: filtri di «Cerca», «Per te», salvate e monitorate, avvisi email, gara aggiunta con il CIG, Ufficio Gare, fonti, settori.
import { SETTORI_RADAR } from "@/lib/radar/settori";

export const PERCORSO_RICERCA_GARE = "/ricerca-gare";

export const SITO_RICERCA_GARE = {
  occhiello: "Ricerca gare",
  titolo: "Le gare dei tuoi servizi, da quattro fonti ufficiali, in un unico posto",
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
  fonti: [
    "TED, Gazzetta ufficiale dell'Unione europea",
    "ANAC, Piattaforma di pubblicità a valore legale",
    "Sintel, piattaforma di e-procurement della Regione Lombardia",
    "SardegnaCAT, piattaforma di e-procurement della Regione Sardegna",
  ],
  aggiornamento: "Le leggiamo più volte al giorno; TED nei giorni feriali.",
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
      testo: "Fonti e settori sono quelli elencati qui: una gara pubblicata solo altrove, o di un altro settore, può non comparire.",
    },
  ],
  chiusuraTitolo: "Compresa in tutti i piani",
  chiusuraTesto: "La ricerca gare è compresa in Starter, Professional ed Enterprise, insieme alla preparazione dell'offerta tecnica.",
} as const;

/** La sezione della home che rimanda alla pagina. */
export const SITO_HOME_RICERCA_GARE = {
  occhiello: "Ricerca gare",
  titolo: "Le gare dei tuoi servizi, in un unico posto",
  guida: "Bandi e avvisi da TED, ANAC, Sintel e SardegnaCAT per i servizi di facility management: li cerchi, li salvi e ricevi gli avvisi email sulle scadenze. Compresa in tutti i piani.",
  collegamento: "Scopri la ricerca gare",
  punti: [
    "Ricerca per oggetto, ente, codice fiscale o CIG, con filtri per settore, regione e importo",
    "«Per te»: le gare aperte in linea con il profilo dell'impresa",
    "Promemoria email a 10, 5 e 1 giorno dalla scadenza",
    "Anche per il tuo Ufficio Gare",
  ],
} as const;

/** La riga della tabella dei piani. */
export const RIGA_PIANI_RICERCA_GARE = { voce: "Ricerca gare", valori: { starter: "Compresa", professional: "Compresa", enterprise: "Compresa" } } as const;
