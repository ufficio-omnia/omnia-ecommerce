// Riclassificazione delle gare GIÀ in archivio con le regole correnti di settori.ts (qualità delle gare, 17/11/2026). Logica pura: nessun
// database. Lo script scripts/radar-riclassifica-settori.ts legge l'archivio, usa queste funzioni e, solo con un'autorizzazione registrata,
// scrive le correzioni.
//
// Regole:
//   - stesso calcolo degli importatori (TED, PVL e le fonti di B2 chiamano tutti classificaGara): CPV della gara e dei lotti, testo =
//     oggetto della gara + oggetti dei lotti; una gara trovata solo per parola chiave deve essere un servizio (o natura mista o non detta);
//   - la riclassificazione può solo TOGLIERE settori: una gara che ne guadagnerebbe uno resta com'è e viene segnalata (non è una correzione
//     di esclusione, va decisa a parte);
//   - esclusione ≠ cancellazione: si cambiano solo «settori» e «metodo_settore» della gara; la gara, i lotti, le fonti e il registro restano;
//   - ogni correzione si traccia nel registro dei cambiamenti (correzione_dati, campo «settori», mai notificabile) con il valore di prima,
//     così si può annullare.
import { classificaGara, idFonteCorrezioneSettori, type Esclusione } from "./settori";

export type GaraDaRiclassificare = {
  id: string;
  oggetto: string;
  cpv_principale: string | null;
  cpv_tutti: readonly string[] | null;
  settori: readonly string[];
  metodo_settore: string | null;
  natura_contratto: string | null;
};
export type LottoDaRiclassificare = { oggetto: string | null; cpv_principale: string | null; cpv_tutti: readonly string[] | null };

export type StatoSettori = { settori: string[]; metodo: string | null };

export type Riclassificazione =
  | { tipo: "invariata" }
  | { tipo: "correzione"; prima: StatoSettori; dopo: StatoSettori; esclusioni: Esclusione[]; idFonte: string }
  // la gara guadagnerebbe un settore: non si tocca (non è un'esclusione)
  | { tipo: "da_decidere"; prima: StatoSettori; dopo: StatoSettori };

const NATURE_AMMESSE_PER_PAROLE = new Set(["servizi", "misto"]);

function stessiSettori(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}

export function riclassificaGara(g: GaraDaRiclassificare, lotti: readonly LottoDaRiclassificare[]): Riclassificazione {
  const c = classificaGara({
    cpvPrincipale: g.cpv_principale,
    cpvTutti: [...(g.cpv_tutti ?? []), ...lotti.flatMap((l) => [l.cpv_principale, ...(l.cpv_tutti ?? [])])],
    testo: [g.oggetto, ...lotti.map((l) => l.oggetto ?? "")].join(" "),
    // i lotti servono per riconoscere un servizio autonomo (lotto dedicato): cambia il livello, mai i settori
    lotti: lotti.map((l) => ({ testo: l.oggetto, cpv: [l.cpv_principale, ...(l.cpv_tutti ?? [])] })),
  });
  const fuoriPerNatura = c.metodo === "parole_chiave" && !!g.natura_contratto && !NATURE_AMMESSE_PER_PAROLE.has(g.natura_contratto);
  const dopo: StatoSettori = fuoriPerNatura || c.settori.length === 0 ? { settori: [], metodo: null } : { settori: [...c.settori], metodo: c.metodo };
  const prima: StatoSettori = { settori: [...g.settori], metodo: g.metodo_settore };
  if (dopo.settori.some((s) => !prima.settori.includes(s))) return { tipo: "da_decidere", prima, dopo };
  // stessi settori (anche se cambiasse solo il metodo): niente da correggere
  if (stessiSettori(prima.settori, dopo.settori)) return { tipo: "invariata" };
  return { tipo: "correzione", prima, dopo, esclusioni: c.esclusioni, idFonte: idFonteCorrezioneSettori(c.esclusioni) };
}

// Valore per il registro dei cambiamenti: settori e metodo, per poterli ripristinare entrambi.
export function valoreRegistro(s: StatoSettori): string {
  return JSON.stringify({ settori: s.settori, metodo: s.metodo });
}

export function statoDaRegistro(v: string | null): StatoSettori | null {
  try {
    const o: unknown = JSON.parse(v ?? "");
    if (Array.isArray(o)) return { settori: o.filter((x): x is string => typeof x === "string"), metodo: null };
    if (o && typeof o === "object" && Array.isArray((o as { settori?: unknown }).settori)) {
      const m = (o as { metodo?: unknown }).metodo;
      return { settori: ((o as { settori: unknown[] }).settori).filter((x): x is string => typeof x === "string"), metodo: m === "cpv" || m === "parole_chiave" ? m : null };
    }
  } catch {
    // valore non leggibile: nessun ripristino
  }
  return null;
}

// La nota del registro: i motivi, in parole semplici (massimo 1000 caratteri, il limite della colonna).
export function notaCorrezione(esclusioni: readonly Esclusione[]): string {
  const testo = esclusioni.length ? esclusioni.map((e) => `${e.settore}: ${e.motivo}`).join(" · ") : "Parole chiave delle regole aggiornate";
  return `Regole di classificazione aggiornate. ${testo}`.slice(0, 1000);
}
