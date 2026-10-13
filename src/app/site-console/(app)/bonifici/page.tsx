import type { Metadata } from "next";
import { richiediAdminPagina } from "@/lib/console/accesso";
import { leggiBonificiInAttesa } from "@/lib/console/ordini";
import { confermaBonifico } from "../../azioni/ordini";
import BonificiVista from "../../_componenti/bonifici-vista";

export const metadata: Metadata = { title: "Bonifici da confermare" };

export default async function PaginaBonifici({
  searchParams,
}: {
  searchParams: Promise<{ esito?: string; ordine?: string; email?: string; data?: string }>;
}) {
  await richiediAdminPagina();
  const [dati, esito] = await Promise.all([leggiBonificiInAttesa(), searchParams]);

  return <BonificiVista dati={dati} esito={esito} azioneConferma={confermaBonifico} />;
}
