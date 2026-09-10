import type { Metadata } from "next";
import PageShell from "@/components/omnia-ai/page-shell";

export const metadata: Metadata = {
  title: "Contatti — OMNIA AI",
};

export default function ContattiPage() {
  return (
    <PageShell>
      <section className="omnia-pagina-hero">
        <h1>Contatti</h1>
      </section>

      <section className="omnia-pagina-corpo">
        <div className="omnia-prosa">
          <p>
            Per domande su OMNIA AI, richieste commerciali o assistenza scrivi a{" "}
            <a href="mailto:info@omniaitalia.com" style={{ color: "var(--verde)" }}>
              info@omniaitalia.com
            </a>
            . Rispondiamo entro 24 ore lavorative.
          </p>
          <p>
            PEC: <span style={{ color: "var(--testo)" }}>omnia26@legalmail.it</span>
          </p>
          <p>
            OMNIA AI è un prodotto di <strong style={{ color: "var(--testo)" }}>Omnia Consulting SRLS</strong>.
          </p>
        </div>
      </section>
    </PageShell>
  );
}
