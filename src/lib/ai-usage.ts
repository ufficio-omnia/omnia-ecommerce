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
}): Promise<void> {
  const { userId, garaId, operazione, provider, model, inputTokens, outputTokens } = params;

  try {
    const costoStimato = calcolaCostoStimato(model, inputTokens, outputTokens);
    const admin = createAdminClient();

    const { error } = await admin.from("ai_operazioni").insert({
      user_id: userId,
      gara_id: garaId,
      operazione,
      provider,
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      costo_stimato: costoStimato,
    });

    if (error) {
      console.error("Errore registrazione costo AI:", error);
    }
  } catch (err) {
    console.error("Errore registrazione costo AI:", err);
  }
}
