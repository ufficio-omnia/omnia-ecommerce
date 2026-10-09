import type { SupabaseClient } from "@supabase/supabase-js";
import { derivaTipoInterfaccia, type FattiOrganigramma } from "@/lib/organigramma-contesto";
import { leggiVociProfilo } from "@/lib/organigramma-dati";

// Lettura dei fatti certi per l'organigramma: committente e interfaccia dalla
// gara e dai suoi documenti, impresa e livello di direzione dal profilo
// aziendale, sedi e organico dai dati strutturati della gara. Solo lettura.

type RigaGara = {
  sedi: { denominazione?: string }[] | null;
  personale_uscente: { numero_addetti?: number | null }[] | null;
  amministrazione_committente: string | null;
  stazione_appaltante: string | null;
};

type RigaProfilo = {
  ragione_sociale: string | null;
  numero_dipendenti: number | null;
  software_nome: string | null;
  funzioni_direzione?: string | null;
  uffici_gestione?: string | null;
};

const COLONNE_PROFILO_BASE = "ragione_sociale, numero_dipendenti, software_nome, certificazioni, referenze, settori_attivita, presentazione";

export async function leggiFattiOrganigramma(params: { supabase: SupabaseClient; garaId: string; userId: string }): Promise<FattiOrganigramma> {
  const { supabase, garaId, userId } = params;

  const [garaRes, chunkRes] = await Promise.all([
    supabase
      .from("gare")
      .select("sedi, personale_uscente, amministrazione_committente, stazione_appaltante")
      .eq("id", garaId)
      .maybeSingle<RigaGara>(),
    supabase.from("gara_documenti_chunks").select("contenuto").eq("gara_id", garaId),
  ]);

  // I campi del livello di direzione stanno nella migrazione 0071: senza di
  // essa si legge il profilo senza (la fascia di direzione resta omessa).
  let profiloRes = await supabase
    .from("companies")
    .select(`${COLONNE_PROFILO_BASE}, funzioni_direzione, uffici_gestione`)
    .eq("user_id", userId)
    .maybeSingle<RigaProfilo>();
  if (profiloRes.error) {
    profiloRes = await supabase.from("companies").select(COLONNE_PROFILO_BASE).eq("user_id", userId).maybeSingle<RigaProfilo>();
  }

  const gara = garaRes.data;
  const profilo = profiloRes.data;
  const sedi = (gara?.sedi ?? []).map((s) => s.denominazione).filter((s): s is string => !!s);
  const uscente = (gara?.personale_uscente ?? []).reduce((tot, p) => tot + (p.numero_addetti ?? 0), 0);
  const testiDocumenti = ((chunkRes.data ?? []) as { contenuto: string }[]).map((c) => c.contenuto);

  return {
    impresa: profilo?.ragione_sociale ?? null,
    committente: gara?.amministrazione_committente ?? gara?.stazione_appaltante ?? null,
    tipoInterfaccia: derivaTipoInterfaccia(testiDocumenti),
    sedi,
    organico: profilo?.numero_dipendenti != null ? profilo.numero_dipendenti + uscente : null,
    funzioniDirezione: leggiVociProfilo(profilo?.funzioni_direzione),
    ufficiGestione: leggiVociProfilo(profilo?.uffici_gestione),
    softwareNome: profilo?.software_nome ?? null,
    testoProfilo: JSON.stringify(profilo ?? {}),
  };
}
