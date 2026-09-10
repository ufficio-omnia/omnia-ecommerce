"use client";

import { useActionState, useRef } from "react";
import { uploadGaraDocumento, type GaraState } from "@/app/actions/gare";

const initialState: GaraState = {};

export default function UploadDocumentoForm({ garaId }: { garaId: string }) {
  const formRef = useRef<HTMLFormElement>(null);

  async function action(prevState: GaraState, formData: FormData) {
    const result = await uploadGaraDocumento(prevState, formData);
    if (!result.error) {
      formRef.current?.reset();
    }
    return result;
  }

  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex flex-col gap-2 sm:flex-row sm:items-center"
    >
      <input type="hidden" name="garaId" value={garaId} />
      <input
        type="file"
        name="file"
        required
        className="flex-1 text-sm text-ink"
      />
      <button
        type="submit"
        disabled={pending}
        className="shrink-0 rounded-full border border-border-strong px-4 py-1.5 font-mono text-xs tracking-wide text-ink uppercase transition-colors hover:bg-ink hover:text-cream disabled:opacity-50"
      >
        {pending ? "Caricamento..." : "Carica documento"}
      </button>
      {state.error && <p className="text-xs text-red-700">{state.error}</p>}
      {state.warning && (
        <p className="text-xs text-amber-700">{state.warning}</p>
      )}
    </form>
  );
}
