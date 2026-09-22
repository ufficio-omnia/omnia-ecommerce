import type Anthropic from "@anthropic-ai/sdk";
import { createAnthropicClient } from "@/lib/anthropic";
import { logAiUsage } from "@/lib/ai-usage";
import { ISTRUZIONI_VERIFICA_DATI } from "@/lib/prompts";

const MODEL = "claude-sonnet-5";

// Il testo corretto arriva SOLO tramite questo strumento, non come
// risposta testuale libera: verificato in pratica che una semplice
// istruzione nel prompt ("restituisci SOLO il testo, senza commenti") non
// basta — il modello ha anteposto una propria analisi in linguaggio
// naturale ("1. Titolo... 2. CCNL errato... Ecco il testo corretto:")
// prima del contenuto vero, che sarebbe finita letteralmente nel
// documento Word del cliente. Estraendo SOLO il campo strutturato dello
// strumento (mai i blocchi di testo della risposta) quel commento, se
// scritto, non raggiunge mai il documento.
//
// tool_choice resta "auto", NON forzato su questo strumento: verificato
// che forzare un tool specifico disattiva silenziosamente il ragionamento
// anche con thinking:"adaptive" richiesto (0 thinking_tokens in pratica,
// nessun errore) — e su un controllo che include somme (monte ore da più
// righe) questo produce risposte sbagliate senza alcun segnale d'errore.
// Con tool_choice "auto" il modello ragiona normalmente in un blocco
// "thinking" (mai incluso nel testo restituito) e poi chiama comunque lo
// strumento in pratica, per come è istruito nel prompt.
const RESTITUISCI_TESTO_TOOL: Anthropic.Tool = {
  name: "restituisci_testo_verificato",
  description:
    "Restituisce il testo della sezione dopo aver applicato le correzioni richieste (invariato se non ce n'era bisogno).",
  input_schema: {
    type: "object",
    properties: {
      testo_completo: {
        type: "string",
        description:
          "Il testo COMPLETO della sezione con le correzioni applicate — nessun commento, nessuna spiegazione, nessuna analisi dei problemi trovati: SOLO il testo che verrà salvato e mostrato così com'è nel documento Word del cliente.",
      },
    },
    required: ["testo_completo"],
  },
};

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

// Quattro controlli in una sola chiamata dopo ogni generazione di sezione
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
// 4. Nessuna cella di tabella vuota.
// In caso di errore/timeout la chiamata NON deve bloccare la generazione:
// meglio consegnare la bozza non verificata che nessuna bozza affatto —
// ritorna il contenuto originale invariato.
export async function verificaDatiAziendali(
  contenuto: string,
  companyProfile: CompanyProfiloConfermato,
  contestoDocumenti: string,
  datiGaraStrutturati: string,
  context: { userId: string | null; garaId: string | null },
): Promise<string> {
  try {
    const anthropic = createAnthropicClient();

    // Tetto fisso, non più scalato sulla lunghezza del contenuto: con il
    // ragionamento riattivato (thinking:"adaptive", vedi sotto) il blocco
    // di pensiero consuma token dallo stesso max_tokens del testo finale,
    // e una formula calcolata solo sulle parole in ingresso troncava la
    // risposta in pratica (bug osservato: sezione da 1447 parole troncata,
    // fallback silenzioso al contenuto non verificato). max_tokens è un
    // tetto, non un budget pagato in anticipo: non costa nulla in più
    // finché il modello non lo usa davvero — stesso valore già usato per
    // lo stesso motivo in gara-chat.ts.
    const maxTokens = 64000;

    // Streaming (non .create()): con max_tokens fino a 64000 una richiesta
    // non in streaming rischia un timeout HTTP, stesso problema già
    // risolto altrove nel codebase (gara-chat.ts) per lo stesso motivo.
    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: maxTokens,
      thinking: { type: "adaptive" },
      system: ISTRUZIONI_VERIFICA_DATI,
      tools: [RESTITUISCI_TESTO_TOOL],
      tool_choice: { type: "auto" },
      messages: [
        {
          role: "user",
          content: `Profilo azienda confermato dal cliente:\n${
            companyProfile ? JSON.stringify(companyProfile, null, 2) : "Profilo azienda non ancora compilato: nessun dato d'impresa è confermato."
          }\n\nSedi/immobili e personale uscente di QUESTA gara (dato di gara, fonte primaria e SEMPRE completa — verificata in fase di estrazione documenti, non dipende da cosa la ricerca per somiglianza ha trovato: vedi la regola di priorità delle fonti sotto):\n${
            datiGaraStrutturati || "Nessuno estratto in forma strutturata per questa gara."
          }\n\nEstratti pertinenti dai documenti di gara (bando/disciplinare/capitolato, recuperati per somiglianza rispetto all'ultimo messaggio: possono NON coprire ogni dettaglio) — servono per il contesto della gara, non contengono dati sull'impresa del cliente:\n${
            contestoDocumenti || "Nessuno."
          }\n\nTesto della sezione da verificare:\n\n${contenuto}`,
        },
      ],
    });
    const response = await stream.finalMessage();

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

    const toolUse = response.content.find(
      (block) => block.type === "tool_use" && block.name === "restituisci_testo_verificato",
    );
    if (!toolUse || toolUse.type !== "tool_use") {
      console.warn("verificaDatiAziendali: nessuna chiamata allo strumento nella risposta, mantengo il contenuto originale.");
      return contenuto;
    }

    const testo = (toolUse.input as { testo_completo?: string }).testo_completo?.trim();

    return testo || contenuto;
  } catch (err) {
    console.error("verificaDatiAziendali: errore, mantengo il contenuto originale:", err);
    return contenuto;
  }
}
