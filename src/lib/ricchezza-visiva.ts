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

// ─── Prosa "liscia" ───
// Una commissione che legge decine di offerte valuta una tabella in tre secondi
// e un paragrafo no: la prosa va tenuta al minimo e, dove c'è, deve avere
// impatto (grassetti sui valori e sui termini chiave, ruoli evidenziati). Si
// misura qui, con una definizione sola, per la prova dei prompt, i controlli e
// la guardia di densità. Un "paragrafo di prosa" è un blocco di testo separato
// da righe vuote che NON è un titolo, una riga di tabella, un elenco puntato,
// una nota, un tag di formattazione né il contenuto di un riquadro o di una
// figura (il riquadro è già un impegno in evidenza, la figura un disegno).
export type MisuraProsa = {
  paragrafi: number;
  parole: number;
  // paragrafi con almeno un grassetto, un ruolo evidenziato o un'icona
  conEvidenza: number;
  // più paragrafi di prosa di fila, senza una tabella, un elenco o una figura in mezzo
  maxConsecutivi: number;
  // paragrafi lunghi (oltre PAROLE_MASSIME_PARAGRAFO)
  lunghi: number;
};

export const PAROLE_MASSIME_PARAGRAFO = 70;

const NON_PROSA = /^(\||#{1,6}\s|[-*•]\s|\*[^*]|\\\*|\[(?:BOX|\/BOX|TABELLA|FIGURA|ORGANIGRAMMA|\/ORGANIGRAMMA|RIGA|CELLA)\b)/i;

export function paragrafiDiProsa(testo: string): string[] {
  const pulito = testo
    .replace(/\[FIGURA\][\s\S]*?\[\/FIGURA\]/gi, "\n\n[FIGURA]\n\n")
    .replace(/\[ORGANIGRAMMA\][\s\S]*?\[\/ORGANIGRAMMA\]/gi, "\n\n[ORGANIGRAMMA]\n\n")
    .replace(/\[BOX(?::[^\]]*)?\][\s\S]*?\[\/BOX\]/gi, "\n\n[BOX]\n\n");
  return pulito.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 0);
}

export function misuraProsa(testo: string): MisuraProsa {
  let paragrafi = 0;
  let parole = 0;
  let conEvidenza = 0;
  let lunghi = 0;
  let consecutivi = 0;
  let maxConsecutivi = 0;
  for (const p of paragrafiDiProsa(testo)) {
    if (NON_PROSA.test(p) || /^\[FIGURA:/i.test(p)) {
      consecutivi = 0;
      continue;
    }
    const n = p.split(/\s+/).filter(Boolean).length;
    paragrafi++;
    parole += n;
    if (/\*\*[^*]+\*\*|!![^!]+!!|\[ICONA:/.test(p)) conEvidenza++;
    if (n > PAROLE_MASSIME_PARAGRAFO) lunghi++;
    consecutivi++;
    maxConsecutivi = Math.max(maxConsecutivi, consecutivi);
  }
  return { paragrafi, parole, conEvidenza, maxConsecutivi, lunghi };
}

export function descriviProsa(m: MisuraProsa, paroleTotali: number): string {
  const quota = paroleTotali > 0 ? Math.round((m.parole / paroleTotali) * 100) : 0;
  return `prosa ${m.paragrafi} par. (${m.parole} parole, ${quota}% del testo), con evidenza ${m.conEvidenza}/${m.paragrafi}, lunghi ${m.lunghi}, max di fila ${m.maxConsecutivi}`;
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
