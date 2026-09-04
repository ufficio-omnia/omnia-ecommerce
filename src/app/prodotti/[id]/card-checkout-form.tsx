"use client";

import { useState, useTransition, type FormEvent } from "react";
import { startCardCheckout } from "@/app/actions/checkout";

const inputClass =
  "mt-1 w-full rounded-lg border border-border bg-cream px-3 py-2 text-sm text-ink focus:border-forest focus:outline-none";
const labelClass = "block text-sm font-medium text-ink";

export default function CardCheckoutForm({ productId }: { productId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    // La scheda va aperta subito, in modo sincrono nel submit, altrimenti
    // i browser bloccano window.open() se arriva dopo l'attesa del server.
    const tab = window.open("about:blank", "_blank");
    setError(null);
    setOpened(false);

    startTransition(async () => {
      const result = await startCardCheckout({}, formData);

      if (result.url) {
        if (tab) {
          tab.location.href = result.url;
        } else {
          window.open(result.url, "_blank", "noopener,noreferrer");
        }
        setOpened(true);
      } else {
        tab?.close();
        setError(result.error ?? "Errore imprevisto.");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-3">
      <input type="hidden" name="productId" value={productId} />

      <div>
        <label htmlFor="cardEmail" className={labelClass}>
          Email
        </label>
        <input
          id="cardEmail"
          name="email"
          type="email"
          required
          autoComplete="email"
          className={inputClass}
        />
      </div>

      <div className="border-t border-border pt-3">
        <p className="font-mono text-xs tracking-wide text-sage uppercase">
          Dati di fatturazione
        </p>

        <div className="mt-2">
          <label htmlFor="cardRagioneSociale" className={labelClass}>
            Ragione sociale
          </label>
          <input
            id="cardRagioneSociale"
            name="ragioneSociale"
            type="text"
            required
            className={inputClass}
          />
        </div>

        <div className="mt-2">
          <label htmlFor="cardPartitaIva" className={labelClass}>
            Partita IVA
          </label>
          <input
            id="cardPartitaIva"
            name="partitaIva"
            type="text"
            required
            className={inputClass}
          />
        </div>

        <div className="mt-2">
          <label htmlFor="cardIndirizzo" className={labelClass}>
            Indirizzo
          </label>
          <input
            id="cardIndirizzo"
            name="indirizzo"
            type="text"
            required
            className={inputClass}
          />
        </div>

        <div className="mt-2">
          <label htmlFor="cardCodiceSdi" className={labelClass}>
            Codice SDI
          </label>
          <input
            id="cardCodiceSdi"
            name="codiceSdi"
            type="text"
            className={inputClass}
          />
        </div>

        <div className="mt-2">
          <label htmlFor="cardPec" className={labelClass}>
            PEC
          </label>
          <input id="cardPec" name="pec" type="email" className={inputClass} />
        </div>

        <p className="mt-1 text-xs text-sage">
          Inserisci almeno uno tra codice SDI e PEC.
        </p>
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}
      {opened && (
        <p className="text-sm text-forest">
          Il pagamento si è aperto in una nuova scheda.
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-full bg-ink px-4 py-2.5 font-mono text-xs tracking-wide text-cream uppercase transition-colors hover:bg-forest disabled:opacity-50"
      >
        {isPending ? "Apertura in corso..." : "Paga con carta"}
      </button>
    </form>
  );
}
