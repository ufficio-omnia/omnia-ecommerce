import Link from "next/link";
import type { ClienteConcessione, DatiPianoLavoroConsole, RicercaCliente } from "@/lib/console/piano-lavoro";
import { ETICHETTA_STATO_OFFERTA, revocabile } from "@/lib/console/offerte-calcoli";
import { formattaGiorno } from "@/lib/omnia-ai-catalogo-calcoli";
import { modalitaChiaveStripe } from "@/lib/omnia-ai-vendita";
import { APPROVAZIONE_LEGALE_PACCHETTI, LIMITI_CATALOGO, LIMITI_OFFERTA, NOTA_CONSOLE_CONDIZIONI_PACCHETTI, SERVIZI, convenienzaPacchetto, testoUnita } from "@/lib/pacchetti-servizi-calcoli";
import { ETICHETTA_POLITICA_PROVA, POLITICHE_PROVA, descriviConcessione } from "@/lib/piano-lavoro-offerta-calcoli";
import { NOTA_CONSOLE_TESTI } from "@/lib/piano-lavoro-testi";
import { creaConcessionePianoLavoro, impostaPoliticaProvaPianoLavoro, impostaVenditaPianoLavoro, revocaConcessionePianoLavoro, salvaCatalogoPacchettiPianoLavoro, salvaPrezzoSingoloPianoLavoro } from "../azioni/piano-lavoro";
import { creaOffertaDedicataCliente, revocaOffertaDedicataCliente } from "../azioni/pacchetti";
import { Badge, Pannello } from "./elementi";
import { formattaDataOra, formattaEuro } from "./formati";
import ModuloAzione from "./modulo-azione";

// Pagina «Piano di lavoro e pacchetti»: la vendita (un interruttore solo, per la singola gara e per i pacchetti), il prezzo della singola gara, i pacchetti
// prepagati, le offerte dedicate a un cliente, la regola per gli utenti in prova e le concessioni gratuite. Il piano di lavoro NON si vende più nell'abbonamento: il pannello dei
// supplementi mensili non è più in pagina (il codice resta). Ciò che si scrive qui vale per i NUOVI acquisti: chi ha già pagato mantiene il suo
// diritto, le sue unità e il suo prezzo.

const euro = (centesimi: number) => formattaEuro(centesimi / 100);
const euroCampo = (centesimi: number) => (centesimi / 100).toFixed(2).replace(".", ",");

export default function PianoLavoroVista({ dati, emailCercata, ricerca }: { dati: DatiPianoLavoroConsole; emailCercata: string; ricerca: RicercaCliente | null }) {
  const modalita = modalitaChiaveStripe(process.env.STRIPE_SECRET_KEY_OMNIA_AI);
  const visibile = dati.interruttore && modalita === "reale";

  return (
    <>
      <div className="cn-testata">
        <div>
          <h1>Piano di lavoro e pacchetti</h1>
          <p>Vendita, prezzi, pacchetti prepagati e concessioni gratuite del piano di lavoro Excel di ogni gara</p>
        </div>
      </div>

      {!dati.pacchettiDisponibili && (
        <p className="cn-esito avviso" role="alert" style={{ marginBottom: 14 }}>
          Manca la migrazione 0104 (pacchetti di servizi): finché non è eseguita i pacchetti non esistono e la vendita non si può accendere.
        </p>
      )}
      {!dati.concessioniDisponibili && (
        <p className="cn-esito avviso" role="alert" style={{ marginBottom: 14 }}>
          Manca la migrazione 0101 (concessioni gratuite): finché non è eseguita non si possono creare concessioni.
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
              ? "Vendita ACCESA: nella gara compare «Acquista il piano di lavoro» e, nella home e in «Servizi aggiuntivi», i pacchetti."
              : dati.interruttore
                ? "L'interruttore è acceso, ma l'acquisto NON è visibile: la chiave Stripe di OMNIA AI su questo ambiente non è reale."
                : "Vendita SPENTA: i clienti non possono comprare il piano di lavoro né i pacchetti. Chi li ha già pagati o ricevuti li usa."}
          </p>
          <p className={`cn-esito ${APPROVAZIONE_LEGALE_PACCHETTI ? "ok" : "avviso"}`} role="alert" style={{ marginBottom: 14 }}>
            {NOTA_CONSOLE_CONDIZIONI_PACCHETTI}
          </p>
          <p className="cn-nota-inline" style={{ marginBottom: 14 }}>
            {NOTA_CONSOLE_TESTI}
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {dati.interruttore ? (
              <ModuloAzione azione={impostaVenditaPianoLavoro} campi={{ azione: "sospendi" }} etichetta="Sospendi la vendita" etichettaInCorso="Sospendo…" messaggioOk="Vendita sospesa.">
                <></>
              </ModuloAzione>
            ) : (
              <ModuloAzione azione={impostaVenditaPianoLavoro} campi={{ azione: "attiva" }} etichetta="Accendi la vendita" etichettaInCorso="Accendo…" variante="primario" messaggioOk="Vendita accesa.">
                <></>
              </ModuloAzione>
            )}
          </div>
          <p className="cn-nota-inline" style={{ marginTop: 10 }}>
            <strong>L&apos;interruttore è uno solo:</strong> vale per l&apos;acquisto del piano di lavoro di una gara <strong>e</strong> per i pacchetti. Si accende solo con la chiave Stripe riconosciuta e la migrazione 0104 eseguita; si spegne sempre, anche per fermare tutto in un attimo.
          </p>
          <p className="cn-nota-inline" style={{ marginTop: 10 }}>
            Il piano di lavoro <strong>non si vende più nell&apos;abbonamento</strong>: lo si compra nella singola gara o a pacchetto. I supplementi mensili dell&apos;abbonamento non sono più in uso (chi lo ha già nel suo abbonamento lo conserva).
          </p>
        </div>
      </Pannello>

      <div className="cn-sezione">
        <Pannello titolo="Piano di lavoro di una singola gara (IVA inclusa)">
          <div className="cn-pannello-corpo">
            <p style={{ marginBottom: 10 }}>
              Oggi si paga <strong>{euro(dati.prezzoSingoloCentesimi)}</strong> {dati.prezzoSingoloModificato ? "(modificato da qui)" : "(prezzo del codice, mai modificato)"}. Una generazione per gara, più una seconda solo se i documenti indicano una proroga. È il prezzo con cui si confrontano i pacchetti qui sotto.
            </p>
            <ModuloAzione azione={salvaPrezzoSingoloPianoLavoro} etichetta="Salva prezzo" etichettaInCorso="Salvo…" messaggioOk="Prezzo salvato." variante="primario">
              <input className="cn-input" name="prezzo" inputMode="decimal" required placeholder={euroCampo(dati.prezzoSingoloCentesimi)} aria-label="Nuovo prezzo del piano di lavoro di una gara" style={{ maxWidth: 120 }} autoComplete="off" />
            </ModuloAzione>
          </div>
        </Pannello>

        <Pannello titolo="Utenti in prova">
          <div className="cn-pannello-corpo">
            <p style={{ marginBottom: 10 }}>
              Chi è in prova (gare gratuite dalla console, nessun abbonamento): <strong>{ETICHETTA_POLITICA_PROVA[dati.politicaProva]}</strong>. I pacchetti si vendono solo a chi ha l&apos;abbonamento attivo.
            </p>
            <ModuloAzione azione={impostaPoliticaProvaPianoLavoro} etichetta="Salva" etichettaInCorso="Salvo…" messaggioOk="Salvato." variante="primario">
              <select className="cn-input" name="politica" defaultValue={dati.politicaProva} aria-label="Cosa fa il piano di lavoro per chi è in prova">
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

      <Pannello titolo={`Pacchetti di piani di lavoro (${dati.pacchetti.length} in vendita)`}>
        <div className="cn-pannello-corpo">
          <p style={{ marginBottom: 10 }}>
            Un pacchetto è un numero di piani di lavoro prepagati: il cliente li usa <strong>uno per gara</strong>, <strong>non scadono nel tempo</strong> e si esauriscono man mano che li usa, anche in più mesi. Se l&apos;abbonamento cessa, le unità
            che restano <strong>si perdono</strong>, come i crediti. Prezzi IVA inclusa. {dati.pacchettiDiPartenza ? "L'elenco è quello di partenza del codice: non è mai stato salvato da qui." : "L'elenco è quello salvato da qui."}
          </p>
          {dati.unitaResidue !== null && (
            <p className="cn-nota-inline" style={{ marginBottom: 10 }}>
              Unità ancora da usare, in tutti i saldi dei clienti: <strong>{dati.unitaResidue}</strong>.
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
                    <th className="num">Per unità</th>
                    <th className="num">Risparmio sul prezzo di {euro(dati.prezzoSingoloCentesimi)} a gara</th>
                  </tr>
                </thead>
                <tbody>
                  {dati.pacchetti.map((p) => {
                    const c = convenienzaPacchetto(p, dati.prezzoSingoloCentesimi);
                    return (
                      <tr key={p.quantita}>
                        <td>{testoUnita(p.quantita, "piano_lavoro")}</td>
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

          <ModuloAzione azione={salvaCatalogoPacchettiPianoLavoro} etichetta="Salva i pacchetti" etichettaInCorso="Salvo…" messaggioOk="Pacchetti salvati." variante="primario">
            <div key={JSON.stringify(dati.pacchetti)} style={{ display: "grid", gap: 8 }}>
              {Array.from({ length: LIMITI_CATALOGO.pacchettiMassimi }, (_, i) => {
                const p = dati.pacchetti[i];
                return (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ minWidth: 70 }}>Pacchetto {i + 1}</span>
                    <input className="cn-input" name={`quantita_${i + 1}`} inputMode="numeric" defaultValue={p ? String(p.quantita) : ""} placeholder="Quanti piani" aria-label={`Pacchetto ${i + 1}: quanti piani di lavoro`} style={{ maxWidth: 120 }} autoComplete="off" />
                    <input className="cn-input" name={`prezzo_${i + 1}`} inputMode="decimal" defaultValue={p ? euroCampo(p.prezzoCentesimi) : ""} placeholder="Prezzo in euro" aria-label={`Pacchetto ${i + 1}: prezzo in euro, IVA inclusa`} style={{ maxWidth: 140 }} autoComplete="off" />
                  </div>
                );
              })}
            </div>
          </ModuloAzione>
          <p className="cn-nota-inline" style={{ marginTop: 10 }}>
            Fino a {LIMITI_CATALOGO.pacchettiMassimi} pacchetti, da {LIMITI_CATALOGO.quantitaMinima} a {LIMITI_CATALOGO.quantitaMassima} piani ciascuno; le righe vuote si ignorano e non si possono avere due pacchetti con la stessa quantità. <strong>Se le lasci tutte vuote non si vende nessun
            pacchetto.</strong> Chi ha già comprato mantiene le sue unità e il prezzo pagato.
          </p>
        </div>
      </Pannello>

      <Pannello titolo={`Offerte dedicate (${dati.offerte.elenco.filter((o) => o.stato === "attiva").length} attive)`}>
        <div className="cn-pannello-corpo">
          <p style={{ marginBottom: 10 }}>
            Un&apos;offerta dedicata è un pacchetto <strong>privato</strong>, con il prezzo e il numero di piani di lavoro che decidi tu per <strong>un cliente preciso</strong> (il titolare dell&apos;account). La vede solo lui, e il suo Ufficio Gare, che con
            «Acquista» avvisa il titolare: <strong>non compare nell&apos;elenco pubblico</strong> dei pacchetti. Si compra <strong>una volta sola</strong>; finché non è stata comprata la puoi revocare; la scadenza è facoltativa (vale l&apos;ultimo giorno).
            Prezzo IVA inclusa. Vale <strong>solo con la vendita accesa</strong> e con l&apos;abbonamento attivo del cliente. Le unità comprate funzionano come quelle di ogni pacchetto: non scadono, si usano una per gara, si perdono se l&apos;abbonamento cessa.
          </p>

          {!dati.offerte.disponibile ? (
            <p className="cn-esito avviso" role="alert">
              Disponibile dopo la migrazione 0105 (offerte dedicate): finché non è eseguita non si possono creare offerte.
            </p>
          ) : (
            <>
              <ModuloAzione azione={creaOffertaDedicataCliente} campi={{ servizio: "piano_lavoro" }} etichetta="Crea l'offerta" etichettaInCorso="Creo…" messaggioOk="Offerta creata: il cliente la vede nella sua area." variante="primario" svuota>
                <input className="cn-input" type="email" name="email" required placeholder="Email del titolare" aria-label="Email del cliente a cui è riservata l'offerta" maxLength={254} autoComplete="off" style={{ maxWidth: 260 }} />
                <input className="cn-input" name="quantita" inputMode="numeric" required placeholder="Quanti piani" aria-label="Quanti piani di lavoro" style={{ maxWidth: 120 }} autoComplete="off" />
                <input className="cn-input" name="prezzo" inputMode="decimal" required placeholder="Prezzo in euro" aria-label="Prezzo totale in euro, IVA inclusa" style={{ maxWidth: 140 }} autoComplete="off" />
                <input className="cn-input" name="scadeIl" type="date" aria-label="Valida fino al (vuoto = senza scadenza)" />
                <input className="cn-input cn-testo" name="nota" placeholder="Nota interna (facoltativa, il cliente non la vede)" aria-label="Nota interna" maxLength={LIMITI_OFFERTA.notaMassima} />
              </ModuloAzione>
              <p className="cn-nota-inline" style={{ marginTop: 10 }}>
                Da {LIMITI_OFFERTA.quantitaMinima} a {LIMITI_OFFERTA.quantitaMassima} piani; il prezzo è il totale dell&apos;offerta, non per piano (da 1 € a 100.000 €). Il confronto con il prezzo della singola gara ({euro(dati.prezzoSingoloCentesimi)}) è nella tabella.
              </p>

              {dati.offerte.elenco.length === 0 ? (
                <p className="cn-vuoto">Nessuna offerta dedicata creata.</p>
              ) : (
                <div className="cn-scorri" style={{ marginTop: 14 }}>
                  <table className="cn-tab">
                    <thead>
                      <tr>
                        <th>Cliente</th>
                        <th>Pacchetto</th>
                        <th className="num">Prezzo</th>
                        <th className="num">Per unità</th>
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
                            <td>
                              {SERVIZI[o.servizio].nome}: {testoUnita(o.quantita, o.servizio)}
                            </td>
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
            Concedi gratis il piano di lavoro a un cliente: per <strong>tutte le sue gare</strong> (con un numero massimo e/o una scadenza, facoltativi) oppure per <strong>una gara</strong>. Si revoca, non si cancella: resta nella storia.
          </p>
          <form action="/piano-lavoro" method="get" className="cn-ricerca" style={{ marginBottom: 12 }}>
            <input className="cn-input" type="email" name="cliente" defaultValue={emailCercata} placeholder="Email del titolare" aria-label="Email del cliente a cui dare la concessione" required />
            <button type="submit" className="cn-btn">
              Cerca il cliente
            </button>
          </form>

          {ricerca?.stato === "non_trovato" && <p className="cn-esito avviso">Nessun cliente con questo indirizzo email.</p>}
          {ricerca?.stato === "ufficio_gare" && <p className="cn-esito avviso">Questo indirizzo è di un Ufficio Gare: la concessione va data al titolare dell&apos;account.</p>}
          {ricerca?.stato === "errore" && <p className="cn-esito errore">Ricerca non riuscita: riprova.</p>}
          {ricerca?.stato === "trovato" && <FormConcessione cliente={ricerca.cliente} disabilitato={!dati.concessioniDisponibili} />}

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
                          <ModuloAzione azione={revocaConcessionePianoLavoro} campi={{ id: c.id }} etichetta="Revoca" etichettaInCorso="Revoco…" messaggioOk="Revocata.">
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
      <ModuloAzione azione={creaConcessionePianoLavoro} campi={{ email: cliente.email, tipo: "tutte" }} etichetta="Concedi per tutte le gare" etichettaInCorso="Concedo…" variante="primario" messaggioOk="Concessione creata." svuota>
        <input className="cn-input" name="gareMassime" inputMode="numeric" placeholder="Numero massimo di gare (vuoto = nessun limite)" aria-label="Numero massimo di gare" style={{ maxWidth: 260 }} autoComplete="off" disabled={disabilitato} />
        <input className="cn-input" name="scadeIl" type="date" aria-label="Scade il (vuoto = senza scadenza)" disabled={disabilitato} />
        <input className="cn-input cn-testo" name="motivo" required placeholder="Motivo (per esempio: cliente pilota, accordo commerciale)" aria-label="Motivo della concessione" maxLength={300} disabled={disabilitato} />
      </ModuloAzione>
      <ModuloAzione azione={creaConcessionePianoLavoro} campi={{ email: cliente.email, tipo: "gara" }} etichetta="Concedi per una gara" etichettaInCorso="Concedo…" messaggioOk="Concessione creata." svuota>
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
