"use client";

import { useSyncExternalStore } from "react";
import Script from "next/script";
import { ZONE_COOKIE } from "@/lib/zone";

const CONSENT_KEY = "omnia-cookie-consent";
const CONSENT_EVENT = "omnia-consent-change";
const GADS_ID = "AW-18422155730";

// Il tag Google Ads è una cosa dell'e-commerce (misura le conversioni di
// vendita documenti): fuori da quella zona (omnia-ai.it, console.*) non
// deve montarsi né il banner né lo script, prima ancora che quei domini
// abbiano una propria informativa cookie — indipendentemente da quale
// consenso risulti nel localStorage locale a quel dominio. Letto da un
// cookie semplice (non da headers(), per non rendere dinamico l'intero
// root layout condiviso, e-commerce incluso — vedi src/proxy.ts).
//
// Stesso motivo di useSyncExternalStore per il consenso qui sotto: il
// server non conosce il cookie di zona nel render iniziale, quindi la
// prima passata client (idratazione) deve assumere "ecommerce" come il
// server — leggere document.cookie direttamente nel corpo del componente
// darebbe un mismatch di idratazione ogni volta che la zona reale è
// diversa. getZoneSnapshot/getZoneServerSnapshot seguono lo stesso
// pattern di getSnapshot/getServerSnapshot sotto.
function subscribeNever() {
  return () => {};
}

function getZoneSnapshot(): string {
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${ZONE_COOKIE}=([^;]*)`),
  );
  return match ? decodeURIComponent(match[1]) : "ecommerce";
}

function getZoneServerSnapshot(): string {
  return "ecommerce";
}

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

// Usata dal link "Preferenze cookie" nel piè di pagina: la Cookie policy
// promette che si possa cambiare idea in qualsiasi momento, quindi deve
// rimettere il banner nello stato "pending" invece di limitarsi a
// cancellare la scelta salvata.
export function resetCookieConsent() {
  localStorage.removeItem(CONSENT_KEY);
  window.dispatchEvent(new Event(CONSENT_EVENT));
}

export default function CookieConsent() {
  const status = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  // Guardia di zona: il tag Google Ads e il banner di consenso servono
  // solo all'e-commerce. Lo script resta comunque bloccato in ogni caso
  // (status è sempre "pending" nel render server/idratazione, vedi
  // getServerSnapshot) — questo controllo evita che il banner resti
  // visibile dopo l'idratazione su un dominio diverso dall'e-commerce.
  const zone = useSyncExternalStore(
    subscribeNever,
    getZoneSnapshot,
    getZoneServerSnapshot,
  );
  if (zone === "omnia-ai" || zone === "console") return null;

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
