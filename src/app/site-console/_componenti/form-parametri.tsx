"use client";

import { useActionState } from "react";
import type { StatoSalvataggio } from "../azioni/costi";

export default function FormParametri({
  azione,
  cambio,
  iva,
}: {
  azione: (stato: StatoSalvataggio, dati: FormData) => Promise<StatoSalvataggio>;
  cambio: number | null;
  iva: number;
}) {
  const [stato, esegui, inCorso] = useActionState(azione, {});

  return (
    <form action={esegui} className="cn-modulo" style={{ padding: 14 }}>
      <div>
        <label className="cn-etichetta" htmlFor="cambio">
          Cambio: euro per 1 dollaro
        </label>
        <input
          className="cn-input"
          id="cambio"
          name="cambio"
          inputMode="decimal"
          required
          defaultValue={cambio === null ? "" : String(cambio).replace(".", ",")}
          placeholder="es. 0,92"
        />
      </div>
      <div>
        <label className="cn-etichetta" htmlFor="iva">
          Aliquota IVA dei prezzi (%)
        </label>
        <input className="cn-input" id="iva" name="iva" inputMode="decimal" required defaultValue={String(iva).replace(".", ",")} />
      </div>
      {stato.errore && (
        <p className="cn-esito errore" role="alert">
          {stato.errore}
        </p>
      )}
      {stato.ok && (
        <p className="cn-esito ok" role="status">
          Parametri salvati.
        </p>
      )}
      <button type="submit" className="cn-btn primario" disabled={inCorso}>
        {inCorso ? "Salvo…" : "Salva parametri"}
      </button>
    </form>
  );
}
