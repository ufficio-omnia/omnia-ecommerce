"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { richiediAdminAzione } from "@/lib/console/accesso";
import { getCatalogoPiani } from "@/lib/omnia-ai-catalogo";
import { getOmniaAiAccessState } from "@/lib/omnia-ai-access";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { validaNuovaOffertaPilot } from "@/lib/omnia-ai-pilot-calcoli";
import { PIANI_ORDINE, type PianoSlug } from "@/lib/omnia-ai-plans";
import type { StatoAzione } from "./ordini";

// Offerta pilot (migrazione 0086): un prezzo dedicato, per N mesi, a un cliente CREATO DALLA CONSOLE.
// Il cliente la vede solo nella sua area riservata, che lo porta al pagamento su Stripe. Ogni azione
// parte da richiediAdminAzione(). Un'offerta acquistata non si modifica né si revoca (il prezzo è già
// su Stripe); quella ancora aperta si revoca o si sostituisce con una nuova.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type StatoOffertaPilotAzione = { errore?: string; ok?: boolean };

export async function creaOffertaPilot(_stato: StatoOffertaPilotAzione, formData: FormData): Promise<StatoOffertaPilotAzione> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const userId = String(formData.get("userId") ?? "");
  if (!UUID.test(userId)) return { errore: "Utente non valido." };

  const admin = createAdminClient();

  const { data: utente } = await admin.from("users").select("id, role").eq("id", userId).maybeSingle<{ id: string; role: string }>();
  if (!utente) return { errore: "Utente non trovato." };
  if (utente.role !== "cliente") return { errore: "L'offerta pilot è solo per i clienti." };

  // Solo un cliente creato dalla console: è la regola dell'offerta, e la tabella la fa rispettare anche a livello di database.
  const { data: creato, error: erroreCreato } = await admin.from("omnia_ai_utenti_console").select("user_id").eq("user_id", userId).maybeSingle<{ user_id: string }>();
  if (erroreCreato) {
    if (schemaAssente(erroreCreato)) return { errore: "Le tabelle degli utenti creati dalla console non esistono ancora (migrazione 0084)." };
    console.error("Console: lettura utente da console fallita", erroreCreato.message);
    return { errore: "Lettura non riuscita." };
  }
  if (!creato) return { errore: "L'offerta pilot è solo per i clienti creati dalla console." };

  // Chi è già abbonato non ha niente da acquistare: l'offerta non servirebbe a nessuno.
  const accesso = await getOmniaAiAccessState(userId, admin);
  if (accesso.stato === "attivo") return { errore: "Il cliente ha già un abbonamento attivo: l'offerta pilot serve a chi deve ancora abbonarsi." };

  const catalogo = await getCatalogoPiani();
  const listini = Object.fromEntries(PIANI_ORDINE.map((p) => [p, catalogo[p].prezzoListinoCentesimi])) as Record<PianoSlug, number>;

  const esito = validaNuovaOffertaPilot({ piano: String(formData.get("piano") ?? ""), prezzo: String(formData.get("prezzo") ?? ""), mesi: String(formData.get("mesi") ?? "") }, listini);
  if (!esito.ok) return { errore: esito.errore };
  const v = esito.valori;

  // Un'offerta aperta alla volta: la nuova sostituisce quella ancora non acquistata.
  const { error: erroreRevoca } = await admin.from("omnia_ai_offerte_pilot").update({ attiva: false }).eq("user_id", userId).eq("attiva", true).is("acquistata_il", null);
  if (erroreRevoca) {
    if (schemaAssente(erroreRevoca)) return { errore: "La tabella delle offerte pilot non esiste ancora (migrazione 0086): nessuna offerta creata." };
    console.error("Console: revoca dell'offerta precedente fallita", erroreRevoca.message);
    return { errore: "Non sono riuscito a sostituire l'offerta precedente: nessuna offerta creata." };
  }

  const { error } = await admin.from("omnia_ai_offerte_pilot").insert({ user_id: userId, piano: v.piano, prezzo_centesimi: v.prezzoCentesimi, mesi: v.mesi, attiva: true, creata_da_email: sessione.email });
  if (error) {
    console.error("Console: creazione dell'offerta pilot fallita", error.message);
    return { errore: "Creazione dell'offerta non riuscita." };
  }

  revalidatePath("/site-console", "layout");
  return { ok: true };
}

// Revoca un'offerta ancora aperta: il cliente non la vede più. Una già acquistata non si tocca.
export async function revocaOffertaPilot(_stato: StatoAzione, formData: FormData): Promise<StatoAzione> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const id = String(formData.get("id") ?? "");
  if (!UUID.test(id)) return { errore: "Offerta non valida." };

  const { data, error } = await createAdminClient().from("omnia_ai_offerte_pilot").update({ attiva: false }).eq("id", id).eq("attiva", true).is("acquistata_il", null).select("id");
  if (error) {
    console.error("Console: revoca dell'offerta pilot fallita", error.message);
    return { errore: "Revoca non riuscita." };
  }
  if (!data || data.length === 0) return { errore: "L'offerta non è più aperta (acquistata o già revocata)." };

  revalidatePath("/site-console", "layout");
  return {};
}
