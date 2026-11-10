"use client";

import { useActionState } from "react";
import { richiediAcquistoPacchetto, type RichiestaPacchettoState } from "@/app/actions/pacchetti-servizi";
import type { ServizioPacchetto } from "@/lib/pacchetti-servizi-calcoli";

const statoIniziale: RichiestaPacchettoState = {};

// «Acquista» dell'Ufficio Gare: NON compra nulla, avvisa il titolare con un'email (una al giorno per pacchetto). Il server controlla tutto.
export default function RichiestaPacchettoForm({ servizio, quantita }: { servizio: ServizioPacchetto; quantita: number }) {
  const [stato, formAction, inCorso] = useActionState(richiediAcquistoPacchetto, statoIniziale);
  return (
    <form action={formAction} className="omnia-pacchetto-azione">
      <input type="hidden" name="servizio" value={servizio} />
      <input type="hidden" name="quantita" value={quantita} />
      <button type="submit" className="omnia-btn omnia-btn-p omnia-btn-piccolo" disabled={inCorso}>
        {inCorso ? "Avviso l'amministratore…" : "Acquista"}
      </button>
      {stato.success && !inCorso && <p className="omnia-messaggio-stato successo omnia-pacchetto-esito">{stato.success}</p>}
      {stato.error && !inCorso && <p className="omnia-messaggio-stato errore omnia-pacchetto-esito">{stato.error}</p>}
    </form>
  );
}
