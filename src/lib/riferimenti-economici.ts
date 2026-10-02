// R8 — nessun riferimento all'offerta economica nell'offerta tecnica, né
// diretto né indiretto. Una frase come "senza oneri aggiuntivi" dentro
// l'offerta tecnica può costare l'esclusione dalla gara, non solo punti.
//
// Modulo PURO (nessun modello, nessun DB): il rilevatore gira in OGNI
// generazione reale (vedi garanzia-senza-economico.ts, chiamata da
// generaBozzaSezione e componiRelazioneFinale) e negli stessi controlli di
// livello 1 e 2 — un'unica definizione dell'elenco, non tre che si
// disallineano. Il modello conta le formule vietate nel prompt (R8), ma
// verificato in pratica che ogni tanto una scappa comunque: per questo il
// controllo è sul testo, non sul prompt.
//
// La ricerca ignora la formattazione (grassetto, tag di cella, icone,
// separatori di tabella): "senza **oneri** aggiuntivi" è la stessa formula.

export type RiferimentoEconomico = {
  regola: string;
  // Testo trovato (ripulito dalla formattazione).
  formula: string;
  // Posizione nel testo ripulito della riga.
  indice: number;
};

type Regola = { id: string; descrizione: string; pattern: RegExp };

const AGGETTIVO_ASSENZA = String.raw`(?:(?:alcun[oa]?|ulterior[ei]|maggior[ei]|nuov[oi]|altr[oi]|qualsiasi|qualunque)\s+)?`;
const VOCE_ECONOMICA = String.raw`(?:oner[ei]|cost[oi]|spes[ae]|aggravi[o]?|addebit[oi]|maggiorazion[ei]|esbors[oi]|corrispettiv[oi]|compens[oi])`;
const ENTE_A_CARICO = String.raw`(?:nostro|proprio|dell['’]\s?(?:impresa|appaltatore|aggiudicatario|operatore\s+economico)|del\s+(?:concorrente|fornitore|prestatore))`;

export const REGOLE_RIFERIMENTI_ECONOMICI: Regola[] = [
  {
    id: "senza-oneri-costi",
    descrizione: "senza (alcun/ulteriori/maggiori) oneri, costi, spese, aggravio, addebiti, maggiorazioni, corrispettivo",
    pattern: new RegExp(String.raw`\bsenza\s+${AGGETTIVO_ASSENZA}${VOCE_ECONOMICA}`, "gi"),
  },
  {
    id: "nessun-onere",
    descrizione: "nessun onere / nessun costo / nessuna spesa / nessun addebito",
    pattern: new RegExp(String.raw`\bnessun[oa]?\s+(?:ulterior[ei]\s+)?${VOCE_ECONOMICA}`, "gi"),
  },
  {
    id: "gratuito",
    descrizione: "gratuito, gratuitamente, a titolo gratuito, gratis, in omaggio",
    pattern: /\bgratuit\w*|\bgratis\b|\bin\s+omaggio\b|\bomaggiat\w*/gi,
  },
  {
    id: "costo-zero",
    descrizione: "a costo zero / a costo nullo / a titolo non oneroso / privo di oneri / esente da costi",
    pattern: /\ba\s+(?:costo|spesa|costi|oneri)\s+(?:zero|nullo|nulli|nulla)\b|\ba\s+zero\s+(?:costi|oneri|spese)\b|\b(?:costi?|oneri|spese)\s+zero\b|\bzero\s+(?:costi|oneri|spese)\b|\bnon\s+oneros[oaie]\b|\bprivo\s+di\s+(?:oneri|costi|spese)\b|\besente\s+da\s+(?:oneri|costi|spese)\b/gi,
  },
  {
    id: "compreso-nel-prezzo",
    descrizione: "compreso/incluso nel prezzo, nel canone, nel corrispettivo, nell'offerta economica",
    pattern: /\b(?:già\s+)?(?:compres[oaie]|inclus[oaie]|ricompres[oaie])\s+(?:nel|nello|nella|nei|nelle|negli|nell['’])\s*(?:prezz[oi]|canone|canoni|corrispettiv[oi]|offerta\s+economica|import[oi]|compens[oi]|ribass[oi])/gi,
  },
  {
    id: "a-spese-proprie",
    descrizione: "a proprie/nostre spese, a spese dell'impresa, a carico dell'impresa",
    pattern: new RegExp(
      String.raw`\ba\s+(?:proprie|nostre|sue|loro|propria|nostra)\s+spese\b|\ba\s+spese\s+(?:proprie|nostre|${ENTE_A_CARICO})|\ba\s+carico\s+${ENTE_A_CARICO}`,
      "gi",
    ),
  },
  {
    id: "euro",
    descrizione: "riferimenti a euro (€, euro, EUR); \"Euro 6\" come classe di emissione non è un importo",
    pattern: /€|\beuro\b(?!\s*[1-6]\b)|\beur\b/gi,
  },
  {
    id: "importi-prezzi",
    // "canone" da solo NON è nell'elenco: "interventi extra-canone" è
    // terminologia contrattuale del capitolato (compare nelle generazioni
    // reali) e non un'offerta; solo "compreso nel canone" è una formula
    // vietata (regola compreso-nel-prezzo).
    descrizione: "importo/i, prezzo/i, tariffa, valore economico, controvalore, costo orario",
    pattern: /\bimport[oi]\b|\bprezz[oi]\b|\btariff[ae]\b|\bvalore\s+economico\b|\bcontrovalore\b|\bcost[oi]\s+orari[oi]\b/gi,
  },
  {
    id: "ribasso-sconto",
    descrizione: "ribasso, percentuali di ribasso, sconto",
    pattern: /\bribass[oi]\b|\bscont[oi]\b/gi,
  },
  {
    id: "offerta-economica",
    descrizione: "riferimento esplicito all'offerta economica",
    pattern: /\boffert[ae]\s+economic[ao]\b|\boffert[ae]\s+di\s+prezzo\b/gi,
  },
];

const RIGA_SEPARATORE_TABELLA = /^\|?[\s:|-]+\|?$/;

// Testo come lo legge una persona: senza grassetto, evidenziazioni, tag di
// cella/icona/riga e con le celle separate da un carattere che nessuna
// formula contiene (una formula non può nascere a cavallo di due celle).
export function normalizzaPerRicerca(riga: string): string {
  return riga
    .replace(/\[(?:C|G)\]/g, "")
    .replace(/\[(?:ICONA|RIGA|CELLA|TABELLA|BOX):[^\]]*\]/gi, "")
    .replace(/\[\/?BOX\]/gi, "")
    .replace(/\\\*/g, "")
    .replace(/\*\*|!!|\*/g, "")
    .replace(/\|/g, " ¦ ")
    .replace(/\s+/g, " ")
    .trim();
}

export function trovaRiferimentiEconomici(testo: string): RiferimentoEconomico[] {
  const pulito = normalizzaPerRicerca(testo);
  const trovati: RiferimentoEconomico[] = [];
  for (const regola of REGOLE_RIFERIMENTI_ECONOMICI) {
    for (const m of pulito.matchAll(new RegExp(regola.pattern.source, regola.pattern.flags))) {
      trovati.push({ regola: regola.id, formula: m[0], indice: m.index ?? 0 });
    }
  }
  trovati.sort((a, b) => a.indice - b.indice || b.formula.length - a.formula.length);
  // Una formula contenuta in un'altra già trovata ("compreso nel prezzo"
  // contiene "prezzo") conta una volta sola: quella più lunga.
  const risultato: RiferimentoEconomico[] = [];
  let fineUltima = -1;
  for (const t of trovati) {
    if (t.indice < fineUltima) continue;
    risultato.push(t);
    fineUltima = t.indice + t.formula.length;
  }
  return risultato;
}

export function haRiferimentiEconomici(testo: string): boolean {
  return trovaRiferimentiEconomici(testo).length > 0;
}

export type RigaConRiferimenti = { indiceRiga: number; riga: string; riferimenti: RiferimentoEconomico[] };

// Righe del testo (paragrafi, voci di elenco, righe di tabella, titoli) che
// contengono almeno un riferimento economico.
export function trovaRigheConRiferimentiEconomici(testo: string): RigaConRiferimenti[] {
  const risultato: RigaConRiferimenti[] = [];
  testo.split("\n").forEach((riga, indiceRiga) => {
    if (riga.trim() === "" || RIGA_SEPARATORE_TABELLA.test(riga.trim())) return;
    const riferimenti = trovaRiferimentiEconomici(riga);
    if (riferimenti.length > 0) risultato.push({ indiceRiga, riga, riferimenti });
  });
  return risultato;
}

// Avviso per il cliente: un riferimento economico che è rimasto nel testo
// dopo i tentativi di riformulazione (vedi garanzia-senza-economico.ts).
// Definito qui, nel modulo puro, perché lo importa anche la UI.
export type AvvisoRiferimentoEconomico = {
  // Titolo della sezione e ultimo titolo ("## 1.2 ...") prima della riga.
  sezione: string;
  sottoCriterio: string | null;
  formula: string;
  estratto: string;
};

// Il punto esatto, non un messaggio generico.
export function descriviAvvisoEconomico(a: AvvisoRiferimentoEconomico): string {
  const dove = a.sottoCriterio ? `${a.sezione} › ${a.sottoCriterio}` : a.sezione;
  return `${dove}: «${a.estratto}» (formula «${a.formula}»)`;
}

// Testo per il modello che risponde in chat (messaggio dello strumento): il
// cliente vede già l'avviso in rosso accanto al pulsante di scaricamento, la
// risposta non deve contraddirlo.
export function testoAvvisoEconomico(avvisi: AvvisoRiferimentoEconomico[]): string {
  if (avvisi.length === 0) return "";
  const punti = avvisi.map((a, i) => `${i + 1}) ${descriviAvvisoEconomico(a)}`).join("; ");
  return `ATTENZIONE — RIFERIMENTO ALL'OFFERTA ECONOMICA ANCORA NEL DOCUMENTO (causa di esclusione dalla gara): nonostante due tentativi di riformulazione restano ${avvisi.length} formula/e. Il cliente vede già un avviso in rosso accanto al pulsante di scaricamento; nella risposta dillo chiaramente, indica i punti e invitalo a toglierle prima di consegnare, senza dire che il documento è pronto. Punti: ${punti}. `;
}

// Frase intorno al punto trovato, per indicare al cliente il punto esatto.
export function estrattoIntorno(riga: string, riferimento: RiferimentoEconomico, raggio = 80): string {
  const pulita = normalizzaPerRicerca(riga);
  const inizio = Math.max(0, riferimento.indice - raggio);
  const fine = Math.min(pulita.length, riferimento.indice + riferimento.formula.length + raggio);
  const frase = pulita.slice(inizio, fine).replace(/ ¦ /g, " | ").replace(/^¦ | ¦$/g, "").trim();
  return `${inizio > 0 ? "…" : ""}${frase}${fine < pulita.length ? "…" : ""}`;
}
