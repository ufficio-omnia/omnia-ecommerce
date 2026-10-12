"use client";

import { useState } from "react";

// Copia negli appunti i dati di fatturazione di una riga, pronti da incollare nel
// programma con cui si emette la fattura.
export default function CopiaDati({ testo }: { testo: string }) {
  const [esito, setEsito] = useState<"" | "copiato" | "errore">("");

  async function copia() {
    try {
      await navigator.clipboard.writeText(testo);
      setEsito("copiato");
    } catch {
      setEsito("errore");
    }
    setTimeout(() => setEsito(""), 2500);
  }

  return (
    <button type="button" className="cn-btn piccolo" onClick={copia}>
      {esito === "copiato" ? "Copiato ✓" : esito === "errore" ? "Copia non riuscita" : "Copia dati"}
    </button>
  );
}
