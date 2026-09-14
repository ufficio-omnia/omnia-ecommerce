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
