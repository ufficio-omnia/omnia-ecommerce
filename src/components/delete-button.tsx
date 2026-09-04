"use client";

import { useActionState } from "react";
import type { FormEvent } from "react";

type DeleteState = { error?: string };

export default function DeleteButton({
  action,
  hiddenFields,
  confirmMessage,
  label,
  className,
}: {
  action: (prevState: DeleteState, formData: FormData) => Promise<DeleteState>;
  hiddenFields: Record<string, string>;
  confirmMessage: string;
  label: string;
  className: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (!window.confirm(confirmMessage)) {
      event.preventDefault();
    }
  }

  return (
    <form action={formAction} onSubmit={handleSubmit}>
      {Object.entries(hiddenFields).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      <button type="submit" disabled={pending} className={className}>
        {pending ? "Eliminazione..." : label}
      </button>
      {state.error && (
        <p className="mt-1 text-xs text-red-700">{state.error}</p>
      )}
    </form>
  );
}
