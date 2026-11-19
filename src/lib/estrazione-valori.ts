// Valori della risposta del modello resi compatibili con le colonne di `gare` PRIMA del salvataggio dell'analisi.
//
// Lo schema dello strumento di estrazione dice al modello il tipo di ogni campo, ma non è una garanzia: il 19/11/2026 (gara
// Bonocunto, Isola di Capo Rizzuto) il modello ha mandato "" come limite_pagine_totale, la colonna integer l'ha rifiutato
// (22P02 «invalid input syntax for type integer») e TUTTA l'analisi è finita in «errore», pur essendo il resto corretto.
// Qui si decide in modo deterministico: un valore che non è del tipo giusto diventa «non indicato» (null), mai un errore.
// Nessuna ipotesi su un valore ambiguo: meglio un campo vuoto che un numero inventato.

// Numero non negativo: un numero vero, o un testo che è chiaramente un numero («40», «1,5», «52.586,16», «€ 52.586,16»).
// Tutto il resto (testo vuoto, parole, negativi, NaN) → null.
export function numeroOpzionale(valore: unknown): number | null {
  let n: number;
  if (typeof valore === "number") n = valore;
  else if (typeof valore === "string") {
    const t = valore.replace(/[€\s]/g, "");
    // «1.250» può essere 1,25 o milleduecentocinquanta: ambiguo, non si indovina
    if (/^\d{1,3}(\.\d{3})+$/.test(t)) return null;
    if (/^\d+([.,]\d+)?$/.test(t)) n = Number(t.replace(",", "."));
    // separatore delle migliaia all'italiana: 52.586,16 oppure 1.250
    else if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) n = Number(t.replace(/\./g, "").replace(",", "."));
    else return null;
  } else return null;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Intero non negativo (colonne integer): un numero con la virgola non si arrotonda, diventa null.
export function interoOpzionale(valore: unknown): number | null {
  const n = numeroOpzionale(valore);
  return n !== null && Number.isInteger(n) ? n : null;
}

// Testo: stringa non vuota (spazi tolti ai bordi), o un numero scritto come testo. Tutto il resto → null.
export function testoOpzionale(valore: unknown): string | null {
  if (typeof valore === "number" && Number.isFinite(valore)) return String(valore);
  if (typeof valore !== "string") return null;
  const t = valore.trim();
  return t === "" ? null : t;
}

// Un elenco: un array vero, o un array mandato come testo JSON («["2.2","4.1"]», capita con gli strumenti). Altrimenti null.
function comeArray(valore: unknown): unknown[] | null {
  if (Array.isArray(valore)) return valore;
  if (typeof valore === "string" && valore.trim().startsWith("[")) {
    try {
      const letto: unknown = JSON.parse(valore);
      return Array.isArray(letto) ? letto : null;
    } catch {
      return null;
    }
  }
  return null;
}

// Elenco di testi (colonne text[] o jsonb di stringhe): solo le voci di testo non vuote. Elenco vuoto o non valido → null.
// Per sub_criteri_tabellari null è anche la scelta sicura: quei sotto-criteri vengono scritti per esteso invece di essere saltati.
export function elencoTestiOpzionale(valore: unknown): string[] | null {
  const voci = comeArray(valore);
  if (!voci) return null;
  const testi = voci.map(testoOpzionale).filter((t): t is string => t !== null);
  return testi.length > 0 ? testi : null;
}

// Elenco di oggetti (colonne jsonb come sedi e criteri_riepilogo): solo le voci che sono oggetti. Vuoto o non valido → null.
export function elencoOggettiOpzionale<T extends object>(valore: unknown): T[] | null {
  const voci = comeArray(valore);
  if (!voci) return null;
  const oggetti = voci.filter((v): v is T => !!v && typeof v === "object" && !Array.isArray(v));
  return oggetti.length > 0 ? oggetti : null;
}

// CIG: come prima (spazi tolti, maiuscolo), ma da qualunque valore: un numero non fa più fallire `.replace`.
export function cigOpzionale(valore: unknown): string | null {
  const t = testoOpzionale(valore)?.replace(/\s+/g, "").toUpperCase() ?? "";
  return t === "" ? null : t;
}
