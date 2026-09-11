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
    <div style={{ marginTop: 20, paddingTop: 20, borderTop: "1px solid var(--bordo)" }}>
      <span className="omnia-eyebrow">Logo stazione appaltante / committente</span>
      <p className="omnia-riquadro-nota">
        Usato da OMNIA AI per inserirlo negli organigrammi generati per questa gara.
      </p>
      <form ref={formRef} action={formAction} className="omnia-form-riga" style={{ marginTop: 12 }}>
        <input type="hidden" name="garaId" value={garaId} />
        <input
          type="file"
          name="logo"
          accept="image/png,image/jpeg,image/webp"
          required
          className="omnia-file-input"
        />
        <button type="submit" disabled={pending} className="omnia-btn omnia-btn-s omnia-btn-piccolo">
          {pending ? "Caricamento..." : "Carica logo"}
        </button>
        {loghiCaricato && !state.error && (
          <span className="omnia-badge verde">Logo già caricato</span>
        )}
        {state.error && <p className="omnia-messaggio-stato errore">{state.error}</p>}
      </form>
    </div>
  );
}
