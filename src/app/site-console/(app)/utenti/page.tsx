import type { Metadata } from "next";
import { richiediAdminPagina } from "@/lib/console/accesso";
import { leggiElencoUtenti } from "@/lib/console/utenti";
import { filtraUtenti, leggiOrdineUtenti, leggiTipoUtente, ordinaUtenti } from "@/lib/console/utenti-calcoli";
import UtentiVista from "../../_componenti/utenti-vista";

export const metadata: Metadata = { title: "Utenti" };

export default async function PaginaUtenti({
  searchParams,
}: {
  searchParams: Promise<{ tipo?: string; q?: string; ord?: string; esito?: string }>;
}) {
  await richiediAdminPagina();
  const parametri = await searchParams;
  const elenco = await leggiElencoUtenti();

  const tipo = leggiTipoUtente(parametri.tipo);
  const ordine = leggiOrdineUtenti(parametri.ord);
  const q = (parametri.q ?? "").slice(0, 100);

  return (
    <UtentiVista
      elenco={elenco}
      righe={elenco.stato === "ok" ? ordinaUtenti(filtraUtenti(elenco.righe, tipo, q), ordine) : []}
      tipo={tipo}
      q={q}
      ordine={ordine}
      esito={parametri.esito}
    />
  );
}
