import type { EventoAccesso, SintesiRegistro } from "@/lib/console/registro-accessi";
import type { StatoSistema } from "@/lib/console/stato-sistema";
import { Badge, Pannello, Tessera, type Tono } from "./elementi";
import { formattaDataOra, formattaDurata } from "./formati";

// Vista pura della Panoramica: riceve dati già letti, non accede a nulla. La
// pagina (che richiede l'admin) legge i dati e la passa qui.

const ETICHETTA_EVENTO: Record<EventoAccesso, { testo: string; tono: Tono }> = {
  accesso: { testo: "Accesso", tono: "ok" },
  link_inviato: { testo: "Link inviato", tono: "accento" },
  link_negato: { testo: "Email non abilitata", tono: "avviso" },
  link_limitato: { testo: "Richiesta limitata", tono: "neutro" },
  link_errore: { testo: "Link non inviato", tono: "errore" },
  accesso_rifiutato: { testo: "Accesso rifiutato", tono: "errore" },
};

// Sintesi dello user agent: il browser e il sistema bastano a riconoscere un
// accesso estraneo senza mostrare la stringa intera.
function sintesiUserAgent(ua: string | null): string {
  if (!ua) return "—";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Altro";
  const sistema = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad/.test(ua)
        ? "iOS"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return sistema ? `${browser} · ${sistema}` : browser;
}

export default function PanoramicaVista({
  scadeIl,
  scadeTraMs,
  registro,
  sistema,
}: {
  scadeIl: Date;
  scadeTraMs: number;
  registro: SintesiRegistro;
  sistema: StatoSistema;
}) {
  const problemi = sistema.voci.filter((v) => v.esito === "errore").length;

  return (
    <>
      <div className="cn-testata">
        <div>
          <h1>Panoramica</h1>
          <p>Console amministrativa OMNIA · accesso e stato del sistema</p>
        </div>
      </div>

      <div className="cn-tessere">
        <Tessera etichetta="Sessione" valore={formattaDurata(scadeTraMs)} dettaglio={`Scade il ${formattaDataOra(scadeIl)}`} />
        <Tessera
          etichetta="Accessi (24 h)"
          valore={registro.disponibile ? registro.accessi24h : "—"}
          dettaglio={registro.disponibile ? "Link usati con successo" : "Registro non ancora attivo"}
        />
        <Tessera
          etichetta="Tentativi negati (7 gg)"
          valore={registro.disponibile ? registro.negati7g : "—"}
          tono={registro.negati7g > 0 ? "avviso" : "neutro"}
          dettaglio={
            registro.disponibile
              ? registro.negati7g > 0
                ? "Email non abilitate o link rifiutati: controlla il registro"
                : "Nessuna richiesta estranea"
              : "Registro non ancora attivo"
          }
        />
        <Tessera
          etichetta="Stato sistema"
          valore={problemi === 0 ? "OK" : problemi}
          unita={problemi === 0 ? undefined : problemi === 1 ? "problema" : "problemi"}
          tono={problemi === 0 ? "ok" : "errore"}
          dettaglio={sistema.pingMs !== null ? `Database in ${sistema.pingMs} ms` : "Database non raggiungibile"}
        />
      </div>

      <div className="cn-colonne">
        <Pannello titolo="Stato del sistema">
          <div className="cn-scorri">
            <table className="cn-tab">
              <thead>
                <tr>
                  <th>Voce</th>
                  <th>Esito</th>
                  <th>Dettaglio</th>
                </tr>
              </thead>
              <tbody>
                {sistema.voci.map((v) => (
                  <tr key={v.voce}>
                    <td className="nowrap">{v.voce}</td>
                    <td>
                      <Badge tono={v.esito}>{v.esito === "ok" ? "ok" : v.esito === "avviso" ? "attenzione" : "errore"}</Badge>
                    </td>
                    <td style={{ color: "var(--cn-secondario)" }}>{v.dettaglio}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Pannello>

        <Pannello titolo="Ultimi eventi di accesso">
          {registro.righe.length === 0 ? (
            <p className="cn-vuoto">
              {registro.disponibile ? "Nessun evento registrato." : "Registro non attivo: eseguire la migrazione 0074."}
            </p>
          ) : (
            <div className="cn-scorri">
              <table className="cn-tab">
                <thead>
                  <tr>
                    <th>Quando</th>
                    <th>Evento</th>
                    <th>Email</th>
                    <th>Origine</th>
                  </tr>
                </thead>
                <tbody>
                  {registro.righe.map((r) => {
                    const evento = ETICHETTA_EVENTO[r.evento];
                    return (
                      <tr key={r.id}>
                        <td className="mono">{formattaDataOra(r.created_at)}</td>
                        <td>
                          <Badge tono={evento.tono}>{evento.testo}</Badge>
                        </td>
                        <td className="tronca" title={r.email ?? undefined}>
                          {r.email ?? "—"}
                        </td>
                        <td className="mono" title={r.user_agent ?? undefined}>
                          {[r.ip, r.user_agent ? sintesiUserAgent(r.user_agent) : null].filter(Boolean).join(" · ") || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Pannello>
      </div>
    </>
  );
}
