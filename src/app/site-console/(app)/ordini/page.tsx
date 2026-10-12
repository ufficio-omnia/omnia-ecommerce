import type { Metadata } from "next";
import { richiediAdminPagina } from "@/lib/console/accesso";
import { filtraOrdini, leggiFiltroStato, leggiOrdini } from "@/lib/console/ordini";
import { caricaFattura, eliminaOrdine } from "../../azioni/ordini";
import OrdiniVista from "../../_componenti/ordini-vista";

export const metadata: Metadata = { title: "Ordini" };

export default async function PaginaOrdini({
  searchParams,
}: {
  searchParams: Promise<{ stato?: string; q?: string; esito?: string; ordine?: string; email?: string }>;
}) {
  await richiediAdminPagina();
  const [elenco, parametri] = await Promise.all([leggiOrdini(), searchParams]);

  const stato = leggiFiltroStato(parametri.stato);
  const q = (parametri.q ?? "").slice(0, 100);

  return (
    <OrdiniVista
      elenco={elenco}
      righe={filtraOrdini(elenco.righe, stato, q)}
      conteggi={{
        tutti: elenco.righe.length,
        inAttesa: elenco.righe.filter((r) => r.stato !== "pagato").length,
        pagati: elenco.righe.filter((r) => r.stato === "pagato").length,
      }}
      stato={stato}
      q={q}
      esito={{ esito: parametri.esito, ordine: parametri.ordine, email: parametri.email }}
      azioneFattura={caricaFattura}
      azioneElimina={eliminaOrdine}
    />
  );
}
