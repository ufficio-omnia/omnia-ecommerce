"use client";

import { useState, useTransition } from "react";

type Esito = { errore?: string; url?: string };

// Apre in una nuova scheda un indirizzo che il server genera al momento (link
// firmato di 60 secondi: fattura PDF di un ordine, file di un prodotto). La scheda
// va aperta subito, nel clic: se si aspettasse la risposta del server il browser la
// bloccherebbe come popup. Poi la si punta all'indirizzo ricevuto.
export default function PulsanteApriLink({
  azione,
  campi,
  etichetta = "Scarica",
}: {
  azione: (stato: Esito, dati: FormData) => Promise<Esito>;
  campi: Record<string, string>;
  etichetta?: string;
}) {
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, avvia] = useTransition();

  function alClic() {
    const scheda = window.open("about:blank", "_blank");
    setErrore(null);

    avvia(async () => {
      const dati = new FormData();
      for (const [nome, valore] of Object.entries(campi)) dati.append(nome, valore);
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
        {inCorso ? "Apro…" : etichetta}
      </button>
      {errore && (
        <span className="cn-azione-errore" role="alert">
          {errore}
        </span>
      )}
    </span>
  );
}
