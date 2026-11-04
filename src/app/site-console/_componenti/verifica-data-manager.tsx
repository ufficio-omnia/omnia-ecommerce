"use client";

import { useState, useTransition } from "react";
import { eseguiVerificaDataManager, type EsitoVerificaDataManager } from "../azioni/demo-ads";
import type { ProvaVerifica, Riepilogo } from "@/lib/demo-ads-verifica-calcoli";
import { Badge, type Tono } from "./elementi";

// Pulsante e risultato della verifica della Data Manager API (sola validazione). Il risultato che arriva dal server contiene solo
// esiti, codici di Google e identificativi mascherati.

const CONTROLLI: { chiave: keyof Riepilogo; titolo: string; testo: (v: string) => { tono: Tono; testo: string } }[] = [
  { chiave: "autenticazione", titolo: "Autenticazione OAuth (refresh token → token di accesso)", testo: (v) => (v === "ok" ? { tono: "ok", testo: "riuscita" } : { tono: "errore", testo: "NON riuscita" }) },
  {
    chiave: "permessi",
    titolo: "Permessi (ambito Data Manager e accesso all'account)",
    testo: (v) => (v === "ok" ? { tono: "ok", testo: "ok" } : v === "negati" ? { tono: "errore", testo: "NEGATI" } : { tono: "neutro", testo: "non verificabile" }),
  },
  {
    chiave: "account",
    titolo: "Account Google Ads",
    testo: (v) =>
      v === "riconosciuto" ? { tono: "ok", testo: "riconosciuto (un account sbagliato viene rifiutato)" } : v === "non_riconosciuto" ? { tono: "errore", testo: "NON riconosciuto (Google contesta il campo)" } : v === "inconcludente" ? { tono: "avviso", testo: "INCONCLUDENTE: i controlli sbagliati non sono distinguibili con certezza" } : { tono: "neutro", testo: "non provato" },
  },
  {
    chiave: "azione",
    titolo: "Azione di conversione",
    testo: (v) =>
      v === "riconosciuta" ? { tono: "ok", testo: "riconosciuta (un'azione sbagliata viene rifiutata)" } : v === "non_riconosciuta" ? { tono: "errore", testo: "NON riconosciuta (Google contesta il campo)" } : v === "inconcludente" ? { tono: "avviso", testo: "INCONCLUDENTE: i controlli sbagliati non sono distinguibili con certezza" } : { tono: "neutro", testo: "non provata" },
  },
  { chiave: "schema", titolo: "Schema della richiesta", testo: (v) => (v === "valido" ? { tono: "ok", testo: "valido" } : v === "non_valido" ? { tono: "errore", testo: "NON valido" } : { tono: "neutro", testo: "non provato" }) },
  { chiave: "conversioniRegistrate", titolo: "Conversioni effettivamente registrate", testo: () => ({ tono: "ok", testo: "nessuna (solo validazione)" }) },
];

function esitoProva(p: ProvaVerifica): { tono: Tono; testo: string } {
  if (p.accettata) return { tono: p.atteso === "rifiutata" ? "avviso" : "ok", testo: "accettata da Google" };
  return { tono: p.atteso === "rifiutata" ? "ok" : p.atteso === "accettata" ? "errore" : "neutro", testo: `rifiutata${p.codiceGoogle ? ` (${p.codiceGoogle})` : ""}` };
}

export default function VerificaDataManager() {
  const [esito, setEsito] = useState<EsitoVerificaDataManager | null>(null);
  const [inCorso, avvia] = useTransition();
  // dopo ogni verifica il pulsante resta spento per un minuto (la stessa pausa che impone il server)
  const [inPausa, setInPausa] = useState(false);

  function lancia() {
    if (inPausa) return;
    setEsito(null);
    avvia(async () => {
      setEsito(await eseguiVerificaDataManager());
      setInPausa(true);
      setTimeout(() => setInPausa(false), 60_000);
    });
  }

  return (
    <div className="cn-pannello-corpo">
      <p className="cn-nota-inline" style={{ marginTop: 0 }}>
        Manda a Google quattro richieste di <strong>sola validazione</strong> con dati inventati (nessun lead, nessun identificativo di clic vero, nessuna riga nel database): serve a controllare credenziali, account, azione di conversione e formato <strong>senza registrare nessuna conversione</strong>.
      </p>
      <button type="button" className="cn-btn primario" onClick={lancia} disabled={inCorso || inPausa}>
        {inCorso ? "Verifica in corso…" : inPausa ? "Attendi un minuto prima di ripetere…" : "Verifica Google Ads (solo validazione)"}
      </button>

      {esito && !esito.ok && (
        <p className="cn-esito errore" role="alert" style={{ marginTop: 12 }}>
          {esito.errore}
        </p>
      )}

      {esito?.ok && (
        <div style={{ marginTop: 14 }}>
          <p className="cn-nota-inline" style={{ marginTop: 0 }}>
            In questa installazione: importazione {esito.risultato.ambiente.importazioneAccesa ? <Badge tono="ok">accesa</Badge> : <Badge>spenta</Badge>} · modalità configurata{" "}
            <Badge tono={esito.risultato.ambiente.modalitaConfigurata === "reale" ? "errore" : "avviso"}>{esito.risultato.ambiente.modalitaConfigurata === "reale" ? "REALE" : "solo verifica"}</Badge> · configurazione {esito.risultato.ambiente.configurazioneCompleta ? "completa" : "INCOMPLETA"} · credenziali {esito.risultato.ambiente.credenzialiPresenti ? "presenti" : "MANCANTI"} · account {esito.risultato.ambiente.account ?? "—"} · azione {esito.risultato.ambiente.azione ?? "—"}
          </p>

          {!esito.risultato.eseguita && (
            <p className="cn-esito errore" role="alert">
              Verifica non eseguita:{" "}
              {esito.risultato.motivo === "oauth_fallita"
                ? `autenticazione OAuth non riuscita (${esito.risultato.oauth.codice || "errore"}${esito.risultato.oauth.httpStato ? `, HTTP ${esito.risultato.oauth.httpStato}` : ""}).`
                : esito.risultato.motivo === "credenziali_mancanti"
                  ? "mancano le credenziali OAuth di Google Ads."
                  : "manca account o azione di conversione."}
            </p>
          )}

          {esito.risultato.riepilogo && (
            <div className="cn-scorri">
              <table className="cn-tab">
                <thead>
                  <tr>
                    <th>Controllo</th>
                    <th>Esito</th>
                  </tr>
                </thead>
                <tbody>
                  {CONTROLLI.map((c) => {
                    const r = c.testo(String(esito.risultato.riepilogo![c.chiave]));
                    return (
                      <tr key={c.chiave}>
                        <td>{c.titolo}</td>
                        <td>
                          <Badge tono={r.tono}>{r.testo}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {esito.risultato.prove.length > 0 && (
            <div className="cn-scorri" style={{ marginTop: 12 }}>
              <table className="cn-tab">
                <thead>
                  <tr>
                    <th>Richiesta di prova</th>
                    <th>HTTP</th>
                    <th>Risposta di Google</th>
                    <th>Campi contestati</th>
                  </tr>
                </thead>
                <tbody>
                  {esito.risultato.prove.map((p) => {
                    const r = esitoProva(p);
                    return (
                      <tr key={p.id}>
                        <td>{p.titolo}</td>
                        <td className="num">{p.httpStato ?? "—"}</td>
                        <td>
                          <Badge tono={r.tono}>{r.testo}</Badge>
                        </td>
                        <td className="mono-campo">{p.campi.length > 0 ? p.campi.join(", ") : p.ragioni.length > 0 ? p.ragioni.join(", ") : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {esito.risultato.statoRichiesta && (
            <p className="cn-nota-inline">
              Stato della richiesta di validazione (requestStatus): HTTP {esito.risultato.statoRichiesta.httpStato ?? "—"}, esito «{esito.risultato.statoRichiesta.esito}»
              {esito.risultato.statoRichiesta.ragioni.length > 0 ? ` (${esito.risultato.statoRichiesta.ragioni.join(", ")})` : ""}. Per una richiesta di sola validazione può non esistere: non è un errore.
            </p>
          )}

          <ul className="cn-elenco-regola">
            {esito.risultato.note.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
