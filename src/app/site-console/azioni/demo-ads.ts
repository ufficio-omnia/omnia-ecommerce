"use server";

import { richiediAdminAzione } from "@/lib/console/accesso";
import { verificaDataManager } from "@/lib/demo-ads-verifica";
import type { RisultatoVerifica } from "@/lib/demo-ads-verifica-calcoli";

// Verifica della Data Manager API di Google Ads in SOLA VALIDAZIONE (validateOnly = true) con dati inventati. Solo l'amministratore
// la può lanciare: il controllo è QUI, sul server, come prima operazione (nascondere il pulsante non basterebbe). Non legge né scrive
// nessuna tabella (nessun lead, nessuna riga), non registra nessuna conversione e restituisce alla pagina soltanto esiti, codici e
// identificativi mascherati: mai token, segreti o email. Vedi src/lib/demo-ads-verifica.ts.
//
// Protezioni contro le esecuzioni ripetute (valgono PER ISTANZA del server: un'altra istanza ha i suoi contatori; per contare anche
// tra istanze servirebbe una tabella, che per scelta non si usa. Ogni esecuzione manda comunque solo richieste di validazione):
//   - una sola verifica alla volta;
//   - un minuto di pausa tra una verifica e l'altra;
//   - al massimo 10 verifiche all'ora.

export type EsitoVerificaDataManager = { ok: true; risultato: RisultatoVerifica } | { ok: false; errore: string };

let inEsecuzione = false;
let ultimaEsecuzioneMs = 0;
const esecuzioniRecenti: number[] = [];
const PAUSA_MINIMA_MS = 60_000;
const MASSIMO_ALL_ORA = 10;
const UN_ORA_MS = 3_600_000;

export async function eseguiVerificaDataManager(): Promise<EsitoVerificaDataManager> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { ok: false, errore: "Non autorizzato." };

  if (inEsecuzione) return { ok: false, errore: "Una verifica è già in corso: attendi che finisca." };
  const adesso = Date.now();
  if (adesso - ultimaEsecuzioneMs < PAUSA_MINIMA_MS) return { ok: false, errore: "Attendi un minuto tra una verifica e l'altra." };
  while (esecuzioniRecenti.length > 0 && adesso - esecuzioniRecenti[0] > UN_ORA_MS) esecuzioniRecenti.shift();
  if (esecuzioniRecenti.length >= MASSIMO_ALL_ORA) return { ok: false, errore: "Troppe verifiche nell'ultima ora: riprova più tardi." };

  inEsecuzione = true;
  ultimaEsecuzioneMs = adesso;
  esecuzioniRecenti.push(adesso);
  try {
    return { ok: true, risultato: await verificaDataManager(process.env) };
  } catch {
    // niente dettagli: un messaggio d'errore potrebbe contenere dati
    return { ok: false, errore: "La verifica non è riuscita (errore imprevisto)." };
  } finally {
    inEsecuzione = false;
  }
}
