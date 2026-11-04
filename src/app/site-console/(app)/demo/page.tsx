import type { Metadata } from "next";
import { richiediAdminPagina } from "@/lib/console/accesso";
import { calcolaPeriodo } from "@/lib/console/periodo";
import { leggiDemo } from "@/lib/console/demo";
import DemoVista from "../../_componenti/demo-vista";

export const metadata: Metadata = { title: "DEMO e Google Ads" };

// Il controllo admin sta qui oltre che nel layout: il layout non si riesegue nelle navigazioni interne.
export default async function PaginaDemo({ searchParams }: { searchParams: Promise<{ p?: string; dal?: string; al?: string }> }) {
  await richiediAdminPagina();
  const adesso = new Date();
  const periodo = calcolaPeriodo(await searchParams, adesso);
  const risultato = await leggiDemo(periodo);
  return <DemoVista periodo={periodo} risultato={risultato} adessoMs={adesso.getTime()} />;
}
