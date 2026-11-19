// Fase B4 (19/11/2026, B2) — CONTRATTO delle notifiche email di Tender Intelligence tra il motore (B2) e i modelli delle email (B1).
// SOLO TIPI e poche funzioni pure: nessun database, nessuna rete, nessun invio. Le email sono SPENTE (interruttore RADAR_NOTIFICHE_EMAIL,
// provider finto ovunque tranne nella futura produzione autorizzata). Decisione dell'utente del 19/11 (documento 26) e piano 26B.
//
// Come si usa:
//   - il motore di B2 costruisce un EventoRadar dai dati del database (fatti della gara + evidenza delle modifiche) e lo CONGELA: i dati
//     dell'email si fissano quando nasce l'evento e non si ricalcolano agli invii successivi;
//   - per ogni destinatario valido (ricontrollato al momento dell'invio) il motore chiama la funzione di B1
//       componiEmailRadar(evento, destinatario) → { oggetto, html, testo }
//     che deve essere PURA e DETERMINISTICA: stessi ingressi = stessa uscita, byte per byte. Niente Date.now(), niente casualità, niente
//     letture: l'invio verso Resend usa una chiave di idempotenza (Idempotency-Key, 24 ore) che esige lo STESSO contenuto a ogni tentativo.
//
// Regole che i modelli devono rispettare (documento 26, §2):
//   - l'ora della scadenza SOLO se `ora` non è null; altrimenti «ora non indicata dalla fonte». MAI un'ora presunta (né 23:59 né altro);
//   - le modifiche SOLO da `modifiche` ed `evidenza` (valori già letti e conservati dal motore), mai dedotte o inventate;
//   - sempre: denominazione, stazione appaltante, CIG se presenti, tipo di avviso, collegamento alla scheda OMNIA AI, collegamento alla fonte
//     ufficiale se c'è, data dell'ultima verifica, avvertenza «servizio informativo: verificare sempre la documentazione ufficiale»,
//     collegamento alle preferenze;
//   - l'email è per UN destinatario di UNA impresa: nessun dato di altre imprese.

export const VERSIONE_CONTRATTO_NOTIFICHE = 1;

/** Le tre categorie che il titolare e ogni destinatario possono accendere o spegnere separatamente. */
export const CATEGORIE_NOTIFICA = ["nuove_opportunita", "scadenze", "rettifiche"] as const;
export type CategoriaNotifica = (typeof CATEGORIE_NOTIFICA)[number];

/**
 * I tipi di evento.
 *   - scadenza_10 / scadenza_5 / scadenza_1: promemoria a 10, 5 e 1 giorno di calendario (Europe/Rome) dalla scadenza (eventi A, B, C);
 *   - scadenza_ravvicinata: avviso separato per una gara entrata nella lista quando mancano ormai pochi giorni (proposta, decisione D-E2);
 *   - rettifica: avviso ufficiale di rettifica con cambiamenti rilevati (D);
 *   - proroga: la scadenza è stata spostata più avanti (E); modifica_scadenza: la scadenza è cambiata in altro modo, per esempio anticipata (E);
 *   - documenti: documenti sostitutivi o integrativi, SOLO dove il connettore lo rileva in modo affidabile (F);
 *   - annullamento: la gara è stata annullata dalla fonte (proposto, nella categoria delle rettifiche);
 *   - riepilogo_opportunita: riepilogo delle nuove gare pertinenti per il profilo (al massimo 20 per impresa per giro).
 */
export const TIPI_EVENTO = [
  "scadenza_10",
  "scadenza_5",
  "scadenza_1",
  "scadenza_ravvicinata",
  "rettifica",
  "proroga",
  "modifica_scadenza",
  "documenti",
  "annullamento",
  "riepilogo_opportunita",
] as const;
export type TipoEvento = (typeof TIPI_EVENTO)[number];

export const CATEGORIA_DEL_TIPO: Readonly<Record<TipoEvento, CategoriaNotifica>> = {
  scadenza_10: "scadenze",
  scadenza_5: "scadenze",
  scadenza_1: "scadenze",
  scadenza_ravvicinata: "scadenze",
  rettifica: "rettifiche",
  proroga: "rettifiche",
  modifica_scadenza: "rettifiche",
  documenti: "rettifiche",
  annullamento: "rettifiche",
  riepilogo_opportunita: "nuove_opportunita",
};

/** Giorni di calendario mancanti per i tre promemoria. */
export const GIORNI_PROMEMORIA = { scadenza_10: 10, scadenza_5: 5, scadenza_1: 1 } as const satisfies Partial<Record<TipoEvento, number>>;

/** Tetto del riepilogo delle nuove opportunità (decisione del 19/11): vale SOLO per il riepilogo, mai per scadenze e rettifiche. */
export const MASSIMO_GARE_RIEPILOGO = 20;

/**
 * Una scadenza come è NOTA. `giorno` è sempre il giorno di calendario a Roma. `ora` e `istante` ci sono SOLO se la fonte indica l'ora
 * (radar_procedure.scadenza_ora_indicata, regola 0102/0114): altrimenti sono null e l'email dice «ora non indicata dalla fonte».
 */
export type ScadenzaNota = {
  /** AAAA-MM-GG, Europe/Rome */
  giorno: string;
  /** "HH:MM" Europe/Rome, solo se indicata dalla fonte */
  ora: string | null;
  /** ISO 8601 con fuso, solo se l'ora è indicata */
  istante: string | null;
  /** chi l'ha indicata: la fonte ufficiale, oppure l'impresa stessa per una gara aggiunta a mano */
  origine: "fonte" | "impresa";
};

/** Fonte di una gara, con il nome da mostrare (per esempio { fonte: "ted", nome: "TED (Gazzetta UE)" }). */
export type FonteGara = { fonte: string; nome: string };

/** Un lotto con una scadenza diversa da quella della gara (si elencano nell'email, senza promemoria separati nella prima versione). */
export type LottoConScadenza = { numero: string; titolo: string | null; cig: string | null; scadenza: ScadenzaNota };

/** I dati di una gara per l'email, già letti e formattati dal motore. */
export type GaraEmail = {
  /** chiave della gara nella lista dell'impresa: "p:<id di radar_procedure>" oppure "a:<id della gara aggiunta a mano>" */
  chiave: string;
  proceduraId: string | null;
  aggiuntaId: string | null;
  /** oggetto della gara (denominazione) */
  denominazione: string;
  /** stazione appaltante; null se la fonte non la indica */
  stazioneAppaltante: string | null;
  /** CIG noti (della gara o dei lotti), senza doppioni; vuoto se nessuno */
  cig: string[];
  /** tipo dell'avviso, già in parole (es. «Bando di gara», «Avviso di rettifica»); null se non noto */
  tipoAvviso: string | null;
  /** scadenza per le offerte; null se la fonte non la indica (allora niente promemoria di scadenza) */
  scadenza: ScadenzaNota | null;
  /** lotti con scadenze diverse da quella della gara; vuoto nel caso normale */
  lottiConScadenzeDiverse: LottoConScadenza[];
  /** luogo di esecuzione in parole (regioni); null se non indicato */
  luogo: string | null;
  /** collegamento ASSOLUTO alla scheda OMNIA AI della gara */
  urlScheda: string;
  /** collegamento alla fonte ufficiale (avviso o documenti); null se non c'è */
  urlFonteUfficiale: string | null;
  fonti: FonteGara[];
  /**
   * data dell'ultima verifica DISPONIBILE (ISO 8601): l'ultimo aggiornamento di questa gara rilevato dalla fonte
   * (radar_procedure.ultima_rilevazione_il). Le letture senza cambiamenti non si registrano gara per gara: il modello scrive «ultimo
   * aggiornamento rilevato dalla fonte il …», non «verificata il …».
   */
  ultimaVerificaIl: string;
  /** la gara è stata aggiunta a mano dall'impresa (dati inseriti dall'impresa, non da una fonte ufficiale) */
  aggiuntaAMano: boolean;
};

/** Un cambiamento rilevato, con i valori GIÀ LEGGIBILI presi dall'evidenza conservata (mai ricalcolati o dedotti). */
export type ModificaRilevata = {
  campo: "scadenza" | "importo" | "oggetto" | "documenti" | "lotti" | "stato";
  /** per esempio «Scadenza per la presentazione delle offerte» */
  etichetta: string;
  prima: string | null;
  dopo: string | null;
};

/** Da dove viene la modifica: l'avviso della fonte che l'ha pubblicata e quando OMNIA AI l'ha rilevata. */
export type EvidenzaModifica = {
  fonte: string;
  nomeFonte: string;
  /** identificativo dell'avviso di modifica nella fonte (per esempio il numero di pubblicazione TED) */
  avvisoId: string | null;
  avvisoUrl: string | null;
  /** data di pubblicazione dell'avviso di modifica (AAAA-MM-GG) se la fonte la indica */
  pubblicatoIl: string | null;
  /** quando OMNIA AI l'ha rilevata (ISO 8601) */
  rilevatoIl: string;
  /**
   * avviso_ufficiale: la fonte ha pubblicato un avviso di modifica (per TED: versione successiva o codice del motivo);
   * confronto_versioni: OMNIA AI ha confrontato due versioni ufficiali della stessa gara pubblicate dalla fonte.
   * Le modifiche non verificate (inferenze, formattazione, riclassificazioni interne) NON diventano mai eventi.
   */
  affidabilita: "avviso_ufficiale" | "confronto_versioni";
  /** motivo indicato dalla fonte, già in parole (per esempio «Correzione da parte dell'amministrazione»); null se non indicato */
  motivoFonte: string | null;
};

type EventoBase = {
  /** identificativo dell'evento (riga di omnia_ai_radar_eventi) */
  id: string;
  /** l'impresa: l'utente titolare dell'account OMNIA AI */
  impresaId: string;
  nomeImpresa: string | null;
  categoria: CategoriaNotifica;
  tipo: TipoEvento;
  /**
   * versione del fatto: per le scadenze l'impronta della scadenza (istante se c'è l'ora, altrimenti il giorno); per le modifiche
   * l'identificativo della modifica registrata; per il riepilogo il giorno del giro. Con destinatario, gara e tipo forma la chiave unica.
   */
  versione: string;
  /** quando è nato l'evento (ISO 8601) */
  creatoIl: string;
};

export type EventoScadenza = EventoBase & {
  categoria: "scadenze";
  tipo: "scadenza_10" | "scadenza_5" | "scadenza_1" | "scadenza_ravvicinata";
  gara: GaraEmail & { scadenza: ScadenzaNota };
  /** giorni di calendario mancanti a Roma il giorno dell'evento (10, 5, 1; per la ravvicinata 0, 1 o 2) */
  giorniMancanti: number;
};

export type EventoModifica = EventoBase & {
  categoria: "rettifiche";
  tipo: "rettifica" | "proroga" | "modifica_scadenza" | "documenti" | "annullamento";
  gara: GaraEmail;
  /**
   * le modifiche rilevate. Vuoto in due soli casi: «annullamento», oppure un avviso UFFICIALE di modifica (evidenza.affidabilita =
   * "avviso_ufficiale") in cui i campi confrontati da OMNIA AI non sono cambiati: il modello scrive che la fonte ha pubblicato un avviso di
   * modifica e che i dettagli vanno letti nell'avviso ufficiale, senza elencare o supporre cambiamenti.
   */
  modifiche: ModificaRilevata[];
  evidenza: EvidenzaModifica;
  /** per proroga e modifica_scadenza: la scadenza precedente (la nuova è in gara.scadenza) */
  scadenzaPrecedente: ScadenzaNota | null;
};

/** Una gara del riepilogo, con il perché è pertinente per il profilo dell'impresa. */
export type GaraRiepilogo = GaraEmail & {
  settori: { settore: string; nome: string; sottocategorie: string[] }[];
  /** motivi leggibili, per esempio «nel tuo profilo: Pulizia › Pulizia di edifici · Lombardia» */
  perche: string[];
};

export type EventoRiepilogo = EventoBase & {
  categoria: "nuove_opportunita";
  tipo: "riepilogo_opportunita";
  /** al più MASSIMO_GARE_RIEPILOGO gare, le più recenti prima */
  gare: GaraRiepilogo[];
  /** gare pertinenti oltre il tetto, non elencate (visibili in «Per te») */
  altreNonIncluse: number;
  /** collegamento ASSOLUTO a «Per te» */
  urlPerTe: string;
};

export type EventoRadar = EventoScadenza | EventoModifica | EventoRiepilogo;

/** Il ruolo del destinatario NELL'IMPRESA. Gli amministratori della console OMNIA AI non ricevono nulla in quanto tali. */
export type RuoloDestinatario = "titolare" | "ufficio_gare";

/**
 * Il destinatario, ricontrollato al momento dell'invio: titolare dell'impresa o membro ATTIVO del suo Ufficio Gare, email confermata,
 * utente non bloccato né cancellato, impresa con le email accese, categoria accesa per questa persona.
 * `email` esiste solo in memoria durante l'invio: non si salva nella coda.
 */
export type DestinatarioEmail = {
  userId: string;
  impresaId: string;
  ruolo: RuoloDestinatario;
  email: string;
  /** nome per il saluto; null = saluto generico */
  nome: string | null;
  /** collegamento ASSOLUTO alla pagina delle preferenze delle notifiche */
  urlPreferenze: string;
};

/** Quello che restituisce il modello di B1. */
export type EmailComposta = { oggetto: string; html: string; testo: string };

/** La firma della funzione di B1 (src/lib/radar/email-modelli/**): pura e deterministica. */
export type ComponiEmailRadar = (evento: EventoRadar, destinatario: DestinatarioEmail) => EmailComposta;

/** Categoria di un tipo di evento. */
export function categoriaDelTipo(tipo: TipoEvento): CategoriaNotifica {
  return CATEGORIA_DEL_TIPO[tipo];
}

/** Impronta della versione di una scadenza: l'istante se l'ora è nota, altrimenti il giorno (stessa regola di valoreScadenza). */
export function versioneScadenza(s: Pick<ScadenzaNota, "giorno" | "istante">): string {
  return s.istante ? new Date(s.istante).toISOString() : s.giorno;
}
