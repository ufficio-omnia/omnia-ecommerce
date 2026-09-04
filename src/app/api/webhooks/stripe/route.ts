import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { createStripeClient } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, ADMIN_EMAIL } from "@/lib/email";

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

  const { productId, ragioneSociale, partitaIva, indirizzo, codiceSdi, pec } =
    metadata;

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
      ragione_sociale: ragioneSociale,
      partita_iva: partitaIva,
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

  await sendEmail({
    to: ADMIN_EMAIL,
    subject: `Nuovo ordine (carta): ${product.title}`,
    html: `
      <p><strong>Nuovo ordine ricevuto</strong></p>
      <p>Numero ordine: ${order.id.slice(0, 8)}</p>
      <p>Metodo di pagamento: carta (Stripe)</p>
      <p>Documento acquistato: ${product.title}</p>
      <p>Importo: ${amountCharged.toLocaleString("it-IT", { style: "currency", currency: "EUR" })}</p>
      <p><strong>Cliente</strong></p>
      <p>Email: ${email}</p>
      <p>Ragione sociale: ${ragioneSociale}</p>
      <p>Partita IVA: ${partitaIva}</p>
      <p>Indirizzo: ${indirizzo}</p>
      <p>Codice SDI: ${codiceSdi || "—"}</p>
      <p>PEC: ${pec || "—"}</p>
    `,
  });

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
      html: `<p>Il pagamento è stato confermato.</p><p>Il documento <strong>${product.title}</strong> è ora disponibile nella tua area riservata.</p><p><a href="${siteUrl}/dashboard">Vai alla dashboard</a></p>`,
    });
  }
}
