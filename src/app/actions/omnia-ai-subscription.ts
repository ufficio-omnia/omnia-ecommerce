"use server";

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
import { getOmniaAiRequestOrigin } from "@/lib/omnia-ai-request";

export type OmniaAiCheckoutState = { error?: string };

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
  const piano = PIANI[planSlug as PianoSlug];

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

  const origin = await getOmniaAiRequestOrigin();
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

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: user.email,
      billing_address_collection: "required",
      tax_id_collection: { enabled: true },
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: { name: `OMNIA AI — Piano ${piano.nome}` },
            unit_amount: piano.prezzoCentesimi,
            recurring: { interval: "month" },
          },
          quantity: 1,
        },
      ],
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
// disciplina "unica fonte di verità" del resto della Tappa 4. Nessuna
// interfaccia la richiama ancora: arriverà con la pagina di gestione
// abbonamento (Tappa 6), implementata già ora perché è nello scopo di
// questa tappa.
export async function cancelOmniaAiSubscription(): Promise<{ error?: string }> {
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
