"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createStripeClient } from "@/lib/stripe";
import { hasActiveSubscription } from "@/lib/subscription";
import { PIANI, type PianoSlug } from "@/lib/omnia-ai-plans";
import {
  getCurrentOmniaAiLegalDocuments,
  validateOmniaAiAcceptance,
} from "@/lib/omnia-ai-legal";
import { getRequestMeta } from "@/lib/legal-acceptance";
import { getStripePriceId } from "@/lib/omnia-ai-stripe-prices";

export type OmniaAiCheckoutState = { error?: string };

// Costruita dall'host della richiesta corrente, MAI da
// NEXT_PUBLIC_SITE_URL: quella costante è quella dell'e-commerce
// (app.omniaitalia.com), userla qui reindirizzerebbe al dominio
// sbagliato — il checkout di un abbonamento OMNIA AI parte sempre dalla
// zona omnia-ai.it. In sviluppo la zona è risolta via cookie da
// src/proxy.ts: un percorso "di zona" (senza prefisso /site-omnia-ai,
// stesso stile di ogni altro Link in questa area) funziona identico in
// entrambi gli ambienti.
async function getRequestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function startOmniaAiSubscriptionCheckout(
  _prevState: OmniaAiCheckoutState,
  formData: FormData,
): Promise<OmniaAiCheckoutState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email) return { error: "Sessione scaduta, ricarica la pagina." };

  const planSlug = String(formData.get("planSlug") ?? "");
  if (!(planSlug in PIANI)) return { error: "Piano non valido." };

  const acceptance = {
    condizioniEPrivacy: formData.get("acceptCondizioniPrivacy") === "on",
    clausoleSpecifiche: formData.get("acceptClausoleSpecifiche") === "on",
  };

  const acceptanceError = validateOmniaAiAcceptance(acceptance);
  if (acceptanceError) return { error: acceptanceError };

  if (await hasActiveSubscription(user.id)) {
    return { error: "Hai già un abbonamento attivo." };
  }

  const admin = createAdminClient();

  const legalDocuments = await getCurrentOmniaAiLegalDocuments(admin);
  if (!legalDocuments) {
    return { error: "Errore nel recupero dei documenti legali. Riprova." };
  }

  // Catturati ORA (unico momento in cui abbiamo IP e user agent della
  // richiesta del cliente) e passati nei metadata della sessione, per
  // essere registrati dal webhook nella stessa operazione che crea la
  // riga subscriptions — stesso schema del checkout carta e-commerce.
  const { ip, userAgent } = await getRequestMeta();
  const acceptedAt = new Date().toISOString();

  const origin = await getRequestOrigin();
  const stripe = createStripeClient();

  const metadata = {
    tipo: "omnia_ai_abbonamento",
    userId: user.id,
    planSlug,
    acceptCondizioniPrivacy: String(acceptance.condizioniEPrivacy),
    acceptClausoleSpecifiche: String(acceptance.clausoleSpecifiche),
    acceptedAt,
    acceptIp: ip ?? "",
    acceptUserAgent: (userAgent ?? "").slice(0, 490),
    condizioniAbbonamentoDocId: legalDocuments.condizioniAbbonamento.id,
    condizioniAbbonamentoVersion: String(legalDocuments.condizioniAbbonamento.version),
    privacyPolicyDocId: legalDocuments.privacyPolicy.id,
    privacyPolicyVersion: String(legalDocuments.privacyPolicy.version),
  };

  // Prezzo Stripe persistente (mai price_data creato al volo): un
  // eventuale cambio piano futuro, programmato tramite Subscription
  // Schedule, deve poter riferire lo stesso prezzo più volte nel tempo.
  let priceId: string;
  try {
    priceId = await getStripePriceId(stripe, planSlug as PianoSlug);
  } catch (err) {
    console.error("Errore recupero prezzo Stripe (abbonamento AI):", err);
    return { error: "Errore nell'avvio del pagamento. Riprova." };
  }

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: user.email,
      billing_address_collection: "required",
      tax_id_collection: { enabled: true },
      line_items: [{ price: priceId, quantity: 1 }],
      // Scritta sia qui (letta da checkout.session.completed) sia su
      // subscription_data.metadata (letta da customer.subscription.*,
      // che non porta i metadata della sessione): nessuno dei due
      // webhook può restare senza userId, qualunque sia l'ordine di
      // arrivo degli eventi.
      subscription_data: { metadata },
      metadata,
      success_url: `${origin}/dashboard/omnia-ai?abbonamento=attivato`,
      cancel_url: `${origin}/dashboard/omnia-ai`,
    });
  } catch (err) {
    console.error("Errore creazione sessione Stripe (abbonamento AI):", err);
    return { error: "Errore nell'avvio del pagamento. Riprova." };
  }

  if (!session.url) {
    return { error: "Errore nell'avvio del pagamento. Riprova." };
  }

  redirect(session.url);
}

// Non tocca lo stato locale: quello arriva solo dal webhook
// (customer.subscription.updated), mai da questa azione — stessa
// disciplina "unica fonte di verità" del resto della Tappa 4. Firma da
// useActionState (prevState/formData ignorati, non servono: nessun campo
// nel form di disdetta) per restare coerente con le altre azioni della
// zona AI invocate da un form.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function cancelOmniaAiSubscription(_prevState: { error?: string }, _formData: FormData): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Sessione scaduta, ricarica la pagina." };

  const admin = createAdminClient();

  const { data: subscription } = await admin
    .from("subscriptions")
    .select("stripe_subscription_id")
    .eq("user_id", user.id)
    .eq("status", "attivo")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ stripe_subscription_id: string | null }>();

  if (!subscription?.stripe_subscription_id) {
    return { error: "Nessun abbonamento attivo trovato." };
  }

  const stripe = createStripeClient();
  try {
    await stripe.subscriptions.update(subscription.stripe_subscription_id, {
      cancel_at_period_end: true,
    });
  } catch (err) {
    console.error("Errore disdetta abbonamento Stripe:", err);
    return { error: "Errore nella disdetta. Riprova." };
  }

  return {};
}

// Apre il portale clienti Stripe (solo cambio metodo di pagamento e dati
// di fatturazione, disdetta e cambio piano disattivati lì: li gestiamo
// nel nostro flusso, non vogliamo due percorsi diversi per la stessa
// cosa). stripe_customer_id manca sulle subscription create prima di
// questa colonna: recuperato al volo da Stripe tramite
// stripe_subscription_id e scritto qui per le volte successive.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function openOmniaAiBillingPortal(_prevState: { error?: string }, _formData: FormData): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Sessione scaduta, ricarica la pagina." };

  const admin = createAdminClient();

  const { data: subscription } = await admin
    .from("subscriptions")
    .select("id, stripe_subscription_id, stripe_customer_id")
    .eq("user_id", user.id)
    .eq("status", "attivo")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{
      id: string;
      stripe_subscription_id: string | null;
      stripe_customer_id: string | null;
    }>();

  if (!subscription?.stripe_subscription_id) {
    return { error: "Nessun abbonamento attivo trovato." };
  }

  const stripe = createStripeClient();
  let customerId = subscription.stripe_customer_id;

  if (!customerId) {
    try {
      const stripeSub = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id);
      customerId = typeof stripeSub.customer === "string" ? stripeSub.customer : stripeSub.customer.id;
    } catch (err) {
      console.error("Errore recupero customer Stripe per il portale:", err);
      return { error: "Errore nell'apertura del portale pagamenti. Riprova." };
    }

    await admin.from("subscriptions").update({ stripe_customer_id: customerId }).eq("id", subscription.id);
  }

  const origin = await getRequestOrigin();

  let portalSession;
  try {
    portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/dashboard/omnia-ai/abbonamento`,
    });
  } catch (err) {
    console.error("Errore creazione sessione portale Stripe:", err);
    return { error: "Errore nell'apertura del portale pagamenti. Riprova." };
  }

  redirect(portalSession.url);
}
