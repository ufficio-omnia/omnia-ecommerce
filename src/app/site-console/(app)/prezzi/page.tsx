import type { Metadata } from "next";
import { richiediAdminPagina } from "@/lib/console/accesso";
import { leggiPrezziConsole } from "@/lib/console/prezzi";
import { leggiControlloStripe } from "@/lib/console/controllo-stripe";
import { leggiInterruttoreVendita } from "@/lib/omnia-ai-vendita";
import { giornoRoma } from "@/lib/omnia-ai-catalogo-calcoli";
import PrezziVista from "../../_componenti/prezzi-vista";

export const metadata: Metadata = { title: "Piani e prezzi" };

// Il controllo admin sta qui oltre che nel layout: il layout non si riesegue nelle navigazioni interne.
export default async function PaginaPrezzi() {
  await richiediAdminPagina();
  const [dati, controllo, interruttore] = await Promise.all([leggiPrezziConsole(), leggiControlloStripe(), leggiInterruttoreVendita()]);
  return <PrezziVista dati={dati} controllo={controllo} interruttore={interruttore} oggi={giornoRoma(new Date())} />;
}
