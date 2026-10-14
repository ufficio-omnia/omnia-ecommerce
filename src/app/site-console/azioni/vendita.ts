"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createStripeClient } from "@/lib/stripe";
import { richiediAdminAzione } from "@/lib/console/accesso";
import { leggiPrezziConsole } from "@/lib/console/prezzi";
import { leggiControlloStripe } from "@/lib/console/controllo-stripe";
import { motiviCheImpedisconoLaVendita, pianiConPrezzoDaCreare } from "@/lib/console/controllo-stripe-calcoli";
import { CHIAVE_VENDITA, modalitaChiaveStripe } from "@/lib/omnia-ai-vendita";
import { creaPrezziSuStripe } from "@/lib/console/crea-prezzi-stripe";

// Messa in vendita degli abbonamenti dal sito. Ogni azione parte da richiediAdminAzione().

export type StatoVendita = { errore?: string; ok?: boolean; avviso?: string };

function ricarica() {
  revalidatePath("/site-console", "layout");
  revalidatePath("/piani");
}

// Crea su Stripe i prezzi dei piani che non ne hanno nessuno attivo (tipicamente un account appena
// passato alla modalità reale: i prezzi esistono solo in quella di prova). Stesso formato di quelli di
// prova: mensile, in euro, importo del LISTINO (IVA inclusa), lookup_key «omnia_ai_<piano>». Non tocca
// mai un prezzo che esiste già, anche se diverso dal listino: quello si risolve risalvando il prezzo.
export async function creaPrezziMancanti(): Promise<StatoVendita> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const chiave = process.env.STRIPE_SECRET_KEY_OMNIA_AI;
  if (modalitaChiaveStripe(chiave) === "sconosciuta") return { errore: "La chiave Stripe di OMNIA AI manca o non è riconosciuta: nessun prezzo creato." };

  const dati = await leggiPrezziConsole();
  const daCreare = pianiConPrezzoDaCreare(dati.piani.map((p) => ({ slug: p.slug, nome: p.nome, listinoCentesimi: p.listinoCentesimi, stato: p.stripe.stato })));
  if (daCreare.length === 0) return { ok: true, avviso: "Nessun prezzo mancante: non c'è niente da creare." };

  const esito = await creaPrezziSuStripe(createStripeClient("omnia-ai"), daCreare);
  if (esito.errore) return { errore: esito.errore };

  ricarica();
  return { ok: true, avviso: `Creati su Stripe i prezzi: ${esito.creati.join(", ")}.` };
}

// Accende o spegne la vendita. Si accende solo se tutti i controlli passano (stessa regola della pagina,
// ricalcolata qui: il pulsante nella pagina non è una garanzia). Si spegne sempre.
export async function impostaVenditaAbbonamenti(_stato: StatoVendita, formData: FormData): Promise<StatoVendita> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const azione = String(formData.get("azione") ?? "");
  if (azione !== "attiva" && azione !== "sospendi") return { errore: "Azione non valida." };

  if (azione === "attiva") {
    const [dati, controllo] = await Promise.all([leggiPrezziConsole(), leggiControlloStripe()]);
    const motivi = motiviCheImpedisconoLaVendita({
      modalita: modalitaChiaveStripe(process.env.STRIPE_SECRET_KEY_OMNIA_AI),
      piani: dati.piani.map((p) => ({ slug: p.slug, nome: p.nome, listinoCentesimi: p.listinoCentesimi, stato: p.stripe.stato })),
      webhook: controllo.webhook,
    });
    if (motivi.length > 0) return { errore: `Non posso accendere la vendita: ${motivi.join(" ")}` };
  }

  const { error } = await createAdminClient()
    .from("console_impostazioni")
    .upsert({ chiave: CHIAVE_VENDITA, valore: azione === "attiva" ? "1" : "0", aggiornato_il: new Date().toISOString(), aggiornato_da: sessione.userId }, { onConflict: "chiave" });
  if (error) {
    console.error("Console: salvataggio dell'interruttore di vendita fallito", error.message);
    return { errore: "Salvataggio non riuscito." };
  }

  ricarica();
  return { ok: true, avviso: azione === "attiva" ? "Vendita accesa: il pulsante «Abbonati» è ora visibile su /piani." : "Vendita sospesa: il pulsante «Abbonati» non è più visibile su /piani." };
}
