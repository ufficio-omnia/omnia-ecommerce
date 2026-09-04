"use client";

import { useActionState } from "react";
import { startBankTransferOrder, type ActionState } from "@/app/actions/checkout";

const initialState: ActionState = {};

const inputClass =
  "mt-1 w-full rounded-lg border border-border bg-cream px-3 py-2 text-sm text-ink focus:border-forest focus:outline-none";
const labelClass = "block text-sm font-medium text-ink";

export default function BankTransferForm({ productId }: { productId: string }) {
  const [state, formAction, pending] = useActionState(
    startBankTransferOrder,
    initialState,
  );

  return (
    <form action={formAction} className="mt-4 space-y-3">
      <input type="hidden" name="productId" value={productId} />

      <div>
        <label htmlFor="email" className={labelClass}>
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

      <div className="border-t border-border pt-3">
        <p className="font-mono text-xs tracking-wide text-sage uppercase">
          Dati di fatturazione
        </p>

        <div className="mt-2">
          <label htmlFor="ragioneSociale" className={labelClass}>
            Ragione sociale
          </label>
          <input
            id="ragioneSociale"
            name="ragioneSociale"
            type="text"
            required
            className={inputClass}
          />
        </div>

        <div className="mt-2">
          <label htmlFor="partitaIva" className={labelClass}>
            Partita IVA
          </label>
          <input
            id="partitaIva"
            name="partitaIva"
            type="text"
            required
            className={inputClass}
          />
        </div>

        <div className="mt-2">
          <label htmlFor="indirizzo" className={labelClass}>
            Indirizzo
          </label>
          <input
            id="indirizzo"
            name="indirizzo"
            type="text"
            required
            className={inputClass}
          />
        </div>

        <div className="mt-2">
          <label htmlFor="codiceSdi" className={labelClass}>
            Codice SDI
          </label>
          <input id="codiceSdi" name="codiceSdi" type="text" className={inputClass} />
        </div>

        <div className="mt-2">
          <label htmlFor="pec" className={labelClass}>
            PEC
          </label>
          <input id="pec" name="pec" type="email" className={inputClass} />
        </div>

        <p className="mt-1 text-xs text-sage">
          Inserisci almeno uno tra codice SDI e PEC.
        </p>
      </div>

      {state.error && <p className="text-sm text-red-700">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-full bg-forest px-4 py-2.5 font-mono text-xs tracking-wide text-cream uppercase transition-colors hover:bg-forest-dark disabled:opacity-50"
      >
        {pending ? "Elaborazione..." : "Ordina con bonifico"}
      </button>
    </form>
  );
}
