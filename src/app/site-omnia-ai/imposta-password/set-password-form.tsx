"use client";

import { useActionState } from "react";
import {
  setInitialPasswordOmniaAi,
  type OmniaAiAuthState,
} from "@/app/actions/omnia-ai-auth";

const initialState: OmniaAiAuthState = {};

export default function SetPasswordForm() {
  const [state, formAction, pending] = useActionState(
    setInitialPasswordOmniaAi,
    initialState,
  );

  return (
    <form action={formAction} className="omnia-modulo">
      <div>
        <label className="omnia-etichetta" htmlFor="password">
          Nuova password
        </label>
        <input
          className="omnia-input"
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
        />
      </div>
      <div>
        <label className="omnia-etichetta" htmlFor="confirmPassword">
          Conferma password
        </label>
        <input
          className="omnia-input"
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
        />
      </div>

      {state.error && <p className="omnia-esito errore">{state.error}</p>}

      <button type="submit" className="omnia-btn omnia-btn-p" disabled={pending}>
        {pending ? "Salvataggio…" : "Imposta password e continua"}
      </button>
    </form>
  );
}
