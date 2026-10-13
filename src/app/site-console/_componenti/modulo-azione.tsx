"use client";

import { useActionState, useRef } from "react";
import type { ReactNode } from "react";

type Esito = { errore?: string; ok?: boolean; avviso?: string };

// Modulo generico: i campi li disegna la pagina (children), qui stanno l'invio, il
// messaggio di esito e, se richiesto, lo svuotamento dopo un salvataggio riuscito.
// Serve a ogni modulo della console che non rimanda a un'altra pagina, così un
// rifiuto («il prezzo scontato deve essere minore…») si legge accanto al pulsante
// invece di sparire. Funziona anche con campi file (FormData).
export default function ModuloAzione({
  azione,
  campi = {},
  etichetta,
  etichettaInCorso,
  svuota = false,
  messaggioOk = "Salvato.",
  variante = "neutro",
  classe = "cn-modulo-linea",
  children,
}: {
  azione: (stato: Esito, dati: FormData) => Promise<Esito>;
  campi?: Record<string, string>;
  etichetta: string;
  etichettaInCorso: string;
  // svuota i campi dopo un esito positivo (aggiunte), non dopo un salvataggio di modifiche
  svuota?: boolean;
  messaggioOk?: string;
  variante?: "neutro" | "primario";
  classe?: string;
  children: ReactNode;
}) {
  const modulo = useRef<HTMLFormElement>(null);

  async function invia(precedente: Esito, dati: FormData): Promise<Esito> {
    const esito = await azione(precedente, dati);
    if (esito.ok && svuota) modulo.current?.reset();
    return esito;
  }

  const [stato, esegui, inCorso] = useActionState(invia, {});

  return (
    <form ref={modulo} action={esegui} className={classe}>
      {Object.entries(campi).map(([nome, valore]) => (
        <input key={nome} type="hidden" name={nome} value={valore} />
      ))}
      {children}
      <div className="cn-azione">
        <button type="submit" className={`cn-btn piccolo${variante === "primario" ? " primario" : ""}`} disabled={inCorso}>
          {inCorso ? etichettaInCorso : etichetta}
        </button>
        {stato.errore && (
          <span className="cn-azione-errore" role="alert">
            {stato.errore}
          </span>
        )}
        {stato.ok && !stato.avviso && !stato.errore && (
          <span className="cn-azione-ok" role="status">
            {messaggioOk}
          </span>
        )}
        {stato.avviso && (
          <span className="cn-azione-avviso" role="alert">
            {stato.avviso}
          </span>
        )}
      </div>
    </form>
  );
}
