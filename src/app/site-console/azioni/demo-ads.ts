"use server";

import { richiediAdminAzione } from "@/lib/console/accesso";
import { verificaDataManager } from "@/lib/demo-ads-verifica";
import type { RisultatoVerifica } from "@/lib/demo-ads-verifica-calcoli";

// Verifica della Data Manager API di Google Ads in SOLA VALIDAZIONE (validateOnly = true) con dati inventati. Solo l'amministratore
// la può lanciare. Non legge né scrive nessuna tabella (nessun lead, nessuna riga), non registra nessuna conversione e restituisce
// alla pagina soltanto esiti, codici e identificativi mascherati: mai token, segreti o email. Vedi src/lib/demo-ads-verifica.ts.

export type EsitoVerificaDataManager = { ok: true; risultato: RisultatoVerifica } | { ok: false; errore: string };

// Una verifica sono 4 richieste di validazione a Google: si lascia una pausa tra una e l'altra (per istanza del server).
let ultimaEsecuzioneMs = 0;
const PAUSA_MINIMA_MS = 20_000;

export async function eseguiVerificaDataManager(): Promise<EsitoVerificaDataManager> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { ok: false, errore: "Non autorizzato." };

  const adesso = Date.now();
  if (adesso - ultimaEsecuzioneMs < PAUSA_MINIMA_MS) return { ok: false, errore: "Attendi qualche secondo tra una verifica e l'altra." };
  ultimaEsecuzioneMs = adesso;

  try {
    return { ok: true, risultato: await verificaDataManager(process.env) };
  } catch {
    // niente dettagli: un messaggio d'errore potrebbe contenere dati
    return { ok: false, errore: "La verifica non è riuscita (errore imprevisto)." };
  }
}
