import type { Metadata, Viewport } from "next";
import "./omnia-ai.css";
import OmniaAiCookieConsent from "@/components/omnia-ai/cookie-consent";
import AttribuzioneDemo from "@/components/omnia-ai/attribuzione-demo";
import ApplicaTema from "@/components/omnia-ai/applica-tema";
import { COLORI_BROWSER, SCELTA_PREDEFINITA, TEMA_PREDEFINITO } from "@/lib/tema-omnia-ai";
import { OMNIA_AI_BASE_URL } from "@/lib/zone";
import { URL_GTAG_JS, costruisciSnippetIniziale } from "@/lib/google-tag";

// Root layout indipendente (route group multipli, vedi src/app/(ecommerce)/layout.tsx):
// <html> proprio, mai condiviso con l'e-commerce — nessuna variabile CSS,
// font o colore di questo sistema visivo può trapelare sull'altro dominio.
//
// metadataBase rende assoluti gli URL relativi dei metadata (canonical,
// og:url, og:image) sul dominio canonico di omnia-ai.it, anche in sviluppo
// e sulle preview: un'anteprima non deve mai dichiararsi canonica di sé.
export const metadata: Metadata = {
  metadataBase: new URL(OMNIA_AI_BASE_URL),
  title: "OMNIA AI",
};

// Il colore del browser (barra dell'indirizzo sui telefoni, controlli nativi) è quello del tema di base, il chiaro; lo script del tema lo
// cambia solo per chi ha scelto lo scuro.
export const viewport: Viewport = {
  themeColor: COLORI_BROWSER[TEMA_PREDEFINITO].themeColor,
  colorScheme: COLORI_BROWSER[TEMA_PREDEFINITO].colorScheme,
};

// Google tag (Consent Mode v2, modalità avanzata): UN solo gtag.js con due destinazioni (Analytics G-… e Google Ads AW-…), presente
// nell'HTML iniziale come normali tag <script> dell'<head> (non con next/script: `beforeInteractive` non scrive un <script> ma accoda lo
// snippet in una coda interna di Next e lascia nell'HTML solo un preload; un controllo automatico di Google cerca il tag vero).
// Lo snippet (inline, esegue subito) imposta PRIMA di ogni configurazione i quattro consensi su «denied»; la libreria è `defer`: il
// browser la esegue solo dopo aver finito di leggere la pagina, quindi dopo lo snippet, sempre. Il banner aggiorna i consensi.
// Niente `async` sulla libreria: React lo tratterebbe come «risorsa» e lo sposterebbe in testa all'<head>, prima dello snippet.
// Tutto sta in src/lib/google-tag.ts (testato in scripts/verifica-google-tag-omnia-ai.ts) e nella guida GUIDA-GOOGLE-TAG-CONSENT-MODE.md.
export default function OmniaAiRootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-tema / data-tema-scelta: il tema di base (chiaro) è scritto già dal server, così la pagina parte chiara per chiunque, anche senza
    // JavaScript. suppressHydrationWarning: per chi ha scelto lo scuro (o «automatico») lo script del tema cambia questi attributi
    // sull'<html> prima che React parta.
    <html lang="it" data-tema={TEMA_PREDEFINITO} data-tema-scelta={SCELTA_PREDEFINITA} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: costruisciSnippetIniziale() }} />
        <script defer src={URL_GTAG_JS} />
      </head>
      <body>
        {/* Primo elemento del body: applica il tema scelto (di base il chiaro, già scritto dal server) prima che la pagina compaia. */}
        <ApplicaTema />
        {children}
        <OmniaAiCookieConsent />
        <AttribuzioneDemo />
      </body>
    </html>
  );
}
