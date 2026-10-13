import Link from "next/link";
import type { CreditiLetti } from "@/lib/console/crediti";
import type { OrdineCrediti, RigaCrediti } from "@/lib/console/crediti-calcoli";
import type { Periodo } from "@/lib/console/periodo";
import { Badge, Pannello, Tessera } from "./elementi";
import { formattaEuro, formattaIntero } from "./formati";
import InterruttoreProva from "./interruttore-prova";
import SelettorePeriodo, { parametriPeriodo, urlConParametri } from "./selettore-periodo";

// Vista pura della pagina Crediti: crediti venduti, consumati e residui, per
// periodo e per cliente. Riceve dati già letti.

const COLONNE: { ordine: OrdineCrediti | null; etichetta: string; num: boolean }[] = [
  { ordine: "cliente", etichetta: "Cliente", num: false },
  { ordine: "movimento", etichetta: "Acquistati nel periodo", num: true },
  { ordine: null, etichetta: "Consumati nel periodo", num: true },
  { ordine: "saldo", etichetta: "Saldo oggi", num: true },
  { ordine: null, etichetta: "Venduti in tutto", num: true },
  { ordine: null, etichetta: "Consumati in tutto", num: true },
  { ordine: null, etichetta: "Estinti (derivati)", num: true },
];

export default function CreditiVista({
  periodo,
  crediti,
  righeOrdinate,
  ordine,
  includiProva,
}: {
  periodo: Periodo;
  crediti: CreditiLetti;
  righeOrdinate: RigaCrediti[];
  ordine: OrdineCrediti;
  includiProva: boolean;
}) {
  const parametriLink = { ...parametriPeriodo(periodo), prova: includiProva ? "1" : undefined };

  const testata = (
    <>
      <div className="cn-testata">
        <div>
          <h1>Crediti</h1>
          <p>Gare extra di OMNIA AI: vendute, consumate, residue · {periodo.etichetta}</p>
        </div>
      </div>
      <div className="cn-periodo" style={{ marginBottom: 14 }}>
        <SelettorePeriodo percorso="/crediti" periodo={periodo} extra={{ ord: ordine === "movimento" ? undefined : ordine, prova: includiProva ? "1" : undefined }} />
        <InterruttoreProva percorso="/crediti" parametri={{ ...parametriPeriodo(periodo), ord: ordine === "movimento" ? undefined : ordine }} includiProva={includiProva} />
      </div>
    </>
  );

  if (crediti.stato === "errore") {
    return (
      <>
        {testata}
        <p className="cn-esito errore" role="alert">
          {crediti.messaggio}
        </p>
      </>
    );
  }

  const { totali: t, provaNascosti } = crediti.risultato;

  return (
    <>
      {testata}

      {provaNascosti > 0 && !includiProva && (
        <p className="cn-esito" role="status" style={{ marginBottom: 14 }}>
          {formattaIntero(provaNascosti)} {provaNascosti === 1 ? "cliente" : "clienti"} con acquisti solo di prova non {provaNascosti === 1 ? "è conteggiato" : "sono conteggiati"} (Stripe di OMNIA AI è in modalità di prova). Includi i dati di prova per vederli.
        </p>
      )}
      {includiProva && (
        <p className="cn-esito avviso" role="status" style={{ marginBottom: 14 }}>
          Dati di prova INCLUSI: gli acquisti di crediti di prova sono dentro i conteggi. Non sono denaro reale.
        </p>
      )}

      <div className="cn-tessere">
        <Tessera
          etichetta="Venduti nel periodo"
          valore={formattaIntero(t.acquistatiPeriodo)}
          unita={t.acquistatiPeriodo === 1 ? "credito" : "crediti"}
          dettaglio={`${formattaEuro(t.importoPeriodo)} incassati, IVA inclusa`}
        />
        <Tessera etichetta="Consumati nel periodo" valore={formattaIntero(t.consumatiPeriodo)} unita={t.consumatiPeriodo === 1 ? "gara" : "gare"} dettaglio="Gare analizzate pagate con crediti" />
        <Tessera
          etichetta="Residui oggi"
          valore={formattaIntero(t.saldoResiduo)}
          tono={t.saldoResiduo > 0 ? "accento" : "neutro"}
          dettaglio={`Saldo spendibile dei ${formattaIntero(t.clienti)} clienti con crediti`}
        />
        <Tessera
          etichetta="Estinti (derivati)"
          valore={formattaIntero(t.estinti)}
          dettaglio={`Venduti ${formattaIntero(t.vendutiTotali)} − consumati ${formattaIntero(t.consumatiTotali)} − residui, in tutto lo storico`}
        />
        {t.rettificheManuali > 0 && (
          <Tessera etichetta="Saldo non spiegato" valore={formattaIntero(t.rettificheManuali)} tono="avviso" dettaglio="Saldo superiore a venduti − consumati: crediti aggiunti a mano" />
        )}
      </div>

      <div className="cn-sezione">
        <Pannello titolo={`Per cliente (${righeOrdinate.length})`}>
          {righeOrdinate.length === 0 ? (
            <p className="cn-vuoto">Nessun cliente con crediti{includiProva ? "" : " (esclusi quelli di prova)"}.</p>
          ) : (
            <div className="cn-scorri">
              <table className="cn-tab">
                <thead>
                  <tr>
                    {COLONNE.map((c) => (
                      <th key={c.etichetta} className={c.num ? "num" : undefined}>
                        {c.ordine ? (
                          <Link href={urlConParametri("/crediti", { ...parametriLink, ord: c.ordine === "movimento" ? undefined : c.ordine })} className={ordine === c.ordine ? "cn-ordinamento attivo" : "cn-ordinamento"}>
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
                  {righeOrdinate.map((r) => (
                    <tr key={r.userId}>
                      <td className="cn-cella-doppia">
                        {r.email ?? "(utente eliminato)"}
                        {r.ragioneSociale && <small>{r.ragioneSociale}</small>}
                        {r.prova && (
                          <small>
                            <Badge tono="avviso">prova</Badge>
                          </small>
                        )}
                      </td>
                      <td className="num" title={`${formattaEuro(r.importoPeriodo)} lordi`}>
                        {formattaIntero(r.acquistatiPeriodo)}
                      </td>
                      <td className="num">{formattaIntero(r.consumatiPeriodo)}</td>
                      <td className="num">
                        <strong>{formattaIntero(r.saldo)}</strong>
                      </td>
                      <td className="num">{formattaIntero(r.vendutiTotali)}</td>
                      <td className="num">{formattaIntero(r.consumatiTotali)}</td>
                      <td className="num">
                        {formattaIntero(r.estinti)}
                        {r.rettificheManuali > 0 && <small style={{ display: "block", color: "var(--cn-avviso)" }}>+{formattaIntero(r.rettificheManuali)} non spiegati</small>}
                      </td>
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
          <summary>Come si calcolano questi numeri</summary>
          <ul className="cn-elenco">
            <li>
              <strong>Venduti:</strong> crediti dei pacchetti acquistati (un credito = una gara extra). <strong>Consumati:</strong> gare analizzate quando il piano non aveva più gare incluse e si è speso un credito.
            </li>
            <li>
              <strong>Residui:</strong> il saldo attuale di ogni cliente (<code>credits.balance</code>).
            </li>
            <li>
              <strong>Estinti:</strong> non esiste un registro delle estinzioni. Alla cessazione dell&apos;abbonamento il saldo si azzera (condizioni di abbonamento): quanto è sparito si ricava per differenza, venduti − consumati − saldo, in tutto lo storico. Se la differenza è negativa il saldo contiene crediti che il registro degli acquisti non spiega (aggiunti o corretti a mano), e si mostra a parte.
            </li>
            <li>
              <strong>Periodo:</strong> acquistati e consumati si contano nel periodo scelto; saldo, venduti ed estinti sono sempre totali. Gli acquisti con Stripe in modalità test sono di prova e restano fuori salvo che tu li includa.
            </li>
          </ul>
        </details>
      </div>
    </>
  );
}
