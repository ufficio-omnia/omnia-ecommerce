"use client";

import { useActionState } from "react";
import { startBankTransferOrder, type ActionState } from "@/app/actions/checkout";

const initialState: ActionState = {};

export default function BankTransferForm({ productId }: { productId: string }) {
  const [state, formAction, pending] = useActionState(
    startBankTransferOrder,
    initialState,
  );

  return (
    <form action={formAction} className="mt-3 space-y-3">
      <input type="hidden" name="productId" value={productId} />

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

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "Elaborazione..." : "Ordina con bonifico"}
      </button>
    </form>
  );
}
