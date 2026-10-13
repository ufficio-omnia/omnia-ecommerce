"use client";

import { useState, useTransition } from "react";
import type { StatoAzione } from "../azioni/ordini";

// Scarica la fattura PDF di un ordine in una nuova scheda. La scheda va aperta
// subito, nel clic: se si aspettasse la risposta del server il browser la
// bloccherebbe come popup. Poi la si punta al link firmato (valido 60 secondi).
export default function PulsanteScaricaFattura({
  orderId,
  azione,
}: {
  orderId: string;
  azione: (stato: StatoAzione, dati: FormData) => Promise<StatoAzione>;
}) {
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, avvia] = useTransition();

  function alClic() {
    const scheda = window.open("about:blank", "_blank");
    setErrore(null);

    avvia(async () => {
      const dati = new FormData();
      dati.append("orderId", orderId);
      const esito = await azione({}, dati);

      if (esito.url) {
        if (scheda) scheda.location.href = esito.url;
        else window.open(esito.url, "_blank", "noopener,noreferrer");
      } else {
        scheda?.close();
        setErrore(esito.errore ?? "Errore imprevisto.");
      }
    });
  }

  return (
    <span className="cn-azione">
      <button type="button" className="cn-btn piccolo" onClick={alClic} disabled={inCorso}>
        {inCorso ? "Apro…" : "Scarica"}
      </button>
      {errore && (
        <span className="cn-azione-errore" role="alert">
          {errore}
        </span>
      )}
    </span>
  );
}
