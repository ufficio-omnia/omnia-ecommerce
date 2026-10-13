import type { StatoAbbonamento } from "@/lib/console/abbonamenti-calcoli";
import type { AbbonamentiLetti } from "@/lib/console/abbonamenti";
import type { Periodo } from "@/lib/console/periodo";
import { Badge, Pannello, Tessera, type Tono } from "./elementi";
import { formattaData, formattaEuro, formattaIntero, formattaPercentuale } from "./formati";
import InterruttoreProva from "./interruttore-prova";
import SelettorePeriodo, { parametriPeriodo } from "./selettore-periodo";

// Vista pura della pagina Abbonamenti: clienti attivi, nuovi, in disdetta, in
// sola lettura, cessati e tasso di abbandono. Riceve dati già letti.

const STATO: Record<StatoAbbonamento, { testo: string; tono: Tono }> = {
  attivo: { testo: "attivo", tono: "ok" },
  sola_lettura: { testo: "sola lettura", tono: "avviso" },
  cessato: { testo: "cessato", tono: "errore" },
};

export default function AbbonamentiVista({
  periodo,
  abbonamenti,
  includiProva,
}: {
  periodo: Periodo;
  abbonamenti: AbbonamentiLetti;
  includiProva: boolean;
}) {
  const parametriControlli = { ...parametriPeriodo(periodo), prova: includiProva ? "1" : undefined };

  const testata = (
    <>
      <div className="cn-testata">
        <div>
          <h1>Abbonamenti</h1>
          <p>Clienti di OMNIA AI per stato e movimento · {periodo.etichetta}</p>
        </div>
      </div>
      <div className="cn-periodo" style={{ marginBottom: 14 }}>
        <SelettorePeriodo percorso="/abbonamenti" periodo={periodo} extra={{ prova: includiProva ? "1" : undefined }} />
        <InterruttoreProva percorso="/abbonamenti" parametri={parametriControlli} includiProva={includiProva} />
      </div>
    </>
  );

  if (abbonamenti.stato === "errore") {
    return (
      <>
        {testata}
        <p className="cn-esito errore" role="alert">
          {abbonamenti.messaggio}
        </p>
      </>
    );
  }

  const { metriche: m, identita, colonneNuoveDisponibili } = abbonamenti;

  return (
    <>
      {testata}

      {!colonneNuoveDisponibili && (
        <p className="cn-esito avviso" role="status" style={{ marginBottom: 14 }}>
          Mancano le colonne di prova e di disdetta delle subscriptions: eseguire la migrazione 0078. Intanto tutti gli abbonamenti con Stripe sono considerati di prova.
        </p>
      )}
      {m.esclusi.prova > 0 && !includiProva && (
        <p className="cn-esito" role="status" style={{ marginBottom: 14 }}>
          {formattaIntero(m.esclusi.prova)} {m.esclusi.prova === 1 ? "cliente" : "clienti"} di prova non {m.esclusi.prova === 1 ? "è conteggiato" : "sono conteggiati"} (Stripe di OMNIA AI è in modalità di prova). Includi i dati di prova per vederli.
        </p>
      )}
      {includiProva && (
        <p className="cn-esito avviso" role="status" style={{ marginBottom: 14 }}>
          Dati di prova INCLUSI: gli abbonamenti di prova di Stripe sono dentro i conteggi. Non sono clienti paganti.
        </p>
      )}

      <div className="cn-tessere">
        <Tessera
          etichetta="Attivi oggi"
          valore={formattaIntero(m.attivi)}
          tono={m.attivi > 0 ? "ok" : "neutro"}
          dettaglio={`Ricorrente da listino ${formattaEuro(m.mrrLordo)} al mese, IVA inclusa`}
        />
        <Tessera etichetta="Nuovi nel periodo" valore={formattaIntero(m.nuovi)} dettaglio="Prima riga di abbonamento nel periodo" />
        <Tessera
          etichetta="In disdetta"
          valore={formattaIntero(m.inDisdetta)}
          tono={m.inDisdetta > 0 ? "avviso" : "neutro"}
          dettaglio={`Attivi fino a fine periodo pagato · ${formattaIntero(m.disdetteRichieste)} richieste nel periodo`}
        />
        <Tessera
          etichetta="In sola lettura"
          valore={formattaIntero(m.solaLettura)}
          tono={m.solaLettura > 0 ? "avviso" : "neutro"}
          dettaglio="Entro 30 giorni dalla fine del periodo pagato"
        />
        <Tessera etichetta="Cessati nel periodo" valore={formattaIntero(m.cessatiNelPeriodo)} dettaglio={`${formattaIntero(m.cessati)} cessati in tutto`} />
        <Tessera
          etichetta="Abbandono"
          valore={m.abbandono === null ? "—" : formattaPercentuale(m.abbandono)}
          tono={m.abbandono !== null && m.abbandono > 0 ? "errore" : "neutro"}
          dettaglio={
            m.abbandono === null
              ? "Nessun cliente attivo a inizio periodo"
              : `${formattaIntero(m.persi)} persi su ${formattaIntero(m.attiviInizioPeriodo)} attivi a inizio periodo`
          }
        />
      </div>

      <div className="cn-sezione">
        <Pannello titolo={`Clienti (${m.clienti.length})`}>
          {m.clienti.length === 0 ? (
            <p className="cn-vuoto">Nessun cliente con abbonamento Stripe{includiProva ? "" : " (esclusi quelli di prova)"}.</p>
          ) : (
            <div className="cn-scorri">
              <table className="cn-tab">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Piano</th>
                    <th>Stato</th>
                    <th>Dal</th>
                    <th>Fine periodo pagato</th>
                    <th>Disdetta richiesta il</th>
                    <th>Cessazione</th>
                  </tr>
                </thead>
                <tbody>
                  {m.clienti.map((c) => {
                    const chi = identita.get(c.userId);
                    return (
                      <tr key={c.userId}>
                        <td className="cn-cella-doppia">
                          {chi?.email ?? "(utente eliminato)"}
                          {chi?.ragioneSociale && <small>{chi.ragioneSociale}</small>}
                        </td>
                        <td className="nowrap">
                          <Badge tono="accento">{c.piano}</Badge>
                          {c.prova && (
                            <span style={{ marginLeft: 6 }}>
                              <Badge tono="avviso">prova</Badge>
                            </span>
                          )}
                        </td>
                        <td className="nowrap">
                          <Badge tono={STATO[c.stato].tono}>{STATO[c.stato].testo}</Badge>
                          {c.inDisdetta && (
                            <span style={{ marginLeft: 6 }}>
                              <Badge tono="avviso">in disdetta</Badge>
                            </span>
                          )}
                        </td>
                        <td className="mono">{formattaData(c.inizio)}</td>
                        <td className="mono">{c.finePeriodo ? formattaData(c.finePeriodo) : "—"}</td>
                        <td className="mono">{c.disdettaRichiestaIl ? formattaData(c.disdettaRichiestaIl) : "—"}</td>
                        <td className="mono">{c.cessatoIl ? formattaData(c.cessatoIl) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Pannello>
      </div>

      <div className="cn-sezione">
        <details className="cn-dettagli">
          <summary>Come si calcolano questi numeri</summary>
          <ul className="cn-elenco">
            <li>
              <strong>Clienti, non righe:</strong> un cliente può avere più righe di abbonamento (ricreato, riattivato) e conta una volta. Gli abbonamenti creati a mano dall&apos;admin ({formattaIntero(m.esclusi.manuali)}) non sono clienti paganti e restano fuori.
            </li>
            <li>
              <strong>Stato:</strong> dalla riga più recente, come nell&apos;area riservata: attivo = abbonamento attivo e periodo pagato non scaduto; sola lettura = nei 30 giorni dopo la fine del periodo pagato; cessato = oltre.
            </li>
            <li>
              <strong>Nuovi:</strong> clienti la cui prima riga nasce nel periodo. <strong>Cessati nel periodo:</strong> clienti la cui cessazione (fine periodo pagato + 30 giorni) cade nel periodo.
            </li>
            <li>
              <strong>Abbandono:</strong> clienti attivi il primo giorno del periodo che non lo sono più alla fine (o a oggi), diviso i clienti attivi il primo giorno. Si ricostruisce dalle date di inizio e di fine periodo pagato di ogni riga.
            </li>
            <li>
              <strong>Disdette richieste:</strong> la data arriva da Stripe e viene registrata solo da quando la migrazione 0078 è attiva ({formattaIntero(m.conDataDisdetta)} clienti ne hanno una). Le disdette precedenti compaiono come «in disdetta» ma senza data.
            </li>
          </ul>
        </details>
      </div>
    </>
  );
}
