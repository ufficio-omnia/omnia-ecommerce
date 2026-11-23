// Righe delle tabelle radar_classificazioni e radar_classificazioni_stato (migrazione 0121, PROGETTO non applicato): dal risultato del
// classificatore unico alle righe da scrivere, con lo storico e lo stato. Logica pura, provata da scripts/verifica-radar-0121.ts.
//
// RILEVANZA, NON AMMISSIBILITÀ: qui si dice quanto una gara è PERTINENTE ai settori monitorati (A pertinente, B correlata, C non pertinente).
// Non si dice nulla sui requisiti di un'impresa (l'ammissibilità spetterà a OMNIA Eligibility AI): per questo i nomi sono «rilevanza».
//
// Regole (decisioni dell'utente del 17/11/2026):
//   - una riga per gara e settore, con la rilevanza, più sottocategorie, regole, MOTIVI (uno per regola, mai vuoti), CPV e versione;
//   - la colonna «settori» della gara NON si tocca: le righe dicono che cosa dicono le regole; se non coincidono con la colonna, la riga è
//     «ambigua» (sono le gare da decidere con la riclassificazione autorizzata, mai cambiate da sole);
//   - gara di più fonti: per ogni settore la rilevanza migliore tra i dati uniti e le singole fonti (coerente con «settori», che è l'unione
//     delle fonti), con la rilevanza data da ciascuna fonte conservata («per_fonte»); se non sono d'accordo la riga è «ambigua»;
//   - storico: una classificazione uguale non si riscrive; una diversa DISATTIVA la precedente (sostituita_il, sostituita_da) e ne inserisce
//     una nuova; nulla si cancella; il ripristino reinserisce le righe di una versione precedente;
//   - la decisione di un AMMINISTRATORE non viene mai sostituita da un calcolo automatico: il calcolo diverso resta solo segnalato;
//   - STATO (D2): «non pertinente» è SOLO una gara classificata con righe C e nessuna A o B. Una gara senza righe, in attesa o con la
//     classificazione fallita NON è mai non pertinente: né nei suggerimenti, né in Cerca, né nella scheda.
import { MOTIVI_DA_VERIFICARE, type DaVerificare, type Livello, type SettoreRadar } from "./settori";
import type { ClassificazioneArchivio, ValutazioneSettore } from "./classificazione-unita";

export type Rilevanza = Livello;
export type OrigineClassificazione = "importazione" | "riclassificazione" | "amministratore";

export type RigaClassificazione = {
  id: string;
  procedura_id: string;
  settore: SettoreRadar;
  // rilevanza settoriale (non ammissibilità)
  rilevanza: Rilevanza;
  sottocategorie: string[];
  regole: string[];
  // un motivo per ogni regola, nello stesso ordine, mai vuoto (D1)
  motivi: string[];
  da: "cpv" | "parole_chiave";
  cpv: string[];
  versione_regole: string;
  origine: OrigineClassificazione;
  fonti: string[];
  // provenienze: la rilevanza data da ciascuna fonte e dai dati uniti («dati_uniti») per questo settore (D3)
  per_fonte: Record<string, Rilevanza>;
  ambigua: boolean;
  nota: string | null;
  autore: string | null;
  attiva: boolean;
  valida_dal: string;
  sostituita_il: string | null;
  sostituita_da: string | null;
};

// «da_verificare» (S4 del 49A/49C, migrazione 0133): una gara che le regole non sanno decidere senza una descrizione utile. Le righe C
// restano; non è mai «non pertinente» né «fuori dai settori», non entra nei suggerimenti né nelle notifiche (tutti vogliono «classificata»);
// l'amministratore la decide dalla console (decisioneAmministratore) e lo stato torna «classificata».
export type StatoClassificazione = "in_attesa" | "classificata" | "fallita" | "da_verificare";
export const REGOLA_DA_VERIFICARE = "da_verificare";

/**
 * Il caso S4 (immobile con CPV di ristorazione, stabulari, biblioteca) di una riga «da_verificare», dal MOTIVO scritto accanto alla regola:
 * i tre motivi sono uno per caso e tutti diversi (MOTIVI_DA_VERIFICARE di settori.ts), quindi il caso non dipende dal settore candidato.
 * null se la riga non ha la regola o se il motivo non è uno dei tre (mai un caso indovinato). Stessa normalizzazione dei motivi delle righe.
 */
export function casoDaRigaDaVerificare(riga: Pick<RigaClassificazione, "regole" | "motivi">): DaVerificare["caso"] | null {
  const i = riga.regole.indexOf(REGOLA_DA_VERIFICARE);
  if (i < 0) return null;
  const motivo = (riga.motivi[i] ?? "").trim();
  const voce = (Object.entries(MOTIVI_DA_VERIFICARE) as [DaVerificare["caso"], string][]).find(([, m]) => m.trim().slice(0, 300) === motivo);
  return voce ? voce[0] : null;
}
export type RigaStato = {
  procedura_id: string;
  stato: StatoClassificazione;
  versione_regole: string | null;
  classificata_il: string | null;
  tentativi: number;
  tentativo_il: string | null;
  errore: string | null;
  aggiornata_il: string;
};

const RANGO: Record<Rilevanza, number> = { A: 0, B: 1, C: 2 };
const pertinente = (l: Rilevanza) => l === "A" || l === "B";
const pieno = (t: string | null | undefined) => typeof t === "string" && t.trim().length > 0;

// D1: i motivi sono uno per regola e mai vuoti. Se il classificatore ne dà di meno (campi singoli) o vuoti, il motivo si ricava dalla
// regola e dalla versione: mai una riga senza spiegazione.
export function motiviPerRegole(regole: readonly string[], motivi: readonly string[], versione: string): string[] {
  return regole.map((r, i) => (pieno(motivi[i]) ? (motivi[i] as string).trim().slice(0, 300) : `Regola «${r}» (regole ${versione})`));
}

/** I controlli della 0121 sulla riga, rifatti nel codice prima di scrivere: elenco degli errori (vuoto se la riga è valida). */
export function erroriRiga(r: RigaClassificazione): string[] {
  const e: string[] = [];
  if (r.regole.length < 1 || r.regole.length > 10) e.push("regole: da 1 a 10");
  if (r.regole.some((x) => !/^[a-z0-9_]{2,60}$/.test(x))) e.push("regole: forma");
  if (r.motivi.length !== r.regole.length) e.push("motivi: uno per regola");
  if (r.motivi.some((m) => !pieno(m) || m.includes("\u0001"))) e.push("motivi: nessuno vuoto");
  if (r.motivi.join("").length > 3000) e.push("motivi: troppo lunghi");
  if (r.sottocategorie.length > 10 || r.sottocategorie.some((x) => !/^[a-z0-9_]{2,60}$/.test(x))) e.push("sottocategorie: forma");
  if (r.rilevanza === "C" && r.sottocategorie.length > 0) e.push("C senza sottocategorie");
  if (r.da !== "cpv" && r.cpv.length > 0) e.push("CPV solo se il settore viene dai CPV");
  if (r.cpv.some((x) => !/^[0-9]{8}$/.test(x))) e.push("cpv: forma");
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}[a-z]?$/.test(r.versione_regole)) e.push("versione: forma");
  if (r.nota !== null && (!pieno(r.nota) || r.nota.length > 1000)) e.push("nota: mai vuota né fatta di soli spazi");
  if (r.origine === "amministratore" && r.nota === null) e.push("nota obbligatoria per l'amministratore");
  if (Object.values(r.per_fonte).some((v) => v !== "A" && v !== "B" && v !== "C")) e.push("per_fonte: solo A, B, C");
  return e;
}

export type ClassificazioneDiFonte = { fonte: string; classificazione: ClassificazioneArchivio };

export type ContestoRighe = {
  proceduraId: string;
  origine: Exclude<OrigineClassificazione, "amministratore">;
  fonti: readonly string[];
  autore: string | null;
  adessoIso: string;
  nuovoId: () => string;
  // le classificazioni delle singole fonti, se il chiamante le ha (unione appena fatta); i dati uniti sono «c»
  perFonte?: readonly ClassificazioneDiFonte[];
  // la colonna «settori» della gara com'è adesso (mai modificata da qui)
  settoriColonna?: readonly string[];
};

/** Le righe che descrivono la gara secondo le regole correnti: una per settore considerato (anche C). */
export function righeDaClassificazione(c: ClassificazioneArchivio, x: ContestoRighe): RigaClassificazione[] {
  const tutte: ClassificazioneDiFonte[] = [{ fonte: "dati_uniti", classificazione: c }, ...(x.perFonte ?? [])];
  const settori = [...new Set(tutte.flatMap((k) => Object.keys(k.classificazione.perSettore) as SettoreRadar[]))];
  const out: RigaClassificazione[] = [];
  for (const settore of settori) {
    const candidati = tutte.map((k) => ({ fonte: k.fonte, v: k.classificazione.perSettore[settore] })).filter((y): y is { fonte: string; v: ValutazioneSettore } => !!y.v);
    // la migliore: A prima di B prima di C; a parità, i dati uniti (il primo dell'elenco)
    const v = candidati.reduce((m, y) => (RANGO[y.v.livello] < RANGO[m.v.livello] ? y : m)).v;
    const perFonte: Record<string, Rilevanza> = Object.fromEntries(candidati.map((y) => [y.fonte, y.v.livello]));
    const rilevanzeDiverse = new Set(candidati.map((y) => y.v.livello)).size > 1;
    // un'altra classificazione che non vede il settore mentre questa lo dà pertinente: anche questo è un disaccordo
    const assente = pertinente(v.livello) && tutte.some((k) => !k.classificazione.perSettore[settore]);
    const colonna = x.settoriColonna ? x.settoriColonna.includes(settore) !== pertinente(v.livello) : false;
    const regole = (v.regole.length ? v.regole : [v.regola]).slice(0, 10);
    out.push({
      id: x.nuovoId(),
      procedura_id: x.proceduraId,
      settore,
      rilevanza: v.livello,
      sottocategorie: v.livello === "C" ? [] : v.sottocategorie.slice(0, 10),
      regole,
      motivi: motiviPerRegole(regole, v.motivi, c.versione),
      da: v.da,
      cpv: v.da === "cpv" ? v.cpv.slice(0, 50) : [],
      versione_regole: c.versione,
      origine: x.origine,
      fonti: [...new Set(x.fonti)].sort(),
      per_fonte: perFonte,
      ambigua: rilevanzeDiverse || assente || colonna,
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

/**
 * D3: la classificazione dopo che una NUOVA FONTE si è unita a una gara esistente: dati uniti più la fonte arrivata e la gara di prima,
 * ciascuna con il suo nome. È lo stesso calcolo del classificatore unico (classificazione-unita.ts); i conflitti finiscono in «ambigua» e
 * «per_fonte» (e, nel registro, nella segnalazione «classificazione_ambigua»).
 */
export function righeDopoUnione(x: {
  proceduraId: string;
  fonte: string;
  altreFonti: readonly string[];
  daFonte: ClassificazioneArchivio;
  altre: ClassificazioneArchivio;
  unita: ClassificazioneArchivio;
  settoriColonna: readonly string[];
  autore: string;
  adessoIso: string;
  nuovoId: () => string;
}): RigaClassificazione[] {
  const altre = [...new Set(x.altreFonti.filter((f) => f !== x.fonte))].sort();
  return righeDaClassificazione(x.unita, {
    proceduraId: x.proceduraId,
    origine: "importazione",
    fonti: [x.fonte, ...altre],
    autore: x.autore,
    adessoIso: x.adessoIso,
    nuovoId: x.nuovoId,
    perFonte: [{ fonte: x.fonte, classificazione: x.daFonte }, ...(altre.length ? [{ fonte: altre.join("+"), classificazione: x.altre }] : [])],
    settoriColonna: x.settoriColonna,
  });
}

// Due classificazioni dello stesso settore sono «uguali» se dicono la stessa cosa con le stesse regole: rilevanza, sottocategorie, regole,
// provenienza del settore, CPV, versione, ambiguità e rilevanze per fonte. Origine, fonti, autore e motivi (che si ricavano da regole e
// versione) non contano.
export function stessaClassificazione(a: RigaClassificazione, b: RigaClassificazione): boolean {
  const ordina = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).sort(([x], [y]) => x.localeCompare(y)));
  const k = (r: RigaClassificazione) => JSON.stringify([r.settore, r.rilevanza, r.sottocategorie, r.regole, r.da, [...r.cpv].sort(), r.versione_regole, r.ambigua, ordina(r.per_fonte)]);
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
      if (a.rilevanza !== n.rilevanza || JSON.stringify(a.sottocategorie) !== JSON.stringify(n.sottocategorie)) out.protette.push({ settore: n.settore, decisione: a, calcolata: n });
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

/** La decisione di un amministratore su un settore: sostituisce la riga attiva (che resta nello storico), sempre con una nota piena. */
export function decisioneAmministratore(attiva: RigaClassificazione | null, d: { proceduraId: string; settore: SettoreRadar; rilevanza: Rilevanza; sottocategorie: string[]; nota: string; autore: string; versione: string; adessoIso: string; nuovoId: () => string }): Aggiornamento {
  const nota = d.nota.trim().slice(0, 1000);
  if (!nota) throw new Error("La decisione dell'amministratore richiede una nota (non vuota, non fatta di soli spazi).");
  const n: RigaClassificazione = {
    id: d.nuovoId(),
    procedura_id: d.proceduraId,
    settore: d.settore,
    rilevanza: d.rilevanza,
    sottocategorie: d.rilevanza === "C" ? [] : d.sottocategorie.slice(0, 10),
    regole: ["decisione_amministratore"],
    motivi: [nota.slice(0, 300)],
    da: attiva?.da ?? "cpv",
    cpv: attiva?.da === "parole_chiave" ? [] : (attiva?.cpv ?? []),
    versione_regole: d.versione,
    origine: "amministratore",
    fonti: attiva?.fonti ?? [],
    per_fonte: attiva?.per_fonte ?? {},
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

// ───── stato della classificazione (D2) ─────

export type SituazioneGara =
  | { tipo: "non_classificata" } // nessuna riga di stato: mai valutata con le regole correnti
  | { tipo: "in_attesa" }
  | { tipo: "fallita"; errore: string }
  // S4: mai «non pertinente» né «fuori dai settori»; candidati = i settori delle righe «da_verificare» (o, senza regole, delle righe C)
  | { tipo: "da_verificare"; versione: string; candidati: SettoreRadar[] }
  | { tipo: "classificata"; versione: string; pertinenti: SettoreRadar[]; correlati: SettoreRadar[]; nonPertinenti: SettoreRadar[]; fuoriDaiSettori: boolean };

/** Che cosa si sa della rilevanza di una gara: lo stato decide, le righe dicono i settori. L'assenza di righe NON vale mai C. */
export function situazioneGara(
  stato: Pick<RigaStato, "stato" | "versione_regole" | "errore"> | null,
  righeAttive: readonly (Pick<RigaClassificazione, "settore" | "rilevanza" | "attiva"> & Partial<Pick<RigaClassificazione, "regole">>)[],
): SituazioneGara {
  if (!stato) return { tipo: "non_classificata" };
  if (stato.stato === "in_attesa") return { tipo: "in_attesa" };
  if (stato.stato === "fallita") return { tipo: "fallita", errore: stato.errore ?? "classificazione non riuscita" };
  if (stato.stato === "da_verificare") {
    const c = righeAttive.filter((r) => r.attiva && r.rilevanza === "C");
    const conRegola = c.filter((r) => (r.regole ?? []).includes(REGOLA_DA_VERIFICARE));
    return { tipo: "da_verificare", versione: stato.versione_regole ?? "", candidati: [...new Set((conRegola.length ? conRegola : c).map((r) => r.settore))].sort() };
  }
  if (stato.stato !== "classificata") return { tipo: "non_classificata" };
  const attive = righeAttive.filter((r) => r.attiva);
  const di = (l: Rilevanza) => attive.filter((r) => r.rilevanza === l).map((r) => r.settore).sort();
  const pertinenti = di("A");
  const correlati = di("B");
  const nonPertinenti = di("C");
  // fuori dai settori monitorati SOLO se classificata, con almeno una riga C e nessuna A o B (una gara senza righe resta «da verificare»)
  return { tipo: "classificata", versione: stato.versione_regole ?? "", pertinenti, correlati, nonPertinenti, fuoriDaiSettori: nonPertinenti.length > 0 && pertinenti.length === 0 && correlati.length === 0 };
}

/**
 * E: l'indicazione per la ricerca generale e la scheda. «Fuori dai settori monitorati» solo per una gara classificata non pertinente;
 * mai per una gara non ancora classificata o con la classificazione fallita (che non sono non pertinenti).
 */
export function etichettaRilevanza(s: SituazioneGara): string | null {
  if (s.tipo === "classificata") {
    if (s.fuoriDaiSettori) return "Fuori dai settori monitorati";
    if (s.pertinenti.length === 0 && s.correlati.length > 0) return "Correlata ai settori monitorati (appalto misto o gestione complessa)";
    return null;
  }
  if (s.tipo === "fallita") return "Classificazione da verificare";
  // S4: diverso da «fallita» (testo proposto nel 49C §4.2)
  if (s.tipo === "da_verificare") return "Classificazione in verifica";
  return null;
}

/**
 * La regola UNICA dei suggerimenti alle imprese (Radar personalizzato e notifiche di settore, D-C9 e decisione dell'utente del 17/11): solo
 * le gare CLASSIFICATE (stato «classificata») con una riga ATTIVA di rilevanza A in uno dei settori dell'impresa. Mai B, mai C, mai righe
 * storiche, mai gare in attesa o con la classificazione fallita, mai gare senza stato. Gare UNITE (pacchetto 16, punto 9): le copie collegate a
 * un'altra gara (unita_a) sono classificate ma non si suggeriscono mai; il cliente vede una sola opportunità, quella canonica.
 */
export function gareSuggeribili(
  righeAttive: readonly Pick<RigaClassificazione, "procedura_id" | "settore" | "rilevanza" | "attiva">[],
  stati: ReadonlyMap<string, Pick<RigaStato, "stato">>,
  settoriImpresa: readonly string[],
  collegate: ReadonlySet<string> = new Set(),
): string[] {
  const settori = new Set(settoriImpresa);
  return [...new Set(righeAttive.filter((r) => r.attiva && r.rilevanza === "A" && settori.has(r.settore) && !collegate.has(r.procedura_id) && stati.get(r.procedura_id)?.stato === "classificata").map((r) => r.procedura_id))].sort();
}

/**
 * LA regola unica di S4 (popolamento, riclassificazione e importatori): una gara va «da_verificare» se le regole hanno casi da verificare,
 * nessuna riga (calcolata o decisa dall'amministratore) è A o B, e l'amministratore non ha già deciso uno dei settori candidati: la sua
 * decisione chiude il caso e lo stato resta «classificata» (49C §4.2).
 */
export function eDaVerificare(
  casi: readonly { settore: string }[] | null | undefined,
  calcolate: readonly Pick<RigaClassificazione, "rilevanza">[],
  attive: readonly Pick<RigaClassificazione, "settore" | "rilevanza" | "attiva" | "origine">[],
): boolean {
  if (!casi?.length) return false;
  const decise = attive.filter((a) => a.attiva && a.origine === "amministratore");
  if (casi.some((c) => decise.some((d) => d.settore === c.settore))) return false;
  return ![...calcolate, ...decise].some((r) => r.rilevanza === "A" || r.rilevanza === "B");
}

/**
 * Lo stato dopo un tentativo: riuscito (versione e data della classificazione) o fallito (errore pieno, righe precedenti intatte). Riuscito
 * con `daVerificare` (S4): stato «da_verificare», con versione e date come una classificata ed errore nullo (vincoli della 0121 e 0133).
 */
export function statoDopoTentativo(prima: Pick<RigaStato, "versione_regole" | "classificata_il" | "tentativi"> | null, esito: { ok: true; versione: string; daVerificare?: boolean } | { ok: false; errore: string }, proceduraId: string, adessoIso: string): RigaStato {
  const tentativi = (prima?.tentativi ?? 0) + 1;
  if (esito.ok) return { procedura_id: proceduraId, stato: esito.daVerificare ? "da_verificare" : "classificata", versione_regole: esito.versione, classificata_il: adessoIso, tentativi, tentativo_il: adessoIso, errore: null, aggiornata_il: adessoIso };
  const errore = pieno(esito.errore) ? esito.errore.trim().slice(0, 1000) : "Classificazione non riuscita";
  return { procedura_id: proceduraId, stato: "fallita", versione_regole: prima?.versione_regole ?? null, classificata_il: prima?.classificata_il ?? null, tentativi, tentativo_il: adessoIso, errore, aggiornata_il: adessoIso };
}

// ───── conservazione delle gare non pertinenti (E, opzione A approvata il 17/11) ─────

/**
 * Se una gara che le regole danno NON pertinente va conservata (metadati essenziali già ricevuti, nessuna lettura in più). TED e PVL: sì,
 * perché le loro query sono già filtrate sui CPV del file approvato. Fonti regionali (elenchi completi della regione): solo con almeno un
 * CPV del file approvato. Mai una gara senza alcun settore considerato (nessun CPV del file, nessuna parola chiave).
 */
export function conservaComeNonPertinente(x: { fonte: string; classificazione: ClassificazioneArchivio; cpvTutti: readonly string[]; cpvDelFile: ReadonlySet<string> }): boolean {
  const valutazioni = Object.values(x.classificazione.perSettore).filter((v): v is ValutazioneSettore => !!v);
  const nonPertinente = x.classificazione.settori.length === 0 && valutazioni.length > 0 && valutazioni.every((v) => v.livello === "C");
  if (!nonPertinente) return false;
  if (x.fonte === "ted" || x.fonte === "pvl") return true;
  return x.cpvTutti.some((c) => x.cpvDelFile.has(c));
}
