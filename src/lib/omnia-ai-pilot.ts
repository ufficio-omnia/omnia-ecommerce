import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { sendEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/html";
import { creaNotifica } from "@/lib/omnia-ai-notifiche";
import { PIANI, PIANI_ORDINE, normalizzaPianoSlug, type PianoSlug } from "@/lib/omnia-ai-plans";
import { OMNIA_AI_BASE_URL } from "@/lib/zone";
import { formattaGiorno } from "@/lib/omnia-ai-catalogo-calcoli";
import { GIORNI_PREAVVISO_PILOT, fineScontoStripe, gareIncluseEffettive, promemoriaPilot, scadenzaPilot, testoPromemoriaPilot, type OffertaPilot } from "@/lib/omnia-ai-pilot-calcoli";

// Offerta pilot (migrazione 0086): letture per l'area riservata e per la console, registrazione
// dell'acquisto dal webhook Stripe e promemoria dei 15 giorni dal lavoro giornaliero. Si usa la
// chiave di servizio dal server, sempre filtrando per il cliente: nessun dato di queste tabelle
// arriva al browser se non quello già pronto per essere mostrato. Prima della migrazione la tabella
// non c'è: nessuna offerta, nessun errore.

type RigaOfferta = {
  id: string;
  user_id: string;
  piano: string;
  prezzo_centesimi: number;
  mesi: number;
  attiva: boolean;
  creata_il: string;
  creata_da_email: string;
  acquistata_il: string | null;
  scade_il: string | null;
  prezzo_pieno_centesimi: number | null;
  promemoria_inviato_il: string | null;
  gare_incluse: number | null;
  stripe_subscription_id: string | null;
};

export const COLONNE_OFFERTA_PILOT =
  "id, user_id, piano, prezzo_centesimi, mesi, attiva, creata_il, creata_da_email, acquistata_il, scade_il, prezzo_pieno_centesimi, promemoria_inviato_il, gare_incluse, stripe_subscription_id";

export function offertaDaRiga(r: RigaOfferta): OffertaPilot | null {
  if (!PIANI_ORDINE.includes(r.piano as PianoSlug)) {
    console.error("Pilot: offerta con un piano non riconosciuto, ignorata", r.id);
    return null;
  }
  return {
    id: r.id,
    userId: r.user_id,
    piano: r.piano as PianoSlug,
    prezzoCentesimi: r.prezzo_centesimi,
    mesi: r.mesi,
    attiva: r.attiva,
    creataIl: r.creata_il,
    creataDa: r.creata_da_email,
    acquistataIl: r.acquistata_il,
    scadeIl: r.scade_il,
    prezzoPienoCentesimi: r.prezzo_pieno_centesimi,
    promemoriaInviatoIl: r.promemoria_inviato_il,
    gareIncluse: typeof r.gare_incluse === "number" ? r.gare_incluse : null,
    stripeSubscriptionId: r.stripe_subscription_id ?? null,
  };
}

function errorePrevisto(error: { code?: string; message?: string } | null): boolean {
  return Boolean(error && schemaAssente(error));
}

// L'offerta che il cliente può ancora acquistare (attiva e non acquistata), o null.
export async function leggiOffertaPilotAperta(userId: string): Promise<OffertaPilot | null> {
  const { data, error } = await createAdminClient()
    .from("omnia_ai_offerte_pilot")
    .select(COLONNE_OFFERTA_PILOT)
    .eq("user_id", userId)
    .eq("attiva", true)
    .is("acquistata_il", null)
    .maybeSingle<RigaOfferta>();
  if (error) {
    if (!errorePrevisto(error)) console.error("Pilot: lettura dell'offerta aperta fallita", error.code, error.message);
    return null;
  }
  return data ? offertaDaRiga(data) : null;
}

// L'ultima offerta pilot che il cliente ha acquistato, o null: serve a mostrargli fino a quando dura
// il prezzo pilot e, negli ultimi 15 giorni, il promemoria. `admin` solo per le prove (un finto database).
export async function leggiPilotAcquistato(userId: string, admin: ReturnType<typeof createAdminClient> = createAdminClient()): Promise<OffertaPilot | null> {
  const { data, error } = await admin
    .from("omnia_ai_offerte_pilot")
    .select(COLONNE_OFFERTA_PILOT)
    .eq("user_id", userId)
    .not("acquistata_il", "is", null)
    .order("acquistata_il", { ascending: false })
    .limit(1)
    .maybeSingle<RigaOfferta>();
  if (error) {
    if (!errorePrevisto(error)) console.error("Pilot: lettura dell'offerta acquistata fallita", error.code, error.message);
    return null;
  }
  return data ? offertaDaRiga(data) : null;
}

// ───── Gare incluse al mese di un abbonamento ─────

// L'UNICO punto in cui si decide quante gare al mese ha un abbonamento attivo: le gare del piano, oppure quelle
// dedicate dall'offerta pilot finché il prezzo pilot è in corso (regole in gareIncluseEffettive). Lo usano il
// consumo di una gara, la verifica del diritto e il riepilogo del periodo: leggere il numero da PIANI nei singoli
// punti farebbe divergere i tre. Un piano non riconosciuto vale 0 gare (come prima); se l'offerta non si legge
// (tabella o colonna assenti, errore) valgono le gare del piano, mai un blocco.
export async function gareInclusePerAbbonamento(params: {
  userId: string;
  piano: string | null | undefined;
  stripeSubscriptionId: string | null | undefined;
  adesso?: Date;
  admin?: ReturnType<typeof createAdminClient>;
}): Promise<number> {
  const slug = normalizzaPianoSlug(params.piano);
  if (!slug) return 0;
  const gareDelPiano = PIANI[slug]?.gareIncluse ?? 0;
  if (!params.stripeSubscriptionId) return gareDelPiano;
  const offerta = await leggiPilotAcquistato(params.userId, params.admin);
  return gareIncluseEffettive({ gareDelPiano, pianoAbbonamento: slug, stripeSubscriptionId: params.stripeSubscriptionId, offerta, adesso: params.adesso ?? new Date() });
}

// ───── Acquisto: dal webhook Stripe ─────

// Chiamata dal webhook alla creazione dell'abbonamento di una sessione con `pilotOffertaId` nei
// metadata. Idempotente (un evento rielaborato non cambia nulla): scrive solo se l'offerta non è già
// acquistata. La fine del prezzo pilot è quella dichiarata da Stripe sullo sconto dell'abbonamento
// (con un coupon a durata); senza, si calcola dai mesi. Con mesi = 0 il prezzo pilot non scade.
export async function registraAcquistoPilot(params: { stripe: Stripe; offertaId: string; userId: string; stripeSubscriptionId: string }): Promise<void> {
  const admin = createAdminClient();
  const { data: riga, error } = await admin.from("omnia_ai_offerte_pilot").select(COLONNE_OFFERTA_PILOT).eq("id", params.offertaId).eq("user_id", params.userId).maybeSingle<RigaOfferta>();
  if (error) {
    if (!errorePrevisto(error)) console.error("Webhook Stripe (pilot): lettura dell'offerta fallita", error.message);
    return;
  }
  if (!riga) {
    console.error("Webhook Stripe (pilot): offerta non trovata per questo cliente", params.offertaId);
    return;
  }
  if (riga.acquistata_il) return;

  const abbonamento = await params.stripe.subscriptions.retrieve(params.stripeSubscriptionId, { expand: ["discounts"] });
  const adesso = new Date();
  const scadeIl = scadenzaPilot(riga.mesi, fineScontoStripe((abbonamento as unknown as { discounts?: ({ end?: number | null } | string)[] }).discounts), adesso);
  const prezzoPieno = abbonamento.items.data[0]?.price.unit_amount ?? null;

  const { error: errore } = await admin
    .from("omnia_ai_offerte_pilot")
    .update({ acquistata_il: adesso.toISOString(), stripe_subscription_id: params.stripeSubscriptionId, prezzo_pieno_centesimi: prezzoPieno, scade_il: scadeIl ? scadeIl.toISOString() : null })
    .eq("id", params.offertaId)
    .is("acquistata_il", null);
  if (errore) console.error("Webhook Stripe (pilot): registrazione dell'acquisto fallita", errore.message);
}

// ───── Promemoria degli ultimi 15 giorni: dal lavoro giornaliero ─────

export type EsitoPromemoriPilot = { inviati: number; falliti: number };

// Per ogni offerta acquistata con una scadenza entro 15 giorni e senza promemoria già inviato: se il
// cliente ha ancora l'abbonamento attivo, notifica nel campanello e email, poi segna l'invio. Si ritenta
// il giorno dopo se l'email non parte (la notifica ha una chiave di deduplica, non si duplica).
export async function inviaPromemoriaPilot(adesso: Date = new Date()): Promise<EsitoPromemoriPilot> {
  const admin = createAdminClient();
  const esito: EsitoPromemoriPilot = { inviati: 0, falliti: 0 };
  const limite = new Date(adesso.getTime() + GIORNI_PREAVVISO_PILOT * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await admin
    .from("omnia_ai_offerte_pilot")
    .select(COLONNE_OFFERTA_PILOT)
    .not("acquistata_il", "is", null)
    .is("promemoria_inviato_il", null)
    .not("scade_il", "is", null)
    .gt("scade_il", adesso.toISOString())
    .lte("scade_il", limite)
    .returns<RigaOfferta[]>();
  if (error) {
    if (!errorePrevisto(error)) console.error("Pilot: lettura delle offerte in scadenza fallita", error.message);
    return esito;
  }

  for (const riga of data ?? []) {
    const offerta = offertaDaRiga(riga);
    if (!offerta) continue;
    try {
      const promemoria = promemoriaPilot(offerta, adesso);
      if (!promemoria) continue;

      // il promemoria ha senso solo se il cliente è ancora abbonato
      const { data: abbonamento } = await admin
        .from("subscriptions")
        .select("status, cancel_at_period_end, plan, stripe_subscription_id")
        .eq("user_id", offerta.userId)
        .eq("status", "attivo")
        .limit(1)
        .maybeSingle<{ status: string; cancel_at_period_end: boolean | null; plan: string; stripe_subscription_id: string | null }>();
      if (!abbonamento || abbonamento.cancel_at_period_end) continue;

      const { data: utente } = await admin.from("users").select("email").eq("id", offerta.userId).maybeSingle<{ email: string }>();
      const prezzoPieno = offerta.prezzoPienoCentesimi;
      if (prezzoPieno === null) continue;
      // Se in questo momento il cliente ha delle gare dedicate, il promemoria dice anche a quante si torna.
      const gareDelPiano = PIANI[offerta.piano].gareIncluse;
      const gareDedicateOra = gareIncluseEffettive({ gareDelPiano, pianoAbbonamento: normalizzaPianoSlug(abbonamento.plan), stripeSubscriptionId: abbonamento.stripe_subscription_id, offerta, adesso }) !== gareDelPiano;
      const testo = testoPromemoriaPilot(promemoria, prezzoPieno, gareDedicateOra ? gareDelPiano : undefined);

      await creaNotifica({ userId: offerta.userId, tipo: "pilot_in_scadenza", garaId: null, titolo: "Il tuo prezzo pilot sta per scadere", corpo: testo, chiaveDedup: `${offerta.userId}:pilot:${promemoria.scadeIlGiorno}` });

      const inviata = utente?.email
        ? await sendEmail({
            to: utente.email,
            from: "OMNIA AI <noreply@omniaitalia.com>",
            subject: `Il tuo prezzo pilot OMNIA AI scade il ${formattaGiorno(promemoria.scadeIlGiorno)}`,
            html: `<p>${escapeHtml(testo)}</p><p><a href="${OMNIA_AI_BASE_URL}/dashboard/omnia-ai/abbonamento">Vai al tuo abbonamento</a></p><p>Se vuoi cambiare o disdire, puoi farlo dalla pagina Abbonamento prima della scadenza.</p>`,
          })
        : false;

      // Segnato inviato solo se l'email è partita: altrimenti si ritenta domani (la notifica non si duplica).
      if (inviata) {
        const { error: errore } = await admin.from("omnia_ai_offerte_pilot").update({ promemoria_inviato_il: new Date().toISOString() }).eq("id", offerta.id);
        if (errore) console.error("Pilot: promemoria inviato ma non registrato", errore.message);
        esito.inviati++;
      } else {
        esito.falliti++;
      }
    } catch (e) {
      esito.falliti++;
      console.error("Pilot: promemoria fallito per l'offerta", riga.id, e instanceof Error ? e.message : e);
    }
  }
  return esito;
}
