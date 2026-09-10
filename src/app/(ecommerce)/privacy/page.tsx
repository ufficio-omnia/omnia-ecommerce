import type { Metadata } from "next";
import PrivacyPolicyV1 from "@/components/legal/privacy-policy-v1";

export const metadata: Metadata = {
  title: "Privacy policy",
};

export default function PrivacyPage() {
  return <PrivacyPolicyV1 />;
}
