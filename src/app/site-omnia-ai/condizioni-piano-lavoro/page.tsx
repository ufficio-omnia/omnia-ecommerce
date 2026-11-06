import { Fragment } from "react";
import { createHash } from "crypto";
import type { Metadata } from "next";
import Link from "next/link";
import PageShell from "@/components/omnia-ai/page-shell";
import { getCurrentOmniaAiCondizioniAbbonamentoUrl } from "@/lib/omnia-ai-legal";
import { paginaMetadata } from "@/lib/omnia-ai-seo";
import { CLAUSOLE_PIANO_LAVORO, VERSIONE_CONDIZIONI_PIANO_LAVORO, testoCanonicoCondizioniPianoLavoro } from "@/lib/piano-lavoro-acquisto-calcoli";
import { CONDIZIONI_INTRO, DESCRIZIONE_CONDIZIONI_PIANO_LAVORO, FORNITORE_PIANO_LAVORO, PERCORSO_CONDIZIONI_PIANO_LAVORO, TITOLO_CONDIZIONI_PIANO_LAVORO } from "@/lib/piano-lavoro-testi";

// Le condizioni del servizio «Piano di lavoro»: le STESSE clausole (stesso testo, stessa versione, stessa impronta) che il cliente accetta nel modulo
// di acquisto. Non è un documento di legal_documents (niente migrazione): il testo sta nel codice, versionato, e di ogni accettazione si conserva
// la versione e l'impronta. Non si indicizza: è raggiungibile dai moduli d'acquisto e dalle email, non è una pagina da trovare dai motori di ricerca.
export const metadata: Metadata = {
  ...paginaMetadata({ title: `${TITOLO_CONDIZIONI_PIANO_LAVORO} — OMNIA AI`, description: DESCRIZIONE_CONDIZIONI_PIANO_LAVORO, path: PERCORSO_CONDIZIONI_PIANO_LAVORO }),
  robots: { index: false, follow: true },
};

export default async function CondizioniPianoLavoroPage() {
  const condizioniAbbonamentoUrl = await getCurrentOmniaAiCondizioniAbbonamentoUrl();
  const impronta = createHash("sha256").update(testoCanonicoCondizioniPianoLavoro()).digest("hex");

  return (
    <PageShell>
      <section className="omnia-pagina-hero">
        <h1>{TITOLO_CONDIZIONI_PIANO_LAVORO}</h1>
        <p className="omnia-sotto" style={{ margin: "24px auto 0" }}>
          Versione {VERSIONE_CONDIZIONI_PIANO_LAVORO}
        </p>
      </section>

      <section className="omnia-pagina-corpo">
        <div className="omnia-prosa">
          <p>{FORNITORE_PIANO_LAVORO}</p>
          {CONDIZIONI_INTRO.map((paragrafo) => (
            <p key={paragrafo}>{paragrafo}</p>
          ))}

          {/* Titoli e paragrafi sono fratelli, senza un contenitore per clausola: il CSS toglie il margine superiore all'h2 che è primo figlio. */}
          {CLAUSOLE_PIANO_LAVORO.map((c) => (
            <Fragment key={c.numero}>
              <h2 id={`clausola-${c.numero}`}>
                {c.numero}. {c.titolo}
              </h2>
              <p>{c.testo}</p>
              {c.specifica && (
                <p>
                  <em>Clausola da approvare specificamente, ai sensi di legge, al momento dell&apos;acquisto.</em>
                </p>
              )}
            </Fragment>
          ))}

          <h2 id="impronta">Impronta del testo</h2>
          <p>
            L&apos;impronta (SHA-256) del testo di queste clausole, versione {VERSIONE_CONDIZIONI_PIANO_LAVORO}, è <code style={{ wordBreak: "break-all" }}>{impronta}</code>. Si registra con ogni accettazione: se anche una sola parola cambiasse, la versione e l&apos;impronta
            cambierebbero.
          </p>

          <h2 id="documenti-collegati">Documenti collegati</h2>
          <ul className="omnia-elenco-documenti">
            <li>
              <Link href={condizioniAbbonamentoUrl}>Condizioni generali di abbonamento</Link>
            </li>
            <li>
              <Link href="/privacy">Privacy policy</Link>
            </li>
            <li>
              <Link href="/riservatezza">Riservatezza e trattamento dei dati</Link>
            </li>
          </ul>
        </div>
      </section>
    </PageShell>
  );
}
