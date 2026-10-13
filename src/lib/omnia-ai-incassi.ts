import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

// Registro degli incassi degli abbonamenti OMNIA AI (tabella omnia_ai_incassi,
// migrazione 0078). Condiviso dal webhook Stripe (evento invoice.paid) e dallo
// script di backfill (scripts/backfill-incassi-stripe.ts): la STESSA funzione
// trasforma una fattura Stripe in una riga, così un incasso registrato dal
// webhook e uno recuperato dal backfill sono identici.
//
// Solo le fatture di ABBONAMENTO e PAGATE diventano incassi. I crediti
// aggiuntivi sono pagamenti una tantum di Checkout, non fatture: restano in
// omnia_ai_credit_purchases (già registrati dal webhook).

export type TipoIncasso = "primo" | "rinnovo" | "conguaglio" | "altro";

export type ClienteSnapshot = {
  nome: string | null;
  email: string | null;
  telefono: string | null;
  indirizzo: {
    riga1: string | null;
    riga2: string | null;
    cap: string | null;
    citta: string | null;
    provincia: string | null;
    paese: string | null;
  } | null;
  // partite IVA / codici fiscali raccolti da Stripe, con il tipo ("eu_vat", "it_cf", ...)
  identificativi_fiscali: { tipo: string; valore: string }[];
};

export type IncassoDaRegistrare = {
  stripe_invoice_id: string;
  stripe_subscription_id: string;
  stripe_customer_id: string | null;
  tipo: TipoIncasso;
  importo_lordo_centesimi: number;
  // calcolati da Stripe; nulli se Stripe non ha calcolato imposte (vedi migrazione 0078)
  imposta_centesimi: number | null;
  imponibile_centesimi: number | null;
  valuta: string;
  pagato_il: string;
  livemode: boolean;
  numero_ricevuta: string | null;
  ricevuta_url: string | null;
  cliente_snapshot: ClienteSnapshot | null;
};

// Perché la fattura è stata emessa → che cosa rappresenta per noi.
export function tipoIncasso(motivo: string | null | undefined): TipoIncasso {
  switch (motivo) {
    case "subscription_create":
      return "primo";
    case "subscription_cycle":
      return "rinnovo";
    case "subscription_update":
      return "conguaglio";
    default:
      return "altro";
  }
}

// La colonna o la tabella non esiste ancora perché la migrazione non è stata
// eseguita (PGRST204 colonna, PGRST205 tabella nella cache dello schema,
// 42703/42P01 dal database).
export function schemaAssente(errore: { code?: string; message?: string } | null | undefined): boolean {
  if (!errore) return false;
  return ["PGRST204", "PGRST205", "42703", "42P01"].includes(errore.code ?? "");
}

function testoONull(valore: string | null | undefined): string | null {
  const pulito = (valore ?? "").trim();
  return pulito === "" ? null : pulito;
}

export function incassoDaFattura(invoice: Stripe.Invoice, livemode: boolean): IncassoDaRegistrare | null {
  // Stesso percorso dell'handler di invoice.payment_failed: dalla versione in
  // uso di Stripe la subscription sta sotto parent.subscription_details.
  const riferimento = invoice.parent?.subscription_details?.subscription;
  const stripeSubscriptionId = typeof riferimento === "string" ? riferimento : riferimento?.id;
  if (!stripeSubscriptionId || !invoice.id) return null;

  // Una fattura a zero (prova gratuita, sconto totale) non è un incasso.
  const importo = invoice.amount_paid ?? 0;
  if (importo <= 0) return null;

  // Le imposte si prendono SOLO se Stripe le ha davvero calcolate: senza
  // total_taxes la fattura non separa l'IVA e total_excluding_tax coinciderebbe
  // col totale, facendo credere che il ricavo sia tutto imponibile.
  const imposte = (invoice.total_taxes ?? []).filter((t) => typeof t.amount === "number");
  const imposta = imposte.length > 0 ? imposte.reduce((somma, t) => somma + t.amount, 0) : null;
  const imponibile = imposta !== null && typeof invoice.total_excluding_tax === "number" ? invoice.total_excluding_tax : null;

  const clienteId = typeof invoice.customer === "string" ? invoice.customer : (invoice.customer?.id ?? null);
  const indirizzo = invoice.customer_address;
  const dataPagamento = invoice.status_transitions?.paid_at ?? invoice.created;

  return {
    stripe_invoice_id: invoice.id,
    stripe_subscription_id: stripeSubscriptionId,
    stripe_customer_id: clienteId,
    tipo: tipoIncasso(invoice.billing_reason),
    importo_lordo_centesimi: importo,
    imposta_centesimi: imposta,
    imponibile_centesimi: imponibile,
    valuta: (invoice.currency ?? "eur").toLowerCase(),
    pagato_il: new Date(dataPagamento * 1000).toISOString(),
    livemode,
    numero_ricevuta: testoONull(invoice.number),
    ricevuta_url: testoONull(invoice.hosted_invoice_url),
    cliente_snapshot: {
      nome: testoONull(invoice.customer_name),
      email: testoONull(invoice.customer_email),
      telefono: testoONull(invoice.customer_phone),
      indirizzo: indirizzo
        ? {
            riga1: testoONull(indirizzo.line1),
            riga2: testoONull(indirizzo.line2),
            cap: testoONull(indirizzo.postal_code),
            citta: testoONull(indirizzo.city),
            provincia: testoONull(indirizzo.state),
            paese: testoONull(indirizzo.country),
          }
        : null,
      identificativi_fiscali: (invoice.customer_tax_ids ?? []).flatMap((t) => (t.value ? [{ tipo: t.type, valore: t.value }] : [])),
    },
  };
}

export type EsitoIncasso =
  | { stato: "registrato"; userId: string | null }
  // evento già visto (retry di Stripe): nessuna doppia riga
  | { stato: "duplicato" }
  // non è una fattura di abbonamento pagata e positiva
  | { stato: "ignorato" }
  // migrazione 0078 non ancora eseguita: l'evento non va ritentato all'infinito
  | { stato: "tabella_assente" }
  // errore transitorio del database: il webhook risponde 500 e Stripe riprova
  | { stato: "errore"; messaggio: string };

export async function registraIncassoDaFattura(
  admin: SupabaseClient,
  invoice: Stripe.Invoice,
  livemode: boolean,
): Promise<EsitoIncasso> {
  const incasso = incassoDaFattura(invoice, livemode);
  if (!incasso) return { stato: "ignorato" };

  // L'utente si ricava dalla subscription. Può non esserci ancora: per il primo
  // pagamento invoice.paid e checkout.session.completed arrivano quasi insieme,
  // in un ordine qualunque. La riga si completa poi in collegaIncassiASubscription.
  const { data: sub } = await admin
    .from("subscriptions")
    .select("user_id")
    .eq("stripe_subscription_id", incasso.stripe_subscription_id)
    .maybeSingle<{ user_id: string }>();

  const { error } = await admin.from("omnia_ai_incassi").insert({ ...incasso, user_id: sub?.user_id ?? null });

  if (!error) return { stato: "registrato", userId: sub?.user_id ?? null };
  if (error.code === "23505") return { stato: "duplicato" };
  if (schemaAssente(error)) return { stato: "tabella_assente" };
  return { stato: "errore", messaggio: error.message };
}

// Dopo la creazione della subscription: aggancia gli incassi arrivati prima.
// Mai bloccante: l'attivazione dell'account non deve dipendere da questo.
export async function collegaIncassiASubscription(
  admin: SupabaseClient,
  stripeSubscriptionId: string,
  userId: string,
): Promise<void> {
  try {
    const { error } = await admin
      .from("omnia_ai_incassi")
      .update({ user_id: userId })
      .eq("stripe_subscription_id", stripeSubscriptionId)
      .is("user_id", null);
    if (error && !schemaAssente(error)) console.error("Incassi AI: collegamento all'utente non riuscito", error.message);
  } catch (e) {
    console.error("Incassi AI: collegamento all'utente non riuscito", e);
  }
}
