"use client";

import { useActionState } from "react";
import Link from "next/link";
import { requestPasswordReset, type ActionState } from "@/app/actions/auth";

const initialState: ActionState = {};

export default function PasswordDimenticataPage() {
  const [state, formAction, pending] = useActionState(
    requestPasswordReset,
    initialState,
  );

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-cream-soft p-8">
        <h1 className="font-serif text-2xl text-ink">Password dimenticata</h1>
        <p className="mt-2 text-justify text-sm text-sage">
          Inserisci la tua email: se è registrata, ti invieremo un link per
          reimpostare la password.
        </p>

        {state.success ? (
          <p className="mt-6 rounded-lg border border-forest/30 bg-forest/10 p-4 text-sm text-forest-dark">
            {state.success}
          </p>
        ) : (
          <form action={formAction} className="mt-6 space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-ink">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                className="mt-1 w-full rounded-lg border border-border bg-cream px-3 py-2 text-sm text-ink focus:border-forest focus:outline-none"
              />
            </div>

            {state.error && (
              <p className="text-sm text-red-700">{state.error}</p>
            )}

            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-full bg-forest px-4 py-2.5 font-mono text-xs tracking-wide text-cream uppercase transition-colors hover:bg-forest-dark disabled:opacity-50"
            >
              {pending ? "Invio in corso..." : "Invia link di reset"}
            </button>
          </form>
        )}

        <p className="mt-6 text-sm text-sage">
          <Link href="/login" className="font-medium text-forest underline">
            Torna al login
          </Link>
        </p>
      </div>
    </main>
  );
}
