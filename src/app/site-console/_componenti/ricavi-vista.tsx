import type { Periodo } from "@/lib/console/periodo";
import type { SuggerimentoProva } from "@/lib/console/prova";
import type { RicaviLetti } from "@/lib/console/ricavi";
import { Badge, Pannello, Tessera } from "./elementi";
import { formattaData, formattaEuro, formattaIntero } from "./formati";
import InterruttoreProva from "./interruttore-prova";
import SelettorePeriodo, { parametriPeriodo } from "./selettore-periodo";

// Vista pura della pagina Ricavi: per dominio (e-commerce, OMNIA AI) e
// aggregati, per mese. Riceve dati già letti.

const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
const etichettaMese = (m: string) => `${MESI[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

const ETICHETTA_TIPO: Record<string, string> = { primo: "primo pagamento", rinnovo: "rinnovo", conguaglio: "conguaglio cambio piano", altro: "altro" };

export default function RicaviVista({
  periodo,
  ricavi,
  includiProva,
  provaAltrove,
}: {
  periodo: Periodo;
  ricavi: RicaviLetti;
  includiProva: boolean;
  // dati di prova inclusi ma assenti in questo periodo, presenti in altri
  provaAltrove: SuggerimentoProva | null;
}) {
  const parametriControlli = { ...parametriPeriodo(periodo), prova: includiProva ? "1" : undefined };

  const testata = (
    <>
      <div className="cn-testata">
        <div>
          <h1>Ricavi</h1>
          <p>
            E-commerce e OMNIA AI, per dominio e aggregati · {periodo.etichetta} · importi senza IVA salvo dove indicato
          </p>
        </div>
      </div>
      <div className="cn-periodo" style={{ marginBottom: 14 }}>
        <SelettorePeriodo percorso="/ricavi" periodo={periodo} extra={{ prova: includiProva ? "1" : undefined }} />
        <InterruttoreProva percorso="/ricavi" parametri={parametriControlli} includiProva={includiProva} />
      </div>
    </>
  );

  if (ricavi.stato === "errore") {
    return (
      <>
        {testata}
        <p className="cn-esito errore" role="alert">
          {ricavi.messaggio}
        </p>
      </>
    );
  }

  const { riepilogo, incassiDisponibili, dataPagamentoDisponibile, ultimiIncassi, parametri } = ricavi;
  const t = riepilogo.totali;
  const massimoMese = Math.max(1, ...riepilogo.perMese.map((m) => m.totale));

  return (
    <>
      {testata}

      {!incassiDisponibili && (
        <p className="cn-esito avviso" role="status" style={{ marginBottom: 14 }}>
          Gli incassi di OMNIA AI non sono ancora registrati: eseguire la migrazione 0078 (poi il backfill e l&apos;evento Stripe). Qui sotto ci sono solo i crediti AI e l&apos;e-commerce.
        </p>
      )}
      {!dataPagamentoDisponibile && (
        <p className="cn-esito avviso" role="status" style={{ marginBottom: 14 }}>
          La data di pagamento degli ordini non è disponibile: eseguire la migrazione 0075. Si usa la data dell&apos;ordine.
        </p>
      )}
      {provaAltrove && (
        <p className="cn-esito avviso" role="status" style={{ marginBottom: 14 }}>
          Dati di prova inclusi, ma in questo periodo non ce ne sono. I {formattaIntero(provaAltrove.voci)} pagamenti di prova esistenti vanno dal {formattaData(provaAltrove.da)} al {formattaData(provaAltrove.a)}: scegli un periodo che li comprenda, per esempio «Anno».
        </p>
      )}
      {riepilogo.prova.voci > 0 && (
        <p className={`cn-esito ${includiProva ? "avviso" : ""}`} role="status" style={{ marginBottom: 14 }}>
          {includiProva
            ? `Dati di prova INCLUSI: ${formattaIntero(riepilogo.prova.voci)} pagamenti di prova per ${formattaEuro(riepilogo.prova.lordo)} lordi (Stripe di OMNIA AI è in modalità di prova) sono dentro i totali. Non sono denaro reale.`
            : `Dati di prova nascosti: ${formattaIntero(riepilogo.prova.voci)} pagamenti di prova per ${formattaEuro(riepilogo.prova.lordo)} lordi non sono nei totali (Stripe di OMNIA AI è in modalità di prova).`}
        </p>
      )}

      <div className="cn-tessere">
        <Tessera etichetta="Ricavo totale" valore={formattaEuro(t.netto)} dettaglio={`Netto · ${formattaEuro(t.lordo)} lordi, IVA inclusa`} />
        <Tessera
          etichetta="E-commerce"
          valore={formattaEuro(t.ecommerceNetto)}
          dettaglio={`${formattaIntero(t.ecommerceOrdini)} ordini pagati · ${formattaEuro(t.ecommerceLordo)} lordi`}
        />
        <Tessera etichetta="OMNIA AI" valore={formattaEuro(t.omniaAiNetto)} dettaglio={`Abbonamenti e crediti · ${formattaEuro(t.omniaAiLordo)} lordi`} />
        <Tessera etichetta="Abbonamenti AI" valore={formattaEuro(t.abbonamentiNetto)} dettaglio={`${formattaIntero(t.incassiAbbonamento)} incassi (primi pagamenti, rinnovi, conguagli)`} />
        <Tessera etichetta="Crediti AI" valore={formattaEuro(t.creditiNetto)} dettaglio={`${formattaIntero(t.acquistiCrediti)} acquisti`} />
      </div>

      <div className="cn-sezione">
        <Pannello titolo="Per mese (senza IVA)">
          <div className="cn-scorri">
            <table className="cn-tab">
              <thead>
                <tr>
                  <th>Mese</th>
                  <th className="num">E-commerce</th>
                  <th className="num">Abbonamenti AI</th>
                  <th className="num">Crediti AI</th>
                  <th className="num">Totale</th>
                  <th style={{ width: "22%" }}></th>
                </tr>
              </thead>
              <tbody>
                {riepilogo.perMese.map((m) => (
                  <tr key={m.mese}>
                    <td className="mono">{etichettaMese(m.mese)}</td>
                    <td className="num">{formattaEuro(m.ecommerce)}</td>
                    <td className="num">{formattaEuro(m.abbonamenti)}</td>
                    <td className="num">{formattaEuro(m.crediti)}</td>
                    <td className="num">
                      <strong>{formattaEuro(m.totale)}</strong>
                    </td>
                    <td>
                      <div className="cn-barra-ricavi" aria-hidden="true">
                        <span className="e" style={{ width: `${(m.ecommerce / massimoMese) * 100}%` }} />
                        <span className="a" style={{ width: `${((m.abbonamenti + m.crediti) / massimoMese) * 100}%` }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              {riepilogo.perMese.length > 1 && (
                <tfoot>
                  <tr>
                    <td>Totale</td>
                    <td className="num">{formattaEuro(t.ecommerceNetto)}</td>
                    <td className="num">{formattaEuro(t.abbonamentiNetto)}</td>
                    <td className="num">{formattaEuro(t.creditiNetto)}</td>
                    <td className="num">{formattaEuro(t.netto)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <p className="cn-nota">
            <span className="cn-legenda e" /> E-commerce <span className="cn-legenda a" style={{ marginLeft: 12 }} /> OMNIA AI
          </p>
        </Pannello>
      </div>

      <div className="cn-sezione">
        <Pannello titolo="Ultimi incassi degli abbonamenti OMNIA AI">
          {ultimiIncassi.length === 0 ? (
            <p className="cn-vuoto">
              {incassiDisponibili ? "Nessun incasso nel periodo." : "Registro degli incassi non ancora attivo."}
            </p>
          ) : (
            <div className="cn-scorri">
              <table className="cn-tab">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Cliente</th>
                    <th>Tipo</th>
                    <th className="num">Lordo</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {ultimiIncassi.map((i) => (
                    <tr key={i.id}>
                      <td className="mono">{formattaData(i.pagatoIl)}</td>
                      <td className="tronca" title={i.cliente}>
                        {i.cliente}
                      </td>
                      <td>{ETICHETTA_TIPO[i.tipo] ?? i.tipo}</td>
                      <td className="num">{formattaEuro(i.lordo)}</td>
                      <td className="nowrap">
                        {i.prova && <Badge tono="avviso">prova</Badge>}
                        {i.ricevutaUrl && (
                          <a href={i.ricevutaUrl} target="_blank" rel="noreferrer" style={{ marginLeft: 8 }}>
                            ricevuta Stripe
                          </a>
                        )}
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
              <strong>Data di competenza:</strong> la data dell&apos;incasso. Un ordine con carta vale dal giorno dell&apos;ordine; un bonifico dal giorno in cui hai confermato l&apos;accredito (la data dell&apos;ordine per quelli confermati prima della migrazione 0075
              {riepilogo.dateApprossimate > 0 ? `: ${riepilogo.dateApprossimate} nel periodo` : ""}). I mesi sono quelli di calendario di Roma.
            </li>
            <li>
              <strong>Netto e lordo:</strong> tutti i prezzi sono IVA inclusa. Il netto si ricava dall&apos;imposta calcolata da Stripe quando c&apos;è; altrimenti si scorpora l&apos;IVA con l&apos;aliquota dei parametri ({parametri.aliquotaIva.toLocaleString("it-IT")} %)
              {riepilogo.ivaStimata ? ": è il caso di questi dati, Stripe non separa l'IVA" : ""}.
            </li>
            <li>
              <strong>OMNIA AI:</strong> incassi degli abbonamenti (fatture Stripe pagate) più i crediti acquistati. I rinnovi mensili compaiono da quando l&apos;evento <code>invoice.paid</code> è attivo su Stripe; i pagamenti precedenti si recuperano con lo script di backfill.
            </li>
            <li>
              <strong>Dati di prova:</strong> gli incassi e i crediti pagati sull&apos;account Stripe in modalità test non sono denaro e restano fuori dai totali, salvo che tu li includa.
            </li>
          </ul>
        </details>
      </div>
    </>
  );
}
