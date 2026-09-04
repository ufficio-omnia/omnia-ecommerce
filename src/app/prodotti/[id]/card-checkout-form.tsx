"use client";

import { useActionState } from "react";
import { startCardCheckout, type ActionState } from "@/app/actions/checkout";

const initialState: ActionState = {};

const inputClass =
  "mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none";

export default function CardCheckoutForm({ productId }: { productId: string }) {
  const [state, formAction, pending] = useActionState(
    startCardCheckout,
    initialState,
  );

  return (
    <form action={formAction} className="mt-3 space-y-3">
      <input type="hidden" name="productId" value={productId} />

      <div>
        <label htmlFor="cardEmail" className="block text-sm font-medium">
          Email
        </label>
        <input
          id="cardEmail"
          name="email"
          type="email"
          required
          autoComplete="email"
          className={inputClass}
        />
      </div>

      <div className="border-t border-gray-100 pt-3">
        <p className="text-xs font-medium text-gray-600">
          Dati di fatturazione
        </p>

        <div className="mt-2">
          <label htmlFor="cardRagioneSociale" className="block text-sm font-medium">
            Ragione sociale
          </label>
          <input
            id="cardRagioneSociale"
            name="ragioneSociale"
            type="text"
            required
            className={inputClass}
          />
        </div>

        <div className="mt-2">
          <label htmlFor="cardPartitaIva" className="block text-sm font-medium">
            Partita IVA
          </label>
          <input
            id="cardPartitaIva"
            name="partitaIva"
            type="text"
            required
            className={inputClass}
          />
        </div>

        <div className="mt-2">
          <label htmlFor="cardIndirizzo" className="block text-sm font-medium">
            Indirizzo
          </label>
          <input
            id="cardIndirizzo"
            name="indirizzo"
            type="text"
            required
            className={inputClass}
          />
        </div>

        <div className="mt-2">
          <label htmlFor="cardCodiceSdi" className="block text-sm font-medium">
            Codice SDI
          </label>
          <input
            id="cardCodiceSdi"
            name="codiceSdi"
            type="text"
            className={inputClass}
          />
        </div>

        <div className="mt-2">
          <label htmlFor="cardPec" className="block text-sm font-medium">
            PEC
          </label>
          <input id="cardPec" name="pec" type="email" className={inputClass} />
        </div>

        <p className="mt-1 text-xs text-gray-500">
          Inserisci almeno uno tra codice SDI e PEC.
        </p>
      </div>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "Reindirizzamento..." : "Paga con carta"}
      </button>
    </form>
  );
}
