"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { aggiornaConsensoGoogle, cancellaCookieGoogle, CHIAVE_VERSIONE_CONSENSO, type FinestraGoogle } from "@/lib/google-tag";
import { TESTO_BANNER_COOKIE, VERSIONE_BANNER_COOKIE } from "@/lib/demo-consensi-calcoli";

const CONSENT_KEY = "omnia-ai-cookie-consent";
const CONSENT_EVENT = "omnia-ai-consent-change";
const CONSENT_VERSION_KEY = CHIAVE_VERSIONE_CONSENSO;

// Il Google tag (Analytics + Google Ads, gli ID stanno solo in src/lib/google-tag.ts) NON si carica più da qui: sta nell'HTML iniziale del layout
// (src/app/site-omnia-ai/layout.tsx, un solo gtag.js) in Consent Mode v2 AVANZATO, con i quattro consensi su «denied» finché il
// visitatore non preme «Accetta». Questo banner conserva la scelta (stessa chiave e stesso evento di prima) e la comunica a Google:
// «Accetta» → consensi «granted»; «Rifiuta», ignorare il banner o revocare da «Preferenze cookie» → «denied», e alla revoca si cancellano i
// cookie di Google già scritti. Il testo è UNO solo e sta in src/lib/demo-consensi-calcoli.ts (lo stesso che si registra nei consensi delle
// richieste, con la sua versione): la scelta si salva con la versione del testo visto, e una scelta fatta con una versione precedente non
// vale più. Vedi src/lib/google-tag.ts e GUIDA-GOOGLE-TAG-CONSENT-MODE.md.

// il testo ha le parole «Cookie policy» una sola volta: diventano il collegamento
const [TESTO_PRIMA_DEL_LINK, TESTO_DOPO_IL_LINK] = TESTO_BANNER_COOKIE.split("Cookie policy");

type Consent = "pending" | "accepted" | "rejected";

// Comunica a Google il consenso e, senza un consenso valido (revoca, rifiuto, banner ignorato, scelta fatta con un testo precedente), toglie
// dal browser i cookie di Google: anche quelli scritti prima di questo rilascio da chi aveva accettato con il vecchio testo e ora rifiuta
// (senza questo resterebbero per anni, inerti ma presenti, contro la promessa «se rifiuti non resta nessun cookie di Google»). Se non ce ne
// sono, non fa niente. Idempotente.
function sincronizzaConsensoGoogle(stato: Consent) {
  aggiornaConsensoGoogle(stato, window as unknown as FinestraGoogle);
  if (stato !== "accepted") cancellaCookieGoogle(document, window.location.hostname);
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

// La scelta vale solo se è stata fatta con la versione ATTUALE del testo del banner; altrimenti si considera «in attesa» (lo snippet nell'<head>
// la cancella anche dal browser a ogni caricamento, così gli altri lettori della chiave — GCLID, modulo DEMO — non la vedono).
function getSnapshot(): Consent {
  const stored = localStorage.getItem(CONSENT_KEY);
  const versioneAttuale = localStorage.getItem(CONSENT_VERSION_KEY) === VERSIONE_BANNER_COOKIE;
  return versioneAttuale && (stored === "accepted" || stored === "rejected") ? stored : "pending";
}

// Il server non conosce localStorage: l'HTML iniziale non include mai lo
// script del tag, in nessuna forma, finché il client non conferma un
// consenso già dato in passato.
function getServerSnapshot(): Consent {
  return "pending";
}

function setConsent(value: "accepted" | "rejected") {
  localStorage.setItem(CONSENT_KEY, value);
  localStorage.setItem(CONSENT_VERSION_KEY, VERSIONE_BANNER_COOKIE);
  window.dispatchEvent(new Event(CONSENT_EVENT));
  sincronizzaConsensoGoogle(value);
}

// Usata dal link "Preferenze cookie" nel footer: rimette il banner in
// stato "pending" invece di limitarsi a cancellare la scelta salvata.
export function resetOmniaAiCookieConsent() {
  localStorage.removeItem(CONSENT_KEY);
  localStorage.removeItem(CONSENT_VERSION_KEY);
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
            <p style={{ fontSize: 13, color: "var(--fioco)", textAlign: "left", maxWidth: "78ch" }}>
              {TESTO_PRIMA_DEL_LINK}
              <Link href="/cookie-policy" style={{ color: "inherit", textDecoration: "underline" }}>
                Cookie policy
              </Link>
              {TESTO_DOPO_IL_LINK}
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
