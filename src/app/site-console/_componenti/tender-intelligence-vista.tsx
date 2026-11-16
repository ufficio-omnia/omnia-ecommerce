import type { DatiTenderIntelligenceConsole } from "@/lib/console/tender-intelligence";
import { AZIONI_RADAR, LIMITI_PREDEFINITI, type AzioneRadar, type NomeLimite } from "@/lib/radar/diritto-calcoli";
import type { StatoFonte } from "@/lib/radar/fonti/tipi";
import { Badge, Pannello, Tessera, type Tono } from "./elementi";

// Vista della pagina «Tender Intelligence» (fase A, sola lettura): il modulo è in costruzione e spento per i clienti. Le modifiche di
// interruttori, costi e limiti arriveranno con la fase B; oggi i valori si leggono da console_impostazioni (migrazione 0111).

const ETICHETTA_AZIONE: Record<AzioneRadar, string> = {
  ricerca: "Ricerca",
  sintesi: "Sintesi in linguaggio semplice",
  analisi_requisiti: "Analisi dei requisiti",
  intelligence: "Intelligence",
  crea_offerta: "Creazione dell'offerta tecnica",
  aggiungi_manuale: "Gara aggiunta a mano",
  monitora: "Monitoraggio",
};

const ETICHETTA_LIMITE: Record<NomeLimite, string> = {
  progetti_senza_analisi: "Progetti dal Radar senza analisi (per impresa)",
  ricerche_minuto: "Ricerche al minuto (per impresa)",
  sintesi_giorno: "Sintesi al giorno (per impresa)",
  analisi_requisiti_giorno: "Analisi dei requisiti al giorno (per impresa)",
};

const STATO_FONTE: Record<StatoFonte, { testo: string; tono: Tono }> = {
  attiva: { testo: "attiva", tono: "ok" },
  in_costruzione: { testo: "in costruzione", tono: "avviso" },
  transitoria: { testo: "transitoria", tono: "avviso" },
  prevista: { testo: "prevista", tono: "neutro" },
};

function data(valore: string | null): string {
  if (!valore) return "—";
  const d = new Date(valore);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("it-IT", { timeZone: "Europe/Rome", dateStyle: "short", timeStyle: "short" });
}

function numero(n: number | null): string {
  return n === null ? "—" : n.toLocaleString("it-IT");
}

export default function TenderIntelligenceVista({ dati }: { dati: DatiTenderIntelligenceConsole }) {
  const { parametri } = dati;
  const inCoda = dati.coda ? dati.coda.in_coda + dati.coda.in_corso : null;
  const conErrori = dati.fonti.some((f) => f.db?.ultimo_errore);

  return (
    <>
      <div className="cn-testata">
        <div>
          <h1>Tender Intelligence</h1>
          <p>Scouting delle gare: fonti, archivio, coda delle elaborazioni e utilizzi. Il modulo è in costruzione e spento per i clienti.</p>
        </div>
      </div>

      {!dati.schemaPresente && (
        <p className="cn-esito avviso" role="alert" style={{ marginBottom: 14 }}>
          Le migrazioni 0109, 0110 e 0111 non sono eseguite in questo database: fonti, archivio e coda non esistono ancora. Il resto della console funziona come prima.
        </p>
      )}

      <div className="cn-tessere">
        <Tessera etichetta="Modulo per i clienti" valore={parametri.attivo ? "Acceso" : "Spento"} tono={parametri.attivo ? "avviso" : "neutro"} dettaglio="Interruttore generale (radar_attivo)" />
        <Tessera etichetta="Imprese abilitate" valore={numero(dati.clientiAbilitati)} dettaglio="Interruttore per cliente acceso" />
        <Tessera etichetta="Gare in archivio" valore={numero(dati.procedure)} dettaglio={dati.procedureAperte === null ? undefined : `${numero(dati.procedureAperte)} aperte`} />
        <Tessera etichetta="Elaborazioni da fare" valore={numero(inCoda)} dettaglio={dati.coda ? `${numero(dati.coda.fallito)} fallite` : undefined} tono={dati.coda && dati.coda.fallito > 0 ? "avviso" : "neutro"} />
      </div>

      <div className="cn-sezione">
        <Pannello titolo="Fonti">
          <div className="cn-scorri">
            <table className="cn-tab">
              <thead>
                <tr>
                  <th>Fonte</th>
                  <th>Stato</th>
                  <th>Copertura</th>
                  <th>Aggiornamento</th>
                  <th>Ultima lettura</th>
                  <th>Dati al</th>
                  {conErrori && <th>Ultimo errore</th>}
                </tr>
              </thead>
              <tbody>
                {dati.fonti.flatMap((f) => [
                  <tr key={f.id}>
                    <td>
                      <strong>{f.nome}</strong>
                    </td>
                    <td>
                      <Badge tono={STATO_FONTE[f.stato].tono}>{STATO_FONTE[f.stato].testo}</Badge>
                    </td>
                    <td>{f.copertura}</td>
                    <td>{f.aggiornamento}</td>
                    <td>{data(f.db?.ultimo_successo_il ?? null)}</td>
                    <td>{data(f.db?.dati_aggiornati_al ?? null)}</td>
                    {conErrori && <td>{f.db?.ultimo_errore ? `${data(f.db.ultimo_errore_il)}: ${f.db.ultimo_errore}` : "—"}</td>}
                  </tr>,
                  <tr key={`${f.id}-limiti`}>
                    <td colSpan={conErrori ? 7 : 6} className="cn-nota-inline">
                      Limiti: {f.limiti.join(" · ")}. Licenza: {f.licenza}.
                    </td>
                  </tr>,
                ])}
              </tbody>
            </table>
          </div>
        </Pannello>
      </div>

      <div className="cn-colonne cn-colonne-pari">
        <Pannello titolo="Costo in crediti per azione">
          <div className="cn-scorri">
            <table className="cn-tab">
              <thead>
                <tr>
                  <th>Azione</th>
                  <th className="num">Crediti</th>
                </tr>
              </thead>
              <tbody>
                {AZIONI_RADAR.map((a) => (
                  <tr key={a}>
                    <td>{ETICHETTA_AZIONE[a]}</td>
                    <td className="num">{parametri.costi[a]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="cn-nota">Zero = nessun addebito. Il contatore delle gare del piano è separato e non cambia.</p>
        </Pannello>

        <Pannello titolo="Limiti tecnici per impresa">
          <div className="cn-scorri">
            <table className="cn-tab">
              <thead>
                <tr>
                  <th>Limite</th>
                  <th className="num">Valore</th>
                  <th className="num">Predefinito</th>
                </tr>
              </thead>
              <tbody>
                {(Object.keys(LIMITI_PREDEFINITI) as NomeLimite[]).map((n) => (
                  <tr key={n}>
                    <td>{ETICHETTA_LIMITE[n]}</td>
                    <td className="num">{parametri.limiti[n]}</td>
                    <td className="num">{LIMITI_PREDEFINITI[n]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="cn-nota">Un singolo cliente può avere valori dedicati (omnia_ai_radar_impostazioni).</p>
        </Pannello>
      </div>

      <div className="cn-sezione">
        <Pannello titolo="Utilizzi degli ultimi 30 giorni">
          {dati.utilizzi30Giorni ? (
            <div className="cn-scorri">
              <table className="cn-tab">
                <thead>
                  <tr>
                    <th>Azione</th>
                    <th className="num">Volte</th>
                    <th className="num">Crediti addebitati</th>
                    <th className="num">Costo AI stimato ($)</th>
                  </tr>
                </thead>
                <tbody>
                  {dati.utilizzi30Giorni.map((u) => (
                    <tr key={u.azione}>
                      <td>{ETICHETTA_AZIONE[u.azione]}</td>
                      <td className="num">{u.numero.toLocaleString("it-IT")}</td>
                      <td className="num">{u.crediti.toLocaleString("it-IT")}</td>
                      <td className="num">{u.costoAi.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="cn-nota">Utilizzi non disponibili in questo database.</p>
          )}
        </Pannello>
      </div>
    </>
  );
}
