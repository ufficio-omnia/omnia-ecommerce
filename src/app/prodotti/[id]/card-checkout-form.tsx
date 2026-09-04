"use client";

import { useActionState } from "react";
import { startCardCheckout, type ActionState } from "@/app/actions/checkout";

const initialState: ActionState = {};

const inputClass =
  "mt-1 w-full rounded-lg border border-border bg-cream px-3 py-2 text-sm text-ink focus:border-forest focus:outline-none";
const labelClass = "block text-sm font-medium text-ink";

export default function CardCheckoutForm({ productId }: { productId: string }) {
  const [state, formAction, pending] = useActionState(
    startCardCheckout,
    initialState,
  );

  return (
    <form action={formAction} className="mt-4 space-y-3">
      <input type="hidden" name="productId" value={productId} />

      <div>
        <label htmlFor="cardEmail" className={labelClass}>
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

      <div className="border-t border-border pt-3">
        <p className="font-mono text-xs tracking-wide text-sage uppercase">
          Dati di fatturazione
        </p>

        <div className="mt-2">
          <label htmlFor="cardRagioneSociale" className={labelClass}>
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
          <label htmlFor="cardPartitaIva" className={labelClass}>
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
          <label htmlFor="cardIndirizzo" className={labelClass}>
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
          <label htmlFor="cardCodiceSdi" className={labelClass}>
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
          <label htmlFor="cardPec" className={labelClass}>
            PEC
          </label>
          <input id="cardPec" name="pec" type="email" className={inputClass} />
        </div>

        <p className="mt-1 text-xs text-sage">
          Inserisci almeno uno tra codice SDI e PEC.
        </p>
      </div>

      {state.error && <p className="text-sm text-red-700">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-full bg-ink px-4 py-2.5 font-mono text-xs tracking-wide text-cream uppercase transition-colors hover:bg-forest disabled:opacity-50"
      >
        {pending ? "Reindirizzamento..." : "Paga con carta"}
      </button>
    </form>
  );
}
