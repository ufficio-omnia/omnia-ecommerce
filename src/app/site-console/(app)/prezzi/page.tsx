import type { Metadata } from "next";
import { richiediAdminPagina } from "@/lib/console/accesso";
import { leggiPrezziConsole } from "@/lib/console/prezzi";
import { giornoRoma } from "@/lib/omnia-ai-catalogo-calcoli";
import PrezziVista from "../../_componenti/prezzi-vista";

export const metadata: Metadata = { title: "Piani e prezzi" };

// Il controllo admin sta qui oltre che nel layout: il layout non si riesegue nelle navigazioni interne.
export default async function PaginaPrezzi() {
  await richiediAdminPagina();
  const dati = await leggiPrezziConsole();
  return <PrezziVista dati={dati} oggi={giornoRoma(new Date())} />;
}
