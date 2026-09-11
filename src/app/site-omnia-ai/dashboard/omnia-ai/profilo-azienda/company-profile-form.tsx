"use client";

import { useActionState } from "react";
import {
  saveCompanyProfile,
  type CompanyProfileState,
} from "@/app/actions/company-profile";
import type { Company } from "./page";

const initialState: CompanyProfileState = {};

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
    <form action={formAction} style={{ marginTop: 16, display: "grid", gap: 24 }}>
      <section className="omnia-riquadro">
        <span className="omnia-eyebrow">Loghi</span>
        <p className="omnia-riquadro-nota">
          Usati da OMNIA AI per inserire i loghi reali negli organigrammi e nei documenti generati.
        </p>
        <div className="omnia-campo-griglia">
          <div>
            <label htmlFor="logo" className="omnia-etichetta">
              Logo aziendale
            </label>
            <input
              id="logo"
              name="logo"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="omnia-input"
            />
            {company?.logo_path && (
              <span className="omnia-badge verde" style={{ marginTop: 8 }}>
                Logo già caricato
              </span>
            )}
          </div>
          <div>
            <label htmlFor="softwareNome" className="omnia-etichetta">
              Software gestionale in uso
            </label>
            <input
              id="softwareNome"
              name="softwareNome"
              type="text"
              placeholder="es. FM360"
              defaultValue={company?.software_nome ?? ""}
              className="omnia-input"
            />
            <label htmlFor="softwareLogo" className="omnia-etichetta" style={{ marginTop: 12 }}>
              Logo del software
            </label>
            <input
              id="softwareLogo"
              name="softwareLogo"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="omnia-input"
            />
            {company?.software_logo_path && (
              <span className="omnia-badge verde" style={{ marginTop: 8 }}>
                Logo già caricato
              </span>
            )}
          </div>
        </div>
      </section>

      <section className="omnia-riquadro">
        <span className="omnia-eyebrow">Anagrafica</span>
        <div className="omnia-campo-griglia">
          <div className="largo">
            <label htmlFor="ragioneSociale" className="omnia-etichetta">
              Ragione sociale *
            </label>
            <input
              id="ragioneSociale"
              name="ragioneSociale"
              type="text"
              required
              defaultValue={company?.ragione_sociale ?? ""}
              className="omnia-input"
            />
          </div>
          <div>
            <label htmlFor="partitaIva" className="omnia-etichetta">
              P.IVA *
            </label>
            <input
              id="partitaIva"
              name="partitaIva"
              type="text"
              required
              defaultValue={company?.partita_iva ?? ""}
              className="omnia-input"
            />
          </div>
          <div>
            <label htmlFor="codiceFiscale" className="omnia-etichetta">
              Codice fiscale
            </label>
            <input
              id="codiceFiscale"
              name="codiceFiscale"
              type="text"
              defaultValue={company?.codice_fiscale ?? ""}
              className="omnia-input"
            />
          </div>
          <div>
            <label htmlFor="formaGiuridica" className="omnia-etichetta">
              Forma giuridica
            </label>
            <input
              id="formaGiuridica"
              name="formaGiuridica"
              type="text"
              placeholder="es. SRL, SPA, ditta individuale"
              defaultValue={company?.forma_giuridica ?? ""}
              className="omnia-input"
            />
          </div>
          <div>
            <label htmlFor="annoCostituzione" className="omnia-etichetta">
              Anno di costituzione
            </label>
            <input
              id="annoCostituzione"
              name="annoCostituzione"
              type="number"
              min={1900}
              max={2100}
              defaultValue={company?.anno_costituzione ?? ""}
              className="omnia-input"
            />
          </div>
          <div className="largo">
            <label htmlFor="indirizzo" className="omnia-etichetta">
              Indirizzo
            </label>
            <input
              id="indirizzo"
              name="indirizzo"
              type="text"
              defaultValue={company?.indirizzo ?? ""}
              className="omnia-input"
            />
          </div>
          <div>
            <label htmlFor="codiceSdi" className="omnia-etichetta">
              Codice SDI
            </label>
            <input
              id="codiceSdi"
              name="codiceSdi"
              type="text"
              defaultValue={company?.codice_sdi ?? ""}
              className="omnia-input"
            />
          </div>
          <div>
            <label htmlFor="pec" className="omnia-etichetta">
              PEC
            </label>
            <input
              id="pec"
              name="pec"
              type="email"
              defaultValue={company?.pec ?? ""}
              className="omnia-input"
            />
          </div>
          <div>
            <label htmlFor="sitoWeb" className="omnia-etichetta">
              Sito web
            </label>
            <input
              id="sitoWeb"
              name="sitoWeb"
              type="text"
              placeholder="www.esempio.it"
              defaultValue={company?.sito_web ?? ""}
              className="omnia-input"
            />
          </div>
          <div>
            <label htmlFor="telefonoAziendale" className="omnia-etichetta">
              Telefono aziendale
            </label>
            <input
              id="telefonoAziendale"
              name="telefonoAziendale"
              type="tel"
              defaultValue={company?.telefono_aziendale ?? ""}
              className="omnia-input"
            />
          </div>
        </div>
      </section>

      <section className="omnia-riquadro">
        <span className="omnia-eyebrow">Capacità organizzativa ed economica</span>
        <div className="omnia-campo-griglia">
          <div>
            <label htmlFor="numeroDipendenti" className="omnia-etichetta">
              Numero dipendenti / organico
            </label>
            <input
              id="numeroDipendenti"
              name="numeroDipendenti"
              type="number"
              min={0}
              defaultValue={company?.numero_dipendenti ?? ""}
              className="omnia-input"
            />
          </div>
          <div>
            <label htmlFor="fatturatoMedioAnnuo" className="omnia-etichetta">
              Fatturato medio annuo (€)
            </label>
            <input
              id="fatturatoMedioAnnuo"
              name="fatturatoMedioAnnuo"
              type="number"
              min={0}
              step="0.01"
              defaultValue={company?.fatturato_medio_annuo ?? ""}
              className="omnia-input"
            />
          </div>
        </div>
      </section>

      <section className="omnia-riquadro">
        <span className="omnia-eyebrow">Certificazioni e ambiti di attività</span>
        <div style={{ marginTop: 20, display: "grid", gap: 16 }}>
          <div>
            <label htmlFor="certificazioni" className="omnia-etichetta">
              Certificazioni possedute
            </label>
            <textarea
              id="certificazioni"
              name="certificazioni"
              rows={3}
              placeholder="es. ISO 9001, ISO 14001, ISO 45001, attestazione SOA..."
              defaultValue={company?.certificazioni ?? ""}
              className="omnia-textarea"
            />
          </div>
          <div>
            <label htmlFor="settoriAttivita" className="omnia-etichetta">
              Settori di attività
            </label>
            <textarea
              id="settoriAttivita"
              name="settoriAttivita"
              rows={2}
              placeholder="es. pulizie civili, industriali, sanificazione..."
              defaultValue={company?.settori_attivita ?? ""}
              className="omnia-textarea"
            />
          </div>
        </div>
      </section>

      <section className="omnia-riquadro">
        <span className="omnia-eyebrow">Esperienza e presentazione</span>
        <div style={{ marginTop: 20, display: "grid", gap: 16 }}>
          <div>
            <label htmlFor="referenze" className="omnia-etichetta">
              Referenze / lavori pregressi rilevanti
            </label>
            <textarea
              id="referenze"
              name="referenze"
              rows={4}
              placeholder="Elenco di gare/appalti pulizie svolti in precedenza, committenti, importi..."
              defaultValue={company?.referenze ?? ""}
              className="omnia-textarea"
            />
          </div>
          <div>
            <label htmlFor="presentazione" className="omnia-etichetta">
              Breve presentazione aziendale
            </label>
            <textarea
              id="presentazione"
              name="presentazione"
              rows={4}
              placeholder="Chi siete, cosa vi contraddistingue, punti di forza..."
              defaultValue={company?.presentazione ?? ""}
              className="omnia-textarea"
            />
          </div>
        </div>
      </section>

      {state.error && <p className="omnia-messaggio-stato errore">{state.error}</p>}
      {state.success && <p className="omnia-messaggio-stato successo">Profilo azienda salvato correttamente.</p>}

      <button type="submit" disabled={pending} className="omnia-btn omnia-btn-p" style={{ justifySelf: "start" }}>
        {pending ? "Salvataggio..." : "Salva profilo"}
      </button>
    </form>
  );
}
