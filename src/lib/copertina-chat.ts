import type { SupabaseClient } from "@supabase/supabase-js";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { postaAOpenAI } from "@/lib/copertina-openai";
import { testoDaRisposta } from "@/lib/copertina-lettura-calcoli";
import { modelloLettura } from "@/lib/copertina-lettura";
import { usoDaRisposta, type UsoImmagine } from "@/lib/copertina-relazione-calcoli";
import {
  ISTRUZIONI_RICHIESTA,
  SCHEMA_RICHIESTA,
  leggiPiano,
  messaggioPerInterprete,
  type ChiLogo,
  type ContestoInterprete,
  type PianoModifica,
  type RigaChat,
  type SchedaCopertina,
} from "@/lib/copertina-chat-calcoli";

// La chat delle modifiche alle copertine: i messaggi nel database (tabella della migrazione 0108, solo con la chiave di servizio) e l'interprete che
// trasforma la richiesta del cliente in un piano (modello di testo di OpenAI, risposta vincolata allo schema). Regole: copertina-chat-calcoli.ts.

const COLONNE = "id, ruolo, testo, copertina, allegato, allegato_per, stato, creata_il";

export type LetturaChat = { disponibile: boolean; errore: boolean; righe: RigaChat[] };

// I messaggi della gara, in ordine. Senza la tabella (0108 non eseguita) la chat non è disponibile; un altro errore = «errore» (nel dubbio non si scrive).
export async function leggiChat(admin: SupabaseClient, garaId: string, accountId: string): Promise<LetturaChat> {
  const { data, error } = await admin.from("gara_copertine_chat").select(COLONNE).eq("gara_id", garaId).eq("user_id", accountId).order("creata_il", { ascending: true }).limit(500).returns<RigaChat[]>();
  if (error) {
    if (schemaAssente(error)) return { disponibile: false, errore: false, righe: [] };
    console.error("Copertina: lettura della chat non riuscita", error.message);
    return { disponibile: true, errore: true, righe: [] };
  }
  return { disponibile: true, errore: false, righe: data ?? [] };
}

// Il messaggio del cliente (con la copertina scelta e l'eventuale logo allegato)
export async function salvaMessaggioCliente(
  admin: SupabaseClient,
  riga: { garaId: string; userId: string; testo: string; copertina: string; allegato: string | null; allegatoPer: ChiLogo | null },
): Promise<string | null> {
  const { data, error } = await admin
    .from("gara_copertine_chat")
    .insert({ gara_id: riga.garaId, user_id: riga.userId, ruolo: "cliente", testo: riga.testo, copertina: riga.copertina, allegato: riga.allegato, allegato_per: riga.allegatoPer })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) {
    console.error("Copertina: messaggio del cliente non salvato", error?.message);
    return null;
  }
  return data.id;
}

// Una risposta che NON consegna una copertina (domanda, chiarimento, richiesta fuori tema): non conta per il limite
export async function salvaRisposta(admin: SupabaseClient, riga: { garaId: string; userId: string; testo: string }): Promise<void> {
  const { error } = await admin.from("gara_copertine_chat").insert({ gara_id: riga.garaId, user_id: riga.userId, ruolo: "assistente", testo: riga.testo });
  if (error) console.error("Copertina: risposta della chat non salvata", error.message);
}

// Si registra che si sta preparando una copertina (così il limite di 3 tiene conto anche di quella in preparazione e un secondo invio non la duplica)
export async function riservaModifica(admin: SupabaseClient, riga: { garaId: string; userId: string; testo: string }): Promise<string | null> {
  const { data, error } = await admin
    .from("gara_copertine_chat")
    .insert({ gara_id: riga.garaId, user_id: riga.userId, ruolo: "assistente", testo: riga.testo, stato: "in_corso" })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) {
    console.error("Copertina: preparazione della modifica non registrata", error?.message);
    return null;
  }
  return data.id;
}

// Copertina consegnata: la risposta diventa «pronta», con la copertina nuova
export async function completaModifica(admin: SupabaseClient, id: string, esito: { testo: string; copertina: string }): Promise<void> {
  const { error } = await admin.from("gara_copertine_chat").update({ stato: "pronta", testo: esito.testo, copertina: esito.copertina }).eq("id", id);
  if (error) console.error("Copertina: consegna della modifica non registrata (smetterà di contare da sola tra 20 minuti)", error.message);
}

// Modifica non riuscita: la riga si cancella, non conta
export async function annullaModifica(admin: SupabaseClient, id: string): Promise<void> {
  const { error } = await admin.from("gara_copertine_chat").delete().eq("id", id);
  if (error) console.error("Copertina: cancellazione della modifica non riuscita (smetterà di contare da sola)", error.message);
}

const URL_RISPOSTE = "https://api.openai.com/v1/responses";
const TEMPO_MASSIMO_MS = 60_000;

// La richiesta del cliente → il piano. null se il modello non risponde con un piano utilizzabile.
export async function interpretaRichiesta(params: {
  scheda: SchedaCopertina;
  numero: number | null;
  richiesta: string;
  allegatoPer: ChiLogo | null;
  // chi è chi, i messaggi precedenti e la copertina di partenza (senza, l'interprete sbaglia logo e non capisce le correzioni)
  contesto?: ContestoInterprete;
  apiKey: string;
  modello?: string;
  fetchFn?: typeof fetch;
}): Promise<{ piano: PianoModifica | null; uso: UsoImmagine; modello: string }> {
  const modello = params.modello ?? modelloLettura();
  const corpo = await postaAOpenAI({
    url: URL_RISPOSTE,
    apiKey: params.apiKey,
    tempoMassimoMs: TEMPO_MASSIMO_MS,
    fetchFn: params.fetchFn,
    corpo: {
      model: modello,
      // «medium»: con «low» una correzione («non il nostro logo») a volte rimetteva a posto l'errore ma dimenticava la richiesta vera (prova del 13/11/2026);
      // i messaggi della chat sono pochi (al massimo 15 per gara), il costo in più è di frazioni di centesimo
      reasoning: { effort: "medium" },
      instructions: ISTRUZIONI_RICHIESTA,
      input: [{ role: "user", content: [{ type: "input_text", text: messaggioPerInterprete({ scheda: params.scheda, numero: params.numero, richiesta: params.richiesta, allegatoPer: params.allegatoPer, contesto: params.contesto }) }] }],
      text: { format: { type: "json_schema", name: "modifica_copertina", strict: true, schema: SCHEMA_RICHIESTA } },
    },
  });
  return { piano: leggiPiano(testoDaRisposta(corpo)), uso: usoDaRisposta(corpo), modello };
}
