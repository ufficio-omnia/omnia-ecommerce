import type { Metadata } from "next";
import { richiediAdminPagina } from "@/lib/console/accesso";
import { createAdminClient } from "@/lib/supabase/admin";
import { leggiDatiFonti } from "@/lib/console/fonti";
import { leggiDatiTenderIntelligence } from "@/lib/console/tender-intelligence";
import FontiVista from "../../../_componenti/fonti-vista";

export const metadata: Metadata = { title: "Fonti di Tender Intelligence" };

// Pagina «Fonti» (48C §3.5–3.6; riordino del 25/11): solo amministratori. Le due letture di prima, insieme: stato calcolato, allarmi e ultimi
// giri (leggiDatiFonti) e i dati delle schede delle fonti della console (leggiDatiTenderIntelligence). Nessuna scrittura.
export default async function PaginaFonti() {
  await richiediAdminPagina();
  const [dati, ti] = await Promise.all([leggiDatiFonti(createAdminClient()), leggiDatiTenderIntelligence()]);
  return <FontiVista dati={dati} ti={ti} />;
}
