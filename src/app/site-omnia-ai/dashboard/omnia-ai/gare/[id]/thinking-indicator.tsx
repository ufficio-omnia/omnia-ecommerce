"use client";

import { useEffect, useState } from "react";
import BrandMark from "@/components/omnia-ai/brand-mark";

const FASI = [
  "Sta pensando...",
  "Sta consultando i documenti...",
  "Sta elaborando...",
  "Sta generando il documento...",
  "Sta scrivendo la risposta...",
];

export default function ThinkingIndicator() {
  const [fase, setFase] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setFase((f) => (f + 1) % FASI.length);
    }, 2200);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="omnia-pensiero">
      <BrandMark stato="elaborazione" width={22} height={22} />
      <span>{FASI[fase]}</span>
    </div>
  );
}
