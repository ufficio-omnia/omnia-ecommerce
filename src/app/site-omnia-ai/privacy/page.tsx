import type { Metadata } from "next";
import PageShell from "@/components/omnia-ai/page-shell";
import PrivacyPolicyV1 from "@/components/omnia-ai/legal/privacy-policy-v1";

export const metadata: Metadata = {
  title: "Privacy policy — OMNIA AI",
};

export default function PrivacyPage() {
  return (
    <PageShell>
      <PrivacyPolicyV1 />
    </PageShell>
  );
}
