"use client";

import { useActionState, useRef } from "react";
import type { StatoAzioneUtente } from "../azioni/utenti";

type Azione = (stato: StatoAzioneUtente, dati: FormData) => Promise<StatoAzioneUtente>;

// Risposta all'ultimo messaggio del cliente. Il testo si svuota solo se l'invio è
// riuscito; se l'email di avviso non è partita il messaggio è comunque salvato e lo
// si dice, perché il cliente non ne saprebbe nulla fino al prossimo accesso.
export default function FormRisposta({ userId, azione, disabilitato }: { userId: string; azione: Azione; disabilitato?: boolean }) {
  const modulo = useRef<HTMLFormElement>(null);

  async function invia(precedente: StatoAzioneUtente, dati: FormData): Promise<StatoAzioneUtente> {
    const esito = await azione(precedente, dati);
    if (esito.ok) modulo.current?.reset();
    return esito;
  }

  const [stato, esegui, inCorso] = useActionState(invia, {});

  return (
    <form ref={modulo} action={esegui} className="cn-risposta">
      <input type="hidden" name="userId" value={userId} />
      <textarea className="cn-input cn-testo" name="body" rows={3} required maxLength={4000} disabled={disabilitato} placeholder={disabilitato ? "Account anonimizzato: non c'è nessuno a cui rispondere." : "Rispondi al cliente…"} aria-label="Risposta al cliente" />
      <div className="cn-azione">
        <button type="submit" className="cn-btn primario" disabled={inCorso || disabilitato}>
          {inCorso ? "Invio…" : "Invia risposta"}
        </button>
        <span className="cn-nota-inline">Il cliente riceve anche un&apos;email con il link alla conversazione.</span>
      </div>
      {stato.errore && (
        <p className="cn-esito errore" role="alert">
          {stato.errore}
        </p>
      )}
      {stato.ok && !stato.avviso && (
        <p className="cn-esito ok" role="status">
          Risposta inviata.
        </p>
      )}
      {stato.avviso && (
        <p className="cn-esito avviso" role="alert">
          {stato.avviso}
        </p>
      )}
    </form>
  );
}
