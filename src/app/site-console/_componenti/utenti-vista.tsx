import Link from "next/link";
import type { ElencoUtentiLetto } from "@/lib/console/utenti";
import { TIPI_UTENTE, conteggiPerTipo, type OrdineUtenti, type RigaUtente, type TipoUtente } from "@/lib/console/utenti-calcoli";
import { Badge, Pannello, Tessera } from "./elementi";
import { formattaData, formattaDataOra, formattaEuro, formattaIntero } from "./formati";
import { urlConParametri } from "./selettore-periodo";

// Vista pura della pagina Utenti: tutti gli account, con ordini, abbonamento AI,
// crediti, messaggi e le accettazioni legali registrate. Riceve dati già letti.

const COLONNE: { ordine: OrdineUtenti | null; etichetta: string }[] = [
  { ordine: "email", etichetta: "Utente" },
  { ordine: "registrazione", etichetta: "Registrato" },
  { ordine: "accesso", etichetta: "Ultimo accesso" },
  { ordine: null, etichetta: "Ordini" },
  { ordine: null, etichetta: "Abbonamento OMNIA AI" },
  { ordine: null, etichetta: "Crediti" },
  { ordine: null, etichetta: "Accettazioni legali" },
  { ordine: null, etichetta: "Messaggi" },
];

function CellaAbbonamento({ r }: { r: RigaUtente }) {
  const a = r.abbonamento;
  if (!a) return <>—</>;
  const tono = a.stato === "attivo" ? "ok" : a.stato === "sola_lettura" ? "avviso" : "errore";
  return (
    <span className="nowrap">
      <Badge tono="accento">{a.piano}</Badge>{" "}
      <Badge tono={tono}>{a.stato === "sola_lettura" ? "sola lettura" : a.stato}</Badge>
      {a.inDisdetta && (
        <>
          {" "}
          <Badge tono="avviso">in disdetta</Badge>
        </>
      )}
      {a.manuale && (
        <>
          {" "}
          <Badge tono="neutro">a mano</Badge>
        </>
      )}
      {a.prova && (
        <>
          {" "}
          <Badge tono="avviso">prova</Badge>
        </>
      )}
    </span>
  );
}

function CellaAccettazioni({ r }: { r: RigaUtente }) {
  const haQualcosa = r.ordini.totale > 0 || (r.abbonamento !== null && !r.abbonamento.manuale);
  if (!haQualcosa) return <>—</>;
  if (r.accettazioniMancanti > 0) {
    const parti = [r.ordini.senzaAccettazioni > 0 ? `${r.ordini.senzaAccettazioni} ordini` : null, r.abbonamentiSenzaAccettazioni > 0 ? `${r.abbonamentiSenzaAccettazioni} abbonamenti` : null].filter(Boolean);
    return (
      <span title={`Senza prova di accettazione: ${parti.join(" e ")}`}>
        <Badge tono="errore">mancano {r.accettazioniMancanti}</Badge>
      </span>
    );
  }
  return <Badge tono="ok">registrate</Badge>;
}

export default function UtentiVista({
  elenco,
  righe,
  tipo,
  q,
  ordine,
  esito,
}: {
  elenco: ElencoUtentiLetto;
  righe: RigaUtente[];
  tipo: TipoUtente;
  q: string;
  ordine: OrdineUtenti;
  esito: string | undefined;
}) {
  const testata = (
    <div className="cn-testata">
      <div>
        <h1>Utenti</h1>
        <p>Account dei due siti, con ordini, abbonamento OMNIA AI, crediti e accettazioni legali registrate</p>
      </div>
      <Link href="/utenti/nuovo" className="cn-btn primario">
        Nuovo utente
      </Link>
    </div>
  );

  if (elenco.stato === "errore") {
    return (
      <>
        {testata}
        <p className="cn-esito errore" role="alert">
          {elenco.messaggio}
        </p>
      </>
    );
  }

  const tutte = elenco.righe;
  const conteggi = conteggiPerTipo(tutte);
  const parametri = { tipo: tipo === "tutti" ? undefined : tipo, q: q || undefined, ord: ordine === "registrazione" ? undefined : ordine };

  return (
    <>
      {testata}

      {esito === "eliminato" && (
        <p className="cn-esito ok" role="status" style={{ marginBottom: 14 }}>
          Utente eliminato.
        </p>
      )}
      {esito === "anonimizzato" && (
        <p className="cn-esito ok" role="status" style={{ marginBottom: 14 }}>
          Utente anonimizzato: email e dati di fatturazione sostituiti, accesso bloccato; ordini, fatture e accettazioni restano.
        </p>
      )}
      {!elenco.accessiDisponibili && (
        <p className="cn-esito avviso" role="status" style={{ marginBottom: 14 }}>
          L&apos;ultimo accesso non è disponibile in questo momento (lettura da Supabase Auth non riuscita).
        </p>
      )}

      <div className="cn-tessere">
        <Tessera etichetta="Utenti" valore={formattaIntero(tutte.length)} dettaglio={`${formattaIntero(conteggi.admin)} amministratori`} />
        <Tessera etichetta="Con ordini" valore={formattaIntero(conteggi.ecommerce)} dettaglio="Clienti dell'e-commerce" />
        <Tessera etichetta="Con abbonamento AI" valore={formattaIntero(conteggi.omnia_ai)} dettaglio="Compresi quelli di prova e a mano" />
        <Tessera etichetta="Uffici Gare" valore={formattaIntero(conteggi.ufficio_gare)} dettaglio="Utenti secondari delle aziende" />
        <Tessera
          etichetta="Da rispondere"
          valore={formattaIntero(conteggi.da_rispondere)}
          tono={conteggi.da_rispondere > 0 ? "avviso" : "neutro"}
          dettaglio="L'ultimo messaggio è del cliente"
        />
        <Tessera
          etichetta="Senza accettazioni"
          valore={formattaIntero(conteggi.senza_accettazioni)}
          tono={conteggi.senza_accettazioni > 0 ? "errore" : "neutro"}
          dettaglio="Ordini o abbonamenti senza prova di accettazione"
        />
      </div>

      <div className="cn-sezione">
        <div className="cn-periodo" style={{ marginBottom: 12 }}>
          <nav className="cn-filtri" aria-label="Tipo di utente">
            {TIPI_UTENTE.map((t) => (
              <Link key={t.valore} href={urlConParametri("/utenti", { ...parametri, tipo: t.valore === "tutti" ? undefined : t.valore })} className={tipo === t.valore ? "attivo" : undefined}>
                {t.etichetta} <span>{conteggi[t.valore]}</span>
              </Link>
            ))}
          </nav>
          <form action="/utenti" method="get" className="cn-ricerca">
            {tipo !== "tutti" && <input type="hidden" name="tipo" value={tipo} />}
            {ordine !== "registrazione" && <input type="hidden" name="ord" value={ordine} />}
            <input className="cn-input" type="search" name="q" defaultValue={q} placeholder="Email, azienda o id" aria-label="Cerca tra gli utenti" />
            <button type="submit" className="cn-btn">
              Cerca
            </button>
          </form>
        </div>

        <Pannello titolo={`Utenti (${righe.length})`}>
          {righe.length === 0 ? (
            <p className="cn-vuoto">Nessun utente con questi filtri.</p>
          ) : (
            <div className="cn-scorri">
              <table className="cn-tab">
                <thead>
                  <tr>
                    {COLONNE.map((c) => (
                      <th key={c.etichetta}>
                        {c.ordine ? (
                          <Link href={urlConParametri("/utenti", { ...parametri, ord: c.ordine === "registrazione" ? undefined : c.ordine })} className={ordine === c.ordine ? "cn-ordinamento attivo" : "cn-ordinamento"}>
                            {c.etichetta}
                            {ordine === c.ordine ? " ↓" : ""}
                          </Link>
                        ) : (
                          c.etichetta
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {righe.map((r) => (
                    <tr key={r.id} className={r.accettazioniMancanti > 0 ? "cn-riga-errore" : r.daRispondere ? "cn-riga-avviso" : undefined}>
                      <td className="cn-cella-doppia">
                        <Link href={`/utenti/${r.id}`}>{r.email}</Link>
                        <small>
                          {r.azienda ?? (r.anonimizzato ? "anonimizzato" : r.ufficioGareDi ? null : "senza profilo azienda")}
                          {r.ufficioGareDi && (
                            <>
                              {" "}
                              <Badge tono="accento">Ufficio Gare</Badge> di <Link href={`/utenti/${r.ufficioGareDi.titolareId}`}>{r.ufficioGareDi.titolare}</Link>
                              {!r.ufficioGareDi.attivo && (
                                <>
                                  {" "}
                                  <Badge tono="errore">sospeso</Badge>
                                </>
                              )}
                            </>
                          )}
                          {r.ufficioGare && (
                            <>
                              {" "}
                              <Badge tono="neutro">ha un Ufficio Gare</Badge>
                            </>
                          )}
                          {r.ruolo === "admin" && (
                            <>
                              {" "}
                              <Badge tono="accento">admin</Badge>
                            </>
                          )}
                          {r.bannato && !r.anonimizzato && (
                            <>
                              {" "}
                              <Badge tono="errore">bloccato</Badge>
                            </>
                          )}
                        </small>
                      </td>
                      <td className="mono" title={formattaDataOra(r.registratoIl)}>
                        {formattaData(r.registratoIl)}
                      </td>
                      <td className="mono" title={r.ultimoAccesso ? formattaDataOra(r.ultimoAccesso) : undefined}>
                        {r.ultimoAccesso ? formattaData(r.ultimoAccesso) : "mai"}
                      </td>
                      <td className="cn-cella-doppia">
                        {r.ordini.totale === 0 ? "—" : `${r.ordini.pagati}/${r.ordini.totale} pagati`}
                        {r.ordini.pagatoLordo > 0 && <small>{formattaEuro(r.ordini.pagatoLordo)}</small>}
                      </td>
                      <td>
                        <CellaAbbonamento r={r} />
                      </td>
                      <td className="num">{r.saldoCrediti > 0 ? formattaIntero(r.saldoCrediti) : "—"}</td>
                      <td>
                        <CellaAccettazioni r={r} />
                      </td>
                      <td>{r.daRispondere ? <Badge tono="avviso">da rispondere</Badge> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Pannello>
      </div>

      <div className="cn-sezione">
        <details className="cn-dettagli">
          <summary>Come leggere questa pagina</summary>
          <ul className="cn-elenco">
            <li>
              <strong>Accettazioni legali:</strong> ogni ordine dell&apos;e-commerce e ogni abbonamento OMNIA AI pagato con Stripe deve avere la prova di ciò che il cliente ha accettato (condizioni e privacy, con data, ora, IP e versione del documento). «Mancano» segnala ordini o abbonamenti senza questa prova: precedono la registrazione delle accettazioni o sono stati creati a mano. Gli abbonamenti creati a mano non hanno un checkout e non sono contati. Il dettaglio è nella scheda del cliente.
            </li>
            <li>
              <strong>Da rispondere:</strong> l&apos;ultimo messaggio della conversazione di assistenza è del cliente.
            </li>
            <li>
              <strong>Ufficio Gare:</strong> è l&apos;utente secondario di un&apos;azienda cliente (il «titolare»): lavora solo sulle gare, non ha abbonamento, crediti né fatture propri, e viene eliminato insieme al titolare. Le operazioni commerciali si fanno sul titolare.
            </li>
            <li>
              <strong>Ultimo accesso:</strong> arriva da Supabase Auth e comprende gli accessi a entrambi i siti.
            </li>
          </ul>
        </details>
      </div>
    </>
  );
}
