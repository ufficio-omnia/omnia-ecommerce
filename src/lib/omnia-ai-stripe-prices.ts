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

// L'abbonamento con il piano di lavoro è UN SOLO prezzo Stripe per piano (importo = listino + surplus), con il suffisso «_pdl»:
// una sola riga di abbonamento, quindi tutto il resto del sistema (webhook, cambio piano, offerte pilot) continua a leggere
// items.data[0]. Dal prezzo si risale al piano E al fatto che il piano di lavoro sia incluso.
export const SUFFISSO_PIANO_LAVORO = "_pdl";

export type OffertaStripe = { piano: PianoSlug; pianoLavoro: boolean };

function lookupKeyPerOfferta(piano: PianoSlug, pianoLavoro: boolean): string {
  return pianoLavoro ? `${lookupKeyPerPiano(piano)}${SUFFISSO_PIANO_LAVORO}` : lookupKeyPerPiano(piano);
}

// Il prezzo Stripe ATTIVO di un'offerta (piano con o senza piano di lavoro: quello che si compra oggi). Quando la console cambia il
// prezzo di listino si crea un nuovo prezzo Stripe e il lookup_key passa a lui: gli abbonamenti
// già attivi restano sul vecchio prezzo, che non si tocca.
export async function getStripePrezzoAttivoOfferta(stripe: Stripe, piano: PianoSlug, pianoLavoro: boolean): Promise<Stripe.Price> {
  const lookupKey = lookupKeyPerOfferta(piano, pianoLavoro);
  const prices = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  const price = prices.data[0];

  if (!price) {
    throw new Error(
      `Nessun prezzo Stripe attivo trovato per il piano "${piano}"${pianoLavoro ? " con piano di lavoro" : ""} (lookup_key "${lookupKey}"). Va creato in Stripe prima di poterlo usare.`,
    );
  }

  return price;
}

export async function getStripePrezzoAttivo(stripe: Stripe, piano: PianoSlug): Promise<Stripe.Price> {
  return getStripePrezzoAttivoOfferta(stripe, piano, false);
}

export async function getStripePriceId(stripe: Stripe, piano: PianoSlug): Promise<string> {
  return (await getStripePrezzoAttivo(stripe, piano)).id;
}

export async function getStripePriceIdOfferta(stripe: Stripe, piano: PianoSlug, pianoLavoro: boolean): Promise<string> {
  return (await getStripePrezzoAttivoOfferta(stripe, piano, pianoLavoro)).id;
}

export const lookupKeyDelPiano = lookupKeyPerPiano;
export const lookupKeyDellOfferta = lookupKeyPerOfferta;

// Inverso: da un lookup_key Stripe al piano E al piano di lavoro — usato nel webhook per risalire all'offerta da un prezzo, senza
// fidarsi solo del nome del prodotto/prezzo (che potrebbe cambiare).
export function offertaDaLookupKey(lookupKey: string | null | undefined): OffertaStripe | null {
  if (!lookupKey?.startsWith("omnia_ai_")) return null;
  let slug = lookupKey.slice("omnia_ai_".length);
  let pianoLavoro = false;
  if (slug.endsWith(SUFFISSO_PIANO_LAVORO)) {
    slug = slug.slice(0, -SUFFISSO_PIANO_LAVORO.length);
    pianoLavoro = true;
  }
  return slug in PIANI ? { piano: slug as PianoSlug, pianoLavoro } : null;
}

// Solo il piano (con o senza piano di lavoro): per chi non guarda l'opzione.
export function pianoDaLookupKey(lookupKey: string | null | undefined): PianoSlug | null {
  return offertaDaLookupKey(lookupKey)?.piano ?? null;
}
