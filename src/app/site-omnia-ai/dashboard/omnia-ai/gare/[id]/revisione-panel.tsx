import Link from "next/link";
import { formatEuro } from "@/lib/omnia-ai-plans";
import { REVISIONE, descriviFontePagine, testoRegoleUrgenza, testoScadenza, type EsitoPrezzoRevisione } from "@/lib/omnia-ai-revisione-calcoli";
import type { RichiestaRevisione } from "@/lib/omnia-ai-revisione";
import RevisioneAvvisoForm from "./revisione-avviso-form";

// Riquadro «Revisione umana» dentro la gara: compare solo dopo la relazione tecnica FINALE (con tutti i
// criteri). Spiega che cosa si ottiene, i tempi, quanto costa per QUESTA gara e quando il prezzo sale, e
// porta alla pagina di acquisto.
export default function RevisionePanel({
  garaId,
  esito,
  pagata,
  ufficioGare = false,
}: {
  garaId: string;
  esito: EsitoPrezzoRevisione;
  pagata: RichiestaRevisione | null;
  // l'Ufficio Gare vede la spiegazione ma non il prezzo, e il pulsante avvisa l'amministratore invece di aprire il pagamento
  ufficioGare?: boolean;
}) {
  const prezzo = esito.ok ? esito.prezzo : null;

  return (
    <section className="omnia-riquadro" style={{ marginTop: 24 }} aria-labelledby="revisione-umana-titolo">
      <span className="omnia-eyebrow" id="revisione-umana-titolo">
        Revisione umana
      </span>
      <h2 style={{ margin: "8px 0 4px", fontSize: 20 }}>Fai rivedere la relazione tecnica da un consulente</h2>
      <p className="omnia-riquadro-nota" style={{ marginTop: 0 }}>
        La relazione finale è pronta. Se vuoi, un consulente umano la rivede e la rifinisce prima della consegna.
      </p>

      <ul style={{ margin: "12px 0", paddingLeft: 20, lineHeight: 1.6 }}>
        <li>
          Un consulente umano si mette in contatto personale con te <strong>entro {REVISIONE.oreContattoLavorative} ore lavorative</strong> dall&apos;invio della richiesta.
        </li>
        <li>
          La revisione ti viene consegnata <strong>entro {REVISIONE.oreConsegna} ore</strong> dall&apos;invio della richiesta.
        </li>
        <li>
          La revisione comprende <strong>intestazione, piè di pagina e copertina grafica personalizzata</strong>.
        </li>
      </ul>

      {pagata ? (
        <div className="omnia-messaggio-stato successo">
          <p style={{ margin: 0 }}>
            <strong>Revisione umana richiesta</strong> il {new Date(pagata.pagata_il ?? pagata.creata_il).toLocaleDateString("it-IT", { timeZone: "Europe/Rome" })}. Un consulente contatterà {pagata.referente_nome} entro {REVISIONE.oreContattoLavorative} ore lavorative e la
            relazione revisionata arriverà entro {REVISIONE.oreConsegna} ore.
          </p>
        </div>
      ) : !esito.ok ? (
        <div className="omnia-messaggio-stato avviso">
          <p style={{ margin: 0 }}>{esito.messaggio}</p>
        </div>
      ) : ufficioGare ? (
        <RevisioneAvvisoForm garaId={garaId} />
      ) : (
        <>
          <div className="omnia-dati-griglia" style={{ marginTop: 8 }}>
            <div className="omnia-dato">
              <div className="omnia-dato-etichetta">Prezzo per questa gara</div>
              <div className="omnia-dato-valore">{formatEuro(prezzo!.totaleCentesimi)}</div>
              <div className="omnia-riquadro-nota" style={{ margin: "4px 0 0" }}>
                IVA inclusa
              </div>
            </div>
            <div className="omnia-dato">
              <div className="omnia-dato-etichetta">Pagine considerate</div>
              <div className="omnia-dato-valore">{prezzo!.pagine}</div>
              <div className="omnia-riquadro-nota" style={{ margin: "4px 0 0" }}>
                {descriviFontePagine(prezzo!.fonte)}
              </div>
            </div>
          </div>
          {prezzo!.maggiorazionePercentuale > 0 && (
            <p className="omnia-messaggio-stato avviso" style={{ marginTop: 12 }}>
              La gara scade {testoScadenza(prezzo!.scadenza, prezzo!.scadenzaOra)}: il prezzo comprende una maggiorazione per urgenza del <strong>{prezzo!.maggiorazionePercentuale}%</strong> (base {formatEuro(prezzo!.baseCentesimi)}).
            </p>
          )}
          <p className="omnia-riquadro-nota">
            Il prezzo va da {formatEuro(REVISIONE.prezzoBaseCentesimi)} (fino a {REVISIONE.pagineBase} pagine) a {formatEuro(REVISIONE.prezzoMassimoCentesimi)} ({REVISIONE.pagineMassimo} pagine o più). {testoRegoleUrgenza()}
          </p>
          <p style={{ margin: "16px 0 0" }}>
            <Link href={`/dashboard/omnia-ai/gare/${garaId}/revisione`} className="omnia-btn omnia-btn-p">
              RICHIEDI REVISIONE UMANA
            </Link>
          </p>
        </>
      )}
    </section>
  );
}
