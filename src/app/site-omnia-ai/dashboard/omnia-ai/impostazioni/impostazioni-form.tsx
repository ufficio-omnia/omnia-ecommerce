"use client";

import { useActionState } from "react";
import {
  updateAccountEmail,
  updateAccountPassword,
  type AccountSettingsState,
} from "@/app/actions/omnia-ai-account-settings";

const STATO_INIZIALE: AccountSettingsState = {};

function Esito({ state }: { state: AccountSettingsState }) {
  if (state.error) return <p className="omnia-messaggio-stato errore">{state.error}</p>;
  if (state.success) return <p className="omnia-messaggio-stato successo">{state.success}</p>;
  return null;
}

export default function ImpostazioniForm({ emailAttuale }: { emailAttuale: string }) {
  const [statoEmail, azioneEmail, pendingEmail] = useActionState(updateAccountEmail, STATO_INIZIALE);
  const [statoPassword, azionePassword, pendingPassword] = useActionState(
    updateAccountPassword,
    STATO_INIZIALE,
  );

  return (
    <>
      <section className="omnia-riquadro">
        <span className="omnia-eyebrow">Email di accesso</span>
        <form action={azioneEmail} className="omnia-form-riga" style={{ marginTop: 16 }}>
          <input
            type="email"
            name="email"
            defaultValue={emailAttuale}
            required
            className="omnia-input"
            style={{ flex: 1, minWidth: 220 }}
          />
          <button type="submit" disabled={pendingEmail} className="omnia-btn omnia-btn-p">
            {pendingEmail ? "Invio..." : "Cambia email"}
          </button>
        </form>
        <Esito state={statoEmail} />
      </section>

      <section className="omnia-riquadro">
        <span className="omnia-eyebrow">Password</span>
        <form action={azionePassword} style={{ marginTop: 16 }}>
          <div className="omnia-campo-griglia">
            <input
              type="password"
              name="password"
              placeholder="Nuova password"
              required
              minLength={8}
              className="omnia-input"
            />
            <input
              type="password"
              name="confirmPassword"
              placeholder="Conferma nuova password"
              required
              minLength={8}
              className="omnia-input"
            />
          </div>
          <button
            type="submit"
            disabled={pendingPassword}
            className="omnia-btn omnia-btn-p"
            style={{ marginTop: 16 }}
          >
            {pendingPassword ? "Salvataggio..." : "Cambia password"}
          </button>
        </form>
        <Esito state={statoPassword} />
      </section>
    </>
  );
}
