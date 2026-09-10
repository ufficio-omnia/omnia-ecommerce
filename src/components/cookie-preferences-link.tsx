"use client";

import { resetCookieConsent } from "./cookie-consent";

export default function CookiePreferencesLink() {
  return (
    <button type="button" onClick={resetCookieConsent} className="hover:text-ink">
      Preferenze cookie
    </button>
  );
}
