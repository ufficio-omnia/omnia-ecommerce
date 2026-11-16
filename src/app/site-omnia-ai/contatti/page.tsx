import type { Metadata } from "next";
import Link from "next/link";
import PageShell from "@/components/omnia-ai/page-shell";
import { paginaMetadata } from "@/lib/omnia-ai-seo";

export const metadata: Metadata = paginaMetadata({
  title: "Contatti — OMNIA AI",
  description:
    "Contatta OMNIA AI, l'intelligenza artificiale per gare d'appalto di Omnia Consulting: domande, richieste commerciali e assistenza.",
  path: "/contatti",
});

// Riferimenti ufficiali invariati (email, PEC, società): cambia solo l'impaginazione (restyling 16/11/2026). Nessuna testimonianza,
// cliente o certificazione: solo chi siamo e come raggiungerci.
export default function ContattiPage() {
  return (
    <PageShell>
      <section className="omnia-pagina-hero">
        <p className="omnia-occhiello omnia-occhiello-centro">Contatti</p>
        <h1>Contatta OMNIA AI</h1>
        <p className="omnia-sotto" style={{ margin: "24px auto 0" }}>
          Domande sul prodotto, richieste commerciali o assistenza: ti risponde il team di Omnia
          Consulting, lo stesso che da oltre dieci anni redige offerte tecniche per gare
          d&apos;appalto.
        </p>
      </section>

      <section className="omnia-pagina-corpo">
        <ul className="omnia-contatti">
          <li className="omnia-cella">
            <h2 className="omnia-contatti-titolo">Scrivici</h2>
            <p>
              <a className="omnia-contatti-valore" href="mailto:info@omniaitalia.com">
                info@omniaitalia.com
              </a>
            </p>
            <p>Per domande su OMNIA AI, richieste commerciali o assistenza. Rispondiamo entro 24 ore lavorative.</p>
          </li>
          <li className="omnia-cella">
            <h2 className="omnia-contatti-titolo">Posta certificata</h2>
            <p>
              <span className="omnia-contatti-valore">omnia26@legalmail.it</span>
            </p>
            <p>Per le comunicazioni che richiedono valore legale.</p>
          </li>
          <li className="omnia-cella">
            <h2 className="omnia-contatti-titolo">Chi siamo</h2>
            <p>
              <span className="omnia-contatti-valore">Omnia Consulting SRLS</span>
            </p>
            <p>
              OMNIA AI è un prodotto di Omnia Consulting SRLS, P.IVA 02957590819.{" "}
              <a href="https://omniaitalia.com">omniaitalia.com</a>
            </p>
          </li>
        </ul>

        <div className="omnia-dietro omnia-contatti-demo">
          <div>
            <h2>Vuoi vederla su una tua gara?</h2>
          </div>
          <div>
            <p className="omnia-firma">
              La demo si fa su un bando che ti interessa davvero: compili il modulo e scegli subito
              giorno e ora nel calendario. Se sei già cliente, l&apos;assistenza è anche dentro
              l&apos;area riservata.
            </p>
            <div className="omnia-azioni omnia-azioni-sinistra">
              <Link className="omnia-btn omnia-btn-p" href="/demo">
                Richiedi la demo
              </Link>
              <Link className="omnia-btn omnia-btn-s" href="/login">
                Accedi all&apos;area riservata
              </Link>
            </div>
          </div>
        </div>
      </section>
    </PageShell>
  );
}
