"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createStripeClient } from "@/lib/stripe";
import { richiediAdminAzione } from "@/lib/console/accesso";
import { cercaClientePerConcessione, leggiPianoLavoroConsole } from "@/lib/console/piano-lavoro";
import { allineaPrezziPianoLavoro } from "@/lib/console/piano-lavoro-stripe";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { giornoRoma, euroACentesimi } from "@/lib/omnia-ai-catalogo-calcoli";
import { PIANI, PIANI_ORDINE } from "@/lib/omnia-ai-plans";
import { modalitaChiaveStripe } from "@/lib/omnia-ai-vendita";
import { CHIAVE_PREZZO_PIANO_LAVORO, CHIAVE_VENDITA_PIANO_LAVORO, PREZZO_PIANO_LAVORO } from "@/lib/piano-lavoro-acquisto-calcoli";
import { CHIAVE_POLITICA_PROVA, LIMITI_SURPLUS, POLITICHE_PROVA, chiaveSurplusPianoLavoro, validaNuovaConcessione } from "@/lib/piano-lavoro-offerta-calcoli";

// Piano di lavoro dalla console: vendita, prezzi, regola per gli utenti in prova, concessioni gratuite. Ogni azione parte da richiediAdminAzione().
// Le impostazioni stanno in console_impostazioni (chiave/valore, già usata per la messa in vendita degli abbonamenti): nessuna migrazione.

export type StatoPianoLavoro = { errore?: string; ok?: boolean; avviso?: string };

function ricarica() {
  revalidatePath("/site-console", "layout");
  revalidatePath("/piani");
}

async function salva(chiavi: { chiave: string; valore: string }[], operatoreId: string): Promise<boolean> {
  const adesso = new Date().toISOString();
  const { error } = await createAdminClient()
    .from("console_impostazioni")
    .upsert(
      chiavi.map((c) => ({ chiave: c.chiave, valore: c.valore, aggiornato_il: adesso, aggiornato_da: operatoreId })),
      { onConflict: "chiave" },
    );
  if (error) console.error("Console: salvataggio delle impostazioni del piano di lavoro fallito", error.message);
  return !error;
}

// Il prezzo del piano di lavoro di UNA gara (IVA inclusa). Vale per i nuovi acquisti.
export async function salvaPrezzoSingoloPianoLavoro(_stato: StatoPianoLavoro, formData: FormData): Promise<StatoPianoLavoro> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const centesimi = euroACentesimi(String(formData.get("prezzo") ?? ""));
  if (centesimi === null) return { errore: "Scrivi un importo in euro (per esempio 75 oppure 74,50)." };
  if (centesimi < PREZZO_PIANO_LAVORO.minimoCentesimi || centesimi > PREZZO_PIANO_LAVORO.massimoCentesimi) {
    return { errore: `Il prezzo dev'essere tra ${(PREZZO_PIANO_LAVORO.minimoCentesimi / 100).toFixed(2).replace(".", ",")} e ${(PREZZO_PIANO_LAVORO.massimoCentesimi / 100).toLocaleString("it-IT")} euro.` };
  }
  if (!(await salva([{ chiave: CHIAVE_PREZZO_PIANO_LAVORO, valore: String(centesimi) }], sessione.userId))) return { errore: "Salvataggio non riuscito." };

  ricarica();
  return { ok: true };
}

// I supplementi mensili: quanto si aggiunge al prezzo di ogni piano per avere il piano di lavoro nell'abbonamento. Per i nuovi abbonamenti
// serve poi «Allinea i prezzi su Stripe»: finché non lo si fa il checkout con il piano di lavoro si ferma da solo (prezzo Stripe ≠ prezzo mostrato).
export async function salvaSupplementiPianoLavoro(_stato: StatoPianoLavoro, formData: FormData): Promise<StatoPianoLavoro> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const valori: { chiave: string; valore: string }[] = [];
  for (const piano of PIANI_ORDINE) {
    const centesimi = euroACentesimi(String(formData.get(piano) ?? ""));
    if (centesimi === null || centesimi < LIMITI_SURPLUS.minimoCentesimi || centesimi > LIMITI_SURPLUS.massimoCentesimi) {
      return { errore: `Il supplemento del piano ${PIANI[piano].nome} dev'essere un importo in euro da 1 a ${(LIMITI_SURPLUS.massimoCentesimi / 100).toLocaleString("it-IT")} (per esempio 150).` };
    }
    valori.push({ chiave: chiaveSurplusPianoLavoro(piano), valore: String(centesimi) });
  }
  if (!(await salva(valori, sessione.userId))) return { errore: "Salvataggio non riuscito." };

  ricarica();
  return { ok: true, avviso: "Supplementi salvati. Ora premi «Allinea i prezzi su Stripe» per applicarli ai nuovi abbonamenti (chi è già abbonato resta al suo prezzo)." };
}

// Crea (o aggiorna) su Stripe i prezzi dell'abbonamento con il piano di lavoro: listino + supplemento, uno per piano.
export async function allineaPrezziStripePianoLavoro(): Promise<StatoPianoLavoro> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  if (modalitaChiaveStripe(process.env.STRIPE_SECRET_KEY_OMNIA_AI) === "sconosciuta") return { errore: "La chiave Stripe di OMNIA AI manca o non è riconosciuta: nessun prezzo toccato." };

  const dati = await leggiPianoLavoroConsole();
  const esito = await allineaPrezziPianoLavoro(
    createStripeClient("omnia-ai"),
    dati.piani.map((p) => ({ piano: p.slug, nome: p.nome, importoCentesimi: p.attesoCentesimi })),
  );
  if (esito.errore) return { errore: esito.errore };

  ricarica();
  const parti = [
    esito.creati.length > 0 ? `creati: ${esito.creati.join(", ")}` : "",
    esito.aggiornati.length > 0 ? `aggiornati: ${esito.aggiornati.join(", ")}` : "",
    esito.invariati.length > 0 ? `già allineati: ${esito.invariati.join(", ")}` : "",
  ].filter(Boolean);
  return { ok: true, avviso: `Prezzi su Stripe — ${parti.join("; ")}.` };
}

// Accende o spegne la vendita del piano di lavoro (acquisto della singola gara e opzione nell'abbonamento). Si accende solo se i prezzi
// dell'abbonamento con il piano di lavoro sono allineati su Stripe (stessa regola della pagina, ricalcolata qui). Si spegne sempre.
export async function impostaVenditaPianoLavoro(_stato: StatoPianoLavoro, formData: FormData): Promise<StatoPianoLavoro> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const azione = String(formData.get("azione") ?? "");
  if (azione !== "attiva" && azione !== "sospendi") return { errore: "Azione non valida." };

  if (azione === "attiva") {
    if (modalitaChiaveStripe(process.env.STRIPE_SECRET_KEY_OMNIA_AI) === "sconosciuta") return { errore: "Non posso accendere la vendita: la chiave Stripe di OMNIA AI manca o non è riconosciuta." };
    const dati = await leggiPianoLavoroConsole();
    const nonAllineati = dati.piani.filter((p) => p.stripe.stato !== "allineato");
    if (nonAllineati.length > 0) {
      return { errore: `Non posso accendere la vendita: i prezzi Stripe con il piano di lavoro non sono allineati (${nonAllineati.map((p) => p.nome).join(", ")}). Premi «Allinea i prezzi su Stripe».` };
    }
    if (!dati.concessioniDisponibili) return { errore: "Non posso accendere la vendita: manca la migrazione 0101 (abbonamento con piano di lavoro e concessioni)." };
  }

  if (!(await salva([{ chiave: CHIAVE_VENDITA_PIANO_LAVORO, valore: azione === "attiva" ? "1" : "0" }], sessione.userId))) return { errore: "Salvataggio non riuscito." };

  ricarica();
  return {
    ok: true,
    avviso:
      azione === "attiva"
        ? "Vendita accesa: l'acquisto del piano di lavoro di una gara e l'opzione nell'abbonamento sono visibili ai clienti (solo con la chiave Stripe reale)."
        : "Vendita sospesa: l'acquisto e l'opzione non sono più visibili. Chi ha già pagato mantiene il suo diritto.",
  };
}

// Che cosa fa il piano di lavoro per chi è in prova.
export async function impostaPoliticaProvaPianoLavoro(_stato: StatoPianoLavoro, formData: FormData): Promise<StatoPianoLavoro> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const politica = String(formData.get("politica") ?? "");
  if (!(POLITICHE_PROVA as string[]).includes(politica)) return { errore: "Scelta non valida." };
  if (!(await salva([{ chiave: CHIAVE_POLITICA_PROVA, valore: politica }], sessione.userId))) return { errore: "Salvataggio non riuscito." };

  ricarica();
  return { ok: true };
}

// Concede gratis il piano di lavoro a un cliente: per tutte le sue gare (con un numero massimo e/o una scadenza facoltativi) oppure per una gara.
export async function creaConcessionePianoLavoro(_stato: StatoPianoLavoro, formData: FormData): Promise<StatoPianoLavoro> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const esito = validaNuovaConcessione(
    {
      tipo: String(formData.get("tipo") ?? ""),
      garaId: String(formData.get("garaId") ?? ""),
      gareMassime: String(formData.get("gareMassime") ?? ""),
      scadeIl: String(formData.get("scadeIl") ?? ""),
      motivo: String(formData.get("motivo") ?? ""),
    },
    giornoRoma(new Date()),
  );
  if (!esito.ok) return { errore: esito.errore };
  const v = esito.valori;

  // Il cliente si rilegge QUI dall'email (mai da un identificativo arrivato dal browser) e dev'essere un titolare.
  const ricerca = await cercaClientePerConcessione(String(formData.get("email") ?? ""));
  if (ricerca.stato === "errore") return { errore: "Ricerca del cliente non riuscita: riprova." };
  if (ricerca.stato === "ufficio_gare") return { errore: "Questo indirizzo è di un Ufficio Gare: la concessione va data al titolare dell'account." };
  if (ricerca.stato === "non_trovato") return { errore: "Nessun cliente con questo indirizzo email." };
  const cliente = ricerca.cliente;

  let garaTitolo: string | null = null;
  if (v.tipo === "gara") {
    const gara = cliente.gare.find((g) => g.id === v.garaId);
    if (!gara) return { errore: "Questa gara non è di questo cliente." };
    garaTitolo = gara.titolo;
  }

  const { error } = await createAdminClient().from("omnia_ai_piano_lavoro_concessioni").insert({
    user_id: cliente.id,
    tipo: v.tipo,
    gara_id: v.garaId,
    gara_titolo: garaTitolo,
    gare_massime: v.gareMassime,
    scade_il: v.scadeIl,
    motivo: v.motivo,
    creata_da_email: sessione.email,
  });
  if (error) {
    if (schemaAssente(error)) return { errore: "La tabella delle concessioni non esiste ancora (migrazione 0101): nessuna concessione creata." };
    console.error("Console: creazione della concessione fallita", error.message);
    return { errore: "Creazione della concessione non riuscita." };
  }

  ricarica();
  return { ok: true };
}

// Revoca una concessione (non si cancella: resta nella storia). Le generazioni già fatte restano del cliente.
export async function revocaConcessionePianoLavoro(_stato: StatoPianoLavoro, formData: FormData): Promise<StatoPianoLavoro> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const id = String(formData.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { errore: "Concessione non valida." };

  const { data, error } = await createAdminClient()
    .from("omnia_ai_piano_lavoro_concessioni")
    .update({ attiva: false, revocata_il: new Date().toISOString(), revocata_da_email: sessione.email })
    .eq("id", id)
    .eq("attiva", true)
    .select("id");
  if (error) {
    console.error("Console: revoca della concessione fallita", error.message);
    return { errore: "Revoca non riuscita." };
  }
  if ((data ?? []).length === 0) return { errore: "La concessione non esiste o è già revocata." };

  ricarica();
  return { ok: true };
}

