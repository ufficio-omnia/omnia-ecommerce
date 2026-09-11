import Link from "next/link";

export default function OmniaAiHomePage() {
  return (
    <main className="flex-1">
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <h1 className="font-serif text-3xl text-ink">OMNIA AI</h1>
        <p className="mt-2 text-justify text-sm text-sage">
          Il tuo abbonamento è attivo. Da qui potrai accedere agli strumenti
          OMNIA AI per l&apos;analisi delle gare e la generazione dei
          contenuti.
        </p>

        <div className="mt-8 space-y-4">
          <Link
            href="/dashboard/omnia-ai/gare"
            className="block rounded-2xl border border-border bg-cream-soft p-5 transition-colors hover:border-forest"
          >
            <h2 className="font-serif text-lg text-ink">Gare</h2>
            <p className="mt-1 text-justify text-sm text-sage">
              Crea una stanza di lavoro per ogni gara d&apos;appalto e carica
              bando, disciplinare e capitolato.
            </p>
          </Link>

          <Link
            href="/dashboard/omnia-ai/profilo-azienda"
            className="block rounded-2xl border border-border bg-cream-soft p-5 transition-colors hover:border-forest"
          >
            <h2 className="font-serif text-lg text-ink">Profilo azienda</h2>
            <p className="mt-1 text-justify text-sm text-sage">
              Compila i dati della tua azienda: verranno usati come base
              fissa da OMNIA AI per l&apos;analisi delle gare e la
              generazione dei contenuti.
            </p>
          </Link>
        </div>
      </div>
    </main>
  );
}
