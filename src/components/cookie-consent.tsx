"use client";

import { useSyncExternalStore } from "react";
import Script from "next/script";

const CONSENT_KEY = "omnia-cookie-consent";
const CONSENT_EVENT = "omnia-consent-change";
const GADS_ID = "AW-18422155730";

type Consent = "pending" | "accepted" | "rejected";

// localStorage è un "external store": niente useState+useEffect (il
// linter del progetto segnala setState dentro effect come anti-pattern),
// ma useSyncExternalStore, pensato apposta per questo caso. L'evento
// custom serve perché "storage" si attiva solo sulle ALTRE schede, mai
// su quella che ha fatto la scrittura.
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(CONSENT_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CONSENT_EVENT, callback);
  };
}

function getSnapshot(): Consent {
  const stored = localStorage.getItem(CONSENT_KEY);
  return stored === "accepted" || stored === "rejected" ? stored : "pending";
}

// Il server non conosce localStorage: l'HTML iniziale non include mai lo
// script del tag, in nessuna forma, finché il client non conferma un
// consenso già dato in passato.
function getServerSnapshot(): Consent {
  return "pending";
}

function setConsent(value: "accepted" | "rejected") {
  localStorage.setItem(CONSENT_KEY, value);
  window.dispatchEvent(new Event(CONSENT_EVENT));
}

export default function CookieConsent() {
  const status = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  return (
    <>
      {status === "accepted" && (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${GADS_ID}`}
            strategy="afterInteractive"
          />
          <Script id="gtag-init" strategy="afterInteractive">
            {`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', '${GADS_ID}');
            `}
          </Script>
        </>
      )}

      {status === "pending" && (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-cream-soft px-4 py-4 shadow-lg sm:px-6">
          <div className="mx-auto flex max-w-5xl flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-sage sm:text-sm">
              Usiamo un cookie tecnico-pubblicitario (Google Ads) solo se
              acconsenti, per capire quali annunci portano contatti utili.
              Nessun dato viene venduto a terzi.
            </p>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => setConsent("rejected")}
                className="rounded-full border border-border-strong px-4 py-1.5 font-mono text-xs tracking-wide text-ink uppercase transition-colors hover:bg-ink hover:text-cream"
              >
                Rifiuta
              </button>
              <button
                type="button"
                onClick={() => setConsent("accepted")}
                className="rounded-full bg-forest px-4 py-1.5 font-mono text-xs tracking-wide text-cream uppercase transition-colors hover:bg-forest-dark"
              >
                Accetta
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
