import type Anthropic from "@anthropic-ai/sdk";
import { createAnthropicClient, MODELLO_PRINCIPALE } from "@/lib/anthropic";
import { logAiUsage } from "@/lib/ai-usage";
import { ISTRUZIONI_RIFORMULAZIONE_SENZA_ECONOMICO } from "@/lib/prompts";
import {
  estrattoIntorno,
  normalizzaPerRicerca,
  trovaRigheConRiferimentiEconomici,
  trovaRiferimentiEconomici,
  type AvvisoRiferimentoEconomico,
} from "@/lib/riferimenti-economici";

// Garanzia R8 sul testo PRIMA che diventi un documento. Il modello conosce la
// regola (prompts/regole-omnia.md) ma ogni tanto una formula come "senza
// oneri aggiuntivi" scappa comunque, e in un'offerta tecnica può costare
// l'esclusione dalla gara: perciò non basta il prompt, il testo si controlla
// in codice a ogni generazione reale (generaBozzaSezione e
// componiRelazioneFinale) e non si consegna mai in silenzio.
//
// Quando il rilevatore (riferimenti-economici.ts) trova una formula:
//  1. le RIGHE interessate (paragrafo, voce di elenco, riga di tabella,
//     titolo) vengono riformulate dal modello con l'istruzione esplicita di
//     togliere ogni riferimento economico — non l'intera sezione, per non
//     toccare nient'altro del testo già verificato;
//  2. ogni riformulazione è controllata (nessuna formula residua, stessa
//     struttura, stessi tag e asterischi) e scartata se non regge;
//  3. un secondo tentativo, con il motivo del primo fallimento;
//  4. se dopo il secondo tentativo la formula c'è ancora, il documento esce
//     comunque ma il risultato porta un AVVISO con il punto esatto, che la
//     UI mostra in rosso accanto al pulsante di scaricamento.

export type RigaDaRiformulare = { indice: number; riga: string; formule: string[] };

export type FunzioneRiformulazione = (params: {
  titoloSezione: string;
  righe: RigaDaRiformulare[];
  correzioni: string;
}) => Promise<Map<number, string>>;

export type EsitoGaranziaEconomica = {
  testo: string;
  avvisi: AvvisoRiferimentoEconomico[];
  righeRiformulate: number;
  chiamate: number;
};

const MAX_TENTATIVI = 2;
// Tetto di righe per chiamata: oltre, il resto resta per il tentativo
// successivo (e infine nell'avviso) invece di una risposta enorme.
const MAX_RIGHE_PER_CHIAMATA = 30;

const TAG_FORMATTAZIONE = /\[(?:C|G|ICONA:[^\]]*|RIGA:[^\]]*|CELLA:[^\]]*|TABELLA:[^\]]*|BOX(?::[^\]]*)?|\/BOX|ORGANIGRAMMA|\/ORGANIGRAMMA)\]/gi;

function tagDiFormattazione(riga: string): string[] {
  return (riga.match(TAG_FORMATTAZIONE) || []).map((t) => t.toUpperCase()).sort();
}

// Asterischi che contano come contenuto (R9: "*" dopo un valore proposto da
// confermare, anche con escape): il grassetto "**" non conta.
function contaAsterischiMarcatori(riga: string): number {
  const senzaGrassetto = riga.replace(/\*\*/g, "");
  return senzaGrassetto.split("*").length - 1;
}

function parole(riga: string): number {
  return normalizzaPerRicerca(riga).split(/\s+/).filter(Boolean).length;
}

function strutturaDellaRiga(riga: string): string {
  const t = riga.trim();
  if (t.startsWith("|")) return `tabella:${t.split("|").length}`;
  const titolo = t.match(/^(#{1,3})\s+(\S+)/);
  if (titolo) return `titolo:${titolo[1]}:${titolo[2]}`;
  const elenco = t.match(/^([-*])\s+/);
  if (elenco) return `elenco:${elenco[1]}`;
  return "paragrafo";
}

// null = riformulazione accettabile; altrimenti il motivo del rifiuto.
export function validaRiformulazione(originale: string, nuova: string): string | null {
  if (!nuova || nuova.trim() === "") return "riga vuota";
  if (/\n/.test(nuova.trim())) return "più righe invece di una";
  const residue = trovaRiferimentiEconomici(nuova);
  if (residue.length > 0) return `contiene ancora «${residue[0].formula}»`;
  if (strutturaDellaRiga(originale) !== strutturaDellaRiga(nuova)) return "struttura diversa (tabella/elenco/titolo/numero di celle)";
  if (JSON.stringify(tagDiFormattazione(originale)) !== JSON.stringify(tagDiFormattazione(nuova))) return "tag di formattazione cambiati";
  if (contaAsterischiMarcatori(nuova) < contaAsterischiMarcatori(originale)) return "asterisco di proposta da confermare perso";
  const p0 = parole(originale);
  const p1 = parole(nuova);
  if (p1 < Math.max(2, Math.floor(p0 * 0.35))) return "riga ridotta troppo";
  if (p1 > Math.ceil(p0 * 1.8) + 5) return "riga allungata troppo";
  return null;
}

function titoloSezionePulito(riga: string): string {
  return normalizzaPerRicerca(riga.replace(/^#{1,3}\s+/, ""));
}

function sottoCriterioDellaRiga(righe: string[], indiceRiga: number): string | null {
  for (let i = indiceRiga; i >= 0; i--) {
    if (/^#{2,3}\s+/.test(righe[i].trim())) return titoloSezionePulito(righe[i].trim());
  }
  return null;
}

const TOOL_RIGHE: Anthropic.Tool = {
  name: "restituisci_righe",
  description: "Restituisce le righe riformulate, ciascuna con il suo indice.",
  input_schema: {
    type: "object",
    properties: {
      righe: {
        type: "array",
        description: "Una voce per ogni riga ricevuta.",
        items: {
          type: "object",
          properties: {
            indice: { type: "number", description: "L'indice della riga, come ricevuto." },
            riga: { type: "string", description: "La riga COMPLETA riformulata, su una sola riga, con la stessa struttura." },
          },
          required: ["indice", "riga"],
        },
      },
    },
    required: ["righe"],
  },
};

async function riformulaConModello(
  { titoloSezione, righe, correzioni }: Parameters<FunzioneRiformulazione>[0],
  context: { userId: string | null; garaId: string | null },
): Promise<Map<number, string>> {
  const anthropic = createAnthropicClient();
  const elenco = righe
    .map((r) => `### RIGA ${r.indice}\nFormule trovate: ${r.formule.map((f) => `«${f}»`).join(", ")}\nTesto:\n${r.riga}`)
    .join("\n\n");

  const response = await anthropic.messages.create({
    model: MODELLO_PRINCIPALE,
    max_tokens: 8000,
    thinking: { type: "disabled" },
    system: ISTRUZIONI_RIFORMULAZIONE_SENZA_ECONOMICO.replace("{TITOLO_SEZIONE}", () => titoloSezione).replace("{CORREZIONI}", () => correzioni),
    tools: [TOOL_RIGHE],
    tool_choice: { type: "tool", name: "restituisci_righe" },
    messages: [{ role: "user", content: elenco }],
  });

  await logAiUsage({
    userId: context.userId,
    garaId: context.garaId,
    operazione: "riformulazione_senza_economico",
    provider: "anthropic",
    model: MODELLO_PRINCIPALE,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });

  const risultato = new Map<number, string>();
  const toolUse = response.content.find((b) => b.type === "tool_use" && b.name === "restituisci_righe");
  if (!toolUse || toolUse.type !== "tool_use") return risultato;
  const input = toolUse.input as { righe?: { indice: number; riga: string }[] };
  for (const voce of input.righe ?? []) {
    if (typeof voce?.indice === "number" && typeof voce?.riga === "string") risultato.set(voce.indice, voce.riga);
  }
  return risultato;
}

export async function garantisciSenzaRiferimentiEconomici(
  testo: string,
  opzioni: {
    titoloSezione: string;
    context: { userId: string | null; garaId: string | null };
    // Solo per i test: sostituisce la chiamata al modello.
    riformula?: FunzioneRiformulazione;
  },
): Promise<EsitoGaranziaEconomica> {
  const { titoloSezione, context } = opzioni;
  const riformula: FunzioneRiformulazione = opzioni.riformula ?? ((p) => riformulaConModello(p, context));
  const righe = testo.split("\n");

  let righeRiformulate = 0;
  let chiamate = 0;
  const motiviPerRiga = new Map<number, string>();

  for (let tentativo = 1; tentativo <= MAX_TENTATIVI; tentativo++) {
    const daCorreggere = trovaRigheConRiferimentiEconomici(righe.join("\n")).slice(0, MAX_RIGHE_PER_CHIAMATA);
    if (daCorreggere.length === 0) break;

    const correzioni =
      tentativo === 1 || motiviPerRiga.size === 0
        ? ""
        : `\nIl tentativo precedente è stato scartato per queste righe — correggi esattamente questo:\n${[...motiviPerRiga]
            .map(([indice, motivo]) => `- RIGA ${indice}: ${motivo}`)
            .join("\n")}\n`;

    chiamate++;
    let riformulate = new Map<number, string>();
    try {
      riformulate = await riformula({
        titoloSezione,
        righe: daCorreggere.map((r) => ({ indice: r.indiceRiga, riga: r.riga, formule: r.riferimenti.map((x) => x.formula) })),
        correzioni,
      });
    } catch (err) {
      console.error(`garantisciSenzaRiferimentiEconomici: errore nella riformulazione (tentativo ${tentativo}):`, err);
    }

    motiviPerRiga.clear();
    for (const r of daCorreggere) {
      const nuova = riformulate.get(r.indiceRiga);
      if (nuova === undefined) {
        motiviPerRiga.set(r.indiceRiga, "nessuna riformulazione restituita");
        continue;
      }
      const motivo = validaRiformulazione(r.riga, nuova);
      if (motivo) {
        motiviPerRiga.set(r.indiceRiga, `riformulazione scartata: ${motivo}`);
        continue;
      }
      righe[r.indiceRiga] = nuova.trim();
      righeRiformulate++;
    }
  }

  // Quello che resta dopo l'ultimo tentativo non si consegna in silenzio.
  const avvisi: AvvisoRiferimentoEconomico[] = [];
  for (const r of trovaRigheConRiferimentiEconomici(righe.join("\n"))) {
    const sottoCriterio = sottoCriterioDellaRiga(righe, r.indiceRiga);
    for (const rif of r.riferimenti) {
      avvisi.push({ sezione: titoloSezione, sottoCriterio, formula: rif.formula, estratto: estrattoIntorno(r.riga, rif) });
    }
  }

  return { testo: righe.join("\n"), avvisi, righeRiformulate, chiamate };
}
