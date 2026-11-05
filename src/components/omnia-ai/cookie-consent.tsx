"use client";

import { useEffect, useSyncExternalStore } from "react";
import { aggiornaConsensoGoogle, cancellaCookieGoogle, type FinestraGoogle } from "@/lib/google-tag";

const CONSENT_KEY = "omnia-ai-cookie-consent";
const CONSENT_EVENT = "omnia-ai-consent-change";

// Il Google tag (Analytics + Google Ads, gli ID stanno solo in src/lib/google-tag.ts) NON si carica più da qui: sta nell'HTML iniziale del layout
// (src/app/site-omnia-ai/layout.tsx, un solo gtag.js) in Consent Mode v2 AVANZATO, con i quattro consensi su «denied» finché il
// visitatore non preme «Accetta». Questo banner conserva la scelta (stessa chiave, stesso evento, stesso testo di prima) e la comunica a
// Google: «Accetta» → consensi «granted»; «Rifiuta», ignorare il banner o revocare da «Preferenze cookie» → «denied», e alla revoca si
// cancellano i cookie di Google già scritti. Vedi src/lib/google-tag.ts e GUIDA-GOOGLE-TAG-CONSENT-MODE.md.

type Consent = "pending" | "accepted" | "rejected";

// Comunica a Google il consenso e, se era concesso ed è stato revocato, toglie dal browser i cookie di Google. Idempotente.
function sincronizzaConsensoGoogle(stato: Consent) {
  const esito = aggiornaConsensoGoogle(stato, window as unknown as FinestraGoogle);
  if (esito === "revocato") cancellaCookieGoogle(document, window.location.hostname);
}

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
  sincronizzaConsensoGoogle(value);
}

// Usata dal link "Preferenze cookie" nel footer: rimette il banner in
// stato "pending" invece di limitarsi a cancellare la scelta salvata.
export function resetOmniaAiCookieConsent() {
  localStorage.removeItem(CONSENT_KEY);
  window.dispatchEvent(new Event(CONSENT_EVENT));
  sincronizzaConsensoGoogle("pending");
}

export default function OmniaAiCookieConsent() {
  const status = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Tiene Google allineato alla scelta anche quando cambia da fuori (un'altra scheda del browser). Si legge la scelta VERA dal browser
  // (getSnapshot) e non `status`: durante l'idratazione `status` vale «pending» (lo stato del server) anche per chi ha già accettato, e
  // trattarlo come una revoca cancellerebbe i cookie di Google a ogni caricamento.
  useEffect(() => {
    sincronizzaConsensoGoogle(getSnapshot());
  }, [status]);

  return (
    <>
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
