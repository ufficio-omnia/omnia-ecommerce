// Filtro deterministico sui dati del personale uscente estratti dai documenti di gara.
//
// La pagina pubblica «Riservatezza» (e l'Allegato A) dicono che dagli elenchi del
// personale si ricavano solo livello contrattuale, ore, anzianità e qualifiche, e che
// nominativi, codici fiscali e matricole non vengono riportati in quei dati. Finora lo
// garantiva solo l'istruzione data al modello nello schema di estrazione; un modello può
// sbagliare, e un codice fiscale finito nei dati strutturati comparirebbe nel prompt di
// generazione e, di lì, nel documento Word che la commissione di gara legge. Questo
// filtro è la garanzia che non dipende dal modello: gira SEMPRE, in due punti
// (salvataggio dell'estratto e formattazione per la generazione), così vale anche per le
// gare analizzate prima che esistesse.
//
// Cosa garantisce, e cosa no (da dire con onestà):
//  - schema chiuso: di ogni voce restano SOLO i cinque campi previsti; qualunque altro
//    campo (nome, cognome, matricola, codice_fiscale, id…) viene scartato;
//  - codici fiscali: riconosciuti per struttura (anche con omocodia, anche con spazi,
//    punti o trattini tra i caratteri) e tolti dal testo;
//  - matricole e codici identificativi quando sono ETICHETTATI («matr. 1234», «matricola
//    A12», «badge 77», «cod. dipendente 9»): etichetta e valore tolti;
//  - nominativi quando sono ETICHETTATI («nominativo: Rossi Mario», «Sig.ra Bianchi»,
//    «cognome Verdi»): etichetta e nome tolti;
//  - NON si può riconoscere con certezza un nome scritto in chiaro senza alcuna etichetta
//    in un campo libero (note, anzianità): lì resta l'istruzione al modello, che chiede
//    riferimenti anonimi («Addetto 1»). Il documento originale resta conservato com'è.

export type VocePersonale = {
  livello_contrattuale: string;
  numero_addetti: number;
  ore_settimanali?: number | null;
  anzianita?: string | null;
  note?: string | null;
};

export type InterventiPulizia = {
  // voci non valide (non oggetti) scartate
  vociScartate: number;
  // campi diversi dai cinque previsti, scartati
  campiEstranei: number;
  codiciFiscali: number;
  matricole: number;
  nominativi: number;
};

export type RisultatoPulizia = { voci: VocePersonale[]; interventi: InterventiPulizia };

export function nessunIntervento(i: InterventiPulizia): boolean {
  return i.vociScartate === 0 && i.campiEstranei === 0 && i.codiciFiscali === 0 && i.matricole === 0 && i.nominativi === 0;
}

const CAMPI_AMMESSI = new Set(["livello_contrattuale", "numero_addetti", "ore_settimanali", "anzianita", "note"]);
const LIVELLO_NON_INDICATO = "Livello non indicato";

// Codice fiscale italiano: 6 lettere, 2 cifre, 1 lettera del mese, 2 cifre, 1 lettera,
// 3 cifre, 1 lettera di controllo. Con omocodia alcune cifre diventano lettere (LMNPQRSTUV).
// Tra un carattere e l'altro si ammette un solo separatore (spazio, punto, trattino): un
// elenco copiato da un PDF spesso spezza il codice. Nessun separatore in più per non
// agganciare testo normale.
const CIFRA_OMOCODIA = "[0-9LMNPQRSTUV]";
const PARTI_CODICE_FISCALE = ["[A-Z]", "[A-Z]", "[A-Z]", "[A-Z]", "[A-Z]", "[A-Z]", CIFRA_OMOCODIA, CIFRA_OMOCODIA, "[ABCDEHLMPRST]", CIFRA_OMOCODIA, CIFRA_OMOCODIA, "[A-Z]", CIFRA_OMOCODIA, CIFRA_OMOCODIA, CIFRA_OMOCODIA, "[A-Z]"];
const CODICE_FISCALE = new RegExp(`(?<![A-Za-z0-9])${PARTI_CODICE_FISCALE.join("[ .\\-]?")}(?![A-Za-z0-9])`, "gi");

// Etichette di una matricola o di un altro codice che identifica l'addetto, seguite dal
// valore (almeno una cifra). L'etichetta non deve continuare con altre lettere
// («matrimonio» non è «matr»).
// «matr.» può essere seguito subito da altre lettere («Matr.n. 78»); senza il punto
// l'etichetta deve finire lì («matrimonio» non è «matr»).
const ETICHETTA_MATRICOLA = "(?:matricola(?![A-Za-z])|matr\\.|matr(?![A-Za-z])|mat\\.|badge(?![A-Za-z])|cod(?:ice|\\.)?\\s*(?:dipendente|addetto|operatore|lavoratore)(?![A-Za-z])|id\\s*(?:dipendente|addetto|operatore|lavoratore)(?![A-Za-z]))";
const MATRICOLA = new RegExp(`(?<![A-Za-z0-9])(?:(?:n(?:umero|\\.|°)?|nr\\.?)\\s*)?${ETICHETTA_MATRICOLA}\\s*(?:(?:n(?:\\.|°|umero)?|nr\\.?)\\s*)?[:#.\\-–]?\\s*[A-Za-z]{0,3}[ \\-]?\\d[\\w\\-/]*`, "gi");

// Etichette di un nominativo. Si toglie anche la parola (o le due-tre parole) con la
// maiuscola che segue: «Sig.ra Bianchi Anna», «nominativo: ROSSI MARIO».
const ETICHETTA_NOME = /(?<![A-Za-z])(?:nominativo|cognome\s+e\s+nome|nome\s+e\s+cognome|cognome|nome|generalit[àa]|sig\.?\s?ra|sig\.?\s?na|sig(?:nor[ae])?\.?|sigg\.?|dott\.?\s?ssa|dott\.?|ing\.|geom\.|avv\.|prof\.?\s?ssa|prof\.?|rag\.)(?![A-Za-zÀ-ÿ])/gi;
const NOME_DOPO_ETICHETTA = /^[\s:.\-–]*([A-ZÀ-Ý][A-Za-zÀ-ÿ'’]+(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'’]+){0,2})/;

function conteggio(testo: string, schema: RegExp, filtro?: (trovato: string) => boolean): number {
  let n = 0;
  for (const m of testo.matchAll(new RegExp(schema.source, schema.flags))) if (!filtro || filtro(m[0])) n++;
  return n;
}

function togliCodiciFiscali(testo: string): { testo: string; trovati: number } {
  let trovati = 0;
  const pulito = testo.replace(CODICE_FISCALE, (m) => {
    // niente cifre = una parola di sedici lettere che per caso ha la forma giusta, non un codice
    if (!/\d/.test(m)) return m;
    trovati++;
    return " ";
  });
  return { testo: pulito, trovati };
}

function togliMatricole(testo: string): { testo: string; trovati: number } {
  const trovati = conteggio(testo, MATRICOLA);
  return { testo: testo.replace(MATRICOLA, " "), trovati };
}

function togliNominativiEtichettati(testo: string): { testo: string; trovati: number } {
  let trovati = 0;
  let risultato = "";
  let da = 0;
  for (const m of testo.matchAll(new RegExp(ETICHETTA_NOME.source, ETICHETTA_NOME.flags))) {
    const inizio = m.index ?? 0;
    if (inizio < da) continue;
    const fineEtichetta = inizio + m[0].length;
    const nome = NOME_DOPO_ETICHETTA.exec(testo.slice(fineEtichetta));
    if (!nome) continue;
    risultato += testo.slice(da, inizio) + " ";
    da = fineEtichetta + nome[0].length;
    trovati++;
  }
  return { testo: risultato + testo.slice(da), trovati };
}

// Sistemazione minima, sempre: caratteri di controllo e invisibili (un PDF copiato ne porta
// spesso) e spazi ripetuti. Non tocca la punteggiatura: un testo senza dati identificativi
// resta com'è («Livello 3 - Operaio» conserva il suo trattino).
function riordinaMinimo(testo: string): string {
  return testo.replace(/[^\P{C}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

// Dopo aver tolto qualcosa restano virgole doppie, trattini o barre soli, parentesi vuote:
// qui si ripulisce anche quello.
function riordinaDopoRimozioni(testo: string): string {
  return riordinaMinimo(testo)
    .replace(/\s+([,;:.)])/g, "$1")
    .replace(/([,;:])(?:\s*[,;:])+/g, "$1")
    .replace(/(^|\s)[,;:\-–/|+]+(?=\s|$)/g, "$1")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,;:.\-–/|\s]+|[,;:\-–/|\s]+$/g, "")
    .trim();
}

// Ripulisce un testo libero. Restituisce null se dopo la pulizia non resta nulla.
export function ripulisciTesto(testo: string, interventi?: InterventiPulizia): string | null {
  const cf = togliCodiciFiscali(testo);
  const matr = togliMatricole(cf.testo);
  const nomi = togliNominativiEtichettati(matr.testo);
  if (interventi) {
    interventi.codiciFiscali += cf.trovati;
    interventi.matricole += matr.trovati;
    interventi.nominativi += nomi.trovati;
  }
  const tolto = cf.trovati + matr.trovati + nomi.trovati > 0;
  const finale = tolto ? riordinaDopoRimozioni(nomi.testo) : riordinaMinimo(nomi.testo);
  return finale === "" ? null : finale;
}

function numeroOCampo(valore: unknown): number | null {
  const n = typeof valore === "number" ? valore : typeof valore === "string" && valore.trim() !== "" ? Number(valore.replace(",", ".")) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Ripulisce l'elenco del personale uscente. `voci` è ciò che ha prodotto il modello o che
// sta nel database (jsonb): non si fa nessuna ipotesi sulla sua forma.
export function ripulisciPersonaleUscente(voci: unknown): RisultatoPulizia {
  const interventi: InterventiPulizia = { vociScartate: 0, campiEstranei: 0, codiciFiscali: 0, matricole: 0, nominativi: 0 };
  const risultato: VocePersonale[] = [];

  for (const grezza of Array.isArray(voci) ? voci : []) {
    if (!grezza || typeof grezza !== "object" || Array.isArray(grezza)) {
      interventi.vociScartate++;
      continue;
    }
    const v = grezza as Record<string, unknown>;
    for (const chiave of Object.keys(v)) if (!CAMPI_AMMESSI.has(chiave)) interventi.campiEstranei++;

    const livello = typeof v.livello_contrattuale === "string" ? ripulisciTesto(v.livello_contrattuale, interventi) : null;
    // una persona per riga se il documento non aggrega: il numero mancante o non valido vale 1
    const addetti = numeroOCampo(v.numero_addetti) ?? 1;
    const voce: VocePersonale = { livello_contrattuale: livello ?? LIVELLO_NON_INDICATO, numero_addetti: addetti };

    const ore = numeroOCampo(v.ore_settimanali);
    if (ore !== null) voce.ore_settimanali = ore;
    const anzianita = typeof v.anzianita === "string" ? ripulisciTesto(v.anzianita, interventi) : null;
    if (anzianita) voce.anzianita = anzianita;
    const note = typeof v.note === "string" ? ripulisciTesto(v.note, interventi) : null;
    if (note) voce.note = note;

    risultato.push(voce);
  }

  return { voci: risultato, interventi };
}

// Per i punti di lettura (formattazione per il modello): voci già pulite, in silenzio se
// non c'era nulla da togliere; se c'era, lo si registra nel log (solo i numeri).
export function personaleUscenteSicuro<T extends VocePersonale>(voci: T[] | null | undefined): VocePersonale[] | null {
  if (!voci) return null;
  const { voci: pulite, interventi } = ripulisciPersonaleUscente(voci);
  if (!nessunIntervento(interventi)) console.warn("Personale uscente: dati identificativi tolti prima dell'uso", interventi);
  return pulite;
}
