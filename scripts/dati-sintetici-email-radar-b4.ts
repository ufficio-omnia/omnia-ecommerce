// DATI SINTETICI per le verifiche e le anteprime delle email di Tender Intelligence (fase B4). Nessun dato reale: imprese, stazioni
// appaltanti, CIG, persone e collegamenti sono inventati (domini .example per le fonti). Usati solo da script locali.
import type { DestinatarioEmailRadar, EventoEmailRadar, GaraEmailRadar } from "../src/lib/radar/email-modelli";

type Evento<T extends EventoEmailRadar["tipo"]> = Extract<EventoEmailRadar, { tipo: T }>;
type Promemoria = Evento<"scadenza_10" | "scadenza_5" | "scadenza_1">;

export const IMPRESA_ALFA = { impresaId: "00000000-0000-4000-a000-00000000a1fa", impresaNome: "Alfa Servizi Sintetici S.r.l." };
export const IMPRESA_BETA = { impresaId: "00000000-0000-4000-a000-00000000be7a", impresaNome: "Beta Costruzioni Sintetiche S.p.A." };

const APP = "https://omnia-ai.it/dashboard/omnia-ai";
export const URL_PREFERENZE = `${APP}/impostazioni/notifiche`;
export const URL_PER_TE = `${APP}/opportunita/per-te`;

export const TITOLARE_ALFA: DestinatarioEmailRadar = { impresaId: IMPRESA_ALFA.impresaId, nome: "Laura", ruolo: "titolare" };
export const UFFICIO_GARE_ALFA: DestinatarioEmailRadar = { impresaId: IMPRESA_ALFA.impresaId, nome: "Marco", ruolo: "ufficio_gare" };
export const TITOLARE_BETA: DestinatarioEmailRadar = { impresaId: IMPRESA_BETA.impresaId, nome: "Paola", ruolo: "titolare" };

function scheda(n: number): string {
  return `${APP}/opportunita/gara/00000000-0000-4000-b000-${String(n).padStart(12, "0")}`;
}

export function gara(n: number, campi: Partial<GaraEmailRadar> = {}): GaraEmailRadar {
  return {
    oggetto: "Servizio di pulizia e sanificazione degli edifici comunali per il triennio 2027–2029",
    stazioneAppaltante: "Comune di Valleverde (dato sintetico)",
    cig: ["A0SINT0001"],
    scadenza: { giorno: "2026-11-30", ora: "12:00" },
    tipoAvviso: "Bando di gara",
    fonti: ["PVL ANAC"],
    luogo: "Lombardia",
    urlScheda: scheda(n),
    urlFonte: `https://piattaforma-gare.example/procedure/${n}`,
    ultimaVerifica: "2026-11-19T07:42:00Z",
    ...campi,
  };
}

const BASE_ALFA = { ...IMPRESA_ALFA, urlPreferenze: URL_PREFERENZE };
const BASE_BETA = { ...IMPRESA_BETA, urlPreferenze: URL_PREFERENZE };

export const SCADENZA_10: Promemoria = { ...BASE_ALFA, tipo: "scadenza_10", gara: gara(1) };

export const SCADENZA_5: Promemoria = {
  ...BASE_ALFA,
  tipo: "scadenza_5",
  gara: gara(2, {
    oggetto: "Lavori di manutenzione straordinaria delle strade provinciali — Accordo quadro in 3 lotti",
    stazioneAppaltante: "Provincia di Monteasso (dato sintetico)",
    cig: ["A0SINT0021", "A0SINT0022", "A0SINT0023"],
    scadenza: { giorno: "2026-11-25", ora: "13:00" },
    fonti: ["TED", "PVL ANAC"],
    luogo: "Piemonte",
  }),
};

export const SCADENZA_1: Promemoria = {
  ...BASE_ALFA,
  tipo: "scadenza_1",
  gara: gara(3, {
    oggetto: "Fornitura di arredi scolastici per le scuole primarie",
    stazioneAppaltante: "Unione dei Comuni di Collealto (dato sintetico)",
    cig: ["A0SINT0031"],
    scadenza: { giorno: "2026-11-20", ora: "10:00" },
    fonti: ["Sintel"],
  }),
};

export const SCADENZA_RAVVICINATA: Evento<"scadenza_ravvicinata"> = {
  ...BASE_ALFA,
  tipo: "scadenza_ravvicinata",
  giorniMancanti: 3,
  gara: gara(4, {
    oggetto: "Servizio di ristorazione scolastica — anno scolastico 2027/2028",
    stazioneAppaltante: "Comune di Pianoro Sintetico (dato sintetico)",
    cig: ["A0SINT0041"],
    scadenza: { giorno: "2026-11-22", ora: "12:00" },
    fonti: ["SardegnaCAT"],
    luogo: "Sardegna",
  }),
};

export const RETTIFICA: Evento<"rettifica"> = {
  ...BASE_ALFA,
  tipo: "rettifica",
  gara: gara(5, { tipoAvviso: "Avviso di rettifica", fonti: ["TED"], urlFonte: "https://ted.example/avvisi/000005-2026" }),
  modifiche: [
    { campo: "Importo a base di gara", prima: "1.250.000,00 €", dopo: "1.310.000,00 €" },
    { campo: "Requisito di capacità tecnica", prima: "Fatturato specifico triennale di 500.000 €", dopo: "Fatturato specifico triennale di 450.000 €" },
  ],
  evidenza: { avviso: "Avviso di rettifica n. 2026/S 000-000005", url: "https://ted.example/avvisi/000005-2026", pubblicatoIl: "2026-11-18" },
};

export const RETTIFICA_SENZA_DETTAGLIO: Evento<"rettifica"> = {
  ...BASE_ALFA,
  tipo: "rettifica",
  gara: gara(6, { tipoAvviso: "Avviso di rettifica", fonti: ["Sintel"] }),
  modifiche: [],
  evidenza: { avviso: "Avviso di rettifica", url: "https://piattaforma-gare.example/procedure/6/rettifica", pubblicatoIl: "2026-11-18" },
};

export const PROROGA: Evento<"proroga"> = {
  ...BASE_ALFA,
  tipo: "proroga",
  gara: gara(7, {
    oggetto: "Servizio di manutenzione del verde pubblico",
    stazioneAppaltante: "Comune di Valleverde (dato sintetico)",
    cig: ["A0SINT0071"],
    scadenza: { giorno: "2026-12-09", ora: "12:00" },
    tipoAvviso: "Avviso di proroga dei termini",
  }),
  scadenzaPrecedente: { giorno: "2026-11-25", ora: "12:00" },
  evidenza: { avviso: "Avviso di proroga dei termini", url: "https://piattaforma-gare.example/procedure/7/proroga", pubblicatoIl: "2026-11-18" },
};

export const DOCUMENTI: Evento<"documenti"> = {
  ...BASE_ALFA,
  tipo: "documenti",
  gara: gara(8, { oggetto: "Servizio di vigilanza armata delle sedi aziendali", stazioneAppaltante: "Azienda sanitaria sintetica di Valleverde", cig: ["A0SINT0081"] }),
  documenti: [
    { nome: "Capitolato speciale d'appalto — versione 2", natura: "sostitutivo", url: "https://piattaforma-gare.example/procedure/8/capitolato-v2.pdf" },
    { nome: "Risposte ai quesiti n. 1–6", natura: "integrativo", url: "https://piattaforma-gare.example/procedure/8/quesiti.pdf" },
  ],
  evidenza: { avviso: "Comunicazione della stazione appaltante", url: "https://piattaforma-gare.example/procedure/8/comunicazioni", pubblicatoIl: "2026-11-17" },
};

const OGGETTI_RIEPILOGO = [
  "Servizio di pulizia degli uffici giudiziari",
  "Fornitura di materiale di cancelleria per le scuole",
  "Lavori di riqualificazione energetica della palestra comunale",
  "Servizio di trasporto scolastico",
  "Servizio di manutenzione degli impianti elettrici",
  "Fornitura di dispositivi di protezione individuale",
  "Servizio di sanificazione dei mezzi pubblici",
  "Lavori di rifacimento della copertura del municipio",
  "Servizio di gestione della biblioteca civica",
  "Servizio di pulizia delle aree verdi",
  "Fornitura di attrezzature per la mensa scolastica",
  "Servizio di facchinaggio e traslochi",
  "Lavori di manutenzione dei marciapiedi",
  "Servizio di custodia e portierato",
  "Fornitura di arredi per uffici",
  "Servizio di disinfestazione e derattizzazione",
  "Lavori di adeguamento antincendio della scuola media",
  "Servizio di pulizia delle strutture sanitarie",
  "Fornitura di prodotti per l'igiene",
  "Servizio di manutenzione del verde scolastico",
  "Servizio di lavanolo",
  "Lavori di efficientamento della pubblica illuminazione",
  "Servizio di raccolta dei rifiuti ingombranti",
];
const REGIONI = ["Lombardia", "Piemonte", "Veneto", "Emilia-Romagna", "Toscana"];
const FONTI = ["PVL ANAC", "TED", "Sintel", "SardegnaCAT"];

export const NUOVE_OPPORTUNITA: Evento<"nuove_opportunita"> = {
  ...BASE_ALFA,
  tipo: "nuove_opportunita",
  urlPerTe: URL_PER_TE,
  altre: 0,
  gare: OGGETTI_RIEPILOGO.map((oggetto, i) =>
    gara(100 + i, {
      oggetto,
      stazioneAppaltante: `Ente sintetico n. ${i + 1}`,
      cig: [`A0SINT${String(100 + i).padStart(4, "0")}`],
      scadenza: { giorno: `2026-12-${String(4 + (i % 20)).padStart(2, "0")}`, ora: i % 4 === 3 ? null : "12:00" },
      fonti: [FONTI[i % FONTI.length]],
      luogo: REGIONI[i % REGIONI.length],
    }),
  ),
};

export const CASO_ORA_NON_NOTA: Promemoria = {
  ...BASE_ALFA,
  tipo: "scadenza_5",
  gara: gara(9, { oggetto: "Servizio di assistenza domiciliare agli anziani", scadenza: { giorno: "2026-11-25", ora: null }, fonti: ["PVL ANAC"] }),
};

export const CASO_CIG_ASSENTE: Promemoria = {
  ...BASE_ALFA,
  tipo: "scadenza_10",
  gara: gara(10, { oggetto: "Concessione del servizio bar presso il centro sportivo comunale", cig: [], tipoAvviso: "Avviso pubblico", fonti: ["TED"] }),
};

/** Un evento dell'impresa Beta, per le prove di separazione tra imprese. */
export const SCADENZA_10_BETA: Promemoria = {
  ...BASE_BETA,
  tipo: "scadenza_10",
  gara: gara(900, { oggetto: "GARA-RISERVATA-BETA servizio sintetico", stazioneAppaltante: "STAZIONE-RISERVATA-BETA", cig: ["BETA000001"] }),
};

/** Le anteprime per l'utente: nome del file, titolo, evento, destinatario. */
export const ANTEPRIME: { file: string; titolo: string; evento: EventoEmailRadar; destinatario: DestinatarioEmailRadar }[] = [
  { file: "01-scadenza-10-giorni", titolo: "A. Scadenza tra 10 giorni", evento: SCADENZA_10, destinatario: TITOLARE_ALFA },
  { file: "02-scadenza-5-giorni", titolo: "B. Scadenza tra 5 giorni (più lotti, più fonti)", evento: SCADENZA_5, destinatario: TITOLARE_ALFA },
  { file: "03-scadenza-1-giorno", titolo: "C. Scadenza domani", evento: SCADENZA_1, destinatario: UFFICIO_GARE_ALFA },
  { file: "04-rettifica", titolo: "D. Rettifica con i cambiamenti dall'avviso", evento: RETTIFICA, destinatario: TITOLARE_ALFA },
  { file: "05-rettifica-senza-dettaglio", titolo: "D. Rettifica senza dettaglio leggibile", evento: RETTIFICA_SENZA_DETTAGLIO, destinatario: UFFICIO_GARE_ALFA },
  { file: "06-proroga-scadenza", titolo: "E. Proroga / modifica della scadenza", evento: PROROGA, destinatario: TITOLARE_ALFA },
  { file: "07-documenti", titolo: "F. Documenti sostitutivi o integrativi", evento: DOCUMENTI, destinatario: TITOLARE_ALFA },
  { file: "08-nuove-opportunita", titolo: "Riepilogo nuove opportunità (20 mostrate + 3)", evento: NUOVE_OPPORTUNITA, destinatario: TITOLARE_ALFA },
  { file: "09-caso-ora-non-nota", titolo: "Caso: ora della scadenza non indicata dalla fonte", evento: CASO_ORA_NON_NOTA, destinatario: UFFICIO_GARE_ALFA },
  { file: "10-caso-cig-assente", titolo: "Caso: CIG assente", evento: CASO_CIG_ASSENTE, destinatario: TITOLARE_ALFA },
  { file: "11-scadenza-ravvicinata", titolo: "Proposta: avviso immediato per scadenza ravvicinata (da decidere)", evento: SCADENZA_RAVVICINATA, destinatario: TITOLARE_ALFA },
];
