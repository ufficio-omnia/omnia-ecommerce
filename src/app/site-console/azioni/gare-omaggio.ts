"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { richiediAdminAzione } from "@/lib/console/accesso";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { giornoRoma } from "@/lib/omnia-ai-catalogo-calcoli";
import { validaNuovoOmaggio } from "@/lib/omnia-ai-gare-omaggio-calcoli";
import { MESSAGGIO_CONTROLLO_UFFICIO_GARE_NON_RIUSCITO, MESSAGGIO_E_UN_UFFICIO_GARE, leggiTitolareDelMembro } from "@/lib/console/ufficio-gare";
import type { StatoAzione } from "./ordini";

// Gare in omaggio (migrazione 0131): gare in più rispetto al piano, per un periodo, regalate a un cliente.
// Ogni azione parte da richiediAdminAzione(). Un omaggio non si modifica: si revoca e se ne crea un altro.
// Le gare già avviate grazie a un omaggio restano del cliente anche dopo la revoca.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MESSAGGIO_MIGRAZIONE = "La tabella delle gare in omaggio non esiste ancora (migrazione 0131): nessun omaggio registrato.";

export type StatoOmaggioAzione = { errore?: string; ok?: boolean };

export async function regalaGareOmaggio(_stato: StatoOmaggioAzione, formData: FormData): Promise<StatoOmaggioAzione> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const userId = String(formData.get("userId") ?? "");
  if (!UUID.test(userId)) return { errore: "Utente non valido." };

  const esito = validaNuovoOmaggio(
    { gare: String(formData.get("gare") ?? ""), dal: String(formData.get("dal") ?? ""), al: String(formData.get("al") ?? ""), motivo: String(formData.get("motivo") ?? "") },
    giornoRoma(new Date()),
  );
  if (!esito.ok) return { errore: esito.errore };

  const admin = createAdminClient();
  const { data: utente } = await admin.from("users").select("id, role").eq("id", userId).maybeSingle<{ id: string; role: string }>();
  if (!utente) return { errore: "Utente non trovato." };
  if (utente.role !== "cliente") return { errore: "Le gare in omaggio sono solo per i clienti." };

  // Un Ufficio Gare lavora con le gare del titolare: l'omaggio si fa al titolare, non a lui.
  const titolareDelMembro = await leggiTitolareDelMembro(userId, admin);
  if (titolareDelMembro === "errore") return { errore: MESSAGGIO_CONTROLLO_UFFICIO_GARE_NON_RIUSCITO };
  if (titolareDelMembro) return { errore: MESSAGGIO_E_UN_UFFICIO_GARE };

  const v = esito.valori;
  const { error } = await admin.from("omnia_ai_gare_omaggio").insert({ user_id: userId, gare: v.gare, dal: v.dal, al: v.al, motivo: v.motivo, creato_da_email: sessione.email });
  if (error) {
    if (schemaAssente(error)) return { errore: MESSAGGIO_MIGRAZIONE };
    console.error("Console: registrazione gare in omaggio fallita", error.message);
    return { errore: "Registrazione dell'omaggio non riuscita." };
  }

  revalidatePath("/site-console", "layout");
  return { ok: true };
}

// Revoca un omaggio non ancora concluso: da subito non vale più (le gare già avviate restano).
export async function revocaGareOmaggio(_stato: StatoAzione, formData: FormData): Promise<StatoAzione> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const id = String(formData.get("id") ?? "");
  if (!UUID.test(id)) return { errore: "Omaggio non valido." };

  const { data, error } = await createAdminClient()
    .from("omnia_ai_gare_omaggio")
    .update({ revocato_il: new Date().toISOString(), revocato_da_email: sessione.email })
    .eq("id", id)
    .is("revocato_il", null)
    .gte("al", giornoRoma(new Date()))
    .select("id");
  if (error) {
    console.error("Console: revoca gare in omaggio fallita", error.message);
    return { errore: "Revoca non riuscita." };
  }
  if (!data || data.length === 0) return { errore: "L'omaggio è già concluso o revocato." };

  revalidatePath("/site-console", "layout");
  return {};
}
