import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAnthropicClient } from "@/lib/anthropic";
import { buildDocxBuffer, rimuoviTitoloRidondante } from "@/lib/docx-generator";
import { sanitizeFileName } from "@/lib/document-text";
import { ricavaStileOrganigramma } from "@/lib/org-chart-style";
import { recuperaLoghiOrganigramma } from "@/lib/org-chart-loghi";
import { stimaPagineContenuto } from "@/lib/stima-pagine";

const CONTIENE_ORGANIGRAMMA = /\[ORGANIGRAMMA\]/i;

const TITOLO_DEFAULT = "Relazione Tecnica";
const MODEL = "claude-sonnet-5";
// Sotto questa quota del target di pagine calcolato per il criterio (in
// pagine REALI stimate, non parole — vedi stima-pagine.ts: un conteggio a
// parole ignora quanto spazio occupano tabelle/immagini, causa di uno
// sforamento osservato in pratica da 40 a 55+ pagine), la sezione viene
// espansa automaticamente componendo la relazione finale; sopra, la
// differenza è considerata trascurabile. Tenuta alta (non un generico
// "abbastanza vicino") perché il cliente si aspetta di usare il limite
// di pagine del disciplinare quasi per intero (scostamento massimo
// tollerato: 1-2 pagine su 40, non 5).
const SOGLIA_ESPANSIONE = 0.92;
// Sopra questa quota del target, la sezione viene condensata: simmetrico
// alla soglia di espansione, con un margine leggermente più ampio (il
// tetto già imposto a chi genera/espande è pagine*1.05, quindi non ha
// senso condensare per uno scarto minore di quello già tollerato altrove).
const SOGLIA_RIDUZIONE = 1.1;

type CriterioRiepilogo = { numero: string; titolo: string; punti_max: number };

export type SezioneEsistente = {
  ordine: number;
  titolo_sezione: string;
  paroleStimate: number;
};

// Elenco delle sezioni già elaborate per una gara, mostrato all'AI come
// contesto informativo (per non trattare da capo un argomento già
// coperto, e per stimare quante pagine del limite totale sono già state
// usate dalle bozze precedenti quando decide quanto spazio dedicare alla
// prossima) — non serve più per decidere "sostituire o no": ogni
// elaborazione crea sempre una sua bozza a sé, la fusione avviene solo
// al comando esplicito "componi la relazione finale".
export async function elencoSezioniEsistenti(garaId: string): Promise<SezioneEsistente[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("gara_relazione_sezioni")
    .select("ordine, titolo_sezione, contenuto")
    .eq("gara_id", garaId)
    .order("ordine", { ascending: true })
    .returns<{ ordine: number; titolo_sezione: string; contenuto: string }[]>();

  return (data ?? []).map((s) => ({
    ordine: s.ordine,
    titolo_sezione: s.titolo_sezione,
    paroleStimate: s.contenuto.split(/\s+/).filter(Boolean).length,
  }));
}

type FormattazioneGara = {
  relazione_titolo: string | null;
  relazione_font: string | null;
  relazione_dimensione_carattere: number | null;
  relazione_interlinea: number | null;
};

// Font/dimensione/interlinea sono una proprietà della gara (dettata dal
// disciplinare), non della singola bozza: si fissano alla prima
// generazione e da lì si riusano sempre, anche per le bozze singole,
// altrimenti si perdono ad ogni nuovo messaggio.
async function formattazioneGara(
  garaId: string,
  proposta: { titoloRelazione?: string; font?: string; dimensioneCarattere?: number; interlinea?: number },
): Promise<{ titolo: string; font?: string; dimensioneCarattere?: number; interlinea?: number }> {
  const supabase = await createClient();

  const { data: garaRow } = await supabase
    .from("gare")
    .select(
      "relazione_titolo, relazione_font, relazione_dimensione_carattere, relazione_interlinea",
    )
    .eq("id", garaId)
    .single<FormattazioneGara>();

  const titolo = garaRow?.relazione_titolo ?? proposta.titoloRelazione ?? TITOLO_DEFAULT;
  const font = garaRow?.relazione_font ?? proposta.font ?? undefined;
  const dimensioneCarattere =
    garaRow?.relazione_dimensione_carattere ?? proposta.dimensioneCarattere ?? undefined;
  const interlinea = garaRow?.relazione_interlinea ?? proposta.interlinea ?? undefined;

  if (!garaRow?.relazione_titolo) {
    await supabase
      .from("gare")
      .update({
        relazione_titolo: titolo,
        relazione_font: font ?? null,
        relazione_dimensione_carattere: dimensioneCarattere ?? null,
        relazione_interlinea: interlinea ?? null,
      })
      .eq("id", garaId);
  }

  return { titolo, font, dimensioneCarattere, interlinea };
}

async function caricaDocumento(
  garaId: string,
  nomeFile: string,
  buffer: Buffer,
): Promise<{ nomeFile: string; filePath: string }> {
  const filePath = `${garaId}/${Date.now()}-${sanitizeFileName(nomeFile)}`;
  const admin = createAdminClient();

  const { error: uploadError } = await admin.storage.from("gare").upload(filePath, buffer, {
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    upsert: false,
  });

  if (uploadError) {
    throw new Error(`Errore nel salvataggio del documento: ${uploadError.message}`);
  }

  return { nomeFile, filePath };
}

// Genera la bozza di UNA sezione/criterio come documento Word a sé
// stante (niente fusione automatica con le altre sezioni: ogni
// elaborazione produce un file pulito e indipendente, senza rischio di
// duplicare contenuto in un unico documento che cresce). La sezione
// viene comunque salvata come riga a sé in gara_relazione_sezioni, così
// "componi la relazione finale" può poi assemblarle tutte.
export async function generaBozzaSezione(params: {
  garaId: string;
  userId: string;
  titoloSezione: string;
  contenuto: string;
  titoloRelazione?: string;
  font?: string;
  dimensioneCarattere?: number;
  interlinea?: number;
}): Promise<{ nomeFile: string; filePath: string }> {
  const { garaId, userId, titoloSezione, contenuto, titoloRelazione, font, dimensioneCarattere, interlinea } =
    params;

  const supabase = await createClient();

  const fmt = await formattazioneGara(garaId, { titoloRelazione, font, dimensioneCarattere, interlinea });

  const { data: ultima } = await supabase
    .from("gara_relazione_sezioni")
    .select("ordine")
    .eq("gara_id", garaId)
    .order("ordine", { ascending: false })
    .limit(1)
    .maybeSingle<{ ordine: number }>();

  await supabase.from("gara_relazione_sezioni").insert({
    gara_id: garaId,
    user_id: userId,
    titolo_sezione: titoloSezione,
    contenuto,
    ordine: (ultima?.ordine ?? 0) + 1,
  });

  const contieneOrganigramma = CONTIENE_ORGANIGRAMMA.test(contenuto);
  const [stileOrganigramma, loghiOrganigramma] = contieneOrganigramma
    ? await Promise.all([ricavaStileOrganigramma(), recuperaLoghiOrganigramma(garaId)])
    : [null, undefined];

  const buffer = await buildDocxBuffer(
    titoloSezione,
    contenuto,
    { font: fmt.font, dimensioneCarattere: fmt.dimensioneCarattere, interlinea: fmt.interlinea },
    stileOrganigramma ?? undefined,
    loghiOrganigramma,
  );

  return caricaDocumento(garaId, `${titoloSezione}.docx`, buffer);
}

// Rimuove un eventuale prefisso numerico/alfabetico iniziale del titolo
// ("A.", "1.", "3)") per confrontare solo l'argomento vero e proprio:
// lo stesso criterio viene spesso rigenerato più volte durante la
// conversazione con una numerazione leggermente diversa ogni volta (es.
// "A. Proposta tecnico-organizzativa..." poi "1. Proposta
// tecnico-organizzativa..."), e un confronto sul titolo letterale non le
// riconoscerebbe come lo stesso argomento.
function normalizzaTitoloSezione(titolo: string): string {
  return titolo
    .replace(/^\s*[A-Za-z0-9]+[.)]\s*/, "")
    .trim()
    .toLowerCase();
}

// Estrae SOLO il numero del criterio di primo livello ("1" sia da "1.
// Proposta..." sia da "1.1 Modello.../1.2 Struttura..."): non richiede un
// separatore ". " subito dopo — un numero composto tipo "1.1" viene
// comunque riconosciuto come criterio "1". Serve per il deduplicamento
// delle bozze: quando l'AI divide un criterio in invii separati con
// titoli diversi (es. perché pensava di aver raggiunto un limite di
// lunghezza dello strumento — problema osservato prima di correggere il
// vero limite di token), un confronto sul titolo letterale/normalizzato
// non riconoscerebbe che si tratta dello stesso criterio, causando
// duplicati nella relazione finale.
function estraiNumeroCriterioTopLevel(titolo: string): string | null {
  const match = titolo.trim().match(/^([A-Za-z]?\d+)/);
  return match ? match[1].toLowerCase() : null;
}

// Raggruppa le bozze di sezione che trattano lo stesso criterio e tiene,
// per ciascun gruppo, solo la più recente (ordine più alto) — mantenendo
// l'ordine di PRIMA comparsa del gruppo per l'ordine finale nel documento
// (non quello dell'ultima rielaborazione). Due bozze finiscono nello
// stesso gruppo se condividono lo stesso numero di criterio di primo
// livello OPPURE lo stesso titolo normalizzato: nessuno dei due segnali
// da solo basta in ogni caso reale osservato — un titolo "A. Proposta
// tecnico-organizzativa..." rinumerato "1. Proposta
// tecnico-organizzativa..." in una rielaborazione successiva ha lo
// stesso titolo normalizzato ma numero diverso ("a" vs "1", non
// confrontabili); un criterio diviso in invii separati con titoli
// completamente diversi ("1. Proposta..." vs "1.1 Modello.../1.2
// Struttura...") ha lo stesso numero ma titoli normalizzati diversi. Un
// confronto su una sola chiave, in entrambi i casi, lascia il duplicato
// nella relazione finale (bug osservato in pratica su entrambe le
// varianti). Unendo i gruppi quando UNO qualsiasi dei due segnali
// coincide (unione, non intersezione) si coprono entrambi i casi.
function raggruppaEDeduplicaSezioni<T extends { ordine: number; titolo_sezione: string }>(
  sezioni: T[],
): T[] {
  const n = sezioni.length;
  const capostipite = Array.from({ length: n }, (_, i) => i);
  function trova(i: number): number {
    while (capostipite[i] !== i) {
      capostipite[i] = capostipite[capostipite[i]];
      i = capostipite[i];
    }
    return i;
  }
  function unisci(i: number, j: number): void {
    const ri = trova(i);
    const rj = trova(j);
    if (ri !== rj) capostipite[ri] = rj;
  }

  const numeri = sezioni.map((s) => estraiNumeroCriterioTopLevel(s.titolo_sezione));
  const titoli = sezioni.map((s) => normalizzaTitoloSezione(s.titolo_sezione));

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const stessoNumero = numeri[i] !== null && numeri[i] === numeri[j];
      const stessoTitolo = titoli[i].length > 0 && titoli[i] === titoli[j];
      if (stessoNumero || stessoTitolo) unisci(i, j);
    }
  }

  const migliorePerGruppo = new Map<number, T>();
  const primaComparsaPerGruppo = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const radice = trova(i);
    if (!primaComparsaPerGruppo.has(radice)) primaComparsaPerGruppo.set(radice, i);
    const esistente = migliorePerGruppo.get(radice);
    if (!esistente || sezioni[i].ordine > esistente.ordine) {
      migliorePerGruppo.set(radice, sezioni[i]);
    }
  }

  return Array.from(primaComparsaPerGruppo.entries())
    .sort((a, b) => a[1] - b[1])
    .map(([radice]) => migliorePerGruppo.get(radice) as T);
}

// Sostituzione deterministica dei segnaposto di anonimizzazione che l'AI
// a volte copia letteralmente dall'Archivio Stile OMNIA (testo di
// riferimento anonimizzato) nel documento del cliente — es. "[Operatore
// Economico] garantisce la tecnica del vapore saturo secco..." nel
// documento di un cliente che non si chiama così. Sostituzione
// deterministica, non un'ennesima istruzione al modello (stesso motivo di
// applicaMarcatoriTabellari): un segnaposto letterale in un documento
// consegnato al cliente è un errore grave indipendentemente da quante
// volte gli si chieda di non farlo. Usata sia dalla generazione dal vivo
// in chat sia da componiRelazioneFinale — vedi
// applicaSostituzioniAnonimizzazione più sotto per il motivo per cui
// serve riapplicarla anche lì.
export function rimuoviPlaceholderAnonimizzazione(contenuto: string, nomeAzienda: string | null | undefined): string {
  // "[Operatore Economico]" è l'unico segnaposto che indica il
  // concorrente/l'azienda che presenta l'offerta — va sostituito con
  // l'azienda REALE del cliente, mai con un termine generico se
  // disponibile. Gli altri indicano ruoli diversi (l'ente appaltante, un
  // software, un referente generico) e sostituirli con l'azienda del
  // cliente sarebbe un errore altrettanto grave del segnaposto letterale
  // (es. "[Committente]" è chi INDICE la gara, non chi la vince).
  const sostituzioni: [string, string][] = [
    ["[Operatore Economico]", nomeAzienda?.trim() || "l'operatore economico"],
    ["[Committente]", "la Stazione Appaltante"],
    ["[Piattaforma Gestionale]", "il sistema gestionale aziendale"],
    ["[Ente]", "l'ente di riferimento"],
  ];
  let risultato = contenuto;
  for (const [segnaposto, sostituto] of sostituzioni) {
    risultato = risultato.split(segnaposto).join(sostituto);
  }
  // "[Referente N]" ha un numero variabile
  risultato = risultato.replace(/\[Referente\s*\d*\]/gi, "il referente");
  return risultato;
}

// L'istruzione nel prompt (usa il nome reale dell'azienda invece della
// dicitura burocratica generica) si è dimostrata inaffidabile in pratica
// — stesso motivo delle altre sostituzioni deterministiche in questo
// file: l'AI continuava a scrivere "l'operatore economico si impegna a…"
// invece di "MARIO ROSSI SRL si impegna a…" anche con l'istruzione
// esplicita. Sostituisce solo le forme SINGOLARI ("l'operatore
// economico", "il concorrente"): le forme plurali ("gli operatori
// economici", "i concorrenti") restano intatte perché si riferiscono
// tipicamente a TUTTI i partecipanti alla gara in generale (citazione/
// parafrasi di un requisito del disciplinare), non all'azienda cliente
// specifica — sostituirle darebbe un'affermazione falsa, non solo
// stilisticamente diversa.
const PATTERN_OPERATORE_SINGOLARE = /\b(?:l'|il )(?:operatore economico|concorrente)\b/gi;
export function sostituisciOperatoreEconomicoGenerico(contenuto: string, nomeAzienda: string | null | undefined): string {
  if (!nomeAzienda?.trim()) return contenuto;
  return contenuto.replace(PATTERN_OPERATORE_SINGOLARE, nomeAzienda.trim());
}

// Punto unico che applica ENTRAMBE le sostituzioni sopra, nell'ordine
// corretto (i placeholder tra parentesi quadre prima, le forme generiche
// senza parentesi dopo — indipendenti tra loro, ma tenerle insieme evita
// di dimenticarne una nei punti in cui va riapplicata: sia dopo la prima
// generazione sia dopo correggiSezioneVersoTarget, che non sa nulla di
// anonimizzazione e può reintrodurre "l'operatore economico" quando
// riscrive/espande il testo — stesso bug già visto con i marcatori
// tabellari.
export function applicaSostituzioniAnonimizzazione(contenuto: string, nomeAzienda: string | null | undefined): string {
  return sostituisciOperatoreEconomicoGenerico(rimuoviPlaceholderAnonimizzazione(contenuto, nomeAzienda), nomeAzienda);
}

// Sostituzione DETERMINISTICA (non un'ennesima istruzione al modello) del
// corpo dei sub-criteri tabellari con la dicitura segnaposto: verificato
// in pratica che l'istruzione nel prompt, per quanto ripetuta e vicina al
// punto in cui il modello scrive il contenuto, non viene rispettata in
// modo affidabile — un sub-criterio nell'elenco continuava a essere
// scritto per esteso a ogni rigenerazione. Qui non si chiede più
// all'AI di comportarsi bene: si riscrive il suo output dopo il fatto,
// una garanzia indipendente da cosa produce il modello. Usata sia dalla
// generazione dal vivo in chat sia da "componi relazione finale" (il cui
// passaggio automatico di espansione/condensazione, non sapendo nulla
// dei marcatori tabellari, può riscriverli come testo normale — bug
// osservato in pratica: un criterio con marcatori corretti nell'ultima
// bozza tornava descrittivo dopo la composizione finale).
export function applicaMarcatoriTabellari(contenuto: string, subCriteriTabellari: string[] | null): string {
  if (!subCriteriTabellari?.length) return contenuto;
  const tabellari = new Set(subCriteriTabellari.map((s) => s.trim().toLowerCase()));

  // Un blocco "## " = un sub-criterio, con tutto ciò che segue (incluse
  // eventuali sotto-sezioni "### ") fino al prossimo "## "/"# ": se il
  // suo numero è nell'elenco, il corpo intero viene sostituito, titolo
  // escluso.
  const blocchi = contenuto.split(/\n(?=##\s)/);
  const blocchiCorretti = blocchi.map((blocco) => {
    const match = blocco.match(/^##\s+([A-Za-z]?\d+(?:\.\d+)*)\b/);
    if (!match) return blocco;
    const numero = match[1].trim().toLowerCase();
    if (!tabellari.has(numero)) return blocco;
    const primaRiga = blocco.split("\n", 1)[0];
    return `${primaRiga}\n\nCRITERIO TABELLARE - COMPILARE`;
  });
  return blocchiCorretti.join("\n\n");
}

// Regole di formattazione ripetute qui (versione condensata di quelle
// date al modello in gara-chat.ts quando genera una sezione da zero):
// senza queste, una chiamata isolata come questa non ha alcun contesto
// sulle convenzioni OMNIA e produce testo discorsivo piatto — bug
// osservato in pratica: contenuto espanso corretto nella sostanza ma
// senza tabelle, colori, grassetti o evidenziazioni, molto diverso dallo
// stile denso e visivamente strutturato del resto del documento.
const ISTRUZIONI_FORMATTAZIONE_ESPANSIONE = `Stai espandendo una sezione di un'offerta tecnica per una gara d'appalto. Applica SEMPRE queste convenzioni di formattazione OMNIA, con la stessa densità del resto del documento (quasi ogni paragrafo ha almeno un termine in grassetto o un ruolo colorato: un paragrafo tecnico senza nessuna evidenziazione è un errore):
- '**testo**' per termini tecnici chiave, definizioni, risultati/numeri rilevanti, riferimenti normativi (es. '**UNI EN ISO 14001**', '**art. 108 comma 7 del D.Lgs. 36/2023**').
- '!!testo!!' per nomi di ruoli/figure professionali/uffici/enti quando compaiono nel testo (es. '!!Responsabile di Commessa!!', '!!Ispettore Qualità!!').
- Tabelle in sintassi markdown ('| colonna | colonna |' seguita da '|---|---|') per qualunque dato tabulare per natura (livelli di controllo, frequenze, certificazioni, KPI, ruoli e responsabilità, confronti): se il contenuto che aggiungi si presta a una tabella e il testo esistente non ne ha già una sull'argomento, AGGIUNGILA, non scriverlo come prosa. Colore intestazione con '[TABELLA:BLU|ROSSA|VERDE|ARANCIONE]' subito sopra (BLU default). Dentro ogni cella, SEMPRE un tag di allineamento a inizio testo ('[C]' per valori brevi/numerici/etichette, '[G]' per testo descrittivo) insieme al grassetto dove pertinente (es. '[C]**ISO 14001**').
- '[ICONA:nome]' (pulizia, sicurezza, formazione, ambiente, certificazione, qualita, tempistiche, personale, comunicazione, monitoraggio, logistica, attrezzature, documentazione) a inizio riga di tabella/elenco puntato dove aggiunge chiarezza visiva.
- '[BOX]testo[/BOX]' per un obbligo normativo, una garanzia o un impegno chiave che merita risalto.
- Non annidare mai '!!...!!' o '[ICONA:...]' dentro '**...**'.`;

// Conta le tabelle markdown presenti nel testo (una riga separatore
// "|---|---|" per tabella): usata per capire se una sezione è priva di
// tabelle nonostante sia già alla lunghezza giusta — un caso che il solo
// controllo sulla lunghezza non intercetta.
function contaTabelle(testo: string): number {
  return (testo.match(/^\s*\|[-:\s|]+\|\s*$/gm) || []).length;
}

// Espande e/o rifinisce la formattazione di UNA sezione già generata, in
// una chiamata isolata e di dimensione contenuta — mai l'intero
// documento finale in un colpo solo, che è esattamente ciò che causava
// il troncamento a metà criterio risolto sopra. Ritorna null se la
// chiamata fallisce o risulta troncata: meglio tenere la versione
// originale, più corta ma certamente completa, che sostituirla con un
// testo a metà.
type AzioneSezione = "espandi" | "condensa" | "formatta";

async function espandiContenutoSezione(
  titoloSezione: string,
  contenutoAttuale: string,
  pagineTarget: number,
  azione: AzioneSezione,
  formattazione: { dimensioneCarattere?: number; interlinea?: number },
): Promise<string | null> {
  const anthropic = createAnthropicClient();
  const paroleAttuali = contenutoAttuale.split(/\s+/).filter(Boolean).length;
  // Pagine REALI stimate (non parole — vedi stima-pagine.ts), le uniche
  // usate per decidere quanto manca/avanza: un conteggio a parole ignora
  // quanto spazio occupano le tabelle, causa dello sforamento osservato
  // in pratica (35 pagine stimate a parole erano in realtà 50+ renderizzate).
  const pagineAttuali = stimaPagineContenuto(contenutoAttuale, formattazione);

  // Tre interventi separati e mutuamente esclusivi per questa chiamata:
  // espandere (troppo corta), condensare (troppo lunga — sforamento del
  // limite di pagine osservato in pratica fino a 55+ pagine su un target
  // di 40), o solo migliorare la formattazione (lunghezza già giusta ma
  // priva di tabelle). Un tetto/pavimento ESPLICITO in pagine (non un
  // generico "va bene superarlo leggermente") evita che più sezioni
  // insieme sforino il limite di pagine complessivo del disciplinare.
  let istruzioneObiettivo: string;
  if (azione === "espandi") {
    const paroleEquivalentiMancanti = Math.round(Math.max(0, pagineTarget - pagineAttuali) * 450);
    istruzioneObiettivo = `È più corta di quanto lo spazio disponibile per questo criterio consentirebbe: occupa circa ${pagineAttuali.toFixed(1)} pagine A4 contro un target di ${pagineTarget.toFixed(1)} pagine (conteggio REALE che tiene conto anche di tabelle/immagini, che occupano più spazio per parola del semplice testo — se aggiungi tabelle, ti serve MENO testo nuovo di quanto suggerirebbe un conteggio a sole parole: attualmente ha ${paroleAttuali} parole, e ne basterebbero all'incirca ${paroleEquivalentiMancanti} in più se scrivessi solo prosa, ma sensibilmente meno se usi tabelle). Espandila aggiungendo approfondimento, dettagli operativi, esempi concreti, tabelle o sotto-argomenti coerenti con quanto già presente, fino a raggiungere TRA ${pagineTarget.toFixed(1)} e ${(pagineTarget * 1.05).toFixed(1)} pagine — MAI oltre questo massimo, MAI sotto il target per prudenza. MANTIENI INTEGRALMENTE tutto il contenuto già presente (non tagliare, non riassumere, non riscrivere quanto già scritto).`;
  } else if (azione === "condensa") {
    istruzioneObiettivo = `È più LUNGA di quanto lo spazio disponibile per questo criterio consenta: occupa circa ${pagineAttuali.toFixed(1)} pagine A4 contro un target massimo di ${pagineTarget.toFixed(1)} pagine (conteggio REALE che tiene conto anche di tabelle/immagini). CONDENSALA fino a rientrare TRA ${pagineTarget.toFixed(1)} e ${(pagineTarget * 1.05).toFixed(1)} pagine, senza perdere alcun contenuto sostanziale (requisiti, impegni, riferimenti normativi, dati tecnici restano tutti presenti) né la formattazione (tabelle/grassetti/evidenziazioni): elimina ridondanze, frasi ripetitive o eccessivamente discorsive, accorpa concetti equivalenti, preferisci frasi dirette. Se un paragrafo lungo descrive elenchi di caratteristiche/confronti/specifiche, valuta di convertirlo in tabella: occupa meno spazio a parità di informazione.`;
  } else {
    istruzioneObiettivo = `La lunghezza attuale (circa ${pagineAttuali.toFixed(1)} pagine) è già adeguata al criterio: NON aggiungere quasi nessun testo nuovo, resta entro ${(pagineAttuali * 1.05).toFixed(1)} pagine. Il tuo unico compito è migliorare la FORMATTAZIONE di quanto già scritto secondo le regole sopra. MANTIENI INTEGRALMENTE tutto il contenuto già presente (non tagliare, non riassumere, non riscrivere quanto già scritto).`;
  }

  const maxTokens = Math.min(64000, Math.max(8000, Math.ceil(Math.max(paroleAttuali, pagineTarget * 450) * 1.3 * 4)));

  try {
    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: maxTokens,
      thinking: { type: "disabled" },
      system: ISTRUZIONI_FORMATTAZIONE_ESPANSIONE,
      messages: [
        {
          role: "user",
          content: `Di seguito il contenuto già scritto per la sezione "${titoloSezione}" di un'offerta tecnica per una gara d'appalto. ${istruzioneObiettivo} Applica le regole di formattazione qui sopra ANCHE al testo già esistente dove ne è privo — in particolare, se un paragrafo descrive elenchi di caratteristiche, specifiche, confronti o livelli/frequenze scritti come prosa e l'argomento non ha già una tabella, CONVERTILO in una tabella markdown invece di lasciarlo come testo continuo: è l'errore più frequente da correggere. Restituisci SOLO il testo completo risultante, senza commenti.

${contenutoAttuale}`,
        },
      ],
    });

    const response = await stream.finalMessage();

    if (response.stop_reason === "max_tokens") {
      console.warn(`espandiContenutoSezione: risposta troncata per max_tokens su "${titoloSezione}", mantengo la versione originale.`);
      return null;
    }

    const testo = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("\n")
      .trim();

    return testo || null;
  } catch (err) {
    console.error(`espandiContenutoSezione: errore su "${titoloSezione}":`, err);
    return null;
  }
}

// Un singolo intervento (espandi/condensa) non è preciso: verificato in
// pratica che chiedere di espandere/condensare verso un target può
// portare a un risultato sballato nella direzione opposta (es. una
// sezione al 139% del target condensata è arrivata al 77%, non alla
// fascia 100-105% richiesta) — limite noto dei modelli nel rispettare un
// conteggio esatto. Per questo la correzione qui non è un singolo
// tentativo ma un ciclo che RIMISURA il risultato reale con
// stimaPagineContenuto e, se ancora fuori fascia, corregge di nuovo
// nella direzione opposta — fino a un massimo di tentativi, per non far
// esplodere tempo/costo per una precisione via via meno necessaria.
export async function correggiSezioneVersoTarget(
  titoloSezione: string,
  contenutoIniziale: string,
  pagineTarget: number,
  formattazione: { dimensioneCarattere?: number; interlinea?: number },
  maxTentativi = 2,
): Promise<string> {
  let contenuto = contenutoIniziale;

  for (let tentativo = 0; tentativo < maxTentativi; tentativo++) {
    const pagineAttuali = stimaPagineContenuto(contenuto, formattazione);
    const necessitaLunghezza = pagineAttuali < pagineTarget * SOGLIA_ESPANSIONE;
    const necessitaRiduzione = pagineAttuali > pagineTarget * SOGLIA_RIDUZIONE;
    // Sulla prima passata, una sezione sostanziosa senza NESSUNA tabella
    // è quasi certamente sotto lo standard OMNIA anche se già alla
    // lunghezza giusta — un caso che il solo controllo sulla lunghezza
    // non correggerebbe mai, lasciando indefinitamente la formattazione
    // piatta di una generazione precedente a questo passaggio. Non lo
    // ripetiamo sui tentativi successivi: dopo una condensazione/
    // espansione la formattazione è già stata rifatta da zero.
    const necessitaFormattazione =
      tentativo === 0 &&
      !necessitaLunghezza &&
      !necessitaRiduzione &&
      contaTabelle(contenuto) === 0 &&
      contenuto.split(/\s+/).filter(Boolean).length > 600;

    if (!necessitaLunghezza && !necessitaRiduzione && !necessitaFormattazione) break;

    const azione: AzioneSezione = necessitaRiduzione ? "condensa" : necessitaLunghezza ? "espandi" : "formatta";
    const risultato = await espandiContenutoSezione(titoloSezione, contenuto, pagineTarget, azione, formattazione);
    if (!risultato) break; // fallito/troncato: tieni l'ultima versione buona, non rischiare di perderla

    contenuto = risultato;
  }

  return contenuto;
}

// Assembla la Relazione Tecnica definitiva da TUTTE le bozze di sezione
// generate finora per la gara. Quando la stessa gara ha ricevuto più
// rielaborazioni dello stesso criterio (frequente: ogni volta che il
// cliente chiede di rivedere/correggere un criterio già trattato,
// genera_bozza_sezione crea una NUOVA bozza pensata per SOSTITUIRE quella
// vecchia, non per affiancarla), qui si tiene solo la più recente
// (ordine più alto) di ciascun argomento — raggruppato per titolo
// normalizzato, deterministicamente: chiedere a Claude di scegliere caso
// per caso è risultato inaffidabile in pratica (verificato su un caso
// reale con 13 rielaborazioni dello stesso criterio: il modello ne
// tratteneva più di una, o sceglieva la versione più corta invece di
// quella più recente/completa). La COMPOSIZIONE del testo finale è poi
// una semplice concatenazione fatta qui in codice, non generata di nuovo
// dal modello: chiedergli di riscrivere per intero un documento che può
// arrivare a 40+ pagine (bug osservato in pratica: relazione finale
// troncata a metà di un criterio) sbatte contro il limite di max_tokens
// della risposta, mentre le bozze sono già testo completo e definitivo
// salvato a DB.
export async function componiRelazioneFinale(params: {
  garaId: string;
  userId: string;
}): Promise<{ nomeFile: string; filePath: string } | { error: string }> {
  const { garaId, userId } = params;

  const supabase = await createClient();

  const { data: sezioni } = await supabase
    .from("gara_relazione_sezioni")
    .select("ordine, titolo_sezione, contenuto")
    .eq("gara_id", garaId)
    .order("ordine", { ascending: true })
    .returns<{ ordine: number; titolo_sezione: string; contenuto: string }[]>();

  if (!sezioni || sezioni.length === 0) {
    return { error: "Nessuna sezione ancora elaborata per questa gara: genera almeno un criterio prima di comporre la relazione finale." };
  }

  const fmt = await formattazioneGara(garaId, {});

  // Serve per applicaSostituzioniAnonimizzazione qui sotto: la relazione
  // finale composta da questa funzione non passava mai per la
  // sostituzione "operatore economico" → nome reale, a differenza delle
  // singole bozze generate in chat — bug root-cause della persistenza
  // del termine generico nel documento finale scaricato.
  const { data: companyBudget } = await supabase
    .from("companies")
    .select("ragione_sociale")
    .eq("user_id", userId)
    .maybeSingle<{ ragione_sociale: string | null }>();

  const sezioniFinali = raggruppaEDeduplicaSezioni(sezioni);

  // Se il criterio di questa sezione ha ricevuto meno pagine di quanto il
  // suo punteggio giustificherebbe (vedi calcolaRipartizionePagine in
  // gara-chat.ts, stesso calcolo qui rifatto sui dati della gara),
  // espandila con una chiamata isolata per quella sola sezione — mai
  // riscrivendo l'intero documento finale in un colpo solo, che è
  // esattamente ciò che causava il troncamento a metà criterio.
  const { data: garaBudget } = await supabase
    .from("gare")
    .select("limite_pagine_totale, punteggio_tecnico_max, criteri_riepilogo, sub_criteri_tabellari")
    .eq("id", garaId)
    .single<{
      limite_pagine_totale: number | null;
      punteggio_tecnico_max: number | null;
      criteri_riepilogo: CriterioRiepilogo[] | null;
      sub_criteri_tabellari: string[] | null;
    }>();

  // Riapplicati qui perché il passaggio di espansione/condensazione più
  // sotto non sa nulla dei marcatori tabellari e potrebbe riscriverli
  // come contenuto discorsivo — vedi applicaMarcatoriTabellari. Il primo
  // giro serve anche a far leggere a stimaPagineContenuto la lunghezza
  // REALE (marcatore incluso, non il testo esteso ancora presente in
  // qualche bozza precedente alla correzione).
  for (const sezione of sezioniFinali) {
    sezione.contenuto = applicaSostituzioniAnonimizzazione(
      applicaMarcatoriTabellari(sezione.contenuto, garaBudget?.sub_criteri_tabellari ?? null),
      companyBudget?.ragione_sociale,
    );
  }

  if (
    garaBudget?.limite_pagine_totale &&
    garaBudget.punteggio_tecnico_max &&
    garaBudget.criteri_riepilogo?.length
  ) {
    const { limite_pagine_totale, punteggio_tecnico_max, criteri_riepilogo } = garaBudget;
    const ordineBase = Math.max(...sezioni.map((s) => s.ordine));

    // Le sezioni da espandere sono indipendenti tra loro: eseguire le
    // chiamate in parallelo invece che una alla volta (bug di lentezza
    // osservato in pratica — comporre una relazione da 4 criteri poteva
    // richiedere 10+ minuti in sequenza) riduce il tempo totale a quello
    // della sezione più lenta, non alla somma di tutte.
    const formattazioneGaraCorrente = { dimensioneCarattere: fmt.dimensioneCarattere, interlinea: fmt.interlinea };

    const risultati = await Promise.all(
      sezioniFinali.map(async (sezione, indice) => {
        const numeroSezione = estraiNumeroCriterioTopLevel(sezione.titolo_sezione);
        const criterio = criteri_riepilogo.find(
          (c) =>
            (numeroSezione && c.numero.trim().toLowerCase() === numeroSezione) ||
            normalizzaTitoloSezione(c.titolo) === normalizzaTitoloSezione(sezione.titolo_sezione),
        );
        if (!criterio) return null;

        const pagineTarget = (criterio.punti_max / punteggio_tecnico_max) * limite_pagine_totale;
        const corretto = await correggiSezioneVersoTarget(
          sezione.titolo_sezione,
          sezione.contenuto,
          pagineTarget,
          formattazioneGaraCorrente,
        );
        if (corretto === sezione.contenuto) return null;

        // Riapplicate dopo l'espansione/condensazione: quel passaggio non
        // sa nulla né dei marcatori tabellari né dell'anonimizzazione, e
        // può aver riscritto/ampliato il testo reintroducendo "l'operatore
        // economico" al posto del nome reale (bug osservato in pratica,
        // stesso motivo dei marcatori tabellari).
        const contenuto = applicaSostituzioniAnonimizzazione(
          applicaMarcatoriTabellari(corretto, garaBudget.sub_criteri_tabellari),
          companyBudget?.ragione_sociale,
        );

        return { indice, contenuto };
      }),
    );

    const espansioniRiuscite = risultati.filter((r): r is { indice: number; contenuto: string } => r !== null);

    if (espansioniRiuscite.length > 0) {
      await supabase.from("gara_relazione_sezioni").insert(
        espansioniRiuscite.map((r, i) => ({
          gara_id: garaId,
          user_id: userId,
          titolo_sezione: sezioniFinali[r.indice].titolo_sezione,
          contenuto: r.contenuto,
          ordine: ordineBase + 1 + i,
        })),
      );

      for (const r of espansioniRiuscite) {
        sezioniFinali[r.indice] = { ...sezioniFinali[r.indice], contenuto: r.contenuto };
      }
    }
  }

  const contenutoFinale = sezioniFinali
    .map((s) => `# ${s.titolo_sezione}\n\n${rimuoviTitoloRidondante(s.contenuto, s.titolo_sezione)}`)
    .join("\n\n");

  if (!contenutoFinale) {
    return { error: "Non sono riuscito a comporre la relazione finale. Riprova tra qualche minuto." };
  }

  const contieneOrganigramma = CONTIENE_ORGANIGRAMMA.test(contenutoFinale);
  const [stileOrganigramma, loghiOrganigramma] = contieneOrganigramma
    ? await Promise.all([ricavaStileOrganigramma(), recuperaLoghiOrganigramma(garaId)])
    : [null, undefined];

  const buffer = await buildDocxBuffer(
    fmt.titolo,
    contenutoFinale,
    { font: fmt.font, dimensioneCarattere: fmt.dimensioneCarattere, interlinea: fmt.interlinea },
    stileOrganigramma ?? undefined,
    loghiOrganigramma,
  );

  return caricaDocumento(garaId, `${fmt.titolo}.docx`, buffer);
}
