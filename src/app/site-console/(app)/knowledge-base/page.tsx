import type { Metadata } from "next";
import { richiediAdminPagina } from "@/lib/console/accesso";
import { leggiKnowledgeBase } from "@/lib/console/knowledge-base";
import KnowledgeBaseVista from "../../_componenti/knowledge-base-vista";

export const metadata: Metadata = { title: "Knowledge base AI" };

// Il caricamento di un documento (estrazione, anonimizzazione, note di stile,
// indicizzazione) è sincrono e può richiedere minuti. Next.js applica il maxDuration
// della PAGINA anche alle Server Action che da essa partono (stessa scelta delle
// pagine di OMNIA AI): senza, vale il tetto predefinito e un documento lungo
// resterebbe «in elaborazione» a metà.
export const maxDuration = 300;

export default async function PaginaKnowledgeBase() {
  await richiediAdminPagina();
  return <KnowledgeBaseVista letta={await leggiKnowledgeBase()} />;
}
