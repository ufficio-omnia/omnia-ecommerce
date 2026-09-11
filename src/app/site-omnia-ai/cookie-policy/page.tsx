import type { Metadata } from "next";
import PageShell from "@/components/omnia-ai/page-shell";
import CookiePolicyV1 from "@/components/omnia-ai/legal/cookie-policy-v1";

export const metadata: Metadata = {
  title: "Cookie policy — OMNIA AI",
};

export default function CookiePolicyPage() {
  return (
    <PageShell>
      <CookiePolicyV1 />
    </PageShell>
  );
}
