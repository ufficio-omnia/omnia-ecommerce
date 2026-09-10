"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createStripeClient } from "@/lib/stripe";
import { sendEmail, ADMIN_EMAIL } from "@/lib/email";
import { effectivePrice } from "@/lib/products";
import { getBankDetails } from "@/lib/bank-details";
import {
  getCurrentLegalDocuments,
  getRequestMeta,
  recordLegalAcceptances,
  validateLegalAcceptance,
  type AcceptanceInput,
  type BuyerType,
} from "@/lib/legal-acceptance";

export type ActionState = { error?: string; url?: string };

function parseBuyerType(formData: FormData): BuyerType | null {
  const value = String(formData.get("buyerType") ?? "");
  return value === "azienda" || value === "consumatore" ? value : null;
}

function parseAcceptance(formData: FormData): AcceptanceInput {
  return {
    condizioniEPrivacy: formData.get("acceptCondizioniPrivacy") === "on",
    esecuzioneImmediata: formData.get("acceptEsecuzioneImmediata") === "on",
    clausoleSpecifiche: formData.get("acceptClausoleSpecifiche") === "on",
  };
}

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
  const indirizzo = String(formData.get("indirizzo") ?? "").trim();
  const partitaIva = String(formData.get("partitaIva") ?? "").trim();
  const codiceFiscale = String(formData.get("codiceFiscale") ?? "").trim();
  const codiceSdi = String(formData.get("codiceSdi") ?? "").trim();
  const pec = String(formData.get("pec") ?? "").trim();
  const buyerType = parseBuyerType(formData);
  const acceptance = parseAcceptance(formData);

  if (!email) {
    return { error: "Inserisci un indirizzo email." };
  }

  if (!buyerType) {
    return { error: "Seleziona il tipo di acquirente." };
  }

  if (!ragioneSociale || !indirizzo) {
    return {
      error:
        buyerType === "azienda"
          ? "Ragione sociale e indirizzo sono obbligatori per la fattura."
          : "Nome e cognome e indirizzo sono obbligatori per la fattura.",
    };
  }

  if (buyerType === "azienda") {
    if (!partitaIva) {
      return { error: "La partita IVA è obbligatoria per la fattura." };
    }
    if (!codiceSdi && !pec) {
      return { error: "Inserisci almeno uno tra codice SDI e PEC." };
    }
  } else if (!codiceFiscale) {
    return { error: "Il codice fiscale è obbligatorio per la fattura." };
  }

  // Controllo server-side, indipendente da qualsiasi validazione fatta
  // nel browser: un pulsante disabilitato lato client non impedisce a
  // nessuno di inviare comunque la richiesta.
  const acceptanceError = validateLegalAcceptance(buyerType, acceptance);
  if (acceptanceError) {
    return { error: acceptanceError };
  }

  const admin = createAdminClient();

  const legalDocuments = await getCurrentLegalDocuments(admin);
  if (!legalDocuments) {
    return { error: "Errore nel recupero dei documenti legali. Riprova." };
  }

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

  // Registrata SUBITO dopo la creazione dell'ordine, prima di qualunque
  // email o redirect: se le accettazioni non si salvano, meglio saperlo
  // ora che scoprirlo in caso di contestazione futura.
  const { ip, userAgent } = await getRequestMeta();
  const acceptedAt = new Date().toISOString();
  const acceptanceResult = await recordLegalAcceptances({
    admin,
    orderId: order.id,
    userId: profile.id,
    buyerType,
    input: acceptance,
    documents: legalDocuments,
    ip,
    userAgent,
    acceptedAt,
  });

  if (acceptanceResult.error) {
    return { error: acceptanceResult.error };
  }

  await sendEmail({
    to: ADMIN_EMAIL,
    subject: `Nuovo ordine (bonifico): ${product.title}`,
    html: `
      <p><strong>Nuovo ordine ricevuto</strong></p>
      <p>Numero ordine: ${order.id.slice(0, 8)}</p>
      <p>Metodo di pagamento: bonifico bancario</p>
      <p>Documento acquistato: ${product.title}</p>
      <p>Importo (IVA inclusa): ${Number(effectivePrice(product)).toLocaleString("it-IT", { style: "currency", currency: "EUR" })}</p>
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

  const bank = await getBankDetails();
  await sendEmail({
    to: email,
    subject: "Istruzioni per il pagamento tramite bonifico",
    html: `
      <p>Grazie per il tuo ordine.</p>
      <p><strong>Documento:</strong> ${product.title}</p>
      <p><strong>Importo (IVA inclusa):</strong> ${Number(effectivePrice(product)).toLocaleString("it-IT", { style: "currency", currency: "EUR" })}</p>
      <p><strong>IBAN:</strong> ${bank.iban}</p>
      <p><strong>Intestatario:</strong> ${bank.intestatario}</p>
      <p><strong>Causale:</strong> Ordine ${order.id.slice(0, 8)}</p>
      <p>Il documento sarà disponibile nella tua area riservata non appena confermiamo la ricezione del bonifico.</p>
      <p style="margin-top:16px;">Hai accettato le
        <a href="${legalDocUrl("condizioni-vendita", legalDocuments.condizioniVendita.version)}">Condizioni generali di vendita (versione ${legalDocuments.condizioniVendita.version})</a>
        e preso visione della
        <a href="${legalDocUrl("privacy-policy", legalDocuments.privacyPolicy.version)}">Privacy policy (versione ${legalDocuments.privacyPolicy.version})</a>.
        ${
          buyerType === "consumatore"
            ? "Hai inoltre richiesto espressamente l'esecuzione immediata della fornitura, con conseguente perdita del diritto di recesso."
            : ""
        }
      </p>
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

function legalDocUrl(type: string, version: number) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return `${siteUrl}/documenti-legali/${type}/${version}`;
}

export async function startCardCheckout(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const productId = String(formData.get("productId") ?? "");
  const ragioneSociale = String(formData.get("ragioneSociale") ?? "").trim();
  const indirizzo = String(formData.get("indirizzo") ?? "").trim();
  const partitaIva = String(formData.get("partitaIva") ?? "").trim();
  const codiceFiscale = String(formData.get("codiceFiscale") ?? "").trim();
  const codiceSdi = String(formData.get("codiceSdi") ?? "").trim();
  const pec = String(formData.get("pec") ?? "").trim();
  const buyerType = parseBuyerType(formData);
  const acceptance = parseAcceptance(formData);

  if (!email) {
    return { error: "Inserisci un indirizzo email." };
  }

  if (!buyerType) {
    return { error: "Seleziona il tipo di acquirente." };
  }

  if (!ragioneSociale || !indirizzo) {
    return {
      error:
        buyerType === "azienda"
          ? "Ragione sociale e indirizzo sono obbligatori per la fattura."
          : "Nome e cognome e indirizzo sono obbligatori per la fattura.",
    };
  }

  if (buyerType === "azienda") {
    if (!partitaIva) {
      return { error: "La partita IVA è obbligatoria per la fattura." };
    }
    if (!codiceSdi && !pec) {
      return { error: "Inserisci almeno uno tra codice SDI e PEC." };
    }
  } else if (!codiceFiscale) {
    return { error: "Il codice fiscale è obbligatorio per la fattura." };
  }

  // Stesso controllo server-side del bonifico: se manca qualcosa, la
  // richiesta si ferma qui, PRIMA di creare la sessione Stripe e quindi
  // prima di qualunque reindirizzamento a Stripe.
  const acceptanceError = validateLegalAcceptance(buyerType, acceptance);
  if (acceptanceError) {
    return { error: acceptanceError };
  }

  const admin = createAdminClient();

  const legalDocuments = await getCurrentLegalDocuments(admin);
  if (!legalDocuments) {
    return { error: "Errore nel recupero dei documenti legali. Riprova." };
  }

  const { data: product, error: productError } = await admin
    .from("products")
    .select("id, title, price, discount_active, discount_price")
    .eq("id", productId)
    .single();

  if (productError || !product) {
    return { error: "Prodotto non trovato." };
  }

  // L'ordine carta viene creato solo dopo il pagamento, dal webhook
  // Stripe (vedi src/app/api/webhooks/stripe/route.ts): l'accettazione
  // va quindi catturata ORA (unico momento in cui abbiamo IP e user
  // agent della richiesta del cliente) e passata nei metadata della
  // sessione, per essere registrata nella stessa operazione che crea
  // l'ordine, dentro al webhook.
  const { ip, userAgent } = await getRequestMeta();
  const acceptedAt = new Date().toISOString();

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
        codiceFiscale,
        indirizzo,
        codiceSdi,
        pec,
        buyerType,
        acceptCondizioniPrivacy: String(acceptance.condizioniEPrivacy),
        acceptEsecuzioneImmediata: String(acceptance.esecuzioneImmediata),
        acceptClausoleSpecifiche: String(acceptance.clausoleSpecifiche),
        acceptedAt,
        acceptIp: ip ?? "",
        acceptUserAgent: (userAgent ?? "").slice(0, 490),
        condizioniVenditaDocId: legalDocuments.condizioniVendita.id,
        condizioniVenditaVersion: String(legalDocuments.condizioniVendita.version),
        privacyPolicyDocId: legalDocuments.privacyPolicy.id,
        privacyPolicyVersion: String(legalDocuments.privacyPolicy.version),
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

  // Non usiamo redirect(): il pagamento Stripe si apre in una nuova
  // scheda (gestito dal componente client), lasciando la pagina prodotto
  // aperta nella scheda originale.
  return { url: session.url };
}
