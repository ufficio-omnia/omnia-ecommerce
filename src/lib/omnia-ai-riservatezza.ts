// Testo della pagina pubblica «Riservatezza e trattamento dei dati» di omnia-ai.it.
//
// Non è un documento legale da versionare: è una pagina informativa che dice, in parole
// semplici, ciò che le condizioni di abbonamento (art. 10) e l'Allegato A (atto di nomina a
// responsabile) stabiliscono formalmente. Per questo il testo sta qui come dato e non in
// un componente: scripts/verifica-riservatezza-omnia-ai.ts lo confronta con i due
// documenti e con il codice, così una frase della pagina non può promettere più di quanto
// il contratto o il sistema garantiscono.
//
// Due frasi del testo originale sono state corrette (concordato con l'utente) perché
// affermavano più di quanto il sistema fa:
//  - l'isolamento dei clienti non è «applicato dalla base dati stessa, non
//    dall'applicazione»: le regole esistono a livello di base dati, ma parti
//    dell'applicazione usano la chiave di servizio con controlli propri → «applicate
//    anche a livello di base dati» (stessa formula dell'Allegato A, art. 5);
//  - nominativi, codici fiscali e matricole «non vengono estratti né conservati» era falso
//    per il documento caricato, che resta conservato com'è: la garanzia vera è che non
//    finiscono nei dati strutturati ricavati dall'elenco del personale.

export const RISERVATEZZA_TITOLO = "Riservatezza e trattamento dei dati";

export const RISERVATEZZA_PERCORSO = "/riservatezza";

export const RISERVATEZZA_DESCRIZIONE =
  "Come OMNIA AI tratta i documenti di gara: dove sono conservati, chi può vederli, nessun addestramento dei modelli, durata di conservazione e nomina a responsabile.";

export const RISERVATEZZA_INTRO =
  "I documenti di gara sono il materiale più delicato che un'impresa possa affidare a un fornitore. Ecco esattamente come li trattiamo.";

export type SezioneRiservatezza = { id: string; titolo: string; paragrafi: string[] };

export const SEZIONI_RISERVATEZZA: SezioneRiservatezza[] = [
  {
    id: "dove-stanno",
    titolo: "Dove stanno i tuoi documenti",
    paragrafi: [
      "I documenti che carichi e i contenuti generati sono conservati su infrastruttura con collocazione nell'Unione Europea. Ogni cliente dispone di uno spazio logicamente separato, con regole di isolamento applicate anche a livello di base dati.",
      "I file non sono raggiungibili da indirizzi pubblici. Il download avviene tramite collegamenti temporanei generati dal server solo dopo aver verificato che chi li richiede ne abbia titolo.",
    ],
  },
  {
    id: "chi-puo-vederli",
    titolo: "Chi può vederli",
    paragrafi: [
      "Nel normale funzionamento, nessuno. L'elaborazione è automatica e i contenuti sono accessibili unicamente dal tuo account.",
      "L'accesso di personale autorizzato è previsto solo in quattro casi: assistenza tecnica che hai richiesto tu, revisione umana che hai acquistato tu, manutenzione o sicurezza non altrimenti risolvibili, obbligo di legge. Ogni accesso è registrato e puoi chiederne l'estratto.",
    ],
  },
  {
    id: "addestramento",
    titolo: "Addestramento dei modelli",
    paragrafi: [
      "I tuoi documenti e i contenuti generati non vengono utilizzati per addestrare modelli, né nostri né di terzi.",
      "I fornitori dei modelli che utilizziamo non impiegano i contenuti trasmessi tramite interfaccia applicativa per l'addestramento dei propri sistemi: è una condizione contrattuale dei rispettivi servizi, non una nostra dichiarazione, e come tale verificabile.",
    ],
  },
  {
    id: "base-di-conoscenza",
    titolo: "La base di conoscenza",
    paragrafi: [
      "OMNIA AI si avvale di una base di conoscenza costituita da documentazione di proprietà di Omnia Consulting, frutto di anni di offerte tecniche redatte a mano.",
      "I contenuti dei clienti non entrano mai nella base di conoscenza, nemmeno in forma anonima, aggregata o rielaborata. Le tue relazioni non alimentano il sistema e non possono comparire, in alcuna forma, nei contenuti generati per altri clienti.",
    ],
  },
  {
    id: "dati-del-personale",
    titolo: "I dati del personale",
    paragrafi: [
      "Dagli elenchi del personale uscente ricaviamo, per dimensionare l'offerta, esclusivamente livello contrattuale, ore, anzianità e qualifiche. Nominativi, codici fiscali e matricole non vengono riportati in questi dati.",
      "Il documento che hai caricato resta conservato così com'è, con tutto ciò che contiene, per il tempo indicato qui sotto, e vale per lui quanto detto sopra su chi può vederlo.",
    ],
  },
  {
    id: "conservazione",
    titolo: "Per quanto tempo restano",
    paragrafi: [
      "Per tutta la durata dell'abbonamento e per trenta giorni dalla cessazione, periodo entro il quale puoi scaricare tutto. Poi vengono cancellati in modo irreversibile, comprese le copie negli indici semantici.",
      "Puoi cancellare una gara e i suoi documenti in qualsiasi momento dall'area riservata, senza chiedere nulla a nessuno.",
    ],
  },
  {
    id: "nomina-responsabile",
    titolo: "Nomina a responsabile del trattamento",
    paragrafi: [
      "Per i dati personali contenuti nei documenti che carichi, tu sei titolare del trattamento e noi siamo nominati responsabili ai sensi dell'art. 28 del Regolamento UE 2016/679.",
      "L'atto di nomina è l'Allegato A delle condizioni di abbonamento: contiene l'elenco completo dei sottoresponsabili con sede e garanzie, le misure di sicurezza adottate, i tempi di notifica in caso di violazione e il tuo diritto di verifica. Lo trovi collegato al momento dell'attivazione e scaricabile in qualsiasi momento dalla tua area riservata, compilato con i tuoi dati.",
    ],
  },
];

export const RISERVATEZZA_DOCUMENTI_TITOLO = "Documenti collegati";

// Nomi dei documenti collegati, nell'ordine in cui compaiono in pagina. Gli indirizzi li
// risolve la pagina (versione vigente letta dal database).
export const RISERVATEZZA_DOCUMENTI = {
  privacy: "Privacy policy",
  cookie: "Cookie policy",
  condizioni: "Condizioni generali di abbonamento",
  allegato: "Allegato A, atto di nomina a responsabile del trattamento",
} as const;
