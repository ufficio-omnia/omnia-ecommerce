"use client";

import { useActionState } from "react";
import Link from "next/link";
import { registerWithEmail, type ActionState } from "@/app/actions/auth";

const initialState: ActionState = {};

export default function RegistratiPage() {
  const [state, formAction, pending] = useActionState(
    registerWithEmail,
    initialState,
  );

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold">Crea il tuo account OMNIA</h1>
        <p className="mt-2 text-sm text-gray-600">
          Inserisci la tua email: ti invieremo un link per attivare
          l&apos;account e impostare la password.
        </p>

        {state.success ? (
          <p className="mt-6 rounded-md bg-green-50 p-4 text-sm text-green-800">
            {state.success}
          </p>
        ) : (
          <form action={formAction} className="mt-6 space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
              />
            </div>

            {state.error && (
              <p className="text-sm text-red-600">{state.error}</p>
            )}

            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {pending ? "Invio in corso..." : "Registrati"}
            </button>
          </form>
        )}

        <p className="mt-6 text-sm text-gray-600">
          Hai già un account?{" "}
          <Link href="/login" className="font-medium underline">
            Accedi
          </Link>
        </p>
      </div>
    </main>
  );
}
