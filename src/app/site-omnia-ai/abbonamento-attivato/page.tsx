import type { Metadata } from "next";
import Link from "next/link";
import PageShell from "@/components/omnia-ai/page-shell";

export const metadata: Metadata = {
  title: "Abbonamento attivato — OMNIA AI",
  robots: { index: false, follow: false },
};

// Landing dopo il pagamento SOLO per il percorso anonimo (/abbonati/[piano]):
// il cliente non ha ancora una sessione, portarlo in dashboard mostrerebbe
// di nuovo la schermata di vendita. Non sappiamo qui, al momento del
// rendering, se l'email corrispondeva a un account nuovo o già esistente
// (lo decide il webhook, che potrebbe non aver ancora finito) — il
// messaggio copre entrambi i casi senza doverlo indovinare.
export default function AbbonamentoAttivatoPage() {
  return (
    <PageShell>
      <section className="omnia-pagina-hero">
        <h1>Pagamento completato</h1>
        <p className="omnia-sotto" style={{ margin: "24px auto 0" }}>
          Grazie per esserti abbonato a OMNIA AI. Se è la prima volta che usi questa email,
          controlla la tua casella: ti abbiamo inviato un link per impostare la password e accedere
          alla tua area riservata. Se avevi già un account, puoi accedere subito.
        </p>
        <div style={{ marginTop: 24 }}>
          <Link href="/login" className="omnia-btn omnia-btn-p">
            Accedi
          </Link>
        </div>
      </section>
    </PageShell>
  );
}
