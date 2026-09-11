"use client";

import { useActionState, useRef } from "react";
import { uploadGaraLogoCliente, type GaraState } from "@/app/actions/gare";

const initialState: GaraState = {};

export default function LogoClienteForm({
  garaId,
  loghiCaricato,
}: {
  garaId: string;
  loghiCaricato: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  async function action(prevState: GaraState, formData: FormData) {
    const result = await uploadGaraLogoCliente(prevState, formData);
    if (!result.error) {
      formRef.current?.reset();
    }
    return result;
  }

  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <div className="mt-5 border-t border-border pt-5">
      <h3 className="font-mono text-xs tracking-wide text-sage uppercase">
        Logo stazione appaltante / committente
      </h3>
      <p className="mt-1 text-xs text-sage">
        Usato da OMNIA AI per inserirlo negli organigrammi generati per questa
        gara.
      </p>
      <form
        ref={formRef}
        action={formAction}
        className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center"
      >
        <input type="hidden" name="garaId" value={garaId} />
        <input
          type="file"
          name="logo"
          accept="image/png,image/jpeg,image/webp"
          required
          className="flex-1 text-sm text-ink"
        />
        <button
          type="submit"
          disabled={pending}
          className="shrink-0 rounded-full border border-border-strong px-4 py-1.5 font-mono text-xs tracking-wide text-ink uppercase transition-colors hover:bg-ink hover:text-cream disabled:opacity-50"
        >
          {pending ? "Caricamento..." : "Carica logo"}
        </button>
        {loghiCaricato && !state.error && (
          <span className="text-xs text-forest">Logo già caricato.</span>
        )}
        {state.error && <p className="text-xs text-red-700">{state.error}</p>}
      </form>
    </div>
  );
}
