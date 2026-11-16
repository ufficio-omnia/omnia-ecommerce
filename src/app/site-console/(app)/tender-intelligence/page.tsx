import type { Metadata } from "next";
import { richiediAdminPagina } from "@/lib/console/accesso";
import { leggiDatiTenderIntelligence } from "@/lib/console/tender-intelligence";
import TenderIntelligenceVista from "../../_componenti/tender-intelligence-vista";

export const metadata: Metadata = { title: "Tender Intelligence" };

export default async function PaginaTenderIntelligence() {
  await richiediAdminPagina();
  const dati = await leggiDatiTenderIntelligence();
  return <TenderIntelligenceVista dati={dati} />;
}
