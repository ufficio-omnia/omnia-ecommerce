"use client";

import { useActionState } from "react";
import {
  saveCompanyProfile,
  type CompanyProfileState,
} from "@/app/actions/company-profile";
import type { Company } from "./page";

const initialState: CompanyProfileState = {};

const inputClass =
  "mt-1 w-full rounded-lg border border-border bg-cream px-3 py-2 text-sm text-ink focus:border-forest focus:outline-none";

const labelClass = "block text-sm font-medium text-ink";

export default function CompanyProfileForm({
  company,
}: {
  company: Company | null;
}) {
  const [state, formAction, pending] = useActionState(
    saveCompanyProfile,
    initialState,
  );

  return (
    <form action={formAction} className="mt-8 space-y-8">
      <section className="rounded-2xl border border-border bg-cream-soft p-5">
        <h2 className="font-mono text-xs tracking-wide text-sage uppercase">
          Loghi
        </h2>
        <p className="mt-1 text-xs text-sage">
          Usati da OMNIA AI per inserire i loghi reali negli organigrammi e nei
          documenti generati.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="logo" className={labelClass}>
              Logo aziendale
            </label>
            <input
              id="logo"
              name="logo"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className={inputClass}
            />
            {company?.logo_path && (
              <p className="mt-1 text-xs text-forest">Logo già caricato.</p>
            )}
          </div>
          <div>
            <label htmlFor="softwareNome" className={labelClass}>
              Software gestionale in uso
            </label>
            <input
              id="softwareNome"
              name="softwareNome"
              type="text"
              placeholder="es. FM360"
              defaultValue={company?.software_nome ?? ""}
              className={inputClass}
            />
            <label htmlFor="softwareLogo" className={`${labelClass} mt-2`}>
              Logo del software
            </label>
            <input
              id="softwareLogo"
              name="softwareLogo"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className={inputClass}
            />
            {company?.software_logo_path && (
              <p className="mt-1 text-xs text-forest">Logo già caricato.</p>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-cream-soft p-5">
        <h2 className="font-mono text-xs tracking-wide text-sage uppercase">
          Anagrafica
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="ragioneSociale" className={labelClass}>
              Ragione sociale *
            </label>
            <input
              id="ragioneSociale"
              name="ragioneSociale"
              type="text"
              required
              defaultValue={company?.ragione_sociale ?? ""}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="partitaIva" className={labelClass}>
              P.IVA *
            </label>
            <input
              id="partitaIva"
              name="partitaIva"
              type="text"
              required
              defaultValue={company?.partita_iva ?? ""}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="codiceFiscale" className={labelClass}>
              Codice fiscale
            </label>
            <input
              id="codiceFiscale"
              name="codiceFiscale"
              type="text"
              defaultValue={company?.codice_fiscale ?? ""}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="formaGiuridica" className={labelClass}>
              Forma giuridica
            </label>
            <input
              id="formaGiuridica"
              name="formaGiuridica"
              type="text"
              placeholder="es. SRL, SPA, ditta individuale"
              defaultValue={company?.forma_giuridica ?? ""}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="annoCostituzione" className={labelClass}>
              Anno di costituzione
            </label>
            <input
              id="annoCostituzione"
              name="annoCostituzione"
              type="number"
              min={1900}
              max={2100}
              defaultValue={company?.anno_costituzione ?? ""}
              className={inputClass}
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="indirizzo" className={labelClass}>
              Indirizzo
            </label>
            <input
              id="indirizzo"
              name="indirizzo"
              type="text"
              defaultValue={company?.indirizzo ?? ""}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="codiceSdi" className={labelClass}>
              Codice SDI
            </label>
            <input
              id="codiceSdi"
              name="codiceSdi"
              type="text"
              defaultValue={company?.codice_sdi ?? ""}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="pec" className={labelClass}>
              PEC
            </label>
            <input
              id="pec"
              name="pec"
              type="email"
              defaultValue={company?.pec ?? ""}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="sitoWeb" className={labelClass}>
              Sito web
            </label>
            <input
              id="sitoWeb"
              name="sitoWeb"
              type="text"
              placeholder="www.esempio.it"
              defaultValue={company?.sito_web ?? ""}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="telefonoAziendale" className={labelClass}>
              Telefono aziendale
            </label>
            <input
              id="telefonoAziendale"
              name="telefonoAziendale"
              type="tel"
              defaultValue={company?.telefono_aziendale ?? ""}
              className={inputClass}
            />
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-cream-soft p-5">
        <h2 className="font-mono text-xs tracking-wide text-sage uppercase">
          Capacità organizzativa ed economica
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="numeroDipendenti" className={labelClass}>
              Numero dipendenti / organico
            </label>
            <input
              id="numeroDipendenti"
              name="numeroDipendenti"
              type="number"
              min={0}
              defaultValue={company?.numero_dipendenti ?? ""}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="fatturatoMedioAnnuo" className={labelClass}>
              Fatturato medio annuo (€)
            </label>
            <input
              id="fatturatoMedioAnnuo"
              name="fatturatoMedioAnnuo"
              type="number"
              min={0}
              step="0.01"
              defaultValue={company?.fatturato_medio_annuo ?? ""}
              className={inputClass}
            />
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-cream-soft p-5">
        <h2 className="font-mono text-xs tracking-wide text-sage uppercase">
          Certificazioni e ambiti di attività
        </h2>
        <div className="mt-4 space-y-4">
          <div>
            <label htmlFor="certificazioni" className={labelClass}>
              Certificazioni possedute
            </label>
            <textarea
              id="certificazioni"
              name="certificazioni"
              rows={3}
              placeholder="es. ISO 9001, ISO 14001, ISO 45001, attestazione SOA..."
              defaultValue={company?.certificazioni ?? ""}
              className={`${inputClass} text-justify`}
            />
          </div>
          <div>
            <label htmlFor="settoriAttivita" className={labelClass}>
              Settori di attività
            </label>
            <textarea
              id="settoriAttivita"
              name="settoriAttivita"
              rows={2}
              placeholder="es. pulizie civili, industriali, sanificazione..."
              defaultValue={company?.settori_attivita ?? ""}
              className={`${inputClass} text-justify`}
            />
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-cream-soft p-5">
        <h2 className="font-mono text-xs tracking-wide text-sage uppercase">
          Esperienza e presentazione
        </h2>
        <div className="mt-4 space-y-4">
          <div>
            <label htmlFor="referenze" className={labelClass}>
              Referenze / lavori pregressi rilevanti
            </label>
            <textarea
              id="referenze"
              name="referenze"
              rows={4}
              placeholder="Elenco di gare/appalti pulizie svolti in precedenza, committenti, importi..."
              defaultValue={company?.referenze ?? ""}
              className={`${inputClass} text-justify`}
            />
          </div>
          <div>
            <label htmlFor="presentazione" className={labelClass}>
              Breve presentazione aziendale
            </label>
            <textarea
              id="presentazione"
              name="presentazione"
              rows={4}
              placeholder="Chi siete, cosa vi contraddistingue, punti di forza..."
              defaultValue={company?.presentazione ?? ""}
              className={`${inputClass} text-justify`}
            />
          </div>
        </div>
      </section>

      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
      {state.success && (
        <p className="text-sm text-forest">
          Profilo azienda salvato correttamente.
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-forest px-6 py-2.5 font-mono text-xs tracking-wide text-cream uppercase transition-colors hover:bg-forest-dark disabled:opacity-50"
      >
        {pending ? "Salvataggio..." : "Salva profilo"}
      </button>
    </form>
  );
}
