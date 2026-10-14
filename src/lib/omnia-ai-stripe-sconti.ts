import type Stripe from "stripe";

// Sconti OMNIA AI su Stripe. Ogni sconto è un coupon a IMPORTO FISSO (mai una percentuale): lo
// sconto in percentuale lo calcoliamo noi sul listino e Stripe sottrae esattamente quell'importo,
// così il prezzo mostrato al cliente e quello addebitato coincidono al centesimo (le percentuali
// di Stripe arrotondano a modo loro). L'identificativo del coupon è deterministico (sconto +
// importo + durata): si recupera se esiste, si crea se manca, in prova come in produzione, senza
// salvare nel database identificativi Stripe che cambiano da un ambiente all'altro.

export function idCouponSconto(scontoId: string, risparmioCentesimi: number, durataMesi: number): string {
  return `oa_${scontoId.replace(/-/g, "").slice(0, 12)}_${risparmioCentesimi}_${durataMesi}`;
}

export async function assicuraCoupon(
  stripe: Stripe,
  params: { id: string; risparmioCentesimi: number; durataMesi: number; nome: string },
): Promise<string> {
  try {
    const esistente = await stripe.coupons.retrieve(params.id);
    if (esistente.amount_off !== params.risparmioCentesimi) throw new Error(`Il coupon ${params.id} esiste con un importo diverso (${esistente.amount_off}).`);
    return esistente.id;
  } catch (errore) {
    if ((errore as { code?: string }).code !== "resource_missing") throw errore;
  }

  const creato = await stripe.coupons.create({
    id: params.id,
    name: params.nome.slice(0, 40),
    amount_off: params.risparmioCentesimi,
    currency: "eur",
    ...(params.durataMesi === 0 ? { duration: "forever" as const } : { duration: "repeating" as const, duration_in_months: params.durataMesi }),
  });
  return creato.id;
}
