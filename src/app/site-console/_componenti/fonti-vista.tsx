import Link from "next/link";
import type { DatiFontiConsole, FonteConsole } from "@/lib/console/fonti";
import { GRAVITA_CONSOLE, STATO_FONTE_CONSOLE, esitoLeggibile, modoLeggibile } from "@/lib/console/fonti-calcoli";
import { impostaFontePvl, impostaFonteRegionale, impostaFonteTed } from "../azioni/tender-intelligence";
import { Badge, Pannello } from "./elementi";
import ModuloAzione from "./modulo-azione";

// Pagina «Fonti» della console (48C §3.5–3.6): per ogni fonte lo stato calcolato, accesa o spenta, ultimo giro e ultimo successo, prossimo
// giro previsto, allarmi (già ordinati per gravità da B2) e gli ultimi giri del registro. Accendere e spegnere usano le azioni ESISTENTI
// (solo amministratori, registro 0112 obbligatorio), con una casella di conferma; nessuna riaccensione automatica. Nessun dato di gare.

function data(valore: string | null): string {
  if (!valore) return "—";
  return new Date(valore).toLocaleString("it-IT", { timeZone: "Europe/Rome", dateStyle: "short", timeStyle: "short" });
}

function durata(ms: number | null): string {
  if (ms === null) return "—";
  return ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`;
}

function accendiSpegni(f: FonteConsole) {
  const azione = f.attiva ? "spegni" : "accendi";
  const etichetta = f.attiva ? "Spegni la fonte" : f.stato === "sospesa" ? "Riaccendi la fonte" : "Accendi la fonte";
  const conferma = (
    <label className="cn-nota">
      <input type="checkbox" name="conferma" value="si" required /> Confermo: {f.attiva ? "spengo" : "accendo"} {f.nome}
    </label>
  );
  if (f.fonte === "ted")
    return (
      <ModuloAzione azione={impostaFonteTed} etichetta={etichetta} etichettaInCorso="Salvo…" campi={{ azione }}>
        {conferma}
      </ModuloAzione>
    );
  if (f.fonte === "pvl")
    return (
      <ModuloAzione azione={impostaFontePvl} etichetta={etichetta} etichettaInCorso="Salvo…" campi={{ azione }}>
        {conferma}
      </ModuloAzione>
    );
  return (
    <ModuloAzione azione={impostaFonteRegionale} etichetta={etichetta} etichettaInCorso="Salvo…" campi={{ fonte: f.fonte, azione }}>
      {conferma}
    </ModuloAzione>
  );
}

// funzioni chiamate direttamente (non componenti): il contenuto resta nell'albero della vista, come lo legge la prova
function sezioneFonte(f: FonteConsole) {
  const stato = STATO_FONTE_CONSOLE[f.stato];
  const g = f.ultimoGiro;
  return (
    <div className="cn-sezione">
      <Pannello titolo={f.nome} azioni={<Badge tono={stato.tono}>{stato.testo}</Badge>}>
        <p className="cn-nota">
          <strong>{stato.testo}</strong>: {stato.spiegazione}.
        </p>
        <p className="cn-nota">
          {f.attiva ? "Accesa" : "Spenta"}
          {f.erroriConsecutivi > 0 ? ` · ${f.erroriConsecutivi} giri di fila non riusciti` : ""}
        </p>
        <p className="cn-nota">
          {"Ultimo giro: "}
          {g ? `${data(g.iniziatoIl)} · ${modoLeggibile(g.modo)} · ${esitoLeggibile(g.esito)} · ${g.richiesteFonte} richieste alla fonte · ${g.gareNuove} gare nuove` : "nessun giro nel registro"}
        </p>
        <p className="cn-nota">{`Ultimo successo: ${data(f.ultimoSuccesso)}`}</p>
        <p className="cn-nota">{`Prossimo giro: ${f.prossimoGiro ? data(f.prossimoGiro) : !f.attiva ? "nessuno (fonte spenta)" : "nessuno (giri programmati spenti in questo ambiente)"}`}</p>
        {f.allarmi.length > 0 ? (
          <ul className="cn-elenco">
            {f.allarmi.map((a, i) => (
              <li key={`${a.codice}|${i}`}>
                <Badge tono={GRAVITA_CONSOLE[a.gravita].tono}>{GRAVITA_CONSOLE[a.gravita].testo}</Badge> {a.messaggio}
                {a.dal ? <span className="cn-nota">{` (dal ${data(a.dal)})`}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="cn-nota">Nessun allarme.</p>
        )}
        {f.giri.length > 0 && (
          <div className="cn-scorri">
            <table className="cn-tab">
              <thead>
                <tr>
                  <th>Iniziato</th>
                  <th>Modo</th>
                  <th>Esito</th>
                  <th>Durata</th>
                  <th>Richieste</th>
                  <th>Gare nuove</th>
                  <th>Allarmi</th>
                </tr>
              </thead>
              <tbody>
                {f.giri.map((x, i) => (
                  <tr key={`${x.iniziatoIl}|${i}`}>
                    <td>{data(x.iniziatoIl)}</td>
                    <td>{modoLeggibile(x.modo)}</td>
                    <td>
                      {esitoLeggibile(x.esito)}
                      {x.errore ? <span className="cn-nota">{` · ${x.errore}`}</span> : null}
                    </td>
                    <td>{durata(x.durataMs)}</td>
                    <td>{`${x.richiesteFonte} fonte · ${x.richiesteDb} database`}</td>
                    <td>{x.gareNuove}</td>
                    <td>{x.allarmi.length ? x.allarmi.join(", ") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {accendiSpegni(f)}
      </Pannello>
    </div>
  );
}

export default function FontiVista({ dati }: { dati: DatiFontiConsole }) {
  return (
    <>
      <div className="cn-testata">
        <div>
          <h1>Fonti</h1>
          <p>
            Stato calcolato, ultimi giri del registro e allarmi delle quattro fonti di Tender Intelligence.{" "}
            <Link href="/tender-intelligence" prefetch={false}>
              Torna a Tender Intelligence
            </Link>
          </p>
        </div>
      </div>
      {dati.errore && (
        <p className="cn-nota" role="alert">
          {`Lettura non riuscita: ${dati.errore}`}
        </p>
      )}
      {dati.registroAssente && (
        <p className="cn-nota" role="alert">
          Il registro dei giri (migrazione 0128) non c&apos;è in questo database: lo stato viene dal solo stato delle fonti, senza gli allarmi che hanno bisogno del registro e senza
          l&apos;elenco dei giri.
        </p>
      )}
      {dati.erroreGiri && (
        <p className="cn-nota" role="alert">
          {`Elenco dei giri non letto (${dati.erroreGiri}): lo stato e gli allarmi restano.`}
        </p>
      )}
      {dati.fonti.map((f) => (
        <div key={f.fonte}>{sezioneFonte(f)}</div>
      ))}
    </>
  );
}
