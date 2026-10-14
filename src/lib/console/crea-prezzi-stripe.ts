import { lookupKeyDelPiano } from "@/lib/omnia-ai-stripe-prices";
import { PIANI_ORDINE } from "@/lib/omnia-ai-plans";
import type { PianoDaControllare } from "./controllo-stripe-calcoli";

// Creazione su Stripe dei prezzi mensili dei piani che non ne hanno nessuno attivo. Separata
// dall'azione della console per poterla provare con uno Stripe finto (nessuna rete nei test).
//
// Non modifica, non archivia e non sostituisce MAI un prezzo esistente: crea solo ciò che manca.

export const NOME_PRODOTTO_ABBONAMENTO = "OMNIA AI — Abbonamento";

// La parte di Stripe che serve qui (il client vero la rispetta).
export type StripeCreaPrezzi = {
  prices: {
    list: (p: { lookup_keys: string[]; active: boolean; limit: number }) => PromiseLike<{ data: { product: string | { id: string } }[] }>;
    create: (
      p: { product: string; currency: string; unit_amount: number; recurring: { interval: "month" }; lookup_key: string; nickname: string },
      o: { idempotencyKey: string },
    ) => PromiseLike<unknown>;
  };
  products: {
    create: (p: { name: string }, o: { idempotencyKey: string }) => PromiseLike<{ id: string }>;
  };
};

export type EsitoCreazionePrezzi = { creati: string[]; errore?: string };

export async function creaPrezziSuStripe(stripe: StripeCreaPrezzi, daCreare: PianoDaControllare[]): Promise<EsitoCreazionePrezzi> {
  const creati: string[] = [];
  if (daCreare.length === 0) return { creati };
  try {
    // Lo stesso prodotto di quelli già esistenti, se ce ne sono; altrimenti uno nuovo.
    const esistenti = await stripe.prices.list({ lookup_keys: PIANI_ORDINE.map(lookupKeyDelPiano), active: true, limit: 10 });
    const prodottoEsistente = esistenti.data[0]?.product;
    let prodotto = typeof prodottoEsistente === "string" ? prodottoEsistente : prodottoEsistente?.id;
    if (!prodotto) prodotto = (await stripe.products.create({ name: NOME_PRODOTTO_ABBONAMENTO }, { idempotencyKey: "omnia-ai-prodotto-abbonamento" })).id;

    for (const p of daCreare) {
      // un secondo clic o una richiesta doppia non devono creare due prezzi: stessa chiave di idempotenza
      await stripe.prices.create(
        { product: prodotto, currency: "eur", unit_amount: p.listinoCentesimi, recurring: { interval: "month" }, lookup_key: lookupKeyDelPiano(p.slug), nickname: p.nome },
        { idempotencyKey: `omnia-ai-prezzo-${p.slug}-${p.listinoCentesimi}` },
      );
      creati.push(p.nome);
    }
    return { creati };
  } catch (e) {
    console.error("Console: creazione dei prezzi su Stripe fallita", e instanceof Error ? e.message : e);
    return { creati, errore: `Creazione non riuscita${creati.length > 0 ? ` dopo ${creati.join(", ")}` : ""}: controlla su Stripe quali prezzi esistono e riprova.` };
  }
}
