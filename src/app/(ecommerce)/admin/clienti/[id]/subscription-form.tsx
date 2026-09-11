"use client";

import { useActionState } from "react";
import {
  setSubscription,
  type SubscriptionState,
} from "@/app/actions/subscriptions";

const initialState: SubscriptionState = {};

const inputClass =
  "mt-1 w-full rounded-lg border border-border bg-cream px-3 py-2 text-sm text-ink focus:border-forest focus:outline-none";

const labelClass = "block text-sm font-medium text-ink";

export type Subscription = {
  plan: string;
  status: string;
  current_period_end: string | null;
};

export default function SubscriptionForm({
  userId,
  subscription,
}: {
  userId: string;
  subscription: Subscription | null;
}) {
  const [state, formAction, pending] = useActionState(
    setSubscription,
    initialState,
  );

  const periodEndValue = subscription?.current_period_end
    ? subscription.current_period_end.slice(0, 10)
    : "";

  return (
    <form action={formAction} className="mt-4 grid gap-4 sm:grid-cols-3">
      <input type="hidden" name="userId" value={userId} />
      <div>
        <label htmlFor="plan" className={labelClass}>
          Piano
        </label>
        <input
          id="plan"
          name="plan"
          type="text"
          required
          placeholder="es. BASIC, MEDIUM, PREMIUM"
          defaultValue={subscription?.plan ?? ""}
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor="status" className={labelClass}>
          Stato
        </label>
        <select
          id="status"
          name="status"
          defaultValue={subscription?.status ?? "attivo"}
          className={inputClass}
        >
          <option value="attivo">Attivo</option>
          <option value="scaduto">Scaduto</option>
          <option value="annullato">Annullato</option>
        </select>
      </div>
      <div>
        <label htmlFor="currentPeriodEnd" className={labelClass}>
          Scadenza periodo
        </label>
        <input
          id="currentPeriodEnd"
          name="currentPeriodEnd"
          type="date"
          defaultValue={periodEndValue}
          className={inputClass}
        />
      </div>
      <div className="sm:col-span-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-full border border-border-strong px-4 py-1.5 font-mono text-xs tracking-wide text-ink uppercase transition-colors hover:bg-ink hover:text-cream disabled:opacity-50"
        >
          {pending ? "Salvataggio..." : "Salva abbonamento"}
        </button>
        {state.error && (
          <p className="mt-2 text-xs text-red-700">{state.error}</p>
        )}
      </div>
    </form>
  );
}
