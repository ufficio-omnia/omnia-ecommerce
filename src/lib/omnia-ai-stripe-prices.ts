import type Stripe from "stripe";
import { PIANI, type PianoSlug } from "@/lib/omnia-ai-plans";

// Servono prezzi Stripe PERSISTENTI (non più price_data creato al volo
// ad ogni checkout, come nella tappa 4): un cambio piano programmato
// (Subscription Schedule) deve poter riferire lo stesso prezzo più
// volte nel tempo, e un price_data inline ne crea uno nuovo — e diverso
// — a ogni chiamata. lookup_key invece di un id salvato in codice: l'id
// del prezzo cambia tra modalità test e live, il lookup_key resta lo
// stesso in entrambe (create-price-lookup-keys.md, stessa idea già
// applicata al portale clienti). Creati una tantum in Stripe (una volta
// per ambiente), non da questo codice.
function lookupKeyPerPiano(piano: PianoSlug): string {
  return `omnia_ai_${piano}`;
}

// Il prezzo Stripe ATTIVO di un piano (quello che si compra oggi). Quando la console cambia il
// prezzo di listino si crea un nuovo prezzo Stripe e il lookup_key passa a lui: gli abbonamenti
// già attivi restano sul vecchio prezzo, che non si tocca.
export async function getStripePrezzoAttivo(stripe: Stripe, piano: PianoSlug): Promise<Stripe.Price> {
  const lookupKey = lookupKeyPerPiano(piano);
  const prices = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  const price = prices.data[0];

  if (!price) {
    throw new Error(
      `Nessun prezzo Stripe attivo trovato per il piano "${piano}" (lookup_key "${lookupKey}"). Va creato in Stripe prima di poterlo usare.`,
    );
  }

  return price;
}

export async function getStripePriceId(stripe: Stripe, piano: PianoSlug): Promise<string> {
  return (await getStripePrezzoAttivo(stripe, piano)).id;
}

export const lookupKeyDelPiano = lookupKeyPerPiano;

// Inverso: da un lookup_key Stripe allo slug del piano — usato nel
// webhook per risalire al piano da un prezzo, senza fidarsi solo del
// nome del prodotto/prezzo (che potrebbe cambiare).
export function pianoDaLookupKey(lookupKey: string | null | undefined): PianoSlug | null {
  if (!lookupKey?.startsWith("omnia_ai_")) return null;
  const slug = lookupKey.slice("omnia_ai_".length);
  return slug in PIANI ? (slug as PianoSlug) : null;
}
