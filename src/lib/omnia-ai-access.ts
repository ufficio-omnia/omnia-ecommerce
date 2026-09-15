import type { SupabaseClient } from "@supabase/supabase-js";

const GIORNI_SOLA_LETTURA = 30;
const MS_GIORNO = 24 * 60 * 60 * 1000;

export type OmniaAiAccessState =
  | { stato: "attivo" }
  | { stato: "sola_lettura"; dataCancellazioneContenuti: Date }
  | { stato: "cessato"; avevaAbbonamento: boolean };

type SubscriptionRow = {
  status: string;
  current_period_end: string | null;
};

// Lo stato non è mai salvato: si calcola ogni volta dall'ultimo
// abbonamento dell'utente, sempre a partire da current_period_end (fine
// dell'ultimo periodo PAGATO), mai dalla data in cui è stata richiesta
// la disdetta — chi disdice il primo del mese ma ha pagato fino al 30
// comincia a contare i 30 giorni di sola lettura dal 30.
export async function getOmniaAiAccessState(
  userId: string,
  client: SupabaseClient,
): Promise<OmniaAiAccessState> {
  const { data: subscription } = await client
    .from("subscriptions")
    .select("status, current_period_end")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<SubscriptionRow>();

  if (!subscription) {
    return { stato: "cessato", avevaAbbonamento: false };
  }

  const periodoScaduto =
    subscription.current_period_end !== null &&
    new Date(subscription.current_period_end).getTime() <= Date.now();

  if (subscription.status === "attivo" && !periodoScaduto) {
    return { stato: "attivo" };
  }

  // Non attiva e senza una data di fine periodo (subscription creata a
  // mano dal form admin, mai passata da Stripe): nessuna finestra di
  // sola lettura calcolabile. Prudente per difetto — nega l'accesso
  // invece di concederlo a tempo indeterminato per un dato mancante.
  if (!subscription.current_period_end) {
    return { stato: "cessato", avevaAbbonamento: true };
  }

  const finePeriodo = new Date(subscription.current_period_end);
  const giorniTrascorsi = (Date.now() - finePeriodo.getTime()) / MS_GIORNO;

  if (giorniTrascorsi < GIORNI_SOLA_LETTURA) {
    return {
      stato: "sola_lettura",
      dataCancellazioneContenuti: new Date(finePeriodo.getTime() + GIORNI_SOLA_LETTURA * MS_GIORNO),
    };
  }

  return { stato: "cessato", avevaAbbonamento: true };
}

export const MESSAGGIO_SOLA_LETTURA =
  "Il tuo abbonamento non è più attivo: l'area è in sola lettura, questa azione non è disponibile. Riattiva l'abbonamento dalla pagina \"Abbonamento\" per continuare.";

// Usato da ogni azione che genera contenuto, consuma risorse, o
// aggiunge materiale destinato a un'analisi futura: né in sola lettura
// né a cessazione avvenuta questo genere di azioni deve avere effetto,
// indipendentemente da cosa mostra l'interfaccia. Ritorna null quando
// l'azione può procedere.
export async function requireOmniaAiWriteAccess(
  userId: string,
  client: SupabaseClient,
): Promise<string | null> {
  const stato = await getOmniaAiAccessState(userId, client);
  return stato.stato === "attivo" ? null : MESSAGGIO_SOLA_LETTURA;
}
