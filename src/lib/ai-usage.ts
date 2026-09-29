import { createAdminClient } from "@/lib/supabase/admin";
import { calcolaCostoStimato } from "@/lib/ai-pricing";

export type AiUsageContext = {
  userId: string | null;
  garaId: string | null;
  operazione: string;
};

// Chiamata esplicitamente da ogni punto del codice che chiama un modello
// (Anthropic o Voyage), subito dopo la risposta — non un wrapper che
// intercetta le chiamate: src/lib/anthropic.ts è solo una fabbrica di
// client, ogni sito chiama .messages.create()/.stream() per conto
// proprio, quindi ogni sito registra il proprio consumo.
//
// Non deve MAI interrompere l'operazione che ha appena avuto successo:
// il cliente ha già ricevuto la sua risposta/bozza, un fallimento del
// logging è grave ma non deve costargli il risultato — per questo non
// propaga errori, si limita a loggarli.
export async function logAiUsage(params: {
  userId: string | null;
  garaId: string | null;
  operazione: string;
  provider: "anthropic" | "voyage";
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  // Prompt caching (vedi src/lib/ai-pricing.ts): token scritti in cache
  // (costano di più) e token letti da cache (costano una frazione). Assenti
  // per le chiamate che non usano cache_control — cache_creation_tokens e
  // cache_read_tokens restano null, come sempre prima di questo campo.
  cacheCreationTokens?: number | null;
  cacheReadTokens?: number | null;
}): Promise<void> {
  const { userId, garaId, operazione, provider, model, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens } = params;

  try {
    const costoStimato = calcolaCostoStimato(model, inputTokens, outputTokens, { creazione: cacheCreationTokens ?? null, lettura: cacheReadTokens ?? null });
    const admin = createAdminClient();

    const riga = {
      user_id: userId,
      gara_id: garaId,
      operazione,
      provider,
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_creation_tokens: cacheCreationTokens ?? null,
      cache_read_tokens: cacheReadTokens ?? null,
      costo_stimato: costoStimato,
    };

    const { error } = await admin.from("ai_operazioni").insert(riga);

    // PGRST204 "Could not find the '...' column" = la migrazione 0069
    // (cache_creation_tokens/cache_read_tokens) non è ancora stata
    // eseguita sul DB: il registro dei costi non deve smettere di
    // funzionare fino a quel momento — ripiega sulle colonne di sempre
    // (il costo resta corretto: calcolaCostoStimato ha già usato i token
    // di cache per il calcolo, solo le due colonne extra non si salvano).
    if (error?.code === "PGRST204") {
      const { cache_creation_tokens: _cc, cache_read_tokens: _cr, ...rigaSenzaCache } = riga;
      void _cc;
      void _cr;
      const { error: errore2 } = await admin.from("ai_operazioni").insert(rigaSenzaCache);
      if (errore2) console.error("Errore registrazione costo AI (anche senza colonne cache):", errore2);
      return;
    }

    if (error) {
      console.error("Errore registrazione costo AI:", error);
    }
  } catch (err) {
    console.error("Errore registrazione costo AI:", err);
  }
}
