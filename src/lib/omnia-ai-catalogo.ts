import { createAdminClient } from "@/lib/supabase/admin";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { PIANI_ORDINE, type PianoSlug } from "@/lib/omnia-ai-plans";
import { costruisciCatalogo, giornoRoma, type Catalogo, type Sconto } from "@/lib/omnia-ai-catalogo-calcoli";

// Lettura del catalogo piani dal database (migrazione 0085): prezzi di listino modificati dalla
// console e sconti. Tutto ciò che il cliente vede dei prezzi passa da qui, così sito pubblico,
// pagina di acquisto e area riservata dicono sempre la stessa cosa. Senza le tabelle (migrazione
// non eseguita) o con un errore di lettura valgono i prezzi del codice: mai una pagina rotta.
// Si legge con la chiave di servizio dal server; nessun dato di queste tabelle arriva al browser
// se non quello già calcolato e destinato a essere mostrato.

type RigaSconto = {
  id: string;
  nome: string;
  piano: string | null;
  tipo: string;
  percentuale: number | null;
  prezzo_scontato_centesimi: number | null;
  valido_dal: string;
  valido_al: string | null;
  durata_mesi: number;
  attivo: boolean;
};

export function scontoDaRiga(r: RigaSconto): Sconto | null {
  const piano = r.piano === null ? null : PIANI_ORDINE.includes(r.piano as PianoSlug) ? (r.piano as PianoSlug) : undefined;
  if (piano === undefined || (r.tipo !== "percentuale" && r.tipo !== "prezzo")) {
    console.error("Catalogo: sconto con dati non riconosciuti, ignorato", r.id);
    return null;
  }
  return {
    id: r.id,
    nome: r.nome,
    piano,
    tipo: r.tipo,
    percentuale: r.percentuale,
    prezzoScontatoCentesimi: r.prezzo_scontato_centesimi,
    validoDal: r.valido_dal,
    validoAl: r.valido_al,
    durataMesi: r.durata_mesi,
    attivo: r.attivo,
  };
}

export const COLONNE_SCONTO = "id, nome, piano, tipo, percentuale, prezzo_scontato_centesimi, valido_dal, valido_al, durata_mesi, attivo";

export type DatiCatalogoDb = { disponibile: boolean; listini: Partial<Record<PianoSlug, number>>; sconti: Sconto[] };

export async function leggiDatiCatalogo(): Promise<DatiCatalogoDb> {
  const admin = createAdminClient();
  const [prezzi, sconti] = await Promise.all([
    admin.from("omnia_ai_prezzi_piani").select("piano, prezzo_centesimi").returns<{ piano: string; prezzo_centesimi: number }[]>(),
    admin.from("omnia_ai_sconti").select(COLONNE_SCONTO).eq("attivo", true).returns<RigaSconto[]>(),
  ]);

  for (const [nome, q] of [["prezzi", prezzi], ["sconti", sconti]] as const) {
    if (q.error) {
      if (!schemaAssente(q.error)) console.error(`Catalogo: lettura ${nome} fallita`, q.error.message);
      return { disponibile: false, listini: {}, sconti: [] };
    }
  }

  const listini: Partial<Record<PianoSlug, number>> = {};
  for (const r of prezzi.data ?? []) if (PIANI_ORDINE.includes(r.piano as PianoSlug)) listini[r.piano as PianoSlug] = r.prezzo_centesimi;
  return { disponibile: true, listini, sconti: (sconti.data ?? []).map(scontoDaRiga).filter((s): s is Sconto => s !== null) };
}

// Il catalogo di oggi: per ogni piano il listino, lo sconto applicato (se c'è) e il prezzo da pagare.
export async function getCatalogoPiani(istante: Date = new Date()): Promise<Catalogo> {
  const dati = await leggiDatiCatalogo();
  return costruisciCatalogo(dati.listini, dati.sconti, giornoRoma(istante));
}
