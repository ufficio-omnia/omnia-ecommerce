import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { createStripeClient } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, ADMIN_EMAIL } from "@/lib/email";
import { recordLegalAcceptances, type BuyerType } from "@/lib/legal-acceptance";

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

  if (event.type === "checkout.session.completed") {
    await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
  }

  return NextResponse.json({ received: true });
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
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
