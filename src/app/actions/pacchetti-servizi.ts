"use server";

import { createHash } from "crypto";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createStripeClient } from "@/lib/stripe";
import { hasActiveSubscription } from "@/lib/subscription";
import { getCurrentOmniaAiLegalDocuments } from "@/lib/omnia-ai-legal";
import { getRequestMeta } from "@/lib/legal-acceptance";
import { getOmniaAiRequestOrigin } from "@/lib/omnia-ai-request";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { richiediAccountAzione, richiediTitolareAzione } from "@/lib/omnia-ai-account-guardie";
import { accessoNegatoPerAccount } from "@/lib/omnia-ai-account-lavoro";
import { avvisaTitolareAcquistoPacchetto } from "@/lib/omnia-ai-ufficio-gare-avvisi";
import { leggiCatalogoPacchetti, pacchettiDisponibili, venditaPacchettiAttiva } from "@/lib/pacchetti-servizi";
import {
  SERVIZI,
  TESTI_PACCHETTI,
  VERSIONE_CONDIZIONI_PACCHETTI,
  eServizioPacchetto,
  testoCanonicoCondizioniPacchetti,
  testoUnita,
  trovaPacchetto,
} from "@/lib/pacchetti-servizi-calcoli";
import { VERSIONE_CONDIZIONI_PIANO_LAVORO, testoCanonicoCondizioniPianoLavoro } from "@/lib/piano-lavoro-acquisto-calcoli";

// Pacchetti prepagati dei servizi aggiuntivi (migrazione 0104). Il titolare compra: avvertenze e clausole (versionate) da accettare, poi il
// pagamento su Stripe; le unità si accreditano SOLO dal webhook. L'Ufficio Gare non compra: con «Acquista» manda al titolare una email
// (una al giorno per pacchetto, deciso dal database). Il prezzo e l'elenco dei pacchetti si rileggono sempre qui: dal browser arrivano solo la
// quantità e il prezzo che il cliente aveva davanti, per accorgersi se nel frattempo è cambiato.

export type AcquistoPacchettoState = { error?: string; prezzoAggiornatoCentesimi?: number };

export async function acquistaPacchettoServizio(_prevState: AcquistoPacchettoState, formData: FormData): Promise<AcquistoPacchettoState> {
  const guardia = await richiediTitolareAzione();
  if (!guardia.ok) return { error: guardia.errore };
  const { user, contesto } = guardia;
  if (!user.email) return { error: "Sessione scaduta: accedi di nuovo e riprova." };

  // Come i crediti aggiuntivi: i pacchetti si estinguono con la cessazione dell'abbonamento, quindi si vendono solo a chi ne ha uno attivo
  // (non a un account in prova né in sola lettura).
  if (!(await hasActiveSubscription(contesto.accountId))) return { error: "L'acquisto dei pacchetti è riservato a chi ha un abbonamento attivo." };

  const servizioGrezzo = formData.get("servizio");
  if (!eServizioPacchetto(servizioGrezzo)) return { error: "Servizio non valido." };
  const servizio = servizioGrezzo;
  if (!SERVIZI[servizio].disponibile) return { error: `${SERVIZI[servizio].nome} non è ancora disponibile.` };

  if (formData.get("accettaCondizioni") !== "on") return { error: "Devi accettare le condizioni del pacchetto e le avvertenze sul servizio e prendere visione della Privacy policy." };
  if (formData.get("accettaClausole") !== "on") return { error: "Devi approvare specificamente le clausole indicate." };

  const admin = createAdminClient();
  if (!(await venditaPacchettiAttiva(admin)) || !(await pacchettiDisponibili(admin))) return { error: "L'acquisto dei pacchetti non è ancora disponibile." };

  const catalogo = await leggiCatalogoPacchetti(servizio, admin);
  const pacchetto = trovaPacchetto(catalogo, formData.get("quantita"));
  if (!pacchetto) return { error: "Questo pacchetto non è più in vendita: ricarica la pagina per vedere quelli attuali." };
  const mostrato = Number(formData.get("prezzoMostratoCentesimi"));
  if (mostrato !== pacchetto.prezzoCentesimi) return { error: "Il prezzo è stato aggiornato. Controlla il nuovo importo e conferma di nuovo.", prezzoAggiornatoCentesimi: pacchetto.prezzoCentesimi };

  const documenti = await getCurrentOmniaAiLegalDocuments(admin);
  const { ip, userAgent } = await getRequestMeta();
  const impronta = (testo: string) => createHash("sha256").update(testo).digest("hex");

  const { data: acquisto, error: erroreInserimento } = await admin
    .from("omnia_ai_pacchetti_acquisti")
    .insert({
      user_id: contesto.accountId,
      servizio,
      quantita: pacchetto.quantita,
      prezzo_centesimi: pacchetto.prezzoCentesimi,
      condizioni_versione: VERSIONE_CONDIZIONI_PACCHETTI,
      condizioni_hash: impronta(testoCanonicoCondizioniPacchetti()),
      // le avvertenze sul servizio: per il piano di lavoro sono quelle già approvate dal legale
      servizio_condizioni_versione: VERSIONE_CONDIZIONI_PIANO_LAVORO,
      servizio_condizioni_hash: impronta(testoCanonicoCondizioniPianoLavoro()),
      accettato_il: new Date().toISOString(),
      accept_ip: ip,
      accept_user_agent: (userAgent ?? "").slice(0, 490) || null,
      privacy_documento_id: documenti?.privacyPolicy.id ?? null,
      privacy_versione: documenti?.privacyPolicy.version ?? null,
      livemode: !process.env.STRIPE_SECRET_KEY_OMNIA_AI?.startsWith("sk_test_"),
    })
    .select("id")
    .single<{ id: string }>();

  if (erroreInserimento || !acquisto) {
    if (schemaAssente(erroreInserimento)) console.error("Pacchetti: tabella omnia_ai_pacchetti_acquisti assente (migrazione 0104 non eseguita)");
    else console.error("Pacchetti: registrazione dell'acquisto non riuscita", erroreInserimento?.message);
    return { error: "L'acquisto del pacchetto non è ancora disponibile: riprova più tardi o scrivici dalla pagina Supporto." };
  }

  const origin = await getOmniaAiRequestOrigin();
  const stripe = createStripeClient("omnia-ai");
  const unita = testoUnita(pacchetto.quantita, servizio);
  const metadata = { tipo: "omnia_ai_pacchetto", acquistoId: acquisto.id, userId: contesto.accountId, servizio, quantita: String(pacchetto.quantita) };

  let sessione;
  try {
    sessione = await stripe.checkout.sessions.create({
      mode: "payment",
      // l'email è quella dell'account, mai quella di un campo del modulo
      customer_email: user.email,
      billing_address_collection: "required",
      tax_id_collection: { enabled: true },
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: `OMNIA AI — Pacchetto ${SERVIZI[servizio].nome}: ${unita}`,
              description: `${unita}, una per gara. Non scadono: si esauriscono man mano che le usi. Si perdono se l'abbonamento cessa.`,
            },
            unit_amount: pacchetto.prezzoCentesimi,
          },
          quantity: 1,
        },
      ],
      metadata,
      payment_intent_data: { metadata },
      // Le unità si accreditano solo dal webhook, mai da questa pagina di ritorno.
      success_url: `${origin}/dashboard/omnia-ai/servizi?pacchetto=pagato`,
      cancel_url: `${origin}/dashboard/omnia-ai/servizi?pacchetto=annullato`,
    });
  } catch (err) {
    console.error("Errore creazione sessione Stripe (pacchetto):", err);
    return { error: "Errore nell'avvio del pagamento. Riprova." };
  }

  if (!sessione.url) return { error: "Errore nell'avvio del pagamento. Riprova." };

  const { error: erroreSessione } = await admin.from("omnia_ai_pacchetti_acquisti").update({ stripe_session_id: sessione.id }).eq("id", acquisto.id);
  if (erroreSessione) console.error("Pacchetti: id della sessione Stripe non salvato (lo scriverà il webhook)", erroreSessione.message);

  redirect(sessione.url);
}

export type RichiestaPacchettoState = { error?: string; success?: string };

// L'Ufficio Gare vede i pacchetti e preme «Acquista»: il clic NON compra nulla, avvisa il titolare con un'email (una al giorno per pacchetto,
// deciso dal database); il titolare lo compra dalla sua pagina, come sempre. Per il titolare questa azione non serve (compra direttamente).
export async function richiediAcquistoPacchetto(_prevState: RichiestaPacchettoState, formData: FormData): Promise<RichiestaPacchettoState> {
  const supabase = await createClient();
  const guardia = await richiediAccountAzione();
  if (!guardia.ok) return { error: guardia.errore };
  const { user, contesto } = guardia;
  if (contesto.ruolo !== "ufficio_gare") return { error: "Il pacchetto lo acquisti dalla pagina dei servizi aggiuntivi." };

  const accessoNegato = await accessoNegatoPerAccount(contesto, user, supabase);
  if (accessoNegato) return { error: accessoNegato };
  if (!user.email) return { error: "Sessione scaduta: accedi di nuovo e riprova." };

  const servizioGrezzo = formData.get("servizio");
  if (!eServizioPacchetto(servizioGrezzo) || !SERVIZI[servizioGrezzo].disponibile) return { error: "Servizio non valido." };
  const servizio = servizioGrezzo;

  const admin = createAdminClient();
  if (!(await venditaPacchettiAttiva(admin)) || !(await pacchettiDisponibili(admin))) return { error: TESTI_PACCHETTI.venditaSpenta };
  // si avvisa solo per un pacchetto davvero in vendita
  const pacchetto = trovaPacchetto(await leggiCatalogoPacchetti(servizio, admin), formData.get("quantita"));
  if (!pacchetto) return { error: "Questo pacchetto non è più in vendita: ricarica la pagina." };

  const avviso = await avvisaTitolareAcquistoPacchetto({
    admin,
    titolareId: contesto.accountId,
    membroId: contesto.userId,
    emailUfficioGare: user.email,
    servizio,
    quantita: pacchetto.quantita,
  });
  if (avviso === "non_riuscito") return { error: TESTI_PACCHETTI.avvisoNonRiuscito };
  return { success: avviso === "gia_inviato_oggi" ? TESTI_PACCHETTI.avvisoGiaInviato : TESTI_PACCHETTI.avvisoInviato };
}
