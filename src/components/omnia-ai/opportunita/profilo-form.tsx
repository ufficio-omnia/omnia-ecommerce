"use client";

import { useActionState, useState } from "react";
import { salvaProfiloRadar, type StatoProfiloRadar } from "@/app/actions/radar-profilo";

// Profilo di ricerca dell'impresa (fase B4, grado 1). Le voci arrivano dal server (catalogo stabile delle sottocategorie, regioni, procedure):
// qui nessun catalogo, solo il modulo. Le sottocategorie di un settore si scelgono solo con il settore scelto (vuote = tutte quelle del settore).
// In sola lettura (Ufficio Gare) tutti i campi sono disattivati e non c'è il pulsante: il server rifiuta comunque l'azione.

type Voce = { id: string; nome: string };

export type ValoriModuloProfilo = {
  settori: string[];
  sottocategorie: Partial<Record<string, string[]>>;
  regioni: string[];
  procedure: string[];
  importoMin: number | null;
  importoMax: number | null;
  vedereCorrelate: boolean;
};

export default function ProfiloForm({
  valori,
  settori,
  sottocategorie,
  regioni,
  procedure,
  soloLettura,
}: {
  valori: ValoriModuloProfilo;
  settori: Voce[];
  sottocategorie: Record<string, Voce[]>;
  regioni: Voce[];
  procedure: Voce[];
  soloLettura: boolean;
}) {
  const [stato, azione, inCorso] = useActionState<StatoProfiloRadar, FormData>(salvaProfiloRadar, {});
  const [scelti, setScelti] = useState<string[]>(valori.settori);
  const spento = soloLettura || inCorso;
  const cambiaSettore = (id: string, acceso: boolean) => setScelti((prima) => (acceso ? [...new Set([...prima, id])] : prima.filter((s) => s !== id)));

  return (
    <form action={azione} className="omnia-modulo">
      <fieldset className="omnia-opp-gruppo" disabled={spento}>
        <legend>Settori che l&apos;impresa segue</legend>
        {settori.map((s) => (
          <div key={s.id}>
            <label className="omnia-opp-scelta">
              <input type="checkbox" name="settore" value={s.id} defaultChecked={valori.settori.includes(s.id)} onChange={(e) => cambiaSettore(s.id, e.currentTarget.checked)} /> <strong>{s.nome}</strong>
            </label>
            {scelti.includes(s.id) && (sottocategorie[s.id] ?? []).length > 0 && (
              <div className="omnia-opp-regioni" role="group" aria-label={`Sottocategorie di ${s.nome}`}>
                {(sottocategorie[s.id] ?? []).map((x) => (
                  <label key={x.id} className="omnia-opp-scelta">
                    <input type="checkbox" name="sottocategoria" value={`${s.id}:${x.id}`} defaultChecked={(valori.sottocategorie[s.id] ?? []).includes(x.id)} /> {x.nome}
                  </label>
                ))}
              </div>
            )}
          </div>
        ))}
        <p className="omnia-opp-nota">Senza sottocategorie scelte valgono tutte quelle del settore.</p>
      </fieldset>

      <details className="omnia-opp-gruppo" open={valori.regioni.length > 0}>
        <summary>Regioni{valori.regioni.length ? ` (${valori.regioni.length})` : " (tutta Italia)"}</summary>
        <fieldset disabled={spento} style={{ border: 0, padding: 0, margin: 0 }}>
          <div className="omnia-opp-regioni">
            {regioni.map((r) => (
              <label key={r.id} className="omnia-opp-scelta">
                <input type="checkbox" name="regione" value={r.id} defaultChecked={valori.regioni.includes(r.id)} /> {r.nome}
              </label>
            ))}
          </div>
        </fieldset>
        <p className="omnia-opp-nota">Luogo di esecuzione indicato nell&apos;avviso. Le gare in cui la fonte non indica il luogo compaiono comunque in «Per te».</p>
      </details>

      <fieldset className="omnia-opp-gruppo" disabled={spento}>
        <legend>Importo stimato (€)</legend>
        <div className="omnia-opp-due">
          <label>
            <span className="omnia-etichetta">da</span>
            <input name="min" inputMode="numeric" defaultValue={valori.importoMin ?? ""} className="omnia-input" placeholder="es. 100000" />
          </label>
          <label>
            <span className="omnia-etichetta">fino a</span>
            <input name="max" inputMode="numeric" defaultValue={valori.importoMax ?? ""} className="omnia-input" placeholder="es. 5000000" />
          </label>
        </div>
      </fieldset>

      <details className="omnia-opp-gruppo" open={valori.procedure.length > 0}>
        <summary>Procedure{valori.procedure.length ? ` (${valori.procedure.length})` : " (tutte)"}</summary>
        <fieldset disabled={spento} style={{ border: 0, padding: 0, margin: 0 }}>
          {procedure.map((p) => (
            <label key={p.id} className="omnia-opp-scelta">
              <input type="checkbox" name="procedura" value={p.id} defaultChecked={valori.procedure.includes(p.id)} /> {p.nome}
            </label>
          ))}
        </fieldset>
      </details>

      <fieldset className="omnia-opp-gruppo" disabled={spento}>
        <legend>Gare correlate</legend>
        <label className="omnia-opp-scelta">
          <input type="checkbox" name="correlate" value="si" defaultChecked={valori.vedereCorrelate} /> Mostra anche le gare correlate (appalti misti, concessioni, gestioni complesse che comprendono il servizio)
        </label>
      </fieldset>

      {stato.errore && (
        <p className="omnia-messaggio-stato errore" role="alert">
          {stato.errore}
        </p>
      )}
      {stato.ok && stato.messaggio && (
        <p className="omnia-messaggio-stato successo" role="status">
          {stato.messaggio}
        </p>
      )}
      {soloLettura ? (
        <p className="omnia-opp-nota">Il profilo di ricerca lo modifica il titolare dell&apos;impresa.</p>
      ) : (
        <button type="submit" className="omnia-btn omnia-btn-p" disabled={inCorso}>
          {inCorso ? "Salvataggio in corso…" : "Salva il profilo"}
        </button>
      )}
    </form>
  );
}
