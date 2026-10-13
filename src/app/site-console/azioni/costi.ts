"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { richiediAdminAzione } from "@/lib/console/accesso";

export type StatoSalvataggio = { ok?: boolean; errore?: string };

const CAMBIO_MINIMO = 0.2;
const CAMBIO_MASSIMO = 5;
const IVA_MASSIMA = 30;

// "0,92" e "0.92" valgono lo stesso: l'admin scrive all'italiana.
function numeroDaTesto(testo: FormDataEntryValue | null): number {
  return Number(String(testo ?? "").trim().replace(",", "."));
}

// Parametri con cui la console converte i costi in euro e toglie l'IVA dai
// ricavi. Controllati qui perché un cambio sbagliato falserebbe ogni margine
// senza che nulla se ne accorga.
export async function salvaParametri(_stato: StatoSalvataggio, formData: FormData): Promise<StatoSalvataggio> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const cambio = numeroDaTesto(formData.get("cambio"));
  const iva = numeroDaTesto(formData.get("iva"));

  if (!Number.isFinite(cambio) || cambio < CAMBIO_MINIMO || cambio > CAMBIO_MASSIMO) {
    return { errore: `Il cambio deve essere un numero tra ${CAMBIO_MINIMO} e ${CAMBIO_MASSIMO} euro per un dollaro (es. 0,92).` };
  }
  if (!Number.isFinite(iva) || iva < 0 || iva > IVA_MASSIMA) {
    return { errore: `L'aliquota IVA deve essere un numero tra 0 e ${IVA_MASSIMA} (es. 22).` };
  }

  const { error } = await createAdminClient()
    .from("console_impostazioni")
    .upsert(
      [
        { chiave: "cambio_usd_eur", valore: String(cambio), aggiornato_il: new Date().toISOString(), aggiornato_da: sessione.userId },
        { chiave: "aliquota_iva", valore: String(iva), aggiornato_il: new Date().toISOString(), aggiornato_da: sessione.userId },
      ],
      { onConflict: "chiave" },
    );

  if (error) {
    console.error("Console: salvataggio parametri fallito", error.message);
    return { errore: "Salvataggio non riuscito: la migrazione 0077 è stata eseguita?" };
  }

  revalidatePath("/site-console", "layout");
  return { ok: true };
}
