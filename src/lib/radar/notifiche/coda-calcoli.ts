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

import type { EsitoProvider } from "./provider";
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

/**
 * Il piano d'invio COMPLETO di una persona (20/11): come pianoInvio, ma il riepilogo delle nuove opportunità non entra MAI in un'email
 * raggruppata (il raggruppamento del contratto porta solo scadenze e modifiche). Il riepilogo è al più uno al giorno: parte da solo se c'è un
 * posto sotto il tetto oppure all'ultimo passaggio del giorno (anche oltre il tetto: non arriva mai un giorno dopo e non si perde);
 * altrimenti aspetta il passaggio successivo. Senza quota resta in coda come tutto il resto.
 */
export function pianoInvioCompleto(
  coda: readonly ConsegnaInCoda[],
  x: { oggi: string; ultimoPassaggioDelGiorno: boolean; quotaResidua: number | null; tetto?: number },
): PianoInvio {
  const riepiloghi = coda.filter((c) => c.tipo === "riepilogo_opportunita");
  const altri = coda.filter((c) => c.tipo !== "riepilogo_opportunita");
  const piano = pianoInvio(altri, x);
  if (!riepiloghi.length) return piano;
  if (x.quotaResidua !== null && x.quotaResidua <= 0) return { ...piano, rinviate: [...piano.rinviate, ...riepiloghi.map((c) => c.id)] };
  const tetto = x.tetto ?? MASSIMO_EMAIL_SINGOLE_PER_PASSAGGIO;
  const usati = piano.singole.length + (piano.raggruppate.length ? 1 : 0);
  const quotaLibera = x.quotaResidua === null || x.quotaResidua - usati > 0;
  const singole = [...piano.singole];
  const rinviate = [...piano.rinviate];
  for (const r of [...new Map(riepiloghi.map((c) => [c.id, c])).values()].sort(ordine)) {
    if (quotaLibera && (singole.length < tetto || x.ultimoPassaggioDelGiorno || r.giornoEvento < x.oggi)) singole.push(r.id);
    else rinviate.push(r.id);
  }
  return { singole, raggruppate: piano.raggruppate, rinviate };
}

/** Le colonne di una consegna che cambiano dopo un tentativo (nomi del database). */
export type AggiornamentoConsegna = {
  stato: "in_coda" | "inviata" | "fallita" | "esito_incerto";
  tentativi: number;
  primo_tentativo_il: string | null;
  prossimo_tentativo_il: string;
  in_invio_fino_il: null;
  provider: "finto" | "resend";
  provider_id: string | null;
  inviata_il: string | null;
  ultimo_errore: string | null;
  motivo: string | null;
  chiusa_il: string | null;
  aggiornata_il: string;
};

/**
 * Dopo un tentativo: lo stato nuovo della consegna (26B §5.4). Regole:
 *   - inviata: chiusa con l'identificativo del provider;
 *   - errore transitorio: di nuovo in coda dopo l'attesa (retry-after se il provider la indica, altrimenti 5 min, 30 min, 2 h, 6 h, 12 h),
 *     SOLO entro la finestra dell'idempotenza (24 ore dal primo tentativo): oltre, o finiti i tentativi, «esito_incerto» se la richiesta
 *     potrebbe essere arrivata (mai un rinvio alla cieca che potrebbe duplicare), altrimenti «fallita»;
 *   - quota esaurita: di nuovo in coda il giorno dopo, SENZA contare un tentativo (nulla è partito);
 *   - 409 contenuto diverso con la stessa chiave: «esito_incerto»;
 *   - errore definitivo: «fallita» con il codice (mai indirizzi).
 * Il codice dell'errore si conserva accorciato e solo con caratteri sicuri.
 */
export function esitoDopoInvio(
  c: { tentativi: number; primoTentativoIl: string | null },
  e: EsitoProvider,
  provider: "finto" | "resend",
  adesso: Date,
  regole: { attesaMinuti: readonly number[]; finestraOre: number },
): AggiornamentoConsegna {
  const ora = adesso.toISOString();
  const codice = (s: string) => s.replace(/[^a-z0-9_.:-]/gi, "_").slice(0, 60);
  const base = { in_invio_fino_il: null, provider, provider_id: null, inviata_il: null, ultimo_errore: null, motivo: null, chiusa_il: null, aggiornata_il: ora } as const;
  if (e.esito === "quota") {
    const domani = new Date(Date.UTC(adesso.getUTCFullYear(), adesso.getUTCMonth(), adesso.getUTCDate() + 1, 5, 30));
    return { ...base, stato: "in_coda", tentativi: c.tentativi, primo_tentativo_il: c.primoTentativoIl, prossimo_tentativo_il: domani.toISOString(), ultimo_errore: codice(e.codice), motivo: "quota_provider" };
  }
  const tentativi = c.tentativi + 1;
  const primo = c.primoTentativoIl ?? ora;
  if (e.esito === "inviata") {
    return { ...base, stato: "inviata", tentativi, primo_tentativo_il: primo, prossimo_tentativo_il: ora, provider_id: e.providerId.slice(0, 200), inviata_il: ora, chiusa_il: ora };
  }
  if (e.esito === "incerto") {
    return { ...base, stato: "esito_incerto", tentativi, primo_tentativo_il: primo, prossimo_tentativo_il: ora, ultimo_errore: codice(e.codice), motivo: "contenuto_diverso_stessa_chiave", chiusa_il: ora };
  }
  if (e.esito === "fallita") {
    return { ...base, stato: "fallita", tentativi, primo_tentativo_il: primo, prossimo_tentativo_il: ora, ultimo_errore: codice(e.codice), motivo: e.configurazione ? "configurazione_provider" : "rifiutata_dal_provider", chiusa_il: ora };
  }
  // riprova
  const attesaMin = e.attesaSecondi !== null ? e.attesaSecondi / 60 : regole.attesaMinuti[Math.min(tentativi - 1, regole.attesaMinuti.length - 1)];
  const prossimo = new Date(adesso.getTime() + attesaMin * 60_000);
  const limite = Date.parse(primo) + regole.finestraOre * 3_600_000;
  const finiti = tentativi > regole.attesaMinuti.length;
  if (finiti || prossimo.getTime() >= limite) {
    return {
      ...base,
      stato: e.dopoInvio ? "esito_incerto" : "fallita",
      tentativi,
      primo_tentativo_il: primo,
      prossimo_tentativo_il: ora,
      ultimo_errore: codice(e.codice),
      motivo: finiti ? "tentativi_esauriti" : "finestra_idempotenza_scaduta",
      chiusa_il: ora,
    };
  }
  return { ...base, stato: "in_coda", tentativi, primo_tentativo_il: primo, prossimo_tentativo_il: prossimo.toISOString(), ultimo_errore: codice(e.codice), motivo: null };
}
