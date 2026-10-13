"use client";

import { useActionState } from "react";
import { richiediLinkAccesso, type StatoRichiestaLink } from "../azioni/accesso";

const statoIniziale: StatoRichiestaLink = {};

export default function LoginForm() {
  const [stato, azione, inCorso] = useActionState(richiediLinkAccesso, statoIniziale);

  if (stato.inviata) {
    return (
      <div className="cn-esito ok" role="status">
        Se l&apos;indirizzo è abilitato, tra un minuto troverai nella casella un link per entrare. Vale per un tempo
        breve e si usa una volta sola. Puoi chiederne un altro dopo un minuto.
      </div>
    );
  }

  return (
    <form action={azione} className="cn-modulo">
      <div>
        <label className="cn-etichetta" htmlFor="email">
          Email
        </label>
        <input
          className="cn-input"
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          autoFocus
          maxLength={254}
        />
      </div>

      {stato.errore && (
        <p className="cn-esito errore" role="alert">
          {stato.errore}
        </p>
      )}

      <button type="submit" className="cn-btn primario ampio" disabled={inCorso}>
        {inCorso ? "Invio in corso…" : "Inviami il link di accesso"}
      </button>
    </form>
  );
}
