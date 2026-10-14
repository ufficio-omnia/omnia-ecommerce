import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import DocumentiContrattualiVista from "@/components/omnia-ai/documenti-contrattuali-vista";
import {
  datiAllegatoMancanti,
  raggruppaAccettazioni,
  type AbbonamentoDb,
  type AccettazioneDb,
  type DocumentoLegaleDb,
  type ProfiloFatturazione,
} from "@/lib/omnia-ai-documenti-contrattuali";

export const metadata: Metadata = { title: "Documenti contrattuali — OMNIA AI" };

// Le tre letture passano dalla sessione del cliente (non dalla chiave di servizio): le
// accettazioni, gli abbonamenti e il profilo li protegge la RLS, quindi qui non si può
// vedere altro che i propri. I documenti legali hanno invece lettura pubblica.
export default async function DocumentiContrattualiPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const [accettazioni, documenti, abbonamenti, profilo] = await Promise.all([
    supabase
      .from("omnia_ai_legal_acceptances")
      .select("subscription_id, acceptance_type, accepted_at, legal_document_id")
      .eq("user_id", user.id)
      .returns<AccettazioneDb[]>(),
    supabase.from("legal_documents").select("id, document_type, version, effective_date").like("document_type", "omnia_ai_%").returns<DocumentoLegaleDb[]>(),
    supabase
      .from("subscriptions")
      .select("id, plan, created_at, stripe_subscription_id")
      .eq("user_id", user.id)
      .returns<AbbonamentoDb[]>(),
    supabase
      .from("companies")
      .select("ragione_sociale, partita_iva, codice_fiscale, indirizzo")
      .eq("user_id", user.id)
      .maybeSingle<ProfiloFatturazione>(),
  ]);

  for (const [nome, q] of [["accettazioni", accettazioni], ["documenti", documenti], ["abbonamenti", abbonamenti]] as const) {
    if (q.error) {
      console.error(`Documenti contrattuali: lettura ${nome} fallita`, q.error.message);
      return (
        <div className="omnia-app-shell">
          <h1 className="omnia-app-titolo">Documenti contrattuali</h1>
          <p className="omnia-messaggio-stato errore" style={{ marginTop: 24 }}>
            Non riesco a leggere i tuoi documenti in questo momento. Riprova tra poco.
          </p>
        </div>
      );
    }
  }

  return (
    <DocumentiContrattualiVista
      gruppi={raggruppaAccettazioni(accettazioni.data ?? [], documenti.data ?? [], abbonamenti.data ?? [])}
      mancantiAllegato={datiAllegatoMancanti(profilo.data)}
    />
  );
}
