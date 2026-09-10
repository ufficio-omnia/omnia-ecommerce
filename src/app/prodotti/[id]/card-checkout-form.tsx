"use client";

import { useState, useTransition, type FormEvent } from "react";
import { startCardCheckout } from "@/app/actions/checkout";

const inputClass =
  "mt-1 w-full rounded-lg border border-border bg-cream px-3 py-2 text-sm text-ink focus:border-forest focus:outline-none";
const labelClass = "block text-sm font-medium text-ink";
const checkboxRowClass = "mt-3 flex items-start gap-2";
const checkboxInputClass = "mt-0.5 h-4 w-4 shrink-0";
const checkboxLabelClass = "text-xs text-sage";
const linkClass = "text-forest underline";

export default function CardCheckoutForm({
  productId,
  condizioniVersion,
  privacyVersion,
}: {
  productId: string;
  condizioniVersion: number;
  privacyVersion: number;
}) {
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [buyerType, setBuyerType] = useState<"azienda" | "consumatore">(
    "azienda",
  );
  const [acceptCondizioniPrivacy, setAcceptCondizioniPrivacy] = useState(false);
  const [acceptEsecuzioneImmediata, setAcceptEsecuzioneImmediata] =
    useState(false);
  const [acceptClausoleSpecifiche, setAcceptClausoleSpecifiche] =
    useState(false);

  const canSubmit =
    acceptCondizioniPrivacy &&
    acceptClausoleSpecifiche &&
    (buyerType === "azienda" || acceptEsecuzioneImmediata);

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
        <p className={labelClass}>Tipo di acquirente</p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:gap-4">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="radio"
              name="buyerType"
              value="azienda"
              checked={buyerType === "azienda"}
              onChange={() => setBuyerType("azienda")}
              required
            />
            Azienda / libero professionista
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="radio"
              name="buyerType"
              value="consumatore"
              checked={buyerType === "consumatore"}
              onChange={() => setBuyerType("consumatore")}
            />
            Privato consumatore
          </label>
        </div>
      </div>

      <div className="border-t border-border pt-3">
        <p className="font-mono text-xs tracking-wide text-sage uppercase">
          Dati di fatturazione
        </p>

        <div className="mt-2">
          <label htmlFor="cardRagioneSociale" className={labelClass}>
            {buyerType === "azienda" ? "Ragione sociale" : "Nome e cognome"}
          </label>
          <input
            id="cardRagioneSociale"
            name="ragioneSociale"
            type="text"
            required
            className={inputClass}
          />
        </div>

        {buyerType === "azienda" ? (
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
        ) : (
          <div className="mt-2">
            <label htmlFor="cardCodiceFiscale" className={labelClass}>
              Codice fiscale
            </label>
            <input
              id="cardCodiceFiscale"
              name="codiceFiscale"
              type="text"
              required
              className={inputClass}
            />
          </div>
        )}

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

        {buyerType === "azienda" && (
          <>
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
          </>
        )}
      </div>

      <div className="border-t border-border pt-3">
        <p className="font-mono text-xs tracking-wide text-sage uppercase">
          Condizioni contrattuali
        </p>

        <div className={checkboxRowClass}>
          <input
            id="cardAcceptCondizioniPrivacy"
            name="acceptCondizioniPrivacy"
            type="checkbox"
            checked={acceptCondizioniPrivacy}
            onChange={(e) => setAcceptCondizioniPrivacy(e.target.checked)}
            required
            className={checkboxInputClass}
          />
          <label
            htmlFor="cardAcceptCondizioniPrivacy"
            className={checkboxLabelClass}
          >
            Dichiaro di aver letto e accettato le{" "}
            <a
              href={`/documenti-legali/condizioni-vendita/${condizioniVersion}`}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
            >
              Condizioni generali di vendita (versione {condizioniVersion})
            </a>{" "}
            e di aver preso visione della{" "}
            <a
              href={`/documenti-legali/privacy-policy/${privacyVersion}`}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
            >
              Privacy policy (versione {privacyVersion})
            </a>
            .
          </label>
        </div>

        {buyerType === "consumatore" && (
          <div className={checkboxRowClass}>
            <input
              id="cardAcceptEsecuzioneImmediata"
              name="acceptEsecuzioneImmediata"
              type="checkbox"
              checked={acceptEsecuzioneImmediata}
              onChange={(e) => setAcceptEsecuzioneImmediata(e.target.checked)}
              required
              className={checkboxInputClass}
            />
            <label
              htmlFor="cardAcceptEsecuzioneImmediata"
              className={checkboxLabelClass}
            >
              Chiedo espressamente l&apos;esecuzione immediata della fornitura
              di contenuto digitale e riconosco che ciò comporta la perdita
              del diritto di recesso.
            </label>
          </div>
        )}

        <div className={checkboxRowClass}>
          <input
            id="cardAcceptClausoleSpecifiche"
            name="acceptClausoleSpecifiche"
            type="checkbox"
            checked={acceptClausoleSpecifiche}
            onChange={(e) => setAcceptClausoleSpecifiche(e.target.checked)}
            required
            className={checkboxInputClass}
          />
          <label
            htmlFor="cardAcceptClausoleSpecifiche"
            className={checkboxLabelClass}
          >
            Dichiaro di approvare specificamente, ai sensi di legge, le
            clausole n.{" "}
            <a
              href={`/documenti-legali/condizioni-vendita/${condizioniVersion}#clausola-7`}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
            >
              7
            </a>{" "}
            (Licenza d&apos;uso),{" "}
            <a
              href={`/documenti-legali/condizioni-vendita/${condizioniVersion}#clausola-8`}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
            >
              8
            </a>{" "}
            (Nessuna garanzia sull&apos;esito della gara),{" "}
            <a
              href={`/documenti-legali/condizioni-vendita/${condizioniVersion}#clausola-11`}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
            >
              11
            </a>{" "}
            (Limitazione di responsabilità) e{" "}
            <a
              href={`/documenti-legali/condizioni-vendita/${condizioniVersion}#clausola-14`}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
            >
              14
            </a>{" "}
            (Legge applicabile e foro) delle Condizioni generali di vendita.
          </label>
        </div>
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}
      {opened && (
        <p className="text-sm text-forest">
          Il pagamento si è aperto in una nuova scheda.
        </p>
      )}

      <button
        type="submit"
        disabled={isPending || !canSubmit}
        className="w-full rounded-full bg-ink px-4 py-2.5 font-mono text-xs tracking-wide text-cream uppercase transition-colors hover:bg-forest disabled:opacity-50"
      >
        {isPending ? "Apertura in corso..." : "Paga con carta"}
      </button>
    </form>
  );
}
