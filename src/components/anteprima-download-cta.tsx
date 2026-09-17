"use client";

import { useEffect, useId, useRef, useState, useActionState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  requestAnteprimaDownload,
  type AnteprimaDownloadState,
} from "@/app/actions/anteprima-download";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const initialState: AnteprimaDownloadState = {};

type FieldErrors = { email?: string; privacy?: string };

export default function AnteprimaDownloadCta() {
  const router = useRouter();
  const uid = useId();
  const emailId = `anteprima-email-${uid}`;
  const aziendaId = `anteprima-azienda-${uid}`;
  const garaId = `anteprima-gara-${uid}`;
  const [open, setOpen] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const downloadRef = useRef<HTMLAnchorElement>(null);
  const submittedRef = useRef(false);
  const [state, formAction, pending] = useActionState(
    requestAnteprimaDownload,
    initialState,
  );

  // Il signed URL non esiste finché il server non lo genera (dopo la
  // validazione): il download può partire solo qui, a risposta ricevuta —
  // niente window.open (bloccabile come popup dopo un await), un <a
  // download> cliccato via ref non ha questo problema. Content-Disposition:
  // attachment è impostato server-side sul signed URL stesso, quindi il
  // click scarica il file senza far navigare via la pagina corrente.
  useEffect(() => {
    if (state.success && state.downloadUrl && submittedRef.current) {
      submittedRef.current = false;
      // Il click sul download e la navigazione alla thank-you page sono
      // due effetti indipendenti: se il primo lancia un'eccezione (alcuni
      // browser/estensioni possono bloccare un click programmato su un
      // link cross-origin), il secondo deve avvenire comunque — l'utente
      // ha già superato la validazione, non deve restare bloccato sul
      // modale solo perché il trigger del download ha avuto un problema.
      try {
        if (downloadRef.current) {
          downloadRef.current.href = state.downloadUrl;
          downloadRef.current.click();
        }
      } catch (err) {
        console.error("anteprima-download-cta: click sul download fallito", err);
      }
      router.push(`/anteprima-scaricata?u=${encodeURIComponent(state.downloadUrl)}`);
    }
  }, [state, router]);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  // Validazione client con errori inline sotto i campi: niente alert nativi
  // del browser (blocchiamo con noValidate sul form). È comunque solo un
  // filtro di UX — la validazione che conta è quella server-side in
  // requestAnteprimaDownload, senza la quale il file non verrebbe servito
  // a prescindere da cosa succede qui.
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    const form = e.currentTarget;
    const email = (form.elements.namedItem("email") as HTMLInputElement).value.trim();
    const privacy = (form.elements.namedItem("privacy") as HTMLInputElement).checked;

    const errors: FieldErrors = {};
    if (!email) errors.email = "L'email è obbligatoria.";
    else if (!EMAIL_REGEX.test(email)) errors.email = "Inserisci un indirizzo email valido.";
    if (!privacy) errors.privacy = "Devi prendere visione dell'informativa privacy per procedere.";

    if (Object.keys(errors).length > 0) {
      e.preventDefault();
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    submittedRef.current = true;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-6 rounded-full bg-forest px-6 py-3 font-mono text-xs tracking-wide text-cream uppercase transition-colors hover:bg-forest-dark"
      >
        Scarica l&apos;anteprima gratuita
      </button>

      <a ref={downloadRef} href="#" download className="hidden" aria-hidden />

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Scarica l'anteprima gratuita"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border bg-cream-soft p-6 sm:p-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <h3 className="font-serif text-xl text-ink">
                Scarica l&apos;anteprima gratuita
              </h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Chiudi"
                className="font-mono text-xs tracking-wide text-sage uppercase hover:text-ink"
              >
                Chiudi ✕
              </button>
            </div>
            <p className="mt-2 text-sm text-sage">
              Nessun acquisto richiesto. Il download parte subito dopo
              l&apos;invio.
            </p>

            <form
              action={formAction}
              onSubmit={handleSubmit}
              noValidate
              className="mt-6 space-y-4"
            >
              <div>
                <label
                  className="font-mono text-xs tracking-wide text-sage uppercase"
                  htmlFor={emailId}
                >
                  Email *
                </label>
                <input
                  id={emailId}
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  aria-invalid={!!fieldErrors.email}
                  aria-describedby={fieldErrors.email ? `${emailId}-error` : undefined}
                  className="mt-1.5 w-full rounded-lg border border-border-strong bg-cream px-3 py-2 text-sm text-ink outline-none focus:border-forest"
                />
                {fieldErrors.email && (
                  <p id={`${emailId}-error`} className="mt-1 text-xs text-red-700">
                    {fieldErrors.email}
                  </p>
                )}
              </div>

              <div>
                <label
                  className="font-mono text-xs tracking-wide text-sage uppercase"
                  htmlFor={aziendaId}
                >
                  Azienda (facoltativo)
                </label>
                <input
                  id={aziendaId}
                  name="azienda"
                  type="text"
                  autoComplete="organization"
                  className="mt-1.5 w-full rounded-lg border border-border-strong bg-cream px-3 py-2 text-sm text-ink outline-none focus:border-forest"
                />
              </div>

              <div>
                <label
                  className="font-mono text-xs tracking-wide text-sage uppercase"
                  htmlFor={garaId}
                >
                  Per quale gara ti serve? (facoltativo)
                </label>
                <textarea
                  id={garaId}
                  name="gara"
                  rows={2}
                  placeholder="Ente, oggetto della gara, scadenza — quello che sai già."
                  className="mt-1.5 w-full rounded-lg border border-border-strong bg-cream px-3 py-2 text-sm text-ink outline-none focus:border-forest"
                />
              </div>

              <div>
                <label className="flex items-start gap-2 text-xs text-sage">
                  <input
                    type="checkbox"
                    name="privacy"
                    required
                    aria-invalid={!!fieldErrors.privacy}
                    aria-describedby={fieldErrors.privacy ? "anteprima-privacy-error" : undefined}
                    className="mt-0.5"
                  />
                  <span>
                    Ho preso visione dell&apos;
                    <Link
                      href="/privacy"
                      target="_blank"
                      className="text-forest underline underline-offset-2 hover:text-forest-dark"
                    >
                      informativa privacy
                    </Link>
                    . *
                  </span>
                </label>
                {fieldErrors.privacy && (
                  <p id="anteprima-privacy-error" className="mt-1 text-xs text-red-700">
                    {fieldErrors.privacy}
                  </p>
                )}
              </div>

              <label className="flex items-start gap-2 text-xs text-sage">
                <input type="checkbox" name="consenso_commerciale" className="mt-0.5" />
                <span>Acconsento a essere ricontattato per finalità commerciali.</span>
              </label>

              <p className="text-[11px] text-sage">* Campi obbligatori</p>

              {state.error && <p className="text-sm text-red-700">{state.error}</p>}

              <button
                type="submit"
                disabled={pending}
                className="w-full rounded-full bg-forest px-6 py-3 text-center font-mono text-xs tracking-wide text-cream uppercase transition-colors hover:bg-forest-dark disabled:opacity-60"
              >
                {pending ? "Invio in corso…" : "Scarica l'anteprima"}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
