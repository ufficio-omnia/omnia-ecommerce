import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EMAIL_UFFICIO, inviaEmailEvento } from "@/lib/omnia-ai-email-eventi";
import { eseguiSenzaBloccare, leggiCliente, linkArea } from "@/lib/omnia-ai-email-webhook";
import { aziendaDaRiga, fatturazioneDaSessione } from "@/lib/omnia-ai-email-revisione";
import { emailClienteCopertinaAcquistata, emailUfficioCopertinaAcquistata } from "@/lib/omnia-ai-email-copertina-calcoli";
import type { RigaAcquistoCopertina } from "@/lib/copertina-acquisto-calcoli";

// Le email di un acquisto della copertina appena pagato: all'ufficio (con i dati per la fattura) e la conferma al cliente.
// Chiamata dal webhook di Stripe; mai bloccante, mai doppia (registro delle email: stesse chiavi anche se Stripe rimanda l'evento).

export async function notificaAcquistoCopertina({
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
  acquisto: RigaAcquistoCopertina;
  pagamentoDoppio?: boolean;
  sessione: Pick<Stripe.Checkout.Session, "customer_details" | "customer_email" | "amount_total"> | null;
}): Promise<void> {
  await eseguiSenzaBloccare("copertina della relazione", async () => {
    const cliente = await leggiCliente(admin, acquisto.user_id, { email: sessione?.customer_details?.email ?? sessione?.customer_email });
    const { data: azienda } = acquisto.user_id
      ? await admin.from("companies").select("*").eq("user_id", acquisto.user_id).maybeSingle<Record<string, unknown>>()
      : { data: null };
    const importo = acquisto.importo_pagato_centesimi ?? sessione?.amount_total ?? acquisto.prezzo_centesimi;
    const pagataIl = acquisto.pagata_il ? new Date(acquisto.pagata_il) : new Date();

    await inviaEmailEvento({
      admin,
      chiave: `copertina:${acquisto.id}:ufficio`,
      tipo: "copertina_acquistata",
      destinatario: "ufficio",
      a: EMAIL_UFFICIO,
      email: emailUfficioCopertinaAcquistata({
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
        chiave: `copertina:${acquisto.id}:cliente`,
        tipo: "copertina_ricevuta",
        destinatario: "cliente",
        a: cliente.email,
        email: emailClienteCopertinaAcquistata({
          prova: !livemode,
          garaTitolo: acquisto.gara_titolo,
          importoCentesimi: importo,
          pagataIl,
          linkGara: acquisto.gara_id ? linkArea(`/dashboard/omnia-ai/gare/${acquisto.gara_id}`) : linkArea("/dashboard/omnia-ai/gare"),
        }),
        livemode,
        userId: acquisto.user_id,
        eventoStripeId: eventoId,
      });
    } else {
      console.error("Email evento (copertina): email del cliente non disponibile, conferma non inviata", acquisto.id);
    }
  });
}
