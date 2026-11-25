import type { DatiFontiConsole, FonteConsole } from "@/lib/console/fonti";
import type { DatiTenderIntelligenceConsole } from "@/lib/console/tender-intelligence";
import { GRAVITA_CONSOLE, STATO_FONTE_CONSOLE, esitoLeggibile, giornoLeggibile, modoLeggibile, testoGiriProgrammati } from "@/lib/console/fonti-calcoli";
import { FRASE_ACCENDI, FRASE_SPEGNI_A_META } from "@/lib/console/tender-intelligence-testi";
import { impostaFontePvl, impostaFonteRegionale, impostaFonteTed, riprendiRecuperoPvlConsole } from "../azioni/tender-intelligence";
import { Badge, Pannello } from "./elementi";
import ModuloAzione from "./modulo-azione";
import { SchedeTenderIntelligence, catalogoFonti, dettagliFonteTi } from "./tender-intelligence-vista";

// Pagina «Fonti» della console (48C §3.5–3.6; riordino del 25/11, proposta B1 43): le quattro fonti TUTTE QUI, con la stessa scheda nello
// stesso ordine (TED, PVL ANAC, Sintel, SardegnaCAT): stato calcolato, accesa o spenta, giri programmati, ultimo giro e ultimo successo,
// prossimo giro, allarmi (ordinati per gravità da B2), azioni e dettagli richiudibili. Accendere e spegnere usano le azioni ESISTENTI (solo
// amministratori, conferma controllata nel server per accendere, registro 0112 obbligatorio); nessuna riaccensione automatica.

function data(valore: string | null): string {
  if (!valore) return "—";
  return new Date(valore).toLocaleString("it-IT", { timeZone: "Europe/Rome", dateStyle: "short", timeStyle: "short" });
}

function durata(ms: number | null): string {
  if (ms === null) return "—";
  return ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`;
}

function accendiSpegni(f: FonteConsole) {
  const azione = f.attiva ? "spegni" : "accendi";
  const etichetta = f.attiva ? "Spegni la fonte" : f.stato === "sospesa" ? "Riaccendi la fonte" : "Accendi la fonte";
  const conferma = (
    <label className="cn-nota">
      <input type="checkbox" name="conferma" value="si" required /> Confermo: {f.attiva ? "spengo" : "accendo"} {f.nome}
    </label>
  );
  // che cosa fa il pulsante (proposta 43 §3.5): accendere avvia i giri; spegnere ferma TED e PVL alla pagina dopo (K7)
  const frase = f.attiva ? null : <p className="cn-nota">{FRASE_ACCENDI}</p>;
  if (f.fonte === "ted")
    return (
      <ModuloAzione azione={impostaFonteTed} etichetta={etichetta} etichettaInCorso="Salvo…" campi={{ azione }}>
        {conferma}
        {frase ?? <p className="cn-nota">{FRASE_SPEGNI_A_META}</p>}
      </ModuloAzione>
    );
  if (f.fonte === "pvl")
    return (
      <ModuloAzione azione={impostaFontePvl} etichetta={etichetta} etichettaInCorso="Salvo…" campi={{ azione }}>
        {conferma}
        {frase ?? <p className="cn-nota">{FRASE_SPEGNI_A_META}</p>}
      </ModuloAzione>
    );
  // Sintel e SardegnaCAT non controllano la fonte durante il giro (TED e PVL sì, dal K7 di B2): lo spegnimento vale dal giro successivo
  return (
    <ModuloAzione azione={impostaFonteRegionale} etichetta={etichetta} etichettaInCorso="Salvo…" campi={{ fonte: f.fonte, azione }}>
      {conferma}
      {frase}
      {f.attiva ? <p className="cn-nota">{`${f.nome} si ferma dal giro successivo: un giro già in corso arriva alla fine.`}</p> : null}
    </ModuloAzione>
  );
}

// «Riprendi il recupero»: SOLO per la PVL con l'allarme «blocco_incompleto» (f.ripresaRecupero non nullo). Il blocco fermo accanto; la
// conferma è controllata anche nel server; nessuna richiesta alla PVL adesso: si ritenta al prossimo giro
function ripresaRecupero(f: FonteConsole) {
  const r = f.ripresaRecupero;
  if (!r) return null;
  if (r.stato === "gia_ripreso") return <p className="cn-nota">Recupero già ripreso: l&apos;allarme resta fino al prossimo giro, che ritenta il blocco.</p>;
  return (
    <div>
      <p className="cn-nota">
        {r.stato === "fermo"
          ? `Recupero fermo sul blocco dal ${giornoLeggibile(r.blocco.da)} al ${giornoLeggibile(r.blocco.a)} (fermo dal ${data(r.blocco.il)}).`
          : `Recupero fermo; il blocco non si è potuto leggere (${r.errore}).`}
      </p>
      <ModuloAzione azione={riprendiRecuperoPvlConsole} etichetta="Riprendi il recupero" etichettaInCorso="Salvo…">
        <label className="cn-nota">
          <input type="checkbox" name="conferma" value="si" required /> Confermo: riprendo il recupero della PVL
        </label>
        <p className="cn-nota">Si ritenta al prossimo giro: nessuna richiesta alla PVL adesso.</p>
      </ModuloAzione>
    </div>
  );
}

// funzioni chiamate direttamente (non componenti): il contenuto resta nell'albero della vista, come lo legge la prova
function sezioneFonte(f: FonteConsole, ti: DatiTenderIntelligenceConsole | null) {
  const stato = STATO_FONTE_CONSOLE[f.stato];
  const g = f.ultimoGiro;
  return (
    <div className="cn-sezione">
      <Pannello titolo={f.nome} azioni={<Badge tono={stato.tono}>{stato.testo}</Badge>}>
        <p className="cn-nota">
          <strong>{stato.testo}</strong>: {stato.spiegazione}.
        </p>
        <p className="cn-nota">
          {f.attiva ? "Accesa" : "Spenta"}
          {f.erroriConsecutivi > 0 ? ` · ${f.erroriConsecutivi} giri di fila non riusciti` : ""}
        </p>
        <p className="cn-nota">
          {"Ultimo giro: "}
          {g ? `${data(g.iniziatoIl)} · ${modoLeggibile(g.modo)} · ${esitoLeggibile(g.esito)} · ${g.richiesteFonte} richieste alla fonte · ${g.gareNuove} gare nuove` : "nessun giro nel registro"}
        </p>
        <p className="cn-nota">{`Ultimo successo: ${data(f.ultimoSuccesso)}`}</p>
        <p className="cn-nota">{`Prossimo giro: ${f.prossimoGiro ? data(f.prossimoGiro) : !f.attiva ? "nessuno (fonte spenta)" : "nessuno (giri programmati spenti in questo ambiente)"}`}</p>
        <p className="cn-nota">{testoGiriProgrammati(f.giriProgrammati)}</p>
        {f.allarmi.length > 0 ? (
          <ul className="cn-elenco">
            {f.allarmi.map((a, i) => (
              <li key={`${a.codice}|${i}`}>
                <Badge tono={GRAVITA_CONSOLE[a.gravita].tono}>{GRAVITA_CONSOLE[a.gravita].testo}</Badge> {a.messaggio}
                {a.dal ? <span className="cn-nota">{` (dal ${data(a.dal)})`}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="cn-nota">Nessun allarme.</p>
        )}
        {accendiSpegni(f)}
        {ripresaRecupero(f)}
        {ti ? dettagliFonteTi(f.fonte, f.attiva, ti) : null}
        {f.giri.length > 0 && (
          <details className="cn-dettagli">
            <summary>{`Ultimi ${f.giri.length} giri`}</summary>
            <div className="cn-scorri">
            <table className="cn-tab">
              <thead>
                <tr>
                  <th>Iniziato</th>
                  <th>Modo</th>
                  <th>Esito</th>
                  <th>Durata</th>
                  <th>Richieste</th>
                  <th>Gare nuove</th>
                  <th>Allarmi</th>
                </tr>
              </thead>
              <tbody>
                {f.giri.map((x, i) => (
                  <tr key={`${x.iniziatoIl}|${i}`}>
                    <td>{data(x.iniziatoIl)}</td>
                    <td>{modoLeggibile(x.modo)}</td>
                    <td>
                      {esitoLeggibile(x.esito)}
                      {x.errore ? <span className="cn-nota">{` · ${x.errore}`}</span> : null}
                    </td>
                    <td>{durata(x.durataMs)}</td>
                    <td>{`${x.richiesteFonte} fonte · ${x.richiesteDb} database`}</td>
                    <td>{x.gareNuove}</td>
                    <td>{x.allarmi.length ? x.allarmi.join(", ") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </details>
        )}
      </Pannello>
    </div>
  );
}

// `ti` (dati della console Tender Intelligence): esecuzione manuale, visibilità, limiti PVL, gare doppie, dettagli dell'ultimo giro e
// catalogo. Senza (prove, letture fallite) la pagina mostra lo stesso le quattro schede con stato, allarmi e accensione.
export default function FontiVista({ dati, ti = null }: { dati: DatiFontiConsole; ti?: DatiTenderIntelligenceConsole | null }) {
  return (
    <>
      <div className="cn-testata">
        <div>
          <h1>Fonti</h1>
          <p>Le quattro fonti di Tender Intelligence, con la stessa scheda: stato calcolato, giri, allarmi e azioni.</p>
        </div>
      </div>
      <SchedeTenderIntelligence attiva="fonti" />
      {dati.errore && (
        <p className="cn-nota" role="alert">
          {`Lettura non riuscita: ${dati.errore}`}
        </p>
      )}
      {dati.registroAssente && (
        <p className="cn-nota" role="alert">
          Il registro dei giri (migrazione 0128) non c&apos;è in questo database: lo stato viene dal solo stato delle fonti, senza gli allarmi che hanno bisogno del registro e senza
          l&apos;elenco dei giri.
        </p>
      )}
      {dati.erroreGiri && (
        <p className="cn-nota" role="alert">
          {`Elenco dei giri non letto (${dati.erroreGiri}): lo stato e gli allarmi restano.`}
        </p>
      )}
      {dati.fonti.map((f) => (
        <div key={f.fonte}>{sezioneFonte(f, ti)}</div>
      ))}
      {ti ? catalogoFonti(ti) : null}
    </>
  );
}
