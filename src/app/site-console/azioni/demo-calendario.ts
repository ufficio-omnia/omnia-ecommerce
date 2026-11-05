"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { richiediAdminAzione } from "@/lib/console/accesso";
import { diagnosticaCasiAperti, type RisultatoDiagnosi } from "@/lib/demo-calendario-diagnosi";

// Diagnosi in SOLA LETTURA degli eventi dei casi aperti del calendario (vedi src/lib/demo-calendario-diagnosi.ts). Solo l'amministratore la
// può lanciare: il controllo è QUI, sul server, come prima operazione. Legge il calendario (calendar.readonly) e il database con sole
// SELECT; non scrive niente, non rielabora niente, non invia niente; restituisce alla pagina SOLO ruoli, conteggi e nomi di campi:
// nessuna email, nessun nome, nessun id.
//
// Protezioni contro le esecuzioni ripetute (per istanza del server): una alla volta, un minuto di pausa, al massimo 10 all'ora.

export type EsitoDiagnosiCalendario = { ok: true; risultato: RisultatoDiagnosi } | { ok: false; errore: string };

let inEsecuzione = false;
let ultimaEsecuzioneMs = 0;
const esecuzioniRecenti: number[] = [];
const PAUSA_MINIMA_MS = 60_000;
const MASSIMO_ALL_ORA = 10;
const UN_ORA_MS = 3_600_000;

export async function eseguiDiagnosiCalendario(): Promise<EsitoDiagnosiCalendario> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { ok: false, errore: "Non autorizzato." };

  if (inEsecuzione) return { ok: false, errore: "Una diagnosi è già in corso: attendi che finisca." };
  const adesso = Date.now();
  if (adesso - ultimaEsecuzioneMs < PAUSA_MINIMA_MS) return { ok: false, errore: "Attendi un minuto tra una diagnosi e l'altra." };
  while (esecuzioniRecenti.length > 0 && adesso - esecuzioniRecenti[0] > UN_ORA_MS) esecuzioniRecenti.shift();
  if (esecuzioniRecenti.length >= MASSIMO_ALL_ORA) return { ok: false, errore: "Troppe diagnosi nell'ultima ora: riprova più tardi." };

  inEsecuzione = true;
  ultimaEsecuzioneMs = adesso;
  esecuzioniRecenti.push(adesso);
  try {
    return { ok: true, risultato: await diagnosticaCasiAperti(createAdminClient(), process.env) };
  } catch {
    // niente dettagli: un messaggio d'errore potrebbe contenere dati
    return { ok: false, errore: "La diagnosi non è riuscita (errore imprevisto)." };
  } finally {
    inEsecuzione = false;
  }
}
