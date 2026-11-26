// Il tipo di una gara come lo vede il cliente, negli elenchi e nella scheda (analisi 49 §4-§5, coordinamento 23/11/2026). Decisione
// dell'utente: un'indagine di mercato non va confusa con una gara aperta. Logica pura, provata da scripts/verifica-monitorate-fonti-nascoste.ts
// (sezione N).
//   - C4: tipo_opportunita è vuoto sulle gare già in archivio (sullo staging su tutte): in lettura il tipo si ricava dal tipo dell'avviso con
//     opportunitaDaTipoAvviso. Nessuna scrittura nel database;
//   - C11 (nome deciso dall'utente): le preinformazioni che indicono la gara, cioè TED «pin-cfc-*» e PVL P1_10–14 e P2_10–14 (piano 36 v2
//     §5, analisi 49 §4), sono «Avviso di preinformazione», non «Bando di gara». Per partecipare si presenta prima la candidatura o la
//     domanda di partecipazione. È solo un'etichetta: nel database il tipo resta «bando» (il valore è di B2);
//   - C5: tre gruppi per il filtro di «Cerca» (bandi, candidature, iscrizioni), applicato NEL DATABASE con condizioneTipi. Le condizioni
//     seguono le stesse regole di tipoDellaGara: la prova lo controlla su ogni combinazione di colonna e tipo dell'avviso. Se
//     opportunitaDaTipoAvviso riconosce un tipo di avviso nuovo (per esempio con C1), la prova cade finché non si aggiornano anche le condizioni.
import { ETICHETTA_OPPORTUNITA, opportunitaDaTipoAvviso, type TipoOpportunitaArchivio } from "./opportunita-calcoli";

export type TipoMostrato = TipoOpportunitaArchivio | "preinformazione";

const TIPI_ARCHIVIO: readonly string[] = ["bando", "manifestazione_interesse", "indagine_mercato", "sistema_qualificazione", "consultazione_preliminare"] satisfies readonly TipoOpportunitaArchivio[];

// i nomi sono quelli di opportunita-calcoli.ts; «Avviso di preinformazione» è il nome scelto dall'utente (C11)
export const ETICHETTA_TIPO: Record<TipoMostrato, string> = {
  bando: ETICHETTA_OPPORTUNITA.bando,
  manifestazione_interesse: ETICHETTA_OPPORTUNITA.manifestazione_interesse,
  indagine_mercato: ETICHETTA_OPPORTUNITA.indagine_mercato,
  sistema_qualificazione: ETICHETTA_OPPORTUNITA.sistema_qualificazione,
  consultazione_preliminare: ETICHETTA_OPPORTUNITA.consultazione_preliminare,
  preinformazione: "Avviso di preinformazione",
};

// Fase 2 (consultazioni preliminari, 26/11): la riga della scheda che dice che cosa è. Testo CONFERMATO dall'utente il 26/11 («va bene così»):
// da usare così
export const COME_SI_PARTECIPA_CONSULTAZIONE =
  "Consultazione preliminare di mercato: l'ente raccoglie informazioni e contributi dagli operatori prima di preparare la gara. Non è una gara né una candidatura: si risponde con le informazioni richieste entro il termine indicato.";

// C11: la riga della scheda che dice che cosa si presenta per partecipare
export const COME_SI_PARTECIPA_PREINFORMAZIONE =
  "Avviso di preinformazione che indice la gara: per partecipare si presenta la candidatura o la domanda di partecipazione entro il termine indicato; l'offerta si presenta dopo, su invito dell'ente.";

const PREFISSO_PREINFORMAZIONE_TED = "pin-cfc-";
export const SCHEDE_PREINFORMAZIONE_PVL: readonly string[] = ["P1_10", "P1_11", "P1_12", "P1_13", "P1_14", "P2_10", "P2_11", "P2_12", "P2_13", "P2_14"];

export function ePreinformazione(tipoAvviso: string | null | undefined): boolean {
  const t = tipoAvviso ?? "";
  return t.startsWith(PREFISSO_PREINFORMAZIONE_TED) || SCHEDE_PREINFORMAZIONE_PVL.includes(t);
}

// Colonna piena: il suo valore (solo se è un tipo dell'archivio). Colonna vuota: il tipo dell'avviso (C4). Un bando che è una
// preinformazione con indizione si mostra come tale (C11). null = tipo non riconosciuto: nessuna etichetta.
export function tipoDellaGara(g: { tipo_opportunita?: string | null; tipo_avviso?: string | null }): TipoMostrato | null {
  const colonna = g.tipo_opportunita ?? null;
  const tipo = colonna === null ? (opportunitaDaTipoAvviso(g.tipo_avviso)?.tipo ?? null) : TIPI_ARCHIVIO.includes(colonna) ? (colonna as TipoOpportunitaArchivio) : null;
  return tipo === "bando" && ePreinformazione(g.tipo_avviso) ? "preinformazione" : tipo;
}

// ───── C5: i gruppi del filtro di «Cerca» ─────

// Fase 2: «consultazioni» (consultazioni preliminari di mercato), DISTINTE da bandi e candidature (decisione dell'utente del 26/11)
export type CategoriaTipo = "bandi" | "candidature" | "iscrizioni" | "consultazioni";

/**
 * La voce «Consultazioni» nel filtro di «Cerca»: SPENTA finché l'utente non decide di mostrarla, INSIEME al testo della pagina pubblica
 * «Ricerca gare» (src/lib/ricerca-gare-testi.ts, verifica-testi-ricerca-gare B1.8), quando una fonte visibile ai clienti produce davvero
 * consultazioni. Spenta: nessuna casella vuota in «Cerca», il parametro «tipo=consultazioni» non si accetta. Il tipo, la sua etichetta e il
 * colore restano pronti per elenchi, scheda ed email.
 */
export const CONSULTAZIONI_IN_CERCA = false as boolean;

export const CATEGORIA_CONSULTAZIONI: { id: CategoriaTipo; etichetta: string; breve: string } = { id: "consultazioni", etichetta: "Consultazioni preliminari di mercato (prima della gara)", breve: "Consultazioni" };

export const CATEGORIE_TIPO: readonly { id: CategoriaTipo; etichetta: string; breve: string }[] = [
  { id: "bandi", etichetta: "Bandi di gara", breve: "Bandi di gara" },
  { id: "candidature", etichetta: "Candidature: manifestazioni di interesse, indagini di mercato, avvisi di preinformazione", breve: "Candidature" },
  { id: "iscrizioni", etichetta: "Iscrizioni: elenchi, sistemi di qualificazione, SDA", breve: "Iscrizioni" },
  ...(CONSULTAZIONI_IN_CERCA ? [CATEGORIA_CONSULTAZIONI] : []),
];

export const CATEGORIA_DEL_TIPO: Record<TipoMostrato, CategoriaTipo> = {
  bando: "bandi",
  preinformazione: "candidature",
  manifestazione_interesse: "candidature",
  indagine_mercato: "candidature",
  sistema_qualificazione: "iscrizioni",
  consultazione_preliminare: "consultazioni",
};

export function eCategoriaTipo(x: string): x is CategoriaTipo {
  return CATEGORIE_TIPO.some((c) => c.id === x);
}

// Condizioni PostgREST (sintassi dei filtri «or»), con le regole di tipoDellaGara. In SQL un confronto con un valore nullo non è mai vero:
// per questo «non è una preinformazione» comprende esplicitamente il tipo dell'avviso nullo (bandi di Sintel e SardegnaCAT).
const PREINFORMAZIONI_PVL = `(${SCHEDE_PREINFORMAZIONE_PVL.join(",")})`;
const PREINFORMAZIONE = `or(tipo_avviso.like.${PREFISSO_PREINFORMAZIONE_TED}*,tipo_avviso.in.${PREINFORMAZIONI_PVL})`;
const NON_PREINFORMAZIONE = `or(tipo_avviso.is.null,and(tipo_avviso.not.like.${PREFISSO_PREINFORMAZIONE_TED}*,tipo_avviso.not.in.${PREINFORMAZIONI_PVL}))`;
// opportunitaDaTipoAvviso (di B2): «cn-*», «pin-cfc-*» e le schede PVL «P1_*», «P2_*» = bando; «qu-sy» = iscrizione; C1 (23/11): la scheda
// PVL «P7_1_3» (avvio dell'indagine di mercato) = indagine di mercato, cioè una candidatura; «P7_3» (costituzione di un elenco) = iscrizione.
// Filtro nel database ed etichetta restano concordi (prova MT6)
const BANDO_DALL_AVVISO = `or(tipo_avviso.like.cn-*,tipo_avviso.like.${PREFISSO_PREINFORMAZIONE_TED}*,tipo_avviso.match.^P[12]_)`;
const CANDIDATURE_DALL_AVVISO = "P7_1_3";
const ISCRIZIONI_DALL_AVVISO = "(qu-sy,P7_3)";
const CONDIZIONE_TIPO: Record<CategoriaTipo, string> = {
  bandi: `and(tipo_opportunita.eq.bando,${NON_PREINFORMAZIONE}),and(tipo_opportunita.is.null,${BANDO_DALL_AVVISO},${NON_PREINFORMAZIONE})`,
  candidature: `tipo_opportunita.in.(manifestazione_interesse,indagine_mercato),and(tipo_opportunita.eq.bando,${PREINFORMAZIONE}),and(tipo_opportunita.is.null,${PREINFORMAZIONE}),and(tipo_opportunita.is.null,tipo_avviso.eq.${CANDIDATURE_DALL_AVVISO})`,
  iscrizioni: `tipo_opportunita.eq.sistema_qualificazione,and(tipo_opportunita.is.null,tipo_avviso.in.${ISCRIZIONI_DALL_AVVISO})`,
  // solo dalla colonna: nessun tipo di avviso di TED o PVL è una consultazione (opportunitaDaTipoAvviso non la riconosce)
  consultazioni: "tipo_opportunita.eq.consultazione_preliminare",
};

export function condizioneTipi(categorie: readonly CategoriaTipo[]): string {
  return [...new Set(categorie)].map((c) => CONDIZIONE_TIPO[c]).join(",");
}
