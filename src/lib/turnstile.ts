import { headers } from "next/headers";
import { CAMPO_TURNSTILE, MESSAGGIO_VERIFICA_FALLITA, statoTurnstile, verificaGettoneTurnstile } from "./turnstile-calcoli";

// Verifica anti-bot per i moduli pubblici (lato server). Ogni azione pubblica la chiama PRIMA di toccare
// Supabase o mandare email: con la verifica spenta (chiavi non impostate) non fa nulla.
//
// Variabili: NEXT_PUBLIC_TURNSTILE_SITE_KEY (pubblica, la usa il riquadro nel browser) e TURNSTILE_SECRET_KEY
// (segreta, solo qui). Vedi la guida nel repository.
export async function verificaFormUmano(formData: FormData): Promise<{ ok: true } | { ok: false; errore: string }> {
  const chiaveSegreta = process.env.TURNSTILE_SECRET_KEY;
  if (statoTurnstile({ chiaveSito: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY, chiaveSegreta }) !== "attiva" || !chiaveSegreta) return { ok: true };

  const intestazioni = await headers();
  const ip = (intestazioni.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;

  const esito = await verificaGettoneTurnstile(formData.get(CAMPO_TURNSTILE), { chiaveSegreta, ip });
  return esito.ok ? { ok: true } : { ok: false, errore: MESSAGGIO_VERIFICA_FALLITA };
}
