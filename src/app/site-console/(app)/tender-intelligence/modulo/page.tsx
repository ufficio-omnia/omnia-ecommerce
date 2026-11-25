import type { Metadata } from "next";
import { richiediAdminPagina } from "@/lib/console/accesso";
import { leggiDatiTenderIntelligence } from "@/lib/console/tender-intelligence";
import { VistaModulo } from "../../../_componenti/tender-intelligence-vista";

export const metadata: Metadata = { title: "Modulo e clienti · Tender Intelligence" };

// Riordino della console (25/11): interruttore generale, imprese abilitate, limiti tecnici, «Avanzate». Solo amministratori; le azioni sono
// quelle di prima (salvaParametriRadar, impostaImpresaRadar).
export default async function PaginaModulo() {
  await richiediAdminPagina();
  const dati = await leggiDatiTenderIntelligence();
  return <VistaModulo dati={dati} />;
}
