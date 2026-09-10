"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { StatoMarchio } from "./brand-mark";

// Il marchio nell'header è anche la spia di stato del sistema: quando la
// demo interattiva nella hero sta "rispondendo", il marchio nell'header
// deve rifletterlo. Header e demo sono fratelli nel DOM (non genitore/
// figlio), quindi lo stato vive qui invece che in un useState locale.
type MarchioStatoValue = {
  stato: StatoMarchio;
  setStato: (stato: StatoMarchio) => void;
};

const MarchioStatoContext = createContext<MarchioStatoValue | null>(null);

export function MarchioStatoProvider({ children }: { children: ReactNode }) {
  const [stato, setStato] = useState<StatoMarchio>("riposo");
  const value = useMemo(() => ({ stato, setStato }), [stato]);
  return <MarchioStatoContext.Provider value={value}>{children}</MarchioStatoContext.Provider>;
}

export function useMarchioStato(): MarchioStatoValue {
  const ctx = useContext(MarchioStatoContext);
  if (!ctx) throw new Error("useMarchioStato va usato dentro <MarchioStatoProvider>");
  return ctx;
}
