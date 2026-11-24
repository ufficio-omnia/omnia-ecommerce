"use client";

import { useActionState } from "react";
import { salvaEmailImpresa, salvaPreferenzeNotifiche, type StatoNotifiche } from "@/app/actions/radar-notifiche";

// Pagina «Notifiche» (fase B4, grado 3): i due moduli. Nel browser nessun dato oltre a quelli passati dal server e nessuna lettura: il server
// ricontrolla tutto (guardia, impresa, regola «solo spegnere» dell'Ufficio Gare). Nessun aggiornamento periodico.

type Categoria = "nuove_opportunita" | "scadenze" | "rettifiche";
export type TestiCategorie = Record<Categoria, { titolo: string; descrizione: string }>;
const CATEGORIE: Categoria[] = ["nuove_opportunita", "scadenze", "rettifiche"];

function Esito({ stato }: { stato: StatoNotifiche }) {
  if (stato.errore)
    return (
      <p className="omnia-messaggio-stato errore" role="alert">
        {stato.errore}
      </p>
    );
  if (stato.ok && stato.messaggio)
    return (
      <p className="omnia-messaggio-stato successo" role="status">
        {stato.messaggio}
      </p>
    );
  return null;
}

/** Interruttore delle email dell'impresa: lo cambia solo il titolare (modificabile); gli altri vedono lo stato. */
export function InterruttoreEmailImpresa({ attive, modificabile }: { attive: boolean; modificabile: boolean }) {
  const [stato, azione, inCorso] = useActionState<StatoNotifiche, FormData>(salvaEmailImpresa, {});
  return (
    <form action={azione} className="omnia-modulo">
      <p className="omnia-opp-prosa">
        Oggi gli avvisi email dell&apos;impresa sono <strong>{attive ? "accesi" : "spenti"}</strong>
        {modificabile ? "." : " dal titolare dell'impresa."}
      </p>
      {modificabile && (
        <>
          <input type="hidden" name="attive" value={attive ? "no" : "si"} />
          <button type="submit" className={`omnia-btn ${attive ? "omnia-btn-s" : "omnia-btn-p"} omnia-btn-piccolo`} disabled={inCorso}>
            {inCorso ? "Salvataggio in corso…" : attive ? "Spegni gli avvisi email" : "Accendi gli avvisi email"}
          </button>
        </>
      )}
      <Esito stato={stato} />
    </form>
  );
}

/**
 * Le tre categorie di una persona. «completa»: tutte modificabili (titolare); «solo_spegnere»: si possono solo spegnere quelle accese
 * (Ufficio Gare, le proprie); «lettura»: nessuna modifica.
 */
export function PreferenzePersonaForm({
  persona,
  valori,
  modo,
  testi,
  riceve,
}: {
  persona: string;
  valori: Record<Categoria, boolean>;
  modo: "completa" | "solo_spegnere" | "lettura";
  testi: TestiCategorie;
  riceve?: Partial<Record<Categoria, string>>;
}) {
  const [stato, azione, inCorso] = useActionState<StatoNotifiche, FormData>(salvaPreferenzeNotifiche, {});
  return (
    <form action={azione} className="omnia-modulo">
      <input type="hidden" name="persona" value={persona} />
      <fieldset className="omnia-opp-gruppo" disabled={modo === "lettura" || inCorso}>
        {CATEGORIE.map((c) => (
          <label key={c} className="omnia-opp-scelta">
            <input type="checkbox" name={c} value="si" defaultChecked={valori[c]} disabled={modo === "solo_spegnere" && !valori[c]} /> <strong>{testi[c].titolo}</strong>
            <span className="omnia-opp-nota"> — {testi[c].descrizione}</span>
            {riceve?.[c] && <span className="omnia-opp-nota"> ({riceve[c]})</span>}
          </label>
        ))}
      </fieldset>
      {modo === "solo_spegnere" && <p className="omnia-opp-nota">Puoi spegnere le categorie accese. Per riaccenderle chiedi al titolare dell&apos;impresa.</p>}
      {modo !== "lettura" && (
        <button type="submit" className="omnia-btn omnia-btn-p omnia-btn-piccolo" disabled={inCorso}>
          {inCorso ? "Salvataggio in corso…" : "Salva le preferenze"}
        </button>
      )}
      <Esito stato={stato} />
    </form>
  );
}
