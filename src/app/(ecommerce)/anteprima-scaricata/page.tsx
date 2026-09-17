import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Anteprima scaricata",
  robots: { index: false, follow: false },
};

// Il link di ripiego non è mai una costante statica: arriva SOLO come
// query param dal redirect dopo un submit riuscito (vedi
// anteprima-download-cta.tsx), quindi porta un signed URL Supabase già
// scaduto o inesistente per chiunque arrivi qui digitando l'URL a mano —
// niente form compilato, niente download. Controllo minimo di forma (non
// è la sicurezza vera, quella è lato server nel signed URL stesso) solo
// per evitare di renderizzare un href arbitrario non riconosciuto.
function isSignedDownloadUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith(".supabase.co");
  } catch {
    return false;
  }
}

export default async function AnteprimaScaricataPage({
  searchParams,
}: {
  searchParams: Promise<{ u?: string }>;
}) {
  const { u } = await searchParams;
  const downloadUrl = isSignedDownloadUrl(u) ? u : null;

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-cream-soft p-8 text-center">
        {downloadUrl ? (
          <>
            <h1 className="font-serif text-3xl text-ink">Il download è partito</h1>
            <p className="mt-3 text-sm text-sage">
              Controlla i download del tuo browser. Se non si è avviato
              automaticamente, puoi scaricare l&apos;anteprima direttamente
              da qui (link valido per pochi minuti):
            </p>
            <a
              href={downloadUrl}
              className="mt-3 inline-block font-mono text-xs tracking-wide text-forest uppercase underline underline-offset-2 hover:text-forest-dark"
            >
              Scarica di nuovo l&apos;anteprima
            </a>
          </>
        ) : (
          <>
            <h1 className="font-serif text-3xl text-ink">Nessun download in corso</h1>
            <p className="mt-3 text-sm text-sage">
              Il link di questa pagina è scaduto o non proviene da una
              richiesta di anteprima. Torna alla guida per compilare il
              modulo e ricevere il PDF.
            </p>
            <Link
              href="/offerta-tecnica-gare-appalto-pulizia"
              className="mt-3 inline-block font-mono text-xs tracking-wide text-forest uppercase underline underline-offset-2 hover:text-forest-dark"
            >
              Torna alla guida
            </Link>
          </>
        )}

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
