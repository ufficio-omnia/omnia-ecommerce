"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { sendGaraMessage, type ChatState } from "@/app/actions/gara-chat";
import { downloadGaraMessaggioFile, downloadAllegatoMessaggio } from "@/app/actions/download";
import OpenInNewTabButton from "@/components/open-in-new-tab-button";
import BrandMark from "@/components/omnia-ai/brand-mark";
import ThinkingIndicator from "./thinking-indicator";

const initialState: ChatState = {};

const ESTENSIONI_ACCETTATE = ".png,.jpg,.jpeg,.gif,.webp,.pdf,.docx,.xlsx,.xls,.csv";
const MAX_ALLEGATI = 5;

function iconaAllegato(nomeFile: string): string {
  const estensione = nomeFile.toLowerCase().split(".").pop() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(estensione)) return "🖼️";
  if (estensione === "pdf") return "📕";
  if (estensione === "docx") return "📄";
  if (["xlsx", "xls", "csv"].includes(estensione)) return "📊";
  return "📎";
}

export type GaraMessaggioAllegato = {
  id: string;
  nome_file: string;
};

export type GaraMessaggio = {
  id: string;
  ruolo: string;
  contenuto: string;
  created_at: string;
  file_nome: string | null;
  file_path: string | null;
  allegati: GaraMessaggioAllegato[];
};

export default function ChatSection({
  garaId,
  messaggi,
}: {
  garaId: string;
  messaggi: GaraMessaggio[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileSelezionati, setFileSelezionati] = useState<File[]>([]);

  function sincronizzaInput(file: File[]) {
    if (!fileInputRef.current) return;
    const dt = new DataTransfer();
    file.forEach((f) => dt.items.add(f));
    fileInputRef.current.files = dt.files;
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const nuovi = Array.from(event.target.files ?? []);
    const combinati = [...fileSelezionati, ...nuovi].slice(0, MAX_ALLEGATI);
    setFileSelezionati(combinati);
    sincronizzaInput(combinati);
  }

  function rimuoviFile(indice: number) {
    const combinati = fileSelezionati.filter((_, i) => i !== indice);
    setFileSelezionati(combinati);
    sincronizzaInput(combinati);
  }

  async function action(prevState: ChatState, formData: FormData) {
    const result = await sendGaraMessage(prevState, formData);
    if (!result.error) {
      formRef.current?.reset();
      setFileSelezionati([]);
    }
    return result;
  }

  const [state, formAction, pending] = useActionState(action, initialState);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messaggi.length, pending]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!pending) {
        formRef.current?.requestSubmit();
      }
    }
  }

  return (
    <section className="omnia-chat">
      <div className="omnia-chat-intestazione">
        <BrandMark stato="riposo" width={28} height={28} />
        <div>
          <h2>Chat con OMNIA AI</h2>
          <p>Documenti, criteri dell&apos;offerta tecnica, ricerche sul web e generazione documenti Word</p>
        </div>
      </div>

      <p className="omnia-chat-nota">
        <strong>Come procedere:</strong> chiedi di sviluppare i criteri uno alla volta (ognuno genera
        una bozza a sé). Solo quando tutti i criteri sono stati sviluppati, chiedi di
        &quot;elaborare la relazione finale&quot; per comporli in un unico documento definitivo.
      </p>

      <div ref={scrollRef} className="omnia-chat-corpo">
        {messaggi.length ? (
          messaggi.map((m) => (
            <div key={m.id} className={`omnia-msg-riga ${m.ruolo}`}>
              <div className={`omnia-msg ${m.ruolo}`}>
                {m.file_nome && (
                  <div className="omnia-allegato-generato">
                    <span style={{ fontSize: 18 }}>📄</span>
                    <span className="nome">{m.file_nome}</span>
                    <OpenInNewTabButton
                      action={downloadGaraMessaggioFile}
                      hiddenFields={{ msgId: m.id }}
                      label="Scarica documento"
                      className="omnia-btn omnia-btn-verde omnia-btn-piccolo"
                    />
                  </div>
                )}
                {m.allegati.length > 0 && (
                  <div className="omnia-allegati-pillole">
                    {m.allegati.map((a) => (
                      <div key={a.id} className="omnia-allegato-pillola">
                        <span>{iconaAllegato(a.nome_file)}</span>
                        <span className="nome">{a.nome_file}</span>
                        <OpenInNewTabButton
                          action={downloadAllegatoMessaggio}
                          hiddenFields={{ allegatoId: a.id }}
                          label="Apri"
                          className="omnia-btn omnia-btn-s omnia-btn-piccolo"
                        />
                      </div>
                    ))}
                  </div>
                )}
                {m.ruolo === "assistente" ? (
                  <div className="prose-chat">
                    <ReactMarkdown>{m.contenuto}</ReactMarkdown>
                  </div>
                ) : (
                  <p style={{ whiteSpace: "pre-wrap" }}>{m.contenuto}</p>
                )}
                <p className="omnia-msg-ora">{new Date(m.created_at).toLocaleString("it-IT")}</p>
              </div>
            </div>
          ))
        ) : (
          <div className="omnia-chat-vuota">
            <p>
              Nessun messaggio ancora. Chiedi qualcosa sui documenti caricati, su un criterio
              dell&apos;offerta tecnica o su un piano di lavoro da preparare.
            </p>
          </div>
        )}
        {pending && <ThinkingIndicator />}
      </div>

      <form ref={formRef} action={formAction} className="omnia-chat-input">
        <input type="hidden" name="garaId" value={garaId} />
        <input
          ref={fileInputRef}
          type="file"
          name="allegati"
          multiple
          accept={ESTENSIONI_ACCETTATE}
          onChange={handleFileChange}
          disabled={pending || fileSelezionati.length >= MAX_ALLEGATI}
          hidden
        />
        {fileSelezionati.length > 0 && (
          <div className="omnia-chat-selezionati">
            {fileSelezionati.map((f, i) => (
              <span key={`${f.name}-${i}`} className="omnia-chat-selezionato">
                {iconaAllegato(f.name)}
                <span className="nome">{f.name}</span>
                <button
                  type="button"
                  onClick={() => rimuoviFile(i)}
                  disabled={pending}
                  aria-label={`Rimuovi ${f.name}`}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="omnia-chat-riga">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={pending || fileSelezionati.length >= MAX_ALLEGATI}
            title="Allega file (immagini, PDF, Word, Excel/CSV)"
            className="omnia-chat-allegabutton"
          >
            📎
          </button>
          <textarea
            ref={textareaRef}
            name="messaggio"
            rows={2}
            disabled={pending}
            onKeyDown={handleKeyDown}
            placeholder="Scrivi un messaggio a OMNIA AI... (Invio per inviare, Maiusc+Invio per andare a capo)"
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
