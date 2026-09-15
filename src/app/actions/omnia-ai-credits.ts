"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createStripeClient } from "@/lib/stripe";
import { hasActiveSubscription } from "@/lib/subscription";
import { PACCHETTI_CREDITI, type PacchettoCreditiSlug } from "@/lib/omnia-ai-plans";
import { getOmniaAiRequestOrigin } from "@/lib/omnia-ai-request";

export type OmniaAiCreditsCheckoutState = { error?: string };

// Acquisto una tantum (mode:"payment", non subscription) riservato a chi
// ha già un abbonamento attivo: i crediti si estinguono con la
// cessazione dell'abbonamento, non ha senso venderli a chi non ne ha
// uno. Autenticazione ed abbonamento attivo sono controllati QUI, lato
// server, non solo nascosti dietro il layout della dashboard — chiunque
// chiami l'azione direttamente deve trovare lo stesso rifiuto.
export async function startOmniaAiCreditsCheckout(
  _prevState: OmniaAiCreditsCheckoutState,
  formData: FormData,
): Promise<OmniaAiCreditsCheckoutState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email) return { error: "Devi accedere al tuo account per acquistare crediti." };

  const pacchettoSlug = String(formData.get("pacchetto") ?? "");
  if (!(pacchettoSlug in PACCHETTI_CREDITI)) return { error: "Pacchetto non valido." };
  const pacchetto = PACCHETTI_CREDITI[pacchettoSlug as PacchettoCreditiSlug];

  if (!(await hasActiveSubscription(user.id))) {
    return { error: "L'acquisto di crediti aggiuntivi è riservato a chi ha un abbonamento attivo." };
  }

  const origin = await getOmniaAiRequestOrigin();
  const stripe = createStripeClient("omnia-ai");

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      // Cliente già autenticato: l'email va a Stripe precompilata dalla
      // sessione, mai da un campo del form — stessa regola già applicata
      // al checkout dell'abbonamento.
      customer_email: user.email,
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: { name: `OMNIA AI — ${pacchetto.nome}` },
            unit_amount: pacchetto.prezzoCentesimi,
          },
          quantity: 1,
        },
      ],
      metadata: {
        tipo: "omnia_ai_crediti",
        userId: user.id,
        pacchetto: pacchettoSlug,
      },
      // Il saldo si aggiorna solo dal webhook, mai da questa pagina di
      // ritorno: success_url non fa altro che riportare l'utente alla
      // pagina di gestione abbonamento (tappa 6).
      success_url: `${origin}/dashboard/omnia-ai/abbonamento?crediti=acquistati`,
      cancel_url: `${origin}/dashboard/omnia-ai/abbonamento`,
    });
  } catch (err) {
    console.error("Errore creazione sessione Stripe (crediti AI):", err);
    return { error: "Errore nell'avvio del pagamento. Riprova." };
  }

  if (!session.url) {
    return { error: "Errore nell'avvio del pagamento. Riprova." };
  }

  redirect(session.url);
}
