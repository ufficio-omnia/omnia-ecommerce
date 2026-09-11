"use client";

import { useActionState } from "react";
import {
  ricalcolaStrutturaDocumento,
  type KnowledgeBaseState,
} from "@/app/actions/knowledge-base";

const initialState: KnowledgeBaseState = {};

export default function RicalcolaStrutturaButton({ docId }: { docId: string }) {
  const [state, formAction, pending] = useActionState(
    ricalcolaStrutturaDocumento,
    initialState,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="docId" value={docId} />
      <button
        type="submit"
        disabled={pending}
        className="shrink-0 font-mono text-[10px] tracking-wide text-forest uppercase hover:underline disabled:opacity-50"
      >
        {pending ? "Analisi struttura..." : "Ricalcola struttura"}
      </button>
      {state.error && <p className="mt-1 text-[10px] text-red-700">{state.error}</p>}
    </form>
  );
}
