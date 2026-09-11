"use client";

import { useActionState } from "react";
import { createGara, type GaraState } from "@/app/actions/gare";

const initialState: GaraState = {};

export default function CreateGaraForm() {
  const [state, formAction, pending] = useActionState(createGara, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2 sm:flex-row">
      <input
        name="titolo"
        type="text"
        required
        placeholder="Nome della gara (es. Comune di Milano - pulizie uffici)"
        className="flex-1 rounded-lg border border-border bg-cream px-3 py-2 text-sm text-ink focus:border-forest focus:outline-none"
      />
      <button
        type="submit"
        disabled={pending}
        className="shrink-0 rounded-full bg-forest px-5 py-2 font-mono text-xs tracking-wide text-cream uppercase transition-colors hover:bg-forest-dark disabled:opacity-50"
      >
        {pending ? "Creazione..." : "Nuova gara"}
      </button>
      {state.error && (
        <p className="text-xs text-red-700 sm:self-center">{state.error}</p>
      )}
    </form>
  );
}
