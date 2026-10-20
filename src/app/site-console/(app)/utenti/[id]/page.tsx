import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { richiediAdminPagina } from "@/lib/console/accesso";
import { riassuntoAccessiCliente } from "@/lib/console/accessi-dati";
import { leggiProvaCliente } from "@/lib/console/gare-gratuite";
import { leggiPilotCliente } from "@/lib/console/pilot";
import { leggiPresenzaUtente } from "@/lib/console/presenza";
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
  const accessi = scheda.stato === "ok" ? await riassuntoAccessiCliente({ id, email: scheda.utente.email }) : null;
  const prova = await leggiProvaCliente(id);
  const pilot = await leggiPilotCliente(id);
  // Presenza nell'area riservata (migrazione 0094): dell'utente e, se questo cliente ha un Ufficio Gare, anche della sua.
  const presenza = await leggiPresenzaUtente(id);
  const presenzaUfficioGare = scheda.stato === "ok" && scheda.legameUfficioGare?.ruolo === "titolare" ? await leggiPresenzaUtente(scheda.legameUfficioGare.ufficioGare.id) : null;

  return <SchedaClienteVista scheda={scheda} idSessione={sessione.userId} esito={esito} accessi={accessi} prova={prova} pilot={pilot} presenza={presenza} presenzaUfficioGare={presenzaUfficioGare} />;
}
