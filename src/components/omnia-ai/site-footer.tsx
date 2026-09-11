"use client";

import Link from "next/link";
import { resetOmniaAiCookieConsent } from "./cookie-consent";

export default function SiteFooter() {
  return (
    <footer className="omnia-footer" id="contatti">
      <span>OMNIA AI — un prodotto di Omnia Consulting SRLS · P.IVA 00000000000</span>
      <nav>
        <a href="https://omniaitalia.com">omniaitalia.com</a>
        <Link href="/contatti">Contatti</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/condizioni-abbonamento">Condizioni</Link>
        <Link href="/cookie-policy">Cookie</Link>
        <button
          type="button"
          onClick={resetOmniaAiCookieConsent}
          style={{ background: "none", border: 0, color: "inherit", font: "inherit", cursor: "pointer", padding: 0 }}
        >
          Preferenze cookie
        </button>
      </nav>
    </footer>
  );
}
