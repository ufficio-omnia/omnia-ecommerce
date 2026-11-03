import type { Metadata } from "next";
import PageShell from "@/components/omnia-ai/page-shell";
import DemoForm from "@/components/omnia-ai/demo-form";
import LinkDemo from "@/components/omnia-ai/link-demo";
import { paginaMetadata } from "@/lib/omnia-ai-seo";

export const metadata: Metadata = paginaMetadata({
  title: "Richiedi la demo — OMNIA AI",
  description:
    "Richiedi la demo di OMNIA AI su una gara d'appalto vera, non su un esempio preconfezionato. Rispondiamo entro 24 ore.",
  path: "/demo",
});

export default function DemoPage() {
  return (
    <PageShell>
      <section className="omnia-pagina-hero">
        <h1>OMNIA AI: portaci una gara vera. Ti mostriamo cosa esce.</h1>
        <p className="omnia-sotto" style={{ margin: "24px auto 0" }}>
          Nessuna presentazione preconfezionata: lavoriamo su un bando che ti interessa davvero.
          Rispondiamo entro 24 ore.
        </p>
        <div className="omnia-azioni">
          <LinkDemo className="omnia-btn omnia-btn-p" testo="Prenota direttamente la demo" />
        </div>
        <p className="micro" style={{ marginTop: 18, fontSize: 13.5, color: "var(--fioco)" }}>
          Scegli tu giorno e ora nel calendario. Oppure compila il modulo qui sotto.
        </p>
      </section>

      <section className="omnia-pagina-corpo">
        <DemoForm />
      </section>
    </PageShell>
  );
}
