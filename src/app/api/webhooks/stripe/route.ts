import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { createStripeClient } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, ADMIN_EMAIL } from "@/lib/email";
import { recordLegalAcceptances, type BuyerType } from "@/lib/legal-acceptance";
import { recordOmniaAiLegalAcceptances } from "@/lib/omnia-ai-legal";
import { PACCHETTI_CREDITI, type PacchettoCreditiSlug } from "@/lib/omnia-ai-plans";
import { pianoDaLookupKey } from "@/lib/omnia-ai-stripe-prices";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const stripe = createStripeClient();
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch (err) {
    console.error("Firma webhook Stripe non valida:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
      break;
    // Questo account Stripe crea una Subscription SOLO per gli
    // abbonamenti OMNIA AI: l'e-commerce è sempre mode:"payment", non
    // genera mai questi due eventi. Nessuna discriminazione necessaria.
    case "customer.subscription.updated":
      await handleOmniaAiSubscriptionUpdated(event.data.object as Stripe.Subscription);
      break;
    case "customer.subscription.deleted":
      await handleOmniaAiSubscriptionDeleted(event.data.object as Stripe.Subscription);
      break;
    // Cambio piano programmato (downgrade, mai immediato): questi tre
    // eventi coprono la creazione della schedule, ogni sua modifica (compresa
    // l'entrata nella nuova fase, che aggiorna anche la Subscription — vedi
    // sopra) e l'annullamento prima che scatti.
    case "subscription_schedule.created":
    case "subscription_schedule.updated":
    case "subscription_schedule.released":
      await handleOmniaAiSubscriptionScheduleEvent(event.data.object as Stripe.SubscriptionSchedule);
      break;
  }

  return NextResponse.json({ received: true });
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  // Discriminatore esplicito nei metadata: un abbonamento OMNIA AI ha un
  // percorso di creazione completamente diverso (mode:"subscription",
  // nessun productId/buyerType/dati di fatturazione propri — quelli li
  // raccoglie Stripe). Il ramo e-commerce sotto resta invariato.
  if (session.metadata?.tipo === "omnia_ai_abbonamento") {
    await handleOmniaAiSubscriptionCheckoutCompleted(session);
    return;
  }

  // Stesso discriminatore, per l'acquisto una tantum di crediti
  // aggiuntivi (mode:"payment", non subscription): nessun productId né
  // dati di fatturazione propri, li raccoglie lo stesso checkout
  // dell'abbonamento a monte.
  if (session.metadata?.tipo === "omnia_ai_crediti") {
    await handleOmniaAiCreditsCheckoutCompleted(session);
    return;
  }

  const email = session.customer_email?.trim().toLowerCase();
  const metadata = session.metadata;

  if (!email || !metadata?.productId) {
    console.error("Webhook Stripe: dati mancanti nella sessione", session.id);
    return;
  }

  const {
    productId,
    ragioneSociale,
    partitaIva,
    codiceFiscale,
    indirizzo,
    codiceSdi,
    pec,
    buyerType: buyerTypeRaw,
    acceptCondizioniPrivacy,
    acceptEsecuzioneImmediata,
    acceptClausoleSpecifiche,
    acceptedAt,
    acceptIp,
    acceptUserAgent,
    condizioniVenditaDocId,
    condizioniVenditaVersion,
    privacyPolicyDocId,
    privacyPolicyVersion,
  } = metadata;

  const buyerType: BuyerType = buyerTypeRaw === "consumatore" ? "consumatore" : "azienda";

  const admin = createAdminClient();

  // Idempotenza: Stripe può reinviare lo stesso evento più volte.
  const { data: existingOrder } = await admin
    .from("orders")
    .select("id")
    .eq("stripe_session_id", session.id)
    .maybeSingle();

  if (existingOrder) return;

  const { data: product } = await admin
    .from("products")
    .select("id, title")
    .eq("id", productId)
    .single();

  if (!product) {
    console.error("Webhook Stripe: prodotto non trovato", productId);
    return;
  }

  // L'importo da registrare è quello effettivamente addebitato da Stripe
  // (bloccato al momento della creazione della sessione, con l'eventuale
  // sconto già applicato allora), non il prezzo attuale del prodotto —
  // che nel frattempo potrebbe essere cambiato.
  const amountCharged = (session.amount_total ?? 0) / 100;

  const { error: createError } = await admin.auth.admin.createUser({
    email,
    email_confirm: false,
  });

  if (createError && !/already.*registered|already exists/i.test(createError.message)) {
    console.error("Webhook Stripe: errore creazione account", createError);
    return;
  }

  const { data: profile, error: profileError } = await admin
    .from("users")
    .select("id")
    .eq("email", email)
    .single();

  if (profileError || !profile) {
    console.error("Webhook Stripe: errore recupero profilo", profileError);
    return;
  }

  const { data: authUser } = await admin.auth.admin.getUserById(profile.id);
  const needsActivation = !authUser?.user?.email_confirmed_at;

  await admin.from("companies").upsert(
    {
      user_id: profile.id,
      buyer_type: buyerType,
      ragione_sociale: ragioneSociale,
      partita_iva: buyerType === "azienda" ? partitaIva : null,
      codice_fiscale: buyerType === "consumatore" ? codiceFiscale : null,
      indirizzo,
      codice_sdi: codiceSdi || null,
      pec: pec || null,
    },
    { onConflict: "user_id" },
  );

  const { data: order, error: orderError } = await admin
    .from("orders")
    .insert({
      user_id: profile.id,
      product_id: product.id,
      status: "pagato",
      payment_method: "carta",
      total_amount: amountCharged,
      stripe_session_id: session.id,
    })
    .select("id")
    .single();

  if (orderError || !order) {
    console.error("Webhook Stripe: errore creazione ordine", orderError);
    return;
  }

  // L'accettazione era stata catturata (IP, user agent, versioni dei
  // documenti) al momento del checkout, prima del redirect a Stripe: qui
  // la registriamo nella stessa operazione che crea l'ordine carta, che
  // per il pagamento con carta è proprio questo webhook.
  if (
    condizioniVenditaDocId &&
    condizioniVenditaVersion &&
    privacyPolicyDocId &&
    privacyPolicyVersion
  ) {
    const acceptanceResult = await recordLegalAcceptances({
      admin,
      orderId: order.id,
      userId: profile.id,
      buyerType,
      input: {
        condizioniEPrivacy: acceptCondizioniPrivacy === "true",
        esecuzioneImmediata: acceptEsecuzioneImmediata === "true",
        clausoleSpecifiche: acceptClausoleSpecifiche === "true",
      },
      documents: {
        condizioniVendita: {
          id: condizioniVenditaDocId,
          version: Number(condizioniVenditaVersion),
        },
        privacyPolicy: {
          id: privacyPolicyDocId,
          version: Number(privacyPolicyVersion),
        },
      },
      ip: acceptIp || null,
      userAgent: acceptUserAgent || null,
      acceptedAt: acceptedAt || new Date().toISOString(),
    });

    if (acceptanceResult.error) {
      console.error(
        "Webhook Stripe: errore registrazione accettazioni legali",
        acceptanceResult.error,
        "ordine",
        order.id,
      );
    }
  } else {
    console.error(
      "Webhook Stripe: metadata accettazioni legali mancanti per l'ordine",
      order.id,
    );
  }

  await sendEmail({
    to: ADMIN_EMAIL,
    subject: `Nuovo ordine (carta): ${product.title}`,
    html: `
      <p><strong>Nuovo ordine ricevuto</strong></p>
      <p>Numero ordine: ${order.id.slice(0, 8)}</p>
      <p>Metodo di pagamento: carta (Stripe)</p>
      <p>Documento acquistato: ${product.title}</p>
      <p>Importo (IVA inclusa): ${amountCharged.toLocaleString("it-IT", { style: "currency", currency: "EUR" })}</p>
      <p><strong>Cliente</strong></p>
      <p>Email: ${email}</p>
      <p>Tipo acquirente: ${buyerType === "azienda" ? "Azienda/libero professionista" : "Privato consumatore"}</p>
      <p>Ragione sociale/Nome: ${ragioneSociale}</p>
      <p>Partita IVA: ${partitaIva || "—"}</p>
      <p>Codice fiscale: ${codiceFiscale || "—"}</p>
      <p>Indirizzo: ${indirizzo}</p>
      <p>Codice SDI: ${codiceSdi || "—"}</p>
      <p>PEC: ${pec || "—"}</p>
    `,
  });

  const legalNote =
    condizioniVenditaVersion && privacyPolicyVersion
      ? `<p style="margin-top:16px;">Hai accettato le
          <a href="${siteUrl}/documenti-legali/condizioni-vendita/${condizioniVenditaVersion}">Condizioni generali di vendita (versione ${condizioniVenditaVersion})</a>
          e preso visione della
          <a href="${siteUrl}/documenti-legali/privacy-policy/${privacyPolicyVersion}">Privacy policy (versione ${privacyPolicyVersion})</a>.
          ${
            buyerType === "consumatore"
              ? "Hai inoltre richiesto espressamente l'esecuzione immediata della fornitura, con conseguente perdita del diritto di recesso."
              : ""
          }
        </p>`
      : "";

  if (needsActivation) {
    const { error: otpError } = await admin.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${siteUrl}/auth/callback?next=/imposta-password`,
      },
    });

    if (otpError) {
      console.error("Webhook Stripe: errore invio email di attivazione", otpError);
    }
  } else {
    await sendEmail({
      to: email,
      subject: "Il tuo documento è pronto per il download",
      html: `<p>Il pagamento è stato confermato.</p><p>Il documento <strong>${product.title}</strong> è ora disponibile nella tua area riservata.</p><p><a href="${siteUrl}/dashboard">Vai alla dashboard</a></p>${legalNote}`,
    });
  }
}

// L'enum locale subscription_status ha solo attivo/scaduto/annullato,
// nessun valore "sospeso" dedicato: past_due/unpaid/incomplete/paused
// (pagamento fallito, in fase di riaddebito) ricadono su "scaduto", la
// lettura più vicina — hasActiveSubscription() nega l'accesso finché lo
// stato non torna "attivo", producendo la sospensione richiesta dalla
// clausola 8 delle condizioni di abbonamento senza bisogno di un nuovo
// valore enum.
function mapStripeSubscriptionStatus(
  status: Stripe.Subscription.Status,
): "attivo" | "scaduto" | "annullato" {
  if (status === "active" || status === "trialing") return "attivo";
  if (status === "canceled") return "annullato";
  return "scaduto";
}

async function handleOmniaAiSubscriptionCheckoutCompleted(session: Stripe.Checkout.Session) {
  const metadata = session.metadata;
  const userId = metadata?.userId;
  const planSlug = metadata?.planSlug;
  const stripeSubscriptionId =
    typeof session.subscription === "string" ? session.subscription : session.subscription?.id;

  if (!userId || !planSlug || !stripeSubscriptionId) {
    console.error(
      "Webhook Stripe (abbonamento AI): dati mancanti nella sessione",
      session.id,
    );
    return;
  }

  const admin = createAdminClient();

  // Idempotenza granulare: un evento rielaborato (retry Stripe, o
  // riprocessato a mano dopo un problema transitorio — es. la
  // registrazione delle accettazioni fallita per una tabella non ancora
  // esistente) non deve limitarsi a saltare tutto se la riga subscriptions
  // esiste già. Va comunque ritentata la registrazione delle accettazioni
  // legali: perderla in modo permanente per un problema temporaneo non è
  // accettabile su un dato che prova il consenso contrattuale.
  const { data: existing } = await admin
    .from("subscriptions")
    .select("id")
    .eq("stripe_subscription_id", stripeSubscriptionId)
    .maybeSingle<{ id: string }>();

  let subscriptionRowId = existing?.id;

  if (!subscriptionRowId) {
    // Mai fidarsi solo del payload dell'evento per stato/periodo: si
    // rilegge la subscription da Stripe. items.data[0] perché c'è sempre
    // un solo line item (un piano, quantity 1) — current_period_start/end
    // in Stripe non sono più sull'oggetto Subscription, vivono qui.
    const stripe = createStripeClient();
    const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
    const item = subscription.items.data[0];
    const stripeCustomerId =
      typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;

    const { data: sub, error: subError } = await admin
      .from("subscriptions")
      .insert({
        user_id: userId,
        plan: planSlug,
        status: mapStripeSubscriptionStatus(subscription.status),
        stripe_subscription_id: stripeSubscriptionId,
        stripe_customer_id: stripeCustomerId,
        current_period_start: item ? new Date(item.current_period_start * 1000).toISOString() : null,
        current_period_end: item ? new Date(item.current_period_end * 1000).toISOString() : null,
        cancel_at_period_end: subscription.cancel_at_period_end,
      })
      .select("id")
      .single();

    if (subError || !sub) {
      console.error("Webhook Stripe (abbonamento AI): errore creazione subscription", subError);
      return;
    }

    subscriptionRowId = sub.id;
  }

  if (!subscriptionRowId) return;

  const {
    condizioniAbbonamentoDocId,
    condizioniAbbonamentoVersion,
    privacyPolicyDocId,
    privacyPolicyVersion,
    acceptedAt,
    acceptIp,
    acceptUserAgent,
  } = metadata;

  if (
    condizioniAbbonamentoDocId &&
    condizioniAbbonamentoVersion &&
    privacyPolicyDocId &&
    privacyPolicyVersion
  ) {
    const acceptanceResult = await recordOmniaAiLegalAcceptances({
      admin,
      subscriptionId: subscriptionRowId,
      userId,
      documents: {
        condizioniAbbonamento: {
          id: condizioniAbbonamentoDocId,
          version: Number(condizioniAbbonamentoVersion),
        },
        privacyPolicy: { id: privacyPolicyDocId, version: Number(privacyPolicyVersion) },
      },
      ip: acceptIp || null,
      userAgent: acceptUserAgent || null,
      acceptedAt: acceptedAt || new Date().toISOString(),
    });

    if (acceptanceResult.error) {
      console.error(
        "Webhook Stripe (abbonamento AI): errore registrazione accettazioni legali",
        acceptanceResult.error,
        "subscription",
        subscriptionRowId,
      );
    }
  } else {
    console.error(
      "Webhook Stripe (abbonamento AI): metadata accettazioni legali mancanti per l'abbonamento",
      subscriptionRowId,
    );
  }
}

async function handleOmniaAiSubscriptionUpdated(subscription: Stripe.Subscription) {
  const admin = createAdminClient();
  const item = subscription.items.data[0];

  const update: Record<string, unknown> = {
    status: mapStripeSubscriptionStatus(subscription.status),
    current_period_start: item ? new Date(item.current_period_start * 1000).toISOString() : null,
    current_period_end: item ? new Date(item.current_period_end * 1000).toISOString() : null,
    cancel_at_period_end: subscription.cancel_at_period_end,
  };

  // item.price arriva già espanso (non solo l'id) sugli item di una
  // Subscription: nessuna chiamata aggiuntiva a Stripe serve per
  // risalire al piano. Un cambio piano (upgrade immediato, o l'entrata
  // nella nuova fase di un downgrade programmato) passa sempre da qui —
  // è l'unico punto che aggiorna subscriptions.plan dopo la creazione.
  const pianoAggiornato = item ? pianoDaLookupKey(item.price.lookup_key) : null;
  if (pianoAggiornato) {
    update.plan = pianoAggiornato;
  }

  const { error } = await admin.from("subscriptions").update(update).eq("stripe_subscription_id", subscription.id);

  if (error) {
    console.error("Webhook Stripe (abbonamento AI): errore aggiornamento subscription", error);
  }
}

async function handleOmniaAiSubscriptionDeleted(subscription: Stripe.Subscription) {
  const admin = createAdminClient();

  const { data: sub, error } = await admin
    .from("subscriptions")
    .update({ status: "annullato", cancel_at_period_end: false })
    .eq("stripe_subscription_id", subscription.id)
    .select("user_id")
    .maybeSingle<{ user_id: string }>();

  if (error) {
    console.error("Webhook Stripe (abbonamento AI): errore cancellazione subscription", error);
    return;
  }

  // I crediti aggiuntivi residui si estinguono con la cessazione, senza
  // diritto a riattivazione successiva (clausola 5/8 delle condizioni di
  // abbonamento): azzerati qui, al momento in cui Stripe conferma che
  // l'abbonamento è davvero terminato — non al 30° giorno (troppo tardi,
  // un cliente potrebbe riabbonarsi ben prima e ritrovarseli ancora
  // spendibili) né alla sola richiesta di disdetta (troppo presto, resta
  // pienamente utilizzabile fino alla fine del periodo pagato). Il job
  // di cancellazione automatica a 30 giorni ripete comunque questo
  // azzeramento come rete di sicurezza, nel caso questo evento non
  // arrivi mai (es. impostazioni di riaddebito Stripe diverse da "Cancel
  // the subscription").
  if (sub?.user_id) {
    const { error: creditiError } = await admin
      .from("credits")
      .update({ balance: 0 })
      .eq("user_id", sub.user_id);

    if (creditiError) {
      console.error("Webhook Stripe (abbonamento AI): errore azzeramento crediti", creditiError);
    }
  }
}

// Il cambio piano immediato (upgrade) passa dalla Subscription stessa
// (vedi handleOmniaAiSubscriptionUpdated). Un downgrade invece è sempre
// gestito da una Subscription Schedule a due fasi: questo handler legge
// la fase successiva a quella corrente (se esiste) per capire se c'è un
// cambio in programma, a quale piano e da quando — mai scritto
// dall'azione che lo richiede, solo da qui.
async function handleOmniaAiSubscriptionScheduleEvent(schedule: Stripe.SubscriptionSchedule) {
  // Al rilascio Stripe svuota "subscription" e sposta l'id in
  // "released_subscription" (la schedule non gestisce più nulla, ma
  // l'abbonamento sottostante resta) — senza questo fallback l'evento
  // "released" non troverebbe a chi appartiene, e piano_programmato
  // resterebbe scritto per sempre dopo un annullamento.
  const stripeSubscriptionId =
    (typeof schedule.subscription === "string" ? schedule.subscription : schedule.subscription?.id) ??
    schedule.released_subscription ??
    undefined;

  if (!stripeSubscriptionId) return;

  const admin = createAdminClient();

  let pianoProgrammato: string | null = null;
  let pianoProgrammatoDa: string | null = null;

  const rilasciata = schedule.status === "released" || schedule.status === "canceled";

  if (!rilasciata && schedule.current_phase) {
    // La fase che inizia esattamente dove finisce quella corrente: nel
    // nostro modello a due fasi è sempre e solo l'eventuale downgrade
    // programmato, non serve assumere un ordine nell'array.
    const faseSuccessiva = schedule.phases.find((f) => f.start_date === schedule.current_phase!.end_date);
    const itemSuccessivo = faseSuccessiva?.items[0];

    if (itemSuccessivo) {
      const priceId = typeof itemSuccessivo.price === "string" ? itemSuccessivo.price : itemSuccessivo.price.id;
      try {
        const stripe = createStripeClient();
        const price = await stripe.prices.retrieve(priceId);
        const slug = pianoDaLookupKey(price.lookup_key);
        if (slug) {
          pianoProgrammato = slug;
          pianoProgrammatoDa = new Date(faseSuccessiva.start_date * 1000).toISOString();
        }
      } catch (err) {
        console.error("Webhook Stripe (schedule AI): errore recupero prezzo fase successiva", err);
      }
    }
  }

  const { error } = await admin
    .from("subscriptions")
    .update({
      stripe_schedule_id: rilasciata ? null : schedule.id,
      piano_programmato: pianoProgrammato,
      piano_programmato_da: pianoProgrammatoDa,
    })
    .eq("stripe_subscription_id", stripeSubscriptionId);

  if (error) {
    console.error("Webhook Stripe (schedule AI): errore aggiornamento subscription", error);
  }
}

async function handleOmniaAiCreditsCheckoutCompleted(session: Stripe.Checkout.Session) {
  const metadata = session.metadata;
  const userId = metadata?.userId;
  const pacchettoSlug = metadata?.pacchetto;

  if (!userId || !pacchettoSlug || !(pacchettoSlug in PACCHETTI_CREDITI)) {
    console.error(
      "Webhook Stripe (crediti AI): dati mancanti o pacchetto non valido nella sessione",
      session.id,
    );
    return;
  }

  const pacchetto = PACCHETTI_CREDITI[pacchettoSlug as PacchettoCreditiSlug];
  const admin = createAdminClient();

  // Idempotenza: Stripe può reinviare lo stesso evento più volte — stesso
  // meccanismo già usato per orders.stripe_session_id nel ramo
  // e-commerce. La riga qui sotto è anche il registro delle ricariche
  // richiesto per la tappa 6 (data di acquisto compresa).
  const { data: existing } = await admin
    .from("omnia_ai_credit_purchases")
    .select("id")
    .eq("stripe_session_id", session.id)
    .maybeSingle<{ id: string }>();

  if (existing) return;

  const importoCentesimi = session.amount_total ?? pacchetto.prezzoCentesimi;

  const { error: insertError } = await admin.from("omnia_ai_credit_purchases").insert({
    user_id: userId,
    pacchetto: pacchettoSlug,
    crediti: pacchetto.crediti,
    importo_centesimi: importoCentesimi,
    stripe_session_id: session.id,
  });

  if (insertError) {
    // Violazione unique(stripe_session_id): un'altra consegna concorrente
    // dello stesso evento ha già registrato questa ricarica — idempotente,
    // non incrementiamo il saldo una seconda volta.
    if (insertError.code === "23505") return;
    console.error("Webhook Stripe (crediti AI): errore registrazione ricarica", insertError);
    return;
  }

  // Incremento atomico (insert...on conflict dentro la funzione, non una
  // lettura+scrittura qui): protegge anche dalla ricarica concorrente di
  // un pacchetto DIVERSO per lo stesso cliente, un caso che il solo
  // vincolo unique sopra non copre.
  const { error: incrementError } = await admin.rpc("increment_credits", {
    p_user_id: userId,
    p_amount: pacchetto.crediti,
  });

  if (incrementError) {
    console.error("Webhook Stripe (crediti AI): errore incremento saldo crediti", incrementError);
  }
}
