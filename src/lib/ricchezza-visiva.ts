import { dividiInBlocchi } from "@/lib/budget-blocchi";

// Misura PURA (nessun modello, nessun DB) di quanto un testo OMNIA usa gli
// elementi visivi che il renderer sa disegnare: icone, riquadri, tabelle,
// righe evidenziate. Serve a tre scopi — la prova controllata dei prompt
// (scripts/prova-ricchezza-visiva.ts), il controllo di livello 1/2 e la
// guardia di densità a valle della generazione — con la stessa definizione
// di "elemento visivo" in tutti e tre i punti.

export type MisuraVisiva = {
  parole: number;
  icone: number;
  riquadri: number;
  tabelle: number;
  righeTabella: number;
  righeEvidenziate: number;
  organigrammi: number;
  // Figure schematiche (archetipi): blocchi costruiti, segnaposti e maschere.
  figure: number;
  elenchiPuntati: number;
};

const RIGA_SEPARATORE_TABELLA = /^\s*\|[-:\s|]+\|\s*$/;

// Parole di testo leggibile: via i tag di formattazione, i separatori di
// tabella e la punteggiatura strutturale (altrimenti una tabella "gonfia"
// il conteggio con i "|" e le icone contano come parole).
function paroleLeggibili(testo: string): number {
  const pulito = testo
    .replace(/\[FIGURA\][\s\S]*?\[\/FIGURA\]/gi, " ")
    .replace(/\[FIGURA:@?\d+\]/gi, " ")
    .split("\n")
    .filter((r) => !RIGA_SEPARATORE_TABELLA.test(r))
    .join("\n")
    .replace(/\[ICONA:[^\]]*\]/g, " ")
    .replace(/\[\/?BOX(?::[^\]]*)?\]/g, " ")
    .replace(/\[\/?ORGANIGRAMMA\]/gi, " ")
    .replace(/\[(?:RIGA|CELLA|TABELLA):[^\]]*\]/gi, " ")
    .replace(/\[(?:C|G)\]/g, " ")
    .replace(/[|#*!]/g, " ");
  return pulito.split(/\s+/).filter(Boolean).length;
}

export function misuraVisiva(testo: string): MisuraVisiva {
  const righe = testo.split("\n");
  return {
    parole: paroleLeggibili(testo),
    icone: (testo.match(/\[ICONA:[^\]]*\]/g) || []).length,
    riquadri: (testo.match(/\[BOX(?::[^\]]*)?\]/g) || []).length,
    tabelle: righe.filter((r) => RIGA_SEPARATORE_TABELLA.test(r)).length,
    righeTabella: righe.filter((r) => /^\s*\|.*\|\s*$/.test(r) && !RIGA_SEPARATORE_TABELLA.test(r)).length,
    righeEvidenziate: (testo.match(/\[RIGA:[^\]]*\]/g) || []).length,
    organigrammi: (testo.match(/\[ORGANIGRAMMA\]/gi) || []).length,
    figure: (testo.match(/\[FIGURA(?::@?\d+)?\]/gi) || []).length,
    elenchiPuntati: righe.filter((r) => /^\s*-\s+\S/.test(r)).length,
  };
}

export type MisuraBlocco = { chiave: string | null; titolo: string; misura: MisuraVisiva };

// Una misura per ogni sotto-criterio ("## x.y ...") del testo; il blocco
// senza chiave è il preambolo (titolo del criterio, eventuale introduzione).
export function misuraPerBlocco(testo: string): MisuraBlocco[] {
  return dividiInBlocchi(testo).map((b) => ({
    chiave: b.chiave,
    titolo: (b.testo.split("\n")[0] ?? "").replace(/^#+\s*/, "").trim(),
    misura: misuraVisiva(b.testo),
  }));
}

export function descriviMisura(m: MisuraVisiva): string {
  return `parole ${m.parole}, icone ${m.icone}, riquadri ${m.riquadri}, tabelle ${m.tabelle}, righe evidenziate ${m.righeEvidenziate}, organigrammi ${m.organigrammi}, figure ${m.figure}`;
}
