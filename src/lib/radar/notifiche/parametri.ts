// Fase B4 (20/11/2026, B2) — PARAMETRI del motore delle notifiche email, isolati e con un nome. Il motore li riceve come argomento, così le
// prove usano anche l'altro valore e un cambio tocca solo questo file. Stato delle decisioni del rapporto 38 (§1), secondo il 40B:
//   - N1 DECISA (decisione 8 del piano 26, approvata il 19/11: «Abbonamento scaduto: nessuna email»);
//   - N5 ANCORA DA DECIDERE: qui c'è il valore PROPOSTO («sì»);
//   - N6 DECISA (20/11: 30 giorni; 7 respinto);
//   - N7 RECEPITA come scelta tecnica.
//
// Compattazione e conservazione restano TRE parametri distinti, anche se oggi due valgono uguale (decisione N6 dell'utente: «Mantieni
// separati i tempi di compattazione dei riepiloghi dalle regole di conservazione degli eventi, degli esiti di invio e dei dati necessari
// all'idempotenza»). La compattazione annulla SOLO il testo congelato dell'evento (`dati`, con l'ora in `dati_compattati_il`): chiavi uniche,
// chiavi di idempotenza, stato ed esiti delle consegne restano, quindi un evento o una consegna non rinascono (prova in
// scripts/verifica-radar-b4-db-motore.ts, «compattazione: chiavi ed esiti intatti»).

export type ParametriNotifiche = {
  /**
   * N1 DECISA (decisione 8 del piano 26, approvata il 19/11: «Abbonamento scaduto: nessuna email») — un'impresa riceve gli avvisi solo con
   * un abbonamento OMNIA AI valido (decisione D-E8 del 26B). Con false (non in uso) conterebbero solo il Radar attivo in console e le email
   * accese dal titolare.
   */
  abbonamentoRichiesto: boolean;
  /** N5 ANCORA DA DECIDERE (proposta: sì) — il riepilogo delle «nuove» non elenca le gare che l'impresa ha già salvato o monitorato. */
  escludiGiaSalvateDalRiepilogo: boolean;
  /**
   * N6 decisa il 20/11: 30 giorni; 7 respinto. Giorni dalla creazione dell'evento dopo i quali si compatta il testo (`dati`, circa 20 KB) dei
   * RIEPILOGHI. Motivo dell'utente: affidabilità, tracciabilità, prevenzione dei duplicati e diagnosi delle anomalie. Distinto dagli altri due.
   */
  giorniCompattazioneRiepiloghi: number;
  /** D-E7 (approvata): giorni dopo i quali si compatta il testo (`dati`) degli altri eventi. Distinto dagli altri due. */
  giorniCompattazioneAltri: number;
  /** D-E7 (approvata): giorni dopo i quali si CANCELLANO eventi, consegne (con i loro esiti) e giri: 12 mesi. Distinto dalla compattazione. */
  giorniConservazione: number;
  /**
   * N7 RECEPITA come scelta tecnica (sì) — un passaggio «invio» senza consegne da inviare non scrive una riga di giro (resta la sola presa in
   * carico vuota, 1 richiesta); si registra comunque un «battito» al giorno. Con false ogni passaggio scriverebbe il suo giro.
   */
  giroInvioSoloConLavoro: boolean;
};

export const PARAMETRI_PROPOSTI: Readonly<ParametriNotifiche> = Object.freeze({
  abbonamentoRichiesto: true, // N1 decisa (decisione 8 del piano 26, 19/11)
  escludiGiaSalvateDalRiepilogo: true, // N5 ancora da decidere: valore proposto
  giorniCompattazioneRiepiloghi: 30, // N6 decisa il 20/11: 30 giorni; 7 respinto
  giorniCompattazioneAltri: 30,
  giorniConservazione: 365,
  giroInvioSoloConLavoro: true, // N7 recepita come scelta tecnica
});

/** Le gare «nuove» del riepilogo: pubblicate al più da questi giorni (26B §5.2 passo f). */
export const FINESTRA_NUOVE_GIORNI = 7;
/** Presa in carico della coda: blocchi di consegne e durata dell'«affitto» (26B §5.4). */
export const BLOCCO_INVIO = 50;
export const AFFITTO_MINUTI = 10;
/** Al più 2 invii al secondo (il limite di Resend, 10 al secondo, è di tutto il team). */
export const INVII_AL_SECONDO = 2;
/** Attese tra i tentativi (26B §5.4): 5 min, 30 min, 2 h, 6 h, 12 h; poi la finestra di 24 ore dell'idempotenza. */
export const ATTESE_TENTATIVI_MINUTI: readonly number[] = [5, 30, 120, 360, 720];
export const FINESTRA_IDEMPOTENZA_ORE = 24;
/** Una raggruppata fallita in modo definitivo rimette in coda le sue incluse al più tante volte (appendice C.1). */
export const RIPROVE_RAGGRUPPATA = 2;
/** Tempo massimo di un giro, come il giro TED: il resto resta in coda. */
export const TEMPO_MASSIMO_GIRO_MS = 240_000;
/** Durata massima del blocco «uno alla volta» del giro (se il processo cade, il blocco scade da solo). */
export const BLOCCO_GIRO_MINUTI = 15;
/** Allarmi della console: nessun giro «eventi» riuscito da tante ore; falliti oltre questa quota del giorno. */
export const ORE_ALLARME_GIRO_MANCATO = 36;
export const QUOTA_ALLARME_FALLITI = 0.05;
/** Righe per ogni richiesta di scrittura a blocchi. */
export const BLOCCO_SCRITTURA = 200;
