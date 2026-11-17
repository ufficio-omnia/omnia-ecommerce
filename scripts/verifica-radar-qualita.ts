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
// Controlli CAMBIATI con la versione «2026-11-17c» (decisioni dell'utente del 17/11 su più sottocategorie e videosorveglianza):
//   - videosorveglianza senza vigilanza: la regola si chiama ora «videosorveglianza_fornitura» (tipo 1 di 4); «telecamere» e
//     «videosorveglianza_senza_vigilanza» non ci sono più: la sola parola «videosorveglianza» non esclude;
//   - Valle Umbra: le sottocategorie sono due, «videosorveglianza_operativa» (gestione del sistema) e «vigilanza_privata» (valori);
//   - stabile di Valprato: le sottocategorie sono quattro, in ordine di comparsa (bar, ristorante, mensa, gestione integrata);
//   - versione delle regole «2026-11-17c».
// Controlli CAMBIATI con la versione «2026-11-17d» (decisione dell'utente sul pacchetto 15, 17/11):
//   - distributori automatici: da B («solo_distributori», regola tolta) ad A nella sottocategoria dedicata «distributori_automatici»;
//   - la ristorazione ha 8 sottocategorie (le 7 decise più i distributori automatici);
//   - congresso di matematica: resta B, ma con la regola «organizzazione_eventi» invece di «cpv_secondario»;
//   - versione delle regole «2026-11-17d». I 6 CPV nuovi sono nel file approvato (56 codici).
// Controlli CAMBIATI con la versione «2026-11-17e» (rilievo di B2 sulle gare di Sintel, 17/11):
//   - versione delle regole «2026-11-17e»; nessun altro controllo cambiato, uno nuovo (Treviglio, gestione integrata del bar: A).
// Controlli CAMBIATI con la versione «2026-11-17f» (decisione dell'utente del 17/11 sul chiosco, caso Sintel di Taino):
//   - versione delle regole «2026-11-17f»; nessun altro controllo cambiato. Nuovi: Taino A; chiosco su suolo pubblico e fornitura di
//     chioschi ancora C (per le loro regole); chiosco di edicola, giornali o fiori ancora C (regola del contesto); chiosco senza CPV fuori.
// Controlli CAMBIATI con la versione «2026-11-17g» (fase B2b autorizzata dall'utente il 17/11, «una parola chiave da sola non rende
// pertinente una gara»; settori dai lotti; servizi di altri settori affidati nell'oggetto):
//   - i tre bar di TED (ASL Roma 2, AUSL Bologna, GOM Reggio Calabria) senza i 6 CPV: prima «nessun settore», ora A per parola chiave,
//     perché l'oggetto AFFIDA la concessione (concessioni di ristoro per parola solo se affidate); il MUSAM resta senza settore;
//   - «navigazione internet nelle mense» (caso ARDSU): prima A, ora C con la regola «servizi_di_connettivita»;
//   - versione delle regole «2026-11-17g».
// Nessun controllo tolto. I controlli nuovi sono nella sezione «fase B2b».
import fs from "fs";
import path from "path";
import {
  CORRELAZIONI,
  CPV_CON_CONTESTO,
  voceCpv,
  ESCLUSIONI_OGGETTO,
  NOMI_LIVELLI,
  REGOLE_PAROLE,
  SETTORI_RADAR,
  SOTTOCATEGORIE,
  VERSIONE_REGOLE_SETTORI,
  affidamentoEsplicito,
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

type Atteso = { settore: SettoreRadar; livello: "A" | "B" | "C"; sottocategoria?: string | null; sottocategorie?: string[]; regola?: string };
type Caso = { nome: string; cpv: string[]; testo: string; attesi: Atteso[] };

function provaCaso(c: Caso) {
  const r = classificaGara({ cpvPrincipale: c.cpv[0] ?? null, cpvTutti: c.cpv, testo: c.testo });
  for (const a of c.attesi) {
    const v = r.valutazioni.find((x) => x.settore === a.settore);
    const ok =
      !!v &&
      v.livello === a.livello &&
      (a.sottocategoria === undefined || v.sottocategoria === a.sottocategoria) &&
      (a.sottocategorie === undefined || JSON.stringify(v.sottocategorie) === JSON.stringify(a.sottocategorie)) &&
      (a.regola === undefined || v.regola === a.regola);
    atteso(`${c.nome}: ${a.settore} ${a.livello}${a.sottocategoria ? ` (${a.sottocategoria})` : ""}${a.sottocategorie ? ` (${a.sottocategorie.join(", ")})` : ""}${a.regola ? ` [${a.regola}]` : ""}`, ok, JSON.stringify(v ?? r.valutazioni));
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
    attesi: [{ settore: "ristorazione", livello: "A", sottocategorie: ["concessione_bar"] }],
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
    // la «vigilanza delle sale» di un museo non aggiunge la vigilanza privata tra le sottocategorie
    attesi: [{ settore: "vigilanza_portierato", livello: "A", sottocategorie: ["portierato_reception"] }],
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
    attesi: [{ settore: "vigilanza_portierato", livello: "C", regola: "videosorveglianza_fornitura" }],
  },
  {
    nome: "vigilanza con trasporto valori (Valle Umbra Servizi)",
    cpv: ["79711000"],
    testo: "SERVIZIO DI GESTIONE DEL SISTEMA DI VIDEO SORVEGLIANZA DEI SITI SENSIBILI E SERVIZIO DI RITIRO, TRASPORTO, CONTAZIONE E DEPOSITO DI VALORI",
    attesi: [{ settore: "vigilanza_portierato", livello: "A", sottocategorie: ["videosorveglianza_operativa", "vigilanza_privata"] }],
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
    attesi: [{ settore: "ristorazione", livello: "B", sottocategorie: ["concessione_bar", "concessione_ristorante", "mense", "appalti_multiservizi"], regola: "gestione_di_struttura" }],
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
    attesi: [{ settore: "vigilanza_portierato", livello: "A", sottocategorie: ["videosorveglianza_operativa", "vigilanza_privata"] }],
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
    nome: "concessione autonoma di distributori automatici: A nella sottocategoria dedicata (TED 236968d7, decisione del 17/11)",
    cpv: ["55300000"],
    testo: "Servizio di somministrazione di bevande e alimenti tramite distributori automatici",
    attesi: [{ settore: "ristorazione", livello: "A", sottocategorie: ["distributori_automatici"] }],
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
    attesi: [{ settore: "ristorazione", livello: "B", regola: "organizzazione_eventi" }],
  },
];
for (const c of FAMIGLIE) provaCaso(c);

// ───── 3 bis. videosorveglianza: i quattro tipi (decisione dell'utente del 17/11; testi sintetici dichiarati, salvo dove indicato) ─────
const VIDEOSORVEGLIANZA: Caso[] = [
  {
    nome: "tipo 1, sola fornitura e posa di un sistema di videosorveglianza",
    cpv: ["79714000"],
    testo: "Fornitura e posa in opera di un sistema di videosorveglianza per il centro storico",
    attesi: [{ settore: "vigilanza_portierato", livello: "C", regola: "videosorveglianza_fornitura" }],
  },
  {
    nome: "tipo 1, installazione di telecamere mobili (caso reale di TED)",
    cpv: ["79714000"],
    testo: "SERVIZIO DI INSTALLAZIONE, PUNTAMENTO, DISINSTALLAZIONE TELECAMERE MOBILI E ANALISI FLUSSI VIDEO (Annualità 2026 - 2030)",
    attesi: [{ settore: "vigilanza_portierato", livello: "C", regola: "videosorveglianza_fornitura" }],
  },
  {
    nome: "tipo 2, manutenzione degli impianti di videosorveglianza",
    cpv: ["79711000"],
    testo: "Servizio di manutenzione ordinaria e straordinaria degli impianti di videosorveglianza e antintrusione degli edifici comunali",
    attesi: [{ settore: "vigilanza_portierato", livello: "C", regola: "videosorveglianza_manutenzione" }],
  },
  {
    nome: "tipo 3, servizio operativo di monitoraggio dalla centrale operativa",
    cpv: ["79711000"],
    testo: "Servizio di videosorveglianza da remoto con monitoraggio delle immagini dalla centrale operativa e pronto intervento",
    attesi: [{ settore: "vigilanza_portierato", livello: "A", sottocategorie: ["videosorveglianza_operativa", "vigilanza_privata"] }],
  },
  {
    nome: "tipo 4, affidamento misto con la parte tecnica come oggetto principale",
    cpv: ["79711000"],
    testo: "Fornitura, installazione e gestione di un sistema di videosorveglianza con monitoraggio delle immagini dalla centrale operativa",
    attesi: [{ settore: "vigilanza_portierato", livello: "B", regola: "videosorveglianza_mista" }],
  },
  {
    nome: "tipo 4, vigilanza armata che comprende la manutenzione della videosorveglianza: pertinente",
    cpv: ["98341140"],
    testo: "Servizio di vigilanza armata e manutenzione degli impianti di videosorveglianza delle sedi aziendali",
    attesi: [{ settore: "vigilanza_portierato", livello: "A", sottocategorie: ["vigilanza_privata"] }],
  },
  {
    nome: "la sola parola «videosorveglianza» non esclude (decide il CPV del settore)",
    cpv: ["79714000"],
    testo: "Servizio di videosorveglianza",
    attesi: [{ settore: "vigilanza_portierato", livello: "A" }],
  },
];
for (const c of VIDEOSORVEGLIANZA) provaCaso(c);
provaCaso({
  nome: "noleggio senza videosorveglianza prima del servizio di portierato: non è un affidamento misto (testo sintetico)",
  cpv: ["98341120"],
  testo: "Noleggio di una guardiola prefabbricata e servizio di portierato presso il parcheggio comunale",
  attesi: [{ settore: "vigilanza_portierato", livello: "A" }],
});
uguale("parole chiave: «vigilanza e videosorveglianza» senza la frase «servizio di» resta", settoriDaParole("Vigilanza e videosorveglianza degli edifici comunali"), ["vigilanza_portierato"]);
provaCaso({
  nome: "fornitura di derrate per i «Presidi ERDIS» (sedi, non presidio di sorveglianza): resta esclusa",
  cpv: ["15000000", "63110000"],
  testo: "Fornitura di derrate alimentari sostenibili per la ristorazione delle mense universitarie a gestione diretta. Fornitura di derrate alimentari sostenibili per la mensa universitaria Presidio ERDIS di Ancona",
  attesi: [{ settore: "facchinaggio", livello: "C", regola: "forniture_di_beni" }],
});
uguale("la sola parola «videosorveglianza» non include (nessun CPV del settore, nessuna parola chiave)", settoriDaParole("Servizio di videosorveglianza degli edifici comunali"), []);
uguale("parole chiave: la vigilanza che cita la videosorveglianza resta (regola di B1 corretta)", settoriDaParole("Servizio di vigilanza e videosorveglianza degli edifici comunali"), ["vigilanza_portierato"]);
uguale("parole chiave: vigilanza armata presso impianti, servizio esplicito: resta", settoriDaParole("Servizio di vigilanza armata presso gli impianti di depurazione"), ["vigilanza_portierato"]);
uguale("parole chiave: manutenzione e vigilanza degli impianti di illuminazione: fuori come prima", settoriDaParole("Manutenzione e vigilanza degli impianti di illuminazione pubblica"), []);

// le 4 gare TED oggi perse per i CPV non nel file (lettura TED del 17/11): con i loro oggetti le regole già le riconoscono
provaCaso({
  nome: "TED 786982-2026, bar del GOM di Reggio Calabria «per le necessità dei degenti»: concessione, non mensa",
  cpv: ["55300000"],
  testo:
    "PROCEDURA APERTA PER L’AFFIDAMENTO IN CONCESSIONE QUINQUENNALE DI SPAZI FINALIZZATI ALLA GESTIONE DEL SERVIZIO DI BAR - POSTO DI RISTORO E TAVOLA CALDA/FREDDA PER LE NECESSITÀ DEI DEGENTI, DEI DIPENDENTI E DEI VISITATORI",
  attesi: [{ settore: "ristorazione", livello: "A", sottocategorie: ["concessione_bar", "concessione_punto_ristoro"] }],
});
provaCaso({
  nome: "ristorazione per i degenti: mensa (caso reale di TED, ULSS 4)",
  cpv: ["55300000"],
  testo: "servizio di ristorazione per i degenti, gli utenti e il personale dipendente dell’azienda u.l.s.s. n. 4",
  attesi: [{ settore: "ristorazione", livello: "A", sottocategorie: ["mense"] }],
});

// ───── 3 quater. decisione del 17/11 sul pacchetto 15: distributori, 6 CPV con il contesto, 4 gare TED recuperate ─────
const DISTRIBUTORI: Caso[] = [
  { nome: "TED 236968d7 distributori", cpv: ["55300000"], testo: "Servizio di somministrazione di bevande e alimenti tramite distributori automatici", attesi: [] },
  { nome: "TED 36fa91de distributori", cpv: ["55900000"], testo: "CONCESSIONE DEI SERVIZI DI RISTORAZIONE A MEZZO DISTRIBUTORI AUTOMATICI. Distributori automatici lotto 1", attesi: [] },
  {
    nome: "TED 7d86699f distributori",
    cpv: ["55300000", "42933000"],
    testo: "Procedura aperta suddivisa in 4 lotti per l'affidamento in concessione del servizio di ristorazione mediante distributori automatici ubicati presso alcuni istituti scolastici",
    attesi: [],
  },
  { nome: "TED 9c93b2a8 distributori", cpv: ["55900000"], testo: "Affidamento in concessione del servizio di ristorazione mediante distributori automatici ubicati presso l'I.T.I. G. Marconi di Pontedera", attesi: [] },
  { nome: "TED b917c3f4 distributori", cpv: ["55900000"], testo: "Affidamento in concessione del servizio di ristorazione mediante distributori automatici presso le sedi del Liceo Principe Umberto di Savoia", attesi: [] },
  { nome: "TED c31d4cae distributori", cpv: ["55524000"], testo: "Affidamento in concessione del servizio di ristorazione mediante distributori automatici ubicati presso la sede dell'Istituto Superiore Ivan Piana", attesi: [] },
  { nome: "TED ea0520c7 distributori", cpv: ["55510000", "55524000"], testo: "Affidamento in concessione del servizio di ristorazione mediante distributori automatici ubicati presso la sede dell'Istituto Superiore Ivan Piana", attesi: [] },
];
for (const c of DISTRIBUTORI) {
  const r = classificaGara({ cpvPrincipale: c.cpv[0], cpvTutti: c.cpv, testo: c.testo });
  // 55900000 (vendita al dettaglio) non è nel file: queste entrano per parola chiave («ristorazione»), come oggi
  const v = r.valutazioni.find((x) => x.settore === "ristorazione");
  uguale(`${c.nome}: ristorazione A, sottocategoria dedicata`, v ? [v.livello, v.sottocategorie] : null, ["A", ["distributori_automatici"]]);
}
provaCaso({
  nome: "distributori accessori a una gestione più ampia: resta la regola B generale (testo sintetico)",
  cpv: ["85311000", "55300000"],
  testo: "Gestione del centro diurno per anziani, comprensiva di pulizie e distributori automatici di bevande",
  attesi: [{ settore: "ristorazione", livello: "B", sottocategorie: ["distributori_automatici", "appalti_multiservizi"] }],
});
uguale("i 6 CPV nuovi sono nel file approvato, in ristorazione", CPV_CON_CONTESTO.map((c) => voceCpv(c)?.settore ?? null), Array(6).fill("ristorazione"));
// controllo positivo chiesto dal coordinamento (17/11): codice con cifra di controllo, settore e descrizione ufficiale (reg. (CE) n.
// 213/2008, verificata dall'utente su EUR-Lex), alla lettera
const CPV_UFFICIALI_17_11: [string, string][] = [
  ["55410000-7", "Servizi di gestione bar"],
  ["55400000-4", "Servizi di mescita di bevande"],
  ["55330000-2", "Servizi di caffetteria"],
  ["55310000-6", "Servizi di ristorazione con cameriere"],
  ["55311000-3", "Servizi di ristorazione con cameriere in ristoranti per clientela ristretta"],
  ["55312000-0", "Servizi di ristorazione con cameriere per clientela non ristretta"],
];
for (const [codice, descrizione] of CPV_UFFICIALI_17_11) {
  const v = voceCpv(codice);
  uguale(`CPV ${codice} nel file approvato: codice, settore e descrizione ufficiale`, v ? [v.codice, v.settore, v.descrizione] : null, [codice, "ristorazione", descrizione]);
}
uguale(
  "descrizione ufficiale del 55311000 (EUR-Lex, verificata dall'utente)",
  voceCpv("55311000-3")?.descrizione,
  "Servizi di ristorazione con cameriere in ristoranti per clientela ristretta",
);
// le 4 gare TED oggi perse (lettura dell'API pubblica del 17/11, nessuna nuova richiesta): con i 6 CPV entrano
const TED_RECUPERATE: Caso[] = [
  { nome: "TED 728008-2026, ASL Roma 2, bar Sant'Eugenio", cpv: ["55410000"], testo: "Concessione Bar Sant'Eugenio", attesi: [{ settore: "ristorazione", livello: "A", sottocategorie: ["concessione_bar"] }] },
  { nome: "TED 743485-2026, AUSL di Bologna, bar AOU", cpv: ["55410000"], testo: "Concessione bar e servizi complementari AOU BO", attesi: [{ settore: "ristorazione", livello: "A", sottocategorie: ["concessione_bar"] }] },
  {
    nome: "TED 786982-2026, GOM di Reggio Calabria, bar e punto ristoro",
    cpv: ["55410000"],
    testo:
      "PROCEDURA APERTA PER L’AFFIDAMENTO IN CONCESSIONE QUINQUENNALE DI SPAZI FINALIZZATI ALLA GESTIONE DEL SERVIZIO DI BAR - POSTO DI RISTORO E TAVOLA CALDA/FREDDA PER LE NECESSITÀ DEI DEGENTI, DEI DIPENDENTI E DEI VISITATORI DEI PP.OO. “RIUNITI” E “MORELLI”",
    attesi: [{ settore: "ristorazione", livello: "A", sottocategorie: ["concessione_bar", "concessione_punto_ristoro"] }],
  },
  {
    nome: "TED 771777-2026, Difesa Servizi, MUSAM: caffetteria accessoria alla gestione del compendio museale",
    cpv: ["92521000", "55330000"],
    testo: "Concessione MUSAM Vigna di Valle - gestione e valorizzazione del compendio museale",
    attesi: [{ settore: "ristorazione", livello: "B", regola: "gestione_di_struttura" }],
  },
  {
    nome: "TED 726389-2026, Comune di Pozzuoli, bar dell'Istituto Virgilio (già dentro)",
    cpv: ["55410000"],
    testo: "Procedura aperta per l'affidamento in concessione del servizio di ristorazione mediante bar, ubicato presso la sede dell’Istituto scolastico Virgilio",
    attesi: [{ settore: "ristorazione", livello: "A", sottocategorie: ["concessione_bar"] }],
  },
];
for (const c of TED_RECUPERATE) provaCaso(c);
for (const c of TED_RECUPERATE.slice(0, 4)) {
  // prima della decisione questi CPV non erano nel file. Fase B2b (2026-11-17g): senza i 6 CPV i tre bar entrano lo stesso, ma SOLO perché
  // l'oggetto affida esplicitamente la concessione (parola chiave, A); il MUSAM, che non nomina il bar, resta fuori
  const senza = c.cpv.filter((x) => !CPV_CON_CONTESTO.includes(x));
  const s = classificaGara({ cpvPrincipale: senza[0] ?? null, cpvTutti: senza, testo: c.testo });
  if (c.nome.includes("MUSAM")) atteso(`${c.nome}: senza i 6 CPV nessun settore`, s.settori.length === 0);
  else uguale(`${c.nome}: senza i 6 CPV entra per parola solo perché la concessione è affidata (A, parole_chiave)`, s.valutazioni.map((v) => [v.settore, v.livello, v.regola]), [["ristorazione", "A", "parole_chiave"]]);
}
// gestione integrata DENTRO lo stesso servizio (il bar in due impianti): resta A, come i «servizi integrati di pulizia»
provaCaso({
  nome: "Sintel 225629817 Treviglio, gestione integrata del servizio bar in due impianti sportivi: A (segnalato da B2)",
  cpv: ["55410000"],
  testo: "Concessione del servizio di gestione integrata del servizio bar presso il Centro Sportivo e lo Stadio Comunale",
  attesi: [{ settore: "ristorazione", livello: "A", sottocategorie: ["concessione_bar"] }],
});
// «chiosco» nella regola del contesto (decisione dell'utente del 17/11): vale solo con uno dei 6 CPV nuovi, mai per edicola, giornali o fiori
provaCaso({
  nome: "Sintel 225696739 Taino, concessione del chiosco nel parco con il CPV del bar: A (decisione dell'utente)",
  cpv: ["55410000"],
  testo: "Affidamento in concessione del chiosco ubicato nel parco comunale per anni sei",
  attesi: [{ settore: "ristorazione", livello: "A", sottocategorie: ["concessione_bar"] }],
});
provaCaso({
  nome: "chiosco su suolo pubblico per attività di commercio, con il CPV del bar: resta C (concessione di immobili)",
  cpv: ["55410000"],
  testo: "Affidamento in concessione di suolo pubblico per la installazione di un chiosco per l'esercizio di attività di commercio",
  attesi: [{ settore: "ristorazione", livello: "C", regola: "concessione_di_immobili" }],
});
provaCaso({
  nome: "fornitura di chioschi, con il CPV del bar: resta C (forniture di beni)",
  cpv: ["55410000"],
  testo: "Fornitura e installazione di chioschi informativi multimediali",
  attesi: [{ settore: "ristorazione", livello: "C", regola: "forniture_di_beni" }],
});
for (const testo of [
  "Concessione del chiosco edicola di piazza Garibaldi",
  "Affidamento in concessione del chiosco per la vendita di giornali e riviste",
  "Concessione del chiosco per la vendita di fiori presso il cimitero comunale",
]) {
  provaCaso({
    nome: `chiosco non di ristoro con il CPV del bar messo per errore: resta C («${testo.slice(0, 45)}…»)`,
    cpv: ["55410000"],
    testo,
    attesi: [{ settore: "ristorazione", livello: "C", regola: "cpv_nuovi_senza_oggetto" }],
  });
}
provaCaso({
  nome: "chiosco bar ed edicola con il CPV del bar: A (il bar è nominato)",
  cpv: ["55410000"],
  testo: "Concessione del chiosco bar ed edicola dei giardini pubblici",
  attesi: [{ settore: "ristorazione", livello: "A", sottocategorie: ["concessione_bar"] }],
});
uguale(
  "chiosco senza CPV di ristorazione: nessun settore (la parola da sola non basta)",
  classificaGara({ cpvPrincipale: null, cpvTutti: [], testo: "Affidamento in concessione del chiosco ubicato nel parco comunale per anni sei" }).settori,
  [],
);
// regola del contesto: un CPV nuovo da solo non basta
provaCaso({
  nome: "solo un CPV nuovo e l'oggetto non nomina il servizio: C",
  cpv: ["55410000"],
  testo: "Concessione di spazi commerciali presso la stazione marittima",
  attesi: [{ settore: "ristorazione", livello: "C", regola: "cpv_nuovi_senza_oggetto" }],
});
provaCaso({
  nome: "CPV nuovo con un CPV già approvato: la regola del contesto non serve",
  cpv: ["55310000", "55300000"],
  testo: "Concessione di spazi presso la sede regionale",
  attesi: [{ settore: "ristorazione", livello: "A" }],
});
// eventi, alloggio e trasporti: niente limite automatico a B, conta se la ristorazione è principale o accessoria (decisione del 17/11)
const PRINCIPALE_O_ACCESSORIA: Caso[] = [
  { nome: "evento: ristorazione principale", cpv: ["79952000", "55520000"], testo: "Servizio di catering per gli eventi istituzionali della Regione", attesi: [{ settore: "ristorazione", livello: "A", sottocategorie: ["catering"] }] },
  {
    nome: "evento: ristorazione accessoria",
    cpv: ["79952000", "55520000"],
    testo: "Organizzazione e gestione del congresso nazionale, comprensiva di servizio di catering per i partecipanti",
    attesi: [{ settore: "ristorazione", livello: "B", regola: "organizzazione_eventi" }],
  },
  {
    nome: "alloggio: ristorante come oggetto principale",
    cpv: ["55100000", "55312000"],
    testo: "Concessione del servizio di ristorante presso l'ostello comunale",
    attesi: [{ settore: "ristorazione", livello: "A", sottocategorie: ["concessione_ristorante"] }],
  },
  {
    nome: "alloggio: ristorazione accessoria alla gestione della struttura",
    cpv: ["55100000", "55312000"],
    testo: "Concessione della gestione dell'albergo comunale con servizio di ristorante",
    attesi: [{ settore: "ristorazione", livello: "B", regola: "gestione_di_struttura" }],
  },
  {
    nome: "trasporto: ristorazione a bordo accessoria (caso reale di TED, dialogo competitivo MITUR)",
    cpv: ["60200000", "55520000"],
    testo: "Dialogo competitivo per servizio di trasporto ferroviario passeggeri a fini turistici, comprensivo di servizi di ristorazione a bordo",
    attesi: [{ settore: "ristorazione", livello: "B", regola: "trasporto_con_ristorazione" }],
  },
];
for (const c of PRINCIPALE_O_ACCESSORIA) provaCaso(c);
uguale(
  "i CPV nuovi non tolgono i settori delle parole chiave (TED 0b7448d7, Università di Sassari)",
  classificaGara({
    cpvPrincipale: "55410000",
    cpvTutti: ["55410000", "98351000"],
    testo: "Procedura aperta per affidamento in concessione dei servizi del bar e del parcheggio esterno con effettuazione del servizio di pulizia e guardiania dell'edificio di via Piandanna dell'Università di Sassari",
  }).settori,
  ["ristorazione", "pulizia", "vigilanza_portierato"],
);
// fase B2b (2026-11-17g): non è un trasporto (B) e non è più ristorazione (A): è connessione a internet (C)
provaCaso({
  nome: "«navigazione» internet nelle mense non è un trasporto né ristorazione (testo sintetico dal caso reale ARDSU)",
  cpv: ["55510000"],
  testo: "Servizio di navigazione internet nelle mense universitarie",
  attesi: [{ settore: "ristorazione", livello: "C", regola: "servizi_di_connettivita" }],
});
// ristorazione AUTONOMA: un lotto dedicato al catering in un appalto di eventi (casi reali di TED, Regione Lombardia e «allestimento,
// organizzazione eventi e catering»)
const eventiConLotti = {
  cpvPrincipale: "79952000",
  cpvTutti: ["79952000", "55520000"],
  testo: "Servizio di allestimento, organizzazione eventi e catering Servizi di organizzazione di eventi Servizi di catering",
};
const senzaLotti = classificaGara(eventiConLotti).valutazioni.find((v) => v.settore === "ristorazione");
const conLotti = classificaGara({
  ...eventiConLotti,
  lotti: [
    { testo: "Servizi di organizzazione di eventi", cpv: ["79952000"] },
    { testo: "Servizi di catering", cpv: ["55520000"] },
  ],
}).valutazioni.find((v) => v.settore === "ristorazione");
uguale("evento con lotto dedicato al catering: senza i lotti è B (accessoria)", senzaLotti?.livello, "B");
uguale("evento con lotto dedicato al catering: con i lotti è A (autonoma)", [conLotti?.livello, conLotti?.regole[0], conLotti?.sottocategorie], ["A", "lotto_autonomo", ["catering"]]);
const unLotto = classificaGara({ ...eventiConLotti, lotti: [{ testo: "Servizi di catering", cpv: ["55520000"] }] }).valutazioni.find((v) => v.settore === "ristorazione");
uguale("un solo lotto non è un servizio autonomo (è la gara stessa)", unLotto?.livello, "B");

// ───── 3 ter. più sottocategorie nello stesso settore, regole e versione (interfaccia per la 0121) ─────
provaCaso({
  nome: "più sottocategorie in ordine di comparsa (testo sintetico)",
  cpv: ["55300000"],
  testo: "Affidamento dei servizi di gestione bar, catering per gli eventi e distribuzione pasti ai reparti",
  attesi: [{ settore: "ristorazione", livello: "A", sottocategorie: ["concessione_bar", "catering", "distribuzione_pasti"] }],
});
for (const c of [...RICHIESTI, ...DUBBIE, ...FAMIGLIE, ...VIDEOSORVEGLIANZA]) {
  const r = classificaGara({ cpvPrincipale: c.cpv[0] ?? null, cpvTutti: c.cpv, testo: c.testo });
  atteso(
    `interfaccia coerente: ${c.nome}`,
    r.versione === VERSIONE_REGOLE_SETTORI &&
      r.valutazioni.every(
        (v) =>
          v.regole.length > 0 &&
          v.regole.length === v.motivi.length &&
          v.regola === v.regole[0] &&
          v.motivo === v.motivi[0] &&
          v.sottocategoria === (v.sottocategorie[0] ?? null) &&
          (v.livello === "C") === (v.sottocategorie.length === 0) &&
          v.sottocategorie.every((s) => SOTTOCATEGORIE[v.settore].some((x) => x.id === s)) &&
          (v.da === "cpv" ? v.cpv.length > 0 : v.cpv.length === 0),
      ),
    JSON.stringify(r.valutazioni),
  );
}

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

// ───── fase B2b (2026-11-17g): affidamento esplicito, servizi di altri settori, settori dai lotti ─────
// testi sintetici o reali dell'archivio dello staging (TED), nessun dato di clienti
const parole = (s: SettoreRadar) => REGOLE_PAROLE.find((r) => r.settore === s)!.cerca;
const AFFIDAMENTI: [SettoreRadar, string, string | null][] = [
  ["pulizia", "Affidamento del servizio di pulizia degli uffici comunali", "principale"],
  ["pulizia", "Procedura aperta per l'affidamento triennale dei servizi di pulizia e sanificazione", "principale"],
  ["pulizia", "Servizio di ristorazione scolastica comprensivo del riordino e della pulizia dei refettori", "accessorio"],
  ["pulizia", "Concessione del bar e del parcheggio con effettuazione del servizio di pulizia e guardiania", "accessorio"],
  ["pulizia", "Servizi cimiteriali, custodia, pulizia e manutenzione del verde", "elenco"],
  ["pulizia", "Servizio gestione, pulizia, sanificazione e manutenzione dei bagni pubblici", "elenco"],
  ["pulizia", "Servizi di lavaggio, sanificazione e stiratura per i capi di abbigliamento", null],
  ["ristorazione", "Servizi di pulizia, sanificazione e altri servizi accessori con applicazione dei CAM per il servizio ristorazione DSU", null],
  ["ristorazione", "Servizio di pulizia della mensa aziendale", null],
  ["ristorazione", "Affidamento dei lavori di adeguamento della mensa scolastica", null],
  ["ristorazione", "Servizio di navigazione nelle residenze e mense universitarie", null],
  ["ristorazione", "Software per la gestione delle mense scolastiche", null],
  ["ristorazione", "Lavori mensa scolastica", null],
  ["ristorazione", "Comune di Donnas - Refezione", "principale"],
  ["ristorazione", "Servizi di pulizia e di ristorazione", "elenco"],
  ["vigilanza_portierato", "Servizio di pulizia degli immobili comunali nonché del servizio di receptionist/portierato", "principale"],
  ["vigilanza_portierato", "Pulizie e guardiania edifici comunali", "elenco"],
  ["vigilanza_portierato", "Appalto relativo alle attività di vigilanza, custodia e accoglienza", "principale"],
  ["vigilanza_portierato", "PROCEDURA APERTA PER LAFFIDAMENTO DEL SERVIZIO DI VIGILANZA ARMATA", "principale"],
  ["vigilanza_portierato", "Affidamento del del servizio di vigilanza", "principale"],
  ["ausiliariato", "Servizi nidi d'infanzia e servizi ausiliari presso le scuole", "principale"],
  ["multiservizi", "Servizio di pulizia delle aree interne e altri servizi integrati presso gli aeroporti", "elenco"],
  ["multiservizi", "Gestione con formula global service dei servizi di ospitalità", "principale"],
];
for (const [s, testo, a] of AFFIDAMENTI) uguale(`affidamento esplicito (${s}): «${testo.slice(0, 70)}»`, affidamentoEsplicito(s, parole(s), testo), a);

// parole chiave senza CPV del file: A solo con l'affidamento esplicito
const gara2b = (testo: string, cpv: string[] = []) => classificaGara({ cpvPrincipale: cpv[0] ?? null, cpvTutti: cpv, testo });
const livelli = (c: ReturnType<typeof classificaGara>) => c.valutazioni.map((v) => [v.settore, v.livello, v.regola]);
uguale("parola chiave affidata: A", livelli(gara2b("Affidamento del servizio di pulizia degli uffici")), [["pulizia", "A", "parole_chiave"]]);
uguale("parola chiave solo citata (lavaggio di indumenti, TED 93a329b1): B", livelli(gara2b("Servizi di lavaggio, sanificazione e stiratura per i capi di abbigliamento")), [["pulizia", "B", "parola_chiave_citata"]]);
uguale("parola chiave in un elenco di servizi cimiteriali: B", livelli(gara2b("Servizi cimiteriali, custodia, pulizia e manutenzione del verde")), [["pulizia", "B", "servizio_in_elenco"]]);
uguale(
  "servizi accessori «in forma integrata con» (TED 722bf4ac): B",
  livelli(gara2b("Gestione dei servizi di assistenza culturale e di ospitalità per il pubblico, in forma integrata con i servizi di pulizia, vigilanza e biglietteria")),
  [["pulizia", "B", "servizio_accessorio"], ["vigilanza_portierato", "B", "servizio_accessorio"]],
);
uguale("concessione del bar senza CPV, affidata: A", gara2b("Concessione del servizio bar presso l'ospedale civile").valutazioni.map((v) => [v.settore, v.livello, v.sottocategorie]), [["ristorazione", "A", ["concessione_bar"]]]);
uguale("bar solo citato senza CPV (lavori): nessun settore", gara2b("Lavori di ristrutturazione del bar comunale").settori, []);
uguale("pulizia del bar senza CPV: pulizia, non ristorazione", gara2b("Servizio di pulizia del bar comunale").settori, ["pulizia"]);
uguale(
  "servizio sostitutivo di mensa con badge (buoni pasto elettronici, TED bf95cc0d): nessun settore",
  gara2b("Affidamento in appalto del servizio sostitutivo di mensa a favore del personale dipendente mediante l'utilizzo di badges elettronici", ["79500000"]).settori,
  [],
);
uguale(
  "servizio di ristorazione sostitutivo della mensa (TED 9150d0f5): resta ristorazione",
  gara2b("Affidamento del servizio di ristorazione, sostitutivo della mensa obbligatoria di servizio scalo aereo e marittimo", ["55000000"]).settori,
  ["ristorazione"],
);
const ardsu = gara2b("SERVIZIO DI NAVIGAZIONE NELLE RESIDENZE E MENSE UNIVERSITARIE ARDSU, COMPRENSIVO DI FORNITURA E INSTALLAZIONE APPARATI DI CONNETTIVITÀ E ASSISTENZA E MANUTENZIONE", ["64210000", "50330000"]);
uguale("ARDSU (TED a9b7980e): connessione a internet, ristorazione C", [ardsu.settori, livelli(ardsu)], [[], [["ristorazione", "C", "servizi_di_connettivita"]]]);
const hotspot = classificaGara({
  cpvPrincipale: "85311000",
  cpvTutti: ["85311000", "55300000", "90911000"],
  testo: "Procedura di gara per l'affidamento dei servizi di gestione dei centri (c.d. hotspot) ubicati presso il porto delle Grazie di Roccella Jonica",
});
atteso("centri «hotspot» per migranti (TED 7ec698cb): non è connettività", !hotspot.valutazioni.some((v) => v.regole.includes("servizi_di_connettivita")), JSON.stringify(livelli(hotspot)));

const finanza = classificaGara({
  cpvPrincipale: "71221000",
  cpvTutti: ["71221000", "55410000"],
  testo: "Concessione mediante project financing dei servizi alla cittadinanza attraverso la riqualificazione del chiosco e dell'area adiacente, con l'erogazione di servizi alla cittadinanza garantendo il servizio di bar/punto di ristoro, la manutenzione e pulizia dell'area",
});
uguale("finanza di progetto con il bar (TED bebfee1e): nessun settore valutato due volte", finanza.valutazioni.map((v) => v.settore).length, new Set(finanza.valutazioni.map((v) => v.settore)).size);

// gare per CPV: i servizi di altri settori affidati nell'oggetto si aggiungono, le citazioni no
const ercolano = gara2b(
  "COMUNE DI ERCOLANO (NA): PROCEDURA APERTA PER L'AFFIDAMENTO DEL SERVIZIO DI PULIZIA, SANIFICAZIONE, DISINFEZIONE E DISINFESTAZIONE DEGLI IMMOBILI COMUNALI NONCHÉ DEL SERVIZIO DI RECEPTIONIST/PORTIERATO",
  ["90910000"],
);
uguale("Ercolano (TED 2cc42f92): pulizia per CPV, portierato affidato con la sua testa: A", livelli(ercolano), [["pulizia", "A", "cpv_principale"], ["vigilanza_portierato", "A", "parole_chiave"]]);
uguale(
  "pulizia, facchinaggio e disinfezione (TED 389bf9d2): facchinaggio in elenco, B",
  livelli(gara2b("Affidamento del servizio di pulizia, facchinaggio e disinfezione degli immobili comunali", ["90910000"])),
  [["pulizia", "A", "cpv_principale"], ["facchinaggio", "B", "servizio_in_elenco"]],
);
uguale(
  "pulizia «per il servizio ristorazione» (TED 6ffe89d4): la ristorazione non si aggiunge",
  gara2b("Servizi di pulizia, sanificazione e altri servizi accessori con applicazione dei CAM per il servizio ristorazione DSU Toscana", ["90910000"]).settori,
  ["pulizia"],
);
uguale(
  "vigilanza con il CPV della pulizia (Ferrovienord, TED bfc3639f): vigilanza A, pulizia B «CPV non confermato»",
  livelli(gara2b("Servizio di vigilanza e portierato da svolgersi presso le località di servizio Ferrovienord", ["90910000"])),
  [["pulizia", "B", "cpv_non_confermato"], ["vigilanza_portierato", "A", "parole_chiave"]],
);
uguale(
  "servizi integrati presso l'INGV (TED dcf5c8e5): multiservizi A, la pulizia del CPV resta A",
  livelli(gara2b("Procedura aperta, suddivisa in tre lotti, per l'affidamento triennale dei servizi integrati presso le sezioni dell'INGV", ["90911200", "98341120"])).filter((x) => x[0] !== "vigilanza_portierato"),
  [["pulizia", "A", "cpv_principale"], ["multiservizi", "A", "parole_chiave"]],
);
for (const testo of ["Affidamento dei servizi integrati di pulizia e sanificazione ambientale della casa di riposo", "Servizi integrati, gestionali e operativi, di pulizia presso uffici ARTE"]) {
  atteso(`«servizi integrati di pulizia» non è multiservizi: «${testo.slice(0, 60)}»`, !gara2b(testo, ["90910000"]).settori.includes("multiservizi"));
}
const sassari = gara2b(
  "Procedura aperta per affidamento in concessione dei servizi del bar e del parcheggio esterno con effettuazione del servizio di pulizia e guardiania dell'edificio",
  ["55410000", "98351000"],
);
uguale("Sassari (TED 0b7448d7): bar A, pulizia e guardiania accessorie B", livelli(sassari), [["ristorazione", "A", "cpv_principale"], ["pulizia", "B", "servizio_accessorio"], ["vigilanza_portierato", "B", "servizio_accessorio"]]);

// settori dai lotti: lotto autonomo A, lotto con il servizio accessorio B, regole di tutta la procedura che valgono per ogni lotto
const garaConLotti = (testo: string, cpv: string[], lotti: { testo: string; cpv: string[] }[]) => classificaGara({ cpvPrincipale: cpv[0] ?? null, cpvTutti: [...cpv, ...lotti.flatMap((l) => l.cpv)], testo, lotti });
const soloInUnLotto = garaConLotti("Servizi per le sedi della Regione", ["90910000"], [
  { testo: "Lotto 1: servizio di pulizia delle sedi", cpv: ["90910000"] },
  { testo: "Lotto 2: servizio di vigilanza armata delle sedi", cpv: ["79999000"] },
]);
uguale("settore solo in un lotto (vigilanza nel lotto 2): A, lotto autonomo", livelli(soloInUnLotto), [["pulizia", "A", "cpv_principale"], ["vigilanza_portierato", "A", "lotto_autonomo"]]);
const lottoAccessorio = garaConLotti("Servizi per gli impianti sportivi comunali", ["98341120"], [
  { testo: "Lotto 1: servizio di portierato degli impianti", cpv: ["98341120"] },
  { testo: "Lotto 2: gestione del centro sportivo comprensiva della pulizia degli spogliatoi", cpv: ["92610000"] },
]);
uguale("pulizia accessoria in un lotto: B, lotto con il servizio accessorio", livelli(lottoAccessorio), [["vigilanza_portierato", "A", "cpv_principale"], ["pulizia", "B", "lotto_accessorio"]]);
const lavori = { testo: "Lavori di ristrutturazione della sede comunale e servizi connessi", cpv: ["45000000", "90910000"] };
const lavoriLotti = [
  { testo: "Lotto 1: lavori edili", cpv: ["45000000"] },
  { testo: "Lotto 2: servizio di pulizia ordinaria degli uffici", cpv: ["90910000"] },
];
const senzaLottiLavori = classificaGara({ cpvPrincipale: "45000000", cpvTutti: lavori.cpv, testo: lavori.testo });
const conLottiLavori = garaConLotti(lavori.testo, lavori.cpv, lavoriLotti);
uguale("lavori con un lotto di pulizia: senza lotti C, con i lotti A (lotto autonomo)", [livelli(senzaLottiLavori)[0]?.[1], livelli(conLottiLavori)], ["C", [["pulizia", "A", "lotto_autonomo"]]]);
const beverello = garaConLotti(
  "procedura ad evidenza pubblica per il rilascio di una concessione demaniale marittima per la durata di anni 6, avente ad oggetto due compendi/lotti al Molo Beverello di Napoli, per lo svolgimento di attività di somministrazione di bevande ed alimenti (bar/ristorazione)",
  ["55000000"],
  [{ testo: "Lotto 1 - Bar interno", cpv: ["55000000"] }, { testo: "Lotto 1 - Bar esterno", cpv: ["55000000"] }],
);
uguale("concessione demaniale con i lotti «Bar interno» e «Bar esterno» (TED 352f212b): resta B", livelli(beverello), [["ristorazione", "B", "concessione_demaniale"]]);
const cassette = classificaGara({ cpvPrincipale: "90910000", cpvTutti: ["90910000"], testo: "Acquisto delle cassette riutilizzabili e relative attrezzature per la gestione degli imballi." });
uguale("lotto «acquisto delle cassette» con il CPV della pulizia (TED 783cfd95): fornitura, C", livelli(cassette), [["pulizia", "C", "forniture_di_beni"]]);
const unSoloLotto = { testo: "Affidamento del servizio di refezione scolastica", cpv: ["55524000"] };
uguale(
  "un solo lotto: nulla cambia",
  garaConLotti(unSoloLotto.testo, unSoloLotto.cpv, [{ testo: "Lotto unico: servizio di vigilanza", cpv: ["55524000"] }]),
  classificaGara({ cpvPrincipale: "55524000", cpvTutti: ["55524000", "55524000"], testo: unSoloLotto.testo }),
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
  cpv_nuovi_senza_oggetto: { principale: "55410000", tutti: ["55410000"], delSettore: ["55410000"] },
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
  "ristorazione: le 7 sottocategorie decise dall'utente più quella dei distributori automatici (decisione del 17/11)",
  SOTTOCATEGORIE.ristorazione.map((s) => s.id),
  ["mense", "catering", "distribuzione_pasti", "concessione_bar", "concessione_ristorante", "concessione_punto_ristoro", "distributori_automatici", "appalti_multiservizi"],
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
uguale("versione delle regole", VERSIONE_REGOLE_SETTORI, "2026-11-17g");
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
