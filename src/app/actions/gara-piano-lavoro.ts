"use server";

import { createHash } from "crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createStripeClient } from "@/lib/stripe";
import { requireOmniaAiWriteAccess } from "@/lib/omnia-ai-access";
import { getCurrentOmniaAiLegalDocuments } from "@/lib/omnia-ai-legal";
import { getRequestMeta } from "@/lib/legal-acceptance";
import { getOmniaAiRequestOrigin } from "@/lib/omnia-ai-request";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { richiediAccountAzione, richiediTitolareAzione } from "@/lib/omnia-ai-account-guardie";
import { accessoNegatoPerAccount, dirittoGaraPerAccount } from "@/lib/omnia-ai-account-lavoro";
import { generaPianoLavoro, leggiPianiGara, urlScaricoPiano } from "@/lib/piano-lavoro-gara";
import { aperturaSviluppoAttiva, valutaDirittoPiano } from "@/lib/piano-lavoro-gara-calcoli";
import { leggiPrezzoPianoLavoro, venditaPianoLavoroAttiva } from "@/lib/piano-lavoro-acquisto";
import { leggiDirittiPianoLavoro } from "@/lib/piano-lavoro-diritti";
import { VERSIONE_CONDIZIONI_PIANO_LAVORO, testoCanonicoCondizioniPianoLavoro } from "@/lib/piano-lavoro-acquisto-calcoli";

// Piano di lavoro di una gara: genera l'Excel, lo scarica e lo acquista. La generazione e il download sono aperti al titolare e all'Ufficio Gare
// (è lavoro di gara); l'acquisto singolo lo fa solo il titolare. Il diritto alla generazione viene da una concessione della console, dall'abbonamento
// che include il piano di lavoro (per le gare incluse nel piano), dalla prova gratuita decisa dalla console, dall'acquisto della gara (pagato,
// confermato da Stripe) oppure, solo in locale, dall'apertura di sviluppo (variabile OMNIA_AI_PIANO_LAVORO_APERTO, mai in produzione). Le regole
// sono in piano-lavoro-gara-calcoli.ts, le letture in piano-lavoro-diritti.ts. I controlli sono QUI, non nel pulsante.

export type PianoLavoroState = { error?: string; ok?: boolean };

export async function generaPianoLavoroGara(_prevState: PianoLavoroState, formData: FormData): Promise<PianoLavoroState> {
  const supabase = await createClient();
  const guardia = await richiediAccountAzione();
  if (!guardia.ok) return { error: guardia.errore };
  const { user, contesto } = guardia;

  // come ogni azione che genera contenuto: bloccata in sola lettura (abbonamento scaduto)
  const accessoNegato = await accessoNegatoPerAccount(contesto, user, supabase);
  if (accessoNegato) return { error: accessoNegato };

  const garaId = String(formData.get("garaId") ?? "");
  if (!garaId) return { error: "Gara non valida." };

  // La RLS garantisce che la gara sia dell'azienda dell'utente
  const { data: gara } = await supabase.from("gare").select("id, estrazione_stato").eq("id", garaId).maybeSingle<{ id: string; estrazione_stato: string | null }>();
  if (!gara) return { error: "Gara non trovata." };
  // colonna della migrazione 0095: se non c'è, nessuna proroga
  const { data: proroga } = await supabase.from("gare").select("proroga_stato").eq("id", garaId).maybeSingle<{ proroga_stato: string | null }>();

  const diritto = await dirittoGaraPerAccount({ contesto, user, garaId });
  const admin = createAdminClient();
  const { disponibile, piani } = await leggiPianiGara(admin, garaId);
  if (!disponibile) return { error: "Il piano di lavoro non è ancora disponibile: l'aggiornamento è in corso." };

  // da dove può venire il diritto (concessione, abbonamento, prova, acquisto): letto dal server, mai dal browser
  const diritti = await leggiDirittiPianoLavoro({ admin, accountId: contesto.accountId, garaId });
  const esito = valutaDirittoPiano({
    analisiCompleta: gara.estrazione_stato === "completata",
    garaUsabile: diritto.consentito,
    messaggioGaraBloccata: diritto.consentito ? undefined : diritto.messaggio,
    piani,
    prorogaStato: proroga?.proroga_stato ?? null,
    concessioneId: diritti.concessioneId,
    abbonamentoCopreGara: diritti.abbonamentoCopreGara,
    provaGratuita: diritti.provaGratuita,
    acquistoPagato: diritti.acquistoPagato,
    aperturaSviluppo: aperturaSviluppoAttiva(process.env),
    adesso: new Date(),
  });
  if (!esito.ok) return { error: esito.messaggio };

  const generato = await generaPianoLavoro({ garaId, accountId: contesto.accountId, versione: esito.versione, fonte: esito.fonte, concessioneId: esito.concessioneId });
  revalidatePath(`/dashboard/omnia-ai/gare/${garaId}`);
  if (!generato.ok) return { error: generato.errore };
  return { ok: true };
}

export type DownloadPianoState = { error?: string; url?: string };

export async function scaricaPianoLavoroGara(_prevState: DownloadPianoState, formData: FormData): Promise<DownloadPianoState> {
  const pianoId = String(formData.get("pianoId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(pianoId)) return {};

  const supabase = await createClient();
  const guardia = await richiediAccountAzione();
  if (!guardia.ok) return { error: guardia.errore };
  const { contesto } = guardia;

  // La RLS (solo le righe della propria azienda) garantisce che il piano sia di questo account
  const { data: visibile } = await supabase.from("gara_piani_lavoro").select("id").eq("id", pianoId).maybeSingle<{ id: string }>();
  if (!visibile) return { error: "Piano di lavoro non trovato." };

  const admin = createAdminClient();
  const { data: piano } = await admin
    .from("gara_piani_lavoro")
    .select("stato, file_path, file_nome")
    .eq("id", pianoId)
    .eq("user_id", contesto.accountId)
    .maybeSingle<{ stato: string; file_path: string | null; file_nome: string | null }>();
  if (!piano || piano.stato !== "pronto") return { error: "Il piano di lavoro non è pronto." };

  const risultato = await urlScaricoPiano(admin, piano);
  return "url" in risultato ? { url: risultato.url } : { error: risultato.errore };
}

// `prezzoAggiornatoCentesimi`: il prezzo che il cliente aveva davanti non vale più (la console l'ha cambiato mentre decideva): la pagina mostra
// quello nuovo.
export type AcquistoPianoLavoroState = { error?: string; prezzoAggiornatoCentesimi?: number };

// Avvia il pagamento del piano di lavoro di UNA gara. Tutto ciò che conta si controlla QUI, lato server, e il prezzo si rilegge sempre:
// quello arrivato dal browser serve solo a accorgersi se nel frattempo è cambiato. Compra solo il titolare.
export async function acquistaPianoLavoro(_prevState: AcquistoPianoLavoroState, formData: FormData): Promise<AcquistoPianoLavoroState> {
  const supabase = await createClient();
  const guardia = await richiediTitolareAzione();
  if (!guardia.ok) return { error: guardia.errore };
  const { user, contesto } = guardia;
  if (!user.email) return { error: "Sessione scaduta: accedi di nuovo e riprova." };

  const accessoNegato = await requireOmniaAiWriteAccess(user.id, supabase);
  if (accessoNegato) return { error: accessoNegato };

  const garaId = String(formData.get("garaId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(garaId)) return { error: "Gara non valida." };

  if (formData.get("accettaAvvertenze") !== "on") return { error: "Devi accettare le avvertenze sul piano di lavoro e prendere visione della Privacy policy." };
  if (formData.get("accettaClausole") !== "on") return { error: "Devi approvare specificamente le clausole indicate." };

  const admin = createAdminClient();
  if (!(await venditaPianoLavoroAttiva(admin))) return { error: "L'acquisto del piano di lavoro non è ancora disponibile." };

  // La RLS garantisce che la gara sia dell'azienda dell'utente
  const { data: gara } = await supabase.from("gare").select("id, titolo, estrazione_stato").eq("id", garaId).maybeSingle<{ id: string; titolo: string; estrazione_stato: string | null }>();
  if (!gara) return { error: "Gara non trovata." };
  // colonna della migrazione 0095: se non c'è, nessuna proroga
  const { data: proroga } = await supabase.from("gare").select("proroga_stato").eq("id", garaId).maybeSingle<{ proroga_stato: string | null }>();

  const { disponibile, piani } = await leggiPianiGara(admin, garaId);
  if (!disponibile) return { error: "Il piano di lavoro non è ancora disponibile: l'aggiornamento è in corso." };

  const diritti = await leggiDirittiPianoLavoro({ admin, accountId: contesto.accountId, garaId });
  if (diritti.acquistoPagato) return { error: "Hai già acquistato il piano di lavoro di questa gara: generalo dalla pagina della gara." };
  // la console può escludere il piano di lavoro per gli account in prova
  if (diritti.provaBloccata) return { error: "Il piano di lavoro non è disponibile per un account in prova." };

  // Si paga solo quando il pagamento cambia qualcosa: analisi finita, gara usabile, nessuna generazione in corso, versioni non esaurite, e
  // nessun altro diritto (concessione, abbonamento con piano di lavoro, prova gratuita) che già lo permetta.
  const diritto = await dirittoGaraPerAccount({ contesto, user, garaId });
  const esito = valutaDirittoPiano({
    analisiCompleta: gara.estrazione_stato === "completata",
    garaUsabile: diritto.consentito,
    messaggioGaraBloccata: diritto.consentito ? undefined : diritto.messaggio,
    piani,
    prorogaStato: proroga?.proroga_stato ?? null,
    concessioneId: diritti.concessioneId,
    abbonamentoCopreGara: diritti.abbonamentoCopreGara,
    provaGratuita: diritti.provaGratuita,
    acquistoPagato: false,
    aperturaSviluppo: aperturaSviluppoAttiva(process.env),
    adesso: new Date(),
  });
  if (esito.ok) return { error: "Puoi già generare il piano di lavoro di questa gara: non serve acquistarlo." };
  if (esito.motivo !== "non_attivo") return { error: esito.messaggio };

  const prezzo = await leggiPrezzoPianoLavoro(admin);
  const mostrato = Number(formData.get("prezzoMostratoCentesimi"));
  if (mostrato !== prezzo) return { error: "Il prezzo è stato aggiornato. Controlla il nuovo importo e conferma di nuovo.", prezzoAggiornatoCentesimi: prezzo };

  const documenti = await getCurrentOmniaAiLegalDocuments(admin);
  const { ip, userAgent } = await getRequestMeta();
  const condizioniHash = createHash("sha256").update(testoCanonicoCondizioniPianoLavoro()).digest("hex");

  const { data: acquisto, error: erroreInserimento } = await admin
    .from("omnia_ai_piani_lavoro_acquisti")
    .insert({
      user_id: user.id,
      gara_id: gara.id,
      gara_titolo: gara.titolo,
      prezzo_centesimi: prezzo,
      condizioni_versione: VERSIONE_CONDIZIONI_PIANO_LAVORO,
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

  if (erroreInserimento || !acquisto) {
    if (schemaAssente(erroreInserimento)) console.error("Piano di lavoro: tabella omnia_ai_piani_lavoro_acquisti assente (migrazione 0097 non eseguita)");
    else console.error("Piano di lavoro: registrazione dell'acquisto non riuscita", erroreInserimento?.message);
    return { error: "L'acquisto del piano di lavoro non è ancora disponibile: riprova più tardi o scrivici dalla pagina Supporto." };
  }

  const origin = await getOmniaAiRequestOrigin();
  const stripe = createStripeClient("omnia-ai");
  const titoloBreve = gara.titolo.length > 90 ? `${gara.titolo.slice(0, 87)}...` : gara.titolo;
  const metadata = { tipo: "omnia_ai_piano_lavoro", acquistoId: acquisto.id, userId: user.id, garaId: gara.id };

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
              name: "OMNIA AI — Piano di lavoro della gara",
              description: `Gara: ${titoloBreve}. Excel con formule attive generato dai documenti di gara (una generazione, più una seconda solo se i documenti indicano una proroga dei termini).`,
            },
            unit_amount: prezzo,
          },
          quantity: 1,
        },
      ],
      metadata,
      payment_intent_data: { metadata },
      // L'acquisto diventa «pagato» solo dal webhook, mai da questa pagina di ritorno.
      success_url: `${origin}/dashboard/omnia-ai/gare/${gara.id}?piano_lavoro=pagato`,
      cancel_url: `${origin}/dashboard/omnia-ai/gare/${gara.id}?piano_lavoro=annullato`,
    });
  } catch (err) {
    console.error("Errore creazione sessione Stripe (piano di lavoro):", err);
    return { error: "Errore nell'avvio del pagamento. Riprova." };
  }

  if (!sessione.url) return { error: "Errore nell'avvio del pagamento. Riprova." };

  const { error: erroreSessione } = await admin.from("omnia_ai_piani_lavoro_acquisti").update({ stripe_session_id: sessione.id }).eq("id", acquisto.id);
  if (erroreSessione) console.error("Piano di lavoro: id della sessione Stripe non salvato (lo scriverà il webhook)", erroreSessione.message);

  redirect(sessione.url);
}
