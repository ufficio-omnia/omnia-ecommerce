import type { Metadata } from "next";
import { richiediAdminPagina } from "@/lib/console/accesso";
import { leggiDatiTenderIntelligence } from "@/lib/console/tender-intelligence";
import { VistaGare } from "../../../_componenti/tender-intelligence-vista";

export const metadata: Metadata = { title: "Gare da controllare · Tender Intelligence" };

// Riordino della console (25/11): gare «da verificare», suggerimenti di unione, conflitti tra fonti. Solo amministratori; le azioni sono
// quelle di prima (decidiGaraInVerifica, decidiPropostaCollegamento).
export default async function PaginaGare() {
  await richiediAdminPagina();
  const dati = await leggiDatiTenderIntelligence();
  return <VistaGare dati={dati} />;
}
