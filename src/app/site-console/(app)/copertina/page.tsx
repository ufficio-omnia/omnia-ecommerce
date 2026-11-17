import type { Metadata } from "next";
import { richiediAdminPagina } from "@/lib/console/accesso";
import { leggiCopertinaConsole } from "@/lib/console/copertina";
import { cercaClientePerConcessione } from "@/lib/console/piano-lavoro";
import CopertinaVista from "../../_componenti/copertina-vista";

export const metadata: Metadata = { title: "Copertina" };

// Il controllo admin sta qui oltre che nel layout: il layout non si riesegue nelle navigazioni interne.
export default async function PaginaCopertina({ searchParams }: { searchParams: Promise<{ cliente?: string }> }) {
  await richiediAdminPagina();
  const { cliente } = await searchParams;
  const emailCercata = (cliente ?? "").slice(0, 200);
  const [dati, ricerca] = await Promise.all([leggiCopertinaConsole(), emailCercata ? cercaClientePerConcessione(emailCercata) : Promise.resolve(null)]);
  return <CopertinaVista dati={dati} emailCercata={emailCercata} ricerca={ricerca} />;
}
