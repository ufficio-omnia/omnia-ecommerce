import type { Metadata } from "next";
import PageShell from "@/components/omnia-ai/page-shell";
import CookiePolicyV1 from "@/components/omnia-ai/legal/cookie-policy-v1";
import { paginaMetadata } from "@/lib/omnia-ai-seo";

export const metadata: Metadata = paginaMetadata({
  title: "Cookie policy — OMNIA AI",
  description:
    "Cookie policy di OMNIA AI: quali cookie usa omnia-ai.it e come gestire le tue preferenze.",
  path: "/cookie-policy",
});

export default function CookiePolicyPage() {
  return (
    <PageShell>
      <CookiePolicyV1 />
    </PageShell>
  );
}
