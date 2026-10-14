import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { dataRoma } from "./giorni-lavorativi";

// Dove stanno i pagamenti di PROVA (Stripe di OMNIA AI in modalità test).
// Premere «Dati di prova: Inclusi» non mostra nulla se il periodo scelto non li
// contiene (oggi sono tutti di settembre e il periodo predefinito è il mese
// corrente): questo riepilogo permette di dirlo e di indicare dove guardare.

export type RiepilogoProva = {
  voci: number;
  // primo e ultimo giorno (AAAA-MM-GG, Roma) in cui c'è un pagamento di prova
  da: string | null;
  a: string | null;
};

export const leggiRiepilogoProva = cache(async (): Promise<RiepilogoProva> => {
  const admin = createAdminClient();
  const [incassi, crediti, revisioni] = await Promise.all([
    admin.from("omnia_ai_incassi").select("pagato_il").eq("livemode", false).limit(5000),
    admin.from("omnia_ai_credit_purchases").select("created_at").like("stripe_session_id", "cs_test_%").limit(5000),
    admin.from("omnia_ai_revisioni").select("pagata_il").eq("stato", "pagata").eq("livemode", false).limit(5000),
  ]);

  // una tabella o una colonna che manca (migrazioni non eseguite) = nessun dato di prova noto
  const date = [
    ...(incassi.error ? [] : ((incassi.data ?? []) as { pagato_il: string }[]).map((r) => r.pagato_il)),
    ...(crediti.error ? [] : ((crediti.data ?? []) as { created_at: string }[]).map((r) => r.created_at)),
    ...(revisioni.error ? [] : ((revisioni.data ?? []) as { pagata_il: string }[]).map((r) => r.pagata_il)),
  ]
    .map((iso) => dataRoma(new Date(iso)))
    .sort();

  return { voci: date.length, da: date[0] ?? null, a: date[date.length - 1] ?? null };
});

export type SuggerimentoProva = { voci: number; da: string; a: string };

// Da mostrare quando i dati di prova sono INCLUSI ma il periodo scelto non ne
// contiene nessuno, mentre in altri periodi ce ne sono.
export function suggerimentoProva(opzioni: { includiProva: boolean; vociNelPeriodo: number; riepilogo: RiepilogoProva }): SuggerimentoProva | null {
  const { includiProva, vociNelPeriodo, riepilogo } = opzioni;
  if (!includiProva || vociNelPeriodo > 0 || riepilogo.voci === 0 || !riepilogo.da || !riepilogo.a) return null;
  return { voci: riepilogo.voci, da: riepilogo.da, a: riepilogo.a };
}
