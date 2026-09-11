import { createAdminClient } from "@/lib/supabase/admin";
import { PIANI, type PianoSlug } from "@/lib/omnia-ai-plans";

export type ConsumoResult = { error?: string };

const MESSAGGIO_QUOTA_ESAURITA =
  "Hai esaurito le gare incluse nel tuo piano e i crediti aggiuntivi. Acquista crediti o attendi il rinnovo del piano per continuare.";

// Una gara si consuma una sola volta nella vita, nell'istante in cui
// parte l'analisi documenti: unique(gara_id) su gara_consumi è la vera
// garanzia di idempotenza (anche sotto doppio click concorrente), il
// controllo qui sotto è solo l'ottimizzazione per non tentare un insert
// inutile nel caso comune (rianalisi).
//
// subscriptions.plan è testo libero digitato a mano dal form admin
// (non vincolato agli slug di PIANI): un piano sconosciuto vale 0 gare
// incluse, si passa direttamente ai crediti invece di bloccare per un
// dato admin imperfetto. Stesso discorso per current_period_start, mai
// valorizzato dal form admin: si usa created_at come inizio finestra.
export async function consumeGaraQuotaIfNeeded({
  garaId,
  userId,
}: {
  garaId: string;
  userId: string;
}): Promise<ConsumoResult> {
  const admin = createAdminClient();

  const { data: consumoEsistente } = await admin
    .from("gara_consumi")
    .select("id")
    .eq("gara_id", garaId)
    .maybeSingle<{ id: string }>();

  if (consumoEsistente) {
    return {};
  }

  // Gare analizzate prima che esistesse questo registro (o comunque
  // finite con dati estratti senza una riga corrispondente, es. per un
  // bug futuro) contano come già consumate: chi ha già ricevuto
  // l'analisi non la ripaga. Si recupera la riga mancante senza scalare
  // nulla — subscription_id resta null, non essendo un vero evento di
  // consumo avvenuto ora, non si attribuisce a un abbonamento/periodo
  // che potrebbe non essere più quello di allora.
  const { data: garaEsistente } = await admin
    .from("gare")
    .select("estrazione_stato, criteri_valutazione")
    .eq("id", garaId)
    .maybeSingle<{ estrazione_stato: string; criteri_valutazione: string | null }>();

  const giaAnalizzata =
    garaEsistente?.estrazione_stato === "completata" || !!garaEsistente?.criteri_valutazione;

  if (giaAnalizzata) {
    const { error: recuperoError } = await admin.from("gara_consumi").insert({
      gara_id: garaId,
      user_id: userId,
      subscription_id: null,
      tipo: "piano",
    });

    if (recuperoError && recuperoError.code !== "23505") {
      console.error("Errore recupero consumo gara già analizzata:", recuperoError);
    }

    return {};
  }

  const { data: subscription } = await admin
    .from("subscriptions")
    .select("id, plan, current_period_start, current_period_end, created_at")
    .eq("user_id", userId)
    .eq("status", "attivo")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{
      id: string;
      plan: string;
      current_period_start: string | null;
      current_period_end: string | null;
      created_at: string;
    }>();

  const subscriptionAttiva =
    subscription &&
    (!subscription.current_period_end ||
      new Date(subscription.current_period_end).getTime() > Date.now());

  const gareIncluse = subscriptionAttiva
    ? (PIANI[subscription.plan as PianoSlug]?.gareIncluse ?? 0)
    : 0;

  if (subscriptionAttiva && gareIncluse > 0) {
    const inizioPeriodo = subscription.current_period_start ?? subscription.created_at;

    const { count } = await admin
      .from("gara_consumi")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("tipo", "piano")
      .gte("created_at", inizioPeriodo);

    if ((count ?? 0) < gareIncluse) {
      const { error: insertError } = await admin.from("gara_consumi").insert({
        gara_id: garaId,
        user_id: userId,
        subscription_id: subscription.id,
        tipo: "piano",
      });

      if (!insertError) {
        return {};
      }

      // Violazione unique(gara_id): un'altra richiesta concorrente ha
      // già consumato questa gara — idempotente, non un errore reale.
      if (insertError.code === "23505") {
        return {};
      }

      console.error("Errore inserimento consumo gara (piano):", insertError);
      return { error: MESSAGGIO_QUOTA_ESAURITA };
    }
  }

  const { data: crediti } = await admin
    .from("credits")
    .select("balance")
    .eq("user_id", userId)
    .maybeSingle<{ balance: number }>();

  const balanceLetto = crediti?.balance ?? 0;

  if (balanceLetto > 0) {
    const { error: insertError } = await admin.from("gara_consumi").insert({
      gara_id: garaId,
      user_id: userId,
      subscription_id: subscription?.id ?? null,
      tipo: "credito",
    });

    if (insertError) {
      if (insertError.code === "23505") {
        return {};
      }
      console.error("Errore inserimento consumo gara (credito):", insertError);
      return { error: MESSAGGIO_QUOTA_ESAURITA };
    }

    // L'ordine insert-poi-decrementa è deliberato: se il decremento
    // fallisce dopo un insert riuscito, l'utente ha comunque diritto
    // all'analisi già registrata — si perde un credito in accounting,
    // mai un blocco su un'operazione già concessa. Guardia .eq("balance",
    // balanceLetto) contro una lettura stale concorrente: se non
    // corrisponde più, si logga e basta, non si ritenta.
    const { error: decrementoError } = await admin
      .from("credits")
      .update({ balance: balanceLetto - 1 })
      .eq("user_id", userId)
      .eq("balance", balanceLetto);

    if (decrementoError) {
      console.error("Errore decremento crediti dopo consumo gara:", decrementoError);
    }

    return {};
  }

  return { error: MESSAGGIO_QUOTA_ESAURITA };
}
