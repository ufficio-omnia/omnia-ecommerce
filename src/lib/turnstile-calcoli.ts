// Verifica anti-bot con Cloudflare Turnstile: parte pura (nessun accesso a Next, nessuna lettura di
// variabili d'ambiente), provabile con un fetch finto. La parte che legge l'ambiente e l'indirizzo di chi
// scrive sta in turnstile.ts.
//
// Cosa protegge: i moduli pubblici dei due siti (richiesta demo, registrazione, login, password dimenticata).
// Cosa NON protegge: chi chiama direttamente le API di Supabase senza passare dal nostro sito (indirizzo e
// chiave pubblica sono nel codice del browser). Per quello serve l'opzione CAPTCHA di Supabase, che tocca anche
// le email di attivazione generate dal server: va provata su un progetto separato.

export const CAMPO_TURNSTILE = "cf-turnstile-response";
export const URL_VERIFICA_TURNSTILE = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const MESSAGGIO_VERIFICA_FALLITA = "Verifica di sicurezza non riuscita. Attendi un istante, poi riprova.";

// Un gettone di Turnstile è lungo al massimo 2048 caratteri: oltre, non lo si manda nemmeno a Cloudflare.
export const LUNGHEZZA_MASSIMA_GETTONE = 2048;
export const TIMEOUT_VERIFICA_MS = 5000;

export type ConfigurazioneTurnstile = { chiaveSito: string | undefined; chiaveSegreta: string | undefined };
export type StatoTurnstile = "attiva" | "spenta" | "incompleta";

// Attiva solo con ENTRAMBE le chiavi: con la sola chiave segreta il riquadro non comparirebbe e nessuno potrebbe
// più accedere. Con nessuna chiave la verifica è spenta (così si può mettere il codice online prima di averle).
export function statoTurnstile(c: ConfigurazioneTurnstile): StatoTurnstile {
  const sito = Boolean(c.chiaveSito?.trim());
  const segreta = Boolean(c.chiaveSegreta?.trim());
  if (sito && segreta) return "attiva";
  if (!sito && !segreta) return "spenta";
  return "incompleta";
}

export type EsitoVerifica =
  // passata, oppure non applicabile: il motivo dice quale (il servizio non raggiungibile o la chiave sbagliata
  // NON bloccano nessuno: un guasto di Cloudflare o una chiave incollata male non deve chiudere fuori i clienti)
  | { ok: true; motivo: "superata" | "servizio_non_raggiungibile" | "chiave_segreta_non_valida" }
  | { ok: false; motivo: "gettone_mancante" | "gettone_non_valido" | "respinta" };

type RispostaCloudflare = { success?: boolean; "error-codes"?: string[] };

export async function verificaGettoneTurnstile(
  gettone: unknown,
  opzioni: { chiaveSegreta: string; ip?: string | null; fetchFn?: typeof fetch; timeoutMs?: number },
): Promise<EsitoVerifica> {
  const testo = typeof gettone === "string" ? gettone.trim() : "";
  if (testo === "") return { ok: false, motivo: "gettone_mancante" };
  if (testo.length > LUNGHEZZA_MASSIMA_GETTONE) return { ok: false, motivo: "gettone_non_valido" };

  const corpo = new URLSearchParams({ secret: opzioni.chiaveSegreta, response: testo });
  if (opzioni.ip) corpo.set("remoteip", opzioni.ip);

  const controllo = new AbortController();
  const scadenza = setTimeout(() => controllo.abort(), opzioni.timeoutMs ?? TIMEOUT_VERIFICA_MS);
  try {
    const risposta = await (opzioni.fetchFn ?? fetch)(URL_VERIFICA_TURNSTILE, { method: "POST", body: corpo, signal: controllo.signal });
    if (!risposta.ok) {
      console.error("Turnstile: risposta HTTP", risposta.status, "dal servizio di verifica: la verifica viene saltata");
      return { ok: true, motivo: "servizio_non_raggiungibile" };
    }
    const dati = (await risposta.json()) as RispostaCloudflare;
    if (dati.success === true) return { ok: true, motivo: "superata" };
    const codici = dati["error-codes"] ?? [];
    if (codici.includes("invalid-input-secret") || codici.includes("missing-input-secret")) {
      console.error("Turnstile: la chiave segreta (TURNSTILE_SECRET_KEY) non è valida: la verifica viene saltata finché non si corregge");
      return { ok: true, motivo: "chiave_segreta_non_valida" };
    }
    return { ok: false, motivo: "respinta" };
  } catch (e) {
    console.error("Turnstile: servizio di verifica non raggiungibile, la verifica viene saltata:", e instanceof Error ? e.message : e);
    return { ok: true, motivo: "servizio_non_raggiungibile" };
  } finally {
    clearTimeout(scadenza);
  }
}
