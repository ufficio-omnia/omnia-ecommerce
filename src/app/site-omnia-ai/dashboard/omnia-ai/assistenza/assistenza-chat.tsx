"use client";

import { useActionState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import {
  sendAssistenzaMessage,
  richiediEscalationAssistenza,
  type AssistenzaChatState,
} from "@/app/actions/assistenza-chat";

const initialState: AssistenzaChatState = {};

export type AssistenzaMessaggio = {
  id: string;
  ruolo: string;
  contenuto: string;
  created_at: string;
};

export default function AssistenzaChat({ messaggi }: { messaggi: AssistenzaMessaggio[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function action(prevState: AssistenzaChatState, formData: FormData) {
    const result = await sendAssistenzaMessage(prevState, formData);
    if (!result.error) formRef.current?.reset();
    return result;
  }

  const [state, formAction, pending] = useActionState(action, initialState);

  const [escalationState, escalationAction, escalationPending] = useActionState(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async (_prev: AssistenzaChatState) => richiediEscalationAssistenza(),
    initialState,
  );

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messaggi.length, pending]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!pending) formRef.current?.requestSubmit();
    }
  }

  return (
    <section className="omnia-chat">
      <div className="omnia-chat-intestazione">
        <div>
          <h2>Assistenza OMNIA AI</h2>
          <p>Domande su piattaforma, abbonamento, piani, crediti, fatturazione e accesso</p>
        </div>
        <form action={escalationAction}>
          <button type="submit" disabled={escalationPending} className="omnia-btn omnia-btn-s omnia-btn-piccolo">
            {escalationPending ? "Invio..." : "Contatta un consulente"}
          </button>
        </form>
      </div>
      {escalationState.error && <p className="omnia-messaggio-stato errore">{escalationState.error}</p>}

      <div ref={scrollRef} className="omnia-chat-corpo">
        {messaggi.length ? (
          messaggi.map((m) => (
            <div key={m.id} className={`omnia-msg-riga ${m.ruolo}`}>
              <div className={`omnia-msg ${m.ruolo}`}>
                {m.ruolo === "assistente" ? (
                  <div className="prose-chat">
                    <ReactMarkdown>{m.contenuto}</ReactMarkdown>
                  </div>
                ) : (
                  <p style={{ whiteSpace: "pre-wrap" }}>{m.contenuto}</p>
                )}
                <p className="omnia-msg-ora">{new Date(m.created_at).toLocaleString("it-IT", { timeZone: "Europe/Rome" })}</p>
              </div>
            </div>
          ))
        ) : (
          <div className="omnia-chat-vuota">
            <p>Scrivi qui una domanda sulla piattaforma, sull&apos;abbonamento o sulla fatturazione.</p>
          </div>
        )}
        {pending && <p className="omnia-chat-vuota">Sto rispondendo...</p>}
      </div>

      <form ref={formRef} action={formAction} className="omnia-chat-input">
        <div className="omnia-chat-riga">
          <textarea
            ref={textareaRef}
            name="messaggio"
            rows={2}
            disabled={pending}
            onKeyDown={handleKeyDown}
            placeholder="Scrivi un messaggio... (Invio per inviare, Maiusc+Invio per andare a capo)"
            className="omnia-input"
          />
          <button type="submit" disabled={pending} className="omnia-btn omnia-btn-p">
            {pending ? "Inviato ✓" : "Invia"}
          </button>
        </div>
        {state.error && <p className="omnia-messaggio-stato errore">{state.error}</p>}
      </form>
    </section>
  );
}
