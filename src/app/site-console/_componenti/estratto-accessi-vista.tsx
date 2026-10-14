import Link from "next/link";
import { ETICHETTA_CASO, LETTERA_CASO, frasePrincipaleEstratto, type RigaAccesso } from "@/lib/console/accessi-dati-calcoli";
import { Badge } from "./elementi";
import { formattaData, formattaDataOra } from "./formati";
import PulsanteStampa from "./pulsante-stampa";

// Estratto del registro degli accessi per UN cliente: il documento che si manda al
// cliente quando lo chiede (condizioni art. 10, Allegato A art. 4). Pensato per la
// stampa o il PDF dal browser; il CSV si scarica a parte. Con zero accessi dice «nessun
// accesso»: per il cliente è l'informazione, non una pagina vuota.

export default function EstrattoAccessiVista({
  cliente,
  righe,
  dal,
  al,
  emessoIl,
  operatore,
}: {
  cliente: { id: string; email: string | null };
  // già filtrate per cliente e periodo, dal più recente
  righe: RigaAccesso[];
  dal: string | null;
  al: string | null;
  emessoIl: Date;
  operatore: string;
}) {
  const generali = righe.filter((r) => r.tuttiIClienti).length;
  const periodo = { da: dal ? formattaData(dal) : null, a: al ? formattaData(al) : null };
  const percorsoCsv = `/accessi-dati/estratto/${cliente.id}/csv${dal || al ? `?${new URLSearchParams({ ...(dal ? { dal } : {}), ...(al ? { al } : {}) }).toString()}` : ""}`;

  return (
    <>
      <div className="cn-nascondi-stampa">
        <Link href="/accessi-dati" className="cn-indietro">
          ← Accessi ai dati
        </Link>
      </div>

      <div className="cn-testata">
        <div>
          <h1>Estratto del registro degli accessi</h1>
          <p>OMNIA AI — Omnia Consulting SRLS · Registro previsto dall&apos;art. 10 delle condizioni di abbonamento e dall&apos;Allegato A (art. 4)</p>
        </div>
        <div className="cn-nascondi-stampa cn-azioni-testata">
          <a className="cn-btn" href={percorsoCsv}>
            Scarica CSV
          </a>
          <PulsanteStampa />
        </div>
      </div>

      <section className="cn-pannello">
        <div className="cn-pannello-corpo">
          <dl className="cn-dati-estratto">
            <div>
              <dt>Cliente</dt>
              <dd>{cliente.email ?? "(utente non più presente)"}</dd>
            </div>
            <div>
              <dt>Periodo</dt>
              <dd>{periodo.da || periodo.a ? `${periodo.da ?? "inizio del registro"} – ${periodo.a ?? "oggi"}` : "tutto il periodo coperto dal registro"}</dd>
            </div>
            <div>
              <dt>Estratto emesso il</dt>
              <dd>
                {formattaDataOra(emessoIl)} (ora di Roma) da {operatore}
              </dd>
            </div>
          </dl>

          <p className="cn-frase-estratto">{frasePrincipaleEstratto(righe.length, generali, periodo)}</p>

          <form action={`/accessi-dati/estratto/${cliente.id}`} method="get" className="cn-ricerca cn-nascondi-stampa" style={{ marginTop: 14 }}>
            <label className="cn-etichetta-inline" htmlFor="dal">
              Dal
            </label>
            <input className="cn-input" id="dal" type="date" name="dal" defaultValue={dal ?? ""} />
            <label className="cn-etichetta-inline" htmlFor="al">
              Al
            </label>
            <input className="cn-input" id="al" type="date" name="al" defaultValue={al ?? ""} />
            <button type="submit" className="cn-btn">
              Applica
            </button>
          </form>
        </div>
      </section>

      {righe.length > 0 && (
        <section className="cn-pannello" style={{ marginTop: 16 }}>
          <div className="cn-scorri">
            <table className="cn-tab">
              <thead>
                <tr>
                  <th>Data e ora (Roma)</th>
                  <th>Operatore</th>
                  <th>Caso</th>
                  <th>Riguarda</th>
                  <th>Cosa è stato guardato</th>
                  <th>Motivo</th>
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
                      {LETTERA_CASO[r.caso]}) {ETICHETTA_CASO[r.caso]}
                    </td>
                    <td>{r.tuttiIClienti ? <Badge tono="avviso">accesso generale al database</Badge> : "i suoi dati"}</td>
                    <td>{r.ambito}</td>
                    <td>{r.motivo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className="cn-nota">
        Il registro riporta gli accessi eccezionali del personale autorizzato ai documenti e ai contenuti del cliente, nei soli casi ammessi dall&apos;Allegato A: assistenza tecnica richiesta dal cliente, revisione umana acquistata dal cliente, manutenzione o sicurezza non altrimenti risolvibili, obbligo di legge. Gli «accessi generali al database» sono interventi che, per la loro natura, possono aver riguardato i dati di tutti i clienti. Il registro non si modifica né si cancella.
      </p>
    </>
  );
}
