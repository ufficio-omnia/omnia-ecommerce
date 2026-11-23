// Fase B4 (B1), Fase A del 20/11 (A8) — Aggancio della «scadenza ravvicinata» (decisione D-E2: «sì, una volta sola, spento di base») alle
// azioni di Opportunità (src/app/actions/radar.ts): quando una gara ENTRA nella lista dell'impresa (salvata, monitorata o aggiunta a mano).
// La regola e il lavoro sono di B2 (notifiche/ravvicinata.ts, dopoIngressoInLista): non lancia mai eccezioni e, con l'interruttore unico
// spento (di base), non legge né scrive nulla. Qui solo due garanzie di B1:
//   - il lavoro parte DOPO la risposta all'utente, con after() di Next 16 (node_modules/next/dist/docs/.../after.md): il salvataggio non lo
//     aspetta mai. after() parte anche se la risposta fallisce o se l'azione chiama redirect(): per questo le azioni lo chiamano SOLO nei
//     punti in cui la scrittura è riuscita, mai prima;
//   - ESATTAMENTE una gara: o dell'archivio (proceduraId) o aggiunta a mano (aggiuntaId), mai entrambe, mai nessuna.
// Solo server.
import { after } from "next/server";
import { dopoIngressoInLista, type EsitoRavvicinata, type GaraEntrataInLista } from "./notifiche/ravvicinata";

export type IngressoInLista = { impresaId: string; autoreId: string } & ({ proceduraId: string; aggiuntaId?: undefined } | { aggiuntaId: string; proceduraId?: undefined });

export type Pianificatore = (lavoro: () => Promise<EsitoRavvicinata>) => void;

/**
 * Pianifica dopo la risposta l'aggancio di B2 per la gara entrata nella lista. Restituisce la gara passata a B2 oppure null (ed è un errore
 * di programmazione, annotato nel registro) se le gare indicate non sono esattamente una. `pianifica` è after() di Next; le prove lo sostituiscono.
 */
export function pianificaScadenzaRavvicinata(ingresso: IngressoInLista, pianifica: Pianificatore = after): GaraEntrataInLista | null {
  const proceduraId = ingresso.proceduraId ?? null;
  const aggiuntaId = ingresso.aggiuntaId ?? null;
  if ((proceduraId === null) === (aggiuntaId === null)) {
    console.error("Tender Intelligence: scadenza ravvicinata non agganciata, serve esattamente una gara");
    return null;
  }
  const gara: GaraEntrataInLista = { impresaId: ingresso.impresaId, proceduraId, aggiuntaId, autoreId: ingresso.autoreId };
  pianifica(async () => {
    const esito = await dopoIngressoInLista(gara);
    if (esito.esito === "errore") console.error("Tender Intelligence: scadenza ravvicinata non riuscita", esito.codice);
    return esito;
  });
  return gara;
}
