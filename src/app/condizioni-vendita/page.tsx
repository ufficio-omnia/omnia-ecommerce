import type { Metadata } from "next";
import CondizioniVenditaV1 from "@/components/legal/condizioni-vendita-v1";

export const metadata: Metadata = {
  title: "Condizioni di vendita",
};

export default function CondizioniVenditaPage() {
  return <CondizioniVenditaV1 />;
}
