// DATI SINTETICI per le verifiche e le anteprime delle email di Tender Intelligence (fase B4). Nessun dato reale: imprese, stazioni
// appaltanti, CIG, persone, indirizzi e collegamenti sono inventati (domini .example per fonti ed email). Usati solo da script locali.
// Forma: il contratto di B2 (src/lib/radar/notifiche/tipi.ts, versione 1), copiato in src/lib/radar/email-modelli/contratto.ts.
import type {
  DestinatarioEmail,
  EventoModifica,
  EventoRadar,
  EventoRiepilogo,
  EventoScadenza,
  EvidenzaModifica,
  GaraEmail,
  GaraRiepilogo,
  ScadenzaNota,
} from "../src/lib/radar/email-modelli";

export const IMPRESA_ALFA = { impresaId: "00000000-0000-4000-a000-00000000a1fa", nomeImpresa: "Alfa Servizi Sintetici S.r.l." };
export const IMPRESA_BETA = { impresaId: "00000000-0000-4000-a000-00000000be7a", nomeImpresa: "Beta Costruzioni Sintetiche S.p.A." };

const APP = "https://omnia-ai.it/dashboard/omnia-ai";
export const URL_PREFERENZE = `${APP}/impostazioni/notifiche`;
export const URL_PER_TE = `${APP}/opportunita/per-te`;

export const TITOLARE_ALFA: DestinatarioEmail = {
  userId: IMPRESA_ALFA.impresaId,
  impresaId: IMPRESA_ALFA.impresaId,
  ruolo: "titolare",
  email: "titolare@alfa.example",
  nome: "Laura",
  urlPreferenze: URL_PREFERENZE,
};
export const UFFICIO_GARE_ALFA: DestinatarioEmail = {
  userId: "00000000-0000-4000-a000-0000000a1fa2",
  impresaId: IMPRESA_ALFA.impresaId,
  ruolo: "ufficio_gare",
  email: "gare@alfa.example",
  nome: "Marco",
  urlPreferenze: URL_PREFERENZE,
};
export const TITOLARE_BETA: DestinatarioEmail = {
  userId: IMPRESA_BETA.impresaId,
  impresaId: IMPRESA_BETA.impresaId,
  ruolo: "titolare",
  email: "titolare@beta.example",
  nome: "Paola",
  urlPreferenze: URL_PREFERENZE,
};

/** Una scadenza (ora null = non indicata). L'istante usa +01:00, l'ora solare di novembre e dicembre. */
export function scadenza(giorno: string, ora: string | null, origine: ScadenzaNota["origine"] = "fonte"): ScadenzaNota {
  return { giorno, ora, istante: ora ? `${giorno}T${ora}:00+01:00` : null, origine };
}

export function gara(n: number, campi: Partial<GaraEmail> = {}): GaraEmail {
  const id = `00000000-0000-4000-b000-${String(n).padStart(12, "0")}`;
  return {
    chiave: `p:${id}`,
    proceduraId: id,
    aggiuntaId: null,
    denominazione: "Servizio di pulizia e sanificazione degli edifici comunali per il triennio 2027–2029",
    stazioneAppaltante: "Comune di Valleverde (dato sintetico)",
    cig: ["A0SINT0001"],
    tipoAvviso: "Bando di gara",
    scadenza: scadenza("2026-11-30", "12:00"),
    lottiConScadenzeDiverse: [],
    luogo: "Lombardia",
    urlScheda: `${APP}/opportunita/gara/${id}`,
    urlFonteUfficiale: `https://piattaforma-gare.example/procedure/${n}`,
    fonti: [{ fonte: "pvl", nome: "PVL ANAC" }],
    ultimaVerificaIl: "2026-11-19T07:42:00Z",
    aggiuntaAMano: false,
    ...campi,
  };
}

function base(n: number) {
  return { id: `00000000-0000-4000-c000-${String(n).padStart(12, "0")}`, ...IMPRESA_ALFA, creatoIl: "2026-11-19T06:00:00Z" };
}

function promemoria(n: number, tipo: EventoScadenza["tipo"], giorniMancanti: number, g: GaraEmail): EventoScadenza {
  const s = g.scadenza ?? scadenza("2026-11-30", null);
  return { ...base(n), categoria: "scadenze", tipo, versione: s.istante ?? s.giorno, giorniMancanti, gara: { ...g, scadenza: s } };
}

function evidenza(campi: Partial<EvidenzaModifica> = {}): EvidenzaModifica {
  return {
    fonte: "ted",
    nomeFonte: "TED (Gazzetta UE)",
    avvisoId: "000005-2026",
    avvisoUrl: "https://ted.example/avvisi/000005-2026",
    pubblicatoIl: "2026-11-18",
    rilevatoIl: "2026-11-19T05:10:00Z",
    affidabilita: "avviso_ufficiale",
    motivoFonte: null,
    ...campi,
  };
}

type CampiModifica = Pick<EventoModifica, "gara" | "modifiche" | "evidenza" | "scadenzaPrecedente">;

function modifica(n: number, tipo: EventoModifica["tipo"], campi: CampiModifica): EventoModifica {
  return { ...base(n), categoria: "rettifiche", tipo, versione: `m:${n}`, ...campi };
}

export const SCADENZA_10 = promemoria(1, "scadenza_10", 10, gara(1));

export const SCADENZA_5 = promemoria(
  2,
  "scadenza_5",
  5,
  gara(2, {
    denominazione: "Lavori di manutenzione straordinaria delle strade provinciali — Accordo quadro in 3 lotti",
    stazioneAppaltante: "Provincia di Monteasso (dato sintetico)",
    cig: ["A0SINT0021", "A0SINT0022", "A0SINT0023"],
    scadenza: scadenza("2026-11-25", "13:00"),
    lottiConScadenzeDiverse: [{ numero: "3", titolo: "Zona montana", cig: "A0SINT0023", scadenza: scadenza("2026-12-02", null) }],
    fonti: [
      { fonte: "ted", nome: "TED (Gazzetta UE)" },
      { fonte: "pvl", nome: "PVL ANAC" },
    ],
    luogo: "Piemonte",
  }),
);

export const SCADENZA_1 = promemoria(
  3,
  "scadenza_1",
  1,
  gara(3, {
    denominazione: "Fornitura di arredi scolastici per le scuole primarie",
    stazioneAppaltante: "Unione dei Comuni di Collealto (dato sintetico)",
    cig: ["A0SINT0031"],
    scadenza: scadenza("2026-11-20", "10:00"),
    fonti: [{ fonte: "sintel", nome: "Sintel (ARIA Lombardia)" }],
  }),
);

export const SCADENZA_RAVVICINATA = promemoria(
  4,
  "scadenza_ravvicinata",
  2,
  gara(4, {
    denominazione: "Servizio di ristorazione scolastica — anno scolastico 2027/2028",
    stazioneAppaltante: "Comune di Pianoro Sintetico (dato sintetico)",
    cig: ["A0SINT0041"],
    scadenza: scadenza("2026-11-21", "12:00"),
    fonti: [{ fonte: "sardegnacat", nome: "SardegnaCAT" }],
    luogo: "Sardegna",
  }),
);

export const RETTIFICA = modifica(5, "rettifica", {
  gara: gara(5, { tipoAvviso: "Avviso di rettifica", fonti: [{ fonte: "ted", nome: "TED (Gazzetta UE)" }], urlFonteUfficiale: "https://ted.example/avvisi/000005-2026" }),
  modifiche: [
    { campo: "importo", etichetta: "Importo a base di gara", prima: "1.250.000,00 €", dopo: "1.310.000,00 €" },
    { campo: "lotti", etichetta: "Numero dei lotti", prima: "2", dopo: "3" },
  ],
  evidenza: evidenza({ motivoFonte: "Correzione da parte dell'amministrazione" }),
  scadenzaPrecedente: null,
});

export const RETTIFICA_SENZA_DETTAGLIO = modifica(6, "rettifica", {
  gara: gara(6, { tipoAvviso: "Avviso di rettifica", fonti: [{ fonte: "ted", nome: "TED (Gazzetta UE)" }] }),
  modifiche: [],
  evidenza: evidenza({ avvisoId: "000006-2026", avvisoUrl: "https://ted.example/avvisi/000006-2026" }),
  scadenzaPrecedente: null,
});

export const PROROGA = modifica(7, "proroga", {
  gara: gara(7, {
    denominazione: "Servizio di manutenzione del verde pubblico",
    cig: ["A0SINT0071"],
    scadenza: scadenza("2026-12-09", "12:00"),
    tipoAvviso: "Avviso di proroga dei termini",
  }),
  modifiche: [{ campo: "scadenza", etichetta: "Scadenza per la presentazione delle offerte", prima: "25 novembre 2026, ore 12:00", dopo: "9 dicembre 2026, ore 12:00" }],
  evidenza: evidenza({ fonte: "pvl", nomeFonte: "PVL ANAC", avvisoId: null, avvisoUrl: "https://piattaforma-gare.example/procedure/7/proroga", affidabilita: "confronto_versioni" }),
  scadenzaPrecedente: scadenza("2026-11-25", "12:00"),
});

export const MODIFICA_SCADENZA = modifica(11, "modifica_scadenza", {
  gara: gara(11, {
    denominazione: "Servizio di trasporto disabili",
    cig: ["A0SINT0111"],
    scadenza: scadenza("2026-11-27", null),
    tipoAvviso: "Avviso di rettifica",
  }),
  modifiche: [{ campo: "scadenza", etichetta: "Scadenza per la presentazione delle offerte", prima: "4 dicembre 2026", dopo: "27 novembre 2026" }],
  evidenza: evidenza({ fonte: "sintel", nomeFonte: "Sintel (ARIA Lombardia)", avvisoId: null, avvisoUrl: null, affidabilita: "confronto_versioni" }),
  scadenzaPrecedente: scadenza("2026-12-04", null),
});

export const DOCUMENTI = modifica(8, "documenti", {
  gara: gara(8, { denominazione: "Servizio di vigilanza armata delle sedi aziendali", stazioneAppaltante: "Azienda sanitaria sintetica di Valleverde", cig: ["A0SINT0081"] }),
  modifiche: [
    { campo: "documenti", etichetta: "Capitolato speciale d'appalto", prima: "versione del 2 novembre 2026", dopo: "versione 2 del 17 novembre 2026" },
    { campo: "documenti", etichetta: "Risposte ai quesiti", prima: null, dopo: "quesiti n. 1–6, pubblicati il 17 novembre 2026" },
  ],
  evidenza: evidenza({ fonte: "pvl", nomeFonte: "PVL ANAC", avvisoId: null, avvisoUrl: "https://piattaforma-gare.example/procedure/8/comunicazioni", pubblicatoIl: "2026-11-17" }),
  scadenzaPrecedente: null,
});

export const ANNULLAMENTO = modifica(12, "annullamento", {
  gara: gara(12, { denominazione: "Servizio di gestione del centro estivo comunale", cig: ["A0SINT0121"], tipoAvviso: "Avviso di annullamento" }),
  modifiche: [],
  evidenza: evidenza({ avvisoId: "000012-2026", avvisoUrl: "https://ted.example/avvisi/000012-2026", motivoFonte: "Procedura annullata in autotutela" }),
  scadenzaPrecedente: null,
});

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
const FONTI = [
  { fonte: "pvl", nome: "PVL ANAC" },
  { fonte: "ted", nome: "TED (Gazzetta UE)" },
  { fonte: "sintel", nome: "Sintel (ARIA Lombardia)" },
  { fonte: "sardegnacat", nome: "SardegnaCAT" },
];

const GARE_RIEPILOGO: GaraRiepilogo[] = OGGETTI_RIEPILOGO.map((denominazione, i) => ({
  ...gara(100 + i, {
    denominazione,
    stazioneAppaltante: `Ente sintetico n. ${i + 1}`,
    cig: [`A0SINT${String(100 + i).padStart(4, "0")}`],
    scadenza: scadenza(`2026-12-${String(4 + (i % 20)).padStart(2, "0")}`, i % 4 === 3 ? null : "12:00"),
    fonti: [FONTI[i % FONTI.length]],
    luogo: REGIONI[i % REGIONI.length],
  }),
  settori: [{ settore: "pulizia", nome: "Pulizia", sottocategorie: [] }],
  perche: [`nel tuo profilo: Pulizia · ${REGIONI[i % REGIONI.length]}`],
}));

/** 23 gare: il motore ne manda al più 20, qui si prova anche il tetto difensivo del modello (le 3 in più contano tra le «altre»). */
export const NUOVE_OPPORTUNITA: EventoRiepilogo = {
  ...base(9),
  categoria: "nuove_opportunita",
  tipo: "riepilogo_opportunita",
  versione: "2026-11-19",
  urlPerTe: URL_PER_TE,
  altreNonIncluse: 0,
  gare: GARE_RIEPILOGO,
};

/** Come lo manda il motore: 20 gare elencate e 3 non incluse. */
export const NUOVE_OPPORTUNITA_MOTORE: EventoRiepilogo = { ...NUOVE_OPPORTUNITA, gare: GARE_RIEPILOGO.slice(0, 20), altreNonIncluse: 3 };

export const CASO_ORA_NON_NOTA = promemoria(
  13,
  "scadenza_5",
  5,
  gara(13, { denominazione: "Servizio di assistenza domiciliare agli anziani", scadenza: scadenza("2026-11-25", null), fonti: [{ fonte: "pvl", nome: "PVL ANAC" }] }),
);

export const CASO_CIG_ASSENTE = promemoria(
  14,
  "scadenza_10",
  10,
  gara(14, {
    denominazione: "Concessione del servizio bar presso il centro sportivo comunale",
    cig: [],
    tipoAvviso: "Avviso pubblico",
    fonti: [{ fonte: "ted", nome: "TED (Gazzetta UE)" }],
  }),
);

export const CASO_AGGIUNTA_A_MANO = promemoria(
  15,
  "scadenza_5",
  5,
  gara(15, {
    chiave: "a:00000000-0000-4000-d000-000000000015",
    proceduraId: null,
    aggiuntaId: "00000000-0000-4000-d000-000000000015",
    denominazione: "Gara privata di manutenzione impianti (aggiunta dall'impresa)",
    stazioneAppaltante: "Committente sintetico",
    cig: [],
    tipoAvviso: null,
    scadenza: scadenza("2026-11-25", null, "impresa"),
    luogo: null,
    urlScheda: `${APP}/opportunita/aggiunta/00000000-0000-4000-d000-000000000015`,
    urlFonteUfficiale: null,
    fonti: [],
    aggiuntaAMano: true,
  }),
);

/** Un evento dell'impresa Beta, per le prove di separazione tra imprese. */
export const SCADENZA_10_BETA: EventoScadenza = {
  ...promemoria(900, "scadenza_10", 10, gara(900, { denominazione: "GARA-RISERVATA-BETA servizio sintetico", stazioneAppaltante: "STAZIONE-RISERVATA-BETA", cig: ["BETA000001"] })),
  ...IMPRESA_BETA,
};

/** Le anteprime per l'utente: nome del file, titolo, evento, destinatario. */
export const ANTEPRIME: { file: string; titolo: string; evento: EventoRadar; destinatario: DestinatarioEmail }[] = [
  { file: "01-scadenza-10-giorni", titolo: "A. Scadenza tra 10 giorni", evento: SCADENZA_10, destinatario: TITOLARE_ALFA },
  { file: "02-scadenza-5-giorni", titolo: "B. Scadenza tra 5 giorni (più lotti, un lotto con scadenza diversa, più fonti)", evento: SCADENZA_5, destinatario: TITOLARE_ALFA },
  { file: "03-scadenza-1-giorno", titolo: "C. Scadenza domani (destinatario: Ufficio Gare)", evento: SCADENZA_1, destinatario: UFFICIO_GARE_ALFA },
  { file: "04-rettifica", titolo: "D. Rettifica con i cambiamenti dall'avviso ufficiale", evento: RETTIFICA, destinatario: TITOLARE_ALFA },
  { file: "05-rettifica-senza-dettaglio", titolo: "D. Avviso ufficiale di modifica senza campi cambiati (rimando all'avviso)", evento: RETTIFICA_SENZA_DETTAGLIO, destinatario: UFFICIO_GARE_ALFA },
  { file: "06-proroga", titolo: "E. Proroga della scadenza", evento: PROROGA, destinatario: TITOLARE_ALFA },
  { file: "07-modifica-scadenza", titolo: "E. Scadenza modificata (anticipata, ora non indicata)", evento: MODIFICA_SCADENZA, destinatario: TITOLARE_ALFA },
  { file: "08-documenti", titolo: "F. Documenti sostitutivi o integrativi", evento: DOCUMENTI, destinatario: TITOLARE_ALFA },
  { file: "09-annullamento", titolo: "Proposta di B2: gara annullata (categoria rettifiche)", evento: ANNULLAMENTO, destinatario: TITOLARE_ALFA },
  { file: "10-nuove-opportunita", titolo: "Riepilogo nuove opportunità (20 elencate + 3 in «Per te»)", evento: NUOVE_OPPORTUNITA_MOTORE, destinatario: TITOLARE_ALFA },
  { file: "11-caso-ora-non-nota", titolo: "Caso: ora della scadenza non indicata dalla fonte", evento: CASO_ORA_NON_NOTA, destinatario: UFFICIO_GARE_ALFA },
  { file: "12-caso-cig-assente", titolo: "Caso: CIG assente", evento: CASO_CIG_ASSENTE, destinatario: TITOLARE_ALFA },
  { file: "13-caso-gara-aggiunta-a-mano", titolo: "Caso: gara aggiunta a mano dall'impresa (nessuna fonte ufficiale)", evento: CASO_AGGIUNTA_A_MANO, destinatario: TITOLARE_ALFA },
  { file: "14-scadenza-ravvicinata", titolo: "Proposta (da decidere): avviso immediato per scadenza ravvicinata", evento: SCADENZA_RAVVICINATA, destinatario: TITOLARE_ALFA },
];
