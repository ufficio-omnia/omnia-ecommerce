import type { Metadata } from "next";
import PageShell from "@/components/omnia-ai/page-shell";
import DocumentoLegaleVersionato, { versioneRegistrataPiuVicina } from "@/components/omnia-ai/legal/documento-legale-versionato";
import { getCurrentOmniaAiDocumento } from "@/lib/omnia-ai-legal";
import { paginaMetadata } from "@/lib/omnia-ai-seo";

export const metadata: Metadata = paginaMetadata({
  title: "Cookie policy — OMNIA AI",
  description:
    "Cookie policy di OMNIA AI: quali cookie usa omnia-ai.it e come gestire le tue preferenze.",
  path: "/cookie-policy",
});

// Pagina «corrente»: mostra la versione in vigore secondo legal_documents (la v2 dopo la migrazione 0100), non una versione fissa. Se il
// database non risponde o non ha righe si ricade sulla v1, che è sempre registrata; se indica una versione che il codice non conosce ancora
// si mostra la più recente che possiede (stesso schema della pagina «Condizioni di abbonamento»).
export default async function CookiePolicyPage() {
  const corrente = await getCurrentOmniaAiDocumento("omnia_ai_cookie_policy");
  const versione = versioneRegistrataPiuVicina("cookie-policy", corrente?.version ?? 1) ?? 1;

  return (
    <PageShell>
      <DocumentoLegaleVersionato slug="cookie-policy" version={String(versione)} />
    </PageShell>
  );
}
