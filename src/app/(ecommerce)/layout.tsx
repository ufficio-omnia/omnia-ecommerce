import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import SiteHeader from "@/components/site-header";
import SiteFooter from "@/components/site-footer";
import CheckoutHeader from "@/components/checkout-header";
import SiteChrome from "@/components/site-chrome";
import CookieConsent from "@/components/cookie-consent";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz", "SOFT", "WONK"],
});

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: {
    default: "Omnia Consulting",
    template: "%s | Omnia Consulting",
  },
  description:
    "Documenti pronti per gare d'appalto: facsimile, piani di lavoro e organigrammi da scaricare subito dopo il pagamento.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="it"
      className={`${fraunces.variable} ${plexSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-cream text-ink font-sans">
        <SiteChrome
          header={<SiteHeader />}
          checkoutHeader={<CheckoutHeader />}
          footer={<SiteFooter />}
        >
          {children}
        </SiteChrome>
        <CookieConsent />
      </body>
    </html>
  );
}
