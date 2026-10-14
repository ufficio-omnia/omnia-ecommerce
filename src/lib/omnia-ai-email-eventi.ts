import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail, ADMIN_EMAIL } from "@/lib/email";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import type { EmailPronta } from "@/lib/omnia-ai-email-eventi-calcoli";

// Invio delle email automatiche legate agli eventi di Stripe, con il registro che impedisce i doppioni
// e permette di rimandare quelle non partite (tabella omnia_ai_email_eventi, migrazione 0087).
//
// Principio: un'email non deve MAI far fallire l'elaborazione dell'evento Stripe (i dati sono più
// importanti della posta), e non deve MAI andare persa in silenzio: se l'invio fallisce la riga resta
// «fallita» con il testo da rimandare e il controllo periodico la ritenta.

export const EMAIL_UFFICIO = ADMIN_EMAIL;
export const MITTENTE_OMNIA_AI = "OMNIA AI <noreply@omniaitalia.com>";

export type TipoEmailEvento =
  | "nuovo_cliente"
  | "cambio_piano"
  | "acquisto_crediti"
  | "disdetta"
  | "mancato_pagamento"
  | "pagamento_ricevuto"
  | "disdetta_confermata"
  | "metodo_pagamento_cambiato";

export type EsitoInvioEvento = "inviata" | "duplicata" | "fallita";

// Dopo quanti tentativi smette di insistere (il controllo gira ogni 15 minuti: ~2 giorni).
export const MAX_TENTATIVI_EMAIL = 200;
// Una riga «in invio» più vecchia di così è rimasta a metà (la funzione si è interrotta): si ritenta.
export const MINUTI_INVIO_BLOCCATO = 10;

async function invia(a: string, email: EmailPronta): Promise<boolean> {
  try {
    return await sendEmail({ to: a, from: MITTENTE_OMNIA_AI, subject: email.oggetto, html: email.html });
  } catch (e) {
    console.error("Email evento: invio non riuscito (eccezione)", e instanceof Error ? e.message : e);
    return false;
  }
}

type RigaEmail = { id: string; stato: string; tentativi: number; creata_il: string };

export async function inviaEmailEvento({
  admin,
  chiave,
  tipo,
  destinatario,
  a,
  email,
  livemode,
  userId = null,
  eventoStripeId = null,
}: {
  admin: SupabaseClient;
  // identifica UNA email: oggetto o evento Stripe + a chi va
  chiave: string;
  tipo: TipoEmailEvento;
  destinatario: "ufficio" | "cliente";
  a: string;
  email: EmailPronta;
  livemode: boolean;
  userId?: string | null;
  eventoStripeId?: string | null;
}): Promise<EsitoInvioEvento> {
  let riga: RigaEmail | null = null;

  const { data: creata, error } = await admin
    .from("omnia_ai_email_eventi")
    .insert({
      chiave,
      tipo,
      destinatario,
      stato: "in_invio",
      tentativi: 0,
      invia_a: a,
      oggetto: email.oggetto,
      corpo_html: email.html,
      evento_stripe_id: eventoStripeId,
      livemode,
      user_id: userId,
    })
    .select("id, stato, tentativi, creata_il")
    .single<RigaEmail>();

  if (!error && creata) {
    riga = creata;
  } else if (error?.code === "23505") {
    // già prenotata: da un'altra consegna dello stesso evento o da un invio precedente
    const { data: esistente } = await admin
      .from("omnia_ai_email_eventi")
      .select("id, stato, tentativi, creata_il")
      .eq("chiave", chiave)
      .maybeSingle<RigaEmail>();
    if (!esistente || esistente.stato === "inviata") return "duplicata";
    const inSospeso = esistente.stato === "in_invio" && Date.now() - new Date(esistente.creata_il).getTime() < MINUTI_INVIO_BLOCCATO * 60_000;
    if (inSospeso) return "duplicata";
    // «fallita» (o rimasta a metà): si riprova subito con questa consegna
    await admin
      .from("omnia_ai_email_eventi")
      .update({ stato: "in_invio", invia_a: a, oggetto: email.oggetto, corpo_html: email.html })
      .eq("id", esistente.id);
    riga = esistente;
  } else {
    // registro non disponibile (migrazione 0087 non eseguita) o errore del database: l'email parte lo
    // stesso, senza protezione contro i doppioni — meglio una email in più di una email persa.
    if (!schemaAssente(error)) console.error("Email evento: registro non disponibile, invio senza prenotazione", error?.message);
    return (await invia(a, email)) ? "inviata" : "fallita";
  }

  const partita = await invia(a, email);
  const aggiornamento = partita
    ? { stato: "inviata", tentativi: riga.tentativi + 1, ultimo_errore: null, invia_a: null, oggetto: null, corpo_html: null, inviata_il: new Date().toISOString() }
    : { stato: "fallita", tentativi: riga.tentativi + 1, ultimo_errore: "invio non riuscito" };
  const { error: erroreAggiornamento } = await admin.from("omnia_ai_email_eventi").update(aggiornamento).eq("id", riga.id);
  if (erroreAggiornamento) console.error("Email evento: registro non aggiornato", erroreAggiornamento.message);

  return partita ? "inviata" : "fallita";
}

// Riprova le email non partite (controllo periodico). Ritorna quante ne ha rimandate e quante restano.
export async function riprovaEmailNonInviate(admin: SupabaseClient, limite = 25): Promise<{ rimandate: number; fallite: number; saltate: number }> {
  const soglia = new Date(Date.now() - MINUTI_INVIO_BLOCCATO * 60_000).toISOString();
  const { data, error } = await admin
    .from("omnia_ai_email_eventi")
    .select("id, stato, tentativi, creata_il, invia_a, oggetto, corpo_html")
    .neq("stato", "inviata")
    .lt("tentativi", MAX_TENTATIVI_EMAIL)
    .order("creata_il", { ascending: true })
    .limit(limite)
    .returns<(RigaEmail & { invia_a: string | null; oggetto: string | null; corpo_html: string | null })[]>();

  if (error) {
    if (!schemaAssente(error)) console.error("Email evento: lettura delle email da rimandare non riuscita", error.message);
    return { rimandate: 0, fallite: 0, saltate: 0 };
  }

  let rimandate = 0;
  let fallite = 0;
  let saltate = 0;
  for (const riga of data ?? []) {
    // «in invio» recente: sta ancora partendo da un'altra richiesta
    if (riga.stato === "in_invio" && riga.creata_il > soglia) {
      saltate++;
      continue;
    }
    if (!riga.invia_a || !riga.oggetto || !riga.corpo_html) {
      await admin.from("omnia_ai_email_eventi").update({ stato: "fallita", tentativi: MAX_TENTATIVI_EMAIL, ultimo_errore: "testo non più disponibile" }).eq("id", riga.id);
      saltate++;
      continue;
    }
    const partita = await invia(riga.invia_a, { oggetto: riga.oggetto, html: riga.corpo_html });
    await admin
      .from("omnia_ai_email_eventi")
      .update(
        partita
          ? { stato: "inviata", tentativi: riga.tentativi + 1, ultimo_errore: null, invia_a: null, oggetto: null, corpo_html: null, inviata_il: new Date().toISOString() }
          : { stato: "fallita", tentativi: riga.tentativi + 1, ultimo_errore: "invio non riuscito" },
      )
      .eq("id", riga.id);
    if (partita) rimandate++;
    else fallite++;
  }
  return { rimandate, fallite, saltate };
}
