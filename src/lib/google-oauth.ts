// Accesso alle API di Google con un «refresh token» (OAuth 2.0, flusso per applicazioni server): le credenziali stanno SOLO nelle
// variabili d'ambiente del server e non compaiono mai in log, errori o risposte. Il token di accesso dura circa un'ora e si chiede
// di nuovo a ogni esecuzione del cron.
//
// Si usa fetch (nessuna libreria in più). `fetchFn` si può sostituire nei test.

export type CredenzialiOAuth = { clientId: string; clientSecret: string; refreshToken: string };

const URL_TOKEN = "https://oauth2.googleapis.com/token";
const TEMPO_MASSIMO_MS = 10_000;

export function credenzialiDaAmbiente(env: Record<string, string | undefined>, nomeRefreshToken: string): CredenzialiOAuth | null {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  const refreshToken = env[nomeRefreshToken]?.trim();
  return clientId && clientSecret && refreshToken ? { clientId, clientSecret, refreshToken } : null;
}

export async function ottieniTokenAccesso(credenziali: CredenzialiOAuth, fetchFn: typeof fetch = fetch): Promise<string | null> {
  const controllo = new AbortController();
  const timer = setTimeout(() => controllo.abort(), TEMPO_MASSIMO_MS);
  try {
    const risposta = await fetchFn(URL_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: credenziali.clientId,
        client_secret: credenziali.clientSecret,
        refresh_token: credenziali.refreshToken,
        grant_type: "refresh_token",
      }),
      signal: controllo.signal,
    });
    if (!risposta.ok) {
      console.error("Google OAuth: token non ottenuto, stato", risposta.status);
      return null;
    }
    const corpo = (await risposta.json()) as { access_token?: unknown };
    return typeof corpo.access_token === "string" && corpo.access_token !== "" ? corpo.access_token : null;
  } catch {
    console.error("Google OAuth: richiesta del token non riuscita");
    return null;
  } finally {
    clearTimeout(timer);
  }
}
