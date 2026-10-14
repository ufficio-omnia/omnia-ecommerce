import { PIANI_ORDINE } from "@/lib/omnia-ai-plans";
import { formattaGiorno, testoOfferta, type StatoSconto } from "@/lib/omnia-ai-catalogo-calcoli";
import type { DatiPrezzi } from "@/lib/console/prezzi";
import { impostaScontoAttivo, creaSconto, salvaPrezzoPiano } from "../azioni/prezzi";
import { Badge, Pannello, type Tono } from "./elementi";
import { formattaDataOra, formattaEuro } from "./formati";
import ModuloAzione from "./modulo-azione";
import PulsanteAzione from "./pulsante-azione";

// Pagina «Piani e prezzi»: il prezzo di listino di ogni piano e gli sconti di OMNIA AI. Ciò che si
// scrive qui è ciò che il cliente vede nel sito (/piani), nella pagina di acquisto e nell'area
// riservata, e ciò che paga al checkout. Vale per i NUOVI acquisti: chi è già abbonato resta al suo prezzo.

const euro = (centesimi: number) => formattaEuro(centesimi / 100);

const TONO_STATO: Record<StatoSconto, Tono> = { attivo: "ok", in_programma: "accento", scaduto: "neutro", disattivato: "neutro" };
const ETICHETTA_STATO: Record<StatoSconto, string> = { attivo: "in corso", in_programma: "in programma", scaduto: "scaduto", disattivato: "disattivato" };

function descriviSconto(s: DatiPrezzi["sconti"][number]): string {
  return s.tipo === "percentuale" ? `−${s.percentuale}%` : `${euro(s.prezzoScontatoCentesimi ?? 0)} al mese`;
}

export default function PrezziVista({ dati, oggi }: { dati: DatiPrezzi; oggi: string }) {
  return (
    <>
      <div className="cn-testata">
        <div>
          <h1>Piani e prezzi</h1>
          <p>Prezzo di listino e sconti di OMNIA AI: quello che scrivi qui compare nel sito, nella pagina di acquisto e nell&apos;area riservata dei clienti</p>
        </div>
      </div>

      {!dati.disponibile && (
        <p className="cn-esito avviso" role="alert" style={{ marginBottom: 14 }}>
          Le tabelle dei prezzi non esistono ancora (migrazione 0085): finché non ci sono vale il listino del codice e non si può modificare nulla.
        </p>
      )}
      <p className={`cn-esito ${dati.modalitaStripe === "reale" ? "avviso" : "ok"}`} role="status" style={{ marginBottom: 14 }}>
        {dati.modalitaStripe === "prova"
          ? "Stripe è in modalità di PROVA: i prezzi che crei da qui vanno sull'account di prova, nessun cliente reale ne è toccato."
          : dati.modalitaStripe === "reale"
            ? "Stripe è in modalità REALE: ogni modifica di prezzo crea un prezzo vero sull'account di produzione."
            : "Non riesco a stabilire se la chiave Stripe è di prova o reale."}
      </p>

      <Pannello titolo="Prezzi di listino (IVA inclusa, al mese)">
        <div className="cn-pannello-corpo">
          <div className="cn-scorri">
            <table className="cn-tab">
              <thead>
                <tr>
                  <th>Piano</th>
                  <th className="num">Gare incluse</th>
                  <th className="num">Listino</th>
                  <th className="num">Oggi si paga</th>
                  <th>Su Stripe</th>
                  <th>Nuovo prezzo</th>
                </tr>
              </thead>
              <tbody>
                {dati.piani.map((p) => (
                  <tr key={p.slug}>
                    <td className="cn-cella-doppia">
                      {p.nome}
                      <small>{p.modificato ? `modificato il ${formattaDataOra(p.aggiornatoIl ?? "")} da ${p.aggiornatoDa}` : "prezzo del codice, mai modificato"}</small>
                    </td>
                    <td className="num">{p.gareIncluse}</td>
                    <td className="num">{euro(p.listinoCentesimi)}</td>
                    <td className="num">
                      {p.sconto ? (
                        <>
                          {euro(p.sconto.prezzoCentesimi)} <Badge tono="ok">sconto</Badge>
                        </>
                      ) : (
                        euro(p.listinoCentesimi)
                      )}
                    </td>
                    <td>
                      {p.stripe.stato === "allineato" && <Badge tono="ok">allineato</Badge>}
                      {p.stripe.stato === "disallineato" && (
                        <>
                          <Badge tono="errore">NON allineato</Badge> <small>({euro(p.stripe.importoCentesimi)} su Stripe: gli acquisti sono fermi finché non si risalva il prezzo)</small>
                        </>
                      )}
                      {p.stripe.stato === "assente" && <Badge tono="errore">prezzo Stripe mancante</Badge>}
                      {p.stripe.stato === "errore" && <Badge tono="avviso">non verificabile</Badge>}
                    </td>
                    <td>
                      <ModuloAzione
                        azione={salvaPrezzoPiano}
                        campi={{ piano: p.slug }}
                        etichetta="Salva prezzo"
                        etichettaInCorso="Salvo…"
                        messaggioOk="Prezzo salvato."
                        variante="primario"
                        classe="cn-modulo-linea"
                      >
                        <input className="cn-input" name="prezzo" inputMode="decimal" required placeholder={(p.listinoCentesimi / 100).toFixed(2).replace(".", ",")} aria-label={`Nuovo prezzo mensile del piano ${p.nome}`} style={{ maxWidth: 120 }} autoComplete="off" />
                      </ModuloAzione>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="cn-nota-inline" style={{ marginTop: 10 }}>
            Il nuovo prezzo vale per i <strong>nuovi acquisti</strong>. Chi è già abbonato resta al prezzo che ha: su Stripe si crea un prezzo nuovo e quello vecchio non si tocca. Chi cambia piano paga il listino del piano nuovo. Scrivi l&apos;importo in euro, IVA inclusa (per esempio 699 oppure 749,50).
          </p>
        </div>
      </Pannello>

      <div className="cn-sezione">
        <Pannello titolo={`Sconti (${dati.sconti.length})`}>
          <div className="cn-pannello-corpo">
            {dati.sconti.length === 0 ? (
              <p className="cn-vuoto">Nessuno sconto creato.</p>
            ) : (
              <div className="cn-scorri">
                <table className="cn-tab">
                  <thead>
                    <tr>
                      <th>Sconto</th>
                      <th>Piano</th>
                      <th>Valido</th>
                      <th>Per chi compra</th>
                      <th>Stato</th>
                      <th>Azione</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dati.sconti.map((s) => (
                      <tr key={s.id}>
                        <td className="cn-cella-doppia">
                          {s.nome}
                          <small>{descriviSconto(s)} · creato da {s.creatoDa}</small>
                        </td>
                        <td>{s.piano ? (dati.piani.find((p) => p.slug === s.piano)?.nome ?? s.piano) : "tutti"}</td>
                        <td className="nowrap">
                          dal {formattaGiorno(s.validoDal)}
                          <br />
                          {s.validoAl ? `al ${formattaGiorno(s.validoAl)}` : "senza scadenza"}
                        </td>
                        <td>{s.durataMesi === 0 ? "per sempre" : `${s.durataMesi} ${s.durataMesi === 1 ? "mese" : "mesi"}, poi listino`}</td>
                        <td>
                          <Badge tono={TONO_STATO[s.stato]}>{ETICHETTA_STATO[s.stato]}</Badge>
                        </td>
                        <td>
                          <PulsanteAzione
                            azione={impostaScontoAttivo}
                            campi={{ id: s.id, attivo: s.attivo ? "0" : "1" }}
                            conferma={s.attivo ? `Disattivare lo sconto «${s.nome}»? Da subito non si applica più ai nuovi acquisti; chi l'ha già usato lo mantiene.` : undefined}
                            etichetta={s.attivo ? "Disattiva" : "Riattiva"}
                            etichettaInCorso="…"
                            variante="neutro"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {dati.piani.some((p) => p.sconto) && (
              <div style={{ marginTop: 12 }}>
                <p className="cn-nota-inline" style={{ marginBottom: 4 }}>Cosa vede oggi il cliente:</p>
                <ul className="cn-elenco-regola">
                  {dati.piani.filter((p) => p.sconto).map((p) => (
                    <li key={p.slug}>
                      <strong>{p.nome}</strong> — {p.sconto ? testoOfferta(p.sconto, p.listinoCentesimi) : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Pannello>
      </div>

      <div className="cn-sezione">
        <Pannello titolo="Nuovo sconto">
          <div className="cn-pannello-corpo">
            <ModuloAzione azione={creaSconto} etichetta="Crea sconto" etichettaInCorso="Creo…" messaggioOk="Sconto creato." variante="primario" svuota classe="cn-modulo">
              <div className="cn-modulo-griglia">
                <div>
                  <label className="cn-etichetta" htmlFor="sconto-nome">
                    Nome (lo legge il cliente)
                  </label>
                  <input className="cn-input" id="sconto-nome" name="nome" required maxLength={80} placeholder="es. Offerta di lancio" autoComplete="off" />
                </div>
                <div>
                  <label className="cn-etichetta" htmlFor="sconto-piano">
                    Piano
                  </label>
                  <select className="cn-input" id="sconto-piano" name="piano" defaultValue="">
                    <option value="">Tutti i piani</option>
                    {PIANI_ORDINE.map((slug) => (
                      <option key={slug} value={slug}>
                        {dati.piani.find((p) => p.slug === slug)?.nome ?? slug}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="cn-etichetta" htmlFor="sconto-tipo">
                    Tipo
                  </label>
                  <select className="cn-input" id="sconto-tipo" name="tipo" defaultValue="percentuale">
                    <option value="percentuale">Percentuale</option>
                    <option value="prezzo">Prezzo promozionale (un piano preciso)</option>
                  </select>
                </div>
                <div>
                  <label className="cn-etichetta" htmlFor="sconto-valore">
                    Valore (% oppure € al mese)
                  </label>
                  <input className="cn-input" id="sconto-valore" name="valore" required inputMode="decimal" placeholder="es. 20 oppure 549" autoComplete="off" />
                </div>
              </div>
              <div className="cn-modulo-griglia">
                <div>
                  <label className="cn-etichetta" htmlFor="sconto-dal">
                    Valido dal
                  </label>
                  <input className="cn-input" id="sconto-dal" name="validoDal" type="date" required defaultValue={oggi} />
                </div>
                <div>
                  <label className="cn-etichetta" htmlFor="sconto-al">
                    Valido fino al (vuoto = senza scadenza)
                  </label>
                  <input className="cn-input" id="sconto-al" name="validoAl" type="date" />
                </div>
                <div>
                  <label className="cn-etichetta" htmlFor="sconto-mesi">
                    Mesi di sconto per chi compra (0 = per sempre)
                  </label>
                  <input className="cn-input" id="sconto-mesi" name="durataMesi" type="number" min={0} max={60} step={1} defaultValue={0} />
                </div>
              </div>
            </ModuloAzione>
            <p className="cn-nota-inline" style={{ marginTop: 10 }}>
              Chi compra mentre lo sconto è valido paga il prezzo scontato per il numero di mesi indicato e poi passa al listino; chi aveva comprato prima non è toccato. Con più sconti validi sullo stesso piano vale quello più conveniente, mai la somma. Un prezzo promozionale deve essere inferiore al listino.
            </p>
          </div>
        </Pannello>
      </div>

      {dati.storico.length > 0 && (
        <div className="cn-sezione">
          <Pannello titolo="Storico dei prezzi">
            <div className="cn-scorri">
              <table className="cn-tab">
                <thead>
                  <tr>
                    <th>Quando</th>
                    <th>Piano</th>
                    <th className="num">Da</th>
                    <th className="num">A</th>
                    <th>Operatore</th>
                  </tr>
                </thead>
                <tbody>
                  {dati.storico.map((m, i) => (
                    <tr key={i}>
                      <td>{formattaDataOra(m.il)}</td>
                      <td>{dati.piani.find((p) => p.slug === m.piano)?.nome ?? m.piano}</td>
                      <td className="num">{m.precedenteCentesimi === null ? "—" : euro(m.precedenteCentesimi)}</td>
                      <td className="num">{euro(m.nuovoCentesimi)}</td>
                      <td>{m.operatore}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Pannello>
        </div>
      )}
    </>
  );
}
