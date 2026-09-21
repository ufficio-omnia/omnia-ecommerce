import type { Metadata, Viewport } from "next";
import "./omnia-ai.css";
import OmniaAiCookieConsent from "@/components/omnia-ai/cookie-consent";
import { OMNIA_AI_BASE_URL } from "@/lib/zone";

// Root layout indipendente (route group multipli, vedi src/app/(ecommerce)/layout.tsx):
// <html> proprio, mai condiviso con l'e-commerce — nessuna variabile CSS,
// font o colore di questo sistema visivo può trapelare sull'altro dominio.
//
// metadataBase rende assoluti gli URL relativi dei metadata (canonical,
// og:url, og:image) sul dominio canonico di omnia-ai.it, anche in sviluppo
// e sulle preview: un'anteprima non deve mai dichiararsi canonica di sé.
export const metadata: Metadata = {
  metadataBase: new URL(OMNIA_AI_BASE_URL),
  title: "OMNIA AI",
};

export const viewport: Viewport = {
  themeColor: "#050509",
  colorScheme: "dark",
};

export default function OmniaAiRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body>
        {children}
        <OmniaAiCookieConsent />
      </body>
    </html>
  );
}
