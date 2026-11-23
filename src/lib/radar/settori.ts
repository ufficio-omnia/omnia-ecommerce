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
    // fase B2b: anche i centri di raccolta dei rifiuti («facchinaggio RAEE e pulizia CCR», TED 3cc0553b: igiene urbana, non pulizia)
    // 18/11: spiagge, arenili, alvei, specchi acquei, aree costiere e fondali non sono più qui ma nella regola C «acque_e_coste»
    // (ESCLUSIONI_OGGETTO), che vale negli stessi casi (senza un CPV della pulizia) e dà un motivo leggibile
    escludi: /\b(strad\w*|fognat\w*|fogn\w*|caditoi\w*|spurg\w*|rifiut\w*|neve|prodott\w*|material\w*|cassonett\w*|raee|ccr|centr\w* (comunal\w* )?di raccolta|isol\w* ecologic\w*)\b/,
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
    // (i buoni pasto e il servizio sostitutivo di mensa non passano di qui: li riconosce BUONI_PASTO in classificaGara e li decidono le
    // regole «servizio_sostitutivo_mensa» (B) e «buoni_pasto_senza_servizio» (C), decisioni dell'utente del 18/11)
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
    // fase B2b: «servizi integrati di pulizia», «global service di igiene ambientale», «servizi integrati di sorveglianza armata» sono
    // integrazioni DENTRO un altro settore, non multiservizi (casi reali di TED nell'archivio dello staging, 17/11/2026)
    cerca:
      /\b(multiservizi(?! (spa|s p a|srl|s r l|scarl|s c a r l)\b)|(global service|facility management|servizi integrati)(?!( (gestional\w*|operativ\w*|tecnic\w*|complementar\w*|e|ed)){0,4} (di |dei |del |della |delle |per (il |la |i |le )?)?(servizi\w* (di |del |della |dei )?)?(pulizi|sanific|disinfe|igiene|vigilanz|sorveglianz|portierat|portineri|guardiani|reception|ristorazion|refezion|mens[ae]\b|facchinagg|trasloc|ausiliar)))\b/,
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

// ───── affidamento esplicito del servizio (fase B2b, decisione dell'utente del 17/11) ─────
//
// «Non considerare automaticamente pertinente una gara soltanto perché contiene una parola chiave». Una parola del settore conta come
// servizio AFFIDATO solo se:
//   - la regge una parola di affidamento («servizio di», «affidamento del», «appalto relativo alle attività di», «gestione del»…), senza
//     che stia da complemento di un'altra cosa («pulizia DELLA mensa», «lavori di adeguamento DELLA mensa», «navigazione NELLE residenze e
//     mense»); oppure
//   - è coordinata a un altro servizio affidato («servizio di pulizia, facchinaggio e sanificazione», «pulizie e guardiania»); oppure
//   - l'oggetto è un titolo senza parole di affidamento («Comune di Donnas - Refezione»), senza lavori né beni.
// Gradi (decisione dell'utente del 18/11, pacchetto 16: «l'ordine dei servizi NON decide il livello»):
//   - PRINCIPALE: il servizio è affidato come attività principale o autonoma, anche se è il secondo di un elenco («pulizie e guardiania»:
//     entrambi), o ha una testa propria («… nonché del servizio di portierato»);
//   - INTEGRATO: è affidato come componente di un «servizio integrato» («servizio integrato di accoglienza / biglietteria / conduzione del
//     bar», teatro di Monfalcone): nelle gare per CPV, senza CPV né lotto propri, è accessorio all'attività prevalente (B);
//   - ACCESSORIO: introdotto da «comprensivo di», «compreso», «incluso», «con», o «altri servizi» («concessione del bar … con effettuazione
//     del servizio di pulizia e guardiania»).
// Casi reali dell'archivio dello staging, 17-18/11/2026.
export type Affidamento = "principale" | "integrato" | "accessorio";

// «laffidamento»: l'apostrofo a volte manca negli avvisi (TED 91580b95)
const TESTE_DI_AFFIDAMENTO = /^l?(servizi?o?|appalt\w*|affidament\w*|concession\w*|gestion\w*|conduzion\w*|attivita|esecuzion\w*|prestazion\w*|espletament\w*|svolgiment\w*|erogazion\w*|acquisizion\w*)$/;
// teste «deboli»: in un elenco seguono la voce precedente («accoglienza / biglietteria / conduzione del bar»), mentre «… e servizio di
// facchinaggio» ripete la testa forte ed è un servizio a sé
const TESTE_DEBOLI = /^l?(gestion\w*|conduzion\w*|attivita|esecuzion\w*|prestazion\w*|espletament\w*|svolgiment\w*|erogazion\w*)$/;
// «e altri servizi integrati»: servizi in più, accessori al principale
const ALTRI = /^(altr[ie]|ulterior[ie]|vari[e]?|divers[ie])$/;
const DI = /^(di|del|dello|della|dei|degli|delle|dell)$/;
const MODALITA = /^(in|formula|regime|mediante|tramite|modalita)$/;
const SERVIZIO_PURO = /^(pulizi\w*|sanificazion\w*|disinfe\w*|igiene|vigilanz\w*|portierat\w*|portineri\w*|guardiani\w*|facchinagg\w*|trasloc\w*|ausiliariat\w*|ristorazion\w*|catering|refezion\w*)$/;
// «comprendente il servizio di …» (TED 465af5a5): come «comprensivo di»
const TESTE_ACCESSORIE = /^(comprensiv\w*|comprendent\w*|compres\w*|inclus\w*|accessori\w*|con)$/;
// «… e per alcune parti di igiene ambientale» (TED 85323614, decisione dell'utente del 18/11, D3): un affidamento parziale, accessorio,
// ma SOLO coordinato dopo un altro servizio affidato («e per alcune parti di», «e in parte di»). Da sole «parte/parti» sono parole comuni:
// «affidamento di parte del servizio di pulizia», «per la parte relativa alla sede», «da parte di istituto», «parte prima» (controllo del
// coordinamento, 18/11)
const PARTI = /^(parte|parti)$/;
const COORDINAZIONE = /^(e|ed|nonche|oltre|o|,)$/;
const PREPOSIZIONI = /^(di|del|dello|della|dei|degli|delle|dell|a|al|allo|alla|ai|agli|alle|all|da|dal|dallo|dalla|dai|dagli|dalle|dall|in|nel|nello|nella|nei|negli|nelle|nell|su|sul|sullo|sulla|sui|sugli|sulle|sull|per|presso|tra|fra)$/;
const ARTICOLI = /^(il|lo|la|i|gli|le|l|un|uno|una)$/;
// parole che tra la testa e il servizio non cambiano chi è affidato («con effettuazione del servizio»)
const RACCORDI = /^(effettuazion\w*|esecuzion\w*|svolgiment\w*|relativ\w*|annesso|annessa|annessi|annesse|connesso|connessa|connessi|connesse)$/;
// servizi (di qualunque mestiere) che possono stare in un elenco di servizi affidati
const ATTIVITA =
  /^(servizi?o?|pulizi\w*|sanificazion\w*|disinfe\w*|igiene|ristorazion\w*|mens[ae]|refezion\w*|past[oi]|vigilanz\w*|portierat\w*|portineri\w*|guardiani\w*|reception\w*|facchinagg\w*|trasloc\w*|ausiliariat\w*|manutenzion\w*|assistenz\w*|custodi\w*|accoglienz\w*|riordin\w*|lavanderi\w*|lavanol\w*|support\w*|conduzion\w*|sorveglianz\w*|presidi\w*|trasport\w*|somministrazion\w*|preparazion\w*|distribuzion\w*|cottur\w*|giardinagg\w*|apertura|chiusura|segreteri\w*|centralin\w*|bar|caffetteri\w*|ristoro|biglietteri\w*|cassa|accompagnament\w*)$/;
// lavori e beni: la parola del servizio che li segue è il loro oggetto, non un servizio affidato («lavori mensa scolastica»)
const BENI_E_LAVORI =
  /^(lavor\w*|fornitur\w*|acquist\w*|noleggi\w*|progettazion\w*|realizzazion\w*|ristrutturazion\w*|adeguament\w*|costruzion\w*|riqualificazion\w*|ammodernament\w*|rifaciment\w*|software|sistem\w*|impiant\w*|apparat\w*|attrezzatur\w*|arred\w*|piattaform\w*|applicativ\w*)$/;

// Il testo in parole, come testoPerConfronto, ma con le virgole (elenchi) e i trattini o i due punti (titoli: «Comune di X - Refezione»).
function paroleDelTesto(testo: string | null | undefined): string[] {
  return (testo ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[,/]+/g, " , ")
    // anche il punto seguito da uno spazio chiude una frase («… dei servizi cimiteriali. Apertura, presidio, chiusura, pulizia», TED 7c78c6ca)
    .replace(/(\s[-–—]+\s|[:;()«»"“”]|\.\s)/g, " | ")
    .replace(/[^a-z0-9,|]+/g, " ")
    .split(" ")
    .filter(Boolean);
}

// Parole che possono reggere la testa di affidamento: la procedura («procedura aperta per l'affidamento»), un'altra testa («affidamento del
// servizio»), un raccordo («relativo alle attività»), un aggettivo della testa («gestione integrata del servizio»), l'ente o i numeri.
const REGGONO_LA_TESTA =
  /^(procedur\w*|gara|gare|bando|avviso|apert\w*|negoziat\w*|ristrett\w*|telematic\w*|europe\w*|comunitari\w*|soglia|quadro|accordo|convenzion\w*|contratt\w*|lott\w*|indizion\w*|richiest\w*|offert\w*|manifestazion\w*|interesse|invito|rdo|trattativa|sensi|art|lgs|n|cig|rif|anni|mesi|periodo|durata|biennal\w*|triennal\w*|quinquennal\w*|annual\w*|pluriennal\w*|integrat\w*|complet\w*|global\w*|unic\w*|comune|azienda|ente|\d+)$/;

// La testa è retta da una procedura o da un'altra testa? Se è il complemento di altro non affida nulla: «sistema di gestione della mensa»,
// «software per la gestione delle mense», «applicazione dei CAM per il servizio ristorazione» (TED 6ffe89d4, pulizia per le mense DSU).
function testaRetta(p: readonly string[], h: number): boolean {
  let j = h - 1;
  while (j >= 0 && ARTICOLI.test(p[j])) j--;
  if (j < 0 || !PREPOSIZIONI.test(p[j])) return true;
  // anche «affidamento del del servizio» (TED f6124638)
  while (j >= 0 && (ARTICOLI.test(p[j]) || PREPOSIZIONI.test(p[j]) || p[j] === ",")) j--;
  // «… nonché del servizio di receptionist/portierato» (Comune di Ercolano, TED 2cc42f92): una seconda testa coordinata alla prima
  if (j < 0 || p[j] === "|" || COORDINAZIONE.test(p[j])) return true;
  // «affidamento di parte del servizio di pulizia»: la testa è retta da «parte», a sua volta retta; non «utilizzo dei locali DA PARTE DEL
  // servizio di ristorazione»
  if (PARTI.test(p[j])) return testaRetta(p, j);
  return TESTE_DI_AFFIDAMENTO.test(p[j]) || TESTE_ACCESSORIE.test(p[j]) || RACCORDI.test(p[j]) || REGGONO_LA_TESTA.test(p[j]);
}

// «parte/parti» in posizione j introduce un servizio accessorio solo se è coordinata dopo un altro servizio affidato: «servizi sanitari,
// assistenziali E PER ALCUNE PARTI di igiene ambientale» (TED 85323614), «… e in parte di pulizia». Non «in tutto o in parte».
function parteCoordinata(p: readonly string[], j: number): boolean {
  let x = j - 1;
  while (x >= 0 && (ARTICOLI.test(p[x]) || PREPOSIZIONI.test(p[x]) || /^(alcun\w*|talun\w*)$/.test(p[x]))) x--;
  if (x < 0 || !/^(e|ed|nonche)$/.test(p[x])) return false;
  for (let y = x - 1, passi = 0; y >= 0 && passi < 12 && p[y] !== "|"; y--, passi++) {
    if (TESTE_DI_AFFIDAMENTO.test(p[y]) && testaRetta(p, y)) return true;
  }
  return false;
}

// «con» introduce un servizio accessorio solo se tra «con» e il servizio ci sono raccordi («con effettuazione del servizio di pulizia», «con
// pulizia dei locali»), non altro («gestione con formula global service»).
function conAccessorio(p: readonly string[], j: number, i: number): boolean {
  return p.slice(j + 1, i).every((w) => ARTICOLI.test(w) || PREPOSIZIONI.test(w) || RACCORDI.test(w) || TESTE_DI_AFFIDAMENTO.test(w));
}

// «con effettuazione del servizio di», «comprensivo del servizio di»: la testa è introdotta da una parola accessoria.
// Anche una testa coordinata a una testa accessoria è accessoria: «comprendente il servizio di mantenimento degli animali ED IL SERVIZIO DI
// PULIZIA» (gestione degli stabulari, TED 465af5a5); «… nonché del servizio di portierato» dopo un affidamento principale resta principale.
function testaAccessoria(p: readonly string[], h: number, profondita = 0): boolean {
  for (let j = h - 1, passi = 0; j >= 0 && passi < 4; j--, passi++) {
    if (TESTE_ACCESSORIE.test(p[j]) || (PARTI.test(p[j]) && parteCoordinata(p, j))) return true;
    if (COORDINAZIONE.test(p[j]) && p[j] !== "," && profondita < 4) {
      for (let x = j - 1, altri = 0; x >= 0 && altri < 12 && p[x] !== "|"; x--, altri++) {
        if (TESTE_DI_AFFIDAMENTO.test(p[x])) return testaAccessoria(p, x, profondita + 1);
      }
      return false;
    }
    if (!(ARTICOLI.test(p[j]) || PREPOSIZIONI.test(p[j]) || RACCORDI.test(p[j]))) return false;
  }
  return false;
}

// Il grado più debole tra la voce e quella a cui è coordinata: l'accessorio resta accessorio, la componente di un servizio integrato resta
// tale.
function unisci(a: Affidamento, b: Affidamento): Affidamento {
  return a === "accessorio" || b === "accessorio" ? "accessorio" : a === "integrato" || b === "integrato" ? "integrato" : "principale";
}

// Una testa debole dentro un elenco segue la voce precedente; undefined se la testa non è debole o non è in un elenco.
function testaDeboleInElenco(p: readonly string[], h: number, profondita: number): Affidamento | null | undefined {
  if (!TESTE_DEBOLI.test(p[h])) return undefined;
  let j = h - 1;
  while (j >= 0 && ARTICOLI.test(p[j])) j--;
  if (j < 0 || !COORDINAZIONE.test(p[j])) return undefined;
  while (j >= 0 && COORDINAZIONE.test(p[j])) j--;
  for (let x = j; x >= 0 && !PREPOSIZIONI.test(p[x]) && !COORDINAZIONE.test(p[x]) && p[x] !== "|"; x--) {
    if (TESTE_DI_AFFIDAMENTO.test(p[x])) break;
    if (ATTIVITA.test(p[x]) && !BENI_E_LAVORI.test(p[x])) return affidamentoInPosizione(p, x, profondita + 1);
  }
  return undefined;
}

function precedutaDaAltri(p: readonly string[], h: number): boolean {
  let j = h - 1;
  while (j >= 0 && ARTICOLI.test(p[j])) j--;
  return j >= 0 && ALTRI.test(p[j]);
}

// «servizio integrato di …», «servizi integrati di …», «gestione integrata dei servizi di …»: la testa regge le componenti di un servizio
// integrato
function testaIntegrata(p: readonly string[], h: number): boolean {
  return /^integrat/.test(p[h + 1] ?? "");
}

// La parola in posizione i è un servizio affidato? Guarda indietro fino alla testa (o all'inizio del titolo) e controlla cosa c'è in mezzo.
function affidamentoInPosizione(p: readonly string[], i: number, profondita = 0): Affidamento | null {
  if (profondita > 6) return null;
  // «servizi di manutenzione IN global service», «in regime di global service», «con formula global service»: è il modo del contratto, non
  // un luogo; conta la testa che regge la frase (TED 54bdd6eb)
  if (/^(global|facility)$/.test(p[i])) {
    let j = i - 1;
    while (j >= 0 && (ARTICOLI.test(p[j]) || DI.test(p[j]))) j--;
    if (j >= 0 && MODALITA.test(p[j])) {
      for (let x = j - 1, passi = 0; x >= 0 && passi < 12 && p[x] !== "|"; x--, passi++) {
        if (TESTE_DI_AFFIDAMENTO.test(p[x])) return testaRetta(p, x) ? (testaAccessoria(p, x) ? "accessorio" : "principale") : null;
      }
    }
  }
  // la parola è già una testa («servizi ausiliari», «servizio di ausiliariato», «e altri servizi integrati»)
  if (TESTE_DI_AFFIDAMENTO.test(p[i])) {
    if (!testaRetta(p, i)) return null;
    return testaAccessoria(p, i) || precedutaDaAltri(p, i) ? "accessorio" : "principale";
  }
  let h = -1;
  let tipo: "principale" | "accessorio" | "titolo" = "titolo";
  for (let j = i - 1, passi = 0; j >= 0 && passi < 25; j--, passi++) {
    if (p[j] === "|") break;
    if ((TESTE_ACCESSORIE.test(p[j]) && (p[j] !== "con" || conAccessorio(p, j, i))) || (PARTI.test(p[j]) && parteCoordinata(p, j))) {
      h = j;
      tipo = "accessorio";
      break;
    }
    if (TESTE_DI_AFFIDAMENTO.test(p[j])) {
      if (!testaRetta(p, j)) return null;
      h = j;
      tipo = testaAccessoria(p, j) ? "accessorio" : "principale";
      break;
    }
  }
  // inizio dell'oggetto o del titolo dopo un trattino: niente testa
  const inizio = h >= 0 ? h + 1 : (() => {
    let j = i - 1;
    while (j >= 0 && p[j] !== "|") j--;
    return j + 1;
  })();
  const mezzo = p.slice(inizio, i);
  if (tipo === "titolo" && mezzo.some((w) => BENI_E_LAVORI.test(w) || TESTE_DI_AFFIDAMENTO.test(w))) return null;
  const debole = h >= 0 && tipo === "principale" ? testaDeboleInElenco(p, h, profondita) : undefined;
  if (debole === null) return null;
  const base: Affidamento =
    debole ?? (tipo === "accessorio" || (h >= 0 && precedutaDaAltri(p, h)) ? "accessorio" : h >= 0 && testaIntegrata(p, h) ? "integrato" : "principale");
  // l'ultimo elenco: la parola è coordinata al servizio che la precede? (anche «e di ristorazione», con la preposizione ripetuta)
  let k = mezzo.length - 1;
  while (k >= 0 && ARTICOLI.test(mezzo[k])) k--;
  // «servizi integrati di assistenza …, installazione … e DI guardiania» (TED 211c3189): la «di» ripetuta dopo la congiunzione è retta dalla
  // testa, come la prima («servizi DI …»)
  if (k >= 1 && DI.test(mezzo[k]) && COORDINAZIONE.test(mezzo[k - 1]) && h >= 0) {
    const primo = mezzo.findIndex((w) => !ARTICOLI.test(w) && !REGGONO_LA_TESTA.test(w));
    if (primo >= 0 && DI.test(mezzo[primo])) return base;
  }
  if (k >= 1 && PREPOSIZIONI.test(mezzo[k]) && COORDINAZIONE.test(mezzo[k - 1])) k--;
  // il servizio è dentro una voce dell'elenco, senza preposizioni dopo la congiunzione («accoglienza / biglietteria / conduzione bar»,
  // teatro di Monfalcone, TED 219ed447): la voce è coordinata a quella precedente
  if (k >= 0 && !COORDINAZIONE.test(mezzo[k]) && !PREPOSIZIONI.test(mezzo[k])) {
    let q = k;
    while (q >= 0 && !COORDINAZIONE.test(mezzo[q]) && !PREPOSIZIONI.test(mezzo[q]) && !TESTE_DI_AFFIDAMENTO.test(mezzo[q])) q--;
    if (q >= 0 && COORDINAZIONE.test(mezzo[q])) k = q;
  }
  if (k >= 0 && COORDINAZIONE.test(mezzo[k])) {
    let c = k;
    while (c >= 0 && COORDINAZIONE.test(mezzo[c])) c--;
    // la voce precedente dell'elenco: dopo la sua ultima preposizione, un servizio noto
    let fine = c;
    while (fine >= 0 && !COORDINAZIONE.test(mezzo[fine]) && !PREPOSIZIONI.test(mezzo[fine])) fine--;
    for (let x = c; x > fine; x--) {
      if (ATTIVITA.test(mezzo[x]) && !BENI_E_LAVORI.test(mezzo[x])) {
        const r = affidamentoInPosizione(p, inizio + x, profondita + 1);
        return r === null ? null : unisci(base, r);
      }
    }
    // la voce precedente è la testa stessa («servizio gestione, pulizia…», «servizi cimiteriali, pulizia…»)
    if (fine < 0) return base;
    // la voce precedente è retta direttamente dalla testa («servizi cimiteriali, operazioni tanatologiche, custodia, pulizia», «servizio di
    // fornitura, pulizia e manutenzione»): è anche lei un servizio dell'elenco, come quella che segue. Non se è un luogo o un destinatario
    // dopo una preposizione («navigazione NELLE residenze e mense», «vigilanza PRESSO le scuole e mense»)
    const retta = COORDINAZIONE.test(mezzo[fine]) || (DI.test(mezzo[fine]) && mezzo.slice(0, fine).every((w) => ARTICOLI.test(w) || REGGONO_LA_TESTA.test(w)));
    // una parola che è solo un servizio, mai un luogo («… di animali da laboratorio e PULIZIA dei locali», TED 2bc0e574) è coordinata alla
    // testa anche dopo un complemento; «mense», «bar», «ristorante» possono essere luoghi («nelle residenze e mense») e non lo sono
    if (!retta) return h >= 0 && SERVIZIO_PURO.test(p[i]) ? base : null;
    let x0 = fine + 1;
    while (x0 <= c && ARTICOLI.test(mezzo[x0])) x0++;
    if (x0 > c) return null;
    if (DI.test(mezzo[fine])) return base;
    const r = affidamentoInPosizione(p, inizio + x0, profondita + 1);
    return r === null ? null : unisci(base, r);
  }
  // complemento di un'altra cosa: preposizione subito prima, con una parola piena prima di lei («pulizia della mensa»)
  // (non contano gli aggettivi della testa, «servizio integrato di accoglienza», né i raccordi, «appalto relativo alla pulizia»)
  if (k >= 0 && PREPOSIZIONI.test(mezzo[k]) && mezzo.slice(0, k).some((w) => !PREPOSIZIONI.test(w) && !ARTICOLI.test(w) && !COORDINAZIONE.test(w) && !REGGONO_LA_TESTA.test(w) && !RACCORDI.test(w))) return null;
  return base;
}

const GRADO: Record<Affidamento, number> = { principale: 3, integrato: 2, accessorio: 1 };

// Come l'oggetto affida il servizio del settore: «principale», «integrato», «accessorio», o null se lo cita soltanto (riferimento, luogo,
// destinazione). Vale la migliore delle occorrenze.
export function affidamentoEsplicito(settore: SettoreRadar, parole: RegExp, testo: string | null | undefined): Affidamento | null {
  const p = paroleDelTesto(testo);
  const unito = p.join(" ");
  const inizi: number[] = [];
  let pos = 0;
  for (const w of p) {
    inizi.push(pos);
    pos += w.length + 1;
  }
  let migliore: Affidamento | null = null;
  for (const m of unito.matchAll(new RegExp(parole.source, "g"))) {
    const i = inizi.indexOf(m.index ?? -1);
    if (i < 0) continue;
    const a = affidamentoInPosizione(p, i);
    if (a === "principale") return a;
    if (a && (!migliore || GRADO[a] > GRADO[migliore])) migliore = a;
  }
  return migliore;
}

// S1 (decisione dell'utente del 23/11, documento 49A): il servizio del settore è UNA DELLE ATTIVITÀ ELENCATE come affidate, in un elenco
// che il riconoscimento dell'affidamento non lega a una testa («servizio di noleggio … di container, gruppi elettrogeni, certificazione
// impianto elettrico, sanificazione/disinfestazione e derattizzazione», Brigata aeromobile, TED e30a5e91): correlata (B), non citazione (C).
// Resta citazione (C) quando la parola:
//   - può essere un luogo o un oggetto («mensa», «bar», «reception», «pasti»): vale solo per le parole che sono sempre un'attività;
//   - non è in un elenco (nessuna virgola o «e» subito prima), o la voce che la precede non è un'attività («presso le scuole, pulizia…»);
//   - ha subito dopo un oggetto che non è un ambiente («pulizia casse» delle navi, Agenzia Industrie Difesa, TED 04ceaec1: manutenzione navale).
const ELENCO = /^(,|e|ed|nonche)$/;
const ATTIVITA_GENERICA = /(zion[ei]|aggio|aggi)$/;
const AMBIENTI = /^(locali|ambienti|uffici|edifici|edificio|immobili|sedi|aree|spazi|strutture|reparti|bagni|servizi|scuole|plessi|palestre)$/;

export function servizioInElenco(settore: SettoreRadar, testo: string | null | undefined): boolean {
  const p = paroleDelTesto(testo);
  const unito = p.join(" ");
  const inizi: number[] = [];
  let pos = 0;
  for (const w of p) {
    inizi.push(pos);
    pos += w.length + 1;
  }
  for (const m of unito.matchAll(new RegExp(paroleDelServizio(settore).source, "g"))) {
    const i = inizi.indexOf(m.index ?? -1);
    if (i < 0 || !SERVIZIO_PURO.test(p[i])) continue;
    const dopo = p[i + 1];
    if (dopo && dopo !== "|" && !ELENCO.test(dopo) && !PREPOSIZIONI.test(dopo) && !ARTICOLI.test(dopo) && !SERVIZIO_PURO.test(dopo) && !AMBIENTI.test(dopo)) continue;
    let j = i - 1;
    while (j >= 0 && (ARTICOLI.test(p[j]) || DI.test(p[j]))) j--;
    if (j < 0 || !ELENCO.test(p[j])) continue;
    const voce: string[] = [];
    for (let x = j - 1; x >= 0 && p[x] !== "|" && !ELENCO.test(p[x]); x--) voce.push(p[x]);
    if (voce.some((w) => SERVIZIO_PURO.test(w) || (ATTIVITA_GENERICA.test(w) && !BENI_E_LAVORI.test(w)))) return true;
  }
  return false;
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
    { id: "concessione_punto_ristoro", nome: "Concessione punto ristoro", testo: /\b(ristoro|panin\w*|prodotti da forno|merend\w*)\b/ },
    // decisione dell'utente del 17/11: le concessioni autonome di distributori automatici sono ristorazione A, in una sottocategoria
    // DEDICATA, distinta dal punto ristoro (dove i distributori sono accessori a un affidamento più ampio valgono le regole B generali)
    { id: "distributori_automatici", nome: "Concessione distributori automatici di alimenti e bevande", testo: /\b(distributor\w* automatic\w*|distribuzione automatica|vending)\b/ },
    { id: "appalti_multiservizi", nome: "Ristorazione dentro appalti multiservizi e gestioni integrate" },
    // decisione dell'utente del 18/11 (ACEA Pinerolese): servizi sostitutivi di mensa e buoni pasto, sempre correlati (B)
    { id: "servizi_sostitutivi_mensa", nome: "Servizi sostitutivi di mensa e buoni pasto", testo: /\b(sostitutiv\w* (di |della |del )?mens[ae]|buon[oi] pasto|ticket restaurant)\b/ },
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
  // l'esclusione non vale se l'oggetto AFFIDA (come principale o accessorio, affidamentoEsplicito) ciò che questa espressione nomina:
  // «fornitura di badge per il servizio sostitutivo di mensa» è C, «affidamento del servizio sostitutivo di mensa mediante badge» no
  salvoSeAffidato?: RegExp;
  // se vale anche una correlazione (gestione di una struttura, evento, finanza di progetto…), il livello è B invece di C
  cedeAlleCorrelazioni?: boolean;
};

// Videosorveglianza: gli oggetti tecnici e il servizio operativo (decisione dell'utente del 17/11)
const VIDEO = /\b(video ?sorveglianz\w*|telecamer\w*|fototrappol\w*|tvcc|impiant\w* (di )?(allarme|antintrusione|videosorveglianza)|sistem\w* di (video\w*|allarme|antintrusione|controllo accessi)|software)\b/;
const OPERATIVO =
  /\b(monitoraggio|presidi\w*|vigilanz\w*|guardi\w* giurat\w*|piantonament\w*|pattugliament\w*|pronto intervento|ronda|ronde|valori|centrale operativa|control room|sala (di )?controllo|telesorveglianz\w*|teleallarm\w*|teleradioallarm\w*|televigilanz\w*|portierat\w*|portineri\w*|guardiani\w*|operatori)\b/;

// I 6 CPV di bar e ristoranti approvati dall'utente il 17/11 (verificati su EUR-Lex, regolamento (CE) n. 213/2008): valgono solo con il
// contesto. Se in ristorazione c'è SOLO uno di questi codici, l'oggetto deve nominare il servizio di ristorazione.
export const CPV_CON_CONTESTO: readonly string[] = ["55410000", "55400000", "55330000", "55310000", "55311000", "55312000"];
const NOMINA_RISTORAZIONE =
  /\b(bar|caffetteri\w*|ristorant\w*|ristorazion\w*|ristoro|punt\w* (di )?ristoro|somministrazion\w*|mens[ae]|refezion\w*|past[oi]|catering|tavola (calda|fredda)|enotec\w*|distributor\w* automatic\w*|vending|food beverage|locanda|trattori\w*|pizzeri\w*)\b/;
// «chiosco» nomina il servizio anche lui (decisione dell'utente del 17/11 sul caso Sintel 225696739, Taino: «concessione del chiosco
// ubicato nel parco comunale» con il CPV del bar), ma non se l'oggetto parla di edicola, giornali o fiori: il chiosco è un'altra attività
const CHIOSCO = /\bchiosc\w*\b/;
const CHIOSCO_NON_RISTORO = /\b(edicol\w*|giornali|quotidiani|riviste|fiori|fiorai\w*|fiorist\w*)\b/;

// La pulizia AFFIDATA come servizio, che resta pulizia anche quando l'oggetto parla di biancheria, indumenti o animali (regole del 18/11):
// «servizio di pulizia giornaliera … e servizio di lavanolo della biancheria», «servizi socio-assistenziali, infermieristici, di pulizia,
// lavanderia», «pulizia dei locali dello stabulario». Non quando ciò che si pulisce sono la biancheria, gli indumenti, i dispositivi o gli
// animali («servizio di pulizia e sanificazione della biancheria», «cattura, ricovero, pulizia, custodia e mantenimento dei cani»).
const NON_AMBIENTI = "(?!( \\w+){0,3} (della |dei |delle |degli |di |del )?(biancheri|indument|capi|divise|dispositivi|tessut|materass|cani|animal|gatti))";
const PULIZIA_AFFIDATA = new RegExp(
  `\\b((servizi?o?|appalt\\w*|affidament\\w*)( \\w+){0,3} (di |della |delle |dei |del )?pulizi\\w*${NON_AMBIENTI}|(pulizi\\w*|sanificazion\\w*) (dei |degli |delle |del |della |di |dell )?(locali|ambienti|uffici|edifici|edificio|immobili|sedi|aree|spazi|strutture|reparti|residenz\\w*)|pulizi\\w*( e| ed)? (lavanderi\\w*|affini))\\b`,
);

const MOVIMENTAZIONE = /\b(facchinagg\w*|trasloc\w*|movimentazion\w*|carico|scarico|magazzin\w*|immagazzin\w*|stoccaggi\w*|logistic\w*|manovalanza|smontaggi\w*|montaggi\w*|allestiment\w*|sgomber\w*|smistament\w*|imballagg\w*)\b/;

export const ESCLUSIONI_OGGETTO: readonly RegolaEsclusione[] = [
  {
    // regola del contesto dei 6 CPV nuovi (decisione dell'utente del 17/11): un CPV non basta. Se l'oggetto non nomina il servizio, la
    // gara è C; ma se l'oggetto descrive una gestione più ampia (struttura, evento, finanza di progetto…), la ristorazione è accessoria: B
    id: "cpv_nuovi_senza_oggetto",
    settori: ["ristorazione"],
    // il testo è già normalizzato in una riga: esclude se non nomina il servizio E non c'è un chiosco senza edicola, giornali o fiori
    cerca: new RegExp(`^(?!.*${NOMINA_RISTORAZIONE.source})(?!(?!.*${CHIOSCO_NON_RISTORO.source}).*${CHIOSCO.source})`),
    salvo: null,
    condizione: (c) => c.delSettore.length > 0 && c.delSettore.every((x) => CPV_CON_CONTESTO.includes(x)),
    cedeAlleCorrelazioni: true,
    motivo: "Solo un CPV di bar, caffetteria o ristorazione con cameriere, ma l'oggetto non nomina bar, caffetteria, ristorante, punto ristoro, chiosco, somministrazione o mensa",
    casi: ["Concessione di spazi commerciali presso la stazione marittima"],
  },
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
    // fase B2b: anche «acquisto» («acquisto delle cassette riutilizzabili e relative attrezzature», lotto con il CPV della pulizia, TED)
    cerca: /\b(fornitur\w*|acquist\w*)\b/,
    // basta che l'oggetto parli di servizi: «fornitura di servizi di catering», «fornitura di beni ed erogazione servizi di accoglienza»;
    // o di un servizio operativo di sorveglianza («fornitura … con monitoraggio delle immagini dalla centrale operativa»: affidamento misto)
    // (non «presidio» né «valori»: «Presidi ERDIS» sono le sedi di una fornitura di derrate, caso reale di TED del 17/11/2026)
    // (anche i buoni pasto: servizio sostitutivo di mensa, mai C in automatico, decisione dell'utente del 18/11)
    salvo: /\b(serviz\w*|catering|concession\w*|monitoraggio|centrale operativa|control room|sala (di )?controllo|telesorveglianz\w*|televigilanz\w*|pronto intervento|piantonament\w*|pattugliament\w*|buon\w* pasto)\b/,
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
  {
    // fase B2b: la connessione a internet nelle mense è un servizio di telecomunicazioni, anche se l'oggetto nomina le mense (ARDSU, TED
    // a9b7980e, CPV 64210000 e 50330000: era A per la parola «mense»). Resta solo se l'oggetto affida esplicitamente il servizio del settore
    id: "servizi_di_connettivita",
    settori: "tutti",
    // non «hotspot»: sono anche i centri di prima accoglienza dei migranti (TED 7ec698cb, «gestione dei centri c.d. hotspot»)
    cerca: /\b(connettivit\w*|wi ?fi|wireless|accesso (a |ad )?internet|navigazione (internet|web|in rete)|banda (larga|ultralarga)|fibra ottica|telecomunicazion\w*|rete dati)\b/,
    salvo: SERVIZIO_ESPLICITO,
    ancheConNucleo: true,
    motivo: "Servizio di connessione a internet o di telecomunicazioni: non è un servizio del settore, anche se nomina i luoghi (mense, residenze)",
    casi: ["Servizio di navigazione nelle residenze e mense universitarie ARDSU, comprensivo di fornitura e installazione apparati di connettività e assistenza e manutenzione"],
  },
  {
    // decisione dell'utente del 18/11: «il lavaggio e la stiratura di indumenti non sono pulizia e sanificazione ambientale» (TED 93a329b1).
    // Resta pulizia se l'oggetto affida anche la pulizia («servizi di pulizia e lavanderia» nelle strutture)
    id: "lavanderia_e_indumenti",
    settori: ["pulizia"],
    // anche materassi antidecubito e dispositivi di protezione individuale (TED 3a7346ec, 3ca05686)
    cerca: /\b(lavanderi\w*|lavanol\w*|stiratur\w*|indument\w*|capi (di )?abbigliament\w*|abiti da lavoro|divise|biancheri\w*|vestiari\w*|tessut\w*|materass\w*|dispositivi di protezione|dpi)\b/,
    // resta se l'oggetto affida anche la pulizia degli ambienti («servizi di pulizia e lavanderia», «pulizia dei locali»)
    salvo: PULIZIA_AFFIDATA,
    ancheConNucleo: true,
    motivo: "Lavaggio, sanificazione o stiratura di indumenti, tessuti o dispositivi: non è pulizia e sanificazione degli ambienti",
    casi: ["Servizi di lavaggio, sanificazione e stiratura per i capi di abbigliamento del personale"],
  },
  {
    // decisioni dell'utente del 18/11 (D4): la pulizia di acque e coste è igiene ambientale del territorio, distinta dalla pulizia di
    // edifici, locali e strutture («servizio integrato di monitoraggio ambientale, pulizia e gestione digitale degli specchi acquei portuali e
    // delle aree costiere», TED feb5aec8). «Un CPV discordante non deve prevalere automaticamente sull'effettivo oggetto contrattuale»: vale
    // anche con il CPV della pulizia («pulizia e disinquinamento degli specchi acquei nel porto», TED 3b0902ca, CPV 90900000). Resta pulizia
    // se l'oggetto affida anche la pulizia di edifici, locali o strutture, anche coordinata («pulizia delle spiagge E DEI SERVIZI IGIENICI
    // degli stabilimenti», controllo del coordinamento del 18/11)
    id: "acque_e_coste",
    settori: ["pulizia"],
    cerca: /\b(spiagg\w*|arenil\w*|alve\w*|specch\w* acque\w*|aree costier\w*|fondal\w*)\b/,
    salvo: /\b(pulizi\w*|sanificazion\w*) ((\w+ ){1,4}(e|ed) )?(dei |degli |delle |del |della |di |dell )?(locali|uffici|edifici|edificio|immobili|sedi|scuole|strutture|servizi igienici|bagni)\b/,
    ancheConNucleo: true,
    motivo:
      "Pulizia di acque e coste (spiagge, arenili, alvei, specchi acquei): igiene ambientale del territorio, distinta dalla pulizia di edifici, locali e strutture; il CPV della gara non prevale sull'oggetto del contratto",
    casi: [
      "Servizio integrato di monitoraggio ambientale, pulizia e gestione digitale degli specchi acquei portuali e delle aree costiere",
      "Appalto del servizio quadriennale di pulizia e disinquinamento degli specchi acquei nel porto",
    ],
  },
  {
    // decisione dell'utente del 18/11 (D2): «C se riguarda soltanto materiali, stampa, dispositivi o badge senza il servizio sottostante».
    // Non vale se l'oggetto affida il servizio di buoni pasto o il servizio sostitutivo di mensa (B), né per la «fornitura di buoni pasto»,
    // che è il servizio stesso. Solo nel contesto dei buoni pasto: nessuna fornitura diventa C o ristorazione per analogia
    id: "buoni_pasto_senza_servizio",
    settori: ["ristorazione"],
    cerca: new RegExp(
      `^(?=.*${/\b(buon[oi] pasto|ticket\w*|sostitutiv\w* (di |della |del )?mens[ae])\b/.source})(?=.*${/\b(stamp\w*|tipografi\w*|(fornitur\w*|acquist\w*|noleggi\w*) (di |dei |delle |degli )?(badge\w*|tessere|card|carte|dispositiv\w*|terminal\w*|lettor\w*|pos|material\w*|blocchett\w*|carnet)|(badge\w*|tessere|terminal\w*|lettor\w*) (per|dei|delle|di))\b/.source})`,
    ),
    salvo: /\bfornitur\w* (dei |di |delle )?buon[oi] pasto\b/,
    salvoSeAffidato: /\b(servizi?o? sostitutiv\w*|buon[oi] pasto|ticket restaurant)\b/,
    ancheConNucleo: true,
    motivo: "Solo materiali, stampa, dispositivi o badge per i buoni pasto, senza il servizio di buoni pasto o il servizio sostitutivo di mensa",
    casi: ["Stampa di ticket per la mensa aziendale", "Fornitura di badge e terminali per il servizio sostitutivo di mensa"],
  },
  {
    // la pulizia dei cani randagi o delle gabbie non è pulizia degli ambienti (TED 8a89e9f9, canile); la pulizia dei locali dello stabulario sì
    // (TED 2bc0e574). Non la disinfestazione da animali infestanti
    id: "cura_degli_animali",
    settori: ["pulizia"],
    // non «stabulario»: è un locale («pulizia dei locali dello stabulario» resta pulizia)
    cerca: /\b(cani|randagi|animal\w*|canil\w*|gatti|felin\w*)\b/,
    salvo: new RegExp(`${PULIZIA_AFFIDATA.source}|\\b(disinfestazion\\w*|derattizzazion\\w*|deblattizzazion\\w*|infestant\\w*)\\b`),
    ancheConNucleo: true,
    motivo: "Cura e pulizia di animali o dei loro ricoveri: non è pulizia e sanificazione degli ambienti",
    casi: ["Individuazione di canile sanitario e rifugio cui affidare il servizio di cattura, ricovero, pulizia, custodia e mantenimento dei cani randagi"],
  },
  {
    // la vigilanza degli alunni (accompagnamento, pre e post scuola, trasporto scolastico) è assistenza educativa, non vigilanza privata
    // (TED 05dce2dd, 7f0814bd, ac6fd4ae)
    id: "vigilanza_educativa",
    settori: ["vigilanza_portierato"],
    cerca:
      /\b((vigilanz\w*|sorveglianz\w*)( \w+){0,6} (alunn\w*|bambin\w*|minor\w*|student\w*|scolar\w*|trasporto scolastico|scuolabus)|(pre|post) scuola|accompagnament\w* e vigilanz\w*)\b/,
    salvo: /\b(vigilanza (armata|privata)|guardi\w* giurat\w*|istitut\w* di vigilanza|portierat\w*|guardiani\w*)\b/,
    ancheConNucleo: true,
    motivo: "Vigilanza e accompagnamento di alunni o minori: è assistenza educativa, non vigilanza privata né portierato",
    casi: ["Servizi di pre e post scuola e servizio di accompagnamento e vigilanza alunni durante il trasporto scolastico"],
  },
  {
    // decisione dell'utente del 18/11: la vigilanza amministrativa (controlli sugli enti, RUNTS) è C per vigilanza e portierato (TED
    // 36085627). Non la «vigilanza ispettiva» delle guardie (ronde di ispezione), che resta vigilanza privata
    id: "vigilanza_amministrativa",
    settori: ["vigilanza_portierato"],
    cerca:
      /\b(vigilanz\w* (e (monitoraggio|controllo) )?(sugli|sulle|sui|sul) (enti|ets|organismi|soggetti|fondi|imprese|cooperative|associazioni|operatori|attivita)|vigilanza (amministrativa|sanitaria|veterinaria|fiscale|prudenziale|urbanistica|edilizia|ambientale))\b/,
    salvo: /\b(vigilanza (armata|privata)|guardi\w* giurat\w*|istitut\w* di vigilanza|portierat\w*|guardiani\w*)\b/,
    ancheConNucleo: true,
    motivo: "Vigilanza amministrativa (controlli e monitoraggio su enti o attività): non è vigilanza privata né portierato",
    casi: ["Servizio di supporto giuridico-legale all'Ufficio regionale del RUNTS per controlli successivi, vigilanza e monitoraggio sugli ETS"],
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
    // l'integrazione è tra servizi dello stesso settore: «gestione integrata dei servizi di sicurezza e portierato»; anche il bar o la
    // mensa in più sedi («concessione del servizio di gestione integrata del servizio bar presso il Centro Sportivo e lo Stadio», Sintel
    // 225629817, segnalato da B2 il 17/11)
    salvo:
      /\b(global service|facility management|gestione (globale|integrata|integrale|complessiva|omnicomprensiva|operativa integrata)) (di |dei |del |della |delle )?(servizi\w* (di |del |della )?)?(pulizi\w*|sanificazion\w*|igiene ambientale|ristorazion\w*|refezion\w*|mens[ae]|bar|caffetteri\w*|ristorant\w*|punt\w* (di )?ristoro|vigilanz\w*|sicurezza|portierat\w*|portineri\w*|facchinagg\w*|trasloc\w*|ausiliariat\w*)\b/,
    motivo: "Il servizio è una parte di un appalto multiservizi o di una gestione integrata",
    casi: ["Servizio di gestione globale in concessione della casa di riposo Villa Loreto", "Servizi di facility management all'interno del complesso immobiliare"],
  },
  {
    id: "gestione_di_struttura",
    settori: "tutti",
    cerca:
      /\b(gestion\w*|concession\w*|conduzion\w*)( \w+){0,4} (centr[oi]|struttur\w*|rsa|r s a|cas[ae] (di riposo|protett\w*|di soggiorno|famiglia|albergo)|residen\w*|asil\w*|nid\w*|comunita|hotspot|impiant\w* sportiv\w*|impianto e|piscin\w*|palestr\w*|palazzett\w*|stabil[ei]|compendi\w*|convitt\w*|ostell\w*|rifugi\w*|campeggi\w*|alberg\w*|hotel|muse\w*|teatr\w*)\b/,
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
  // «solo_distributori» (B) non c'è più: decisione dell'utente del 17/11, le concessioni autonome di distributori automatici sono A nella
  // sottocategoria «distributori_automatici»
  {
    // eventi: la ristorazione è accessoria se l'oggetto principale è l'organizzazione dell'evento (viene prima); principale se il servizio
    // di ristorazione viene prima («servizio di catering per gli eventi»). Decisione dell'utente del 17/11: niente limite automatico a B
    id: "organizzazione_eventi",
    settori: ["ristorazione", "pulizia", "vigilanza_portierato", "facchinaggio"],
    // «gestione» solo se riferita direttamente all'evento: «gestione bar, catering per gli eventi» è il servizio, non l'organizzazione
    cerca:
      /\b(organizzazion\w*|allestiment\w*)( \w+){0,4} (event\w*|congress\w*|convegn\w*|manifestazion\w*|fier[ae]|festival|concert\w*|spettacol\w*|edizion\w*)\b|\bgestion\w* (dell |della |del |dei |degli |delle )?(event\w*|congress\w*|convegn\w*|manifestazion\w*|fier[ae]|festival)\b/,
    salvo: null,
    motivo: "Organizzazione di un evento, di un congresso o di una manifestazione: il servizio ne è una parte",
    casi: ["Concessione del servizio di organizzazione e gestione della decima edizione del congresso europeo di matematica, comprensivo di catering"],
  },
  {
    // trasporti: la ristorazione a bordo è accessoria se l'oggetto principale è il trasporto (viene prima)
    id: "trasporto_con_ristorazione",
    settori: ["ristorazione"],
    // non «navigazione» da sola: «servizio di navigazione nelle residenze e mense universitarie» è la connessione a internet (caso reale)
    cerca: /\b(trasporto (ferroviari\w*|passegger\w*|marittim\w*|aere\w*|turistic\w*)|navigazione (marittim\w*|lacustr\w*|fluvial\w*|laguna\w*|turistic\w*)|crocier\w*|traghett\w*|servizi\w* ferroviari\w*)\b/,
    salvo: null,
    motivo: "Servizio di trasporto che comprende la ristorazione a bordo: la ristorazione è accessoria",
    casi: ["Dialogo competitivo per servizio di trasporto ferroviario passeggeri a fini turistici, comprensivo di servizi di ristorazione a bordo"],
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
  {
    // noleggio, installazione, pulizia e manutenzione di bagni chimici (TED 5053404c, 60b1eef7, a4767661): la pulizia è affidata, ma dentro
    // il noleggio di servizi igienici mobili; correlata (B), da confermare
    id: "bagni_chimici",
    settori: ["pulizia"],
    cerca: /\b(bagn\w* (a funzionamento )?chimic\w*|wc chimic\w*|servizi igienici (mobili|chimici))\b/,
    salvo: null,
    motivo: "Noleggio e pulizia di bagni chimici: correlato alla pulizia, non pulizia degli ambienti",
    casi: ["Affidamento del servizio di fornitura, pulizia e manutenzione di bagni a funzionamento chimico per eventi"],
  },
  {
    // decisione dell'utente del 18/11 (ACEA Pinerolese, TED bf95cc0d): il servizio sostitutivo di mensa (buoni pasto, card o badge) è un
    // servizio correlato alla ristorazione collettiva, con la sua sottocategoria; mai A né C in automatico. Resta A se l'oggetto affida anche
    // una vera mensa o un servizio di ristorazione («servizio di mensa interno e servizio sostitutivo», «servizio di ristorazione,
    // sostitutivo della mensa»: casi reali di TED)
    id: "servizio_sostitutivo_mensa",
    settori: ["ristorazione"],
    cerca: /\b(servizi?o? sostitutiv\w* (di |della |del )?mens[ae]|buon[oi] pasto|ticket (restaurant|mensa|pasto))\b/,
    salvo: /\b(servizi?o?|gestion\w*) (di |della |delle |dei |del )?(mens[ae]|ristorazion\w*|refezion\w*|bar)\b/,
    // il CPV 30199770-8 (buoni pasto, usato anche da Consip) è un indizio, non è nel file approvato (decisione dell'utente del 18/11, D2)
    motivo:
      "Servizio sostitutivo di mensa o erogazione di buoni pasto (indizio anche il CPV 30199770-8, se indicato): un servizio correlato alla ristorazione collettiva, non la gestione di una mensa",
    casi: ["Procedura aperta per l'affidamento in appalto del servizio sostitutivo di mensa a favore del personale dipendente mediante l'utilizzo di badges elettronici"],
  },
  {
    // decisione dell'utente del 18/11 (case di soggiorno ex ENAM, TED 0baf7379): «A se il contenuto conferma veri servizi integrati del
    // settore». Il global service dei servizi di OSPITALITÀ (CPV degli alberghi nei lotti) o dei servizi SOCIO-SANITARI di una struttura
    // (TED c65ba31d, centro servizi anziani) non è facility management degli edifici: correlato (B)
    id: "global_service_di_altri_servizi",
    settori: ["multiservizi"],
    // l'oggetto del global service sono «servizi» o «attività» di ospitalità o socio-sanitari, non un aggettivo qualunque più avanti
    // («Facility Management Logistica Integrata … facility management sanitario», TED 1e649b29, resta facility management)
    // anche la gestione di una struttura per anziani («global service gestione casa anziani», TED edd7f211)
    cerca:
      /\b(global service|facility management)\b(.{0,60}\b(servizi|attivita) (di |del |della |dei |delle )?(ospitalit\w*|alberghier\w*|ricettiv\w*|socio\w*|sanitar\w*|assistenzial\w*|infermieristic\w*|educativ\w*)|( \w+){0,2} (gestione (della |del |di )?)?(casa (di riposo|anziani|albergo)|rsa|residenz\w* (sanitari\w*|assistenzial\w*|per anziani)|centr\w* servizi anziani))\b/,
    salvo: null,
    motivo: "Global service di servizi diversi dalla gestione degli edifici (ospitalità, servizi socio-sanitari): correlato, non facility management",
    casi: ["Affidamento della gestione con formula global service dei servizi di ospitalità delle case di soggiorno", "Affidamento in regime di global service dei servizi socio sanitari diurni e notturni del centro servizi anziani"],
  },
];

// Le correlazioni che, in ristorazione, portano alla sottocategoria «dentro appalti multiservizi e gestioni integrate»
const CORRELAZIONI_DI_GESTIONE = new Set(["gestione_integrata", "gestione_di_struttura", "servizi_alla_persona"]);
// Le correlazioni che valgono solo se vengono prima del servizio del settore nell'oggetto (vedi valutaSettore)
const CORRELAZIONI_DI_POSIZIONE = new Set([
  "gestione_integrata",
  "gestione_di_struttura",
  "servizi_alla_persona",
  "finanza_di_progetto",
  "videosorveglianza_mista",
  "organizzazione_eventi",
  "trasporto_con_ristorazione",
]);

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
    (r) =>
      vale(r, settore) &&
      (r.ancheConNucleo || !haNucleo) &&
      r.cerca.test(t) &&
      !(r.salvo && r.salvo.test(t)) &&
      !(r.salvoSeAffidato && affidamentoEsplicito(settore, r.salvoSeAffidato, t)) &&
      (!r.condizione || r.condizione(contesto)),
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

const MOTIVO_AFFIDATO = "Trovata per parola chiave: l'oggetto affida esplicitamente il servizio";
const MOTIVO_ACCESSORIO = "Il servizio è compreso come accessorio in un affidamento più ampio («comprensivo di», «con», «incluso», «altri servizi»)";
// decisione dell'utente del 18/11: una parola solo citata (riferimento, luogo, destinazione) è C, non B
const MOTIVO_CITATO = "L'oggetto cita il servizio (come riferimento, luogo o destinazione) ma non lo affida: una parola chiave da sola non basta";
const MOTIVO_COMPONENTE = "Il servizio è una componente di un servizio integrato di un'altra attività prevalente, senza CPV né lotto propri";
// S1, decisione dell'utente del 23/11 (49A)
const MOTIVO_IN_ELENCO = "Il servizio è una delle attività elencate come affidate in un appalto più ampio: correlata, non una semplice citazione";
// S3, decisione dell'utente del 23/11 (49A): «servizi integrati, gestionali ed operativi di manutenzione da eseguirsi presso gli immobili»
// (ASL Napoli 1, TED 69298aba). Servono il segnale dell'integrazione (servizi integrati, gestione integrata, global service, manutenzione
// integrata, multiservizi), la manutenzione e gli edifici: la manutenzione di apparecchiature, strade o centrali non è qui
const EDIFICI = "(immobil\\w*|edific\\w*|fabbricat\\w*|stabil[ei]|plessi|patrimonio (immobiliare|edilizio))";
const MANUTENZIONE_INTEGRATA_EDIFICI = new RegExp(
  `\\b((servizi\\w* integrat\\w*|gestione integrata|global service|multiservizi)( \\w+){0,8} manutenzion\\w*|manutenzion\\w* integrat\\w*)( \\w+){0,10} ${EDIFICI}\\b`,
);
const MOTIVO_MANUTENZIONE_INTEGRATA = "Manutenzione integrata di edifici e impianti: gestione degli edifici correlata al multiservizi, mai pertinente da sola";
// S2, decisione dell'utente del 23/11 (49A): «servizio di trasporto di opere d'arte» con, nella DESCRIZIONE, «comprensivo di imballaggio e
// disimballaggio, montaggio e smontaggio» (MANN, TED 566d9123). Solo quando la regola «trasporto_puro» escluderebbe la gara: un oggetto che
// nomina già la movimentazione non è mai «puro trasporto» (salvo della regola)
const MOVIMENTAZIONE_AFFIDATA = /\b(imballagg\w*|disimballagg\w*|montaggi\w*|smontaggi\w*|movimentazion\w*|facchinagg\w*|carico e scarico)\b/;
// la negazione vale anche per le voci coordinate dopo («escluso il montaggio e l'imballaggio»)
const NEGAZIONE_PRIMA = /\b(esclus\w*|senza|non (compres\w*|inclus\w*|comprend\w*))( \w+){0,5} $/;
const MOTIVO_TRASPORTO_CON_MOVIMENTAZIONE = "Trasporto con imballaggio, montaggio o movimentazione affidati (dalla descrizione dell'avviso): correlata al facchinaggio, non puro trasporto";

export function trasportoConMovimentazione(descrizione: string | null | undefined): boolean {
  const d = testoPerConfronto(descrizione);
  if (!/\btrasport\w*/.test(d)) return false;
  for (const m of d.matchAll(new RegExp(MOVIMENTAZIONE_AFFIDATA.source, "g"))) {
    if (!NEGAZIONE_PRIMA.test(d.slice(Math.max(0, (m.index ?? 0) - 60), m.index))) return true;
  }
  return false;
}

// Livello, sottocategorie, regole e motivi di un settore. Per le parole chiave conta come l'oggetto affida il servizio (fase B2b).
function valutaSettore(settore: SettoreRadar, t: string, contesto: ContestoCpv, da: "cpv" | "parole_chiave", affidamento: Affidamento | null = null, inElenco = false): Valutazione {
  const cpvDelSettore = da === "cpv" ? contesto.delSettore : [];
  const escluse = regoleDiEsclusione(settore, t, contesto);
  // una regola che «cede alle correlazioni» esclude solo se nessuna correlazione vale (vedi sotto: B invece di C)
  const escluseFerme = escluse.filter((r) => !r.cedeAlleCorrelazioni);
  if (escluseFerme.length) return valutazione(settore, "C", [], escluse.map((r) => ({ id: r.id, motivo: r.motivo })), da, cpvDelSettore);
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
    // servizio sostitutivo di mensa (decisione dell'utente del 18/11): solo la sua sottocategoria, non «mense»
    const sostitutivo = correlate.some((r) => r.id === "servizio_sostitutivo_mensa") ? ["servizi_sostitutivi_mensa"] : null;
    const sottocategorie = sostitutivo ?? (daTesto.length || diGestione.length ? [...daTesto, ...diGestione] : daCpv.length ? daCpv : [predefinita]);
    return valutazione(settore, "B", sottocategorie, correlate.map((r) => ({ id: r.id, motivo: r.motivo })), da, cpvDelSettore);
  }
  // nessuna correlazione: le regole che cedevano alle correlazioni escludono
  if (escluse.length) return valutazione(settore, "C", [], escluse.map((r) => ({ id: r.id, motivo: r.motivo })), da, cpvDelSettore);
  const haNucleo = !!t && !!nucleoDel(settore)?.test(t);
  const principale = contesto.principale ? MAPPA_CPV.get(contesto.principale) : undefined;
  const sottocategorie = daTesto.length ? daTesto : daCpv.length ? daCpv : [predefinita];
  // decisioni dell'utente del 17/11 (fase B2b) e del 18/11 (pacchetto 16): una parola chiave da sola non rende pertinente una gara. A se il
  // servizio è affidato come attività principale o autonoma (anche componente di un servizio integrato, se non c'è un CPV che dica
  // un'altra attività prevalente: vedi classificaSenzaLotti); B se è affidato ma accessorio; C se è soltanto citato
  if (da === "parole_chiave") {
    if (affidamento === "principale" || affidamento === "integrato") return valutazione(settore, "A", sottocategorie, [{ id: "parole_chiave", motivo: MOTIVO_AFFIDATO }], da, []);
    if (affidamento === "accessorio") return valutazione(settore, "B", sottocategorie, [{ id: "servizio_accessorio", motivo: MOTIVO_ACCESSORIO }], da, []);
    if (inElenco) return valutazione(settore, "B", sottocategorie, [{ id: "servizio_in_elenco", motivo: MOTIVO_IN_ELENCO }], da, []);
    return valutazione(settore, "C", [], [{ id: "parola_chiave_citata", motivo: MOTIVO_CITATO }], da, []);
  }
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
// «2026-11-17d»: pacchetto 15 (distributori automatici in A, 6 CPV di bar e ristoranti con la regola del contesto).
// «2026-11-17e»: la gestione integrata del solo bar, mensa o punto ristoro (anche in più sedi) resta del settore (Sintel, Treviglio).
// «2026-11-17f»: «chiosco» nomina il servizio nella regola del contesto, salvo edicola, giornali o fiori (Sintel, Taino).
// «2026-11-17g»: fase B2b. Parola chiave A solo con affidamento esplicito; servizi di altri settori affidati nell'oggetto; settori dai lotti;
// concessioni di ristoro per parola solo se affidate; connettività (ARDSU); «acquisto» tra le forniture; «servizi integrati di pulizia» non
// è multiservizi.
// «2026-11-18a»: decisioni dell'utente sul pacchetto 16. Parola solo citata C; nessuna regola dell'elenco (l'ordine non decide); componente
// di un servizio integrato senza CPV proprio B; CPV incoerente con l'oggetto C (non più B); servizio sostitutivo di mensa B con la sua
// sottocategoria; lavaggio di indumenti e vigilanza amministrativa C; global service di ospitalità B.
// «2026-11-18b»: «comprendente» introduce un servizio accessorio, e una testa coordinata a una testa accessoria è accessoria (gestione degli
// stabulari, TED 465af5a5: pulizia da A a B; segnalato dal coordinamento il 18/11).
// «2026-11-18c»: la pulizia di acque e coste (spiagge, arenili, alvei, specchi acquei) diventa una regola C con un motivo leggibile,
// «acque_e_coste», invece di un'esclusione delle parole chiave senza motivo; stessi casi, stessi numeri.
// «2026-11-18d»: decisioni dell'utente del 18/11 (pacchetto 16 aggiornato). D2: buoni pasto senza CPV del file valutati (B servizio, C
// «buoni_pasto_senza_servizio» per soli materiali o badge, A con una mensa vera). D3: «per alcune parti di …» è accessorio. D4:
// «acque_e_coste» vale anche con il CPV della pulizia, salvo la pulizia di edifici, locali e strutture.
// «2026-11-18e»: controllo del coordinamento sulla 18d. «parte/parti» è accessorio solo coordinato dopo un altro servizio affidato («e per
// alcune parti di»), non da solo («affidamento di parte del servizio di pulizia» resta A); il «salvo» di «acque_e_coste» vale anche per gli
// edifici coordinati («pulizia delle spiagge e dei servizi igienici»). Nessuna gara dell'archivio cambia rispetto alla 18d.
// «2026-11-23a»: decisione dell'utente del 23/11 sui quattro schemi del documento 49A (revisione delle gare C). S1: il servizio elencato tra
// le attività affidate è correlato (B «servizio_in_elenco»), non citato. S3: la manutenzione integrata di edifici e impianti è multiservizi
// B («manutenzione_integrata_edifici», gestione impianti), mai A da sola. S4: tre casi senza descrizione utile hanno l'etichetta «da
// verificare» (dato puro, nessuna riga cambia finché non si decide la rappresentazione). S2: trasporto con imballaggio, montaggio o
// movimentazione nella descrizione = facchinaggio B («trasporto_con_movimentazione»); vale solo con la descrizione nei dati (campo facoltativo
// «descrizione», che importatori e popolamento oggi non passano).
export const VERSIONE_REGOLE_SETTORI = "2026-11-23a";
const PREFISSO_CORREZIONE = "regole-settori-";

// Settore che le regole non vedono più (né i CPV né l'oggetto lo indicano, nessuna regola di esclusione): la regola della riga C e della
// correzione. Nome scelto insieme a B2 il 17/11 (fase B2b): «parole_chiave» sembrava la regola che rende pertinente una gara.
export const REGOLA_NON_RICONOSCIUTO = "non_riconosciuto";
export const MOTIVO_NON_RICONOSCIUTO = "Né i CPV né l'oggetto indicano più il settore";

// Identificativo della correzione nel registro: versione e regole («regole-settori-2026-11-17b:rifiuti»). Rifare la stessa correzione
// con le stesse regole non la duplica (chiave unica del registro). Senza regole di esclusione: «non_riconosciuto».
export function idFonteCorrezioneSettori(esclusioni: readonly Esclusione[]): string {
  const regole = [...new Set(esclusioni.map((e) => e.regola))].sort();
  return `${PREFISSO_CORREZIONE}${VERSIONE_REGOLE_SETTORI}:${regole.length ? regole.join("+") : REGOLA_NON_RICONOSCIUTO}`.slice(0, 200);
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
// Fase B2b: lo script unico di popolamento (di B2) può anche AGGIUNGERE settori. L'identificativo diventa
// «regole-settori-<versione>:<regole>:<esecuzione>»; il secondo pezzo restano le regole di esclusione («aggiunta» se la correzione aggiunge
// soltanto). Frasi: «abbiamo tolto la gara da: Y (motivi)», «abbiamo aggiunto la gara a: X», «abbiamo tolto la gara da: Y (motivi) e
// l'abbiamo aggiunta a: X»; poi «Resta in: …» se ha solo tolto, «Ora è in: …» se ha aggiunto.
export function descriviCorrezioneSettori(quando: string | null, valorePrecedente: string | null, valoreNuovo: string | null, idFonte: string | null): string {
  const prima = settoriDaValore(valorePrecedente);
  const dopo = settoriDaValore(valoreNuovo);
  const nomi = (l: readonly SettoreRadar[]) => l.map((s) => nomeSettore(s).toLowerCase()).join(", ");
  const tolti = prima.filter((s) => !dopo.includes(s));
  const aggiunti = dopo.filter((s) => !prima.includes(s));
  const regole = (idFonte ?? "").startsWith(PREFISSO_CORREZIONE) ? (idFonte ?? "").split(":")[1]?.split("+") ?? [] : [];
  const motivi = [
    ...new Set(regole.map((r) => (r === REGOLA_NON_RICONOSCIUTO ? MOTIVO_NON_RICONOSCIUTO : ESCLUSIONI_OGGETTO.find((e) => e.id === r)?.motivo)).filter((m): m is string => !!m)),
  ];
  const perche = motivi.length ? ` (${motivi.join("; ")})` : "";
  const cosa =
    tolti.length && aggiunti.length
      ? `abbiamo tolto la gara da: ${nomi(tolti)}${perche} e l'abbiamo aggiunta a: ${nomi(aggiunti)}`
      : tolti.length
        ? `abbiamo tolto la gara da: ${nomi(tolti)}${perche}`
        : aggiunti.length
          ? `abbiamo aggiunto la gara a: ${nomi(aggiunti)}`
          : `abbiamo corretto i settori della gara${perche}`;
  const resta = dopo.length ? `${aggiunti.length ? "Ora è in" : "Resta in"}: ${nomi(dopo)}.` : "Resta consultabile nell'archivio.";
  return `${quando ? `Il ${quando} ` : ""}${quando ? cosa : cosa.charAt(0).toUpperCase() + cosa.slice(1)}. ${resta}`;
}

// Concessioni di bar, caffetterie, ristoranti, punti ristoro, distributori automatici e chioschi (fase B2b): senza un CPV del file entrano
// per parola, ma SOLO se l'oggetto le affida («concessione del servizio bar», «gestione del punto ristoro»), mai se le cita soltanto. Il
// chiosco NO: per decisione dell'utente del 17/11 vale solo con uno dei 6 CPV di bar e ristoranti (regola del contesto).
const PAROLE_DELLE_CONCESSIONI = /\b(bar|caffetteri\w*|ristorant\w*|punt\w* (di )?ristoro|distributor\w* automatic\w*|distribuzione automatica|vending)\b/;
// buoni pasto e servizio sostitutivo di mensa (decisione dell'utente del 18/11, D2): la ristorazione si valuta anche senza CPV del file
const BUONI_PASTO = /\b(buon[oi] pasto|ticket (restaurant|mensa|pasto)|ticket\w* (per (la |il )?)?mens[ae]|servizi?o? sostitutiv\w* (di |della |del )?mens[ae])\b/;
function concessioneDiRistoro(t: string): boolean {
  return PAROLE_DELLE_CONCESSIONI.test(t);
}

// Le parole che nominano il servizio del settore, per riconoscere l'affidamento esplicito: quelle approvate (REGOLE_PAROLE) e, per la
// ristorazione, anche le concessioni.
function paroleDelServizio(settore: SettoreRadar): RegExp {
  const nucleo = nucleoDel(settore) ?? /$^/;
  return settore === "ristorazione" ? new RegExp(`${nucleo.source}|${PAROLE_DELLE_CONCESSIONI.source}`) : nucleo;
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
  // S4 (23/11): solo per una gara senza A né B, i casi senza descrizione utile da far decidere a un amministratore. Il campo c'è solo se non
  // è vuoto (le classificazioni di sempre restano identiche)
  daVerificare?: DaVerificare[];
};

// S4 (decisione dell'utente del 23/11, documento 49A): casi senza una descrizione utile. Né C né B in automatico, ma un'etichetta «da
// verificare» con la decisione a mano dell'amministratore in console. Qui c'è solo il DATO, puro: come rappresentarlo nel database (le
// righe della 0121 ammettono solo A, B e C) è da decidere con il coordinamento; finché non c'è, la riga resta quella calcolata (C) e nessuna
// gara cambia. Tre casi, quelli del 49A:
//   - concessione di un immobile con un CPV di ristorazione e nessuna descrizione del servizio (casone «Paduli», Comune di Accadia);
//   - appalto misto per stabulari con «pulizie» tra le attività (Università di Torino: pulizia dei locali o cura degli animali?);
//   - servizi di biblioteca senza descrizione (Università di Chieti: apertura, accoglienza e custodia delle sale = correlata di portierato?).
export type DaVerificare = {
  settore: SettoreRadar;
  caso: "immobile_con_cpv_ristorazione" | "stabulari" | "biblioteca";
  regola: "da_verificare";
  motivo: string;
};

const CONCESSIONE_DI_IMMOBILE = /\bconcession\w* (in gestione |in uso |d uso )?(del|dello|della|dell|di) (casone|stabile|immobil\w*|fabbricat\w*|local\w*|rifugi\w*|compendio)\b/;
const STABULARI = /\b(stabular\w*|stabiliment\w* utilizzator\w*|animal\w* (da |per )?(laboratorio|sperimentazion\w*|ricerca))\b/;
const BIBLIOTECA = /\b(servizi\w* (integrat\w* )?(di |della |delle |dei )?bibliotec\w*|servizi\w* bibliotecar\w*|gestione (della |delle |dei )?bibliotec\w*)\b/;

// Si chiama solo per una gara senza A né B (ultimo ritorno di classificaSenzaLotti: tutte le valutazioni sono C o non ce ne sono)
// I motivi dei tre casi S4, uno per caso e tutti diversi (B2, 23/11, testo INVARIATO): così il caso si ricava dal motivo scritto nella riga
// «da_verificare» (casoDaRigaDaVerificare in classificazioni-calcoli.ts) senza dipendere dal settore candidato.
export const MOTIVI_DA_VERIFICARE: Readonly<Record<DaVerificare["caso"], string>> = {
  immobile_con_cpv_ristorazione: "Concessione di un immobile con un CPV di ristorazione, senza una descrizione del servizio: da verificare sull'avviso (punto ristoro o solo immobile)",
  stabulari: "Appalto misto per stabulari con le «pulizie» tra le attività: da verificare nei documenti (pulizia dei locali o cura degli animali)",
  biblioteca: "Servizi di biblioteca senza descrizione: da verificare se comprendono apertura, accoglienza e custodia delle sale (correlata di portierato)",
};

function casiDaVerificare(t: string, valutazioni: readonly Valutazione[], settoriDeiCpv: readonly SettoreRadar[]): DaVerificare[] {
  if (!t) return [];
  const esclusaDa = (s: SettoreRadar, regola: string) => valutazioni.some((v) => v.settore === s && v.livello === "C" && v.regole.includes(regola));
  const out: DaVerificare[] = [];
  if (esclusaDa("ristorazione", "concessione_di_immobili") && settoriDeiCpv.includes("ristorazione") && CONCESSIONE_DI_IMMOBILE.test(t)) {
    out.push({ settore: "ristorazione", caso: "immobile_con_cpv_ristorazione", regola: "da_verificare", motivo: MOTIVI_DA_VERIFICARE.immobile_con_cpv_ristorazione });
  }
  if (esclusaDa("pulizia", "cura_degli_animali") && STABULARI.test(t) && /\bpulizi\w*/.test(t)) {
    out.push({ settore: "pulizia", caso: "stabulari", regola: "da_verificare", motivo: MOTIVI_DA_VERIFICARE.stabulari });
  }
  if (BIBLIOTECA.test(t) && !valutazioni.some((v) => v.settore === "vigilanza_portierato")) {
    out.push({ settore: "vigilanza_portierato", caso: "biblioteca", regola: "da_verificare", motivo: MOTIVI_DA_VERIFICARE.biblioteca });
  }
  return out;
}

function livelloMigliore(v: readonly Valutazione[]): Livello | null {
  return v.some((x) => x.livello === "A") ? "A" : v.some((x) => x.livello === "B") ? "B" : v.length ? "C" : null;
}

export type DatiGara = {
  cpvPrincipale?: string | null;
  cpvTutti?: readonly (string | null | undefined)[];
  // oggetto della gara e dei lotti, insieme (come oggi)
  testo?: string | null;
  // FACOLTATIVO (17/11): i lotti, con oggetto e CPV di ciascuno. Con due o più lotti, un lotto che da solo è pertinente per un settore
  // rende quel settore AUTONOMO nella gara: A invece di B (per esempio un lotto «servizi di catering» in un appalto di eventi). Senza i
  // lotti il risultato non cambia
  lotti?: readonly { testo?: string | null; cpv?: readonly (string | null | undefined)[] }[];
  // FACOLTATIVA (23/11, S2): la descrizione dell'avviso. La usa SOLO la regola S2 (trasporto con imballaggio, montaggio o movimentazione =
  // facchinaggio B): non riconosce settori e non alza altri livelli. Senza la descrizione il risultato non cambia
  descrizione?: string | null;
};

const MOTIVO_LOTTO_AUTONOMO = "Un lotto della gara è dedicato al servizio del settore: è autonomo, non accessorio";
const MOTIVO_LOTTO_ACCESSORIO = "Un lotto della gara comprende il servizio del settore dentro un affidamento più ampio";
const REGOLE_DI_TUTTA_LA_PROCEDURA = new Set(["concessione_demaniale", "concessione_di_immobili"]);

// Con due o più lotti ogni lotto si valuta anche da solo (fase B2b, «soprattutto le opportunità contenute nei singoli lotti»):
//   - un lotto pertinente (A) rende il settore A nella gara («lotto autonomo»), anche se la gara nel suo insieme lo vedeva correlato (B) o
//     escluso (C: «lavori … lotto 2 servizio di pulizia») o non lo vedeva affatto;
//   - un lotto correlato (B) aggiunge il settore come B, se la gara non lo aveva.
// Un lotto da solo è un intero affidamento: le regole sono le stesse della gara (una fornitura resta una fornitura, una parola citata resta
// una citazione). Con un solo lotto il lotto è la gara: nulla cambia.
export function classificaGara(dati: DatiGara): Classificazione {
  const c = classificaSenzaLotti(dati);
  const lotti = dati.lotti ?? [];
  if (lotti.length < 2) return c;
  const perLotto = lotti.map((l) => classificaSenzaLotti({ cpvPrincipale: l.cpv?.[0] ?? null, cpvTutti: l.cpv ?? [], testo: l.testo ?? null }));
  const nelLotto = (s: SettoreRadar, livello: Livello) => perLotto.map((p) => p.valutazioni.find((x) => x.settore === s && x.livello === livello)).find((x) => !!x);
  let cambiate = false;
  const valutazioni = c.valutazioni.map((v) => {
    if (v.livello === "A") return v;
    // una regola che riguarda tutta la procedura vale per ogni lotto, anche se il testo del lotto è troppo corto per dirlo («concessione
    // demaniale marittima … due compendi/lotti» con i lotti «Bar interno» e «Bar esterno», TED 352f212b)
    if (v.regole.some((r) => REGOLE_DI_TUTTA_LA_PROCEDURA.has(r))) return v;
    const lotto = nelLotto(v.settore, "A");
    if (!lotto) return v;
    cambiate = true;
    const sottocategorie = [...lotto.sottocategorie, ...v.sottocategorie.filter((s) => s !== "appalti_multiservizi")];
    // da B le regole della gara restano come spiegazione; da C l'esclusione della gara non vale per il lotto dedicato
    const regole = [{ id: "lotto_autonomo", motivo: MOTIVO_LOTTO_AUTONOMO }, ...(v.livello === "B" ? v.regole.map((id, i) => ({ id, motivo: v.motivi[i] ?? "" })) : [])];
    return valutazione(v.settore, "A", sottocategorie, regole, v.da, v.cpv.length ? v.cpv : lotto.cpv);
  });
  const nuove: Valutazione[] = [];
  for (const { id: s } of SETTORI_RADAR) {
    if (valutazioni.some((v) => v.settore === s)) continue;
    const a = nelLotto(s, "A");
    const x = a ?? nelLotto(s, "B");
    if (!x) continue;
    const regole = a ? [{ id: "lotto_autonomo", motivo: MOTIVO_LOTTO_AUTONOMO }] : [{ id: "lotto_accessorio", motivo: MOTIVO_LOTTO_ACCESSORIO }, ...x.regole.map((id, i) => ({ id, motivo: x.motivi[i] ?? "" }))];
    nuove.push(valutazione(s, x.livello, x.sottocategorie, regole, x.da, x.cpv));
  }
  if (!cambiate && !nuove.length) return c;
  const tutte = [...valutazioni, ...nuove];
  const settori = tutte.filter((v) => v.livello !== "C").map((v) => v.settore);
  const cpvNuovi = [...new Set(tutte.filter((v) => v.livello !== "C" && !c.settori.includes(v.settore)).flatMap((v) => v.cpv))];
  // S4: un lotto che rende la gara pertinente toglie l'etichetta «da verificare» (vale solo per le gare senza A né B)
  const { daVerificare, ...resto } = c;
  return {
    ...resto,
    ...(daVerificare && !settori.length ? { daVerificare } : {}),
    settori,
    settorePrincipale: c.settorePrincipale && settori.includes(c.settorePrincipale) ? c.settorePrincipale : (tutte.find((v) => v.livello === "A")?.settore ?? settori[0] ?? null),
    metodo: c.metodo ?? (settori.length ? (tutte.find((v) => v.livello !== "C")?.da ?? null) : null),
    motivi: [...c.motivi, ...tutte.filter((v) => v.livello !== "C" && !c.settori.includes(v.settore)).map((v) => `Trovata in un lotto: ${nomeSettore(v.settore).toLowerCase()}`)],
    cpvRiconosciuti: [...new Set([...c.cpvRiconosciuti, ...cpvNuovi])],
    valutazioni: tutte,
    livello: livelloMigliore(tutte),
    esclusioni: c.esclusioni.filter((e) => !settori.includes(e.settore)),
  };
}

function classificaSenzaLotti(dati: DatiGara): Classificazione {
  const principale = normalizzaCpv(dati.cpvPrincipale);
  const tutti = [...new Set([principale, ...(dati.cpvTutti ?? []).map(normalizzaCpv)].filter((c): c is string => !!c))];
  const voci = tutti.map((c) => MAPPA_CPV.get(c)).filter((v): v is VoceCpv => !!v);
  const t = testoPerConfronto(dati.testo);
  const settoriParole = settoriDaParole(dati.testo);
  // concessioni di bar, ristoranti, punti ristoro, distributori e chioschi senza CPV del file: entrano per parola SOLO se affidate (fase B2b)
  if (!settoriParole.includes("ristorazione") && concessioneDiRistoro(t) && !(PAROLE_INFORMATICHE.test(t) && !SERVIZIO_ESPLICITO.test(t)) && affidamentoEsplicito("ristorazione", paroleDelServizio("ristorazione"), dati.testo)) {
    settoriParole.push("ristorazione");
  }
  // buoni pasto e servizio sostitutivo di mensa senza CPV del file (decisione dell'utente del 18/11, D2): la ristorazione si valuta, e
  // decidono le regole: B se è affidato il servizio, C se solo materiali o badge, A se c'è anche una mensa vera
  if (!settoriParole.includes("ristorazione") && BUONI_PASTO.test(t)) settoriParole.push("ristorazione");
  const affidamento = (s: SettoreRadar) => affidamentoEsplicito(s, paroleDelServizio(s), dati.testo);
  const contesto = (s: SettoreRadar): ContestoCpv => ({ principale, tutti, delSettore: voci.filter((v) => v.settore === s).map((v) => v.cpv) });

  const valutazioniCpv = [...new Set(voci.map((v) => v.settore))].map((s) => valutaSettore(s, t, contesto(s), "cpv"));
  // S2 (23/11): «puro trasporto» per l'oggetto, ma la descrizione affida anche imballaggio, montaggio o movimentazione → facchinaggio B
  const trasporto = valutazioniCpv.findIndex((v) => v.settore === "facchinaggio" && v.livello === "C" && v.regole.length === 1 && v.regole[0] === "trasporto_puro");
  if (trasporto >= 0 && trasportoConMovimentazione(dati.descrizione)) {
    valutazioniCpv[trasporto] = valutazione("facchinaggio", "B", ["facchinaggio_movimentazione"], [{ id: "trasporto_con_movimentazione", motivo: MOTIVO_TRASPORTO_CON_MOVIMENTAZIONE }], "cpv", valutazioniCpv[trasporto].cpv);
  }
  const esclusioni: Esclusione[] = valutazioniCpv.filter((v) => v.livello === "C").map((v) => ({ settore: v.settore, regola: v.regola, motivo: v.motivo }));
  const tenute = valutazioniCpv.filter((v) => v.livello !== "C");

  if (tenute.length > 0) {
    const valutazioni = [...valutazioniCpv];
    // fase B2b: i servizi di altri settori che l'oggetto AFFIDA si aggiungono, anche all'ausiliariato che non ha CPV: A se affidati, B se
    // accessori. Le sole citazioni no («pulizia … per il servizio ristorazione»). Casi reali dell'archivio dello staging, 17/11/2026:
    // «pulizie e guardiania edifici comunali», «servizio di pulizia … nonché del servizio di receptionist/portierato», «concessione del bar
    // e del parcheggio … con effettuazione del servizio di pulizia e guardiania» (Università di Sassari: B)
    const aggiunte: Valutazione[] = [];
    for (const s of settoriParole) {
      if (valutazioni.some((v) => v.settore === s)) continue;
      const a = affidamento(s);
      if (!a) continue;
      const v = valutaSettore(s, t, contesto(s), "parole_chiave", a);
      if (v.livello === "C") continue;
      // componente di un servizio integrato, senza un CPV proprio: il CPV della gara dice un'altra attività prevalente, quindi è accessoria
      // (B). Decisione dell'utente del 18/11 sul teatro di Monfalcone («valuta l'autonomia effettiva della conduzione del bar»). Non per il
      // multiservizi, che è proprio il servizio integrato
      if (a === "integrato" && v.livello === "A" && s !== "multiservizi") {
        aggiunte.push(valutazione(s, "B", v.sottocategorie, [{ id: "componente_di_servizio_integrato", motivo: MOTIVO_COMPONENTE }], "parole_chiave", []));
      } else aggiunte.push(v);
    }
    valutazioni.push(...aggiunte);
    // CPV incoerente con l'oggetto (decisione dell'utente del 18/11): l'oggetto affida il servizio di un altro settore e non nomina mai quello
    // del CPV («servizio di vigilanza e portierato … Ferrovienord» con il CPV della pulizia). Nessun B automatico: il settore del CPV è C, e
    // il CPV discordante resta nel motivo. Non per il multiservizi, che comprende gli altri servizi («servizi integrati presso le sezioni
    // dell'INGV» con il CPV della pulizia); se l'oggetto nomina anche il servizio del CPV, valgono le regole di sempre
    if (aggiunte.some((v) => v.livello === "A" && v.settore !== "multiservizi")) {
      for (let x = 0; x < valutazioni.length; x++) {
        const v = valutazioni[x];
        if (v.da !== "cpv" || v.livello !== "A" || v.regole.includes("oggetto")) continue;
        const voce = MAPPA_CPV.get(v.cpv[0] ?? "");
        const altri = aggiunte.filter((y) => y.livello === "A" && y.settore !== "multiservizi").map((y) => nomeSettore(y.settore).toLowerCase());
        const motivo = `Il CPV ${voce ? `${voce.cpv} ${voce.descrizione}` : v.cpv.join(", ")} è del settore, ma l'oggetto affida solo ${altri.join(", ")} e non nomina alcuna attività di questo settore`;
        valutazioni[x] = valutazione(v.settore, "C", [], [{ id: "cpv_non_confermato", motivo }], "cpv", v.cpv);
      }
    }
    const settori = valutazioni.filter((v) => v.livello !== "C").map((v) => v.settore);
    const vociTenute = voci.filter((v) => settori.includes(v.settore));
    const motivi = vociTenute.map((v) => `CPV ${v.cpv} ${v.descrizione}`);
    for (const v of aggiunte) motivi.push(v.settore === "ausiliariato" ? "Oggetto che parla di ausiliariato" : `Trovata per parola chiave: ${nomeSettore(v.settore).toLowerCase()}`);
    const sp = principale ? MAPPA_CPV.get(principale)?.settore : undefined;
    return {
      versione: VERSIONE_REGOLE_SETTORI,
      settori,
      settorePrincipale: sp && settori.includes(sp) ? sp : (valutazioni.find((v) => v.livello === "A")?.settore ?? settori[0]),
      // se nessun settore del CPV resta, i settori vengono dalle parole chiave
      metodo: vociTenute.length ? "cpv" : "parole_chiave",
      motivi,
      cpvRiconosciuti: vociTenute.map((v) => v.cpv),
      valutazioni,
      livello: livelloMigliore(valutazioni),
      esclusioni: valutazioni.filter((v) => v.livello === "C").map((v) => ({ settore: v.settore, regola: v.regola, motivo: v.motivo })),
    };
  }

  // nessun CPV del file, oppure tutti i loro settori esclusi dall'oggetto: decidono le parole chiave, come per ogni altra gara
  // i settori che il CPV ha già escluso (C) non si rivalutano per parola: la stessa esclusione vale anche lì
  const daParole = settoriParole.filter((s) => !valutazioniCpv.some((v) => v.settore === s));
  const valutazioniParole =
    daParole.length > 0 && !cpvSoloDiAltriMestieri(tutti)
      ? daParole.map((s) => {
          const a = affidamento(s);
          // S1: una parola non affidata ma elencata tra le attività affidate è correlata (B), non citata (C)
          return valutaSettore(s, t, contesto(s), "parole_chiave", a, !a && servizioInElenco(s, dati.testo));
        })
      : [];
  // S3 (decisione dell'utente del 23/11, 49A): la manutenzione integrata di edifici e impianti è multiservizi B («gestione impianti»), mai A
  // da sola; solo se il multiservizi non è già valutato dal CPV o dalle parole chiave (le sue esclusioni restano)
  if (!cpvSoloDiAltriMestieri(tutti) && ![...valutazioniCpv, ...valutazioniParole].some((v) => v.settore === "multiservizi") && MANUTENZIONE_INTEGRATA_EDIFICI.test(t)) {
    valutazioniParole.push(valutazione("multiservizi", "B", ["gestione_impianti"], [{ id: "manutenzione_integrata_edifici", motivo: MOTIVO_MANUTENZIONE_INTEGRATA }], "parole_chiave", []));
  }
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

  const daVerificare = casiDaVerificare(t, valutazioni, voci.map((v) => v.settore));
  return {
    versione: VERSIONE_REGOLE_SETTORI,
    settori: [],
    settorePrincipale: null,
    metodo: null,
    motivi: [],
    cpvRiconosciuti: [],
    valutazioni,
    livello: livelloMigliore(valutazioni),
    esclusioni: tutteLeEsclusioni,
    ...(daVerificare.length ? { daVerificare } : {}),
  };
}
