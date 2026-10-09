import type { DatiFigura } from "../../src/lib/figure-dati";

// Figure di esempio ANONIMIZZATE (nessun nome di impresa, committente,
// piattaforma o prodotto reale), modellate su figure reali di relazioni
// tecniche: servono agli autotest e al disegno di prova
// (scripts/disegna-figure-prova.ts). Il contenuto riproduce la STRUTTURA delle
// figure reali per dimostrare che i campi degli archetipi bastano a descriverle.

export const flussoAlternative: DatiFigura = {
  v: 1,
  archetipo: "flusso",
  didascalia: "La classificazione dell'evento in pochi secondi attiva risposte con tempi e dotazioni diverse; ogni caso si chiude con un ticket tracciato.",
  flusso: {
    stadi: [
      { tipo: "passo", titolo: "Segnalazione", dettaglio: "Piattaforma, telefono o capo squadra" },
      { tipo: "passo", titolo: "Classificazione", dettaglio: "dell'evento in pochi secondi" },
      {
        tipo: "alternative",
        rami: [
          { titolo: "Sversamento ordinario", dettaglio: "Presa in carico ≤ 30 minuti *" },
          { titolo: "Materiale biologico", dettaglio: "≤ 20 min * · decontaminazione e disinfezione", semantico: "SICUREZZA" },
          { titolo: "Isolamento infettivo", dettaglio: "Protocollo di isolamento · DPI e attrezzature dedicate", semantico: "SICUREZZA" },
          { titolo: "Maxi afflusso", dettaglio: "Squadra dedicata immediata e richiamo del pool" },
        ],
      },
      { tipo: "passo", titolo: "Chiusura del ticket", dettaglio: "Tempi registrati in piattaforma · esito al referente" },
    ],
  },
};

export const flussoSerpentina: DatiFigura = {
  v: 1,
  archetipo: "flusso",
  didascalia: "Il ripristino segue sette passaggi fissi, con controllo del materiale organico prima della pulizia e verifica finale registrata prima di dichiarare la sala pronta.",
  flusso: {
    numerato: true,
    stadi: [
      { tipo: "passo", titolo: "Avvio", dettaglio: "Fine intervento o chiamata" },
      { tipo: "passo", titolo: "Teleria", dettaglio: "e rifiuti, contenitori sostituiti" },
      { tipo: "passo", titolo: "Controllo", dettaglio: "materiale organico visibile", ramoLaterale: { etichetta: "sì", titolo: "Decontaminazione preliminare", semantico: "SICUREZZA" } },
      { tipo: "passo", titolo: "Superfici", dettaglio: "dall'alto al basso, dal pulito allo sporco" },
      { tipo: "passo", titolo: "Attrezzature", dettaglio: "scialitica, letto e carrelli" },
      { tipo: "passo", titolo: "Pavimento", dettaglio: "ad umido, disinfezione con panni monouso" },
      { tipo: "passo", titolo: "Verifica", dettaglio: "capo squadra, check-list e ATP" },
      { tipo: "passo", titolo: "Sala pronta", dettaglio: "registrata in piattaforma e comunicata al blocco" },
    ],
    nota: "Il tempo di ripristino è misurato e registrato a ogni intervento.",
  },
};

export const flussoAssenze: DatiFigura = {
  v: 1,
  archetipo: "flusso",
  didascalia: "La copertura di un'assenza dipende da quando viene comunicata; nel frattempo le priorità sono riallineate e ogni scoperto è registrato e analizzato.",
  flusso: {
    stadi: [
      { tipo: "passo", titolo: "Assenza comunicata", dettaglio: "Registrazione il giorno stesso" },
      { tipo: "passo", titolo: "Scoperto rilevato", dettaglio: "Area e turno da coprire" },
      { tipo: "passo", titolo: "Coordinatore di presidio", dettaglio: "Attiva il contingente già formato" },
      { tipo: "passo", titolo: "Quando viene comunicata l'assenza?" },
      {
        tipo: "alternative",
        rami: [
          { titolo: "Prima dell'inizio del turno", dettaglio: "Sostituto operativo all'inizio del turno", etichetta: "prima" },
          { titolo: "A turno iniziato", dettaglio: "Copertura ripristinata entro due ore *", etichetta: "dopo" },
        ],
      },
      { tipo: "banda", titolo: "Nel frattempo: priorità riallineate dal capo squadra", dettaglio: "Aree critiche, servizi igienici e ripassi: la riduzione temporanea non colpisce le aree a più alto rischio." },
      {
        tipo: "paralleli",
        rami: [
          { titolo: "Non conformità organizzativa", dettaglio: "Registrazione dell'evento e dello scoperto" },
          { titolo: "Analisi della causa", dettaglio: "Individuazione della causa e azione preventiva" },
          { titolo: "Controllo copertura turni", dettaglio: "Obiettivo ≥ 99 % *, verifica giornaliera e report mensile" },
        ],
      },
    ],
  },
};

export const flussoRitorno: DatiFigura = {
  v: 1,
  archetipo: "flusso",
  didascalia: "Ogni non conformità segue sei fasi, dalla registrazione alla verifica dell'efficacia; se la correzione non è efficace il ciclo riparte dalle azioni.",
  flusso: {
    numerato: true,
    stadi: [
      { tipo: "passo", titolo: "Registra", dettaglio: "Apri la non conformità in piattaforma", responsabile: "Operatore" },
      { tipo: "passo", titolo: "Classifica", dettaglio: "Lieve, media o grave", responsabile: "Caposquadra" },
      { tipo: "passo", titolo: "Contieni", dettaglio: "Servizi continui entro 4 h *", semantico: "SICUREZZA" },
      { tipo: "passo", titolo: "Analizza", dettaglio: "Individua la causa e i fattori ricorrenti" },
      { tipo: "passo", titolo: "Correggi", dettaglio: "Azioni correttive e preventive" },
      { tipo: "passo", titolo: "Verifica", dettaglio: "Efficacia entro 30 giorni *" },
      { tipo: "passo", titolo: "Esito documentato", dettaglio: "Chiusura della non conformità" },
    ],
    ritorno: { da: 5, a: 4, etichetta: "non efficace" },
  },
};

export const flussoRitornoRighe: DatiFigura = {
  v: 1,
  archetipo: "flusso",
  didascalia: "Un ritorno può risalire di più stadi, anche su una riga precedente.",
  flusso: {
    stadi: [
      { tipo: "passo", titolo: "Richiesta" },
      { tipo: "passo", titolo: "Verifica disponibilità" },
      { tipo: "passo", titolo: "Preparazione" },
      { tipo: "passo", titolo: "Consegna" },
      { tipo: "passo", titolo: "Conferma di ricevimento" },
      { tipo: "passo", titolo: "Aggiornamento giacenze" },
    ],
    ritorno: { da: 5, a: 1, etichetta: "scorta insufficiente" },
  },
};

export const livelliElenco: DatiFigura = {
  v: 1,
  archetipo: "livelli",
  didascalia: "Tre livelli di controllo indipendenti dall'esecuzione, dal controllo operativo alla verifica di sistema, alimentano un'unica gestione delle non conformità.",
  livelli: {
    livelli: [
      { titolo: "Autocontrollo operativo", responsabile: "Operatore di squadra", descrizione: "Check-list a fine intervento, segnalazione immediata delle anomalie" },
      { titolo: "Controllo di qualità", responsabile: "Capo squadra", descrizione: "Ispezioni a campione con scheda, esito registrato in piattaforma" },
      { titolo: "Verifica di sistema", responsabile: "Responsabile qualità", descrizione: "Audit programmati e riesame periodico con il referente del committente" },
    ],
    pannello: {
      titolo: "Gestione delle non conformità",
      forma: "elenco",
      voci: ["Segnalazione e registrazione in piattaforma", "Classificazione per gravità", "Azione correttiva entro 48 ore *", "Verifica dell'efficacia", "Report mensile al referente"],
      collegaLivelli: true,
    },
    banda: { titolo: "Ogni livello verifica quello inferiore", descrizione: "Chi controlla non è lo stesso che esegue: gli esiti confluiscono in un unico registro." },
  },
};

export const livelliFlusso: DatiFigura = {
  v: 1,
  archetipo: "livelli",
  didascalia: "I quattro livelli di controllo si incontrano nel percorso di una non conformità, che si chiude solo dopo la verifica dell'efficacia.",
  livelli: {
    livelli: [
      { titolo: "Squadra", responsabile: "Operatori", descrizione: "Autocontrollo a fine intervento" },
      { titolo: "Coordinamento", responsabile: "Capo squadra", descrizione: "Controllo giornaliero delle aree" },
      { titolo: "Gestione del contratto", responsabile: "Referente di commessa", descrizione: "Ispezioni programmate e report mensile" },
      { titolo: "Direzione", responsabile: "Responsabile qualità", descrizione: "Audit annuale e riesame del servizio" },
    ],
    pannello: {
      titolo: "Percorso di una non conformità",
      forma: "flusso",
      collegaLivelli: true,
      flusso: {
        numerato: true,
        stadi: [
          { tipo: "passo", titolo: "Segnalazione", dettaglio: "da qualsiasi livello" },
          { tipo: "passo", titolo: "Classificazione", dettaglio: "lieve, media, grave" },
          { tipo: "passo", titolo: "Correzione", dettaglio: "entro 24 ore *" },
          { tipo: "passo", titolo: "Verifica", dettaglio: "dell'efficacia" },
        ],
        ritorno: { da: 3, a: 2, etichetta: "non efficace" },
      },
    },
  },
};

export const livelliSenzaPannello: DatiFigura = {
  v: 1,
  archetipo: "livelli",
  didascalia: "Il controllo cresce di livello man mano che aumenta la distanza dall'esecuzione: dalla squadra alla direzione.",
  livelli: {
    livelli: [
      { titolo: "Controllo operativo", responsabile: "Capo squadra", descrizione: "Verifica quotidiana del servizio svolto in ogni area, con scheda e foto" },
      { titolo: "Controllo gestionale", responsabile: "Responsabile di commessa", descrizione: "Ispezioni a campione settimanali, analisi degli scostamenti e azioni correttive" },
      { titolo: "Controllo di sistema", responsabile: "Responsabile qualità", descrizione: "Audit programmati sul sistema di gestione e riesame con il committente" },
    ],
    banda: { titolo: "Gli esiti di ogni livello confluiscono in un unico registro dei controlli" },
  },
};

export const cronoMinuti: DatiFigura = {
  v: 1,
  archetipo: "cronoprogramma",
  didascalia: "In meno di mezz'ora la sala è di nuovo pronta: le operazioni si sovrappongono dove possibile e la verifica del capo squadra chiude l'intervento.",
  cronoprogramma: {
    unita: "minuti",
    durata: 30,
    traguardi: [
      { posizione: 5, titolo: "Squadra sul posto" },
      { posizione: 30, titolo: "Sala pronta", dettaglio: "entro 30 minuti *", finale: true },
    ],
    righe: [
      { titolo: "Teleria e rifiuti", responsabile: "Operatore", barre: [{ da: 0, a: 5, etichetta: "5′" }] },
      { titolo: "Decontaminazione preliminare", responsabile: "Operatore", barre: [{ da: 5, a: 10, etichetta: "se necessario", semantico: "SICUREZZA" }] },
      { titolo: "Superfici e attrezzature", responsabile: "Squadra", barre: [{ da: 10, a: 20, etichetta: "dall'alto al basso" }] },
      { titolo: "Pavimento", responsabile: "Squadra", barre: [{ da: 18, a: 25, etichetta: "ad umido" }] },
      { titolo: "Verifica e check-list", responsabile: "Capo squadra", barre: [{ da: 25, a: 30, etichetta: "ATP" }] },
    ],
  },
};

export const cronoSettimane: DatiFigura = {
  v: 1,
  archetipo: "cronoprogramma",
  didascalia: "L'attivazione del servizio richiede dodici settimane, con la formazione che parte prima della consegna delle attrezzature e controlli a campione fin dall'avvio.",
  cronoprogramma: {
    unita: "settimane",
    durata: 12,
    traguardi: [
      { posizione: 2, titolo: "Presa in carico" },
      { posizione: 6, titolo: "Verifica dei primi 30 giorni", dettaglio: "con il referente" },
      { posizione: 12, titolo: "Servizio a regime", finale: true },
    ],
    righe: [
      { titolo: "Sopralluogo e piano operativo", responsabile: "Responsabile di commessa", fase: "Avvio", barre: [{ da: 0, a: 2, etichetta: "piano" }] },
      { titolo: "Formazione del personale", responsabile: "Responsabile formazione", fase: "Avvio", barre: [{ da: 1, a: 4, etichetta: "formazione *" }] },
      { titolo: "Consegna di attrezzature e prodotti", responsabile: "Logistica", fase: "Avvio", barre: [{ da: 2, a: 4 }] },
      { titolo: "Start-up del servizio", responsabile: "Capo squadra", fase: "Messa a regime", barre: [{ da: 4, a: 6, etichetta: "start-up" }], pietre: [{ posizione: 4, etichetta: "avvio" }] },
      { titolo: "Controlli di qualità", responsabile: "Responsabile qualità", fase: "Messa a regime", barre: [{ da: 6, a: 12, etichetta: "controlli a campione" }] },
      { titolo: "Report e riesame", responsabile: "Referente", fase: "Messa a regime", barre: [], pietre: [{ posizione: 8, etichetta: "report mensile" }, { posizione: 12, etichetta: "riesame" }] },
    ],
    banda: { titolo: "Ogni fase è validata dal referente prima di passare alla successiva" },
  },
};

export const cronoGiorniSemplice: DatiFigura = {
  v: 1,
  archetipo: "cronoprogramma",
  didascalia: "La bonifica iniziale si completa in dieci giorni, con le aree più delicate trattate per prime.",
  cronoprogramma: {
    unita: "giorni",
    durata: 10,
    righe: [
      { titolo: "Aree critiche", barre: [{ da: 0, a: 3, etichetta: "aree critiche", semantico: "SICUREZZA" }] },
      { titolo: "Degenze", barre: [{ da: 2, a: 6 }, { da: 7, a: 9, etichetta: "ripasso" }] },
      { titolo: "Aree comuni e uffici", barre: [{ da: 5, a: 9, etichetta: "aree comuni" }] },
      { titolo: "Collaudo", barre: [], pietre: [{ posizione: 10, etichetta: "collaudo" }] },
    ],
    nota: "I giorni sono lavorativi e partono dalla consegna delle aree.",
  },
};

export const cruscottoCompleto: DatiFigura = {
  v: 1,
  archetipo: "cruscotto",
  didascalia: "La piattaforma gestionale dà al referente una vista unica sugli indicatori del contratto, con gli obiettivi di capitolato accanto a ciò che viene rilevato in ogni area.",
  cruscotto: {
    piattaforma: "Piattaforma gestionale",
    profilo: "Responsabile di commessa",
    indicatori: [
      { etichetta: "Presa in carico degli eventi", obiettivo: "≤ 30 min *" },
      { etichetta: "Copertura dei turni", obiettivo: "≥ 99 % *" },
      { etichetta: "Non conformità chiuse", obiettivo: "≤ 30 giorni *" },
      { etichetta: "Controlli eseguiti", obiettivo: "100 %" },
    ],
    righe: [
      { indicatore: "Presa in carico di un evento ordinario", obiettivo: "≤ 30 min *", stato: "conforme" },
      { indicatore: "Presa in carico di un evento biologico", obiettivo: "≤ 20 min *", stato: "attenzione" },
      { indicatore: "Copertura delle assenze a turno iniziato", obiettivo: "≤ 2 ore *", stato: "conforme" },
      { indicatore: "Ripasso dei servizi igienici", obiettivo: "ogni 2 ore", stato: "scostamento" },
      { indicatore: "Controlli di qualità eseguiti", obiettivo: "100 %", stato: "conforme" },
      { indicatore: "Reportistica mensile al referente", obiettivo: "entro il 5" },
    ],
    laterale: { titolo: "Aree di intervento", voci: ["Blocco operatorio", "Degenze", "Pronto soccorso", "Ambulatori", "Aree comuni"] },
  },
};

export const cruscottoSemplice: DatiFigura = {
  v: 1,
  archetipo: "cruscotto",
  didascalia: "Il referente consulta in piattaforma gli obiettivi di servizio e, a regime, i valori rilevati.",
  cruscotto: {
    profilo: "Referente del committente",
    indicatori: [
      { etichetta: "Controlli di qualità", obiettivo: "1 a settimana" },
      { etichetta: "Reportistica", obiettivo: "mensile" },
    ],
    righe: [
      { indicatore: "Ispezioni programmate", obiettivo: "1 a settimana" },
      { indicatore: "Non conformità aperte e chiuse", obiettivo: "report mensile" },
      { indicatore: "Soddisfazione degli utenti", obiettivo: "indagine annuale" },
    ],
  },
};

export const reteColonne: DatiFigura = {
  v: 1,
  archetipo: "rete",
  didascalia: "Un magazzino centrale rifornisce i depositi di sede, e la piattaforma gestionale tiene allineati scorte, consumi e segnalazioni di tutte le sedi.",
  rete: {
    origini: [{ titolo: "Magazzino centrale", dettaglio: "Scorte e rifornimento", voci: ["Prodotti", "Attrezzature", "DPI"] }],
    nodi: [
      { titolo: "Deposito sede A", dettaglio: "scorta di sicurezza" },
      { titolo: "Deposito sede B", dettaglio: "scorta di sicurezza" },
      { titolo: "Deposito sede C", dettaglio: "scorta di sicurezza" },
      { titolo: "Deposito sede D", dettaglio: "scorta di sicurezza" },
    ],
    centro: { titolo: "Piattaforma gestionale", sottotitolo: "dati in tempo reale", voci: ["Giacenze e ordini", "Consumi per sede", "Segnalazioni"] },
    collegamento: "bidirezionale",
    chip: { titolo: "Profili di accesso", voci: ["Operatore", "Capo squadra", "Responsabile di commessa", "Referente del committente"] },
    banda: { titolo: "Una sola fonte dei dati per tutte le sedi" },
  },
};

export const reteStella: DatiFigura = {
  v: 1,
  archetipo: "rete",
  didascalia: "La centrale operativa è l'unico punto di raccolta delle chiamate e attiva il presidio o la squadra più vicini.",
  rete: {
    centro: { titolo: "Centrale operativa", sottotitolo: "presidio 24 ore su 24 *", voci: ["Ricezione delle chiamate", "Attivazione delle squadre"] },
    nodi: [
      { titolo: "Presidio Nord", dettaglio: "squadra fissa" },
      { titolo: "Presidio Sud", dettaglio: "squadra fissa" },
      { titolo: "Presidio Est", dettaglio: "squadra fissa" },
      { titolo: "Presidio Ovest", dettaglio: "squadra fissa" },
      { titolo: "Squadra pronto intervento", dettaglio: "decontaminazione e isolamento", semantico: "SICUREZZA" },
    ],
    collegamento: "bidirezionale",
    nota: "Ogni intervento è registrato con data, ora e squadra.",
  },
};

export const reteSemplice: DatiFigura = {
  v: 1,
  archetipo: "rete",
  didascalia: "Le segnalazioni di ogni sede confluiscono in un unico registro.",
  rete: {
    centro: { titolo: "Registro delle segnalazioni" },
    nodi: [{ titolo: "Sede 1" }, { titolo: "Sede 2" }],
    collegamento: "verso_centro",
  },
};

export const tuttiGliEsempiFigure: Record<string, DatiFigura> = {
  flussoAlternative,
  flussoSerpentina,
  flussoAssenze,
  flussoRitorno,
  flussoRitornoRighe,
  livelliElenco,
  livelliFlusso,
  livelliSenzaPannello,
  cronoMinuti,
  cronoSettimane,
  cronoGiorniSemplice,
  cruscottoCompleto,
  cruscottoSemplice,
  reteColonne,
  reteStella,
  reteSemplice,
};
