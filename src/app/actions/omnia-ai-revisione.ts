"use server";

import { createHash } from "crypto";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createStripeClient } from "@/lib/stripe";
import { requireOmniaAiWriteAccess } from "@/lib/omnia-ai-access";
import { getCurrentOmniaAiLegalDocuments } from "@/lib/omnia-ai-legal";
import { getRequestMeta } from "@/lib/legal-acceptance";
import { getOmniaAiRequestOrigin } from "@/lib/omnia-ai-request";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { REVISIONE, calcolaPrezzoRevisione, validaContattiRevisione } from "@/lib/omnia-ai-revisione-calcoli";
import { VERSIONE_CONDIZIONI_REVISIONE, testoCanonicoCondizioniRevisione } from "@/lib/omnia-ai-revisione-condizioni";
import { leggiContestoRevisione } from "@/lib/omnia-ai-revisione";

// `prezzoAggiornatoCentesimi`: il prezzo che il cliente aveva davanti non vale più (la scadenza della
// gara è passata a una fascia di urgenza diversa mentre compilava): la pagina mostra quello nuovo.
export type RevisioneState = { error?: string; prezzoAggiornatoCentesimi?: number };

// Avvia il pagamento della revisione umana. Tutto ciò che conta si controlla QUI, lato server, e il
// prezzo si ricalcola sempre: quello arrivato dal browser serve solo a accorgersi se nel frattempo è cambiato.
export async function avviaRevisioneUmana(_prevState: RevisioneState, formData: FormData): Promise<RevisioneState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) return { error: "Sessione scaduta: accedi di nuovo e riprova." };

  const accessoNegato = await requireOmniaAiWriteAccess(user.id, supabase);
  if (accessoNegato) return { error: accessoNegato };

  const garaId = String(formData.get("garaId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(garaId)) return { error: "Gara non valida." };

  if (formData.get("acceptCondizioni") !== "on") return { error: "Devi accettare le Condizioni del servizio di revisione umana e prendere visione della Privacy policy." };
  if (formData.get("acceptClausole") !== "on") return { error: "Devi approvare specificamente le clausole indicate delle Condizioni del servizio." };

  const contatti = validaContattiRevisione({ nome: formData.get("referenteNome"), email: formData.get("referenteEmail"), cellulare: formData.get("referenteCellulare") });
  if (!contatti.ok) return { error: contatti.errore };

  const admin = createAdminClient();
  const contesto = await leggiContestoRevisione({ supabase, admin, userId: user.id, garaId });
  if (!contesto) return { error: "Gara non trovata." };
  if (!contesto.relazione) return { error: "La revisione umana si richiede dopo aver elaborato la relazione tecnica finale, con tutti i criteri." };
  if (contesto.pagata) return { error: "Hai già richiesto e pagato la revisione umana di questa relazione tecnica." };

  const esito = calcolaPrezzoRevisione({
    scadenza: contesto.gara.scadenza,
    scadenzaOra: contesto.gara.scadenza_ora,
    limitePagineDisciplinare: contesto.gara.limite_pagine_totale,
    pagineStimateRelazione: contesto.relazione.pagineStimate,
    adesso: new Date(),
  });
  if (!esito.ok) return { error: esito.messaggio };
  const prezzo = esito.prezzo;

  const mostrato = Number(formData.get("prezzoMostratoCentesimi"));
  if (mostrato !== prezzo.totaleCentesimi) {
    return { error: "Il prezzo è stato aggiornato (cambia con la scadenza della gara). Controlla il nuovo importo e conferma di nuovo.", prezzoAggiornatoCentesimi: prezzo.totaleCentesimi };
  }

  // Il Word deve esistere davvero, prima di prendere soldi: l'ufficio lo riceve in allegato.
  const { data: esiste } = await admin.storage.from("gare").exists(contesto.relazione.filePath);
  if (!esiste) return { error: "Il file Word della relazione tecnica non risulta più disponibile: ricomponi la relazione finale dalla chat e riprova." };

  const documenti = await getCurrentOmniaAiLegalDocuments(admin);
  const { ip, userAgent } = await getRequestMeta();
  const condizioniHash = createHash("sha256").update(testoCanonicoCondizioniRevisione()).digest("hex");

  const { data: richiesta, error: erroreInserimento } = await admin
    .from("omnia_ai_revisioni")
    .insert({
      user_id: user.id,
      gara_id: contesto.gara.id,
      gara_titolo: contesto.gara.titolo,
      messaggio_id: contesto.relazione.messaggioId,
      file_nome: contesto.relazione.fileNome,
      file_path: contesto.relazione.filePath,
      pagine: prezzo.pagine,
      pagine_fonte: prezzo.fonte,
      prezzo_base_centesimi: prezzo.baseCentesimi,
      maggiorazione_percentuale: prezzo.maggiorazionePercentuale,
      prezzo_totale_centesimi: prezzo.totaleCentesimi,
      scadenza_gara: prezzo.scadenza,
      scadenza_ora: prezzo.scadenzaOra,
      ore_alla_scadenza: prezzo.oreAllaScadenza !== null ? Math.round(prezzo.oreAllaScadenza) : null,
      referente_nome: contatti.valori.nome,
      referente_email: contatti.valori.email,
      referente_cellulare: contatti.valori.cellulare,
      condizioni_versione: VERSIONE_CONDIZIONI_REVISIONE,
      condizioni_hash: condizioniHash,
      accettato_il: new Date().toISOString(),
      accept_ip: ip,
      accept_user_agent: (userAgent ?? "").slice(0, 490) || null,
      privacy_documento_id: documenti?.privacyPolicy.id ?? null,
      privacy_versione: documenti?.privacyPolicy.version ?? null,
      livemode: !process.env.STRIPE_SECRET_KEY_OMNIA_AI?.startsWith("sk_test_"),
    })
    .select("id")
    .single<{ id: string }>();

  if (erroreInserimento || !richiesta) {
    if (schemaAssente(erroreInserimento)) console.error("Revisione umana: tabella omnia_ai_revisioni assente (migrazione 0089 non eseguita)");
    else console.error("Revisione umana: registrazione della richiesta non riuscita", erroreInserimento?.message);
    return { error: "Il servizio di revisione umana non è ancora disponibile: riprova più tardi o scrivici dalla pagina Supporto." };
  }

  const origin = await getOmniaAiRequestOrigin();
  const stripe = createStripeClient("omnia-ai");
  const titoloBreve = contesto.gara.titolo.length > 90 ? `${contesto.gara.titolo.slice(0, 87)}...` : contesto.gara.titolo;
  const metadata = { tipo: "omnia_ai_revisione", revisioneId: richiesta.id, userId: user.id, garaId: contesto.gara.id };

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
              name: "OMNIA AI — Revisione umana della relazione tecnica",
              description: `Gara: ${titoloBreve}. ${prezzo.pagine} pagine${prezzo.maggiorazionePercentuale > 0 ? `, maggiorazione per urgenza ${prezzo.maggiorazionePercentuale}%` : ""}. Contatto entro ${REVISIONE.oreContattoLavorative} ore lavorative, consegna entro ${REVISIONE.oreConsegna} ore.`,
            },
            unit_amount: prezzo.totaleCentesimi,
          },
          quantity: 1,
        },
      ],
      metadata,
      payment_intent_data: { metadata },
      // La richiesta diventa «pagata» solo dal webhook, mai da questa pagina di ritorno.
      success_url: `${origin}/dashboard/omnia-ai/gare/${contesto.gara.id}/revisione?richiesta=${richiesta.id}`,
      cancel_url: `${origin}/dashboard/omnia-ai/gare/${contesto.gara.id}/revisione`,
    });
  } catch (err) {
    console.error("Errore creazione sessione Stripe (revisione umana):", err);
    return { error: "Errore nell'avvio del pagamento. Riprova." };
  }

  if (!sessione.url) return { error: "Errore nell'avvio del pagamento. Riprova." };

  const { error: erroreSessione } = await admin.from("omnia_ai_revisioni").update({ stripe_session_id: sessione.id }).eq("id", richiesta.id);
  if (erroreSessione) console.error("Revisione umana: id della sessione Stripe non salvato (lo scriverà il webhook)", erroreSessione.message);

  redirect(sessione.url);
}
