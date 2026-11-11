import { createAdminClient } from "@/lib/supabase/admin";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { COLONNE_IMPOSTAZIONI_COPERTINA, generazioniContate, impostazioniDaRiga, usoDaRighe, type ImpostazioniCopertina, type RigaGenerazione } from "@/lib/copertina-diritto-calcoli";

// Letture per il riquadro «Copertina della relazione tecnica» della scheda cliente (migrazione 0106): le impostazioni del cliente e ciò che ha già generato.
// Prima della migrazione le tabelle non ci sono: `disponibile: false`. Da chiamare solo dopo richiediAdminPagina().

export type CopertinaCliente = {
  disponibile: boolean;
  // null = mai configurato (servizio spento)
  impostazioni: ImpostazioniCopertina | null;
  aggiornataIl: string | null;
  aggiornataDa: string | null;
  // quante gare gratis ha già usato (gare distinte con almeno una copertina gratuita, pronta o in corso)
  gareGratisUsate: number;
  // le copertine generate (pronte), per stile, su tutte le sue gare
  generazioni: { stilizzato: number; realistico: number };
};

export async function leggiCopertinaCliente(userId: string): Promise<CopertinaCliente> {
  const admin = createAdminClient();
  const nonDisponibile: CopertinaCliente = { disponibile: false, impostazioni: null, aggiornataIl: null, aggiornataDa: null, gareGratisUsate: 0, generazioni: { stilizzato: 0, realistico: 0 } };

  const { data: riga, error } = await admin
    .from("omnia_ai_copertina_impostazioni")
    .select(COLONNE_IMPOSTAZIONI_COPERTINA)
    .eq("user_id", userId)
    .maybeSingle<Record<string, unknown>>();
  if (error) {
    if (!schemaAssente(error)) console.error("Console: lettura delle impostazioni della copertina fallita", error.message);
    return nonDisponibile;
  }

  const { data: righe, error: erroreRighe } = await admin.from("gara_copertine").select("gara_id, stile, stato, fonte, creata_il").eq("user_id", userId).limit(5000).returns<RigaGenerazione[]>();
  if (erroreRighe) {
    if (!schemaAssente(erroreRighe)) console.error("Console: lettura delle copertine generate fallita", erroreRighe.message);
    return nonDisponibile;
  }

  const adesso = new Date();
  const contate = generazioniContate(righe ?? [], adesso);
  const generazioni = { stilizzato: 0, realistico: 0 };
  for (const r of contate) if (r.stato === "pronta" && (r.stile === "stilizzato" || r.stile === "realistico")) generazioni[r.stile] += 1;

  return {
    disponibile: true,
    impostazioni: impostazioniDaRiga(riga),
    aggiornataIl: typeof riga?.aggiornata_il === "string" ? riga.aggiornata_il : null,
    aggiornataDa: typeof riga?.aggiornata_da_email === "string" ? riga.aggiornata_da_email : null,
    gareGratisUsate: usoDaRighe(righe ?? [], "", adesso).gareGratisUsate.length,
    generazioni,
  };
}
