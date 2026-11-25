import type { Metadata } from "next";
import Link from "next/link";
import PageShell from "@/components/omnia-ai/page-shell";
import { paginaMetadata } from "@/lib/omnia-ai-seo";
import { DESCRIZIONE_RICERCA_GARE, PERCORSO_RICERCA_GARE, SITO_RICERCA_GARE as T } from "@/lib/ricerca-gare-testi";

export const metadata: Metadata = paginaMetadata({
  title: "Ricerca gare — OMNIA AI",
  description: DESCRIZIONE_RICERCA_GARE,
  path: PERCORSO_RICERCA_GARE,
});

// «Ricerca gare» (25/11/2026): la funzione «Opportunità» dell'area riservata spiegata al pubblico. Stile e struttura di «Come funziona».
// Testi in src/lib/ricerca-gare-testi.ts, confrontati con il codice da scripts/verifica-testi-ricerca-gare.ts.
export default function RicercaGarePage() {
  return (
    <PageShell>
      <section className="omnia-pagina-hero">
        <p className="omnia-occhiello omnia-occhiello-centro">{T.occhiello}</p>
        <h1>{T.titolo}</h1>
        <p className="omnia-sotto" style={{ margin: "24px auto 0" }}>
          {T.sotto}
        </p>
      </section>

      <section className="omnia-pagina-corpo">
        <h2>{T.funzioniTitolo}</h2>
        <ol className="omnia-passi">
          {T.funzioni.map((f) => (
            <li key={f.titolo} className="omnia-passo">
              <div>
                <b>{f.titolo}</b>
                <p>{f.testo}</p>
              </div>
            </li>
          ))}
        </ol>

        <h2>{T.fontiTitolo}</h2>
        <p className="omnia-guida">{T.fontiTesto}</p>

        <h2>{T.settoriTitolo}</h2>
        <ul className="omnia-elenco">
          {T.settori.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>

        <h2>{T.limitiTitolo}</h2>
        <ul className="omnia-tre omnia-distinzione">
          {T.limiti.map((l) => (
            <li key={l.titolo} className="omnia-cella">
              <h3>{l.titolo}</h3>
              <p>{l.testo}</p>
            </li>
          ))}
        </ul>

        <div className="omnia-dietro omnia-chiusura">
          <div>
            <h2>{T.chiusuraTitolo}</h2>
          </div>
          <div>
            <p className="omnia-firma">{T.chiusuraTesto}</p>
            <div className="omnia-azioni omnia-azioni-sinistra">
              <Link className="omnia-btn omnia-btn-p" href="/piani">
                Vedi i piani
              </Link>
              <Link className="omnia-btn omnia-btn-s" href="/demo">
                Richiedi la demo
              </Link>
            </div>
          </div>
        </div>
      </section>
    </PageShell>
  );
}
