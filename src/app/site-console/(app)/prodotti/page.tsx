import type { Metadata } from "next";
import { richiediAdminPagina } from "@/lib/console/accesso";
import { leggiProdotti } from "@/lib/console/prodotti";
import ProdottiVista from "../../_componenti/prodotti-vista";

export const metadata: Metadata = { title: "Prodotti e sconti" };

export default async function PaginaProdotti() {
  await richiediAdminPagina();
  return <ProdottiVista letti={await leggiProdotti()} />;
}
