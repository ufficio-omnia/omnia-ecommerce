import Link from "next/link";
import CookiePreferencesButton from "./cookie-preferences-button";
import { getCurrentOmniaAiCondizioniAbbonamentoUrl } from "@/lib/omnia-ai-legal";

// Server Component (non più "use client"): il link "Condizioni" punta
// alla versione vigente per data in legal_documents, non alla pagina
// statica — stessa logica del link a condizioni-vendita/privacy nella
// scheda prodotto dell'e-commerce. Il resto del footer non dipende dal
// DB e resta invariato.
export default async function SiteFooter() {
  const condizioniUrl = await getCurrentOmniaAiCondizioniAbbonamentoUrl();

  return (
    <footer className="omnia-footer" id="contatti">
      <span>OMNIA AI — un prodotto di Omnia Consulting SRLS · P.IVA 00000000000</span>
      <nav>
        <a href="https://omniaitalia.com">omniaitalia.com</a>
        <Link href="/contatti">Contatti</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href={condizioniUrl}>Condizioni</Link>
        <Link href="/cookie-policy">Cookie</Link>
        <CookiePreferencesButton />
      </nav>
    </footer>
  );
}
