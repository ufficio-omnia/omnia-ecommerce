import { headers } from "next/headers";

// Costruita dall'host della richiesta corrente, MAI da
// NEXT_PUBLIC_SITE_URL: quella costante è quella dell'e-commerce
// (app.omniaitalia.com), usarla per un link generato dalla zona
// omnia-ai.it porterebbe al dominio sbagliato (bug reale osservato in
// pratica sulle email di conferma). In sviluppo la zona è risolta via
// cookie da src/proxy.ts: un percorso "di zona" (senza prefisso
// /site-omnia-ai, stesso stile di ogni altro Link in questa area)
// funziona identico in entrambi gli ambienti.
export async function getOmniaAiRequestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

// Per contesti senza una richiesta del cliente da cui derivare l'host
// (il webhook Stripe: le richieste arrivano dai server di Stripe, non
// dal browser del cliente). NODE_ENV distingue sviluppo, dove tutte le
// zone vivono sullo stesso localhost, da produzione, dove serve il
// dominio reale — stesso identico bisogno già risolto per l'e-commerce
// dalla costante "siteUrl" in cima al webhook, qui specifica per la
// zona omnia-ai.it.
export function getOmniaAiBaseUrl(): string {
  if (process.env.NODE_ENV !== "production") {
    return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  }
  return "https://omnia-ai.it";
}
