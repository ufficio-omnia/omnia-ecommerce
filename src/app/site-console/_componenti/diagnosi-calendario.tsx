"use client";

import { useState, useTransition } from "react";
import { eseguiDiagnosiCalendario, type EsitoDiagnosiCalendario } from "../azioni/demo-calendario";
import { Badge, type Tono } from "./elementi";

// Pulsante e risultato della diagnosi degli eventi dei casi aperti (sola lettura). Il risultato che arriva dal server contiene solo ruoli,
// conteggi e nomi di campi: nessuna email, nessun nome, nessun id.

const RUOLO: Record<string, { testo: string; tono: Tono }> = {
  esterno: { testo: "esterno (può essere il prenotante)", tono: "accento" },
  calendario: { testo: "calendario stesso", tono: "neutro" },
  organizzatore: { testo: "organizzatore", tono: "neutro" },
  risorsa: { testo: "risorsa", tono: "neutro" },
  squadra: { testo: "squadra (email interna)", tono: "neutro" },
  dominio_interno: { testo: "dominio interno", tono: "neutro" },
};

const MOTIVO_ASSENTE: Record<string, string> = {
  credenziali_mancanti: "mancano le credenziali OAuth del calendario.",
  token_non_ottenuto: "autenticazione OAuth non riuscita.",
  schema_assente: "le tabelle DEMO non esistono ancora.",
  errore_database: "lettura del database non riuscita.",
};

export default function DiagnosiCalendario() {
  const [esito, setEsito] = useState<EsitoDiagnosiCalendario | null>(null);
  const [inCorso, avvia] = useTransition();
  // dopo ogni diagnosi il pulsante resta spento per un minuto (la stessa pausa che impone il server)
  const [inPausa, setInPausa] = useState(false);

  function lancia() {
    if (inPausa) return;
    setEsito(null);
    avvia(async () => {
      setEsito(await eseguiDiagnosiCalendario());
      setInPausa(true);
      setTimeout(() => setInPausa(false), 60_000);
    });
  }

  return (
    <div className="cn-pannello-corpo">
      <p className="cn-nota-inline" style={{ marginTop: 0 }}>
        Legge in <strong>sola lettura</strong> gli eventi del calendario dei casi aperti e mostra com&apos;è fatto ognuno: chi è l&apos;organizzatore e il creatore, quali ospiti ci sono (come «ospite 1», «ospite 2»: <strong>nessuna email, nessun nome</strong>), se sono interni o esterni, quante richieste dal modulo hanno e perché l&apos;abbinamento non è certo. Non modifica nulla.
      </p>
      <button type="button" className="cn-btn primario" onClick={lancia} disabled={inCorso || inPausa}>
        {inCorso ? "Diagnosi in corso…" : inPausa ? "Attendi un minuto prima di ripetere…" : "Analizza gli eventi dei casi aperti"}
      </button>

      {esito && !esito.ok && (
        <p className="cn-esito errore" role="alert" style={{ marginTop: 12 }}>
          {esito.errore}
        </p>
      )}
      {esito?.ok && !esito.risultato.eseguita && (
        <p className="cn-esito errore" role="alert" style={{ marginTop: 12 }}>
          Diagnosi non eseguita: {MOTIVO_ASSENTE[esito.risultato.motivo] ?? esito.risultato.motivo}
        </p>
      )}
      {esito?.ok && esito.risultato.eseguita && esito.risultato.eventi.length === 0 && <p className="cn-vuoto">Nessun caso aperto da analizzare.</p>}

      {esito?.ok &&
        esito.risultato.eseguita &&
        esito.risultato.eventi.map((e) => (
          <div key={e.numero} style={{ marginTop: 16 }}>
            <h3 style={{ margin: "0 0 6px" }}>
              Evento {e.numero} · caso «{e.motivoCaso}»
            </h3>
            {!e.trovato ? (
              <p className="cn-nota-inline">L&apos;evento non si è potuto rileggere (non c&apos;è più o la lettura non è riuscita).</p>
            ) : (
              <>
                <p className="cn-nota-inline">
                  Stato {e.stato ?? "—"} · tipo {e.tipoEvento ?? "—"} · titolo {e.titoloDemo ? "riconosciuto come DEMO" : "NON riconosciuto come DEMO"} · creato {e.creatoIl ?? "—"} · inizio {e.inizioIl ?? "—"}
                </p>
                <p className="cn-nota-inline">
                  Organizzatore: {e.organizzatore.presente ? `presente${e.organizzatore.haEmail ? "" : " (senza email)"}, ${e.organizzatore.interno ? "INTERNO" : "ESTERNO"}${e.organizzatore.self ? ", è il calendario stesso" : ""}` : "assente"} · Creatore:{" "}
                  {e.creatore.presente ? `presente${e.creatore.haEmail ? "" : " (senza email)"}, ${e.creatore.interno ? "INTERNO" : "ESTERNO"}${e.creatore.self ? ", è il calendario stesso" : ""}${e.creatore.ancheOspite ? ", è anche tra gli ospiti" : ", non è tra gli ospiti"}` : "assente"}
                </p>
                <div className="cn-scorri">
                  <table className="cn-tab">
                    <thead>
                      <tr>
                        <th>Ospite</th>
                        <th>Ruolo</th>
                        <th>Risposta</th>
                        <th className="num">Richieste dal modulo</th>
                        <th className="num">Candidate per questo evento</th>
                      </tr>
                    </thead>
                    <tbody>
                      {e.ospiti.map((o) => (
                        <tr key={o.ospite}>
                          <td>ospite {o.ospite}</td>
                          <td>
                            <Badge tono={RUOLO[o.ruolo]?.tono ?? "neutro"}>{RUOLO[o.ruolo]?.testo ?? o.ruolo}</Badge>
                          </td>
                          <td>
                            {o.risposta ?? "—"}
                            {o.opzionale ? " (facoltativo)" : ""}
                          </td>
                          <td className="num">{o.richiesteTotali}</td>
                          <td className="num">{o.richiesteCandidate}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {e.richiesteCandidate.length > 0 && (
                  <p className="cn-nota-inline">
                    Richieste candidate: {e.richiesteCandidate.map((r) => `ospite ${r.ospite}, ${r.stato}, ${r.minutiPrimaDellEvento} min prima dell'evento${r.conversioneInviata ? ", conversione già inviata" : ""}`).join(" · ")}
                  </p>
                )}
                <p className="cn-nota-inline">
                  Con le regole di adesso l&apos;esito sarebbe: <Badge tono={e.esitoConLeRegoleDiOra.tipo === "abbinato" ? "ok" : "avviso"}>{e.esitoConLeRegoleDiOra.tipo === "caso" ? `caso «${e.esitoConLeRegoleDiOra.motivo}»` : e.esitoConLeRegoleDiOra.tipo}</Badge>
                  {e.esitoConLeRegoleDiOra.nota ? ` — ${e.esitoConLeRegoleDiOra.nota}` : ""}
                </p>
                <p className="cn-nota-inline">Campi presenti nell&apos;evento (solo i nomi): {e.campiPresenti.join(", ") || "—"}</p>
              </>
            )}
          </div>
        ))}
    </div>
  );
}
