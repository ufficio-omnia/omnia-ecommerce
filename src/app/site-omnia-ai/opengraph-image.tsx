import { ImageResponse } from "next/og";
import { TRACCIATO } from "@/components/omnia-ai/brand-mark";

// Immagine di anteprima social (og:image) di tutte le pagine di omnia-ai.it,
// generata con next/og — già incluso in Next, come src/app/site-omnia-ai/
// apple-icon.tsx — dallo stesso tracciato del marchio. Colori dal design
// system (omnia-ai.css): fondo --nero, marchio --verde, testo --testo/--fioco.
//
// Font: quello predefinito di next/og. Syne e Space Grotesk sono in
// public/fonts solo come woff2, formato che next/og non accetta: un font
// del brand richiederebbe un .ttf/.otf da aggiungere al progetto.
//
// Le pagine interne dichiarano questa stessa immagine (stesso alt) in
// paginaMetadata, src/lib/omnia-ai-seo.ts: se cambia qui, cambia anche lì.
export const alt = "OMNIA AI — intelligenza artificiale per gare d'appalto";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          padding: "0 96px",
          background: "#050509",
          // rgba(5,5,9,0) e non "transparent": stesso colore di fondo a
          // opacità zero, per non sporcare il gradiente (vedi omnia-ai.css).
          backgroundImage:
            "radial-gradient(circle at 18% 30%, rgba(139,127,232,0.30), rgba(5,5,9,0) 55%)",
        }}
      >
        <svg width="250" height="250" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
          <path d={TRACCIATO} fill="none" stroke="#4FD1A5" strokeWidth="6.5" strokeLinejoin="round" />
        </svg>

        <div style={{ display: "flex", flexDirection: "column", marginLeft: 72 }}>
          <div style={{ fontSize: 120, lineHeight: 1, color: "#E9E7F4", letterSpacing: -2 }}>
            OMNIA AI
          </div>
          <div style={{ fontSize: 42, lineHeight: 1.25, color: "#8B8AA8", marginTop: 28 }}>
            Intelligenza artificiale
          </div>
          <div style={{ fontSize: 42, lineHeight: 1.25, color: "#4FD1A5" }}>
            per gare d&apos;appalto
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
