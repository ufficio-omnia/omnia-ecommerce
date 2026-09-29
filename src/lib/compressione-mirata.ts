import { createAnthropicClient, modelloAttivo, operazionePerRegistro } from "@/lib/anthropic";
import { logAiUsage } from "@/lib/ai-usage";
import { confrontaSubCriteri, violazioniBlocco, type RequisitoDisciplinare } from "@/lib/confronto-tagli";
import { REGOLE_OMNIA, ISTRUZIONI_COMPRESSIONE_MIRATA } from "@/lib/prompts";
import { ripristinaDaTestoVerificato, riepilogoRipristino } from "@/lib/ripristino-verificato";
import { stimaPagineContenuto } from "@/lib/stima-pagine";

// Compressione di UN sotto-criterio alla volta, consapevole di quanti punti
// vale e di cosa richiede il disciplinare, con garanzie a valle:
//
//  1. il modello riduce il blocco (sa punteggio, requisiti, tetto);
//  2. un ripristino DETERMINISTICO rimette asterischi di conferma, note e
//     citazioni che il modello ha tolto, prendendoli dal testo verificato
//     (nessun contenuto nuovo, nessuna chiamata);
//  3. un controllo verifica che nulla di ciò che il disciplinare richiede
//     sia sparito (termini del sotto-criterio, citazioni, asterischi,
//     figure, contenuto sufficiente);
//  4. se il controllo fallisce si riprova con l'elenco di ciò che manca; se
//     fallisce ancora la riduzione viene RIFIUTATA e il blocco resta com'è:
//     meglio un blocco più lungo del tetto (che il sistema segnala) che un
//     elemento richiesto perso.
//
// La funzione che chiama il modello è iniettabile (FunzioneCompressione):
// i test la sostituiscono con un modello finto e provano tutta la logica
// di garanzia senza spendere nulla.

export type RichiestaCompressione = {
  chiave: string;
  titoloBlocco: string;
  testo: string;
  paginePrima: number;
  pagineTarget: number;
  paroleXPagina: number;
  sotto?: { titolo: string; requisito: string; punti: number };
  punteggioTecnico?: number;
  correzioni?: string[];
  context: { userId: string | null; garaId: string | null };
};

export type FunzioneCompressione = (richiesta: RichiestaCompressione) => Promise<string | null>;

function fmt(n: number, cifre = 1): string {
  return n.toFixed(cifre).replace(".", ",");
}

export function costruisciIstruzioniCompressione(r: RichiestaCompressione): string {
  const punti = r.sotto?.punti;
  const quota = punti && r.punteggioTecnico ? Math.round((punti / r.punteggioTecnico) * 100) : null;
  const paroleDaTogliere = Math.round(Math.max(0, r.paginePrima - r.pagineTarget) * r.paroleXPagina);
  const correzioni = r.correzioni?.length
    ? `\nATTENZIONE — il tentativo precedente è stato scartato dal controllo automatico. Correggi questi punti nel testo che ti viene consegnato (reinserendo con poche parole ciò che manca, senza superare il tetto):\n${r.correzioni.map((c) => `- ${c}`).join("\n")}\n`
    : "";

  const valori: Record<string, string> = {
    CHIAVE: r.chiave,
    TITOLO: r.sotto?.titolo ?? r.titoloBlocco,
    PUNTI: punti !== undefined ? String(punti) : "non noti",
    PUNTEGGIO_TECNICO: r.punteggioTecnico !== undefined ? String(r.punteggioTecnico) : "non noto",
    QUOTA: quota !== null ? String(quota) : "n.d.",
    REQUISITO: r.sotto?.requisito || "il disciplinare non dettaglia oltre il titolo: tratta ciò che il titolo indica",
    TETTO_PAGINE: fmt(r.pagineTarget),
    TETTO_PAROLE: String(Math.round(r.pagineTarget * r.paroleXPagina)),
    PAGINE_ATTUALI: fmt(r.paginePrima),
    N: String(paroleDaTogliere),
    CORREZIONI: correzioni,
  };
  return ISTRUZIONI_COMPRESSIONE_MIRATA.replace(/\{([A-Z_]+)\}/g, (tutto, nome: string) => (nome in valori ? valori[nome] : tutto));
}

// Modello reale. Ritorna null se la chiamata fallisce o la risposta è
// troncata: meglio tenere il blocco com'è che sostituirlo con metà testo.
export const comprimiConModello: FunzioneCompressione = async (richiesta) => {
  const anthropic = createAnthropicClient();
  const model = modelloAttivo();
  const parole = richiesta.testo.split(/\s+/).filter(Boolean).length;
  const maxTokens = Math.min(32000, Math.max(4000, Math.ceil(parole * 1.3 * 4)));

  try {
    const stream = anthropic.messages.stream({
      model,
      max_tokens: maxTokens,
      thinking: { type: "disabled" },
      system: `Riduci la lunghezza di un sotto-criterio di un'offerta tecnica per una gara d'appalto senza perdere ciò che vale punti. Il testo ridotto deve continuare a rispettare le regole di scrittura del documento:\n\n=== REGOLE DI SCRITTURA OMNIA ===\n${REGOLE_OMNIA}\n=== FINE REGOLE DI SCRITTURA OMNIA ===`,
      messages: [{ role: "user", content: `${costruisciIstruzioniCompressione(richiesta)}\n\nTESTO DA RIDURRE:\n\n${richiesta.testo}` }],
    });
    const response = await stream.finalMessage();

    await logAiUsage({
      userId: richiesta.context.userId,
      garaId: richiesta.context.garaId,
      operazione: operazionePerRegistro("compressione_mirata"),
      provider: "anthropic",
      model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });

    if (response.stop_reason === "max_tokens") {
      console.warn(`comprimiConModello: risposta troncata per max_tokens su ${richiesta.chiave}, blocco lasciato com'è.`);
      return null;
    }
    const testo = response.content.map((b) => (b.type === "text" ? b.text : "")).join("\n").trim();
    return testo || null;
  } catch (err) {
    console.error(`comprimiConModello: errore su ${richiesta.chiave}:`, err);
    return null;
  }
};

export type EsitoCompressione = {
  testo: string;
  esito: "compresso" | "rifiutato" | "non_eseguito";
  motivo?: string;
  ripristino?: string;
  avvisi: string[];
  tentativi: number;
  paginePrima: number;
  pagineDopo: number;
};

// Il titolo "## x.y ..." del blocco resta quello originale (il modello a
// volte lo riscrive o lo omette), e un blocco che contiene altri "## "
// viene tagliato al primo: la risposta è per UN solo sotto-criterio.
function normalizzaBlocco(originale: string, candidato: string, chiave: string): string {
  const soloUno = candidato.replace(/^\s+/, "").split(/\n(?=##\s)/)[0];
  const righe = soloUno.split("\n");
  const titoloOriginale = originale.split("\n")[0];
  const chiaveDelPrimo = righe[0].match(/^##\s+([A-Za-z]?\d+(?:\.\d+)+)/)?.[1];
  if (chiaveDelPrimo && chiaveDelPrimo.toLowerCase() === chiave.toLowerCase()) {
    righe[0] = titoloOriginale;
    return righe.join("\n").trimEnd();
  }
  return [titoloOriginale, "", ...righe].join("\n").trimEnd();
}

export async function comprimiBloccoConGaranzie(params: {
  chiave: string;
  titoloBlocco: string;
  // Testo VERIFICATO del blocco: il riferimento del contratto (ciò che non
  // va perso si misura contro questo, non contro una versione già ridotta).
  bloccoOriginale: string;
  // Testo da ridurre adesso (può essere già stato ridotto in un giro
  // precedente).
  bloccoAttuale: string;
  pagineTarget: number;
  sotto?: { titolo: string; requisito: string; punti: number };
  punteggioTecnico?: number;
  requisito?: RequisitoDisciplinare;
  paroleTetto?: number;
  paroleXPagina: number;
  formattazione: { dimensioneCarattere?: number; interlinea?: number };
  context: { userId: string | null; garaId: string | null };
  comprimi?: FunzioneCompressione;
  maxTentativi?: number;
}): Promise<EsitoCompressione> {
  const {
    chiave, titoloBlocco, bloccoOriginale, bloccoAttuale, pagineTarget, sotto, punteggioTecnico, requisito, paroleTetto, paroleXPagina, formattazione, context,
  } = params;
  const comprimi = params.comprimi ?? comprimiConModello;
  const maxTentativi = params.maxTentativi ?? 3;
  const paginePrima = stimaPagineContenuto(bloccoAttuale, formattazione);

  const nonEseguito = (motivo: string, tentativi: number): EsitoCompressione => ({
    testo: bloccoAttuale, esito: "non_eseguito", motivo, avvisi: [], tentativi, paginePrima, pagineDopo: paginePrima,
  });

  let migliore: { testo: string; pagine: number; ripristino: string; avvisi: string[] } | null = null;
  let ultimoMotivo = "";
  let correzioni: string[] = [];
  let testoDaRidurre = bloccoAttuale;
  let tentativi = 0;
  let senzaRisposta = false;

  for (let t = 1; t <= maxTentativi; t++) {
    tentativi = t;
    const risposta = await comprimi({
      chiave, titoloBlocco, testo: testoDaRidurre, paginePrima: stimaPagineContenuto(testoDaRidurre, formattazione), pagineTarget, paroleXPagina, sotto, punteggioTecnico, correzioni, context,
    });
    if (!risposta) {
      ultimoMotivo = "nessuna risposta utilizzabile dal modello (errore o risposta troncata)";
      senzaRisposta = t === 1;
      break;
    }

    const normalizzato = normalizzaBlocco(bloccoOriginale, risposta, chiave);
    const ripristino = ripristinaDaTestoVerificato(bloccoOriginale, normalizzato);
    const candidato = ripristino.testo;
    const pagineCandidato = stimaPagineContenuto(candidato, formattazione);

    const confronto = confrontaSubCriteri(
      [{ titolo_sezione: titoloBlocco, contenuto: bloccoOriginale }],
      [{ titolo_sezione: titoloBlocco, contenuto: candidato }],
      formattazione,
      requisito ? [requisito] : [],
    ).find((c) => c.chiave.toLowerCase() === chiave.toLowerCase());

    const { violazioni, avvisi } = confronto ? violazioniBlocco(confronto, { paroleTetto }) : { violazioni: ["Impossibile confrontare il testo ridotto con l'originale."], avvisi: [] };
    for (const n of ripristino.nonRipristinabili) violazioni.push(`Non si riesce a ripristinare automaticamente: ${n}.`);
    if (pagineCandidato >= paginePrima * 0.98) violazioni.push(`Il testo ridotto occupa ancora ${fmt(pagineCandidato, 2)} pagine (era ${fmt(paginePrima, 2)}): deve scendere a ${fmt(pagineTarget, 2)}.`);

    if (violazioni.length === 0) {
      // Valido. È anche vicino al tetto? Un risultato molto sotto il tetto
      // ha tagliato più del necessario ("meno si taglia, meno si perde").
      const troppoRidotto = pagineCandidato < pagineTarget * 0.8;
      const ancoraAlto = pagineCandidato > pagineTarget * 1.1;
      const candidatoValido = { testo: candidato, pagine: pagineCandidato, ripristino: riepilogoRipristino(ripristino), avvisi };
      if (!migliore || Math.abs(pagineCandidato - pagineTarget) < Math.abs(migliore.pagine - pagineTarget)) migliore = candidatoValido;
      if (!troppoRidotto && !ancoraAlto) break;
      if (t < maxTentativi) {
        correzioni = troppoRidotto
          ? [`Hai tolto più del necessario (${fmt(pagineCandidato, 2)} pagine, il tetto è ${fmt(pagineTarget, 2)}): puoi mantenere più contenuto fino al tetto, senza aggiungere nulla di nuovo.`]
          : [`Il testo è ancora ${fmt(pagineCandidato, 2)} pagine: deve scendere a ${fmt(pagineTarget, 2)}, togliendo ciò che vale meno.`];
        testoDaRidurre = troppoRidotto ? bloccoAttuale : candidato;
      }
      continue;
    }

    ultimoMotivo = violazioni.join(" | ");
    if (t < maxTentativi) {
      correzioni = violazioni;
      // Si ripete sul testo già ripristinato (che contiene già ciò che il
      // ripristino ha potuto rimettere), non sul risposta grezza.
      testoDaRidurre = candidato;
    }
  }

  if (migliore) {
    return { testo: migliore.testo, esito: "compresso", ripristino: migliore.ripristino, avvisi: migliore.avvisi, tentativi, paginePrima, pagineDopo: migliore.pagine };
  }
  if (!ultimoMotivo || senzaRisposta) return nonEseguito(ultimoMotivo || "nessun tentativo eseguito", tentativi);
  return { testo: bloccoAttuale, esito: "rifiutato", motivo: ultimoMotivo, avvisi: [], tentativi, paginePrima, pagineDopo: paginePrima };
}
