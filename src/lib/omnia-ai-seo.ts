import type { Metadata } from "next";
import { OMNIA_AI_BASE_URL } from "@/lib/zone";

export const OMNIA_AI_NOME = "OMNIA AI";

// Stessi nomi in Organization e WebSite (JSON-LD della home): Google li
// usa per riconoscere "OMNIA AI" e le sue varianti come lo stesso sito.
export const OMNIA_AI_NOMI_ALTERNATIVI = ["OMNIA Intelligenza Artificiale", "Omnia AI"];

// Metadata delle pagine pubbliche di omnia-ai.it: title, description,
// canonical, Open Graph e Twitter card, composti in un punto solo.
//
// Perché un helper e non `openGraph` scritto in ogni pagina: Next.js fonde
// i metadata dei segmenti in modo SUPERFICIALE, quindi una pagina che
// definisce `openGraph` cancella per intero quello del layout (siteName,
// locale...). Passando da qui ogni pagina ha sempre l'oggetto completo.
//
// `path` è il percorso PUBBLICO ("/piani"), non quello interno
// (/site-omnia-ai/piani): il proxy riscrive gli URL per zona, e un
// canonical relativo ("./") potrebbe risolvere sul percorso interno.
// Diventa assoluto con `metadataBase` di src/app/site-omnia-ai/layout.tsx
// (https://omnia-ai.it).
//
// L'immagine social è quella di src/app/site-omnia-ai/opengraph-image.tsx,
// ma va dichiarata ANCHE qui: quel file vale per la sola pagina del suo
// stesso segmento (la home), mentre per le pagine figlie l'`openGraph`
// definito qui sotto sostituisce quello ereditato, immagine compresa —
// senza `images` restavano senza og:image (verificato in pratica).
const OG_IMAGE_PATH = "/site-omnia-ai/opengraph-image";
// Stesso testo di `alt` in opengraph-image.tsx.
const OG_IMAGE_ALT = "OMNIA AI — intelligenza artificiale per gare d'appalto";

export function paginaMetadata({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: OMNIA_AI_NOME,
      locale: "it_IT",
      url: path,
      title,
      description,
      images: [{ url: OG_IMAGE_PATH, width: 1200, height: 630, alt: OG_IMAGE_ALT }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [{ url: OG_IMAGE_PATH, alt: OG_IMAGE_ALT }],
    },
  };
}

// Percorso pubblico dell'immagine del logo per il JSON-LD (Organization).
export const OMNIA_AI_LOGO_URL = `${OMNIA_AI_BASE_URL}/site-omnia-ai/logo.png`;
