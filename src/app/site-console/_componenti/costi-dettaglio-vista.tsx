import Link from "next/link";
import type { DettaglioCliente } from "@/lib/console/costi";
import type { Periodo } from "@/lib/console/periodo";
import { Badge, Pannello, Tessera } from "./elementi";
import { formattaData, formattaEuro, formattaIntero, formattaPercentuale, formattaUsd } from "./formati";
import SelettorePeriodo, { parametriPeriodo, urlConParametri } from "./selettore-periodo";

// Nome leggibile delle operazioni registrate in ai_operazioni (il codice grezzo resta visibile sotto).
function etichettaOperazione(nome: string): string {
  if (nome.startsWith("bozza_")) return "Bozza di una sezione della relazione";
  const note: Record<string, string> = {
    estrazione_gara: "Analisi del bando",
    chat_gara: "Chat della gara",
    chat_gara_ricerca: "Ricerca nei documenti (chat)",
    chat_gara_wrapup: "Riepilogo di fine elaborazione",
    espansione_mirata: "Espansione dei sotto-criteri",
    compressione_mirata: "Compressione dei sotto-criteri",
    verifica_dati_aziendali: "Verifica dei dati aziendali",
    riformulazione_senza_economico: "Rimozione dei riferimenti economici",
    organigramma_ricerca_stile: "Organigramma: ricerca dello stile",
    organigramma_stile: "Organigramma: stile",
    trascrizione_immagine_gara: "Trascrizione di immagini del bando",
    indicizzazione_documento_gara: "Indicizzazione dei documenti",
    chat_assistenza: "Assistente di supporto",
    kb_nota_stile: "Knowledge base: nota di stile",
    kb_struttura_titoli: "Knowledge base: struttura dei titoli",
    kb_anonimizzazione_alias: "Knowledge base: anonimizzazione",
    kb_anonimizzazione_blocco: "Knowledge base: anonimizzazione",
    kb_embedding_documento: "Knowledge base: embedding dei documenti",
    kb_embedding_immagini: "Knowledge base: embedding delle immagini",
    kb_embedding_stile_struttura: "Knowledge base: embedding dello stile",
  };
  return note[nome] ?? "";
}

export default function CostiDettaglioVista({
  periodo,
  dettaglio,
  piattaforma,
  idUtente,
}: {
  periodo: Periodo;
  dettaglio: DettaglioCliente;
  piattaforma: boolean;
  idUtente: string;
}) {
  const parametriLink = parametriPeriodo(periodo);
  const indietro = urlConParametri("/costi", parametriLink);
  const titolo = piattaforma ? "Costi senza cliente" : dettaglio.stato === "ok" ? (dettaglio.identita.email ?? "Cliente eliminato") : "Cliente";

  const testata = (
    <>
      <p style={{ marginBottom: 6 }}>
        <Link href={indietro}>← Tutti i clienti</Link>
      </p>
      <div className="cn-testata">
        <div>
          <h1>{titolo}</h1>
          <p>
            {dettaglio.stato === "ok" && dettaglio.identita.ragioneSociale ? `${dettaglio.identita.ragioneSociale} · ` : ""}
            Costi e margini · {periodo.etichetta}
          </p>
        </div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <SelettorePeriodo percorso={`/costi/${idUtente}`} periodo={periodo} />
      </div>
    </>
  );

  if (dettaglio.stato === "funzioni_mancanti") {
    return (
      <>
        {testata}
        <p className="cn-esito avviso">Mancano le funzioni di calcolo nel database: eseguire la migrazione 0077.</p>
      </>
    );
  }
  if (dettaglio.stato === "errore") {
    return (
      <>
        {testata}
        <p className="cn-esito errore">{dettaglio.messaggio}</p>
      </>
    );
  }

  const { riga, operazioni, gare, parametri } = dettaglio;
  const cambio = parametri.cambioUsdEur;
  const costoTotaleUsd = operazioni.reduce((s, o) => s + o.costoUsd, 0);
  const euro = (usd: number) => (cambio === null ? "—" : formattaEuro(usd * cambio));

  return (
    <>
      {testata}

      {cambio === null && (
        <p className="cn-esito avviso" role="status" style={{ marginBottom: 14 }}>
          Il cambio dollaro-euro non è impostato: costi in dollari, margine non calcolato (vedi «Parametri di calcolo» nella pagina Costi).
        </p>
      )}

      <div className="cn-tessere">
        <Tessera etichetta="Costo dei modelli" valore={cambio === null ? formattaUsd(costoTotaleUsd) : formattaEuro(costoTotaleUsd * cambio)} dettaglio={`${formattaUsd(costoTotaleUsd, 4)} · ${formattaIntero(operazioni.reduce((s, o) => s + o.chiamate, 0))} chiamate`} />
        {!piattaforma && riga && (
          <>
            <Tessera etichetta="Gare consumate" valore={formattaIntero(riga.gare)} dettaglio={`${riga.gareDaPiano} dal piano · ${riga.gareDaCredito} con crediti`} />
            <Tessera etichetta="Costo per gara" valore={riga.costoPerGaraEur === null ? "—" : formattaEuro(riga.costoPerGaraEur)} dettaglio={riga.gare === 0 && riga.costoUsd > 0 ? "Costo senza gare consumate nel periodo" : "Costo del periodo ÷ gare del periodo"} />
            <Tessera etichetta="Ricavo netto da listino" valore={formattaEuro(riga.ricavoNetto)} dettaglio={`Lordo ${formattaEuro(riga.ricavoLordo)}, IVA ${parametri.aliquotaIva.toLocaleString("it-IT")} % scorporata`} />
            <Tessera
              etichetta="Margine"
              valore={riga.margine === null ? "—" : formattaEuro(riga.margine)}
              tono={riga.margine === null ? "neutro" : riga.margine < 0 ? "errore" : "ok"}
              dettaglio={riga.marginePerc === null ? "Margine percentuale non calcolabile" : `${formattaPercentuale(riga.marginePerc)} del ricavo`}
            />
          </>
        )}
      </div>

      {!piattaforma && (
        <div className="cn-colonne cn-colonne-pari">
          <Pannello titolo="Ricavo del periodo (lordo IVA)">
            <div className="cn-scorri">
              <table className="cn-tab">
                <tbody>
                  <tr>
                    <td>
                      Abbonamento da listino
                      {riga?.piano && (
                        <small style={{ display: "block", color: "var(--cn-fioco)" }}>
                          piano {riga.abbonamentoManuale ? `${riga.piano} (creato a mano: nessun ricavo)` : riga.piano} · {riga.giorniAbbonamento} giorni attivi nel periodo
                        </small>
                      )}
                    </td>
                    <td className="num">{formattaEuro(riga?.ricavoAbbonamentoLordo ?? 0)}</td>
                  </tr>
                  <tr>
                    <td>Crediti acquistati nel periodo</td>
                    <td className="num">{formattaEuro(riga?.ricavoCreditiLordo ?? 0)}</td>
                  </tr>
                  <tr>
                    <td>
                      <strong>Totale lordo</strong>
                    </td>
                    <td className="num">
                      <strong>{formattaEuro(riga?.ricavoLordo ?? 0)}</strong>
                    </td>
                  </tr>
                  <tr>
                    <td>Ricavo netto (IVA scorporata)</td>
                    <td className="num">{formattaEuro(riga?.ricavoNetto ?? 0)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Pannello>

          <Pannello titolo={`Gare consumate (${gare.length})`}>
            {gare.length === 0 ? (
              <p className="cn-vuoto">Nessuna gara consumata nel periodo.</p>
            ) : (
              <div className="cn-scorri" style={{ maxHeight: 280, overflowY: "auto" }}>
                <table className="cn-tab">
                  <thead>
                    <tr>
                      <th>Gara</th>
                      <th>Pagata con</th>
                      <th>Data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gare.map((g, i) => (
                      <tr key={`${g.creatoIl}-${i}`}>
                        <td>{g.titolo ?? "(gara cancellata)"}</td>
                        <td>
                          <Badge tono={g.tipo === "credito" ? "avviso" : "neutro"}>{g.tipo === "credito" ? "credito" : "piano"}</Badge>
                        </td>
                        <td className="mono">{formattaData(g.creatoIl)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Pannello>
        </div>
      )}

      <div className="cn-sezione">
        <Pannello titolo="Costo per tipo di operazione e modello">
          {operazioni.length === 0 ? (
            <p className="cn-vuoto">Nessuna chiamata a modelli nel periodo.</p>
          ) : (
            <div className="cn-scorri">
              <table className="cn-tab">
                <thead>
                  <tr>
                    <th>Operazione</th>
                    <th>Modello</th>
                    <th className="num">Chiamate</th>
                    <th className="num">Token in</th>
                    <th className="num">Token out</th>
                    <th className="num">Costo $</th>
                    <th className="num">Costo €</th>
                  </tr>
                </thead>
                <tbody>
                  {operazioni.map((o) => (
                    <tr key={`${o.operazione}/${o.model}`}>
                      <td className="cn-cella-doppia">
                        <span className="mono">{o.operazione}</span>
                        {etichettaOperazione(o.operazione) && <small>{etichettaOperazione(o.operazione)}</small>}
                      </td>
                      <td className="cn-cella-doppia">
                        {o.model}
                        <small>{o.provider}</small>
                      </td>
                      <td className="num">
                        {formattaIntero(o.chiamate)}
                        {o.senzaCosto > 0 && (
                          <small style={{ display: "block", color: "var(--cn-avviso)" }}>{o.senzaCosto} senza costo</small>
                        )}
                      </td>
                      <td className="num">{formattaIntero(o.inputToken)}</td>
                      <td className="num">{formattaIntero(o.outputToken)}</td>
                      <td className="num">{formattaUsd(o.costoUsd, 4)}</td>
                      <td className="num">{euro(o.costoUsd)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Totale</td>
                    <td></td>
                    <td className="num">{formattaIntero(operazioni.reduce((s, o) => s + o.chiamate, 0))}</td>
                    <td className="num">{formattaIntero(operazioni.reduce((s, o) => s + o.inputToken, 0))}</td>
                    <td className="num">{formattaIntero(operazioni.reduce((s, o) => s + o.outputToken, 0))}</td>
                    <td className="num">{formattaUsd(costoTotaleUsd, 4)}</td>
                    <td className="num">{euro(costoTotaleUsd)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Pannello>
      </div>
    </>
  );
}
