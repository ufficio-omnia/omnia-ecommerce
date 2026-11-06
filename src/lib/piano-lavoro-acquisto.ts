import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { modalitaChiaveStripe } from "@/lib/omnia-ai-vendita";
import { notificaAcquistoPianoLavoro } from "@/lib/omnia-ai-email-piano-lavoro";
import {
  CHIAVE_PREZZO_PIANO_LAVORO,
  CHIAVE_VENDITA_PIANO_LAVORO,
  controllaSessioneAcquisto,
  interpretaInterruttoreVenditaPianoLavoro,
  interpretaPrezzoPianoLavoro,
  provaAcquistoLocaleAttiva,
  venditaPianoLavoroVisibile,
  type RigaAcquistoPianoLavoro,
} from "@/lib/piano-lavoro-acquisto-calcoli";

// Acquisto singolo del piano di lavoro: letture e registrazione del pagamento (lato server). Le regole pure stanno in
// piano-lavoro-acquisto-calcoli.ts; qui tutto ciò che tocca il database, provato con un database finto da
// scripts/verifica-piano-lavoro-acquisto-omnia-ai.ts.

async function leggiImpostazione(client: SupabaseClient, chiave: string): Promise<string | null> {
  try {
    const { data, error } = await client.from("console_impostazioni").select("valore").eq("chiave", chiave).maybeSingle<{ valore: string }>();
    if (error) return null;
    return data?.valore ?? null;
  } catch {
    return null;
  }
}

// Il prezzo in vigore (IVA inclusa, centesimi): quello della console se impostato e valido, altrimenti quello del codice.
export async function leggiPrezzoPianoLavoro(client?: SupabaseClient): Promise<number> {
  const db = client ?? createAdminClient();
  return interpretaPrezzoPianoLavoro(await leggiImpostazione(db, CHIAVE_PREZZO_PIANO_LAVORO));
}

// Si vende? Qualunque errore (tabella assente, rete) = no: nel dubbio non si vende.
export async function venditaPianoLavoroAttiva(client?: SupabaseClient): Promise<boolean> {
  const modalita = modalitaChiaveStripe(process.env.STRIPE_SECRET_KEY_OMNIA_AI);
  const provaLocale = provaAcquistoLocaleAttiva(process.env);
  // con la chiave non reale e senza la prova in locale non si legge nemmeno il database
  if (modalita !== "reale" && !(provaLocale && modalita === "prova")) return false;
  const interruttore = interpretaInterruttoreVenditaPianoLavoro(await leggiImpostazione(client ?? createAdminClient(), CHIAVE_VENDITA_PIANO_LAVORO));
  return venditaPianoLavoroVisibile({ interruttore, modalita, provaLocale });
}

// La gara ha un acquisto PAGATO (confermato dal webhook)? Senza la migrazione 0097 la tabella non c'è: nessun acquisto.
export async function leggiAcquistoPagato(admin: SupabaseClient, accountId: string, garaId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("omnia_ai_piani_lavoro_acquisti")
    .select("id")
    .eq("user_id", accountId)
    .eq("gara_id", garaId)
    .eq("stato", "pagata")
    .limit(1);
  if (error) {
    if (!schemaAssente(error)) console.error("Piano di lavoro: lettura dell'acquisto non riuscita", error.message);
    return false;
  }
  return (data ?? []).length > 0;
}

export type EsitoRegistrazionePagamento = { esito: "registrato" | "gia_registrato" | "ignorato"; motivo?: string };

export type SessionePagamentoPianoLavoro = Pick<Stripe.Checkout.Session, "id" | "payment_status" | "payment_intent" | "amount_total" | "livemode" | "customer_details" | "customer_email"> & {
  metadata?: Stripe.Checkout.Session["metadata"];
};

// Dal webhook di Stripe: l'acquisto diventa «pagato» SOLO qui (mai dalla pagina di ritorno). Idempotente (Stripe può rimandare l'evento);
// le email hanno il loro registro contro i doppioni, quindi si richiamano anche per un evento rimandato: così un'email che non era
// partita riparte.
export async function registraPagamentoPianoLavoro({
  admin,
  sessione,
  eventoId,
  notifica = notificaAcquistoPianoLavoro,
}: {
  admin: SupabaseClient;
  sessione: SessionePagamentoPianoLavoro;
  eventoId: string | null;
  notifica?: typeof notificaAcquistoPianoLavoro;
}): Promise<EsitoRegistrazionePagamento> {
  const acquistoId = sessione.metadata?.acquistoId;
  if (!acquistoId) {
    console.error("Webhook Stripe (piano di lavoro): acquistoId mancante nella sessione", sessione.id);
    return { esito: "ignorato", motivo: "acquisto_id_mancante" };
  }
  if (sessione.payment_status !== "paid") {
    console.error("Webhook Stripe (piano di lavoro): sessione non pagata", sessione.id, sessione.payment_status);
    return { esito: "ignorato", motivo: "non_pagata" };
  }

  const { data: riga, error } = await admin.from("omnia_ai_piani_lavoro_acquisti").select("*").eq("id", acquistoId).maybeSingle<RigaAcquistoPianoLavoro>();
  if (error || !riga) {
    console.error("Webhook Stripe (piano di lavoro): acquisto non trovato", acquistoId, error?.message);
    return { esito: "ignorato", motivo: "non_trovato" };
  }
  // l'acquisto deve essere quello di QUESTO pagamento e di QUESTO cliente
  const controllo = controllaSessioneAcquisto(riga, { id: sessione.id, metadata: sessione.metadata ? { userId: sessione.metadata.userId } : null });
  if (!controllo.ok) {
    console.error("Webhook Stripe (piano di lavoro): la sessione non corrisponde all'acquisto", acquistoId, controllo.motivo);
    return { esito: "ignorato", motivo: controllo.motivo };
  }

  let acquisto: RigaAcquistoPianoLavoro = riga;
  let registrato = false;
  if (riga.stato !== "pagata") {
    const paymentIntentId = typeof sessione.payment_intent === "string" ? sessione.payment_intent : (sessione.payment_intent?.id ?? null);
    const { data: aggiornato, error: erroreAggiornamento } = await admin
      .from("omnia_ai_piani_lavoro_acquisti")
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
      .maybeSingle<RigaAcquistoPianoLavoro>();
    if (erroreAggiornamento) {
      console.error("Webhook Stripe (piano di lavoro): errore registrazione del pagamento", erroreAggiornamento.message);
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
      .from("omnia_ai_piani_lavoro_acquisti")
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
