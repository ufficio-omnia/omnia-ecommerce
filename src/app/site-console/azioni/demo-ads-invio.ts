"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { richiediAdminAzione } from "@/lib/console/accesso";
import { controllaEsitoAds, inviaConversioneAds, leggiInvioAds, type RisultatoControlloAds, type RisultatoElencoInvioAds, type RisultatoInvioAds } from "@/lib/demo-ads-invio";

// INVIO REALE di UNA conversione Google Ads dalla console (vedi src/lib/demo-ads-invio.ts e GUIDA-DEMO-TRACCIAMENTO.md). Solo
// l'amministratore può usare queste azioni: il controllo è QUI, sul server, come PRIMA operazione di ognuna (nascondere il pulsante non
// basterebbe, un'azione si può chiamare a prescindere dalla pagina che la mostra).
//
//  - leggiInvioAdsAzione:       SOLA LETTURA. Elenca le richieste con una conversione Ads e dice se sono inviabili. Non chiama Google.
//  - inviaConversioneAdsAzione: l'unica che invia, UNA conversione REALE, dopo la frase digitata (specifica della richiesta). La
//                               protezione dai doppioni sta nel database (prenotazione condizionata + blocco condiviso con il cron); il
//                               «segnale di occupato» di questa istanza è solo una comodità in più.
//  - controllaEsitoAdsAzione:   legge requestStatus di una conversione già inviata (una GET). Non invia niente.
//
// Alla pagina arrivano SOLO esiti, codici, stati e conteggi: mai token, mai email, mai identificativi di clic.

export type EsitoElencoAzione = { ok: true; risultato: Extract<RisultatoElencoInvioAds, { ok: true }> } | { ok: false; errore: string };
export type EsitoInvioAzione = { ok: true; risultato: RisultatoInvioAds } | { ok: false; errore: string };
export type EsitoControlloAzione = { ok: true; risultato: RisultatoControlloAds } | { ok: false; errore: string };

let invioInCorso = false;

export async function leggiInvioAdsAzione(): Promise<EsitoElencoAzione> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { ok: false, errore: "Non autorizzato." };
  try {
    const r = await leggiInvioAds(createAdminClient(), process.env, Date.now());
    if (!r.ok) return { ok: false, errore: r.motivo === "schema_assente" ? "Mancano le tabelle del tracciamento (migrazione 0098)." : "Lettura non riuscita." };
    return { ok: true, risultato: r };
  } catch {
    return { ok: false, errore: "Lettura non riuscita (errore imprevisto)." };
  }
}

export async function inviaConversioneAdsAzione(leadId: string, frase: string): Promise<EsitoInvioAzione> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { ok: false, errore: "Non autorizzato." };
  if (invioInCorso) return { ok: false, errore: "Un invio è già in corso: attendi che finisca." };
  invioInCorso = true;
  try {
    return { ok: true, risultato: await inviaConversioneAds(createAdminClient(), process.env, { leadId, frase }, Date.now()) };
  } catch {
    // niente dettagli (potrebbero contenere dati). L'invio potrebbe essere partito: guardare lo stato della richiesta prima di fare altro.
    return { ok: false, errore: "Errore imprevisto. Guarda lo stato della richiesta qui sotto prima di fare altro: la conversione potrebbe essere già partita. NON ripetere l'invio." };
  } finally {
    invioInCorso = false;
    revalidatePath("/site-console", "layout");
  }
}

export async function controllaEsitoAdsAzione(leadId: string): Promise<EsitoControlloAzione> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { ok: false, errore: "Non autorizzato." };
  try {
    return { ok: true, risultato: await controllaEsitoAds(createAdminClient(), process.env, { leadId }, Date.now()) };
  } catch {
    return { ok: false, errore: "Controllo non riuscito (errore imprevisto)." };
  } finally {
    revalidatePath("/site-console", "layout");
  }
}
