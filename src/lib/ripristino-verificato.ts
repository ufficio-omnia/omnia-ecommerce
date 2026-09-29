import {
  REGEX_ARTICOLI,
  REGEX_MARCATORE_PROSA,
  REGEX_NORME,
  estraiRiferimenti as estraiRiferimentiGrezzi,
  normalizzaTesto,
  riferimentoConservato,
  valoreDelMarcatoreProsa,
} from "@/lib/confronto-tagli";

// Stessa normalizzazione del controllo (date in lettere = date numeriche,
// asterisco con escape = asterisco): senza, "D.M. 29 gennaio 2021" scritto
// come "D.M. 29/01/2021" risulterebbe un riferimento sparito.
function estraiRiferimenti(testo: string): string[] {
  return estraiRiferimentiGrezzi(normalizzaTesto(testo));
}

// Ripristino DETERMINISTICO di asterischi di conferma e citazioni del
// capitolato dopo una compressione. Confronta il testo compresso con quello
// VERIFICATO (quello che ha già passato il controllo dei dati d'impresa) e
// rimette ciò che il modello ha tolto. Nessuna chiamata a modelli e nessun
// contenuto nuovo: tutto ciò che viene reinserito è testo già presente nella
// versione verificata, quindi non può introdurre valori mai confermati.
//
// Perché serve: il contratto di compressione (prompts/compressione-omnia.md)
// vieta di toccare citazioni di articoli e valori; in pratica il modello lo
// viola (osservato su dati reali: asterischi tolti da valori ancora presenti,
// quindi presentati come impegni confermati; un articolo del capitolato
// sparito). Ripristinare a valle costa zero rispetto a rifare la verifica
// dei dati, e non può peggiorare nulla: se qualcosa non è ripristinabile lo
// segnala, e sarà il chiamante a rifiutare la compressione.

export type EsitoRipristino = {
  testo: string;
  asterischiRipristinati: string[];
  noteRipristinate: string[];
  citazioniRipristinate: string[];
  // Cose scomparse che qui non si riesce a rimettere in modo affidabile:
  // il chiamante deve trattarle come una violazione del contratto.
  nonRipristinabili: string[];
};

// ————————————————————————————————————————————————————————————————
// Utilità di testo
// ————————————————————————————————————————————————————————————————

function radici(testo: string): Set<string> {
  const pulito = testo
    .replace(/\[(?:C|G)\]/g, " ")
    .replace(/\[ICONA:[^\]]*\]/g, " ")
    .replace(/[*!|#]/g, " ")
    .toLowerCase();
  const set = new Set<string>();
  for (const parola of pulito.split(/[^a-zà-ÿ0-9]+/)) {
    if (parola.length >= 4) set.add(parola.slice(0, 6));
  }
  return set;
}

// Coefficiente di sovrapposizione (comuni / il più piccolo dei due insiemi):
// una frase accorciata dal modello mantiene le parole che restano, quindi
// resta molto simile all'originale anche se ne ha perse la metà.
function sovrapposizione(a: string, b: string): { punteggio: number; comuni: number } {
  const ra = radici(a);
  const rb = radici(b);
  if (ra.size === 0 || rb.size === 0) return { punteggio: 0, comuni: 0 };
  let comuni = 0;
  for (const r of ra) if (rb.has(r)) comuni++;
  return { punteggio: comuni / Math.min(ra.size, rb.size), comuni };
}

const SOGLIA_ABBINAMENTO = 0.5;
const MINIMO_RADICI_COMUNI = 3;

type Blocco = { chiave: string | null; testo: string };

function dividiBlocchi(testo: string): Blocco[] {
  return testo.split(/\n(?=##\s)/).map((parte) => {
    const m = parte.match(/^##\s+([A-Za-z]?\d+(?:\.\d+)+)/);
    return { chiave: m ? m[1] : null, testo: parte };
  });
}

function cellePerRiga(riga: string): string[] {
  return riga.trim().replace(/^\|/, "").replace(/\|$/, "").split("|");
}

const RIGA_SEPARATORE = /^\s*\|[-:\s|]+\|\s*$/;

function eRigaTabella(riga: string): boolean {
  return riga.trim().startsWith("|") && !RIGA_SEPARATORE.test(riga);
}

function pulisciCellaPerValore(cella: string): string {
  return cella
    .replace(/\[(?:C|G)\]/g, "")
    .replace(/\[ICONA:[^\]]*\]/g, "")
    .replace(/\*\*([^*]*?)\*\*/g, "$1")
    .trim();
}

// Valore di una cella se finisce con un asterisco isolato ("48 ore *").
function valoreMarcatoDiCella(cella: string): string | null {
  const m = pulisciCellaPerValore(cella).match(/^(.*?\S)\s*\*$/);
  return m ? m[1].replace(/\s+/g, " ").trim().toLowerCase() : null;
}

function valoreNormalizzatoDiCella(cella: string): string {
  return pulisciCellaPerValore(cella).replace(/\s+/g, " ").trim().toLowerCase();
}

function etichettaDiRiga(riga: string): string {
  return valoreNormalizzatoDiCella(cellePerRiga(riga)[0] ?? "");
}

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ————————————————————————————————————————————————————————————————
// Asterischi di conferma
// ————————————————————————————————————————————————————————————————

type MarcatoreVerificato =
  | { tipo: "cella"; valore: string; etichetta: string; contesto: string }
  | { tipo: "prosa"; valore: string; contesto: string };

function estraiMarcatiDalVerificato(testo: string): MarcatoreVerificato[] {
  const risultati: MarcatoreVerificato[] = [];
  for (const riga of testo.split("\n")) {
    if (riga.trim().startsWith("|")) {
      if (RIGA_SEPARATORE.test(riga)) continue;
      for (const cella of cellePerRiga(riga)) {
        const v = valoreMarcatoDiCella(cella);
        if (v) risultati.push({ tipo: "cella", valore: v, etichetta: etichettaDiRiga(riga), contesto: riga });
      }
    } else if (!/^\s*\*[^*\s]/.test(riga)) {
      for (const m of riga.matchAll(REGEX_MARCATORE_PROSA)) {
        const v = valoreDelMarcatoreProsa(riga, m.index ?? 0);
        if (v) risultati.push({ tipo: "prosa", valore: v, contesto: riga });
      }
    }
  }
  return risultati;
}

// True se nel testo compare già questo valore marcato con asterisco.
function valoreGiaMarcato(testo: string, m: MarcatoreVerificato): boolean {
  for (const riga of testo.split("\n")) {
    if (m.tipo === "cella") {
      if (!eRigaTabella(riga)) continue;
      if (cellePerRiga(riga).some((c) => valoreMarcatoDiCella(c) === m.valore)) return true;
    }
    if (m.tipo === "prosa" && !riga.trim().startsWith("|")) {
      for (const x of riga.matchAll(REGEX_MARCATORE_PROSA)) {
        if (valoreDelMarcatoreProsa(riga, x.index ?? 0) === m.valore) return true;
      }
    }
  }
  return false;
}

function ripristinaAsterischi(verificato: string, righeCompresso: string[]): string[] {
  const ripristinati: string[] = [];
  const marcatiVerificato = estraiMarcatiDalVerificato(verificato);
  const visti = new Set<string>();

  for (const m of marcatiVerificato) {
    const chiaveUnica = `${m.tipo}|${m.valore}`;
    if (visti.has(chiaveUnica)) continue;
    visti.add(chiaveUnica);

    const testoCorrente = righeCompresso.join("\n");
    if (valoreGiaMarcato(testoCorrente, m)) continue;

    if (m.tipo === "cella") {
      // Candidati: celle di tabella il cui valore è lo stesso, senza asterisco.
      const candidati: { riga: number; cella: number; stessaEtichetta: boolean }[] = [];
      righeCompresso.forEach((riga, i) => {
        if (!eRigaTabella(riga)) return;
        const celle = cellePerRiga(riga);
        celle.forEach((c, j) => {
          if (valoreNormalizzatoDiCella(c) !== m.valore) return;
          const etichetta = etichettaDiRiga(riga);
          const stessa = etichetta === m.etichetta || sovrapposizione(etichetta, m.etichetta).punteggio >= 0.6;
          candidati.push({ riga: i, cella: j, stessaEtichetta: stessa });
        });
      });
      // Stessa riga (etichetta uguale/simile) → sicuro. Altrimenti solo se il
      // valore compare in UNA sola cella ed è abbastanza specifico da non
      // marcare per errore un dato confermato che gli somiglia ("2", "no").
      const scelto =
        candidati.find((c) => c.stessaEtichetta) ?? (candidati.length === 1 && m.valore.length >= 4 ? candidati[0] : undefined);
      if (!scelto) continue;
      const riga = righeCompresso[scelto.riga];
      const celle = cellePerRiga(riga);
      const cellaOriginale = celle[scelto.cella];
      celle[scelto.cella] = `${cellaOriginale.trimEnd()} *${cellaOriginale.endsWith(" ") ? " " : ""}`;
      righeCompresso[scelto.riga] = `|${celle.join("|")}|`;
      ripristinati.push(m.valore);
    } else {
      // Paragrafo: cerca il valore (tollerando il grassetto attorno) e
      // sceglie l'occorrenza il cui contesto somiglia di più a quello
      // originale, se ce n'è più di una.
      const sequenza = m.valore.split(" ").map(esc).join("\\s+");
      const cerca = new RegExp(`(?:\\*\\*)?${sequenza}(?:\\*\\*)?`, "gi");
      const occorrenze: { riga: number; fine: number; punteggio: number }[] = [];
      righeCompresso.forEach((riga, i) => {
        if (riga.trim().startsWith("|") || /^\s*\*[^*\s]/.test(riga)) return;
        for (const x of riga.matchAll(cerca)) {
          occorrenze.push({ riga: i, fine: (x.index ?? 0) + x[0].length, punteggio: sovrapposizione(riga, m.contesto).punteggio });
        }
      });
      if (occorrenze.length === 0) continue;
      occorrenze.sort((a, b) => b.punteggio - a.punteggio);
      const migliore = occorrenze[0];
      if (occorrenze.length > 1 && migliore.punteggio < 0.3) continue; // ambiguo: non indovinare
      const riga = righeCompresso[migliore.riga];
      righeCompresso[migliore.riga] = `${riga.slice(0, migliore.fine)} *${riga.slice(migliore.fine)}`;
      ripristinati.push(m.valore);
    }
  }
  return ripristinati;
}

// Nota che spiega l'asterisco ("*Valori proposti da confermare..."): inizia
// con '*' seguito da testo e non si richiude (a differenza di un corsivo su
// un'intera riga, che finisce con '*').
const RIGA_NOTA_ASTERISCO = /^\s*\*[^*\s][^*]*$/;

function ripristinaNota(verificato: string, righeCompresso: string[]): string[] {
  const noteVerificato = verificato.split("\n").filter((r) => RIGA_NOTA_ASTERISCO.test(r));
  if (noteVerificato.length === 0) return [];
  if (righeCompresso.some((r) => RIGA_NOTA_ASTERISCO.test(r))) return [];
  // Serve solo se nel blocco ci sono ancora valori marcati da spiegare.
  const conMarcatori = righeCompresso.some((r) => {
    if (r.trim().startsWith("|")) return !RIGA_SEPARATORE.test(r) && cellePerRiga(r).some((c) => valoreMarcatoDiCella(c));
    return [...r.matchAll(REGEX_MARCATORE_PROSA)].length > 0;
  });
  if (!conMarcatori) return [];
  const nota = noteVerificato[0].trim();
  while (righeCompresso.length > 0 && righeCompresso[righeCompresso.length - 1].trim() === "") righeCompresso.pop();
  righeCompresso.push("", nota);
  return [nota];
}

// ————————————————————————————————————————————————————————————————
// Citazioni di articoli e norme
// ————————————————————————————————————————————————————————————————

type Unita = { tipo: "frase" | "elenco" | "riga"; testo: string; riga: number };

// Fine di una frase: punteggiatura seguita da una maiuscola (o apertura di
// virgolette/parentesi/grassetto). NON dopo un'abbreviazione: "art. 9",
// "n. 3", "D.M. 29", "D.Lgs. 36" non terminano la frase — spezzarla lì
// separerebbe la citazione dal suo numero.
const SEPARATORE_FRASI =
  /(?<!\b(?:artt?|nn?|par|cap|lett|es|pag|all|ecc|cfr|sig|dott|ing|[A-Z]|Lgs|Dlgs|Dpr)\.)(?<=[.!?;])\s+(?=[A-ZÀ-Ý"“(*\[])/;

// Unità confrontabili di un blocco: frasi dei paragrafi, voci di elenco,
// righe di tabella. Salta titoli, tag di tabella e contenuto degli
// organigrammi (non hanno citazioni da conservare in prosa).
function unitaDelTesto(righe: string[]): Unita[] {
  const unita: Unita[] = [];
  let dentroOrganigramma = false;
  righe.forEach((riga, i) => {
    const t = riga.trim();
    if (!t) return;
    if (/^\[ORGANIGRAMMA\]/i.test(t)) dentroOrganigramma = true;
    if (dentroOrganigramma) {
      if (/\[\/ORGANIGRAMMA\]/i.test(t)) dentroOrganigramma = false;
      return;
    }
    if (/^#{1,3}\s/.test(t) || /^\[TABELLA:/i.test(t) || /^\[\/?BOX\]$/i.test(t)) return;
    if (t.startsWith("|")) {
      if (!RIGA_SEPARATORE.test(t)) unita.push({ tipo: "riga", testo: t, riga: i });
      return;
    }
    if (/^-\s+/.test(t)) {
      unita.push({ tipo: "elenco", testo: t, riga: i });
      return;
    }
    const contenuto = t.replace(/^\[BOX\]/i, "").replace(/\[\/BOX\]$/i, "");
    const frasi = contenuto.split(SEPARATORE_FRASI).filter((f) => f.trim());
    for (const f of frasi) unita.push({ tipo: "frase", testo: f.trim(), riga: i });
  });
  return unita;
}

// Documento a cui si riferisce un articolo, se scritto subito dopo
// ("art. 12 del Capitolato Speciale d'Appalto"): parole con l'iniziale
// maiuscola, che si fermano alla punteggiatura.
const ARTICOLO_ESTESO =
  /\b[Aa]rtt?\.?\s*\d+(?:[.,]\d+)?(?:\s*(?:,|e|-|–)\s*\d+(?:[.,]\d+)?)*(?:\s*,?\s*comma\s*\d+)?(?:\s+(?:del|dello|della|dei|degli|delle)\s+(?:[A-ZÀ-Ý][\w'’]*|d['’]\w+)(?:\s+(?:[A-ZÀ-Ý][\w'’]*|di|d['’]\w+|del|dello|della|e)){0,5})?/g;

function frammentoCitazione(unita: string, riferimento: string): string {
  for (const m of unita.matchAll(new RegExp(ARTICOLO_ESTESO.source, ARTICOLO_ESTESO.flags))) {
    if (estraiRiferimenti(m[0]).some((r) => r === riferimento || riferimento.startsWith(`${r} `))) {
      return m[0].replace(/\s+(?:e|di|del|dello|della)$/i, "").trim();
    }
  }
  for (const re of REGEX_NORME) {
    for (const m of unita.matchAll(new RegExp(re.source, re.flags))) {
      if (normalizzaTesto(m[0]).trim().replace(/\s+/g, " ").toLowerCase() === riferimento) return m[0].trim();
    }
  }
  return riferimento;
}

function senzaCitazioni(testo: string): string {
  let t = testo.replace(new RegExp(ARTICOLO_ESTESO.source, ARTICOLO_ESTESO.flags), " ");
  t = t.replace(new RegExp(REGEX_ARTICOLI.source, REGEX_ARTICOLI.flags), " ");
  for (const re of REGEX_NORME) t = t.replace(new RegExp(re.source, re.flags), " ");
  return t;
}

function aggiungiCitazioneAllUnita(riga: string, unita: Unita, frammento: string): string {
  if (unita.tipo === "riga") {
    // Nella cella più lunga (quella descrittiva), in coda.
    const celle = cellePerRiga(riga);
    let indice = 0;
    celle.forEach((c, j) => {
      if (pulisciCellaPerValore(c).length > pulisciCellaPerValore(celle[indice]).length) indice = j;
    });
    const originale = celle[indice];
    celle[indice] = `${originale.trimEnd()} (${frammento})${originale.endsWith(" ") ? " " : ""}`;
    return `|${celle.join("|")}|`;
  }
  const posizione = riga.indexOf(unita.testo);
  if (posizione < 0) return riga;
  const fine = posizione + unita.testo.length;
  const m = unita.testo.match(/^([\s\S]*?)([.;:!?]*(?:\*\*)?)$/);
  const corpo = m ? m[1] : unita.testo;
  const coda = m ? m[2] : "";
  return `${riga.slice(0, posizione)}${corpo} (${frammento})${coda}${riga.slice(fine)}`;
}

function ripristinaCitazioni(verificato: string, righeCompresso: string[]): { ripristinate: string[]; nonRipristinabili: string[] } {
  const ripristinate: string[] = [];
  const nonRipristinabili: string[] = [];

  const riferimentiVerificato = estraiRiferimenti(verificato);
  const perse = riferimentiVerificato.filter((r) => !riferimentoConservato(r, estraiRiferimenti(righeCompresso.join("\n"))));
  if (perse.length === 0) return { ripristinate, nonRipristinabili };

  const righeVerificato = verificato.split("\n");
  const unitaVerificato = unitaDelTesto(righeVerificato);

  for (const riferimento of perse) {
    // Già rimessa da un ripristino precedente nello stesso giro (una frase
    // può contenere più riferimenti).
    if (riferimentoConservato(riferimento, estraiRiferimenti(righeCompresso.join("\n")))) continue;

    const sorgente = unitaVerificato.find((u) => estraiRiferimenti(u.testo).some((r) => r === riferimento || r.startsWith(`${riferimento} `)));
    if (!sorgente) {
      nonRipristinabili.push(`${riferimento} (frase di origine non individuabile)`);
      continue;
    }
    const frammento = frammentoCitazione(sorgente.testo, riferimento);
    const ricorrenza = senzaCitazioni(sorgente.testo);

    // Cerca l'unità del testo compresso che è la versione accorciata della
    // frase di origine: stesso tipo, massima sovrapposizione di parole.
    const unitaCompresso = unitaDelTesto(righeCompresso).filter((u) => u.tipo === sorgente.tipo || (u.tipo !== "riga" && sorgente.tipo !== "riga"));
    let migliore: { u: Unita; punteggio: number; comuni: number } | null = null;
    for (const u of unitaCompresso) {
      const s = sovrapposizione(ricorrenza, senzaCitazioni(u.testo));
      if (!migliore || s.punteggio > migliore.punteggio) migliore = { u, ...s };
    }

    if (migliore && migliore.punteggio >= SOGLIA_ABBINAMENTO && migliore.comuni >= MINIMO_RADICI_COMUNI) {
      righeCompresso[migliore.u.riga] = aggiungiCitazioneAllUnita(righeCompresso[migliore.u.riga], migliore.u, frammento);
      ripristinate.push(`${riferimento} → aggiunto «${frammento}» alla frase compressa`);
      continue;
    }

    // La frase è stata tolta per intero: si rimette la frase verificata
    // (stesso testo, nessun contenuto nuovo) in coda al blocco.
    if (sorgente.tipo === "riga") {
      // Una riga di tabella si rimette solo dentro una tabella esistente con
      // lo stesso numero di colonne.
      const colonne = cellePerRiga(sorgente.testo).length;
      let ultimaRigaTabella = -1;
      righeCompresso.forEach((r, i) => {
        if (eRigaTabella(r) && cellePerRiga(r).length === colonne) ultimaRigaTabella = i;
      });
      if (ultimaRigaTabella < 0) {
        nonRipristinabili.push(`${riferimento} (riga di tabella tolta e nessuna tabella compatibile)`);
        continue;
      }
      righeCompresso.splice(ultimaRigaTabella + 1, 0, sorgente.testo);
    } else {
      while (righeCompresso.length > 0 && righeCompresso[righeCompresso.length - 1].trim() === "") righeCompresso.pop();
      righeCompresso.push("", sorgente.testo);
    }
    ripristinate.push(`${riferimento} → rimessa la frase verificata che lo conteneva`);
  }
  return { ripristinate, nonRipristinabili };
}

// ————————————————————————————————————————————————————————————————
// Interfaccia
// ————————————————————————————————————————————————————————————————

function ripristinaBlocco(verificato: string, compresso: string): EsitoRipristino {
  const righe = compresso.split("\n");
  const asterischiRipristinati = ripristinaAsterischi(verificato, righe);
  const noteRipristinate = ripristinaNota(verificato, righe);
  const { ripristinate, nonRipristinabili } = ripristinaCitazioni(verificato, righe);
  return { testo: righe.join("\n"), asterischiRipristinati, noteRipristinate, citazioniRipristinate: ripristinate, nonRipristinabili };
}

// Ripristina asterischi, note e citazioni scomparsi dal testo compresso
// rispetto a quello verificato, blocco per blocco (## x.y): il confronto è
// tra lo stesso sotto-criterio, non tra testi interi in cui un valore
// potrebbe comparire altrove. Blocchi presenti solo da una parte vengono
// lasciati come sono.
export function ripristinaDaTestoVerificato(verificato: string, compresso: string): EsitoRipristino {
  const blocchiV = dividiBlocchi(verificato);
  const blocchiC = dividiBlocchi(compresso);
  const totale: EsitoRipristino = { testo: "", asterischiRipristinati: [], noteRipristinate: [], citazioniRipristinate: [], nonRipristinabili: [] };

  const senzaChiaveV = blocchiV.filter((b) => b.chiave === null);
  let indiceSenzaChiave = 0;

  const risultati = blocchiC.map((bc) => {
    const bv = bc.chiave === null ? senzaChiaveV[indiceSenzaChiave++] : blocchiV.find((b) => b.chiave?.toLowerCase() === bc.chiave!.toLowerCase());
    if (!bv) return bc.testo;
    const esito = ripristinaBlocco(bv.testo, bc.testo);
    const prefisso = bc.chiave ? `${bc.chiave}: ` : "";
    totale.asterischiRipristinati.push(...esito.asterischiRipristinati.map((x) => `${prefisso}${x}`));
    totale.noteRipristinate.push(...esito.noteRipristinate.map((x) => `${prefisso}${x}`));
    totale.citazioniRipristinate.push(...esito.citazioniRipristinate.map((x) => `${prefisso}${x}`));
    totale.nonRipristinabili.push(...esito.nonRipristinabili.map((x) => `${prefisso}${x}`));
    return esito.testo;
  });

  totale.testo = risultati.join("\n");
  return totale;
}

export function riepilogoRipristino(esito: EsitoRipristino): string {
  const parti: string[] = [];
  if (esito.asterischiRipristinati.length) parti.push(`${esito.asterischiRipristinati.length} asterisco/i di conferma rimesso/i (${esito.asterischiRipristinati.join("; ")})`);
  if (esito.noteRipristinate.length) parti.push(`${esito.noteRipristinate.length} nota/e esplicativa/e rimessa/e`);
  if (esito.citazioniRipristinate.length) parti.push(`${esito.citazioniRipristinate.length} citazione/i rimessa/e (${esito.citazioniRipristinate.join("; ")})`);
  if (esito.nonRipristinabili.length) parti.push(`NON ripristinabili: ${esito.nonRipristinabili.join("; ")}`);
  return parti.length ? parti.join(" | ") : "nulla da ripristinare";
}
