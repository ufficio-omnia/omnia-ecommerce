"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createStripeClient } from "@/lib/stripe";
import { PIANI, type PianoSlug } from "@/lib/omnia-ai-plans";
import { getStripePriceId } from "@/lib/omnia-ai-stripe-prices";

type SubscriptionRow = {
  id: string;
  plan: string;
  stripe_subscription_id: string | null;
  current_period_end: string | null;
  current_period_start: string | null;
  piano_programmato: string | null;
};

async function getSubscriptionAttivaDelCliente(userId: string): Promise<SubscriptionRow | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("subscriptions")
    .select("id, plan, stripe_subscription_id, current_period_end, current_period_start, piano_programmato")
    .eq("user_id", userId)
    .eq("status", "attivo")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<SubscriptionRow>();
  return data ?? null;
}

// Le stesse verifiche servono sia per il preview che per la conferma:
// mai fidarsi del solo esito del preview mostrato al cliente, la
// richiesta di conferma viene rivalidata da zero.
async function validaRichiestaCambioPiano(
  userId: string,
  pianoDestinazioneRaw: string,
): Promise<
  | { error: string }
  | {
      subscription: SubscriptionRow;
      pianoAttuale: PianoSlug;
      pianoDestinazione: PianoSlug;
      tipo: "upgrade" | "downgrade";
    }
> {
  if (!(pianoDestinazioneRaw in PIANI)) return { error: "Piano non valido." };
  const pianoDestinazione = pianoDestinazioneRaw as PianoSlug;

  const subscription = await getSubscriptionAttivaDelCliente(userId);
  if (!subscription?.stripe_subscription_id) return { error: "Nessun abbonamento attivo trovato." };

  if (subscription.piano_programmato) {
    return {
      error:
        "C'è già un cambio di piano programmato per il prossimo rinnovo: annullalo prima di richiederne un altro.",
    };
  }

  const pianoAttuale = subscription.plan as PianoSlug;
  if (!(pianoAttuale in PIANI)) return { error: "Piano attuale non riconosciuto." };
  if (pianoDestinazione === pianoAttuale) return { error: "È già il tuo piano attuale." };

  const tipo: "upgrade" | "downgrade" =
    PIANI[pianoDestinazione].prezzoCentesimi > PIANI[pianoAttuale].prezzoCentesimi ? "upgrade" : "downgrade";

  return { subscription, pianoAttuale, pianoDestinazione, tipo };
}

// Le gare del piano già consumate in questo periodo restano consumate:
// il cambio alza (o abbassa) il tetto, non azzera il contatore — senza
// questa regola due cambi di piano in su e poi in giù basterebbero per
// ottenere gare illimitate, come già accadeva con le cancellazioni
// (tappa 3).
async function contaGareConsumatePianoNelPeriodo(userId: string, inizioPeriodo: string): Promise<number> {
  const admin = createAdminClient();
  const { count } = await admin
    .from("gara_consumi")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("tipo", "piano")
    .gte("created_at", inizioPeriodo);
  return count ?? 0;
}

export type PreviewCambioPiano =
  | {
      tipo: "upgrade";
      pianoDestinazione: PianoSlug;
      nomeNuovo: string;
      importoImmediatoCentesimi: number;
      gareIncluseNuovo: number;
      gareConsumate: number;
      gareDisponibiliDaOra: number;
    }
  | {
      tipo: "downgrade";
      pianoDestinazione: PianoSlug;
      nomeNuovo: string;
      gareIncluseNuovo: number;
      dataEffettivo: string;
    }
  | { error: string };

export async function previewOmniaAiPlanChange(pianoDestinazioneRaw: string): Promise<PreviewCambioPiano> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessione scaduta, ricarica la pagina." };

  const validazione = await validaRichiestaCambioPiano(user.id, pianoDestinazioneRaw);
  if ("error" in validazione) return validazione;

  const { subscription, pianoDestinazione, tipo } = validazione;
  const nuovo = PIANI[pianoDestinazione];

  if (tipo === "downgrade") {
    return {
      tipo: "downgrade",
      pianoDestinazione,
      nomeNuovo: nuovo.nome,
      gareIncluseNuovo: nuovo.gareIncluse,
      dataEffettivo: subscription.current_period_end ?? new Date().toISOString(),
    };
  }

  const stripe = createStripeClient();

  let stripeSub;
  let nuovoPriceId: string;
  try {
    stripeSub = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id!);
    nuovoPriceId = await getStripePriceId(stripe, pianoDestinazione);
  } catch (err) {
    console.error("Errore preview cambio piano (recupero abbonamento/prezzo):", err);
    return { error: "Errore nel calcolo dell'importo. Riprova." };
  }

  const item = stripeSub.items.data[0];
  if (!item) return { error: "Errore nel recupero dell'abbonamento Stripe." };

  let importoImmediatoCentesimi: number;
  try {
    const preview = await stripe.invoices.createPreview({
      subscription: subscription.stripe_subscription_id!,
      subscription_details: {
        items: [{ id: item.id, price: nuovoPriceId }],
        proration_behavior: "always_invoice",
      },
    });
    importoImmediatoCentesimi = preview.amount_due;
  } catch (err) {
    console.error("Errore preview cambio piano (calcolo conguaglio):", err);
    return { error: "Errore nel calcolo dell'importo. Riprova." };
  }

  const inizioPeriodo = subscription.current_period_start ?? subscription.current_period_end ?? new Date(0).toISOString();
  const gareConsumate = await contaGareConsumatePianoNelPeriodo(user.id, inizioPeriodo);

  return {
    tipo: "upgrade",
    pianoDestinazione,
    nomeNuovo: nuovo.nome,
    importoImmediatoCentesimi,
    gareIncluseNuovo: nuovo.gareIncluse,
    gareConsumate,
    gareDisponibiliDaOra: Math.max(0, nuovo.gareIncluse - gareConsumate),
  };
}

// Non tocca lo stato locale: quello arriva solo dal webhook
// (customer.subscription.updated per l'upgrade immediato,
// subscription_schedule.* per il downgrade programmato), mai da questa
// azione né dalla pagina di ritorno — stessa disciplina del resto della
// tappa 6.
export async function confirmOmniaAiPlanChange(pianoDestinazioneRaw: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessione scaduta, ricarica la pagina." };

  const validazione = await validaRichiestaCambioPiano(user.id, pianoDestinazioneRaw);
  if ("error" in validazione) return validazione;

  const { subscription, pianoDestinazione, tipo } = validazione;
  const stripe = createStripeClient();

  let nuovoPriceId: string;
  try {
    nuovoPriceId = await getStripePriceId(stripe, pianoDestinazione);
  } catch (err) {
    console.error("Errore cambio piano (recupero prezzo):", err);
    return { error: "Errore nell'aggiornamento del piano. Riprova." };
  }

  if (tipo === "upgrade") {
    try {
      const stripeSub = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id!);
      const item = stripeSub.items.data[0];
      if (!item) return { error: "Errore nel recupero dell'abbonamento Stripe." };

      // always_invoice, non il default create_prorations: il conguaglio
      // va addebitato SUBITO, non accodato alla prossima fattura di
      // rinnovo.
      await stripe.subscriptions.update(subscription.stripe_subscription_id!, {
        items: [{ id: item.id, price: nuovoPriceId }],
        proration_behavior: "always_invoice",
      });
    } catch (err) {
      console.error("Errore cambio piano (upgrade immediato):", err);
      return { error: "Errore nell'aggiornamento del piano. Riprova." };
    }

    return {};
  }

  // Downgrade: mai immediato, programmato con una Subscription Schedule
  // a due fasi — la fase corrente (invariata) e una nuova fase, sul
  // prezzo inferiore, che comincia dove finisce quella corrente (il
  // periodo in corso è già pagato a prezzo pieno). Nessuna fase con
  // end_behavior:"cancel": la seconda fase, senza una fine impostata,
  // prosegue indefinitamente come nuovo regime.
  try {
    const schedule = await stripe.subscriptionSchedules.create({
      from_subscription: subscription.stripe_subscription_id!,
    });

    const faseCorrente = schedule.phases[0];
    if (!faseCorrente) return { error: "Errore nella programmazione del cambio piano. Riprova." };

    await stripe.subscriptionSchedules.update(schedule.id, {
      end_behavior: "release",
      phases: [
        {
          items: faseCorrente.items.map((i) => ({
            price: typeof i.price === "string" ? i.price : i.price.id,
            quantity: i.quantity,
          })),
          start_date: faseCorrente.start_date,
          end_date: faseCorrente.end_date,
        },
        {
          items: [{ price: nuovoPriceId, quantity: 1 }],
          start_date: faseCorrente.end_date,
        },
      ],
    });
  } catch (err) {
    console.error("Errore cambio piano (programmazione downgrade):", err);
    return { error: "Errore nella programmazione del cambio piano. Riprova." };
  }

  return {};
}

// Annulla un downgrade programmato prima che scatti: "release" toglie
// la schedule, l'abbonamento resta sul piano attuale. Anche qui lo
// stato locale (piano_programmato tornato a null) arriva solo dal
// webhook subscription_schedule.released.
export async function cancelOmniaAiScheduledPlanChange(): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessione scaduta, ricarica la pagina." };

  const admin = createAdminClient();
  const { data: subscription } = await admin
    .from("subscriptions")
    .select("stripe_schedule_id")
    .eq("user_id", user.id)
    .eq("status", "attivo")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ stripe_schedule_id: string | null }>();

  if (!subscription?.stripe_schedule_id) {
    return { error: "Nessun cambio di piano programmato da annullare." };
  }

  const stripe = createStripeClient();
  try {
    await stripe.subscriptionSchedules.release(subscription.stripe_schedule_id);
  } catch (err) {
    console.error("Errore annullamento cambio piano programmato:", err);
    return { error: "Errore nell'annullamento. Riprova." };
  }

  return {};
}
