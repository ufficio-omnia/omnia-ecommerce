import type { ClienteConcessione, DatiPianoLavoroConsole, RicercaCliente } from "@/lib/console/piano-lavoro";
import { formattaGiorno } from "@/lib/omnia-ai-catalogo-calcoli";
import { PIANI } from "@/lib/omnia-ai-plans";
import { modalitaChiaveStripe } from "@/lib/omnia-ai-vendita";
import { ETICHETTA_POLITICA_PROVA, POLITICHE_PROVA, descriviConcessione } from "@/lib/piano-lavoro-offerta-calcoli";
import { NOTA_CONSOLE_TESTI } from "@/lib/piano-lavoro-testi";
import { allineaPrezziStripePianoLavoro, creaConcessionePianoLavoro, impostaPoliticaProvaPianoLavoro, impostaVenditaPianoLavoro, revocaConcessionePianoLavoro, salvaPrezzoSingoloPianoLavoro, salvaSupplementiPianoLavoro } from "../azioni/piano-lavoro";
import { Badge, Pannello } from "./elementi";
import { formattaDataOra, formattaEuro } from "./formati";
import ModuloAzione from "./modulo-azione";

// Pagina «Piano di lavoro»: la vendita (acquisto della singola gara e opzione nell'abbonamento), i prezzi, la regola per gli utenti in prova e le
// concessioni gratuite. Ciò che si scrive qui vale per i NUOVI acquisti: chi ha già pagato mantiene il suo diritto e il suo prezzo.

const euro = (centesimi: number) => formattaEuro(centesimi / 100);
const euroCampo = (centesimi: number) => (centesimi / 100).toFixed(2).replace(".", ",");

export default function PianoLavoroVista({ dati, emailCercata, ricerca }: { dati: DatiPianoLavoroConsole; emailCercata: string; ricerca: RicercaCliente | null }) {
  const modalita = modalitaChiaveStripe(process.env.STRIPE_SECRET_KEY_OMNIA_AI);
  const tuttiAllineati = dati.piani.every((p) => p.stripe.stato === "allineato");
  const visibile = dati.interruttore && modalita === "reale";

  return (
    <>
      <div className="cn-testata">
        <div>
          <h1>Piano di lavoro</h1>
          <p>Vendita, prezzi e concessioni gratuite del piano di lavoro Excel di ogni gara</p>
        </div>
      </div>

      {!dati.concessioniDisponibili && (
        <p className="cn-esito avviso" role="alert" style={{ marginBottom: 14 }}>
          Manca la migrazione 0101 (abbonamento con piano di lavoro e concessioni): finché non è eseguita non si possono creare concessioni né accendere la vendita.
        </p>
      )}
      <p className={`cn-esito ${modalita === "reale" ? "avviso" : "ok"}`} role="status" style={{ marginBottom: 14 }}>
        {modalita === "prova"
          ? "Stripe è in modalità di PROVA: i prezzi che crei da qui vanno sull'account di prova, nessun cliente reale ne è toccato."
          : modalita === "reale"
            ? "Stripe è in modalità REALE: ogni allineamento crea prezzi veri sull'account di produzione."
            : "Non riesco a stabilire se la chiave Stripe è di prova o reale."}
      </p>

      <Pannello titolo="Vendita">
        <div className="cn-pannello-corpo">
          <p className={`cn-esito ${visibile ? "ok" : "avviso"}`} role="status" style={{ marginBottom: 14 }}>
            {visibile
              ? "Vendita ACCESA: nella gara compare «Acquista il piano di lavoro» e nelle pagine di acquisto l'opzione «piano di lavoro» dell'abbonamento."
              : dati.interruttore
                ? "L'interruttore è acceso, ma l'acquisto NON è visibile: la chiave Stripe di OMNIA AI su questo ambiente non è reale."
                : "Vendita SPENTA: i clienti non possono comprare il piano di lavoro (né da soli né nell'abbonamento). Chi lo ha già pagato o ricevuto lo usa."}
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
            La vendita si accende solo se i prezzi dell&apos;abbonamento con il piano di lavoro sono allineati su Stripe ({tuttiAllineati ? "lo sono" : "NON lo sono: vedi sotto"}). Si spegne sempre, anche per fermare tutto in un attimo.
          </p>
        </div>
      </Pannello>

      <div className="cn-sezione">
        <Pannello titolo="Piano di lavoro di una singola gara (IVA inclusa)">
          <div className="cn-pannello-corpo">
            <p style={{ marginBottom: 10 }}>
              Oggi si paga <strong>{euro(dati.prezzoSingoloCentesimi)}</strong> {dati.prezzoSingoloModificato ? "(modificato da qui)" : "(prezzo del codice, mai modificato)"}. Una generazione per gara, più una seconda solo se i documenti indicano una proroga.
            </p>
            <ModuloAzione azione={salvaPrezzoSingoloPianoLavoro} etichetta="Salva prezzo" etichettaInCorso="Salvo…" messaggioOk="Prezzo salvato." variante="primario">
              <input className="cn-input" name="prezzo" inputMode="decimal" required placeholder={euroCampo(dati.prezzoSingoloCentesimi)} aria-label="Nuovo prezzo del piano di lavoro di una gara" style={{ maxWidth: 120 }} autoComplete="off" />
            </ModuloAzione>
          </div>
        </Pannello>

        <Pannello titolo="Utenti in prova">
          <div className="cn-pannello-corpo">
            <p style={{ marginBottom: 10 }}>
              Chi è in prova (gare gratuite dalla console, nessun abbonamento): <strong>{ETICHETTA_POLITICA_PROVA[dati.politicaProva]}</strong>.
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

      <Pannello titolo="Abbonamento con piano di lavoro (IVA inclusa, al mese)">
        <div className="cn-pannello-corpo">
          <div className="cn-scorri">
            <table className="cn-tab">
              <thead>
                <tr>
                  <th>Piano</th>
                  <th className="num">Listino</th>
                  <th className="num">Supplemento</th>
                  <th className="num">Prezzo con piano di lavoro</th>
                  <th>Su Stripe</th>
                </tr>
              </thead>
              <tbody>
                {dati.piani.map((p) => (
                  <tr key={p.slug}>
                    <td className="cn-cella-doppia">
                      {p.nome}
                      <small>{p.surplusModificato ? "supplemento modificato da qui" : "supplemento del codice"}</small>
                    </td>
                    <td className="num">{euro(p.listinoCentesimi)}</td>
                    <td className="num">+{euro(p.surplusCentesimi)}</td>
                    <td className="num">{euro(p.attesoCentesimi)}</td>
                    <td>
                      {p.stripe.stato === "allineato" && <Badge tono="ok">allineato</Badge>}
                      {p.stripe.stato === "da_allineare" && (
                        <>
                          <Badge tono="errore">NON allineato</Badge> <small>({euro(p.stripe.importoCentesimi ?? 0)} su Stripe: l&apos;opzione nel checkout è ferma finché non allinei)</small>
                        </>
                      )}
                      {p.stripe.stato === "mancante" && <Badge tono="errore">prezzo Stripe mancante</Badge>}
                      {p.stripe.stato === "errore" && <Badge tono="avviso">non verificabile</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 14 }}>
            <ModuloAzione azione={salvaSupplementiPianoLavoro} etichetta="Salva i supplementi" etichettaInCorso="Salvo…" messaggioOk="Supplementi salvati." variante="primario">
              {dati.piani.map((p) => (
                <label key={p.slug} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                  {PIANI[p.slug].nome}
                  <input className="cn-input" name={p.slug} inputMode="decimal" required defaultValue={euroCampo(p.surplusCentesimi)} aria-label={`Supplemento mensile del piano ${p.nome}`} style={{ maxWidth: 100 }} autoComplete="off" />
                </label>
              ))}
            </ModuloAzione>
          </div>
          <div style={{ marginTop: 10 }}>
            <ModuloAzione azione={allineaPrezziStripePianoLavoro} etichetta="Allinea i prezzi su Stripe" etichettaInCorso="Allineo…" messaggioOk="Prezzi allineati.">
              <></>
            </ModuloAzione>
          </div>
          <p className="cn-nota-inline" style={{ marginTop: 10 }}>
            Il prezzo dell&apos;abbonamento con il piano di lavoro è il <strong>listino del piano + il supplemento</strong> (gli sconti e le offerte riservate si applicano come per il piano). Chi è già abbonato resta al prezzo che ha: su Stripe si crea un prezzo nuovo e quello vecchio non si tocca. Il
            piano di lavoro dell&apos;abbonamento copre solo le gare incluse nel piano: per le gare pagate con i crediti il cliente compra il piano della singola gara.
          </p>
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
