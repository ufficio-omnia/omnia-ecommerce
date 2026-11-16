"use client";

import { useId, useRef, useState } from "react";

type Voce = { domanda: string; risposta: string };

export default function FaqAccordion({ voci }: { voci: Voce[] }) {
  const [aperta, setAperta] = useState<number | null>(null);
  // Misurata al click (un ref si legge in un event handler, mai durante
  // il render) e congelata in stato: la risposta è testo statico, non
  // serve rimisurarla ad ogni render mentre resta aperta.
  const [altezzaAperta, setAltezzaAperta] = useState<number | undefined>(undefined);
  const risposteRef = useRef<(HTMLDivElement | null)[]>([]);
  // collega ogni domanda alla sua risposta (aria-controls) per i lettori di schermo
  const base = useId();

  function toggle(i: number) {
    if (aperta === i) {
      setAperta(null);
      return;
    }
    setAltezzaAperta(risposteRef.current[i]?.scrollHeight ?? undefined);
    setAperta(i);
  }

  return (
    <div className="omnia-faq">
      {voci.map((voce, i) => {
        const isAperta = aperta === i;
        return (
          <div key={voce.domanda} className={`omnia-q${isAperta ? " aperta" : ""}`}>
            <button type="button" id={`${base}-d${i}`} aria-expanded={isAperta} aria-controls={`${base}-r${i}`} onClick={() => toggle(i)}>
              {voce.domanda}
            </button>
            <div
              id={`${base}-r${i}`}
              role="region"
              aria-labelledby={`${base}-d${i}`}
              className="omnia-r"
              ref={(el) => {
                risposteRef.current[i] = el;
              }}
              style={{ maxHeight: isAperta ? altezzaAperta : 0 }}
            >
              <p>{voce.risposta}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
