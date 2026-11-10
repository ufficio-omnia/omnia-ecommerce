"use client";

import { useState, useTransition } from "react";
import { controllaEsitoAdsAzione, inviaConversioneAdsAzione, leggiInvioAdsAzione } from "../azioni/demo-ads-invio";
import { TESTO_INVIO_ADS_SPENTO, TESTO_NON_INVIABILE_ADS, type RigaInvioAds, type RisultatoControlloAds, type RisultatoInvioAds, type StatoGateInvioAds } from "@/lib/demo-ads-invio";
import { COSA_FARE_FASE_ADS, ETICHETTA_FASE_ADS, FRASE_INVIO_ADS, TONO_FASE_ADS, abbreviaIdRichiesta, fraseInvioAds } from "@/lib/demo-ads-invio-calcoli";
import { Badge } from "./elementi";
import { formattaDataOra } from "./formati";

// Sezione «Invio reale a Google Ads»: UNA conversione REALE per UNA richiesta di demo, su comando dell'amministratore. La pagina non decide
// niente: ogni controllo e ogni protezione sta sul server (azioni/demo-ads-invio.ts e lib/demo-ads-invio.ts: prenotazione condizionata nel
// database, blocco condiviso con il cron, esito incerto mai rimandato). Qui ci sono solo i pulsanti, la frase da digitare e gli esiti.
// Arrivano soltanto esiti, codici e stati: mai token, email o identificativi di clic.

function testoRifiuto(r: Extract<RisultatoInvioAds, { ok: false }>): string {
  switch (r.motivo) {
    case "invio_spento":
      return `L'invio è spento: ${(r.mancanti ?? []).map((m) => TESTO_INVIO_ADS_SPENTO[m]).join(" ")} Non è stato inviato niente.`;
    case "id_non_valido":
      return "Richiesta non valida: non è stato inviato niente.";
    case "frase_errata":
      return "La frase di conferma non è corretta: non è stato inviato niente.";
    case "occupato":
      return "È in corso un altro giro del sistema: non è stato inviato niente. Riprova tra qualche minuto.";
    case "non_trovata":
      return "Richiesta non trovata: non è stato inviato niente.";
    case "non_inviabile":
      return `La richiesta non è inviabile (${(r.motivi ?? []).map((m) => TESTO_NON_INVIABILE_ADS[m]).join("; ")}): non è stato inviato niente.`;
    case "token_non_ottenuto":
      return "Google non ha dato il token di accesso (credenziali scadute o revocate?): non è stato inviato niente e niente è stato prenotato.";
    case "gia_prenotata":
      return "Questa richiesta è già stata prenotata o modificata da un altro processo: non è stato inviato niente da qui. Guarda il suo stato.";
    default:
      return "Errore del database: non è stato inviato niente.";
  }
}

function EsitoInvio({ r }: { r: RisultatoInvioAds }) {
  if (!r.ok) {
    return (
      <p className="cn-esito errore" role="alert" style={{ marginTop: 12 }}>
        {testoRifiuto(r)}
      </p>
    );
  }
  const tono = r.fase === "in_elaborazione" ? "avviso" : "errore";
  return (
    <div className={`cn-esito ${tono}`} role="status" style={{ marginTop: 12 }}>
      <strong>L&apos;invio è stato tentato UNA volta: {ETICHETTA_FASE_ADS[r.fase]}.</strong>{" "}
      {r.fase === "in_elaborazione" && r.requestId ? `Google ha ricevuto la richiesta (identificativo ${r.requestId}). ` : ""}
      {r.fase === "incerta" ? `Nessun esito certo (${r.codice ?? "—"}): la conversione può essere stata registrata o no. NON si rimanda. ` : ""}
      {r.fase === "rifiutata" ? `Google ha rifiutato la richiesta (${r.codice ?? "—"}): non è stato registrato niente. ` : ""}
      Ora della conversione: {formattaDataOra(r.conversionTime)} · transazione {r.transactionId}.{" "}
      {r.esitoRegistrato ? "Esito registrato." : `ATTENZIONE: l'esito non si è potuto registrare nel database${r.requestId ? ` — annota l'identificativo ${r.requestId}` : ""}: la richiesta risulta «esito incerto», non rimandarla.`}{" "}
      {r.fase === "in_elaborazione" ? "Dopo qualche minuto usa «Controlla l'esito»: SUCCESS = acquisita." : ""}
    </div>
  );
}

function EsitoControllo({ r }: { r: RisultatoControlloAds }) {
  if (!r.ok) {
    return (
      <p className="cn-esito errore" role="alert" style={{ margin: "8px 0 0" }}>
        {r.motivo === "non_controllabile" ? "Questa richiesta non ha un invio da controllare." : r.motivo === "token_non_ottenuto" ? "Google non ha dato il token di accesso." : r.motivo === "invio_spento" ? "L'integrazione Google Ads non è attiva." : "Controllo non riuscito."}
      </p>
    );
  }
  const testo: Record<typeof r.esito, string> = {
    accettata: "Google ha elaborato la richiesta con successo (SUCCESS): la conversione è acquisita.",
    fallita: `Google ha rifiutato l'elaborazione${r.ragioni.length ? ` (${r.ragioni.join(", ")})` : ""}: la richiesta è «rifiutata o fallita».`,
    in_corso: "Google la sta ancora elaborando (PROCESSING): riprova tra un po'.",
    non_letta: "Google non ha dato una risposta leggibile: riprova tra un po'. Non cambia niente.",
    troppo_presto: "Troppo presto: riprova tra poco.",
  };
  return (
    <p className={`cn-esito ${r.esito === "accettata" ? "ok" : r.esito === "fallita" ? "errore" : "avviso"}`} role="status" style={{ margin: "8px 0 0" }}>
      {testo[r.esito]}
    </p>
  );
}

function Spunta({ ok, testo }: { ok: boolean; testo: string }) {
  return <Badge tono={ok ? "ok" : "errore"}>{`${ok ? "✓" : "✗"} ${testo}`}</Badge>;
}

function SchedaRichiesta({
  riga,
  gate,
  selezionata,
  onSeleziona,
  onCambiata,
}: {
  riga: RigaInvioAds;
  gate: StatoGateInvioAds;
  selezionata: boolean;
  onSeleziona: () => void;
  onCambiata: () => void;
}) {
  const [frase, setFrase] = useState("");
  const [esitoInvio, setEsitoInvio] = useState<RisultatoInvioAds | null>(null);
  const [esitoControllo, setEsitoControllo] = useState<RisultatoControlloAds | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [inInvio, avviaInvio] = useTransition();
  const [inControllo, avviaControllo] = useTransition();
  const attesa = fraseInvioAds(riga.leadId);

  function invia() {
    if (inInvio) return;
    setErrore(null);
    setEsitoControllo(null);
    avviaInvio(async () => {
      const r = await inviaConversioneAdsAzione(riga.leadId, frase);
      if (!r.ok) setErrore(r.errore);
      else setEsitoInvio(r.risultato);
      setFrase("");
      onCambiata();
    });
  }

  function controlla() {
    setErrore(null);
    setEsitoInvio(null);
    avviaControllo(async () => {
      const r = await controllaEsitoAdsAzione(riga.leadId);
      if (!r.ok) setErrore(r.errore);
      else setEsitoControllo(r.risultato);
      onCambiata();
    });
  }

  const a = riga.anteprima;
  return (
    <div className="cn-pannello" style={{ marginBottom: 10 }}>
      <div className="cn-pannello-corpo">
        <p style={{ margin: "0 0 8px" }}>
          <strong>{riga.azienda || "Richiesta"}</strong> · richiesta {abbreviaIdRichiesta(riga.leadId)}… · prenotata {riga.prenotataIl ? formattaDataOra(riga.prenotataIl) : "—"} · settore «{riga.settore}» <Badge tono={TONO_FASE_ADS[riga.fase]}>{ETICHETTA_FASE_ADS[riga.fase]}</Badge>
        </p>
        <p style={{ margin: "0 0 8px", display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Spunta ok={riga.consensi.privacy} testo="informativa" />
          <Spunta ok={riga.consensi.cookie} testo="cookie pubblicitari" />
          <Badge tono={riga.consensi.misurazione ? "ok" : "neutro"}>{riga.consensi.misurazione ? "email cifrata: consenso dato" : "email cifrata: consenso NON dato"}</Badge>
          {a && <Badge tono={a.usaClic ? "ok" : "errore"}>{a.usaClic ? `clic (${a.usaClic})` : "nessun clic"}</Badge>}
        </p>
        <p className="cn-nota-inline" style={{ margin: "0 0 8px" }}>
          {COSA_FARE_FASE_ADS[riga.fase]}
          {riga.requestId ? ` Identificativo di richiesta Google: ${riga.requestId}.` : ""}
          {riga.errore ? ` Codice: ${riga.errore}.` : ""}
          {riga.tentativi > 0 ? ` Tentativi contati: ${riga.tentativi}.` : ""}
          {riga.inviataIl ? ` Prenotato/inviato il ${formattaDataOra(riga.inviataIl)}.` : ""}
        </p>

        {riga.fase === "in_elaborazione" && (
          <button type="button" className="cn-btn" onClick={controlla} disabled={inControllo || inInvio}>
            {inControllo ? "Controllo…" : "Controlla l'esito (requestStatus)"}
          </button>
        )}
        {esitoControllo && <EsitoControllo r={esitoControllo} />}

        {!riga.inviabile && riga.motivi.length > 0 && riga.fase === "da_inviare" && (
          <p className="cn-nota-inline" style={{ margin: 0 }}>
            Non inviabile: {riga.motivi.map((m) => TESTO_NON_INVIABILE_ADS[m]).join("; ")}.
          </p>
        )}

        {riga.inviabile && a && (
          <>
            <p className="cn-nota-inline" style={{ margin: "0 0 8px" }}>
              Cosa partirebbe: UNA conversione REALE (validateOnly = {String(a.validateOnly)}) sull&apos;account {gate.contoMascherato ?? "—"}, azione {gate.azioneMascherata ?? "—"}. Ora della conversione {formattaDataOra(a.conversionTime)} (la prenotazione, non l&apos;appuntamento). Transazione {a.transactionId}.{" "}
              {a.usaClic ? `Identificativo di clic: ${a.usaClic}.` : ""} {a.usaEmail ? "Con l'email cifrata (consenso dato)." : "Senza email (consenso non dato)."} Consenso a Google: dati pubblicitari {a.adUserData === "CONSENT_GRANTED" ? "concessi" : "negati"}, personalizzazione {a.adPersonalization === "CONSENT_GRANTED" ? "concessa" : "negata"}.
            </p>
            {!selezionata ? (
              <button type="button" className="cn-btn" onClick={onSeleziona}>
                Prepara l&apos;invio di questa richiesta
              </button>
            ) : (
              <div className="cn-esito avviso" style={{ marginTop: 8 }}>
                <p style={{ margin: "0 0 8px" }}>
                  <strong>Stai per inviare 1 conversione REALE a Google Ads per la richiesta {abbreviaIdRichiesta(riga.leadId)}…</strong> Controlla che account ({gate.contoMascherato}) e azione ({gate.azioneMascherata}) siano quelli giusti. Non si può annullare e non si ripete da sola: se l&apos;esito è incerto non viene rimandata. Per confermare scrivi esattamente: <strong>{FRASE_INVIO_ADS} {abbreviaIdRichiesta(riga.leadId)}</strong>
                </p>
                <input className="cn-input" value={frase} onChange={(e) => setFrase(e.target.value)} placeholder="Frase di conferma" autoComplete="off" style={{ maxWidth: 360, marginRight: 8 }} />
                <button type="button" className="cn-btn pericolo" onClick={invia} disabled={inInvio || frase.trim().replace(/\s+/g, " ") !== attesa}>
                  {inInvio ? "Invio in corso…" : "Invia 1 conversione REALE a Google Ads"}
                </button>
              </div>
            )}
          </>
        )}

        {errore && (
          <p className="cn-esito errore" role="alert" style={{ marginTop: 8 }}>
            {errore}
          </p>
        )}
        {esitoInvio && <EsitoInvio r={esitoInvio} />}
      </div>
    </div>
  );
}

export default function InvioAdsReale() {
  const [dati, setDati] = useState<{ gate: StatoGateInvioAds; righe: RigaInvioAds[] } | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [selezionata, setSelezionata] = useState<string | null>(null);
  const [inCorso, avvia] = useTransition();

  function leggi() {
    setErrore(null);
    avvia(async () => {
      const r = await leggiInvioAdsAzione();
      if (!r.ok) {
        setErrore(r.errore);
        return;
      }
      setDati({ gate: r.risultato.gate, righe: r.risultato.righe });
    });
  }

  return (
    <div className="cn-pannello-corpo">
      <p className="cn-esito avviso" role="status" style={{ marginTop: 0 }}>
        <strong>Questo invio è REALE.</strong> Registra <strong>una</strong> conversione sull&apos;account Google Ads di produzione, anche se il cron è in «solo verifica»: l&apos;invio manuale è una decisione separata. Prima di chiamare Google la richiesta viene <strong>prenotata</strong> nel database: nessun altro (cron compreso) può inviarla, e se l&apos;esito è incerto <strong>non viene mai rimandata</strong>. Una risposta positiva di Google non prova che la conversione sia nei rapporti: «Controlla l&apos;esito» legge lo stato dell&apos;elaborazione, e Google Ads mostra la conversione dopo alcune ore.
      </p>
      <button type="button" className="cn-btn primario" onClick={leggi} disabled={inCorso}>
        {inCorso ? "Leggo…" : dati ? "Aggiorna l'elenco (sola lettura)" : "Mostra le conversioni Google Ads (sola lettura)"}
      </button>
      {errore && (
        <p className="cn-esito errore" role="alert" style={{ marginTop: 12 }}>
          {errore}
        </p>
      )}

      {dati && (
        <div style={{ marginTop: 12 }}>
          {!dati.gate.attivo ? (
            <>
              <p className="cn-nota-inline">
                Invio <Badge>spento</Badge>: non si può inviare niente.
              </p>
              <ul className="cn-elenco-regola">
                {dati.gate.mancanti.map((m) => (
                  <li key={m}>{TESTO_INVIO_ADS_SPENTO[m]}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="cn-nota-inline">
              Invio <Badge tono="accento">pronto</Badge> · account {dati.gate.contoMascherato} · azione di conversione {dati.gate.azioneMascherata} (solo le ultime tre cifre) · il cron è in{" "}
              <strong>{dati.gate.modalitaCron === "reale" ? "modalità REALE" : "solo verifica"}</strong>
              {dati.gate.modalitaCron === "reale" ? (dati.gate.dataMinimaCron ? `, invia solo prenotazioni dal ${formattaDataOra(dati.gate.dataMinimaCron)}` : ", ma SENZA data minima valida (DEMO_ADS_REAL_FROM): non invia niente") : ""}.
            </p>
          )}
          {dati.righe.length === 0 ? (
            <p className="cn-vuoto">Nessuna richiesta con una conversione Google Ads (pronta, verificata, inviata, accettata o fallita).</p>
          ) : (
            dati.righe.map((riga) => <SchedaRichiesta key={riga.leadId} riga={riga} gate={dati.gate} selezionata={selezionata === riga.leadId} onSeleziona={() => setSelezionata(riga.leadId)} onCambiata={leggi} />)
          )}
        </div>
      )}
    </div>
  );
}
