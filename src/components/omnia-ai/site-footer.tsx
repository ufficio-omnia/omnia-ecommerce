import Link from "next/link";
import CookiePreferencesButton from "./cookie-preferences-button";
import ClimateBadge from "./climate-badge";
import BrandMark from "./brand-mark";
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
      {/* Il marchio con lo slogan ufficiale (mai tradotto): chiude ogni pagina con l'identità del prodotto. */}
      <div className="omnia-footer-marchio">
        <Link className="omnia-marchio" href="/">
          <BrandMark />
          OMNIA AI
        </Link>
        <p className="omnia-footer-descrizione">
          Intelligenza artificiale per gare d&apos;appalto e offerte tecniche, nata dall&apos;esperienza di professionisti che
          lavorano nel settore da oltre dieci anni.
        </p>
        <p className="omnia-slogan omnia-footer-slogan" lang="en">
          <span className="omnia-slogan-tech">TECH WHEN POSSIBLE.</span>{" "}
          <span className="omnia-slogan-human">HUMAN WHEN IT MATTERS.</span>
        </p>
      </div>
      {/* In alto i collegamenti (a sinistra) e il badge di Stripe Climate (a destra); in basso, dopo una linea sottile, la riga legale. */}
      <div className="omnia-footer-alto">
        <nav>
          <Link href="/come-funziona">Come funziona</Link>
          <Link href="/piani">Piani</Link>
          <Link href="/demo">Demo</Link>
          <Link href="/login">Accedi</Link>
          <a href="https://omniaitalia.com">omniaitalia.com</a>
          <Link href="/contatti">Contatti</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/riservatezza">Riservatezza</Link>
          <Link href={condizioniUrl}>Condizioni</Link>
          <Link href="/cookie-policy">Cookie</Link>
          <CookiePreferencesButton />
        </nav>
        <div className="omnia-climate">
          <ClimateBadge />
        </div>
      </div>
      <p className="omnia-footer-basso">OMNIA AI — un prodotto di Omnia Consulting SRLS · P.IVA 02957590819</p>
    </footer>
  );
}
