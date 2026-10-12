import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./console.css";

// Root layout indipendente, terzo dopo (ecommerce) e site-omnia-ai: <html>
// proprio, foglio di stile proprio senza Tailwind, font propri. Nessuna
// variabile, colore o font degli altri due sistemi visivi può entrare qui, né
// il contrario. Niente banner cookie né pubblicità: è uno strumento interno.
const sans = Geist({ variable: "--font-cn-sans", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-cn-mono", subsets: ["latin"] });

// Mai indicizzata: oltre a questi metadati ci sono il Disallow di robots.ts e
// l'intestazione X-Robots-Tag di next.config.ts, che copre anche gli asset.
export const metadata: Metadata = {
  title: { default: "Console OMNIA", template: "%s · Console OMNIA" },
  robots: { index: false, follow: false, noarchive: true, nosnippet: true, nocache: true },
};

export const viewport: Viewport = {
  themeColor: "#0b0d10",
  colorScheme: "dark",
};

export default function ConsoleRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
