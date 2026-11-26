import Link from "next/link";
import type { DatiTenderIntelligenceConsole } from "@/lib/console/tender-intelligence";
import { AZIONI_RADAR, LIMITI_PREDEFINITI, PREFISSO_COSTO, PREFISSO_LIMITE, type AzioneRadar, type NomeLimite } from "@/lib/radar/diritto-calcoli";
import type { StatoFonte } from "@/lib/radar/fonti/tipi";
import {
  decidiPropostaCollegamento,
  eseguiGiroPvl,
  eseguiGiroRegionale,
  eseguiGiroTed,
  impostaImpresaRadar,
  impostaVisibilitaFonte,
  salvaParametriRadar,
  scollegaGaraDoppia,
} from "../azioni/tender-intelligence";
import { CHIAVI_LIMITI_PVL, LIMITI_PVL_INTERVALLI } from "@/lib/radar/fonti/pvl-calcoli";
import { ETICHETTE_LIMITI_PVL, erroreAncoraAttuale } from "@/lib/console/tender-intelligence-calcoli";
import {
  FRASE_ACCENSIONE_NON_CONSENTITA,
  FRASE_COSTI,
  FRASE_ESEGUI_GIRO,
  FRASE_IMPRESE,
  FRASE_INTERRUTTORE_GENERALE,
  FRASE_LIMITE,
  FRASE_LIMITE_PVL,
  FRASE_VISIBILITA,
  LIMITI_IN_USO,
  LIMITI_NON_IN_USO,
} from "@/lib/console/tender-intelligence-testi";
import { Badge, Pannello, Tessera, type Tono } from "./elementi";
import ModuloAzione from "./modulo-azione";
import GareInVerifica from "./gare-in-verifica";

// Console «Tender Intelligence», riordinata il 25/11/2026 (proposta B1 43, via dell'utente: pagine separate con una barra di schede comune).
// Panoramica, Fonti (pagina /tender-intelligence/fonti, fonti-vista.tsx, che usa i dettagli esportati qui), Modulo e clienti, Gare da
// controllare, Registro, Email non consegnate. Solo impaginazione e testi: le azioni del server (guardie degli amministratori, conferma nel
// server per accendere, registro 0112, regole dell'ambiente) sono quelle di prima, in azioni/tender-intelligence.ts.

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
  "fonte:pvl:attiva": "Fonte PVL",
  "fonte:pvl:ripresa_recupero": "Ripresa del recupero PVL",
  "gara:collegamento": "Collegamento di una gara doppia",
  "gara:suggerimento": "Suggerimento di unione",
  "fonte:sintel:attiva": "Fonte Sintel",
  "fonte:sardegnacat:attiva": "Fonte SardegnaCAT",
  "fonte:sintel:nascosta_ai_clienti": "Sintel nascosta ai clienti",
  "fonte:sardegnacat:nascosta_ai_clienti": "SardegnaCAT nascosta ai clienti",
  "fonte:sintel:giro": "Giro di Sintel dalla console",
  "fonte:sardegnacat:giro": "Giro di SardegnaCAT dalla console",
  "fonte:sater:attiva": "Fonte SATER",
  "fonte:sater:nascosta_ai_clienti": "SATER nascosta ai clienti",
  "fonte:sater:giro": "Giro di SATER dalla console",
  "cliente:attivo": "Modulo per l'impresa",
  "gara:decisione_classificazione": "Decisione su una gara da verificare",
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

// ───── barra di schede comune a tutte le pagine di Tender Intelligence ─────
// Collegamenti scritti per esteso (le prove li cercano nel sorgente); quello della pagina aperta è un testo con aria-current, non un link.
export type SchedaTenderIntelligence = "panoramica" | "fonti" | "modulo" | "gare" | "registro" | "email";

export function SchedeTenderIntelligence({ attiva }: { attiva: SchedaTenderIntelligence }) {
  return (
    <nav className="cn-schede" aria-label="Sezioni di Tender Intelligence">
      <ul>
        <li className="cn-scheda">
          {attiva === "panoramica" ? (
            <span aria-current="page">Panoramica</span>
          ) : (
            <Link href="/tender-intelligence" prefetch={false}>
              Panoramica
            </Link>
          )}
        </li>
        <li className="cn-scheda">
          {attiva === "fonti" ? (
            <span aria-current="page">Fonti</span>
          ) : (
            <Link href="/tender-intelligence/fonti" prefetch={false}>
              Fonti
            </Link>
          )}
        </li>
        <li className="cn-scheda">
          {attiva === "modulo" ? (
            <span aria-current="page">Modulo e clienti</span>
          ) : (
            <Link href="/tender-intelligence/modulo" prefetch={false}>
              Modulo e clienti
            </Link>
          )}
        </li>
        <li className="cn-scheda">
          {attiva === "gare" ? (
            <span aria-current="page">Gare da controllare</span>
          ) : (
            <Link href="/tender-intelligence/gare" prefetch={false}>
              Gare da controllare
            </Link>
          )}
        </li>
        <li className="cn-scheda">
          {attiva === "registro" ? (
            <span aria-current="page">Registro</span>
          ) : (
            <Link href="/tender-intelligence/registro" prefetch={false}>
              Registro
            </Link>
          )}
        </li>
        <li className="cn-scheda">
          {/* fase B4: pagina in sola lettura degli avvisi email non consegnati */}
          {attiva === "email" ? (
            <span aria-current="page">Email non consegnate</span>
          ) : (
            <Link href="/tender-intelligence/email" prefetch={false}>
              Email non consegnate
            </Link>
          )}
        </li>
      </ul>
    </nav>
  );
}

function Testata({ titolo, testo, attiva }: { titolo: string; testo: string; attiva: SchedaTenderIntelligence }) {
  return (
    <>
      <div className="cn-testata">
        <div>
          <h1>{titolo}</h1>
          <p>{testo}</p>
        </div>
      </div>
      <SchedeTenderIntelligence attiva={attiva} />
    </>
  );
}

function AvvisoSchema({ dati }: { dati: DatiTenderIntelligenceConsole }) {
  if (dati.schemaPresente) return null;
  return (
    <p className="cn-esito avviso" role="alert" style={{ marginBottom: 14 }}>
      Le migrazioni di Tender Intelligence (0109–0113) non sono eseguite in questo database: fonti, archivio e coda non esistono ancora. Il resto della console funziona come prima.
    </p>
  );
}

// ───── dettagli delle fonti, per la pagina «Fonti» (fonti-vista.tsx li chiama direttamente: il contenuto resta nell'albero della vista) ─────

function dettagliTed(ti: DatiTenderIntelligenceConsole, attiva: boolean) {
  const giro = ti.ted?.ultimoGiro ?? null;
  return (
    <div className="cn-dettagli-fonte">
      {(ti.ted?.fase || ti.ted?.recuperoCompletatoIl || ti.ted?.ultimoGiorno) && (
        <p className="cn-nota">
          {ti.ted?.fase ? `Fase: ${ti.ted.fase}` : ""}
          {ti.ted?.recuperoCompletatoIl ? ` · storico recuperato il ${data(ti.ted.recuperoCompletatoIl)}` : ""}
          {ti.ted?.ultimoGiorno ? ` · avvisi letti fino al ${data(ti.ted.ultimoGiorno)}` : ""}
        </p>
      )}
      {attiva && (
        <ModuloAzione azione={eseguiGiroTed} etichetta="Esegui un giro adesso" etichettaInCorso="Importo… (fino a 50 s)">
          <span className="cn-nota">{FRASE_ESEGUI_GIRO} Al massimo 10 pagine; il resto riprende al giro successivo dal punto salvato.</span>
        </ModuloAzione>
      )}
      {giro && (
        <details className="cn-dettagli">
          <summary>Dettagli dell&apos;ultimo giro</summary>
          <div className="cn-scorri">
            <table className="cn-tab">
              <tbody>
                <tr>
                  <th>Iniziato</th>
                  <td>
                    {data(giro.iniziato_il)} · {giro.fase === "recupero" ? "recupero dello storico" : "sincronizzazione"} · durata {secondi(giro.durata_ms)} · {giro.giro_finito ? "finito" : "da continuare"}
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
                    TED: {numero(giro.ted.richieste)} richieste, {(giro.ted.byte / 1_048_576).toLocaleString("it-IT", { maximumFractionDigits: 1 })} MB, {secondi(giro.ted.ms)} · Database: {numero(giro.db.richiesteDb)} richieste, {secondi(giro.db.msDb)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

function dettagliPvl(pvl: NonNullable<DatiTenderIntelligenceConsole["pvl"]>, attiva: boolean) {
  const g = pvl.ultimoGiro;
  return (
    <div className="cn-dettagli-fonte">
      <p className="cn-nota">
        {pvl.inCorso ? "Giro da continuare · " : ""}
        {pvl.ultimoGiorno ? `Avvisi letti fino al ${data(pvl.ultimoGiorno)} · ` : ""}
        Archivio: {numero(pvl.archivio.avvisi)} avvisi letti dalla PVL, {numero(pvl.archivio.gareNateDallaPvl)} gare arrivate prima (o solo) dalla PVL, {numero(pvl.archivio.avvisiCheCitanoTed)} avvisi che citano un avviso TED (stessa gara, nessun doppione), {numero(pvl.archivio.cambiamentiPvl)} rettifiche, proroghe, annullamenti ed esiti registrati dalla PVL.
      </p>
      {!pvl.accensioneConsentita && !attiva && <p className="cn-nota">{FRASE_ACCENSIONE_NON_CONSENTITA}</p>}
      {attiva && (
        <ModuloAzione azione={eseguiGiroPvl} etichetta="Esegui un giro adesso" etichettaInCorso="Leggo… (fino a 50 s)">
          <span className="cn-nota">{FRASE_ESEGUI_GIRO} Dall&apos;ultimo giorno letto meno uno a oggi, entro il tetto di richieste dei limiti qui sotto.</span>
        </ModuloAzione>
      )}
      <details className="cn-dettagli">
        <summary>Limiti verso la PVL</summary>
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
              <p className="cn-nota">{FRASE_LIMITE_PVL[k]}</p>
            </div>
          ))}
        </ModuloAzione>
        <p className="cn-nota">Su 401, 403 o 429, o su una risposta che non sono i dati attesi, il connettore si sospende da solo e non ripete la richiesta.</p>
      </details>
      {pvl.collegamenti && (
        <details className="cn-dettagli">
          <summary>{`Gare doppie collegate (${numero(pvl.collegamenti.totale)})`}</summary>
          <p className="cn-nota">
            Stessa gara pubblicata due volte (per esempio una rettifica della PVL letta prima del bando TED): la scheda doppia resta intera nel database, sparisce da elenchi e ricerca e porta a quella che resta. Annullare il collegamento la rende di nuovo visibile; da quel momento non si ricollega più da sola.
          </p>
          {pvl.collegamenti.elenco.length === 0 ? (
            <p className="cn-nota">Nessuna gara collegata.</p>
          ) : (
            <div className="cn-scorri">
              <table className="cn-tab">
                <thead>
                  <tr>
                    <th>Gara collegata</th>
                    <th>Quando e perché</th>
                    <th>Azione</th>
                  </tr>
                </thead>
                <tbody>
                  {pvl.collegamenti.elenco.map((c) => (
                    <tr key={c.id}>
                      <td>
                        {c.titolo}
                        <div className="cn-nota">
                          {c.id} → resta {c.resta}
                        </div>
                      </td>
                      <td>
                        {data(c.il)}
                        {c.motivo ? ` · ${c.motivo}` : ""}
                      </td>
                      <td>
                        <ModuloAzione azione={scollegaGaraDoppia} etichetta="Annulla il collegamento" etichettaInCorso="Annullo…" campi={{ id: c.id }} variante="neutro">
                          <span className="cn-nota">Torna visibile, nulla si cancella.</span>
                        </ModuloAzione>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </details>
      )}
      {g && (
        <details className="cn-dettagli">
          <summary>Dettagli dell&apos;ultimo giro</summary>
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
        </details>
      )}
    </div>
  );
}

function dettagliRegionale(f: NonNullable<DatiTenderIntelligenceConsole["regionali"]>["fonti"][number], attiva: boolean) {
  const g = f.ultimoGiro;
  return (
    <div className="cn-dettagli-fonte">
      <p className="cn-nota">
        Ai clienti: <strong>{f.nascosta ? "nascosta" : "visibile"}</strong>
        {f.datiAl ? ` · dati della fonte al ${data(f.datiAl)}` : ""} · procedure lette in archivio: {numero(f.procedure)}
      </p>
      {/* decisione 48E dell'utente: SardegnaCAT visibile ai clienti come le altre fonti; nascondere una fonte resta possibile da qui */}
      {f.nascosta && <p className="cn-nota">Nascosta ai clienti: le gare che hanno solo questa fonte non compaiono e i suoi dati non entrano nelle gare già visibili.</p>}
      {!f.accensioneConsentita && !attiva && <p className="cn-nota">{FRASE_ACCENSIONE_NON_CONSENTITA}</p>}
      {attiva && (
        <ModuloAzione azione={eseguiGiroRegionale} etichetta="Esegui un giro adesso" etichettaInCorso="Leggo… (fino a 50 s)" campi={{ fonte: f.fonte }}>
          <span className="cn-nota">{FRASE_ESEGUI_GIRO}</span>
        </ModuloAzione>
      )}
      {f.nascosta ? (
        <ModuloAzione azione={impostaVisibilitaFonte} etichetta="Mostra ai clienti" etichettaInCorso="Salvo…" campi={{ fonte: f.fonte, azione: "mostra" }} variante="neutro">
          <span className="cn-nota">{FRASE_VISIBILITA}</span>
        </ModuloAzione>
      ) : (
        <ModuloAzione azione={impostaVisibilitaFonte} etichetta="Nascondi ai clienti" etichettaInCorso="Salvo…" campi={{ fonte: f.fonte, azione: "nascondi" }} variante="neutro">
          <span className="cn-nota">{FRASE_VISIBILITA}</span>
        </ModuloAzione>
      )}
      {g && (
        <details className="cn-dettagli">
          <summary>Dettagli dell&apos;ultimo giro</summary>
          <p className="cn-nota">
            Ultimo giro del {data(g.iniziato_il)}, {secondi(g.durata_ms)}: {g.invariata_alla_fonte ? "dati invariati alla fonte" : `${numero(g.fonte.richieste)} richieste (${(g.fonte.byte / 1_048_576).toLocaleString("it-IT", { maximumFractionDigits: 1 })} MB); ${numero(g.letti)} procedure lette, ${numero(g.nuove)} gare nuove, ${numero(g.aggiornate)} aggiornate, ${numero(g.invariati)} invariate, ${numero(g.rettifiche)} con rettifiche o proroghe, ${numero(g.collegateDoppie)} gare doppie unite, ${numero(g.proposte)} suggerimenti, ${numero(g.nonApplicateNascosta)} versioni non applicate perché la fonte è nascosta; esclusioni: ${Object.entries(g.esclusi).map(([k, n]) => `${k} ${n}`).join(", ") || "nessuna"}`}
            {g.errore ? ` · errore: ${g.errore}` : ""}
          </p>
        </details>
      )}
    </div>
  );
}

/** I dettagli della scheda di una fonte nella pagina «Fonti»: esecuzione manuale, visibilità, limiti PVL, gare doppie, ultimo giro. */
export function dettagliFonteTi(fonte: string, attiva: boolean, ti: DatiTenderIntelligenceConsole) {
  if (fonte === "ted") return dettagliTed(ti, attiva);
  if (fonte === "pvl") return ti.pvl ? dettagliPvl(ti.pvl, attiva) : null;
  const r = ti.regionali?.fonti.find((x) => x.fonte === fonte);
  return r ? dettagliRegionale(r, attiva) : null;
}

/** Catalogo delle fonti (copertura, aggiornamento, licenza), richiudibile in fondo alla pagina «Fonti». */
export function catalogoFonti(dati: DatiTenderIntelligenceConsole) {
  const conErrori = dati.fonti.some((f) => f.db?.ultimo_errore);
  return (
    <details className="cn-dettagli cn-sezione">
      <summary>Catalogo delle fonti</summary>
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
                {conErrori && <td>{f.db?.ultimo_errore ? (erroreAncoraAttuale(f.db.ultimo_errore_il, f.db.ultimo_successo_il) ? `${data(f.db.ultimo_errore_il)}: ${f.db.ultimo_errore}` : `risolto: ultimo giro riuscito il ${data(f.db.ultimo_successo_il)}`) : "—"}</td>}
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
    </details>
  );
}

// ───── Panoramica (/tender-intelligence): solo lettura, come va e che cosa c'è da fare ─────

const FONTI_DEL_RADAR = ["ted", "pvl", "sintel", "sardegnacat", "sater"];

export default function TenderIntelligenceVista({ dati }: { dati: DatiTenderIntelligenceConsole }) {
  const { parametri } = dati;
  const inCoda = dati.coda ? dati.coda.in_coda + dati.coda.in_corso : null;
  const fonti = FONTI_DEL_RADAR.map((id) => dati.fonti.find((f) => f.id === id)).filter((f): f is DatiTenderIntelligenceConsole["fonti"][number] => !!f);
  const daVerificare = dati.gareInVerifica?.length ?? null;
  const suggerimenti = dati.regionali?.proposte?.length ?? null;
  const conflitti = dati.regionali?.classificazioni?.length ?? null;

  return (
    <>
      <Testata titolo="Tender Intelligence" testo="Scouting delle gare per le imprese abilitate. Il modulo si vede solo con l'interruttore generale acceso e l'impresa abilitata." attiva="panoramica" />
      <AvvisoSchema dati={dati} />

      <div className="cn-tessere">
        <Tessera etichetta="Modulo per i clienti" valore={parametri.attivo ? "Acceso" : "Spento"} tono={parametri.attivo ? "avviso" : "neutro"} dettaglio="Interruttore generale (radar_attivo)" />
        <Tessera etichetta="Imprese abilitate" valore={numero(dati.clientiAbilitati)} dettaglio="Interruttore per impresa acceso" />
        <Tessera etichetta="Gare in archivio" valore={numero(dati.procedure)} dettaglio={[dati.procedureAperte === null ? null : `${numero(dati.procedureAperte)} aperte adesso`, dati.gareCollegate ? `più ${numero(dati.gareCollegate)} copie collegate a un'altra gara (non contate)` : null].filter(Boolean).join(" · ") || undefined} />
        <Tessera etichetta="Elaborazioni da fare" valore={numero(inCoda)} dettaglio={dati.coda ? `${numero(dati.coda.fallito)} fallite` : undefined} tono={dati.coda && dati.coda.fallito > 0 ? "avviso" : "neutro"} />
      </div>

      <div className="cn-colonne cn-colonne-pari">
        <Pannello
          titolo="Fonti"
          azioni={
            <Link href="/tender-intelligence/fonti" prefetch={false}>
              Vai alle fonti →
            </Link>
          }
        >
          {fonti.length === 0 ? (
            <p className="cn-nota">Nessuna fonte nel database.</p>
          ) : (
            <ul className="cn-elenco">
              {fonti.map((f) => (
                <li key={f.id}>
                  <strong>{f.nome}</strong> {f.db?.attiva ? <Badge tono="ok">accesa</Badge> : <Badge tono="neutro">spenta</Badge>}
                  <span className="cn-nota">
                    {` · ultimo giro riuscito: ${data(f.db?.ultimo_successo_il ?? null)}`}
                    {f.db?.ultimo_errore && erroreAncoraAttuale(f.db.ultimo_errore_il, f.db.ultimo_successo_il) ? ` · ultimo errore il ${data(f.db.ultimo_errore_il)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="cn-nota">Stato calcolato, allarmi, accensione e giri sono nella scheda «Fonti».</p>
        </Pannello>

        <Pannello
          titolo="Da fare"
          azioni={
            <Link href="/tender-intelligence/gare" prefetch={false}>
              Vai alle gare →
            </Link>
          }
        >
          <ul className="cn-elenco">
            <li>{`Gare da verificare: ${numero(daVerificare)}`}</li>
            <li>{`Suggerimenti di unione: ${numero(suggerimenti)}`}</li>
            <li>{`Conflitti tra fonti nella classificazione: ${numero(conflitti)}`}</li>
          </ul>
        </Pannello>
      </div>
    </>
  );
}

// ───── Modulo e clienti (/tender-intelligence/modulo) ─────

export function VistaModulo({ dati }: { dati: DatiTenderIntelligenceConsole }) {
  const { parametri } = dati;
  return (
    <>
      <Testata titolo="Modulo e clienti" testo="Chi vede «Opportunità» e con quali limiti. Ogni modifica va nel registro." attiva="modulo" />
      <AvvisoSchema dati={dati} />

      <div className="cn-sezione">
        <Pannello titolo="1. Interruttore generale">
          <ModuloAzione azione={salvaParametriRadar} etichetta={parametri.attivo ? "Spegni il modulo" : "Accendi il modulo"} etichettaInCorso="Salvo…" campi={{ radar_attivo: parametri.attivo ? "0" : "1" }} variante={parametri.attivo ? "neutro" : "primario"}>
            <p className="cn-nota">
              Oggi è <strong>{parametri.attivo ? "acceso" : "spento"}</strong>.
            </p>
          </ModuloAzione>
          <p className="cn-nota">{FRASE_INTERRUTTORE_GENERALE}</p>
        </Pannello>
      </div>

      {dati.schemaPresente && (
        <div className="cn-sezione">
          <Pannello titolo="2. Imprese abilitate">
            <p className="cn-nota">{FRASE_IMPRESE}</p>
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

      <div className="cn-sezione">
        <Pannello titolo="3. Limiti tecnici per impresa">
          <ModuloAzione azione={salvaParametriRadar} etichetta="Salva i limiti" etichettaInCorso="Salvo…" classe="cn-modulo">
            {LIMITI_IN_USO.map((n) => (
              <div key={n} className="cn-campo">
                <label className="cn-etichetta" htmlFor={`limite-${n}`}>
                  {ETICHETTA_LIMITE[n]} <span className="cn-nota">(predefinito {LIMITI_PREDEFINITI[n]})</span>
                </label>
                <input id={`limite-${n}`} name={`${PREFISSO_LIMITE}${n}`} inputMode="numeric" className="cn-input" defaultValue={String(parametri.limiti[n])} />
                <p className="cn-nota">{FRASE_LIMITE[n]}</p>
              </div>
            ))}
          </ModuloAzione>
          <p className="cn-nota">Interi da 0 a 100.000. Un singolo cliente può avere valori dedicati (omnia_ai_radar_impostazioni).</p>
        </Pannello>
      </div>

      <details className="cn-dettagli cn-sezione cn-avanzate">
        <summary>Avanzate</summary>
        <div className="cn-colonne cn-colonne-pari">
          <Pannello titolo="Costo in crediti per azione">
            <p className="cn-nota">{FRASE_COSTI}</p>
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
            <p className="cn-nota">Interi da 0 a 1.000. Zero = nessun addebito.</p>
          </Pannello>

          <Pannello titolo="Limiti delle funzioni non ancora attive">
            <ModuloAzione azione={salvaParametriRadar} etichetta="Salva questi limiti" etichettaInCorso="Salvo…" classe="cn-modulo">
              {LIMITI_NON_IN_USO.map((n) => (
                <div key={n} className="cn-campo">
                  <label className="cn-etichetta" htmlFor={`limite-${n}`}>
                    {ETICHETTA_LIMITE[n]} <span className="cn-nota">(predefinito {LIMITI_PREDEFINITI[n]})</span>
                  </label>
                  <input id={`limite-${n}`} name={`${PREFISSO_LIMITE}${n}`} inputMode="numeric" className="cn-input" defaultValue={String(parametri.limiti[n])} />
                  <p className="cn-nota">{FRASE_LIMITE[n]}</p>
                </div>
              ))}
            </ModuloAzione>
          </Pannello>
        </div>
      </details>
    </>
  );
}

// ───── Gare da controllare (/tender-intelligence/gare): il lavoro dell'amministratore sulle gare ─────

export function VistaGare({ dati }: { dati: DatiTenderIntelligenceConsole }) {
  const regionali = dati.regionali;
  return (
    <>
      <Testata titolo="Gare da controllare" testo="Gare da verificare, suggerimenti di unione e conflitti tra fonti: niente si decide da solo." attiva="gare" />
      <AvvisoSchema dati={dati} />

      {dati.gareInVerifica && <GareInVerifica gare={dati.gareInVerifica} />}

      {regionali?.proposte && (
        <div className="cn-sezione">
          <Pannello titolo={`Suggerimenti di unione da verificare (${numero(regionali.proposte.length)})`}>
            <p className="cn-nota">
              Corrispondenze PROBABILI (stesso ente e stesso giorno di scadenza, un solo candidato per parte): non sono mai unite in automatico. «Unisci» esegue l&apos;unione reversibile (annullabile dall&apos;elenco delle gare collegate nella scheda PVL); «Non sono la stessa gara» le esclude per sempre l&apos;una dall&apos;altra.
            </p>
            {regionali.proposte.length === 0 ? (
              <p className="cn-nota">Nessun suggerimento in attesa.</p>
            ) : (
              <div className="cn-scorri">
                <table className="cn-tab">
                  <thead>
                    <tr>
                      <th>Prima gara</th>
                      <th>Seconda gara</th>
                      <th>Perché</th>
                      <th>Decisione</th>
                    </tr>
                  </thead>
                  <tbody>
                    {regionali.proposte.map((p) => (
                      <tr key={`${p.a.id}|${p.b.id}`}>
                        {[p.a, p.b].map((g) => (
                          <td key={g.id}>
                            <strong>{g.titolo}</strong>
                            <div className="cn-nota">Ente: {g.ente ?? "non indicato"}{g.codiceFiscale ? ` (C.F. ${g.codiceFiscale})` : ""}</div>
                            <div className="cn-nota">Scadenza: {g.scadenzaIstante ? data(g.scadenzaIstante) : g.scadenzaGiorno ? `${g.scadenzaGiorno} (ora non indicata)` : "non indicata"}</div>
                            <div className="cn-nota">Importo: {g.importo !== null ? `${numero(g.importo)} € (${g.tipoImporto})` : "non indicato"}</div>
                            <div className="cn-nota">Fonti: {g.fonti.join(", ") || "—"}</div>
                            {g.collegamento && (
                              <div className="cn-nota">
                                <a href={g.collegamento} target="_blank" rel="noopener noreferrer">Pagina ufficiale</a>
                              </div>
                            )}
                            <div className="cn-nota">{g.id}</div>
                          </td>
                        ))}
                        <td>
                          {data(p.il)} · {p.motivo}
                        </td>
                        <td>
                          <ModuloAzione azione={decidiPropostaCollegamento} etichetta="Unisci" etichettaInCorso="Unisco…" campi={{ a: p.a.id, b: p.b.id, decisione: "conferma" }} variante="primario">
                            {null}
                          </ModuloAzione>
                          <ModuloAzione azione={decidiPropostaCollegamento} etichetta="Non sono la stessa gara" etichettaInCorso="Salvo…" campi={{ a: p.a.id, b: p.b.id, decisione: "rifiuta" }} variante="neutro">
                            {null}
                          </ModuloAzione>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Pannello>
        </div>
      )}
      {regionali?.classificazioni && (
        <div className="cn-sezione">
          <Pannello titolo={`Conflitti tra fonti nella classificazione (${numero(regionali.classificazioni.length)})`}>
            <p className="cn-nota">
              Gare pubblicate da più fonti che, classificate con le stesse regole, danno settori o livelli diversi (A pertinente, B correlata, C non pertinente). Nessuna scelta automatica: la gara resta nei settori riconosciuti da tutte le fonti insieme, e i clienti non vedono queste righe.
            </p>
            {regionali.classificazioni.length === 0 ? (
              <p className="cn-nota">Nessun conflitto tra fonti.</p>
            ) : (
              <div className="cn-scorri">
                <table className="cn-tab">
                  <thead>
                    <tr>
                      <th>Gara</th>
                      <th>Fonte arrivata</th>
                      <th>Altre fonti</th>
                      <th>Dati uniti</th>
                      <th>Perché</th>
                    </tr>
                  </thead>
                  <tbody>
                    {regionali.classificazioni.map((c, i) => (
                      <tr key={`${c.gara.id}|${i}`}>
                        <td>
                          <strong>{c.gara.titolo}</strong>
                          <div className="cn-nota">{c.gara.id}</div>
                        </td>
                        <td>
                          {c.fonte}: {c.daFonte.settori.join(", ") || "nessun settore"} {c.daFonte.livello ? `(livello ${c.daFonte.livello})` : ""}
                        </td>
                        <td>
                          {c.altreFonti.join(", ") || "—"}: {c.altre.settori.join(", ") || "nessun settore"} {c.altre.livello ? `(livello ${c.altre.livello})` : ""}
                        </td>
                        <td>
                          {c.datiUniti.settori.join(", ") || "nessun settore"} {c.datiUniti.livello ? `(livello ${c.datiUniti.livello})` : ""}
                        </td>
                        <td>
                          {data(c.il)} · {c.motivo ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Pannello>
        </div>
      )}
      {!dati.gareInVerifica && !regionali?.proposte && !regionali?.classificazioni && <p className="cn-nota">Nessun elenco disponibile in questo database.</p>}
    </>
  );
}

// ───── Registro (/tender-intelligence/registro) ─────

export function VistaRegistro({ dati }: { dati: DatiTenderIntelligenceConsole }) {
  return (
    <>
      <Testata titolo="Registro" testo="Chi ha cambiato che cosa, quando, con il valore di prima e quello nuovo; e quanto è stato usato il modulo." attiva="registro" />
      <AvvisoSchema dati={dati} />

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
