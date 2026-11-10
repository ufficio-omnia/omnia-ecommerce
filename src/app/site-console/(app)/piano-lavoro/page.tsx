import type { Metadata } from "next";
import { richiediAdminPagina } from "@/lib/console/accesso";
import { cercaClientePerConcessione, leggiPianoLavoroConsole } from "@/lib/console/piano-lavoro";
import PianoLavoroVista from "../../_componenti/piano-lavoro-vista";

export const metadata: Metadata = { title: "Piano di lavoro e pacchetti" };

// Il controllo admin sta qui oltre che nel layout: il layout non si riesegue nelle navigazioni interne.
export default async function PaginaPianoLavoro({ searchParams }: { searchParams: Promise<{ cliente?: string }> }) {
  await richiediAdminPagina();
  const { cliente } = await searchParams;
  const emailCercata = (cliente ?? "").slice(0, 200);
  const [dati, ricerca] = await Promise.all([leggiPianoLavoroConsole(), emailCercata ? cercaClientePerConcessione(emailCercata) : Promise.resolve(null)]);
  return <PianoLavoroVista dati={dati} emailCercata={emailCercata} ricerca={ricerca} />;
}
