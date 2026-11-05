"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { inviaProvaGa4Azione, preparaProvaGa4Azione, risolviProvaGa4Azione } from "../azioni/demo-ga4-prova";
import type { RisultatoInvioProva, RisultatoRisoluzione } from "@/lib/demo-ga4-prova";
import type { DatiDemo } from "@/lib/console/demo";
import {
  COSA_FARE_STATO_PROVA,
  ETICHETTA_STATO_PROVA,
  FRASE_EVENTO_ASSENTE,
  FRASE_EVENTO_PRESENTE,
  FRASE_INVIO_PROVA,
  TESTO_NON_IDONEA,
  TESTO_PROVA_SPENTA,
  TONO_STATO_PROVA,
  type CandidataProva,
  type RigaProvaGa4,
} from "@/lib/demo-ga4-prova-calcoli";
import { Badge } from "./elementi";
import { formattaDataOra } from "./formati";

// Sezione «Prova reale GA4»: UN evento «demo_booking_confirmed» REALE, per UNA richiesta di prova, su comando dell'amministratore.
// La pagina non decide niente: ogni controllo e ogni protezione sta sul server (azioni/demo-ga4-prova.ts, lib/demo-ga4-prova.ts e la
// tabella demo_ga4_prove). Qui ci sono solo i pulsanti, le frasi da digitare e gli esiti. Arrivano soltanto esiti, codici e stati.

const abbrevia = (id: string) => id.slice(0, 8);

function testoRifiuto(r: Extract<RisultatoInvioProva, { ok: false }>): string {
  switch (r.motivo) {
    case "prova_spenta":
      return `La prova è spenta: ${(r.mancanti ?? []).map((m) => TESTO_PROVA_SPENTA[m]).join(" ")}`;
    case "frase_errata":
      return "La frase di conferma non è corretta: non è stato inviato niente.";
    case "id_non_valido":
      return "Richiesta non valida: non è stato inviato niente.";
    case "occupato":
      return "È in corso un altro giro del sistema: non è stato inviato niente. Riprova tra qualche minuto.";
    case "non_trovata":
      return "Richiesta non trovata: non è stato inviato niente.";
    case "non_idonea":
      return `La richiesta non è idonea (${(r.motiviNonIdonea ?? []).map((m) => TESTO_NON_IDONEA[m]).join("; ")}): non è stato inviato niente.`;
    case "gia_presente":
      return `Per questa richiesta c'è già una prova${r.statoEsistente ? ` (${ETICHETTA_STATO_PROVA[r.statoEsistente]})` : ""}: non è stato inviato niente. Una richiesta ha una sola prova.`;
    case "schema_assente":
      return "Manca la tabella delle prove (migrazione 0099): non è stato inviato niente.";
    default:
      return "Errore del database: non è stato inviato niente.";
  }
}

function EsitoInvio({ r }: { r: RisultatoInvioProva }) {
  if (!r.ok) {
    return (
      <p className="cn-esito errore" role="alert" style={{ marginTop: 12 }}>
        {testoRifiuto(r)}
      </p>
    );
  }
  const tono = r.stato === "sent_unverified" ? "avviso" : "errore";
  return (
    <div className={`cn-esito ${tono}`} role="status" style={{ marginTop: 12 }}>
      <strong>L&apos;invio è stato tentato UNA volta: {ETICHETTA_STATO_PROVA[r.stato]}.</strong>{" "}
      {r.codice === "timeout" || r.codice === "rete"
        ? "Nessuna risposta da Google: l'evento può essere arrivato o no. Non si rimanda."
        : `Risposta di Google: HTTP ${r.httpStato}. ${r.stato === "sent_unverified" ? "Una risposta positiva NON prova che l'evento sia in Analytics: va verificato nei rapporti." : ""}`}{" "}
      L&apos;evento porta l&apos;ora {r.modalitaTimestamp === "prenotazione" ? "della prenotazione" : "dell'invio"} ({formattaDataOra(r.timestampEventoIl)}).{" "}
      {r.esitoRegistrato ? "Esito registrato." : "ATTENZIONE: l'esito non si è potuto registrare, la prova resta «prenotata»: dopo 5 minuti dichiara cosa vedi in GA4."} Cerca «demo_booking_confirmed» in GA4: Realtime (ultimi 30 minuti) o, più tardi, i rapporti degli eventi.
    </div>
  );
}

function Spunta({ ok, testo }: { ok: boolean; testo: string }) {
  return <Badge tono={ok ? "ok" : "errore"}>{`${ok ? "✓" : "✗"} ${testo}`}</Badge>;
}

function SchedaCandidata({ c, selezionata, onSeleziona }: { c: CandidataProva; selezionata: boolean; onSeleziona: () => void }) {
  return (
    <div className="cn-pannello" style={{ marginBottom: 10 }}>
      <div className="cn-pannello-corpo">
        <p style={{ margin: "0 0 8px" }}>
          <strong>Richiesta {abbrevia(c.leadId)}…</strong> · prenotata {c.prenotataIl ? formattaDataOra(c.prenotataIl) : "—"} · settore «{c.settore}»
        </p>
        <p style={{ margin: "0 0 8px", display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Spunta ok={c.consensi.privacy} testo="informativa" />
          <Spunta ok={c.consensi.cookie} testo="cookie (firma verificata)" />
          <Spunta ok={c.haClientId} testo="client_id" />
          <Spunta ok={c.haSessionId} testo="session_id" />
          {c.idoneo && c.anteprima && <Badge tono={c.anteprima.adPersonalization === "GRANTED" ? "ok" : "avviso"}>{`ad_personalization ${c.anteprima.adPersonalization}`}</Badge>}
        </p>
        {c.idoneo && c.anteprima ? (
          <>
            <p className="cn-nota-inline" style={{ margin: "0 0 8px" }}>
              Evento «{c.anteprima.nomeEvento}» con parametri: {c.anteprima.parametri.join(", ")}. Porterà l&apos;ora{" "}
              {c.anteprima.modalita === "prenotazione" ? `della prenotazione (${c.anteprima.minutiDallaPrenotazione} minuti fa)` : "dell'invio (la prenotazione è più vecchia di 72 ore)"}.{" "}
              {c.anteprima.dentroFinestraRealtime
                ? "È dentro i 30 minuti di Realtime (non è documentato se Realtime guardi l'ora dell'evento o quella di ricezione)."
                : "È OLTRE i 30 minuti di Realtime: potrebbe non comparire subito, solo nei rapporti dopo alcune ore. Meglio una prenotazione più recente."}
            </p>
            <button type="button" className="cn-btn" onClick={onSeleziona} disabled={selezionata}>
              {selezionata ? "Selezionata" : "Prepara l'invio di questa richiesta"}
            </button>
          </>
        ) : (
          <p className="cn-nota-inline" style={{ margin: 0 }}>
            Non idonea: {c.motivi.map((m) => TESTO_NON_IDONEA[m]).join("; ")}.
          </p>
        )}
      </div>
    </div>
  );
}

function RigaRegistro({ p, onFatto }: { p: RigaProvaGa4; onFatto: () => void }) {
  const [aperta, setAperta] = useState(false);
  const [frase, setFrase] = useState("");
  const [esito, setEsito] = useState<RisultatoRisoluzione | { ok: false; motivo: "errore"; errore: string } | null>(null);
  const [inCorso, avvia] = useTransition();

  function dichiara(valore: "verified" | "not_received") {
    setEsito(null);
    avvia(async () => {
      const r = await risolviProvaGa4Azione(p.leadId, valore, frase);
      if (!r.ok) setEsito({ ok: false, motivo: "errore", errore: r.errore });
      else {
        setEsito(r.risultato);
        if (r.risultato.ok) onFatto();
      }
    });
  }

  return (
    <>
      <tr>
        <td className="mono-campo">{abbrevia(p.leadId)}…</td>
        <td>
          <Badge tono={TONO_STATO_PROVA[p.stato]}>{ETICHETTA_STATO_PROVA[p.stato]}</Badge>
        </td>
        <td>{p.esitoCodice ? `${p.esitoCodice}${p.httpStato ? ` (HTTP ${p.httpStato})` : ""}` : "—"}</td>
        <td>
          {formattaDataOra(p.timestampEventoIl)} <small>({p.modalitaTimestamp === "prenotazione" ? "ora prenotazione" : "ora invio"})</small>
        </td>
        <td>{formattaDataOra(p.riservataIl)}</td>
        <td>{p.risoltaIl ? formattaDataOra(p.risoltaIl) : "—"}</td>
        <td>
          {p.risolvibile ? (
            <button type="button" className="cn-btn piccolo" onClick={() => setAperta((v) => !v)}>
              {aperta ? "Chiudi" : "Dichiara cosa vedi in GA4"}
            </button>
          ) : (
            "—"
          )}
        </td>
      </tr>
      {aperta && p.risolvibile && (
        <tr>
          <td colSpan={7}>
            <p className="cn-nota-inline" style={{ marginTop: 0 }}>
              {COSA_FARE_STATO_PROVA[p.stato]}
            </p>
            <p className="cn-nota-inline">
              Per dichiarare che l&apos;evento <strong>c&apos;è</strong> scrivi «{FRASE_EVENTO_PRESENTE}»; che <strong>non c&apos;è</strong> scrivi «{FRASE_EVENTO_ASSENTE}». È una dichiarazione tua: non invia niente a nessuno e lo stato diventa definitivo.
            </p>
            <input className="cn-input" value={frase} onChange={(e) => setFrase(e.target.value)} placeholder="Frase di conferma" autoComplete="off" style={{ maxWidth: 360, marginRight: 8 }} />
            <button type="button" className="cn-btn" disabled={inCorso || frase.trim() !== FRASE_EVENTO_PRESENTE} onClick={() => dichiara("verified")} style={{ marginRight: 6 }}>
              Evento presente in GA4
            </button>
            <button type="button" className="cn-btn" disabled={inCorso || frase.trim() !== FRASE_EVENTO_ASSENTE} onClick={() => dichiara("not_received")}>
              Evento assente in GA4
            </button>
            {esito && !esito.ok && (
              <p className="cn-esito errore" role="alert" style={{ marginTop: 8 }}>
                {"errore" in esito ? esito.errore : esito.motivo === "frase_errata" ? "Frase non corretta." : esito.motivo === "cambiata_nel_frattempo" ? "Lo stato è cambiato nel frattempo: ricarica la pagina." : esito.motivo === "non_risolvibile" ? "Questo stato non si può dichiarare ora." : "Operazione non riuscita."}
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export default function ProvaGa4Reale({ prova }: { prova: DatiDemo["provaGa4"] }) {
  const router = useRouter();
  const [candidate, setCandidate] = useState<CandidataProva[] | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [selezionata, setSelezionata] = useState<string | null>(null);
  const [frase, setFrase] = useState("");
  const [esito, setEsito] = useState<RisultatoInvioProva | null>(null);
  const [inCorso, avvia] = useTransition();
  const [inInvio, avviaInvio] = useTransition();

  function cerca() {
    setErrore(null);
    setEsito(null);
    avvia(async () => {
      const r = await preparaProvaGa4Azione();
      if (!r.ok) {
        setErrore(r.errore);
        setCandidate(null);
        return;
      }
      setCandidate(r.risultato.candidate);
      setSelezionata(null);
      setFrase("");
    });
  }

  function invia() {
    if (!selezionata || inInvio) return;
    setErrore(null);
    avviaInvio(async () => {
      const r = await inviaProvaGa4Azione(selezionata, frase);
      if (!r.ok) setErrore(r.errore);
      else setEsito(r.risultato);
      // qualunque cosa sia successa, la richiesta non è più selezionabile: il registro (aggiornato dalla pagina) è la fonte di verità
      setSelezionata(null);
      setFrase("");
      setCandidate(null);
      router.refresh();
    });
  }

  const scelta = candidate?.find((c) => c.leadId === selezionata) ?? null;

  return (
    <div className="cn-pannello-corpo">
      <p className="cn-esito avviso" role="status" style={{ marginTop: 0 }}>
        <strong>Questo invio è REALE.</strong> Manda <strong>un solo</strong> evento «demo_booking_confirmed» alla proprietà GA4 di produzione, anche se GA4 è in modalità DEBUG: il cron non c&apos;entra e continua a solo validare. Una richiesta ha <strong>una sola</strong> prova, mai ritentata da sola. Una risposta positiva di Google <strong>non</strong> prova che l&apos;evento sia in Analytics: la verifica la dichiari tu dopo aver guardato i rapporti.
      </p>

      {prova.tabella === "assente" && (
        <p className="cn-esito errore" role="alert">
          Manca la tabella delle prove: eseguire la migrazione 0099. Finché non c&apos;è, la prova non si può usare.
        </p>
      )}
      {prova.tabella === "errore" && (
        <p className="cn-esito errore" role="alert">
          Lettura del registro delle prove non riuscita: la prova non si può usare finché non si legge.
        </p>
      )}

      {!prova.gate.attiva ? (
        <>
          <p className="cn-nota-inline">
            Prova <Badge>spenta</Badge>: non si può inviare niente.
          </p>
          <ul className="cn-elenco-regola">
            {prova.gate.mancanti.map((m) => (
              <li key={m}>{TESTO_PROVA_SPENTA[m]}</li>
            ))}
          </ul>
        </>
      ) : (
        prova.tabella === "ok" && (
          <>
            <p className="cn-nota-inline">
              Prova <Badge tono="accento">pronta</Badge> · {prova.gate.emailDiProva} email di prova configurata/e. Si usa solo una prenotazione di prova <strong>confermata sul calendario</strong> da un&apos;email di prova.
            </p>
            <button type="button" className="cn-btn primario" onClick={cerca} disabled={inCorso || inInvio}>
              {inCorso ? "Cerco…" : "Cerca richieste di prova (sola lettura)"}
            </button>

            {candidate && candidate.length === 0 && (
              <p className="cn-vuoto" style={{ marginTop: 12 }}>
                Nessuna richiesta di prova confermata e ancora non usata. Fai una nuova prenotazione di prova con l&apos;email di prova e attendi che il sistema la confermi (fino a 10 minuti).
              </p>
            )}
            {candidate && candidate.length > 0 && (
              <div style={{ marginTop: 12 }}>
                {candidate.map((c) => (
                  <SchedaCandidata key={c.leadId} c={c} selezionata={selezionata === c.leadId} onSeleziona={() => { setSelezionata(c.leadId); setFrase(""); setEsito(null); }} />
                ))}
              </div>
            )}

            {scelta && scelta.idoneo && (
              <div className="cn-esito avviso" style={{ marginTop: 12 }}>
                <p style={{ margin: "0 0 8px" }}>
                  <strong>Stai per inviare 1 evento REALE a GA4 per la richiesta {abbrevia(scelta.leadId)}…</strong> Non si può annullare e non si può ripetere per questa richiesta. Per confermare scrivi esattamente: <strong>{FRASE_INVIO_PROVA}</strong>
                </p>
                <input className="cn-input" value={frase} onChange={(e) => setFrase(e.target.value)} placeholder="Frase di conferma" autoComplete="off" style={{ maxWidth: 320, marginRight: 8 }} />
                <button type="button" className="cn-btn pericolo" onClick={invia} disabled={inInvio || frase.trim() !== FRASE_INVIO_PROVA}>
                  {inInvio ? "Invio in corso…" : "Invia 1 evento REALE a GA4"}
                </button>
              </div>
            )}
          </>
        )
      )}

      {errore && (
        <p className="cn-esito errore" role="alert" style={{ marginTop: 12 }}>
          {errore}
        </p>
      )}
      {esito && <EsitoInvio r={esito} />}

      <h3 style={{ margin: "18px 0 8px", fontSize: "0.95rem" }}>Registro delle prove ({prova.prove.length})</h3>
      {prova.prove.length === 0 ? (
        <p className="cn-vuoto">Nessuna prova ancora. Il cron GA4 non riprende mai una richiesta che compare qui, in nessuno stato.</p>
      ) : (
        <div className="cn-scorri">
          <table className="cn-tab">
            <thead>
              <tr>
                <th>Richiesta</th>
                <th>Stato</th>
                <th>Esito dell&apos;invio</th>
                <th>Ora dell&apos;evento</th>
                <th>Prenotata il</th>
                <th>Dichiarata il</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {prova.prove.map((p) => (
                <RigaRegistro key={p.leadId} p={p} onFatto={() => router.refresh()} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="cn-nota">
        Stati: «inviata, non verificata» = Google ha risposto positivamente ma l&apos;evento non è ancora stato visto nei rapporti; «esito incerto» = nessuna risposta utile; «prenotata» = invio prenotato senza esito registrato. Solo la tua dichiarazione porta a «verificata» o «non risulta». Per riprovare serve una nuova prenotazione di prova (è un&apos;altra richiesta).
      </p>
    </div>
  );
}
