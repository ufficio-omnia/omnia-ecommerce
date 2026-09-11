import type { Metadata } from "next";
import PageShell from "@/components/omnia-ai/page-shell";
import CondizioniAbbonamentoV1 from "@/components/omnia-ai/legal/condizioni-abbonamento-v1";

export const metadata: Metadata = {
  title: "Condizioni di abbonamento — OMNIA AI",
};

export default function CondizioniAbbonamentoPage() {
  return (
    <PageShell>
      <CondizioniAbbonamentoV1 />
    </PageShell>
  );
}
