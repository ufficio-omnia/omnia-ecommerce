// La voce «Opportunità» nel menu dell'area riservata: si vede solo con l'interruttore generale acceso E quello del cliente acceso
// (o, in sviluppo locale, con OMNIA_AI_RADAR_APERTO=1). Il layout la chiede a OGNI pagina: per non aggiungere letture al database, i due
// interruttori si leggono con la cache dei dati di Next (unstable_cache, 5 minuti) e la console la svuota subito a ogni modifica
// (TAG_PARAMETRI_RADAR, TAG_CLIENTI_RADAR). A modulo spento, in produzione, la lettura per pagina è zero (si legge al più ogni 5 minuti).
// Qualunque errore = voce nascosta. Il controllo vero resta nelle pagine e nelle azioni (leggiDirittoRadar).
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { aperturaSviluppoRadar, CHIAVE_RADAR_ATTIVO, interpretaInterruttore } from "./diritto-calcoli";

export const TAG_PARAMETRI_RADAR = "radar-parametri";
export const TAG_CLIENTI_RADAR = "radar-clienti";

const attivoGenerale = unstable_cache(
  async (): Promise<boolean> => {
    try {
      const { data, error } = await createAdminClient().from("console_impostazioni").select("valore").eq("chiave", CHIAVE_RADAR_ATTIVO).maybeSingle<{ valore: string }>();
      return !error && interpretaInterruttore(data?.valore);
    } catch {
      return false;
    }
  },
  ["radar-attivo-generale"],
  { tags: [TAG_PARAMETRI_RADAR], revalidate: 300 },
);

const attivoCliente = unstable_cache(
  async (accountId: string): Promise<boolean> => {
    try {
      const { data, error } = await createAdminClient().from("omnia_ai_radar_impostazioni").select("attivo").eq("user_id", accountId).maybeSingle<{ attivo: boolean }>();
      return !error && data?.attivo === true;
    } catch {
      return false;
    }
  },
  ["radar-attivo-cliente"],
  { tags: [TAG_CLIENTI_RADAR], revalidate: 300 },
);

export async function radarNelMenu(accountId: string): Promise<boolean> {
  if (aperturaSviluppoRadar(process.env)) return true;
  if (!(await attivoGenerale())) return false;
  return attivoCliente(accountId);
}
