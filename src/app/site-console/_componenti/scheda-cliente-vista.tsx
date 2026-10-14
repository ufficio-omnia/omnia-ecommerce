import { Fragment } from "react";
import Link from "next/link";
import { PIANI, PIANI_ORDINE, type PianoSlug } from "@/lib/omnia-ai-plans";
import type { SchedaCliente } from "@/lib/console/utenti";
import { eAnonimizzato, etichettaAccettazione, etichettaDocumento, type AccettazioneScheda, type StatoProva } from "@/lib/console/utenti-calcoli";
import { anonimizzaUtente, eliminaUtente, impostaAbbonamentoManuale, rispondiAlCliente } from "../azioni/utenti";
import { modificaGareGratuite, resetPasswordCliente } from "../azioni/utenti-console";
import { statoPasswordCliente } from "@/lib/console/utenti-console-calcoli";
import type { ProvaCliente } from "@/lib/console/gare-gratuite";
import ModuloAzione from "./modulo-azione";
import { eliminaOrdine, ottieniLinkFattura } from "../azioni/ordini";
import AvvisoEsito, { type ParametriEsito } from "./avviso-esito";
import { Badge, Pannello, Tessera } from "./elementi";
import { formattaData, formattaDataOra, formattaEuro, formattaIntero } from "./formati";
import FormAbbonamentoManuale from "./form-abbonamento-manuale";
import FormRisposta from "./form-risposta";
import PulsanteAzione from "./pulsante-azione";
import PulsanteApriLink from "./pulsante-apri-link";

// Vista pura della scheda di un cliente: anagrafica, ordini e abbonamenti con le
// accettazioni legali registrate (data e ora al secondo, versione e impronta del
// documento, IP), crediti, incassi, messaggi e le azioni sull'account.

type SchedaOk = Extract<SchedaCliente, { stato: "ok" }>;
// riassunto del registro degli accessi ai dati del cliente; null se il registro non è disponibile
type AccessiCliente = { quanti: number; generali: number; ultimo: string | null } | null;

const STATO_ORDINE: Record<string, { etichetta: string; tono: "ok" | "avviso" | "neutro" | "errore" }> = {
  pagato: { etichetta: "pagato", tono: "ok" },
  in_attesa: { etichetta: "in attesa", tono: "avviso" },
};

const ETICHETTA_METODO: Record<string, string> = { bonifico: "Bonifico", carta: "Carta" };
const ETICHETTA_TIPO_INCASSO: Record<string, string> = { primo: "Primo pagamento", rinnovo: "Rinnovo", conguaglio: "Conguaglio" };
const ETICHETTA_STATO_FATTURA: Record<string, string> = { da_fatturare: "da fatturare", fatturata: "fatturata", non_dovuta: "non dovuta" };

function nomePiano(slug: string): string {
  return PIANI[slug as PianoSlug]?.nome ?? slug;
}

function breve(sha: string): string {
  return sha.length > 10 ? `${sha.slice(0, 10)}…` : sha;
}

// Prova di accettazione di un ordine o di un abbonamento: la tabella delle
// accettazioni registrate, oppure l'avviso che non ce ne sono.
function ProvaAccettazioni({ stato, accettazioni, oggetto }: { stato: StatoProva; accettazioni: AccettazioneScheda[]; oggetto: "ordine" | "abbonamento" }) {
  if (stato === "non_prevista") {
    return (
      <p className="cn-prova non-prevista">
        <Badge>nessuna accettazione prevista</Badge> Abbonamento creato a mano: non è passato da un checkout, quindi non c&apos;è nulla che il cliente abbia accettato online.
      </p>
    );
  }
  if (stato === "mancante") {
    return (
      <p className="cn-prova mancante">
        <Badge tono="errore">non registrata</Badge>{" "}
        {oggetto === "ordine"
          ? "Nessuna accettazione contrattuale registrata per questo ordine: precede la registrazione delle prove oppure è stato creato a mano."
          : "Nessuna accettazione registrata per questo abbonamento: precede la registrazione delle prove (migrazione 0057) oppure il checkout non l'ha salvata."}
      </p>
    );
  }
  return (
    <div className="cn-scorri cn-prova registrata">
      <table className="cn-tab cn-tab-annidata">
        <thead>
          <tr>
            <th>Accettato</th>
            <th>Documento e versione</th>
            <th>Data e ora (Roma)</th>
            <th>IP</th>
            <th>Browser</th>
            <th>Impronta (SHA-256)</th>
          </tr>
        </thead>
        <tbody>
          {accettazioni.map((a, i) => (
            <tr key={`${a.tipo}-${a.quando}-${i}`}>
              <td>{etichettaAccettazione(a.tipo)}</td>
              <td title={a.documento ? `In vigore dal ${formattaData(a.documento.inVigoreDal)}` : undefined}>
                {a.documento ? `${etichettaDocumento(a.documento.tipo)} · v${a.documento.versione}` : <Badge tono="avviso">documento non trovato</Badge>}
              </td>
              <td className="mono">{formattaDataOra(a.quando)}</td>
              <td className="mono">{a.ip ?? "—"}</td>
              <td className="tronca" title={a.userAgent ?? undefined}>
                {a.userAgent ?? "—"}
              </td>
              <td className="mono" title={a.documento?.sha256}>
                {a.documento ? breve(a.documento.sha256) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BadgeProva({ stato }: { stato: StatoProva }) {
  if (stato === "registrata") return <Badge tono="ok">accettazioni registrate</Badge>;
  if (stato === "mancante") return <Badge tono="errore">non registrata</Badge>;
  return <Badge>non prevista</Badge>;
}

export default function SchedaClienteVista({
  scheda,
  idSessione,
  esito,
  accessi,
  prova,
}: {
  scheda: SchedaCliente;
  // id dell'admin che sta guardando: non può eliminare né anonimizzare sé stesso
  idSessione: string;
  esito: ParametriEsito;
  accessi: AccessiCliente;
  // account creato dalla console e gare gratuite (migrazione 0084)
  prova: ProvaCliente;
}) {
  const indietro = (
    <Link href="/utenti" className="cn-indietro">
      ← Utenti
    </Link>
  );

  if (scheda.stato === "non_trovato") {
    return (
      <>
        {indietro}
        <div className="cn-testata">
          <div>
            <h1>Utente non trovato</h1>
            <p>Non esiste un utente con questo identificativo: potrebbe essere stato eliminato.</p>
          </div>
        </div>
      </>
    );
  }
  if (scheda.stato === "errore") {
    return (
      <>
        {indietro}
        <p className="cn-esito errore" role="alert">
          {scheda.messaggio}
        </p>
      </>
    );
  }

  return <SchedaOkVista s={scheda} idSessione={idSessione} esito={esito} indietro={indietro} accessi={accessi} prova={prova} />;
}

function SchedaOkVista({ s, idSessione, esito, indietro, accessi, prova }: { s: SchedaOk; idSessione: string; esito: ParametriEsito; indietro: React.ReactNode; accessi: AccessiCliente; prova: ProvaCliente }) {
  const anonimizzato = eAnonimizzato(s.utente.email);
  const ultimoAbb = s.abbonamenti[0] ?? null;
  const ordiniPagati = s.ordini.filter((o) => o.stato === "pagato");
  const pagatoLordo = ordiniPagati.reduce((somma, o) => somma + o.importo, 0);
  const mancanti = s.ordini.filter((o) => o.provaAccettazione === "mancante").length + s.abbonamenti.filter((a) => a.provaAccettazione === "mancante").length;
  const registrate = s.ordini.filter((o) => o.provaAccettazione === "registrata").length + s.abbonamenti.filter((a) => a.provaAccettazione === "registrata").length;
  const ultimoMessaggio = s.messaggi.length > 0 ? s.messaggi[s.messaggi.length - 1] : null;
  const daRispondere = ultimoMessaggio?.mittente === "cliente";
  const sonoIo = s.utente.id === idSessione;
  const elencoPiani = PIANI_ORDINE.map((slug) => ({ slug, nome: PIANI[slug].nome }));

  return (
    <>
      {indietro}

      <div className="cn-testata">
        <div>
          <h1>{s.utente.email}</h1>
          <p>
            Registrato il {formattaData(s.utente.registratoIl)}
            {" · "}
            {s.accesso.ultimoAccesso ? `ultimo accesso ${formattaDataOra(s.accesso.ultimoAccesso)}` : "non ha mai effettuato l'accesso"}
            {" · "}
            <span className="cn-mono-id" title="Identificativo dell'utente">
              {s.utente.id}
            </span>
          </p>
        </div>
        <div className="cn-testata-badge">
          {s.utente.ruolo === "admin" && <Badge tono="accento">amministratore</Badge>}
          {anonimizzato && <Badge>anonimizzato</Badge>}
          {s.accesso.bannato && !anonimizzato && <Badge tono="errore">accesso bloccato</Badge>}
          {!s.accesso.emailConfermataIl && !anonimizzato && <Badge tono="avviso">email non confermata</Badge>}
        </div>
      </div>

      <AvvisoEsito {...esito} />

      <div className="cn-tessere">
        <Tessera
          etichetta="Ordini"
          valore={formattaIntero(s.ordini.length)}
          dettaglio={s.ordini.length === 0 ? "Nessun ordine" : `${ordiniPagati.length} ${ordiniPagati.length === 1 ? "pagato" : "pagati"}, ${formattaEuro(pagatoLordo)} IVA inclusa`}
        />
        <Tessera
          etichetta="Abbonamento AI"
          valore={ultimoAbb ? nomePiano(ultimoAbb.piano) : "—"}
          dettaglio={
            ultimoAbb
              ? `${ultimoAbb.stato === "sola_lettura" ? "sola lettura" : ultimoAbb.stato}${ultimoAbb.finePeriodo ? ` · fino al ${formattaData(ultimoAbb.finePeriodo)}` : ""}`
              : "Nessun abbonamento"
          }
          tono={ultimoAbb?.stato === "sola_lettura" ? "avviso" : "neutro"}
        />
        <Tessera etichetta="Crediti" valore={formattaIntero(s.saldoCrediti)} unita="gare" dettaglio={`${s.acquistiCrediti.length} acquisti`} />
        <Tessera
          etichetta="Accettazioni legali"
          valore={mancanti > 0 ? `${mancanti} mancano` : registrate > 0 ? "Registrate" : "—"}
          tono={mancanti > 0 ? "errore" : registrate > 0 ? "ok" : "neutro"}
          dettaglio={
            registrate > 0 || mancanti > 0
              ? `${registrate} con prova su ${registrate + mancanti}`
              : s.abbonamenti.length > 0
                ? "Abbonamento a mano: nessuna prevista"
                : "Nessun ordine né abbonamento"
          }
        />
        <Tessera etichetta="Messaggi" valore={formattaIntero(s.messaggi.length)} tono={daRispondere ? "avviso" : "neutro"} dettaglio={daRispondere ? "L'ultimo è del cliente: da rispondere" : s.messaggi.length > 0 ? "Risposto" : "Nessuna conversazione"} />
      </div>

      <div className="cn-colonne cn-colonne-pari">
        <Pannello titolo="Dati di fatturazione">
          {s.azienda ? (
            <dl className="cn-dl">
              <div>
                <dt>Tipo</dt>
                <dd>{s.azienda.buyer_type === "consumatore" ? "Consumatore" : s.azienda.buyer_type === "azienda" ? "Azienda / professionista" : "—"}</dd>
              </div>
              <div>
                <dt>Ragione sociale</dt>
                <dd>{s.azienda.ragione_sociale ?? "—"}</dd>
              </div>
              <div>
                <dt>Partita IVA</dt>
                <dd className="mono">{s.azienda.partita_iva ?? "—"}</dd>
              </div>
              <div>
                <dt>Codice fiscale</dt>
                <dd className="mono">{s.azienda.codice_fiscale ?? "—"}</dd>
              </div>
              <div>
                <dt>Indirizzo</dt>
                <dd>{s.azienda.indirizzo ?? "—"}</dd>
              </div>
              <div>
                <dt>Codice SDI</dt>
                <dd className="mono">{s.azienda.codice_sdi ?? "—"}</dd>
              </div>
              <div>
                <dt>PEC</dt>
                <dd>{s.azienda.pec ?? "—"}</dd>
              </div>
            </dl>
          ) : (
            <p className="cn-vuoto">{anonimizzato ? "Dati di fatturazione rimossi con l'anonimizzazione." : "Nessun dato di fatturazione inserito."}</p>
          )}
          <p className="cn-nota">Sola lettura: li modifica il cliente dalla sua area riservata.</p>
        </Pannello>

        <Pannello
          titolo="Costo e crediti"
          azioni={
            <Link href={`/costi/${s.utente.id}`} className="cn-btn piccolo">
              Costi del cliente →
            </Link>
          }
        >
          <dl className="cn-dl">
            <div>
              <dt>Saldo crediti</dt>
              <dd className="mono">{formattaIntero(s.saldoCrediti)}</dd>
            </div>
            <div>
              <dt>Crediti acquistati</dt>
              <dd className="mono">{formattaIntero(s.acquistiCrediti.reduce((somma, c) => somma + c.crediti, 0))}</dd>
            </div>
            <div>
              <dt>Pagato per i crediti</dt>
              <dd className="mono">{formattaEuro(s.acquistiCrediti.filter((c) => !c.prova).reduce((somma, c) => somma + c.lordo, 0))}</dd>
            </div>
            <div>
              <dt>Incassi abbonamento</dt>
              <dd className="mono">{s.incassiDisponibili ? formattaEuro(s.incassi.filter((i) => !i.prova).reduce((somma, i) => somma + i.lordo, 0)) : "—"}</dd>
            </div>
          </dl>
          <p className="cn-nota">Importi reali, IVA inclusa; le righe di prova sono escluse. Costo dei modelli e margine sono nella pagina dei costi del cliente.</p>
        </Pannello>
      </div>

      {/* ───── Abbonamenti OMNIA AI ───── */}
      <div className="cn-sezione">
        <Pannello titolo={`Abbonamenti OMNIA AI (${s.abbonamenti.length})`}>
          {s.abbonamenti.length === 0 ? (
            <p className="cn-vuoto">Nessun abbonamento.</p>
          ) : (
            <div className="cn-scorri">
              <table className="cn-tab">
                <thead>
                  <tr>
                    <th>Piano</th>
                    <th>Stato</th>
                    <th>Creato il</th>
                    <th>Periodo fino al</th>
                    <th>Origine</th>
                    <th>Accettazioni</th>
                  </tr>
                </thead>
                <tbody>
                  {s.abbonamenti.map((a) => (
                    <Fragment key={a.id}>
                      <tr>
                        <td>
                          <Badge tono="accento">{nomePiano(a.piano)}</Badge>
                        </td>
                        <td className="nowrap">
                          <Badge tono={a.stato === "attivo" ? "ok" : a.stato === "sola_lettura" ? "avviso" : "errore"}>{a.stato === "sola_lettura" ? "sola lettura" : a.stato}</Badge>
                          {a.inDisdetta && (
                            <>
                              {" "}
                              <Badge tono="avviso">in disdetta</Badge>
                            </>
                          )}
                        </td>
                        <td className="mono">{formattaData(a.creatoIl)}</td>
                        <td className="mono">{a.finePeriodo ? formattaData(a.finePeriodo) : "—"}</td>
                        <td className="nowrap">
                          {a.manuale ? <Badge>a mano</Badge> : <Badge tono="accento">Stripe</Badge>}
                          {a.prova && (
                            <>
                              {" "}
                              <Badge tono="avviso">prova</Badge>
                            </>
                          )}
                        </td>
                        <td>
                          <BadgeProva stato={a.provaAccettazione} />
                        </td>
                      </tr>
                      <tr className="cn-riga-prova">
                        <td colSpan={6}>
                          <ProvaAccettazioni stato={a.provaAccettazione} accettazioni={a.accettazioni} oggetto="abbonamento" />
                        </td>
                      </tr>
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Pannello>
      </div>

      <div className="cn-sezione">
        <Pannello titolo="Abbonamento a mano">
          {s.abbonamentoGestitoDaStripe ? (
            <p className="cn-nota" style={{ padding: 14 }}>
              L&apos;abbonamento di questo cliente è gestito da Stripe (paga con carta): stato e scadenza si cambiano da Stripe, non da qui, altrimenti il database divergerebbe da ciò che Stripe addebita davvero.
            </p>
          ) : anonimizzato ? (
            <p className="cn-nota" style={{ padding: 14 }}>
              Account anonimizzato: non si assegnano abbonamenti.
            </p>
          ) : (
            <div className="cn-pannello-corpo">
              <FormAbbonamentoManuale
                userId={s.utente.id}
                piani={elencoPiani}
                attuale={ultimoAbb ? { piano: ultimoAbb.piano, stato: ultimoAbb.statoDb, scadenza: ultimoAbb.finePeriodo ? ultimoAbb.finePeriodo.slice(0, 10) : null } : null}
                azione={impostaAbbonamentoManuale}
              />
              <p className="cn-nota-inline" style={{ marginTop: 10 }}>
                Per accordi commerciali o prove concesse: non passa da Stripe, non genera incassi né accettazioni. L&apos;accesso vale fino alla fine del giorno indicato; senza data non scade.
              </p>
            </div>
          )}
        </Pannello>
      </div>

      {/* ───── Ordini ───── */}
      <div className="cn-sezione">
        <Pannello titolo={`Ordini (${s.ordini.length})`}>
          {s.ordini.length === 0 ? (
            <p className="cn-vuoto">Nessun ordine.</p>
          ) : (
            <div className="cn-scorri">
              <table className="cn-tab">
                <thead>
                  <tr>
                    <th>Ordine</th>
                    <th>Prodotto</th>
                    <th>Stato</th>
                    <th className="num">Importo IVA incl.</th>
                    <th>Data</th>
                    <th>Fattura</th>
                    <th>Accettazioni</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {s.ordini.map((o) => {
                    const stato = STATO_ORDINE[o.stato] ?? { etichetta: o.stato, tono: "neutro" as const };
                    return (
                      <Fragment key={o.id}>
                        <tr className={o.provaAccettazione === "mancante" ? "cn-riga-errore" : undefined}>
                          <td className="mono" title={o.id}>
                            {o.id.slice(0, 8)}
                          </td>
                          <td>{o.prodotto ?? "—"}</td>
                          <td className="cn-cella-doppia">
                            <Badge tono={stato.tono}>{stato.etichetta}</Badge>
                            <small>{o.metodo ? (ETICHETTA_METODO[o.metodo] ?? o.metodo) : "metodo non indicato"}</small>
                          </td>
                          <td className="num">{formattaEuro(o.importo)}</td>
                          <td className="mono" title={o.pagatoIl ? `Pagato il ${formattaDataOra(o.pagatoIl)}` : undefined}>
                            {formattaData(o.creatoIl)}
                          </td>
                          <td>{o.fatturaCaricata ? <PulsanteApriLink azione={ottieniLinkFattura} campi={{ orderId: o.id }} /> : "—"}</td>
                          <td>
                            <BadgeProva stato={o.provaAccettazione} />
                          </td>
                          <td>
                            <PulsanteAzione
                              azione={eliminaOrdine}
                              campi={{ orderId: o.id, ritorno: `/utenti/${s.utente.id}` }}
                              conferma="Eliminare definitivamente questo ordine? L'operazione non è reversibile."
                              etichetta="Elimina"
                              etichettaInCorso="Elimino…"
                              variante="pericolo"
                            />
                          </td>
                        </tr>
                        <tr className="cn-riga-prova">
                          <td colSpan={8}>
                            <ProvaAccettazioni stato={o.provaAccettazione} accettazioni={o.accettazioni} oggetto="ordine" />
                          </td>
                        </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="cn-nota">
            Un ordine con accettazioni contrattuali registrate non si può eliminare: la prova non deve sparire con l&apos;ordine. Gli acquisti di crediti non hanno un legame con le accettazioni.
          </p>
        </Pannello>
      </div>

      {/* ───── Incassi e crediti ───── */}
      <div className="cn-colonne cn-colonne-pari">
        <Pannello titolo={`Incassi abbonamento (${s.incassi.length})`}>
          {!s.incassiDisponibili ? (
            <p className="cn-vuoto">Registro degli incassi non ancora disponibile (migrazione 0078).</p>
          ) : s.incassi.length === 0 ? (
            <p className="cn-vuoto">Nessun incasso registrato.</p>
          ) : (
            <div className="cn-scorri">
              <table className="cn-tab">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Tipo</th>
                    <th className="num">Importo lordo</th>
                    <th>Fattura</th>
                  </tr>
                </thead>
                <tbody>
                  {s.incassi.map((i) => (
                    <tr key={i.id}>
                      <td className="mono">{formattaData(i.data)}</td>
                      <td>
                        {ETICHETTA_TIPO_INCASSO[i.tipo] ?? i.tipo}
                        {i.prova && (
                          <>
                            {" "}
                            <Badge tono="avviso">prova</Badge>
                          </>
                        )}
                      </td>
                      <td className="num">{formattaEuro(i.lordo)}</td>
                      <td>{i.statoFattura ? `${ETICHETTA_STATO_FATTURA[i.statoFattura] ?? i.statoFattura}${i.numeroFattura ? ` · ${i.numeroFattura}` : ""}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Pannello>

        <Pannello titolo={`Acquisti di crediti (${s.acquistiCrediti.length})`}>
          {s.acquistiCrediti.length === 0 ? (
            <p className="cn-vuoto">Nessun acquisto di crediti.</p>
          ) : (
            <div className="cn-scorri">
              <table className="cn-tab">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Pacchetto</th>
                    <th className="num">Crediti</th>
                    <th className="num">Importo lordo</th>
                  </tr>
                </thead>
                <tbody>
                  {s.acquistiCrediti.map((c) => (
                    <tr key={c.id}>
                      <td className="mono">{formattaData(c.data)}</td>
                      <td>
                        {c.pacchetto}
                        {c.prova && (
                          <>
                            {" "}
                            <Badge tono="avviso">prova</Badge>
                          </>
                        )}
                      </td>
                      <td className="num">{formattaIntero(c.crediti)}</td>
                      <td className="num">{formattaEuro(c.lordo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Pannello>
      </div>

      {/* ───── Prova gratuita e account creato dalla console ───── */}
      <div className="cn-sezione">
        <Pannello titolo="Prova gratuita">
          <div className="cn-pannello-corpo">
            {!prova.disponibile ? (
              <p className="cn-nota-inline">Le gare gratuite non sono disponibili (migrazione 0084 non ancora eseguita).</p>
            ) : (
              <>
                {prova.creatoDaConsole && (
                  <p className="cn-nota-inline" style={{ marginTop: 0 }}>
                    Account creato dalla console il {formattaData(prova.creatoDaConsole.creatoIl)} da {prova.creatoDaConsole.creatoDa}.
                  </p>
                )}
                {prova.gare ? (
                  <p className="cn-nota-inline" style={{ marginTop: prova.creatoDaConsole ? 6 : 0 }}>
                    Gare gratuite: <strong>{prova.gare.assegnate}</strong> assegnate, <strong>{prova.gare.usate}</strong> usate, <strong>{prova.gare.rimanenti}</strong> rimaste.
                  </p>
                ) : (
                  <p className="cn-nota-inline" style={{ marginTop: prova.creatoDaConsole ? 6 : 0 }}>
                    Nessuna gara gratuita assegnata.
                  </p>
                )}
                {prova.haAvutoAbbonamento ? (
                  <p className="cn-nota-inline">Ha avuto un abbonamento: le gare gratuite servono solo alla prova, prima del primo abbonamento, e non si modificano più.</p>
                ) : s.utente.ruolo === "admin" ? (
                  <p className="cn-nota-inline">È un amministratore: non ha gare gratuite.</p>
                ) : (
                  <ModuloAzione azione={modificaGareGratuite} campi={{ userId: s.utente.id }} etichetta="Applica" etichettaInCorso="Applico…" messaggioOk="Gare gratuite aggiornate." variante="primario" svuota classe="cn-modulo-linea">
                    <div>
                      <label className="cn-etichetta" htmlFor="delta">
                        Gare (+ assegna, − toglie)
                      </label>
                      <input className="cn-input" id="delta" name="delta" type="number" step={1} required placeholder="es. 2 oppure -1" style={{ maxWidth: 150 }} />
                    </div>
                    <div>
                      <label className="cn-etichetta" htmlFor="motivo-gare">
                        Motivo (facoltativo)
                      </label>
                      <input className="cn-input" id="motivo-gare" name="motivo" maxLength={300} placeholder="es. richiesta del cliente" />
                    </div>
                  </ModuloAzione>
                )}
                {prova.movimenti.length > 0 && (
                  <div className="cn-scorri" style={{ marginTop: 12 }}>
                    <table className="cn-tab">
                      <thead>
                        <tr>
                          <th>Quando</th>
                          <th className="num">Gare</th>
                          <th>Operatore</th>
                          <th>Motivo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {prova.movimenti.map((m, i) => (
                          <tr key={i}>
                            <td>{formattaDataOra(m.creatoIl)}</td>
                            <td className="num">{m.delta > 0 ? `+${m.delta}` : m.delta}</td>
                            <td>{m.operatore}</td>
                            <td>{m.motivo ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        </Pannello>
      </div>

      {/* ───── Password del cliente creato dalla console ───── */}
      {prova.creatoDaConsole && s.utente.ruolo !== "admin" && (
        <div className="cn-sezione">
          <Pannello titolo="Password">
            <div className="cn-pannello-corpo">
              {(() => {
                const statoPassword = statoPasswordCliente(prova.creatoDaConsole);
                if (statoPassword === "consegnata") {
                  return (
                    <p className="cn-nota-inline" style={{ marginTop: 0 }}>
                      Il cliente ha scelto la sua password il {formattaDataOra(prova.creatoDaConsole.passwordConsegnataIl ?? "")}. <strong>Da qui la console non può più modificarla né azzerarla</strong>: se la dimentica usa «Password dimenticata» nella pagina di accesso.
                    </p>
                  );
                }
                return (
                  <>
                    <p className="cn-nota-inline" style={{ marginTop: 0 }}>
                      {statoPassword === "iniziale"
                        ? "Il cliente usa ancora la password iniziale che hai scelto tu."
                        : `Hai azzerato la password iniziale il ${formattaDataOra(prova.creatoDaConsole.resetRichiestoIl ?? "")}: il cliente non ha ancora scelto la sua, la vecchia non funziona più.`}
                    </p>
                    <PulsanteAzione
                      azione={resetPasswordCliente}
                      campi={{ userId: s.utente.id }}
                      conferma={`${statoPassword === "iniziale" ? "Azzerare la password iniziale" : "Rinviare l'email e azzerare di nuovo la password"} di ${s.utente.email}? La password che hai scelto smette di funzionare e al cliente arriva un'email per sceglierne una sua. Dopo che l'avrà scelta, da qui non potrai più modificarla.`}
                      etichetta={statoPassword === "iniziale" ? "Reset password" : "Rinvia l'email di reset"}
                      etichettaInCorso="Invio…"
                      variante="neutro"
                    />
                    <p className="cn-nota-inline">
                      Il cliente riceve un link per scegliere la password; una volta scelta, nessuno di Omnia può vederla né modificarla.
                    </p>
                  </>
                );
              })()}
            </div>
          </Pannello>
        </div>
      )}

      {/* ───── Accessi ai suoi dati (registro promesso dal contratto) ───── */}
      <div className="cn-sezione">
        <Pannello titolo="Accessi del personale ai suoi dati">
          <div className="cn-pannello-corpo">
            {accessi === null ? (
              <p className="cn-nota-inline">Il registro non è disponibile (migrazione 0082 non ancora eseguita).</p>
            ) : (
              <p className="cn-nota-inline" style={{ marginTop: 0 }}>
                {accessi.quanti === 0
                  ? "Nessun accesso registrato: nessuno ha guardato i dati di questo cliente."
                  : `${accessi.quanti} ${accessi.quanti === 1 ? "accesso registrato" : "accessi registrati"}${accessi.generali > 0 ? ` (${accessi.generali} generali al database)` : ""}, l'ultimo il ${formattaDataOra(accessi.ultimo ?? "")}.`}
              </p>
            )}
            <p className="cn-nota-inline">
              <Link href={`/accessi-dati/estratto/${s.utente.id}`}>Estratto per il cliente</Link> ·{" "}
              <Link href={`/accessi-dati?cliente=${encodeURIComponent(s.utente.email)}`}>Registra un accesso a questo cliente</Link>
            </p>
          </div>
        </Pannello>
      </div>

      {/* ───── Messaggi ───── */}
      <div className="cn-sezione">
        <Pannello titolo={`Messaggi (${s.messaggi.length})`}>
          <div className="cn-pannello-corpo">
            {s.messaggi.length === 0 ? (
              <p className="cn-vuoto">Nessun messaggio.</p>
            ) : (
              <div className="cn-conversazione">
                {s.messaggi.map((m) => (
                  <div key={m.id} className={`cn-messaggio ${m.mittente === "admin" ? "admin" : "cliente"}`}>
                    <div className="cn-messaggio-testo">{m.testo}</div>
                    <div className="cn-messaggio-meta">
                      {m.mittente === "admin" ? "OMNIA" : "Cliente"} · {formattaDataOra(m.creatoIl)}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <FormRisposta userId={s.utente.id} azione={rispondiAlCliente} disabilitato={anonimizzato} />
          </div>
        </Pannello>
      </div>

      {/* ───── Zona delicata ───── */}
      <div className="cn-sezione">
        <section className="cn-pannello cn-zona-pericolo">
          <div className="cn-pannello-testa">
            <h2>Eliminazione e anonimizzazione</h2>
          </div>
          <div className="cn-pannello-corpo">
            {sonoIo ? (
              <p className="cn-nota-inline">Questo è il tuo account: non puoi eliminarlo né anonimizzarlo da qui.</p>
            ) : s.utente.ruolo === "admin" ? (
              <p className="cn-nota-inline">È un altro amministratore: non si elimina né si anonimizza da qui.</p>
            ) : (
              <div className="cn-zona-azioni">
                <div>
                  <PulsanteAzione
                    azione={anonimizzaUtente}
                    campi={{ userId: s.utente.id }}
                    conferma={`Anonimizzare l'account di ${s.utente.email}? Email e dati di fatturazione vengono sostituiti con valori anonimi e l'accesso viene revocato; ordini, fatture e accettazioni contrattuali restano conservati. L'operazione non è reversibile.`}
                    etichetta={anonimizzato ? "Già anonimizzato" : "Anonimizza cliente"}
                    etichettaInCorso="Anonimizzo…"
                    variante="neutro"
                  />
                  <p className="cn-nota-inline">Per chi ha dati contabili da conservare: l&apos;account diventa irriconoscibile, la contabilità resta.</p>
                </div>
                <div>
                  <PulsanteAzione
                    azione={eliminaUtente}
                    campi={{ userId: s.utente.id }}
                    conferma={`Eliminare definitivamente l'account di ${s.utente.email}? Vengono cancellati anche i suoi ordini e le fatture. Si rifiuta da solo se ci sono ordini pagati, incassi o accettazioni contrattuali: in quel caso usa «Anonimizza». L'operazione non è reversibile.`}
                    etichetta="Elimina utente"
                    etichettaInCorso="Elimino…"
                    variante="pericolo"
                  />
                  <p className="cn-nota-inline">Solo per account senza storia contabile (registrazioni di prova, doppi account).</p>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
