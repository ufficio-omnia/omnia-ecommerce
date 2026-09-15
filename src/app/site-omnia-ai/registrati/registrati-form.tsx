"use client";

import { useActionState } from "react";
import Link from "next/link";
import {
  registerOmniaAi,
  type OmniaAiRegisterState,
} from "@/app/actions/omnia-ai-auth";

const initialState: OmniaAiRegisterState = {};

export default function RegistratiForm() {
  const [state, formAction, pending] = useActionState(registerOmniaAi, initialState);

  if (state.success) {
    return <p className="omnia-esito successo">{state.success}</p>;
  }

  return (
    <>
      <form action={formAction} className="omnia-modulo">
        <div>
          <label className="omnia-etichetta" htmlFor="email">
            Email
          </label>
          <input
            className="omnia-input"
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
          />
        </div>

        {state.error && <p className="omnia-esito errore">{state.error}</p>}

        <button type="submit" className="omnia-btn omnia-btn-p" disabled={pending}>
          {pending ? "Invio in corso…" : "Registrati"}
        </button>
      </form>

      <p className="micro" style={{ marginTop: 24 }}>
        Hai già un account? <Link href="/login">Accedi</Link>
      </p>
    </>
  );
}
