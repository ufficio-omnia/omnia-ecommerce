// Fase B4 (20/11/2026, B2) — ADATTATORE di Resend per il motore delle notifiche, CHIUSO: nella B4 non si costruisce mai (resendConsentito()
// è sempre false e creaProviderResend lancia un errore). Serve a preparare e provare la classificazione delle risposte, che è logica pura.
//
// Documentazione pubblica di Resend (letta il 19/11, 26B §5.4): POST /emails; intestazione Idempotency-Key (24 ore, al più 256 caratteri,
// stesso contenuto); errori 400 validation_error, 401 missing_api_key / restricted_api_key, 403 invalid_api_key / domini non verificati,
// 409 invalid_idempotent_request / concurrent_idempotent_requests, 422, 429 rate_limit_exceeded / daily_quota_exceeded /
// monthly_quota_exceeded, 500 application_error. Limite: 10 richieste al secondo per TUTTO il team (il motore ne fa al più 2).
// Non usa src/lib/email.ts: è un adattatore nuovo. La rete passa SOLO dalla funzione iniettata, mai da una chiamata diretta.

import { resendConsentito, type EsitoProvider, type MessaggioEmail, type ProviderEmail } from "./provider";

export const MITTENTE_RESEND = "OMNIA AI <noreply@omniaitalia.com>";
export const INDIRIZZO_RESEND = "https://api.resend.com/emails";

/** La richiesta che si manderebbe a Resend (senza la chiave, che resta nell'intestazione aggiunta al momento). */
export function richiestaResend(m: MessaggioEmail): { url: string; intestazioni: Record<string, string>; corpo: string } {
  if (!m.chiaveIdempotenza || m.chiaveIdempotenza.length > 256) throw new Error("chiave di idempotenza non valida");
  return {
    url: INDIRIZZO_RESEND,
    intestazioni: { "Content-Type": "application/json", "Idempotency-Key": m.chiaveIdempotenza },
    corpo: JSON.stringify({ from: MITTENTE_RESEND, to: [m.a], subject: m.oggetto, html: m.html, text: m.testo, tags: m.tags }),
  };
}

/** Dalla risposta di Resend all'esito del motore. Logica pura. */
export function classificaRispostaResend(stato: number, corpo: unknown, intestazioni: (nome: string) => string | null): EsitoProvider {
  const c = corpo && typeof corpo === "object" ? (corpo as Record<string, unknown>) : {};
  const nome = typeof c.name === "string" ? c.name : "";
  if (stato >= 200 && stato < 300 && typeof c.id === "string" && c.id) return { esito: "inviata", providerId: c.id.slice(0, 200) };
  if (stato >= 200 && stato < 300) return { esito: "riprova", codice: "risposta_senza_id", attesaSecondi: null, dopoInvio: true };
  const attesa = Number(intestazioni("retry-after"));
  const retryAfter = Number.isFinite(attesa) && attesa > 0 ? Math.min(attesa, 86_400) : null;
  if (stato === 429 && (nome === "daily_quota_exceeded" || nome === "monthly_quota_exceeded")) return { esito: "quota", codice: nome };
  if (stato === 429) return { esito: "riprova", codice: nome || "429", attesaSecondi: retryAfter, dopoInvio: false };
  if (stato === 409 && nome === "invalid_idempotent_request") return { esito: "incerto", codice: nome };
  if (stato === 409) return { esito: "riprova", codice: nome || "409", attesaSecondi: retryAfter, dopoInvio: false };
  if (stato >= 500) return { esito: "riprova", codice: nome || String(stato), attesaSecondi: retryAfter, dopoInvio: true };
  if (stato === 401 || stato === 403) return { esito: "fallita", codice: nome || String(stato), configurazione: true };
  return { esito: "fallita", codice: nome || String(stato), configurazione: false };
}

/** Quota residua dalle intestazioni di Resend (piano gratuito: giornaliera; altrimenti mensile). null se non indicata. */
export function quotaDaIntestazioni(intestazioni: (nome: string) => string | null): number | null {
  for (const nome of ["x-resend-daily-quota", "x-resend-monthly-quota"]) {
    const v = Number(intestazioni(nome));
    if (Number.isFinite(v) && v >= 0 && intestazioni(nome) !== null) return v;
  }
  return null;
}

type Richiedi = (url: string, init: { method: "POST"; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  status: number;
  json(): Promise<unknown>;
  headers: { get(nome: string): string | null };
}>;

/** L'adattatore. Nella B4 NON si costruisce: lancia sempre, perché resendConsentito() è false. */
export function creaProviderResend(chiave: string, richiedi: Richiedi): ProviderEmail {
  if (!resendConsentito()) throw new Error("Resend non è autorizzato nella B4: il motore usa solo il provider finto");
  let quota: number | null = null;
  return {
    nome: "resend",
    quotaResidua: () => quota,
    async invia(m: MessaggioEmail): Promise<EsitoProvider> {
      const r = richiestaResend(m);
      try {
        const risposta = await richiedi(r.url, { method: "POST", headers: { ...r.intestazioni, Authorization: `Bearer ${chiave}` }, body: r.corpo, signal: AbortSignal.timeout(20_000) });
        const intestazioni = (n: string) => risposta.headers.get(n);
        quota = quotaDaIntestazioni(intestazioni) ?? quota;
        const corpo = await risposta.json().catch(() => null);
        return classificaRispostaResend(risposta.status, corpo, intestazioni);
      } catch {
        // rete caduta o tempo scaduto: la richiesta potrebbe essere arrivata; si riprova SOLO con la stessa chiave
        return { esito: "riprova", codice: "rete", attesaSecondi: null, dopoInvio: true };
      }
    },
  };
}
