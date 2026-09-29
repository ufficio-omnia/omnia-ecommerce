// Tariffe usate per calcolare costo_stimato in ai_operazioni. I prezzi
// dei modelli cambiano nel tempo: vivono qui, in un file a sé, con la
// data a cui si riferiscono — fra mesi deve essere possibile capire se
// un costo storico in ai_operazioni è stato calcolato con la tariffa
// corretta per quel periodo. I token grezzi salvati in ai_operazioni
// restano comunque sempre la fonte di verità: costo_stimato è derivato e
// ricalcolabile in qualsiasi momento, non l'unico dato conservato.
//
// Tariffe di riferimento al: 2026-09-11.
// ATTENZIONE — DA VERIFICARE: questi valori non sono stati confermati
// contro il listino prezzi pubblico corrente al momento della scrittura
// (modello e provider recenti, dati di listino non certi). Vanno
// controllati e corretti prima di considerare costo_stimato affidabile
// — il conteggio dei token resta comunque corretto ed è già utile da
// solo, indipendentemente da questa tariffa.

type Tariffa = {
  // Dollari per milione di token.
  inputPerMilione: number;
  outputPerMilione: number;
};

export const TARIFFE: Record<string, Tariffa> = {
  "claude-sonnet-5": { inputPerMilione: 3, outputPerMilione: 15 },
  // Modello leggero (src/lib/anthropic.ts): mai nelle generazioni reali,
  // solo nelle prove di meccanismo — la tariffa serve comunque a registrare
  // correttamente il costo di quelle prove in ai_operazioni.
  "claude-haiku-4-5-20251001": { inputPerMilione: 1, outputPerMilione: 5 },
  "voyage-4": { inputPerMilione: 0.12, outputPerMilione: 0 },
};

// Moltiplicatori sulla tariffa di input per il prompt caching (verificati
// nella documentazione Anthropic): scrivere in cache costa di più della
// tariffa piena (paghi per calcolare E salvare il prefisso), leggerla costa
// una frazione. TTL 5 minuti (quello usato in questo progetto, vedi
// gara-extraction.ts): scrittura 1,25x, lettura 0,1x. Il TTL da 1 ora (2x in
// scrittura) non è usato qui.
const MOLTIPLICATORE_CACHE_SCRITTURA = 1.25;
const MOLTIPLICATORE_CACHE_LETTURA = 0.1;

export function calcolaCostoStimato(
  model: string,
  inputTokens: number | null,
  outputTokens: number | null,
  cache?: { creazione: number | null; lettura: number | null },
): number | null {
  const tariffa = TARIFFE[model];
  if (!tariffa) return null;

  const costoInput = ((inputTokens ?? 0) / 1_000_000) * tariffa.inputPerMilione;
  const costoOutput = ((outputTokens ?? 0) / 1_000_000) * tariffa.outputPerMilione;
  const costoCacheScrittura = ((cache?.creazione ?? 0) / 1_000_000) * tariffa.inputPerMilione * MOLTIPLICATORE_CACHE_SCRITTURA;
  const costoCacheLettura = ((cache?.lettura ?? 0) / 1_000_000) * tariffa.inputPerMilione * MOLTIPLICATORE_CACHE_LETTURA;
  return costoInput + costoOutput + costoCacheScrittura + costoCacheLettura;
}
