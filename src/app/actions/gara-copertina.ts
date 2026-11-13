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
import {
  copertineDaNomi,
  fileCopertina,
  idCopertinaValido,
  leggiTestiCliente,
  marcaTempo,
  messaggioErroreCopertina,
  nomeFileScaricato,
  normalizzaStile,
  numeriCopertine,
  percorsoCopertinaValido,
  stileDaNomeFile,
  type Stile,
} from "@/lib/copertina-relazione-calcoli";
import { generaCopertina, leggiPercorsoLogoCliente, leggiSchedaCopertina, linkCopertina, modificaCopertina, nomiFileCopertine } from "@/lib/copertina-relazione";
import {
  ALLEGATO_MASSIMO_BYTE,
  MESSAGGIO_SENZA_EFFETTI,
  RICHIESTA_MASSIMA,
  TIPI_ALLEGATO,
  applicaPiano,
  chatAperta,
  copertinaDiLavoro,
  loghiDiRiserva,
  pianoSenzaEffetti,
  statoChat,
  storiaPerInterprete,
  verificaPiano,
  type ChiLogo,
  type ContestoInterprete,
} from "@/lib/copertina-chat-calcoli";
import { annullaModifica, completaModifica, interpretaRichiesta, leggiChat, riservaModifica, salvaMessaggioCliente, salvaRisposta } from "@/lib/copertina-chat";
import { preparaLogo } from "@/lib/copertina-loghi";
import { logAiUsage } from "@/lib/ai-usage";
import { operazionePerRegistro } from "@/lib/anthropic";
import { annullaCopertina, completaCopertina, decidi, leggiContestoCopertina, riservaCopertina } from "@/lib/copertina-diritto";

// «Genera copertina relazione tecnica»: dentro la gara due pulsanti (stile stilizzato e stile realistico) chiedono a OpenAI di leggere il
// disciplinare/capitolato scelto (titolo, CIG e indicazioni per lo sfondo) e di disegnare una copertina A4 nello stile scelto, con il logo della
// stazione appaltante in alto a sinistra e quello del cliente in basso a destra. Il cliente può generarle in entrambi gli stili e poi decidere.
// Aperta al titolare e all'Ufficio Gare (è lavoro di gara). Chi può generare, a che prezzo e quante volte lo decide la console, cliente per cliente
// (impostazioni in copertina-diritto-calcoli.ts): acceso/spento, gratis (numero di gare e scadenza) o a pagamento; e in ogni caso al massimo 3
// generazioni per stile e per gara. I controlli sono QUI, non nei pulsanti.

// Dopo una generazione riuscita si rimanda alla pagina cosa è finito sulla copertina (stile, titolo, CIG, documento letto) e gli avvisi da mostrare.
export type CopertinaState = {
  error?: string;
  ok?: boolean;
  stile?: Stile;
  // i testi finiti sulla copertina e quali li ha scritti il cliente (gli altri sono letti dal documento)
  titoloPrincipale?: string;
  titolo?: string;
  cig?: string | null;
  daCliente?: { titoloPrincipale: boolean; sottotitolo: boolean; cig: boolean };
  documento?: string;
  avvisi?: string[];
};

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

  // I testi che il cliente può scrivere al posto di quelli letti dal documento (facoltativi, uno per uno): si controllano PRIMA di tutto il resto, così un CIG
  // sbagliato o un testo troppo lungo non consuma né una generazione né una gara gratis. Prevalgono sull'estrazione; il documento si legge comunque per lo sfondo.
  const testi = leggiTestiCliente({ titoloPrincipale: formData.get("testoTitoloPrincipale"), sottotitolo: formData.get("testoSottotitolo"), cig: formData.get("testoCig") });
  if (!testi.ok) return { error: testi.errore };

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
      testiCliente: testi.testi,
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
  return { ok: true, stile: esito.stile, titoloPrincipale: esito.titoloPrincipale, titolo: esito.titolo, cig: esito.cig, daCliente: esito.daCliente, documento: esito.documento, avvisi: esito.avvisi };
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
  // il numero nel nome del file è quello mostrato nella pagina («Copertina N.3 …»)
  const admin = createAdminClient();
  const numero = numeriCopertine(copertineDaNomi(await nomiFileCopertine(admin, garaId))).get(nomeFile.replace(/\.(png|pdf)$/, "")) ?? undefined;
  const url = await linkCopertina(admin, garaId, nomeFile, nomeFileScaricato(gara.titolo, estensione, stileDaNomeFile(nomeFile) ?? undefined, numero));
  return url ? { url } : { error: "Errore nella generazione del link di download." };
}

// ───── La chat per modificare una copertina (richiesta dell'utente, 13/11/2026) ─────
// Dopo le 6 generazioni (3 stilizzate e 3 realistiche) il cliente sceglie una copertina e scrive cosa cambiare: al massimo 3 copertine nuove per gara, poi la
// chat si chiude. Conta solo una copertina consegnata: una domanda o una richiesta poco chiara non consuma nulla (c'è comunque un tetto ai messaggi). Lavoro
// di gara: titolare e Ufficio Gare. Regole: copertina-chat-calcoli.ts; i controlli sono QUI, prima di qualsiasi chiamata a OpenAI.

export type ChatCopertinaState = { error?: string; ok?: boolean; messaggio?: string; nuova?: string };

const MESSAGGIO_NON_CAPITO = "Non sono riuscito a capire la richiesta: puoi riscriverla in modo più semplice, dicendo cosa vuoi cambiare nella copertina?";

export async function inviaRichiestaCopertina(_prevState: ChatCopertinaState, formData: FormData): Promise<ChatCopertinaState> {
  const supabase = await createClient();
  const guardia = await richiediAccountAzione();
  if (!guardia.ok) return { error: guardia.errore };
  const { user, contesto } = guardia;
  const accessoNegato = await accessoNegatoPerAccount(contesto, user, supabase);
  if (accessoNegato) return { error: accessoNegato };

  // ciò che arriva dal browser, controllato prima di tutto il resto
  const garaId = String(formData.get("garaId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(garaId)) return { error: "Gara non valida." };
  // la copertina scelta col flag conta SOLO per il primo messaggio: dopo, la decide la chat (vedi sotto)
  const sceltaDalBrowser = formData.get("copertina");
  if (sceltaDalBrowser !== null && sceltaDalBrowser !== "" && !idCopertinaValido(sceltaDalBrowser)) return { error: "Copertina non valida." };
  const richiesta = String(formData.get("richiesta") ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim();
  if (!richiesta) return { error: "Scrivi cosa vuoi cambiare nella copertina." };
  if (richiesta.length > RICHIESTA_MASSIMA) return { error: `La richiesta è troppo lunga: al massimo ${RICHIESTA_MASSIMA} caratteri.` };
  const file = formData.get("allegato");
  const conAllegato = file instanceof File && file.size > 0;
  let allegatoPer: ChiLogo | null = null;
  if (conAllegato) {
    if (!TIPI_ALLEGATO[file.type]) return { error: "Il logo allegato deve essere un'immagine PNG, JPG o WebP." };
    if (file.size > ALLEGATO_MASSIMO_BYTE) return { error: "Il logo allegato supera i 5 MB: riducilo e riprova." };
    const per = formData.get("allegatoPer");
    if (per !== "stazione" && per !== "cliente") return { error: "Indica di quale logo si tratta: il tuo o quello della stazione appaltante." };
    allegatoPer = per;
  }

  // la gara (la RLS la mostra solo all'account giusto)
  const { data: gara } = await supabase
    .from("gare")
    .select("id, titolo, stazione_appaltante, amministrazione_committente")
    .eq("id", garaId)
    .maybeSingle<{ id: string; titolo: string | null; stazione_appaltante: string | null; amministrazione_committente: string | null }>();
  if (!gara) return { error: "Gara non trovata." };

  // si può scrivere? Chat aperta (6 generazioni), modifiche rimaste, tetto dei messaggi, servizio ancora attivo per la gara, nessuna modifica in corso
  const admin = createAdminClient();
  const [ctx, chat] = await Promise.all([leggiContestoCopertina({ admin, accountId: contesto.accountId, garaId }), leggiChat(admin, garaId, contesto.accountId)]);
  if (ctx.errore || chat.errore) return { error: "Non riesco a controllare la chat in questo momento. Riprova tra qualche istante." };
  if (!chat.disponibile) return { error: "La chat per modificare le copertine non è ancora disponibile." };
  // il diritto sulla gara, senza il limite per stile (le 6 generazioni sono già state fatte)
  const diritto = decidi({ ...ctx, uso: { ...ctx.uso, perStile: { stilizzato: 0, realistico: 0 } } }, garaId, "stilizzato");
  const stato = statoChat({ aperta: chatAperta(ctx.uso), righe: chat.righe, adesso: new Date(), diritto: { ok: diritto.ok, messaggio: diritto.ok ? null : diritto.messaggio } });
  if (!stato.puoScrivere) return { error: stato.motivo ?? "La chat è chiusa." };

  // La copertina su cui lavorare (richiesta dell'utente, 13/11/2026): si sceglie UNA volta, col primo messaggio; poi la chat continua sempre sulla stessa,
  // ripartendo dall'ultima versione consegnata. Dopo la prima scelta la decide la chat, mai il browser.
  const lavoro = copertinaDiLavoro(chat.righe);
  const origine = lavoro ? lavoro.ultima : sceltaDalBrowser;
  if (!idCopertinaValido(origine)) return { error: "Scegli prima la copertina che ritieni migliore: la chat lavorerà su quella." };

  // la copertina scelta deve esistere ed essere modificabile (pagina senza loghi e scheda: le copertine fatte prima del 13/11/2026 non le hanno)
  const nomi = await nomiFileCopertine(admin, garaId);
  const fileOrigine = fileCopertina(origine);
  if (![fileOrigine.png, fileOrigine.base, fileOrigine.scheda].every((n) => nomi.includes(n))) {
    return {
      error: lavoro
        ? "La copertina su cui stavi lavorando non si trova più, quindi le modifiche non possono continuare."
        : "Questa copertina non si può modificare: è stata fatta prima che le modifiche in chat fossero disponibili. Scegline un'altra.",
    };
  }
  const scheda = await leggiSchedaCopertina(admin, garaId, contesto.accountId, origine);
  if (!scheda) return { error: lavoro ? "Non riesco a leggere la copertina su cui stai lavorando. Riprova tra qualche istante." : "Non riesco a leggere questa copertina. Scegline un'altra o riprova." };
  const numeri = numeriCopertine(copertineDaNomi(nomi));
  const numero = numeri.get(origine) ?? null;
  // Ciò che l'interprete deve sapere oltre alla copertina (correzione del 13/11/2026): chi è chi (nome della stazione appaltante e dell'azienda del cliente),
  // i messaggi precedenti, com'erano i loghi nella copertina scelta all'inizio. Senza, sulla gara Teatro alla Scala ha spostato il logo sbagliato e ha letto
  // la correzione «non il nostro logo» come «togli il nostro logo».
  const sceltaIniziale = lavoro ? lavoro.scelta : origine;
  // com'erano i loghi in ogni copertina consegnata in chat (al massimo 3): per rimediare a un errore tornando alla versione giusta precedente
  const consegnate = [...new Set(chat.righe.filter((r) => r.ruolo === "assistente" && r.stato === "pronta" && r.copertina && idCopertinaValido(r.copertina)).map((r) => r.copertina as string))];
  const [{ data: azienda }, schedaPartenza, schedeConsegnate] = await Promise.all([
    admin.from("companies").select("ragione_sociale").eq("user_id", contesto.accountId).maybeSingle<{ ragione_sociale: string | null }>(),
    sceltaIniziale === origine ? Promise.resolve(scheda) : leggiSchedaCopertina(admin, garaId, contesto.accountId, sceltaIniziale),
    Promise.all(consegnate.map(async (id) => [id, id === origine ? scheda : await leggiSchedaCopertina(admin, garaId, contesto.accountId, id)] as const)),
  ]);
  // la copertina da cui è nata quella da modificare (per annullare l'ultima modifica): una consegnata in chat, o quella di partenza
  const schedaPrecedente = scheda.origine ? (scheda.origine === sceltaIniziale ? schedaPartenza : (new Map(schedeConsegnate).get(scheda.origine) ?? null)) : null;
  const contestoInterprete: ContestoInterprete = {
    // il nome dell'ente: dalla gara; se l'estrazione non l'ha trovato, quello letto dal documento per la copertina (salvato nella scheda dal 13/11/2026)
    nomi: { stazione: gara.stazione_appaltante ?? gara.amministrazione_committente ?? schedaPartenza?.ente ?? scheda.ente ?? null, cliente: azienda?.ragione_sociale ?? null },
    titoloGara: gara.titolo,
    storia: storiaPerInterprete(chat.righe, numeri, new Map(schedeConsegnate)),
    partenza: schedaPartenza ? { numero: numeri.get(sceltaIniziale) ?? null, scheda: schedaPartenza } : null,
    precedente: schedaPrecedente && scheda.origine ? { numero: numeri.get(scheda.origine) ?? null, scheda: schedaPrecedente } : null,
  };

  // il logo allegato: deve essere un'immagine leggibile; si salva nella cartella della gara (va via con la gara)
  let allegato: { per: ChiLogo; percorso: string } | null = null;
  if (conAllegato && allegatoPer) {
    const contenuto = Buffer.from(await (file as File).arrayBuffer());
    if (!(await preparaLogo(contenuto))) return { error: "Il logo allegato non è un'immagine leggibile." };
    const percorso = `${garaId}/copertina-allegato-${marcaTempo(new Date())}.${TIPI_ALLEGATO[(file as File).type]}`;
    const { error: erroreCarica } = await admin.storage.from("gare").upload(percorso, contenuto, { contentType: (file as File).type, upsert: false });
    if (erroreCarica) return { error: "Non sono riuscito a caricare il logo allegato. Riprova." };
    allegato = { per: allegatoPer, percorso };
  }

  const idMessaggio = await salvaMessaggioCliente(admin, { garaId, userId: contesto.accountId, testo: richiesta, copertina: origine, allegato: allegato?.percorso ?? null, allegatoPer: allegato?.per ?? null });
  if (!idMessaggio) return { error: "Non sono riuscito a registrare il messaggio. Riprova." };
  const rispondi = async (testo: string, errore = false): Promise<ChatCopertinaState> => {
    await salvaRisposta(admin, { garaId, userId: contesto.accountId, testo });
    revalidatePath(`/dashboard/omnia-ai/gare/${garaId}`);
    return errore ? { error: testo } : { ok: true, messaggio: testo };
  };

  // la richiesta → il piano
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return rispondi("La modifica della copertina non è configurata (manca la chiave di OpenAI).", true);
  let interpretazione: Awaited<ReturnType<typeof interpretaRichiesta>>;
  try {
    interpretazione = await interpretaRichiesta({ scheda, numero, richiesta, allegatoPer: allegato?.per ?? null, contesto: contestoInterprete, apiKey });
  } catch (err) {
    console.error("Copertina: interpretazione della richiesta non riuscita", err instanceof Error ? err.message : err);
    return rispondi(messaggioErroreCopertina(err, "disegno"), true);
  }
  await logAiUsage({
    userId: contesto.accountId,
    garaId,
    operazione: operazionePerRegistro("copertina_relazione_chat"),
    provider: "openai",
    model: interpretazione.modello,
    inputTokens: interpretazione.uso.inputTokens,
    outputTokens: interpretazione.uso.outputTokens,
  });
  if (!interpretazione.piano) return rispondi(MESSAGGIO_NON_CAPITO);
  // i controlli nel codice sul piano: niente «togli» se il cliente non ha chiesto di togliere; se nomina un logo e il modello vuole cambiare l'altro, si chiede
  const verificato = verificaPiano({ piano: interpretazione.piano, richiesta, nomi: contestoInterprete.nomi });
  if (verificato.domanda) return rispondi(verificato.domanda);
  const piano = verificato.piano;
  // una domanda, una richiesta poco chiara o fuori tema: si risponde e non si consuma nulla. Con un logo allegato però il cliente vuole quel logo sulla copertina.
  if (piano.esito === "risposta" && !allegato) return rispondi(piano.messaggio);
  // la copertina nuova (un logo tolto per errore si rimette dalla copertina di partenza o dall'ultimo allegato); se resterebbe uguale non si prepara
  const dopo = applicaPiano({ scheda, piano, allegato, origine, riserva: loghiDiRiserva(chat.righe, schedaPartenza, garaId, schedaPrecedente) });
  if (!allegato && pianoSenzaEffetti(piano, scheda, dopo)) return rispondi(MESSAGGIO_SENZA_EFFETTI);

  // si registra che è in preparazione (conta subito), poi o si consegna o si annulla
  const riserva = await riservaModifica(admin, { garaId, userId: contesto.accountId, testo: piano.messaggio });
  if (!riserva) return rispondi("Non riesco a preparare la copertina in questo momento. Riprova tra qualche istante.", true);
  let esito: Awaited<ReturnType<typeof modificaCopertina>>;
  try {
    esito = await modificaCopertina({ garaId, accountId: contesto.accountId, origine, prima: scheda, dopo, piano, admin });
  } catch (err) {
    console.error("Copertina: modifica interrotta da un errore", err instanceof Error ? err.message : err);
    esito = { ok: false, errore: "La modifica della copertina non è riuscita. Riprova tra qualche istante." };
  }
  if (!esito.ok) {
    await annullaModifica(admin, riserva);
    return rispondi(esito.errore, true);
  }
  await completaModifica(admin, riserva, { testo: [piano.messaggio, ...esito.avvisi].join(" "), copertina: esito.id });
  revalidatePath(`/dashboard/omnia-ai/gare/${garaId}`);
  return { ok: true, messaggio: piano.messaggio, nuova: esito.id };
}
