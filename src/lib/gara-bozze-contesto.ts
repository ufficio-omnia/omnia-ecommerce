import { leggiBloccoFigura } from "@/lib/figure-dati";
import { leggiBloccoOrganigramma } from "@/lib/organigramma-dati";
import { quotaParoleConservate } from "@/lib/espansione-mirata";
import { parseSottoCriteri } from "@/lib/sotto-criteri";

// Memoria della chat di gara (OMNIA AI): cosa vede il modello del lavoro già fatto e delle richieste precedenti del cliente.
// Funzioni PURE (nessun database, nessun modello): le usano la chat (src/app/actions/gara-chat.ts), il prompt di sistema e i test.
//
// Il difetto che qui si corregge (segnalazione di un cliente, 26/10/2026, e dati reali): ogni bozza era una riscrittura da
// zero, perché del lavoro già salvato il modello vedeva solo l'elenco dei titoli, mai il testo; della conversazione
// vedeva solo gli ultimi 12 messaggi, quindi le istruzioni date prima sparivano; e il totale delle «pagine già scritte»
// sommava TUTTE le versioni di ogni criterio (14 versioni del 2.1 in un giorno), spingendo il modello ad accorciare.

export type SezioneSalvata = { ordine: number; titolo_sezione: string; contenuto: string; created_at: string };

export type VersioneSezione = { ordine: number; titolo: string; creataIl: string; parole: number; pagine: number };

export type GruppoCriterio = {
  chiave: string;
  // titolo dell'ULTIMA versione
  titolo: string;
  // dalla più recente alla più vecchia
  versioni: VersioneSezione[];
};

export const PAROLE_PER_PAGINA_STIMATE = 450;

function contaParole(testo: string): number {
  return testo.split(/\s+/).filter(Boolean).length;
}

// "2.1 Servizio di pulizie" → "2.1"; "CRITERIO 2 - Descrizione" → "2"; "2. Descrizione" → "2"; "A.1 Qualità" → "A.1".
// null se il titolo non comincia con una numerazione.
const NUMERAZIONE_TITOLO_REGEX = /^\s*(?:criterio\s*)?((?:[A-Za-z]\.)?\d+(?:\.\d+)*)\s*[.\-–:)]*\s*/i;

function chiaveNumerica(titolo: string): string | null {
  const m = titolo.match(NUMERAZIONE_TITOLO_REGEX);
  return m ? m[1].toUpperCase() : null;
}

// Il titolo senza numerazione e senza «CRITERIO n -»: serve a riconoscere la stessa bozza salvata senza numero.
function nucleoTitolo(titolo: string): string {
  return titolo.replace(NUMERAZIONE_TITOLO_REGEX, "").toLowerCase().replace(/\s+/g, " ").trim();
}

// Chiave del criterio a cui appartiene una bozza: tutte le versioni dello stesso criterio hanno la stessa chiave.
export function chiaveCriterio(titolo: string): string {
  return chiaveNumerica(titolo) ?? `t:${nucleoTitolo(titolo)}`;
}

// Raggruppa le bozze salvate per criterio; ogni gruppo ha le versioni dalla più recente. Una bozza senza numerazione che ha lo
// stesso titolo di un criterio numerato (es. «Coordinamento dei Servizi in Appalto» e «CRITERIO 1 - Coordinamento dei Servizi in
// Appalto») entra nello stesso gruppo. I gruppi sono nell'ordine in cui sono comparsi.
export function raggruppaSezioni(sezioni: SezioneSalvata[], paroleXPagina = PAROLE_PER_PAGINA_STIMATE): GruppoCriterio[] {
  const ordinate = [...sezioni].sort((a, b) => a.ordine - b.ordine);
  const chiavePerNucleo = new Map<string, string>();
  for (const s of ordinate) {
    const k = chiaveNumerica(s.titolo_sezione);
    const nucleo = nucleoTitolo(s.titolo_sezione);
    if (k && nucleo && !chiavePerNucleo.has(nucleo)) chiavePerNucleo.set(nucleo, k);
  }

  const gruppi = new Map<string, GruppoCriterio>();
  for (const s of ordinate) {
    const k = chiaveNumerica(s.titolo_sezione) ?? chiavePerNucleo.get(nucleoTitolo(s.titolo_sezione)) ?? `t:${nucleoTitolo(s.titolo_sezione)}`;
    const parole = contaParole(senzaBlocchiStrutturati(s.contenuto));
    const versione: VersioneSezione = { ordine: s.ordine, titolo: s.titolo_sezione, creataIl: s.created_at, parole, pagine: parole / paroleXPagina };
    const g = gruppi.get(k);
    if (g) {
      g.versioni.unshift(versione);
      g.titolo = s.titolo_sezione;
    } else {
      gruppi.set(k, { chiave: k, titolo: s.titolo_sezione, versioni: [versione] });
    }
  }
  return [...gruppi.values()];
}

function dataOra(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("it-IT", { timeZone: "Europe/Rome", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const VERSIONI_PRECEDENTI_MOSTRATE = 3;

// L'elenco delle bozze per il prompt di sistema: per ogni criterio, l'ULTIMA versione (quella da leggere e da cui partire) e
// i numeri d'ordine delle precedenti.
export function testoElencoBozze(gruppi: GruppoCriterio[]): string {
  return gruppi
    .map((g) => {
      const [ultima, ...precedenti] = g.versioni;
      const pag = (v: VersioneSezione) => `~${Math.max(0.1, Math.round(v.pagine * 10) / 10)} pag.`;
      let riga = `- ${g.titolo} — ULTIMA versione: [ordine ${ultima.ordine}] (${pag(ultima)}, ${dataOra(ultima.creataIl)})`;
      if (precedenti.length > 0) {
        const mostrate = precedenti.slice(0, VERSIONI_PRECEDENTI_MOSTRATE).map((v) => `[ordine ${v.ordine}] (${pag(v)}, ${dataOra(v.creataIl)})`);
        const altre = precedenti.length - mostrate.length;
        riga += `; versioni precedenti: ${mostrate.join(", ")}${altre > 0 ? ` e altre ${altre}` : ""}`;
      }
      return riga;
    })
    .join("\n");
}

// Quanto è già scritto, contando UNA volta sola ogni criterio (la sua ultima versione): le versioni vecchie sono lo stesso
// contenuto riscritto, non pagine in più. (Un criterio intero e i suoi sotto-criteri scritti a parte si sommano: è una stima.)
export function totaleUltimeVersioni(gruppi: GruppoCriterio[]): { parole: number; pagine: number } {
  const parole = gruppi.reduce((tot, g) => tot + (g.versioni[0]?.parole ?? 0), 0);
  return { parole, pagine: Math.round(parole / PAROLE_PER_PAGINA_STIMATE) };
}

// ─── Leggere prima di riscrivere ───

export type EsitoControlloLettura =
  | { ok: true; chiave: string; gruppo: GruppoCriterio | undefined; ordineBase: number | null }
  | { ok: false; chiave: string; gruppo: GruppoCriterio; ordineUltima: number; precedenti: number[] };

// Prima di generare la bozza di un criterio che ha già delle versioni, il modello deve averne LETTO almeno una (in un passaggio
// precedente). Se sì, la «bozza di partenza» è la più recente tra quelle lette. Un criterio senza versioni passa sempre.
export function controllaLetturaPrimaDiGenerare(titoloNuovo: string, gruppi: GruppoCriterio[], lette: ReadonlySet<number>): EsitoControlloLettura {
  const chiave = chiaveCriterio(titoloNuovo);
  const gruppo = gruppi.find((g) => g.chiave === chiave);
  if (!gruppo) return { ok: true, chiave, gruppo: undefined, ordineBase: null };
  const lette_ = gruppo.versioni.filter((v) => lette.has(v.ordine));
  if (lette_.length === 0) {
    return { ok: false, chiave, gruppo, ordineUltima: gruppo.versioni[0].ordine, precedenti: gruppo.versioni.slice(1).map((v) => v.ordine) };
  }
  return { ok: true, chiave, gruppo, ordineBase: Math.max(...lette_.map((v) => v.ordine)) };
}

export function testoGenerazioneRifiutata(e: Extract<EsitoControlloLettura, { ok: false }>): string {
  const precedenti = e.precedenti.length > 0 ? `; le precedenti sono ${e.precedenti.slice(0, 3).join(", ")}${e.precedenti.length > 3 ? " e altre" : ""}` : "";
  return `GENERAZIONE NON ESEGUITA, nessun file creato: per questo criterio esiste già una bozza e non l'hai letta (o l'hai letta nella stessa risposta in cui hai generato, quindi non ne hai visto il testo). Chiama leggi_bozza_sezione con ordine ${e.ordineUltima} (l'ultima versione${precedenti}) e, nel passaggio dopo, richiama genera_bozza_sezione partendo da quel testo: conserva tutto ciò che il cliente non ti ha chiesto di cambiare.`;
}

// ─── La bozza come la vede il modello quando la legge ───

const BLOCCO_ORGANIGRAMMA_REGEX = /\[ORGANIGRAMMA\]([\s\S]*?)\[\/ORGANIGRAMMA\]/gi;
const BLOCCO_FIGURA_REGEX = /\[FIGURA\]([\s\S]*?)\[\/FIGURA\]/gi;
const LIMITE_CARATTERI_BOZZA_LETTA = 150_000;

export type BozzaPerModello = { testo: string; figure: number; organigrammi: number };

// Il testo salvato contiene i dati strutturati di organigramma e figure come righe JSON: al modello non servono (sono costruiti
// dal codice) e non devono essere ricopiati a mano. Si sostituiscono con una riga che dice cosa c'è e dove.
export function presentaBozzaAlModello(sezione: SezioneSalvata): BozzaPerModello {
  let figure = 0;
  let organigrammi = 0;
  let testo = sezione.contenuto
    .replace(BLOCCO_ORGANIGRAMMA_REGEX, (_m, corpo: string) => {
      organigrammi++;
      const d = leggiBloccoOrganigramma(corpo);
      return `[ORGANIGRAMMA GIÀ PRESENTE in questa bozza${d ? ` (${d.coordinamento.length} zone di coordinamento)` : ""}]`;
    })
    .replace(BLOCCO_FIGURA_REGEX, (_m, corpo: string) => {
      figure++;
      const d = leggiBloccoFigura(corpo);
      return `[FIGURA GIÀ PRESENTE in questa bozza${d ? `: «${d.didascalia}» (${d.archetipo})` : ""}]`;
    });
  let troncata = false;
  if (testo.length > LIMITE_CARATTERI_BOZZA_LETTA) {
    testo = testo.slice(0, LIMITE_CARATTERI_BOZZA_LETTA);
    troncata = true;
  }
  const parole = contaParole(senzaBlocchiStrutturati(sezione.contenuto));
  const intestazione = `BOZZA [ordine ${sezione.ordine}] «${sezione.titolo_sezione}» — salvata il ${dataOra(sezione.created_at)} — ~${parole} parole (~${Math.round((parole / PAROLE_PER_PAGINA_STIMATE) * 10) / 10} pagine). Questo è il testo che il cliente ha GIÀ.`;
  const note = figure + organigrammi > 0 ? `\nLe righe «[FIGURA GIÀ PRESENTE…]» e «[ORGANIGRAMMA GIÀ PRESENTE…]» indicano figure e organigramma disegnati dal sistema: se la nuova bozza li deve mantenere, riproponili con i campi dello strumento («figure», «organigramma») e i segnaposto [FIGURA:n] / [ORGANIGRAMMA][/ORGANIGRAMMA] nella stessa posizione.` : "";
  return { testo: `${intestazione}${note}\n-----\n${testo}\n-----${troncata ? "\n(Testo troncato: la bozza è più lunga di quanto si possa mostrare.)" : ""}`, figure, organigrammi };
}

// ─── Confronto tra la bozza di partenza e la nuova ───

export type EsitoConfronto = {
  titoliMancanti: string[];
  figure: { prima: number; dopo: number };
  organigrammi: { prima: number; dopo: number };
  tabelle: { prima: number; dopo: number };
  paroleConservate: number; // 0..1
  parole: { prima: number; dopo: number };
};

function titoliSezione(testo: string): string[] {
  return testo
    .split("\n")
    .map((r) => r.match(/^#{2,3}\s+(.+?)\s*$/)?.[1])
    .filter((t): t is string => Boolean(t))
    .map((t) => t.replace(/\*\*/g, "").trim());
}

// Radici delle parole significative: «Piano di lavoro per sede» e «Piani di lavoro per le sedi» sono lo stesso titolo
// (si tolgono le vocali finali: piano/piani → «pian», sede/sedi → «sed», fascia/fasce → «fasc»).
function radici(titolo: string): Set<string> {
  return new Set(
    titolo
      .toLowerCase()
      .replace(/^[a-z]?\d+(?:\.\d+)*[.)]?\s*/, "")
      .split(/[^a-zà-ÿ0-9]+/)
      .filter((p) => p.length >= 4)
      .map((p) => p.replace(/[aeiouàèéìòù]+$/, "").slice(0, 6))
      .filter((p) => p.length >= 3),
  );
}

function titoliSimili(a: string, b: string): boolean {
  const ra = radici(a);
  const rb = radici(b);
  if (ra.size === 0 || rb.size === 0) return a.trim().toLowerCase() === b.trim().toLowerCase();
  let comuni = 0;
  for (const r of ra) if (rb.has(r)) comuni++;
  return comuni / Math.min(ra.size, rb.size) >= 0.6;
}

function contaFigure(testo: string): number {
  return (testo.match(/\[FIGURA\]/gi) ?? []).length + (testo.match(/\[FIGURA:\d+\]/gi) ?? []).length;
}
function contaOrganigrammi(testo: string): number {
  return (testo.match(/\[ORGANIGRAMMA\]/gi) ?? []).length;
}
function contaTabelle(testo: string): number {
  return (testo.match(/^\s*\|\s*:?-{2,}/gm) ?? []).length;
}

// Cosa c'era nella bozza di partenza e non c'è più in quella nuova. «Nuova» può essere il testo scritto dal modello (con i
// segnaposto delle figure) o quello salvato (con i blocchi): le figure si contano in entrambi i modi.
// Il testo senza i dati strutturati di figure e organigramma (blocchi JSON nel salvato, segnaposto nello scritto dal modello):
// le parole si confrontano sul solo testo, altrimenti il JSON del salvato conterebbe come «parole perse».
function senzaBlocchiStrutturati(testo: string): string {
  return testo
    .replace(/\[ORGANIGRAMMA\][\s\S]*?\[\/ORGANIGRAMMA\]/gi, " ")
    .replace(/\[FIGURA\][\s\S]*?\[\/FIGURA\]/gi, " ")
    .replace(/\[FIGURA:\d+\]/gi, " ");
}

export function confrontaConBozzaBase(base: string, nuova: string): EsitoConfronto {
  const titoliNuova = titoliSezione(nuova);
  const titoliMancanti = titoliSezione(base).filter((t) => !titoliNuova.some((n) => titoliSimili(t, n)));
  const soloTestoBase = senzaBlocchiStrutturati(base);
  const soloTestoNuova = senzaBlocchiStrutturati(nuova);
  return {
    titoliMancanti,
    figure: { prima: contaFigure(base), dopo: contaFigure(nuova) },
    organigrammi: { prima: contaOrganigrammi(base), dopo: contaOrganigrammi(nuova) },
    tabelle: { prima: contaTabelle(base), dopo: contaTabelle(nuova) },
    paroleConservate: quotaParoleConservate(soloTestoBase, soloTestoNuova),
    parole: { prima: contaParole(soloTestoBase), dopo: contaParole(soloTestoNuova) },
  };
}

// L'organigramma di commessa appartiene al criterio che descrive la struttura di coordinamento: ripetuto in un altro criterio è
// il «miscuglio» che un cliente ha segnalato (l'organigramma del criterio 1 comparso dentro il 2.1). Se la nuova bozza ne ha uno
// e l'ultima versione di un ALTRO criterio ce l'ha già, lo dice al modello (che lo riferisce al cliente).
export function avvisoOrganigrammaInAltroCriterio(nuova: string, sezioni: SezioneSalvata[], gruppi: GruppoCriterio[], chiaveCorrente: string): string {
  if (contaOrganigrammi(nuova) === 0) return "";
  for (const g of gruppi) {
    if (g.chiave === chiaveCorrente) continue;
    const ultima = sezioni.find((s) => s.ordine === g.versioni[0]?.ordine);
    if (ultima && contaOrganigrammi(ultima.contenuto) > 0) {
      return `ATTENZIONE — ORGANIGRAMMA GIÀ PRESENTE IN UN ALTRO CRITERIO: la bozza «${ultima.titolo_sezione}» [ordine ${ultima.ordine}] ha già l'organigramma di commessa e questa nuova bozza ne contiene un altro. Se il cliente non lo ha chiesto per questo criterio, dillo chiaramente nella risposta e offri di toglierlo: lo stesso organigramma ripetuto in due criteri è un difetto. `;
    }
  }
  return "";
}

export const SOGLIA_PAROLE_CONSERVATE = 0.7;

export function haPerdutoContenuto(e: EsitoConfronto): boolean {
  return e.titoliMancanti.length > 0 || e.figure.dopo < e.figure.prima || e.organigrammi.dopo < e.organigrammi.prima || e.tabelle.dopo < e.tabelle.prima || e.paroleConservate < SOGLIA_PAROLE_CONSERVATE;
}

// Cosa dire al modello (e quindi al cliente) dopo il confronto. Solo fatti misurati dal codice.
export function testoConfrontoPerModello(e: EsitoConfronto, ordineBase: number): string {
  const percentuale = Math.round(e.paroleConservate * 100);
  if (!haPerdutoContenuto(e)) {
    return `CONFRONTO CON LA BOZZA DI PARTENZA [ordine ${ordineBase}]: conservati tutti i titoli, le figure e le tabelle (${percentuale}% delle parole di prima è ancora presente). `;
  }
  const parti: string[] = [];
  if (e.titoliMancanti.length > 0) parti.push(`mancano ${e.titoliMancanti.length} titoli presenti prima: ${e.titoliMancanti.slice(0, 8).map((t) => `«${t}»`).join(", ")}${e.titoliMancanti.length > 8 ? " e altri" : ""}`);
  if (e.figure.dopo < e.figure.prima) parti.push(`figure ${e.figure.prima} → ${e.figure.dopo}`);
  if (e.organigrammi.dopo < e.organigrammi.prima) parti.push(`organigramma tolto`);
  if (e.tabelle.dopo < e.tabelle.prima) parti.push(`tabelle ${e.tabelle.prima} → ${e.tabelle.dopo}`);
  if (e.paroleConservate < SOGLIA_PAROLE_CONSERVATE) parti.push(`solo il ${percentuale}% delle parole di prima è ancora presente (parole ${e.parole.prima} → ${e.parole.dopo})`);
  return `ATTENZIONE — CONFRONTO CON LA BOZZA DI PARTENZA [ordine ${ordineBase}]: ${parti.join("; ")}. Se il cliente NON ha chiesto di togliere o accorciare queste parti, dillo chiaramente nella risposta (elenca cosa manca) e proponi di rimetterle: NON scrivere che hai mantenuto tutto. Se la rimozione era voluta, confermalo in una frase. `;
}

// ─── Le richieste precedenti del cliente ───

export type MessaggioChat = { ruolo: string; contenuto: string };

const MESSAGGIO_BANALE_REGEX = /^(ok|okay|si|sì|no|grazie|perfetto|va bene|bene|ottimo|fatto|continua|procedi)[\s.!?]*$/i;
const CARATTERI_PER_RICHIESTA = 450;
const CARATTERI_TOTALI_MEMORIA = 6000;

// Le richieste del cliente più vecchie degli ultimi `recenti` messaggi (che il modello vede già per intero): sono le sue
// istruzioni su cosa includere, quali fonti usare, cosa non fare. Una riga per richiesta, dalla più vecchia; se non stanno tutte
// nel limite si tengono le più recenti. Stringa vuota se non c'è nulla di più vecchio.
export function memoriaRichiesteCliente(messaggi: (MessaggioChat & { created_at?: string })[], recenti: number): string {
  const piuVecchi = messaggi.slice(0, Math.max(0, messaggi.length - recenti));
  const righe = piuVecchi
    .filter((m) => m.ruolo === "utente")
    .map((m) => ({ quando: m.created_at ? dataOra(m.created_at) : "", testo: m.contenuto.replace(/\s+/g, " ").trim() }))
    .filter((r) => r.testo.length >= 20 && !MESSAGGIO_BANALE_REGEX.test(r.testo))
    .map((r) => `- ${r.quando ? `${r.quando}: ` : ""}${r.testo.length > CARATTERI_PER_RICHIESTA ? `${r.testo.slice(0, CARATTERI_PER_RICHIESTA)}…` : r.testo}`);
  if (righe.length === 0) return "";

  const tenute: string[] = [];
  let totale = 0;
  for (let i = righe.length - 1; i >= 0; i--) {
    if (totale + righe[i].length > CARATTERI_TOTALI_MEMORIA) break;
    tenute.unshift(righe[i]);
    totale += righe[i].length;
  }
  const omesse = righe.length - tenute.length;
  return `${omesse > 0 ? `(${omesse} richieste ancora più vecchie non sono riportate)\n` : ""}${tenute.join("\n")}`;
}

// ─── La ricerca negli estratti, ancorata al criterio di cui si parla ───

const RIFERIMENTO_CRITERIO_REGEX = /\bcriteri[oa]\s*(?:n\.?\s*)?(\d+(?:\.\d+)?)(?![\d])/gi;
// «2.1», «2.2»: numerazione dei sotto-criteri. Esclude 10.950 (migliaia), 6.5 euro seguiti da altre cifre e simili.
const NUMERAZIONE_NEL_MESSAGGIO_REGEX = /(?<![\d.,])(\d{1,2}\.\d{1,2})(?![\d])(?!\.\d)(?!,\d)/g;
const LIMITE_CARATTERI_ANCORA = 1200;

export function criteriCitati(messaggio: string): string[] {
  const numeri = new Set<string>();
  for (const m of messaggio.matchAll(RIFERIMENTO_CRITERIO_REGEX)) numeri.add(m[1]);
  for (const m of messaggio.matchAll(NUMERAZIONE_NEL_MESSAGGIO_REGEX)) numeri.add(m[1]);
  return [...numeri];
}

// Il testo con cui si cercano gli estratti: il messaggio del cliente («amplia il 2.2») più titolo e requisito del criterio che
// cita. Senza, una richiesta breve cerca a caso e porta estratti di un altro criterio.
export function arricchisciQueryRicerca(
  messaggio: string,
  gara: { criteri_valutazione: string | null; criteri_riepilogo: { numero: string; titolo: string }[] | null; sub_criteri_tabellari: string[] | null },
): string {
  const citati = criteriCitati(messaggio);
  if (citati.length === 0) return messaggio;

  const sotto = gara.criteri_valutazione ? parseSottoCriteri(gara.criteri_valutazione, gara.sub_criteri_tabellari) : [];
  const ancore: string[] = [];
  for (const numero of citati) {
    const sc = sotto.find((s) => s.chiave.toLowerCase() === numero.toLowerCase());
    if (sc) {
      ancore.push(`${sc.chiave} ${sc.titolo} ${sc.requisito}`.replace(/\s+/g, " ").trim());
      continue;
    }
    const cr = gara.criteri_riepilogo?.find((c) => c.numero.trim() === numero);
    if (cr) ancore.push(`Criterio ${cr.numero} ${cr.titolo}`);
  }
  if (ancore.length === 0) return messaggio;
  return `${messaggio}\n${ancore.join(" | ")}`.slice(0, messaggio.length + 1 + LIMITE_CARATTERI_ANCORA);
}
