import Link from "next/link";
import { CASI_ACCESSO, ETICHETTA_CASO, GIORNI_MASSIMI_RITARDO, LETTERA_CASO, MOTIVO_MIN, type FiltroAccessi } from "@/lib/console/accessi-dati-calcoli";
import type { RisultatoAccessi } from "@/lib/console/accessi-dati";
import { registraAccesso } from "../azioni/accessi-dati";
import { Badge, Pannello } from "./elementi";
import { formattaDataOra } from "./formati";
import ModuloAzione from "./modulo-azione";
import { urlConParametri } from "./selettore-periodo";

// Pagina «Accessi ai dati»: il registro che le condizioni di abbonamento (art. 10) e
// l'Allegato A (art. 4) promettono ai clienti. Regola, modulo per registrare un accesso
// ed elenco; l'estratto per cliente sta in una pagina a parte, stampabile.

export default function AccessiDatiVista({ risultato, filtro }: { risultato: RisultatoAccessi; filtro: FiltroAccessi }) {
  const righe = risultato.stato === "ok" ? risultato.righe : [];
  const filtrato = filtro.cliente !== "" || filtro.caso !== "";

  return (
    <>
      <div className="cn-testata">
        <div>
          <h1>Accessi ai dati dei clienti</h1>
          <p>Il registro che i contratti di OMNIA AI promettono: ogni accesso del personale ai documenti o ai contenuti di un cliente, con data, ora, operatore e motivo</p>
        </div>
      </div>

      {risultato.stato === "tabella_assente" && (
        <p className="cn-esito errore" role="alert" style={{ marginBottom: 14 }}>
          Il registro non esiste ancora nel database: eseguire la migrazione 0082. Finché non c&apos;è, gli accessi non si possono registrare e il contratto promette una cosa che non si può mantenere.
        </p>
      )}
      {risultato.stato === "errore" && (
        <p className="cn-esito errore" role="alert" style={{ marginBottom: 14 }}>
          {risultato.messaggio}
        </p>
      )}

      <div className="cn-colonne cn-colonne-pari">
        <Pannello titolo="La regola">
          <div className="cn-pannello-corpo">
            <p className="cn-nota-inline" style={{ marginTop: 0 }}>
              Nel funzionamento normale nessuno vede i documenti dei clienti: la console non li mostra e l&apos;elaborazione è automatica. Se per un motivo <strong>eccezionale</strong> devi guardarli — nella console, da Supabase, dallo storage o con uno script — <strong>registralo qui</strong>, prima o subito dopo. Senza registrazione quell&apos;accesso non è ammesso dal contratto.
            </p>
            <p className="cn-nota-inline">I casi ammessi sono solo questi quattro (Allegato A, art. 4):</p>
            <ul className="cn-elenco-regola">
              {CASI_ACCESSO.map((c) => (
                <li key={c}>
                  <strong>{LETTERA_CASO[c]})</strong> {ETICHETTA_CASO[c]}
                </li>
              ))}
            </ul>
            <p className="cn-nota-inline">
              Un estratto vuoto è un&apos;informazione: dice al cliente che nessuno ha guardato i suoi dati. Il registro non si modifica né si cancella; per correggere si scrive una nuova riga.
            </p>
          </div>
        </Pannello>

        <Pannello titolo="Registra un accesso">
          <div className="cn-pannello-corpo">
            <ModuloAzione azione={registraAccesso} etichetta="Registra l'accesso" etichettaInCorso="Registro…" messaggioOk="Accesso registrato." variante="primario" svuota classe="cn-modulo">
              <div>
                <label className="cn-etichetta" htmlFor="caso">
                  Perché
                </label>
                <select className="cn-input" id="caso" name="caso" defaultValue="assistenza_tecnica">
                  {CASI_ACCESSO.map((c) => (
                    <option key={c} value={c}>
                      {LETTERA_CASO[c]}) {ETICHETTA_CASO[c]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <span className="cn-etichetta">Chi riguarda</span>
                <label className="cn-etichetta-inline">
                  <input type="radio" name="riguarda" value="cliente" defaultChecked /> Un cliente
                </label>{" "}
                <label className="cn-etichetta-inline">
                  <input type="radio" name="riguarda" value="tutti" /> Tutti i clienti (intervento generale sul database)
                </label>
                <small className="cn-nota-inline" style={{ display: "block", marginTop: 4 }}>
                  «Tutti» solo per manutenzione/sicurezza o obbligo di legge: l&apos;assistenza e la revisione nascono dalla richiesta di un cliente.
                </small>
              </div>
              <div>
                <label className="cn-etichetta" htmlFor="cliente">
                  Email del cliente
                </label>
                <input className="cn-input" id="cliente" name="cliente" type="email" defaultValue={filtro.cliente.includes("@") ? filtro.cliente : ""} placeholder="se «Un cliente»" autoComplete="off" />
              </div>
              <div>
                <label className="cn-etichetta" htmlFor="ambito">
                  Cosa hai guardato e con che strumento
                </label>
                <input className="cn-input" id="ambito" name="ambito" maxLength={500} required placeholder="es. documenti della gara «Comune di X», dal pannello Supabase" autoComplete="off" />
              </div>
              <div>
                <label className="cn-etichetta" htmlFor="motivo">
                  Motivo (almeno {MOTIVO_MIN} caratteri)
                </label>
                <textarea className="cn-input cn-testo" id="motivo" name="motivo" rows={3} maxLength={1000} required placeholder="es. il cliente ha segnalato per email che l'analisi dei documenti si blocca; richiesta del 12/10" />
              </div>
              <div className="cn-modulo-griglia">
                <div>
                  <label className="cn-etichetta" htmlFor="data">
                    Giorno (vuoto = adesso)
                  </label>
                  <input className="cn-input" id="data" name="data" type="date" />
                </div>
                <div>
                  <label className="cn-etichetta" htmlFor="ora">
                    Ora di Roma
                  </label>
                  <input className="cn-input" id="ora" name="ora" type="time" />
                </div>
                <div>
                  <label className="cn-etichetta" htmlFor="gara">
                    Id della gara (facoltativo)
                  </label>
                  <input className="cn-input mono-campo" id="gara" name="gara" maxLength={36} autoComplete="off" spellCheck={false} />
                </div>
              </div>
            </ModuloAzione>
            <p className="cn-nota-inline" style={{ marginTop: 10 }}>
              L&apos;operatore è chi ha effettuato l&apos;accesso alla console, non si scrive a mano. Un accesso già avvenuto si registra entro {GIORNI_MASSIMI_RITARDO} giorni indicando giorno e ora.
            </p>
          </div>
        </Pannello>
      </div>

      <div className="cn-sezione">
        <div className="cn-periodo" style={{ marginBottom: 12 }}>
          <nav className="cn-filtri" aria-label="Filtra per caso">
            <Link href={urlConParametri("/accessi-dati", { cliente: filtro.cliente || undefined })} className={filtro.caso === "" ? "attivo" : undefined}>
              Tutti i casi
            </Link>
            {CASI_ACCESSO.map((c) => (
              <Link key={c} href={urlConParametri("/accessi-dati", { caso: c, cliente: filtro.cliente || undefined })} className={filtro.caso === c ? "attivo" : undefined}>
                {LETTERA_CASO[c]}) {ETICHETTA_CASO[c].split(" ")[0]}
              </Link>
            ))}
          </nav>
          <form action="/accessi-dati" method="get" className="cn-ricerca">
            {filtro.caso !== "" && <input type="hidden" name="caso" value={filtro.caso} />}
            <input className="cn-input" type="search" name="cliente" defaultValue={filtro.cliente} placeholder="Email del cliente" aria-label="Cerca per email del cliente" />
            <button type="submit" className="cn-btn">
              Cerca
            </button>
          </form>
        </div>

        <Pannello titolo={`Accessi registrati (${righe.length}${risultato.stato === "ok" && risultato.troncato ? "+" : ""})`}>
          {risultato.stato !== "ok" ? null : righe.length === 0 ? (
            <p className="cn-vuoto">{filtrato ? "Nessun accesso con questi filtri." : "Nessun accesso registrato: finora nessuno ha guardato i dati dei clienti."}</p>
          ) : (
            <div className="cn-scorri">
              <table className="cn-tab">
                <thead>
                  <tr>
                    <th>Quando</th>
                    <th>Operatore</th>
                    <th>Cliente</th>
                    <th>Caso</th>
                    <th>Cosa e perché</th>
                    <th>Estratto</th>
                  </tr>
                </thead>
                <tbody>
                  {righe.map((r) => (
                    <tr key={r.id}>
                      <td className="cn-cella-doppia">
                        {formattaDataOra(r.accessoIl)}
                        {Math.abs(Date.parse(r.creatoIl) - Date.parse(r.accessoIl)) > 5 * 60_000 && <small>registrato il {formattaDataOra(r.creatoIl)}</small>}
                      </td>
                      <td>{r.operatoreEmail}</td>
                      <td>
                        {r.tuttiIClienti ? (
                          <Badge tono="avviso">tutti (generale)</Badge>
                        ) : r.clienteId ? (
                          <Link href={`/utenti/${r.clienteId}`}>{r.clienteEmail}</Link>
                        ) : (
                          <>{r.clienteEmail} <small>(utente non trovato)</small></>
                        )}
                      </td>
                      <td>
                        {LETTERA_CASO[r.caso]}) {ETICHETTA_CASO[r.caso]}
                      </td>
                      <td className="cn-cella-doppia">
                        {r.ambito}
                        <small>{r.motivo}</small>
                      </td>
                      <td>{r.clienteId ? <Link href={`/accessi-dati/estratto/${r.clienteId}`}>estratto</Link> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {risultato.stato === "ok" && risultato.troncato && <p className="cn-nota">Si vedono gli accessi più recenti: per l&apos;elenco completo di un cliente apri il suo estratto.</p>}
        </Pannello>
      </div>
    </>
  );
}
