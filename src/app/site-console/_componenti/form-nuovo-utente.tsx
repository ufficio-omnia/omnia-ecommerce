"use client";

import { useActionState, useState } from "react";
import { creaUtenteDaConsole, type StatoUtenteConsole } from "../azioni/utenti-console";
import { PASSWORD_MAX, PASSWORD_MIN, generaPassword } from "@/lib/console/utenti-console-calcoli";

// Modulo «Nuovo utente». La password la scegli tu (o la generi qui) e la comunichi al cliente:
// non viene salvata da nessuna parte oltre a Supabase Auth, e dal pulsante «Reset password»
// della sua scheda potrai azzerarla e farla scegliere a lui.
export default function FormNuovoUtente() {
  const [stato, esegui, inCorso] = useActionState<StatoUtenteConsole, FormData>(creaUtenteDaConsole, {});
  // Controllati tutti e tre: dopo un'azione React svuota i campi non controllati, e dopo un errore
  // («esiste già un utente…») l'amministratore perderebbe ciò che ha scritto.
  const [email, setEmail] = useState("");
  const [gare, setGare] = useState("1");
  const [password, setPassword] = useState("");
  const [visibile, setVisibile] = useState(false);

  function genera() {
    setPassword(generaPassword(() => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32));
    setVisibile(true);
  }

  return (
    <form action={esegui} className="cn-modulo" autoComplete="off">
      <div>
        <label className="cn-etichetta" htmlFor="email">
          Email del cliente
        </label>
        <input className="cn-input" id="email" name="email" type="email" required autoComplete="off" maxLength={254} placeholder="nome@azienda.it" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>

      <div>
        <label className="cn-etichetta" htmlFor="password">
          Password iniziale ({PASSWORD_MIN}-{PASSWORD_MAX} caratteri, con lettere e cifre)
        </label>
        <div className="cn-ricerca" style={{ margin: 0 }}>
          <input
            className="cn-input mono-campo"
            id="password"
            name="password"
            type={visibile ? "text" : "password"}
            required
            minLength={PASSWORD_MIN}
            maxLength={PASSWORD_MAX}
            autoComplete="new-password"
            spellCheck={false}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="button" className="cn-btn" onClick={genera}>
            Genera
          </button>
          <button type="button" className="cn-btn" onClick={() => setVisibile((v) => !v)}>
            {visibile ? "Nascondi" : "Mostra"}
          </button>
        </div>
        <small className="cn-nota-inline">Copiala prima di salvare: dopo non potrai più rivederla, la console non la conserva.</small>
      </div>

      <div>
        <label className="cn-etichetta" htmlFor="gare">
          Gare gratuite
        </label>
        <input className="cn-input" id="gare" name="gare" type="number" min={0} max={1000} step={1} value={gare} onChange={(e) => setGare(e.target.value)} style={{ maxWidth: 140 }} />
        <small className="cn-nota-inline">
          Una gara si consuma quando parte l&apos;analisi dei documenti. Finite quelle, il cliente può solo consultare e scaricare, e trova l&apos;invito ad abbonarsi. Con 0 vede subito la pagina di attivazione.
        </small>
      </div>

      {stato.errore && (
        <p className="cn-esito errore" role="alert">
          {stato.errore}
        </p>
      )}

      <div className="cn-azione">
        <button type="submit" className="cn-btn primario" disabled={inCorso}>
          {inCorso ? "Creo l'utente…" : "Crea utente"}
        </button>
        <span className="cn-nota-inline">Entra da omnia-ai.it/login con email e password. Nessuna email parte da qui.</span>
      </div>
    </form>
  );
}
