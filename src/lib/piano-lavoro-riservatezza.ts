// Il piano di lavoro di un cliente NON deve parlare, da nessuna parte e nemmeno nelle note, di un'altra gara (né di un altro cliente o di un altro piano):
// regola assoluta. Qui c'è la garanzia che non dipende da come sono scritti i testi o da cosa risponde il modello: UN controllo che gira sempre, su
// tutti i testi del piano, prima di scrivere l'Excel e prima di salvare i dati (vedi normalizzaPianoLavoro e costruisciExcelPianoLavoro).
//
// Che cosa riconosce:
//   - i nomi delle gare e dei clienti da cui sono nate le rese e i prezzi di riferimento (i piani di lavoro fatti a mano): se compaiono nel testo di una
//     gara che NON è la loro, si tolgono. Se una di quelle gare è proprio quella di cui si sta facendo il piano, il suo nome è legittimo e resta
//     (lo si riconosce dal titolo, dalla stazione appaltante, dal riferimento di gara, dalle sedi e dai nomi dei documenti);
//   - le frasi che rimandano ad altre gare in generale («altre gare», «gare precedenti», «piani di riferimento»…): si tolgono sempre.
//
// Come toglie: i testi composti da più parti separate da « — » (fonte, nota…) perdono le parti che contengono il riferimento; un testo di una parte sola
// perde il riferimento. Non tocca i numeri né i nomi dei file dei documenti del cliente.

// I riferimenti ai piani da cui sono nate le rese e i prezzi di prassi. Nomi lunghi, distintivi: «scala» da sola è una parola comune (le scale), per
// questo si riconosce solo il teatro o il nome seguito da un numero (il vecchio stile «Scala 220»).
export const RIFERIMENTI_ESTRANEI: RegExp[] = [
  // dopo il nome si consuma anche il numero o l'intervallo che lo segue («Milanosport 250», «Donnafugata 320-355»)
  /milanosport(?:\s+\d[\d.,/–-]*)?/i,
  /donnafugata(?:\s+\d[\d.,/–-]*)?/i,
  /teatro\s+alla\s+scala(?:\s+\d[\d.,/–-]*)?/i,
  /\bscala\s+\d[\d.,/–-]*/i,
  /ferrovie\s+del\s+sud[\s-]?est(?:\s+\d[\d.,/–-]*)?/i,
  /\bFS\s+sud[\s-]?est(?:\s+\d[\d.,/–-]*)?/i,
  /\bsud[\s-]?est\s+\d[\d.,/–-]*/i,
];

// Le frasi che rimandano ad altre gare: mai, qualunque sia la gara.
export const FRASI_ALTRE_GARE: RegExp[] = [
  /\baltr[aeio]\s+(gara|gare|appalto|appalti|cliente|clienti|stazione\s+appaltante|stazioni\s+appaltanti)\b/i,
  /\b(gara|gare|appalto|appalti)\s+precedent[ei]\b/i,
  /\bprecedent[ei]\s+(gara|gare|appalto|appalti)\b/i,
  /\bpiani\s+di\s+(lavoro\s+)?(di\s+)?riferimento\b/i,
  /\bpiani\s+(fatti|redatti|elaborati)\s+(a\s+mano|per\s+altri)\b/i,
];

const SEPARATORE = " — ";

export type EsitoRiservatezza<T> = { valore: T; rimossi: string[] };

const normalizza = (s: string) => s.toLowerCase().replace(/[\s-]+/g, " ");

function contieneRiferimento(testo: string, contestoNormalizzato: string): boolean {
  if (FRASI_ALTRE_GARE.some((r) => r.test(testo))) return true;
  return RIFERIMENTI_ESTRANEI.some((r) => {
    const m = r.exec(testo);
    if (!m) return false;
    // il nome è legittimo se è quello della gara di cui si sta facendo il piano: compare nel suo contesto
    const parola = normalizza(m[0]).replace(/\s+\d.*$/, "");
    return !contestoNormalizzato.includes(parola);
  });
}

// Toglie da UN testo i riferimenti ad altre gare. null = nessun riferimento (il testo resta com'è).
export function ripulisciTestoDaAltreGare(testo: string, contesto: string): { testo: string; rimosso: string } | null {
  const ctx = normalizza(contesto);
  if (!contieneRiferimento(testo, ctx)) return null;

  const parti = testo.split(SEPARATORE);
  if (parti.length > 1) {
    const buone = parti.filter((p) => !contieneRiferimento(p, ctx));
    return { testo: buone.join(SEPARATORE), rimosso: parti.filter((p) => contieneRiferimento(p, ctx)).join(SEPARATORE) };
  }

  // un testo di una parte sola: si toglie il riferimento (e le parentesi che restano vuote), il resto si lascia
  let nuovo = testo;
  for (const r of [...RIFERIMENTI_ESTRANEI, ...FRASI_ALTRE_GARE]) {
    const globale = new RegExp(r.source, r.flags.includes("g") ? r.flags : `${r.flags}g`);
    nuovo = nuovo.replace(globale, (m) => (contieneRiferimento(m, ctx) ? "" : m));
  }
  nuovo = nuovo
    .replace(/\(\s*[,;\s\d-]*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/^[\s,;:—-]+|[\s,;:—-]+$/g, "")
    .trim();
  return { testo: nuovo, rimosso: testo };
}

// Il testo del contesto della gara: ciò che è SUO (titolo, stazione appaltante, riferimento, sedi, nomi dei documenti). Un nome di quelli da
// proteggere che compare qui è legittimo per questa gara.
export function contestoDellaGara(parti: (string | null | undefined)[]): string {
  return parti.filter((p): p is string => typeof p === "string" && p.trim() !== "").join(" \n ");
}

// Percorre un valore qualsiasi (oggetti, liste, testi) e ripulisce ogni testo. `escludi`: chiavi da non toccare (i nomi dei file del cliente).
export function togliRiferimentiAdAltreGare<T>(valore: T, contesto: string, escludi: string[] = []): EsitoRiservatezza<T> {
  const rimossi: string[] = [];
  const visita = (v: unknown, chiave: string | null): unknown => {
    if (typeof v === "string") {
      if (chiave !== null && escludi.includes(chiave)) return v;
      const esito = ripulisciTestoDaAltreGare(v, contesto);
      if (!esito) return v;
      rimossi.push(esito.rimosso);
      return esito.testo;
    }
    if (Array.isArray(v)) return v.map((x) => visita(x, chiave));
    if (v !== null && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, escludi.includes(k) ? x : visita(x, k)]));
    return v;
  };
  return { valore: visita(valore, null) as T, rimossi };
}
