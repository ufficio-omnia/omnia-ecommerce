"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { richiediAdminAzione } from "@/lib/console/accesso";
import { erroreIban } from "@/lib/console/iban";

// Dati bancari per il bonifico (spostati dal vecchio pannello admin dell'e-commerce).
// Cambio e IVA si salvano con salvaParametri (azioni/costi.ts), la stessa azione
// della pagina Costi.

export type StatoImpostazioni = { errore?: string; ok?: boolean };

const LUNGHEZZA_INTESTATARIO = 120;

// L'IBAN si salva come l'ha scritto l'admin (con o senza spazi), ripulito da spazi
// doppi e in maiuscolo: è ciò che i clienti vedranno, e la forma raggruppata è la più
// leggibile. Il controllo però si fa sul valore normalizzato.
function ibanDaSalvare(valore: string): string {
  return valore.trim().replace(/\s+/g, " ").toUpperCase();
}

export async function salvaDatiBancari(_stato: StatoImpostazioni, formData: FormData): Promise<StatoImpostazioni> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const iban = ibanDaSalvare(String(formData.get("iban") ?? ""));
  const intestatario = String(formData.get("intestatario") ?? "").trim().replace(/\s+/g, " ");

  const problema = erroreIban(iban);
  if (problema) return { errore: problema };
  if (intestatario.length < 2) return { errore: "Scrivi l'intestatario del conto." };
  if (intestatario.length > LUNGHEZZA_INTESTATARIO) return { errore: `L'intestatario è troppo lungo (massimo ${LUNGHEZZA_INTESTATARIO} caratteri).` };

  // La riga è una sola (id = 1, vincolo della tabella). Se l'aggiornamento non ne
  // tocca nessuna non si dice «salvato»: la riga manca e i clienti vedrebbero i dati vecchi.
  const { data, error } = await createAdminClient()
    .from("bank_settings")
    .update({ iban, intestatario, updated_at: new Date().toISOString() })
    .eq("id", 1)
    .select("id");
  if (error) {
    console.error("Console: salvataggio dei dati bancari fallito", error.message);
    return { errore: "Salvataggio non riuscito." };
  }
  if (!data || data.length === 0) return { errore: "La riga dei dati bancari non esiste nel database (migrazione 0029): nulla è stato salvato." };

  revalidatePath("/site-console", "layout");
  // l'area riservata del cliente mostra questi dati a chi paga con bonifico
  revalidatePath("/dashboard");
  return { ok: true };
}
