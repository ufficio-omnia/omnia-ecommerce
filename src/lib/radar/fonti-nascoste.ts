// Fonti importate ma NON mostrate ai clienti (radar_fonti_stato.nascosta_ai_clienti, migrazione 0120): solo quelle che la console nasconde.
// Di base nessuna: la PVL è visibile (direttiva 48A, revoca della 7.14) e SardegnaCAT anche, senza aspettare il parere legale (48E, D4-bis).
// Si legge con la cache dei dati di Next (5 minuti), come la voce «Opportunità» del menu; la console la svuota subito a ogni modifica (TAG_FONTI_RADAR).
// Qualunque errore = le fonti nascoste di base (FONTI_NASCOSTE_PREDEFINITE, oggi nessuna).
// La regola (riga del database, altrimenti la predefinita) è UNA sola, pura, condivisa col motore delle notifiche: fonti-gara-calcoli.ts.
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { FONTI_NASCOSTE_PREDEFINITE, fontiNascosteDa } from "./fonti-gara-calcoli";
import { FONTI_UNITE, type FonteUnita } from "./unione-calcoli";

export const TAG_FONTI_RADAR = "radar-fonti";

// Le fonti che, senza un'indicazione esplicita dal database, restano nascoste (definite in fonti-gara-calcoli.ts).
export { FONTI_NASCOSTE_PREDEFINITE };

export const fontiNascosteAiClienti = unstable_cache(
  async (): Promise<string[]> => {
    try {
      const { data, error } = await createAdminClient().from("radar_fonti_stato").select("fonte, nascosta_ai_clienti").returns<{ fonte: string; nascosta_ai_clienti: boolean }[]>();
      if (error) return [...FONTI_NASCOSTE_PREDEFINITE];
      // una fonte senza riga resta nascosta se lo è per default
      return fontiNascosteDa(data ?? []);
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
