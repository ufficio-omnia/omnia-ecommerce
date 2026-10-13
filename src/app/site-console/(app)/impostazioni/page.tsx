import type { Metadata } from "next";
import { getBankDetails } from "@/lib/bank-details";
import { richiediAdminPagina } from "@/lib/console/accesso";
import { leggiParametriCalcolo } from "@/lib/console/costi";
import ImpostazioniVista from "../../_componenti/impostazioni-vista";

export const metadata: Metadata = { title: "Impostazioni" };

export default async function PaginaImpostazioni() {
  await richiediAdminPagina();
  const [banca, parametri] = await Promise.all([getBankDetails(), leggiParametriCalcolo()]);
  return <ImpostazioniVista banca={banca} parametri={parametri} />;
}
