import { testoPresenza, type PresenzaCalcolata } from "@/lib/omnia-ai-presenza-calcoli";
import type { PresenzaUtente } from "@/lib/console/presenza";
import { Badge, Pannello } from "./elementi";
import { formattaDataOra } from "./formati";

// Mattoni per mostrare la presenza (migrazione 0094) nella console: un badge e una cella a due righe. Solo markup, nessuno
// stato: usabili da Server Component. I dati sono già calcolati (lib/omnia-ai-presenza-calcoli.ts).

export function BadgePresenza({ p }: { p: PresenzaCalcolata }) {
  if (p.stato === "attivo") return <Badge tono="ok">online · attivo</Badge>;
  if (p.stato === "fermo") return <Badge tono="accento">online · fermo</Badge>;
  return <Badge>{p.stato === "mai" ? "mai in linea" : "offline"}</Badge>;
}

// Seconda riga della cella: per chi è collegato la sezione, per chi non lo è come e quando ha lasciato.
export function dettaglioPresenza(p: PresenzaCalcolata): string | null {
  if (p.stato === "mai") return null;
  if (p.stato === "attivo" || p.stato === "fermo") return p.etichettaSezione ?? null;
  if (p.uscitoConEsciIl) return `uscito con «Esci» il ${formattaDataOra(p.uscitoConEsciIl)}`;
  return p.ultimoSegnale ? `ultimo segnale ${formattaDataOra(p.ultimoSegnale)}` : null;
}

export function CellaPresenza({ p }: { p: PresenzaCalcolata }) {
  const dettaglio = dettaglioPresenza(p);
  return (
    <span className="cn-cella-doppia" title={testoPresenza(p, formattaDataOra)}>
      <BadgePresenza p={p} />
      {dettaglio && <small>{dettaglio}</small>}
    </span>
  );
}

// Il riquadro della scheda cliente: dove si trova adesso, da quando, quando ha lavorato l'ultima volta, come e quando è uscito.
export function PannelloPresenza({ presenza }: { presenza: PresenzaUtente }) {
  const p = presenza.presenza;
  const inLinea = p.stato === "attivo" || p.stato === "fermo";
  return (
    <Pannello titolo="Presenza nell'area riservata">
      <div className="cn-pannello-corpo">
        {!presenza.disponibile ? (
          <p className="cn-nota-inline">La presenza non è ancora attiva (migrazione 0094 non eseguita).</p>
        ) : (
          <>
            <dl className="cn-dl">
              <div>
                <dt>Stato</dt>
                <dd>
                  <BadgePresenza p={p} />
                </dd>
              </div>
              {inLinea && (
                <>
                  <div>
                    <dt>Dove si trova</dt>
                    <dd>{p.etichettaSezione ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>In linea da</dt>
                    <dd>{p.inSessioneDa ? formattaDataOra(p.inSessioneDa) : "—"}</dd>
                  </div>
                </>
              )}
              <div>
                <dt>Ultima attività</dt>
                <dd>{p.ultimaAttivita ? formattaDataOra(p.ultimaAttivita) : "—"}</dd>
              </div>
              <div>
                <dt>Ultimo segnale</dt>
                <dd>{p.ultimoSegnale ? formattaDataOra(p.ultimoSegnale) : "—"}</dd>
              </div>
              <div>
                <dt>Ultima uscita con «Esci»</dt>
                <dd>{p.ultimaUscitaEsciIl ? formattaDataOra(p.ultimaUscitaEsciIl) : "—"}</dd>
              </div>
            </dl>
            <p className="cn-nota-inline" style={{ marginTop: 10 }}>
              {p.stato === "mai"
                ? "Non ha ancora aperto l'area riservata da quando la presenza è attiva."
                : p.stato === "offline" && !p.uscitoConEsciIl
                  ? "È uscito senza premere «Esci» (scheda o browser chiusi): vale l'ultimo segnale, al più 45 secondi prima."
                  : "Il segnale arriva ogni 45 secondi circa finché la scheda è aperta e visibile. «Attivo» = nell'ultimo minuto ha usato mouse, tastiera, scorrimento o tocco. Si registra solo la sezione, mai quale gara."}
            </p>
          </>
        )}
      </div>
    </Pannello>
  );
}
