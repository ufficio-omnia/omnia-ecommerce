"use client";

import { useActionState, useRef } from "react";
import {
  uploadKnowledgeBaseDocumento,
  type KnowledgeBaseState,
} from "@/app/actions/knowledge-base";

const initialState: KnowledgeBaseState = {};

export default function KnowledgeBaseUploadForm() {
  const formRef = useRef<HTMLFormElement>(null);

  async function action(prevState: KnowledgeBaseState, formData: FormData) {
    const result = await uploadKnowledgeBaseDocumento(prevState, formData);
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
      className="mt-6 rounded-2xl border border-border bg-cream-soft p-5"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="file"
          name="file"
          accept=".pdf,.docx"
          required
          className="flex-1 text-sm text-ink"
        />
        <button
          type="submit"
          disabled={pending}
          className="shrink-0 rounded-full bg-forest px-5 py-2 font-mono text-xs tracking-wide text-cream uppercase transition-colors hover:bg-forest-dark disabled:opacity-50"
        >
          {pending ? "Elaborazione..." : "Carica documento"}
        </button>
      </div>
      {state.error && (
        <p className="mt-2 text-xs text-red-700">{state.error}</p>
      )}
    </form>
  );
}
