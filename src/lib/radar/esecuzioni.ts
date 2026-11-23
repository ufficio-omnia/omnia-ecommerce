// Scrittura del registro dei giri (radar_esecuzioni, 0128; pacchetto K2 del piano 48C). Solo server, chiave di servizio.
// Ogni giro di un importatore passa da `giroRegistrato`: l'identificativo del giro nasce PRIMA del giro (lo stesso che la 0123 copia in
// radar_aggiornamenti.esecuzione_id), alla fine si scrive UNA riga (un insert: la 0128 non dà update) e si cancellano le righe della stessa
// fonte oltre i 90 giorni (una sola istruzione, sull'indice). Il registro non ferma MAI il giro: se la scrittura fallisce, il risultato lo
// dice e resta il log; l'allarme lo ricava dalla mancanza della riga (ultimo_avvio_il più recente dell'ultima riga, pacchetto K3).
// MAI una riga se l'ambiente non è consentito o se le tabelle mancano (esecuzioni-calcoli.ts, datiUscita).
import type { SupabaseClient } from "@supabase/supabase-js";
import { scrittureRadarConsentite } from "./ambiente";
import { GIORNI_CONSERVAZIONE_ESECUZIONI, rigaEsecuzione, type DatiGiro, type FonteEsecuzione, type OrigineGiro, type RigaEsecuzione } from "./esecuzioni-calcoli";

export type EsitoRegistro =
  | { scritta: true; id: string; cancellate: number | null; erroreCancellazione?: string }
  | { scritta: false; id: string | null; motivo: "non_registrato" | "ambiente_non_consentito" | "scrittura_fallita"; errore?: string };

export type OpzioniRegistro = { origine?: OrigineGiro; adesso?: () => Date; nuovoIdEsecuzione?: () => string; env?: Record<string, string | undefined> };

export function nuovoIdEsecuzione(): string {
  return globalThis.crypto.randomUUID();
}

const soglia = (adesso: Date) => new Date(adesso.getTime() - GIORNI_CONSERVAZIONE_ESECUZIONI * 86_400_000).toISOString();

/** Scrive la riga e cancella le righe della stessa fonte oltre i 90 giorni. Non lancia mai eccezioni. */
export async function scriviEsecuzione(admin: SupabaseClient, riga: RigaEsecuzione, adesso: Date): Promise<EsitoRegistro> {
  try {
    const { error } = await admin.from("radar_esecuzioni").insert(riga);
    if (error) {
      console.error("Tender Intelligence: registro del giro non scritto", riga.fonte, error.code ?? "", error.message);
      return { scritta: false, id: riga.id, motivo: "scrittura_fallita", errore: `${error.code ?? ""} ${error.message ?? ""}`.trim().slice(0, 300) };
    }
  } catch (e) {
    console.error("Tender Intelligence: registro del giro non scritto", riga.fonte, e instanceof Error ? e.message : String(e));
    return { scritta: false, id: riga.id, motivo: "scrittura_fallita", errore: (e instanceof Error ? e.message : String(e)).slice(0, 300) };
  }
  try {
    const { data, error } = await admin.from("radar_esecuzioni").delete().eq("fonte", riga.fonte).lt("iniziato_il", soglia(adesso)).select("id");
    if (error) return { scritta: true, id: riga.id, cancellate: null, erroreCancellazione: `${error.code ?? ""} ${error.message ?? ""}`.trim().slice(0, 300) };
    return { scritta: true, id: riga.id, cancellate: ((data ?? []) as unknown[]).length };
  } catch (e) {
    return { scritta: true, id: riga.id, cancellate: null, erroreCancellazione: (e instanceof Error ? e.message : String(e)).slice(0, 300) };
  }
}

/**
 * Esegue un giro e lo registra. `giro` riceve l'identificativo del giro; `comeDati` traduce il risultato nella riga (null = non registrare).
 * Se il giro lancia un'eccezione imprevista, la riga «errore» si scrive comunque e l'eccezione riparte verso chi ha chiamato.
 */
export async function giroRegistrato<R extends object>(
  admin: SupabaseClient,
  fonte: FonteEsecuzione,
  opzioni: OpzioniRegistro,
  giro: (esecuzioneId: string) => Promise<R>,
  comeDati: (r: R) => DatiGiro | null,
): Promise<R & { esecuzione: EsitoRegistro }> {
  const ora = opzioni.adesso ?? (() => new Date());
  const id = (opzioni.nuovoIdEsecuzione ?? nuovoIdEsecuzione)();
  const origine = opzioni.origine ?? "programmato";
  // la stessa regola degli importatori, controllata di nuovo qui: il registro non si scrive MAI dove la fonte non può scrivere
  const permesso = scrittureRadarConsentite(fonte, opzioni.env ?? process.env).ok;
  const iniziato = ora();
  let risultato: R;
  try {
    risultato = await giro(id);
  } catch (e) {
    const finito = ora();
    if (permesso) await scriviEsecuzione(admin, rigaEsecuzione({ id, fonte, origine, iniziato, finito, modo: "incrementale", esito: "errore", errore: `eccezione imprevista: ${e instanceof Error ? e.message : String(e)}` }), finito);
    throw e;
  }
  if (!permesso) return { ...risultato, esecuzione: { scritta: false, id: null, motivo: "ambiente_non_consentito" } };
  const dati = comeDati(risultato);
  if (!dati) return { ...risultato, esecuzione: { scritta: false, id: null, motivo: "non_registrato" } };
  const finito = ora();
  const esecuzione = await scriviEsecuzione(admin, rigaEsecuzione({ id, fonte, origine, iniziato, finito, ...dati }), finito);
  return { ...risultato, esecuzione };
}
