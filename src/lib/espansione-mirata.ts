import { createAnthropicClient, modelloAttivo, operazionePerRegistro } from "@/lib/anthropic";
import { logAiUsage } from "@/lib/ai-usage";
import { dividiInBlocchi, unisciBlocchi } from "@/lib/budget-blocchi";
import { confrontaSubCriteri, estraiRequisitiDaCriteri, type ConfrontoSubCriterio, type RequisitoDisciplinare } from "@/lib/confronto-tagli";
import { REGOLE_OMNIA, ISTRUZIONI_ESPANSIONE_MIRATA } from "@/lib/prompts";
import { ripristinaDaTestoVerificato } from "@/lib/ripristino-verificato";
import { trovaBudgetSottoCriterio, type BudgetGara } from "@/lib/sotto-criteri";
import { stimaPagineContenuto } from "@/lib/stima-pagine";
import { mascheraOrganigrammi, organigrammiInvariati, ripristinaOrganigrammi } from "@/lib/organigramma-dati";

// Espansione di UN sotto-criterio alla volta quando occupa molto meno del
// proprio tetto di pagine (ripartito in proporzione ai punti). Verificato con
// il modello vero: con il solo vincolo di lunghezza nel prompt di
// generazione le bozze si fermano al 60-75% del tetto, e un'istruzione
// "riempi il tetto" nello stesso prompt non lo cambia (lo peggiora). Il
// vecchio passaggio "espandi" per criterio portava il testo a 1000-1280
// parole su un tetto di 1190: questo è il suo equivalente per
// sotto-criterio, con le garanzie della compressione mirata a rovescio.
//
// L'espansione AGGIUNGE testo, quindi il rischio è l'opposto della
// compressione: dati d'impresa o riferimenti inventati. Il testo ampliato è
// accettato solo se, confrontato con quello di partenza (controllo
// deterministico, nessun modello):
//  - non contiene numeri, riferimenti normativi o di capitolato nuovi;
//  - non perde numeri, riferimenti, asterischi di conferma, tabelle,
//    riquadri o figure;
//  - conserva almeno il 90% delle parole di partenza (non una riscrittura);
//  - cresce davvero (almeno l'8%) e resta entro il tetto vero (+8%, meno
//    della tolleranza del 10% con cui la compressione lascia un blocco com'è).
// Se viola uno di questi punti si riprova una volta con l'elenco dei
// problemi; se viola ancora, il blocco resta com'è. L'espansione avviene
// PRIMA della verifica dati (generaBozzaSezione): ciò che aggiunge passa
// anche dal controllo sul profilo aziendale, come il vecchio "espandi".
//
// La funzione che chiama il modello è iniettabile (FunzioneEspansione): i
// test la sostituiscono con un modello finto e provano tutta la logica di
// garanzia senza spendere nulla.

export type RichiestaEspansione = {
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

export type FunzioneEspansione = (richiesta: RichiestaEspansione) => Promise<string | null>;

// Sotto questa soglia (pagine del blocco / pagine del tetto) il blocco si
// espande; sopra, lo scarto non vale il costo di una chiamata.
export const SOGLIA_ESPANSIONE_BLOCCO = 0.8;
// Obiettivo dell'espansione, in quota del tetto: un margine sotto il tetto
// perché il modello tende a superare il numero richiesto.
export const OBIETTIVO_ESPANSIONE = 0.97;
const CRESCITA_MINIMA = 1.08;
// Il modello conta male le pagine (verificato: chiesto di fermarsi a 0,64
// arriva a 0,69-0,87): il limite di accettazione è il TETTO vero più questa
// tolleranza, non l'obiettivo che gli si chiede di raggiungere.
export const TOLLERANZA_TETTO_ESPANSIONE = 1.08;
const QUOTA_PAROLE_CONSERVATE = 0.9;
const PAROLE_MINIME_BLOCCO = 60;
export const MAX_CHIAMATE_ESPANSIONE = 12;

function fmt(n: number, cifre = 1): string {
  return n.toFixed(cifre).replace(".", ",");
}

export function costruisciIstruzioniEspansione(r: RichiestaEspansione): string {
  const punti = r.sotto?.punti;
  const quota = punti && r.punteggioTecnico ? Math.round((punti / r.punteggioTecnico) * 100) : null;
  const paroleDaAggiungere = Math.round(Math.max(0, r.pagineTarget - r.paginePrima) * r.paroleXPagina);
  const correzioni = r.correzioni?.length
    ? `\nATTENZIONE — il tentativo precedente è stato scartato dal controllo automatico. Correggi questi punti nel testo che ti viene consegnato:\n${r.correzioni.map((c) => `- ${c}`).join("\n")}\n`
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
    N: String(paroleDaAggiungere),
    CORREZIONI: correzioni,
  };
  return ISTRUZIONI_ESPANSIONE_MIRATA.replace(/\{([A-Z_]+)\}/g, (tutto, nome: string) => (nome in valori ? valori[nome] : tutto));
}

// Modello reale. Ritorna null se la chiamata fallisce o la risposta è
// troncata: meglio tenere il blocco com'è che sostituirlo con metà testo.
export const espandiConModello: FunzioneEspansione = async (richiesta) => {
  const anthropic = createAnthropicClient();
  const model = modelloAttivo();
  const parole = Math.max(richiesta.testo.split(/\s+/).filter(Boolean).length, richiesta.pagineTarget * richiesta.paroleXPagina);
  const maxTokens = Math.min(32000, Math.max(4000, Math.ceil(parole * 1.4 * 4)));

  try {
    const stream = anthropic.messages.stream({
      model,
      max_tokens: maxTokens,
      thinking: { type: "disabled" },
      system: `Amplia un sotto-criterio di un'offerta tecnica per una gara d'appalto SENZA introdurre dati nuovi. Il testo ampliato deve continuare a rispettare le regole di scrittura del documento:\n\n=== REGOLE DI SCRITTURA OMNIA ===\n${REGOLE_OMNIA}\n=== FINE REGOLE DI SCRITTURA OMNIA ===`,
      messages: [{ role: "user", content: `${costruisciIstruzioniEspansione(richiesta)}\n\nTESTO DA AMPLIARE:\n\n${richiesta.testo}` }],
    });
    const response = await stream.finalMessage();

    await logAiUsage({
      userId: richiesta.context.userId,
      garaId: richiesta.context.garaId,
      operazione: operazionePerRegistro("espansione_mirata"),
      provider: "anthropic",
      model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });

    if (response.stop_reason === "max_tokens") {
      console.warn(`espandiConModello: risposta troncata per max_tokens su ${richiesta.chiave}, blocco lasciato com'è.`);
      return null;
    }
    const testo = response.content.map((b) => (b.type === "text" ? b.text : "")).join("\n").trim();
    return testo || null;
  } catch (err) {
    console.error(`espandiConModello: errore su ${richiesta.chiave}:`, err);
    return null;
  }
};

function tokens(testo: string): Map<string, number> {
  const mappa = new Map<string, number>();
  const parole = testo
    .toLowerCase()
    .replace(/\[(?:RIGA|CELLA|TABELLA|ICONA|BOX)[^\]]*\]|\[\/?BOX\]|\[(?:C|G)\]/gi, " ")
    .split(/[^a-zà-ÿ0-9]+/)
    .filter(Boolean);
  for (const p of parole) mappa.set(p, (mappa.get(p) ?? 0) + 1);
  return mappa;
}

// Quota delle parole di partenza ancora presenti (come multiinsieme): un
// ampliamento che aggiunge attorno e dentro le conserva quasi tutte, una
// riscrittura no.
export function quotaParoleConservate(prima: string, dopo: string): number {
  const p = tokens(prima);
  const d = tokens(dopo);
  let totale = 0;
  let conservate = 0;
  for (const [parola, n] of p) {
    totale += n;
    conservate += Math.min(n, d.get(parola) ?? 0);
  }
  return totale === 0 ? 1 : conservate / totale;
}

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

export function violazioniEspansione(
  c: ConfrontoSubCriterio,
  extra: { paroleConservate: number; pagineMassime: number },
): string[] {
  const v: string[] = [];
  if (!c.presenteDopo) {
    return [`Il testo ampliato non contiene più il titolo "## ${c.chiave}" del sotto-criterio.`];
  }
  if (c.numeriNuovi.length > 0) {
    v.push(`Hai introdotto numeri che non erano nel testo di partenza (${c.numeriNuovi.join(", ")}): non aggiungere dati, descrivi a parole ciò che il testo già dice.`);
  }
  if (c.riferimentiNuovi.length > 0) {
    v.push(`Hai introdotto riferimenti al capitolato/norme che non erano nel testo di partenza: ${c.riferimentiNuovi.join("; ")}.`);
  }
  if (c.numeriPersi.length > 0) v.push(`Sono spariti dei numeri del testo di partenza: ${c.numeriPersi.map((n) => n.numero).join(", ")}.`);
  if (c.riferimentiPersi.length > 0) v.push(`Sono spariti riferimenti che vanno conservati: ${c.riferimentiPersi.join("; ")}.`);
  if (c.marcatoriRimossi.length > 0) v.push(`Questi valori erano marcati con asterisco e ora compaiono senza: ${c.marcatoriRimossi.join("; ")}.`);
  const s = c.struttura;
  if (s.dopo.tabelle < s.prima.tabelle || c.righeTabellaPerse.length > 0) v.push("Sono sparite tabelle o righe di tabella: tutto ciò che c'era resta.");
  if (s.dopo.box < s.prima.box) v.push("Sono spariti dei riquadri [BOX]: tutto ciò che c'era resta.");
  if (s.dopo.organigrammi < s.prima.organigrammi) v.push("La figura [ORGANIGRAMMA] è sparita.");
  if (extra.paroleConservate < QUOTA_PAROLE_CONSERVATE) {
    v.push(`Hai riscritto il testo di partenza (ne resta il ${Math.round(extra.paroleConservate * 100)}% delle parole): non toccare ciò che c'è, aggiungi attorno e dentro.`);
  }
  if (c.paroleInizio > 0 && c.paroleFine < c.paroleInizio * CRESCITA_MINIMA) {
    v.push(`Il testo è cresciuto di troppo poco (${c.paroleInizio} → ${c.paroleFine} parole): aggiungi ciò che è richiesto sopra, oppure lascia com'è.`);
  }
  if (c.pagineDopo > extra.pagineMassime) {
    v.push(`Il testo occupa ${fmt(c.pagineDopo, 2)} pagine e supera il tetto: deve restare entro ${fmt(extra.pagineMassime, 2)}. Aggiungi MENO (circa la metà di quanto hai aggiunto).`);
  }
  return v;
}

export type EsitoEspansione = {
  chiave: string;
  testo: string;
  esito: "espanso" | "rifiutato" | "non_eseguito";
  motivo?: string;
  // Motivi per cui i tentativi precedenti sono stati scartati (anche se poi
  // un tentativo è andato bene): serve a capire dai log cosa sbaglia il modello.
  scartati?: string[];
  tentativi: number;
  paginePrima: number;
  pagineDopo: number;
};

export async function espandiBloccoConGaranzie(params: {
  chiave: string;
  titoloBlocco: string;
  blocco: string;
  pagineTarget: number;
  // Oltre queste pagine l'ampliamento è rifiutato (default: obiettivo + tolleranza).
  pagineMassime?: number;
  sotto?: { titolo: string; requisito: string; punti: number };
  punteggioTecnico?: number;
  requisito?: RequisitoDisciplinare;
  paroleXPagina: number;
  formattazione: { dimensioneCarattere?: number; interlinea?: number };
  context: { userId: string | null; garaId: string | null };
  espandi?: FunzioneEspansione;
  maxTentativi?: number;
}): Promise<EsitoEspansione> {
  const { chiave, titoloBlocco, blocco, pagineTarget, sotto, punteggioTecnico, requisito, paroleXPagina, formattazione, context } = params;
  const pagineMassime = params.pagineMassime ?? pagineTarget * TOLLERANZA_TETTO_ESPANSIONE;
  const scartati: string[] = [];
  const espandi = params.espandi ?? espandiConModello;
  const maxTentativi = params.maxTentativi ?? 2;
  const paginePrima = stimaPagineContenuto(blocco, formattazione);

  let correzioni: string[] = [];
  let ultimoMotivo = "";
  let tentativi = 0;
  let testoDaAmpliare = blocco;

  for (let t = 1; t <= maxTentativi; t++) {
    tentativi = t;
    // L'organigramma strutturato non va al modello (vedi mascheraOrganigrammi).
    const mascherato = mascheraOrganigrammi(testoDaAmpliare);
    const rispostaGrezza = await espandi({ chiave, titoloBlocco, testo: mascherato.testo, paginePrima: stimaPagineContenuto(testoDaAmpliare, formattazione), pagineTarget, paroleXPagina, sotto, punteggioTecnico, correzioni, context });
    if (!rispostaGrezza) {
      return { chiave, testo: blocco, esito: "non_eseguito", motivo: "nessuna risposta utilizzabile dal modello (errore o risposta troncata)", tentativi, paginePrima, pagineDopo: paginePrima };
    }

    const normalizzato = normalizzaBlocco(blocco, ripristinaOrganigrammi(rispostaGrezza, mascherato.blocchi), chiave);
    // Asterischi di conferma e citazioni che il modello avesse tolto: si
    // rimettono dal testo di partenza (nessun contenuto nuovo).
    const candidato = ripristinaDaTestoVerificato(blocco, normalizzato).testo;

    const confronto = confrontaSubCriteri(
      [{ titolo_sezione: titoloBlocco, contenuto: blocco }],
      [{ titolo_sezione: titoloBlocco, contenuto: candidato }],
      formattazione,
      requisito ? [requisito] : [],
    ).find((c) => c.chiave.toLowerCase() === chiave.toLowerCase());

    const violazioni = confronto
      ? violazioniEspansione(confronto, { paroleConservate: quotaParoleConservate(blocco, candidato), pagineMassime })
      : ["Impossibile confrontare il testo ampliato con l'originale."];
    if (!organigrammiInvariati(blocco, candidato)) violazioni.push("Il blocco [ORGANIGRAMMA] è stato modificato: i suoi dati vanno lasciati IDENTICI, carattere per carattere.");

    if (violazioni.length === 0) {
      return { chiave, testo: candidato, esito: "espanso", scartati, tentativi, paginePrima, pagineDopo: stimaPagineContenuto(candidato, formattazione) };
    }
    ultimoMotivo = violazioni.join(" | ");
    scartati.push(ultimoMotivo);
    correzioni = violazioni;
    testoDaAmpliare = blocco; // si riparte sempre dal testo originale: un tentativo scartato non fa da base
  }

  return { chiave, testo: blocco, esito: "rifiutato", motivo: ultimoMotivo, scartati, tentativi, paginePrima, pagineDopo: paginePrima };
}

// Espande, in parallelo, i blocchi di UNA sezione che occupano meno
// dell'80% del proprio tetto. I sotto-criteri tabellari, i blocchi senza
// chiave (testo prima del primo "##") e quelli troppo brevi non si toccano.
export async function espandiSezioneSottoTetto(params: {
  titoloSezione: string;
  contenuto: string;
  budget: BudgetGara;
  criteriValutazione: string | null | undefined;
  punteggioTecnico?: number;
  formattazione: { dimensioneCarattere?: number; interlinea?: number };
  context: { userId: string | null; garaId: string | null };
  espandi?: FunzioneEspansione;
  maxChiamate?: number;
}): Promise<{ contenuto: string; esiti: EsitoEspansione[] }> {
  const { titoloSezione, contenuto, budget, criteriValutazione, punteggioTecnico, formattazione, context } = params;
  const base = params.espandi ?? espandiConModello;
  const chiamate = { usate: 0, max: params.maxChiamate ?? MAX_CHIAMATE_ESPANSIONE };
  const limitata: FunzioneEspansione = async (richiesta) => {
    if (chiamate.usate >= chiamate.max) return null;
    chiamate.usate++;
    return base(richiesta);
  };
  const requisiti = estraiRequisitiDaCriteri(criteriValutazione ?? "");

  const blocchi = dividiInBlocchi(contenuto);
  const esiti: EsitoEspansione[] = [];

  await Promise.all(
    blocchi.map(async (blocco, i) => {
      if (!blocco.chiave) return;
      const sotto = trovaBudgetSottoCriterio(budget, blocco.chiave);
      if (!sotto || sotto.tabellare) return;
      if (/CRITERIO TABELLARE/i.test(blocco.testo)) return;
      if (blocco.testo.split(/\s+/).filter(Boolean).length < PAROLE_MINIME_BLOCCO) return;
      const pagine = stimaPagineContenuto(blocco.testo, formattazione);
      if (pagine >= sotto.paginePreviste * SOGLIA_ESPANSIONE_BLOCCO) return;

      const esito = await espandiBloccoConGaranzie({
        chiave: blocco.chiave,
        titoloBlocco: titoloSezione,
        blocco: blocco.testo,
        pagineTarget: sotto.paginePreviste * OBIETTIVO_ESPANSIONE,
        pagineMassime: sotto.paginePreviste * TOLLERANZA_TETTO_ESPANSIONE,
        sotto: { titolo: sotto.titolo, requisito: sotto.requisito, punti: sotto.punti },
        punteggioTecnico,
        requisito: requisiti.find((r) => r.chiave.toLowerCase() === blocco.chiave!.toLowerCase()),
        paroleXPagina: budget.paroleProsaPerPagina,
        formattazione,
        context,
        espandi: limitata,
      });
      esiti.push(esito);
      if (esito.esito === "espanso") blocchi[i] = { ...blocco, testo: esito.testo };
    }),
  );

  esiti.sort((a, b) => a.chiave.localeCompare(b.chiave, undefined, { numeric: true }));
  return { contenuto: unisciBlocchi(blocchi), esiti };
}

export function riepilogoEsitiEspansione(esiti: EsitoEspansione[]): string[] {
  return esiti.map((e) =>
    e.esito === "espanso"
      ? `[espansione] ${e.chiave}: ${fmt(e.paginePrima, 2)} → ${fmt(e.pagineDopo, 2)} pagine (tentativi ${e.tentativi}${e.scartati?.length ? `; scartato: ${e.scartati.join(" // ")}` : ""})`
      : `[espansione] ${e.chiave}: ${e.esito === "rifiutato" ? "RIFIUTATA" : "non eseguita"} — ${e.motivo}`,
  );
}
