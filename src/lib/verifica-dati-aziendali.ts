import { createAnthropicClient } from "@/lib/anthropic";
import { logAiUsage } from "@/lib/ai-usage";
import { ISTRUZIONI_VERIFICA_DATI } from "@/lib/prompts";

const MODEL = "claude-sonnet-5";

export type CompanyProfiloConfermato = {
  ragione_sociale: string | null;
  forma_giuridica: string | null;
  numero_dipendenti: number | null;
  fatturato_medio_annuo: number | null;
  certificazioni: string | null;
  referenze: string | null;
  settori_attivita: string | null;
  presentazione: string | null;
} | null;

// Tre controlli in una sola chiamata dopo ogni generazione di sezione
// (vedi prompts/verifica-dati-omnia.md per il dettaglio):
// 1. R9 di regole-omnia.md ("nessun dato d'impresa inventato") con un
//    controllo effettivo, non solo con l'istruzione nel prompt di
//    generazione: verificato in pratica che il modello scrive comunque
//    monte ore, numero di addetti e reperibilità senza alcuna fonte
//    quando il profilo azienda non li contiene — anche quando il testo
//    viene solo condensato/espanso in un secondo momento, perché il
//    prompt di compressione protegge esplicitamente "impegni e valori
//    numerici" (per i dati VERI, giustamente): un numero senza fonte non
//    va protetto, va tolto.
// 2. Coerenza numerica tra righe della stessa tabella.
// 3. Coerenza tra titolo e contenuto di ogni paragrafo.
// In caso di errore/timeout la chiamata NON deve bloccare la generazione:
// meglio consegnare la bozza non verificata che nessuna bozza affatto —
// ritorna il contenuto originale invariato.
export async function verificaDatiAziendali(
  contenuto: string,
  companyProfile: CompanyProfiloConfermato,
  contestoDocumenti: string,
  context: { userId: string | null; garaId: string | null },
): Promise<string> {
  try {
    const anthropic = createAnthropicClient();
    const paroleContenuto = contenuto.split(/\s+/).filter(Boolean).length;
    const maxTokens = Math.min(64000, Math.max(4000, Math.ceil(paroleContenuto * 1.3 * 4)));

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      thinking: { type: "disabled" },
      system: ISTRUZIONI_VERIFICA_DATI,
      messages: [
        {
          role: "user",
          content: `Profilo azienda confermato dal cliente:\n${
            companyProfile ? JSON.stringify(companyProfile, null, 2) : "Profilo azienda non ancora compilato: nessun dato d'impresa è confermato."
          }\n\nEstratti pertinenti dai documenti di gara (bando/disciplinare/capitolato) — servono per il contesto della gara, non contengono dati sull'impresa del cliente:\n${
            contestoDocumenti || "Nessuno."
          }\n\nTesto della sezione da verificare:\n\n${contenuto}`,
        },
      ],
    });

    await logAiUsage({
      userId: context.userId,
      garaId: context.garaId,
      operazione: "verifica_dati_aziendali",
      provider: "anthropic",
      model: MODEL,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });

    if (response.stop_reason === "max_tokens") {
      console.warn("verificaDatiAziendali: risposta troncata per max_tokens, mantengo il contenuto originale.");
      return contenuto;
    }

    const testo = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("\n")
      .trim();

    return testo || contenuto;
  } catch (err) {
    console.error("verificaDatiAziendali: errore, mantengo il contenuto originale:", err);
    return contenuto;
  }
}
