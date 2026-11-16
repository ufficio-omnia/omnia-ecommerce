// Lettura degli interruttori, dei costi e dei limiti di Tender Intelligence (console_impostazioni, chiavi «radar_*») e delle impostazioni
// del singolo cliente (omnia_ai_radar_impostazioni, migrazione 0111). Solo server, con la chiave di servizio, dopo le guardie.
// Qualunque errore o tabella assente = modulo spento (le regole sono in diritto-calcoli.ts).
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { getOmniaAiAccessState } from "@/lib/omnia-ai-access";
import {
  aperturaSviluppoRadar,
  dirittoRadar,
  impostazioniClienteDaRiga,
  parametriDaRighe,
  type DirittoRadar,
  type ImpostazioniClienteRadar,
  type ParametriRadar,
} from "./diritto-calcoli";

export async function leggiParametriRadar(admin: SupabaseClient = createAdminClient()): Promise<ParametriRadar> {
  try {
    const { data, error } = await admin.from("console_impostazioni").select("chiave, valore").like("chiave", "radar_%").returns<{ chiave: string; valore: string }[]>();
    if (error) {
      if (!schemaAssente(error)) console.error("Tender Intelligence: lettura dei parametri non riuscita", error.message);
      return parametriDaRighe(null);
    }
    return parametriDaRighe(data ?? []);
  } catch (e) {
    console.error("Tender Intelligence: lettura dei parametri non riuscita", e);
    return parametriDaRighe(null);
  }
}

export async function leggiImpostazioniClienteRadar(accountId: string, admin: SupabaseClient = createAdminClient()): Promise<ImpostazioniClienteRadar | null> {
  try {
    const { data, error } = await admin.from("omnia_ai_radar_impostazioni").select("attivo, limiti").eq("user_id", accountId).maybeSingle<{ attivo: boolean | null; limiti: unknown }>();
    if (error) {
      if (!schemaAssente(error)) console.error("Tender Intelligence: lettura delle impostazioni del cliente non riuscita", error.message);
      return null;
    }
    return impostazioniClienteDaRiga(data);
  } catch (e) {
    console.error("Tender Intelligence: lettura delle impostazioni del cliente non riuscita", e);
    return null;
  }
}

// Il diritto dell'account effettivo (titolare o Ufficio Gare: vale quello del titolare). Lo stato dell'abbonamento si legge con la chiave di
// servizio, filtrando SEMPRE per l'identificativo del titolare risolto dal server.
export async function leggiDirittoRadar(accountId: string): Promise<DirittoRadar> {
  const admin = createAdminClient();
  const [parametri, cliente, stato] = await Promise.all([leggiParametriRadar(admin), leggiImpostazioniClienteRadar(accountId, admin), getOmniaAiAccessState(accountId, admin)]);
  return dirittoRadar({ parametri, cliente, statoAccesso: stato.stato, aperturaSviluppo: aperturaSviluppoRadar(process.env) });
}
