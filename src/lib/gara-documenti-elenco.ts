// Elenco dei documenti di una gara (OMNIA AI): ordine cronologico di caricamento, data di caricamento in vista, e quali documenti
// sono stati caricati DOPO l'ultima analisi. Funzioni PURE (nessun database): le usano la pagina della gara, l'analisi dei
// documenti e i test (scripts/verifica-documenti-proroga-omnia-ai.ts).

export type DocumentoElenco = { id: string; nome_file: string; created_at: string };

// Dal più vecchio al più recente (ordine cronologico di caricamento). A parità di istante decide il nome, poi l'id: l'ordine è
// sempre lo stesso, anche per più file caricati nello stesso momento.
export function ordinaPerCaricamento<T extends DocumentoElenco>(documenti: T[]): T[] {
  return [...documenti].sort((a, b) => {
    const ta = new Date(a.created_at).getTime();
    const tb = new Date(b.created_at).getTime();
    if (ta !== tb) return (Number.isFinite(ta) ? ta : 0) - (Number.isFinite(tb) ? tb : 0);
    return a.nome_file.localeCompare(b.nome_file, "it") || a.id.localeCompare(b.id);
  });
}

// «26/10/2026, 14:35» in ora di Roma (l'ora del server può essere un'altra). Stringa vuota se la data non è leggibile.
export function testoDataCaricamento(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("it-IT", { timeZone: "Europe/Rome", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// I documenti caricati dopo l'ultima analisi: i loro contenuti (per esempio un avviso di proroga) non sono ancora nei dati
// estratti. Senza analisi fatta non c'è nulla da segnalare.
export function documentiDopoUltimaAnalisi<T extends DocumentoElenco>(documenti: T[], estrazioneAggiornataIl: string | null): T[] {
  if (!estrazioneAggiornataIl) return [];
  const limite = new Date(estrazioneAggiornataIl).getTime();
  if (!Number.isFinite(limite)) return [];
  return documenti.filter((d) => new Date(d.created_at).getTime() > limite);
}

// L'elenco che si dà al modello insieme ai PDF, nello stesso ordine in cui i PDF sono allegati: gli serve per capire quale
// documento viene dopo (un avviso di proroga o una rettifica che cambia la data). La data di caricamento è solo un indizio: la
// data che conta è quella scritta nel documento stesso.
export function testoElencoCronologicoPerEstrazione(documenti: DocumentoElenco[]): string {
  const ordinati = ordinaPerCaricamento(documenti);
  const righe = ordinati.map((d, i) => `${i + 1}. ${d.nome_file} — caricato il ${testoDataCaricamento(d.created_at)}`);
  return `I documenti allegati sono in ordine cronologico di caricamento (dal più vecchio al più recente):\n${righe.join("\n")}\nLa data di caricamento è solo un indizio sull'ordine: per decidere quale documento è successivo a un altro (per esempio un avviso di proroga rispetto al bando) conta soprattutto la data scritta nel documento.`;
}
