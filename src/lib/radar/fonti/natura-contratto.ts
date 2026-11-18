// La regola della NATURA DEL CONTRATTO, una sola per tutte le fonti (TED, PVL, Sintel, SardegnaCAT), per la classificazione dell'archivio
// (classificazione-unita.ts) e quindi anche per la riclassificazione e per gli importatori con l'interruttore acceso (fase B3, 18/11/2026).
// Logica pura, nessuna espressione sulle parole: decide sul risultato di classificaGara (settori.ts, regole della PVL). Provata da
// scripts/verifica-radar-classificazione.ts (sezione 9, con le mutazioni).
//
// Regola di sempre (fasi B2a e B2b): una gara trovata SOLO per parola chiave (nessun CPV del file tenuto) deve essere un appalto di servizi,
// di natura mista o non indicata; altrimenti il settore è escluso, «per non prendere lavori e forniture che puliscono».
//
// Eccezione D2 (decisione dell'utente del 18/11, buoni pasto): «La parola "fornitura" non deve escludere automaticamente un vero servizio
// sostitutivo di mensa.» La «fornitura di buoni pasto» è il servizio stesso. Quindi la natura «forniture» NON esclude la ristorazione quando
// le regole della PVL vi riconoscono il servizio sostitutivo di mensa o di buoni pasto, cioè una valutazione A o B con la sottocategoria
// «servizi_sostitutivi_mensa» (B: servizio sostitutivo; A: con una gestione autonoma della mensa). Tutto il resto resta com'era:
//   - la stampa di tessere, badge o materiali è già C per le regole della PVL («buoni_pasto_senza_servizio»), e resta C;
//   - nessun altro settore e nessun'altra fornitura cambia (cancelleria, detersivi, pasti: come prima), nemmeno nella stessa gara;
//   - i LAVORI restano esclusi anche con i buoni pasto: l'eccezione è solo per la natura «forniture».
import type { Livello, SettoreRadar } from "../settori";

export type NaturaContratto = "servizi" | "forniture" | "lavori" | "misto";

const NATURE_AMMESSE_PER_PAROLE: ReadonlySet<string> = new Set(["servizi", "misto"]);

// La sottocategoria della ristorazione per i servizi sostitutivi di mensa e i buoni pasto (SOTTOCATEGORIE di settori.ts; la prova controlla
// che esista ancora con questo id).
export const SOTTOCATEGORIA_SOSTITUTIVI_MENSA = "servizi_sostitutivi_mensa";

export type ValutazionePerNatura = { settore: SettoreRadar; livello: Livello; sottocategorie: readonly string[] };

/** Vero servizio sostitutivo di mensa o di buoni pasto, riconosciuto dalle regole della PVL (A o B, con la sua sottocategoria). */
export function servizioSostitutivoMensa(v: ValutazionePerNatura): boolean {
  return v.settore === "ristorazione" && v.livello !== "C" && v.sottocategorie.includes(SOTTOCATEGORIA_SOSTITUTIVI_MENSA);
}

/** true = il settore di questa valutazione è escluso dalla natura del contratto. */
export function esclusoPerNatura(metodo: "cpv" | "parole_chiave" | null, natura: string | null, v: ValutazionePerNatura): boolean {
  if (metodo !== "parole_chiave" || !natura || NATURE_AMMESSE_PER_PAROLE.has(natura)) return false;
  // eccezione D2: solo la natura «forniture», solo il servizio sostitutivo di mensa
  return !(natura === "forniture" && servizioSostitutivoMensa(v));
}

/**
 * I settori della gara che restano dopo la regola della natura, nell'ordine della classificazione: gli STESSI se la regola non esclude nulla
 * (così una gara di servizi, o riconosciuta dai CPV, non cambia in nulla), nessuno se esclude tutto (la gara resta fuori, come prima).
 */
export function settoriDopoNatura(
  c: { settori: readonly SettoreRadar[]; metodo: "cpv" | "parole_chiave" | null; valutazioni: readonly ValutazionePerNatura[] },
  natura: string | null,
): SettoreRadar[] {
  return c.settori.filter((s) => !esclusoPerNatura(c.metodo, natura, c.valutazioni.find((v) => v.settore === s) ?? { settore: s, livello: "A", sottocategorie: [] }));
}
