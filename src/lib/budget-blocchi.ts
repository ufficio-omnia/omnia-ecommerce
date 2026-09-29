import { estraiRequisitiDaCriteri, type RequisitoDisciplinare } from "@/lib/confronto-tagli";
import { comprimiBloccoConGaranzie, comprimiConModello, type EsitoCompressione, type FunzioneCompressione } from "@/lib/compressione-mirata";
import { trovaBudgetSottoCriterio, type BudgetGara, type BudgetSottoCriterio } from "@/lib/sotto-criteri";
import { stimaPagineContenuto } from "@/lib/stima-pagine";

// Orchestrazione della compressione per sotto-criterio. Nessun accesso a
// DB e nessuna dipendenza da relazione-tecnica.ts: opera su testo e su un
// budget, e riceve dall'esterno la funzione che chiama il modello, così la
// stessa logica gira in produzione e nei test senza spendere nulla.
//
// Due fasi, in questo ordine:
//  1. per ogni sotto-criterio che supera il PROPRIO tetto (proporzionale ai
//     punti) di oltre la tolleranza: una riduzione mirata di quel solo
//     blocco, che sa cosa vale e cosa richiede;
//  2. se il documento intero supera ancora il limite: ulteriori riduzioni,
//     partendo dai blocchi che rendono meno punti per pagina.
// Ogni riduzione è soggetta alle garanzie di comprimiBloccoConGaranzie: se
// viola il contratto (elemento richiesto perso, citazione, asterisco, ecc.)
// viene rifiutata e il blocco resta com'è.

// Un blocco si riduce solo se supera il proprio tetto di oltre il 10%: sotto
// quella soglia il costo di una chiamata e il rischio di perdere contenuto
// non valgono lo scarto (stessa tolleranza di SOGLIA_RIDUZIONE in
// relazione-tecnica.ts).
export const TOLLERANZA_TETTO = 1.1;

export type Sezione = { titolo_sezione: string; contenuto: string };

export type BloccoSezione = { chiave: string | null; testo: string };

export function dividiInBlocchi(contenuto: string): BloccoSezione[] {
  return contenuto.split(/\n(?=##\s)/).map((testo) => ({
    chiave: testo.match(/^##\s+([A-Za-z]?\d+(?:\.\d+)+)/)?.[1] ?? null,
    testo,
  }));
}

export function unisciBlocchi(blocchi: BloccoSezione[]): string {
  return blocchi.map((b) => b.testo).join("\n");
}

// Tetto alle chiamate al modello per la compressione di UNA composizione:
// senza, una gara in cui le riduzioni vengono rifiutate a ripetizione
// (contenuto che non si riesce a ridurre senza toccare ciò che è richiesto)
// moltiplicherebbe le chiamate — in una prova con un modello finto che
// falliva sempre furono 68. Oltre il tetto non si prova più: i blocchi
// restano come sono e il documento porta l'avviso di superamento del limite.
export const MAX_CHIAMATE_COMPRESSIONE = 40;

export type ContestoBudget = {
  budget: BudgetGara;
  requisiti: RequisitoDisciplinare[];
  punteggioTecnico?: number;
  formattazione: { dimensioneCarattere?: number; interlinea?: number };
  context: { userId: string | null; garaId: string | null };
  comprimi: FunzioneCompressione;
  chiamate: { usate: number; max: number };
};

export function contestoDaCriteri(
  budget: BudgetGara,
  criteriValutazione: string | null | undefined,
  resto: Omit<ContestoBudget, "budget" | "requisiti" | "comprimi" | "chiamate"> & { comprimi?: FunzioneCompressione; maxChiamate?: number },
): ContestoBudget {
  const { comprimi, maxChiamate, ...altro } = resto;
  const base = comprimi ?? comprimiConModello;
  const chiamate = { usate: 0, max: maxChiamate ?? MAX_CHIAMATE_COMPRESSIONE };
  const limitata: FunzioneCompressione = async (richiesta) => {
    if (chiamate.usate >= chiamate.max) return null;
    chiamate.usate++;
    return base(richiesta);
  };
  return { budget, requisiti: estraiRequisitiDaCriteri(criteriValutazione ?? ""), ...altro, comprimi: limitata, chiamate };
}

export type EsitoBlocco = EsitoCompressione & { chiave: string; fase: 1 | 2 };

async function comprimiUnBlocco(
  chiave: string,
  bloccoAttuale: string,
  bloccoOriginale: string,
  titoloSezione: string,
  pagineTarget: number,
  sotto: BudgetSottoCriterio | undefined,
  ctx: ContestoBudget,
  maxTentativi = 3,
): Promise<EsitoCompressione> {
  return comprimiBloccoConGaranzie({
    maxTentativi,
    chiave,
    titoloBlocco: titoloSezione,
    bloccoOriginale,
    bloccoAttuale,
    pagineTarget,
    sotto: sotto ? { titolo: sotto.titolo, requisito: sotto.requisito, punti: sotto.punti } : undefined,
    punteggioTecnico: ctx.punteggioTecnico,
    requisito: ctx.requisiti.find((r) => r.chiave.toLowerCase() === chiave.toLowerCase()),
    paroleTetto: sotto?.parolePreviste,
    paroleXPagina: ctx.budget.paroleProsaPerPagina,
    formattazione: ctx.formattazione,
    context: ctx.context,
    comprimi: ctx.comprimi,
  });
}

function bloccoOriginaleDi(originale: string, chiave: string, ripiego: string): string {
  return dividiInBlocchi(originale).find((b) => b.chiave?.toLowerCase() === chiave.toLowerCase())?.testo ?? ripiego;
}

// Fase 1 per UNA sezione: riduce i blocchi che superano il proprio tetto.
// I blocchi di una stessa sezione sono indipendenti: si riducono in
// parallelo. I sotto-criteri tabellari e i blocchi senza chiave (testo prima
// del primo "##") non si toccano.
export async function comprimiSezionePerSottoCriteri(
  titoloSezione: string,
  contenuto: string,
  originale: string,
  ctx: ContestoBudget,
): Promise<{ contenuto: string; esiti: EsitoBlocco[] }> {
  const blocchi = dividiInBlocchi(contenuto);
  const esiti: EsitoBlocco[] = [];

  await Promise.all(
    blocchi.map(async (blocco, i) => {
      if (!blocco.chiave) return;
      const sotto = trovaBudgetSottoCriterio(ctx.budget, blocco.chiave);
      if (!sotto || sotto.tabellare) return;
      const pagine = stimaPagineContenuto(blocco.testo, ctx.formattazione);
      if (pagine <= sotto.paginePreviste * TOLLERANZA_TETTO) return;

      const esito = await comprimiUnBlocco(blocco.chiave, blocco.testo, bloccoOriginaleDi(originale, blocco.chiave, blocco.testo), titoloSezione, sotto.paginePreviste, sotto, ctx);
      esiti.push({ ...esito, chiave: blocco.chiave, fase: 1 });
      if (esito.esito === "compresso") blocchi[i] = { ...blocco, testo: esito.testo };
    }),
  );

  esiti.sort((a, b) => a.chiave.localeCompare(b.chiave, undefined, { numeric: true }));
  return { contenuto: unisciBlocchi(blocchi), esiti };
}

// Fase 2, sul documento intero: finché il totale supera `limite`, riduce i
// blocchi PARTENDO da quelli che rendono meno punti per pagina occupata
// (punti del sotto-criterio / pagine del blocco): è lì che una pagina in meno
// costa meno. Ogni blocco si riduce al massimo una volta per round e mai
// sotto il 55% della sua lunghezza attuale. Ritorna il numero di blocchi
// ridotti; le sezioni sono modificate sul posto.
export async function tagliaPerValore(
  sezioni: Sezione[],
  originali: Sezione[],
  limite: number,
  misuraTotale: (sezioni: Sezione[]) => number,
  ctx: ContestoBudget,
  // `saltare`: chiavi dei sotto-criteri la cui riduzione è già stata rifiutata
  // (non si riprova con un target più basso: rifiuterebbe per lo stesso
  // motivo e costerebbe altre chiamate).
  opzioni: { maxRound?: number; saltare?: Set<string> } = {},
): Promise<{ esiti: EsitoBlocco[]; sezioniTagliate: string[] }> {
  const maxRound = opzioni.maxRound ?? 3;
  const esiti: EsitoBlocco[] = [];
  const sezioniTagliate = new Set<string>();
  const giaRifiutati = new Set<string>(opzioni.saltare ?? []);
  let totale = misuraTotale(sezioni);

  for (let round = 0; round < maxRound && totale > limite; round++) {
    // Candidati: (sezione, blocco) con budget noto e non tabellari.
    const candidati: { s: number; b: number; chiave: string; densita: number; pagine: number }[] = [];
    sezioni.forEach((sezione, s) => {
      dividiInBlocchi(sezione.contenuto).forEach((blocco, b) => {
        if (!blocco.chiave) return;
        const sotto = trovaBudgetSottoCriterio(ctx.budget, blocco.chiave);
        if (!sotto || sotto.tabellare || giaRifiutati.has(blocco.chiave)) return;
        const pagine = stimaPagineContenuto(blocco.testo, ctx.formattazione);
        if (pagine <= 0.3) return; // già ridotto al minimo: non vale un'altra chiamata
        candidati.push({ s, b, chiave: blocco.chiave, densita: sotto.punti / pagine, pagine });
      });
    });
    candidati.sort((a, b) => a.densita - b.densita);

    let tagliato = false;
    for (const c of candidati) {
      if (totale <= limite) break;
      const sezione = sezioni[c.s];
      const blocchi = dividiInBlocchi(sezione.contenuto);
      const blocco = blocchi[c.b];
      if (!blocco || blocco.chiave !== c.chiave) continue;
      const pagineAttuali = stimaPagineContenuto(blocco.testo, ctx.formattazione);
      const eccesso = totale - limite;
      // Margine di 0,15 pagine oltre l'eccesso: il modello tende a fermarsi
      // appena sopra il target, non esattamente su di esso.
      const target = Math.max(pagineAttuali * 0.55, pagineAttuali - eccesso - 0.15);
      if (target >= pagineAttuali * 0.98) continue;

      const sotto = trovaBudgetSottoCriterio(ctx.budget, c.chiave);
      // In fase 2 due tentativi bastano: il primo con il testo, il secondo
      // con l'elenco di ciò che il controllo ha trovato mancante.
      const esito = await comprimiUnBlocco(c.chiave, blocco.testo, bloccoOriginaleDi(originali[c.s]?.contenuto ?? "", c.chiave, blocco.testo), sezione.titolo_sezione, target, sotto, ctx, 2);
      esiti.push({ ...esito, chiave: c.chiave, fase: 2 });
      if (esito.esito !== "compresso") {
        giaRifiutati.add(c.chiave);
        continue;
      }
      blocchi[c.b] = { ...blocco, testo: esito.testo };
      sezioni[c.s] = { ...sezione, contenuto: unisciBlocchi(blocchi) };
      sezioniTagliate.add(sezione.titolo_sezione);
      tagliato = true;
      totale = misuraTotale(sezioni);
    }
    if (!tagliato) break; // nessun progresso possibile: non insistere a vuoto
  }
  return { esiti, sezioniTagliate: [...sezioniTagliate] };
}

export function riepilogoEsiti(esiti: EsitoBlocco[]): string[] {
  return esiti.map((e) => {
    const base = `[fase ${e.fase}] ${e.chiave}: ${e.esito} ${e.paginePrima.toFixed(2)} → ${e.pagineDopo.toFixed(2)} pagine (${e.tentativi} tentativo/i)`;
    const extra = [e.ripristino && e.ripristino !== "nulla da ripristinare" ? `ripristino: ${e.ripristino}` : "", e.motivo ? `motivo: ${e.motivo}` : "", e.avvisi.length ? `avvisi: ${e.avvisi.join("; ")}` : ""].filter(Boolean);
    return extra.length ? `${base} — ${extra.join(" — ")}` : base;
  });
}
