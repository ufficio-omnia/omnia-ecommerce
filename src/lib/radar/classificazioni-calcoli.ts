// Righe della tabella radar_classificazioni (migrazione 0121, PROGETTO non applicato): dal risultato del classificatore unico alle righe da
// scrivere, con lo storico. Logica pura, provata da scripts/verifica-radar-0121.ts.
//
// Regole (decisioni dell'utente del 17/11/2026):
//   - una riga per gara e settore, con livello (A, B, C), più sottocategorie, regole, motivi, CPV e versione delle regole;
//   - la colonna «settori» della gara NON si tocca: le righe dicono che cosa dicono le regole; se non coincidono con la colonna, la riga è
//     «ambigua» (sono le gare da decidere con la riclassificazione autorizzata, mai cambiate da sole);
//   - gara di più fonti: per ogni settore il livello migliore tra i dati uniti e le singole fonti (coerente con «settori», che è l'unione
//     delle fonti); se non sono d'accordo la riga è «ambigua»;
//   - storico: una classificazione uguale non si riscrive; una diversa DISATTIVA la precedente (sostituita_il, sostituita_da) e ne inserisce
//     una nuova; nulla si cancella; il ripristino reinserisce le righe di una versione precedente;
//   - la decisione di un AMMINISTRATORE non viene mai sostituita da un calcolo automatico: il calcolo diverso resta solo segnalato.
import type { Livello, SettoreRadar } from "./settori";
import type { ClassificazioneArchivio, ValutazioneSettore } from "./classificazione-unita";

export type OrigineClassificazione = "importazione" | "riclassificazione" | "amministratore";

export type RigaClassificazione = {
  id: string;
  procedura_id: string;
  settore: SettoreRadar;
  livello: Livello;
  sottocategorie: string[];
  regole: string[];
  motivi: string[];
  da: "cpv" | "parole_chiave";
  cpv: string[];
  versione_regole: string;
  origine: OrigineClassificazione;
  fonti: string[];
  ambigua: boolean;
  nota: string | null;
  autore: string | null;
  attiva: boolean;
  valida_dal: string;
  sostituita_il: string | null;
  sostituita_da: string | null;
};

const RANGO: Record<Livello, number> = { A: 0, B: 1, C: 2 };
const pertinente = (l: Livello) => l === "A" || l === "B";

export type ContestoRighe = {
  proceduraId: string;
  origine: Exclude<OrigineClassificazione, "amministratore">;
  fonti: readonly string[];
  autore: string | null;
  adessoIso: string;
  nuovoId: () => string;
  // le classificazioni delle singole fonti, se il chiamante le ha (unione appena fatta); i dati uniti sono «c»
  perFonte?: readonly ClassificazioneArchivio[];
  // la colonna «settori» della gara com'è adesso (mai modificata da qui)
  settoriColonna?: readonly string[];
};

/** Le righe che descrivono la gara secondo le regole correnti: una per settore considerato (anche C). */
export function righeDaClassificazione(c: ClassificazioneArchivio, x: ContestoRighe): RigaClassificazione[] {
  const tutte = [c, ...(x.perFonte ?? [])];
  const settori = [...new Set(tutte.flatMap((k) => Object.keys(k.perSettore) as SettoreRadar[]))];
  const out: RigaClassificazione[] = [];
  for (const settore of settori) {
    const candidati = tutte.map((k) => k.perSettore[settore]).filter((v): v is ValutazioneSettore => !!v);
    // il migliore: A prima di B prima di C; a parità, i dati uniti (il primo dell'elenco)
    const v = candidati.reduce((m, y) => (RANGO[y.livello] < RANGO[m.livello] ? y : m));
    const livelliDiversi = new Set(candidati.map((y) => y.livello)).size > 1;
    // un'altra classificazione che non vede il settore mentre questa lo dà pertinente: anche questo è un disaccordo
    const assente = pertinente(v.livello) && tutte.some((k) => !k.perSettore[settore]);
    const colonna = x.settoriColonna ? x.settoriColonna.includes(settore) !== pertinente(v.livello) : false;
    out.push({
      id: x.nuovoId(),
      procedura_id: x.proceduraId,
      settore,
      livello: v.livello,
      sottocategorie: v.livello === "C" ? [] : v.sottocategorie.slice(0, 10),
      regole: (v.regole.length ? v.regole : [v.regola]).slice(0, 10),
      motivi: v.motivi.slice(0, 10).map((m) => m.slice(0, 300)),
      da: v.da,
      cpv: v.da === "cpv" ? v.cpv.slice(0, 50) : [],
      versione_regole: c.versione,
      origine: x.origine,
      fonti: [...new Set(x.fonti)].sort(),
      ambigua: livelliDiversi || assente || colonna,
      nota: null,
      autore: x.autore,
      attiva: true,
      valida_dal: x.adessoIso,
      sostituita_il: null,
      sostituita_da: null,
    });
  }
  return out.sort((a, b) => a.settore.localeCompare(b.settore));
}

// Due classificazioni dello stesso settore sono «uguali» se dicono la stessa cosa con le stesse regole: livello, sottocategorie, regole,
// provenienza del settore, CPV, versione e ambiguità. Origine, fonti, autore e motivi (che si ricavano da regole e versione) non contano.
export function stessaClassificazione(a: RigaClassificazione, b: RigaClassificazione): boolean {
  const k = (r: RigaClassificazione) => JSON.stringify([r.settore, r.livello, r.sottocategorie, r.regole, r.da, [...r.cpv].sort(), r.versione_regole, r.ambigua]);
  return k(a) === k(b);
}

export type Aggiornamento = {
  inserisci: RigaClassificazione[];
  disattiva: { id: string; sostituita_il: string; sostituita_da: string | null }[];
  // calcoli automatici diversi da una decisione dell'amministratore: non applicati, solo segnalati
  protette: { settore: SettoreRadar; decisione: RigaClassificazione; calcolata: RigaClassificazione }[];
  invariate: number;
};

/**
 * Che cosa scrivere per passare dalle righe ATTIVE di una gara a quelle calcolate ora. Mai cancellazioni: una riga cambiata si disattiva e
 * si sostituisce; un settore che non c'è più si disattiva senza sostituta; le decisioni dell'amministratore restano.
 */
export function aggiornamentoClassificazioni(attive: readonly RigaClassificazione[], calcolate: readonly RigaClassificazione[], adessoIso: string): Aggiornamento {
  const out: Aggiornamento = { inserisci: [], disattiva: [], protette: [], invariate: 0 };
  const perSettore = new Map(attive.filter((r) => r.attiva).map((r) => [r.settore, r]));
  for (const n of calcolate) {
    const a = perSettore.get(n.settore);
    if (a && a.origine === "amministratore" && n.origine !== "amministratore") {
      if (!stessaClassificazione({ ...a, ambigua: n.ambigua }, n)) out.protette.push({ settore: n.settore, decisione: a, calcolata: n });
      else out.invariate++;
      continue;
    }
    if (a && stessaClassificazione(a, n)) {
      out.invariate++;
      continue;
    }
    out.inserisci.push(n);
    if (a) out.disattiva.push({ id: a.id, sostituita_il: adessoIso, sostituita_da: n.id });
  }
  const calcolati = new Set(calcolate.map((n) => n.settore));
  for (const a of perSettore.values()) {
    if (calcolati.has(a.settore)) continue;
    // un settore che le regole non vedono più: la riga si chiude (non si cancella); quelle dell'amministratore restano
    if (a.origine === "amministratore") continue;
    out.disattiva.push({ id: a.id, sostituita_il: adessoIso, sostituita_da: null });
  }
  return out;
}

/** La decisione di un amministratore su un settore: sostituisce la riga attiva (che resta nello storico), sempre con una nota. */
export function decisioneAmministratore(attiva: RigaClassificazione | null, d: { proceduraId: string; settore: SettoreRadar; livello: Livello; sottocategorie: string[]; nota: string; autore: string; versione: string; adessoIso: string; nuovoId: () => string }): Aggiornamento {
  const nota = d.nota.trim().slice(0, 1000);
  if (!nota) throw new Error("La decisione dell'amministratore richiede una nota.");
  const n: RigaClassificazione = {
    id: d.nuovoId(),
    procedura_id: d.proceduraId,
    settore: d.settore,
    livello: d.livello,
    sottocategorie: d.livello === "C" ? [] : d.sottocategorie.slice(0, 10),
    regole: ["decisione_amministratore"],
    motivi: [nota.slice(0, 300)],
    da: attiva?.da ?? "cpv",
    cpv: attiva?.da === "parole_chiave" ? [] : (attiva?.cpv ?? []),
    versione_regole: d.versione,
    origine: "amministratore",
    fonti: attiva?.fonti ?? [],
    ambigua: false,
    nota,
    autore: d.autore,
    attiva: true,
    valida_dal: d.adessoIso,
    sostituita_il: null,
    sostituita_da: null,
  };
  return { inserisci: [n], disattiva: attiva ? [{ id: attiva.id, sostituita_il: d.adessoIso, sostituita_da: n.id }] : [], protette: [], invariate: 0 };
}

/**
 * Ripristino (reversibilità): le righe che una gara aveva con una versione precedente delle regole tornano attive come righe NUOVE (copie
 * con origine «riclassificazione» e una nota), così lo storico resta intero. Si confrontano poi con le attive come ogni altro calcolo.
 */
export function righeDaRipristinare(storico: readonly RigaClassificazione[], versione: string, x: { autore: string; adessoIso: string; nuovoId: () => string }): RigaClassificazione[] {
  const ultime = new Map<SettoreRadar, RigaClassificazione>();
  for (const r of [...storico].filter((r) => r.versione_regole === versione).sort((a, b) => a.valida_dal.localeCompare(b.valida_dal))) ultime.set(r.settore, r);
  return [...ultime.values()].map((r) => ({
    ...r,
    id: x.nuovoId(),
    origine: "riclassificazione" as const,
    nota: `Ripristino della classificazione con le regole ${versione}.`,
    autore: x.autore,
    attiva: true,
    valida_dal: x.adessoIso,
    sostituita_il: null,
    sostituita_da: null,
  }));
}

/**
 * La regola UNICA dei suggerimenti alle imprese (D-C9, decisione dell'utente del 17/11): solo le gare con una classificazione ATTIVA di
 * livello A in uno dei settori dell'impresa. Le correlate (B) si vedono nei risultati di settore con la loro etichetta, mai suggerite; le
 * non pertinenti (C) mai, anche se conservate nell'archivio. Una gara senza righe (prima della riclassificazione) non si suggerisce da qui.
 */
export function gareSuggeribili(righeAttive: readonly Pick<RigaClassificazione, "procedura_id" | "settore" | "livello" | "attiva">[], settoriImpresa: readonly string[]): string[] {
  const settori = new Set(settoriImpresa);
  return [...new Set(righeAttive.filter((r) => r.attiva && r.livello === "A" && settori.has(r.settore)).map((r) => r.procedura_id))].sort();
}
