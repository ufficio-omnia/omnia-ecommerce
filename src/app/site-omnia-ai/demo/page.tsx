import type { Metadata } from "next";
import PageShell from "@/components/omnia-ai/page-shell";
import DemoForm from "@/components/omnia-ai/demo-form";
import { paginaMetadata } from "@/lib/omnia-ai-seo";

export const metadata: Metadata = paginaMetadata({
  title: "Richiedi la demo — OMNIA AI",
  description:
    "Richiedi la demo di OMNIA AI su una gara d'appalto vera, non su un esempio preconfezionato. Lasci i tuoi dati e scegli subito giorno e ora nel calendario.",
  path: "/demo",
});

// Solo presentazione (restyling 16/11/2026): il modulo, la validazione, il salvataggio, i consensi, i tracciamenti e l'apertura del
// calendario restano tutti in DemoForm, invariati. I due passaggi qui sotto dicono soltanto che la demo è confermata quando si sceglie
// l'orario nel calendario, come dice già il modulo dopo l'invio.
const PASSAGGI = [
  {
    titolo: "Compila il modulo",
    testo: "Nome, azienda, email, telefono e settore di attività: nient'altro.",
  },
  {
    titolo: "Scegli giorno e ora",
    testo: "Dopo l'invio si apre il calendario in una nuova scheda: la demo è confermata quando prenoti l'orario.",
  },
];

export default function DemoPage() {
  return (
    <PageShell>
      <section className="omnia-pagina-hero">
        <p className="omnia-occhiello omnia-occhiello-centro">Richiedi la demo</p>
        <h1>OMNIA AI: portaci una gara vera. Ti mostriamo cosa esce</h1>
        <p className="omnia-sotto" style={{ margin: "24px auto 0" }}>
          Nessuna presentazione preconfezionata: lavoriamo su un bando che ti interessa davvero.
          Lasciaci i tuoi dati e scegli subito giorno e ora della demo nel calendario.
        </p>
      </section>

      <section className="omnia-pagina-corpo">
        <ol className="omnia-percorso-demo" aria-label="Come si prenota la demo">
          {PASSAGGI.map((p, i) => (
            <li key={p.titolo}>
              <span className="omnia-tappa-numero" aria-hidden="true">
                {i + 1}
              </span>
              <div>
                <b>{p.titolo}</b>
                <p>{p.testo}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="omnia-modulo-riquadro">
          <DemoForm />
        </div>
      </section>
    </PageShell>
  );
}
