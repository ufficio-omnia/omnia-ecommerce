import type { Metadata } from "next";
import PageShell from "@/components/omnia-ai/page-shell";
import TenderWeeklyIscrizione from "@/components/omnia-ai/tender-weekly-iscrizione";
import { paginaMetadata } from "@/lib/omnia-ai-seo";

export const metadata: Metadata = paginaMetadata({
  title: "Tender Weekly — la newsletter sugli appalti pubblici di OMNIA AI",
  description:
    "Ogni venerdì le principali novità del mondo degli appalti pubblici: normativa, provvedimenti delle autorità, giurisprudenza e approfondimenti operativi per gli uffici gare. Iscrizione gratuita.",
  path: "/newsletter",
});

// Pagina pubblica di Tender Weekly: presentazione e iscrizione gratuita (senza account né abbonamento).
export default function PaginaNewsletter() {
  return (
    <PageShell>
      <section className="omnia-pagina-hero">
        <p className="omnia-occhiello omnia-occhiello-centro">Newsletter</p>
        <h1>Tender Weekly</h1>
        <p className="omnia-sotto" style={{ margin: "24px auto 0" }}>
          Il mondo degli appalti pubblici, ogni settimana. Una lettura breve e documentata per imprenditori, direttori commerciali e uffici gare: le novità che contano, cosa cambiano in
          pratica e dove verificarle.
        </p>
      </section>
      <section className="omnia-pagina-corpo">
        <TenderWeeklyIscrizione variante="pagina" />
        <p className="omnia-nota-sezione" style={{ marginTop: 28 }}>
          I contenuti hanno finalità informativa e non costituiscono consulenza legale. Ti puoi disiscrivere in qualunque momento dal link presente in ogni email.
        </p>
      </section>
    </PageShell>
  );
}
