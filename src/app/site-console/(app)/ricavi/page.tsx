import type { Metadata } from "next";
import { richiediAdminPagina } from "@/lib/console/accesso";
import { calcolaPeriodo } from "@/lib/console/periodo";
import { leggiRiepilogoProva, suggerimentoProva } from "@/lib/console/prova";
import { leggiRicavi } from "@/lib/console/ricavi";
import RicaviVista from "../../_componenti/ricavi-vista";

export const metadata: Metadata = { title: "Ricavi" };

export default async function PaginaRicavi({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; dal?: string; al?: string; prova?: string }>;
}) {
  await richiediAdminPagina();
  const parametri = await searchParams;
  const periodo = calcolaPeriodo(parametri, new Date());
  const includiProva = parametri.prova === "1";
  const ricavi = await leggiRicavi(periodo, { includiProva });
  const provaAltrove = suggerimentoProva({
    includiProva,
    vociNelPeriodo: ricavi.stato === "ok" ? ricavi.riepilogo.prova.voci : 0,
    riepilogo: await leggiRiepilogoProva(),
  });

  return <RicaviVista periodo={periodo} ricavi={ricavi} includiProva={includiProva} provaAltrove={provaAltrove} />;
}
