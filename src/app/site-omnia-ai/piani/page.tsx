import type { Metadata } from "next";
import { getCurrentOmniaAiCondizioniAbbonamentoUrl } from "@/lib/omnia-ai-legal";
import { getCatalogoPiani } from "@/lib/omnia-ai-catalogo";
import { paginaMetadata } from "@/lib/omnia-ai-seo";
import { venditaAbbonamentiVisibile } from "@/lib/omnia-ai-vendita";
import { leggiPrezzoPianoLavoro } from "@/lib/piano-lavoro-acquisto";
import PianiVista from "./piani-vista";

export const metadata: Metadata = paginaMetadata({
  title: "Piani e prezzi — OMNIA AI",
  description:
    "Piani e prezzi di OMNIA AI: abbonamento mensile con gare incluse per generare la relazione tecnica delle tue gare d'appalto in Word.",
  path: "/piani",
});

export default async function PianiPage() {
  const [condizioniUrl, catalogo, vendita] = await Promise.all([getCurrentOmniaAiCondizioniAbbonamentoUrl(), getCatalogoPiani(), venditaAbbonamentiVisibile()]);
  // il prezzo del piano di lavoro della singola gara si mostra sempre, come i prezzi dei piani: letto dalla console. Il supplemento mensile
  // nell'abbonamento non si legge e non si mostra più (il piano di lavoro non si compra con l'abbonamento: decisione del 09/11/2026).
  const prezzoSingolaGara = await leggiPrezzoPianoLavoro();
  return <PianiVista catalogo={catalogo} condizioniUrl={condizioniUrl} vendita={vendita} prezzoSingolaGaraCentesimi={prezzoSingolaGara} />;
}
