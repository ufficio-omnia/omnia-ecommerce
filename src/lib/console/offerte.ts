import { createAdminClient } from "@/lib/supabase/admin";
import { giornoRoma } from "@/lib/omnia-ai-catalogo-calcoli";
import { leggiOfferteConsole } from "@/lib/pacchetti-servizi";
import { daRigaConsole, type OffertaDedicataConsole } from "./offerte-calcoli";

// Lettura delle offerte dedicate per la console (pagina «Piano di lavoro e pacchetti» e scheda cliente). Tutto con la chiave di servizio: da chiamare
// solo dopo richiediAdminPagina() / richiediAdminAzione(). Senza la migrazione 0105 `disponibile` è false e l'elenco è vuoto: nessun errore.

export type OfferteDedicateConsole = { disponibile: boolean; elenco: OffertaDedicataConsole[] };

export async function leggiOfferteDedicateConsole(opzioni: { perUtente?: string; limite?: number } = {}): Promise<OfferteDedicateConsole> {
  const { disponibile, offerte } = await leggiOfferteConsole(createAdminClient(), opzioni);
  const oggi = giornoRoma(new Date());
  return { disponibile, elenco: offerte.map((o) => daRigaConsole(o, oggi)) };
}
