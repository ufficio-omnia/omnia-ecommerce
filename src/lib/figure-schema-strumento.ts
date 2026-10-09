import { LIMITI_FIGURE, UNITA_TEMPO, STATI_RIGA } from "@/lib/figure-dati";

// Schema dello strumento (campo "figure" di genera_bozza_sezione): solo ciò che
// il modello può e deve dichiarare per ogni figura schematica. Niente colori,
// coordinate, dimensioni o numero della figura; niente piattaforma del
// cruscotto, né il valore «Rilevato» (lo gestisce il codice). Le descrizioni
// insegnano ogni archetipo: è l'unico punto in cui il modello le legge.
const stringa = (descrizione: string) => ({ type: "string" as const, description: descrizione });
const numero = (descrizione: string) => ({ type: "number" as const, description: descrizione });
const SEMANTICO = {
  type: "string" as const,
  enum: ["AMBIENTE", "SICUREZZA", "CAPITOLATO"],
  description:
    "Facoltativo. AMBIENTE (verde) solo per ciò che riguarda l'ambiente/CAM; SICUREZZA (arancio) solo per sicurezza, emergenze, rischio biologico; CAPITOLATO (blu) per un impegno richiesto dal capitolato. Se non è uno di questi, OMETTI il campo: il colore neutro è la regola, quelli semantici sono l'eccezione.",
};
const T = LIMITI_FIGURE;

const RAMO = {
  type: "object" as const,
  properties: {
    titolo: stringa("Nome breve del ramo (al massimo 5-6 parole)."),
    dettaglio: stringa("Una riga facoltativa di dettaglio."),
    etichetta: stringa("Etichetta facoltativa sulla freccia che porta al ramo (es. 'sì', 'no', 'prima', 'dopo')."),
    semantico: SEMANTICO,
  },
  required: ["titolo"],
};

const FLUSSO = {
  type: "object" as const,
  description:
    `Flusso di processo: una SEQUENZA di stadi (al massimo ${T.stadiFlusso}) letti da sinistra a destra, che vanno a capo da soli. Ogni stadio è un 'passo', oppure 'alternative' (UNA sola strada si attiva: rami che partono dallo stesso punto e si riuniscono dopo), oppure 'paralleli' (TUTTI i rami si attivano), oppure una 'banda' a piena larghezza per un principio che vale lungo il flusso. Un passo può avere un ramo laterale (es. 'se sì: decontaminazione preliminare') e un responsabile.`,
  properties: {
    stadi: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          tipo: { type: "string" as const, enum: ["passo", "alternative", "paralleli", "banda"], description: "Tipo dello stadio." },
          titolo: stringa("Titolo breve (passo o banda). Per 'alternative'/'paralleli' non serve."),
          dettaglio: stringa("Una riga di dettaglio facoltativa (passo o banda)."),
          responsabile: stringa("Ruolo che esegue il passo, facoltativo, breve (es. 'Caposquadra')."),
          semantico: SEMANTICO,
          ramo_laterale: {
            type: "object" as const,
            description: "Facoltativo: ramo che si stacca dal passo (es. una verifica che, se sì, porta a un'azione).",
            properties: { titolo: stringa("Nome breve del ramo."), etichetta: stringa("Es. 'sì'."), semantico: SEMANTICO },
            required: ["titolo"],
          },
          rami: { type: "array" as const, items: RAMO, description: `Solo per 'alternative' e 'paralleli': da 2 a ${T.ramiPerStadio} rami.` },
        },
        required: ["tipo"],
      },
    },
    ritorno: {
      type: "object" as const,
      description: "Facoltativo: un ritorno a monte (es. 'se la correzione non è efficace il ciclo riparte'). da/a sono i numeri degli stadi (1 = il primo) e 'a' deve essere PRIMA di 'da'.",
      properties: { da: numero("Numero dello stadio da cui parte il ritorno."), a: numero("Numero dello stadio a cui torna."), etichetta: stringa("Es. 'non efficace'.") },
      required: ["da", "a"],
    },
    numerato: { type: "boolean" as const, description: "true se i passi sono una sequenza numerata (1, 2, 3…): il numero lo disegna il generatore." },
    nota: stringa("Nota breve facoltativa sotto il flusso."),
  },
  required: ["stadi"],
};

const LIVELLI = {
  type: "object" as const,
  description:
    `Schema a livelli di controllo: caselle impilate dal livello 1 (operativo, il PRIMO dell'elenco) al più alto (l'ULTIMO), da ${2} a ${T.livelli}. Accanto, facoltativo, un pannello con un elenco o un flusso (es. la gestione delle non conformità) alimentato dai livelli; sotto, facoltativa, una banda con il principio che li tiene insieme.`,
  properties: {
    livelli: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          titolo: stringa("Nome del livello (es. 'Controllo di qualità')."),
          responsabile: stringa("Ruolo che lo esegue (es. 'Capo squadra'), breve."),
          descrizione: stringa("Cosa fa questo livello, una riga o due."),
        },
        required: ["titolo"],
      },
    },
    pannello: {
      type: "object" as const,
      properties: {
        titolo: stringa("Titolo del pannello (es. 'Gestione delle non conformità')."),
        forma: { type: "string" as const, enum: ["elenco", "flusso"], description: "'elenco' di voci brevi oppure 'flusso' (stessa struttura del flusso di processo)." },
        voci: { type: "array" as const, items: { type: "string" as const }, description: `Per forma 'elenco': da 2 a ${T.vociPannello} voci brevi.` },
        flusso: FLUSSO,
        collega_livelli: { type: "boolean" as const, description: "true se i livelli alimentano il pannello (frecce dai livelli al pannello). Per l'elenco è il predefinito." },
      },
      required: ["titolo", "forma"],
    },
    banda: {
      type: "object" as const,
      properties: { titolo: stringa("Il principio, breve."), descrizione: stringa("Una riga facoltativa.") },
      required: ["titolo"],
    },
  },
  required: ["livelli"],
};

const CRONOPROGRAMMA = {
  type: "object" as const,
  description:
    `Cronoprogramma: asse del tempo in alto, una riga per attività con barre colorate. L'unità può essere minuti, ore, giorni, settimane o mesi; le posizioni sono numeri sull'asse (da 0 alla durata). Al massimo ${T.righeCronoprogramma} righe.`,
  properties: {
    unita: { type: "string" as const, enum: [...UNITA_TEMPO], description: "Unità dell'asse del tempo." },
    durata: numero("Durata totale nell'unità scelta (es. 30 se sono 30 minuti). Il generatore la allarga se una barra la supera."),
    traguardi: {
      type: "array" as const,
      description: `Traguardi in testa al grafico, al massimo ${T.traguardi}: una linea verticale attraverso tutte le righe.`,
      items: {
        type: "object" as const,
        properties: {
          posizione: numero("Posizione sull'asse."),
          titolo: stringa("Nome breve del traguardo."),
          dettaglio: stringa("Una riga facoltativa."),
          finale: { type: "boolean" as const, description: "true per il traguardo di chiusura, evidenziato." },
        },
        required: ["posizione", "titolo"],
      },
    },
    righe: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          titolo: stringa("Attività."),
          responsabile: stringa("Ruolo responsabile, breve."),
          fase: stringa("Nome della fase di raggruppamento: le righe consecutive con la stessa fase stanno sotto una fascia con quel nome."),
          barre: {
            type: "array" as const,
            description: `Barre della riga (al massimo ${T.barrePerRiga}).`,
            items: {
              type: "object" as const,
              properties: {
                da: numero("Inizio sull'asse."),
                a: numero("Fine sull'asse."),
                etichetta: stringa("Testo breve sulla barra, facoltativo."),
                semantico: SEMANTICO,
              },
              required: ["da", "a"],
            },
          },
          pietre: {
            type: "array" as const,
            description: "Pietre miliari della riga (losanghe).",
            items: { type: "object" as const, properties: { posizione: numero("Posizione sull'asse."), etichetta: stringa("Testo breve.") }, required: ["posizione"] },
          },
        },
        required: ["titolo"],
      },
    },
    banda: { type: "object" as const, properties: { titolo: stringa("Titolo."), descrizione: stringa("Facoltativa.") }, required: ["titolo"] },
    nota: stringa("Nota breve facoltativa."),
  },
  required: ["unita", "righe"],
};

const CRUSCOTTO = {
  type: "object" as const,
  description:
    "Schermata ILLUSTRATIVA di un cruscotto della piattaforma gestionale dell'impresa. Dichiarabile SOLO se il profilo azienda indica una piattaforma con una funzione di cruscotto/indicatori/reportistica: il generatore altrimenti non la disegna. Mostra SOLO gli OBIETTIVI che vengono dai documenti di gara (capitolato, disciplinare) o dal profilo: il valore «Rilevato» è sempre un trattino, lo imposta il generatore; NON scrivere valori misurati né dati inventati. La striscia «Dati di esempio — schermata illustrativa» è sempre aggiunta dal generatore. Il nome della piattaforma lo mette il generatore dal profilo.",
  properties: {
    profilo: stringa("Il profilo utente della schermata (es. 'Responsabile di commessa', 'Referente del committente')."),
    indicatori: {
      type: "array" as const,
      description: `Tessere in alto (al massimo ${T.indicatori}): gli indicatori più importanti con il loro obiettivo.`,
      items: { type: "object" as const, properties: { etichetta: stringa("Nome dell'indicatore."), obiettivo: stringa("Obiettivo come scritto nei documenti (es. '≤ 30 min').") }, required: ["etichetta", "obiettivo"] },
    },
    righe: {
      type: "array" as const,
      description: `Righe della tabella (da 2 a ${T.righeCruscotto}).`,
      items: {
        type: "object" as const,
        properties: {
          indicatore: stringa("Nome dell'indicatore."),
          obiettivo: stringa("Obiettivo."),
          stato: { type: "string" as const, enum: [...STATI_RIGA], description: "Facoltativo: stato illustrativo del semaforo (conforme/attenzione/scostamento). Ometti se non serve." },
        },
        required: ["indicatore", "obiettivo"],
      },
    },
    laterale: {
      type: "object" as const,
      description: "Facoltativo: elenco laterale delle aree o sedi monitorate (barre vuote).",
      properties: { titolo: stringa("Titolo."), voci: { type: "array" as const, items: { type: "string" as const }, description: `Da 2 a ${T.vociLaterale} voci.` } },
      required: ["titolo", "voci"],
    },
  },
  required: ["profilo", "righe"],
};

const RETE = {
  type: "object" as const,
  description:
    `Rete/hub: un CENTRO (piattaforma, magazzino, centrale operativa) collegato a più NODI (sedi, presìdi, depositi), da 2 a ${T.nodiRete}. Con 'origini' (es. un magazzino centrale che rifornisce) la disposizione è a colonne origini → nodi ↔ centro; senza, il centro sta in mezzo e i nodi ai lati. Facoltative una fascia di profili di accesso e una banda finale.`,
  properties: {
    centro: {
      type: "object" as const,
      properties: {
        titolo: stringa("Nome del centro."),
        sottotitolo: stringa("Una riga facoltativa."),
        voci: { type: "array" as const, items: { type: "string" as const }, description: `Funzioni del centro, brevi (al massimo ${T.vociCentro}).` },
      },
      required: ["titolo"],
    },
    nodi: {
      type: "array" as const,
      items: { type: "object" as const, properties: { titolo: stringa("Nome del nodo."), dettaglio: stringa("Una riga facoltativa."), semantico: SEMANTICO }, required: ["titolo"] },
    },
    origini: {
      type: "array" as const,
      description: `Facoltativo: origini che alimentano i nodi (al massimo ${T.originiRete}).`,
      items: {
        type: "object" as const,
        properties: { titolo: stringa("Nome."), dettaglio: stringa("Una riga facoltativa."), voci: { type: "array" as const, items: { type: "string" as const }, description: "Voci brevi (al massimo 5)." }, semantico: SEMANTICO },
        required: ["titolo"],
      },
    },
    chip: {
      type: "object" as const,
      description: "Facoltativo: profili di accesso al centro (es. Operatore, Capo squadra, Referente).",
      properties: { titolo: stringa("Titolo della fascia."), voci: { type: "array" as const, items: { type: "string" as const }, description: `Al massimo ${T.chip}.` } },
      required: ["titolo", "voci"],
    },
    banda: { type: "object" as const, properties: { titolo: stringa("Titolo."), dettaglio: stringa("Facoltativa.") }, required: ["titolo"] },
    collegamento: { type: "string" as const, enum: ["bidirezionale", "verso_centro", "da_centro"], description: "Direzione delle frecce fra nodi e centro. Predefinito: bidirezionale." },
    nota: stringa("Nota breve facoltativa."),
  },
  required: ["centro", "nodi"],
};

export const SCHEMA_FIGURE_STRUMENTO = {
  type: "array" as const,
  description:
    `Figure SCHEMATICHE di questa sezione (archetipi), al massimo ${T.figurePerSezione}. Compila questo campo SOLO se nel testo inserisci una figura, e in quel caso scrivi nel testo il segnaposto '[FIGURA:1]' (o '[FIGURA:2]', ... : il numero è la POSIZIONE della figura in questo elenco, da 1) su una riga a sé, tra due righe vuote, senza altro: il generatore disegna la figura come immagine, con colori, posizioni e dimensioni decisi da lui, e la numera ('Figura N') da solo. Non scrivere MAI il numero di una figura, né nella didascalia né nel testo. QUANDO USARLE: solo dove una figura fa capire più del testo e di una tabella — un processo con più passaggi o decisioni (flusso), una struttura di controllo a più livelli (livelli), una scansione di tempi o fasi (cronoprogramma), una rete di sedi, depositi o presìdi attorno a un centro (rete), la schermata della piattaforma (cruscotto, solo se il profilo la prevede). Ogni figura occupa circa mezza pagina: non ripetere ciò che dice già una tabella e non inserirne una per fare scena. CHE COSA DICHIARARE: soltanto ciò che l'offerta di QUESTA gara prevede davvero e che il testo della sezione descrive; ogni elemento della figura deve comparire anche nel testo. NON inventare dati d'impresa: un valore numerico in un testo di figura segue la regola R9 (asterisco se non confermato), e i nominativi di persone non vanno scritti. Ogni figura ha una DIDASCALIA di una frase che dice COSA DIMOSTRA, non cosa raffigura (es. 'Tre livelli di controllo indipendenti dall'esecuzione alimentano un'unica gestione delle non conformità', non 'Schema dei livelli di controllo'). Dichiara per ogni figura l'archetipo e SOLO il campo di quell'archetipo, con i dati DENTRO quel campo (archetipo 'flusso' → campo 'flusso': {stadi: [...]}, mai gli 'stadi' accanto all'archetipo). Ogni segnaposto [FIGURA:n] nel testo deve avere la sua figura n dichiarata in questo elenco, e viceversa: un segnaposto senza figura viene tolto.`,
  items: {
    type: "object" as const,
    properties: {
      archetipo: { type: "string" as const, enum: ["flusso", "livelli", "cronoprogramma", "cruscotto", "rete"], description: "Quale archetipo: flusso (processo), livelli (controlli a livelli), cronoprogramma (tempi e fasi), cruscotto (schermata della piattaforma), rete (centro e nodi)." },
      didascalia: stringa("Una frase che dice cosa dimostra la figura, senza numero di figura."),
      flusso: FLUSSO,
      livelli: LIVELLI,
      cronoprogramma: CRONOPROGRAMMA,
      cruscotto: CRUSCOTTO,
      rete: RETE,
    },
    required: ["archetipo", "didascalia"],
  },
};
