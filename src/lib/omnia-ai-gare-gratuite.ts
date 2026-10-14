import type { SupabaseClient } from "@supabase/supabase-js";

// Gare gratuite di OMNIA AI: le assegna la console a un cliente che non ha mai avuto un
// abbonamento (tabella omnia_ai_gare_gratuite, migrazione 0084). Finché ne ha, il cliente
// lavora come un abbonato; a zero può consultare e scaricare ma non avviare nuove analisi, e
// l'area lo invita ad abbonarsi. Qui i calcoli puri e la lettura; il consumo vero sta in
// gara-consumo.ts; a chi le assegna e le toglie provvede l'amministrazione.

export const MAX_GARE_GRATUITE = 1000;

export type GareGratuite = { assegnate: number; usate: number; rimanenti: number };

export const MESSAGGIO_GARE_GRATUITE_ESAURITE =
  "Hai usato tutte le gare gratuite. Per avviare una nuova analisi scegli un abbonamento dalla pagina «Abbonamento»: nel frattempo puoi consultare le tue gare e scaricare i documenti già generati.";

export function calcolaGareGratuite(riga: { assegnate: number; usate: number } | null | undefined): GareGratuite | null {
  if (!riga) return null;
  const assegnate = Math.max(0, Math.trunc(Number(riga.assegnate)));
  const usate = Math.max(0, Math.trunc(Number(riga.usate)));
  return { assegnate, usate, rimanenti: Math.max(0, assegnate - usate) };
}

// Legge il contatore del cliente. null se non ne ha uno (nessuna gara gratuita mai assegnata)
// o se la tabella non esiste ancora (migrazione 0084 non eseguita): chi chiama si comporta
// come per un cliente senza abbonamento, mai con un errore.
export async function leggiGareGratuite(client: SupabaseClient, userId: string): Promise<GareGratuite | null> {
  const { data, error } = await client.from("omnia_ai_gare_gratuite").select("assegnate, usate").eq("user_id", userId).maybeSingle<{ assegnate: number; usate: number }>();
  if (error) {
    // tabella assente (42P01, PGRST205) è il caso atteso prima della migrazione: nessun rumore
    if (!["42P01", "PGRST205", "PGRST204"].includes(error.code ?? "")) console.error("Gare gratuite: lettura non riuscita", error.code, error.message);
    return null;
  }
  return calcolaGareGratuite(data);
}

// Controllo di una variazione decisa dalla console (positiva = assegna, negativa = toglie).
// Restituisce il nuovo totale di gare assegnate o il messaggio da mostrare.
export function applicaVariazione(attuale: { assegnate: number; usate: number } | null, delta: number): { assegnate: number } | { errore: string } {
  if (!Number.isInteger(delta) || delta === 0) return { errore: "Indica un numero intero di gare, diverso da zero." };
  const assegnate = attuale?.assegnate ?? 0;
  const usate = attuale?.usate ?? 0;
  const nuovo = assegnate + delta;
  if (nuovo > MAX_GARE_GRATUITE) return { errore: `Il totale delle gare gratuite non può superare ${MAX_GARE_GRATUITE}.` };
  if (nuovo < usate) return { errore: `Il cliente ne ha già usate ${usate}: non si può scendere sotto questo numero (al minimo ${usate} assegnate).` };
  return { assegnate: nuovo };
}

// Testo dell'avviso in cima all'area riservata del cliente in prova.
export function testoAvvisoProva(g: GareGratuite): { esaurite: boolean; testo: string } {
  if (g.rimanenti <= 0) {
    return {
      esaurite: true,
      testo: "Hai usato tutte le gare gratuite. Puoi consultare le tue gare e scaricare i documenti già generati, ma per avviare una nuova analisi serve un abbonamento.",
    };
  }
  return {
    esaurite: false,
    testo: `Prova gratuita: ${g.rimanenti === 1 ? "ti resta 1 gara gratuita" : `ti restano ${g.rimanenti} gare gratuite`} su ${g.assegnate}. Una gara si consuma quando parte l'analisi dei documenti.`,
  };
}
