// Fase B4 (19/11/2026, B2) — piano d'invio della coda per UN destinatario in UN passaggio (modifica 1 dell'approvazione definitiva).
// Logica PURA: nessun database, nessuna rete.
//
// Regole (testo dell'utente: «Confermo il limite di 15 email singole per destinatario e per giro, ma nessun avviso urgente deve arrivare
// fuori tempo utile… raggruppamento intelligente… senza duplicati e rispettando i limiti del provider. Le email non devono andare perse»):
//   - al più MASSIMO_EMAIL_SINGOLE_PER_PASSAGGIO email singole per persona e per passaggio, in ordine di priorità (urgenti prima);
//   - gli URGENTI oltre il tetto NON si rinviano: partono subito in UNA email raggruppata (EventoRaggruppato), con le consegne segnate
//     «incluse» (nessun doppione: non partiranno più da sole);
//   - i NON urgenti oltre il tetto (promemoria a 10 e 5 giorni, riepilogo) passano al passaggio successivo; all'ULTIMO passaggio del loro
//     giorno di Roma entrano anch'essi nel raggruppamento, così non arrivano mai con un giorno di ritardo e non si perdono;
//   - se il provider ha poca quota residua, si raggruppa prima, per far stare TUTTI gli urgenti nella quota (mai prima i non urgenti).

import { MASSIMO_EMAIL_SINGOLE_PER_PASSAGGIO, TIPI_URGENTI, type TipoEvento } from "./tipi";

/** Priorità (1 = prima) per tipo: piano 26B §2.2, con gli urgenti sempre davanti. */
export const PRIORITA_DEL_TIPO: Readonly<Record<TipoEvento, number>> = {
  scadenza_1: 1,
  scadenza_ravvicinata: 1,
  proroga: 2,
  modifica_scadenza: 2,
  annullamento: 2,
  rettifica: 3,
  documenti: 3,
  scadenza_5: 4,
  scadenza_10: 5,
  riepilogo_opportunita: 6,
};

export type ConsegnaInCoda = { id: string; tipo: TipoEvento; creataIl: string; giornoEvento: string };

export type PianoInvio = {
  /** email singole da inviare ora, in ordine */
  singole: string[];
  /** consegne da inviare ora in UNA email raggruppata (vuoto = nessun raggruppamento) */
  raggruppate: string[];
  /** consegne che restano in coda per il passaggio successivo (solo non urgenti) */
  rinviate: string[];
};

function ordine(a: ConsegnaInCoda, b: ConsegnaInCoda): number {
  return PRIORITA_DEL_TIPO[a.tipo] - PRIORITA_DEL_TIPO[b.tipo] || a.creataIl.localeCompare(b.creataIl) || a.id.localeCompare(b.id);
}

/**
 * Il piano d'invio di una persona per questo passaggio.
 *   - `ultimoPassaggioDelGiorno`: nessun passaggio successivo nello stesso giorno di Roma;
 *   - `quotaResidua`: email che il provider accetta ancora (null = sconosciuta). Una email raggruppata conta 1.
 */
export function pianoInvio(
  coda: readonly ConsegnaInCoda[],
  x: { oggi: string; ultimoPassaggioDelGiorno: boolean; quotaResidua: number | null; tetto?: number },
): PianoInvio {
  const tetto = x.tetto ?? MASSIMO_EMAIL_SINGOLE_PER_PASSAGGIO;
  const ordinate = [...new Map(coda.map((c) => [c.id, c])).values()].sort(ordine);
  const urgenti = ordinate.filter((c) => TIPI_URGENTI.includes(c.tipo));
  const altri = ordinate.filter((c) => !TIPI_URGENTI.includes(c.tipo));
  // i non urgenti del giorno (o di giorni passati) all'ultimo passaggio del giorno non possono più aspettare
  const nonPossonoAspettare = (c: ConsegnaInCoda) => x.ultimoPassaggioDelGiorno || c.giornoEvento < x.oggi;

  // quante email singole si possono mandare: il tetto, ridotto dalla quota residua (tenendo 1 posto per l'eventuale raggruppamento)
  let posti = tetto;
  if (x.quotaResidua !== null) posti = Math.max(0, Math.min(posti, x.quotaResidua - 1));

  if (urgenti.length + altri.length <= posti) return { singole: ordinate.map((c) => c.id), raggruppate: [], rinviate: [] };

  const singole: ConsegnaInCoda[] = [];
  const raggruppate: ConsegnaInCoda[] = [];
  const rinviate: ConsegnaInCoda[] = [];
  // 1) urgenti: i primi «posti» da soli, gli altri raggruppati (mai rinviati)
  for (const c of urgenti) (singole.length < posti ? singole : raggruppate).push(c);
  // 2) non urgenti: nei posti rimasti; oltre, rinviati, oppure raggruppati se non possono aspettare
  for (const c of altri) {
    if (singole.length < posti) singole.push(c);
    else if (nonPossonoAspettare(c)) raggruppate.push(c);
    else rinviate.push(c);
  }
  // anche un raggruppamento di una sola consegna resta «raggruppato»: le email singole non superano mai il tetto
  // senza quota per niente: tutto resta in coda (nulla si perde), urgenti compresi; la console mostra l'allarme della quota
  if (x.quotaResidua !== null && x.quotaResidua <= 0) return { singole: [], raggruppate: [], rinviate: ordinate.map((c) => c.id) };
  return { singole: singole.map((c) => c.id), raggruppate: raggruppate.map((c) => c.id), rinviate: rinviate.map((c) => c.id) };
}

/** Chiave della consegna raggruppata: stessa persona + insieme ordinato delle consegne incluse (stesso insieme = stessa chiave). */
export function chiaveRaggruppamento(destinatarioId: string, consegneIncluse: readonly string[], impronta: (s: string) => string): string {
  return `${destinatarioId}:raggruppamento:${impronta([...new Set(consegneIncluse)].sort().join(","))}`;
}
