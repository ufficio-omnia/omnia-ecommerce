import type { Metadata } from "next";
import PageShell from "@/components/omnia-ai/page-shell";

export const metadata: Metadata = {
  title: "Condizioni di abbonamento — OMNIA AI",
  robots: { index: false, follow: false },
};

// Struttura pronta, testo segnaposto: il testo legale definitivo lo
// fornisce Ufficio Omnia. Documento nuovo, senza equivalente diretto
// nell'e-commerce (che ha "condizioni di vendita" per l'acquisto di un
// documento, non un abbonamento ricorrente) — sezioni provvisorie, da
// correggere sul testo reale quando arriva.
export default function CondizioniAbbonamentoPage() {
  return (
    <PageShell>
      <section className="omnia-pagina-hero">
        <h1>Condizioni di abbonamento</h1>
      </section>

      <section className="omnia-pagina-corpo">
        <div className="omnia-prosa">
          <p>Testo in preparazione — questa pagina sarà aggiornata con le condizioni complete.</p>
          <h2>Oggetto del servizio</h2>
          <p>—</p>
          <h2>Piani, crediti e rinnovo</h2>
          <p>—</p>
          <h2>Recesso e disdetta</h2>
          <p>—</p>
          <h2>Limiti di responsabilità</h2>
          <p>—</p>
          <h2>Trattamento dei documenti caricati</h2>
          <p>—</p>
        </div>
      </section>
    </PageShell>
  );
}
