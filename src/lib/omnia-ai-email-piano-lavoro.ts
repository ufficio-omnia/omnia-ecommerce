import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EMAIL_UFFICIO, inviaEmailEvento } from "@/lib/omnia-ai-email-eventi";
import { eseguiSenzaBloccare, leggiCliente, linkArea } from "@/lib/omnia-ai-email-webhook";
import { aziendaDaRiga, fatturazioneDaSessione } from "@/lib/omnia-ai-email-revisione";
import { emailClientePianoLavoroAcquistato, emailUfficioPianoLavoroAbbonamento, emailUfficioPianoLavoroAcquistato } from "@/lib/omnia-ai-email-piano-lavoro-calcoli";
import type { RigaAcquistoPianoLavoro } from "@/lib/piano-lavoro-acquisto-calcoli";
import { PERCORSO_CONDIZIONI_PIANO_LAVORO } from "@/lib/piano-lavoro-testi";

// Le email di un acquisto singolo del piano di lavoro appena pagato: all'ufficio (con i dati per la fattura) e la conferma al cliente.
// Chiamata dal webhook di Stripe; mai bloccante, mai doppia (registro delle email: stesse chiavi anche se Stripe rimanda l'evento).

export async function notificaAcquistoPianoLavoro({
  admin,
  livemode,
  eventoId,
  acquisto,
  sessione,
  pagamentoDoppio = false,
}: {
  admin: SupabaseClient;
  livemode: boolean;
  eventoId: string | null;
  acquisto: RigaAcquistoPianoLavoro;
  pagamentoDoppio?: boolean;
  sessione: Pick<Stripe.Checkout.Session, "customer_details" | "customer_email" | "amount_total"> | null;
}): Promise<void> {
  await eseguiSenzaBloccare("piano di lavoro", async () => {
    const cliente = await leggiCliente(admin, acquisto.user_id, { email: sessione?.customer_details?.email ?? sessione?.customer_email });
    const { data: azienda } = acquisto.user_id
      ? await admin.from("companies").select("*").eq("user_id", acquisto.user_id).maybeSingle<Record<string, unknown>>()
      : { data: null };
    const importo = acquisto.importo_pagato_centesimi ?? sessione?.amount_total ?? acquisto.prezzo_centesimi;
    const pagataIl = acquisto.pagata_il ? new Date(acquisto.pagata_il) : new Date();

    await inviaEmailEvento({
      admin,
      chiave: `pdl:${acquisto.id}:ufficio`,
      tipo: "piano_lavoro_acquistato",
      destinatario: "ufficio",
      a: EMAIL_UFFICIO,
      email: emailUfficioPianoLavoroAcquistato({
        prova: !livemode,
        acquistoId: acquisto.id,
        cliente,
        azienda: aziendaDaRiga(azienda),
        fatturazione: fatturazioneDaSessione(sessione),
        garaTitolo: acquisto.gara_titolo,
        importoPagatoCentesimi: importo,
        pagataIl,
        stripePaymentIntentId: acquisto.stripe_payment_intent_id,
        pagamentoDoppio,
      }),
      livemode,
      userId: acquisto.user_id,
      eventoStripeId: eventoId,
    });

    if (cliente.email) {
      await inviaEmailEvento({
        admin,
        chiave: `pdl:${acquisto.id}:cliente`,
        tipo: "piano_lavoro_ricevuto",
        destinatario: "cliente",
        a: cliente.email,
        email: emailClientePianoLavoroAcquistato({
          prova: !livemode,
          garaTitolo: acquisto.gara_titolo,
          importoCentesimi: importo,
          pagataIl,
          linkGara: linkArea(acquisto.gara_id ? `/dashboard/omnia-ai/gare/${acquisto.gara_id}` : "/dashboard/omnia-ai/gare"),
          linkCondizioni: linkArea(PERCORSO_CONDIZIONI_PIANO_LAVORO),
        }),
        livemode,
        userId: acquisto.user_id,
        eventoStripeId: eventoId,
      });
    } else {
      console.error("Email evento (piano di lavoro): email del cliente non disponibile, conferma non inviata", acquisto.id);
    }
  });
}

// Il piano di lavoro aggiunto o tolto all'abbonamento (cambio immediato dal webhook dell'abbonamento, oppure programmato per il prossimo
// rinnovo dal webhook della schedule): una email all'ufficio, mai bloccante, mai doppia (la chiave comprende l'evento Stripe e il cambio).
export async function notificaCambioPianoLavoroAbbonamento({
  admin,
  livemode,
  eventoId,
  stripeSubscriptionId,
  userId,
  piano,
  cambio,
  dal,
}: {
  admin: SupabaseClient;
  livemode: boolean;
  eventoId: string | null;
  stripeSubscriptionId: string;
  userId: string;
  piano: string | null;
  cambio: "aggiunto" | "tolto";
  dal: Date | null;
}): Promise<void> {
  await eseguiSenzaBloccare("piano di lavoro dell'abbonamento", async () => {
    const cliente = await leggiCliente(admin, userId);
    await inviaEmailEvento({
      admin,
      chiave: `evt:${eventoId ?? stripeSubscriptionId}:ufficio:piano_lavoro_${cambio}${dal ? "_programmato" : ""}`,
      tipo: "cambio_piano",
      destinatario: "ufficio",
      a: EMAIL_UFFICIO,
      email: emailUfficioPianoLavoroAbbonamento({ prova: !livemode, cliente, piano, cambio, dal, stripeSubscriptionId }),
      livemode,
      userId,
      eventoStripeId: eventoId,
    });
  });
}
