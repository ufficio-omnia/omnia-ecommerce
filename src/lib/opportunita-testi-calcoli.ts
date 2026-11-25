// Testi dell'area «Opportunità» sugli avvisi email (richiesta del coordinamento del 25/11, dopo l'accensione delle email ai clienti, F8).
// Logica PURA: nessun database, nessuna rete. Le frasi dicono SOLO ciò che fa il motore delle notifiche di B2 (src/lib/radar/notifiche):
//   - scadenze: promemoria a 10, 5 e 1 giorno di calendario dalla scadenza (GIORNI_PROMEMORIA, tipi.ts) e l'avviso «scadenza ravvicinata»
//     una volta sola per una gara entrata nella lista a pochi giorni dalla scadenza (ravvicinata.ts);
//   - rettifiche: rettifica, proroga, modifica della scadenza, annullamento (CATEGORIA_DEL_TIPO); MAI «documenti» (eventi-calcoli.ts: nessuna
//     fonte li rileva in modo attendibile);
//   - nuove opportunità: un riepilogo delle nuove gare in linea con il profilo dell'impresa (al massimo 20 per invio);
//   - gare SALVATE e MONITORATE: per il motore sono la STESSA lista (motore.ts legge tutte le righe di omnia_ai_radar_salvate, senza il campo
//     «monitorata»; eventi-calcoli.ts: «le gare SALVATE o MONITORATE ricevono scadenze e rettifiche»; 0125: «una gara salvata e monitorata =
//     un solo evento»). Anche le novità in «Salvate e monitorate» valgono per entrambe. «Monitora» è un segno in più, non altri avvisi.
// Chi può accendere cosa (pagina «Notifiche», notifiche-preferenze-calcoli.ts): gli avvisi dell'IMPRESA li accende solo il titolare; le
// preferenze personali il titolare per tutti, l'Ufficio Gare solo le proprie e SOLO per spegnere.

export type RuoloOpportunita = "titolare" | "ufficio_gare";
export type CategorieAvvisi = { nuove_opportunita: boolean; scadenze: boolean; rettifiche: boolean };

/** Lo stato letto dal server per l'avviso. `lettura: false` = tabelle assenti o lettura non riuscita: nessun avviso. */
export type StatoAvvisiPersona = {
  /** interruttore unico del motore acceso (invioEmailAcceso, notifiche/interruttore.ts) */
  motoreAcceso: boolean;
  /** pagina «Notifiche» disponibile (preferenzeNotificheAttive, interruttori-b4.ts): il pulsante non porta mai a una pagina inesistente */
  paginaNotifiche: boolean;
  /** abbonamento operativo: con il modulo in sola lettura le email non partono comunque */
  operativo: boolean;
  lettura: boolean;
  ruolo: RuoloOpportunita;
  /** omnia_ai_radar_notifiche_impresa.email_attive (riga assente = spente) */
  emailImpresaAttive: boolean;
  /** la riga della persona in omnia_ai_radar_notifiche_persone; null = nessuna riga = tutto spento */
  preferenze: CategorieAvvisi | null;
};

/**
 * «invito»: riquadro ben visibile con il pulsante verso «Notifiche» (chi guarda può accendere);
 * «nota»: una riga discreta (chi guarda non può accendere da sé, oppure ha già spento gli avvisi di proposito).
 */
export type AvvisoNotifiche = { forma: "invito" | "nota"; titolo: string | null; testo: string; pulsante: string };

export const TITOLO_INVITO = "Attiva gli avvisi email";
export const TESTO_AVVISI =
  "Ti scriviamo quando una gara salvata o monitorata sta per scadere (10, 5 e 1 giorno prima), quando cambia (rettifica, proroga, nuova scadenza o annullamento) e quando escono nuove gare in linea con il profilo dell'impresa.";
export const PULSANTE_NOTIFICHE = "Vai alle notifiche";
export const PULSANTE_VEDI_NOTIFICHE = "Vedi le notifiche";
export const NOTA_TITOLARE_SPENTI = "Hai spento i tuoi avvisi email. Puoi riattivarli quando vuoi dalla pagina Notifiche.";
export const NOTA_UFFICIO_IMPRESA_SPENTA =
  "Gli avvisi email dell'impresa sono spenti: può attivarli il titolare dell'impresa. Con gli avvisi attivi ti scriviamo quando una gara salvata o monitorata sta per scadere o cambia.";
export const NOTA_UFFICIO_PERSONALI_SPENTI = "I tuoi avvisi email sono spenti: può riattivarli il titolare dell'impresa dalla pagina Notifiche.";

/** Gli avvisi della persona sono attivi: impresa accesa e almeno una categoria personale accesa. */
export function avvisiAttivi(s: Pick<StatoAvvisiPersona, "emailImpresaAttive" | "preferenze">): boolean {
  return s.emailImpresaAttive && !!s.preferenze && (s.preferenze.nuove_opportunita || s.preferenze.scadenze || s.preferenze.rettifiche);
}

/** L'avviso da mostrare in testa alle pagine di «Opportunità», oppure null. */
export function avvisoNotifiche(s: StatoAvvisiPersona): AvvisoNotifiche | null {
  if (!s.motoreAcceso || !s.paginaNotifiche || !s.operativo || !s.lettura) return null;
  if (avvisiAttivi(s)) return null;
  // una riga che c'è con tutte le categorie spente = scelta fatta (dalla persona o dal titolare): niente riquadro insistente
  const sceltoDiSpegnere = !!s.preferenze;
  if (s.ruolo === "titolare") {
    if (s.emailImpresaAttive && sceltoDiSpegnere) return { forma: "nota", titolo: null, testo: NOTA_TITOLARE_SPENTI, pulsante: PULSANTE_NOTIFICHE };
    return { forma: "invito", titolo: TITOLO_INVITO, testo: TESTO_AVVISI, pulsante: PULSANTE_NOTIFICHE };
  }
  // Ufficio Gare: non può accendere né gli avvisi dell'impresa né le proprie categorie (solo spegnere): mai un invito ad agire
  if (!s.emailImpresaAttive) return { forma: "nota", titolo: null, testo: NOTA_UFFICIO_IMPRESA_SPENTA, pulsante: PULSANTE_VEDI_NOTIFICHE };
  return { forma: "nota", titolo: null, testo: NOTA_UFFICIO_PERSONALI_SPENTI, pulsante: PULSANTE_VEDI_NOTIFICHE };
}

// ───── «Salvate» e «Monitorate» (A2) ─────

/** Nella pagina della lista («Salvate e monitorate»). */
export const TESTO_LISTA_SALVATE =
  "Salvate e monitorate funzionano allo stesso modo: qui vedi le novità rilevate nelle fonti finché non apri la scheda e, con gli avvisi email attivi, arrivano per entrambe i promemoria di scadenza e gli avvisi di modifica. «Monitora» aggiunge solo un segno per le gare da seguire da vicino.";

/** Accanto ai pulsanti «Salva» e «Monitora» nella scheda della gara. */
export const TESTO_PULSANTI_SALVA =
  "«Salva» e «Monitora» mettono la gara nella lista dell'impresa, con gli stessi avvisi email su scadenze e modifiche, se attivi. «Monitora» la segna come gara da seguire da vicino.";
