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
import { richiediAccountAzione, richiediTitolareAzione } from "@/lib/omnia-ai-account-guardie";
import { VERSIONE_CONDIZIONI_COPERTINA, testoCanonicoCondizioniCopertina } from "@/lib/copertina-acquisto-calcoli";
import { accessoNegatoPerAccount } from "@/lib/omnia-ai-account-lavoro";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { nomeFileScaricato, normalizzaStile, percorsoCopertinaValido, stileDaNomeFile, type Stile } from "@/lib/copertina-relazione-calcoli";
import { generaCopertina, leggiPercorsoLogoCliente, linkCopertina } from "@/lib/copertina-relazione";
import { annullaCopertina, completaCopertina, decidi, leggiContestoCopertina, riservaCopertina } from "@/lib/copertina-diritto";

// «Genera copertina relazione tecnica»: dentro la gara due pulsanti (stile stilizzato e stile realistico) chiedono a OpenAI di leggere il
// disciplinare/capitolato scelto (titolo, CIG e indicazioni per lo sfondo) e di disegnare una copertina A4 nello stile scelto, con il logo della
// stazione appaltante in alto a sinistra e quello del cliente in basso a destra. Il cliente può generarle in entrambi gli stili e poi decidere.
// Aperta al titolare e all'Ufficio Gare (è lavoro di gara). Chi può generare, a che prezzo e quante volte lo decide la console, cliente per cliente
// (impostazioni in copertina-diritto-calcoli.ts): acceso/spento, gratis (numero di gare e scadenza) o a pagamento; e in ogni caso al massimo 3
// generazioni per stile e per gara. I controlli sono QUI, non nei pulsanti.

// Dopo una generazione riuscita si rimanda alla pagina cosa è finito sulla copertina (stile, titolo, CIG, documento letto) e gli avvisi da mostrare.
export type CopertinaState = { error?: string; ok?: boolean; stile?: Stile; titolo?: string; cig?: string | null; documento?: string; avvisi?: string[] };

export async function generaCopertinaGara(_prevState: CopertinaState, formData: FormData): Promise<CopertinaState> {
  const supabase = await createClient();
  const guardia = await richiediAccountAzione();
  if (!guardia.ok) return { error: guardia.errore };
  const { user, contesto } = guardia;

  // come ogni azione che genera contenuto: bloccata in sola lettura (abbonamento scaduto)
  const accessoNegato = await accessoNegatoPerAccount(contesto, user, supabase);
  if (accessoNegato) return { error: accessoNegato };

  const garaId = String(formData.get("garaId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(garaId)) return { error: "Gara non valida." };

  // Lo stile è quello del pulsante premuto (il valore arriva dal browser): solo i due stili previsti, nessun valore di ripiego
  const stile = normalizzaStile(formData.get("stile"));
  if (!stile) return { error: "Scegli lo stile della copertina: stilizzato o realistico." };

  // La RLS ("gare_all_own") garantisce che la gara sia dell'azienda dell'utente
  const { data: gara, error: erroreGara } = await supabase
    .from("gare")
    .select("id, titolo, cig, stazione_appaltante, logo_cliente_path, estrazione_stato")
    .eq("id", garaId)
    .maybeSingle<{ id: string; titolo: string; cig: string | null; stazione_appaltante: string | null; logo_cliente_path: string | null; estrazione_stato: string | null }>();
  if (erroreGara) {
    console.error("Copertina: lettura della gara non riuscita", erroreGara.message);
    return { error: "Non sono riuscito a leggere la gara. Riprova." };
  }
  if (!gara) return { error: "Gara non trovata." };
  // la gara deve essere stata analizzata: titolo, CIG e stazione appaltante già estratti servono da ripiego se il documento non li dà in modo verificabile
  if (gara.estrazione_stato !== "completata") return { error: "Analizza prima i documenti della gara: la copertina usa i dati dell'analisi come ripiego." };

  // Il documento da leggere: sceglie il cliente (di solito il disciplinare o il capitolato). L'identificativo arriva dal browser: si cerca TRA i documenti
  // di questa gara (la RLS li mostra solo al proprietario) e deve essere un PDF.
  const documentoId = String(formData.get("documentoId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(documentoId)) return { error: "Scegli il documento da cui leggere titolo e CIG." };
  const { data: documento } = await supabase
    .from("gara_documenti")
    .select("id, nome_file, file_path")
    .eq("id", documentoId)
    .eq("gara_id", garaId)
    .maybeSingle<{ id: string; nome_file: string; file_path: string }>();
  if (!documento) return { error: "Documento non trovato in questa gara." };
  if (!documento.nome_file.toLowerCase().endsWith(".pdf")) return { error: "Il documento scelto non è un PDF: scegli il disciplinare o il capitolato in formato PDF." };

  // Chi può generare: le impostazioni del cliente (titolare, anche se lavora l'Ufficio Gare) e ciò che ha già generato. Si rilegge QUI, mai dal browser.
  const admin = createAdminClient();
  const ctx = await leggiContestoCopertina({ admin, accountId: contesto.accountId, garaId: gara.id });
  if (ctx.errore) return { error: "Non riesco a controllare il servizio in questo momento. Riprova tra qualche istante." };
  const diritto = decidi(ctx, gara.id, stile);
  if (!diritto.ok) return { error: diritto.messaggio };

  // Settore (migrazione 0103), in una lettura a parte: se la colonna non c'è la copertina si basa solo sulla lettura del documento
  const { data: settoreRiga, error: erroreSettore } = await supabase.from("gare").select("settore").eq("id", garaId).maybeSingle<{ settore: string | null }>();
  if (erroreSettore && !schemaAssente(erroreSettore)) console.error("Copertina: lettura del settore non riuscita", erroreSettore.message);

  // Si registra che la generazione parte (così limite e gare gratis tengono conto anche di questa, mentre è in corso). Senza la tabella (migrazione 0106)
  // si procede solo in sviluppo locale, dove `decidi` ha già dato il via libera.
  const riserva = await riservaCopertina(admin, { garaId: gara.id, userId: contesto.accountId, stile, fonte: diritto.fonte });
  if (riserva.stato === "errore") return { error: "Non riesco a registrare la generazione in questo momento. Riprova tra qualche istante." };
  if (riserva.stato === "schema_assente" && diritto.fonte !== "sviluppo") return { error: "Il servizio non è ancora disponibile. Riprova più tardi." };
  const rigaId = riserva.stato === "ok" ? riserva.id : null;

  let esito: Awaited<ReturnType<typeof generaCopertina>>;
  try {
    esito = await generaCopertina({
      garaId: gara.id,
      accountId: contesto.accountId,
      stile,
      gara: { titolo: gara.titolo, cig: gara.cig, stazioneAppaltante: gara.stazione_appaltante, settore: settoreRiga?.settore },
      documento: { file_path: documento.file_path, nome_file: documento.nome_file },
      logoStazionePath: gara.logo_cliente_path,
      logoClientePath: await leggiPercorsoLogoCliente(admin, contesto.accountId),
      admin,
    });
  } catch (err) {
    // generaCopertina non lancia errori (li trasforma in un esito), ma una generazione che salta non deve restare registrata come fatta
    console.error("Copertina: generazione interrotta da un errore", err instanceof Error ? err.message : err);
    esito = { ok: false, errore: "La generazione della copertina non è riuscita. Riprova tra qualche istante." };
  }

  // Non riuscita: non conta (né per il limite né per le gare gratis). Riuscita: la riga diventa «pronta».
  if (rigaId) {
    if (esito.ok) await completaCopertina(admin, rigaId, esito.marca);
    else await annullaCopertina(admin, rigaId);
  }

  revalidatePath(`/dashboard/omnia-ai/gare/${garaId}`);
  if (!esito.ok) return { error: esito.errore };
  return { ok: true, stile: esito.stile, titolo: esito.titolo, cig: esito.cig, documento: esito.documento, avvisi: esito.avvisi };
}

// `prezzoAggiornatoCentesimi`: il prezzo che il cliente aveva davanti non vale più (la console l'ha cambiato mentre decideva): la pagina mostra quello nuovo.
export type AcquistoCopertinaState = { error?: string; prezzoAggiornatoCentesimi?: number };

// Avvia il pagamento della copertina di UNA gara. Tutto ciò che conta si controlla QUI, lato server, e il prezzo si rilegge sempre dalle impostazioni
// del cliente: quello arrivato dal browser serve solo ad accorgersi se nel frattempo è cambiato. Compra solo il titolare (l'Ufficio Gare vede che serve il
// titolare). L'acquisto diventa «pagato» solo dal webhook di Stripe, mai da questa pagina.
export async function acquistaCopertina(_prevState: AcquistoCopertinaState, formData: FormData): Promise<AcquistoCopertinaState> {
  const supabase = await createClient();
  const guardia = await richiediTitolareAzione();
  if (!guardia.ok) return { error: guardia.errore };
  const { user, contesto } = guardia;
  if (!user.email) return { error: "Sessione scaduta: accedi di nuovo e riprova." };

  const accessoNegato = await requireOmniaAiWriteAccess(user.id, supabase);
  if (accessoNegato) return { error: accessoNegato };

  const garaId = String(formData.get("garaId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(garaId)) return { error: "Gara non valida." };

  if (formData.get("accettaAvvertenze") !== "on") return { error: "Devi accettare le condizioni di acquisto della copertina e prendere visione della Privacy policy." };
  if (formData.get("accettaClausole") !== "on") return { error: "Devi approvare specificamente le clausole indicate." };

  // La RLS garantisce che la gara sia dell'azienda dell'utente
  const { data: gara } = await supabase.from("gare").select("id, titolo, estrazione_stato").eq("id", garaId).maybeSingle<{ id: string; titolo: string; estrazione_stato: string | null }>();
  if (!gara) return { error: "Gara non trovata." };
  if (gara.estrazione_stato !== "completata") return { error: "Analizza prima i documenti della gara." };

  // Si paga solo quando il pagamento cambia qualcosa: servizio «a pagamento» per questo cliente, gara non ancora pagata, pagamento online possibile.
  // Le stesse regole della pagina (decidi): se il diritto c'è già, o il servizio non è in vendita per lui, non si arriva a Stripe.
  const admin = createAdminClient();
  const ctx = await leggiContestoCopertina({ admin, accountId: contesto.accountId, garaId: gara.id });
  if (ctx.errore) return { error: "Non riesco a controllare il servizio in questo momento. Riprova tra qualche istante." };
  if (ctx.acquistata) return { error: "Hai già acquistato la copertina di questa gara: generala dalla pagina della gara." };
  const diritto = decidi(ctx, gara.id, "stilizzato");
  if (diritto.ok) return { error: "Puoi già generare la copertina di questa gara: non serve acquistarla." };
  if (diritto.motivo !== "a_pagamento") return { error: diritto.messaggio };
  if (!diritto.acquistabile || diritto.prezzoCentesimi === null) return { error: "Il pagamento online della copertina non è ancora disponibile: scrivici dalla pagina Supporto." };

  const prezzo = diritto.prezzoCentesimi;
  const mostrato = Number(formData.get("prezzoMostratoCentesimi"));
  if (mostrato !== prezzo) return { error: "Il prezzo è stato aggiornato. Controlla il nuovo importo e conferma di nuovo.", prezzoAggiornatoCentesimi: prezzo };

  const documenti = await getCurrentOmniaAiLegalDocuments(admin);
  const { ip, userAgent } = await getRequestMeta();
  const condizioniHash = createHash("sha256").update(testoCanonicoCondizioniCopertina()).digest("hex");

  const { data: acquisto, error: erroreInserimento } = await admin
    .from("omnia_ai_copertine_acquisti")
    .insert({
      user_id: user.id,
      gara_id: gara.id,
      gara_titolo: gara.titolo,
      prezzo_centesimi: prezzo,
      condizioni_versione: VERSIONE_CONDIZIONI_COPERTINA,
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
    if (schemaAssente(erroreInserimento)) console.error("Copertina: tabella omnia_ai_copertine_acquisti assente (migrazione 0107 non eseguita)");
    else console.error("Copertina: registrazione dell'acquisto non riuscita", erroreInserimento?.message);
    return { error: "L'acquisto della copertina non è ancora disponibile: riprova più tardi o scrivici dalla pagina Supporto." };
  }

  const origin = await getOmniaAiRequestOrigin();
  const stripe = createStripeClient("omnia-ai");
  const titoloBreve = gara.titolo.length > 90 ? `${gara.titolo.slice(0, 87)}...` : gara.titolo;
  const metadata = { tipo: "omnia_ai_copertina", acquistoId: acquisto.id, userId: user.id, garaId: gara.id };

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
              name: "OMNIA AI — Copertina della relazione tecnica",
              description: `Gara: ${titoloBreve}. Copertina grafica A4 (PNG e PDF): fino a 3 generazioni in stile stilizzato e 3 in stile realistico.`,
            },
            unit_amount: prezzo,
          },
          quantity: 1,
        },
      ],
      metadata,
      payment_intent_data: { metadata },
      // L'acquisto diventa «pagato» solo dal webhook, mai da questa pagina di ritorno.
      success_url: `${origin}/dashboard/omnia-ai/gare/${gara.id}?copertina=pagato`,
      cancel_url: `${origin}/dashboard/omnia-ai/gare/${gara.id}?copertina=annullato`,
    });
  } catch (err) {
    console.error("Errore creazione sessione Stripe (copertina):", err);
    return { error: "Errore nell'avvio del pagamento. Riprova." };
  }

  if (!sessione.url) return { error: "Errore nell'avvio del pagamento. Riprova." };

  const { error: erroreSessione } = await admin.from("omnia_ai_copertine_acquisti").update({ stripe_session_id: sessione.id }).eq("id", acquisto.id);
  if (erroreSessione) console.error("Copertina: id della sessione Stripe non salvato (lo scriverà il webhook)", erroreSessione.message);

  redirect(sessione.url);
}

export type DownloadCopertinaState = { error?: string; url?: string };

// Il link temporaneo per scaricare un file di copertina (PNG o PDF). Il nome arriva dal browser: si accetta solo quello di un file di copertina,
// nella cartella di una gara dell'account (la RLS la mostra solo al proprietario). Si scarica anche a servizio spento: sono file del cliente.
export async function scaricaCopertinaGara(_prevState: DownloadCopertinaState, formData: FormData): Promise<DownloadCopertinaState> {
  const garaId = String(formData.get("garaId") ?? "");
  const nomeFile = formData.get("nomeFile");
  if (!percorsoCopertinaValido(garaId, nomeFile)) return {};

  const supabase = await createClient();
  const guardia = await richiediAccountAzione();
  if (!guardia.ok) return { error: guardia.errore };

  const { data: gara } = await supabase.from("gare").select("id, titolo").eq("id", garaId).maybeSingle<{ id: string; titolo: string }>();
  if (!gara) return { error: "Gara non trovata." };

  const estensione = nomeFile.endsWith(".pdf") ? "pdf" : "png";
  const url = await linkCopertina(createAdminClient(), garaId, nomeFile, nomeFileScaricato(gara.titolo, estensione, stileDaNomeFile(nomeFile) ?? undefined));
  return url ? { url } : { error: "Errore nella generazione del link di download." };
}
