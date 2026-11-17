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

type RegolaParole = { settore: SettoreRadar; cerca: RegExp; escludi: RegExp | null; esempio: string };

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
    escludi: /\b(videosorveglianza|impiant\w*|manutenzion\w*|attraversament\w*|scuolabus)\b/,
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

export function settoriDaParole(testo: string | null | undefined): SettoreRadar[] {
  const t = testoPerConfronto(testo);
  if (!t) return [];
  return REGOLE_PAROLE.filter((r) => r.cerca.test(t) && !(r.escludi && r.escludi.test(t))).map((r) => r.settore);
}

// ───── esclusioni per oggetto (qualità delle gare, 17/11/2026) ─────

// I CPV del file approvato dicono il mestiere in modo largo («Servizi di ristorazione scolastica», «Servizi di gestione impianti», «Servizi
// di accoglienza»), e le stazioni appaltanti li usano anche per gare di altri mestieri: il bar della scuola, il mattatoio comunale,
// l'accoglienza dei richiedenti asilo. Queste regole tolgono il settore quando l'OGGETTO dice chiaramente un altro mestiere.
// Due salvaguardie: (1) mai se l'oggetto nomina il servizio del settore con le sue parole approvate (la «cerca» di REGOLE_PAROLE: «bar e
// mensa» resta ristorazione, «facchinaggio dei RAEE» resta facchinaggio); (2) la «salvo» della regola, per i casi vicini al settore.
// Ogni regola nasce da casi reali (le 8 gare PVL dubbie e l'archivio dello staging del 17/11/2026, in «casi»), e il test le prova tutte.
export type RegolaEsclusione = { id: string; settori: readonly SettoreRadar[] | "tutti"; cerca: RegExp; salvo: RegExp | null; motivo: string; casi: readonly string[] };

export const ESCLUSIONI_OGGETTO: readonly RegolaEsclusione[] = [
  {
    id: "ristorazione_commerciale",
    settori: ["ristorazione"],
    cerca: /\b(bar|caffetteri\w*|chiosc\w*|ristorant\w*|pizzeri\w*|enotec\w*|ristoro|locanda|food beverage|somministrazione al pubblico|esercizi\w* di somministrazione)\b/,
    salvo: /\b(pranz\w*|catering|cottura|aziendal\w*|degent\w*)\b/,
    motivo: "Bar, ristorante o punto ristoro in concessione: non è ristorazione collettiva",
    casi: [
      "Affidamento della gestione del servizio di: n. 1 punto ristoro, n. 2 punti ristoro volanti e n. 6 distributori automatici di bevande calde/fredde e snack",
      "Concessione dei servizi bar – caffetteria presso i Presidi Ospedalieri di San Donà di Piave e Portogruaro",
      "Affidamento in concessione del servizio di gestione del ristorante del museo MAXXI",
    ],
  },
  {
    id: "distribuzione_automatica",
    settori: ["ristorazione"],
    cerca: /\b(distributor\w* automatic\w*|distribuzione automatica|vending)\b/,
    salvo: /\b(pranz\w*|catering|cottura|aziendal\w*|degent\w*)\b/,
    motivo: "Distributori automatici di bevande e alimenti: non è ristorazione collettiva",
    casi: ["Servizio di somministrazione di bevande e alimenti tramite distributori automatici"],
  },
  {
    id: "prodotti_da_banco",
    settori: ["ristorazione"],
    cerca: /\b(panin\w*|prodotti da forno|pizza|snack|merend\w*)\b/,
    salvo: /\b(pranz\w*|catering|cottura|aziendal\w*|degent\w*)\b/,
    motivo: "Vendita o fornitura di panini, pizza o merende: non è un servizio di ristorazione collettiva",
    casi: ["Affidamento in concessione del servizio di distribuzione di panini e prodotti da forno", "Fornitura pizza scuole Betti"],
  },
  {
    id: "concessione_di_immobili",
    settori: ["ristorazione"],
    cerca:
      /\b(concession\w* demanial\w*|demanio marittimo|turistic\w* ricreativ\w*|suolo pubblico|compendio immobiliare|local\w* denominat\w*|concession\w* (in gestione |in uso |d uso )?(del|dello|della|dell|di) (casone|stabile|immobil\w*|fabbricat\w*|local\w*|rifugi\w*|compendio))\b/,
    // non «demaniale» da solo: «centro di accoglienza … presso la struttura demaniale» è un'altra cosa (caso reale di TED, 17/11/2026)
    salvo: null,
    motivo: "Concessione di un immobile, di un'area demaniale o di suolo pubblico: non è ristorazione collettiva",
    casi: ["Affidamento in concessione del casone “Paduli” per la durata di sette anni", "Assentimento di n. 6 concessioni demaniali marittime ad uso commerciale, ludico, turistico ricreativo"],
  },
  {
    id: "accoglienza_sociale",
    settori: ["vigilanza_portierato"],
    cerca: /\b(sai|richiedent\w*|protezione internazionale|stranier\w*|msna|migrant\w*|mediator\w* cultural\w*|terzo settore|accoglienza integrata)\b/,
    salvo: null,
    motivo: "Accoglienza di richiedenti asilo o di stranieri (servizi sociali): non è l'accoglienza della portineria",
    casi: ["Affidamento della gestione del servizio di accoglienza integrata (SAI) - categoria minori stranieri non accompagnati (MSNA)", "Servizio mediatori culturali"],
  },
  {
    id: "impianti_sportivi",
    settori: "tutti",
    cerca: /^(?=.*\b(concession\w*|gestion\w*)\b)(?=.*\b(impiant\w* sportiv\w*|piscin\w*|centr\w* natator\w*|palazzett\w* dello sport)\b)/,
    // «servizio di custodia, sicurezza e pulizia degli impianti sportivi» resta vigilanza (caso reale di TED, 17/11/2026)
    salvo: /\b(front office|back office|segreteri\w*|reception|custodi\w*|sicurezza|sorveglianz\w*|guardian\w*)\b/,
    motivo: "Gestione di un impianto sportivo o di una piscina: è un altro mestiere",
    casi: ["Concessione in gestione dell'impianto sportivo comunale di via Monsignor Peluso", "Affidamento del servizio in concessione della gestione dell'impianto e manutenzione della piscina comunale coperta"],
  },
  {
    id: "rifiuti",
    settori: "tutti",
    cerca: /\b(rifiut\w*|raee|igiene urbana|raccolta differenziata|raccolta e trasporto)\b/,
    salvo: null,
    motivo: "Raccolta, trasporto o smaltimento di rifiuti: è un altro mestiere (igiene urbana)",
    casi: ["Gara europea a procedura aperta per il servizio di raccolta e gestione di rifiuti assimilabili", "Servizio di raccolta e trasporto dei RU classificato come «verde»"],
  },
  {
    id: "mobilita_e_sanzioni",
    settori: "tutti",
    cerca: /\b(ztl|zona a traffico limitato|zone a traffico limitato|last mile|logistica urbana|sanzionator\w*|infrazion\w*|codice della strada)\b/,
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
    // basta che l'oggetto parli di servizi: «fornitura di servizi di catering», «fornitura di beni ed erogazione servizi di accoglienza»
    // restano come sono (casi reali di TED, 17/11/2026)
    salvo: /\b(serviz\w*|catering)\b/,
    motivo: "Fornitura di beni: non è un servizio del settore",
    casi: [
      "Fornitura di derrate alimentari sostenibili per la ristorazione delle mense universitarie a gestione diretta",
      "Accordo quadro avente ad oggetto la fornitura di quotidiani e periodici cartacei e relativa distribuzione",
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
    id: "telecamere",
    settori: ["vigilanza_portierato"],
    cerca: /\b(telecamer\w*|fototrappol\w*)\b/,
    salvo: null,
    motivo: "Installazione e gestione di telecamere o fototrappole: è un servizio tecnologico, non vigilanza",
    casi: ["Servizio di installazione, puntamento, disinstallazione telecamere mobili e analisi flussi video"],
  },
];

export type Esclusione = { settore: SettoreRadar; regola: string; motivo: string };

// Versione delle regole: si cambia a ogni modifica di REGOLE_PAROLE o ESCLUSIONI_OGGETTO. Accompagna ogni correzione dei settori di una
// gara già in archivio (registro dei cambiamenti, «correzione_dati» sul campo «settori»), così ogni correzione dice con quali regole è stata
// fatta e si può annullare.
export const VERSIONE_REGOLE_SETTORI = "2026-11-17";
const PREFISSO_CORREZIONE = "regole-settori-";

// Identificativo della correzione nel registro: versione e regole («regole-settori-2026-11-17:ristorazione_commerciale»). Rifare la stessa
// correzione con le stesse regole non la duplica (chiave unica del registro).
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

// I settori (venuti dai CPV) che l'oggetto esclude, con la prima regola che li esclude. Testo già normalizzato con testoPerConfronto.
export function esclusioniOggetto(testoNormalizzato: string, settori: readonly SettoreRadar[]): Esclusione[] {
  if (!testoNormalizzato) return [];
  const out: Esclusione[] = [];
  for (const settore of settori) {
    const nucleo = REGOLE_PAROLE.find((r) => r.settore === settore)?.cerca;
    if (nucleo && nucleo.test(testoNormalizzato)) continue;
    const regola = ESCLUSIONI_OGGETTO.find(
      (r) => (r.settori === "tutti" || r.settori.includes(settore)) && r.cerca.test(testoNormalizzato) && !(r.salvo && r.salvo.test(testoNormalizzato)),
    );
    if (regola) out.push({ settore, regola: regola.id, motivo: regola.motivo });
  }
  return out;
}

// ───── classificazione di una gara ─────

export type Classificazione = {
  settori: SettoreRadar[];
  // settore principale: quello del CPV principale se è nel file, altrimenti il primo trovato
  settorePrincipale: SettoreRadar | null;
  metodo: "cpv" | "parole_chiave" | null;
  // un motivo per settore, in parole semplici («CPV 90919200 Servizi di pulizia di uffici»)
  motivi: string[];
  cpvRiconosciuti: string[];
  // i settori dei CPV tolti perché l'oggetto dice un altro mestiere, con la regola e il motivo (esclusione, non cancellazione)
  esclusioni: Esclusione[];
};

export function classificaGara(dati: { cpvPrincipale?: string | null; cpvTutti?: readonly (string | null | undefined)[]; testo?: string | null }): Classificazione {
  const principale = normalizzaCpv(dati.cpvPrincipale);
  const tutti = [...new Set([principale, ...(dati.cpvTutti ?? []).map(normalizzaCpv)].filter((c): c is string => !!c))];
  const voci = tutti.map((c) => MAPPA_CPV.get(c)).filter((v): v is VoceCpv => !!v);
  const settoriParole = settoriDaParole(dati.testo);
  // i settori dei CPV che l'oggetto esclude (le parole chiave no: chi le contiene ha già il «nucleo» del settore e non si esclude mai)
  const esclusioni = esclusioniOggetto(testoPerConfronto(dati.testo), [...new Set(voci.map((v) => v.settore))]);
  const esclusi = new Set(esclusioni.map((e) => e.settore));
  const vociTenute = voci.filter((v) => !esclusi.has(v.settore));

  if (vociTenute.length > 0) {
    const settori = [...new Set(vociTenute.map((v) => v.settore))];
    // l'ausiliariato non ha CPV: se le parole lo indicano si aggiunge, con il suo motivo
    const conAusiliariato = settoriParole.includes("ausiliariato") && !settori.includes("ausiliariato") ? [...settori, "ausiliariato" as const] : settori;
    const vocePrincipale = principale ? MAPPA_CPV.get(principale) : undefined;
    const motivi = vociTenute.map((v) => `CPV ${v.cpv} ${v.descrizione}`);
    if (conAusiliariato.length > settori.length) motivi.push("Oggetto che parla di ausiliariato");
    return {
      settori: conAusiliariato,
      settorePrincipale: vocePrincipale && !esclusi.has(vocePrincipale.settore) ? vocePrincipale.settore : conAusiliariato[0],
      metodo: "cpv",
      motivi,
      cpvRiconosciuti: vociTenute.map((v) => v.cpv),
      esclusioni,
    };
  }

  // nessun CPV del file, oppure tutti i loro settori esclusi dall'oggetto: decidono le parole chiave, come per ogni altra gara
  if (settoriParole.length > 0 && !cpvSoloDiAltriMestieri(tutti)) {
    return {
      settori: settoriParole,
      settorePrincipale: settoriParole[0],
      metodo: "parole_chiave",
      motivi: settoriParole.map((s) => `Trovata per parola chiave: ${nomeSettore(s).toLowerCase()}`),
      cpvRiconosciuti: [],
      esclusioni,
    };
  }

  return { settori: [], settorePrincipale: null, metodo: null, motivi: [], cpvRiconosciuti: [], esclusioni };
}
