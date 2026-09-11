"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import { sendGaraMessage, type ChatState } from "@/app/actions/gara-chat";
import { downloadGaraMessaggioFile, downloadAllegatoMessaggio } from "@/app/actions/download";
import OpenInNewTabButton from "@/components/open-in-new-tab-button";
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
    <section className="mt-8 overflow-hidden rounded-2xl border border-border bg-cream-soft">
      <div className="flex items-center gap-3 border-b border-border px-6 py-4">
        <Image
          src="/omnia-logo.png"
          alt=""
          width={28}
          height={28}
          className="shrink-0"
        />
        <div>
          <h2 className="font-serif text-lg text-ink">Chat con OMNIA AI</h2>
          <p className="text-xs text-sage">
            Documenti, criteri dell&apos;offerta tecnica, ricerche sul web e
            generazione documenti Word
          </p>
        </div>
      </div>

      <p className="border-b border-border bg-cream px-6 py-2 text-xs text-sage">
        <strong className="text-ink">Come procedere:</strong> chiedi di
        sviluppare i criteri uno alla volta (ognuno genera una bozza a sé).
        Solo quando tutti i criteri sono stati sviluppati, chiedi di
        &quot;elaborare la relazione finale&quot; per comporli in un unico
        documento definitivo.
      </p>

      <div
        ref={scrollRef}
        className="max-h-[38rem] min-h-[20rem] space-y-4 overflow-y-auto scroll-smooth px-6 py-6"
      >
        {messaggi.length ? (
          messaggi.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.ruolo === "assistente" ? "justify-start" : "justify-end"}`}
            >
              <div
                className={`max-w-[90%] rounded-2xl px-5 py-3 text-[15px] leading-relaxed shadow-sm sm:max-w-[80%] ${
                  m.ruolo === "assistente"
                    ? "border border-border bg-cream text-ink"
                    : "bg-forest text-cream"
                }`}
              >
                {m.file_nome && (
                  <div className="mb-3 flex items-center gap-3 rounded-xl border-2 border-forest bg-forest/10 px-4 py-3">
                    <span className="text-xl">📄</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                      {m.file_nome}
                    </span>
                    <OpenInNewTabButton
                      action={downloadGaraMessaggioFile}
                      hiddenFields={{ msgId: m.id }}
                      label="Scarica documento"
                      className="shrink-0 rounded-full bg-forest px-4 py-2 font-mono text-[10px] tracking-wide text-cream uppercase hover:bg-forest-dark"
                    />
                  </div>
                )}
                {m.allegati.length > 0 && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {m.allegati.map((a) => (
                      <div
                        key={a.id}
                        className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${
                          m.ruolo === "assistente"
                            ? "border-border-strong bg-cream text-ink"
                            : "border-cream/40 bg-forest-dark/40 text-cream"
                        }`}
                      >
                        <span>{iconaAllegato(a.nome_file)}</span>
                        <span className="max-w-[10rem] truncate">{a.nome_file}</span>
                        <OpenInNewTabButton
                          action={downloadAllegatoMessaggio}
                          hiddenFields={{ allegatoId: a.id }}
                          label="Apri"
                          className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase ${
                            m.ruolo === "assistente"
                              ? "border border-border-strong hover:bg-ink hover:text-cream"
                              : "border border-cream/40 hover:bg-cream hover:text-forest"
                          }`}
                        />
                      </div>
                    ))}
                  </div>
                )}
                {m.ruolo === "assistente" ? (
                  <div className="prose-chat text-justify">
                    <ReactMarkdown>{m.contenuto}</ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-justify whitespace-pre-wrap">
                    {m.contenuto}
                  </p>
                )}
                <p
                  className={`mt-2 text-[10px] ${
                    m.ruolo === "assistente" ? "text-sage" : "text-cream/70"
                  }`}
                >
                  {new Date(m.created_at).toLocaleString("it-IT")}
                </p>
              </div>
            </div>
          ))
        ) : (
          <div className="flex h-full items-center justify-center py-10 text-center">
            <p className="max-w-sm text-sm text-sage">
              Nessun messaggio ancora. Chiedi qualcosa sui documenti caricati,
              su un criterio dell&apos;offerta tecnica o su un piano di
              lavoro da preparare.
            </p>
          </div>
        )}
        {pending && <ThinkingIndicator />}
      </div>

      <form
        ref={formRef}
        action={formAction}
        className="border-t border-border px-6 py-4"
      >
        <input type="hidden" name="garaId" value={garaId} />
        <input
          ref={fileInputRef}
          type="file"
          name="allegati"
          multiple
          accept={ESTENSIONI_ACCETTATE}
          onChange={handleFileChange}
          disabled={pending || fileSelezionati.length >= MAX_ALLEGATI}
          className="hidden"
        />
        {fileSelezionati.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {fileSelezionati.map((f, i) => (
              <span
                key={`${f.name}-${i}`}
                className="flex items-center gap-1.5 rounded-full border border-border-strong bg-cream px-3 py-1 text-xs text-ink"
              >
                {iconaAllegato(f.name)}
                <span className="max-w-[9rem] truncate">{f.name}</span>
                <button
                  type="button"
                  onClick={() => rimuoviFile(i)}
                  disabled={pending}
                  className="text-sage hover:text-red-700"
                  aria-label={`Rimuovi ${f.name}`}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-end gap-3">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={pending || fileSelezionati.length >= MAX_ALLEGATI}
            title="Allega file (immagini, PDF, Word, Excel/CSV)"
            className="shrink-0 rounded-full border border-border-strong px-3 py-3 text-sm text-ink hover:bg-ink hover:text-cream disabled:opacity-50"
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
            className="flex-1 resize-none rounded-xl border border-border bg-cream px-4 py-3 text-sm text-ink focus:border-forest focus:outline-none disabled:bg-border/20 disabled:text-sage"
          />
          <button
            type="submit"
            disabled={pending}
            className="shrink-0 rounded-full bg-forest px-6 py-3 font-mono text-xs tracking-wide text-cream uppercase transition-colors hover:bg-forest-dark disabled:opacity-50"
          >
            {pending ? "Inviato ✓" : "Invia"}
          </button>
        </div>
        {state.error && (
          <p className="mt-2 text-xs text-red-700">{state.error}</p>
        )}
      </form>
    </section>
  );
}
