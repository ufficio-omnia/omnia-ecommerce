import type { Metadata } from "next";
import CookiePolicyV1 from "@/components/legal/cookie-policy-v1";

export const metadata: Metadata = {
  title: "Cookie policy",
};

export default function CookiePolicyPage() {
  return <CookiePolicyV1 />;
}
