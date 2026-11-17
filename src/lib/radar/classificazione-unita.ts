// Classificatore unico sui dati UNITI di una gara pubblicata da più fonti (fase B2, 17/11/2026). Logica pura, provata da
// scripts/verifica-radar-classificazione.ts.
//
// Decisione dell'utente del 17/11: «un solo classificatore per tutte le fonti … una gara presente su più fonti ha una classificazione
// coerente e le ambiguità si segnalano». Regole:
//   - UN SOLO CALCOLO, quello degli importatori e della riclassificazione (classificaGara di settori.ts): CPV della gara e dei lotti, testo =
//     oggetto della gara + oggetti dei lotti, in quest'ordine; una gara trovata solo per parola chiave deve essere un servizio (o natura
//     mista o non indicata);
//   - la colonna «settori» NON cambia comportamento: resta l'unione delle fonti (unione-calcoli.ts), così nessuna fonte toglie ciò che
//     un'altra ha riconosciuto e nessuna gara cambia settore senza la riclassificazione autorizzata;
//   - le AMBIGUITÀ si SEGNALANO, non si risolvono da sole. Quando una fonte si unisce a una gara che ha già un'altra fonte, si confrontano:
//       1. la versione della fonte, classificata da sola;
//       2. la gara com'era prima (i dati delle altre fonti);
//       3. i dati uniti dopo l'unione.
//     Settori diversi, livelli diversi per lo stesso settore (A pertinente, B correlata, C non pertinente) o dati uniti che danno un
//     risultato diverso dalle due classificazioni → una segnalazione nel registro dei cambiamenti (correzione_dati, campo
//     «classificazione_ambigua»), mai notificabile, mai mostrata ai clienti, che un amministratore vede in console;
//   - tutte e tre le classificazioni usano le regole CORRENTI, mai la colonna salvata: una differenza dovuta solo al cambio delle regole
//     non è un'ambiguità tra fonti (se ne occupa la riclassificazione autorizzata);
//   - rileggere le stesse versioni non duplica la segnalazione (chiave con la versione delle regole e un'impronta del confronto).
import { classificaGara, nomeSettore, VERSIONE_REGOLE_SETTORI, type Livello, type SettoreRadar } from "./settori";
import { CAMPO_CLASSIFICAZIONE_AMBIGUA, NOME_FONTE } from "./fonti-gara-calcoli";
import type { FonteUnita } from "./unione-calcoli";

export type DatiDaClassificare = { oggetto: string | null; cpv_principale: string | null; cpv_tutti: readonly string[] | null; natura_contratto: string | null };
export type LottoDaClassificare = { oggetto: string | null; cpv_principale: string | null; cpv_tutti: readonly string[] | null };

// Per settore: livello e, dall'interfaccia della PVL del 17/11 (additiva), PIÙ sottocategorie, regole, motivi e CPV. Finché classificaGara
// non restituisce gli elenchi, si leggono dai campi singoli (sottocategoria, regola, motivo): stesso significato, primo elemento.
export type ValutazioneSettore = {
  livello: Livello;
  sottocategoria: string | null;
  regola: string;
  sottocategorie: string[];
  regole: string[];
  motivi: string[];
  da: "cpv" | "parole_chiave";
  cpv: string[];
};

export type ClassificazioneArchivio = {
  // dove la gara compare (A e B), come la colonna «settori»
  settori: SettoreRadar[];
  metodo: "cpv" | "parole_chiave" | null;
  // il livello migliore (A, poi B; C se tutti i settori sono esclusi; null se nessun settore)
  livello: Livello | null;
  // per ogni settore considerato, anche quelli di livello C
  perSettore: Partial<Record<SettoreRadar, ValutazioneSettore>>;
  // versione delle regole che l'ha prodotta
  versione: string;
};

const NATURE_AMMESSE_PER_PAROLE = new Set(["servizi", "misto"]);

// Lo stesso calcolo di riclassifica-settori.ts (la prova lo confronta su tutti i casi).
export function classificaPerArchivio(g: DatiDaClassificare, lotti: readonly LottoDaClassificare[]): ClassificazioneArchivio {
  const c = classificaGara({
    cpvPrincipale: g.cpv_principale,
    cpvTutti: [...(g.cpv_tutti ?? []), ...lotti.flatMap((l) => [l.cpv_principale, ...(l.cpv_tutti ?? [])])],
    testo: [g.oggetto, ...lotti.map((l) => l.oggetto ?? "")].join(" "),
    // come riclassifica-settori.ts: i lotti riconoscono un servizio AUTONOMO (lotto dedicato); cambiano il livello, mai i settori
    lotti: lotti.map((l) => ({ testo: l.oggetto, cpv: [l.cpv_principale, ...(l.cpv_tutti ?? [])] })),
  });
  const fuoriPerNatura = c.metodo === "parole_chiave" && !!g.natura_contratto && !NATURE_AMMESSE_PER_PAROLE.has(g.natura_contratto);
  const versione = (c as { versione?: string }).versione ?? VERSIONE_REGOLE_SETTORI;
  if (fuoriPerNatura) return { settori: [], metodo: null, livello: null, perSettore: {}, versione };
  const perSettore: Partial<Record<SettoreRadar, ValutazioneSettore>> = {};
  for (const v of c.valutazioni) if (!perSettore[v.settore]) perSettore[v.settore] = valutazioneSettore(v);
  return { settori: c.settori.length ? [...c.settori] : [], metodo: c.settori.length ? c.metodo : null, livello: c.livello, perSettore, versione };
}

// Lettura tollerante di una valutazione di classificaGara: gli elenchi se ci sono (interfaccia della PVL), altrimenti i campi singoli.
function valutazioneSettore(v: { livello: Livello; sottocategoria: string | null; regola: string; motivo?: string; da: "cpv" | "parole_chiave" }): ValutazioneSettore {
  const x = v as typeof v & { sottocategorie?: string[]; regole?: string[]; motivi?: string[]; cpv?: string[] };
  const sottocategorie = v.livello === "C" ? [] : Array.isArray(x.sottocategorie) ? [...x.sottocategorie] : v.sottocategoria ? [v.sottocategoria] : [];
  const regole = Array.isArray(x.regole) && x.regole.length ? [...x.regole] : [v.regola];
  const motivi = Array.isArray(x.motivi) ? [...x.motivi] : v.motivo ? [v.motivo] : [];
  return { livello: v.livello, sottocategoria: sottocategorie[0] ?? null, regola: regole[0], sottocategorie, regole, motivi, da: v.da, cpv: v.da === "cpv" && Array.isArray(x.cpv) ? [...x.cpv] : [] };
}

export type AmbiguitaClassificazione = {
  fonte: FonteUnita;
  altreFonti: FonteUnita[];
  daFonte: ClassificazioneArchivio;
  altre: ClassificazioneArchivio;
  unita: ClassificazioneArchivio;
  motivi: string[];
  chiave: string;
};

const stessi = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
const elenco = (s: readonly SettoreRadar[]) => (s.length ? s.map((x) => nomeSettore(x).toLowerCase()).join(", ") : "nessun settore");
const firma = (c: ClassificazioneArchivio) =>
  (Object.entries(c.perSettore) as [SettoreRadar, ValutazioneSettore][])
    .map(([s, v]) => `${s}=${v.livello}/${v.sottocategoria ?? "-"}`)
    .sort()
    .join(",") + `;${[...c.settori].sort().join(",")}`;

// Impronta corta e stabile per la chiave del registro (al massimo 200 caratteri): due FNV-1a a 32 bit con basi diverse.
function impronta(t: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ t.length;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ (c + 0x9e), 0x01000193) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/**
 * Il confronto tra le fonti quando la versione di «fonte» si unisce a una gara che ha già «altreFonti». null = nessuna ambiguità (o gara di
 * una sola fonte: allora non c'è nulla da confrontare e il comportamento è quello di sempre).
 */
export function ambiguitaTraFonti(x: { fonte: FonteUnita; altreFonti: readonly FonteUnita[]; daFonte: ClassificazioneArchivio; altre: ClassificazioneArchivio; unita: ClassificazioneArchivio }): AmbiguitaClassificazione | null {
  const altreFonti = [...new Set(x.altreFonti.filter((f) => f !== x.fonte))];
  if (altreFonti.length === 0) return null;
  const nome = NOME_FONTE[x.fonte];
  const nomiAltre = altreFonti.map((f) => NOME_FONTE[f]).join(" e ");
  const motivi: string[] = [];
  if (!stessi(x.daFonte.settori, x.altre.settori)) motivi.push(`Settori diversi tra le fonti: ${nome} dà ${elenco(x.daFonte.settori)}, ${nomiAltre} ${elenco(x.altre.settori)}`);
  for (const s of Object.keys(x.daFonte.perSettore) as SettoreRadar[]) {
    const a = x.daFonte.perSettore[s];
    const b = x.altre.perSettore[s];
    if (a && b && a.livello !== b.livello) motivi.push(`Livello diverso per ${nomeSettore(s).toLowerCase()}: ${nome} ${a.livello} (${a.regola}), ${nomiAltre} ${b.livello} (${b.regola})`);
  }
  const unione = [...new Set([...x.daFonte.settori, ...x.altre.settori])];
  if (!stessi(x.unita.settori, unione)) motivi.push(`I dati uniti danno ${elenco(x.unita.settori)}; le fonti insieme ${elenco(unione)}`);
  if (motivi.length === 0) return null;
  const chiave = `classificazione:${VERSIONE_REGOLE_SETTORI}:${x.fonte}:${impronta(`${firma(x.daFonte)}|${firma(x.altre)}|${firma(x.unita)}`)}`;
  return { fonte: x.fonte, altreFonti, daFonte: x.daFonte, altre: x.altre, unita: x.unita, motivi, chiave };
}

const compatta = (c: ClassificazioneArchivio) => ({ settori: c.settori, livello: c.livello, per_settore: c.perSettore });

function json(v: unknown): string {
  const t = JSON.stringify(v);
  return t.length <= 2000 ? t : JSON.stringify({ ...(v as object), per_settore: undefined }).slice(0, 2000);
}

// La riga del registro dei cambiamenti: sempre «correzione_dati», mai notificabile; i clienti non la vedono (aggiornamentoPerCliente).
export function rigaSegnalazioneClassificazione(proceduraId: string, a: AmbiguitaClassificazione): Record<string, unknown> {
  return {
    procedura_id: proceduraId,
    tipo: "correzione_dati",
    campo: CAMPO_CLASSIFICAZIONE_AMBIGUA,
    valore_precedente: json({ fonti: a.altreFonti, ...compatta(a.altre) }),
    valore_nuovo: json({ fonte: a.fonte, ...compatta(a.daFonte), dati_uniti: compatta(a.unita) }),
    fonte: a.fonte,
    id_fonte: a.chiave,
    nota: `Da verificare (regole ${VERSIONE_REGOLE_SETTORI}). ${a.motivi.join(". ")}.`.slice(0, 1000),
    notificabile: false,
  };
}
