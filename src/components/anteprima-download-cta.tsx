"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  requestAnteprimaDownload,
  type AnteprimaDownloadState,
} from "@/app/actions/anteprima-download";

export const PDF_URL = "/downloads/offerta-tecnica-pulizie-anteprima.pdf";
const initialState: AnteprimaDownloadState = {};

export default function AnteprimaDownloadCta() {
  const router = useRouter();
  const uid = useId();
  const emailId = `anteprima-email-${uid}`;
  const aziendaId = `anteprima-azienda-${uid}`;
  const garaId = `anteprima-gara-${uid}`;
  const [open, setOpen] = useState(false);
  const downloadRef = useRef<HTMLAnchorElement>(null);
  const submittedRef = useRef(false);
  const [state, formAction, pending] = useActionState(
    requestAnteprimaDownload,
    initialState,
  );

  useEffect(() => {
    if (state.success && submittedRef.current) {
      router.push("/anteprima-scaricata");
    }
  }, [state.success, router]);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  // Il download deve partire subito, nello stesso gesture di click
  // dell'utente sul submit — non dopo l'await della server action,
  // altrimenti alcuni browser lo trattano come popup/non richiesto.
  function handleSubmit() {
    submittedRef.current = true;
    downloadRef.current?.click();
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

      <a ref={downloadRef} href={PDF_URL} download className="hidden" aria-hidden />


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

            <form action={formAction} onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label
                  className="font-mono text-xs tracking-wide text-sage uppercase"
                  htmlFor={emailId}
                >
                  Email
                </label>
                <input
                  id={emailId}
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  className="mt-1.5 w-full rounded-lg border border-border-strong bg-cream px-3 py-2 text-sm text-ink outline-none focus:border-forest"
                />
              </div>

              <div>
                <label
                  className="font-mono text-xs tracking-wide text-sage uppercase"
                  htmlFor={aziendaId}
                >
                  Azienda
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
                  Per quale gara ti serve?
                </label>
                <textarea
                  id={garaId}
                  name="gara"
                  rows={2}
                  placeholder="Ente, oggetto della gara, scadenza — quello che sai già."
                  className="mt-1.5 w-full rounded-lg border border-border-strong bg-cream px-3 py-2 text-sm text-ink outline-none focus:border-forest"
                />
              </div>

              <label className="flex items-start gap-2 text-xs text-sage">
                <input type="checkbox" name="privacy" required className="mt-0.5" />
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

              <label className="flex items-start gap-2 text-xs text-sage">
                <input type="checkbox" name="consenso_commerciale" className="mt-0.5" />
                <span>Acconsento a essere ricontattato per finalità commerciali.</span>
              </label>

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
