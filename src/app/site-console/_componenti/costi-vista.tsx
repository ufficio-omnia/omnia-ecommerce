import Link from "next/link";
import type { CostiNonAttribuiti, OrdineCosti, RigaCliente } from "@/lib/console/costi-calcoli";
import type { CostiLetti } from "@/lib/console/costi";
import type { Periodo } from "@/lib/console/periodo";
import type { StatoSalvataggio } from "../azioni/costi";
import { Badge, Pannello, Tessera } from "./elementi";
import FormParametri from "./form-parametri";
import { formattaEuro, formattaIntero, formattaPercentuale, formattaUsd } from "./formati";
import SelettorePeriodo, { parametriPeriodo, urlConParametri } from "./selettore-periodo";

// Vista pura della pagina Costi: costo dei modelli per cliente contro quanto il
// cliente paga. Riceve dati già letti; l'azione dei parametri è una prop.

export const ETICHETTA_CATEGORIA: Record<CostiNonAttribuiti["categoria"], string> = {
  piattaforma: "Piattaforma: knowledge base (nel margine)",
  non_attribuito: "Senza cliente: script di sviluppo o clienti eliminati (fuori dal margine)",
  prova: "Prove degli script con prefisso «prova:» (escluse da tutto)",
};

// Euro se il cambio è impostato, altrimenti dollari con la dicitura.
export function importoCosto(usd: number, eur: number | null): string {
  return eur === null ? formattaUsd(usd) : formattaEuro(eur);
}

function Margine({ valore, percentuale }: { valore: number | null; percentuale: number | null }) {
  if (valore === null) return <>—</>;
  return (
    <span style={{ color: valore < 0 ? "var(--cn-errore)" : "var(--cn-ok)" }}>
      {formattaEuro(valore)}
      {percentuale !== null && <small style={{ marginLeft: 6, color: "var(--cn-secondario)" }}>{formattaPercentuale(percentuale)}</small>}
    </span>
  );
}

const COLONNE: { ordine: OrdineCosti | null; etichetta: string; num: boolean }[] = [
  { ordine: "cliente", etichetta: "Cliente", num: false },
  { ordine: null, etichetta: "Piano", num: false },
  { ordine: "costo", etichetta: "Costo", num: true },
  { ordine: "gare", etichetta: "Gare", num: true },
  { ordine: null, etichetta: "Costo / gara", num: true },
  { ordine: null, etichetta: "Ricavo netto", num: true },
  { ordine: "margine", etichetta: "Margine", num: true },
];

export default function CostiVista({
  periodo,
  ordine,
  costi,
  righeOrdinate,
  stripeInProva,
  azioneParametri,
}: {
  periodo: Periodo;
  ordine: OrdineCosti;
  costi: CostiLetti;
  righeOrdinate: RigaCliente[];
  // la chiave Stripe di OMNIA AI è di prova: i ricavi AI non sono denaro reale
  stripeInProva: boolean;
  azioneParametri: (stato: StatoSalvataggio, dati: FormData) => Promise<StatoSalvataggio>;
}) {
  const testata = (
    <div className="cn-testata">
      <div>
        <h1>Costi e margini</h1>
        <p>Costo dei modelli per cliente contro quanto il cliente paga · {periodo.etichetta}</p>
      </div>
    </div>
  );
  const selettore = (
    <div style={{ marginBottom: 14 }}>
      <SelettorePeriodo percorso="/costi" periodo={periodo} extra={{ ord: ordine === "costo" ? undefined : ordine }} />
    </div>
  );

  if (costi.stato === "funzioni_mancanti") {
    return (
      <>
        {testata}
        <p className="cn-esito avviso" role="status">
          Mancano le funzioni di calcolo nel database: eseguire la migrazione 0077.
        </p>
      </>
    );
  }
  if (costi.stato === "errore") {
    return (
      <>
        {testata}
        <p className="cn-esito errore" role="alert">
          {costi.messaggio}
        </p>
      </>
    );
  }

  const { parametri, totali, nonAttribuiti, modelli } = costi;
  const cambio = parametri.cambioUsdEur;
  const senzaCambio = cambio === null;
  const totaleClienti = righeOrdinate.reduce(
    (s, r) => ({
      costoUsd: s.costoUsd + r.costoUsd,
      costoEur: s.costoEur + (r.costoEur ?? 0),
      gare: s.gare + r.gare,
      ricavoNetto: s.ricavoNetto + r.ricavoNetto,
      margine: s.margine + (r.margine ?? 0),
    }),
    { costoUsd: 0, costoEur: 0, gare: 0, ricavoNetto: 0, margine: 0 },
  );
  const parametriLink = parametriPeriodo(periodo);

  return (
    <>
      {testata}
      {selettore}

      {!parametri.tabellaDisponibile && (
        <p className="cn-esito avviso" role="status" style={{ marginBottom: 14 }}>
          Mancano i parametri di calcolo nel database: eseguire la migrazione 0077.
        </p>
      )}
      {stripeInProva && (
        <p className="cn-esito avviso" role="status" style={{ marginBottom: 14 }}>
          Stripe di OMNIA AI è in modalità di prova: abbonamenti e crediti sono acquisti di prova, quindi ricavo e margine qui sotto non sono denaro reale. I costi dei modelli, invece, sono spesa vera.
        </p>
      )}
      {senzaCambio && (
        <p className="cn-esito avviso" role="status" style={{ marginBottom: 14 }}>
          Il cambio dollaro-euro non è impostato: i costi sono in dollari e il margine non si calcola. Impostalo nel riquadro «Parametri di calcolo» in fondo alla pagina.
        </p>
      )}

      <div className="cn-tessere">
        <Tessera
          etichetta="Costo dei modelli"
          valore={importoCosto(totali.costoUsd, totali.costoEur)}
          dettaglio={
            totali.costoNonAttribuitoUsd > 0
              ? `Clienti e piattaforma, ${formattaIntero(totali.operazioni)} chiamate · più ${formattaUsd(totali.costoNonAttribuitoUsd)} senza cliente`
              : `Clienti e piattaforma, ${formattaIntero(totali.operazioni)} chiamate`
          }
        />
        <Tessera
          etichetta="Ricavo da listino, senza IVA"
          valore={formattaEuro(totali.ricavoNetto)}
          dettaglio={`IVA ${parametri.aliquotaIva.toLocaleString("it-IT")} % scorporata · abbonamenti da listino, non incassi`}
        />
        <Tessera
          etichetta="Margine complessivo"
          valore={totali.margine === null ? "—" : formattaEuro(totali.margine)}
          tono={totali.margine === null ? "neutro" : totali.margine < 0 ? "errore" : "ok"}
          dettaglio={totali.marginePerc === null ? "Dopo i costi di piattaforma" : `${formattaPercentuale(totali.marginePerc)} del ricavo, dopo i costi di piattaforma`}
        />
        <Tessera
          etichetta="Gare consumate"
          valore={formattaIntero(totali.gare)}
          dettaglio={totali.costoPerGaraEur === null ? "Costo medio per gara non calcolabile" : `Costo medio ${formattaEuro(totali.costoPerGaraEur)} per gara (solo costi dei clienti)`}
        />
        <Tessera
          etichetta="Chiamate senza costo"
          valore={formattaIntero(totali.operazioniSenzaCosto)}
          tono={totali.operazioniSenzaCosto > 0 ? "avviso" : "neutro"}
          dettaglio={totali.operazioniSenzaCosto > 0 ? "Modello senza tariffa: costo sottostimato" : "Tutte le chiamate hanno una tariffa"}
        />
      </div>

      <div className="cn-sezione">
        <Pannello titolo={`Clienti (${righeOrdinate.length})`}>
          {righeOrdinate.length === 0 ? (
            <p className="cn-vuoto">Nessun costo, gara o ricavo da clienti in questo periodo.</p>
          ) : (
            <div className="cn-scorri">
              <table className="cn-tab">
                <thead>
                  <tr>
                    {COLONNE.map((c) => (
                      <th key={c.etichetta} className={c.num ? "num" : undefined}>
                        {c.ordine ? (
                          <Link
                            href={urlConParametri("/costi", { ...parametriLink, ord: c.ordine === "costo" ? undefined : c.ordine })}
                            className={ordine === c.ordine ? "cn-ordinamento attivo" : "cn-ordinamento"}
                            aria-label={`Ordina per ${c.etichetta}`}
                          >
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
                    <tr key={r.userId} className={r.margine !== null && r.margine < 0 ? "cn-riga-errore" : undefined}>
                      <td className="cn-cella-doppia">
                        <Link href={urlConParametri(`/costi/${r.userId}`, parametriLink)}>{r.email ?? "(utente eliminato)"}</Link>
                        {r.ragioneSociale && <small>{r.ragioneSociale}</small>}
                      </td>
                      <td className="nowrap">
                        {r.abbonamentoManuale ? <Badge tono="avviso">manuale</Badge> : r.piano ? <Badge tono="accento">{r.piano}</Badge> : "—"}
                      </td>
                      <td className="num" title={`${formattaUsd(r.costoUsd, 4)} · ${formattaIntero(r.operazioni)} chiamate`}>
                        {importoCosto(r.costoUsd, r.costoEur)}
                      </td>
                      <td className="num" title={`${r.gareDaPiano} dal piano, ${r.gareDaCredito} con crediti`}>
                        {formattaIntero(r.gare)}
                      </td>
                      <td className="num">{r.costoPerGaraEur === null ? (r.costoUsd > 0 && r.gare === 0 ? "senza gare" : "—") : formattaEuro(r.costoPerGaraEur)}</td>
                      <td className="num" title={`Abbonamento ${formattaEuro(r.ricavoAbbonamentoLordo)} + crediti ${formattaEuro(r.ricavoCreditiLordo)} lordi`}>
                        {formattaEuro(r.ricavoNetto)}
                      </td>
                      <td className="num">
                        <Margine valore={r.margine} percentuale={r.marginePerc} />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Totale clienti</td>
                    <td></td>
                    <td className="num">{importoCosto(totaleClienti.costoUsd, senzaCambio ? null : totaleClienti.costoEur)}</td>
                    <td className="num">{formattaIntero(totaleClienti.gare)}</td>
                    <td className="num">{!senzaCambio && totaleClienti.gare > 0 ? formattaEuro(totaleClienti.costoEur / totaleClienti.gare) : "—"}</td>
                    <td className="num">{formattaEuro(totaleClienti.ricavoNetto)}</td>
                    <td className="num">{senzaCambio ? "—" : <Margine valore={totaleClienti.margine} percentuale={totaleClienti.ricavoNetto > 0 ? totaleClienti.margine / totaleClienti.ricavoNetto : null} />}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Pannello>
      </div>

      <div className="cn-sezione">
        <Pannello titolo="Costi non attribuibili a un cliente">
          {nonAttribuiti.length === 0 ? (
            <p className="cn-vuoto">Nessuno in questo periodo.</p>
          ) : (
            <div className="cn-scorri">
              <table className="cn-tab">
                <thead>
                  <tr>
                    <th>Categoria</th>
                    <th className="num">Chiamate</th>
                    <th className="num">Senza costo</th>
                    <th className="num">Costo</th>
                  </tr>
                </thead>
                <tbody>
                  {nonAttribuiti.map((n) => (
                    <tr key={n.categoria}>
                      <td>
                        {n.categoria === "prova" ? (
                          ETICHETTA_CATEGORIA[n.categoria]
                        ) : (
                          <Link href={urlConParametri("/costi/piattaforma", parametriLink)}>{ETICHETTA_CATEGORIA[n.categoria]}</Link>
                        )}
                      </td>
                      <td className="num">{formattaIntero(n.operazioni)}</td>
                      <td className="num">{formattaIntero(n.operazioniSenzaCosto)}</td>
                      <td className="num">{importoCosto(n.costoUsd, senzaCambio ? null : n.costoUsd * (cambio ?? 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Pannello>
      </div>

      <div className="cn-colonne cn-colonne-pari">
        <Pannello titolo="Qualità dei dati: modelli e tariffe">
          {modelli.length === 0 ? (
            <p className="cn-vuoto">Nessuna chiamata a modelli in questo periodo.</p>
          ) : (
            <div className="cn-scorri">
              <table className="cn-tab">
                <thead>
                  <tr>
                    <th>Modello</th>
                    <th className="num">Chiamate</th>
                    <th className="num">Costo</th>
                    <th>Tariffa ($ per milione di token)</th>
                  </tr>
                </thead>
                <tbody>
                  {modelli.map((m) => (
                    <tr key={`${m.provider}/${m.model}`}>
                      <td className="cn-cella-doppia">
                        {m.model}
                        <small>{m.provider}</small>
                      </td>
                      <td className="num">{formattaIntero(m.operazioni)}</td>
                      <td className="num">{formattaUsd(m.costoUsd)}</td>
                      <td>
                        {m.tariffa ? (
                          <span className="mono">
                            in {m.tariffa.input.toLocaleString("it-IT")} · out {m.tariffa.output.toLocaleString("it-IT")}
                          </span>
                        ) : (
                          <Badge tono="errore">mancante: {formattaIntero(m.operazioniSenzaCosto)} chiamate senza costo</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="cn-nota">
            Le tariffe stanno in <code>src/lib/ai-pricing.ts</code> (riferite al 2026-09-11) e sono segnate «da verificare» contro il listino: il margine
            vale quanto le tariffe. I token grezzi restano salvati e il costo si può ricalcolare.
          </p>
        </Pannello>

        <Pannello titolo="Parametri di calcolo">
          <FormParametri azione={azioneParametri} cambio={parametri.cambioUsdEur} iva={parametri.aliquotaIva} />
        </Pannello>
      </div>

      <div className="cn-sezione">
        <details className="cn-dettagli">
          <summary>Come si calcolano questi numeri</summary>
          <ul className="cn-elenco">
            <li>
              <strong>Costo:</strong> somma del costo stimato di ogni chiamata a un modello (registro delle operazioni) nel periodo, in dollari, convertito in euro col cambio dei parametri. Le prove degli script sono escluse.
            </li>
            <li>
              <strong>Gare:</strong> gare analizzate nel periodo, incluse nel piano o pagate con crediti (anche se poi cancellate). Costo per gara = costo del cliente ÷ gare del cliente nel periodo.
            </li>
            <li>
              <strong>Ricavo:</strong> abbonamento <em>da listino</em> (prezzo del piano ÷ 30,4375 × giorni di abbonamento attivo nel periodo; i giorni futuri non contano) più i crediti acquistati nel periodo (importo pagato). Gli abbonamenti creati a mano non generano ricavo. Quando gli incassi reali saranno registrati, l&apos;abbonamento passerà a quelli.
            </li>
            <li>
              <strong>Margine:</strong> ricavo senza IVA − costo in euro. I costi di piattaforma (knowledge base) non pesano sui singoli clienti ma sul margine complessivo. Le chiamate senza cliente (script di sviluppo, clienti eliminati) si vedono in «Costi non attribuibili» ma restano fuori dal margine e dal costo per gara: sono spesa di sviluppo, non costo di servire i clienti.
            </li>
          </ul>
          {(costi.abbonamentiManuali > 0 || costi.abbonamentiPianoSconosciuto > 0) && (
            <p className="cn-nota">
              Abbonamenti senza ricavo calcolabile: {costi.abbonamentiManuali} creati a mano, {costi.abbonamentiPianoSconosciuto} con piano fuori catalogo.
            </p>
          )}
        </details>
      </div>
    </>
  );
}
