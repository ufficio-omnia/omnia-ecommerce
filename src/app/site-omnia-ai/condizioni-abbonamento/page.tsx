import type { Metadata } from "next";
import PageShell from "@/components/omnia-ai/page-shell";
import CondizioniAbbonamentoV1 from "@/components/omnia-ai/legal/condizioni-abbonamento-v1";
import { paginaMetadata } from "@/lib/omnia-ai-seo";

export const metadata: Metadata = paginaMetadata({
  title: "Condizioni di abbonamento — OMNIA AI",
  description:
    "Condizioni di abbonamento al servizio OMNIA AI per la generazione di relazioni tecniche di gara d'appalto.",
  path: "/condizioni-abbonamento",
});

export default function CondizioniAbbonamentoPage() {
  return (
    <PageShell>
      <CondizioniAbbonamentoV1 />
    </PageShell>
  );
}
