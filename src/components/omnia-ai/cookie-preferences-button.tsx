"use client";

import { resetOmniaAiCookieConsent } from "./cookie-consent";

// Estratto da site-footer.tsx perché quest'ultimo è diventato un Server
// Component (deve interrogare legal_documents per il link "Condizioni"
// alla versione vigente): solo questo pulsante resta client, per l'onClick.
export default function CookiePreferencesButton() {
  return (
    <button
      type="button"
      onClick={resetOmniaAiCookieConsent}
      style={{ background: "none", border: 0, color: "inherit", font: "inherit", cursor: "pointer", padding: 0 }}
    >
      Preferenze cookie
    </button>
  );
}
