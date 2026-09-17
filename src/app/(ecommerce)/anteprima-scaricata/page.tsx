import type { Metadata } from "next";
import Link from "next/link";
import { PDF_URL } from "@/components/anteprima-download-cta";

export const metadata: Metadata = {
  title: "Anteprima scaricata",
  robots: { index: false, follow: false },
};

export default function AnteprimaScaricataPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-cream-soft p-8 text-center">
        <h1 className="font-serif text-3xl text-ink">Il download è partito</h1>
        <p className="mt-3 text-sm text-sage">
          Controlla i download del tuo browser. Se non si è avviato
          automaticamente, puoi scaricare l&apos;anteprima direttamente da
          qui:
        </p>
        <a
          href={PDF_URL}
          download
          className="mt-3 inline-block font-mono text-xs tracking-wide text-forest uppercase underline underline-offset-2 hover:text-forest-dark"
        >
          Scarica di nuovo l&apos;anteprima
        </a>

        <div className="mt-8 space-y-3 border-t border-border pt-8">
          <Link
            href="/prodotti"
            className="block rounded-full bg-forest px-5 py-3 text-center font-mono text-xs tracking-wide text-cream uppercase transition-colors hover:bg-forest-dark"
          >
            Acquista il documento completo
          </Link>
          <a
            href="https://omnia-ai.it"
            className="block rounded-full border border-border-strong px-5 py-3 text-center font-mono text-xs tracking-wide text-ink uppercase transition-colors hover:bg-ink hover:text-cream"
          >
            Fai elaborare la relazione con OMNIA AI
          </a>
          <a
            href="https://omniaitalia.com#contatti"
            className="block rounded-full border border-border-strong px-5 py-3 text-center font-mono text-xs tracking-wide text-ink uppercase transition-colors hover:bg-ink hover:text-cream"
          >
            Richiedi una revisione umana
          </a>
        </div>
      </div>
    </main>
  );
}
