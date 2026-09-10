import type { Metadata } from "next";
import PageShell from "@/components/omnia-ai/page-shell";
import DemoForm from "@/components/omnia-ai/demo-form";

export const metadata: Metadata = {
  title: "Richiedi la demo — OMNIA AI",
  description: "Demo su una gara vera, non su un esempio preconfezionato. Rispondiamo entro 24 ore.",
};

export default function DemoPage() {
  return (
    <PageShell>
      <section className="omnia-pagina-hero">
        <h1>Portaci una gara vera. Ti mostriamo cosa esce.</h1>
        <p className="omnia-sotto" style={{ margin: "24px auto 0" }}>
          Nessuna presentazione preconfezionata: lavoriamo su un bando che ti interessa davvero.
          Rispondiamo entro 24 ore.
        </p>
      </section>

      <section className="omnia-pagina-corpo">
        <DemoForm />
      </section>
    </PageShell>
  );
}
