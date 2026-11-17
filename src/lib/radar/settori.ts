// Settori di Tender Intelligence e classificazione delle gare. Logica pura: nessun database, nessuna rete.
//
// Regole approvate (04_DECISIONI_E_PIANO, §2 e §4):
//   - la mappa CPV → settore viene SOLO dal file approvato (settori-dati.ts, generato da dati/cpv-settori-omnia.csv), con
//     corrispondenza ESATTA sulle 8 cifre, su qualunque CPV della gara;
//   - l'ausiliariato non ha un CPV proprio: si riconosce solo dalle parole dell'oggetto;
//   - una gara che non ha un CPV del file entra solo se l'oggetto contiene le parole chiave del settore e nessuna parola di esclusione,
//     ed è marcata «trovata per parola chiave»;
//   - ogni classificazione porta il suo motivo, da mostrare al cliente (pertinenza spiegabile);
//   - (17/11/2026, qualità delle gare) un settore venuto da un CPV del file si toglie quando l'OGGETTO dice chiaramente un altro mestiere
//     (ESCLUSIONI_OGGETTO), mai quando l'oggetto nomina il servizio del settore con le sue parole approvate. Esclusione ≠ cancellazione:
//     la classificazione riporta ogni settore tolto con la regola e il motivo; nessun dato della gara si cancella.
import { CPV_SETTORI_OMNIA } from "./settori-dati";

export const SETTORI_RADAR = [
  { id: "pulizia", nome: "Pulizia e sanificazione" },
  { id: "ristorazione", nome: "Ristorazione collettiva" },
  { id: "vigilanza_portierato", nome: "Vigilanza privata e portierato" },
  { id: "facchinaggio", nome: "Facchinaggio e movimentazione" },
  { id: "multiservizi", nome: "Multiservizi e gestione edifici" },
  { id: "ausiliariato", nome: "Ausiliariato" },
] as const;

export type SettoreRadar = (typeof SETTORI_RADAR)[number]["id"];

export function nomeSettore(id: SettoreRadar): string {
  return SETTORI_RADAR.find((s) => s.id === id)?.nome ?? id;
}

// Il nome del settore come scritto nel CSV → identificativo interno. Un nome sconosciuto è un errore del file (lo intercetta il test).
export function settoreDaNomeFile(nome: string): SettoreRadar | null {
  const trovato = SETTORI_RADAR.find((s) => s.nome.toLowerCase() === nome.trim().toLowerCase());
  return trovato ? trovato.id : null;
}

type VoceCpv = { cpv: string; codice: string; descrizione: string; settore: SettoreRadar };

// Una riga con un settore sconosciuto resta fuori dalla mappa (mai attribuita a un settore a caso): il test la segnala come errore del file.
const MAPPA_CPV: ReadonlyMap<string, VoceCpv> = new Map(
  CPV_SETTORI_OMNIA.flatMap((r) => {
    const settore = settoreDaNomeFile(r.settore);
    return settore ? [[r.cpv, { cpv: r.cpv, codice: r.codice, descrizione: r.descrizione, settore }] as const] : [];
  }),
);

export function vociCpv(): VoceCpv[] {
  return [...MAPPA_CPV.values()];
}

export function cpvDelSettore(settore: SettoreRadar): string[] {
  return vociCpv().filter((v) => v.settore === settore).map((v) => v.cpv);
}

// «90910000-9», «90910000», « 90910000 » → «90910000». Tutto il resto (99999999 compreso, che le fonti usano per «non disponibile») → null.
export function normalizzaCpv(valore: string | null | undefined): string | null {
  const m = (valore ?? "").trim().match(/^(\d{8})(?:-\d)?$/);
  if (!m || m[1] === "99999999") return null;
  return m[1];
}

export function voceCpv(cpv: string | null | undefined): VoceCpv | null {
  const n = normalizzaCpv(cpv);
  return n ? MAPPA_CPV.get(n) ?? null : null;
}

// ───── parole chiave (oggetto e descrizione) ─────

// Testo per il confronto: minuscole, senza accenti, spazi semplici.
export function testoPerConfronto(testo: string | null | undefined): string {
  return (testo ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// «salvo»: se l'oggetto affida esplicitamente il servizio, «escludi» non vale
type RegolaParole = { settore: SettoreRadar; cerca: RegExp; escludi: RegExp | null; salvo?: RegExp; esempio: string };

// Le esclusioni vengono dai casi reali dello spike (02, §4.1 e 04, §4.1): «pulizia» compare anche in fognature, strade, rifiuti; «mensa» nei
// buoni pasto e negli arredi; «vigilanza» nella videosorveglianza e negli impianti. «Custodia» non è tra le parole: catturava canili e cimiteri.
export const REGOLE_PAROLE: readonly RegolaParole[] = [
  {
    settore: "pulizia",
    cerca: /\b(pulizi[ae]|sanificazion[ei]|disinfezion[ei]|disinfestazion[ei]|igiene ambientale)\b/,
    escludi: /\b(strad\w*|fognat\w*|fogn\w*|caditoi\w*|spurg\w*|rifiut\w*|spiagg\w*|arenil\w*|alve\w*|neve|prodott\w*|material\w*|cassonett\w*)\b/,
    esempio: "pulizia, sanificazione, disinfestazione",
  },
  {
    settore: "ausiliariato",
    cerca: /\b(ausiliariato|servizi ausiliari|servizio ausiliario|servizio di ausiliariato)\b/,
    // «servizio ausiliario al rilascio di visti» (esternalizzazione consolare): caso reale di TED nell'archivio dello staging, 17/11/2026
    escludi: /\b(visti|consolar\w*|consolat\w*)\b/,
    esempio: "ausiliariato, servizi ausiliari",
  },
  {
    settore: "facchinaggio",
    cerca: /\b(facchinaggio|trasloco|traslochi|movimentazione (di )?arredi)\b/,
    escludi: /\b(movimentazione (di )?terra|rifiut\w*|container\w*)\b/,
    esempio: "facchinaggio, trasloco",
  },
  {
    settore: "ristorazione",
    cerca: /\b(ristorazione|mensa|mense|refezione|pasti)\b/,
    // «rifiuti … di cucine e mense» (codice EER 20.01.08): caso reale di TED del 16/11/2026
    escludi: /\b(buon[oi] pasto|ticket\w*|attrezzatur\w*|arred\w*|derrat\w*|rifiut\w*)\b/,
    esempio: "ristorazione, mensa, refezione",
  },
  {
    settore: "vigilanza_portierato",
    cerca: /\b(vigilanza|portierato|portineria|guardiania|reception)\b/,
    // «videosorveglianza» da sola non esclude più (decisione dell'utente del 17/11): la vigilanza che comprende la videosorveglianza
    // resta; forniture, installazioni e manutenzioni di impianti si riconoscono con le regole dei quattro tipi (ESCLUSIONI_OGGETTO e
    // CORRELAZIONI). «Impianti» e «manutenzione» restano esclusioni dello spike, ma non quando l'oggetto affida esplicitamente il servizio
    escludi: /\b(impiant\w*|manutenzion\w*|attraversament\w*|scuolabus)\b/,
    salvo: /\b(servizi?o? (di )?(vigilanza|portierato|portineria|guardiania|reception)|vigilanza (armata|non armata|privata|fissa|ispettiva|attiva)|guardi\w* giurat\w*|istitut\w* di vigilanza)\b/,
    esempio: "vigilanza, portierato, guardiania",
  },
  {
    settore: "multiservizi",
    // «Marche Multiservizi SpA», «Levante Multiservizi s.r.l.»: è il nome della società che fa la gara (assicurazioni, socio privato),
    // non il servizio. Casi reali di TED nell'archivio dello staging, 17/11/2026
    cerca: /\b(multiservizi(?! (spa|s p a|srl|s r l|scarl|s c a r l)\b)|global service|facility management|servizi integrati)\b/,
    // «servizi integrati» di formazione, gestione documentale, biblioteca, sterilizzazione, apparecchiature elettromedicali, consulenza
    // sui rifiuti, percorsi espositivi, lavanolo: casi reali di TED nell'archivio dello staging, 17/11/2026
    escludi: /\b(formazion\w*|documental\w*|bibliotec\w*|sterilizzazion\w*|apparecchiatur\w*|elettromedical\w*|biomedical\w*|strumentari\w*|attrezzature scientific\w*|consulenz\w*|assicurativ\w*|espositiv\w*|lava noleggio|lavanolo|tributari\w*|pagopa|rete stradale|adolescent\w*|rifiut\w*)\b/,
    esempio: "multiservizi, global service",
  },
];

// Famiglie di CPV di mestieri diversi da quelli del Radar, che però usano le stesse parole («pulizia» delle strade, «rifiuti» delle mense,
// «manutenzione del verde e pulizia delle aree esterne»): una gara con SOLO questi CPV non entra per parola chiave. Casi reali di TED del
// 16/11/2026. Non toccano le gare riconosciute per CPV del file approvato.
export const CPV_ESCLUSI_PER_PAROLE: readonly { prefisso: string; descrizione: string }[] = [
  { prefisso: "905", descrizione: "Servizi connessi ai rifiuti" },
  { prefisso: "906", descrizione: "Pulizia e spazzamento delle strade, sgombero della neve" },
  { prefisso: "773", descrizione: "Servizi di orticoltura e manutenzione del verde" },
  // dall'archivio di prova dello staging (16/11/2026): «servizi di ingegneria … lavori di adeguamento della mensa», «banche dati per la
  // vigilanza ispettiva», «trasporto ferroviario … ristorazione a bordo», «navigazione wifi nelle mense universitarie»
  { prefisso: "45", descrizione: "Lavori di costruzione" },
  { prefisso: "48", descrizione: "Pacchetti software e sistemi di informazione" },
  { prefisso: "60", descrizione: "Servizi di trasporto" },
  { prefisso: "64", descrizione: "Servizi di poste e telecomunicazioni" },
  { prefisso: "71", descrizione: "Servizi architettonici, di ingegneria e di ispezione" },
  { prefisso: "72", descrizione: "Servizi informatici" },
  { prefisso: "73", descrizione: "Servizi di ricerca e sviluppo" },
];

export function cpvSoloDiAltriMestieri(cpv: readonly string[]): boolean {
  return cpv.length > 0 && cpv.every((c) => CPV_ESCLUSI_PER_PAROLE.some((e) => c.startsWith(e.prefisso)));
}

// Parole dei servizi informatici («software per la prenotazione dei pasti»). NON «piattaforma telematica» o «digitale»: è la piattaforma di
// gara su cui si svolge la procedura (casi reali di TED: «vigilanza armata … tramite piattaforma telematica», «ausiliariato … sulla
// piattaforma telematica aziendale»). Le gare con un CPV del file passano dalla regola «servizi_informatici», che guarda il CPV principale.
const PAROLE_INFORMATICHE = /\b(software|applicativ\w*|sistem\w* informativ\w*|sistem\w* informatic\w*|servizi\w* informatic\w*|servizio informatico|piattaform\w* informatic\w*)\b/;
// Un oggetto che affida esplicitamente il servizio del settore («servizio di vigilanza armata … con software di controllo») resta.
const SERVIZIO_ESPLICITO =
  /\b(servizi?o?|appalto|affidamento|gestione) (di |del |della |dei )?(pulizi\w*|sanificazion\w*|disinfe\w*|ristorazion\w*|refezion\w*|mens[ae]|vigilanz\w*|portierat\w*|portineri\w*|guardiani\w*|facchinagg\w*|trasloc\w*|ausiliariat\w*|multiservizi|global service|facility management)\b/;

export function settoriDaParole(testo: string | null | undefined): SettoreRadar[] {
  const t = testoPerConfronto(testo);
  // un oggetto informatico entra per parola chiave solo se affida esplicitamente il servizio del settore
  if (!t || (PAROLE_INFORMATICHE.test(t) && !SERVIZIO_ESPLICITO.test(t))) return [];
  return REGOLE_PAROLE.filter((r) => r.cerca.test(t) && !(r.escludi && r.escludi.test(t) && !(r.salvo && r.salvo.test(t)))).map((r) => r.settore);
}

// ───── rilevanza: livelli A, B, C e sottocategorie (decisione definitiva dell'utente, 17/11/2026) ─────
//
// Per ogni settore che i CPV o le parole chiave indicano, la classificazione dice il livello, con la regola e il motivo:
//   A «pertinente»: nei risultati del settore e nei suggerimenti;
//   B «correlata»: appalto misto, concessione o gestione complessa che comprende servizi del settore; si trova nel settore, con la
//     natura mista segnalata;
//   C «non pertinente»: fuori dai risultati e dai suggerimenti del settore; se la gara è già nell'archivio ci resta (mai cancellata).
// La classificazione NON è la verifica dei requisiti di partecipazione.
// Una sola parola non basta, e nemmeno il solo CPV quando l'oggetto dice chiaramente altro: le regole combinano CPV, oggetto e contesto,
// e ogni regola nasce da casi reali (le 8 gare PVL dubbie e l'archivio dello staging del 17/11/2026, in «casi»).
export type Livello = "A" | "B" | "C";
export const NOMI_LIVELLI: Record<Livello, string> = { A: "pertinente", B: "correlata", C: "non pertinente" };

// «debole»: un segnale che vale solo fuori da un contesto («vigilanza» da sola, ma non nei musei, dove è la sorveglianza di sala)
type Sottocategoria = { id: string; nome: string; testo?: RegExp; debole?: { cerca: RegExp; nonSe: RegExp }; cpv?: readonly string[] };

// Sottocategorie interne di ogni settore. Una gara può averne più d'una nello stesso settore (decisione dell'utente del 17/11): tutte
// quelle che l'oggetto nomina, in ordine di comparsa; se l'oggetto non ne nomina, quelle del CPV del settore; altrimenti la prima.
// Ristorazione: le 7 decise dall'utente; le concessioni di bar e ristoranti restano concessioni, mai mense (il CPV generico 55300000 non
// aggiunge «mense» a una concessione di bar: le sottocategorie dei CPV valgono solo quando l'oggetto non ne nomina).
export const SOTTOCATEGORIE: Record<SettoreRadar, readonly Sottocategoria[]> = {
  pulizia: [
    { id: "pulizia_edifici", nome: "Pulizia di edifici, uffici e scuole", testo: /\bpulizi\w*/, cpv: ["90900000", "90910000", "90911000", "90911100", "90911200", "90911300", "90914000", "90917000", "90919000", "90919100", "90919200", "90919300"] },
    { id: "sanificazione", nome: "Sanificazione e disinfezione", testo: /\b(sanificazion\w*|disinfezion\w*|igiene ambientale)\b/ },
    { id: "disinfestazione", nome: "Disinfestazione e derattizzazione", testo: /\b(disinfestazion\w*|derattizzazion\w*|deblattizzazion\w*|fumigazion\w*)\b/, cpv: ["90920000", "90921000", "90922000", "90923000", "90924000"] },
  ],
  ristorazione: [
    // «degenti» vale solo vicino a ristorazione, pasti o vitto: il «bar … per le necessità dei degenti» resta una concessione, non una mensa
    // (caso reale di TED 786982-2026, 17/11/2026)
    {
      id: "mense",
      nome: "Mense e ristorazione collettiva",
      testo: /\b(mens[ae]|refezion\w*|ristorazione (scolastica|collettiva|aziendale|ospedaliera|universitaria|sanitaria)|centr\w* (di )?cottura|(ristorazion\w*|past[oi]|vitto)( \w+){0,4} degent\w*|vitto)\b/,
      cpv: ["55300000", "55500000", "55510000", "55511000", "55512000", "55523100", "55524000"],
    },
    { id: "catering", nome: "Catering e preparazione pasti", testo: /\b(catering|preparazion\w* (dei |di )?pasti|cottura (dei |di )?pasti|business lunch|coffee break|banqueting)\b/, cpv: ["55520000", "55523000", "55321000", "55322000"] },
    { id: "distribuzione_pasti", nome: "Distribuzione pasti", testo: /\b(distribuzion\w* (dei |di )?pasti|consegna (dei |di )?pasti|pasti a domicilio|fornitura (dei |di )?pasti|trasporto (dei |di )?pasti)\b/, cpv: ["55320000", "55521000", "55521100", "55521200"] },
    { id: "concessione_bar", nome: "Concessione bar e caffetteria", testo: /\b(bar|caffetteri\w*|enotec\w*|chiosc\w*)\b/ },
    { id: "concessione_ristorante", nome: "Concessione ristorante", testo: /\b(ristorant\w*|locanda|trattori\w*|pizzeri\w*|food beverage|somministrazione al pubblico)\b/ },
    { id: "concessione_punto_ristoro", nome: "Concessione punto ristoro", testo: /\b(ristoro|distributor\w* automatic\w*|distribuzione automatica|vending|panin\w*|prodotti da forno|merend\w*|snack)\b/ },
    { id: "appalti_multiservizi", nome: "Ristorazione dentro appalti multiservizi e gestioni integrate" },
  ],
  vigilanza_portierato: [
    {
      id: "vigilanza_privata",
      nome: "Vigilanza privata (istituti autorizzati)",
      // «vigilanza» da sola nei musei, nei teatri e nelle biblioteche è di solito la sorveglianza di sala, non la vigilanza privata
      // regolamentata: lì serve un segnale forte (armata, guardie giurate, pattugliamento…), altrimenti è accoglienza o presidio
      testo: /\b(guardi\w* giurat\w*|armat\w*|piantonament\w*|pattugliament\w*|pronto intervento|valori|security|istitut\w* di vigilanza|vigilanza privata|vigilanza ispettiva)\b/,
      debole: { cerca: /\bvigilanz\w*/, nonSe: /\b(muse\w*|teatr\w*|bibliotec\w*|mostr[ae]|spettator\w*|visitator\w*|non armat\w*|fiduciar\w*)\b/ },
      cpv: ["98341140", "79710000", "79713000", "79714000", "79715000"],
    },
    {
      // decisione dell'utente del 17/11: il servizio operativo (monitoraggio delle immagini, centrale operativa, telesorveglianza) è
      // pertinente; la sola fornitura, installazione o manutenzione degli impianti no (ESCLUSIONI_OGGETTO), l'affidamento misto è correlato
      id: "videosorveglianza_operativa",
      nome: "Videosorveglianza e telesorveglianza operativa (monitoraggio, centrale operativa)",
      testo:
        /\b(telesorveglianz\w*|teleallarm\w*|teleradioallarm\w*|televigilanz\w*|centrale operativa|control room|sala (di )?controllo|monitoraggio (h24 |continuo |costante )?(delle |degli |dei |di )?(immagini|telecamer\w*|allarm\w*|segnal\w*|impiant\w*|sistem\w*)|gestione (del |dei |della |delle )?(sistem\w*|impiant\w*|servizi\w*) (di )?video ?sorveglianz\w*|video ?sorveglianz\w* (attiva|da remoto|in remoto|operativa|h24))\b/,
      cpv: ["79711000"],
    },
    { id: "portierato_reception", nome: "Portierato, reception e accoglienza", testo: /\b(portierat\w*|portineri\w*|reception|front office|centralin\w*|accoglienz\w*|hostess|steward\w*|maschere|biglietteri\w*)\b/, cpv: ["98341120", "79992000"] },
    { id: "presidio_accessi", nome: "Presidio, custodia e controllo accessi", testo: /\b(presidi\w*|controllo (degli |degl )?accessi|guardiani\w*|custodi\w*|apertura e chiusura)\b/, cpv: ["98341130"] },
  ],
  facchinaggio: [
    { id: "traslochi", nome: "Traslochi", testo: /\btrasloc\w*/, cpv: ["98392000"] },
    { id: "facchinaggio_movimentazione", nome: "Facchinaggio, carico e scarico, movimentazione", testo: /\b(facchinagg\w*|movimentazion\w*|carico|scarico|manovalanza|smontaggi\w*|montaggi\w*|allestiment\w*|sgomber\w*)\b/, cpv: ["63100000", "63110000"] },
    { id: "logistica_magazzino", nome: "Logistica e magazzino", testo: /\b(logistic\w*|magazzin\w*|immagazzin\w*|stoccaggi\w*|deposit\w*)\b/, cpv: ["63120000", "63121000", "63121100", "63122000"] },
  ],
  multiservizi: [
    { id: "facility_management", nome: "Global service e facility management", testo: /\b(multiservizi|global service|facility management|servizi integrati|immobil\w*|edific\w*)\b/, cpv: ["79993000"] },
    { id: "gestione_impianti", nome: "Gestione di impianti tecnologici", testo: /\b(impiant\w*|conduzion\w*|calore|termic\w*)\b/, cpv: ["79993100"] },
  ],
  ausiliariato: [{ id: "ausiliariato", nome: "Ausiliariato" }],
};

export function nomeSottocategoria(settore: SettoreRadar, id: string | null): string | null {
  return SOTTOCATEGORIE[settore].find((s) => s.id === id)?.nome ?? null;
}

// Dove l'oggetto nomina la sottocategoria (prima posizione), -1 se non la nomina.
function posizioneSottocategoria(s: Sottocategoria, t: string): number {
  const posizioni = [s.testo ? t.search(s.testo) : -1, s.debole && !s.debole.nonSe.test(t) ? t.search(s.debole.cerca) : -1].filter((p) => p >= 0);
  return posizioni.length ? Math.min(...posizioni) : -1;
}

// Tutte le sottocategorie che l'oggetto nomina, in ordine di comparsa.
function sottocategorieDaTesto(settore: SettoreRadar, t: string): string[] {
  if (!t) return [];
  return SOTTOCATEGORIE[settore]
    .map((s) => ({ id: s.id, p: posizioneSottocategoria(s, t) }))
    .filter((x) => x.p >= 0)
    .sort((a, b) => a.p - b.p)
    .map((x) => x.id);
}

// Le sottocategorie dei CPV del settore trovati nell'avviso, nell'ordine dell'elenco.
function sottocategorieDaCpv(settore: SettoreRadar, cpv: readonly string[]): string[] {
  return SOTTOCATEGORIE[settore].filter((s) => s.cpv && cpv.some((c) => s.cpv?.includes(c))).map((s) => s.id);
}

// Il contesto dei CPV per le regole che combinano CPV e oggetto: CPV principale, tutti i CPV, i CPV del file per il settore valutato.
export type ContestoCpv = { principale: string | null; tutti: readonly string[]; delSettore: readonly string[] };

// ───── livello C: esclusioni motivate ─────

// Un settore si esclude quando l'oggetto (con il CPV, dove serve) dice chiaramente un altro mestiere. Salvaguardie: (1) mai se l'oggetto
// nomina il servizio con le parole approvate del settore (la «cerca» di REGOLE_PAROLE), salvo le regole «ancheConNucleo» che guardano il
// CPV principale; (2) la «salvo» della regola, per i casi vicini al settore.
// Non sono più esclusioni (decisione del 17/11): bar, ristoranti, caffetterie, punti ristoro, distributori automatici, panini; impianti
// sportivi, RSA, centri di accoglienza, asili nido e multiservizi diventano al più «correlati» (livello B).
export type RegolaEsclusione = {
  id: string;
  settori: readonly SettoreRadar[] | "tutti";
  cerca: RegExp;
  salvo: RegExp | null;
  motivo: string;
  casi: readonly string[];
  condizione?: (c: ContestoCpv) => boolean;
  ancheConNucleo?: boolean;
};

// Videosorveglianza: gli oggetti tecnici e il servizio operativo (decisione dell'utente del 17/11)
const VIDEO = /\b(video ?sorveglianz\w*|telecamer\w*|fototrappol\w*|tvcc|impiant\w* (di )?(allarme|antintrusione|videosorveglianza)|sistem\w* di (video\w*|allarme|antintrusione|controllo accessi)|software)\b/;
const OPERATIVO =
  /\b(monitoraggio|presidi\w*|vigilanz\w*|guardi\w* giurat\w*|piantonament\w*|pattugliament\w*|pronto intervento|ronda|ronde|valori|centrale operativa|control room|sala (di )?controllo|telesorveglianz\w*|teleallarm\w*|teleradioallarm\w*|televigilanz\w*|portierat\w*|portineri\w*|guardiani\w*|operatori)\b/;

const MOVIMENTAZIONE = /\b(facchinagg\w*|trasloc\w*|movimentazion\w*|carico|scarico|magazzin\w*|immagazzin\w*|stoccaggi\w*|logistic\w*|manovalanza|smontaggi\w*|montaggi\w*|allestiment\w*|sgomber\w*|smistament\w*|imballagg\w*)\b/;

export const ESCLUSIONI_OGGETTO: readonly RegolaEsclusione[] = [
  {
    id: "concessione_di_immobili",
    settori: ["ristorazione"],
    cerca:
      /\b(concession\w* demanial\w*|demanio marittimo|turistic\w* ricreativ\w*|suolo pubblico|assegnazione (di |dei |delle )?(posteggi|stalli|spazi|aree)|concession\w* (in gestione |in uso |d uso )?(del|dello|della|dell|di) (casone|stabile|immobil\w*|fabbricat\w*|local\w*|rifugi\w*|compendio|area|aree))\b/,
    // c'è un vero affidamento del servizio o della gestione del punto ristoro: la concessione entra (casi reali di TED, 17/11/2026)
    salvo:
      /\b(concessione del servizio|affidamento del servizio|servizi?o? (di |del |della )?(bar|caffetteri\w*|ristor\w*|somministrazion\w*|punt\w* (di )?ristoro|enotec\w*)|gestione (del|dello|della|dei) (bar|ristorant\w*|punt\w* (di )?ristoro|caffetteri\w*|chiosc\w*)|esercizi\w* di somministrazione|somministrazione di alimenti)\b/,
    motivo: "Concessione di un immobile, di un'area demaniale o di suolo pubblico senza l'affidamento del servizio di ristorazione",
    casi: [
      "Affidamento in concessione del casone “Paduli” per la durata di sette anni",
      "Assentimento di n. 6 concessioni demaniali marittime ad uso commerciale, ludico, turistico ricreativo",
      "Affidamento in concessione di suolo pubblico per la installazione di un chiosco per l'esercizio di attività di commercio",
    ],
  },
  {
    id: "trasporto_puro",
    settori: ["facchinaggio"],
    cerca: /\b(trasport\w*|vettor\w*|spedizion\w*|consegn\w*|corrier\w*|recapit\w*|navett\w*)\b/,
    salvo: MOVIMENTAZIONE,
    motivo: "Solo trasporto di merci o documenti, senza facchinaggio né movimentazione: non entra da solo nel facchinaggio",
    casi: ["Gara europea avente ad oggetto il servizio trasporti di beni economali e farmaceutici", "Affidamento del servizio di trasporto interbibliotecario"],
  },
  {
    id: "accoglienza_sociale",
    settori: ["vigilanza_portierato"],
    cerca: /\b(sai|richiedent\w*|protezione internazionale|stranier\w*|msna|migrant\w*|mediator\w* cultural\w*|terzo settore|accoglienza integrata|integrazione e tutela|tutela e integrazione)\b/,
    salvo: null,
    // combinazione: il settore viene SOLO dal CPV 79992000 «servizi di accoglienza» e l'oggetto non nomina portineria, reception o
    // presidio. Non vale per pulizia e ristorazione dei centri di accoglienza, che restano (al più «correlate»)
    condizione: (c) => c.delSettore.length > 0 && c.delSettore.every((x) => x === "79992000"),
    motivo: "Accoglienza e integrazione di richiedenti asilo o stranieri: il CPV «servizi di accoglienza» qui indica un servizio sociale, non la portineria",
    casi: ["Affidamento della gestione del servizio di accoglienza integrata (SAI) - categoria minori stranieri non accompagnati (MSNA)", "Servizio mediatori culturali"],
  },
  // Videosorveglianza, decisione dell'utente del 17/11: quattro tipi. La sola parola «videosorveglianza» non include né esclude.
  //   1. sola fornitura o installazione di telecamere, software o impianti → C (videosorveglianza_fornitura);
  //   2. manutenzione degli impianti → C (videosorveglianza_manutenzione);
  //   3. servizio operativo di monitoraggio, presidio o vigilanza → A (sottocategoria videosorveglianza_operativa o vigilanza privata);
  //   4. affidamento misto (fornitura o manutenzione con il servizio operativo) → B (CORRELAZIONI, videosorveglianza_mista), A se il
  //      servizio operativo è l'oggetto principale (viene prima).
  {
    id: "videosorveglianza_fornitura",
    settori: ["vigilanza_portierato"],
    cerca: new RegExp(`^(?=.*\\b(fornitur\\w*|installazion\\w*|posa in opera|realizzazion\\w*|acquist\\w*|noleggi\\w*|potenziament\\w*|ampliament\\w*|implementazion\\w*)\\b)(?=.*${VIDEO.source})`),
    salvo: OPERATIVO,
    motivo: "Sola fornitura o installazione di telecamere, software o impianti di videosorveglianza, senza servizio operativo: non è vigilanza",
    casi: ["Servizio di installazione, puntamento, disinstallazione telecamere mobili e analisi flussi video", "Fornitura e posa in opera di un sistema di videosorveglianza per il centro storico"],
  },
  {
    id: "videosorveglianza_manutenzione",
    settori: ["vigilanza_portierato"],
    cerca: new RegExp(`^(?=.*\\bmanutenzion\\w*)(?=.*${VIDEO.source})`),
    salvo: OPERATIVO,
    motivo: "Manutenzione degli impianti di videosorveglianza o di allarme, senza servizio operativo: non è vigilanza",
    casi: ["Servizio di manutenzione ordinaria e straordinaria degli impianti di videosorveglianza e antintrusione degli edifici comunali"],
  },
  {
    id: "rifiuti",
    settori: "tutti",
    cerca:
      /\b((raccolta|trasporto|smaltimento|recupero|conferimento|gestione)( e (raccolta|trasporto|smaltimento|recupero|conferimento|gestione))*( (dei|di|del|delle))? (rifiut\w*|ru|raee)|igiene urbana|raccolta differenziata|rifiuti (urbani|speciali|solidi))\b/,
    salvo: null,
    motivo: "Raccolta, trasporto o smaltimento di rifiuti: è un altro mestiere (igiene urbana)",
    casi: ["Gara europea a procedura aperta per il servizio di raccolta e gestione di rifiuti assimilabili", "Servizio di raccolta e trasporto dei RU classificato come «verde»"],
  },
  {
    id: "mobilita_e_sanzioni",
    settori: "tutti",
    // ZTL e logistica urbana, oppure le sanzioni INSIEME al codice della strada o alla polizia locale
    cerca: /\b(ztl|zona a traffico limitato|zone a traffico limitato|last mile|logistica urbana)\b|^(?=.*\bsanzion\w*)(?=.*\b(infrazion\w*|codice della strada|c d s|verbal\w*|polizia locale)\b)/,
    salvo: null,
    motivo: "Mobilità urbana, ZTL o gestione delle sanzioni: è un altro mestiere",
    casi: [
      "Concessione del servizio integrato di gestione tecnologica delle ZTL, logistica urbana last-mile a zero emissioni ed ausilio alla gestione del procedimento sanzionatorio",
      "Servizio di gestione dell'intero ciclo sanzionatorio e delle procedure per le infrazioni di cui all'art. 142 del C.d.S.",
    ],
  },
  {
    id: "impianti_di_altri_mestieri",
    settori: ["multiservizi"],
    cerca: /\b(mattatoi\w*|macell\w*|rete idrica|fognar\w*|depurazion\w*|depurator\w*|servizio idrico|generazione elettrica|centrale elettrica|illuminazione pubblica|figure luminose)\b/,
    salvo: null,
    motivo: "Gestione di un impianto produttivo o di una rete (mattatoio, acquedotto, energia): non è gestione di edifici",
    casi: ["Affidamento in concessione del servizio di gestione del mattatoio comunale di Corinaldo", "Servizio di supporto alla gestione della rete idrica e fognaria"],
  },
  {
    id: "forniture_di_beni",
    settori: "tutti",
    cerca: /\bfornitur\w*\b/,
    // basta che l'oggetto parli di servizi: «fornitura di servizi di catering», «fornitura di beni ed erogazione servizi di accoglienza»;
    // o di un servizio operativo di sorveglianza («fornitura … con monitoraggio delle immagini dalla centrale operativa»: affidamento misto)
    // (non «presidio» né «valori»: «Presidi ERDIS» sono le sedi di una fornitura di derrate, caso reale di TED del 17/11/2026)
    salvo: /\b(serviz\w*|catering|concession\w*|monitoraggio|centrale operativa|control room|sala (di )?controllo|telesorveglianz\w*|televigilanz\w*|pronto intervento|piantonament\w*|pattugliament\w*)\b/,
    motivo: "Fornitura di beni senza un servizio del settore",
    casi: [
      "Fornitura di derrate alimentari sostenibili per la ristorazione delle mense universitarie a gestione diretta",
      "Accordo quadro avente ad oggetto la fornitura di quotidiani e periodici cartacei e relativa distribuzione",
      "Fornitura pizza scuole Betti",
    ],
  },
  {
    id: "noleggio_a_freddo",
    settori: "tutti",
    cerca: /\bnoleggio a freddo\b/,
    salvo: null,
    motivo: "Noleggio di macchine senza operatore: non è un servizio del settore",
    casi: ["Servizio di noleggio a freddo di macchine operatrici"],
  },
  {
    id: "somministrazione_di_lavoro",
    settori: "tutti",
    cerca: /\b(somministrazione (di )?lavoro|lavoro (interinale|temporaneo)|agenzi\w* (di |per il )?lavoro|somministrazione di personale|fornitura di personale)\b/,
    salvo: null,
    // vale anche se l'oggetto nomina il servizio: «addetti alle pulizie» qui è la figura richiesta all'agenzia (casi reali di TED, 17/11/2026)
    ancheConNucleo: true,
    motivo: "Somministrazione di lavoro (agenzia per il lavoro): fornisce personale, non affida il servizio del settore",
    casi: ["Servizio di somministrazione lavoro a tempo determinato per la selezione di figure come addetti alle pulizie"],
  },
  {
    id: "manutenzione_veicoli",
    settori: "tutti",
    cerca: /\bmanutenzion\w* (e riparazion\w* )?(del |dei |di )?(parco )?(mezzi|veicol\w*|automezz\w*|autoveicol\w*)\b/,
    salvo: null,
    motivo: "Manutenzione di veicoli: è un altro mestiere (CPV del settore indicato per errore nell'avviso)",
    casi: ["Servizio di manutenzione e riparazione parco mezzi in dotazione ai Comuni di Trieste e Muggia"],
  },
  {
    id: "custodia_veicoli",
    settori: ["vigilanza_portierato"],
    cerca: /\b(veicoli rimossi|rimozione (dei |di )?veicoli|depositeri\w*)\b/,
    salvo: null,
    motivo: "Custodia di veicoli rimossi (depositeria): non è vigilanza",
    casi: ["Servizio di custodia dei veicoli rimossi nel territorio del Comune di Milano"],
  },
  {
    id: "sicurezza_sul_lavoro",
    settori: ["vigilanza_portierato"],
    cerca: /\b(agenti fisici|sostanze pericolose|agenti biologici|sicurezza sul lavoro|sicurezza nei luoghi di lavoro|rspp|valutazione dei rischi)\b/,
    salvo: null,
    motivo: "Sicurezza sul lavoro (misure, valutazione dei rischi): non è vigilanza",
    casi: ["Servizio di misurazioni strumentali degli agenti fisici, delle sostanze pericolose e degli agenti biologici"],
  },
  {
    id: "lavori_e_progettazione",
    settori: "tutti",
    cerca:
      /\b(progettazion\w*|lavori|intervent\w*|riqualificazion\w*|ristrutturazion\w*|efficientament\w*|costruzion\w*|ammodernament\w*|manutenzione straordinaria|adeguament\w*)\b/,
    // un sistema di qualificazione o un partenariato che comprende la gestione dei servizi non è solo lavori (resta, al più correlata)
    salvo: /\b(sistema di qualificazione|gestione (dei |del |di )?serviz\w*|servizi manutentivi|global service|facility management)\b/,
    // combinazione: CPV principale di lavori (45), ingegneria (71) o informatica (72) E oggetto di lavori o progettazione; il settore
    // viene solo da un CPV secondario (casi reali di TED, 17/11/2026: «Casa del Carabiniere - progettazione e verifica», «efficientamento
    // ERP», «ammodernamento del sistema d'asta del mercato ittico»)
    condizione: (c) => !!c.principale && /^(45|71|72)/.test(c.principale),
    motivo: "Lavori o progettazione (CPV principale e oggetto): il servizio del settore compare solo tra i CPV secondari",
    casi: ["ALD0009 - Casale Monferrato - Casa del Carabiniere - Progettazione e verifica", "Efficientamento ERP CH_PNRR"],
  },
  {
    id: "servizi_informatici",
    settori: "tutti",
    cerca: PAROLE_INFORMATICHE,
    salvo: null,
    // combinazione: CPV principale informatico (48 software, 72 servizi informatici) E oggetto informatico, anche se nomina il servizio
    condizione: (c) => !!c.principale && /^(48|72)/.test(c.principale),
    ancheConNucleo: true,
    motivo: "Servizio informatico (CPV principale e oggetto): non è un servizio del settore, anche se lo nomina",
    casi: ["Piattaforma informatica per la prenotazione dei pasti della refezione scolastica"],
  },
];

// ───── livello B: gare correlate ─────

// «richiede»: un secondo segnale che deve esserci in qualunque punto dell'oggetto (la posizione è quella di «cerca»)
export type RegolaCorrelazione = { id: string; settori: readonly SettoreRadar[] | "tutti"; cerca: RegExp; richiede?: RegExp; salvo: RegExp | null; motivo: string; casi: readonly string[] };

// Il servizio del settore è l'oggetto della gestione («gestione della mensa dell'asilo nido», «gestione del servizio di pulizia»): non è
// una gestione complessa.
const GESTIONE_DEL_SERVIZIO = /\bgestion\w* (del servizio di |dei servizi di |della |del |dei )?(mens[ae]|refezion\w*|ristorazion\w*|cucina|pulizi\w*|portierat\w*|portineri\w*|vigilanz\w*|facchinagg\w*|trasloc\w*|ausiliariat\w*|bar|ristorant\w*|caffetteri\w*|punt\w* (di )?ristoro)\b/;

export const CORRELAZIONI: readonly RegolaCorrelazione[] = [
  {
    id: "gestione_integrata",
    settori: ["pulizia", "ristorazione", "vigilanza_portierato", "facchinaggio", "ausiliariato"],
    // non «servizi integrati» da solo: «servizi integrati di pulizia e sanificazione», «servizi integrati di vigilanza armata» sono appalti
    // del settore (casi reali di TED, 17/11/2026)
    cerca: /\b(global service|facility management|multiservizi(?! (spa|s p a|srl|s r l|scarl|s c a r l)\b)|gestione (globale|integrata|integrale|complessiva|omnicomprensiva|operativa integrata))\b/,
    // l'integrazione è tra servizi dello stesso settore: «gestione integrata dei servizi di sicurezza e portierato»
    salvo:
      /\b(global service|facility management|gestione (globale|integrata|integrale|complessiva|omnicomprensiva|operativa integrata)) (di |dei |del |della |delle )?(servizi\w* (di |del |della )?)?(pulizi\w*|sanificazion\w*|igiene ambientale|ristorazion\w*|refezion\w*|vigilanz\w*|sicurezza|portierat\w*|portineri\w*|facchinagg\w*|trasloc\w*|ausiliariat\w*)\b/,
    motivo: "Il servizio è una parte di un appalto multiservizi o di una gestione integrata",
    casi: ["Servizio di gestione globale in concessione della casa di riposo Villa Loreto", "Servizi di facility management all'interno del complesso immobiliare"],
  },
  {
    id: "gestione_di_struttura",
    settori: "tutti",
    cerca:
      /\b(gestion\w*|concession\w*|conduzion\w*)( \w+){0,4} (centr[oi]|struttur\w*|rsa|r s a|cas[ae] (di riposo|protett\w*|di soggiorno|famiglia|albergo)|residen\w*|asil\w*|nid\w*|comunita|hotspot|impiant\w* sportiv\w*|impianto e|piscin\w*|palestr\w*|palazzett\w*|stabil[ei]|compendi\w*|convitt\w*|ostell\w*|rifugi\w*|campeggi\w*|muse\w*|teatr\w*)\b/,
    salvo: new RegExp(`${GESTIONE_DEL_SERVIZIO.source}|\\bcentr\\w* (di )?cottura\\b`),
    motivo: "Gestione o concessione di una struttura (centro, residenza, asilo nido, impianto sportivo, museo, immobile): il servizio ne è una parte",
    casi: ["Gara europea per l'affidamento servizi gestione centri accoglienza straordinari", "Concessione in gestione dell'impianto sportivo comunale", "Concessione in gestione dello stabile comunale costituito da bar, ristorante, pizzeria e servizio mensa per la scuola dell'infanzia"],
  },
  {
    id: "servizi_alla_persona",
    settori: "tutti",
    cerca:
      /\b(socio ?assistenzial\w*|socioassistenzial\w*|socio ?sanitari\w*|sociosanitari\w*|socio ?educativ\w*|servizi\w* educativ\w*|servizi\w* assistenzial\w*|assistenzial\w* (ed|e) alberghier\w*|servizi\w* alberghier\w*|infermieristic\w*|assistenza (alla persona|domiciliare|educativa|scolastica|ai disabili|agli anziani)|istruzione prescolastica|accoglienza (integrata|in centri|di cittadini|di richiedenti|dei richiedenti|straordinari\w*)|protezione internazionale|richiedent\w* asilo|minori stranieri)\b/,
    salvo: null,
    motivo: "Servizi alla persona (assistenza, educazione, accoglienza di persone): il servizio del settore ne è una parte",
    casi: ["Gestione dei servizi assistenziali ed alberghieri presso la casa di riposo", "Servizio di istruzione prescolastica a supporto delle attività educative presso gli asili nido comunali", "Affidamento del servizio di accoglienza in centri collettivi fino a 50 posti"],
  },
  {
    id: "finanza_di_progetto",
    settori: "tutti",
    cerca: /\b(project financing|finanza di progetto|partenariato pubblico privato)\b/,
    salvo: null,
    motivo: "Concessione in finanza di progetto (lavori e gestione): il servizio ne è una parte",
    casi: ["Affidamento mediante project financing degli interventi di riqualificazione dell'Isola Comacina finalizzato alla concessione del servizio bar/ristoro e gestione della locanda"],
  },
  {
    id: "solo_distributori",
    settori: ["ristorazione"],
    cerca: /\b(distributor\w* automatic\w*|distribuzione automatica|vending)\b/,
    salvo: /\b(bar|caffetteri\w*|ristorant\w*|ristorazion\w*|punt\w* (di )?ristoro|ristoro interno|mens[ae]|refezion\w*|past[oi]|catering|panin\w*)\b/,
    motivo: "Solo distributori automatici: servizio vicino alla ristorazione, non è una mensa né un bar",
    casi: ["Servizio di somministrazione di bevande e alimenti tramite distributori automatici"],
  },
  {
    id: "logistica_senza_facchinaggio",
    settori: ["facchinaggio"],
    cerca: /\blogistic\w*/,
    salvo: /\b(facchinagg\w*|trasloc\w*|movimentazion\w*|carico|scarico|magazzin\w*|immagazzin\w*|stoccaggi\w*|manovalanza|smontaggi\w*|montaggi\w*|allestiment\w*|sgomber\w*|smistament\w*)\b/,
    motivo: "Logistica senza facchinaggio né movimentazione dichiarati: correlata",
    casi: ["Servizio di supporto logistica integrata", "Procedura aperta per l'acquisizione del servizio di logistica integrata del farmaco"],
  },
  {
    id: "concessione_demaniale",
    settori: ["ristorazione"],
    cerca: /\b(concession\w* demanial\w*|demanio marittimo)\b/,
    salvo: null,
    motivo: "Concessione demaniale con attività di ristorazione o somministrazione: è una concessione d'uso dell'area, correlata",
    casi: ["Assegnazione di 4 concessioni demaniali a finalità turistico-ricreativa, di cui 3 esercizi di somministrazione"],
  },
  {
    // tipo 4 della videosorveglianza: fornitura, installazione o manutenzione con il servizio operativo; correlata se la parte tecnica
    // viene prima del servizio (oggetto principale tecnico), pertinente se viene prima il servizio di vigilanza o di monitoraggio
    id: "videosorveglianza_mista",
    settori: ["vigilanza_portierato"],
    cerca: /\b(fornitur\w*|installazion\w*|posa in opera|realizzazion\w*|manutenzion\w*|noleggi\w*|potenziament\w*|ampliament\w*)\b/,
    richiede: VIDEO,
    salvo: null,
    motivo: "Affidamento misto: fornitura, installazione o manutenzione di impianti di videosorveglianza insieme al servizio operativo",
    casi: ["Fornitura, installazione e gestione di un sistema di videosorveglianza con monitoraggio delle immagini dalla centrale operativa"],
  },
  {
    id: "antincendio",
    settori: ["vigilanza_portierato"],
    cerca: /\b(antincendio|prevenzione incendi|gestione delle emergenze)\b/,
    // con vigilanza armata, guardie giurate o portineria è il settore (A)
    salvo: /\b(vigilanza armata|guardi\w* giurat\w*|istitut\w* di vigilanza|armat\w*|pattugli\w*|pronto intervento|portierat\w*|portineri\w*|reception|guardiani\w*)\b/,
    motivo: "Sorveglianza antincendio e gestione delle emergenze: vicina alla vigilanza, ma non è vigilanza privata",
    casi: ["Sorveglianza attiva antincendio per le AASS della Regione Campania", "Servizio di sorveglianza antincendio e gestione delle emergenze del mercato centrale"],
  },
];

// Le correlazioni che, in ristorazione, portano alla sottocategoria «dentro appalti multiservizi e gestioni integrate»
const CORRELAZIONI_DI_GESTIONE = new Set(["gestione_integrata", "gestione_di_struttura", "servizi_alla_persona"]);
// Le correlazioni che valgono solo se vengono prima del servizio del settore nell'oggetto (vedi valutaSettore)
const CORRELAZIONI_DI_POSIZIONE = new Set(["gestione_integrata", "gestione_di_struttura", "servizi_alla_persona", "finanza_di_progetto", "videosorveglianza_mista"]);

// Dove l'oggetto nomina per la prima volta il servizio del settore (parole approvate o sottocategorie); -1 se non lo nomina.
function posizioneDelServizio(settore: SettoreRadar, t: string): number {
  const nucleo = nucleoDel(settore);
  const posizioni = [nucleo ? t.search(nucleo) : -1, ...SOTTOCATEGORIE[settore].map((s) => posizioneSottocategoria(s, t))].filter((p) => p >= 0);
  return posizioni.length ? Math.min(...posizioni) : -1;
}

export type Esclusione = { settore: SettoreRadar; regola: string; motivo: string };

// INTERFACCIA per la 0121 (comunicata a B2 il 17/11): una valutazione per settore considerato. Gli elenchi sono in ordine di evidenza (il
// primo è il principale); i campi singoli restano per compatibilità e valgono il primo elemento. I motivi si ricavano da regole e versione:
// non serve salvarli.
export type Valutazione = {
  settore: SettoreRadar;
  livello: Livello;
  // id di SOTTOCATEGORIE[settore]; [] se il livello è C
  sottocategorie: string[];
  // id delle regole che decidono il livello: «cpv_principale», «oggetto», «cpv_del_settore», «parole_chiave», «cpv_secondario», un id di
  // CORRELAZIONI (B) o di ESCLUSIONI_OGGETTO (C)
  regole: string[];
  // un motivo leggibile per ogni regola, stesso ordine
  motivi: string[];
  da: "cpv" | "parole_chiave";
  // i CPV del file approvato trovati per questo settore ([] se da parole chiave)
  cpv: string[];
  sottocategoria: string | null;
  regola: string;
  motivo: string;
};

function vale(r: { settori: readonly SettoreRadar[] | "tutti" }, settore: SettoreRadar): boolean {
  return r.settori === "tutti" || r.settori.includes(settore);
}

function nucleoDel(settore: SettoreRadar): RegExp | undefined {
  return REGOLE_PAROLE.find((r) => r.settore === settore)?.cerca;
}

const CONTESTO_VUOTO: ContestoCpv = { principale: null, tutti: [], delSettore: [] };

// Tutte le regole di esclusione che valgono per il settore (la prima è la principale). Testo già normalizzato con testoPerConfronto.
function regoleDiEsclusione(settore: SettoreRadar, t: string, contesto: ContestoCpv): RegolaEsclusione[] {
  if (!t) return [];
  const haNucleo = !!nucleoDel(settore)?.test(t);
  return ESCLUSIONI_OGGETTO.filter(
    (r) => vale(r, settore) && (r.ancheConNucleo || !haNucleo) && r.cerca.test(t) && !(r.salvo && r.salvo.test(t)) && (!r.condizione || r.condizione(contesto)),
  );
}

// I settori che l'oggetto esclude (livello C), con la regola principale e il motivo. Senza contesto valgono solo le regole che non guardano
// il CPV.
export function esclusioniOggetto(testoNormalizzato: string, settori: readonly SettoreRadar[], contesto: ContestoCpv = CONTESTO_VUOTO): Esclusione[] {
  return settori.flatMap((settore) => {
    const r = regoleDiEsclusione(settore, testoNormalizzato, contesto)[0];
    return r ? [{ settore, regola: r.id, motivo: r.motivo }] : [];
  });
}

const MOTIVO_CPV_SECONDARIO = "Il servizio è tra i CPV dell'avviso ma non è l'oggetto principale (appalto misto)";

function valutazione(settore: SettoreRadar, livello: Livello, sottocategorie: string[], regole: { id: string; motivo: string }[], da: "cpv" | "parole_chiave", cpv: readonly string[]): Valutazione {
  const sc = [...new Set(sottocategorie)];
  return {
    settore,
    livello,
    sottocategorie: sc,
    regole: regole.map((r) => r.id),
    motivi: regole.map((r) => r.motivo),
    da,
    cpv: [...cpv],
    sottocategoria: sc[0] ?? null,
    regola: regole[0]?.id ?? "",
    motivo: regole[0]?.motivo ?? "",
  };
}

// Livello, sottocategorie, regole e motivi di un settore.
function valutaSettore(settore: SettoreRadar, t: string, contesto: ContestoCpv, da: "cpv" | "parole_chiave"): Valutazione {
  const cpvDelSettore = da === "cpv" ? contesto.delSettore : [];
  const escluse = regoleDiEsclusione(settore, t, contesto);
  if (escluse.length) return valutazione(settore, "C", [], escluse.map((r) => ({ id: r.id, motivo: r.motivo })), da, cpvDelSettore);
  const daTesto = sottocategorieDaTesto(settore, t);
  const daCpv = sottocategorieDaCpv(settore, contesto.delSettore);
  const predefinita = SOTTOCATEGORIE[settore][0].id;
  // le correlazioni «di gestione» valgono solo se la gestione complessa viene PRIMA del servizio del settore nell'oggetto: «appalto del
  // servizio di ristorazione scolastica … nei servizi educativi» è ristorazione (A); «gestione dei servizi socio-assistenziali e di
  // ristorazione» è correlata (B). Casi reali di TED, 17/11/2026
  const primoServizio = posizioneDelServizio(settore, t);
  const correlate = t
    ? CORRELAZIONI.filter(
        (r) =>
          vale(r, settore) &&
          r.cerca.test(t) &&
          (!r.richiede || r.richiede.test(t)) &&
          !(r.salvo && r.salvo.test(t)) &&
          (!CORRELAZIONI_DI_POSIZIONE.has(r.id) || primoServizio < 0 || t.search(r.cerca) < primoServizio),
      )
    : [];
  if (correlate.length) {
    const diGestione = settore === "ristorazione" && correlate.some((r) => CORRELAZIONI_DI_GESTIONE.has(r.id)) ? ["appalti_multiservizi"] : [];
    const sottocategorie = daTesto.length || diGestione.length ? [...daTesto, ...diGestione] : daCpv.length ? daCpv : [predefinita];
    return valutazione(settore, "B", sottocategorie, correlate.map((r) => ({ id: r.id, motivo: r.motivo })), da, cpvDelSettore);
  }
  const haNucleo = !!t && !!nucleoDel(settore)?.test(t);
  const principale = contesto.principale ? MAPPA_CPV.get(contesto.principale) : undefined;
  const sottocategorie = daTesto.length ? daTesto : daCpv.length ? daCpv : [predefinita];
  if (da === "parole_chiave") return valutazione(settore, "A", sottocategorie, [{ id: "parole_chiave", motivo: "Trovata per parola chiave nell'oggetto" }], da, []);
  if (contesto.principale && principale?.settore !== settore && !haNucleo && !daTesto.length) {
    return valutazione(settore, "B", sottocategorie, [{ id: "cpv_secondario", motivo: MOTIVO_CPV_SECONDARIO }], da, cpvDelSettore);
  }
  const regole: { id: string; motivo: string }[] = [];
  if (principale?.settore === settore) regole.push({ id: "cpv_principale", motivo: `CPV principale ${principale.cpv} ${principale.descrizione}` });
  if (haNucleo || daTesto.length) regole.push({ id: "oggetto", motivo: "L'oggetto nomina il servizio del settore" });
  if (!regole.length) {
    const v = MAPPA_CPV.get(cpvDelSettore[0] ?? "");
    regole.push({ id: "cpv_del_settore", motivo: v ? `CPV ${v.cpv} ${v.descrizione} (nessun CPV principale indicato)` : "CPV del settore" });
  }
  return valutazione(settore, "A", sottocategorie, regole, da, cpvDelSettore);
}

// Versione delle regole: si cambia a ogni modifica di REGOLE_PAROLE, ESCLUSIONI_OGGETTO, CORRELAZIONI o SOTTOCATEGORIE. Accompagna ogni
// correzione dei settori di una gara già in archivio (registro dei cambiamenti, «correzione_dati» sul campo «settori»), così ogni
// correzione dice con quali regole è stata fatta e si può annullare. «2026-11-17b»: regole definitive dell'utente del 17/11.
// «2026-11-17c»: più sottocategorie per settore, quattro tipi di videosorveglianza, parole chiave della vigilanza senza «videosorveglianza».
export const VERSIONE_REGOLE_SETTORI = "2026-11-17c";
const PREFISSO_CORREZIONE = "regole-settori-";

// Identificativo della correzione nel registro: versione e regole («regole-settori-2026-11-17b:rifiuti»). Rifare la stessa correzione
// con le stesse regole non la duplica (chiave unica del registro).
export function idFonteCorrezioneSettori(esclusioni: readonly Esclusione[]): string {
  const regole = [...new Set(esclusioni.map((e) => e.regola))].sort();
  return `${PREFISSO_CORREZIONE}${VERSIONE_REGOLE_SETTORI}:${regole.length ? regole.join("+") : "parole_chiave"}`.slice(0, 200);
}

// Il registro tiene {"settori": [...], "metodo": ...} (o, in forma breve, solo l'elenco dei settori).
function settoriDaValore(v: string | null): SettoreRadar[] {
  try {
    const o: unknown = JSON.parse(v ?? "[]");
    const a: unknown = Array.isArray(o) ? o : o && typeof o === "object" ? (o as { settori?: unknown }).settori : null;
    return Array.isArray(a) ? a.filter((s): s is SettoreRadar => SETTORI_RADAR.some((x) => x.id === s)) : [];
  } catch {
    return [];
  }
}

// La frase per il cliente nella scheda della gara: quali settori sono stati tolti e perché. La gara resta nell'archivio.
export function descriviCorrezioneSettori(quando: string | null, valorePrecedente: string | null, valoreNuovo: string | null, idFonte: string | null): string {
  const prima = settoriDaValore(valorePrecedente);
  const dopo = settoriDaValore(valoreNuovo);
  const tolti = prima.filter((s) => !dopo.includes(s)).map((s) => nomeSettore(s).toLowerCase());
  const regole = (idFonte ?? "").startsWith(PREFISSO_CORREZIONE) ? (idFonte ?? "").split(":")[1]?.split("+") ?? [] : [];
  const motivi = [...new Set(regole.map((r) => ESCLUSIONI_OGGETTO.find((e) => e.id === r)?.motivo).filter((m): m is string => !!m))];
  const cosa = tolti.length ? `abbiamo tolto la gara da: ${tolti.join(", ")}` : "abbiamo corretto i settori della gara";
  const resta = dopo.length ? `Resta in: ${dopo.map((s) => nomeSettore(s).toLowerCase()).join(", ")}.` : "Resta consultabile nell'archivio.";
  return `${quando ? `Il ${quando} ` : ""}${quando ? cosa : cosa.charAt(0).toUpperCase() + cosa.slice(1)}${motivi.length ? ` (${motivi.join("; ")})` : ""}. ${resta}`;
}

// ───── classificazione di una gara ─────

export type Classificazione = {
  // la versione delle regole con cui è stata fatta (VERSIONE_REGOLE_SETTORI)
  versione: string;
  // dove la gara compare: i settori di livello A e B (la colonna «settori» dell'archivio, come prima)
  settori: SettoreRadar[];
  // settore principale: quello del CPV principale se non escluso, altrimenti il primo pertinente
  settorePrincipale: SettoreRadar | null;
  metodo: "cpv" | "parole_chiave" | null;
  // un motivo per settore tenuto, in parole semplici («CPV 90919200 Servizi di pulizia di uffici»)
  motivi: string[];
  cpvRiconosciuti: string[];
  // per ogni settore considerato: livello A/B/C, sottocategoria, regola e motivo
  valutazioni: Valutazione[];
  // il livello migliore della gara (A, poi B); C se tutti i settori sono esclusi; null se nessun settore
  livello: Livello | null;
  // i settori esclusi (livello C), con la regola e il motivo (esclusione, non cancellazione)
  esclusioni: Esclusione[];
};

function livelloMigliore(v: readonly Valutazione[]): Livello | null {
  return v.some((x) => x.livello === "A") ? "A" : v.some((x) => x.livello === "B") ? "B" : v.length ? "C" : null;
}

export function classificaGara(dati: { cpvPrincipale?: string | null; cpvTutti?: readonly (string | null | undefined)[]; testo?: string | null }): Classificazione {
  const principale = normalizzaCpv(dati.cpvPrincipale);
  const tutti = [...new Set([principale, ...(dati.cpvTutti ?? []).map(normalizzaCpv)].filter((c): c is string => !!c))];
  const voci = tutti.map((c) => MAPPA_CPV.get(c)).filter((v): v is VoceCpv => !!v);
  const t = testoPerConfronto(dati.testo);
  const settoriParole = settoriDaParole(dati.testo);
  const contesto = (s: SettoreRadar): ContestoCpv => ({ principale, tutti, delSettore: voci.filter((v) => v.settore === s).map((v) => v.cpv) });

  const valutazioniCpv = [...new Set(voci.map((v) => v.settore))].map((s) => valutaSettore(s, t, contesto(s), "cpv"));
  const esclusioni: Esclusione[] = valutazioniCpv.filter((v) => v.livello === "C").map((v) => ({ settore: v.settore, regola: v.regola, motivo: v.motivo }));
  const tenute = valutazioniCpv.filter((v) => v.livello !== "C");

  if (tenute.length > 0) {
    // l'ausiliariato non ha CPV: se le parole lo indicano si aggiunge, con il suo motivo
    const valutazioni = [...valutazioniCpv];
    if (settoriParole.includes("ausiliariato") && !tenute.some((v) => v.settore === "ausiliariato")) valutazioni.push(valutaSettore("ausiliariato", t, contesto("ausiliariato"), "parole_chiave"));
    const settori = valutazioni.filter((v) => v.livello !== "C").map((v) => v.settore);
    const vociTenute = voci.filter((v) => settori.includes(v.settore));
    const motivi = vociTenute.map((v) => `CPV ${v.cpv} ${v.descrizione}`);
    if (settori.includes("ausiliariato") && !valutazioniCpv.some((v) => v.settore === "ausiliariato")) motivi.push("Oggetto che parla di ausiliariato");
    const sp = principale ? MAPPA_CPV.get(principale)?.settore : undefined;
    return {
      versione: VERSIONE_REGOLE_SETTORI,
      settori,
      settorePrincipale: sp && settori.includes(sp) ? sp : (valutazioni.find((v) => v.livello === "A")?.settore ?? settori[0]),
      metodo: "cpv",
      motivi,
      cpvRiconosciuti: vociTenute.map((v) => v.cpv),
      valutazioni,
      livello: livelloMigliore(valutazioni),
      esclusioni,
    };
  }

  // nessun CPV del file, oppure tutti i loro settori esclusi dall'oggetto: decidono le parole chiave, come per ogni altra gara
  const valutazioniParole = settoriParole.length > 0 && !cpvSoloDiAltriMestieri(tutti) ? settoriParole.map((s) => valutaSettore(s, t, contesto(s), "parole_chiave")) : [];
  const valutazioni = [...valutazioniCpv, ...valutazioniParole];
  // anche quando le parole chiave sono escluse (somministrazione di lavoro) il motivo resta scritto
  const tutteLeEsclusioni = [...esclusioni, ...valutazioniParole.filter((v) => v.livello === "C").map((v) => ({ settore: v.settore, regola: v.regola, motivo: v.motivo }))];
  const settori = valutazioniParole.filter((v) => v.livello !== "C").map((v) => v.settore);
  if (settori.length > 0) {
    return {
      versione: VERSIONE_REGOLE_SETTORI,
      settori,
      settorePrincipale: valutazioniParole.find((v) => v.livello === "A")?.settore ?? settori[0],
      metodo: "parole_chiave",
      motivi: settori.map((s) => `Trovata per parola chiave: ${nomeSettore(s).toLowerCase()}`),
      cpvRiconosciuti: [],
      valutazioni,
      livello: livelloMigliore(valutazioni.filter((v) => v.livello !== "C")),
      esclusioni: tutteLeEsclusioni,
    };
  }

  return { versione: VERSIONE_REGOLE_SETTORI, settori: [], settorePrincipale: null, metodo: null, motivi: [], cpvRiconosciuti: [], valutazioni, livello: livelloMigliore(valutazioni), esclusioni: tutteLeEsclusioni };
}
