// Disdetta di un abbonamento OMNIA AI su Stripe: l'abbonamento resta attivo fino alla fine del
// periodo già pagato e poi non si rinnova (cancel_at_period_end).
//
// Se c'è un cambio di piano programmato (downgrade con una Subscription Schedule), Stripe rifiuta
// la disdetta diretta («the subscription is managed by the subscription schedule… updating any
// cancelation behavior directly is not allowed», provato su Stripe di prova): il cambio va annullato
// prima. Disdire vale più del downgrade: l'abbonamento resta sul piano attuale fino a fine periodo e
// poi termina. L'upgrade è immediato e non lascia nessuna schedule.
//
// Prende il client Stripe come parametro per poterlo provare con uno finto.

export type StripePerDisdetta = {
  subscriptions: {
    retrieve(id: string): Promise<{ schedule?: string | { id: string } | null }>;
    update(id: string, params: { cancel_at_period_end: boolean }): Promise<unknown>;
  };
  subscriptionSchedules: {
    release(id: string): Promise<unknown>;
  };
};

export async function disdiciSuStripe(
  stripe: StripePerDisdetta,
  stripeSubscriptionId: string,
): Promise<{ cambioProgrammatoAnnullato: boolean }> {
  // Si legge da Stripe (non dal database locale, che arriva dai webhook e può essere in ritardo)
  // se l'abbonamento è gestito da una schedule.
  const abbonamento = await stripe.subscriptions.retrieve(stripeSubscriptionId);
  const scheduleId = typeof abbonamento.schedule === "string" ? abbonamento.schedule : (abbonamento.schedule?.id ?? null);

  // release (non cancel): toglie la schedule e lascia l'abbonamento com'è, sul piano attuale.
  if (scheduleId) await stripe.subscriptionSchedules.release(scheduleId);

  await stripe.subscriptions.update(stripeSubscriptionId, { cancel_at_period_end: true });
  return { cambioProgrammatoAnnullato: scheduleId !== null };
}

export const AVVISO_CAMBIO_PIANO_ANNULLATO_CON_DISDETTA =
  "Il cambio di piano programmato è stato annullato: l'abbonamento resta sul piano attuale fino alla fine del periodo pagato, poi termina.";

export function testoConfermaDisdetta(dataRinnovo: string | null, cambioPianoProgrammato: boolean): string {
  const fine = dataRinnovo ?? "termine del periodo corrente";
  const cambio = cambioPianoProgrammato
    ? ` Il cambio di piano programmato verrà annullato: l'abbonamento resta sul piano attuale fino al ${fine} e poi termina.`
    : "";
  return `Disdire l'abbonamento? Il servizio resta attivo fino al ${fine}, comprese le gare residue del piano: da quella data non si rinnova più.${cambio} I crediti aggiuntivi residui si estinguono con la cessazione, senza rimborso.`;
}
