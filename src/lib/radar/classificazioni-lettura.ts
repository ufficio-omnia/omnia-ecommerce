// Fase B3, interfaccia (18/11/2026): lettura delle classificazioni della 0121 per le schermate dei clienti (Cerca, scheda, Monitorate).
//
//   - SOLO server: radar_classificazioni e radar_classificazioni_stato sono leggibili dal solo service_role (0121). Si leggono con il client
//     di servizio già usato per l'archivio pubblico, dopo le guardie della pagina; nel browser arriva solo il testo da mostrare.
//   - SOLO lettura e SOLO con l'interruttore acceso (classificazioniAttive, ambiente.ts: spento di base, acceso solo sullo staging): spento,
//     queste colonne non si chiedono e le pagine restano come prima.
//   - NESSUNA richiesta in più: le righe arrivano nella STESSA richiesta della gara o dell'elenco. Le due tabelle hanno una sola chiave esterna
//     verso radar_procedure (procedura_id), quindi l'incorporamento di PostgREST non è ambiguo. Solo le righe attive (le storiche restano nel
//     database per la cronologia).
//
// Rilevanza settoriale, NON ammissibilità dell'impresa (classificazioni-calcoli.ts di B2). Una gara senza stato è «non ancora classificata»
// e una gara senza righe non è mai «non pertinente» (decisione D2). Logica pura qui sotto: nessuna chiamata al database.
import { SETTORI_RADAR, nomeSettore, nomeSottocategoria, type SettoreRadar } from "./settori";

export type LivelloRilevanza = "A" | "B" | "C";
export type StatoLettura = "classificata" | "in_attesa" | "fallita" | "non_classificata";

/** Da aggiungere alla select degli elenchi (Cerca, Monitorate): stato e, per settore, livello e sottocategorie. */
export const CLASSIFICAZIONI_ELENCO =
  "classificazione_stato:radar_classificazioni_stato(stato), classificazioni:radar_classificazioni(settore, rilevanza, sottocategorie, attiva)";

/** Da aggiungere alla select della scheda: anche motivi, regole, versione, provenienza (CPV o parole chiave), fonti e ambiguità. */
export const CLASSIFICAZIONI_SCHEDA =
  "classificazione_stato:radar_classificazioni_stato(stato, versione_regole, classificata_il, errore), classificazioni:radar_classificazioni(settore, rilevanza, sottocategorie, regole, motivi, versione_regole, da, fonti, ambigua, attiva)";

/** Filtro sulle righe incorporate (non sulle gare): solo le righe attive. */
export const COLONNA_RIGHE_ATTIVE = "classificazioni.attiva";

type StatoIncorporato = { stato: "classificata" | "in_attesa" | "fallita"; versione_regole?: string | null; classificata_il?: string | null; errore?: string | null };
type RigaIncorporata = {
  settore: string;
  rilevanza: LivelloRilevanza;
  sottocategorie: string[] | null;
  attiva?: boolean | null;
  regole?: string[] | null;
  motivi?: string[] | null;
  versione_regole?: string | null;
  da?: string | null;
  fonti?: string[] | null;
  ambigua?: boolean | null;
};

/** Le due colonne incorporate, come le restituisce PostgREST (lo stato è uno a uno: oggetto; per sicurezza si accetta anche un elenco). */
export type ConClassificazioni = {
  classificazione_stato?: StatoIncorporato | StatoIncorporato[] | null;
  classificazioni?: RigaIncorporata[] | null;
};

export type SettoreClassificato = {
  settore: SettoreRadar;
  nome: string;
  livello: LivelloRilevanza;
  etichettaLivello: string;
  sottocategorie: { id: string; nome: string }[];
  motivi: string[];
  versione: string | null;
  daCpv: boolean;
  fonti: string[];
  ambigua: boolean;
};

export type ClassificazioneLetta = {
  stato: StatoLettura;
  versione: string | null;
  classificataIl: string | null;
  errore: string | null;
  // in ordine: pertinenti (A), correlati (B), non pertinenti (C); a parità, l'ordine dei settori di Tender Intelligence
  settori: SettoreClassificato[];
};

export const ETICHETTA_LIVELLO: Record<LivelloRilevanza, string> = { A: "Pertinente", B: "Correlata", C: "Non pertinente" };

export const SPIEGAZIONE_LIVELLO: Record<LivelloRilevanza, string> = {
  A: "il servizio richiesto rientra nel settore",
  B: "appalto misto, concessione o gestione complessa che comprende servizi del settore: va valutato per intero",
  C: "l'oggetto non rientra nel settore: la gara resta consultabile, ma non è suggerita",
};

const ORDINE_LIVELLO: Record<LivelloRilevanza, number> = { A: 0, B: 1, C: 2 };
const ORDINE_SETTORE = new Map<string, number>(SETTORI_RADAR.map((s, i) => [s.id, i]));

function eSettore(x: string): x is SettoreRadar {
  return ORDINE_SETTORE.has(x);
}

function statoIncorporato(r: ConClassificazioni): StatoIncorporato | null {
  const s = r.classificazione_stato;
  if (!s) return null;
  return Array.isArray(s) ? (s[0] ?? null) : s;
}

/** La classificazione di una gara dalle colonne incorporate. Senza stato: «non_classificata» (mai C), anche se ci fossero righe. */
export function classificazioneDaRiga(r: ConClassificazioni): ClassificazioneLetta {
  const s = statoIncorporato(r);
  const righe = (r.classificazioni ?? []).filter((x) => x.attiva !== false && eSettore(x.settore) && (x.rilevanza === "A" || x.rilevanza === "B" || x.rilevanza === "C"));
  const settori: SettoreClassificato[] = righe
    .map((x) => {
      const settore = x.settore as SettoreRadar;
      const sottocategorie = x.rilevanza === "C" ? [] : (x.sottocategorie ?? []).map((id) => ({ id, nome: nomeSottocategoria(settore, id) ?? id.replace(/_/g, " ") }));
      return {
        settore,
        nome: nomeSettore(settore),
        livello: x.rilevanza,
        etichettaLivello: ETICHETTA_LIVELLO[x.rilevanza],
        sottocategorie,
        motivi: (x.motivi ?? []).map((m) => m.trim()).filter(Boolean),
        versione: x.versione_regole ?? null,
        daCpv: x.da === "cpv",
        fonti: x.fonti ?? [],
        ambigua: x.ambigua === true,
      };
    })
    .sort((a, b) => ORDINE_LIVELLO[a.livello] - ORDINE_LIVELLO[b.livello] || (ORDINE_SETTORE.get(a.settore) ?? 99) - (ORDINE_SETTORE.get(b.settore) ?? 99));
  if (!s) return { stato: "non_classificata", versione: null, classificataIl: null, errore: null, settori: [] };
  return {
    stato: s.stato,
    versione: s.versione_regole ?? null,
    classificataIl: s.classificata_il ?? null,
    errore: s.stato === "fallita" ? (s.errore ?? "classificazione non riuscita") : null,
    // in attesa o fallita: le righe attive precedenti restano valide finché la nuova classificazione non riesce (classificazioni.ts)
    settori,
  };
}

/** Per la ricerca: stato e livello per settore (forma di RilevanzaRicerca in ricerca-calcoli.ts) più le sottocategorie dei settori A e B. */
export function rilevanzaPerRicerca(c: ClassificazioneLetta): {
  stato: StatoLettura;
  perSettore: Partial<Record<string, LivelloRilevanza>>;
  sottocategorie: Partial<Record<string, string[]>>;
} {
  const perSettore: Partial<Record<string, LivelloRilevanza>> = {};
  const sottocategorie: Partial<Record<string, string[]>> = {};
  for (const s of c.settori) {
    perSettore[s.settore] = s.livello;
    if (s.livello !== "C") sottocategorie[s.settore] = s.sottocategorie.map((x) => x.nome);
  }
  return { stato: c.stato, perSettore, sottocategorie };
}

/** Che cosa dire dello stato quando non è «classificata» (scheda e righe): mai «non pertinente». */
export function messaggioStato(c: Pick<ClassificazioneLetta, "stato" | "errore">): string | null {
  if (c.stato === "in_attesa") return "Classificazione in corso: i settori mostrati sono quelli della classificazione precedente o della fonte.";
  if (c.stato === "fallita") return "Classificazione da verificare: l'ultima classificazione automatica non è riuscita. I settori mostrati sono quelli precedenti.";
  if (c.stato === "non_classificata") return "Non ancora classificata con le regole attuali: i settori mostrati sono quelli indicati dalla fonte.";
  return null;
}
