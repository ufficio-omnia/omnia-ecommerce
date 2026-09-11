"use client";

import { useActionState } from "react";
import { createGara, type GaraState } from "@/app/actions/gare";

const initialState: GaraState = {};

export default function CreateGaraForm() {
  const [state, formAction, pending] = useActionState(createGara, initialState);

  return (
    <form action={formAction} className="omnia-form-riga">
      <input
        name="titolo"
        type="text"
        required
        placeholder="Nome della gara (es. Comune di Milano - pulizie uffici)"
        className="omnia-input"
        style={{ flex: 1 }}
      />
      <button type="submit" disabled={pending} className="omnia-btn omnia-btn-p omnia-btn-piccolo">
        {pending ? "Creazione..." : "Nuova gara"}
      </button>
      {state.error && <p className="omnia-messaggio-stato errore">{state.error}</p>}
    </form>
  );
}
