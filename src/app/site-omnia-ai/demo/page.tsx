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

// Solo presentazione: il modulo, la validazione, il salvataggio, i consensi, l'anti-spam, i tracciamenti e l'apertura del calendario
// restano tutti in DemoForm, invariati (anche il pulsante di riserva se la nuova scheda non si apre). I tre passaggi dicono soltanto che
// la demo è confermata quando si sceglie l'orario, come dice già il modulo dopo l'invio. Durata, gratuità e modalità dell'incontro non
// sono scritte da nessuna parte: non si indicano.
const PASSAGGI = ["Compili il modulo", "Si apre il calendario in una nuova scheda", "Scegli giorno e ora: la demo è confermata"];

export default function DemoPage() {
  return (
    <PageShell>
      <section className="omnia-pagina-hero omnia-demo-hero">
        <p className="omnia-occhiello omnia-occhiello-centro">Richiedi la demo</p>
        <h1>OMNIA AI: portaci una gara vera. Ti mostriamo cosa esce</h1>
        <p className="omnia-sotto" style={{ margin: "14px auto 0" }}>
          <span className="omnia-demo-solo-ampio">Nessuna presentazione preconfezionata: lavoriamo su un bando che ti interessa davvero. </span>
          Lasciaci i tuoi dati e scegli subito giorno e ora della demo nel calendario.
        </p>
      </section>

      <section className="omnia-pagina-corpo">
        <ol className="omnia-percorso-demo" aria-label="Come si prenota la demo">
          {PASSAGGI.map((testo, i) => (
            <li key={testo}>
              <span className="omnia-tappa-numero" aria-hidden="true">
                {i + 1}
              </span>
              <p>{testo}</p>
            </li>
          ))}
        </ol>
        <div className="omnia-modulo-riquadro">
          <p className="omnia-demo-preparati">
            Se stai lavorando a una gara, tieni a portata di mano bando e disciplinare: la demo si fa su quelli.
          </p>
          <DemoForm />
        </div>
      </section>
    </PageShell>
  );
}
