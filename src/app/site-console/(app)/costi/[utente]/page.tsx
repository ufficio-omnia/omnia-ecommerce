import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { richiediAdminPagina } from "@/lib/console/accesso";
import { leggiDettaglioCliente } from "@/lib/console/costi";
import { calcolaPeriodo } from "@/lib/console/periodo";
import CostiDettaglioVista from "../../../_componenti/costi-dettaglio-vista";

export const metadata: Metadata = { title: "Costi del cliente" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// /costi/<uuid del cliente>, oppure /costi/piattaforma per i costi senza cliente.
export default async function PaginaCostiCliente({
  params,
  searchParams,
}: {
  params: Promise<{ utente: string }>;
  searchParams: Promise<{ p?: string; dal?: string; al?: string }>;
}) {
  await richiediAdminPagina();
  const { utente } = await params;
  const piattaforma = utente === "piattaforma";
  if (!piattaforma && !UUID.test(utente)) notFound();

  const periodo = calcolaPeriodo(await searchParams, new Date());
  const dettaglio = await leggiDettaglioCliente(piattaforma ? null : utente, periodo);

  return <CostiDettaglioVista periodo={periodo} dettaglio={dettaglio} piattaforma={piattaforma} idUtente={utente} />;
}
