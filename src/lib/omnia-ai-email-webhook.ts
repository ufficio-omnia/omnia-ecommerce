import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createStripeClient } from "@/lib/stripe";
import { getOmniaAiBaseUrl } from "@/lib/omnia-ai-request";
import { pianoDaLookupKey } from "@/lib/omnia-ai-stripe-prices";
import { tipoIncasso } from "@/lib/omnia-ai-incassi";
import { PACCHETTI_CREDITI, type PacchettoCreditiSlug } from "@/lib/omnia-ai-plans";
import { EMAIL_UFFICIO, inviaEmailEvento } from "@/lib/omnia-ai-email-eventi";
import {
  daUnix,
  descriviMetodo,
  deveAvvisareMancatoPagamento,
  emailClienteDisdettaConfermata,
  emailClienteMetodoPagamento,
  emailClientePagamentoRicevuto,
  emailUfficioCambioPiano,
  emailUfficioCreditiAcquistati,
  emailUfficioDisdetta,
  emailUfficioMancatoPagamento,
  emailUfficioNuovoCliente,
  rilevaCambioProgrammato,
  rilevaVariazioniAbbonamento,
  type AbbonamentoPrima,
  type ClienteEmail,
} from "@/lib/omnia-ai-email-eventi-calcoli";

// Collega gli eventi di Stripe alle email (vedi omnia-ai-email-eventi-calcoli.ts per quali e perché).
// Ogni funzione è «mai bloccante»: un errore qui si scrive nel registro del server e basta, perché
// l'elaborazione dell'evento Stripe (abbonamento, incasso, crediti) è più importante della posta.

type Contesto = { admin: SupabaseClient; livemode: boolean; eventoId: string | null };

// Le sole letture di Stripe che servono alle email (piano di un prezzo, dettagli di una carta):
// parametro opzionale per poterle sostituire nelle prove.
export type StripeLetture = {
  prices: { retrieve(id: string): Promise<{ lookup_key: string | null }> };
  paymentMethods: { retrieve(id: string): Promise<{ card?: { brand?: string | null; last4?: string | null; exp_month?: number | null; exp_year?: number | null } | null }> };
};

export function linkArea(percorso: string): string {
  return `${getOmniaAiBaseUrl()}${percorso}`;
}

// L'email e il nome del cliente dall'archivio (utente + profilo azienda), con i dati di Stripe come ripiego.
export async function leggiCliente(
  admin: SupabaseClient,
  userId: string | null | undefined,
  ripiego: { email?: string | null; nome?: string | null; partitaIva?: string | null } = {},
): Promise<ClienteEmail> {
  let email: string | null = null;
  let nome: string | null = null;
  let partitaIva: string | null = null;
  let codiceFiscale: string | null = null;
  if (userId) {
    const { data: utente } = await admin.from("users").select("email").eq("id", userId).maybeSingle<{ email: string | null }>();
    email = utente?.email ?? null;
    const { data: azienda } = await admin
      .from("companies")
      .select("ragione_sociale, partita_iva, codice_fiscale")
      .eq("user_id", userId)
      .maybeSingle<{ ragione_sociale: string | null; partita_iva: string | null; codice_fiscale: string | null }>();
    nome = azienda?.ragione_sociale ?? null;
    partitaIva = azienda?.partita_iva ?? null;
    codiceFiscale = azienda?.codice_fiscale ?? null;
  }
  return {
    email: email ?? ripiego.email ?? null,
    nome: nome ?? ripiego.nome ?? null,
    partitaIva: partitaIva ?? ripiego.partitaIva ?? null,
    codiceFiscale,
  };
}

export async function eseguiSenzaBloccare(nome: string, azione: () => Promise<void>): Promise<void> {
  try {
    await azione();
  } catch (e) {
    console.error(`Email evento (${nome}) non riuscita:`, e instanceof Error ? e.message : e);
  }
}

// ───── nuovo abbonamento (checkout.session.completed) ─────

export async function notificaNuovoAbbonamento({
  admin,
  livemode,
  eventoId,
  session,
  stripeSubscriptionId,
  planSlug,
  userId,
  accountNuovo,
}: Contesto & {
  session: Stripe.Checkout.Session;
  stripeSubscriptionId: string;
  planSlug: string;
  userId: string;
  accountNuovo: boolean;
}): Promise<void> {
  await eseguiSenzaBloccare("nuovo abbonamento", async () => {
    const { count: abbonamenti } = await admin.from("subscriptions").select("id", { count: "exact", head: true }).eq("user_id", userId);
    const { data: daConsole } = await admin.from("omnia_ai_utenti_console").select("user_id").eq("user_id", userId).maybeSingle();
    const dettagli = session.customer_details;
    const cliente = await leggiCliente(admin, userId, {
      email: dettagli?.email ?? session.customer_email,
      nome: dettagli?.name,
      partitaIva: dettagli?.tax_ids?.[0]?.value ?? null,
    });
    const email = emailUfficioNuovoCliente({
      prova: !livemode,
      primoAbbonamento: (abbonamenti ?? 1) <= 1,
      cliente,
      piano: planSlug,
      importoCentesimi: session.amount_total ?? null,
      quando: new Date(),
      accountNuovo,
      creatoDaConsole: !!daConsole,
      pilot: !!session.metadata?.pilotOffertaId,
      stripeSubscriptionId,
    });
    await inviaEmailEvento({ admin, chiave: `sub:${stripeSubscriptionId}:ufficio:nuovo_cliente`, tipo: "nuovo_cliente", destinatario: "ufficio", a: EMAIL_UFFICIO, email, livemode, userId, eventoStripeId: eventoId });
  });
}

// ───── abbonamento aggiornato (customer.subscription.updated): cambio piano, disdetta ─────

export async function notificaVariazioniAbbonamento({
  admin,
  livemode,
  eventoId,
  subscription,
  userId,
  prima,
  nuovoPiano,
}: Contesto & {
  subscription: Stripe.Subscription;
  userId: string;
  // la riga locale PRIMA dell'aggiornamento
  prima: AbbonamentoPrima | null;
  nuovoPiano: string | null;
}): Promise<void> {
  const variazioni = rilevaVariazioniAbbonamento(prima, { plan: nuovoPiano ?? prima?.plan ?? null, cancel_at_period_end: subscription.cancel_at_period_end });
  if (!variazioni.cambioPiano && !variazioni.disdettaRichiesta) return;

  await eseguiSenzaBloccare("variazioni abbonamento", async () => {
    const cliente = await leggiCliente(admin, userId);

    if (variazioni.cambioPiano) {
      const { direzione, da, a } = variazioni.cambioPiano;
      const email = emailUfficioCambioPiano({ prova: !livemode, cliente, direzione, da, a, dal: null, programmato: false, stripeSubscriptionId: subscription.id });
      await inviaEmailEvento({ admin, chiave: `evt:${eventoId ?? subscription.id}:ufficio:cambio_piano`, tipo: "cambio_piano", destinatario: "ufficio", a: EMAIL_UFFICIO, email, livemode, userId, eventoStripeId: eventoId });
    }

    if (variazioni.disdettaRichiesta) {
      const fineIl = daUnix(subscription.cancel_at) ?? daUnix(subscription.items.data[0]?.current_period_end);
      const piano = nuovoPiano ?? prima?.plan ?? null;
      const chiaveBase = `evt:${eventoId ?? subscription.id}`;
      await inviaEmailEvento({
        admin,
        chiave: `${chiaveBase}:ufficio:disdetta`,
        tipo: "disdetta",
        destinatario: "ufficio",
        a: EMAIL_UFFICIO,
        email: emailUfficioDisdetta({ prova: !livemode, cliente, piano, fineIl, stripeSubscriptionId: subscription.id }),
        livemode,
        userId,
        eventoStripeId: eventoId,
      });
      if (cliente.email) {
        await inviaEmailEvento({
          admin,
          chiave: `${chiaveBase}:cliente:disdetta`,
          tipo: "disdetta_confermata",
          destinatario: "cliente",
          a: cliente.email,
          email: emailClienteDisdettaConfermata({ prova: !livemode, piano, fineIl, linkAbbonamento: linkArea("/dashboard/omnia-ai/abbonamento") }),
          livemode,
          userId,
          eventoStripeId: eventoId,
        });
      } else {
        console.error("Email evento (disdetta): email del cliente non disponibile, conferma non inviata", subscription.id);
      }
    }
  });
}

// ───── cambio piano programmato (subscription_schedule.*): downgrade richiesto ─────

export async function notificaCambioProgrammato({
  admin,
  livemode,
  eventoId,
  stripeSubscriptionId,
  userId,
  prima,
  pianoProgrammato,
  dal,
}: Contesto & {
  stripeSubscriptionId: string;
  userId: string;
  prima: { plan: string | null; piano_programmato: string | null };
  pianoProgrammato: string | null;
  dal: Date | null;
}): Promise<void> {
  const cambio = rilevaCambioProgrammato(prima, pianoProgrammato);
  if (!cambio) return;
  await eseguiSenzaBloccare("cambio piano programmato", async () => {
    const cliente = await leggiCliente(admin, userId);
    const email = emailUfficioCambioPiano({ prova: !livemode, cliente, direzione: cambio.direzione, da: cambio.da, a: cambio.a, dal, programmato: true, stripeSubscriptionId });
    await inviaEmailEvento({ admin, chiave: `evt:${eventoId ?? stripeSubscriptionId}:ufficio:cambio_programmato`, tipo: "cambio_piano", destinatario: "ufficio", a: EMAIL_UFFICIO, email, livemode, userId, eventoStripeId: eventoId });
  });
}

// ───── crediti acquistati (checkout.session.completed, pagamento una tantum) ─────

export async function notificaCreditiAcquistati({
  admin,
  livemode,
  eventoId,
  sessionId,
  userId,
  pacchettoSlug,
  importoCentesimi,
}: Contesto & { sessionId: string; userId: string; pacchettoSlug: PacchettoCreditiSlug; importoCentesimi: number }): Promise<void> {
  await eseguiSenzaBloccare("crediti acquistati", async () => {
    const cliente = await leggiCliente(admin, userId);
    const pacchetto = PACCHETTI_CREDITI[pacchettoSlug];
    const quando = new Date();
    await inviaEmailEvento({
      admin,
      chiave: `sess:${sessionId}:ufficio:crediti`,
      tipo: "acquisto_crediti",
      destinatario: "ufficio",
      a: EMAIL_UFFICIO,
      email: emailUfficioCreditiAcquistati({ prova: !livemode, cliente, pacchetto: pacchettoSlug, crediti: pacchetto.crediti, importoCentesimi, quando }),
      livemode,
      userId,
      eventoStripeId: eventoId,
    });
    if (cliente.email) {
      await inviaEmailEvento({
        admin,
        chiave: `sess:${sessionId}:cliente:pagamento`,
        tipo: "pagamento_ricevuto",
        destinatario: "cliente",
        a: cliente.email,
        email: emailClientePagamentoRicevuto({
          prova: !livemode,
          tipo: "crediti",
          piano: null,
          pacchetto: pacchettoSlug,
          importoCentesimi,
          pagatoIl: quando,
          periodoDal: null,
          periodoAl: null,
          linkPagamenti: linkArea("/dashboard/omnia-ai/pagamenti"),
        }),
        livemode,
        userId,
        eventoStripeId: eventoId,
      });
    }
  });
}

// ───── mancato pagamento (invoice.payment_failed) ─────

export async function notificaMancatoPagamento({
  admin,
  livemode,
  eventoId,
  invoice,
  prima,
  userId,
}: Contesto & { invoice: Stripe.Invoice; prima: { plan: string | null; cancel_at_period_end: boolean | null } | null; userId: string | null }): Promise<void> {
  if (!deveAvvisareMancatoPagamento(prima, invoice.billing_reason) || !invoice.id) return;
  await eseguiSenzaBloccare("mancato pagamento", async () => {
    const cliente = await leggiCliente(admin, userId, { email: invoice.customer_email, nome: invoice.customer_name });
    const definitivo = invoice.next_payment_attempt === null;
    const email = emailUfficioMancatoPagamento({
      prova: !livemode,
      cliente,
      piano: prima?.plan ?? null,
      importoCentesimi: invoice.amount_due ?? 0,
      tentativo: typeof invoice.attempt_count === "number" ? invoice.attempt_count : null,
      prossimoTentativo: daUnix(invoice.next_payment_attempt),
      definitivo,
      motivoFattura: invoice.billing_reason ?? null,
      stripeInvoiceId: invoice.id!,
    });
    // un'email al primo tentativo fallito e, se Stripe poi si arrende, una sola per l'ultimo
    await inviaEmailEvento({
      admin,
      chiave: `invoice:${invoice.id}:ufficio:${definitivo ? "mancato_pagamento_finale" : "mancato_pagamento"}`,
      tipo: "mancato_pagamento",
      destinatario: "ufficio",
      a: EMAIL_UFFICIO,
      email,
      livemode,
      userId,
      eventoStripeId: eventoId,
    });
  });
}

// ───── pagamento ricevuto (invoice.paid) ─────

export async function notificaPagamentoRicevuto({
  admin,
  livemode,
  eventoId,
  invoice,
  stripe,
}: Contesto & { invoice: Stripe.Invoice; stripe?: StripeLetture }): Promise<void> {
  const riferimento = invoice.parent?.subscription_details?.subscription;
  const stripeSubscriptionId = typeof riferimento === "string" ? riferimento : riferimento?.id;
  // stessa regola degli incassi: solo fatture di abbonamento, pagate e a importo positivo
  if (!stripeSubscriptionId || !invoice.id || (invoice.amount_paid ?? 0) <= 0) return;

  await eseguiSenzaBloccare("pagamento ricevuto", async () => {
    const { data: riga } = await admin
      .from("subscriptions")
      .select("user_id, plan")
      .eq("stripe_subscription_id", stripeSubscriptionId)
      .maybeSingle<{ user_id: string; plan: string | null }>();

    const cliente = await leggiCliente(admin, riga?.user_id ?? null, { email: invoice.customer_email, nome: invoice.customer_name });
    if (!cliente.email) {
      console.error("Email evento (pagamento ricevuto): email del cliente non disponibile", invoice.id);
      return;
    }

    const tipoRaw = tipoIncasso(invoice.billing_reason);
    const tipo = tipoRaw === "primo" || tipoRaw === "rinnovo" || tipoRaw === "conguaglio" ? tipoRaw : "altro";

    // Piano e periodo dalla riga positiva della fattura (un conguaglio ne ha anche una a credito).
    const righe = invoice.lines?.data ?? [];
    const rigaPositiva = righe.find((r) => (r.amount ?? 0) > 0) ?? righe[0];
    let piano: string | null = null;
    const prezzoId = (rigaPositiva?.pricing as { price_details?: { price?: string } } | null | undefined)?.price_details?.price;
    if (tipo !== "conguaglio" && prezzoId) {
      try {
        const prezzo = await (stripe ?? createStripeClient("omnia-ai")).prices.retrieve(prezzoId);
        piano = pianoDaLookupKey(prezzo.lookup_key);
      } catch (e) {
        console.error("Email evento (pagamento ricevuto): piano non letto da Stripe", e instanceof Error ? e.message : e);
      }
    }
    piano = piano ?? riga?.plan ?? null;

    await inviaEmailEvento({
      admin,
      chiave: `invoice:${invoice.id}:cliente:pagamento`,
      tipo: "pagamento_ricevuto",
      destinatario: "cliente",
      a: cliente.email,
      email: emailClientePagamentoRicevuto({
        prova: !livemode,
        tipo,
        piano,
        importoCentesimi: invoice.amount_paid,
        pagatoIl: daUnix(invoice.status_transitions?.paid_at) ?? new Date(),
        periodoDal: daUnix(rigaPositiva?.period?.start),
        periodoAl: daUnix(rigaPositiva?.period?.end),
        linkPagamenti: linkArea("/dashboard/omnia-ai/pagamenti"),
      }),
      livemode,
      userId: riga?.user_id ?? null,
      eventoStripeId: eventoId,
    });
  });
}

// ───── cambio del metodo di pagamento (customer.updated / customer.subscription.updated) ─────

export async function notificaCambioMetodoPagamento({
  admin,
  livemode,
  eventoId,
  stripeCustomerId,
  metodoId,
  stripe,
}: Contesto & { stripeCustomerId: string; metodoId: string; stripe?: StripeLetture }): Promise<void> {
  await eseguiSenzaBloccare("metodo di pagamento", async () => {
    // Solo i clienti di OMNIA AI hanno una riga con il loro cliente Stripe.
    const { data: riga } = await admin
      .from("subscriptions")
      .select("user_id")
      .eq("stripe_customer_id", stripeCustomerId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ user_id: string }>();
    if (!riga) return;

    const cliente = await leggiCliente(admin, riga.user_id);
    if (!cliente.email) return;

    let metodo: string | null = null;
    try {
      const pm = await (stripe ?? createStripeClient("omnia-ai")).paymentMethods.retrieve(metodoId);
      metodo = descriviMetodo(pm.card);
    } catch (e) {
      console.error("Email evento (metodo di pagamento): dettagli non letti da Stripe", e instanceof Error ? e.message : e);
    }

    // La chiave è sul NUOVO metodo, non sull'evento: lo stesso cambio può arrivare sia dal cliente
    // sia dall'abbonamento, e deve produrre una sola email.
    await inviaEmailEvento({
      admin,
      chiave: `pm:${stripeCustomerId}:${metodoId}:cliente`,
      tipo: "metodo_pagamento_cambiato",
      destinatario: "cliente",
      a: cliente.email,
      email: emailClienteMetodoPagamento({ prova: !livemode, metodo, linkAbbonamento: linkArea("/dashboard/omnia-ai/abbonamento") }),
      livemode,
      userId: riga.user_id,
      eventoStripeId: eventoId,
    });
  });
}
