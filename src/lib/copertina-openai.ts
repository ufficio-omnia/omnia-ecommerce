// L'unico punto in cui la copertina della relazione parla con OpenAI: una richiesta POST (corpo JSON oppure modulo con file), la chiave nell'intestazione,
// un tempo massimo, e gli errori trasformati in un ErroreOpenAI leggibile. Lo usano sia la lettura del disciplinare (copertina-lettura.ts) sia la
// generazione dell'immagine (copertina-relazione.ts). `fetchFn` si può sostituire per provare senza rete.

export class ErroreOpenAI extends Error {
  constructor(
    messaggio: string,
    readonly stato?: number,
  ) {
    super(messaggio);
  }
}

export async function postaAOpenAI(params: {
  url: string;
  apiKey: string;
  corpo: FormData | Record<string, unknown>;
  tempoMassimoMs: number;
  fetchFn?: typeof fetch;
}): Promise<unknown> {
  const { url, apiKey, corpo, tempoMassimoMs } = params;
  const fetchFn = params.fetchFn ?? fetch;
  const èModulo = corpo instanceof FormData;

  let risposta: Response;
  try {
    risposta = await fetchFn(url, {
      method: "POST",
      headers: èModulo ? { Authorization: `Bearer ${apiKey}` } : { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: èModulo ? corpo : JSON.stringify(corpo),
      signal: AbortSignal.timeout(tempoMassimoMs),
    });
  } catch (err) {
    const scaduto = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new ErroreOpenAI(scaduto ? "OpenAI non ha risposto in tempo." : `Connessione a OpenAI non riuscita: ${err instanceof Error ? err.message : String(err)}`);
  }

  let corpoRisposta: unknown = null;
  try {
    corpoRisposta = await risposta.json();
  } catch {
    // risposta non JSON: gestita sotto
  }
  if (!risposta.ok) {
    const messaggio = (corpoRisposta as { error?: { message?: unknown } } | null)?.error?.message;
    throw new ErroreOpenAI(`OpenAI ha rifiutato la richiesta (${risposta.status}): ${typeof messaggio === "string" ? messaggio : "nessun dettaglio"}`, risposta.status);
  }
  return corpoRisposta;
}
