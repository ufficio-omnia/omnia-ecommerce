// Fonti importate ma NON ancora mostrabili ai clienti (radar_fonti_stato.nascosta_ai_clienti, migrazione 0120): oggi SardegnaCAT, finché manca
// il parere legale sulla licenza del feed (controllo di accettazione 6 dell'utente). Si legge con la cache dei dati di Next (5 minuti), come
// la voce «Opportunità» del menu; la console la svuota subito a ogni modifica (TAG_FONTI_RADAR). Qualunque errore = si nascondono le fonti
// che per default non sono autorizzate (prudenza: mai mostrare una fonte non autorizzata).
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { FONTI_UNITE, type FonteUnita } from "./unione-calcoli";

export const TAG_FONTI_RADAR = "radar-fonti";

// Le fonti che, senza un'indicazione esplicita dal database, restano nascoste.
export const FONTI_NASCOSTE_PREDEFINITE: readonly FonteUnita[] = ["sardegnacat"];

export const fontiNascosteAiClienti = unstable_cache(
  async (): Promise<string[]> => {
    try {
      const { data, error } = await createAdminClient().from("radar_fonti_stato").select("fonte, nascosta_ai_clienti").returns<{ fonte: string; nascosta_ai_clienti: boolean }[]>();
      if (error) return [...FONTI_NASCOSTE_PREDEFINITE];
      const indicate = new Map((data ?? []).map((r) => [r.fonte, r.nascosta_ai_clienti]));
      // una fonte senza riga resta nascosta se lo è per default
      return FONTI_UNITE.filter((f) => indicate.get(f) ?? FONTI_NASCOSTE_PREDEFINITE.includes(f));
    } catch {
      return [...FONTI_NASCOSTE_PREDEFINITE];
    }
  },
  ["radar-fonti-nascoste"],
  { tags: [TAG_FONTI_RADAR], revalidate: 300 },
);

// Le fonti visibili, per il filtro della ricerca (radar_procedure.fonti deve averne almeno una).
export function fontiVisibiliDa(nascoste: readonly string[]): FonteUnita[] {
  return FONTI_UNITE.filter((f) => !nascoste.includes(f));
}
