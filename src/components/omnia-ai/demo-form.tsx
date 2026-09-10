"use client";

import { useActionState } from "react";
import { requestDemo, type DemoRequestState } from "@/app/actions/omnia-ai-demo";

const initialState: DemoRequestState = {};

const SETTORI = [
  "Pulizie e sanificazione",
  "Facchinaggio",
  "Ausiliariato",
  "Portierato",
  "Manutenzione edile, idrica ed elettrica",
  "Sorveglianza armata e non armata",
  "Gestione e manutenzione elisuperfici",
  "Altro",
];

export default function DemoForm() {
  const [state, formAction, pending] = useActionState(requestDemo, initialState);

  if (state.success) {
    return <p className="omnia-esito successo">{state.success}</p>;
  }

  return (
    <form action={formAction} className="omnia-modulo">
      <div className="omnia-campo-riga">
        <div>
          <label className="omnia-etichetta" htmlFor="nome">
            Nome e cognome
          </label>
          <input className="omnia-input" id="nome" name="nome" type="text" required autoComplete="name" />
        </div>
        <div>
          <label className="omnia-etichetta" htmlFor="azienda">
            Azienda
          </label>
          <input className="omnia-input" id="azienda" name="azienda" type="text" required autoComplete="organization" />
        </div>
      </div>

      <div className="omnia-campo-riga">
        <div>
          <label className="omnia-etichetta" htmlFor="email">
            Email
          </label>
          <input className="omnia-input" id="email" name="email" type="email" required autoComplete="email" />
        </div>
        <div>
          <label className="omnia-etichetta" htmlFor="telefono">
            Telefono
          </label>
          <input className="omnia-input" id="telefono" name="telefono" type="tel" autoComplete="tel" />
        </div>
      </div>

      <div>
        <label className="omnia-etichetta" htmlFor="settore">
          Settore
        </label>
        <select className="omnia-select" id="settore" name="settore" defaultValue="">
          <option value="" disabled>
            Scegli il settore
          </option>
          {SETTORI.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="omnia-etichetta" htmlFor="bando">
          Bando di interesse
        </label>
        <textarea
          className="omnia-textarea"
          id="bando"
          name="bando"
          placeholder="Ente, oggetto della gara, scadenza — quello che sai già."
        />
      </div>

      {state.error && <p className="omnia-esito errore">{state.error}</p>}

      <button type="submit" className="omnia-btn omnia-btn-p" disabled={pending}>
        {pending ? "Invio in corso…" : "Richiedi la demo"}
      </button>
    </form>
  );
}
