import { createClient } from "@/lib/supabase/server";

// Stesso pattern di getCurrentLegalDocuments (src/lib/legal-acceptance.ts):
// "vigente" = versione con la effective_date più recente non successiva
// ad oggi, non il numero di versione più alto — permette di pubblicare in
// anticipo una revisione futura senza che scatti prima della sua data di
// entrata in vigore.
//
// Client di sessione (non admin): legal_documents ha SELECT pubblico via
// RLS, stesso client già usato per lo stesso scopo in
// src/app/(ecommerce)/prodotti/[id]/page.tsx.
//
// Ricade sulla pagina statica se non c'è ancora una riga per questo tipo
// (es. la migrazione 0052 non è stata ancora eseguita): non deve mai
// rompere il rendering della pagina piani o del piè di pagina.
export async function getCurrentOmniaAiCondizioniAbbonamentoUrl(): Promise<string> {
  const fallback = "/condizioni-abbonamento";
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("legal_documents")
    .select("version")
    .eq("document_type", "omnia_ai_condizioni_abbonamento")
    .lte("effective_date", today)
    .order("effective_date", { ascending: false })
    .limit(1)
    .maybeSingle<{ version: number }>();

  if (error || !data) return fallback;

  return `/documenti-legali/condizioni-abbonamento/${data.version}`;
}
