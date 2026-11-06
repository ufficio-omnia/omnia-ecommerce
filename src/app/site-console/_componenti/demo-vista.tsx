import type { Periodo } from "@/lib/console/periodo";
import type { RisultatoDemo } from "@/lib/console/demo";
import {
  COSA_FARE_CASO,
  ETICHETTA_STATO_ADS,
  TONO_STATO_ADS,
  avvisiIntegrazioni,
  etichettaMotivoCaso,
  sintesiSincronizzazione,
  type StatoRichiesta,
  type Tono,
} from "@/lib/console/demo-calcoli";
import { Badge, Pannello, Tessera } from "./elementi";
import { formattaDataOra, formattaIntero, formattaPercentuale } from "./formati";
import SelettorePeriodo from "./selettore-periodo";
import VerificaDataManager from "./verifica-data-manager";
import DiagnosiCalendario from "./diagnosi-calendario";
import ProvaGa4Reale from "./prova-ga4-reale";

// Sezione «DEMO e Google Ads»: le richieste arrivate dal modulo, le prenotazioni confermate sul calendario, i casi da verificare, lo
// stato delle importazioni verso GA4 e Google Ads e gli errori. SOLA LETTURA sui dati, con due eccezioni volute: la verifica della Data
// Manager API in SOLA VALIDAZIONE con dati inventati (non scrive nulla e non registra conversioni) e la «Prova reale GA4», che manda UN
// evento reale solo dopo una frase digitata (vedi prova-ga4-reale.tsx). Riceve dati già letti; nessun valore segreto passa di qui (lo
// stato delle integrazioni è fatto di «sì/no» e di modalità).

const ETICHETTA_STATO: Record<StatoRichiesta, string> = {
  pending: "in attesa di prenotazione",
  confirmed: "prenotata",
  cancelled: "annullata",
  superseded: "sostituita da una più recente",
};
const TONO_STATO: Record<StatoRichiesta, Tono> = { pending: "neutro", confirmed: "ok", cancelled: "avviso", superseded: "neutro" };

function Stato({ acceso, ok }: { acceso: boolean; ok: boolean }) {
  if (!acceso) return <Badge>spento</Badge>;
  return ok ? <Badge tono="ok">acceso</Badge> : <Badge tono="errore">incompleto</Badge>;
}

export default function DemoVista({ periodo, risultato, adessoMs }: { periodo: Periodo; risultato: RisultatoDemo; adessoMs: number }) {
  const testata = (
    <>
      <div className="cn-testata">
        <div>
          <h1>DEMO e Google Ads</h1>
          <p>
            Richieste dal modulo, prenotazioni sul calendario, conversioni · {periodo.etichetta} · una conversione conta solo con la prenotazione vista sul calendario
          </p>
        </div>
      </div>
      <div className="cn-periodo" style={{ marginBottom: 14 }}>
        <SelettorePeriodo percorso="/demo" periodo={periodo} />
      </div>
    </>
  );

  if (risultato.stato === "tabella_assente") {
    return (
      <>
        {testata}
        <p className="cn-esito errore" role="alert">
          Le tabelle della DEMO non esistono ancora nel database: eseguire la migrazione 0098. Finché non ci sono (o finché DEMO_LEADS_ATTIVO non è «1») le richieste arrivano solo per email all&apos;ufficio e non si misurano.
        </p>
      </>
    );
  }
  if (risultato.stato === "errore") {
    return (
      <>
        {testata}
        <p className="cn-esito errore" role="alert">
          {risultato.messaggio}
        </p>
      </>
    );
  }

  const d = risultato.dati;
  const r = d.riepilogo;
  const i = d.integrazioni;
  const avvisi = avvisiIntegrazioni(i);
  const sintesi = sintesiSincronizzazione(i.calendario.acceso && i.calendario.credenziali && i.calendario.idCalendario, d.sync, new Date(adessoMs));

  return (
    <>
      {testata}

      {avvisi.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          {avvisi.map((a) => (
            <p key={a.testo} className={`cn-esito ${a.tono === "errore" ? "errore" : "avviso"}`} role={a.tono === "errore" ? "alert" : "status"} style={{ marginBottom: 6 }}>
              {a.testo}
            </p>
          ))}
        </div>
      )}

      <div className="cn-tessere">
        <Tessera etichetta="Richieste ricevute" valore={formattaIntero(r.ricevute)} dettaglio={`${formattaIntero(r.persone)} persone · ${formattaIntero(r.conClic)} da annunci con clic registrato`} />
        <Tessera
          etichetta="Demo prenotate"
          valore={formattaIntero(r.confermate)}
          tono={r.confermate > 0 ? "ok" : "neutro"}
          dettaglio={r.tassoConferma === null ? "nessuna richiesta valida nel periodo" : `${formattaPercentuale(r.tassoConferma)} delle richieste valide`}
        />
        <Tessera etichetta="In attesa di prenotazione" valore={formattaIntero(r.inAttesa)} dettaglio="hanno compilato il modulo, non risulta ancora la prenotazione" />
        <Tessera etichetta="Annullate" valore={formattaIntero(r.annullate)} tono={r.annullate > 0 ? "avviso" : "neutro"} dettaglio={r.sostituite > 0 ? `${formattaIntero(r.sostituite)} sostituite da una richiesta più recente` : "prenotazioni cancellate o rifiutate"} />
        <Tessera etichetta="Casi da verificare" valore={formattaIntero(d.casi.length)} tono={d.casi.length > 0 ? "errore" : "ok"} dettaglio="prenotazioni che non si sono potute abbinare con certezza" />
        <Tessera etichetta="Importazioni Ads in errore" valore={formattaIntero(d.ads.daControllare)} tono={d.ads.daControllare > 0 ? "errore" : "ok"} dettaglio="conversioni da guardare a mano (tutte le richieste confermate)" />
      </div>

      <div className="cn-colonne cn-colonne-pari" style={{ marginTop: 14 }}>
        <Pannello titolo="Sistema">
          <div className="cn-pannello-corpo">
            <table className="cn-tab">
              <tbody>
                <tr>
                  <td>Registrazione delle richieste</td>
                  <td>{i.richieste.attive ? <Badge tono={i.richieste.segretoFirma ? "ok" : "errore"}>{i.richieste.segretoFirma ? "attiva" : "attiva ma senza segreto"}</Badge> : <Badge>spenta</Badge>}</td>
                </tr>
                <tr>
                  <td>Sincronizzazione del calendario</td>
                  <td>
                    <Stato acceso={i.calendario.acceso} ok={i.calendario.credenziali && i.calendario.idCalendario} /> <Badge tono={sintesi.tono}>{sintesi.testo}</Badge>
                  </td>
                </tr>
                <tr>
                  <td>Evento GA4 «demo_booking_confirmed»</td>
                  <td>
                    <Stato acceso={i.ga4.acceso} ok={i.ga4.segretoApi} /> {i.ga4.acceso && i.ga4.soloVerifica && <Badge tono="avviso">solo verifica</Badge>}
                  </td>
                </tr>
                <tr>
                  <td>Conversione Google Ads</td>
                  <td>
                    <Stato acceso={i.ads.acceso} ok={i.ads.configurazione && i.ads.credenziali} />{" "}
                    {i.ads.acceso && <Badge tono={i.ads.modalita === "reale" ? "accento" : "avviso"}>{i.ads.modalita === "reale" ? "reale" : "solo verifica"}</Badge>}
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="cn-nota-inline" style={{ marginTop: 10 }}>
              {d.sync?.ultimoSuccessoIl ? `Ultima sincronizzazione riuscita: ${formattaDataOra(d.sync.ultimoSuccessoIl)}.` : "Nessuna sincronizzazione riuscita finora."}{" "}
              {d.sync?.ultimaEsecuzioneIl ? `Ultima esecuzione: ${formattaDataOra(d.sync.ultimaEsecuzioneIl)}.` : ""} Si accende dalle variabili su Vercel, vedi la guida: qui si vede solo lo stato.
            </p>
          </div>
        </Pannello>

        <Pannello titolo="Google Ads e GA4 (richieste confermate)">
          <div className="cn-pannello-corpo">
            <table className="cn-tab">
              <thead>
                <tr>
                  <th>Stato della conversione</th>
                  <th className="num">Richieste</th>
                </tr>
              </thead>
              <tbody>
                {(Object.keys(ETICHETTA_STATO_ADS) as (keyof typeof ETICHETTA_STATO_ADS)[]).map((s) => (
                  <tr key={s}>
                    <td>
                      <Badge tono={TONO_STATO_ADS[s]}>{ETICHETTA_STATO_ADS[s]}</Badge>
                    </td>
                    <td className="num">{formattaIntero(d.ads.perStato[s])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="cn-nota-inline" style={{ marginTop: 10 }}>
              GA4: {formattaIntero(d.ga4.inviati)} eventi inviati · {formattaIntero(d.ga4.inAttesa)} in attesa · {formattaIntero(d.ga4.nonInviabili)} non inviabili (senza consenso ai cookie o tentativi esauriti)
              {d.ga4.riservateProva > 0 ? ` · ${formattaIntero(d.ga4.riservateProva)} riservate alla prova reale (il cron non le riprende, vedi la sezione sotto)` : ""}. Su {formattaIntero(d.confermateTotali)} richieste confermate in tutto.
            </p>
          </div>
        </Pannello>
      </div>

      <div className="cn-sezione">
        <Pannello titolo="Verifica Google Ads (solo validazione)">
          <VerificaDataManager />
        </Pannello>
      </div>

      <div className="cn-sezione">
        <Pannello titolo="Prova reale GA4 (un solo evento)">
          <ProvaGa4Reale prova={d.provaGa4} />
        </Pannello>
      </div>

      <div className="cn-sezione">
        <Pannello titolo="Diagnosi degli eventi dei casi aperti (sola lettura)">
          <DiagnosiCalendario />
        </Pannello>
      </div>

      <div className="cn-sezione">
        <Pannello titolo={`Casi da verificare (${d.casi.length})`}>
          {d.casi.length === 0 ? (
            <p className="cn-vuoto">Nessun caso aperto: ogni prenotazione vista sul calendario è stata abbinata con certezza, oppure non è una demo.</p>
          ) : (
            <div className="cn-scorri">
              <table className="cn-tab">
                <thead>
                  <tr>
                    <th>Visto il</th>
                    <th>Perché</th>
                    <th>Email del candidato</th>
                    <th>Prenotazione creata</th>
                    <th>Demo il</th>
                    <th>Cosa significa</th>
                  </tr>
                </thead>
                <tbody>
                  {d.casi.map((c) => (
                    <tr key={c.id}>
                      <td>{formattaDataOra(c.creatoIl)}</td>
                      <td>
                        <Badge tono="errore">{etichettaMotivoCaso(c.motivo)}</Badge>
                      </td>
                      <td>{c.email ?? "—"}</td>
                      <td>{c.eventoCreatoIl ? formattaDataOra(c.eventoCreatoIl) : "—"}</td>
                      <td>{c.eventoInizio ? formattaDataOra(c.eventoInizio) : "—"}</td>
                      <td className="cn-cella-doppia">
                        {COSA_FARE_CASO[c.motivo] ?? ""}
                        {c.nota && <small>{c.nota}</small>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="cn-nota">Nessuna conversione viene inviata per questi casi. Per chiuderne uno, dopo averlo guardato, si imposta «risolto» sulla riga di demo_calendar_casi (editor SQL di Supabase).</p>
        </Pannello>
      </div>

      <div className="cn-sezione">
        <Pannello titolo={`Prenotazioni confermate sul calendario (${d.prenotazioni.length})`}>
          {d.prenotazioni.length === 0 ? (
            <p className="cn-vuoto">Nessuna prenotazione registrata in questo periodo.</p>
          ) : (
            <div className="cn-scorri">
              <table className="cn-tab">
                <thead>
                  <tr>
                    <th>Prenotata il</th>
                    <th>Azienda</th>
                    <th>Email</th>
                    <th>Demo il</th>
                    <th>Stato</th>
                  </tr>
                </thead>
                <tbody>
                  {d.prenotazioni.map((p) => (
                    <tr key={p.id}>
                      <td>{formattaDataOra(p.prenotataIl)}</td>
                      <td>{p.azienda ?? "—"}</td>
                      <td>{p.email ?? "—"}</td>
                      <td className="cn-cella-doppia">
                        {p.inizio ? formattaDataOra(p.inizio) : "—"}
                        {p.riprogrammataIl && p.inizioOriginale && <small>spostata (era {formattaDataOra(p.inizioOriginale)})</small>}
                      </td>
                      <td>{p.stato === "confirmed" ? <Badge tono="ok">valida</Badge> : <Badge tono="avviso">annullata{p.annullataIl ? ` il ${formattaDataOra(p.annullataIl)}` : ""}</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Pannello>
      </div>

      <div className="cn-sezione">
        <Pannello titolo={`Importazioni in errore (${d.erroriAds.length})`}>
          {d.erroriAds.length === 0 ? (
            <p className="cn-vuoto">Nessun errore di importazione registrato.</p>
          ) : (
            <div className="cn-scorri">
              <table className="cn-tab">
                <thead>
                  <tr>
                    <th>Richiesta del</th>
                    <th>Azienda</th>
                    <th>Stato</th>
                    <th className="num">Tentativi</th>
                    <th>Errore</th>
                    <th>Prossimo tentativo</th>
                  </tr>
                </thead>
                <tbody>
                  {d.erroriAds.map((x) => (
                    <tr key={x.id}>
                      <td>{formattaDataOra(x.creataIl)}</td>
                      <td>{x.azienda}</td>
                      <td>
                        <Badge tono={TONO_STATO_ADS[x.statoAds]}>{ETICHETTA_STATO_ADS[x.statoAds]}</Badge>
                      </td>
                      <td className="num">{formattaIntero(x.adsTentativi)}</td>
                      <td className="mono-campo">{x.adsErrore}</td>
                      <td>{x.adsProssimoTentativo ? formattaDataOra(x.adsProssimoTentativo) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="cn-nota">Il codice dell&apos;errore è quello di Google (mai testi liberi, mai email o identificativi di clic).</p>
        </Pannello>
      </div>

      <div className="cn-sezione">
        <Pannello titolo={`Richieste ricevute (${d.richieste.length}${d.troncato ? "+" : ""})`}>
          {d.richieste.length === 0 ? (
            <p className="cn-vuoto">Nessuna richiesta in questo periodo.</p>
          ) : (
            <div className="cn-scorri">
              <table className="cn-tab">
                <thead>
                  <tr>
                    <th>Ricevuta il</th>
                    <th>Nome</th>
                    <th>Azienda</th>
                    <th>Email</th>
                    <th>Settore</th>
                    <th>Provenienza</th>
                    <th>Stato</th>
                    <th>Conversione</th>
                  </tr>
                </thead>
                <tbody>
                  {d.richieste.map((x) => (
                    <tr key={x.id}>
                      <td>{formattaDataOra(x.creataIl)}</td>
                      <td>{x.nome}</td>
                      <td>{x.azienda}</td>
                      <td>{x.email}</td>
                      <td>{x.settore}</td>
                      <td className="cn-cella-doppia">
                        {x.conClic ? "annuncio (clic)" : x.utmSource ?? "—"}
                        {x.utmCampaign && <small>{x.utmCampaign}</small>}
                      </td>
                      <td>
                        <Badge tono={TONO_STATO[x.stato]}>{ETICHETTA_STATO[x.stato]}</Badge>
                      </td>
                      <td>{x.stato === "confirmed" ? <Badge tono={TONO_STATO_ADS[x.statoAds]}>{ETICHETTA_STATO_ADS[x.statoAds]}</Badge> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {d.troncato && <p className="cn-nota">Si vedono le richieste più recenti del periodo; i totali sopra si riferiscono a queste.</p>}
          <p className="cn-nota">Una persona può fare più richieste: ognuna è una riga a parte, lo storico non si sovrascrive.</p>
        </Pannello>
      </div>
    </>
  );
}
