"use client";

import { useActionState, useState } from "react";
import { startBankTransferOrder, type ActionState } from "@/app/actions/checkout";

const initialState: ActionState = {};

const inputClass =
  "mt-1 w-full rounded-lg border border-border bg-cream px-3 py-2 text-sm text-ink focus:border-forest focus:outline-none";
const labelClass = "block text-sm font-medium text-ink";
const checkboxRowClass = "mt-3 flex items-start gap-2";
const checkboxInputClass = "mt-0.5 h-4 w-4 shrink-0";
const checkboxLabelClass = "text-xs text-sage";
const linkClass = "text-forest underline";

export default function BankTransferForm({
  productId,
  condizioniVersion,
  privacyVersion,
}: {
  productId: string;
  condizioniVersion: number;
  privacyVersion: number;
}) {
  const [state, formAction, pending] = useActionState(
    startBankTransferOrder,
    initialState,
  );
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

  return (
    <form action={formAction} className="mt-4 space-y-3">
      <input type="hidden" name="productId" value={productId} />

      <div>
        <label htmlFor="email" className={labelClass}>
          Email
        </label>
        <input
          id="email"
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
          <label htmlFor="ragioneSociale" className={labelClass}>
            {buyerType === "azienda" ? "Ragione sociale" : "Nome e cognome"}
          </label>
          <input
            id="ragioneSociale"
            name="ragioneSociale"
            type="text"
            required
            className={inputClass}
          />
        </div>

        {buyerType === "azienda" ? (
          <div className="mt-2">
            <label htmlFor="partitaIva" className={labelClass}>
              Partita IVA
            </label>
            <input
              id="partitaIva"
              name="partitaIva"
              type="text"
              required
              className={inputClass}
            />
          </div>
        ) : (
          <div className="mt-2">
            <label htmlFor="codiceFiscale" className={labelClass}>
              Codice fiscale
            </label>
            <input
              id="codiceFiscale"
              name="codiceFiscale"
              type="text"
              required
              className={inputClass}
            />
          </div>
        )}

        <div className="mt-2">
          <label htmlFor="indirizzo" className={labelClass}>
            Indirizzo
          </label>
          <input
            id="indirizzo"
            name="indirizzo"
            type="text"
            required
            className={inputClass}
          />
        </div>

        {buyerType === "azienda" && (
          <>
            <div className="mt-2">
              <label htmlFor="codiceSdi" className={labelClass}>
                Codice SDI
              </label>
              <input
                id="codiceSdi"
                name="codiceSdi"
                type="text"
                className={inputClass}
              />
            </div>

            <div className="mt-2">
              <label htmlFor="pec" className={labelClass}>
                PEC
              </label>
              <input id="pec" name="pec" type="email" className={inputClass} />
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
            id="acceptCondizioniPrivacy"
            name="acceptCondizioniPrivacy"
            type="checkbox"
            checked={acceptCondizioniPrivacy}
            onChange={(e) => setAcceptCondizioniPrivacy(e.target.checked)}
            required
            className={checkboxInputClass}
          />
          <label htmlFor="acceptCondizioniPrivacy" className={checkboxLabelClass}>
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
              id="acceptEsecuzioneImmediata"
              name="acceptEsecuzioneImmediata"
              type="checkbox"
              checked={acceptEsecuzioneImmediata}
              onChange={(e) => setAcceptEsecuzioneImmediata(e.target.checked)}
              required
              className={checkboxInputClass}
            />
            <label
              htmlFor="acceptEsecuzioneImmediata"
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
            id="acceptClausoleSpecifiche"
            name="acceptClausoleSpecifiche"
            type="checkbox"
            checked={acceptClausoleSpecifiche}
            onChange={(e) => setAcceptClausoleSpecifiche(e.target.checked)}
            required
            className={checkboxInputClass}
          />
          <label htmlFor="acceptClausoleSpecifiche" className={checkboxLabelClass}>
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

      {state.error && <p className="text-sm text-red-700">{state.error}</p>}

      <button
        type="submit"
        disabled={pending || !canSubmit}
        className="w-full rounded-full bg-forest px-4 py-2.5 font-mono text-xs tracking-wide text-cream uppercase transition-colors hover:bg-forest-dark disabled:opacity-50"
      >
        {pending ? "Elaborazione..." : "Ordina con bonifico"}
      </button>
    </form>
  );
}
