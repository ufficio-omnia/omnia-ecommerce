"use client";

import { useActionState } from "react";
import { loginOmniaAi, type OmniaAiAuthState } from "@/app/actions/omnia-ai-auth";

const initialState: OmniaAiAuthState = {};

export default function OmniaAiLoginForm() {
  const [state, formAction, pending] = useActionState(loginOmniaAi, initialState);

  return (
    <form action={formAction} className="omnia-modulo">
      <div>
        <label className="omnia-etichetta" htmlFor="email">
          Email
        </label>
        <input className="omnia-input" id="email" name="email" type="email" required autoComplete="email" />
      </div>
      <div>
        <label className="omnia-etichetta" htmlFor="password">
          Password
        </label>
        <input
          className="omnia-input"
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
        />
      </div>

      {state.error && <p className="omnia-esito errore">{state.error}</p>}

      <button type="submit" className="omnia-btn omnia-btn-p" disabled={pending}>
        {pending ? "Accesso in corso…" : "Accedi"}
      </button>
    </form>
  );
}
