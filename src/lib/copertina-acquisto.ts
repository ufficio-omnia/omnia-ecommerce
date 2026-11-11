import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notificaAcquistoCopertina } from "@/lib/omnia-ai-email-copertina";
import { controllaSessioneAcquistoCopertina, type RigaAcquistoCopertina } from "@/lib/copertina-acquisto-calcoli";

// Acquisto della copertina della relazione tecnica: la registrazione del pagamento (lato server, dal webhook di Stripe). Le regole pure stanno in
// copertina-acquisto-calcoli.ts; l'avvio del pagamento in src/app/actions/gara-copertina.ts; la lettura «questa gara è pagata?» in copertina-diritto.ts.
// Stessa struttura di registraPagamentoPianoLavoro (piano-lavoro-acquisto.ts), provata con un database finto da scripts/verifica-copertina-acquisto.ts.

export type EsitoRegistrazionePagamentoCopertina = { esito: "registrato" | "gia_registrato" | "ignorato"; motivo?: string };

export type SessionePagamentoCopertina = Pick<Stripe.Checkout.Session, "id" | "payment_status" | "payment_intent" | "amount_total" | "livemode" | "customer_details" | "customer_email"> & {
  metadata?: Stripe.Checkout.Session["metadata"];
};

// Dal webhook di Stripe: l'acquisto diventa «pagato» SOLO qui (mai dalla pagina di ritorno). Idempotente (Stripe può rimandare l'evento); le email hanno il
// loro registro contro i doppioni, quindi si richiamano anche per un evento rimandato: così un'email che non era partita riparte.
export async function registraPagamentoCopertina({
  admin,
  sessione,
  eventoId,
  notifica = notificaAcquistoCopertina,
}: {
  admin: SupabaseClient;
  sessione: SessionePagamentoCopertina;
  eventoId: string | null;
  notifica?: typeof notificaAcquistoCopertina;
}): Promise<EsitoRegistrazionePagamentoCopertina> {
  const acquistoId = sessione.metadata?.acquistoId;
  if (!acquistoId) {
    console.error("Webhook Stripe (copertina): acquistoId mancante nella sessione", sessione.id);
    return { esito: "ignorato", motivo: "acquisto_id_mancante" };
  }
  if (sessione.payment_status !== "paid") {
    console.error("Webhook Stripe (copertina): sessione non pagata", sessione.id, sessione.payment_status);
    return { esito: "ignorato", motivo: "non_pagata" };
  }

  const { data: riga, error } = await admin.from("omnia_ai_copertine_acquisti").select("*").eq("id", acquistoId).maybeSingle<RigaAcquistoCopertina>();
  if (error || !riga) {
    console.error("Webhook Stripe (copertina): acquisto non trovato", acquistoId, error?.message);
    return { esito: "ignorato", motivo: "non_trovato" };
  }
  // l'acquisto deve essere quello di QUESTO pagamento e di QUESTO cliente
  const controllo = controllaSessioneAcquistoCopertina(riga, { id: sessione.id, metadata: sessione.metadata ? { userId: sessione.metadata.userId } : null });
  if (!controllo.ok) {
    console.error("Webhook Stripe (copertina): la sessione non corrisponde all'acquisto", acquistoId, controllo.motivo);
    return { esito: "ignorato", motivo: controllo.motivo };
  }

  let acquisto: RigaAcquistoCopertina = riga;
  let registrato = false;
  if (riga.stato !== "pagata") {
    const paymentIntentId = typeof sessione.payment_intent === "string" ? sessione.payment_intent : (sessione.payment_intent?.id ?? null);
    const { data: aggiornato, error: erroreAggiornamento } = await admin
      .from("omnia_ai_copertine_acquisti")
      .update({
        stato: "pagata",
        pagata_il: new Date().toISOString(),
        stripe_session_id: sessione.id,
        stripe_payment_intent_id: paymentIntentId,
        importo_pagato_centesimi: sessione.amount_total,
        livemode: sessione.livemode,
        dati_stripe: sessione.customer_details ?? null,
        // un pagamento di prova (Stripe in modalità test) non va mai fatturato
        ...(sessione.livemode ? {} : { stato_fattura: "non_dovuta", note_fattura: "Pagamento di prova (Stripe in modalità test): nessuna fattura da emettere" }),
      })
      .eq("id", riga.id)
      .eq("stato", "in_attesa_pagamento")
      .select("*")
      .maybeSingle<RigaAcquistoCopertina>();
    if (erroreAggiornamento) {
      console.error("Webhook Stripe (copertina): errore registrazione del pagamento", erroreAggiornamento.message);
      return { esito: "ignorato", motivo: "errore_registrazione" };
    }
    if (aggiornato) {
      acquisto = aggiornato;
      registrato = true;
    }
  }

  // Un altro pagamento già registrato per la stessa gara (due schede di pagamento aperte insieme)?
  let pagamentoDoppio = false;
  if (riga.gara_id && riga.user_id) {
    const { count } = await admin
      .from("omnia_ai_copertine_acquisti")
      .select("id", { count: "exact", head: true })
      .eq("user_id", riga.user_id)
      .eq("gara_id", riga.gara_id)
      .eq("stato", "pagata")
      .neq("id", riga.id)
      .lt("pagata_il", acquisto.pagata_il ?? new Date().toISOString());
    pagamentoDoppio = (count ?? 0) > 0;
  }

  await notifica({ admin, livemode: sessione.livemode, eventoId, acquisto, sessione, pagamentoDoppio });
  return { esito: registrato ? "registrato" : "gia_registrato" };
}
