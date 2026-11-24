"use client";

import { useEffect, useRef } from "react";

// Pannello dei filtri: su smartphone è chiuso dietro «Filtri (n)»; da 901 px in su si apre da solo al primo disegno (nessuna richiesta, nessun
// controllo periodico: solo la larghezza della finestra, letta una volta).
export default function PannelloFiltri({ attivi, children }: { attivi: number; children: React.ReactNode }) {
  const rif = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (rif.current && window.matchMedia("(min-width: 901px)").matches) rif.current.open = true;
  }, []);
  return (
    <details ref={rif} className="omnia-opp-filtri">
      <summary>
        Filtri{attivi > 0 ? ` (${attivi})` : ""}
      </summary>
      <div className="omnia-opp-filtri-corpo">{children}</div>
    </details>
  );
}
