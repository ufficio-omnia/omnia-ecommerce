import type { SupabaseClient } from "@supabase/supabase-js";
import { acquisisciBlocco, rilasciaBlocco } from "@/lib/demo-blocco";
import { sincronizzaCalendario, type RisultatoSync } from "@/lib/demo-calendario-sync";
import { inviaConversioniGa4, type RisultatoGa4 } from "@/lib/demo-ga4";
import { inviaConversioniAds, type RisultatoAds } from "@/lib/demo-ads-data-manager";

// Un giro completo del cron «omnia-ai-demo-sync» (ogni 10 minuti): sincronizzazione del calendario, evento GA4, conversione Google Ads.
// Tre passi INDIPENDENTI (un errore in uno non ferma gli altri), tutti spenti finché non si impostano le variabili e i flag descritti in
// GUIDA-DEMO-TRACCIAMENTO.md. L'intero giro avviene sotto un BLOCCO (demo-blocco.ts): due esecuzioni insieme non si sovrappongono.
// Il risultato contiene SOLO numeri e motivi, mai dati delle persone.

type ErroreCalendario = { eseguita: false; motivo: "errore_imprevisto" };
type ErroreInvio = { abilitato: false; motivo: "errore_imprevisto" };

export type RisultatoCiclo =
  | { eseguito: false; motivo: "tutto_spento" | "occupato" | "schema_assente" }
  | { eseguito: true; calendario: RisultatoSync | ErroreCalendario; ga4: RisultatoGa4 | ErroreInvio; ads: RisultatoAds | ErroreInvio };

export async function eseguiCicloDemo(admin: SupabaseClient, env: Record<string, string | undefined>, adessoMs: number, fetchFn: typeof fetch = fetch): Promise<RisultatoCiclo> {
  const qualcosaAcceso = env.DEMO_CALENDAR_SYNC_ENABLED === "1" || env.DEMO_GA4_MP_ENABLED === "1" || env.DEMO_ADS_IMPORT_ENABLED === "1";
  if (!qualcosaAcceso) return { eseguito: false, motivo: "tutto_spento" };

  const blocco = await acquisisciBlocco(admin, adessoMs);
  if (blocco === "occupato") return { eseguito: false, motivo: "occupato" };
  if (blocco === "non_disponibile") return { eseguito: false, motivo: "schema_assente" };

  try {
    let calendario: RisultatoSync | ErroreCalendario;
    try {
      calendario = await sincronizzaCalendario(admin, env, adessoMs, fetchFn);
    } catch {
      calendario = { eseguita: false, motivo: "errore_imprevisto" };
    }
    let ga4: RisultatoGa4 | ErroreInvio;
    try {
      ga4 = await inviaConversioniGa4(admin, env, adessoMs, fetchFn);
    } catch {
      ga4 = { abilitato: false, motivo: "errore_imprevisto" };
    }
    let ads: RisultatoAds | ErroreInvio;
    try {
      ads = await inviaConversioniAds(admin, env, adessoMs, fetchFn);
    } catch {
      ads = { abilitato: false, motivo: "errore_imprevisto" };
    }
    return { eseguito: true, calendario, ga4, ads };
  } finally {
    await rilasciaBlocco(admin);
  }
}
