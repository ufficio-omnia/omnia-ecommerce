"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createStripeClient } from "@/lib/stripe";
import { richiediAdminAzione } from "@/lib/console/accesso";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { PIANI, PIANI_ORDINE, type PianoSlug } from "@/lib/omnia-ai-plans";
import { lookupKeyDelPiano } from "@/lib/omnia-ai-stripe-prices";
import { euroACentesimi, erroreListino, giornoRoma, validaNuovoSconto } from "@/lib/omnia-ai-catalogo-calcoli";

// Prezzi dei piani e sconti di OMNIA AI (migrazione 0085). Ogni azione parte da richiediAdminAzione().
//
// Cambiare il prezzo di un piano crea un NUOVO prezzo su Stripe (i prezzi Stripe non si modificano)
// e sposta su di lui il lookup_key, quindi vale per i nuovi acquisti. Il vecchio prezzo Stripe
// non si tocca e non si archivia: gli abbonamenti già attivi continuano ad addebitare quello.

export type StatoPrezzi = { errore?: string; ok?: boolean; avviso?: string };

function ricarica() {
  revalidatePath("/site-console", "layout");
}

export async function salvaPrezzoPiano(_stato: StatoPrezzi, formData: FormData): Promise<StatoPrezzi> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const piano = String(formData.get("piano") ?? "");
  if (!PIANI_ORDINE.includes(piano as PianoSlug)) return { errore: "Piano non valido." };
  const slug = piano as PianoSlug;

  const nuovo = euroACentesimi(String(formData.get("prezzo") ?? ""));
  const errorePrezzo = erroreListino(nuovo);
  if (errorePrezzo || nuovo === null) return { errore: errorePrezzo ?? "Prezzo non valido." };

  if (!process.env.STRIPE_SECRET_KEY_OMNIA_AI) return { errore: "La chiave Stripe di OMNIA AI non è configurata: nessuna modifica fatta." };

  const admin = createAdminClient();
  const { data: attuale, error: erroreLettura } = await admin.from("omnia_ai_prezzi_piani").select("prezzo_centesimi").eq("piano", slug).maybeSingle<{ prezzo_centesimi: number }>();
  if (erroreLettura) {
    if (schemaAssente(erroreLettura)) return { errore: "Le tabelle dei prezzi non esistono ancora (migrazione 0085): nessuna modifica fatta." };
    console.error("Console: lettura del prezzo del piano fallita", erroreLettura.message);
    return { errore: "Lettura del prezzo attuale non riuscita: nessuna modifica fatta." };
  }
  const listinoAttuale = attuale?.prezzo_centesimi ?? PIANI[slug].prezzoCentesimi;

  // 1) Stripe: il prezzo attivo deve diventare quello nuovo. Se lo è già (una modifica precedente
  //    rimasta a metà: Stripe aggiornato e database no) non si crea niente, si riallinea il database.
  const stripe = createStripeClient("omnia-ai");
  let importoStripe: number | null;
  try {
    const attivi = await stripe.prices.list({ lookup_keys: [lookupKeyDelPiano(slug)], active: true, limit: 1 });
    const corrente = attivi.data[0];
    if (!corrente) return { errore: `Su Stripe non c'è un prezzo attivo per il piano ${PIANI[slug].nome} (chiave ${lookupKeyDelPiano(slug)}): va creato prima su Stripe. Nessuna modifica fatta.` };
    importoStripe = corrente.unit_amount;
    if (corrente.unit_amount === nuovo && listinoAttuale === nuovo) return { errore: "È già il prezzo attuale: nulla da cambiare." };

    if (corrente.unit_amount !== nuovo) {
      await stripe.prices.create({
        product: typeof corrente.product === "string" ? corrente.product : corrente.product.id,
        currency: corrente.currency,
        unit_amount: nuovo,
        recurring: { interval: corrente.recurring?.interval ?? "month", interval_count: corrente.recurring?.interval_count ?? 1 },
        lookup_key: lookupKeyDelPiano(slug),
        // il lookup_key passa al prezzo nuovo; quello vecchio resta com'è e continua a servire gli abbonamenti già attivi
        transfer_lookup_key: true,
        ...(corrente.tax_behavior && corrente.tax_behavior !== "unspecified" ? { tax_behavior: corrente.tax_behavior } : {}),
        ...(corrente.nickname ? { nickname: corrente.nickname } : {}),
        metadata: corrente.metadata,
      });
      importoStripe = nuovo;
    }
  } catch (e) {
    console.error("Console: aggiornamento del prezzo su Stripe fallito", e instanceof Error ? e.message : e);
    return { errore: "Stripe ha rifiutato la modifica: nessun prezzo è cambiato." };
  }

  // 2) Database: il listino che il sito mostra. Se questo passo fallisce Stripe è già cambiato: lo si
  //    dice, e il checkout si ferma da solo (prezzo Stripe ≠ listino) finché non si ripete l'operazione.
  const adesso = new Date().toISOString();
  const { error: erroreScrittura } = await admin.from("omnia_ai_prezzi_piani").upsert({ piano: slug, prezzo_centesimi: nuovo, aggiornato_il: adesso, aggiornato_da_email: sessione.email }, { onConflict: "piano" });
  if (erroreScrittura) {
    console.error("Console: salvataggio del prezzo del piano fallito", erroreScrittura.message);
    return { errore: "Su Stripe il prezzo è cambiato ma non sono riuscito a salvarlo nel database: per sicurezza gli acquisti di questo piano sono fermi. Ripremi «Salva prezzo» con lo stesso importo per completare." };
  }

  const { error: erroreStorico } = await admin.from("omnia_ai_prezzi_piani_storico").insert({ piano: slug, prezzo_precedente_centesimi: listinoAttuale, prezzo_nuovo_centesimi: nuovo, operatore_email: sessione.email });
  if (erroreStorico) console.error("Console: storico dei prezzi non scritto", erroreStorico.message);

  ricarica();
  revalidatePath("/piani");
  return { ok: true, ...(importoStripe !== nuovo ? { avviso: "Salvato, ma il prezzo su Stripe non risulta allineato." } : {}) };
}

export async function creaSconto(_stato: StatoPrezzi, formData: FormData): Promise<StatoPrezzi> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const admin = createAdminClient();
  const { data: prezzi, error: erroreLettura } = await admin.from("omnia_ai_prezzi_piani").select("piano, prezzo_centesimi").returns<{ piano: string; prezzo_centesimi: number }[]>();
  if (erroreLettura) {
    if (schemaAssente(erroreLettura)) return { errore: "Le tabelle degli sconti non esistono ancora (migrazione 0085): nessuno sconto creato." };
    console.error("Console: lettura dei listini fallita", erroreLettura.message);
    return { errore: "Lettura dei prezzi non riuscita: nessuno sconto creato." };
  }
  const listini = Object.fromEntries(PIANI_ORDINE.map((p) => [p, PIANI[p].prezzoCentesimi])) as Record<PianoSlug, number>;
  for (const r of prezzi ?? []) if (PIANI_ORDINE.includes(r.piano as PianoSlug)) listini[r.piano as PianoSlug] = r.prezzo_centesimi;

  const esito = validaNuovoSconto(
    {
      nome: String(formData.get("nome") ?? ""),
      piano: String(formData.get("piano") ?? ""),
      tipo: String(formData.get("tipo") ?? ""),
      valore: String(formData.get("valore") ?? ""),
      validoDal: String(formData.get("validoDal") ?? ""),
      validoAl: String(formData.get("validoAl") ?? ""),
      durataMesi: String(formData.get("durataMesi") ?? ""),
    },
    listini,
    giornoRoma(new Date()),
  );
  if (!esito.ok) return { errore: esito.errore };
  const v = esito.valori;

  const { error } = await admin.from("omnia_ai_sconti").insert({
    nome: v.nome,
    piano: v.piano,
    tipo: v.tipo,
    percentuale: v.percentuale,
    prezzo_scontato_centesimi: v.prezzoScontatoCentesimi,
    valido_dal: v.validoDal,
    valido_al: v.validoAl,
    durata_mesi: v.durataMesi,
    attivo: true,
    creato_da_email: sessione.email,
  });
  if (error) {
    console.error("Console: creazione dello sconto fallita", error.message);
    return { errore: "Creazione dello sconto non riuscita." };
  }

  ricarica();
  revalidatePath("/piani");
  return { ok: true };
}

// Disattiva (o riattiva) uno sconto. Non si cancella: resta la storia di cosa è stato offerto.
// Chi ha già comprato con lo sconto lo mantiene (il coupon sul suo abbonamento non si tocca).
export async function impostaScontoAttivo(_stato: { errore?: string }, formData: FormData): Promise<{ errore?: string }> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const id = String(formData.get("id") ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return { errore: "Sconto non valido." };
  const attivo = String(formData.get("attivo") ?? "") === "1";

  const { data, error } = await createAdminClient().from("omnia_ai_sconti").update({ attivo }).eq("id", id).select("id");
  if (error) {
    console.error("Console: aggiornamento dello sconto fallito", error.message);
    return { errore: "Aggiornamento non riuscito." };
  }
  if (!data || data.length === 0) return { errore: "Sconto non trovato." };

  ricarica();
  revalidatePath("/piani");
  return {};
}
