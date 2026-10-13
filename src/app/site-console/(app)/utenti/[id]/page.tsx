import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { richiediAdminPagina } from "@/lib/console/accesso";
import { leggiScheda } from "@/lib/console/utenti";
import SchedaClienteVista from "../../../_componenti/scheda-cliente-vista";

export const metadata: Metadata = { title: "Scheda cliente" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// /utenti/<uuid dell'utente>. Il controllo admin sta qui oltre che nel layout:
// il layout non si riesegue nelle navigazioni interne.
export default async function PaginaSchedaCliente({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ esito?: string; ordine?: string; email?: string; data?: string }>;
}) {
  const sessione = await richiediAdminPagina();
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const esito = await searchParams;
  const scheda = await leggiScheda(id);

  return <SchedaClienteVista scheda={scheda} idSessione={sessione.userId} esito={esito} />;
}
