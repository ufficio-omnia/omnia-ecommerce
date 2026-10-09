import { dividiInBlocchi } from "@/lib/budget-blocchi";
import { misuraVisiva, type MisuraVisiva } from "@/lib/ricchezza-visiva";

// Densità visiva MINIMA di un testo OMNIA, garantita dal codice e non dal solo
// prompt. Verificato con il modello vero (scripts/prova-ricchezza-visiva.ts):
// il prompt di una data in cui le icone venivano scritte da sole, rigiocato
// oggi, ne produce 0-2 per criterio invece di 20-36 — il comportamento del
// modello su questo punto cambia nel tempo e il prompt non basta a fissarlo.
// Le icone sono decorazione pura (nessun contenuto, nessuna pagina in più),
// quindi si possono assegnare in modo deterministico; riquadri e tabelle no
// (richiedono di scegliere cosa evidenziare) e qui vengono solo misurati.

// Soglia sotto la quale il codice completa le icone: il riferimento di una
// relazione ben riuscita è 17-26 ogni 1000 parole, quella prodotta dal prompt
// attuale 15-25. Con meno di 8 il modello le ha di fatto dimenticate.
export const ICONE_MINIME_PER_1000_PAROLE = 8;

type Icona = { nome: string; radici: string[] };

// Ordine = priorità a parità di punteggio. Le radici corte (sigle) devono
// coincidere con l'intera parola; le altre valgono come inizio di parola.
const ICONE: Icona[] = [
  { nome: "sicurezza", radici: ["sicurezz", "infortun", "antinfortun", "protezion", "rischi", "dpi", "rspp", "dvr", "emergenz", "antincend", "evacuaz", "preposto"] },
  { nome: "ambiente", radici: ["ambient", "ecolabel", "cam", "rifiut", "differenziat", "ecolog", "sostenib", "energ", "emission", "ricicl", "biodegrad", "impatt", "imballagg", "idric", "acqua"] },
  { nome: "formazione", radici: ["formazion", "addestr", "corso", "corsi", "aggiornament", "affiancament", "tutor"] },
  { nome: "certificazione", radici: ["certificaz", "certificat", "iso", "uni", "attestat", "accredit", "emas", "marchio", "omologaz"] },
  { nome: "pulizia", radici: ["pulizi", "detergen", "sanific", "disinfe", "igieniz", "lavagg", "sanitari", "superfic", "vetri", "pavimenti", "spolver", "deodor", "sgrassan", "ceratur"] },
  { nome: "attrezzature", radici: ["attrezzatur", "macchin", "dosator", "diluitor", "aspirapolver", "lavasciug", "microfibr", "carrell", "strument", "mezzi", "dotazion", "monospazzol", "apparecchi"] },
  { nome: "tempistiche", radici: ["orari", "frequenz", "giornalier", "settimanal", "mensil", "trimestral", "semestral", "annual", "tempi", "tempistic", "h24", "reperibil", "scadenz", "cronoprogramma", "calendario", "puntual"] },
  { nome: "monitoraggio", radici: ["monitor", "verific", "rilevaz", "rilevament", "misuraz", "registraz", "tracciab", "sopralluog", "controll", "campionament", "valutaz", "check"] },
  { nome: "qualita", radici: ["qualit", "autoverific", "audit", "ispezion", "kpi", "indicator", "conformit", "standard"] },
  { nome: "comunicazione", radici: ["comunicaz", "segnalaz", "rendicont", "interfaccia", "contatt", "canale", "riunion", "feedback", "app", "portale", "piattaforma", "telefon", "email", "reclam"] },
  { nome: "logistica", radici: ["logistic", "magazzin", "approvvigion", "trasport", "fornitur", "scorte", "consegn", "stoccagg", "fornitor"] },
  { nome: "documentazione", radici: ["document", "manual", "procedur", "protocoll", "registro", "piano", "dossier", "schede", "modulistic", "istruzion", "archivi"] },
  { nome: "personale", radici: ["personale", "operator", "addett", "squadra", "capisquadra", "caposquadra", "responsabil", "referent", "risors", "organico", "dipendent", "figur", "coordinator", "ispettor"] },
];

// Toglie gli accenti ("qualità" → "qualita"): le radici sono scritte senza.
const SEGNI_DIACRITICI = new RegExp("[" + String.fromCharCode(0x0300) + "-" + String.fromCharCode(0x036f) + "]", "g");

function normalizza(testo: string): string {
  return testo.normalize("NFD").replace(SEGNI_DIACRITICI, "").toLowerCase();
}

function corrisponde(parola: string, radice: string): boolean {
  return radice.length <= 4 ? parola === radice : parola.startsWith(radice);
}

// Icona più pertinente per un'etichetta, o null se nessuna radice
// corrisponde: meglio nessuna icona di un'icona che non c'entra.
export function sceltaIcona(etichetta: string, contesto = ""): string | null {
  const parole = normalizza(etichetta).split(/[^a-z0-9]+/).filter(Boolean);
  const paroleContesto = normalizza(contesto).split(/[^a-z0-9]+/).filter(Boolean);
  let migliore: { nome: string; punti: number } | null = null;
  for (const icona of ICONE) {
    let punti = 0;
    for (const radice of icona.radici) {
      if (parole.some((p) => corrisponde(p, radice))) punti += 1;
      else if (paroleContesto.some((p) => corrisponde(p, radice))) punti += 0.2;
    }
    // Serve almeno una corrispondenza nell'etichetta stessa: il solo
    // contesto (le altre celle della riga) non basta.
    const nelEtichetta = icona.radici.some((r) => parole.some((p) => corrisponde(p, r)));
    if (!nelEtichetta) continue;
    if (!migliore || punti > migliore.punti) migliore = { nome: icona.nome, punti };
  }
  return migliore?.nome ?? null;
}

const TAG_IN_TESTA = /^(?:\s*(?:\[(?:RIGA|CELLA):[^\]]*\]|\[(?:C|G)\]))*\s*/;

function etichettaPulita(testo: string): string {
  return testo
    .replace(/\[(?:RIGA|CELLA):[^\]]*\]/gi, " ")
    .replace(/\[(?:C|G|ICONA:[^\]]*)\]/g, " ")
    .replace(/\\\*/g, "")
    .replace(/[*!]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function haAlmenoDueParoleDiLettere(testo: string): boolean {
  return testo.split(/\s+/).filter((p) => /[A-Za-zÀ-ÿ]{3,}/.test(p)).length >= 2;
}

const RIGA_TABELLA = /^\s*\|.*\|\s*$/;
const SEPARATORE_TABELLA = /^\s*\|[-:\s|]+\|\s*$/;

// Inserisce "[ICONA:x] " dopo i tag di riga/cella/allineamento in testa al
// testo, come fa il modello ("[G][ICONA:ambiente] **Etichetta**").
function conIcona(testo: string, nome: string): string {
  const testa = testo.match(TAG_IN_TESTA)?.[0] ?? "";
  return `${testa}[ICONA:${nome}] ${testo.slice(testa.length).replace(/^\s+/, "")}`;
}

export type EsitoIcone = { testo: string; aggiunte: number; saltato: boolean };

// Completa le icone mancanti nelle righe d'impegno di tabelle ed elenchi
// puntati, ma SOLO se il testo ne ha meno di ICONE_MINIME_PER_1000_PAROLE:
// un testo che le ha già (come le scrive il prompt) non viene toccato, e
// riapplicare la funzione sul proprio risultato non cambia più nulla.
// Salta: intestazioni di tabella, tabelle di soli dati (prima colonna senza
// parole), organigrammi, righe senza una radice riconoscibile.
export function assegnaIconeMancanti(testo: string): EsitoIcone {
  const misura = misuraVisiva(testo);
  if (misura.parole === 0 || (misura.icone / misura.parole) * 1000 >= ICONE_MINIME_PER_1000_PAROLE) {
    return { testo, aggiunte: 0, saltato: true };
  }

  const righe = testo.split("\n");
  let dentroOrganigramma = false;
  let aggiunte = 0;

  // Prima passata: per ogni tabella, le righe di dati e se la prima colonna
  // è fatta di etichette (altrimenti è una tabella di soli dati).
  const dati = new Set<number>();
  for (let i = 0; i < righe.length; ) {
    if (!RIGA_TABELLA.test(righe[i]) || SEPARATORE_TABELLA.test(righe[i])) { i++; continue; }
    let fine = i;
    while (fine < righe.length && RIGA_TABELLA.test(righe[fine])) fine++;
    const intestazioneSeguitaDaSeparatore = i + 1 < fine && SEPARATORE_TABELLA.test(righe[i + 1]);
    if (intestazioneSeguitaDaSeparatore) {
      const candidate: number[] = [];
      for (let k = i + 2; k < fine; k++) if (!SEPARATORE_TABELLA.test(righe[k])) candidate.push(k);
      const conEtichetta = candidate.filter((k) => haAlmenoDueParoleDiLettere(etichettaPulita(righe[k].split("|")[1] ?? "")));
      if (candidate.length > 0 && conEtichetta.length / candidate.length >= 0.5) conEtichetta.forEach((k) => dati.add(k));
    }
    i = fine;
  }

  const nuove = righe.map((riga, i) => {
    if (/\[(?:ORGANIGRAMMA|FIGURA)\]/i.test(riga)) dentroOrganigramma = true;
    if (/\[\/(?:ORGANIGRAMMA|FIGURA)\]/i.test(riga)) { dentroOrganigramma = false; return riga; }
    if (dentroOrganigramma || /\[ICONA:/.test(riga)) return riga;

    if (dati.has(i)) {
      const celle = riga.split("|");
      const prima = celle[1] ?? "";
      const etichetta = etichettaPulita(prima);
      const nome = sceltaIcona(etichetta, celle.slice(2, -1).map(etichettaPulita).join(" "));
      if (!nome) return riga;
      celle[1] = ` ${conIcona(prima.trim(), nome)} `;
      aggiunte++;
      return celle.join("|");
    }

    const punto = riga.match(/^(\s*-\s+)(.*)$/);
    if (punto && !RIGA_TABELLA.test(riga)) {
      const etichetta = etichettaPulita(punto[2].split(/\s+/).slice(0, 14).join(" "));
      if (!haAlmenoDueParoleDiLettere(etichetta)) return riga;
      const nome = sceltaIcona(etichetta);
      if (!nome) return riga;
      aggiunte++;
      return `${punto[1]}${conIcona(punto[2], nome)}`;
    }
    return riga;
  });

  return { testo: aggiunte > 0 ? nuove.join("\n") : testo, aggiunte, saltato: false };
}

export type DensitaBlocco = { chiave: string; titolo: string; misura: MisuraVisiva; mancaRiquadro: boolean; mancaTabella: boolean };
export type DensitaTesto = { misura: MisuraVisiva; icone1000: number; sottoSogliaIcone: boolean; blocchi: DensitaBlocco[] };

// Un blocco è "discorsivo" se ha un sotto-criterio ("## x.y"), non è la
// sola dicitura tabellare e ha abbastanza testo da avere qualcosa da
// evidenziare.
const PAROLE_MINIME_BLOCCO_DISCORSIVO = 120;

export function analizzaDensita(testo: string): DensitaTesto {
  const misura = misuraVisiva(testo);
  const icone1000 = misura.parole > 0 ? (misura.icone / misura.parole) * 1000 : 0;
  const blocchi: DensitaBlocco[] = [];
  for (const b of dividiInBlocchi(testo)) {
    if (!b.chiave || /CRITERIO TABELLARE/i.test(b.testo)) continue;
    const m = misuraVisiva(b.testo);
    if (m.parole < PAROLE_MINIME_BLOCCO_DISCORSIVO) continue;
    blocchi.push({
      chiave: b.chiave,
      titolo: (b.testo.split("\n")[0] ?? "").replace(/^#+\s*/, "").trim(),
      misura: m,
      mancaRiquadro: m.riquadri === 0,
      mancaTabella: m.tabelle === 0,
    });
  }
  return { misura, icone1000, sottoSogliaIcone: misura.parole > 0 && icone1000 < ICONE_MINIME_PER_1000_PAROLE, blocchi };
}
