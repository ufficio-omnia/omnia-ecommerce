import type { DatiTenderIntelligenceConsole } from "@/lib/console/tender-intelligence";
import { AZIONI_RADAR, LIMITI_PREDEFINITI, PREFISSO_COSTO, PREFISSO_LIMITE, type AzioneRadar, type NomeLimite } from "@/lib/radar/diritto-calcoli";
import type { StatoFonte } from "@/lib/radar/fonti/tipi";
import { eseguiGiroPvl, eseguiGiroTed, impostaFontePvl, impostaFonteTed, impostaImpresaRadar, salvaParametriRadar } from "../azioni/tender-intelligence";
import { CHIAVI_LIMITI_PVL, LIMITI_PVL_INTERVALLI } from "@/lib/radar/fonti/pvl-calcoli";
import { ETICHETTE_LIMITI_PVL } from "@/lib/console/tender-intelligence-calcoli";
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
  "fonte:pvl:attiva": "Fonte PVL (staging)",
  "cliente:attivo": "Modulo per l'impresa",
};

function etichettaOggetto(o: string): string {
  if (ETICHETTA_OGGETTO[o]) return ETICHETTA_OGGETTO[o];
  if (o.startsWith(`parametro:${PREFISSO_COSTO}`)) return `Costo: ${ETICHETTA_AZIONE[o.slice(`parametro:${PREFISSO_COSTO}`.length) as AzioneRadar] ?? o}`;
  if (o.startsWith(`parametro:${PREFISSO_LIMITE}`)) return `Limite: ${ETICHETTA_LIMITE[o.slice(`parametro:${PREFISSO_LIMITE}`.length) as NomeLimite] ?? o}`;
  const pvl = (Object.entries(CHIAVI_LIMITI_PVL) as [keyof typeof CHIAVI_LIMITI_PVL, string][]).find(([, c]) => o === `parametro:${c}`);
  if (pvl) return `PVL: ${ETICHETTE_LIMITI_PVL[pvl[0]]}`;
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

function secondi(ms: number): string {
  return `${(ms / 1000).toLocaleString("it-IT", { maximumFractionDigits: 1 })} s`;
}

const MOTIVI_ESCLUSIONE_PVL: Record<string, string> = {
  modifica_contrattuale: "modifiche contrattuali",
  indagine_o_negoziata: "indagini di mercato e negoziate senza bando",
  affidamento: "affidamenti diretti e adesioni",
  altra_scheda: "altri avvisi (esecuzione, elenchi…)",
  fuori_settore: "fuori dai sei settori",
  oscurato: "oscurati",
  avviso_malformato: "malformati",
  senza_oggetto: "senza oggetto",
};

const CAMPI_MANCANTI_PVL: Record<string, string> = {
  cpv_non_riconosciuto: "CPV non del file approvato",
  scadenza: "scadenza",
  valore: "valore",
  documenti: "collegamento ai documenti",
  cig: "CIG",
  regione: "regione",
};

function elenco(m: Record<string, number>, etichette: Record<string, string>): string {
  const voci = Object.entries(m).filter(([, v]) => v > 0);
  return voci.length ? voci.map(([k, v]) => `${numero(v)} ${etichette[k] ?? k.replaceAll("_", " ")}`).join(", ") : "nessuno";
}

// Connettore PVL di ANAC (fase B1-bis, SOLO STAGING): stato e sospensione, giri programmati (configurati, non attivi), ultimo giro con
// richieste, gare importate, doppioni TED/PVL evitati, rettifiche, errori e tempi; limiti di cortesia modificabili entro intervalli fissi.
function SezionePvl({ pvl, attiva }: { pvl: NonNullable<DatiTenderIntelligenceConsole["pvl"]>; attiva: boolean }) {
  const g = pvl.ultimoGiro;
  return (
    <>
      <div className="cn-colonne cn-colonne-pari">
        <Pannello titolo="Fonte PVL di ANAC (solo staging)">
          <p className="cn-nota">
            Stato: <strong>{attiva ? "accesa" : pvl.sospensione ? "sospesa" : "spenta"}</strong>
            {pvl.inCorso ? " · giro da continuare" : ""}
            {pvl.ultimoGiorno ? ` · avvisi letti fino al ${data(pvl.ultimoGiorno)}` : ""} · database: {pvl.ambiente}
          </p>
          {pvl.sospensione && !attiva && (
            <p className="cn-esito avviso" role="alert">
              Sospesa dal connettore il {data(pvl.sospensione.il)}: {pvl.sospensione.motivo ?? "motivo non registrato"}. Si riaccende solo da qui, dopo averne verificato la causa.
            </p>
          )}
          {pvl.accensioneConsentita || attiva ? (
            <ModuloAzione azione={impostaFontePvl} etichetta={attiva ? "Spegni la fonte" : "Accendi la fonte"} etichettaInCorso="Salvo…" campi={{ azione: attiva ? "spegni" : "accendi" }}>
              <span className="cn-nota">Uso sperimentale autorizzato solo sullo staging; non è un&apos;autorizzazione di ANAC né del riuso commerciale.</span>
            </ModuloAzione>
          ) : (
            <p className="cn-nota">Accensione non consentita in questo database: la PVL è autorizzata solo sullo staging.</p>
          )}
          {attiva && (
            <ModuloAzione azione={eseguiGiroPvl} etichetta="Esegui un giro adesso" etichettaInCorso="Leggo… (fino a 50 s)">
              <span className="cn-nota">Dall&apos;ultimo giorno letto meno uno a oggi, entro il tetto di richieste qui sotto.</span>
            </ModuloAzione>
          )}
          <p className="cn-nota">
            Giri programmati alle {pvl.giriProgrammati.orari} ora italiana (ora legale compresa):{" "}
            {pvl.giriProgrammati.attivi ? (
              <>
                <strong>attivi</strong>, prossimo il {data(pvl.giriProgrammati.prossimo)}
              </>
            ) : (
              <>
                <strong>configurati ma non attivi</strong> (servono l&apos;autorizzazione operativa, la riga «{pvl.giriProgrammati.cronProposto}» in vercel.json e RADAR_PVL_CRON=attivo). Se attivi, il prossimo sarebbe il {data(pvl.giriProgrammati.prossimo)}
              </>
            )}
            .
          </p>
          <p className="cn-nota">
            Archivio: {numero(pvl.archivio.avvisi)} avvisi letti dalla PVL, {numero(pvl.archivio.gareNateDallaPvl)} gare arrivate prima (o solo) dalla PVL, {numero(pvl.archivio.avvisiCheCitanoTed)} avvisi che citano un avviso TED (stessa gara, nessun doppione), {numero(pvl.archivio.cambiamentiPvl)} rettifiche, proroghe, annullamenti ed esiti registrati dalla PVL.
          </p>
        </Pannello>

        <Pannello titolo="Limiti verso la PVL">
          <ModuloAzione azione={salvaParametriRadar} etichetta="Salva i limiti PVL" etichettaInCorso="Salvo…" classe="cn-modulo">
            {(Object.keys(CHIAVI_LIMITI_PVL) as (keyof typeof CHIAVI_LIMITI_PVL)[]).map((k) => (
              <div key={k} className="cn-campo">
                <label className="cn-etichetta" htmlFor={`pvl-${k}`}>
                  {ETICHETTE_LIMITI_PVL[k]}{" "}
                  <span className="cn-nota">
                    (da {numero(LIMITI_PVL_INTERVALLI[k].min)} a {numero(LIMITI_PVL_INTERVALLI[k].max)})
                  </span>
                </label>
                <input id={`pvl-${k}`} name={CHIAVI_LIMITI_PVL[k]} inputMode="numeric" className="cn-input" defaultValue={String(pvl.limiti[k])} />
              </div>
            ))}
          </ModuloAzione>
          <p className="cn-nota">Su 401, 403 o 429, o su una risposta che non sono i dati attesi, il connettore si sospende da solo e non ripete la richiesta.</p>
        </Pannello>
      </div>

      {g && (
        <div className="cn-sezione">
          <Pannello titolo="Ultimo giro PVL">
            <div className="cn-scorri">
              <table className="cn-tab">
                <tbody>
                  <tr>
                    <th>Iniziato</th>
                    <td>
                      {data(g.iniziato_il)} · {g.modo === "finestra" ? "finestra controllata" : "giro incrementale"} dal {data(g.finestra.da)} al {data(g.finestra.a)} · durata {secondi(g.durata_ms)} · {g.giro_finito ? "finito" : "da continuare"}
                      {g.errore ? ` · interrotto: ${g.errore}` : ""}
                    </td>
                  </tr>
                  <tr>
                    <th>Richieste alla PVL</th>
                    <td>
                      {numero(g.pvl.richieste)} (
                      {Object.entries(g.pvl.risposte)
                        .map(([stato, n]) => (stato === "rete" ? `${numero(n)} senza risposta` : `${numero(n)} con esito ${stato}`))
                        .join(", ") || "nessuna"}
                      ), {(g.pvl.byte / 1_048_576).toLocaleString("it-IT", { maximumFractionDigits: 1 })} MB, {secondi(g.pvl.ms)} · avvisi dichiarati dalla fonte: {numero(g.pvl.conteggioDichiarato)} · limiti: pausa {secondi(g.limiti.pausaMs)}, tetto {numero(g.limiti.richiesteMassime)} richieste
                    </td>
                  </tr>
                  <tr>
                    <th>Avvisi</th>
                    <td>
                      {numero(g.avvisi.letti)} letti: {numero(g.avvisi.bandi)} bandi, {numero(g.avvisi.esiti)} esiti; esclusi: {elenco(g.avvisi.esclusi, MOTIVI_ESCLUSIONE_PVL)}
                      {g.avvisi.sostituiti && Object.keys(g.avvisi.sostituiti).length > 0 ? ` · sostituiti da un avviso nuovo: ${elenco(g.avvisi.sostituiti, {})}` : ""}
                      {g.avvisi.nonAttivi ? ` · non attivi: ${numero(g.avvisi.nonAttivi)}` : ""}
                    </td>
                  </tr>
                  <tr>
                    <th>Gare</th>
                    <td>
                      {numero(g.bandi.nuoveNazionali)} nuove nazionali, {numero(g.bandi.nuoveSopraSogliaSenzaTed)} sopra soglia non ancora su TED, <strong>{numero(g.bandi.giaPresentiTed)} già presenti da TED</strong> (unite, nessun doppione), {numero(g.bandi.nuoveVersioni)} nuove versioni di gare PVL, {numero(g.bandi.rettifiche)} con rettifiche o proroghe, {numero(g.bandi.annullate)} annullate, {numero(g.bandi.invariati)} già note; {numero(g.bandi.scaduteAllImportazione)} già scadute all&apos;importazione (mai mostrate aperte)
                    </td>
                  </tr>
                  <tr>
                    <th>Lotti e CIG</th>
                    <td>
                      {numero(g.bandi.lotti)} lotti, {numero(g.bandi.cigAssegnati)} CIG nuovi, {numero(g.bandi.cigScartati)} CIG scartati, {numero(g.bandi.lottiNonAllineati)} gare con lotti non allineati, {numero(g.bandi.conflitti)} conflitti tra riferimenti, {numero(g.bandi.aggiunteCollegate)} gare aggiunte a mano collegate
                    </td>
                  </tr>
                  <tr>
                    <th>Dati mancanti</th>
                    <td>{elenco(g.bandi.mancanti, CAMPI_MANCANTI_PVL)}</td>
                  </tr>
                  <tr>
                    <th>Esiti</th>
                    <td>
                      {numero(g.esiti.letti)} letti, {numero(g.esiti.applicati)} applicati, {numero(g.esiti.senzaGara)} senza la gara in archivio, {numero(g.esiti.invariati)} già noti
                    </td>
                  </tr>
                  <tr>
                    <th>Database</th>
                    <td>
                      {numero(g.db.richiesteDb)} richieste, {secondi(g.db.msDb)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Pannello>
        </div>
      )}
    </>
  );
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

      {dati.pvl && <SezionePvl pvl={dati.pvl} attiva={dati.fonti.find((f) => f.id === "pvl")?.db?.attiva === true} />}

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
