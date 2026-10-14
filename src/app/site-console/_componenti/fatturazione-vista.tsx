import Link from "next/link";
import type { FatturazioneLetta } from "@/lib/console/fatturazione";
import {
  GIORNI_TERMINE_INDICATIVO,
  contaPerStato,
  filtroPredefinito,
  testoDaCopiare,
  type FiltroFattura,
  type RigaFatturazione,
  type StatoFattura,
} from "@/lib/console/fatturazione-calcoli";
import type { StatoAzioneFattura } from "../azioni/fatturazione";
import CopiaDati from "./copia-dati";
import { Badge, Pannello, Tessera, type Tono } from "./elementi";
import { formattaData, formattaEuro, formattaIntero } from "./formati";
import InterruttoreProva from "./interruttore-prova";
import ModuloMultiploFattura from "./modulo-multiplo-fattura";
import ModuloStatoFattura from "./modulo-stato-fattura";
import { urlConParametri } from "./selettore-periodo";

// Vista pura della pagina «Da fatturare». Le ricevute di Stripe non sono fatture
// elettroniche italiane: questa pagina è l'elenco di ciò che va emesso a parte,
// con tutto ciò che serve (importi, dati del cliente) e lo stato segnato a mano.

type Azione = (stato: StatoAzioneFattura, dati: FormData) => Promise<StatoAzioneFattura>;

const STATO: Record<StatoFattura, { testo: string; tono: Tono }> = {
  da_fatturare: { testo: "da fatturare", tono: "avviso" },
  fatturata: { testo: "fatturata", tono: "ok" },
  non_dovuta: { testo: "non dovuta", tono: "neutro" },
};

const TAB: { valore: FiltroFattura; etichetta: string }[] = [
  { valore: "da_fatturare", etichetta: "Da fatturare" },
  { valore: "fatturata", etichetta: "Fatturate" },
  { valore: "non_dovuta", etichetta: "Non dovute" },
  { valore: "tutte", etichetta: "Tutte" },
];

export type ParametriEsitoFattura = { esito?: string; n?: string; nuovo?: string; email?: string };

function testoEsito({ esito, n, nuovo }: ParametriEsitoFattura): string | null {
  if (esito !== "aggiornate" || !n) return null;
  const quante = Number(n);
  const come = nuovo === "fatturata" ? "segnate come fatturate" : nuovo === "non_dovuta" ? "segnate come non dovute" : "riportate a da fatturare";
  return `${quante} ${quante === 1 ? "riga" : "righe"} ${come}.`;
}

function CellaDati({ r }: { r: RigaFatturazione }) {
  const d = r.dati;
  return (
    <div className="cn-dati-fatt">
      <strong>{d.ragioneSociale ?? "—"}</strong>
      <span>{[d.partitaIva ? `P.IVA ${d.partitaIva}` : null, d.codiceFiscale ? `C.F. ${d.codiceFiscale}` : null].filter(Boolean).join(" · ") || "senza partita IVA né codice fiscale"}</span>
      {d.indirizzo && <span>{d.indirizzo}</span>}
      <span>{[d.codiceSdi ? `SDI ${d.codiceSdi}` : null, d.pec ? `PEC ${d.pec}` : null].filter(Boolean).join(" · ") || (d.tipoCliente === "consumatore" ? "privato: SDI 0000000" : "senza SDI né PEC")}</span>
      <span className="cn-dati-badge">
        <Badge tono={d.fonte === "nessuna" ? "errore" : d.fonte === "profilo" ? "ok" : "accento"}>
          {d.fonte === "profilo" ? "dal profilo" : d.fonte === "stripe" ? "da Stripe" : d.fonte === "profilo+stripe" ? "profilo + Stripe" : "nessun dato"}
        </Badge>
        {d.mancanti.length > 0 && (
          <span title={`Mancano: ${d.mancanti.join(", ")}`} style={{ marginLeft: 6 }}>
            <Badge tono="errore">mancano {d.mancanti.length}</Badge>
          </span>
        )}
      </span>
    </div>
  );
}

export default function FatturazioneVista({
  dati,
  filtro,
  includiProva,
  esito,
  oggi,
  azioneStato,
  azioneMultipla,
}: {
  dati: FatturazioneLetta;
  filtro: FiltroFattura;
  includiProva: boolean;
  esito: ParametriEsitoFattura;
  // AAAA-MM-GG di oggi a Roma
  oggi: string;
  azioneStato: Azione;
  azioneMultipla: Azione;
}) {
  const testata = (
    <div className="cn-testata">
      <div>
        <h1>Da fatturare</h1>
        <p>Incassi degli abbonamenti OMNIA AI, acquisti di crediti e revisioni umane, con i dati per emettere la fattura</p>
      </div>
    </div>
  );

  if (dati.stato === "errore") {
    return (
      <>
        {testata}
        <p className="cn-esito errore" role="alert">
          {dati.messaggio}
        </p>
      </>
    );
  }

  const conteggi = contaPerStato(dati.righe);
  const mostrate = filtro === "tutte" ? dati.righe : dati.righe.filter((r) => r.stato === filtro);
  const daFatturare = dati.righe.filter((r) => r.stato === "da_fatturare");
  const lordoDaFatturare = daFatturare.reduce((s, r) => s + r.importi.lordo, 0);
  const oltreTermine = daFatturare.filter((r) => r.giorni > GIORNI_TERMINE_INDICATIVO).length;
  const incompleti = daFatturare.filter((r) => r.dati.mancanti.length > 0).length;
  const messaggioEsito = testoEsito(esito);
  // la scheda si porta nell'URL solo se non è quella che si aprirebbe comunque
  const predefinito = filtroPredefinito(includiProva);
  const parametriControlli = { stato: filtro === predefinito ? undefined : filtro };

  return (
    <>
      {testata}

      <p className="cn-esito avviso" role="note" style={{ marginBottom: 14 }}>
        Le ricevute di Stripe non sono fatture elettroniche italiane: ogni riga qui sotto va fatturata a parte, con il tuo programma di fatturazione. Qui segni quando l&apos;hai fatto.
      </p>
      {messaggioEsito && (
        <p className={`cn-esito ${esito.email === "0" ? "errore" : "ok"}`} role="status" style={{ marginBottom: 14 }}>
          {messaggioEsito}
          {esito.email === "1" && " PDF caricato: il cliente è stato avvisato per email."}
          {esito.email === "0" && " PDF caricato, ma l'email al cliente NON è partita (o il pagamento non è collegato a un cliente): avvisalo tu."}
        </p>
      )}
      {!dati.statoDisponibile && (
        <p className="cn-esito avviso" role="status" style={{ marginBottom: 14 }}>
          Lo stato di fatturazione non è ancora disponibile: eseguire la migrazione 0079. Intanto tutte le righe risultano da fatturare e non si può segnare nulla.
        </p>
      )}
      {dati.statoDisponibile && !dati.fileFatturaDisponibile && (
        <p className="cn-esito avviso" role="status" style={{ marginBottom: 14 }}>
          Il caricamento del PDF della fattura non è ancora disponibile: eseguire la migrazione 0081. Intanto lo stato si segna come sempre.
        </p>
      )}
      {!dati.incassiDisponibili && (
        <p className="cn-esito avviso" role="status" style={{ marginBottom: 14 }}>
          Gli incassi degli abbonamenti non sono ancora registrati: eseguire la migrazione 0078. Qui compaiono solo gli acquisti di crediti.
        </p>
      )}
      {dati.provaNascoste > 0 && !includiProva && (
        <p className="cn-esito" role="status" style={{ marginBottom: 14 }}>
          {formattaIntero(dati.provaNascoste)} pagamenti di prova (Stripe di OMNIA AI è in modalità test) non sono in elenco: non vanno mai fatturati. Includi i dati di prova per vederli.
        </p>
      )}
      {includiProva && (
        <p className="cn-esito avviso" role="status" style={{ marginBottom: 14 }}>
          Dati di prova INCLUSI: i pagamenti di prova compaiono come «non dovuta», nelle schede «Non dovute» e «Tutte» (non in «Da fatturare»). Non vanno fatturati.
        </p>
      )}

      <div className="cn-tessere">
        <Tessera
          etichetta="Da fatturare"
          valore={formattaIntero(conteggi.da_fatturare)}
          tono={conteggi.da_fatturare > 0 ? "avviso" : "ok"}
          dettaglio={conteggi.da_fatturare > 0 ? `${formattaEuro(lordoDaFatturare)} lordi, IVA inclusa` : "Niente da fatturare"}
        />
        <Tessera
          etichetta={`Oltre ${GIORNI_TERMINE_INDICATIVO} giorni`}
          valore={formattaIntero(oltreTermine)}
          tono={oltreTermine > 0 ? "errore" : "neutro"}
          dettaglio="Dall'incasso: termine ordinario indicativo, da confermare col commercialista"
        />
        <Tessera
          etichetta="Dati incompleti"
          valore={formattaIntero(incompleti)}
          tono={incompleti > 0 ? "errore" : "neutro"}
          dettaglio={incompleti > 0 ? "Mancano dati del cliente per emettere la fattura" : "Tutti i clienti hanno i dati necessari"}
        />
        <Tessera etichetta="Fatturate" valore={formattaIntero(conteggi.fatturata)} dettaglio="In questo elenco" />
      </div>

      <div className="cn-sezione">
        <div className="cn-periodo" style={{ marginBottom: 12 }}>
          <nav className="cn-filtri" aria-label="Stato di fatturazione">
            {TAB.map((t) => (
              <Link
                key={t.valore}
                href={urlConParametri("/fatturazione", { stato: t.valore === predefinito ? undefined : t.valore, prova: includiProva ? "1" : undefined })}
                className={filtro === t.valore ? "attivo" : undefined}
              >
                {t.etichetta} <span>{conteggi[t.valore]}</span>
              </Link>
            ))}
          </nav>
          <div className="cn-azione">
            <InterruttoreProva percorso="/fatturazione" parametri={parametriControlli} includiProva={includiProva} />
            <a className="cn-btn piccolo" href={urlConParametri("/fatturazione/esporta", { stato: filtro, prova: includiProva ? "1" : undefined })}>
              Esporta CSV
            </a>
          </div>
        </div>

        {dati.statoDisponibile && mostrate.length > 0 && <ModuloMultiploFattura oggi={oggi} filtro={filtro} prova={includiProva} azione={azioneMultipla} />}

        <Pannello titolo={`${TAB.find((t) => t.valore === filtro)?.etichetta ?? "Righe"} (${mostrate.length})`}>
          {mostrate.length === 0 ? (
            <p className="cn-vuoto">{filtro === "da_fatturare" ? "Niente da fatturare." : "Nessuna riga."}</p>
          ) : (
            <div className="cn-scorri">
              <table className="cn-tab">
                <thead>
                  <tr>
                    <th></th>
                    <th>Incassato</th>
                    <th>Cliente e descrizione</th>
                    <th className="num">Imponibile</th>
                    <th className="num">IVA</th>
                    <th className="num">Totale</th>
                    <th>Dati di fatturazione</th>
                    <th>Stato</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {mostrate.map((r) => (
                    <tr key={r.chiave} className={r.stato === "da_fatturare" && r.giorni > GIORNI_TERMINE_INDICATIVO ? "cn-riga-avviso" : undefined}>
                      <td>
                        {dati.statoDisponibile && <input type="checkbox" name="righe" value={r.chiave} form="modulo-multiplo" aria-label={`Seleziona ${r.cliente}`} />}
                      </td>
                      <td className="nowrap">
                        <span className="mono">{formattaData(r.data)}</span>
                        <small style={{ display: "block", color: r.stato === "da_fatturare" && r.giorni > GIORNI_TERMINE_INDICATIVO ? "var(--cn-avviso)" : "var(--cn-fioco)" }}>
                          {r.giorni === 0 ? "oggi" : `${formattaIntero(r.giorni)} gg fa`}
                        </small>
                      </td>
                      <td className="cn-cella-doppia">
                        {r.cliente}
                        <small>
                          {r.descrizione}
                          {r.prova ? " · di prova" : ""}
                        </small>
                      </td>
                      <td className="num">{formattaEuro(r.importi.imponibile)}</td>
                      <td className="num" title={r.importi.ivaDaStripe ? "Calcolata da Stripe" : "Scorporata con l'aliquota dei parametri (Stripe non separa l'IVA)"}>
                        {formattaEuro(r.importi.iva)}
                        {!r.importi.ivaDaStripe && <small style={{ display: "block", color: "var(--cn-fioco)" }}>stimata</small>}
                      </td>
                      <td className="num">
                        <strong>{formattaEuro(r.importi.lordo)}</strong>
                      </td>
                      <td>
                        <CellaDati r={r} />
                        <div style={{ marginTop: 6 }}>
                          <CopiaDati testo={testoDaCopiare(r)} />
                        </div>
                      </td>
                      <td className="cn-cella-doppia">
                        <Badge tono={STATO[r.stato].tono}>{STATO[r.stato].testo}</Badge>
                        {r.stato === "fatturata" && (
                          <small>
                            {r.numeroFattura ? `n. ${r.numeroFattura}` : "senza numero"}
                            {r.dataFattura ? ` · ${formattaData(r.dataFattura)}` : ""}
                          </small>
                        )}
                        {r.stato === "fatturata" && (
                          <small>
                            {r.fatturaFile ? (
                              <>
                                PDF caricato ·{" "}
                                <a href={`/fatturazione/fattura/${r.chiave.replace(":", "/")}`} target="_blank" rel="noreferrer">
                                  apri
                                </a>
                              </>
                            ) : (
                              "nessun PDF caricato"
                            )}
                          </small>
                        )}
                        {r.note && <small>{r.note}</small>}
                        {r.ricevutaUrl && (
                          <small>
                            <a href={r.ricevutaUrl} target="_blank" rel="noreferrer">
                              documento Stripe (non fiscale)
                            </a>
                          </small>
                        )}
                      </td>
                      <td>
                        {dati.statoDisponibile && (
                          <ModuloStatoFattura
                            chiave={r.chiave}
                            statoAttuale={r.stato}
                            numero={r.numeroFattura}
                            data={r.dataFattura}
                            note={r.note}
                            haFile={r.fatturaFile}
                            fileDisponibile={dati.fileFatturaDisponibile}
                            oggi={oggi}
                            filtro={filtro}
                            prova={includiProva}
                            azione={azioneStato}
                          />
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
        <Pannello
          titolo={`Ordini e-commerce pagati senza fattura caricata (${dati.ordiniSenzaFattura.n})`}
          azioni={
            <Link href="/ordini?stato=pagato" className="cn-btn piccolo">
              Apri gli ordini
            </Link>
          }
        >
          {dati.ordiniSenzaFattura.n === 0 ? (
            <p className="cn-vuoto">Tutti gli ordini pagati hanno una fattura.</p>
          ) : (
            <div className="cn-scorri">
              <table className="cn-tab">
                <thead>
                  <tr>
                    <th>Ordinato il</th>
                    <th>Cliente</th>
                    <th>Prodotto</th>
                    <th className="num">Totale</th>
                  </tr>
                </thead>
                <tbody>
                  {dati.ordiniSenzaFattura.ultimi.map((o) => (
                    <tr key={o.id}>
                      <td className="mono">{formattaData(o.creatoIl)}</td>
                      <td className="tronca" title={o.email ?? undefined}>
                        {o.email ?? "—"}
                      </td>
                      <td>{o.prodotto ?? "—"}</td>
                      <td className="num">{formattaEuro(o.lordo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="cn-nota">
            Per gli ordini dell&apos;e-commerce la fattura si carica come PDF dalla pagina Ordini: il cliente la trova nella sua area riservata. Ordini pagati senza fattura: {formattaIntero(dati.ordiniSenzaFattura.n)}, {formattaEuro(dati.ordiniSenzaFattura.lordo)} lordi.
          </p>
        </Pannello>
      </div>

      <div className="cn-sezione">
        <details className="cn-dettagli">
          <summary>Come funziona</summary>
          <ul className="cn-elenco">
            <li>
              <strong>Cosa compare:</strong> ogni pagamento di abbonamento incassato (primo pagamento, rinnovo, conguaglio per cambio piano), ogni acquisto di crediti e ogni revisione umana pagata. I pagamenti di prova nascono già «non dovuti».
            </li>
            <li>
              <strong>Dati del cliente:</strong> dal profilo azienda che ha compilato; i campi che mancano si completano con quelli raccolti da Stripe al pagamento. «Mancano» segnala ciò che serve e non c&apos;è: ragione sociale, partita IVA o codice fiscale, indirizzo, codice SDI o PEC (per un privato basta il codice fiscale).
            </li>
            <li>
              <strong>Importi:</strong> i prezzi sono IVA inclusa. L&apos;IVA è quella calcolata da Stripe quando c&apos;è; altrimenti si scorpora con l&apos;aliquota dei parametri ({dati.parametri.aliquotaIva.toLocaleString("it-IT")} %) e la riga porta «stimata».
            </li>
            <li>
              <strong>Giorni dall&apos;incasso:</strong> la riga si evidenzia oltre {GIORNI_TERMINE_INDICATIVO} giorni, il termine ordinario di emissione della fattura immediata. È solo un promemoria: i termini reali dipendono dal caso (fattura differita, estero, ecc.), confermali col commercialista.
            </li>
            <li>
              <strong>Stato:</strong> «fatturata» richiede la data della fattura (il numero è facoltativo ma consigliato); «non dovuta» richiede una nota. Ogni cambio registra chi lo ha fatto e quando. Il pulsante «Copia dati» prepara il testo da incollare nel programma di fatturazione; «Esporta CSV» scarica l&apos;elenco filtrato (separatore «;», decimali con la virgola).
            </li>
          </ul>
        </details>
      </div>
    </>
  );
}
