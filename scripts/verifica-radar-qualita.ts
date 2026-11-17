// Autotest della QUALITÀ DELLE GARE di Tender Intelligence: regole definitive dell'utente del 17/11/2026 (livelli A/B/C, sottocategorie,
// concessioni di bar e ristoranti, cinque famiglie). Gratuito, nessun database né rete: gira nel livello 1.
// Gli oggetti usati sono quelli dei bandi pubblici (TED e PVL) visti nell'archivio dello staging, o testi sintetici dichiarati: nessun dato
// di clienti.
//
// Controlli CAMBIATI rispetto alla prima versione (commit 541893a), perché la decisione del 17/11 li ha superati:
//   - punti ristoro e distributori del Liceo Orazio: da esclusa («ristorazione_commerciale») a A, concessione punto ristoro;
//   - panini dell'IIS Majorana: da esclusa («prodotti_da_banco») a A, concessione punto ristoro;
//   - pizza dell'IC Betti: resta esclusa, ma con la regola «forniture_di_beni» (fornitura di un prodotto, nessun servizio affidato);
//   - stabile di Valprato Soana: da A a B «correlata» (concessione complessa di uno stabile con bar, ristorante, negozio e mensa);
//   - «bar con pulizie»: la ristorazione non si toglie più (concessione di bar = ristorazione, sottocategoria concessione bar);
//   - «tutti i settori dei CPV esclusi»: nuovo esempio (concessione di un immobile con il solo servizio di pulizia), perché il bar non è
//     più un'esclusione;
//   - regole tolte: ristorazione_commerciale, distribuzione_automatica, prodotti_da_banco, impianti_sportivi (ora «correlata»);
//     «telecamere» diventa «videosorveglianza_senza_vigilanza»;
//   - salvaguardia del nucleo: non vale per le regole «ancheConNucleo» (servizi informatici con CPV principale informatico,
//     somministrazione di lavoro), che sono esclusioni volute anche quando l'oggetto nomina il servizio;
//   - frase nella scheda e identificativo della correzione: versione «2026-11-17b» e regola «forniture_di_beni».
import fs from "fs";
import path from "path";
import {
  CORRELAZIONI,
  ESCLUSIONI_OGGETTO,
  NOMI_LIVELLI,
  REGOLE_PAROLE,
  SETTORI_RADAR,
  SOTTOCATEGORIE,
  VERSIONE_REGOLE_SETTORI,
  classificaGara,
  descriviCorrezioneSettori,
  esclusioniOggetto,
  idFonteCorrezioneSettori,
  settoriDaParole,
  testoPerConfronto,
  type ContestoCpv,
  type SettoreRadar,
} from "../src/lib/radar/settori";
import { notaCorrezione, riclassificaGara, statoDaRegistro, valoreRegistro } from "../src/lib/radar/riclassifica-settori";

const RADICE = path.join(__dirname, "..");
const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale<T>(nome: string, ottenuto: T, previsto: T) {
  atteso(nome, JSON.stringify(ottenuto) === JSON.stringify(previsto), `ottenuto ${JSON.stringify(ottenuto)}, previsto ${JSON.stringify(previsto)}`);
}
const leggi = (relativo: string) => fs.readFileSync(path.join(RADICE, relativo), "utf-8").replace(/\r\n/g, "\n");
const SETTORI_CPV: SettoreRadar[] = ["pulizia", "ristorazione", "vigilanza_portierato", "facchinaggio", "multiservizi"];

type Atteso = { settore: SettoreRadar; livello: "A" | "B" | "C"; sottocategoria?: string | null; regola?: string };
type Caso = { nome: string; cpv: string[]; testo: string; attesi: Atteso[] };

function provaCaso(c: Caso) {
  const r = classificaGara({ cpvPrincipale: c.cpv[0] ?? null, cpvTutti: c.cpv, testo: c.testo });
  for (const a of c.attesi) {
    const v = r.valutazioni.find((x) => x.settore === a.settore);
    const ok = !!v && v.livello === a.livello && (a.sottocategoria === undefined || v.sottocategoria === a.sottocategoria) && (a.regola === undefined || v.regola === a.regola);
    atteso(`${c.nome}: ${a.settore} ${a.livello}${a.sottocategoria ? ` (${a.sottocategoria})` : ""}${a.regola ? ` [${a.regola}]` : ""}`, ok, JSON.stringify(v ?? r.valutazioni));
    // coerenza: un settore A o B è nei settori della gara, un settore C no (esclusione, non cancellazione)
    atteso(`${c.nome}: ${a.settore} ${a.livello === "C" ? "fuori dai" : "nei"} settori della gara`, (a.livello === "C") !== r.settori.includes(a.settore));
  }
  return r;
}

// ───── 1. i 14 casi chiesti dall'utente (17/11) ─────
const RICHIESTI: Caso[] = [
  {
    nome: "bar ospedaliero (ULSS 4 Veneto Orientale)",
    cpv: ["55300000"],
    testo: "Concessione dei servizi bar – caffetteria presso i Presidi Ospedalieri di San Donà di Piave e Portogruaro dell'Azienda ULSS n. 4",
    attesi: [{ settore: "ristorazione", livello: "A", sottocategoria: "concessione_bar" }],
  },
  {
    nome: "bar del Consiglio regionale (testo sintetico)",
    cpv: ["55300000"],
    testo: "Affidamento in concessione del servizio bar e caffetteria presso la sede del Consiglio regionale",
    attesi: [{ settore: "ristorazione", livello: "A", sottocategoria: "concessione_bar" }],
  },
  {
    nome: "ristorante presso un ente pubblico (museo MAXXI)",
    cpv: ["55300000"],
    testo: "Procedura aperta per l'affidamento in concessione del servizio di gestione del ristorante del museo MAXXI",
    attesi: [{ settore: "ristorazione", livello: "A", sottocategoria: "concessione_ristorante" }],
  },
  {
    nome: "punto ristoro universitario (testo sintetico)",
    cpv: ["55524000"],
    testo: "Concessione del servizio di punto ristoro presso il polo universitario di Ingegneria",
    attesi: [{ settore: "ristorazione", livello: "A", sottocategoria: "concessione_punto_ristoro" }],
  },
  {
    nome: "mensa scolastica",
    cpv: ["55524000"],
    testo: "Affidamento del servizio di refezione scolastica della scuola dell'infanzia del Comune di Amato",
    attesi: [{ settore: "ristorazione", livello: "A", sottocategoria: "mense" }],
  },
  {
    nome: "catering pubblico",
    cpv: ["55520000"],
    testo: "Accordo quadro multisourcing per la fornitura di servizi di catering per le strutture dell'Università",
    attesi: [{ settore: "ristorazione", livello: "A", sottocategoria: "catering" }],
  },
  {
    nome: "concessione immobiliare senza ristorazione (casone Paduli, Accadia)",
    cpv: ["55300000"],
    testo: "AFFIDAMENTO IN CONCESSIONE DEL CASONE “PADULI” PER LA DURATA DI SETTE ANNI",
    attesi: [{ settore: "ristorazione", livello: "C", regola: "concessione_di_immobili" }],
  },
  {
    nome: "puro trasporto merci",
    cpv: ["63100000"],
    testo: "Gara europea avente ad oggetto il servizio trasporti di beni economali e farmaceutici",
    attesi: [{ settore: "facchinaggio", livello: "C", regola: "trasporto_puro" }],
  },
  {
    nome: "trasloco e movimentazione di beni",
    cpv: ["98392000"],
    testo: "Servizio di trasloco, facchinaggio e movimentazione di materiali e arredi presso le strutture dell'ASL",
    attesi: [{ settore: "facchinaggio", livello: "A", sottocategoria: "traslochi" }],
  },
  {
    nome: "gestione complessiva di una RSA con ristorazione",
    cpv: ["85311000", "55300000", "90911200"],
    testo: "Servizio di gestione globale in concessione della casa di riposo Villa Loreto: servizi assistenziali, ristorazione e pulizia",
    attesi: [
      { settore: "ristorazione", livello: "B", sottocategoria: "appalti_multiservizi" },
      { settore: "pulizia", livello: "B" },
    ],
  },
  {
    nome: "accoglienza museale (non vigilanza privata)",
    cpv: ["79992000"],
    testo: "Affidamento del servizio di accoglienza ed assistenza al pubblico nell'ambito delle attività del museo, con vigilanza delle sale",
    attesi: [{ settore: "vigilanza_portierato", livello: "A", sottocategoria: "portierato_reception" }],
  },
  {
    nome: "servizio solo informatico (CPV principale informatico)",
    cpv: ["72000000", "55524000"],
    testo: "Piattaforma informatica per la prenotazione dei pasti della refezione scolastica",
    attesi: [{ settore: "ristorazione", livello: "C", regola: "servizi_informatici" }],
  },
  {
    nome: "videosorveglianza senza vigilanza",
    cpv: ["79714000"],
    testo: "Servizio di installazione, puntamento, disinstallazione telecamere mobili e analisi flussi video",
    attesi: [{ settore: "vigilanza_portierato", livello: "C", regola: "videosorveglianza_senza_vigilanza" }],
  },
  {
    nome: "vigilanza con trasporto valori (Valle Umbra Servizi)",
    cpv: ["79711000"],
    testo: "SERVIZIO DI GESTIONE DEL SISTEMA DI VIDEO SORVEGLIANZA DEI SITI SENSIBILI E SERVIZIO DI RITIRO, TRASPORTO, CONTAZIONE E DEPOSITO DI VALORI",
    attesi: [{ settore: "vigilanza_portierato", livello: "A", sottocategoria: "vigilanza_privata" }],
  },
];
for (const c of RICHIESTI) provaCaso(c);
uguale("servizio solo informatico senza CPV del file: nessun settore per parola chiave", settoriDaParole("Servizio informatico di prenotazione dei pasti per le mense"), []);

// ───── 2. le 8 gare PVL dubbie con le regole definitive ─────
const DUBBIE: Caso[] = [
  {
    nome: "ZTL e logistica urbana (Pizzo)",
    cpv: ["63100000"],
    testo: "CONCESSIONE DEL SERVIZIO INTEGRATO DI GESTIONE TECNOLOGICA DELLE ZTL, LOGISTICA URBANA LAST-MILE A ZERO EMISSIONI ED AUSILIO ALLA GESTIONE DEL PROCEDIMENTO SANZIONATORIO – HUB PARRERA",
    attesi: [{ settore: "facchinaggio", livello: "C", regola: "mobilita_e_sanzioni" }],
  },
  {
    nome: "mattatoio comunale (Corinaldo)",
    cpv: ["79993100"],
    testo: "PROCEDURA TELEMATICA APERTA PER L’AFFIDAMENTO IN CONCESSIONE DEL SERVIZIO DI GESTIONE DEL MATTATOIO COMUNALE DI CORINALDO",
    attesi: [{ settore: "multiservizi", livello: "C", regola: "impianti_di_altri_mestieri" }],
  },
  { nome: "casone (Accadia)", cpv: ["55300000"], testo: "AFFIDAMENTO IN CONCESSIONE DEL CASONE “PADULI” PER LA DURATA DI SETTE ANNI", attesi: [{ settore: "ristorazione", livello: "C", regola: "concessione_di_immobili" }] },
  {
    nome: "stabile con bar, ristorante e mensa dell'infanzia (Valprato Soana)",
    cpv: ["55300000"],
    testo:
      "CONCESSIONE IN GESTIONE DELLO STABILE COMUNALE SITO IN LOCALITA’ CAPOLUOGO COSTITUITO DA BAR, RISTORANTE, PIZZERIA, NEGOZIO ALIMENTARI E SERVIZIO MENSA PER LA SCUOLA DELL’INFANZIA COMUNALE",
    attesi: [{ settore: "ristorazione", livello: "B", sottocategoria: "mense", regola: "gestione_di_struttura" }],
  },
  {
    nome: "punti ristoro e distributori (Liceo Orazio)",
    cpv: ["55524000"],
    testo:
      "PA ESF35/26/SUA - Affidamento della gestione del servizio di: n. 1 punto ristoro, n. 2 punti ristoro volanti e n. 6 distributori automatici di bevande calde/fredde e snack e n. 3 distributori di acqua di rete interni alle sedi del Liceo Ginnasio Statale “Orazio”",
    attesi: [{ settore: "ristorazione", livello: "A", sottocategoria: "concessione_punto_ristoro" }],
  },
  {
    nome: "panini e prodotti da forno (IIS Majorana)",
    cpv: ["55524000"],
    testo: "AFFIDAMENTO IN CONCESSIONE DEL SERVIZIO DI DISTRIBUZIONE DI PANINI E PRODOTTI DA FORNO",
    attesi: [{ settore: "ristorazione", livello: "A", sottocategoria: "concessione_punto_ristoro" }],
  },
  { nome: "fornitura di pizza (IC Ugo Betti)", cpv: ["55524000"], testo: "Fornitura pizza scuole Betti", attesi: [{ settore: "ristorazione", livello: "C", regola: "forniture_di_beni" }] },
  {
    nome: "videosorveglianza e trasporto valori (Valle Umbra Servizi)",
    cpv: ["79711000"],
    testo: "SERVIZIO DI GESTIONE DEL SISTEMA DI VIDEO SORVEGLIANZA DEI SITI SENSIBILI E SERVIZIO DI RITIRO, TRASPORTO, CONTAZIONE E DEPOSITO DI VALORI",
    attesi: [{ settore: "vigilanza_portierato", livello: "A", sottocategoria: "vigilanza_privata" }],
  },
];
for (const c of DUBBIE) provaCaso(c);

// ───── 3. le cinque famiglie e gli altri casi reali ─────
const FAMIGLIE: Caso[] = [
  {
    nome: "centro di accoglienza: gestione complessiva",
    cpv: ["85311000", "55300000", "90911000"],
    testo: "GARA EUROPEA PER L'AFFIDAMENTO SERVIZI GESTIONE CENTRI ACCOGLIENZA STRAORDINARI. FORNITURA DI BENI ED EROGAZIONE SERVIZI DI ACCOGLIENZA",
    attesi: [
      { settore: "ristorazione", livello: "B", sottocategoria: "appalti_multiservizi" },
      { settore: "pulizia", livello: "B" },
    ],
  },
  {
    nome: "centro di accoglienza: servizio di ristorazione affidato da solo (testo sintetico)",
    cpv: ["55300000"],
    testo: "Servizio di ristorazione per gli ospiti dei centri di accoglienza della Prefettura",
    attesi: [{ settore: "ristorazione", livello: "A" }],
  },
  {
    nome: "accoglienza SAI: non è portineria (CPV 79992000 e oggetto sociale)",
    cpv: ["79992000"],
    testo: "Affidamento della gestione del servizio di accoglienza integrata (SAI) - categoria minori stranieri non accompagnati (MSNA)",
    attesi: [{ settore: "vigilanza_portierato", livello: "C", regola: "accoglienza_sociale" }],
  },
  {
    nome: "RSA: servizio di ristorazione affidato da solo",
    cpv: ["55320000"],
    testo: "Appalto del servizio di ristorazione rivolto agli anziani ospiti delle strutture residenziali e semiresidenziali",
    attesi: [{ settore: "ristorazione", livello: "A" }],
  },
  {
    nome: "logistica senza facchinaggio dichiarato",
    cpv: ["63100000"],
    testo: "Servizio di supporto logistica integrata",
    attesi: [{ settore: "facchinaggio", livello: "B", regola: "logistica_senza_facchinaggio" }],
  },
  {
    nome: "trasporto e facchinaggio insieme",
    cpv: ["63110000"],
    testo: "Procedura aperta per l'affidamento del servizio di trasporto e facchinaggio presso le strutture dell'Università",
    attesi: [{ settore: "facchinaggio", livello: "A", sottocategoria: "facchinaggio_movimentazione" }],
  },
  {
    nome: "vigilanza armata in un museo: vigilanza privata",
    cpv: ["98341140"],
    testo: "Servizio di vigilanza armata presso le sedi museali del Castello del Buonconsiglio",
    attesi: [{ settore: "vigilanza_portierato", livello: "A", sottocategoria: "vigilanza_privata" }],
  },
  {
    nome: "asilo nido: refezione affidata da sola",
    cpv: ["55523100"],
    testo: "Affidamento del servizio di refezione per gli asili nido comunali",
    attesi: [{ settore: "ristorazione", livello: "A", sottocategoria: "mense" }],
  },
  {
    nome: "asilo nido: mensa come parte della gestione integrale",
    cpv: ["80110000", "55523100"],
    testo: "Affidamento del servizio di gestione dell'asilo nido comunale, comprensivo dei servizi di pulizia e mensa",
    attesi: [{ settore: "ristorazione", livello: "B", sottocategoria: "mense" }],
  },
  {
    nome: "appalto di ristorazione scolastica che cita i servizi educativi come luogo",
    cpv: ["55524000"],
    testo: "Procedura aperta per l'affidamento del servizio di ristorazione scolastica nei servizi educativi dell'Unione",
    attesi: [{ settore: "ristorazione", livello: "A", sottocategoria: "mense" }],
  },
  {
    nome: "servizi integrati di pulizia: è pulizia (A), non multiservizi",
    cpv: ["90911200"],
    testo: "Gara europea per l'affidamento dei servizi integrati di pulizia e sanificazione ambientale",
    attesi: [{ settore: "pulizia", livello: "A" }],
  },
  {
    nome: "gestione integrata dei servizi di sicurezza e portierato: è il settore (A)",
    cpv: ["98341120"],
    testo: "Servizio di gestione integrata dei servizi di sicurezza e portierato presso impianti e sedi",
    attesi: [{ settore: "vigilanza_portierato", livello: "A" }],
  },
  {
    nome: "facility management con pulizia: correlata",
    cpv: ["79993000", "90911200"],
    testo: "Servizi di facility management all'interno del complesso immobiliare",
    attesi: [
      { settore: "multiservizi", livello: "A", sottocategoria: "facility_management" },
      { settore: "pulizia", livello: "B" },
    ],
  },
  {
    nome: "concessione demaniale con somministrazione: correlata",
    cpv: ["55300000"],
    testo: "Assegnazione di 4 concessioni demaniali a finalità turistico-ricreativa, di cui 3 esercizi di somministrazione",
    attesi: [{ settore: "ristorazione", livello: "B", regola: "concessione_demaniale" }],
  },
  {
    nome: "concessione demaniale senza ristorazione: esclusa",
    cpv: ["55300000"],
    testo: "Assentimento di n. 6 concessioni demaniali marittime ad uso commerciale, ludico, turistico ricreativo",
    attesi: [{ settore: "ristorazione", livello: "C", regola: "concessione_di_immobili" }],
  },
  {
    nome: "food & beverage di un evento affidato dall'ente",
    cpv: ["55521200"],
    testo: "Concessione servizio food&beverage presso Autodromo Nazionale Monza per GP Formula 1 e altri eventi della stagione sportiva",
    attesi: [{ settore: "ristorazione", livello: "A", sottocategoria: "concessione_ristorante" }],
  },
  {
    nome: "posteggi per somministrazione in una fiera (autorizzazione occasionale, testo sintetico)",
    cpv: ["55300000"],
    testo: "Bando per l'assegnazione dei posteggi per attività di vendita in occasione della fiera di primavera",
    attesi: [{ settore: "ristorazione", livello: "C", regola: "concessione_di_immobili" }],
  },
  {
    nome: "solo distributori automatici: correlata",
    cpv: ["55300000"],
    testo: "Servizio di somministrazione di bevande e alimenti tramite distributori automatici",
    attesi: [{ settore: "ristorazione", livello: "B", sottocategoria: "concessione_punto_ristoro", regola: "solo_distributori" }],
  },
  {
    nome: "bar in finanza di progetto con lavori: correlata",
    cpv: ["55300000", "45454000"],
    testo:
      "Procedura aperta per l'affidamento mediante project financing degli interventi di riqualificazione dell'Isola Comacina finalizzato alla concessione del servizio bar/ristoro e gestione della locanda",
    attesi: [{ settore: "ristorazione", livello: "B", sottocategoria: "concessione_bar", regola: "finanza_di_progetto" }],
  },
  {
    nome: "sorveglianza antincendio: correlata alla vigilanza",
    cpv: ["79714000"],
    testo: "Servizio di sorveglianza antincendio e gestione delle emergenze del mercato centrale",
    attesi: [{ settore: "vigilanza_portierato", livello: "B", regola: "antincendio" }],
  },
  {
    nome: "pattugliamento armato con presidio antincendio: vigilanza privata",
    cpv: ["79714000"],
    testo: "Servizio di sicurezza aeroportuale di sorveglianza e pattugliamento armato, con presidio antincendio",
    attesi: [{ settore: "vigilanza_portierato", livello: "A", sottocategoria: "vigilanza_privata" }],
  },
  {
    nome: "lavori e progettazione con CPV di pulizia secondario",
    cpv: ["71000000", "90900000"],
    testo: "ALD0009 - Casale Monferrato - Casa del Carabiniere - Progettazione e verifica",
    attesi: [{ settore: "pulizia", livello: "C", regola: "lavori_e_progettazione" }],
  },
  {
    nome: "somministrazione di lavoro per addetti alle pulizie",
    cpv: ["79620000", "90911200"],
    testo: "Servizio di somministrazione lavoro a tempo determinato per la selezione di figure come addetti alle pulizie",
    attesi: [{ settore: "pulizia", livello: "C", regola: "somministrazione_di_lavoro" }],
  },
  {
    nome: "servizio solo nei CPV secondari (appalto misto)",
    cpv: ["79952000", "55520000"],
    testo: "Concessione del servizio di organizzazione e gestione del congresso europeo di matematica",
    attesi: [{ settore: "ristorazione", livello: "B", regola: "cpv_secondario" }],
  },
];
for (const c of FAMIGLIE) provaCaso(c);

// combinazioni: una sola parola non basta
const accoglienzaAltroCpv = classificaGara({ cpvPrincipale: "98341130", cpvTutti: ["98341130"], testo: "Servizi di integrazione e tutela per richiedenti protezione internazionale" });
atteso(
  "accoglienza sociale: senza il CPV «servizi di accoglienza» le parole da sole non escludono",
  !accoglienzaAltroCpv.esclusioni.some((e) => e.regola === "accoglienza_sociale") && accoglienzaAltroCpv.settori.includes("vigilanza_portierato"),
  JSON.stringify(accoglienzaAltroCpv.valutazioni),
);
uguale(
  "trasporto con movimentazione: resta facchinaggio",
  classificaGara({ cpvPrincipale: "63110000", cpvTutti: ["63110000"], testo: "Servizio di trasporto e movimentazione di materiali ferroviari tra gli impianti di manutenzione" }).valutazioni.map((v) => [v.settore, v.livello]),
  [["facchinaggio", "A"]],
);
uguale("oggetto con software ma servizio affidato esplicitamente: resta", settoriDaParole("Servizio di vigilanza armata con software di gestione delle ronde"), ["vigilanza_portierato"]);
uguale("«piattaforma telematica» senza frase di servizio: resta", settoriDaParole("Procedura svolta sulla piattaforma telematica aziendale: ausiliariato nei presidi ospedalieri"), ["ausiliariato"]);

// la piattaforma di gara non è un servizio informatico (casi reali di TED, 17/11/2026)
uguale(
  "«piattaforma telematica» di gara: la vigilanza armata resta",
  settoriDaParole("Affidamento del servizio di vigilanza armata e telesorveglianza espletata tramite piattaforma telematica Acquisti Telematici"),
  ["vigilanza_portierato"],
);
uguale(
  "«piattaforma telematica» di gara: l'ausiliariato resta",
  settoriDaParole("Procedura di gara aperta sulla piattaforma telematica aziendale per l'affidamento del Servizio di Ausiliariato"),
  ["ausiliariato"],
);

// ───── 4. regole ben formate e provate sui loro casi ─────
uguale("id delle esclusioni unici", new Set(ESCLUSIONI_OGGETTO.map((r) => r.id)).size, ESCLUSIONI_OGGETTO.length);
uguale("id delle correlazioni unici e distinti dalle esclusioni", new Set([...ESCLUSIONI_OGGETTO, ...CORRELAZIONI].map((r) => r.id)).size, ESCLUSIONI_OGGETTO.length + CORRELAZIONI.length);
for (const id of ["ristorazione_commerciale", "distribuzione_automatica", "prodotti_da_banco", "impianti_sportivi"]) {
  atteso(`decisione del 17/11: «${id}» non è più un'esclusione`, !ESCLUSIONI_OGGETTO.some((r) => r.id === id));
}
// contesto CPV dei casi reali per le regole che combinano CPV e oggetto
const CONTESTI: Record<string, ContestoCpv> = {
  accoglienza_sociale: { principale: "79992000", tutti: ["79992000"], delSettore: ["79992000"] },
  lavori_e_progettazione: { principale: "71000000", tutti: ["71000000", "90900000"], delSettore: ["90900000"] },
  servizi_informatici: { principale: "72000000", tutti: ["72000000", "55524000"], delSettore: ["55524000"] },
};
for (const r of ESCLUSIONI_OGGETTO) {
  atteso(`${r.id}: motivo in parole semplici e almeno un caso reale`, r.motivo.length > 20 && r.casi.length > 0);
  atteso(`${r.id}: espressioni senza stato (né g né y)`, !/[gy]/.test(r.cerca.flags) && !(r.salvo && /[gy]/.test(r.salvo.flags)));
  atteso(`${r.id}: settori noti, mai l'ausiliariato da solo`, r.settori === "tutti" || (r.settori.every((s) => SETTORI_RADAR.some((x) => x.id === s)) && !r.settori.includes("ausiliariato")));
  if (r.condizione) atteso(`${r.id}: regola combinata, il contesto di prova esiste`, !!CONTESTI[r.id]);
  for (const caso of r.casi) {
    const settori = r.settori === "tutti" ? SETTORI_CPV : r.settori;
    const e = esclusioniOggetto(testoPerConfronto(caso), settori, CONTESTI[r.id]);
    atteso(`${r.id}: esclude il caso «${caso.slice(0, 60)}…»`, e.some((x) => x.regola === r.id), JSON.stringify(e));
    if (r.condizione) atteso(`${r.id}: senza il CPV giusto il caso NON si esclude (una sola parola non basta)`, !esclusioniOggetto(testoPerConfronto(caso), settori).some((x) => x.regola === r.id));
  }
}
for (const r of CORRELAZIONI) {
  atteso(`correlazione ${r.id}: motivo e casi`, r.motivo.length > 20 && r.casi.length > 0);
  atteso(`correlazione ${r.id}: espressioni senza stato`, !/[gy]/.test(r.cerca.flags) && !(r.salvo && /[gy]/.test(r.salvo.flags)));
  atteso(`correlazione ${r.id}: ogni caso fa scattare la regola`, r.casi.every((c) => r.cerca.test(testoPerConfronto(c)) && !(r.salvo && r.salvo.test(testoPerConfronto(c)))));
}
for (const r of REGOLE_PAROLE) atteso(`parole chiave ${r.settore}: espressioni senza stato`, !/[gy]/.test(r.cerca.flags) && !(r.escludi && /[gy]/.test(r.escludi.flags)));
for (const s of SETTORI_RADAR) {
  const sc = SOTTOCATEGORIE[s.id];
  atteso(`sottocategorie ${s.id}: almeno una, id unici, nomi leggibili`, sc.length > 0 && new Set(sc.map((x) => x.id)).size === sc.length && sc.every((x) => x.nome.length > 5));
}
uguale(
  "ristorazione: le 7 sottocategorie decise dall'utente",
  SOTTOCATEGORIE.ristorazione.map((s) => s.id),
  ["mense", "catering", "distribuzione_pasti", "concessione_bar", "concessione_ristorante", "concessione_punto_ristoro", "appalti_multiservizi"],
);
uguale("tre livelli", Object.keys(NOMI_LIVELLI), ["A", "B", "C"]);

// ───── 5. salvaguardie: gare pertinenti (casi reali vicini alle regole) ─────
const PERTINENTI: { nome: string; cpv: string[]; testo: string; settori: SettoreRadar[] }[] = [
  { nome: "pausa pranzo e bar", cpv: ["55511000"], testo: "Servizi di pausa pranzo e bar", settori: ["ristorazione"] },
  { nome: "bar e mensa", cpv: ["55300000"], testo: "Concessione del servizio bar e mensa dell'ospedale", settori: ["ristorazione"] },
  { nome: "enoteca in concessione con il servizio", cpv: ["55300000"], testo: "Concessione del servizio di enoteca e dell'uso del locale denominato Bottega del vino", settori: ["ristorazione"] },
  { nome: "facchinaggio dei RAEE", cpv: ["63100000"], testo: "SERVIZIO DI FACCHINAGGIO RAEE E PULIZIA CCR", settori: ["facchinaggio"] },
  { nome: "facchinaggio negli impianti sportivi", cpv: ["63100000"], testo: "PA servizio di facchinaggio da espletarsi presso gli immobili e gli impianti sportivi durante i Giochi del Mediterraneo", settori: ["facchinaggio"] },
  { nome: "trasloco con fornitura di imballaggi", cpv: ["98392000"], testo: "Servizio di trasloco con fornitura di imballaggi", settori: ["facchinaggio"] },
  { nome: "pulizia con fornitura di materiali", cpv: ["90911200"], testo: "Servizio di pulizia degli edifici comunali con fornitura di materiali e prodotti di consumo", settori: ["pulizia"] },
  { nome: "pulizia e raccolta dei rifiuti negli uffici", cpv: ["90919200"], testo: "Servizio di pulizia degli uffici e raccolta dei rifiuti", settori: ["pulizia"] },
  { nome: "custodia, sicurezza e pulizia degli impianti sportivi", cpv: ["90910000", "98341130"], testo: "SERVIZIO DI CUSTODIA, SICUREZZA E PULIZIA AMBIENTALE DEGLI IMPIANTI SPORTIVI AFFIDATI IN GESTIONE", settori: ["pulizia", "vigilanza_portierato"] },
  { nome: "centralino e front office", cpv: ["79992000"], testo: "SERVIZIO DI SPOLA E CENTRALINO-FRONT OFFICE PER LA SEDE ISTITUZIONALE", settori: ["vigilanza_portierato"] },
  { nome: "vigilanza armata con telecamere", cpv: ["98341140"], testo: "Servizio di vigilanza armata e di controllo delle telecamere", settori: ["vigilanza_portierato"] },
  { nome: "gestione di impianti tecnologici degli edifici", cpv: ["79993100"], testo: "Servizio di conduzione e manutenzione impianti tecnologici", settori: ["multiservizi"] },
  { nome: "multiservizi presso i soggiorni militari", cpv: [], testo: "Concessione di Multiservizi da erogare presso i Soggiorni Militari di Forza Armata", settori: ["multiservizi"] },
  { nome: "ausiliariato", cpv: [], testo: "Servizio di ausiliariato specializzato occorrente all’ASP di Catania", settori: ["ausiliariato"] },
  { nome: "pulizia dei veicoli (non è manutenzione di veicoli)", cpv: ["90917000"], testo: "Servizio di pulizia e lavaggio dei veicoli del parco mezzi", settori: ["pulizia"] },
  { nome: "centro cottura (non è una struttura da gestire)", cpv: ["55321000"], testo: "Gestione del centro cottura comunale e preparazione dei pasti", settori: ["ristorazione"] },
];
for (const c of PERTINENTI) uguale(`pertinente, resta: ${c.nome}`, classificaGara({ cpvPrincipale: c.cpv[0] ?? null, cpvTutti: c.cpv, testo: c.testo }).settori, c.settori);

const PAROLE_FUORI = [
  "Procedura aperta per l'affidamento del servizio di coperture assicurative di Marche Multiservizi SPA",
  "Individuazione di un nuovo socio privato della Società Levante Multiservizi s.r.l.",
  "Servizi integrati di gestione documentale: ricevimento, profilazione, postalizzazione",
  "Servizi integrati per la gestione e manutenzione delle apparecchiature biomediche",
  "Procedura aperta per l'affidamento in concessione del servizio ausiliario al rilascio di visti di circolazione e soggiorno",
];
for (const t of PAROLE_FUORI) uguale(`parole chiave: fuori «${t.slice(0, 60)}…»`, settoriDaParole(t), []);
uguale("parole chiave: «multiservizi» come servizio resta", settoriDaParole("Affidamento del servizio multiservizi presso le sedi comunali"), ["multiservizi"]);

// ───── 6. esclusione ≠ cancellazione: cosa riporta la classificazione ─────
const bar = classificaGara({ cpvPrincipale: "55300000", cpvTutti: ["55300000", "90911200"], testo: "Concessione del bar e pulizia dei locali del museo" });
uguale("bar con pulizie: restano ristorazione (concessione bar) e pulizia", [bar.settori, bar.valutazioni.map((v) => [v.settore, v.livello, v.sottocategoria])], [
  ["ristorazione", "pulizia"],
  [
    ["ristorazione", "A", "concessione_bar"],
    ["pulizia", "A", "pulizia_edifici"],
  ],
]);
const soloParole = classificaGara({ cpvPrincipale: "55300000", cpvTutti: ["55300000"], testo: "Concessione del casone comunale con servizio di pulizia dei locali" });
uguale("tutti i settori dei CPV esclusi: decidono le parole chiave, come per le altre gare", [soloParole.settori, soloParole.metodo, soloParole.esclusioni.map((e) => e.regola)], [["pulizia"], "parole_chiave", ["concessione_di_immobili"]]);
const nessuno = classificaGara({ cpvPrincipale: "55524000", cpvTutti: ["55524000"], testo: "Fornitura pizza scuole Betti" });
atteso("gara esclusa: nessun settore, livello C, esclusione tracciata", nessuno.settori.length === 0 && nessuno.metodo === null && nessuno.livello === "C" && nessuno.esclusioni.length === 1);
uguale("senza testo: settore dal CPV principale, livello A", [classificaGara({ cpvPrincipale: "55524000", cpvTutti: ["55524000"], testo: null }).settori, classificaGara({ cpvPrincipale: "55524000", cpvTutti: ["55524000"], testo: null }).livello], [["ristorazione"], "A"]);
const lavoro = classificaGara({ cpvPrincipale: "79620000", cpvTutti: ["79620000"], testo: "Servizio di somministrazione lavoro a tempo determinato per figure di addetti alle pulizie" });
uguale(
  "esclusione di una gara trovata per parola chiave: il motivo resta scritto",
  [lavoro.settori, lavoro.livello, lavoro.esclusioni.map((e) => [e.settore, e.regola])],
  [[], "C", [["pulizia", "somministrazione_di_lavoro"]]],
);
uguale("nessun CPV e nessuna parola: livello nullo", classificaGara({ cpvPrincipale: "33000000", cpvTutti: ["33000000"], testo: "Fornitura di farmaci" }).livello, null);
const misto = classificaGara({ cpvPrincipale: "85311000", cpvTutti: ["85311000", "55300000"], testo: "Servizi di gestione e funzionamento del centro di accoglienza" });
atteso("una gara B ha motivi e settore principale coerenti", misto.livello === "B" && misto.settorePrincipale === "ristorazione" && misto.motivi.some((m) => m.includes("55300000")));
for (const r of ESCLUSIONI_OGGETTO.filter((x) => !x.ancheConNucleo)) {
  // chi contiene le parole approvate del settore non si esclude mai (salvo le regole «ancheConNucleo», documentate sopra)
  for (const pr of REGOLE_PAROLE.filter((p) => p.settore !== "ausiliariato" && (r.settori === "tutti" || r.settori.includes(p.settore)))) {
    const esempio = pr.esempio.split(",")[0].trim();
    const e = esclusioniOggetto(testoPerConfronto(`${esempio} ${r.casi.join(" ")}`), [pr.settore], CONTESTI[r.id]);
    atteso(`nucleo ${pr.settore} contro ${r.id}: con «${esempio}» non si esclude`, !e.some((x) => x.regola === r.id), JSON.stringify(e));
  }
}

// ───── 7. stesse regole per tutte le fonti ─────
for (const f of ["src/lib/radar/fonti/ted-calcoli.ts", "src/lib/radar/fonti/pvl-calcoli.ts", "src/lib/radar/fonti/sintel-calcoli.ts", "src/lib/radar/fonti/aflink-calcoli.ts"]) {
  if (!fs.existsSync(path.join(RADICE, f))) {
    console.log(`(salto ${f}: non è su questo ramo)`);
    continue;
  }
  const t = leggi(f);
  if (!/classificaGara/.test(t)) {
    console.log(`(salto ${f}: non classifica ancora)`);
    continue;
  }
  atteso(`${f}: classifica con classificaGara di settori.ts`, /import \{[^}]*classificaGara[^}]*\} from "\.\.\/settori"/.test(t));
  atteso(`${f}: nessuna regola di classificazione propria`, !/ESCLUSIONI_OGGETTO\s*=|REGOLE_PAROLE\s*=|CORRELAZIONI\s*=/.test(t));
}

// ───── 8. riclassificazione delle gare già in archivio ─────
const base = { id: "00000000-0000-0000-0000-000000000001", cpv_tutti: null, natura_contratto: "servizi" };
uguale(
  "riclassificazione: gara pertinente invariata",
  riclassificaGara({ ...base, oggetto: "Servizio di refezione scolastica", cpv_principale: "55524000", settori: ["ristorazione"], metodo_settore: "cpv" }, []).tipo,
  "invariata",
);
uguale(
  "riclassificazione: gara correlata (B) invariata nella colonna settori",
  riclassificaGara({ ...base, oggetto: "Servizi di gestione e funzionamento del centro di accoglienza", cpv_principale: "85311000", cpv_tutti: ["85311000", "55300000"], settori: ["ristorazione"], metodo_settore: "cpv" }, []).tipo,
  "invariata",
);
const corr = riclassificaGara({ ...base, oggetto: "Fornitura pizza scuole Betti", cpv_principale: "55524000", settori: ["ristorazione"], metodo_settore: "cpv" }, []);
atteso(
  "riclassificazione: gara esclusa → correzione che toglie e basta",
  corr.tipo === "correzione" && corr.dopo.settori.length === 0 && corr.dopo.metodo === null && corr.idFonte === `regole-settori-${VERSIONE_REGOLE_SETTORI}:forniture_di_beni`,
  JSON.stringify(corr),
);
uguale("versione delle regole definitive", VERSIONE_REGOLE_SETTORI, "2026-11-17b");
const lotti = riclassificaGara({ ...base, oggetto: "lotto1", cpv_principale: "90910000", cpv_tutti: ["90910000", "98341130"], settori: ["pulizia", "vigilanza_portierato"], metodo_settore: "cpv" }, [
  { oggetto: "SERVIZIO DI CUSTODIA, SICUREZZA E PULIZIA AMBIENTALE DEGLI IMPIANTI SPORTIVI", cpv_principale: "90910000", cpv_tutti: null },
]);
uguale("riclassificazione: legge anche gli oggetti dei lotti (come gli importatori)", lotti.tipo, "invariata");
uguale(
  "riclassificazione: una gara che guadagnerebbe un settore non si tocca",
  riclassificaGara({ ...base, oggetto: "Servizio di refezione scolastica", cpv_principale: "55524000", settori: [], metodo_settore: null }, []).tipo,
  "da_decidere",
);
uguale(
  "riclassificazione: parola chiave su una fornitura → fuori (regola degli importatori)",
  (() => {
    const r = riclassificaGara({ ...base, oggetto: "Fornitura di attrezzature per la pulizia con servizio di pulizia", cpv_principale: "39000000", settori: ["pulizia"], metodo_settore: "parole_chiave", natura_contratto: "forniture" }, []);
    return r.tipo === "correzione" ? r.dopo.settori : r.tipo;
  })(),
  [],
);
const stato = { settori: ["ristorazione", "pulizia"], metodo: "cpv" };
uguale("registro: valore di prima leggibile per il ripristino", statoDaRegistro(valoreRegistro(stato)), stato);
uguale("registro: forma breve (solo settori)", statoDaRegistro('["pulizia"]'), { settori: ["pulizia"], metodo: null });
uguale("registro: valore illeggibile = nessun ripristino", statoDaRegistro("{rotto"), null);
atteso("nota del registro entro 1000 caratteri", notaCorrezione(Array.from({ length: 50 }, () => ({ settore: "ristorazione" as const, regola: "x", motivo: "m".repeat(80) }))).length <= 1000);
atteso("identificativo della correzione entro 200 caratteri", idFonteCorrezioneSettori(ESCLUSIONI_OGGETTO.map((r) => ({ settore: "pulizia" as const, regola: r.id, motivo: "" }))).length <= 200);
uguale(
  "frase per il cliente nella scheda",
  descriviCorrezioneSettori("17/11/2026", valoreRegistro({ settori: ["ristorazione"], metodo: "cpv" }), valoreRegistro({ settori: [], metodo: null }), `regole-settori-${VERSIONE_REGOLE_SETTORI}:forniture_di_beni`),
  "Il 17/11/2026 abbiamo tolto la gara da: ristorazione collettiva (Fornitura di beni senza un servizio del settore). Resta consultabile nell'archivio.",
);

// ───── 9. script di riclassificazione: porta, tetto, nessuna cancellazione ─────
const script = leggi("scripts/radar-riclassifica-settori.ts");
atteso("script: porta delle autorizzazioni con il suo nome", script.includes('controllaPorta({ script: "radar-riclassifica-settori.ts" })'));
atteso("script: la porta viene prima di ogni accesso al database per applica e annulla", script.indexOf('if (modo !== "prova") await porta();') > 0 && script.indexOf('if (modo !== "prova") await porta();') < script.indexOf("const db = createClient"));
atteso("script: solo staging, mai produzione", script.includes("PROGETTO_PRODUZIONE") && script.includes("RADAR_STAGING_REF"));
atteso("script: nessuna cancellazione né funzione del database", !/\.delete\(|\.rpc\(|truncate|drop /i.test(script));
atteso("script: scritture condizionate ai settori trovati (contiene E contenuto)", /contains\("settori"/.test(script) && /containedBy\("settori"/.test(script));
atteso("script: tetto di gare, si ferma prima di scrivere", script.includes("più del massimo autorizzato") && script.includes("massimo <= 500"));
atteso("script: registro mai notificabile", (script.match(/notificabile: false/g) ?? []).length === 2 && !script.includes("notificabile: true"));
atteso("script: cambia solo settori, metodo e data di aggiornamento", (script.match(/\.update\(\{[^}]*\}/g) ?? []).every((u) => /^\.update\(\{ settori: [^,]+, metodo_settore: [^,]+, aggiornata_il: iso \}$/.test(u)));
const scheda = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/opportunita/gara/[id]/page.tsx");
atteso("scheda della gara: la correzione dei settori ha la sua frase (non «Rettifica»)", scheda.includes("descriviCorrezioneSettori(quando, a.valore_precedente, a.valore_nuovo, a.id_fonte)"));

if (fallimenti.length) {
  console.error(`\n${fallimenti.length} controlli falliti:\n- ${fallimenti.join("\n- ")}`);
  process.exit(1);
}
console.log("\nTutti i controlli sulla qualità delle gare sono superati.");
