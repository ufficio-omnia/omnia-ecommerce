import type { Metadata } from "next";
import PageShell from "@/components/omnia-ai/page-shell";
import DocumentoLegaleVersionato, { versioneRegistrataPiuVicina } from "@/components/omnia-ai/legal/documento-legale-versionato";
import { getCurrentOmniaAiDocumento } from "@/lib/omnia-ai-legal";
import { paginaMetadata } from "@/lib/omnia-ai-seo";

export const metadata: Metadata = paginaMetadata({
  title: "Condizioni di abbonamento — OMNIA AI",
  description:
    "Condizioni di abbonamento al servizio OMNIA AI per la generazione di relazioni tecniche di gara d'appalto.",
  path: "/condizioni-abbonamento",
});

// Pagina «corrente»: mostra la versione in vigore secondo legal_documents (la v2 dopo la
// migrazione 0080), non una versione fissa. Se il database non risponde o non ha righe
// si ricade sulla v1, che è sempre registrata; se indica una versione che il codice non
// conosce ancora si mostra la più recente che possiede.
export default async function CondizioniAbbonamentoPage() {
  const corrente = await getCurrentOmniaAiDocumento("omnia_ai_condizioni_abbonamento");
  const versione = versioneRegistrataPiuVicina("condizioni-abbonamento", corrente?.version ?? 1) ?? 1;

  return (
    <PageShell>
      <DocumentoLegaleVersionato slug="condizioni-abbonamento" version={String(versione)} />
    </PageShell>
  );
}
