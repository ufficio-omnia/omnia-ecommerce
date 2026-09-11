import { createAnthropicClient } from "@/lib/anthropic";
import { logAiUsage } from "@/lib/ai-usage";

const BLOCK_SIZE_WORDS = 2500;
const MODEL = "claude-sonnet-5";
const INIZIO = "<<<TESTO_ANONIMIZZATO>>>";
const FINE = "<<<FINE_TESTO_ANONIMIZZATO>>>";

const ISTRUZIONE_SISTEMA_BASE = `Anonimizzi estratti di progetti tecnici/offerte redatte da OMNIA per clienti reali, prima che vengano usati come esempio di riferimento per altri clienti. Per ogni testo che ricevi, sostituisci ogni informazione che identifica il committente, l'operatore economico (l'azienda che ha redatto l'offerta) o terze parti reali con un segnaposto generico, mantenendo intatti struttura, contenuto tecnico e stile:
- Nome dell'azienda concorrente/operatore economico che ha redatto il documento (chi scrive "noi", chi si propone come fornitore) → "[Operatore Economico]" — ATTENZIONE: questo nome ricorre spesso nel testo anche in forma abbreviata/come alias (es. il documento scrive "Rossi Pulizie S.p.A., di seguito 'Rossi'" e poi usa solo "Rossi" per il resto del testo): quando riconosci questo pattern, sostituisci OGNI occorrenza, sia della forma completa sia dell'alias abbreviato, non solo la prima menzione formale.
- Nomi di software/piattaforme/app PROPRIETARI dell'operatore economico che incorporano il suo nome o marchio, anche come parte di una parola composta (es. "RossiFM", "RossiOps", "Rossi360") → genericizza con un termine descrittivo (es. "il sistema gestionale interno", "la piattaforma di ticketing", "l'app aziendale"), anche quando il nome del marchio compare SOLO come prefisso/suffisso attaccato al resto della parola: non lasciare mai riconoscibile la radice del nome dell'azienda nemmeno dentro un nome di prodotto.
- Nomi di aziende/enti committenti → "[Committente]" (stessa attenzione ad eventuali alias/abbreviazioni)
- Nomi di persone (referenti, responsabili, RUP) → "[Referente]" (numera se ce ne sono più di uno: "[Referente 1]", "[Referente 2]")
- Indirizzi specifici, comuni, sedi operative → "[Sede]" o "[Comune]"
- Partite IVA, codici fiscali, numeri di protocollo/gara, email, telefoni → "[Dato omesso]"
- Importi economici che identificano chiaramente il valore del contratto specifico → "[Importo]" (mantieni invece valori generici usati come esempio di calcolo)

IMPORTANTE: riscrivi il testo INTEGRALMENTE, dalla prima all'ultima parola — non riassumere, non accorciare, non saltare parti: la lunghezza del testo restituito deve essere paragonabile a quella del testo ricevuto. Racchiudi ESATTAMENTE E SOLO il testo riscritto tra i marcatori ${INIZIO} e ${FINE}, senza nient'altro prima, dopo o intorno (niente introduzioni tipo "Ecco il testo anonimizzato").`;

function estraiTestoDelimitato(risposta: string): string | null {
  const inizio = risposta.indexOf(INIZIO);
  const fine = risposta.indexOf(FINE);
  if (inizio === -1 || fine === -1 || fine <= inizio) return null;
  return risposta.slice(inizio + INIZIO.length, fine).trim();
}

function splitIntoBlocks(text: string, sizeWords: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const blocks: string[] = [];
  for (let i = 0; i < words.length; i += sizeWords) {
    blocks.push(words.slice(i, i + sizeWords).join(" "));
  }
  return blocks;
}

const SEGNAPOSTO_PER_TIPO: Record<string, string> = {
  operatore_economico: "[Operatore Economico]",
  committente: "[Committente]",
  persona: "[Referente]",
  software_prodotto: "[Piattaforma Gestionale]",
  altro: "[Ente]",
};

const ALIAS_TOOL = {
  name: "registra_entita_da_anonimizzare",
  description:
    "Registra ogni entità reale (azienda offerente/operatore economico, committente, persona, software/prodotto proprietario, altro ente terzo) nominata nell'intero documento, con TUTTE le forme testuali con cui viene richiamata.",
  input_schema: {
    type: "object" as const,
    properties: {
      entita: {
        type: "array" as const,
        description: "Un elemento per ciascuna entità reale distinta trovata nel documento.",
        items: {
          type: "object" as const,
          properties: {
            forme: {
              type: "array" as const,
              items: { type: "string" as const },
              description:
                "TUTTE le forme testuali esatte con cui questa entità compare nel documento: nome legale completo, eventuale alias/soprannome/abbreviazione definito nel testo (es. dopo 'di seguito', 'in seguito denominata', o tra parentesi dopo il nome completo), sigla, e per i software anche ogni nome di prodotto composto che incorpora il marchio (es. se l'azienda è 'Rossi' e ha un software 'RossiFM' o 'RossiOps', registra 'RossiFM'/'RossiOps' come forme separate, non solo 'Rossi'). Se il documento definisce un alias e poi lo usa da solo per il resto del testo, includi ENTRAMBE le forme come voci separate dell'array.",
            },
            tipo: {
              type: "string" as const,
              enum: ["operatore_economico", "committente", "persona", "software_prodotto", "altro"],
              description:
                "operatore_economico = l'azienda che ha scritto/offerto il documento (parla in prima persona, 'la scrivente', 'il concorrente'); committente = l'ente/azienda che ha indetto la gara/richiesto il servizio; persona = nome di un individuo; software_prodotto = nome di un software/app/piattaforma proprietaria citata nel testo (spesso incorpora il nome dell'azienda come prefisso/suffisso, es. 'RossiFM'); altro = altro ente terzo reale.",
            },
          },
          required: ["forme", "tipo"],
        },
      },
    },
    required: ["entita"],
  },
};

// Individua, leggendo l'INTERO documento in un colpo solo, ogni entità
// reale e tutte le forme/alias con cui viene richiamata — serve perché
// l'anonimizzazione dei singoli blocchi (sotto) lavora in isolamento: se
// un alias viene definito nel blocco 1 (es. "Rossi Pulizie S.p.A., di
// seguito 'Rossi'") e poi ricompare da solo nel blocco 7, quel blocco non
// ha nessun modo di sapere che "Rossi" è un nome da anonimizzare (bug
// osservato in produzione: il nome reale dell'operatore economico
// restava non anonimizzato in gran parte del documento, comparso poi
// filtrato nell'offerta di un altro cliente — violazione di
// riservatezza). Questa mappa viene quindi passata a OGNI blocco, così
// la sostituzione è coerente in tutto il documento indipendentemente da
// dove l'alias viene definito.
async function estraiAliasEntita(
  anthropic: ReturnType<typeof createAnthropicClient>,
  testoCompleto: string,
): Promise<{ originale: string; sostituzione: string }[]> {
  try {
    const response = await anthropic.messages.create(
      {
        model: MODEL,
        max_tokens: 3000,
        thinking: { type: "disabled" },
        tools: [ALIAS_TOOL],
        tool_choice: { type: "tool", name: ALIAS_TOOL.name },
        messages: [
          {
            role: "user",
            content: `Leggi questo documento per intero e registra ogni entità reale con lo strumento fornito, prestando particolare attenzione ad alias/abbreviazioni definiti nel testo:\n\n${testoCompleto}`,
          },
        ],
      },
      { timeout: 120000 },
    );

    await logAiUsage({
      userId: null,
      garaId: null,
      operazione: "kb_anonimizzazione_alias",
      provider: "anthropic",
      model: MODEL,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return [];

    const input = toolUse.input as { entita?: { forme: string[]; tipo: string }[] };
    const risultato: { originale: string; sostituzione: string }[] = [];
    const contatorePersone = { n: 0 };

    for (const entita of input.entita ?? []) {
      let segnaposto = SEGNAPOSTO_PER_TIPO[entita.tipo] ?? "[Ente]";
      if (entita.tipo === "persona") {
        contatorePersone.n += 1;
        segnaposto = `[Referente ${contatorePersone.n}]`;
      }
      for (const forma of entita.forme) {
        const pulita = forma.trim();
        if (pulita.length >= 2) {
          risultato.push({ originale: pulita, sostituzione: segnaposto });
        }
      }
    }
    return risultato;
  } catch (err) {
    console.error("Errore estrazione alias entità:", err);
    return [];
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Rete di sicurezza meccanica, non affidata solo all'affidabilità del
// modello: anche con l'elenco alias fornito esplicitamente, in pratica
// l'LLM non sostituisce SEMPRE ogni occorrenza in un blocco di migliaia
// di parole (bug osservato: nomi come "Zenith" restavano isolati in
// punti di testo tabellare/compresso, o dentro nomi di software
// proprietari come "ZenithFM"/"ZenithOps" trattati come parole a sé).
// Questa scansione finale, deterministica, sostituisce ogni forma
// registrata ovunque compaia (anche come prefisso di una parola più
// lunga, per coprire i nomi di prodotto), garantendo l'assenza totale
// del nome reale indipendentemente da eventuali sviste del modello.
function scrubDeterministico(testo: string, alias: { originale: string; sostituzione: string }[]): string {
  // Le forme più lunghe vanno sostituite per prime: altrimenti una forma
  // corta (es. "Zenith") romperebbe una forma più lunga non ancora
  // processata (es. "Zenith Service S.p.A.") lasciando un segnaposto
  // innestato dentro il nome invece di sostituirlo per intero.
  const ordinati = [...alias].sort((a, b) => b.originale.length - a.originale.length);
  let risultato = testo;
  let sostituzioniAggiuntive = 0;
  for (const { originale, sostituzione } of ordinati) {
    if (originale.length < 3) continue;
    const pattern = new RegExp(`\\b${escapeRegExp(originale)}`, "gi");
    const prima = risultato;
    risultato = risultato.replace(pattern, sostituzione);
    if (risultato !== prima) sostituzioniAggiuntive++;
  }
  if (sostituzioniAggiuntive > 0) {
    console.warn(
      `Scrub deterministico: corrette ${sostituzioniAggiuntive} forme che il modello non aveva sostituito in ogni occorrenza.`,
    );
  }
  return risultato;
}

function costruisciIstruzioneAlias(alias: { originale: string; sostituzione: string }[]): string {
  if (alias.length === 0) return "";
  const elenco = alias.map((a) => `- "${a.originale}" → ${a.sostituzione}`).join("\n");
  return `\n\nQueste forme testuali sono state identificate leggendo l'intero documento come nomi reali da anonimizzare, comprese le loro varianti/alias abbreviati: sostituiscile SEMPRE con il segnaposto indicato ovunque compaiano in questo blocco, anche se il blocco stesso non le introduce o non le spiega:\n${elenco}`;
}

// Anonimizza un testo lungo (spezzato in blocchi per restare entro i
// limiti di output del modello) prima che venga indicizzato nella
// knowledge base condivisa: i progetti caricati da admin come esempio di
// stile/qualità possono contenere dati di clienti reali, che non devono
// influenzare le chat di altri clienti.
//
// L'istruzione va nel "system" (mai insieme al testo da riscrivere nello
// stesso messaggio) e il testo restituito va estratto da due marcatori
// espliciti: senza questi accorgimenti il modello a volte ripeteva parte
// dell'istruzione nella risposta (bug osservato), che finiva indicizzata
// come contenuto reale. Un tentativo di forzare la risposta tramite tool
// use con il testo intero come parametro JSON ha invece introdotto un
// problema peggiore: il modello troncava/riassumeva drasticamente il
// testo invece di riscriverlo per intero (bug osservato anche questo,
// su testi di migliaia di parole) — per questo si è tornati a testo
// libero con marcatori, verificando la lunghezza del risultato.
async function anonymizeBlocco(
  anthropic: ReturnType<typeof createAnthropicClient>,
  blocco: string,
  istruzioneAlias: string,
): Promise<string | null> {
  const response = await anthropic.messages.create(
    {
      model: MODEL,
      // Un blocco di 2500 parole in italiano può arrivare vicino a
      // 8000 token in output (l'italiano è più "denso" in token
      // dell'inglese): 8192 si è rivelato troppo stretto in pratica,
      // troncando la risposta prima del marcatore finale (bug
      // osservato: stop_reason "max_tokens" a metà del testo riscritto).
      max_tokens: 16000,
      // Senza disabilitarlo esplicitamente, il modello a volte entra in
      // ragionamento esteso anche per un compito diretto come questo,
      // consumando l'intero max_tokens in "pensiero" e restituendo zero
      // testo (bug osservato: blocco troncato a 0 caratteri restituiti).
      thinking: { type: "disabled" },
      system: ISTRUZIONE_SISTEMA_BASE + istruzioneAlias,
      messages: [{ role: "user", content: blocco }],
    },
    // Timeout esplicito: senza, una richiesta rimasta bloccata lato rete
    // (osservato in pratica: nessun errore, nessuna risposta per minuti)
    // farebbe restare sospeso l'intero caricamento del documento.
    { timeout: 120000 },
  );

  await logAiUsage({
    userId: null,
    garaId: null,
    operazione: "kb_anonimizzazione_blocco",
    provider: "anthropic",
    model: MODEL,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });

  const testoRisposta = response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n");

  return estraiTestoDelimitato(testoRisposta);
}

export async function anonymizeText(testo: string): Promise<string> {
  const blocchi = splitIntoBlocks(testo, BLOCK_SIZE_WORDS);
  if (blocchi.length === 0) return "";

  const anthropic = createAnthropicClient();

  // Passata unica sull'intero documento per individuare alias/abbreviazioni
  // di nomi reali (vedi commento su estraiAliasEntita), PRIMA di anonimizzare
  // i singoli blocchi: garantisce coerenza anche quando l'alias è definito
  // in un blocco e riusato in un altro, cosa che l'elaborazione blocco per
  // blocco da sola non può rilevare.
  const alias = await estraiAliasEntita(anthropic, testo);
  const istruzioneAlias = costruisciIstruzioneAlias(alias);

  const blocchiAnonimizzati = await Promise.all(
    blocchi.map(async (blocco) => {
      let estratto = await anonymizeBlocco(anthropic, blocco, istruzioneAlias).catch(() => null);

      // Un timeout/errore di rete o una risposta senza delimitatori
      // (troncamento, riassunto, risposta malformata) vale un secondo
      // tentativo prima di arrendersi: meglio far fallire l'elaborazione
      // del documento dopo un retry che indicizzare un estratto
      // inutilizzabile o potenzialmente non anonimizzato.
      if (!estratto || estratto.length < blocco.length * 0.5) {
        estratto = await anonymizeBlocco(anthropic, blocco, istruzioneAlias).catch(() => null);
      }

      if (!estratto || estratto.length < blocco.length * 0.5) {
        throw new Error(
          `Anonimizzazione fallita o incompleta per un blocco (${blocco.length} caratteri originali, ${estratto?.length ?? 0} restituiti).`,
        );
      }

      return estratto;
    }),
  );

  const testoUnito = blocchiAnonimizzati.join("\n\n");
  return scrubDeterministico(testoUnito, alias);
}
