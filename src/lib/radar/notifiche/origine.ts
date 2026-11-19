// Fase B4 (19/11/2026, B2) — origine e percorsi dell'area clienti nei collegamenti delle email di Tender Intelligence. Logica PURA:
// legge solo l'ambiente che riceve.
//
// Perché non getOmniaAiBaseUrl() (src/lib/omnia-ai-request.ts): restituisce https://omnia-ai.it ogni volta che NODE_ENV = production,
// quindi ANCHE sulle anteprime di Vercel. Un'email nata sullo staging o su un'anteprima non deve mai portare alla produzione.
//
// Regola:
//   - produzione (database di produzione E VERCEL_ENV = production): https://omnia-ai.it, scritto fisso (OMNIA_AI_BASE_URL di zone.ts);
//   - ovunque altrove: RADAR_EMAIL_ORIGINE (per esempio l'alias del ramo d'anteprima o http://localhost:3000), che NON può essere un
//     dominio di produzione; senza la variabile, http://localhost:3000;
//   - database di produzione senza VERCEL_ENV = production (per esempio un computer locale con il database vero): nessuna origine, il
//     motore si ferma.
// L'origine entra nei dati congelati dell'evento (urlScheda, urlPerTe) e nel destinatario (urlPreferenze): deve essere stabile tra i
// tentativi d'invio, quindi viene dall'ambiente e non dall'host della richiesta.

import { ambienteDb } from "../ambiente";
import { CONSOLE_BASE_URL, ECOMMERCE_HOST, OMNIA_AI_BASE_URL } from "@/lib/zone";

/** Percorsi dell'area clienti (zona omnia-ai.it, senza il prefisso interno /site-omnia-ai). */
export const PERCORSO_PREFERENZE = "/dashboard/omnia-ai/opportunita/notifiche";
export const PERCORSO_PER_TE = "/dashboard/omnia-ai/opportunita/per-te";
export const PERCORSO_GARA = "/dashboard/omnia-ai/opportunita/gara";
export const PERCORSO_GARA_AGGIUNTA = "/dashboard/omnia-ai/opportunita/aggiunta";

const HOST_DI_PRODUZIONE = new Set(["omnia-ai.it", "www.omnia-ai.it", ECOMMERCE_HOST, new URL(CONSOLE_BASE_URL).hostname, "omniaitalia.com", "www.omniaitalia.com"]);
export const ORIGINE_LOCALE = "http://localhost:3000";

export type OrigineAreaClienti = { ok: true; origine: string } | { ok: false; motivo: string };

export function origineAreaClienti(env: Record<string, string | undefined>): OrigineAreaClienti {
  const db = ambienteDb(env.NEXT_PUBLIC_SUPABASE_URL);
  if (db === "produzione") {
    if (env.VERCEL_ENV === "production") return { ok: true, origine: OMNIA_AI_BASE_URL };
    return { ok: false, motivo: "Database di produzione fuori dal deploy di produzione: nessun collegamento per le email." };
  }
  const scelta = (env.RADAR_EMAIL_ORIGINE ?? "").trim();
  if (!scelta) return { ok: true, origine: ORIGINE_LOCALE };
  let u: URL;
  try {
    u = new URL(scelta);
  } catch {
    return { ok: false, motivo: "RADAR_EMAIL_ORIGINE non è un indirizzo valido." };
  }
  if (u.protocol !== "https:" && !(u.protocol === "http:" && u.hostname === "localhost")) {
    return { ok: false, motivo: "RADAR_EMAIL_ORIGINE: solo https, oppure http su localhost." };
  }
  if (HOST_DI_PRODUZIONE.has(u.hostname.toLowerCase())) {
    return { ok: false, motivo: "RADAR_EMAIL_ORIGINE punta alla produzione: vietato fuori dal deploy di produzione." };
  }
  if (u.pathname !== "/" || u.search || u.hash || u.username || u.password) {
    return { ok: false, motivo: "RADAR_EMAIL_ORIGINE: solo l'origine, senza percorso, parametri o credenziali." };
  }
  return { ok: true, origine: u.origin };
}

/** Collegamento alle preferenze (DestinatarioEmail.urlPreferenze): la pagina «Notifiche» di B1, dentro Opportunità. */
export function urlPreferenze(origine: string): string {
  return `${origine}${PERCORSO_PREFERENZE}`;
}

/** Collegamento a «Per te» (EventoRiepilogo.urlPerTe). */
export function urlPerTe(origine: string): string {
  return `${origine}${PERCORSO_PER_TE}`;
}

/** Collegamento alla scheda della gara (GaraEmail.urlScheda) dalla chiave «p:<id>» o «a:<id>». */
export function urlScheda(origine: string, garaChiave: string): string | null {
  const m = /^(p|a):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(garaChiave);
  if (!m) return null;
  return `${origine}${m[1] === "p" ? PERCORSO_GARA : PERCORSO_GARA_AGGIUNTA}/${m[2]}`;
}
