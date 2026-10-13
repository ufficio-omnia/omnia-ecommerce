import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PageShell from "@/components/omnia-ai/page-shell";
import DocumentoLegaleVersionato, { TITOLI_DOCUMENTI, versioneEsiste } from "@/components/omnia-ai/legal/documento-legale-versionato";

// Pagina di ogni versione pubblicata di un documento legale di omnia-ai.it, stesso
// pattern di src/app/(ecommerce)/documenti-legali/[type]/[version]/page.tsx. Le
// versioni sono registrate in documento-legale-versionato.tsx: una revisione aggiunge
// una voce, non ne sostituisce una esistente.

// Pagina pubblica "corrente" di ciascun documento: le versioni archiviate
// (/documenti-legali/<tipo>/<n>) ne dichiarano il canonical, così Google
// le tratta come duplicati e indicizza solo quella. L'Allegato A non ha una pagina
// «corrente» a parte: ogni sua versione è l'unico indirizzo di quel testo.
const CANONICAL_PATHS: Record<string, string> = {
  "privacy-policy": "/privacy",
  "cookie-policy": "/cookie-policy",
  "condizioni-abbonamento": "/condizioni-abbonamento",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ type: string; version: string }>;
}): Promise<Metadata> {
  const { type, version } = await params;
  const title = TITOLI_DOCUMENTI[type];
  const canonical = CANONICAL_PATHS[type];
  return {
    title: title ? `${title} — versione ${version} — OMNIA AI` : "Documento non trovato",
    ...(canonical ? { alternates: { canonical } } : {}),
    // l'Allegato A pubblico è il modello con i campi da compilare: non ha ragione di comparire nei risultati di ricerca
    ...(type === "allegato-a" ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function DocumentoLegaleVersionatoPage({
  params,
}: {
  params: Promise<{ type: string; version: string }>;
}) {
  const { type, version } = await params;

  if (!versioneEsiste(type, version)) {
    notFound();
  }

  return (
    <PageShell>
      <DocumentoLegaleVersionato slug={type} version={version} />
    </PageShell>
  );
}
