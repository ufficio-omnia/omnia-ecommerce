import { Fragment } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import PageShell from "@/components/omnia-ai/page-shell";
import { getCurrentOmniaAiAllegatoAUrl, getCurrentOmniaAiCondizioniAbbonamentoUrl } from "@/lib/omnia-ai-legal";
import {
  RISERVATEZZA_DESCRIZIONE,
  RISERVATEZZA_DOCUMENTI,
  RISERVATEZZA_DOCUMENTI_TITOLO,
  RISERVATEZZA_INTRO,
  RISERVATEZZA_PERCORSO,
  RISERVATEZZA_TITOLO,
  SEZIONI_RISERVATEZZA,
} from "@/lib/omnia-ai-riservatezza";
import { paginaMetadata } from "@/lib/omnia-ai-seo";

export const metadata: Metadata = paginaMetadata({
  title: `${RISERVATEZZA_TITOLO} — OMNIA AI`,
  description: RISERVATEZZA_DESCRIZIONE,
  path: RISERVATEZZA_PERCORSO,
});

// Pagina informativa (non è un documento legale da versionare). I link ai documenti
// puntano sempre alla versione vigente secondo legal_documents: le condizioni e
// l'Allegato A cambiano di versione, la pagina no. Prima della migrazione 0080 l'Allegato
// A non è ancora registrato: allora compare il suo nome senza collegamento, mai un link
// che porta a una pagina inesistente.
export default async function RiservatezzaPage() {
  const [condizioniUrl, allegatoUrl] = await Promise.all([getCurrentOmniaAiCondizioniAbbonamentoUrl(), getCurrentOmniaAiAllegatoAUrl()]);

  return (
    <PageShell>
      <section className="omnia-pagina-hero">
        <h1>{RISERVATEZZA_TITOLO}</h1>
        <p className="omnia-sotto" style={{ margin: "24px auto 0" }}>
          {RISERVATEZZA_INTRO}
        </p>
      </section>

      <section className="omnia-pagina-corpo">
        <div className="omnia-prosa">
          {/* Titoli e paragrafi sono fratelli, senza un contenitore per sezione: il CSS toglie
              il margine superiore all'h2 che è primo figlio del proprio contenitore, e le
              sezioni resterebbero attaccate l'una all'altra. */}
          {SEZIONI_RISERVATEZZA.map((sezione) => (
            <Fragment key={sezione.id}>
              <h2 id={sezione.id}>{sezione.titolo}</h2>
              {sezione.paragrafi.map((paragrafo) => (
                <p key={paragrafo}>{paragrafo}</p>
              ))}
            </Fragment>
          ))}

          <h2 id="documenti-collegati">{RISERVATEZZA_DOCUMENTI_TITOLO}</h2>
          <ul className="omnia-elenco-documenti">
            <li>
              <Link href="/privacy">{RISERVATEZZA_DOCUMENTI.privacy}</Link>
            </li>
            <li>
              <Link href="/cookie-policy">{RISERVATEZZA_DOCUMENTI.cookie}</Link>
            </li>
            <li>
              <Link href={condizioniUrl}>{RISERVATEZZA_DOCUMENTI.condizioni}</Link>
            </li>
            <li>
              {allegatoUrl ? (
                <>
                  <Link href={allegatoUrl}>{RISERVATEZZA_DOCUMENTI.allegato}</Link> (<a href={`${allegatoUrl}/pdf`}>PDF</a>)
                </>
              ) : (
                RISERVATEZZA_DOCUMENTI.allegato
              )}
            </li>
          </ul>
        </div>
      </section>
    </PageShell>
  );
}
