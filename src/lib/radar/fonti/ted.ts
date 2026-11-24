// Lettura delle pagine dell'API ufficiale di ricerca di TED (accesso anonimo documentato). Solo rete: nessun database.
//
// Uso corretto della fonte (politica d'uso di TED: 700 richieste al minuto da un indirizzo): qui al massimo una richiesta ogni
// PAUSA_MS, con un tempo massimo per richiesta e pochi nuovi tentativi, distanziati, solo su errori temporanei (429 e 5xx).
// Nessuna pagina del sito di TED viene letta: solo l'API.
import { CAMPI_BANDO, CAMPI_ESITO, URL_RICERCA_TED, USER_AGENT_TED, corpoRichiesta, queryAvvisi } from "./ted-calcoli";

export const PAUSA_MS = 1_500;
const TEMPO_MASSIMO_MS = 45_000;
const TENTATIVI = 3;

export type PaginaTed = { avvisi: Record<string, unknown>[]; totale: number; byte: number; ms: number };

export class ErroreTed extends Error {
  constructor(
    messaggio: string,
    readonly stato: number | null,
  ) {
    super(messaggio);
  }
}

const attendi = (ms: number, segnale?: AbortSignal) =>
  new Promise<void>((ok, ko) => {
    const t = setTimeout(ok, ms);
    segnale?.addEventListener("abort", () => {
      clearTimeout(t);
      ko(new ErroreTed("Interrotta", null));
    });
  });

let ultimaRichiesta = 0;

export async function leggiPaginaTed(
  tipo: "bando" | "esito",
  cpv: readonly string[],
  da: string,
  a: string,
  pagina: number,
  // userAgent: quello del giro (K9, user-agent.ts); di base quello generico
  opzioni: { fetchFn?: typeof fetch; segnale?: AbortSignal; pausaMs?: number; userAgent?: string } = {},
): Promise<PaginaTed> {
  const fetchFn = opzioni.fetchFn ?? fetch;
  const pausa = opzioni.pausaMs ?? PAUSA_MS;
  const corpo = JSON.stringify(corpoRichiesta(queryAvvisi(tipo, cpv, da, a), tipo === "bando" ? CAMPI_BANDO : CAMPI_ESITO, pagina));
  let ultimoErrore: ErroreTed | null = null;
  for (let tentativo = 1; tentativo <= TENTATIVI; tentativo++) {
    const attesa = ultimaRichiesta + pausa - Date.now();
    if (attesa > 0) await attendi(attesa, opzioni.segnale);
    ultimaRichiesta = Date.now();
    const inizio = Date.now();
    const controllo = new AbortController();
    const timer = setTimeout(() => controllo.abort(), TEMPO_MASSIMO_MS);
    opzioni.segnale?.addEventListener("abort", () => controllo.abort());
    try {
      const r = await fetchFn(URL_RICERCA_TED, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": opzioni.userAgent ?? USER_AGENT_TED },
        body: corpo,
        signal: controllo.signal,
      });
      const testo = await r.text();
      if (r.status === 429 || r.status >= 500) {
        ultimoErrore = new ErroreTed(`TED ha risposto ${r.status}`, r.status);
        await attendi(pausa * 4 * tentativo, opzioni.segnale);
        continue;
      }
      if (r.status !== 200) throw new ErroreTed(`TED ha risposto ${r.status}: ${testo.slice(0, 200)}`, r.status);
      const j = JSON.parse(testo) as { notices?: unknown; totalNoticeCount?: unknown; timedOut?: unknown };
      if (j.timedOut === true) {
        ultimoErrore = new ErroreTed("TED: ricerca scaduta lato server", 200);
        await attendi(pausa * 4 * tentativo, opzioni.segnale);
        continue;
      }
      if (!Array.isArray(j.notices) || typeof j.totalNoticeCount !== "number") throw new ErroreTed("TED: risposta in un formato inatteso", 200);
      return { avvisi: j.notices as Record<string, unknown>[], totale: j.totalNoticeCount, byte: testo.length, ms: Date.now() - inizio };
    } catch (e) {
      if (e instanceof ErroreTed && e.stato !== null && e.stato < 500 && e.stato !== 429) throw e;
      if (opzioni.segnale?.aborted) throw new ErroreTed("Interrotta", null);
      ultimoErrore = e instanceof ErroreTed ? e : new ErroreTed(controllo.signal.aborted ? "TED: tempo massimo superato" : "TED: rete non raggiungibile", null);
      await attendi(pausa * 4 * tentativo, opzioni.segnale);
    } finally {
      clearTimeout(timer);
    }
  }
  throw ultimoErrore ?? new ErroreTed("TED: lettura non riuscita", null);
}
