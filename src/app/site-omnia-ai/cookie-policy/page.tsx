import type { Metadata } from "next";
import PageShell from "@/components/omnia-ai/page-shell";

export const metadata: Metadata = {
  title: "Cookie policy — OMNIA AI",
  robots: { index: false, follow: false },
};

// Struttura pronta, testo segnaposto: il testo legale definitivo lo
// fornisce Ufficio Omnia. Il banner cookie di questo dominio
// (src/components/omnia-ai/cookie-consent.tsx) non ha ancora un tag
// Google Ads collegato — questa pagina andrà aggiornata quando ce l'avrà.
//
// Quando arriva il testo: creare src/components/omnia-ai/legal/cookie-policy-v1.tsx,
// registrarlo in .../documenti-legali/[type]/[version]/page.tsx sotto
// "cookie-policy" → "1", e sostituire il blocco sotto con <CookiePolicyV1 />
// — esattamente come fa src/app/(ecommerce)/cookie-policy/page.tsx.
export default function CookiePolicyPage() {
  return (
    <PageShell>
      <section className="omnia-pagina-hero">
        <h1>Cookie policy</h1>
      </section>

      <section className="omnia-pagina-corpo">
        <div className="omnia-prosa">
          <p>Testo in preparazione — questa pagina sarà aggiornata con l&apos;informativa completa.</p>
          <h2>Cookie tecnici</h2>
          <p>—</p>
          <h2>Cookie di profilazione/pubblicitari</h2>
          <p>Caricati solo dopo consenso esplicito, mai automaticamente. —</p>
          <h2>Come modificare le preferenze</h2>
          <p>Dal link &quot;Preferenze cookie&quot; nel piè di pagina, in qualsiasi momento.</p>
        </div>
      </section>
    </PageShell>
  );
}
