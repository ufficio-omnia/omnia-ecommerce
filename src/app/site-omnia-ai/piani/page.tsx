import type { Metadata } from "next";
import { getCurrentOmniaAiCondizioniAbbonamentoUrl } from "@/lib/omnia-ai-legal";
import { getCatalogoPiani } from "@/lib/omnia-ai-catalogo";
import { paginaMetadata } from "@/lib/omnia-ai-seo";
import { venditaAbbonamentiVisibile } from "@/lib/omnia-ai-vendita";
import PianiVista from "./piani-vista";

export const metadata: Metadata = paginaMetadata({
  title: "Piani e prezzi — OMNIA AI",
  description:
    "Piani e prezzi di OMNIA AI: abbonamento mensile con gare incluse per generare la relazione tecnica delle tue gare d'appalto in Word.",
  path: "/piani",
});

export default async function PianiPage() {
  const [condizioniUrl, catalogo, vendita] = await Promise.all([getCurrentOmniaAiCondizioniAbbonamentoUrl(), getCatalogoPiani(), venditaAbbonamentiVisibile()]);
  return <PianiVista catalogo={catalogo} condizioniUrl={condizioniUrl} vendita={vendita} />;
}
