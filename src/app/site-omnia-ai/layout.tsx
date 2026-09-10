import type { Metadata, Viewport } from "next";
import "./omnia-ai.css";

// Root layout indipendente (route group multipli, vedi src/app/(ecommerce)/layout.tsx):
// <html> proprio, mai condiviso con l'e-commerce — nessuna variabile CSS,
// font o colore di questo sistema visivo può trapelare sull'altro dominio.
export const metadata: Metadata = {
  title: "OMNIA AI",
};

export const viewport: Viewport = {
  themeColor: "#050509",
  colorScheme: "dark",
};

export default function OmniaAiRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  );
}
