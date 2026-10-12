import type { Metadata } from "next";
import { richiediAdminPagina } from "@/lib/console/accesso";
import { leggiCosti } from "@/lib/console/costi";
import { leggiOrdineCosti, ordinaClienti } from "@/lib/console/costi-calcoli";
import { calcolaPeriodo } from "@/lib/console/periodo";
import { providerConfigurati, stripeOmniaAiInProva } from "@/lib/console/stato-sistema";
import { salvaParametri } from "../../azioni/costi";
import CostiVista from "../../_componenti/costi-vista";

export const metadata: Metadata = { title: "Costi e margini" };

export default async function PaginaCosti({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; dal?: string; al?: string; ord?: string; prova?: string }>;
}) {
  await richiediAdminPagina();
  const parametri = await searchParams;
  const periodo = calcolaPeriodo(parametri, new Date());
  const ordine = leggiOrdineCosti(parametri.ord);
  const includiProva = parametri.prova === "1";
  const costi = await leggiCosti(periodo, { includiProva });

  return (
    <CostiVista
      periodo={periodo}
      ordine={ordine}
      costi={costi}
      righeOrdinate={costi.stato === "ok" ? ordinaClienti(costi.righe, ordine) : []}
      stripeInProva={stripeOmniaAiInProva()}
      includiProva={includiProva}
      providerConfigurati={providerConfigurati()}
      azioneParametri={salvaParametri}
    />
  );
}
