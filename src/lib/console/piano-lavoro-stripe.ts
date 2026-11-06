import { lookupKeyDelPiano, lookupKeyDellOfferta } from "@/lib/omnia-ai-stripe-prices";
import { PIANI_ORDINE, type PianoSlug } from "@/lib/omnia-ai-plans";

// Allineamento su Stripe dei prezzi dell'abbonamento CON il piano di lavoro (uno per piano, importo = listino + supplemento, chiave «omnia_ai_<piano>_pdl»).
// Separato dall'azione della console per poterlo provare con uno Stripe finto (nessuna rete nei test).
//
// Come per i prezzi dei piani, un prezzo Stripe non si modifica: se l'importo è cambiato si crea un prezzo NUOVO e la chiave passa a lui; il
// vecchio resta com'è e continua a servire gli abbonamenti già attivi. Non archivia e non cancella mai nulla.

export type PrezzoStripePianoLavoro = {
  lookup_key?: string | null;
  unit_amount: number | null;
  currency: string;
  product: string | { id: string };
  recurring?: { interval: string; interval_count?: number } | null;
  tax_behavior?: string | null;
  nickname?: string | null;
  metadata?: Record<string, string> | null;
};

// La parte di Stripe che serve qui (il client vero la rispetta).
export type StripePianoLavoro = {
  prices: {
    list: (p: { lookup_keys: string[]; active: boolean; limit: number }) => PromiseLike<{ data: PrezzoStripePianoLavoro[] }>;
    create: (
      p: {
        product: string;
        currency: string;
        unit_amount: number;
        recurring: { interval: "month"; interval_count: number };
        lookup_key: string;
        transfer_lookup_key?: boolean;
        nickname?: string;
        tax_behavior?: "inclusive" | "exclusive";
        metadata?: Record<string, string>;
      },
      o: { idempotencyKey: string },
    ) => PromiseLike<unknown>;
  };
};

export type OffertaDaAllineare = { piano: PianoSlug; nome: string; importoCentesimi: number };
export type EsitoAllineamentoPianoLavoro = { creati: string[]; aggiornati: string[]; invariati: string[]; errore?: string };

export async function allineaPrezziPianoLavoro(stripe: StripePianoLavoro, offerte: OffertaDaAllineare[]): Promise<EsitoAllineamentoPianoLavoro> {
  const esito: EsitoAllineamentoPianoLavoro = { creati: [], aggiornati: [], invariati: [] };
  try {
    const chiavi = [...PIANI_ORDINE.map(lookupKeyDelPiano), ...PIANI_ORDINE.map((p) => lookupKeyDellOfferta(p, true))];
    const attivi = await stripe.prices.list({ lookup_keys: chiavi, active: true, limit: 20 });
    const perChiave = new Map(attivi.data.flatMap((p) => (p.lookup_key ? [[p.lookup_key, p] as const] : [])));

    for (const o of offerte) {
      const corrente = perChiave.get(lookupKeyDellOfferta(o.piano, true));
      if (corrente && corrente.unit_amount === o.importoCentesimi) {
        esito.invariati.push(o.nome);
        continue;
      }
      // il prodotto è lo stesso del prezzo già esistente dell'offerta o, se non c'è, del prezzo del piano senza piano di lavoro
      const modello = corrente ?? perChiave.get(lookupKeyDelPiano(o.piano));
      if (!modello) {
        return { ...esito, errore: `Su Stripe manca anche il prezzo del piano ${o.nome}: crealo prima da «Piani e prezzi». Nessun altro prezzo è stato toccato.` };
      }
      const prodotto = typeof modello.product === "string" ? modello.product : modello.product.id;
      await stripe.prices.create(
        {
          product: prodotto,
          currency: modello.currency || "eur",
          unit_amount: o.importoCentesimi,
          recurring: { interval: "month", interval_count: modello.recurring?.interval_count ?? 1 },
          lookup_key: lookupKeyDellOfferta(o.piano, true),
          // il lookup_key passa al prezzo nuovo; quello vecchio resta com'è e continua a servire gli abbonamenti già attivi
          ...(corrente ? { transfer_lookup_key: true } : {}),
          nickname: `${o.nome} con piano di lavoro`,
          ...(modello.tax_behavior === "inclusive" || modello.tax_behavior === "exclusive" ? { tax_behavior: modello.tax_behavior } : {}),
        },
        // un secondo clic o una richiesta doppia non devono creare due prezzi: stessa chiave di idempotenza
        { idempotencyKey: `omnia-ai-pdl-${o.piano}-${o.importoCentesimi}` },
      );
      (corrente ? esito.aggiornati : esito.creati).push(o.nome);
    }
    return esito;
  } catch (e) {
    console.error("Console: allineamento dei prezzi del piano di lavoro su Stripe fallito", e instanceof Error ? e.message : e);
    const fatti = [...esito.creati, ...esito.aggiornati];
    return { ...esito, errore: `Operazione non riuscita${fatti.length > 0 ? ` dopo ${fatti.join(", ")}` : ""}: controlla su Stripe quali prezzi esistono e riprova.` };
  }
}
