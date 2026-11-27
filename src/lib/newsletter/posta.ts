import { randomUUID } from "crypto";

// Invio della newsletter tramite Resend, separato da sendEmail (src/lib/email.ts) che resta quello delle email
// transazionali: mittente diverso, intestazioni di disiscrizione, invio a lotti. Le email transazionali non passano
// da qui e non cambiano.
//
// INVIO REALE SOLO SUL DEPLOY DI PRODUZIONE (VERCEL_ENV=production). In sviluppo, sulle anteprime e negli script il
// lotto è SIMULATO: nessuna chiamata a Resend, id fittizi «simulato-…». In locale la chiave di Resend in .env.local è
// quella vera: senza questa guardia una prova in sviluppo partirebbe davvero.

export type MessaggioNewsletter = {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
  tags: { name: string; value: string }[];
};

export type EsitoLotto = { ok: true; ids: string[]; simulato: boolean } | { ok: false; errore: string; simulato: boolean };

export const DIMENSIONE_LOTTO = 100; // massimo ammesso dall'endpoint batch di Resend

export function invioRealeConsentito(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VERCEL_ENV === "production" && Boolean(env.RESEND_API_KEY);
}

export async function inviaLotto(
  messaggi: MessaggioNewsletter[],
  mittente: { nome: string; email: string; rispondiA: string | null },
  chiaveIdempotenza: string,
): Promise<EsitoLotto> {
  if (messaggi.length === 0) return { ok: true, ids: [], simulato: !invioRealeConsentito() };
  if (messaggi.length > DIMENSIONE_LOTTO) return { ok: false, errore: `Lotto troppo grande (${messaggi.length})`, simulato: false };

  if (!invioRealeConsentito()) {
    console.info(`Newsletter: lotto SIMULATO di ${messaggi.length} email (nessun invio reale fuori dalla produzione).`);
    return { ok: true, ids: messaggi.map(() => `simulato-${randomUUID()}`), simulato: true };
  }

  // nome visualizzato tra virgolette: contiene «|», che senza virgolette renderebbe l'intestazione From non valida
  const from = `"${mittente.nome.replace(/["\\]/g, "")}" <${mittente.email}>`;
  const corpo = messaggi.map((m) => ({
    from,
    to: [m.to],
    subject: m.subject,
    html: m.html,
    text: m.text,
    headers: m.headers,
    tags: m.tags,
    ...(mittente.rispondiA ? { reply_to: mittente.rispondiA } : {}),
  }));

  try {
    const res = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        // stessa chiave = stessa risposta per 24 ore: un ripetersi della richiesta non manda due volte
        "Idempotency-Key": chiaveIdempotenza.slice(0, 256),
      },
      body: JSON.stringify(corpo),
    });
    const testo = await res.text();
    if (!res.ok) return { ok: false, errore: `Resend ${res.status}: ${testo.slice(0, 300)}`, simulato: false };
    const json = JSON.parse(testo) as { data?: { id: string }[] };
    const ids = (json.data ?? []).map((d) => d.id);
    if (ids.length !== messaggi.length) return { ok: false, errore: `Resend: risposta con ${ids.length} id su ${messaggi.length} email`, simulato: false };
    return { ok: true, ids, simulato: false };
  } catch (e) {
    return { ok: false, errore: `Resend non raggiungibile: ${e instanceof Error ? e.message : String(e)}`, simulato: false };
  }
}
