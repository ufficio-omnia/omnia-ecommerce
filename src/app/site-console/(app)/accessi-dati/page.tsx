import type { Metadata } from "next";
import { richiediAdminPagina } from "@/lib/console/accesso";
import { leggiFiltroAccessi } from "@/lib/console/accessi-dati-calcoli";
import { leggiAccessi } from "@/lib/console/accessi-dati";
import AccessiDatiVista from "../../_componenti/accessi-dati-vista";

export const metadata: Metadata = { title: "Accessi ai dati" };

// Il controllo admin sta qui oltre che nel layout: il layout non si riesegue nelle
// navigazioni interne.
export default async function PaginaAccessiDati({ searchParams }: { searchParams: Promise<{ cliente?: string; caso?: string }> }) {
  await richiediAdminPagina();
  const filtro = leggiFiltroAccessi(await searchParams);
  const risultato = await leggiAccessi({ caso: filtro.caso, cliente: filtro.cliente });
  return <AccessiDatiVista risultato={risultato} filtro={filtro} />;
}
