import type { Metadata } from "next";
import { richiediAdminPagina } from "@/lib/console/accesso";
import { leggiDatiTenderIntelligence } from "@/lib/console/tender-intelligence";
import { VistaRegistro } from "../../../_componenti/tender-intelligence-vista";

export const metadata: Metadata = { title: "Registro · Tender Intelligence" };

// Riordino della console (25/11): registro delle modifiche e utilizzi degli ultimi 30 giorni. Solo amministratori, sola lettura.
export default async function PaginaRegistro() {
  await richiediAdminPagina();
  const dati = await leggiDatiTenderIntelligence();
  return <VistaRegistro dati={dati} />;
}
