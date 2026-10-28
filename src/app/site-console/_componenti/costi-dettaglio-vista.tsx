import Link from "next/link";
import type { DettaglioCliente } from "@/lib/console/costi";
import { etichettaConsumo, quadraConIlTotale } from "@/lib/console/costi-per-gara-calcoli";
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
  includiProva,
}: {
  periodo: Periodo;
  dettaglio: DettaglioCliente;
  piattaforma: boolean;
  idUtente: string;
  includiProva: boolean;
}) {
  const parametriLink = { ...parametriPeriodo(periodo), prova: includiProva ? "1" : undefined };
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
        <SelettorePeriodo percorso={`/costi/${idUtente}`} periodo={periodo} extra={{ prova: includiProva ? "1" : undefined }} />
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
            <Tessera etichetta="Gare consumate" valore={formattaIntero(riga.gare)} dettaglio={`${riga.gareDaPiano} dal piano · ${riga.gareDaCredito} con crediti${gare.some((g) => g.tipo === "gratuita") ? ` · ${gare.filter((g) => g.tipo === "gratuita").length} gratuita` : ""}`} />
            <Tessera etichetta="Costo per gara" valore={riga.costoPerGaraEur === null ? "—" : formattaEuro(riga.costoPerGaraEur)} dettaglio={riga.gare === 0 && riga.costoUsd > 0 ? "Costo senza gare consumate nel periodo" : "Costo del periodo ÷ gare del periodo"} />
            <Tessera etichetta={dettaglio.fonteRicavo === "incassi" ? "Ricavo netto incassato" : "Ricavo netto da listino"} valore={formattaEuro(riga.ricavoNetto)} dettaglio={`Lordo ${formattaEuro(riga.ricavoLordo)}, IVA ${parametri.aliquotaIva.toLocaleString("it-IT")} % scorporata`} />
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
                      {dettaglio.fonteRicavo === "incassi" ? "Abbonamento: incassi del periodo" : "Abbonamento da listino"}
                      {riga?.piano && (
                        <small style={{ display: "block", color: "var(--cn-fioco)" }}>
                          piano {riga.abbonamentoManuale ? `${riga.piano} (creato a mano: nessun incasso)` : riga.piano}
                          {dettaglio.fonteRicavo === "listino" ? ` · ${riga.giorniAbbonamento} giorni attivi nel periodo` : ""}
                          {dettaglio.includiProva ? " · dati di prova inclusi" : ""}
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
                          <Badge tono={g.tipo === "piano" ? "neutro" : "avviso"}>{g.tipo === "credito" ? "credito" : g.tipo === "gratuita" ? "gara gratuita" : "piano"}</Badge>
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

      {!piattaforma && (
        <div className="cn-sezione">
          <Pannello titolo="Costo per gara">
            {dettaglio.perGaraErrore || !dettaglio.perGara ? (
              <p className="cn-esito avviso">Non sono riuscito a leggere il costo per gara: ricarica la pagina. Il resto della scheda non è interessato.</p>
            ) : dettaglio.perGara.costi.righe.length === 0 ? (
              <p className="cn-vuoto">Nessuna chiamata a modelli registrata per questo cliente.</p>
            ) : (
              <>
                <div className="cn-scorri">
                  <table className="cn-tab">
                    <thead>
                      <tr>
                        <th>Gara</th>
                        <th>Pagata con</th>
                        <th className="num">Operazioni nel periodo</th>
                        <th className="num">Costo nel periodo</th>
                        <th className="num">Costo totale dall&apos;inizio</th>
                        <th>Ultima attività</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dettaglio.perGara.costi.righe.map((g) => (
                        <tr key={g.garaId ?? "senza-gara"}>
                          <td className="cn-cella-doppia">
                            <span>{g.titolo}</span>
                            {g.creataIl && <small>creata il {formattaData(g.creataIl)}</small>}
                          </td>
                          <td>{g.garaId ? <Badge tono={g.consumo === "piano" || g.consumo === null ? "neutro" : "avviso"}>{etichettaConsumo(g.consumo)}</Badge> : "—"}</td>
                          <td className="num">
                            {formattaIntero(g.operazioniPeriodo)}
                            {g.senzaCostoPeriodo > 0 && <small style={{ display: "block", color: "var(--cn-avviso)" }}>{g.senzaCostoPeriodo} senza costo</small>}
                          </td>
                          <td className="num cn-cella-doppia">
                            <span>{euro(g.costoPeriodoUsd)}</span>
                            <small>{formattaUsd(g.costoPeriodoUsd, 2)}</small>
                          </td>
                          <td className="num cn-cella-doppia">
                            <span>{euro(g.costoTotaleUsd)}</span>
                            <small>{formattaUsd(g.costoTotaleUsd, 2)} · {formattaIntero(g.operazioniTotali)} operazioni</small>
                          </td>
                          <td className="mono">{g.ultimaAttivita ? formattaData(g.ultimaAttivita) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td>Totale</td>
                        <td></td>
                        <td className="num">{formattaIntero(dettaglio.perGara.costi.righe.reduce((s, g) => s + g.operazioniPeriodo, 0))}</td>
                        <td className="num">{euro(dettaglio.perGara.costi.totalePeriodoUsd)}</td>
                        <td className="num">{euro(dettaglio.perGara.costi.totaleUsd)}</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <p style={{ marginTop: 10, color: "var(--cn-fioco)", fontSize: 12 }}>
                  «Costo nel periodo» conta solo le chiamate del periodo scelto; «Costo totale» tutte quelle fatte su quella gara dall&apos;inizio. Anche il lavoro dell&apos;Ufficio Gare
                  del cliente è registrato qui, sotto il titolare. Le gare cancellate non hanno più il legame con i costi e finiscono nell&apos;ultima riga.
                </p>
                {!quadraConIlTotale(dettaglio.perGara.costi.totalePeriodoUsd, costoTotaleUsd) && (
                  <p className="cn-esito avviso" role="status" style={{ marginTop: 10 }}>
                    La somma per gara del periodo ({formattaUsd(dettaglio.perGara.costi.totalePeriodoUsd, 4)}) non coincide con il costo dei modelli del periodo ({formattaUsd(costoTotaleUsd, 4)}):
                    differenza da verificare.
                  </p>
                )}
                {dettaglio.perGara.troncato && (
                  <p className="cn-esito avviso" role="status" style={{ marginTop: 10 }}>
                    Il cliente ha moltissime operazioni: ne ho lette solo le prime 20.000, il costo per gara può essere incompleto.
                  </p>
                )}
              </>
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
