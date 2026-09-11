import type { Metadata } from "next";
import PageShell from "@/components/omnia-ai/page-shell";

export const metadata: Metadata = {
  title: "Privacy policy — OMNIA AI",
  robots: { index: false, follow: false },
};

// Struttura pronta, testo segnaposto: il testo legale definitivo lo
// fornisce Ufficio Omnia. Stessi titoli di sezione già usati nella
// privacy policy dell'e-commerce (src/components/legal/privacy-policy-v1.tsx),
// da adattare al trattamento dati specifico di OMNIA AI (documenti di
// gara caricati, non solo dati di fatturazione/ordine).
//
// Quando arriva il testo: creare src/components/omnia-ai/legal/privacy-policy-v1.tsx,
// registrarlo in .../documenti-legali/[type]/[version]/page.tsx sotto
// "privacy-policy" → "1", e sostituire il blocco sotto con <PrivacyPolicyV1 />
// — esattamente come fa src/app/(ecommerce)/privacy/page.tsx.
export default function PrivacyPage() {
  return (
    <PageShell>
      <section className="omnia-pagina-hero">
        <h1>Privacy policy</h1>
      </section>

      <section className="omnia-pagina-corpo">
        <div className="omnia-prosa">
          <p>Testo in preparazione — questa pagina sarà aggiornata con l&apos;informativa completa.</p>
          <h2>Titolare del trattamento</h2>
          <p>—</p>
          <h2>Dati raccolti</h2>
          <p>—</p>
          <h2>Finalità del trattamento</h2>
          <p>—</p>
          <h2>Conservazione dei documenti di gara</h2>
          <p>—</p>
          <h2>Diritti dell&apos;interessato</h2>
          <p>—</p>
        </div>
      </section>
    </PageShell>
  );
}
