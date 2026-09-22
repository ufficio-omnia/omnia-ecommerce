"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import BrandMark from "./brand-mark";
import { useMarchioStato } from "./marchio-stato-context";

// Unica fonte delle voci: la navigazione desktop e il menu mobile le
// leggono da qui, così non possono divergere. "Accedi" è a parte perché
// ha una veste diversa in entrambe.
const VOCI = [
  { href: "/come-funziona", label: "Come funziona" },
  { href: "/piani", label: "Piani" },
  { href: "/demo", label: "Demo" },
  { href: "/contatti", label: "Contatti" },
];

export default function SiteHeader() {
  const { stato } = useMarchioStato();
  const [aperto, setAperto] = useState(false);
  const idMenu = useId();
  const bottoneRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // preventScroll su ogni focus() qui sotto: l'header è sticky, e senza
  // questa opzione il browser scorrerebbe fino alla posizione originale
  // dell'elemento — la pagina saltava in cima alla chiusura del menu.
  const chiudi = useCallback((restituisciFocus = false) => {
    setAperto(false);
    if (restituisciFocus) bottoneRef.current?.focus({ preventScroll: true });
  }, []);

  // Tutto ciò che vale solo a menu aperto: blocco dello scroll sotto,
  // Esc, focus che non esce dal menu, chiusura se la finestra torna
  // larga. Ogni cosa si annulla nel cleanup, anche allo smontaggio.
  useEffect(() => {
    if (!aperto) return;

    const html = document.documentElement;
    const body = document.body;
    // Con una scrollbar classica (finestra stretta su desktop) togliere lo
    // scroll allargherebbe la pagina e la farebbe "saltare": si compensa.
    const larghezzaScrollbar = window.innerWidth - html.clientWidth;
    html.classList.add("omnia-menu-aperto");
    if (larghezzaScrollbar > 0) body.style.paddingRight = `${larghezzaScrollbar}px`;

    const voci = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>("a[href]") ?? []);
    voci()[0]?.focus({ preventScroll: true });

    const alTasto = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        chiudi(true);
        return;
      }
      if (e.key !== "Tab") return;
      // Ordine di tabulazione a menu aperto: pulsante (la X), poi le voci.
      const ciclo = [bottoneRef.current, ...voci()].filter((el): el is HTMLElement => el !== null);
      const primo = ciclo[0];
      const ultimo = ciclo[ciclo.length - 1];
      const attivo = document.activeElement as HTMLElement | null;
      if (e.shiftKey && attivo === primo) {
        e.preventDefault();
        ultimo.focus({ preventScroll: true });
      } else if (!e.shiftKey && attivo === ultimo) {
        e.preventDefault();
        primo.focus({ preventScroll: true });
      } else if (!attivo || !ciclo.includes(attivo)) {
        // Il focus è finito fuori (es. sul marchio): rientra nel menu.
        e.preventDefault();
        primo.focus({ preventScroll: true });
      }
    };
    document.addEventListener("keydown", alTasto);

    const desktop = window.matchMedia("(min-width: 901px)");
    const alCambioLarghezza = () => {
      if (desktop.matches) setAperto(false);
    };
    desktop.addEventListener("change", alCambioLarghezza);

    return () => {
      html.classList.remove("omnia-menu-aperto");
      body.style.paddingRight = "";
      document.removeEventListener("keydown", alTasto);
      desktop.removeEventListener("change", alCambioLarghezza);
    };
  }, [aperto, chiudi]);

  return (
    <>
      <header className="omnia-header">
        <div className="omnia-bar">
          <Link className="omnia-marchio" href="/" onClick={() => chiudi()}>
            <BrandMark stato={stato} />
            OMNIA AI
          </Link>
          <nav className="omnia-nav omnia-principale">
            {VOCI.map((v) => (
              <Link key={v.href} href={v.href}>
                {v.label}
              </Link>
            ))}
            <Link href="/login" className="omnia-accedi">
              Accedi
            </Link>
          </nav>
          {/* Visibile solo sotto i 900px, dove la navigazione sopra sparisce
              (vedi omnia-ai.css). */}
          <button
            ref={bottoneRef}
            type="button"
            className="omnia-hamburger"
            aria-label={aperto ? "Chiudi il menu" : "Apri il menu"}
            aria-expanded={aperto}
            aria-controls={idMenu}
            onClick={() => (aperto ? chiudi() : setAperto(true))}
          >
            <span className="omnia-hamburger-linea" aria-hidden="true" />
            <span className="omnia-hamburger-linea" aria-hidden="true" />
            <span className="omnia-hamburger-linea" aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Fratello dell'<header>, non figlio: l'header ha backdrop-filter, e
          un elemento con backdrop-filter diventa il riferimento dei figli
          position:fixed — il pannello non riempirebbe lo schermo. Da
          chiuso è visibility:hidden (fuori da tabulazione e da lettori di
          schermo), non display:none, per poter animare l'apertura. */}
      <div id={idMenu} ref={menuRef} className="omnia-menu-mobile" data-aperto={aperto}>
        <nav aria-label="Menu principale">
          {VOCI.map((v) => (
            <Link key={v.href} href={v.href} className="omnia-menu-voce" onClick={() => chiudi()}>
              {v.label}
            </Link>
          ))}
          <Link
            href="/login"
            className="omnia-btn omnia-btn-p omnia-menu-accedi"
            onClick={() => chiudi()}
          >
            Accedi
          </Link>
        </nav>
      </div>
    </>
  );
}
