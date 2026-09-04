"use client";

import { useActionState, useRef } from "react";
import { sendMessageAsAdmin, type MessageState } from "@/app/actions/messages";

const initialState: MessageState = {};

export default function ReplyForm({ userId }: { userId: string }) {
  const formRef = useRef<HTMLFormElement>(null);

  async function action(prevState: MessageState, formData: FormData) {
    const result = await sendMessageAsAdmin(prevState, formData);
    if (!result.error) {
      formRef.current?.reset();
    }
    return result;
  }

  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form ref={formRef} action={formAction} className="mt-4">
      <input type="hidden" name="userId" value={userId} />
      <div className="flex gap-2">
        <textarea
          name="body"
          rows={2}
          required
          placeholder="Rispondi al cliente..."
          className="flex-1 rounded-lg border border-border bg-cream px-3 py-2 text-sm text-ink focus:border-forest focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-forest px-4 py-2 font-mono text-xs tracking-wide text-cream uppercase transition-colors hover:bg-forest-dark disabled:opacity-50"
        >
          {pending ? "Invio..." : "Invia"}
        </button>
      </div>
      {state.error && (
        <p className="mt-2 text-xs text-red-700">{state.error}</p>
      )}
    </form>
  );
}
