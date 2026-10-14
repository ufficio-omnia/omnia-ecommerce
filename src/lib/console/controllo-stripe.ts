import { createStripeClient } from "@/lib/stripe";
import { analizzaWebhook, type DestinazioneWebhook, type StatoPortale, type StatoWebhook } from "./controllo-stripe-calcoli";

// Lettura (mai scrittura) della configurazione Stripe di OMNIA AI sull'account della chiave in uso:
// destinazioni del webhook con i loro eventi e portale clienti. Serve alla pagina «Piani e prezzi».
// Una chiave con permessi limitati può non riuscire a leggere: allora «non verificabile», mai un errore
// che blocchi la pagina.

export type ControlloStripe = {
  webhook: StatoWebhook;
  destinazioni: DestinazioneWebhook[];
  portale: StatoPortale;
};

export async function leggiControlloStripe(): Promise<ControlloStripe> {
  if (!process.env.STRIPE_SECRET_KEY_OMNIA_AI) return { webhook: { verificabile: false }, destinazioni: [], portale: "non_verificabile" };
  const stripe = createStripeClient("omnia-ai");

  let destinazioni: DestinazioneWebhook[] = [];
  let webhook: StatoWebhook = { verificabile: false };
  try {
    const lista = await stripe.webhookEndpoints.list({ limit: 100 });
    destinazioni = lista.data.map((e) => ({ url: e.url, stato: e.status, eventi: e.enabled_events }));
    webhook = { verificabile: true, ...analizzaWebhook(destinazioni) };
  } catch (e) {
    console.error("Console: lettura delle destinazioni webhook di Stripe fallita", e instanceof Error ? e.message : e);
  }

  let portale: StatoPortale = "non_verificabile";
  try {
    const configurazioni = await stripe.billingPortal.configurations.list({ is_default: true, active: true, limit: 1 });
    const predefinita = configurazioni.data[0];
    portale = predefinita && predefinita.features.payment_method_update.enabled ? "configurato" : "mancante";
  } catch (e) {
    console.error("Console: lettura del portale clienti di Stripe fallita", e instanceof Error ? e.message : e);
  }

  return { webhook, destinazioni, portale };
}
