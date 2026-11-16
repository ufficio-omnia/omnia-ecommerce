// Fonti di Tender Intelligence: il contratto comune degli adattatori (una fonte = un file) e il registro delle fonti, con copertura,
// aggiornamento e limiti da mostrare SEMPRE al cliente e in console (precisazione P3 del 16/11/2026). Nessuna rete, nessun database.
//
// Regole:
//   - un adattatore legge solo fonti ufficiali; non scrive sul database: restituisce record già normalizzati e il nuovo cursore;
//   - l'interfaccia del sito della piattaforma di pubblicità legale di ANAC (PVL) si usa SOLO sullo staging, in via sperimentale e con limiti
//     dichiarati (decisione del titolare del 16/11/2026, che aggiorna la D5): non è un'autorizzazione di ANAC né del riuso commerciale; la
//     produzione resta esclusa (guardia in ambiente.ts) finché non arrivano le verifiche formali e legali. La fornitura ANAC entrerà come
//     fonte a sé quando l'istanza sarà accolta;
//   - ogni campo di una gara conserva la fonte da cui viene (radar_procedure.provenienza_campi, migrazione 0115).

export type IdFonte = "ted" | "pvl" | "anac_open_data" | "anac_fornitura" | "regionale" | "manuale";

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
    aggiornamento: "Ogni giorno feriale",
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
    copertura: "Bandi italiani sopra e sotto la soglia europea pubblicati sulla piattaforma nazionale (con CIG e collegamento ai documenti)",
    aggiornamento: "Prova sullo staging; giri previsti alle 8, alle 13 e alle 18 (non ancora attivi)",
    limiti: [
      "Uso sperimentale solo sullo staging: manca la conferma di ANAC all'uso automatico e il parere sul riuso commerciale",
      "Il CPV è scritto come descrizione: si riconosce solo se è una voce del file approvato",
      "La durata del contratto non ha unità di misura e non si usa",
      "Indagini di mercato, negoziate senza bando e affidamenti diretti non entrano",
    ],
    licenza: "Da verificare con ANAC e con il legale prima di ogni uso in produzione",
    porta: { bandi: true, esiti: true, cig: "sempre", documenti: "collegamento" },
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
