import type { Metadata } from "next";
import PageShell from "@/components/omnia-ai/page-shell";
import PrivacyPolicyV1 from "@/components/omnia-ai/legal/privacy-policy-v1";
import { paginaMetadata } from "@/lib/omnia-ai-seo";

export const metadata: Metadata = paginaMetadata({
  title: "Privacy policy — OMNIA AI",
  description:
    "Informativa sulla privacy di OMNIA AI: come vengono trattati i dati personali di clienti e visitatori di omnia-ai.it.",
  path: "/privacy",
});

export default function PrivacyPage() {
  return (
    <PageShell>
      <PrivacyPolicyV1 />
    </PageShell>
  );
}
