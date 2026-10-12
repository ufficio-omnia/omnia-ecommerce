import type { Metadata } from "next";
import { richiediAdminPagina } from "@/lib/console/accesso";
import { leggiCrediti } from "@/lib/console/crediti";
import { leggiOrdineCrediti, ordinaCrediti } from "@/lib/console/crediti-calcoli";
import { calcolaPeriodo } from "@/lib/console/periodo";
import CreditiVista from "../../_componenti/crediti-vista";

export const metadata: Metadata = { title: "Crediti" };

export default async function PaginaCrediti({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; dal?: string; al?: string; ord?: string; prova?: string }>;
}) {
  await richiediAdminPagina();
  const parametri = await searchParams;
  const periodo = calcolaPeriodo(parametri, new Date());
  const ordine = leggiOrdineCrediti(parametri.ord);
  const includiProva = parametri.prova === "1";
  const crediti = await leggiCrediti(periodo, { includiProva });

  return (
    <CreditiVista
      periodo={periodo}
      crediti={crediti}
      righeOrdinate={crediti.stato === "ok" ? ordinaCrediti(crediti.risultato.righe, ordine) : []}
      ordine={ordine}
      includiProva={includiProva}
    />
  );
}
