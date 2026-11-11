"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import {
  EVENTO_SERVIZI,
  leggiRidotto,
  ridottoNelBrowser,
  salvaRidotto,
  sezioneRidotta,
  type ServizioRichiudibile,
} from "@/lib/servizi-richiudibili";

// Il riquadro di un servizio aggiuntivo della gara (piano di lavoro, copertina, revisione umana, OMNIA FOOD MENU) che si può ridurre a una riga e riaprire.
// Il titolo è il pulsante: un clic riduce o riapre. Ridotta, la sezione mostra solo il titolo e, accanto, una breve frase di stato («2 copertine generate»);
// il contenuto resta nella pagina, solo nascosto: una generazione in corso continua e i campi già compilati non si perdono. Di base è aperta; la scelta si
// ricorda sul dispositivo dopo un clic (regole in src/lib/servizi-richiudibili.ts). `forzaApertura` la tiene aperta per quella visita (il ritorno da Stripe).
function iscriviti(chiamata: () => void) {
  window.addEventListener("storage", chiamata);
  window.addEventListener(EVENTO_SERVIZI, chiamata);
  return () => {
    window.removeEventListener("storage", chiamata);
    window.removeEventListener(EVENTO_SERVIZI, chiamata);
  };
}

export default function ServizioRichiudibileRiquadro({
  id,
  titoloId,
  titolo,
  riepilogo,
  azioni,
  forzaApertura = false,
  children,
}: {
  id: ServizioRichiudibile;
  // l'id del titolo: lo legge aria-labelledby della sezione
  titoloId: string;
  titolo: ReactNode;
  // frase breve mostrata accanto al titolo quando la sezione è ridotta
  riepilogo?: string | null;
  // pulsanti della testata (es. «Genera il piano di lavoro»): si vedono solo a sezione aperta
  azioni?: ReactNode;
  forzaApertura?: boolean;
  children: ReactNode;
}) {
  // Il server non conosce il localStorage: l'HTML iniziale è sempre «aperta», poi il browser applica la preferenza (stessa tecnica del banner dei cookie).
  const salvato = useSyncExternalStore(
    iscriviti,
    () => leggiRidotto(ridottoNelBrowser(), id),
    () => false,
  );
  const [sceltaInQuestaVisita, setSceltaInQuestaVisita] = useState<boolean | null>(null);
  const ridotta = sezioneRidotta({ salvato, sceltaInQuestaVisita, forzaApertura });
  const idCorpo = `servizio-${id}-corpo`;

  function alterna() {
    const nuova = !ridotta;
    setSceltaInQuestaVisita(nuova);
    salvaRidotto(ridottoNelBrowser(), id, nuova);
    window.dispatchEvent(new Event(EVENTO_SERVIZI));
  }

  return (
    <section className={`omnia-riquadro omnia-servizio${ridotta ? " ridotto" : ""}`} style={{ marginTop: 24 }} aria-labelledby={titoloId}>
      <div className="omnia-app-intestazione">
        <button
          type="button"
          className="omnia-servizio-titolo"
          aria-expanded={!ridotta}
          aria-controls={idCorpo}
          onClick={alterna}
          title={ridotta ? "Apri la sezione" : "Riduci la sezione"}
        >
          <svg className="omnia-servizio-freccia" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
          <span className="omnia-eyebrow" id={titoloId}>
            {titolo}
          </span>
          {ridotta && riepilogo ? <span className="omnia-servizio-riepilogo">{riepilogo}</span> : null}
        </button>
        {!ridotta && azioni}
      </div>
      <div id={idCorpo} className="omnia-servizio-corpo" hidden={ridotta}>
        {children}
      </div>
    </section>
  );
}
