import type { Metadata } from "next";
import { richiediAdminPagina } from "@/lib/console/accesso";
import { createAdminClient } from "@/lib/supabase/admin";
import { leggiDatiFonti } from "@/lib/console/fonti";
import FontiVista from "../../../_componenti/fonti-vista";

export const metadata: Metadata = { title: "Fonti di Tender Intelligence" };

// Pagina «Fonti» (48C §3.5–3.6): solo amministratori; lettura dello stato calcolato, degli allarmi e degli ultimi giri (nessuna scrittura).
export default async function PaginaFonti() {
  await richiediAdminPagina();
  const dati = await leggiDatiFonti(createAdminClient());
  return <FontiVista dati={dati} />;
}
