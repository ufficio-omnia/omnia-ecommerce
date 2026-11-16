import type { DatiTenderIntelligenceConsole } from "@/lib/console/tender-intelligence";
import { AZIONI_RADAR, LIMITI_PREDEFINITI, PREFISSO_COSTO, PREFISSO_LIMITE, type AzioneRadar, type NomeLimite } from "@/lib/radar/diritto-calcoli";
import type { StatoFonte } from "@/lib/radar/fonti/tipi";
import { eseguiGiroTed, impostaFonteTed, impostaImpresaRadar, salvaParametriRadar } from "../azioni/tender-intelligence";
import { Badge, Pannello, Tessera, type Tono } from "./elementi";
import ModuloAzione from "./modulo-azione";

// Vista della pagina «Tender Intelligence». Fase B1: interruttore generale, costi e limiti modificabili (solo amministratori, validati nel
// server, ogni modifica nel registro con autore, data, valore precedente e nuovo), fonte TED accendibile con giro manuale e misure dell'ultimo
// giro, imprese abilitate una per una. Il modulo resta spento per i clienti finché l'interruttore generale e quello dell'impresa sono spenti.

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

const ETICHETTA_OGGETTO: Record<string, string> = {
  "parametro:radar_attivo": "Interruttore generale del modulo",
  "fonte:ted:attiva": "Fonte TED",
  "cliente:attivo": "Modulo per l'impresa",
};

function etichettaOggetto(o: string): string {
  if (ETICHETTA_OGGETTO[o]) return ETICHETTA_OGGETTO[o];
  if (o.startsWith(`parametro:${PREFISSO_COSTO}`)) return `Costo: ${ETICHETTA_AZIONE[o.slice(`parametro:${PREFISSO_COSTO}`.length) as AzioneRadar] ?? o}`;
  if (o.startsWith(`parametro:${PREFISSO_LIMITE}`)) return `Limite: ${ETICHETTA_LIMITE[o.slice(`parametro:${PREFISSO_LIMITE}`.length) as NomeLimite] ?? o}`;
  return o;
}

function valoreLeggibile(oggetto: string, v: string | null): string {
  if (v === null) return "—";
  if (oggetto === "parametro:radar_attivo") return v === "1" ? "acceso" : "spento";
  if (v === "true") return "acceso";
  if (v === "false") return "spento";
  return v;
}

function data(valore: string | null): string {
  if (!valore) return "—";
  const d = new Date(valore.length === 10 ? `${valore}T12:00:00Z` : valore);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("it-IT", { timeZone: "Europe/Rome", dateStyle: "short", ...(valore.length === 10 ? {} : { timeStyle: "short" }) });
}

function numero(n: number | null): string {
  return n === null ? "—" : n.toLocaleString("it-IT");
}

export default function TenderIntelligenceVista({ dati }: { dati: DatiTenderIntelligenceConsole }) {
  const { parametri } = dati;
  const inCoda = dati.coda ? dati.coda.in_coda + dati.coda.in_corso : null;
  const conErrori = dati.fonti.some((f) => f.db?.ultimo_errore);
  const tedAttiva = dati.fonti.find((f) => f.id === "ted")?.db?.attiva === true;
  const giro = dati.ted?.ultimoGiro ?? null;

  return (
    <>
      <div className="cn-testata">
        <div>
          <h1>Tender Intelligence</h1>
          <p>Scouting delle gare: fonti, archivio, imprese abilitate, costi e limiti. Il modulo si vede solo con l&apos;interruttore generale acceso e l&apos;impresa abilitata.</p>
        </div>
      </div>

      {!dati.schemaPresente && (
        <p className="cn-esito avviso" role="alert" style={{ marginBottom: 14 }}>
          Le migrazioni di Tender Intelligence (0109–0113) non sono eseguite in questo database: fonti, archivio e coda non esistono ancora. Il resto della console funziona come prima.
        </p>
      )}

      <div className="cn-tessere">
        <Tessera etichetta="Modulo per i clienti" valore={parametri.attivo ? "Acceso" : "Spento"} tono={parametri.attivo ? "avviso" : "neutro"} dettaglio="Interruttore generale (radar_attivo)" />
        <Tessera etichetta="Imprese abilitate" valore={numero(dati.clientiAbilitati)} dettaglio="Interruttore per impresa acceso" />
        <Tessera etichetta="Gare in archivio" valore={numero(dati.procedure)} dettaglio={dati.procedureAperte === null ? undefined : `${numero(dati.procedureAperte)} aperte adesso`} />
        <Tessera etichetta="Elaborazioni da fare" valore={numero(inCoda)} dettaglio={dati.coda ? `${numero(dati.coda.fallito)} fallite` : undefined} tono={dati.coda && dati.coda.fallito > 0 ? "avviso" : "neutro"} />
      </div>

      {dati.schemaPresente && (
        <div className="cn-colonne cn-colonne-pari">
          <Pannello titolo="Interruttore generale">
            <ModuloAzione azione={salvaParametriRadar} etichetta={parametri.attivo ? "Spegni il modulo" : "Accendi il modulo"} etichettaInCorso="Salvo…" campi={{ radar_attivo: parametri.attivo ? "0" : "1" }} variante={parametri.attivo ? "neutro" : "primario"}>
              <p className="cn-nota">
                Oggi è <strong>{parametri.attivo ? "acceso" : "spento"}</strong>. Acceso non basta: ogni impresa va abilitata qui sotto. Spento, la voce «Opportunità» sparisce per tutti entro pochi secondi.
              </p>
            </ModuloAzione>
          </Pannello>

          <Pannello titolo="Fonte TED">
            <p className="cn-nota">
              Stato: <strong>{tedAttiva ? "accesa" : "spenta"}</strong>
              {dati.ted?.fase ? ` · ${dati.ted.fase}` : ""}
              {dati.ted?.recuperoCompletatoIl ? ` · storico di 12 mesi recuperato il ${data(dati.ted.recuperoCompletatoIl)}` : ""}
              {dati.ted?.ultimoGiorno ? ` · avvisi letti fino al ${data(dati.ted.ultimoGiorno)}` : ""}
            </p>
            <ModuloAzione azione={impostaFonteTed} etichetta={tedAttiva ? "Spegni la fonte" : "Accendi la fonte"} etichettaInCorso="Salvo…" campi={{ azione: tedAttiva ? "spegni" : "accendi" }}>
              <span className="cn-nota">Importazione automatica nei giorni feriali alle 9:15 UTC (cron), solo con la fonte accesa.</span>
            </ModuloAzione>
            {tedAttiva && (
              <ModuloAzione azione={eseguiGiroTed} etichetta="Esegui un giro adesso" etichettaInCorso="Importo… (fino a 50 s)">
                <span className="cn-nota">Al massimo 10 pagine e 50 secondi; il resto riprende al giro successivo dal punto salvato.</span>
              </ModuloAzione>
            )}
          </Pannello>
        </div>
      )}

      {giro && (
        <div className="cn-sezione">
          <Pannello titolo="Ultimo giro di importazione TED">
            <div className="cn-scorri">
              <table className="cn-tab">
                <tbody>
                  <tr>
                    <th>Iniziato</th>
                    <td>
                      {data(giro.iniziato_il)} · {giro.fase === "recupero" ? "recupero dello storico" : "sincronizzazione"} · durata {(giro.durata_ms / 1000).toLocaleString("it-IT", { maximumFractionDigits: 1 })} s · {giro.giro_finito ? "finito" : "da continuare"}
                      {giro.errore ? ` · interrotto: ${giro.errore}` : ""}
                    </td>
                  </tr>
                  <tr>
                    <th>Avvisi di gara</th>
                    <td>
                      {numero(giro.bandi.letti)} letti: {numero(giro.bandi.nuove)} gare nuove, {numero(giro.bandi.aggiornate)} aggiornate, {numero(giro.bandi.rettifiche)} con rettifiche o proroghe, {numero(giro.bandi.annullate)} annullate, {numero(giro.bandi.invariati)} già note;{" "}
                      {Object.entries(giro.bandi.esclusi)
                        .map(([k, v]) => `${numero(v)} ${k === "fuori_settore" ? "fuori dai sei settori" : k.replaceAll("_", " ")}`)
                        .join(", ") || "nessuno escluso"}
                    </td>
                  </tr>
                  <tr>
                    <th>Esiti</th>
                    <td>
                      {numero(giro.esiti.letti)} letti, {numero(giro.esiti.applicati)} applicati, {numero(giro.esiti.senzaBando)} senza il bando in archivio
                    </td>
                  </tr>
                  <tr>
                    <th>Risorse</th>
                    <td>
                      TED: {numero(giro.ted.richieste)} richieste, {(giro.ted.byte / 1_048_576).toLocaleString("it-IT", { maximumFractionDigits: 1 })} MB, {(giro.ted.ms / 1000).toLocaleString("it-IT", { maximumFractionDigits: 1 })} s · Database: {numero(giro.db.richiesteDb)} richieste, {(giro.db.msDb / 1000).toLocaleString("it-IT", { maximumFractionDigits: 1 })} s
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Pannello>
        </div>
      )}

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
                      {f.db?.attiva ? <Badge tono="ok">accesa</Badge> : <Badge tono={STATO_FONTE[f.stato].tono}>{STATO_FONTE[f.stato].testo}</Badge>}
                    </td>
                    <td>{f.copertura}</td>
                    <td>{f.aggiornamento}</td>
                    <td>{data(f.db?.ultimo_successo_il ?? null)}</td>
                    <td>{data(f.db?.dati_aggiornati_al ? new Date(f.db.dati_aggiornati_al).toLocaleDateString("en-CA", { timeZone: "Europe/Rome" }) : null)}</td>
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

      {dati.schemaPresente && (
        <div className="cn-sezione">
          <Pannello titolo="Imprese abilitate">
            <ModuloAzione azione={impostaImpresaRadar} etichetta="Salva" etichettaInCorso="Salvo…" svuota>
              <label className="cn-etichetta" htmlFor="ti-email">
                Email del titolare dell&apos;impresa
              </label>
              <input id="ti-email" name="email" type="email" required className="cn-input" placeholder="titolare@impresa.it" />
              <select name="azione" className="cn-input" defaultValue="abilita" aria-label="Abilita o disabilita">
                <option value="abilita">Abilita il modulo</option>
                <option value="disabilita">Disabilita il modulo</option>
              </select>
            </ModuloAzione>
            {dati.imprese && dati.imprese.length > 0 ? (
              <div className="cn-scorri">
                <table className="cn-tab">
                  <thead>
                    <tr>
                      <th>Impresa (titolare)</th>
                      <th>Modulo</th>
                      <th>Ultima modifica</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dati.imprese.map((i) => (
                      <tr key={i.email}>
                        <td>{i.email}</td>
                        <td>{i.attivo ? <Badge tono="ok">abilitato</Badge> : <Badge tono="neutro">disabilitato</Badge>}</td>
                        <td>
                          {data(i.aggiornataIl)} · {i.aggiornataDa}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="cn-nota">Nessuna impresa abilitata.</p>
            )}
          </Pannello>
        </div>
      )}

      <div className="cn-colonne cn-colonne-pari">
        <Pannello titolo="Costo in crediti per azione">
          <ModuloAzione azione={salvaParametriRadar} etichetta="Salva i costi" etichettaInCorso="Salvo…" classe="cn-modulo">
            {AZIONI_RADAR.map((a) => (
              <div key={a} className="cn-campo">
                <label className="cn-etichetta" htmlFor={`costo-${a}`}>
                  {ETICHETTA_AZIONE[a]}
                </label>
                <input id={`costo-${a}`} name={`${PREFISSO_COSTO}${a}`} inputMode="numeric" className="cn-input" defaultValue={String(parametri.costi[a])} />
              </div>
            ))}
          </ModuloAzione>
          <p className="cn-nota">Interi da 0 a 1.000. Zero = nessun addebito. Il contatore delle gare del piano è separato e non cambia.</p>
        </Pannello>

        <Pannello titolo="Limiti tecnici per impresa">
          <ModuloAzione azione={salvaParametriRadar} etichetta="Salva i limiti" etichettaInCorso="Salvo…" classe="cn-modulo">
            {(Object.keys(LIMITI_PREDEFINITI) as NomeLimite[]).map((n) => (
              <div key={n} className="cn-campo">
                <label className="cn-etichetta" htmlFor={`limite-${n}`}>
                  {ETICHETTA_LIMITE[n]} <span className="cn-nota">(predefinito {LIMITI_PREDEFINITI[n]})</span>
                </label>
                <input id={`limite-${n}`} name={`${PREFISSO_LIMITE}${n}`} inputMode="numeric" className="cn-input" defaultValue={String(parametri.limiti[n])} />
              </div>
            ))}
          </ModuloAzione>
          <p className="cn-nota">Interi da 0 a 100.000. Un singolo cliente può avere valori dedicati (omnia_ai_radar_impostazioni).</p>
        </Pannello>
      </div>

      {dati.registro && (
        <div className="cn-sezione">
          <Pannello titolo="Registro delle modifiche">
            {dati.registro.length === 0 ? (
              <p className="cn-nota">Nessuna modifica registrata.</p>
            ) : (
              <div className="cn-scorri">
                <table className="cn-tab">
                  <thead>
                    <tr>
                      <th>Quando</th>
                      <th>Chi</th>
                      <th>Che cosa</th>
                      <th>Prima</th>
                      <th>Dopo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dati.registro.map((r, i) => (
                      <tr key={`${r.il}-${i}`}>
                        <td>{data(r.il)}</td>
                        <td>{r.autore}</td>
                        <td>
                          {etichettaOggetto(r.oggetto)}
                          {r.clienteEmail ? ` · ${r.clienteEmail}` : ""}
                        </td>
                        <td>{valoreLeggibile(r.oggetto, r.prima)}</td>
                        <td>{valoreLeggibile(r.oggetto, r.dopo)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Pannello>
        </div>
      )}

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
