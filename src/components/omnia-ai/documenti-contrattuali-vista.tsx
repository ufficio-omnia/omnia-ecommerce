import Link from "next/link";
import { dataOraRoma, dataRoma } from "@/lib/data-it";
import type { GruppoAccettazioni } from "@/lib/omnia-ai-documenti-contrattuali";
import { PIANI, type PianoSlug } from "@/lib/omnia-ai-plans";

// Vista della sezione «Documenti contrattuali» dell'area riservata: per ogni abbonamento
// i documenti che il cliente ha accettato, nella versione esatta, con data e ora
// dell'accettazione in evidenza e il PDF scaricabile. Riceve dati già calcolati.

function nomePiano(piano: string): string {
  return PIANI[piano as PianoSlug]?.nome ?? piano;
}

export default function DocumentiContrattualiVista({
  gruppi,
  mancantiAllegato,
}: {
  gruppi: GruppoAccettazioni[];
  // dati del profilo di fatturazione che mancano per compilare l'Allegato A (vuoto = completo)
  mancantiAllegato: string[];
}) {
  return (
    <div className="omnia-app-shell">
      <Link href="/dashboard/omnia-ai" className="omnia-torna">
        ← Torna alla dashboard
      </Link>

      <h1 className="omnia-app-titolo">Documenti contrattuali</h1>
      <p className="omnia-app-sottotitolo">
        I documenti che hai accettato attivando l&apos;abbonamento, nella versione esatta in cui li hai
        accettati, con data e ora dell&apos;accettazione. Puoi rileggerli e scaricarli in PDF.
      </p>

      {gruppi.length === 0 && (
        <section className="omnia-riquadro">
          <p className="omnia-riquadro-nota">Non risulta ancora nessun abbonamento.</p>
        </section>
      )}

      {gruppi.map((g) => (
        <section className="omnia-riquadro" key={g.abbonamentoId}>
          <span className="omnia-eyebrow">
            Abbonamento {nomePiano(g.piano)} · attivato il {dataRoma(g.creatoIl)}
          </span>

          {g.documenti.length === 0 ? (
            <p className="omnia-riquadro-nota">
              {g.manuale
                ? "Questo abbonamento è stato attivato dal fornitore, senza un acquisto online: non ci sono accettazioni registrate da mostrare."
                : "Per questo abbonamento non risulta registrata nessuna accettazione: è precedente alla registrazione delle accettazioni. Per qualsiasi chiarimento scrivici dalla pagina Supporto."}
            </p>
          ) : (
            <div className="omnia-doc-elenco">
              {g.documenti.map((d) => (
                <div className="omnia-doc-riga" key={d.documentoId}>
                  <div>
                    <div className="omnia-doc-titolo">{d.titolo}</div>
                    <div className="omnia-doc-versione">Versione {d.versione}</div>
                    <div className="omnia-doc-accettazione">
                      <strong>Accettato il {dataOraRoma(d.accettatoIl)}</strong>
                    </div>
                  </div>
                  <div className="omnia-doc-azioni">
                    <Link className="omnia-btn omnia-btn-s omnia-btn-piccolo" href={`/documenti-legali/${d.slug}/${d.versione}`} target="_blank">
                      Leggi
                    </Link>
                    <a className="omnia-btn omnia-btn-p omnia-btn-piccolo" href={`/documenti-legali/${d.slug}/${d.versione}/pdf?abbonamento=${g.abbonamentoId}`}>
                      Scarica PDF
                    </a>
                  </div>
                  {d.tipoDb === "omnia_ai_allegato_a" && (
                    <div className="omnia-doc-avviso">
                      {mancantiAllegato.length === 0 ? (
                        <p className="omnia-riquadro-nota" style={{ margin: 0 }}>
                          Il PDF è compilato con i dati di fatturazione del tuo profilo azienda.
                        </p>
                      ) : (
                        <p className="omnia-messaggio-stato avviso" style={{ margin: 0 }}>
                          Nel profilo azienda mancano: {mancantiAllegato.join(", ")}. Il PDF si scarica con i campi vuoti da compilare:{" "}
                          <Link href="/dashboard/omnia-ai/profilo-azienda">completa i dati di fatturazione</Link> per averlo già compilato.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {g.cookie && (
                <div className="omnia-doc-riga">
                  <div>
                    <div className="omnia-doc-titolo">{g.cookie.titolo}</div>
                    <div className="omnia-doc-versione">Versione {g.cookie.versione}, in vigore dal {dataRoma(g.cookie.inVigoreDal)}</div>
                    <div className="omnia-doc-accettazione">Versione in vigore al momento dell&apos;attivazione. Non è un documento da accettare: il consenso ai cookie si gestisce dal banner.</div>
                  </div>
                  <div className="omnia-doc-azioni">
                    <Link className="omnia-btn omnia-btn-s omnia-btn-piccolo" href={`/documenti-legali/${g.cookie.slug}/${g.cookie.versione}`} target="_blank">
                      Leggi
                    </Link>
                    <a className="omnia-btn omnia-btn-p omnia-btn-piccolo" href={`/documenti-legali/${g.cookie.slug}/${g.cookie.versione}/pdf`}>
                      Scarica PDF
                    </a>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      ))}

      <p className="omnia-riquadro-nota">
        Le versioni successive dei documenti non modificano quelle che hai già accettato: a ogni periodo di abbonamento si applicano le condizioni vigenti al suo avvio.
      </p>
    </div>
  );
}
