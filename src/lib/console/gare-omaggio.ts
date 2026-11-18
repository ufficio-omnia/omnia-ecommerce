import { createAdminClient } from "@/lib/supabase/admin";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { giornoRoma } from "@/lib/omnia-ai-catalogo-calcoli";
import { statoOmaggio, type StatoOmaggio } from "@/lib/omnia-ai-gare-omaggio-calcoli";

// Letture per il riquadro «Gare in omaggio» della scheda cliente (migrazione 0131). Prima della migrazione
// la tabella non c'è: `disponibile: false`, e il riquadro lo dice.

export type OmaggioScheda = {
  id: string;
  gare: number;
  dal: string;
  al: string;
  motivo: string | null;
  creatoDa: string;
  creatoIl: string;
  revocatoIl: string | null;
  revocatoDa: string | null;
  stato: StatoOmaggio;
};

export type OmaggiCliente = { disponibile: boolean; errore: boolean; oggi: string; omaggi: OmaggioScheda[]; gareInCorso: number };

export async function leggiOmaggiCliente(userId: string, adesso: Date = new Date()): Promise<OmaggiCliente> {
  const oggi = giornoRoma(adesso);
  const { data, error } = await createAdminClient()
    .from("omnia_ai_gare_omaggio")
    .select("id, gare, dal, al, motivo, creato_da_email, creato_il, revocato_il, revocato_da_email")
    .eq("user_id", userId)
    .order("creato_il", { ascending: false })
    .limit(50)
    .returns<{ id: string; gare: number; dal: string; al: string; motivo: string | null; creato_da_email: string; creato_il: string; revocato_il: string | null; revocato_da_email: string | null }[]>();
  if (error) {
    if (schemaAssente(error)) return { disponibile: false, errore: false, oggi, omaggi: [], gareInCorso: 0 };
    console.error("Console: lettura gare in omaggio fallita", error.message);
    return { disponibile: true, errore: true, oggi, omaggi: [], gareInCorso: 0 };
  }
  const omaggi = (data ?? []).map((r) => ({
    id: r.id,
    gare: r.gare,
    dal: r.dal,
    al: r.al,
    motivo: r.motivo,
    creatoDa: r.creato_da_email,
    creatoIl: r.creato_il,
    revocatoIl: r.revocato_il,
    revocatoDa: r.revocato_da_email,
    stato: statoOmaggio(r, oggi),
  }));
  return { disponibile: true, errore: false, oggi, omaggi, gareInCorso: omaggi.filter((o) => o.stato === "in_corso").reduce((t, o) => t + o.gare, 0) };
}
