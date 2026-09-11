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
    <form ref={formRef} action={formAction} className="omnia-form-riga">
      <input type="hidden" name="garaId" value={garaId} />
      <input type="file" name="file" required className="omnia-file-input" />
      <button type="submit" disabled={pending} className="omnia-btn omnia-btn-s omnia-btn-piccolo">
        {pending ? "Caricamento..." : "Carica documento"}
      </button>
      {state.error && <p className="omnia-messaggio-stato errore">{state.error}</p>}
      {state.warning && <p className="omnia-messaggio-stato avviso">{state.warning}</p>}
    </form>
  );
}
