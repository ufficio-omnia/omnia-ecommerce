import type { Metadata } from "next";
import type { ReactElement } from "react";
import { notFound } from "next/navigation";
import PrivacyPolicyV1 from "@/components/legal/privacy-policy-v1";
import CookiePolicyV1 from "@/components/legal/cookie-policy-v1";
import CondizioniVenditaV1 from "@/components/legal/condizioni-vendita-v1";

// Registro delle versioni pubblicate: quando un documento viene rivisto
// si aggiunge una nuova voce (es. "2": CondizioniVenditaV2) senza mai
// toccare le precedenti, così un link raccolto in un vecchio ordine
// continua a mostrare esattamente il testo che era in vigore allora.
const REGISTRY: Record<string, Record<string, () => ReactElement>> = {
  "privacy-policy": { "1": PrivacyPolicyV1 },
  "cookie-policy": { "1": CookiePolicyV1 },
  "condizioni-vendita": { "1": CondizioniVenditaV1 },
};

const TITLES: Record<string, string> = {
  "privacy-policy": "Privacy policy",
  "cookie-policy": "Cookie policy",
  "condizioni-vendita": "Condizioni di vendita",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ type: string; version: string }>;
}): Promise<Metadata> {
  const { type, version } = await params;
  const title = TITLES[type];
  return {
    title: title ? `${title} — versione ${version}` : "Documento non trovato",
  };
}

export default async function DocumentoLegaleVersionatoPage({
  params,
}: {
  params: Promise<{ type: string; version: string }>;
}) {
  const { type, version } = await params;
  const Component = REGISTRY[type]?.[version];

  if (!Component) {
    notFound();
  }

  return <Component />;
}
