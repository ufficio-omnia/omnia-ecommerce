// DATI SINTETICI per le verifiche e le anteprime delle email di Tender Intelligence (fase B4). Nessun dato reale: imprese, stazioni
// appaltanti, CIG, persone, indirizzi e collegamenti sono inventati (domini .example per fonti ed email). Usati solo da script locali.
// Forma: il contratto di B2, src/lib/radar/notifiche/tipi.ts VERSIONE 2 (scadenze per gruppo di lotti, email raggruppata degli urgenti).
import type {
  ContenutoEmail,
  DestinatarioEmail,
  EventoModifica,
  EventoRaggruppato,
  EventoRiepilogo,
  EventoScadenza,
  EvidenzaModifica,
  GaraEmail,
  GaraRiepilogo,
  GruppoScadenza,
  LottoEmail,
  ModificaRilevata,
  ScadenzaNota,
} from "../src/lib/radar/email-modelli";

export const IMPRESA_ALFA = { impresaId: "00000000-0000-4000-a000-00000000a1fa", nomeImpresa: "Alfa Servizi Sintetici S.r.l." };
export const IMPRESA_BETA = { impresaId: "00000000-0000-4000-a000-00000000be7a", nomeImpresa: "Beta Costruzioni Sintetiche S.p.A." };

const APP = "https://omnia-ai.it/dashboard/omnia-ai";
export const URL_PREFERENZE = `${APP}/opportunita/notifiche`;
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

export function lotto(numero: string | null, cig: string | null, titolo: string | null = null): LottoEmail {
  return { numero, titolo, cig };
}

/** Un gruppo di scadenza: ambito «procedura» senza lotti, oppure i lotti che condividono la scadenza. */
export function gruppo(s: ScadenzaNota, lotti: LottoEmail[] = []): GruppoScadenza {
  return { scadenza: s, ambito: lotti.length ? "lotti" : "procedura", lotti };
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
    scadenze: [gruppo(scadenza("2026-11-30", "12:00"))],
    lottiSenzaScadenza: [],
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

/** Un promemoria per UN gruppo della gara (di base il primo, il più vicino). */
function promemoria(n: number, tipo: EventoScadenza["tipo"], giorniMancanti: number, g: GaraEmail, quale = 0): EventoScadenza {
  const gr = g.scadenze[quale];
  return { ...base(n), categoria: "scadenze", tipo, versione: gr.scadenza.istante ?? gr.scadenza.giorno, giorniMancanti, gara: g, gruppo: gr };
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

export function mod(campo: ModificaRilevata["campo"], etichetta: string, prima: string | null, dopo: string | null, lotti: LottoEmail[] = []): ModificaRilevata {
  return { campo, etichetta, prima, dopo, lotti };
}

type CampiModifica = Pick<EventoModifica, "gara" | "modifiche" | "evidenza" | "cambioScadenza">;

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
    scadenze: [gruppo(scadenza("2026-11-25", "13:00"))],
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
    scadenze: [gruppo(scadenza("2026-11-20", "10:00"))],
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
    scadenze: [gruppo(scadenza("2026-11-21", "12:00"))],
    fonti: [{ fonte: "sardegnacat", nome: "SardegnaCAT" }],
    luogo: "Sardegna",
  }),
);

export const RETTIFICA = modifica(5, "rettifica", {
  gara: gara(5, { tipoAvviso: "Avviso di rettifica", fonti: [{ fonte: "ted", nome: "TED (Gazzetta UE)" }], urlFonteUfficiale: "https://ted.example/avvisi/000005-2026" }),
  modifiche: [mod("importo", "Importo a base di gara", "1.250.000,00 €", "1.310.000,00 €"), mod("lotti", "Numero dei lotti", "2", "3")],
  evidenza: evidenza({ motivoFonte: "Correzione da parte dell'amministrazione" }),
  cambioScadenza: null,
});

export const RETTIFICA_SENZA_DETTAGLIO = modifica(6, "rettifica", {
  gara: gara(6, { tipoAvviso: "Avviso di rettifica", fonti: [{ fonte: "ted", nome: "TED (Gazzetta UE)" }] }),
  modifiche: [],
  evidenza: evidenza({ avvisoId: "000006-2026", avvisoUrl: "https://ted.example/avvisi/000006-2026" }),
  cambioScadenza: null,
});

export const PROROGA = modifica(7, "proroga", {
  gara: gara(7, { denominazione: "Servizio di manutenzione del verde pubblico", cig: ["A0SINT0071"], scadenze: [gruppo(scadenza("2026-12-09", "12:00"))], tipoAvviso: "Avviso di proroga dei termini" }),
  modifiche: [mod("scadenza", "Scadenza per la presentazione delle offerte", "25 novembre 2026, ore 12:00", "9 dicembre 2026, ore 12:00")],
  evidenza: evidenza({ fonte: "pvl", nomeFonte: "PVL ANAC", avvisoId: null, avvisoUrl: "https://piattaforma-gare.example/procedure/7/proroga", affidabilita: "confronto_versioni" }),
  cambioScadenza: { precedente: scadenza("2026-11-25", "12:00"), nuova: scadenza("2026-12-09", "12:00"), lotti: [] },
});

export const MODIFICA_SCADENZA = modifica(11, "modifica_scadenza", {
  gara: gara(11, { denominazione: "Servizio di trasporto disabili", fonti: [{ fonte: "sintel", nome: "Sintel (ARIA Lombardia)" }], cig: ["A0SINT0111"], scadenze: [gruppo(scadenza("2026-11-27", null))], tipoAvviso: "Avviso di rettifica" }),
  modifiche: [mod("scadenza", "Scadenza per la presentazione delle offerte", "4 dicembre 2026", "27 novembre 2026")],
  evidenza: evidenza({ fonte: "sintel", nomeFonte: "Sintel (ARIA Lombardia)", avvisoId: null, avvisoUrl: null, affidabilita: "confronto_versioni" }),
  cambioScadenza: { precedente: scadenza("2026-12-04", null), nuova: scadenza("2026-11-27", null), lotti: [] },
});

export const DOCUMENTI = modifica(8, "documenti", {
  gara: gara(8, { denominazione: "Servizio di vigilanza armata delle sedi aziendali", stazioneAppaltante: "Azienda sanitaria sintetica di Valleverde", cig: ["A0SINT0081"] }),
  modifiche: [
    mod("documenti", "Capitolato speciale d'appalto", "versione del 2 novembre 2026", "versione 2 del 17 novembre 2026"),
    mod("documenti", "Risposte ai quesiti", null, "quesiti n. 1–6, pubblicati il 17 novembre 2026"),
  ],
  evidenza: evidenza({ fonte: "pvl", nomeFonte: "PVL ANAC", avvisoId: null, avvisoUrl: "https://piattaforma-gare.example/procedure/8/comunicazioni", pubblicatoIl: "2026-11-17" }),
  cambioScadenza: null,
});

export const ANNULLAMENTO = modifica(12, "annullamento", {
  gara: gara(12, { denominazione: "Servizio di gestione del centro estivo comunale", cig: ["A0SINT0121"], tipoAvviso: "Avviso di annullamento", fonti: [{ fonte: "ted", nome: "TED (Gazzetta UE)" }] }),
  modifiche: [],
  evidenza: evidenza({ avvisoId: "000012-2026", avvisoUrl: "https://ted.example/avvisi/000012-2026", motivoFonte: "Procedura annullata in autotutela" }),
  cambioScadenza: null,
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
    scadenze:
      i === 5
        ? [gruppo(scadenza("2026-12-05", "12:00"), [lotto("1", "A0SINT0601")]), gruppo(scadenza("2026-12-12", "12:00"), [lotto("2", "A0SINT0602")])]
        : [gruppo(scadenza(`2026-12-${String(4 + (i % 20)).padStart(2, "0")}`, i % 4 === 3 ? null : "12:00"))],
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
  gara(13, { denominazione: "Servizio di assistenza domiciliare agli anziani", scadenze: [gruppo(scadenza("2026-11-25", null))], fonti: [{ fonte: "pvl", nome: "PVL ANAC" }] }),
);

export const CASO_CIG_ASSENTE = promemoria(
  14,
  "scadenza_10",
  10,
  gara(14, { denominazione: "Concessione del servizio bar presso il centro sportivo comunale", cig: [], tipoAvviso: "Avviso pubblico", fonti: [{ fonte: "ted", nome: "TED (Gazzetta UE)" }] }),
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
    scadenze: [gruppo(scadenza("2026-11-25", null, "impresa"))],
    luogo: null,
    urlScheda: `${APP}/opportunita/aggiunta/00000000-0000-4000-d000-000000000015`,
    urlFonteUfficiale: null,
    fonti: [],
    aggiuntaAMano: true,
  }),
);

// ───── v2: scadenze per gruppo di lotti, proroga di un lotto, email raggruppata degli urgenti ─────

export const LOTTI_A = [lotto("1", "A0SINT1601", "Zona nord"), lotto("2", "A0SINT1602", "Zona sud")];
export const LOTTI_B = [lotto("3", "A0SINT1603", "Zona montana"), lotto("4", "A0SINT1604", "Isole")];
const GARA_DUE_GRUPPI = gara(16, {
  denominazione: "Servizio di pulizia delle sedi dell'Azienda sanitaria sintetica — 4 lotti",
  stazioneAppaltante: "Azienda sanitaria sintetica di Valleverde",
  cig: ["A0SINT1601", "A0SINT1602", "A0SINT1603", "A0SINT1604"],
  scadenze: [gruppo(scadenza("2026-11-25", "12:00"), LOTTI_A), gruppo(scadenza("2026-12-02", null), LOTTI_B)],
  fonti: [{ fonte: "ted", nome: "TED (Gazzetta UE)" }],
});
/** Due gruppi di lotti a scadenze diverse: il promemoria a 5 giorni riguarda SOLO i lotti 1 e 2. */
export const DUE_GRUPPI = promemoria(16, "scadenza_5", 5, GARA_DUE_GRUPPI, 0);
/** Lo stesso, per il secondo gruppo (lotti 3 e 4): serie di promemoria separata. */
export const DUE_GRUPPI_SECONDO = promemoria(161, "scadenza_10", 10, GARA_DUE_GRUPPI, 1);

/** Un solo gruppo di lotti con più CIG (tutti i lotti hanno la stessa scadenza). */
export const PIU_CIG = promemoria(
  17,
  "scadenza_10",
  10,
  gara(17, {
    denominazione: "Fornitura di prodotti per la pulizia — 3 lotti",
    cig: ["A0SINT1701", "A0SINT1702", "A0SINT1703"],
    scadenze: [gruppo(scadenza("2026-11-30", "12:00"), [lotto("1", "A0SINT1701", "Detergenti"), lotto("2", "A0SINT1702", "Carta"), lotto("3", "A0SINT1703", "Attrezzature")])],
  }),
);

/** Lotti con scadenza e un lotto SENZA scadenza indicata dalla fonte, elencato a parte (mai con una scadenza attribuita). */
export const LOTTI_SENZA_SCADENZA = promemoria(
  18,
  "scadenza_10",
  10,
  gara(18, {
    denominazione: "Servizio di sanificazione dei mezzi pubblici — 3 lotti",
    cig: ["A0SINT1801", "A0SINT1802", "A0SINT1803"],
    scadenze: [gruppo(scadenza("2026-11-30", "10:00"), [lotto("1", "A0SINT1801"), lotto("2", "A0SINT1802")])],
    lottiSenzaScadenza: [lotto("3", "A0SINT1803", "Linee extraurbane")],
  }),
);

/** Proroga di UN solo lotto: la gara ha due scadenze, cambia solo quella del lotto 2. */
export const PROROGA_LOTTO = modifica(19, "proroga", {
  gara: gara(19, {
    denominazione: "Servizio di vigilanza delle sedi universitarie — 2 lotti",
    cig: ["A0SINT1901", "A0SINT1902"],
    scadenze: [gruppo(scadenza("2026-11-27", "12:00"), [lotto("1", "A0SINT1901", "Campus centrale")]), gruppo(scadenza("2026-12-11", "12:00"), [lotto("2", "A0SINT1902", "Sedi periferiche")])],
    tipoAvviso: "Avviso di proroga dei termini",
    fonti: [{ fonte: "ted", nome: "TED (Gazzetta UE)" }],
  }),
  modifiche: [mod("scadenza", "Scadenza per la presentazione delle offerte", "27 novembre 2026, ore 12:00", "11 dicembre 2026, ore 12:00", [lotto("2", "A0SINT1902", "Sedi periferiche")])],
  evidenza: evidenza({ avvisoId: "000019-2026", avvisoUrl: "https://ted.example/avvisi/000019-2026" }),
  cambioScadenza: { precedente: scadenza("2026-11-27", "12:00"), nuova: scadenza("2026-12-11", "12:00"), lotti: [lotto("2", "A0SINT1902", "Sedi periferiche")] },
});

/** Email raggruppata degli urgenti di una persona oltre il tetto: una scadenza a 1 giorno e due rettifiche. */
export const RAGGRUPPATO: EventoRaggruppato = {
  tipo: "raggruppamento_urgenti",
  id: "00000000-0000-4000-e000-000000000020",
  ...IMPRESA_ALFA,
  versione: "r:sintetica",
  creatoIl: "2026-11-19T06:30:00Z",
  eventi: [SCADENZA_1, RETTIFICA, RETTIFICA_SENZA_DETTAGLIO],
};

/** Un evento dell'impresa Beta, per le prove di separazione tra imprese. */
export const SCADENZA_10_BETA: EventoScadenza = {
  ...promemoria(900, "scadenza_10", 10, gara(900, { denominazione: "GARA-RISERVATA-BETA servizio sintetico", stazioneAppaltante: "STAZIONE-RISERVATA-BETA", cig: ["BETA000001"] })),
  ...IMPRESA_BETA,
};

/** Le anteprime per l'utente: nome del file, titolo, contenuto, destinatario. */
export const ANTEPRIME: { file: string; titolo: string; evento: ContenutoEmail; destinatario: DestinatarioEmail }[] = [
  { file: "01-scadenza-10-giorni", titolo: "A. Scadenza tra 10 giorni", evento: SCADENZA_10, destinatario: TITOLARE_ALFA },
  { file: "02-scadenza-5-giorni", titolo: "B. Scadenza tra 5 giorni (procedura con più CIG e più fonti)", evento: SCADENZA_5, destinatario: TITOLARE_ALFA },
  { file: "03-scadenza-1-giorno", titolo: "C. Scadenza domani (destinatario: Ufficio Gare)", evento: SCADENZA_1, destinatario: UFFICIO_GARE_ALFA },
  { file: "04-rettifica", titolo: "D. Rettifica con i cambiamenti dall'avviso ufficiale", evento: RETTIFICA, destinatario: TITOLARE_ALFA },
  { file: "05-rettifica-senza-dettaglio", titolo: "D. Avviso ufficiale di modifica senza campi cambiati (rimando all'avviso)", evento: RETTIFICA_SENZA_DETTAGLIO, destinatario: UFFICIO_GARE_ALFA },
  { file: "06-proroga", titolo: "E. Proroga della scadenza", evento: PROROGA, destinatario: TITOLARE_ALFA },
  { file: "07-modifica-scadenza", titolo: "E. Scadenza modificata (anticipata, ora non indicata)", evento: MODIFICA_SCADENZA, destinatario: TITOLARE_ALFA },
  { file: "08-documenti", titolo: "F. Documenti sostitutivi o integrativi", evento: DOCUMENTI, destinatario: TITOLARE_ALFA },
  { file: "09-annullamento", titolo: "Gara annullata (categoria rettifiche, D-E5)", evento: ANNULLAMENTO, destinatario: TITOLARE_ALFA },
  { file: "10-nuove-opportunita", titolo: "Riepilogo nuove opportunità (20 elencate + 3 in «Per te»)", evento: NUOVE_OPPORTUNITA_MOTORE, destinatario: TITOLARE_ALFA },
  { file: "11-caso-ora-non-nota", titolo: "Caso: ora della scadenza non indicata dalla fonte", evento: CASO_ORA_NON_NOTA, destinatario: UFFICIO_GARE_ALFA },
  { file: "12-caso-cig-assente", titolo: "Caso: CIG assente", evento: CASO_CIG_ASSENTE, destinatario: TITOLARE_ALFA },
  { file: "13-caso-gara-aggiunta-a-mano", titolo: "Caso: gara aggiunta a mano dall'impresa (nessuna fonte ufficiale)", evento: CASO_AGGIUNTA_A_MANO, destinatario: TITOLARE_ALFA },
  { file: "14-scadenza-ravvicinata", titolo: "Avviso immediato per scadenza ravvicinata (D-E2)", evento: SCADENZA_RAVVICINATA, destinatario: TITOLARE_ALFA },
  { file: "15-due-gruppi-di-lotti", titolo: "v2: gara con DUE gruppi di lotti a scadenze diverse (promemoria del solo gruppo interessato)", evento: DUE_GRUPPI, destinatario: TITOLARE_ALFA },
  { file: "16-gruppo-con-piu-cig", titolo: "v2: un gruppo di lotti con più CIG", evento: PIU_CIG, destinatario: TITOLARE_ALFA },
  { file: "17-lotti-senza-scadenza", titolo: "v2: lotto senza scadenza indicata, elencato a parte", evento: LOTTI_SENZA_SCADENZA, destinatario: UFFICIO_GARE_ALFA },
  { file: "18-urgenti-raggruppati", titolo: "v2: email RAGGRUPPATA di urgenti (scadenza domani + due rettifiche)", evento: RAGGRUPPATO, destinatario: TITOLARE_ALFA },
  { file: "19-proroga-di-un-lotto", titolo: "v2: proroga della scadenza di un solo lotto", evento: PROROGA_LOTTO, destinatario: TITOLARE_ALFA },
];
