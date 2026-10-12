import type { Metadata } from "next";
import { richiediAdminPagina } from "@/lib/console/accesso";
import { leggiFatturazione } from "@/lib/console/fatturazione";
import { leggiFiltroFattura } from "@/lib/console/fatturazione-calcoli";
import { dataRoma } from "@/lib/console/giorni-lavorativi";
import { aggiornaStatoFattura, aggiornaStatoFatturaMultiplo } from "../../azioni/fatturazione";
import FatturazioneVista from "../../_componenti/fatturazione-vista";

export const metadata: Metadata = { title: "Da fatturare" };

export default async function PaginaFatturazione({
  searchParams,
}: {
  searchParams: Promise<{ stato?: string; prova?: string; esito?: string; n?: string; nuovo?: string }>;
}) {
  await richiediAdminPagina();
  const parametri = await searchParams;
  const includiProva = parametri.prova === "1";
  const dati = await leggiFatturazione({ includiProva });

  return (
    <FatturazioneVista
      dati={dati}
      filtro={leggiFiltroFattura(parametri.stato)}
      includiProva={includiProva}
      esito={{ esito: parametri.esito, n: parametri.n, nuovo: parametri.nuovo }}
      oggi={dataRoma(new Date())}
      azioneStato={aggiornaStatoFattura}
      azioneMultipla={aggiornaStatoFatturaMultiplo}
    />
  );
}
