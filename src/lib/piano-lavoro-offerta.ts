import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { PIANI_ORDINE, type PianoSlug } from "@/lib/omnia-ai-plans";
import { getCatalogoPiani } from "@/lib/omnia-ai-catalogo";
import { venditaPianoLavoroAttiva } from "@/lib/piano-lavoro-acquisto";
import { ABBONAMENTO_PIANO_LAVORO_OFFERTO } from "@/lib/piano-lavoro-testi";
import { chiaveSurplusPianoLavoro, prezzoConPianoLavoro, surplusDaImpostazioni } from "@/lib/piano-lavoro-offerta-calcoli";

// L'abbonamento con il piano di lavoro: letture (lato server) del supplemento mensile e dei prezzi che il cliente vede. Come per il catalogo
// dei piani, tutto ciò che si mostra passa da qui, così sito pubblico, pagina di acquisto e area riservata dicono la stessa cosa. Senza la
// tabella delle impostazioni o con un errore di lettura valgono i supplementi del codice: mai una pagina rotta.

export async function leggiSurplusPianoLavoro(client?: SupabaseClient): Promise<Record<PianoSlug, number>> {
  try {
    const db = client ?? createAdminClient();
    const { data, error } = await db
      .from("console_impostazioni")
      .select("chiave, valore")
      .in("chiave", PIANI_ORDINE.map(chiaveSurplusPianoLavoro))
      .returns<{ chiave: string; valore: string }[]>();
    return surplusDaImpostazioni(error ? [] : (data ?? []));
  } catch {
    return surplusDaImpostazioni([]);
  }
}

// L'opzione «piano di lavoro» DENTRO L'ABBONAMENTO si offre? No, finché ABBONAMENTO_PIANO_LAVORO_OFFERTO è spento (decisione del 09/11/2026: il piano
// di lavoro si compra solo dentro la singola gara). Se un domani si riaccende, resta la regola di prima: interruttore della console + chiave Stripe
// reale (o prova in locale). È QUI il punto unico che pagine di acquisto, moduli di cambio piano e azioni sul server usano per l'abbonamento; l'acquisto
// della singola gara usa invece venditaPianoLavoroAttiva e non ne è toccato.
export async function venditaAbbonamentoPianoLavoroAttiva(client?: SupabaseClient): Promise<boolean> {
  if (!ABBONAMENTO_PIANO_LAVORO_OFFERTO) return false;
  return venditaPianoLavoroAttiva(client);
}

// I supplementi da mostrare nei moduli di acquisto, o null se l'opzione non è in vendita nell'abbonamento: il checkout lo riverifica comunque.
export async function surplusSeInVendita(client?: SupabaseClient): Promise<Record<PianoSlug, number> | null> {
  const db = client ?? createAdminClient();
  return (await venditaAbbonamentoPianoLavoroAttiva(db)) ? await leggiSurplusPianoLavoro(db) : null;
}

export type OffertaConPianoLavoro = {
  piano: PianoSlug;
  surplusCentesimi: number;
  // quello che si paga oggi (il prezzo del piano, con lo sconto in corso se c'è) + il supplemento
  prezzoCentesimi: number;
  // il prezzo di listino del piano + il supplemento: è l'importo del prezzo Stripe dell'offerta (gli sconti sono coupon a parte)
  listinoCentesimi: number;
};

export async function getOffertePianoLavoro(client?: SupabaseClient): Promise<Record<PianoSlug, OffertaConPianoLavoro>> {
  const [catalogo, surplus] = await Promise.all([getCatalogoPiani(), leggiSurplusPianoLavoro(client)]);
  return Object.fromEntries(
    PIANI_ORDINE.map((piano) => [
      piano,
      {
        piano,
        surplusCentesimi: surplus[piano],
        prezzoCentesimi: prezzoConPianoLavoro(catalogo[piano].prezzoCentesimi, surplus[piano]),
        listinoCentesimi: prezzoConPianoLavoro(catalogo[piano].prezzoListinoCentesimi, surplus[piano]),
      },
    ]),
  ) as Record<PianoSlug, OffertaConPianoLavoro>;
}
