"use client";

import { useActionState } from "react";
import Link from "next/link";
import { loginWithPassword, type ActionState } from "@/app/actions/auth";

const initialState: ActionState = {};

const inputClass =
  "mt-1 w-full rounded-lg border border-border bg-cream px-3 py-2 text-sm text-ink focus:border-forest focus:outline-none";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(
    loginWithPassword,
    initialState,
  );

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-cream-soft p-8">
        <h1 className="font-serif text-2xl text-ink">Accedi a OMNIA</h1>

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
              className={inputClass}
            />
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="password" className="block text-sm font-medium text-ink">
                Password
              </label>
              <Link
                href="/password-dimenticata"
                className="text-xs text-forest underline"
              >
                Password dimenticata?
              </Link>
            </div>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className={inputClass}
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
            {pending ? "Accesso in corso..." : "Accedi"}
          </button>
        </form>

        <p className="mt-6 text-sm text-sage">
          Non hai un account?{" "}
          <Link href="/registrati" className="font-medium text-forest underline">
            Registrati
          </Link>
        </p>
      </div>
    </main>
  );
}
