"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { richiediAdminAzione } from "@/lib/console/accesso";
import {
  inviaProvaGa4,
  preparaProvaGa4,
  risolviProvaGa4Admin,
  type RisultatoInvioProva,
  type RisultatoPreparazione,
  type RisultatoRisoluzione,
} from "@/lib/demo-ga4-prova";

// PROVA REALE dell'evento GA4 «demo_booking_confirmed» (vedi src/lib/demo-ga4-prova.ts e GUIDA-DEMO-TRACCIAMENTO.md). Solo
// l'amministratore può usare queste azioni: il controllo è QUI, sul server, come PRIMA operazione di ognuna (nascondere il pulsante non
// basterebbe, un'azione si può chiamare a prescindere dalla pagina che la mostra).
//
//  - preparaProvaGa4Azione: SOLA LETTURA. Elenca le richieste con un'email di prova e dice se sono idonee. Non invia niente.
//  - inviaProvaGa4Azione:   l'unica che invia, UN evento REALE, dopo la frase digitata. Prenotazione esclusiva nel database + blocco
//                           condiviso con il cron: la protezione dai doppioni sta nel database, non qui. Il «segnale di occupato» di
//                           questa istanza è solo una comodità in più.
//  - risolviProvaGa4Azione: l'amministratore dichiara cosa ha visto in GA4 (presente / assente). Non invia niente.
//
// Alla pagina arrivano SOLO esiti, codici, stati e conteggi: mai il segreto, mai l'indirizzo chiamato, mai email o client_id.

export type EsitoPreparaProva = { ok: true; risultato: Extract<RisultatoPreparazione, { ok: true }> } | { ok: false; errore: string };
export type EsitoInvioProvaAzione = { ok: true; risultato: RisultatoInvioProva } | { ok: false; errore: string };
export type EsitoRisoluzioneAzione = { ok: true; risultato: RisultatoRisoluzione } | { ok: false; errore: string };

let invioInCorso = false;

export async function preparaProvaGa4Azione(): Promise<EsitoPreparaProva> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { ok: false, errore: "Non autorizzato." };
  try {
    const r = await preparaProvaGa4(createAdminClient(), process.env, Date.now());
    if (!r.ok) return { ok: false, errore: r.motivo === "schema_assente" ? "Manca la tabella delle prove: eseguire la migrazione 0099." : "Lettura non riuscita." };
    return { ok: true, risultato: r };
  } catch {
    return { ok: false, errore: "Lettura non riuscita (errore imprevisto)." };
  }
}

export async function inviaProvaGa4Azione(leadId: string, frase: string): Promise<EsitoInvioProvaAzione> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { ok: false, errore: "Non autorizzato." };
  if (invioInCorso) return { ok: false, errore: "Un invio è già in corso: attendi che finisca." };
  invioInCorso = true;
  try {
    return { ok: true, risultato: await inviaProvaGa4(createAdminClient(), process.env, { leadId, frase, utenteId: sessione.userId }, Date.now()) };
  } catch {
    // niente dettagli (potrebbero contenere dati). L'invio potrebbe essere partito: controllare il registro delle prove prima di fare altro.
    return { ok: false, errore: "Errore imprevisto. Controlla il registro delle prove qui sotto prima di fare altro: l'evento potrebbe essere già partito." };
  } finally {
    invioInCorso = false;
  }
}

export async function risolviProvaGa4Azione(leadId: string, esito: string, frase: string): Promise<EsitoRisoluzioneAzione> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { ok: false, errore: "Non autorizzato." };
  try {
    return { ok: true, risultato: await risolviProvaGa4Admin(createAdminClient(), { leadId, esito, frase, utenteId: sessione.userId }, Date.now()) };
  } catch {
    return { ok: false, errore: "Operazione non riuscita (errore imprevisto)." };
  }
}
