"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

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
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-cream px-4 py-3">
      <Image
        src="/omnia-logo.png"
        alt=""
        width={22}
        height={22}
        className="animate-spin-slow shrink-0"
      />
      <span className="text-sm text-sage">{FASI[fase]}</span>
    </div>
  );
}
