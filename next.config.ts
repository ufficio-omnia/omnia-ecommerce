import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "30mb",
    },
  },
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas", "sharp"],
  // src/lib/prompts.ts legge prompts/*.md con fs.readFileSync a runtime: un
  // percorso costruito con process.cwd() non viene tracciato automaticamente
  // dal build Vercel, quindi va incluso esplicitamente nel bundle serverless.
  outputFileTracingIncludes: {
    "/**": ["./prompts/**"],
  },
  // Next ammette un solo favicon.ico, al livello più alto di app/ (quindi
  // src/app/favicon.ico, quello dell'e-commerce), condiviso da tutti i
  // domini: senza questa regola omnia-ai.it serviva l'icona dell'e-commerce
  // su /favicon.ico — l'URL che i browser richiedono da soli per le pagine
  // senza <head>, come sitemap.xml e robots.txt — e la dichiarava per prima
  // nel proprio <head>. Solo per l'host omnia-ai.it la richiesta viene
  // deviata sul file di OMNIA AI; per ogni altro host non cambia nulla.
  // beforeFiles: va valutata prima delle rotte dell'app, dove vive
  // /favicon.ico. Il proxy non passa da qui (il suo matcher esclude
  // favicon.ico), quindi l'host va riconosciuto in questa regola.
  // www.omnia-ai.it è incluso per coerenza con ZONE_HOSTS in
  // src/lib/zone.ts, anche se oggi fa già un 308 verso l'apex.
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/favicon.ico",
          has: [{ type: "host", value: "(?:www\\.)?omnia-ai\\.it" }],
          destination: "/site-omnia-ai/favicon.ico",
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
