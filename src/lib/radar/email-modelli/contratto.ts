// Fase B4 — CONTRATTO dei dati che servono alle email delle notifiche di Tender Intelligence (decisione dell'utente del 19/11, §1–3).
// Proposta di B1 da allineare con il tipo dell'evento che B2 pubblica in src/lib/radar/notifiche/tipi.ts: se i nomi divergono, il motore
// di B2 passa da un adattatore puro, senza cambiare i modelli. Qui solo tipi e costanti: nessun database, nessuna rete.

export type CategoriaEmailRadar = "nuove_opportunita" | "scadenze" | "rettifiche";

export type TipoEmailRadar =
  | "scadenza_10"
  | "scadenza_5"
  | "scadenza_1"
  // avviso immediato e separato per una gara salvata o monitorata quando mancano già meno di 10 giorni (decisione §4): mai il recupero
  // dei promemoria ormai trascorsi
  | "scadenza_ravvicinata"
  | "rettifica"
  | "proroga"
  | "documenti"
  | "nuove_opportunita";

export const CATEGORIA_EMAIL: Record<TipoEmailRadar, CategoriaEmailRadar> = {
  scadenza_10: "scadenze",
  scadenza_5: "scadenze",
  scadenza_1: "scadenze",
  scadenza_ravvicinata: "scadenze",
  rettifica: "rettifiche",
  proroga: "rettifiche",
  documenti: "rettifiche",
  nuove_opportunita: "nuove_opportunita",
};

/** Al massimo 20 gare nel riepilogo delle nuove opportunità (il tetto vale solo qui: scadenze e rettifiche non si perdono mai). */
export const MASSIMO_GARE_RIEPILOGO = 20;

/**
 * La scadenza come la dà la fonte. `ora` SOLO se indicata dalla fonte (radar_procedure.scadenza_ora_indicata): altrimenti null e l'email
 * scrive «ora non indicata dalla fonte». Mai un'ora presunta (regola 0102/0114).
 */
export type ScadenzaEmail = {
  // giorno di calendario a Roma, «AAAA-MM-GG»
  giorno: string;
  // «HH:MM» (ora di Roma) solo se indicata dalla fonte
  ora: string | null;
};

/** Una gara come compare nell'email: solo dati dell'archivio pubblico o della gara aggiunta dall'impresa stessa. */
export type GaraEmailRadar = {
  // denominazione (oggetto) della gara
  oggetto: string;
  stazioneAppaltante: string | null;
  // CIG dei lotti; vuoto = CIG assente (la riga non compare)
  cig: string[];
  scadenza: ScadenzaEmail | null;
  // tipologia dell'avviso come la indica la fonte (per esempio «Bando di gara», «Avviso di rettifica»)
  tipoAvviso: string | null;
  // fonti della gara (per esempio «TED», «PVL ANAC»)
  fonti: string[];
  // luogo di esecuzione (regione); null = non indicato
  luogo: string | null;
  // collegamento assoluto alla scheda in OMNIA AI
  urlScheda: string;
  // collegamento alla fonte ufficiale; null se non disponibile
  urlFonte: string | null;
  // data e ora (ISO) dell'ultima verifica sulla fonte
  ultimaVerifica: string | null;
};

/** Un cambiamento preso SOLO dall'evidenza conservata (avviso della fonte): mai inventato, mai da una riclassificazione interna. */
export type ModificaEmail = { campo: string; prima: string | null; dopo: string | null };

/** L'avviso ufficiale da cui viene il cambiamento. */
export type EvidenzaEmail = { avviso: string | null; url: string | null; pubblicatoIl: string | null };

export type DocumentoEmail = { nome: string; natura: "sostitutivo" | "integrativo" | "nuovo"; url: string | null };

type Base = {
  // l'impresa (account del titolare) a cui appartiene la lista salvate/monitorate o il profilo
  impresaId: string;
  impresaNome: string;
  // collegamento assoluto alla pagina delle preferenze delle notifiche
  urlPreferenze: string;
};

export type EventoEmailRadar =
  | (Base & { tipo: "scadenza_10" | "scadenza_5" | "scadenza_1"; gara: GaraEmailRadar })
  | (Base & { tipo: "scadenza_ravvicinata"; gara: GaraEmailRadar; giorniMancanti: number })
  | (Base & { tipo: "rettifica"; gara: GaraEmailRadar; modifiche: ModificaEmail[]; evidenza: EvidenzaEmail })
  | (Base & { tipo: "proroga"; gara: GaraEmailRadar; scadenzaPrecedente: ScadenzaEmail | null; evidenza: EvidenzaEmail })
  | (Base & { tipo: "documenti"; gara: GaraEmailRadar; documenti: DocumentoEmail[]; evidenza: EvidenzaEmail })
  | (Base & { tipo: "nuove_opportunita"; gare: GaraEmailRadar[]; altre: number; urlPerTe: string });

/**
 * Il destinatario: una persona DELL'IMPRESA (il titolare dell'impresa o un componente attivo del suo Ufficio Gare). Gli amministratori della
 * console di OMNIA AI non ricevono nulla in quanto tali. Chi è valido (email verificata, utente attivo, preferenze) lo decide il motore di B2
 * al momento dell'invio; qui serve solo per i testi.
 */
export type DestinatarioEmailRadar = { impresaId: string; nome: string | null; ruolo: "titolare" | "ufficio_gare" };

export type EmailRadar = { oggetto: string; html: string; testo: string };
