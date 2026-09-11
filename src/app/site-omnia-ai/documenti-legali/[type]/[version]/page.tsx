import type { Metadata } from "next";
import type { ReactElement } from "react";
import { notFound } from "next/navigation";
import PageShell from "@/components/omnia-ai/page-shell";

// Registro delle versioni pubblicate dei documenti legali di omnia-ai.it,
// stesso pattern di src/app/(ecommerce)/documenti-legali/[type]/[version]/
// page.tsx: una voce per versione, mai toccata dopo la pubblicazione — una
// revisione aggiunge una voce nuova (es. "2": PrivacyPolicyV2), non
// sostituisce quella esistente, così un link raccolto al momento
// dell'accettazione continua a mostrare esattamente quel testo che era in
// vigore allora. I componenti andranno in src/components/omnia-ai/legal/,
// uno per versione pubblicata (mai modificato dopo).
//
// Vuoto finché non arrivano i testi reali e le relative righe in
// legal_documents (vedi supabase/migrations/0051_omnia_ai_legal_documents.sql):
// una richiesta a qualunque versione dà 404 fino ad allora, correttamente.
const REGISTRY: Record<string, Record<string, () => ReactElement>> = {
  "privacy-policy": {},
  "cookie-policy": {},
  "condizioni-abbonamento": {},
};

const TITLES: Record<string, string> = {
  "privacy-policy": "Privacy policy",
  "cookie-policy": "Cookie policy",
  "condizioni-abbonamento": "Condizioni di abbonamento",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ type: string; version: string }>;
}): Promise<Metadata> {
  const { type, version } = await params;
  const title = TITLES[type];
  return {
    title: title ? `${title} — versione ${version} — OMNIA AI` : "Documento non trovato",
  };
}

export default async function DocumentoLegaleVersionatoPage({
  params,
}: {
  params: Promise<{ type: string; version: string }>;
}) {
  const { type, version } = await params;
  const Componente = REGISTRY[type]?.[version];

  if (!Componente) {
    notFound();
  }

  return (
    <PageShell>
      <section className="omnia-pagina-corpo">
        <div className="omnia-prosa">
          <Componente />
        </div>
      </section>
    </PageShell>
  );
}
