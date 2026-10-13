import type { Metadata } from "next";
import { richiediAdminPagina } from "@/lib/console/accesso";
import { leggiAbbonamenti } from "@/lib/console/abbonamenti";
import { calcolaPeriodo } from "@/lib/console/periodo";
import AbbonamentiVista from "../../_componenti/abbonamenti-vista";

export const metadata: Metadata = { title: "Abbonamenti" };

export default async function PaginaAbbonamenti({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; dal?: string; al?: string; prova?: string }>;
}) {
  await richiediAdminPagina();
  const parametri = await searchParams;
  const periodo = calcolaPeriodo(parametri, new Date());
  const includiProva = parametri.prova === "1";
  const abbonamenti = await leggiAbbonamenti(periodo, { includiProva });

  return <AbbonamentiVista periodo={periodo} abbonamenti={abbonamenti} includiProva={includiProva} />;
}
