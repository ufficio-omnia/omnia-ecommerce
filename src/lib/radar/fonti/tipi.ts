// Fonti di Tender Intelligence: il contratto comune degli adattatori (una fonte = un file) e il registro delle fonti, con copertura,
// aggiornamento e limiti da mostrare SEMPRE al cliente e in console (precisazione P3 del 16/11/2026). Nessuna rete, nessun database.
//
// Regole:
//   - un adattatore legge solo fonti ufficiali; non scrive sul database: restituisce record già normalizzati e il nuovo cursore;
//   - la piattaforma di pubblicità legale di ANAC (PVL) è una fonte visibile ai clienti (direttiva 48A del 23/11/2026, che revoca la 7.14);
//     dove si può scrivere lo decide la guardia di produzione per fonte e per ambiente (ambiente.ts, L6 del piano 36, pacchetto K8). La
//     fornitura ANAC entrerà come fonte a sé quando l'istanza sarà accolta;
//   - ogni campo di una gara conserva la fonte da cui viene (radar_procedure.provenienza_campi, migrazione 0115).

// gli orari dei giri vengono da ORARI_GIRI (programmazione-calcoli.ts): frase neutra («giri previsti»), vera anche finché i giri sono spenti
import { testoOrari } from "../programmazione-calcoli";

export type IdFonte = "ted" | "pvl" | "sintel" | "sardegnacat" | "sater" | "tuttogare" | "anac_open_data" | "anac_fornitura" | "regionale" | "manuale";

export type StatoFonte = "attiva" | "in_costruzione" | "transitoria" | "prevista";

export type DescrizioneFonte = {
  id: IdFonte;
  nome: string;
  stato: StatoFonte;
  copertura: string;
  aggiornamento: string;
  limiti: readonly string[];
  licenza: string;
  // che cosa porta: le capacità servono alle regole di unione tra fonti
  porta: { bandi: boolean; esiti: boolean; cig: "sempre" | "spesso" | "raramente" | "mai"; documenti: "collegamento" | "nessuno" };
};

export const FONTI_RADAR: readonly DescrizioneFonte[] = [
  {
    id: "ted",
    nome: "TED, Gazzetta ufficiale dell'Unione europea",
    stato: "in_costruzione",
    copertura: "Gare italiane sopra la soglia europea, e quelle che gli enti pubblicano su TED per scelta",
    aggiornamento: `Giri previsti ${testoOrari("ted")} (ora italiana)`,
    limiti: [
      "Non comprende le gare sotto la soglia europea",
      "Il CIG manca quasi sempre nel bando",
      "Il valore è quello stimato complessivo, non la base di gara",
      "Il collegamento ai documenti porta di solito alla piattaforma dell'ente, non ai file",
    ],
    licenza: "Riuso libero, anche commerciale, citando la fonte (Ufficio delle pubblicazioni dell'Unione europea)",
    porta: { bandi: true, esiti: true, cig: "raramente", documenti: "collegamento" },
  },
  {
    id: "pvl",
    nome: "ANAC, Piattaforma di pubblicità a valore legale",
    stato: "in_costruzione",
    // copertura e ultimo limite: testi approvati dall'utente il 23/11 con C1 («Sì, vanno bene»), da usare così
    copertura: "Bandi italiani sopra e sotto la soglia europea pubblicati sulla piattaforma nazionale (con CIG e collegamento ai documenti), indagini di mercato e avvisi per l'iscrizione a elenchi",
    aggiornamento: `Giri previsti ${testoOrari("pvl")} (ora italiana)`,
    limiti: [
      // testo scelto dall'utente il 23/11 («Frase neutra proposta»), da usare così
      "Dati letti dalla piattaforma pubblica di ANAC; fa fede l'avviso pubblicato sulla piattaforma",
      "Il CPV è scritto come descrizione: si riconosce solo se è una voce del file approvato",
      "La durata del contratto non ha unità di misura e non si usa",
      "Le procedure negoziate su invito e gli affidamenti diretti non entrano; le indagini di mercato entrano come candidature e gli avvisi di costituzione di elenchi come iscrizioni",
    ],
    // testo scelto dall'utente il 23/11 («Frase neutra proposta»), da usare così
    licenza: "Avvisi di pubblicità legale pubblicati da ANAC: solo dati di fatto, con il collegamento all'avviso ufficiale e la citazione della fonte",
    porta: { bandi: true, esiti: true, cig: "sempre", documenti: "collegamento" },
  },
  // Fase B2a: piattaforme regionali. Testi senza dichiarazioni di copertura nazionale (decisione 9 del 16/11): ogni fonte dice quale parte
  // copre, e le altre regioni non sono comprese.
  {
    id: "sintel",
    nome: "Sintel, piattaforma di e-procurement della Regione Lombardia",
    stato: "in_costruzione",
    copertura: "Gare degli enti lombardi gestite su Sintel, anche sotto la soglia europea (bandi, manifestazioni di interesse, indagini di mercato)",
    aggiornamento: `Giri previsti ${testoOrari("sintel")} (ora italiana), dopo il caricamento dei dati aperti della Regione`,
    limiti: [
      "Comprende solo le gare gestite su Sintel dagli enti lombardi",
      "La scadenza è indicata solo come giorno: l'ora va controllata sulla pagina della procedura",
      "Il CPV è quello della categoria merceologica della piattaforma, non sempre quello del bando",
      "L'importo è la base d'asta indicata nei dati aperti",
      "Non comprende procedure su invito né affidamenti diretti",
    ],
    licenza: "Regione Lombardia – Open Data Lombardia (Sintel), licenza CC0 1.0, citando la fonte",
    porta: { bandi: true, esiti: false, cig: "spesso", documenti: "collegamento" },
  },
  {
    id: "sardegnacat",
    nome: "SardegnaCAT, piattaforma di e-procurement della Regione Sardegna",
    stato: "in_costruzione",
    copertura: "Gare degli enti sardi pubblicate su SardegnaCAT, anche sotto la soglia europea",
    aggiornamento: `Giri previsti ${testoOrari("sardegnacat")} (ora italiana), dal feed pubblico dei bandi`,
    limiti: [
      "Comprende solo le gare pubblicate su SardegnaCAT",
      "Il CIG manca nelle procedure con più lotti",
      "Non comprende procedure su invito né affidamenti diretti",
    ],
    // decisione dell'utente del 23/11 (48E, D4-bis): visibile ai clienti senza aspettare il parere; restano solo dati di fatto con il
    // collegamento alla pagina ufficiale e la citazione della fonte, e i limiti verso il feed
    licenza: "Regione Autonoma della Sardegna – SardegnaCAT: licenza del feed non dichiarata; solo dati di fatto, con il collegamento alla pagina ufficiale e la citazione della fonte",
    porta: { bandi: true, esiti: false, cig: "spesso", documenti: "collegamento" },
  },
  // Fase 2 (documento 60, connettore SATER; in produzione dal 26/11 per decisione dell'utente): parte spenta e nascosta ai clienti (0134). I
  // testi diventano pubblici solo quando la fonte è accesa e resa visibile dalla console (fonti-ricerca.tsx mostra SOLO le fonti attive e
  // visibili).
  {
    id: "sater",
    nome: "SATER, piattaforma di e-procurement della Regione Emilia-Romagna (Intercent-ER)",
    stato: "in_costruzione",
    copertura: "Gare degli enti emiliano-romagnoli pubblicate su SATER, anche sotto la soglia europea (bandi, avvisi e indagini di mercato)",
    aggiornamento: `Giri previsti ${testoOrari("sater")} (ora italiana), dagli elenchi pubblici del portale Intercent-ER`,
    limiti: [
      "Comprende solo le gare pubblicate su SATER",
      "Il CIG manca in circa un terzo degli avvisi (soprattutto indagini di mercato e manifestazioni di interesse)",
      "Il CPV e l'importo non sono indicati negli elenchi: il settore si riconosce dall'oggetto",
      "Non comprende procedure su invito né affidamenti diretti",
    ],
    // confermata sul campione vero (addendum 60C): CC BY 4.0, riuso anche commerciale con l'attribuzione della fonte
    licenza: "Agenzia regionale Intercent-ER: dati del portale in licenza CC BY 4.0, riusati citando la fonte, con il collegamento alla pagina ufficiale del bando",
    porta: { bandi: true, esiti: false, cig: "spesso", documenti: "collegamento" },
  },
  // Fase 2 (documento 60, connettore TuttoGare; in produzione per decisione dell'utente del 26/11): parte spenta e nascosta ai clienti (0135).
  // Testi per il cliente SENZA il nome del software delle piattaforme (indicazione del coordinamento: le istanze sono le piattaforme degli enti,
  // anche con il loro marchio, come Roma); diventano pubblici solo quando la fonte è accesa e resa visibile dalla console.
  {
    id: "tuttogare",
    nome: "Piattaforme telematiche di alcune stazioni appaltanti",
    stato: "in_costruzione",
    copertura: "Gare, indagini di mercato e richieste di preventivo aperte che alcuni enti pubblicano sulle proprie piattaforme telematiche, anche sotto la soglia europea (Roma Capitale, Università di Bari, Regione Siciliana e due centrali di committenza di Lazio e Puglia)",
    aggiornamento: `Giri previsti ${testoOrari("tuttogare")} (ora italiana), dalle pagine pubbliche delle gare degli enti`,
    limiti: [
      "Comprende solo gli enti collegati, non tutte le stazioni appaltanti delle loro regioni",
      "Il codice fiscale dell'ente non è indicato: si ricava dal CIG quando la gara è pubblicata anche su altre fonti",
      "Il CIG manca spesso nelle indagini di mercato e nelle richieste di preventivo",
      "Non comprende procedure su invito né affidamenti diretti",
    ],
    licenza: "Dati pubblicati dalle stazioni appaltanti sulle proprie piattaforme: solo dati di fatto, con il collegamento alla pagina ufficiale della gara",
    porta: { bandi: true, esiti: false, cig: "spesso", documenti: "collegamento" },
  },
  {
    id: "anac_open_data",
    nome: "ANAC, dati aperti della Banca dati nazionale dei contratti pubblici",
    stato: "transitoria",
    copertura: "Tutte le procedure italiane con CIG, anche sotto soglia, con esiti e aggiudicatari",
    aggiornamento: "Una volta al mese, con alcune settimane di ritardo; importazione con uno strumento locale",
    limiti: [
      "Molte gare arrivano quando sono già scadute o quasi",
      "Nessun collegamento ai documenti di gara",
      "Gli esiti mancano per circa metà delle procedure, anche dopo anni",
    ],
    licenza: "Indicata come CC BY-SA 4.0 nei metadati e CC BY 4.0 sul sito ANAC: in attesa di parere legale",
    porta: { bandi: true, esiti: true, cig: "sempre", documenti: "nessuno" },
  },
  {
    id: "anac_fornitura",
    nome: "ANAC, fornitura periodica dei dati della Banca dati nazionale",
    stato: "prevista",
    copertura: "Da definire con ANAC (istanza inviata)",
    aggiornamento: "Da definire con ANAC",
    limiti: ["Non ancora disponibile"],
    licenza: "Da definire con ANAC",
    porta: { bandi: true, esiti: true, cig: "sempre", documenti: "collegamento" },
  },
  {
    id: "regionale",
    nome: "Dati aperti delle piattaforme regionali",
    stato: "prevista",
    copertura: "Le procedure della singola regione (per esempio Sintel in Lombardia)",
    aggiornamento: "Ogni giorno, secondo la piattaforma",
    limiti: ["Non ancora disponibile", "Copertura limitata alla regione"],
    licenza: "Secondo la piattaforma (Sintel: CC0)",
    porta: { bandi: true, esiti: true, cig: "sempre", documenti: "collegamento" },
  },
  {
    id: "manuale",
    nome: "Gare aggiunte dal cliente",
    stato: "in_costruzione",
    copertura: "Le gare che il cliente aggiunge a mano con il CIG o il collegamento",
    aggiornamento: "Quando il cliente le aggiunge",
    limiti: ["Visibili solo all'impresa che le ha aggiunte", "I dati sono quelli scritti dal cliente finché la gara non compare in una fonte ufficiale"],
    licenza: "Dati dell'impresa, riservati",
    porta: { bandi: true, esiti: false, cig: "spesso", documenti: "collegamento" },
  },
];

export function descrizioneFonte(id: IdFonte): DescrizioneFonte {
  const f = FONTI_RADAR.find((x) => x.id === id);
  if (!f) throw new Error(`Fonte sconosciuta: ${id}`);
  return f;
}

// ───── contratto degli adattatori ─────

export type RecordLotto = {
  cig: string | null;
  numero: string | null;
  oggetto: string | null;
  cpvPrincipale: string | null;
  cpvTutti: string[];
  valoreStimato: number | null;
  valoreBase: number | null;
  oneriSicurezza: number | null;
  durataMesi: number | null;
  opzioniRinnovi: string | null;
};

export type RecordProcedura = {
  fonte: IdFonte;
  // identificativo dell'avviso nella fonte (per TED il numero di pubblicazione, per ANAC il CIG o il numero di gara)
  idFonte: string;
  // chiave stabile della procedura, uguale tra versioni e rettifiche dello stesso avviso (per TED: «ted:<identificativo della procedura>»)
  chiaveProcedura: string;
  oggetto: string;
  descrizione: string | null;
  ente: { codiceFiscale: string | null; denominazione: string | null; comune: string | null; provincia: string | null; regione: string | null; luogoIstat: string | null; nuts: string | null };
  tipoAvviso: string | null;
  tipoProcedura: string | null;
  criterioAggiudicazione: string | null;
  natura: "servizi" | "forniture" | "lavori" | "misto" | null;
  settoriSpeciali: boolean | null;
  dataPubblicazione: string | null; // AAAA-MM-GG
  // giorno della scadenza (AAAA-MM-GG, giorno di calendario della fonte) e istante esatto SOLO se la fonte indica l'ora (mai presunta)
  scadenzaGiorno: string | null;
  scadenzaOfferte: string | null; // ISO con fuso, null senza ora
  scadenzaOraIndicata: boolean;
  valoreStimato: number | null;
  valoreBase: number | null;
  oneriSicurezza: number | null;
  durataMesi: number | null;
  annullata: boolean;
  urlAvviso: string | null;
  urlDocumenti: string | null;
  cpvPrincipale: string | null;
  cpvTutti: string[];
  lotti: RecordLotto[];
  // impronta del contenuto letto: due letture con la stessa impronta non generano aggiornamenti
  impronta: string;
};

// Il cursore è opaco per chi chiama: lo interpreta solo l'adattatore che l'ha prodotto.
export type CursoreFonte = Record<string, unknown>;

export type LetturaFonte = { record: RecordProcedura[]; cursore: CursoreFonte; finito: boolean };

export interface AdattatoreFonte {
  readonly id: IdFonte;
  // legge le novità dopo il cursore, al massimo «limite» record; finito=false vuol dire che ce ne sono altre da leggere al giro successivo
  leggiNovita(cursore: CursoreFonte | null, opzioni: { limite: number; segnale?: AbortSignal }): Promise<LetturaFonte>;
}
