"use client";

import { useSyncExternalStore } from "react";
import Script from "next/script";

const CONSENT_KEY = "omnia-ai-cookie-consent";
const CONSENT_EVENT = "omnia-ai-consent-change";

// Nessun ID Google Ads collegato per ora — logica di consenso pronta,
// il tag resta bloccato comunque (mai da CDN/script prima del consenso)
// finché questo non viene valorizzato. Quando arriva l'ID, basta
// scriverlo qui: il resto del componente non cambia.
const GADS_ID: string | null = null;

type Consent = "pending" | "accepted" | "rejected";

// Stessa logica del banner e-commerce (src/components/cookie-consent.tsx):
// localStorage come "external store" con useSyncExternalStore, chiave e
// nome evento separati perché sono due consensi indipendenti (domini
// diversi in produzione, ma anche in sviluppo — dove il dominio è sempre
// "localhost" — non devono influenzarsi a vicenda).
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

// Usata dal link "Preferenze cookie" nel footer: rimette il banner in
// stato "pending" invece di limitarsi a cancellare la scelta salvata.
export function resetOmniaAiCookieConsent() {
  localStorage.removeItem(CONSENT_KEY);
  window.dispatchEvent(new Event(CONSENT_EVENT));
}

export default function OmniaAiCookieConsent() {
  const status = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    <>
      {status === "accepted" && GADS_ID && (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${GADS_ID}`} strategy="afterInteractive" />
          <Script id="omnia-ai-gtag-init" strategy="afterInteractive">
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
        <div
          style={{
            position: "fixed",
            insetInline: 0,
            bottom: 0,
            zIndex: 50,
            borderTop: "1px solid var(--bordo)",
            background: "rgba(11,10,22,.92)",
            backdropFilter: "blur(14px)",
            padding: "16px 24px",
          }}
        >
          <div
            style={{
              maxWidth: 1160,
              margin: "0 auto",
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <p style={{ fontSize: 13, color: "var(--fioco)", textAlign: "left", maxWidth: "60ch" }}>
              Usiamo un cookie tecnico-pubblicitario solo se acconsenti, per capire quali annunci
              portano contatti utili. Nessun dato viene venduto a terzi.
            </p>
            <div style={{ display: "flex", flexShrink: 0, gap: 8 }}>
              <button type="button" onClick={() => setConsent("rejected")} className="omnia-btn omnia-btn-s">
                Rifiuta
              </button>
              <button type="button" onClick={() => setConsent("accepted")} className="omnia-btn omnia-btn-p">
                Accetta
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
