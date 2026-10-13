import type { RiepilogoBonifici } from "@/lib/console/ordini";
import type { StatoAzione } from "../azioni/ordini";
import AvvisoEsito, { type ParametriEsito } from "./avviso-esito";
import { BadgeScadenza, Pannello, Tessera } from "./elementi";
import { formattaData, formattaEuro } from "./formati";
import PulsanteAzione from "./pulsante-azione";

// Vista pura della pagina Bonifici: riceve dati già letti e l'azione di
// conferma come prop (la pagina, che richiede l'admin, la importa).

export default function BonificiVista({
  dati,
  esito,
  azioneConferma,
}: {
  dati: RiepilogoBonifici;
  esito: ParametriEsito;
  azioneConferma: (stato: StatoAzione, dati: FormData) => Promise<StatoAzione>;
}) {
  return (
    <>
      <div className="cn-testata">
        <div>
          <h1>Bonifici da confermare</h1>
          <p>
            Ordini con bonifico in attesa di accredito, dal più vecchio. Oltre sette giorni lavorativi l&apos;ordine può
            essere annullato (condizioni di vendita).
          </p>
        </div>
      </div>

      <AvvisoEsito {...esito} />

      {dati.errore && (
        <p className="cn-esito errore" role="alert" style={{ marginBottom: 14 }}>
          {dati.errore}
        </p>
      )}

      <div className="cn-tessere">
        <Tessera
          etichetta="In attesa"
          valore={dati.totale}
          tono={dati.totale > 0 ? "avviso" : "ok"}
          dettaglio={dati.totale > 0 ? "Da confermare dopo aver controllato l'estratto conto" : "Niente da confermare"}
        />
        <Tessera etichetta="Importo in attesa" valore={formattaEuro(dati.importoTotale)} dettaglio="IVA inclusa" />
        <Tessera
          etichetta="Oltre il termine"
          valore={dati.scaduti}
          tono={dati.scaduti > 0 ? "errore" : "neutro"}
          dettaglio={dati.scaduti > 0 ? "Più di 7 giorni lavorativi dall'ordine" : "Nessuno"}
        />
        <Tessera
          etichetta="In scadenza"
          valore={dati.inScadenza}
          tono={dati.inScadenza > 0 ? "avviso" : "neutro"}
          dettaglio="Entro 2 giorni lavorativi dal termine"
        />
      </div>

      <div className="cn-sezione">
        <Pannello titolo={`Ordini in attesa (${dati.totale})`}>
          {dati.righe.length === 0 ? (
            <p className="cn-vuoto">Nessun bonifico in attesa.</p>
          ) : (
            <div className="cn-scorri">
              <table className="cn-tab">
                <thead>
                  <tr>
                    <th>Causale</th>
                    <th>Cliente</th>
                    <th>Prodotto</th>
                    <th className="num">Importo</th>
                    <th>Ordinato il</th>
                    <th className="num">Gg lav.</th>
                    <th>Termine</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {dati.righe.map((r) => (
                    <tr key={r.id} className={r.stato === "scaduto" ? "cn-riga-errore" : r.stato === "in_scadenza" ? "cn-riga-avviso" : undefined}>
                      <td className="mono" title={r.id}>
                        {r.causale}
                      </td>
                      <td className="cn-cella-doppia">
                        {r.email ?? "—"}
                        {r.ragioneSociale && <small>{r.ragioneSociale}</small>}
                      </td>
                      <td>{r.prodotto ?? "—"}</td>
                      <td className="num">{formattaEuro(r.importo)}</td>
                      <td className="mono">{formattaData(r.creatoIl)}</td>
                      <td className="num">{r.giorniLavorativi}</td>
                      <td className="nowrap">
                        <span className="mono" style={{ marginRight: 8 }}>
                          {formattaData(r.scadenza)}
                        </span>
                        <BadgeScadenza stato={r.stato} giorniRimasti={r.giorniRimasti} />
                      </td>
                      <td>
                        <PulsanteAzione
                          azione={azioneConferma}
                          campi={{ orderId: r.id }}
                          conferma={`Confermare l'accredito di ${formattaEuro(r.importo)} per "${r.causale}"${r.email ? ` (${r.email})` : ""}?\n\nParte subito un'email al cliente e il download si sblocca.`}
                          etichetta="Conferma accredito"
                          etichettaInCorso="Confermo…"
                          variante="primario"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Pannello>
      </div>
    </>
  );
}
