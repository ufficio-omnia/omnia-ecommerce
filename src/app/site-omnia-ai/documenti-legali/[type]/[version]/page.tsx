import type { Metadata } from "next";
import type { ReactElement } from "react";
import { notFound } from "next/navigation";
import PageShell from "@/components/omnia-ai/page-shell";
import PrivacyPolicyV1 from "@/components/omnia-ai/legal/privacy-policy-v1";
import CookiePolicyV1 from "@/components/omnia-ai/legal/cookie-policy-v1";
import CondizioniAbbonamentoV1 from "@/components/omnia-ai/legal/condizioni-abbonamento-v1";

// Registro delle versioni pubblicate dei documenti legali di omnia-ai.it,
// stesso pattern di src/app/(ecommerce)/documenti-legali/[type]/[version]/
// page.tsx: una voce per versione, mai toccata dopo la pubblicazione — una
// revisione aggiunge una voce nuova (es. "2": PrivacyPolicyV2), non
// sostituisce quella esistente, così un link raccolto al momento
// dell'accettazione continua a mostrare esattamente quel testo che era in
// vigore allora.
const REGISTRY: Record<string, Record<string, () => ReactElement>> = {
  "privacy-policy": { "1": PrivacyPolicyV1 },
  "cookie-policy": { "1": CookiePolicyV1 },
  "condizioni-abbonamento": { "1": CondizioniAbbonamentoV1 },
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
      <Componente />
    </PageShell>
  );
}
