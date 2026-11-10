import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { notificaAcquistoPacchetto } from "@/lib/omnia-ai-email-pacchetti";
import { leggiPrezzoPianoLavoro, venditaPianoLavoroAttiva } from "@/lib/piano-lavoro-acquisto";
import { controllaSessioneAcquisto } from "@/lib/piano-lavoro-acquisto-calcoli";
import {
  SERVIZI,
  dirittoDaPacchetto,
  eServizioPacchetto,
  interpretaCatalogoPacchetti,
  costruisciSchede,
  interpretaEsitoConsumo,
  type EsitoConsumo,
  type MovimentoTipo,
  type PacchettoCatalogo,
  type RigaAcquistoPacchetto,
  type SchedaServizio,
  type ServizioPacchetto,
  type StatoPacchetto,
} from "@/lib/pacchetti-servizi-calcoli";
import { normalizzaSettore, type Settore } from "@/lib/gara-settore";

// Pacchetti prepagati dei servizi aggiuntivi: letture e scritture lato server. Le regole pure stanno in pacchetti-servizi-calcoli.ts; le variazioni
// del saldo sono funzioni SQL atomiche (migrazione 0104). Tutto è tollerante alla migrazione non ancora eseguita: senza le tabelle nessun saldo,
// nessun acquisto, nessun diritto da pacchetto (il codice si comporta come prima).

async function leggiImpostazione(client: SupabaseClient, chiave: string): Promise<string | null> {
  try {
    const { data, error } = await client.from("console_impostazioni").select("valore").eq("chiave", chiave).maybeSingle<{ valore: string }>();
    if (error) return null;
    return data?.valore ?? null;
  } catch {
    return null;
  }
}

// I pacchetti in vendita per un servizio: quelli della console se impostati, altrimenti quelli di partenza.
export async function leggiCatalogoPacchetti(servizio: ServizioPacchetto, client?: SupabaseClient): Promise<PacchettoCatalogo[]> {
  const db = client ?? createAdminClient();
  return interpretaCatalogoPacchetti(servizio, await leggiImpostazione(db, SERVIZI[servizio].chiaveCatalogo));
}

// L'interruttore di vendita dei servizi aggiuntivi è UNO solo (lo stesso del piano di lavoro singolo): spento, né il singolo né i pacchetti si
// comprano. Qualunque errore = no.
export async function venditaPacchettiAttiva(client?: SupabaseClient): Promise<boolean> {
  return venditaPianoLavoroAttiva(client);
}

// Il prezzo della singola gara, per dire «quanto si risparmia» (null = il servizio non si compra singolarmente).
export async function leggiPrezzoSingoloServizio(servizio: ServizioPacchetto, client?: SupabaseClient): Promise<number | null> {
  return servizio === "piano_lavoro" ? leggiPrezzoPianoLavoro(client) : null;
}

type RigaSaldo = { servizio: string; saldo: number };

// Le unità residue dell'account, per servizio, e se la funzione è disponibile: senza la migrazione 0104 (o se il database non risponde) nessun saldo
// e «disponibile: false», così i pacchetti non si offrono né si comprano.
async function leggiSaldiConStato(admin: SupabaseClient, accountId: string): Promise<{ saldi: Partial<Record<ServizioPacchetto, number>>; disponibile: boolean }> {
  const { data, error } = await admin.from("omnia_ai_pacchetti_saldi").select("servizio, saldo").eq("user_id", accountId).returns<RigaSaldo[]>();
  if (error) {
    if (!schemaAssente(error)) console.error("Pacchetti: lettura del saldo non riuscita", error.message);
    return { saldi: {}, disponibile: false };
  }
  const saldi: Partial<Record<ServizioPacchetto, number>> = {};
  for (const r of data ?? []) if (eServizioPacchetto(r.servizio)) saldi[r.servizio] = Math.max(0, r.saldo);
  return { saldi, disponibile: true };
}

// Le unità residue dell'account, per servizio. Senza la migrazione 0104: nessuna.
export async function leggiSaldiPacchetti(admin: SupabaseClient, accountId: string): Promise<Partial<Record<ServizioPacchetto, number>>> {
  return (await leggiSaldiConStato(admin, accountId)).saldi;
}

// Le tabelle dei pacchetti ci sono (migrazione 0104 eseguita) e rispondono? Se no, nulla si offre e nulla si compra: un cliente non deve vedere un
// pacchetto che non può pagare.
export async function pacchettiDisponibili(admin: SupabaseClient): Promise<boolean> {
  const { error } = await admin.from("omnia_ai_pacchetti_saldi").select("user_id").limit(1);
  return !error;
}

// Quanti acquisti pagati ha l'account, per servizio (per mostrare il servizio a chi ha già speso, anche a saldo zero).
export async function contaAcquistiPacchetti(admin: SupabaseClient, accountId: string): Promise<Partial<Record<ServizioPacchetto, number>>> {
  const { data, error } = await admin.from("omnia_ai_pacchetti_acquisti").select("servizio").eq("user_id", accountId).eq("stato", "pagata").returns<{ servizio: string }[]>();
  if (error) {
    if (!schemaAssente(error)) console.error("Pacchetti: lettura degli acquisti non riuscita", error.message);
    return {};
  }
  const conti: Partial<Record<ServizioPacchetto, number>> = {};
  for (const r of data ?? []) if (eServizioPacchetto(r.servizio)) conti[r.servizio] = (conti[r.servizio] ?? 0) + 1;
  return conti;
}

// Il saldo e, per questa gara, se ha già consumato un'unità: serve alla regola del diritto a generare.
export async function leggiStatoPacchettoGara(admin: SupabaseClient, accountId: string, servizio: ServizioPacchetto, garaId: string): Promise<StatoPacchetto> {
  const [saldi, consumo] = await Promise.all([
    leggiSaldiPacchetti(admin, accountId),
    admin.from("omnia_ai_pacchetti_consumi").select("id").eq("user_id", accountId).eq("servizio", servizio).eq("gara_id", garaId).limit(1),
  ]);
  if (consumo.error && !schemaAssente(consumo.error)) console.error("Pacchetti: lettura del consumo non riuscita", consumo.error.message);
  return { saldo: saldi[servizio] ?? 0, garaGiaConsumata: !consumo.error && (consumo.data ?? []).length > 0 };
}

// Per il diritto a generare, in una sola lettura.
export async function leggiDirittoPacchetto(admin: SupabaseClient, accountId: string, servizio: ServizioPacchetto, garaId: string) {
  const stato = await leggiStatoPacchettoGara(admin, accountId, servizio, garaId);
  return { ...stato, ...dirittoDaPacchetto(stato) };
}

// Tutto ciò che serve per mostrare i servizi a chi guarda (home e pagina dei servizi), letto lato server con la chiave di servizio e sempre
// sull'account effettivo (il titolare). `settoriGare`: i settori delle gare dell'account (null = non ancora classificata).
export async function leggiSchedeServizi({
  admin,
  accountId,
  titolare,
  settoriGare,
}: {
  admin: SupabaseClient;
  accountId: string;
  titolare: boolean;
  settoriGare: (Settore | null)[];
}): Promise<SchedaServizio[]> {
  const [{ saldi, disponibile }, acquisti, venditaAttiva, catalogoPianoLavoro, prezzoPianoLavoro] = await Promise.all([
    leggiSaldiConStato(admin, accountId),
    contaAcquistiPacchetti(admin, accountId),
    venditaPacchettiAttiva(admin),
    leggiCatalogoPacchetti("piano_lavoro", admin),
    leggiPrezzoSingoloServizio("piano_lavoro", admin),
  ]);
  return costruisciSchede({
    settoriGare,
    saldi,
    acquisti,
    titolare,
    // senza la migrazione 0104 non si offre nulla (il saldo, se c'è, si vede comunque)
    venditaAttiva: venditaAttiva && disponibile,
    cataloghi: { piano_lavoro: catalogoPianoLavoro },
    prezzoSingolo: { piano_lavoro: prezzoPianoLavoro },
  });
}

// I settori delle gare dell'account (una voce per gara; null = non ancora classificata). Il settore è della migrazione 0103: se la colonna non c'è,
// tutte le gare risultano «non classificate» e contano come pulizie, come per la scheda della gara. `client`: la sessione di chi guarda (la RLS
// limita alle gare dell'azienda) o la chiave di servizio.
export async function leggiSettoriGare(client: SupabaseClient, accountId: string): Promise<(Settore | null)[]> {
  const conSettore = await client.from("gare").select("settore").eq("user_id", accountId).returns<{ settore: string | null }[]>();
  if (!conSettore.error) return (conSettore.data ?? []).map((r) => normalizzaSettore(r.settore));
  const soloId = await client.from("gare").select("id").eq("user_id", accountId).returns<{ id: string }[]>();
  return (soloId.data ?? []).map(() => null);
}

export type MovimentoPacchetto = { id: string; servizio: ServizioPacchetto; tipo: MovimentoTipo; delta: number; saldo_dopo: number; gara_titolo: string | null; motivo: string | null; creato_il: string };

// Gli ultimi movimenti del saldo (acquisti, consumi, riaccrediti, rettifiche, estinzioni), dal più recente. Senza la migrazione 0104: nessuno.
export async function leggiMovimentiPacchetti(admin: SupabaseClient, accountId: string, limite = 20): Promise<MovimentoPacchetto[]> {
  const { data, error } = await admin
    .from("omnia_ai_pacchetti_movimenti")
    .select("id, servizio, tipo, delta, saldo_dopo, gara_titolo, motivo, creato_il")
    .eq("user_id", accountId)
    .order("creato_il", { ascending: false })
    .limit(limite)
    .returns<MovimentoPacchetto[]>();
  if (error) {
    if (!schemaAssente(error)) console.error("Pacchetti: lettura dei movimenti non riuscita", error.message);
    return [];
  }
  return (data ?? []).filter((m) => eServizioPacchetto(m.servizio));
}

// ───── consumo ─────

// Toglie UN'unità per questa gara (una sola per gara, anche con richieste contemporanee). «errore» = non so com'è andata: non si genera nulla.
export async function consumaUnita(
  admin: SupabaseClient,
  { accountId, servizio, garaId, garaTitolo }: { accountId: string; servizio: ServizioPacchetto; garaId: string; garaTitolo: string | null },
): Promise<EsitoConsumo | "errore"> {
  const { data, error } = await admin.rpc("omnia_ai_pacchetto_consuma", { p_user: accountId, p_servizio: servizio, p_gara: garaId, p_gara_titolo: garaTitolo });
  if (error) {
    console.error("Pacchetti: consumo non riuscito", error.message);
    return "errore";
  }
  return interpretaEsitoConsumo(data) ?? "errore";
}

// Rimette l'unità appena consumata se la generazione non è riuscita. Un errore qui non si può ignorare in silenzio: si registra.
export async function riaccreditaUnita(
  admin: SupabaseClient,
  { accountId, servizio, garaId, motivo }: { accountId: string; servizio: ServizioPacchetto; garaId: string; motivo: string },
): Promise<boolean> {
  const { error } = await admin.rpc("omnia_ai_pacchetto_riaccredita", { p_user: accountId, p_servizio: servizio, p_gara: garaId, p_motivo: motivo });
  if (error) {
    console.error("Pacchetti: riaccredito NON riuscito (unità da rimettere a mano)", accountId, servizio, garaId, error.message);
    return false;
  }
  return true;
}

// Alla cessazione dell'abbonamento: azzera i saldi (come i crediti). Restituisce le unità perse; senza la migrazione 0104 zero. Mai un'eccezione:
// chi chiama (webhook, controllo giornaliero) non deve fallire per questo.
export async function estinguiPacchetti(admin: SupabaseClient, userId: string): Promise<number> {
  try {
    const { data, error } = await admin.rpc("omnia_ai_pacchetto_estingui", { p_user: userId });
    if (error) {
      if (!schemaAssente(error) && error.code !== "PGRST202") console.error("Pacchetti: estinzione alla cessazione non riuscita", error.message);
      return 0;
    }
    return typeof data === "number" ? data : 0;
  } catch (e) {
    console.error("Pacchetti: estinzione alla cessazione non riuscita", e instanceof Error ? e.message : e);
    return 0;
  }
}

// Aggiunta o correzione a mano dalla console (con motivo). Il saldo non scende sotto zero.
export async function rettificaPacchetti(
  admin: SupabaseClient,
  { userId, servizio, delta, motivo, da }: { userId: string; servizio: ServizioPacchetto; delta: number; motivo: string; da: string },
): Promise<{ ok: true; saldo: number } | { ok: false; errore: string }> {
  const { data, error } = await admin.rpc("omnia_ai_pacchetto_rettifica", { p_user: userId, p_servizio: servizio, p_delta: delta, p_motivo: motivo, p_da: da });
  if (error) {
    if (/saldo insufficiente/i.test(error.message)) return { ok: false, errore: "Il saldo non può scendere sotto zero." };
    console.error("Pacchetti: rettifica non riuscita", error.message);
    return { ok: false, errore: "Rettifica non riuscita. Riprova." };
  }
  return { ok: true, saldo: typeof data === "number" ? data : 0 };
}

// ───── pagamento ─────

export type EsitoRegistrazionePacchetto = { esito: "registrato" | "gia_registrato" | "ignorato" | "errore"; motivo?: string };

export type SessionePagamentoPacchetto = Pick<Stripe.Checkout.Session, "id" | "payment_status" | "payment_intent" | "amount_total" | "livemode" | "customer_details" | "customer_email"> & {
  metadata?: Stripe.Checkout.Session["metadata"];
};

// Dal webhook di Stripe: l'acquisto diventa «pagato» e le unità si accreditano SOLO qui (mai dalla pagina di ritorno). Idempotente: Stripe può
// rimandare l'evento, e se il pagamento era già registrato ma l'accredito no, lo completa (l'accredito è una funzione SQL che somma una volta sola).
// «errore» = nulla di definitivo è stato perso: il webhook risponde 500 e Stripe riprova.
export async function registraPagamentoPacchetto({
  admin,
  sessione,
  eventoId,
  notifica = notificaAcquistoPacchetto,
}: {
  admin: SupabaseClient;
  sessione: SessionePagamentoPacchetto;
  eventoId: string | null;
  notifica?: typeof notificaAcquistoPacchetto;
}): Promise<EsitoRegistrazionePacchetto> {
  const acquistoId = sessione.metadata?.acquistoId;
  if (!acquistoId) {
    console.error("Webhook Stripe (pacchetto): acquistoId mancante nella sessione", sessione.id);
    return { esito: "ignorato", motivo: "acquisto_id_mancante" };
  }
  if (sessione.payment_status !== "paid") {
    console.error("Webhook Stripe (pacchetto): sessione non pagata", sessione.id, sessione.payment_status);
    return { esito: "ignorato", motivo: "non_pagata" };
  }

  const { data: riga, error } = await admin.from("omnia_ai_pacchetti_acquisti").select("*").eq("id", acquistoId).maybeSingle<RigaAcquistoPacchetto>();
  if (error) {
    // un errore del database è transitorio: Stripe riprova
    console.error("Webhook Stripe (pacchetto): lettura dell'acquisto non riuscita", acquistoId, error.message);
    return { esito: "errore", motivo: "lettura" };
  }
  if (!riga) {
    console.error("Webhook Stripe (pacchetto): acquisto non trovato", acquistoId);
    return { esito: "ignorato", motivo: "non_trovato" };
  }
  const controllo = controllaSessioneAcquisto(riga, { id: sessione.id, metadata: sessione.metadata ? { userId: sessione.metadata.userId } : null });
  if (!controllo.ok) {
    console.error("Webhook Stripe (pacchetto): la sessione non corrisponde all'acquisto", acquistoId, controllo.motivo);
    return { esito: "ignorato", motivo: controllo.motivo };
  }

  let acquisto: RigaAcquistoPacchetto = riga;
  let registrato = false;
  if (riga.stato !== "pagata") {
    const paymentIntentId = typeof sessione.payment_intent === "string" ? sessione.payment_intent : (sessione.payment_intent?.id ?? null);
    const { data: aggiornato, error: erroreAggiornamento } = await admin
      .from("omnia_ai_pacchetti_acquisti")
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
      .maybeSingle<RigaAcquistoPacchetto>();
    if (erroreAggiornamento) {
      console.error("Webhook Stripe (pacchetto): errore registrazione del pagamento", erroreAggiornamento.message);
      return { esito: "errore", motivo: "registrazione" };
    }
    if (aggiornato) {
      acquisto = aggiornato;
      registrato = true;
    }
  }

  // L'accredito si tenta SEMPRE (anche per un evento rimandato): la funzione SQL somma una volta sola.
  const { data: esitoAccredito, error: erroreAccredito } = await admin.rpc("omnia_ai_pacchetto_accredita", { p_acquisto: riga.id });
  if (erroreAccredito) {
    console.error("Webhook Stripe (pacchetto): accredito delle unità NON riuscito", acquistoId, erroreAccredito.message);
    return { esito: "errore", motivo: "accredito" };
  }
  const accreditoMancante = esitoAccredito === "senza_utente";
  if (accreditoMancante) console.error("Webhook Stripe (pacchetto): utente non più presente, unità non accreditate", acquistoId);

  await notifica({ admin, livemode: sessione.livemode, eventoId, acquisto, sessione, accreditoMancante });
  return { esito: registrato ? "registrato" : "gia_registrato" };
}
