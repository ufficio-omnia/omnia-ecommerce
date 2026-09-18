"use server";

import type Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAnthropicClient } from "@/lib/anthropic";
import { logAiUsage } from "@/lib/ai-usage";
import { inviaEmailAssistenza } from "@/lib/assistenza-email";

export type AssistenzaChatState = { error?: string };

const MODEL = "claude-sonnet-5";
const MAX_HISTORY = 20;
const MAX_TOOL_ROUNDS = 3;

const INVIA_EMAIL_TOOL: Anthropic.Tool = {
  name: "invia_email_assistenza",
  description:
    "Gira la richiesta del cliente al team di assistenza umano via email, con la trascrizione completa della conversazione. Usalo quando non riesci a risolvere il problema del cliente, o quando il cliente chiede esplicitamente di parlare con una persona/un consulente. Dopo averlo chiamato, conferma al cliente che sarà ricontattato al più presto — non aggiungere altro.",
  input_schema: {
    type: "object",
    properties: {
      motivo: {
        type: "string",
        description: "Riassunto breve (1-2 frasi) del motivo dell'escalation, per il team che risponderà.",
      },
      gara_riferimento: {
        type: "string",
        description: "Nome/titolo della gara a cui il cliente ha fatto riferimento, se ne ha menzionata una. Ometti se non pertinente.",
      },
    },
    required: ["motivo"],
  },
};

// Confine rigido, scritto esplicitamente: l'assistente di supporto NON è
// l'assistente di gara (gara-chat.ts) — non ha accesso a documenti,
// bandi o RAG, e non deve MAI provare a rispondere su contenuti di gara
// nemmeno se il cliente insiste o la domanda sembra semplice. Stesso
// rigore del blocco "RISERVATEZZA ASSOLUTA" già usato in gara-chat.ts
// per un'istruzione a cui il modello deve attenersi senza eccezioni.
const SYSTEM_PROMPT = `Sei l'assistente di supporto di OMNIA AI. Rispondi SOLO su questi argomenti: funzionamento della piattaforma, problemi tecnici, abbonamento, piani, crediti, fatturazione, accesso e account.

DIVIETO ASSOLUTO, SENZA ECCEZIONI: non rispondere MAI a domande su contenuti di una gara specifica, requisiti di partecipazione, interpretazione di bandi/disciplinari/capitolati, valutazioni di ammissibilità, o qualsiasi forma di consulenza di merito su una gara d'appalto — anche se la domanda sembra semplice, anche se il cliente insiste, anche se pensi di conoscere la risposta. Su questi argomenti rispondi SEMPRE che serve un consulente umano e proponi di girare la richiesta con lo strumento invia_email_assistenza: non abbozzare mai nemmeno una risposta parziale o un'opinione, nemmeno "giusto per aiutare".

Quando non riesci a risolvere un problema entro il tuo ambito, o quando il cliente chiede esplicitamente di parlare con una persona, usa lo strumento invia_email_assistenza per girare la richiesta al team — poi conferma solo che il cliente sarà ricontattato al più presto.

Rispondi sempre in italiano, in modo chiaro, professionale e conciso.`;

export async function sendAssistenzaMessage(
  _prevState: AssistenzaChatState,
  formData: FormData,
): Promise<AssistenzaChatState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Sessione scaduta, ricarica la pagina." };

  const messaggio = String(formData.get("messaggio") ?? "").trim();
  if (!messaggio) return { error: "Scrivi un messaggio." };

  const { data: storicoRaw } = await supabase
    .from("assistenza_messaggi")
    .select("ruolo, contenuto")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(MAX_HISTORY)
    .returns<{ ruolo: string; contenuto: string }[]>();

  const storico = (storicoRaw ?? []).slice().reverse();

  const { error: insertUserError } = await supabase.from("assistenza_messaggi").insert({
    user_id: user.id,
    ruolo: "utente",
    contenuto: messaggio,
  });

  if (insertUserError) {
    console.error("Errore salvataggio messaggio assistenza:", insertUserError);
    return { error: "Errore nell'invio del messaggio." };
  }

  let rispostaFinale = "";
  // Diagnostica temporanea: prima d'ora un errore qui veniva solo
  // loggato lato server (console.error, invisibile senza accesso ai log
  // Vercel) e il client tornava sempre {} — un fallimento della chiamata
  // a Claude era quindi indistinguibile da "nessuna risposta di testo"
  // per il cliente, che vedeva la chat restare silenziosa senza errore.
  // Da togliere (tornare a un messaggio generico) una volta confermata
  // la causa del bug segnalato in produzione.
  let erroreDiagnostico: string | null = null;

  try {
    const anthropic = createAnthropicClient();

    const messages: Anthropic.MessageParam[] = [
      ...storico.map((m) => ({
        role: m.ruolo === "utente" ? ("user" as const) : ("assistant" as const),
        content: m.contenuto,
      })),
      { role: "user" as const, content: messaggio },
    ];

    let strumentoDisponibile = true;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const stream = anthropic.messages.stream({
        model: MODEL,
        max_tokens: 4096,
        thinking: { type: "adaptive" },
        system: SYSTEM_PROMPT,
        tools: strumentoDisponibile ? [INVIA_EMAIL_TOOL] : [],
        messages,
      });
      const response = await stream.finalMessage();

      await logAiUsage({
        userId: user.id,
        garaId: null,
        operazione: "chat_assistenza",
        provider: "anthropic",
        model: MODEL,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      });

      const testoBlocco = response.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("\n")
        .trim();

      if (testoBlocco) {
        rispostaFinale = rispostaFinale ? `${rispostaFinale}\n${testoBlocco}` : testoBlocco;
      }

      const toolUse = response.content.find(
        (block) => block.type === "tool_use" && block.name === "invia_email_assistenza",
      );

      if (response.stop_reason !== "tool_use" || !toolUse || toolUse.type !== "tool_use") {
        break;
      }

      messages.push({ role: "assistant", content: response.content });

      const input = toolUse.input as { motivo: string; gara_riferimento?: string };
      try {
        await inviaEmailAssistenza({
          userId: user.id,
          motivo: input.motivo,
          garaRiferimento: input.gara_riferimento ?? null,
        });
        // Il messaggio di conferma lo scrive già inviaEmailAssistenza
        // direttamente su assistenza_messaggi: qui basta chiudere il
        // ciclo, non serve un altro giro dal modello.
        strumentoDisponibile = false;
        messages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: "Email inviata al team di assistenza con successo.",
            },
          ],
        });
        break;
      } catch (err) {
        console.error("Errore invio email assistenza:", err);
        messages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: "Errore nell'invio dell'email al team di assistenza.",
              is_error: true,
            },
          ],
        });
      }
    }
  } catch (err) {
    console.error("Errore chat assistenza:", err);
    erroreDiagnostico = err instanceof Error ? err.message : String(err);
  }

  // Quando il tool invia_email_assistenza viene chiamato, la conferma al
  // cliente viene già scritta da inviaEmailAssistenza: se il modello non
  // ha prodotto anche un proprio testo in quel giro, non serve un
  // secondo messaggio di ripiego generico.
  if (rispostaFinale.trim()) {
    const { error: insertAiError } = await supabase.from("assistenza_messaggi").insert({
      user_id: user.id,
      ruolo: "assistente",
      contenuto: rispostaFinale.trim(),
    });

    if (insertAiError) {
      console.error("Errore salvataggio risposta assistenza:", insertAiError);
    }
  } else {
    console.warn("sendAssistenzaMessage: nessun testo prodotto dal modello dopo il ciclo di strumenti.");
  }

  revalidatePath("/dashboard/omnia-ai/assistenza");
  return erroreDiagnostico ? { error: `Errore assistente: ${erroreDiagnostico}` } : {};
}

// Escalation su richiesta diretta del cliente, senza passare dal
// modello: stessa funzione di invio usata quando è l'assistente a
// decidere, un solo punto di implementazione per entrambi i trigger.
export async function richiediEscalationAssistenza(): Promise<AssistenzaChatState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Sessione scaduta, ricarica la pagina." };

  await supabase.from("assistenza_messaggi").insert({
    user_id: user.id,
    ruolo: "utente",
    contenuto: "[Richiesta di essere contattato da un consulente]",
  });

  try {
    await inviaEmailAssistenza({
      userId: user.id,
      motivo: "Richiesta diretta del cliente, nessun giro con l'assistente.",
      garaRiferimento: null,
    });
  } catch (err) {
    console.error("Errore richiesta escalation assistenza:", err);
    return { error: "Errore nell'invio della richiesta. Riprova." };
  }

  revalidatePath("/dashboard/omnia-ai/assistenza");
  return {};
}
