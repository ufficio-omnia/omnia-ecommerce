"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createStripeClient } from "@/lib/stripe";
import { sendEmail, ADMIN_EMAIL } from "@/lib/email";
import { effectivePrice } from "@/lib/products";

export type ActionState = { error?: string };

export async function startBankTransferOrder(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // Supabase normalizza le email in minuscolo internamente: normalizziamo
  // anche qui, altrimenti la successiva ricerca per email non trova la
  // riga appena creata se l'utente digita maiuscole diverse.
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const productId = String(formData.get("productId") ?? "");
  const ragioneSociale = String(formData.get("ragioneSociale") ?? "").trim();
  const partitaIva = String(formData.get("partitaIva") ?? "").trim();
  const indirizzo = String(formData.get("indirizzo") ?? "").trim();
  const codiceSdi = String(formData.get("codiceSdi") ?? "").trim();
  const pec = String(formData.get("pec") ?? "").trim();

  if (!email) {
    return { error: "Inserisci un indirizzo email." };
  }

  if (!ragioneSociale || !partitaIva || !indirizzo) {
    return {
      error: "Ragione sociale, P.IVA e indirizzo sono obbligatori per la fattura.",
    };
  }

  if (!codiceSdi && !pec) {
    return { error: "Inserisci almeno uno tra codice SDI e PEC." };
  }

  const admin = createAdminClient();

  const { data: product, error: productError } = await admin
    .from("products")
    .select("id, title, price, discount_active, discount_price")
    .eq("id", productId)
    .single();

  if (productError || !product) {
    return { error: "Prodotto non trovato." };
  }

  const { error: createError } = await admin.auth.admin.createUser({
    email,
    email_confirm: false,
  });

  if (createError && !/already.*registered|already exists/i.test(createError.message)) {
    return { error: `Errore nella creazione dell'account: ${createError.message}` };
  }

  const { data: profile, error: profileError } = await admin
    .from("users")
    .select("id")
    .eq("email", email)
    .single();

  if (profileError || !profile) {
    console.error("Errore recupero profilo:", profileError, "email:", email);
    return { error: "Errore nel recupero del profilo utente." };
  }

  // Non ci basiamo su "account appena creato o no": un tentativo
  // precedente potrebbe aver creato l'account ma essere fallito prima di
  // inviare il link (es. errore di rete). Controlliamo invece se
  // l'account ha davvero già confermato l'email/impostato una password:
  // se no, gli mandiamo comunque il link di attivazione.
  const { data: authUser } = await admin.auth.admin.getUserById(profile.id);
  const needsActivation = !authUser?.user?.email_confirmed_at;

  const { error: companyError } = await admin.from("companies").upsert(
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

  if (companyError) {
    return { error: "Errore nel salvataggio dei dati di fatturazione." };
  }

  const { data: order, error: orderError } = await admin
    .from("orders")
    .insert({
      user_id: profile.id,
      product_id: product.id,
      status: "in_attesa",
      payment_method: "bonifico",
      total_amount: effectivePrice(product),
    })
    .select("id")
    .single();

  if (orderError || !order) {
    return { error: "Errore nella creazione dell'ordine." };
  }

  await sendEmail({
    to: ADMIN_EMAIL,
    subject: `Nuovo ordine (bonifico): ${product.title}`,
    html: `
      <p><strong>Nuovo ordine ricevuto</strong></p>
      <p>Numero ordine: ${order.id.slice(0, 8)}</p>
      <p>Metodo di pagamento: bonifico bancario</p>
      <p>Documento acquistato: ${product.title}</p>
      <p>Importo: ${Number(effectivePrice(product)).toLocaleString("it-IT", { style: "currency", currency: "EUR" })}</p>
      <p><strong>Cliente</strong></p>
      <p>Email: ${email}</p>
      <p>Ragione sociale: ${ragioneSociale}</p>
      <p>Partita IVA: ${partitaIva}</p>
      <p>Indirizzo: ${indirizzo}</p>
      <p>Codice SDI: ${codiceSdi || "—"}</p>
      <p>PEC: ${pec || "—"}</p>
    `,
  });

  // L'email di attivazione (con link per impostare la password) ha senso
  // solo se l'account non ha ancora completato l'attivazione: un cliente
  // già confermato ha già la sua password e vedrà comunque le istruzioni
  // di pagamento a schermo.
  if (needsActivation) {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    const { error: otpError } = await admin.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${siteUrl}/auth/callback?next=/imposta-password`,
      },
    });

    if (otpError) {
      console.error("Errore nell'invio dell'email di attivazione:", otpError);
    }
  }

  redirect(
    `/checkout/bonifico-istruzioni/${order.id}${needsActivation ? "?new=1" : ""}`,
  );
}

export async function startCardCheckout(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const productId = String(formData.get("productId") ?? "");
  const ragioneSociale = String(formData.get("ragioneSociale") ?? "").trim();
  const partitaIva = String(formData.get("partitaIva") ?? "").trim();
  const indirizzo = String(formData.get("indirizzo") ?? "").trim();
  const codiceSdi = String(formData.get("codiceSdi") ?? "").trim();
  const pec = String(formData.get("pec") ?? "").trim();

  if (!email) {
    return { error: "Inserisci un indirizzo email." };
  }

  if (!ragioneSociale || !partitaIva || !indirizzo) {
    return {
      error: "Ragione sociale, P.IVA e indirizzo sono obbligatori per la fattura.",
    };
  }

  if (!codiceSdi && !pec) {
    return { error: "Inserisci almeno uno tra codice SDI e PEC." };
  }

  const admin = createAdminClient();

  const { data: product, error: productError } = await admin
    .from("products")
    .select("id, title, price, discount_active, discount_price")
    .eq("id", productId)
    .single();

  if (productError || !product) {
    return { error: "Prodotto non trovato." };
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const stripe = createStripeClient();

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: email,
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: { name: product.title },
            unit_amount: Math.round(effectivePrice(product) * 100),
          },
          quantity: 1,
        },
      ],
      metadata: {
        productId: product.id,
        ragioneSociale,
        partitaIva,
        indirizzo,
        codiceSdi,
        pec,
      },
      success_url: `${siteUrl}/checkout/carta-successo?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/prodotti/${product.id}`,
    });
  } catch (err) {
    console.error("Errore creazione sessione Stripe:", err);
    return { error: "Errore nell'avvio del pagamento. Riprova." };
  }

  if (!session.url) {
    return { error: "Errore nell'avvio del pagamento. Riprova." };
  }

  redirect(session.url);
}
