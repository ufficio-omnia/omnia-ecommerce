// Newsletter «OMNIA AI | Tender Weekly»: tipi condivisi tra console, generazione, invio e template.
// Solo tipi e costanti: nessun accesso a database o rete (si può importare anche da componenti client).

export const NOME_NEWSLETTER = "OMNIA AI | TENDER WEEKLY";
export const TESTATA = "TENDER WEEKLY";
export const SOTTOTITOLO = "Il mondo degli appalti pubblici, ogni settimana.";
export const CLAIM = "TECH WHEN POSSIBLE. HUMAN WHEN IT MATTERS.";

export const STATI_EDIZIONE = ["bozza", "in_revisione", "approvata", "programmata", "in_invio", "inviata", "invio_parziale", "annullata"] as const;
export type StatoEdizione = (typeof STATI_EDIZIONE)[number];

export const ETICHETTA_STATO: Record<StatoEdizione, string> = {
  bozza: "Bozza",
  in_revisione: "In revisione",
  approvata: "Approvata",
  programmata: "Programmata",
  in_invio: "In invio",
  inviata: "Inviata",
  invio_parziale: "Invio parziale",
  annullata: "Annullata",
};

// Stati in cui il contenuto si può ancora modificare (lo stesso vincolo è nel trigger della 0141).
export const STATI_MODIFICABILI: StatoEdizione[] = ["bozza", "in_revisione", "approvata", "programmata"];

export const CHIAVI_SEZIONE = ["notizia", "normativa", "tender", "esperto", "omnia", "chiusura"] as const;
export type ChiaveSezione = (typeof CHIAVI_SEZIONE)[number];

export const SEZIONI_PREDEFINITE: Record<ChiaveSezione, { lettera: string; titolo: string; descrizione: string }> = {
  notizia: { lettera: "A", titolo: "La notizia della settimana", descrizione: "La novità più significativa del mondo degli appalti pubblici." },
  normativa: { lettera: "B", titolo: "Normativa e giurisprudenza", descrizione: "Codice dei contratti, ANAC, MIT, TAR e Consiglio di Stato." },
  tender: { lettera: "C", titolo: "Tender Intelligence", descrizione: "Andamento del mercato e dati significativi, solo se verificati." },
  esperto: { lettera: "D", titolo: "L'approfondimento dell'esperto", descrizione: "Contenuti operativi per gli uffici gare." },
  omnia: { lettera: "E", titolo: "OMNIA AI News", descrizione: "Novità della piattaforma effettivamente disponibili." },
  chiusura: { lettera: "F", titolo: "Chiusura", descrizione: "Invito ad accedere a OMNIA AI e saluti." },
};

export type Fonte = { titolo: string; url: string; data?: string; ente?: string };

export type Notizia = {
  titolo: string;
  // testo principale (paragrafi separati da una riga vuota)
  sintesi: string;
  // «Cosa cambia per le imprese»: implicazioni operative
  implicazioni?: string;
  // dato o frase da mettere in evidenza (box)
  evidenza?: string;
  fonti: Fonte[];
  immagine?: { url: string; alt: string };
};

export type Sezione = {
  chiave: ChiaveSezione;
  titolo: string;
  attiva: boolean;
  introduzione?: string;
  notizie: Notizia[];
};

export type ContenutoEdizione = {
  editoriale: { attivo: boolean; titolo: string; testo: string; firma: string };
  sezioni: Sezione[];
  cta: { testo: string; etichetta: string; url: string };
};

export type DestinatariScelti = { abbonati_attivi: boolean; altri_autorizzati: boolean };

export type Edizione = {
  id: string;
  numero: number;
  settimana: string | null;
  stato: StatoEdizione;
  data_edizione: string; // AAAA-MM-GG
  oggetto: string;
  preheader: string;
  contenuto: ContenutoEdizione;
  origine: "manuale" | "ai" | "ai_automatica";
  note_generazione: string | null;
  destinatari: DestinatariScelti;
  versione: number;
  versione_attiva: number | null;
  generazione_in_corso_da: string | null;
  generazione_token: string | null;
  approvata_il: string | null;
  approvata_da: string | null;
  programmata_per: string | null;
  invio_iniziato_il: string | null;
  invio_concluso_il: string | null;
  creata_il: string;
  aggiornata_il: string;
};

export const BASI_GIURIDICHE = ["consenso", "soft_spam_art130", "altro_documentato", "contratto_abbonamento"] as const;
export type BaseGiuridica = (typeof BASI_GIURIDICHE)[number];
export const ETICHETTA_BASE: Record<BaseGiuridica, string> = {
  consenso: "Consenso espresso",
  soft_spam_art130: "Cliente – art. 130 c. 4 Codice privacy",
  altro_documentato: "Altra base documentata",
  contratto_abbonamento: "Cliente – servizio incluso nell'abbonamento (Condizioni v3+)",
};

// Le Condizioni di abbonamento includono Tender Weekly tra i servizi informativi da questa versione in poi: solo chi l'ha
// accettata viene acquisito in automatico come iscritto «contratto_abbonamento».
export const VERSIONE_CONDIZIONI_CON_NEWSLETTER = 3;
// Versione dell'informativa privacy che cita la newsletter (registrata con ogni iscrizione dal sito).
export const VERSIONE_INFORMATIVA_NEWSLETTER = "privacy-policy v3";
// Testo del consenso mostrato nel modulo pubblico: si salva identico con ogni iscrizione.
export const TESTO_CONSENSO_NEWSLETTER =
  "Acconsento a ricevere Tender Weekly, la newsletter informativa settimanale di OMNIA AI, all'indirizzo indicato. Posso disiscrivermi in qualunque momento dal link presente in ogni email.";

export type Provenienza = "sito" | "console" | "importazione" | "abbonamento";
export const ETICHETTA_PROVENIENZA: Record<Provenienza, string> = {
  sito: "Sito omnia-ai.it",
  console: "Aggiunto a mano",
  importazione: "Importazione (elenco o CSV)",
  abbonamento: "Cliente con abbonamento",
};

export type StatoIscritto = "in_attesa" | "iscritto" | "disiscritto" | "rimbalzato" | "segnalato_spam";
export type CategoriaIscritto = "cliente" | "prospect" | "interno" | "altro";

export type Iscritto = {
  id: string;
  email: string;
  nome: string | null;
  user_id: string | null;
  categoria: CategoriaIscritto;
  stato: StatoIscritto;
  base_giuridica: BaseGiuridica;
  prova_base: string;
  base_dal: string;
  token_disiscrizione: string;
  disiscritto_il: string | null;
  motivo_uscita: string | null;
  creato_il: string;
  // 0142 (facoltativi: assenti prima della migrazione)
  provenienza?: Provenienza;
  azienda?: string | null;
  note_admin?: string | null;
  consenso_testo?: string | null;
  informativa_versione?: string | null;
  consenso_ip_hash?: string | null;
  consenso_user_agent?: string | null;
  conferma_token?: string | null;
  conferma_inviata_il?: string | null;
  conferme_inviate?: number;
  confermato_il?: string | null;
};

export type StatoInvio = "in_coda" | "inviato" | "consegnato" | "ritardato" | "rimbalzato" | "segnalato_spam" | "errore" | "saltato";

export type Invio = {
  id: string;
  edizione_id: string;
  iscritto_id: string | null;
  tipo: "reale" | "prova";
  email: string;
  versione: number;
  stato: StatoInvio;
  resend_id: string | null;
  errore: string | null;
  inviato_il: string | null;
  consegnato_il: string | null;
  aperto_il: string | null;
  cliccato_il: string | null;
  clic: number;
  creato_il: string;
};

export type Impostazioni = {
  giorno_generazione: number;
  ora_generazione: string;
  giorno_invio: number;
  ora_invio: string;
  generazione_automatica: boolean;
  mittente_nome: string;
  mittente_email: string;
  rispondi_a: string | null;
  email_notifica_admin: string;
  resend_piano: string | null;
  resend_quota_mensile_eur: number | null;
};

export const IMPOSTAZIONI_PREDEFINITE: Impostazioni = {
  giorno_generazione: 4,
  ora_generazione: "18:00",
  giorno_invio: 5,
  ora_invio: "10:00",
  generazione_automatica: true,
  mittente_nome: "OMNIA AI | Tender Weekly",
  mittente_email: "newsletter@omniaitalia.com",
  rispondi_a: null,
  email_notifica_admin: "ufficio@omniaitalia.com",
  resend_piano: null,
  resend_quota_mensile_eur: null,
};

export const GIORNI_SETTIMANA = ["", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica"];

export function contenutoVuoto(): ContenutoEdizione {
  return {
    editoriale: { attivo: false, titolo: "", testo: "", firma: "La redazione di OMNIA AI" },
    sezioni: CHIAVI_SEZIONE.map((chiave) => ({
      chiave,
      titolo: SEZIONI_PREDEFINITE[chiave].titolo,
      attiva: true,
      introduzione: "",
      notizie: [],
    })),
    cta: {
      testo: "Analisi dei bandi, criteri di valutazione e bozze della relazione tecnica: tutto in un unico spazio di lavoro, con il tuo ufficio gare sempre al centro.",
      etichetta: "Accedi a OMNIA AI",
      url: "https://omnia-ai.it/login",
    },
  };
}

// ───── versioni di un'edizione ─────

export type OrigineVersione = "generazione" | "rigenerazione" | "rigenerazione_sezione" | "rigenerazione_notizia" | "modifiche_manuali" | "iniziale";

export const ETICHETTA_ORIGINE: Record<OrigineVersione, string> = {
  generazione: "Generazione",
  rigenerazione: "Rigenerazione intera",
  rigenerazione_sezione: "Rigenerazione di una sezione",
  rigenerazione_notizia: "Rigenerazione di una notizia",
  modifiche_manuali: "Modifiche manuali (salvate prima di rigenerare)",
  iniziale: "Testo iniziale",
};

export type Versione = {
  id: string;
  edizione_id: string;
  numero_versione: number;
  origine: OrigineVersione;
  esito: "ok" | "fallita";
  ambito: { chiave?: string; indice?: number; titolo?: string };
  indicazioni: string | null;
  oggetto: string | null;
  preheader: string | null;
  contenuto: ContenutoEdizione | null;
  generazione_id: string | null;
  costo_usd: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  ricerche_web: number | null;
  modello: string | null;
  errore: string | null;
  creata_il: string;
};

// Una riga di ai_operazioni della newsletter (stesso registro dei costi di tutto il progetto).
export type OperazioneCosto = {
  id: string;
  operazione: string;
  provider: string;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  costo_stimato: number | null;
  created_at: string;
  dettaglio: Record<string, unknown> | null;
};
