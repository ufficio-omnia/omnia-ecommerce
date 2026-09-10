"use client";

import { useRef, useState } from "react";

type Voce = { domanda: string; risposta: string };

export default function FaqAccordion({ voci }: { voci: Voce[] }) {
  const [aperta, setAperta] = useState<number | null>(null);
  const risposteRef = useRef<(HTMLDivElement | null)[]>([]);

  return (
    <div className="omnia-faq">
      {voci.map((voce, i) => {
        const isAperta = aperta === i;
        return (
          <div key={voce.domanda} className={`omnia-q${isAperta ? " aperta" : ""}`}>
            <button
              type="button"
              aria-expanded={isAperta}
              onClick={() => setAperta(isAperta ? null : i)}
            >
              {voce.domanda}
            </button>
            <div
              className="omnia-r"
              ref={(el) => {
                risposteRef.current[i] = el;
              }}
              style={{ maxHeight: isAperta ? (risposteRef.current[i]?.scrollHeight ?? undefined) : 0 }}
            >
              <p>{voce.risposta}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
