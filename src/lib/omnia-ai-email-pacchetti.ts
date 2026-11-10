import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EMAIL_UFFICIO, inviaEmailEvento } from "@/lib/omnia-ai-email-eventi";
import { eseguiSenzaBloccare, leggiCliente, linkArea } from "@/lib/omnia-ai-email-webhook";
import { aziendaDaRiga, fatturazioneDaSessione } from "@/lib/omnia-ai-email-revisione";
import { emailClientePacchettoAcquistato, emailUfficioPacchettoAcquistato } from "@/lib/omnia-ai-email-pacchetti-calcoli";
import type { RigaAcquistoPacchetto } from "@/lib/pacchetti-servizi-calcoli";

// Le email di un pacchetto di servizi appena pagato: all'ufficio (con i dati per la fattura) e la conferma al cliente.
// Chiamata dal webhook di Stripe; mai bloccante, mai doppia (registro delle email: stesse chiavi anche se Stripe rimanda l'evento).

export async function notificaAcquistoPacchetto({
  admin,
  livemode,
  eventoId,
  acquisto,
  sessione,
  accreditoMancante = false,
}: {
  admin: SupabaseClient;
  livemode: boolean;
  eventoId: string | null;
  acquisto: RigaAcquistoPacchetto;
  accreditoMancante?: boolean;
  sessione: Pick<Stripe.Checkout.Session, "customer_details" | "customer_email" | "amount_total"> | null;
}): Promise<void> {
  await eseguiSenzaBloccare("pacchetto di servizi", async () => {
    const cliente = await leggiCliente(admin, acquisto.user_id, { email: sessione?.customer_details?.email ?? sessione?.customer_email });
    const { data: azienda } = acquisto.user_id
      ? await admin.from("companies").select("*").eq("user_id", acquisto.user_id).maybeSingle<Record<string, unknown>>()
      : { data: null };
    const importo = acquisto.importo_pagato_centesimi ?? sessione?.amount_total ?? acquisto.prezzo_centesimi;
    const pagataIl = acquisto.pagata_il ? new Date(acquisto.pagata_il) : new Date();

    await inviaEmailEvento({
      admin,
      chiave: `pacchetto:${acquisto.id}:ufficio`,
      tipo: "pacchetto_acquistato",
      destinatario: "ufficio",
      a: EMAIL_UFFICIO,
      email: emailUfficioPacchettoAcquistato({
        prova: !livemode,
        acquistoId: acquisto.id,
        cliente,
        azienda: aziendaDaRiga(azienda),
        fatturazione: fatturazioneDaSessione(sessione),
        servizio: acquisto.servizio,
        quantita: acquisto.quantita,
        importoPagatoCentesimi: importo,
        pagataIl,
        stripePaymentIntentId: acquisto.stripe_payment_intent_id,
        accreditoMancante,
      }),
      livemode,
      userId: acquisto.user_id,
      eventoStripeId: eventoId,
    });

    if (cliente.email) {
      await inviaEmailEvento({
        admin,
        chiave: `pacchetto:${acquisto.id}:cliente`,
        tipo: "pacchetto_ricevuto",
        destinatario: "cliente",
        a: cliente.email,
        email: emailClientePacchettoAcquistato({
          prova: !livemode,
          servizio: acquisto.servizio,
          quantita: acquisto.quantita,
          importoCentesimi: importo,
          pagataIl,
          linkServizi: linkArea("/dashboard/omnia-ai/servizi"),
        }),
        livemode,
        userId: acquisto.user_id,
        eventoStripeId: eventoId,
      });
    } else {
      console.error("Email evento (pacchetto): email del cliente non disponibile, conferma non inviata", acquisto.id);
    }
  });
}
