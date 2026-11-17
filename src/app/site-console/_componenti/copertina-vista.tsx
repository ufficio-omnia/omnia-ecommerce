import Link from "next/link";
import type { DatiCopertinaConsole } from "@/lib/console/copertina";
import type { ClienteConcessione, RicercaCliente } from "@/lib/console/piano-lavoro";
import { ETICHETTA_STATO_OFFERTA, revocabile } from "@/lib/console/offerte-calcoli";
import { formattaGiorno } from "@/lib/omnia-ai-catalogo-calcoli";
import { APPROVAZIONE_LEGALE_PACCHETTI, LIMITI_CATALOGO, LIMITI_OFFERTA, NOTA_CONSOLE_CONDIZIONI_PACCHETTI, convenienzaPacchetto, testoUnita } from "@/lib/pacchetti-servizi-calcoli";
import { ETICHETTA_POLITICA_PROVA, POLITICHE_PROVA, descriviConcessione } from "@/lib/piano-lavoro-offerta-calcoli";
import { NOTA_CONSOLE_CONDIZIONI_COPERTINA } from "@/lib/copertina-acquisto-calcoli";
import { descriviImpostazioniCopertina } from "@/lib/copertina-diritto-calcoli";
import {
  creaConcessioneCopertina,
  impostaPoliticaProvaCopertina,
  impostaVenditaCopertina,
  revocaConcessioneCopertina,
  salvaCatalogoPacchettiCopertina,
  salvaPrezzoSingoloCopertina,
} from "../azioni/copertina";
import { creaOffertaDedicataCliente, revocaOffertaDedicataCliente } from "../azioni/pacchetti";
import { Badge, Pannello } from "./elementi";
import { formattaDataOra, formattaEuro } from "./formati";
import ModuloAzione from "./modulo-azione";

// Pagina «Copertina» (menu Sistema, richiesta dell'utente del 17/11/2026): la copertina della relazione tecnica si gestisce come il piano di lavoro. La vendita
// a tutti (un interruttore suo, per la singola gara e per i pacchetti), il prezzo per gara (50 € di partenza), la regola per chi è in prova, i pacchetti
// prepagati (5 gare a 175 € di partenza), le offerte dedicate a un cliente, le concessioni gratuite e, in sola lettura, i clienti con condizioni particolari
// (si cambiano dalla scheda cliente). Ciò che si scrive qui vale per i NUOVI acquisti: chi ha già pagato mantiene il suo diritto, le sue unità e il suo prezzo.

const euro = (centesimi: number) => formattaEuro(centesimi / 100);
const euroCampo = (centesimi: number) => (centesimi / 100).toFixed(2).replace(".", ",");

export default function CopertinaVista({ dati, emailCercata, ricerca }: { dati: DatiCopertinaConsole; emailCercata: string; ricerca: RicercaCliente | null }) {
  const modalita = dati.modalitaStripe;
  const visibile = dati.interruttore && modalita === "reale" && dati.acquistiDisponibili;
  const senza0130 = dati.migrazione0130 !== "si";

  return (
    <>
      <div className="cn-testata">
        <div>
          <h1>Copertina relazione tecnica</h1>
          <p>Vendita, prezzo per gara, pacchetti prepagati, offerte dedicate e concessioni gratuite della copertina A4 della relazione tecnica</p>
        </div>
      </div>

      {senza0130 && (
        <p className="cn-esito avviso" role="alert" style={{ marginBottom: 14 }}>
          {dati.migrazione0130 === "no"
            ? "Manca la migrazione 0130 (pacchetti e concessioni della copertina): finché non è eseguita i pacchetti della copertina non si vendono e non si possono creare concessioni né offerte dedicate. L'acquisto della singola gara funziona."
            : "Non riesco a controllare la migrazione 0130: ricarica la pagina."}
        </p>
      )}
      {!dati.acquistiDisponibili && (
        <p className="cn-esito avviso" role="alert" style={{ marginBottom: 14 }}>
          Manca la migrazione 0107 (acquisti della copertina): finché non è eseguita nessuno può comprare e la vendita non si può accendere.
        </p>
      )}
      {!dati.chiaveOpenAI && (
        <p className="cn-esito avviso" role="alert" style={{ marginBottom: 14 }}>
          In questo ambiente manca la chiave di OpenAI (OPENAI_API_KEY): il cliente vede il servizio ma la copertina non parte.
        </p>
      )}
      <p className={`cn-esito ${modalita === "reale" ? "avviso" : "ok"}`} role="status" style={{ marginBottom: 14 }}>
        {modalita === "prova"
          ? "Stripe è in modalità di PROVA: nessun cliente reale vede l'acquisto, finché la chiave Stripe di OMNIA AI non è quella reale."
          : modalita === "reale"
            ? "Stripe è in modalità REALE: ogni acquisto è un pagamento vero."
            : "Non riesco a stabilire se la chiave Stripe è di prova o reale."}
      </p>

      <Pannello titolo="Vendita">
        <div className="cn-pannello-corpo">
          <p className={`cn-esito ${visibile ? "ok" : "avviso"}`} role="status" style={{ marginBottom: 14 }}>
            {visibile
              ? "Vendita ACCESA: in ogni gara analizzata compare la copertina con «Acquista» e, nella home e in «Servizi aggiuntivi», i pacchetti."
              : dati.interruttore
                ? "L'interruttore è acceso, ma l'acquisto NON è visibile: la chiave Stripe di OMNIA AI su questo ambiente non è reale (o manca la migrazione 0107)."
                : "Vendita SPENTA: la copertina la vede solo chi ha una concessione, delle unità, condizioni particolari o una gara già pagata."}
          </p>
          <p className="cn-esito ok" role="status" style={{ marginBottom: 14 }}>
            {NOTA_CONSOLE_CONDIZIONI_COPERTINA}
          </p>
          <p className={`cn-esito ${APPROVAZIONE_LEGALE_PACCHETTI ? "ok" : "avviso"}`} role="alert" style={{ marginBottom: 14 }}>
            {NOTA_CONSOLE_CONDIZIONI_PACCHETTI}
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {dati.interruttore ? (
              <ModuloAzione azione={impostaVenditaCopertina} campi={{ azione: "sospendi" }} etichetta="Sospendi la vendita" etichettaInCorso="Sospendo…" messaggioOk="Vendita sospesa.">
                <></>
              </ModuloAzione>
            ) : (
              <ModuloAzione azione={impostaVenditaCopertina} campi={{ azione: "attiva" }} etichetta="Accendi la vendita" etichettaInCorso="Accendo…" variante="primario" messaggioOk="Vendita accesa.">
                <></>
              </ModuloAzione>
            )}
          </div>
          <p className="cn-nota-inline" style={{ marginTop: 10 }}>
            <strong>Questo interruttore è solo della copertina</strong> (quello del piano di lavoro è nella sua pagina): vale per l&apos;acquisto della copertina di una gara <strong>e</strong> per i pacchetti della copertina. Si accende solo con la chiave Stripe
            riconosciuta e la migrazione 0107 eseguita; si spegne sempre, anche per fermare tutto in un attimo.
          </p>
        </div>
      </Pannello>

      <div className="cn-sezione">
        <Pannello titolo="Copertina di una singola gara (IVA inclusa)">
          <div className="cn-pannello-corpo">
            <p style={{ marginBottom: 10 }}>
              Oggi si paga <strong>{euro(dati.prezzoSingoloCentesimi)}</strong> {dati.prezzoSingoloModificato ? "(modificato da qui)" : "(prezzo del codice, mai modificato)"}. Comprende, per quella gara, fino a 3 generazioni in stile stilizzato e 3 in stile realistico,
              più la chat delle modifiche. Un prezzo dedicato a un cliente (scheda cliente) prevale. È il prezzo con cui si confrontano i pacchetti qui sotto.
            </p>
            <ModuloAzione azione={salvaPrezzoSingoloCopertina} etichetta="Salva prezzo" etichettaInCorso="Salvo…" messaggioOk="Prezzo salvato." variante="primario">
              <input className="cn-input" name="prezzo" inputMode="decimal" required placeholder={euroCampo(dati.prezzoSingoloCentesimi)} aria-label="Nuovo prezzo della copertina di una gara" style={{ maxWidth: 120 }} autoComplete="off" />
            </ModuloAzione>
          </div>
        </Pannello>

        <Pannello titolo="Utenti in prova">
          <div className="cn-pannello-corpo">
            <p style={{ marginBottom: 10 }}>
              Chi è in prova (gare gratuite dalla console, nessun abbonamento), con la vendita accesa: <strong>{ETICHETTA_POLITICA_PROVA[dati.politicaProva]}</strong>. I pacchetti si vendono solo a chi ha l&apos;abbonamento attivo.
            </p>
            {dati.politicaProva === "gratis" && senza0130 && (
              <p className="cn-esito avviso" role="alert" style={{ marginBottom: 10 }}>
                «Incluso gratis» funziona solo dopo la migrazione 0130: prima, chi è in prova vedrebbe il pulsante ma la generazione non partirebbe.
              </p>
            )}
            <ModuloAzione azione={impostaPoliticaProvaCopertina} etichetta="Salva" etichettaInCorso="Salvo…" messaggioOk="Salvato." variante="primario">
              <select className="cn-input" name="politica" defaultValue={dati.politicaProva} aria-label="Cosa fa la copertina per chi è in prova">
                {POLITICHE_PROVA.map((p) => (
                  <option key={p} value={p}>
                    {ETICHETTA_POLITICA_PROVA[p]}
                  </option>
                ))}
              </select>
            </ModuloAzione>
          </div>
        </Pannello>
      </div>

      <Pannello titolo={`Pacchetti di copertine (${dati.pacchetti.length} in vendita)`}>
        <div className="cn-pannello-corpo">
          <p style={{ marginBottom: 10 }}>
            Un pacchetto è un numero di <strong>gare con copertina</strong> prepagate: ogni gara ne usa una alla sua prima copertina (poi fino a 3 generazioni per stile), <strong>non scadono nel tempo</strong> e si esauriscono man mano, anche in più
            mesi. Se l&apos;abbonamento cessa, le unità che restano <strong>si perdono</strong>, come i crediti. Prezzi IVA inclusa. {dati.pacchettiDiPartenza ? "L'elenco è quello di partenza del codice: non è mai stato salvato da qui." : "L'elenco è quello salvato da qui."}
          </p>
          {dati.unitaResidue !== null && (
            <p className="cn-nota-inline" style={{ marginBottom: 10 }}>
              Gare con copertina ancora da usare, in tutti i saldi dei clienti: <strong>{dati.unitaResidue}</strong>.
            </p>
          )}

          {dati.pacchetti.length === 0 ? (
            <p className="cn-vuoto">Nessun pacchetto in vendita: i clienti vedono solo l&apos;acquisto della singola gara.</p>
          ) : (
            <div className="cn-scorri" style={{ marginBottom: 14 }}>
              <table className="cn-tab">
                <thead>
                  <tr>
                    <th>Pacchetto</th>
                    <th className="num">Prezzo</th>
                    <th className="num">Per gara</th>
                    <th className="num">Risparmio sul prezzo di {euro(dati.prezzoSingoloCentesimi)} a gara</th>
                  </tr>
                </thead>
                <tbody>
                  {dati.pacchetti.map((p) => {
                    const c = convenienzaPacchetto(p, dati.prezzoSingoloCentesimi);
                    return (
                      <tr key={p.quantita}>
                        <td>{testoUnita(p.quantita, "copertina")}</td>
                        <td className="num">{euro(p.prezzoCentesimi)}</td>
                        <td className="num">{euro(c.perUnitaCentesimi)}</td>
                        <td className="num">{c.risparmioCentesimi ? euro(c.risparmioCentesimi) : "nessuno (costa come o più della singola gara)"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <ModuloAzione azione={salvaCatalogoPacchettiCopertina} etichetta="Salva i pacchetti" etichettaInCorso="Salvo…" messaggioOk="Pacchetti salvati." variante="primario">
            <div key={JSON.stringify(dati.pacchetti)} style={{ display: "grid", gap: 8 }}>
              {Array.from({ length: LIMITI_CATALOGO.pacchettiMassimi }, (_, i) => {
                const p = dati.pacchetti[i];
                return (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ minWidth: 70 }}>Pacchetto {i + 1}</span>
                    <input className="cn-input" name={`quantita_${i + 1}`} inputMode="numeric" defaultValue={p ? String(p.quantita) : ""} placeholder="Quante gare" aria-label={`Pacchetto ${i + 1}: quante gare con copertina`} style={{ maxWidth: 120 }} autoComplete="off" />
                    <input className="cn-input" name={`prezzo_${i + 1}`} inputMode="decimal" defaultValue={p ? euroCampo(p.prezzoCentesimi) : ""} placeholder="Prezzo in euro" aria-label={`Pacchetto ${i + 1}: prezzo in euro, IVA inclusa`} style={{ maxWidth: 140 }} autoComplete="off" />
                  </div>
                );
              })}
            </div>
          </ModuloAzione>
          <p className="cn-nota-inline" style={{ marginTop: 10 }}>
            Fino a {LIMITI_CATALOGO.pacchettiMassimi} pacchetti, da {LIMITI_CATALOGO.quantitaMinima} a {LIMITI_CATALOGO.quantitaMassima} gare ciascuno; le righe vuote si ignorano e non si possono avere due pacchetti con la stessa quantità. <strong>Se le lasci tutte vuote non si vende nessun
            pacchetto.</strong> Chi ha già comprato mantiene le sue unità e il prezzo pagato. Per regalare o correggere unità a un cliente: scheda cliente, riquadro dei pacchetti.
          </p>
        </div>
      </Pannello>

      <Pannello titolo={`Offerte dedicate (${dati.offerte.elenco.filter((o) => o.stato === "attiva").length} attive)`}>
        <div className="cn-pannello-corpo">
          <p style={{ marginBottom: 10 }}>
            Un&apos;offerta dedicata è un pacchetto <strong>privato</strong>, con il prezzo e il numero di gare con copertina che decidi tu per <strong>un cliente preciso</strong> (il titolare dell&apos;account). La vede solo lui, e il suo Ufficio Gare, che
            con «Acquista» avvisa il titolare: <strong>non compare nell&apos;elenco pubblico</strong>. Si compra <strong>una volta sola</strong>; finché non è stata comprata la puoi revocare; la scadenza è facoltativa (vale l&apos;ultimo giorno). Prezzo
            IVA inclusa. Vale <strong>solo con la vendita della copertina accesa</strong> e con l&apos;abbonamento attivo del cliente.
          </p>

          {!dati.offerte.disponibile || senza0130 ? (
            <p className="cn-esito avviso" role="alert">
              Disponibile dopo le migrazioni 0105 (offerte dedicate) e 0130 (copertina nei pacchetti).
            </p>
          ) : (
            <>
              <ModuloAzione azione={creaOffertaDedicataCliente} campi={{ servizio: "copertina" }} etichetta="Crea l'offerta" etichettaInCorso="Creo…" messaggioOk="Offerta creata: il cliente la vede nella sua area." variante="primario" svuota>
                <input className="cn-input" type="email" name="email" required placeholder="Email del titolare" aria-label="Email del cliente a cui è riservata l'offerta" maxLength={254} autoComplete="off" style={{ maxWidth: 260 }} />
                <input className="cn-input" name="quantita" inputMode="numeric" required placeholder="Quante gare" aria-label="Quante gare con copertina" style={{ maxWidth: 120 }} autoComplete="off" />
                <input className="cn-input" name="prezzo" inputMode="decimal" required placeholder="Prezzo in euro" aria-label="Prezzo totale in euro, IVA inclusa" style={{ maxWidth: 140 }} autoComplete="off" />
                <input className="cn-input" name="scadeIl" type="date" aria-label="Valida fino al (vuoto = senza scadenza)" />
                <input className="cn-input cn-testo" name="nota" placeholder="Nota interna (facoltativa, il cliente non la vede)" aria-label="Nota interna" maxLength={LIMITI_OFFERTA.notaMassima} />
              </ModuloAzione>
              <p className="cn-nota-inline" style={{ marginTop: 10 }}>
                Da {LIMITI_OFFERTA.quantitaMinima} a {LIMITI_OFFERTA.quantitaMassima} gare; il prezzo è il totale dell&apos;offerta, non per gara (da 1 € a 100.000 €).
              </p>

              {dati.offerte.elenco.length === 0 ? (
                <p className="cn-vuoto">Nessuna offerta dedicata della copertina.</p>
              ) : (
                <div className="cn-scorri" style={{ marginTop: 14 }}>
                  <table className="cn-tab">
                    <thead>
                      <tr>
                        <th>Cliente</th>
                        <th>Pacchetto</th>
                        <th className="num">Prezzo</th>
                        <th className="num">Per gara</th>
                        <th className="num">Risparmio sul prezzo di {euro(dati.prezzoSingoloCentesimi)} a gara</th>
                        <th>Valida fino al</th>
                        <th>Stato</th>
                        <th>Azione</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dati.offerte.elenco.map((o) => {
                        const c = convenienzaPacchetto({ quantita: o.quantita, prezzoCentesimi: o.prezzoCentesimi }, dati.prezzoSingoloCentesimi);
                        return (
                          <tr key={o.id}>
                            <td className="cn-cella-doppia">
                              {o.cliente ? <Link href={`/utenti/${o.userId}`}>{o.cliente}</Link> : "(cliente non trovato)"}
                              <small>
                                creata il {formattaDataOra(o.creataIl)} da {o.creataDa}
                              </small>
                              {o.nota && <small>Nota: {o.nota}</small>}
                            </td>
                            <td>{testoUnita(o.quantita, o.servizio)}</td>
                            <td className="num">{euro(o.prezzoCentesimi)}</td>
                            <td className="num">{euro(c.perUnitaCentesimi)}</td>
                            <td className="num">{c.risparmioCentesimi ? euro(c.risparmioCentesimi) : "nessuno"}</td>
                            <td>{o.scadeIl ? formattaGiorno(o.scadeIl) : "senza scadenza"}</td>
                            <td>
                              <Badge tono={o.stato === "attiva" || o.stato === "acquistata" ? "ok" : "neutro"}>{ETICHETTA_STATO_OFFERTA[o.stato]}</Badge>
                              {o.stato === "revocata" && o.chiusaIl && <small style={{ display: "block" }}>il {formattaDataOra(o.chiusaIl)}{o.chiusaDa ? ` da ${o.chiusaDa}` : ""}</small>}
                              {o.stato === "acquistata" && o.chiusaIl && <small style={{ display: "block" }}>il {formattaDataOra(o.chiusaIl)}</small>}
                            </td>
                            <td>
                              {revocabile(o.stato) && (
                                <ModuloAzione azione={revocaOffertaDedicataCliente} campi={{ id: o.id }} etichetta="Revoca" etichettaInCorso="Revoco…" messaggioOk="Revocata.">
                                  <></>
                                </ModuloAzione>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </Pannello>

      <Pannello titolo={`Concessioni gratuite (${dati.concessioni.filter((c) => c.attiva).length} attive)`}>
        <div className="cn-pannello-corpo">
          <p className="cn-nota-inline" style={{ marginBottom: 10 }}>
            Concedi gratis la copertina a un cliente: per <strong>tutte le sue gare</strong> (con un numero massimo e/o una scadenza, facoltativi) oppure per <strong>una gara</strong>. Vale anche con la vendita spenta e prima di pacchetti e acquisti
            (per le gare coperte il pacchetto non si consuma). Si revoca, non si cancella: resta nella storia.
          </p>
          <form action="/copertina" method="get" className="cn-ricerca" style={{ marginBottom: 12 }}>
            <input className="cn-input" type="email" name="cliente" defaultValue={emailCercata} placeholder="Email del titolare" aria-label="Email del cliente a cui dare la concessione" required />
            <button type="submit" className="cn-btn">
              Cerca il cliente
            </button>
          </form>

          {ricerca?.stato === "non_trovato" && <p className="cn-esito avviso">Nessun cliente con questo indirizzo email.</p>}
          {ricerca?.stato === "ufficio_gare" && <p className="cn-esito avviso">Questo indirizzo è di un Ufficio Gare: la concessione va data al titolare dell&apos;account.</p>}
          {ricerca?.stato === "errore" && <p className="cn-esito errore">Ricerca non riuscita: riprova.</p>}
          {ricerca?.stato === "trovato" && <FormConcessione cliente={ricerca.cliente} disabilitato={senza0130} />}

          {dati.concessioni.length === 0 ? (
            <p className="cn-vuoto">Nessuna concessione creata.</p>
          ) : (
            <div className="cn-scorri" style={{ marginTop: 14 }}>
              <table className="cn-tab">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Cosa copre</th>
                    <th>Gare usate</th>
                    <th>Motivo</th>
                    <th>Stato</th>
                    <th>Azione</th>
                  </tr>
                </thead>
                <tbody>
                  {dati.concessioni.map((c) => (
                    <tr key={c.id}>
                      <td className="cn-cella-doppia">
                        {c.utente}
                        <small>
                          creata il {formattaDataOra(c.creataIl)} da {c.creataDa}
                        </small>
                      </td>
                      <td>{descriviConcessione({ tipo: c.tipo, gara_titolo: c.garaTitolo, gare_massime: c.gareMassime, scade_il: c.scadeIl })}</td>
                      <td className="num">{c.gareMassime !== null ? `${c.gareUsate} su ${c.gareMassime}` : c.gareUsate}</td>
                      <td>{c.motivo}</td>
                      <td>
                        {c.attiva ? (
                          c.scadeIl && c.scadeIl < new Date().toISOString().slice(0, 10) ? (
                            <Badge tono="neutro">scaduta il {formattaGiorno(c.scadeIl)}</Badge>
                          ) : (
                            <Badge tono="ok">attiva</Badge>
                          )
                        ) : (
                          <Badge tono="neutro">
                            revocata{c.revocataIl ? ` il ${formattaDataOra(c.revocataIl)}` : ""}
                            {c.revocataDa ? ` da ${c.revocataDa}` : ""}
                          </Badge>
                        )}
                      </td>
                      <td>
                        {c.attiva && (
                          <ModuloAzione azione={revocaConcessioneCopertina} campi={{ id: c.id }} etichetta="Revoca" etichettaInCorso="Revoco…" messaggioOk="Revocata.">
                            <></>
                          </ModuloAzione>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Pannello>

      <Pannello titolo={`Clienti con condizioni particolari (${dati.clientiParticolari.length})`}>
        <div className="cn-pannello-corpo">
          <p className="cn-nota-inline" style={{ marginBottom: 10 }}>
            Condizioni decise per un singolo cliente, che prevalgono sulle regole generali di questa pagina: <strong>gratis</strong> (con gare e scadenza facoltative) oppure un <strong>prezzo dedicato</strong> per gara (vale anche a vendita spenta). Si
            impostano e si tolgono dalla scheda del cliente (Utenti → cliente → «Copertina della relazione tecnica»).
          </p>
          {dati.clientiParticolari.length === 0 ? (
            <p className="cn-vuoto">Nessun cliente con condizioni particolari.</p>
          ) : (
            <div className="cn-scorri">
              <table className="cn-tab">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Condizioni</th>
                  </tr>
                </thead>
                <tbody>
                  {dati.clientiParticolari.map((c) => (
                    <tr key={c.userId}>
                      <td>
                        <Link href={`/utenti/${c.userId}`}>{c.email}</Link>
                      </td>
                      <td>
                        {descriviImpostazioniCopertina(c.descrizione)}
                        {c.descrizione.nota ? ` Nota: ${c.descrizione.nota}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Pannello>
    </>
  );
}

// I due moduli di concessione per il cliente trovato: tutte le gare, oppure una gara.
function FormConcessione({ cliente, disabilitato }: { cliente: ClienteConcessione; disabilitato: boolean }) {
  return (
    <div style={{ display: "grid", gap: 12, marginBottom: 6 }}>
      <p>
        Cliente: <strong>{cliente.email}</strong>
      </p>
      <ModuloAzione azione={creaConcessioneCopertina} campi={{ email: cliente.email, tipo: "tutte" }} etichetta="Concedi per tutte le gare" etichettaInCorso="Concedo…" variante="primario" messaggioOk="Concessione creata." svuota>
        <input className="cn-input" name="gareMassime" inputMode="numeric" placeholder="Numero massimo di gare (vuoto = nessun limite)" aria-label="Numero massimo di gare" style={{ maxWidth: 260 }} autoComplete="off" disabled={disabilitato} />
        <input className="cn-input" name="scadeIl" type="date" aria-label="Scade il (vuoto = senza scadenza)" disabled={disabilitato} />
        <input className="cn-input cn-testo" name="motivo" required placeholder="Motivo (per esempio: cliente pilota, accordo commerciale)" aria-label="Motivo della concessione" maxLength={300} disabled={disabilitato} />
      </ModuloAzione>
      <ModuloAzione azione={creaConcessioneCopertina} campi={{ email: cliente.email, tipo: "gara" }} etichetta="Concedi per una gara" etichettaInCorso="Concedo…" messaggioOk="Concessione creata." svuota>
        <select className="cn-input" name="garaId" required aria-label="Gara" disabled={disabilitato || cliente.gare.length === 0} defaultValue="">
          <option value="" disabled>
            {cliente.gare.length === 0 ? "Il cliente non ha gare" : "Scegli la gara"}
          </option>
          {cliente.gare.map((g) => (
            <option key={g.id} value={g.id}>
              {g.titolo}
            </option>
          ))}
        </select>
        <input className="cn-input" name="scadeIl" type="date" aria-label="Scade il (vuoto = senza scadenza)" disabled={disabilitato} />
        <input className="cn-input cn-testo" name="motivo" required placeholder="Motivo" aria-label="Motivo della concessione" maxLength={300} disabled={disabilitato} />
      </ModuloAzione>
    </div>
  );
}
