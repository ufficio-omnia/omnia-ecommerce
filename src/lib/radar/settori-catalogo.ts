// Catalogo STABILE delle sottocategorie (fase B4, filtri del profilo di ricerca e «Per te»). Logica pura: nessuna rete, nessun database.
// Provato da scripts/verifica-radar-b4-pvl.ts.
//
// Le sottocategorie e i loro nomi stanno in settori.ts (SOTTOCATEGORIE, regole 2026-11-18e): questo file NON le ripete, ne fissa gli
// IDENTIFICATIVI. Un profilo salvato conserva gli identificativi, quindi:
//   - un identificativo non si rinomina e non si riusa mai; il nome leggibile invece può cambiare liberamente (lo dà settori.ts);
//   - una sottocategoria nuova si AGGIUNGE in fondo a ID_STABILI del suo settore, nella stessa modifica che la aggiunge a SOTTOCATEGORIE;
//   - un identificativo da rinominare (o due sottocategorie da unire): il nuovo entra in ID_STABILI, il vecchio va in ALIAS verso il nuovo
//     e ci resta per sempre; il server traduce gli alias quando legge o salva un profilo; le righe già classificate cambiano solo con una
//     nuova versione delle regole e un popolamento autorizzato;
//   - una sottocategoria da togliere senza un sostituto va in RITIRATE: il server la toglie dai profili, con un avviso al titolare.
// Il database controlla solo la FORMA delle sottocategorie (0122, B2): l'appartenenza al catalogo la controlla il server con questo file,
// così il catalogo cambia senza migrazioni. Catalogo leggibile: TENDER_INTELLIGENCE_FASE0/25C_CATALOGO_SOTTOCATEGORIE.md.
import { SETTORI_RADAR, SOTTOCATEGORIE, type SettoreRadar } from "./settori";

// Identificativi stabili, per settore, nell'ordine di SOTTOCATEGORIE (il primo è la sottocategoria predefinita del settore). 22 voci al
// 19/11/2026 (regole 2026-11-18e): nessun identificativo è mai stato rinominato dalle regole 2026-11-17b.
export const ID_STABILI: Readonly<Record<SettoreRadar, readonly string[]>> = {
  pulizia: ["pulizia_edifici", "sanificazione", "disinfestazione"],
  ristorazione: [
    "mense",
    "catering",
    "distribuzione_pasti",
    "concessione_bar",
    "concessione_ristorante",
    "concessione_punto_ristoro",
    "distributori_automatici",
    "appalti_multiservizi",
    "servizi_sostitutivi_mensa",
  ],
  vigilanza_portierato: ["vigilanza_privata", "videosorveglianza_operativa", "portierato_reception", "presidio_accessi"],
  facchinaggio: ["traslochi", "facchinaggio_movimentazione", "logistica_magazzino"],
  multiservizi: ["facility_management", "gestione_impianti"],
  ausiliariato: ["ausiliariato"],
};

// Identificativo vecchio → identificativo stabile, per settore. Vuoto: finora nessun rinomina.
export const ALIAS_SOTTOCATEGORIE: Readonly<Record<SettoreRadar, Readonly<Record<string, string>>>> = {
  pulizia: {},
  ristorazione: {},
  vigilanza_portierato: {},
  facchinaggio: {},
  multiservizi: {},
  ausiliariato: {},
};

// Identificativi tolti senza sostituto. Vuoto.
export const SOTTOCATEGORIE_RITIRATE: Readonly<Record<SettoreRadar, readonly string[]>> = {
  pulizia: [],
  ristorazione: [],
  vigilanza_portierato: [],
  facchinaggio: [],
  multiservizi: [],
  ausiliariato: [],
};

// Sottocategorie che la classificazione assegna solo con le sue regole, non perché l'oggetto le nomina: si possono scegliere nel profilo,
// ma il nome da solo non le spiega (nota per l'interfaccia).
const SOLO_DALLE_REGOLE: Readonly<Record<string, string>> = {
  "ristorazione/appalti_multiservizi": "Ristorazione B dentro una gestione integrata o un appalto multiservizi",
};

// Massimo di identificativi per settore in un profilo (lo stesso limite del controllo di forma della 0122).
export const MASSIMO_PER_SETTORE = 30;

export type CatalogoSottocategorie = {
  idStabili: Readonly<Record<SettoreRadar, readonly string[]>>;
  alias: Readonly<Record<SettoreRadar, Readonly<Record<string, string>>>>;
  ritirate: Readonly<Record<SettoreRadar, readonly string[]>>;
};

export const CATALOGO: CatalogoSottocategorie = { idStabili: ID_STABILI, alias: ALIAS_SOTTOCATEGORIE, ritirate: SOTTOCATEGORIE_RITIRATE };

export type VoceCatalogo = { settore: SettoreRadar; id: string; nome: string; predefinita: boolean; nota: string | null };

// Le voci del catalogo, per settore e nell'ordine stabile, con il nome leggibile di settori.ts.
export function vociCatalogo(settore?: SettoreRadar): VoceCatalogo[] {
  const settori = settore ? [settore] : SETTORI_RADAR.map((s) => s.id);
  return settori.flatMap((s) =>
    ID_STABILI[s].map((id, i) => ({
      settore: s,
      id,
      nome: SOTTOCATEGORIE[s].find((x) => x.id === id)?.nome ?? id,
      predefinita: i === 0,
      nota: SOLO_DALLE_REGOLE[`${s}/${id}`] ?? null,
    })),
  );
}

export function eSettore(x: unknown): x is SettoreRadar {
  return typeof x === "string" && SETTORI_RADAR.some((s) => s.id === x);
}

export type Risolta = { id: string; daAlias: boolean };

// Un identificativo ricevuto (da un profilo salvato o da un modulo) → l'identificativo stabile, traducendo gli alias (anche a catena, senza
// cicli). null se non è nel catalogo o è ritirato.
export function risolviSottocategoria(settore: SettoreRadar, id: unknown, catalogo: CatalogoSottocategorie = CATALOGO): Risolta | null {
  if (typeof id !== "string") return null;
  let corrente = id.trim();
  let daAlias = false;
  const visti = new Set<string>();
  while (!catalogo.idStabili[settore].includes(corrente)) {
    const verso = catalogo.alias[settore][corrente];
    if (!verso || visti.has(corrente)) return null;
    visti.add(corrente);
    corrente = verso;
    daAlias = true;
  }
  if (catalogo.ritirate[settore].includes(corrente)) return null;
  return { id: corrente, daAlias };
}

export type Scartata = { settore: string; id: string; motivo: "settore_sconosciuto" | "settore_non_scelto" | "non_nel_catalogo" | "ritirata" | "non_testo" | "oltre_il_massimo" };

// Le sottocategorie di un profilo ({"<settore>": ["<id>", …]}) ripulite sul catalogo: solo settori scelti, solo identificativi del catalogo
// (alias tradotti), senza doppioni, nell'ordine stabile. Tutto ciò che si scarta torna con il motivo: niente sparisce in silenzio.
export function normalizzaSottocategorieProfilo(
  scelte: unknown,
  settoriScelti: readonly SettoreRadar[],
  catalogo: CatalogoSottocategorie = CATALOGO,
): { sottocategorie: Partial<Record<SettoreRadar, string[]>>; scartate: Scartata[]; tradotte: { settore: SettoreRadar; da: string; a: string }[] } {
  const sottocategorie: Partial<Record<SettoreRadar, string[]>> = {};
  const scartate: Scartata[] = [];
  const tradotte: { settore: SettoreRadar; da: string; a: string }[] = [];
  if (!scelte || typeof scelte !== "object" || Array.isArray(scelte)) return { sottocategorie, scartate, tradotte };
  for (const [settore, valori] of Object.entries(scelte as Record<string, unknown>)) {
    const lista = Array.isArray(valori) ? valori : [valori];
    if (!eSettore(settore)) {
      for (const v of lista) scartate.push({ settore, id: String(v), motivo: "settore_sconosciuto" });
      continue;
    }
    if (!settoriScelti.includes(settore)) {
      for (const v of lista) scartate.push({ settore, id: String(v), motivo: "settore_non_scelto" });
      continue;
    }
    const tenute = new Set<string>();
    for (const v of lista) {
      if (typeof v !== "string") {
        scartate.push({ settore, id: String(v), motivo: "non_testo" });
        continue;
      }
      const r = risolviSottocategoria(settore, v, catalogo);
      if (!r) {
        const ritirata = catalogo.ritirate[settore].includes(v.trim()) || catalogo.ritirate[settore].includes(catalogo.alias[settore][v.trim()] ?? "");
        scartate.push({ settore, id: v, motivo: ritirata ? "ritirata" : "non_nel_catalogo" });
        continue;
      }
      if (r.daAlias) tradotte.push({ settore, da: v, a: r.id });
      tenute.add(r.id);
    }
    const ordinate = catalogo.idStabili[settore].filter((id) => tenute.has(id));
    if (ordinate.length > MASSIMO_PER_SETTORE) {
      for (const id of ordinate.slice(MASSIMO_PER_SETTORE)) scartate.push({ settore, id, motivo: "oltre_il_massimo" });
    }
    if (ordinate.length) sottocategorie[settore] = ordinate.slice(0, MASSIMO_PER_SETTORE);
  }
  return { sottocategorie, scartate, tradotte };
}

// Coerenza del catalogo con le regole: ogni identificativo di SOTTOCATEGORIE è stabile e nello stesso ordine; ogni identificativo stabile è
// ancora nelle regole o è ritirato; gli alias puntano a identificativi stabili, non coincidono con identificativi vivi e non fanno cicli.
// Elenco vuoto = coerente. Lo usa la verifica: un rinomina senza alias fa fallire il livello 1.
export function problemiDelCatalogo(
  regole: Readonly<Record<SettoreRadar, readonly { id: string }[]>> = SOTTOCATEGORIE,
  catalogo: CatalogoSottocategorie = CATALOGO,
): string[] {
  const problemi: string[] = [];
  for (const { id: settore } of SETTORI_RADAR) {
    const nelleRegole = regole[settore].map((s) => s.id);
    const stabili = catalogo.idStabili[settore];
    const ritirate = catalogo.ritirate[settore];
    for (const id of nelleRegole) if (!stabili.includes(id)) problemi.push(`${settore}: «${id}» è nelle regole ma non tra gli identificativi stabili (aggiungerlo in fondo, o un alias se è un rinomina)`);
    for (const id of stabili) if (!nelleRegole.includes(id) && !ritirate.includes(id)) problemi.push(`${settore}: «${id}» è stabile ma non è più nelle regole (alias verso il nuovo identificativo, oppure ritirata)`);
    const vivi = stabili.filter((id) => nelleRegole.includes(id));
    const ordineRegole = nelleRegole.filter((id) => stabili.includes(id));
    if (vivi.join() !== ordineRegole.join()) problemi.push(`${settore}: l'ordine delle regole non è quello degli identificativi stabili (la prima è la predefinita)`);
    if (new Set(stabili).size !== stabili.length) problemi.push(`${settore}: identificativi stabili ripetuti`);
    for (const [vecchio, nuovo] of Object.entries(catalogo.alias[settore])) {
      if (stabili.includes(vecchio)) problemi.push(`${settore}: l'alias «${vecchio}» è anche un identificativo stabile`);
      const r = risolviSottocategoria(settore, vecchio, catalogo);
      if (!r && !ritirate.includes(nuovo)) problemi.push(`${settore}: l'alias «${vecchio}» → «${nuovo}» non porta a un identificativo del catalogo (o fa un ciclo)`);
    }
  }
  return problemi;
}
