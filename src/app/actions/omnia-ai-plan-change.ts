"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createStripeClient } from "@/lib/stripe";
import { PIANI, type PianoSlug } from "@/lib/omnia-ai-plans";
import { getStripePriceIdOfferta } from "@/lib/omnia-ai-stripe-prices";
import { richiediTitolareAzione } from "@/lib/omnia-ai-account-guardie";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { venditaAbbonamentoPianoLavoroAttiva } from "@/lib/piano-lavoro-offerta";
import { MESSAGGIO_ABBONAMENTO_PIANO_LAVORO_NON_OFFERTO } from "@/lib/piano-lavoro-testi";
import { VERSIONE_CONDIZIONI_PIANO_LAVORO, testoCanonicoCondizioniPianoLavoro } from "@/lib/piano-lavoro-acquisto-calcoli";
import { etichettaOfferta, interpretaDestinazione, tipoCambioOfferta, type OffertaAbbonamento } from "@/lib/piano-lavoro-offerta-calcoli";
import { createHash } from "crypto";

type SubscriptionRow = {
  id: string;
  plan: string;
  stripe_subscription_id: string | null;
  current_period_end: string | null;
  current_period_start: string | null;
  piano_programmato: string | null;
  // l'abbonamento include il piano di lavoro (colonna della migrazione 0101: false se manca)
  piano_lavoro: boolean;
};

async function getSubscriptionAttivaDelCliente(userId: string): Promise<SubscriptionRow | null> {
  const admin = createAdminClient();
  const cerca = (colonne: string) =>
    admin
      .from("subscriptions")
      .select(colonne)
      .eq("user_id", userId)
      .eq("status", "attivo")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<Omit<SubscriptionRow, "piano_lavoro"> & { piano_lavoro?: boolean | null }>();
  const base = "id, plan, stripe_subscription_id, current_period_end, current_period_start, piano_programmato";
  let { data, error } = await cerca(`${base}, piano_lavoro`);
  // senza la migrazione 0101 la colonna non c'è: si legge come prima, senza piano di lavoro
  if (error && schemaAssente(error)) ({ data, error } = await cerca(base));
  if (error) console.error("Cambio piano: lettura dell'abbonamento non riuscita", error.message);
  return data ? { ...data, piano_lavoro: data.piano_lavoro === true } : null;
}

// Le stesse verifiche servono sia per il preview che per la conferma:
// mai fidarsi del solo esito del preview mostrato al cliente, la
// richiesta di conferma viene rivalidata da zero.
//
// La destinazione è «piano», «piano:lavoro» o «piano:base» (vedi interpretaDestinazione): senza opzione si mantiene il piano di lavoro che
// l'abbonamento ha già; con l'opzione lo si aggiunge o lo si toglie, anche a parità di piano.
async function validaRichiestaCambioPiano(
  userId: string,
  destinazioneRaw: string,
): Promise<
  | { error: string }
  | {
      subscription: SubscriptionRow;
      offertaAttuale: OffertaAbbonamento;
      destinazione: OffertaAbbonamento;
      tipo: "upgrade" | "downgrade";
    }
> {
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
  const offertaAttuale: OffertaAbbonamento = { piano: pianoAttuale, pianoLavoro: subscription.piano_lavoro };

  const destinazione = interpretaDestinazione(destinazioneRaw, offertaAttuale);
  if (!destinazione) return { error: "Piano non valido." };

  // Salire o scendere si decide dall'ORDINE dei piani (Starter < Professional < Enterprise) e, a parità di piano, dal piano di lavoro
  // (aggiungerlo è salire, toglierlo è scendere), non dal confronto dei prezzi nel codice: i prezzi si modificano dalla console e non
  // devono poter scambiare un upgrade con un downgrade.
  const tipo = tipoCambioOfferta(offertaAttuale, destinazione);
  if (!tipo) return { error: "È già la tua offerta attuale." };

  // Il piano di lavoro si AGGIUNGE solo se è in vendita e solo subito (un cambio che decorre dal rinnovo non può portare l'accettazione delle
  // avvertenze): chi passa a un piano inferiore e vuole anche il piano di lavoro prima cambia piano, poi lo aggiunge. Tenerlo o toglierlo si può sempre.
  if (destinazione.pianoLavoro && !offertaAttuale.pianoLavoro) {
    if (!(await venditaAbbonamentoPianoLavoroAttiva())) return { error: MESSAGGIO_ABBONAMENTO_PIANO_LAVORO_NON_OFFERTO };
    if (tipo !== "upgrade") return { error: "Per aggiungere il piano di lavoro passa prima al piano che vuoi, poi aggiungilo." };
  }

  return { subscription, offertaAttuale, destinazione, tipo };
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

// La destinazione può cambiare il piano, il piano di lavoro o entrambi: `cambioPianoLavoro` dice se lo aggiunge o lo toglie (null = lo lascia com'è).
export type PreviewCambioPiano =
  | {
      tipo: "upgrade";
      pianoDestinazione: PianoSlug;
      pianoLavoro: boolean;
      cambioPianoLavoro: "aggiunto" | "tolto" | null;
      // se il piano resta lo stesso (si aggiunge o si toglie soltanto il piano di lavoro)
      stessoPiano: boolean;
      nomeNuovo: string;
      importoImmediatoCentesimi: number;
      gareIncluseNuovo: number;
      gareConsumate: number;
      gareDisponibiliDaOra: number;
    }
  | {
      tipo: "downgrade";
      pianoDestinazione: PianoSlug;
      pianoLavoro: boolean;
      cambioPianoLavoro: "aggiunto" | "tolto" | null;
      stessoPiano: boolean;
      nomeNuovo: string;
      gareIncluseNuovo: number;
      dataEffettivo: string;
    }
  | { error: string };

const cambioPianoLavoro = (da: OffertaAbbonamento, a: OffertaAbbonamento): "aggiunto" | "tolto" | null => (da.pianoLavoro === a.pianoLavoro ? null : a.pianoLavoro ? "aggiunto" : "tolto");

export async function previewOmniaAiPlanChange(destinazioneRaw: string): Promise<PreviewCambioPiano> {
  // Solo il titolare: l'Ufficio Gare non può usare questa azione (la barra laterale nasconde la voce, il controllo vero è qui).
  const guardia = await richiediTitolareAzione();
  if (!guardia.ok) return { error: guardia.errore };
  const { user } = guardia;

  const validazione = await validaRichiestaCambioPiano(user.id, destinazioneRaw);
  if ("error" in validazione) return validazione;

  const { subscription, offertaAttuale, destinazione, tipo } = validazione;
  const pianoDestinazione = destinazione.piano;
  const nuovo = PIANI[pianoDestinazione];
  const comune = {
    pianoDestinazione,
    pianoLavoro: destinazione.pianoLavoro,
    cambioPianoLavoro: cambioPianoLavoro(offertaAttuale, destinazione),
    stessoPiano: pianoDestinazione === offertaAttuale.piano,
    nomeNuovo: etichettaOfferta(destinazione),
  };

  if (tipo === "downgrade") {
    return {
      tipo: "downgrade",
      ...comune,
      gareIncluseNuovo: nuovo.gareIncluse,
      dataEffettivo: subscription.current_period_end ?? new Date().toISOString(),
    };
  }

  const stripe = createStripeClient("omnia-ai");

  let stripeSub;
  let nuovoPriceId: string;
  try {
    stripeSub = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id!);
    nuovoPriceId = await getStripePriceIdOfferta(stripe, destinazione.piano, destinazione.pianoLavoro);
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
    ...comune,
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
// `accettaAvvertenze`: chi AGGIUNGE il piano di lavoro deve aver accettato le avvertenze sul servizio (le stesse del checkout); versione e impronta
// viaggiano nei metadata dell'abbonamento e le registra il webhook.
export async function confirmOmniaAiPlanChange(destinazioneRaw: string, accettaAvvertenze = false): Promise<{ error?: string }> {
  // Solo il titolare: l'Ufficio Gare non può usare questa azione (la barra laterale nasconde la voce, il controllo vero è qui).
  const guardia = await richiediTitolareAzione();
  if (!guardia.ok) return { error: guardia.errore };
  const { user } = guardia;

  const validazione = await validaRichiestaCambioPiano(user.id, destinazioneRaw);
  if ("error" in validazione) return validazione;

  const { subscription, offertaAttuale, destinazione, tipo } = validazione;
  const aggiungePianoLavoro = destinazione.pianoLavoro && !offertaAttuale.pianoLavoro;
  if (aggiungePianoLavoro && accettaAvvertenze !== true) return { error: "Per aggiungere il piano di lavoro devi accettare le avvertenze sul servizio." };
  const stripe = createStripeClient("omnia-ai");

  let nuovoPriceId: string;
  try {
    nuovoPriceId = await getStripePriceIdOfferta(stripe, destinazione.piano, destinazione.pianoLavoro);
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
        ...(aggiungePianoLavoro
          ? {
              metadata: {
                pianoLavoroCondizioniVersione: String(VERSIONE_CONDIZIONI_PIANO_LAVORO),
                pianoLavoroCondizioniHash: createHash("sha256").update(testoCanonicoCondizioniPianoLavoro()).digest("hex"),
                pianoLavoroAccettatoIl: new Date().toISOString(),
              },
            }
          : {}),
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
  // Solo il titolare: l'Ufficio Gare non può usare questa azione (la barra laterale nasconde la voce, il controllo vero è qui).
  const guardia = await richiediTitolareAzione();
  if (!guardia.ok) return { error: guardia.errore };
  const { user } = guardia;

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

  const stripe = createStripeClient("omnia-ai");
  try {
    await stripe.subscriptionSchedules.release(subscription.stripe_schedule_id);
  } catch (err) {
    console.error("Errore annullamento cambio piano programmato:", err);
    return { error: "Errore nell'annullamento. Riprova." };
  }

  return {};
}
