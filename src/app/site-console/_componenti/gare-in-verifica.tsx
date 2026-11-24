import type { GaraInVerificaConsole } from "@/lib/console/gare-in-verifica";
import { SETTORI_RADAR } from "@/lib/radar/settori";
import { vociCatalogo } from "@/lib/radar/settori-catalogo";
import { decidiGaraInVerifica } from "../azioni/tender-intelligence";
import { Pannello } from "./elementi";
import ModuloAzione from "./modulo-azione";

// Schema S4 (49C §4.2): le gare «da verificare», cioè i casi senza descrizione utile. Per i clienti sono «Classificazione in verifica»: mai
// «non pertinenti», mai in «Per te» né nei suggerimenti. Qui un amministratore decide la rilevanza per il settore candidato, con la nota
// obbligatoria; la decisione va nel registro e la gara torna «classificata».
const RILEVANZE = [
  { id: "A", nome: "A pertinente" },
  { id: "B", nome: "B correlata" },
  { id: "C", nome: "C non pertinente" },
] as const;

function data(valore: string): string {
  return new Date(valore).toLocaleString("it-IT", { timeZone: "Europe/Rome", dateStyle: "short", timeStyle: "short" });
}

export default function GareInVerifica({ gare }: { gare: GaraInVerificaConsole[] }) {
  return (
    <div className="cn-sezione">
      <Pannello titolo={`Gare da verificare (${gare.length})`}>
        <p className="cn-nota">
          Casi senza una descrizione utile (concessione di un immobile con un CPV di ristorazione, stabulari, servizi di biblioteca). Il classificatore non decide da solo:
          ai clienti la gara appare «Classificazione in verifica», non entra in «Per te» né nei suggerimenti. Decidi la rilevanza per il settore candidato, con una nota:
          la decisione resta nel registro e le riclassificazioni non la cambiano.
        </p>
        {gare.length === 0 ? (
          <p className="cn-nota">Nessuna gara da verificare.</p>
        ) : (
          gare.map((g) => {
            const sottocategorie = g.settoreCandidato ? g.sottocategorie : SETTORI_RADAR.flatMap((s) => vociCatalogo(s.id).map((v) => ({ id: v.id, nome: `${s.nome}: ${v.nome}` })));
            return (
              <div key={g.id} className="cn-scheda-gara">
                <p>
                  <strong>{g.titolo}</strong>
                  <br />
                  <span className="cn-nota">
                    {g.ente ?? "Ente non indicato"} · {g.chiave} · da verificare dal {data(g.il)}
                    {g.versione ? ` · regole ${g.versione}` : ""}
                  </span>
                </p>
                {g.urlAvviso && (
                  <p className="cn-nota">
                    <a href={g.urlAvviso} target="_blank" rel="noopener noreferrer">
                      Apri l&apos;avviso ufficiale
                    </a>
                  </p>
                )}
                <p className="cn-nota">
                  Settore candidato: <strong>{g.nomeSettoreCandidato ?? "non indicato: sceglilo nel modulo"}</strong>
                  {" · "}caso: {g.casoLeggibile ?? "caso non riconosciuto (vale il motivo)"}
                  {g.motivo ? ` · ${g.motivo}` : ""}
                </p>
                {g.righe.length > 0 && (
                  <div className="cn-scorri">
                    <table className="cn-tab">
                      <thead>
                        <tr>
                          <th>Settore</th>
                          <th>Rilevanza di oggi</th>
                          <th>Regole e motivi</th>
                          <th>Origine</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.righe.map((r, i) => (
                          <tr key={`${r.settore}|${i}`}>
                            <td>{r.nomeSettore}</td>
                            <td>{r.rilevanza}</td>
                            <td>{r.regole.map((x, j) => `${x}${r.motivi[j] ? `: ${r.motivi[j]}` : ""}`).join(" · ")}</td>
                            <td>{r.origine}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <ModuloAzione azione={decidiGaraInVerifica} etichetta="Decidi" etichettaInCorso="Salvo…" campi={{ gara: g.id, ...(g.settoreCandidato ? { settore: g.settoreCandidato } : {}) }} variante="primario" classe="cn-modulo">
                  {!g.settoreCandidato && (
                    <label>
                      Settore{" "}
                      <select name="settore" required defaultValue="">
                        <option value="" disabled>
                          scegli
                        </option>
                        {SETTORI_RADAR.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.nome}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <fieldset>
                    <legend>Rilevanza{g.nomeSettoreCandidato ? ` per ${g.nomeSettoreCandidato}` : ""}</legend>
                    {RILEVANZE.map((r) => (
                      <label key={r.id}>
                        <input type="radio" name="rilevanza" value={r.id} required /> {r.nome}
                      </label>
                    ))}
                  </fieldset>
                  <fieldset>
                    <legend>Sottocategorie (solo per A e B, dal catalogo)</legend>
                    {sottocategorie.map((s) => (
                      <label key={s.id}>
                        <input type="checkbox" name="sottocategoria" value={s.id} /> {s.nome}
                      </label>
                    ))}
                  </fieldset>
                  <label>
                    Nota (obbligatoria: perché decidi così)
                    <textarea name="nota" required maxLength={1000} rows={2} />
                  </label>
                </ModuloAzione>
              </div>
            );
          })
        )}
      </Pannello>
    </div>
  );
}
