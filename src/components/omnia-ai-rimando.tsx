import { OMNIA_AI_BASE_URL } from "@/lib/zone";

// Rimando dall'e-commerce (app.omniaitalia.com) a omnia-ai.it.
// «sezione»: blocco a tutta larghezza per la home; «compatto»: riquadro da
// mettere accanto al pulsante «Scarica l'anteprima gratuita» della guida.
// Testi coerenti con la home di omnia-ai.it: nessuna promessa di punteggio o
// di aggiudicazione, la verifica finale resta a chi firma.
export default function OmniaAiRimando({
  variante,
}: {
  variante: "sezione" | "compatto";
}) {
  if (variante === "compatto") {
    return (
      <div className="mt-6 rounded-2xl border border-border bg-cream-soft p-5">
        <p className="font-mono text-[11px] tracking-widest text-forest uppercase">
          Oppure con l&apos;intelligenza artificiale
        </p>
        <p className="mt-2 text-sm leading-relaxed text-ink">
          Hai già i documenti di gara?{" "}
          <strong>OMNIA AI</strong> analizza bando, disciplinare e capitolato
          e prepara l&apos;offerta tecnica in Word, organizzata sui criteri
          di valutazione.
        </p>
        <a
          href={OMNIA_AI_BASE_URL}
          target="_blank"
          rel="noopener"
          className="mt-3 inline-block font-mono text-xs tracking-wide text-forest uppercase underline underline-offset-2 hover:text-forest-dark"
        >
          Scopri OMNIA AI su omnia-ai.it ↗
        </a>
      </div>
    );
  }

  return (
    <section className="border-b border-border bg-forest text-cream">
      <div className="mx-auto max-w-3xl px-4 py-14 text-center sm:px-6 sm:py-16">
        <p className="font-mono text-xs tracking-widest text-mint uppercase">
          OMNIA AI
        </p>
        <h2 className="mt-3 font-serif text-2xl sm:text-3xl">
          L&apos;offerta tecnica costruita sulla tua gara
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-justify text-cream/90">
          Carichi bando, disciplinare e capitolato: OMNIA AI individua
          criteri, punteggi, scadenze e limiti di pagine e prepara la
          relazione tecnica in Word, già impaginata e organizzata sulla
          griglia di valutazione. Tu la completi con i dati della tua
          azienda e fai la verifica finale.
        </p>
        <a
          href={OMNIA_AI_BASE_URL}
          target="_blank"
          rel="noopener"
          className="mt-6 inline-block rounded-full bg-cream px-6 py-3 font-mono text-xs tracking-wide text-forest uppercase transition-colors hover:bg-mint"
        >
          Scopri OMNIA AI ↗
        </a>
      </div>
    </section>
  );
}
