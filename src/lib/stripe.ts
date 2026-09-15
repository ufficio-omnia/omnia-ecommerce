import Stripe from "stripe";

// Due account Stripe, non uno: l'e-commerce è live (STRIPE_SECRET_KEY),
// la zona OMNIA AI resta in modalità di prova (STRIPE_SECRET_KEY_OMNIA_AI)
// finché non si decide di lanciarla per davvero — condividere la stessa
// chiave avrebbe reso ogni abbonamento/credito/cambio piano attivato su
// omnia-ai.it un addebito vero (bug reale osservato in produzione: un
// prezzo creato in test mode non trovato perché la chiave in uso era
// quella live). Ogni chiamata in codice OMNIA AI passa "omnia-ai"
// esplicitamente; il default resta "ecommerce" solo come rete di
// sicurezza per una chiamata dimenticata (fallisce restando sul live
// già in uso, non finisce silenziosamente sul test dell'altra zona).
export function createStripeClient(zone: "ecommerce" | "omnia-ai" = "ecommerce") {
  const key = zone === "omnia-ai" ? process.env.STRIPE_SECRET_KEY_OMNIA_AI! : process.env.STRIPE_SECRET_KEY!;
  return new Stripe(key);
}
