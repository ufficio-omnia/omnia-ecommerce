"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createGara, type GaraState } from "@/app/actions/gare";

const initialState: GaraState = {};

export default function CreateGaraForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [titolo, setTitolo] = useState("");
  const [conferma, setConferma] = useState(false);
  const [state, formAction, pending] = useActionState(createGara, initialState);

  // Il "Sì, crea comunque" imposta conferma e poi reinvia lo stesso
  // modulo: l'effetto aspetta che il campo nascosto rifletta il nuovo
  // valore (il re-render) prima di chiamare requestSubmit, altrimenti
  // partirebbe ancora con conferma="false".
  useEffect(() => {
    if (conferma) {
      formRef.current?.requestSubmit();
    }
  }, [conferma]);

  return (
    <div>
      <form ref={formRef} action={formAction} className="omnia-form-riga">
        <input type="hidden" name="conferma" value={conferma ? "true" : "false"} />
        <input
          name="titolo"
          type="text"
          required
          placeholder="Nome della gara (es. Comune di Milano - pulizie uffici)"
          className="omnia-input"
          style={{ flex: 1 }}
          value={titolo}
          onChange={(e) => {
            setTitolo(e.target.value);
            setConferma(false);
          }}
        />
        <button type="submit" disabled={pending} className="omnia-btn omnia-btn-p omnia-btn-piccolo">
          {pending ? "Creazione..." : "Nuova gara"}
        </button>
      </form>

      {state.duplicato && !pending && (
        <div className="omnia-messaggio-stato avviso" style={{ marginTop: 10 }}>
          <p style={{ margin: 0 }}>
            Hai già una gara che si chiama &quot;{state.duplicato}&quot;. Vuoi crearne un&apos;altra?
          </p>
          <button
            type="button"
            onClick={() => setConferma(true)}
            className="omnia-btn omnia-btn-s omnia-btn-piccolo"
            style={{ marginTop: 10 }}
          >
            Sì, crea comunque
          </button>
        </div>
      )}

      {state.error && <p className="omnia-messaggio-stato errore">{state.error}</p>}
    </div>
  );
}
