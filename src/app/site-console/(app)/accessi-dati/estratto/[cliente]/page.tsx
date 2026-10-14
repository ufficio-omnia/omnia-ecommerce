import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { richiediAdminPagina } from "@/lib/console/accesso";
import { giornoValido, leggiEstratto } from "@/lib/console/accessi-dati-estratto";
import EstrattoAccessiVista from "../../../../_componenti/estratto-accessi-vista";

export const metadata: Metadata = { title: "Estratto accessi" };

// /accessi-dati/estratto/<uuid del cliente>?dal=…&al=… — il documento che si manda al
// cliente quando chiede l'estratto del registro. Il controllo admin è la prima istruzione.
export default async function PaginaEstrattoAccessi({
  params,
  searchParams,
}: {
  params: Promise<{ cliente: string }>;
  searchParams: Promise<{ dal?: string; al?: string }>;
}) {
  const sessione = await richiediAdminPagina();
  const { cliente } = await params;
  const periodo = await searchParams;
  const dal = giornoValido(periodo.dal);
  const al = giornoValido(periodo.al);

  const estratto = await leggiEstratto(cliente, dal, al);
  if (estratto.stato === "id_non_valido") notFound();
  if (estratto.stato === "tabella_assente") {
    return (
      <p className="cn-esito errore" role="alert">
        Il registro non esiste ancora nel database: eseguire la migrazione 0082.
      </p>
    );
  }
  if (estratto.stato === "errore") {
    return (
      <p className="cn-esito errore" role="alert">
        {estratto.messaggio}
      </p>
    );
  }

  return <EstrattoAccessiVista cliente={estratto.cliente} righe={estratto.righe} dal={dal} al={al} emessoIl={new Date()} operatore={sessione.email} />;
}
