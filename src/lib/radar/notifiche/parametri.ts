// Fase B4 (20/11/2026, B2) — PARAMETRI del motore delle notifiche email, isolati e con un nome. Le decisioni N1, N5, N6 e N7 del rapporto
// 38 (§1) sono ANCORA APERTE: qui c'è il valore PROPOSTO, e il motore riceve i parametri come argomento, così le prove usano anche l'altro
// valore e cambiarli dopo la decisione dell'utente tocca solo questo file.

export type ParametriNotifiche = {
  /**
   * N1 (proposta: sì) — un'impresa riceve gli avvisi solo con un abbonamento OMNIA AI valido (decisione D-E8 del 26B). Con false, conta solo
   * che il Radar sia attivo in console e che il titolare abbia acceso le email.
   */
  abbonamentoRichiesto: boolean;
  /** N5 (proposta: sì) — il riepilogo delle «nuove» non elenca le gare che l'impresa ha già salvato o monitorato. */
  escludiGiaSalvateDalRiepilogo: boolean;
  /**
   * N6 (proposta: 7) — giorni dopo la chiusura di tutte le consegne entro cui si compattano i `dati` dei RIEPILOGHI (pesano circa 20 KB).
   * Gli altri eventi seguono la decisione D-E7 (30 giorni).
   */
  giorniCompattazioneRiepiloghi: number;
  /** D-E7 (approvata): giorni dopo i quali si compattano i dati degli altri eventi. */
  giorniCompattazioneAltri: number;
  /** D-E7 (approvata): giorni dopo i quali si cancellano eventi, consegne e giri (12 mesi). */
  giorniConservazione: number;
  /**
   * N7 (proposta: sì) — un passaggio «invio» senza consegne da inviare non scrive una riga di giro (resta 1 sola richiesta, la presa in
   * carico vuota); si registra comunque un «battito» al giorno. Con false ogni passaggio scrive il suo giro.
   */
  giroInvioSoloConLavoro: boolean;
};

export const PARAMETRI_PROPOSTI: Readonly<ParametriNotifiche> = Object.freeze({
  abbonamentoRichiesto: true,
  escludiGiaSalvateDalRiepilogo: true,
  giorniCompattazioneRiepiloghi: 7,
  giorniCompattazioneAltri: 30,
  giorniConservazione: 365,
  giroInvioSoloConLavoro: true,
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
