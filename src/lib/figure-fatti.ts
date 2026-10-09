import type { SupabaseClient } from "@supabase/supabase-js";
import { leggiFunzioniPiattaforma, type FattiFigure } from "@/lib/figure-contesto";

// Lettura dei fatti certi per le figure: piattaforma gestionale e sue funzioni
// dal profilo azienda. Solo lettura. Il campo delle funzioni sta nella
// migrazione 0072: senza di essa si legge il profilo senza (nessuna funzione
// dichiarata → il cruscotto non viene disegnato).

type RigaProfilo = { software_nome: string | null; funzioni_piattaforma?: string | null };

export async function leggiFattiFigure(params: { supabase: SupabaseClient; userId: string }): Promise<FattiFigure> {
  const { supabase, userId } = params;
  let res = await supabase.from("companies").select("software_nome, funzioni_piattaforma").eq("user_id", userId).maybeSingle<RigaProfilo>();
  if (res.error) res = await supabase.from("companies").select("software_nome").eq("user_id", userId).maybeSingle<RigaProfilo>();
  const profilo = res.data;
  return {
    piattaforma: profilo?.software_nome?.trim() || null,
    funzioniPiattaforma: leggiFunzioniPiattaforma(profilo?.funzioni_piattaforma),
  };
}
