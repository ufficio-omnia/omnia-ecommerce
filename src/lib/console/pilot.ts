import { createAdminClient } from "@/lib/supabase/admin";
import { getCatalogoPiani } from "@/lib/omnia-ai-catalogo";
import { COLONNE_OFFERTA_PILOT, offertaDaRiga } from "@/lib/omnia-ai-pilot";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import type { OffertaPilot } from "@/lib/omnia-ai-pilot-calcoli";
import { PIANI_ORDINE, type PianoSlug } from "@/lib/omnia-ai-plans";

// Letture per il riquadro «Offerta pilot» della scheda cliente (migrazione 0086): le offerte del
// cliente (la più recente prima) e il listino di oggi di ogni piano, per confrontare il prezzo
// dedicato. Prima della migrazione la tabella non c'è: `disponibile: false`.

export type PilotCliente = {
  disponibile: boolean;
  offerte: OffertaPilot[];
  listini: Record<PianoSlug, number>;
  nomi: Record<PianoSlug, string>;
};

export async function leggiPilotCliente(userId: string): Promise<PilotCliente> {
  const catalogo = await getCatalogoPiani();
  const listini = Object.fromEntries(PIANI_ORDINE.map((p) => [p, catalogo[p].prezzoListinoCentesimi])) as Record<PianoSlug, number>;
  const nomi = Object.fromEntries(PIANI_ORDINE.map((p) => [p, catalogo[p].nome])) as Record<PianoSlug, string>;

  const { data, error } = await createAdminClient()
    .from("omnia_ai_offerte_pilot")
    .select(COLONNE_OFFERTA_PILOT)
    .eq("user_id", userId)
    .order("creata_il", { ascending: false })
    .limit(10)
    .returns<Parameters<typeof offertaDaRiga>[0][]>();

  if (error) {
    if (!schemaAssente(error)) console.error("Console: lettura delle offerte pilot fallita", error.message);
    return { disponibile: false, offerte: [], listini, nomi };
  }
  return { disponibile: true, offerte: (data ?? []).flatMap((r) => offertaDaRiga(r) ?? []), listini, nomi };
}
