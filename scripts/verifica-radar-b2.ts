// Verifica della fase B2-0 di Tender Intelligence: connettori Sintel (dati aperti della Regione Lombardia) e SardegnaCAT (feed RSS ufficiale),
// solo lettura e normalizzazione, nessun database. Tutti gli avvisi qui sotto sono SINTETICI, scritti a mano per la prova (enti, CIG,
// importi e identificativi inventati: «Comune di Provasintetica» e simili); le risposte della rete sono simulate.
// Controlla anche il codice: nessuna colonna degli aggiudicatari richiesta, nessuna scrittura sul database, nessuna dipendenza nuova,
// nessuna ora presunta, solo istanze pubblicate.
import fs from "fs";
import path from "path";
import {
  COLONNE_SINTEL,
  URL_DATI_SINTEL,
  URL_METADATI_SINTEL,
  cigSintel,
  dataAggiornamentoSintel,
  leggiProceduraSintel,
  leggiRigheSintel,
  parametriSintel,
  righeSintelValide,
  scadenzaSintel,
  type BandoSintel,
  type EsclusioneSintel,
  type RigaSintel,
} from "../src/lib/radar/fonti/sintel-calcoli";
import { LettoreSintel } from "../src/lib/radar/fonti/sintel";
import {
  ISTANZE_AFLINK,
  decodificaEntita,
  importoAflink,
  leggiElementiAflink,
  leggiElementoAflink,
  leggiFeedAflink,
  oggettoAflink,
  scadenzaAflink,
  type BandoAflink,
  type EsclusioneAflink,
} from "../src/lib/radar/fonti/aflink-calcoli";
import { LettoreAflink } from "../src/lib/radar/fonti/aflink";
import { ErroreFonte, SessioneFonte, USER_AGENT_FONTI, limitiValidi, type LimitiFonte } from "../src/lib/radar/fonti/sessione-fonte";
import { idPiattaformaDaUrl } from "../src/lib/radar/fonti/piattaforme-calcoli";
import { entraInOpportunita, opportunitaAflink, opportunitaSintel } from "../src/lib/radar/opportunita-calcoli";
import { USER_AGENT_PVL } from "../src/lib/radar/fonti/pvl-calcoli";

const RADICE = path.join(__dirname, "..");
const leggi = (r: string) => fs.readFileSync(path.join(RADICE, r), "utf8");
const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok || !dettaglio ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale(nome: string, reale: unknown, previsto: unknown) {
  const a = JSON.stringify(reale);
  const b = JSON.stringify(previsto);
  atteso(nome, a === b, `atteso ${b}, ottenuto ${a}`);
}

const OGGI = "2026-11-17";
const ADESSO = new Date("2026-11-17T12:00:00Z");
const LIMITI_PROVA: LimitiFonte = { pausaMs: 1, timeoutMs: 5_000, tentativi: 2, richiesteMassime: 6 };

// ───── righe Sintel SINTETICHE (stesse colonne del dataset, valori inventati) ─────
function rigaSintel(p: Partial<Record<string, unknown>>): RigaSintel {
  return {
    id_procedura: "900000001",
    id_lotto: "N/D",
    multilotto: "NO",
    cig: "PRV0000001",
    codice_cpv: "90910000-9",
    data_inizio_negoziazione: "2026-11-10T00:00:00.000",
    data_fine_negoziazione: "2026-12-15T00:00:00.000",
    modalita_scelta_contraente: "Procedura Aperta",
    ambito_merceologico: "Procedura per forniture/servizi",
    stato_procedura: "Pubblicata",
    stato_lotto: "N/D",
    accordo_quadro: "NO",
    valore_economico_procedura: "120000.5",
    cf_stazione_appaltante: "00000000001",
    stazione_appaltante: "COMUNE DI PROVASINTETICA",
    nome_procedura: "Servizio di pulizia degli uffici comunali (prova sintetica)",
    link_procedura: { url: "http://www.sintel.regione.lombardia.it/eprocdata/auctionDetail.xhtml?id=900000001" },
    ...p,
  };
}

// ───── feed AF Soluzioni SINTETICO (stessa struttura del feed di SardegnaCAT, valori inventati) ─────
function elementoXml(c: Record<string, string>): string {
  const campi = Object.entries(c)
    .filter(([k]) => k !== "link")
    .map(([k, v]) => `\t<afs:${k}><![CDATA[${v}]]></afs:${k}>`)
    .join("\n");
  return `<item>\n\t<title><![CDATA[Bando ]]></title>\n\t<link><![CDATA[${c.link ?? ""}]]></link>\n${campi}\n</item>`;
}
function elementoBase(id: string, p: Record<string, string> = {}): Record<string, string> {
  return {
    link: `https://sardegnacat.regione.sardegna.it/portale/index.php/bandi?getdettaglio=yes&bando=${id}&tipobando=Bando&scadenzaBando=2026-12-10T10:00:00`,
    Oggetto: "Servizio di ristorazione scolastica (prova sintetica)",
    Tipo: "Bando",
    EnteProponente: "",
    DenominazioneEnte: "COMUNE DI PROVASINTETICA",
    Contratto: "Servizi",
    a_base_asta: "1.234.567,89",
    DtScadenzaBandoTecnical: "2026-12-10T10:00:00",
    CIG: "PRV0000002",
    TipoProcedura: "Aperta",
    statoFunzionale: "PresOfferte",
    IdMsg: id,
    TitoloDocumento: "Ristorazione scolastica - prova",
    dataUltimaModifica: "2026-11-16T10:36:25",
    CPV: "55524000-9 - Servizi di ristorazione scolastica",
    DtPubblicazioneTecnical: "2026-11-03T11:52:46",
    ...p,
  };
}
function feedXml(elementi: Record<string, string>[], totale = elementi.length): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:afs="http://www.aflink.it/XMLBANDI">\n<channel>\n<title>Elenco dei bandi di gara In Corso (prova)</title>\n<ttl>15</ttl>\n<afs:totRecord>${totale}</afs:totRecord>\n${elementi.map(elementoXml).join("\n")}\n</channel>\n</rss>`;
}

// risposte di rete simulate
function rete(risposte: { stato: number; corpo: string; tipo?: string }[], richieste: string[]): typeof fetch {
  let i = 0;
  return (async (url: string | URL | Request) => {
    richieste.push(String(url));
    const r = risposte[Math.min(i++, risposte.length - 1)];
    return new Response(r.corpo, { status: r.stato, headers: { "content-type": r.tipo ?? "application/json" } });
  }) as typeof fetch;
}

async function principale() {
  // ───── 1. Sintel: richiesta ─────
  const par = parametriSintel({ daGiorno: OGGI, limite: 1000, offset: 0 });
  atteso("Sintel: la richiesta elenca solo le colonne utili", par.$select === COLONNE_SINTEL.join(","));
  atteso("Sintel: nessuna colonna degli aggiudicatari è mai richiesta", !/aggiudicatar/i.test(par.$select) && !COLONNE_SINTEL.some((c) => /aggiudicatar|ragione_sociale|id_fiscale/i.test(c)));
  uguale("Sintel: filtro sulle scadenze da oggi, ordine stabile", [par.$where, par.$order], [`data_fine_negoziazione >= '${OGGI}T00:00:00'`, "id_procedura,id_lotto"]);
  let rifiutato = false;
  try {
    parametriSintel({ daGiorno: "2026-11-17' OR 1=1 --", limite: 10, offset: 0 });
  } catch {
    rifiutato = true;
  }
  atteso("Sintel: un giorno non valido non entra nella richiesta", rifiutato);
  uguale("Sintel: data dell'ultimo caricamento dai metadati", dataAggiornamentoSintel({ rowsUpdatedAt: 1794895401 }), new Date(1794895401 * 1000).toISOString());
  uguale("Sintel: metadati senza data → nessuna data", dataAggiornamentoSintel({}), null);
  atteso("Sintel: una risposta con le colonne degli aggiudicatari è rifiutata", "errore" in righeSintelValide([{ id_procedura: "1", ragione_sociale_aggiudicatario: "X" }]));
  atteso("Sintel: una risposta che non è un elenco è rifiutata", "errore" in righeSintelValide({ errore: true }));

  // ───── 2. Sintel: CIG, scadenza, modalità ─────
  uguale("Sintel: i segnaposto non sono CIG", ["XXXXXXXXXX", "^^^^^^^^^^", "AAAAAAAAAA", "prv0000001", "PRV000001", null].map(cigSintel), [null, null, null, "PRV0000001", null, null]);
  uguale("Sintel: scadenza solo come giorno, nessun istante, ora non presunta", scadenzaSintel("2026-12-15T00:00:00.000"), { giorno: "2026-12-15", iso: null, oraIndicata: false, fonte: "2026-12-15 (Sintel indica solo il giorno)" });
  const modalita: [string, string | null][] = [
    ["Procedura Aperta", "bando"],
    ["Manifestazione di interesse", "manifestazione_interesse"],
    ["Affidamento diretto", "affidamento_diretto"],
    ["Indagine di mercato", "indagine_mercato"],
    ["Procedura negoziata senza previa indizione di gara", "riservata"],
    ["SDA - Appalto specifico", "riservata"],
    ["Affidamento diretto previa preventivi", "affidamento_diretto"],
    ["SDA - Bando istitutivo", "sistema_qualificazione"],
    ["Procedura negoziata con previa indizione di gara", "bando"],
    ["Negoziata senza previa indizione", "riservata"],
    ["Negoziata con previa indizione", "bando"],
    ["RDO per indagine di mercato", "indagine_mercato"],
    ["RDO per manifestazione di interesse", "manifestazione_interesse"],
    ["Cottimo fiduciario ad invito diretto", "riservata"],
    ["Modalità mai vista", null],
  ];
  uguale("Sintel: le 11 modalità scritte come nei dati del 16/11 (più forme brevi, inviti e sconosciute) hanno il tipo giusto", modalita.map(([m]) => opportunitaSintel(m)?.tipo ?? null), modalita.map(([, t]) => t));
  atteso("Sintel: riservate e affidamenti non entrano in Opportunità", ["Negoziata senza previa indizione", "SDA - Appalto specifico", "Affidamento diretto"].every((m) => !entraInOpportunita(opportunitaSintel(m)!)));

  // ───── 3. Sintel: procedure ─────
  const mono = leggiProceduraSintel("900000001", [rigaSintel({})], OGGI) as BandoSintel;
  atteso("Sintel: una procedura aperta di pulizia entra", mono.tipo === "bando" && mono.settori.includes("pulizia") && mono.opportunita.tipo === "bando");
  uguale(
    "Sintel: chiave, fonte, identificativo della piattaforma e regione dell'ente",
    [mono.record.chiaveProcedura, mono.record.fonte, mono.meta.idPiattaforma, mono.regioni, mono.record.ente.regione, mono.record.ente.comune],
    ["sintel:900000001", "regionale", "sintel:900000001", ["lombardia"], "lombardia", "Provasintetica"],
  );
  uguale("Sintel: giorno di scadenza senza ora", [mono.record.scadenzaGiorno, mono.record.scadenzaOfferte, mono.record.scadenzaOraIndicata], ["2026-12-15", null, false]);
  uguale("Sintel: base d'asta come base (non come valore stimato), un lotto con CIG", [mono.record.valoreBase, mono.record.valoreStimato, mono.record.lotti.length, mono.record.lotti[0].cig, mono.record.lotti[0].valoreBase], [120000.5, null, 1, "PRV0000001", 120000.5]);
  uguale("Sintel: nessuna data di pubblicazione inventata; inizio offerte a parte", [mono.record.dataPubblicazione, mono.inizioOfferte], [null, "2026-11-10"]);
  atteso("Sintel: i dati che la fonte non dà sono dichiarati mancanti", ["ora_scadenza", "luogo_esecuzione", "data_pubblicazione"].every((m) => mono.mancanti.includes(m)));
  atteso("Sintel: collegamento ufficiale alla procedura", mono.record.urlAvviso === "http://www.sintel.regione.lombardia.it/eprocdata/auctionDetail.xhtml?id=900000001");

  const multi = leggiProceduraSintel(
    "900000002",
    [
      rigaSintel({ id_procedura: "900000002", multilotto: "SI", id_lotto: "11", cig: "PRV0000011", base_asta_lotto: "50000", stato_lotto: "Pubblicata", nome_lotto: "Lotto 1 pulizia scuole", valore_economico_procedura: "150000" }),
      rigaSintel({ id_procedura: "900000002", multilotto: "SI", id_lotto: "12", cig: "PRV0000012", base_asta_lotto: "60000", stato_lotto: "Pubblicata", nome_lotto: "Lotto 2 pulizia uffici", valore_economico_procedura: "150000" }),
      rigaSintel({ id_procedura: "900000002", multilotto: "SI", id_lotto: "13", cig: "PRV0000013", base_asta_lotto: "40000", stato_lotto: "Chiusa", nome_lotto: "Lotto 3 già chiuso", valore_economico_procedura: "150000" }),
    ],
    OGGI,
  ) as BandoSintel;
  uguale("Sintel: multilotto = un lotto per riga, i lotti chiusi restano fuori", multi.record.lotti.map((l) => [l.numero, l.cig, l.valoreBase]), [["SINTEL-11", "PRV0000011", 50000], ["SINTEL-12", "PRV0000012", 60000]]);
  uguale("Sintel: base d'asta della procedura", multi.record.valoreBase, 150000);

  const manif = leggiProceduraSintel("900000003", [rigaSintel({ id_procedura: "900000003", modalita_scelta_contraente: "Manifestazione di interesse", cig: "XXXXXXXXXX" })], OGGI) as BandoSintel;
  atteso("Sintel: manifestazione di interesse entra con il suo tipo, senza CIG", manif.tipo === "bando" && manif.opportunita.tipo === "manifestazione_interesse" && manif.record.lotti[0].cig === null && manif.mancanti.includes("cig"));

  const esclusa = (righe: RigaSintel[]) => (leggiProceduraSintel(String(righe[0].id_procedura), righe, OGGI) as EsclusioneSintel).motivo;
  uguale(
    "Sintel: esclusioni con il loro motivo",
    [
      esclusa([rigaSintel({ modalita_scelta_contraente: "Affidamento diretto" })]),
      esclusa([rigaSintel({ modalita_scelta_contraente: "Procedura negoziata senza previa indizione di gara" })]),
      esclusa([rigaSintel({ modalita_scelta_contraente: "SDA - Appalto specifico" })]),
      esclusa([rigaSintel({ codice_cpv: "33141200-2", nome_procedura: "Fornitura di cateteri" })]),
      esclusa([rigaSintel({ data_fine_negoziazione: "2026-11-16T00:00:00.000" })]),
      esclusa([rigaSintel({ stato_procedura: "Chiusa" })]),
      esclusa([rigaSintel({ modalita_scelta_contraente: "Modalità mai vista" })]),
      esclusa([rigaSintel({ nome_procedura: "  " })]),
      esclusa([rigaSintel({ codice_cpv: "45000000-7", ambito_merceologico: "Procedura per lavori", nome_procedura: "Lavori di pulizia del canale" })]),
    ],
    ["affidamento", "riservata", "riservata", "fuori_settore", "scaduta", "chiusa", "modalita_sconosciuta", "senza_oggetto", "fuori_settore"],
  );
  const sospesa = leggiProceduraSintel("900000001", [rigaSintel({ stato_procedura: "Sospesa" })], OGGI);
  atteso("Sintel: una procedura sospesa resta, con il suo stato", sospesa.tipo === "bando" && sospesa.meta?.stato === "sospesa");
  atteso("Sintel: oggi è ancora valido (gara aperta per tutto il giorno)", leggiProceduraSintel("900000001", [rigaSintel({ data_fine_negoziazione: `${OGGI}T00:00:00.000` })], OGGI).tipo === "bando");
  const a1 = leggiProceduraSintel("900000001", [rigaSintel({})], OGGI) as BandoSintel;
  const a2 = leggiProceduraSintel("900000001", [rigaSintel({ data_fine_negoziazione: "2026-12-22T00:00:00.000" })], OGGI) as BandoSintel;
  atteso("Sintel: stessa lettura = stessa impronta; proroga = impronta diversa", a1.record.impronta === mono.record.impronta && a2.record.impronta !== mono.record.impronta);
  const tutte = leggiRigheSintel([rigaSintel({}), rigaSintel({ id_procedura: "" }), rigaSintel({ id_procedura: "900000004", modalita_scelta_contraente: "Affidamento diretto" })], OGGI);
  uguale("Sintel: righe raggruppate per procedura, righe senza identificativo scartate", [tutte.procedure.length, tutte.righeScartate, tutte.procedure.map((p) => p.tipo)], [2, 1, ["bando", "esclusione"]]);

  // ───── 3bis. esclusioni per oggetto (regole della PVL in settori.ts, uguali per tutte le fonti): contate a parte, con la regola ─────
  // Regole definitive del 17/11/2026 (2026-11-17b, decisione dell'utente): le concessioni pubbliche di bar e ristoranti ENTRANO in
  // ristorazione; resta esclusa, per esempio, la concessione di un immobile senza il servizio di ristorazione.
  {
    const bar = leggiProceduraSintel("900000009", [rigaSintel({ id_procedura: "900000009", codice_cpv: "55300000-3", nome_procedura: "Concessione della gestione del bar e punto ristoro del parco comunale (prova sintetica)" })], OGGI) as BandoSintel | EsclusioneSintel;
    uguale("Sintel: la concessione di un bar con CPV della ristorazione entra in ristorazione (regole definitive)", [bar.tipo, bar.tipo === "bando" ? bar.settori : null], ["bando", ["ristorazione"]]);
    const barS = leggiElementoAflink("sardegnacat", { ...elementoBase("700099"), CPV: "55300000-3 - Servizi di ristorazione", Oggetto: "Concessione della gestione del bar e punto ristoro del parco comunale (prova sintetica)", TitoloDocumento: "Bar del parco (prova)" }, ADESSO) as BandoAflink | EsclusioneAflink;
    uguale("SardegnaCAT: stesso caso, stesso risultato (classificatore unico)", [barS.tipo, barS.tipo === "bando" ? barS.settori : null], ["bando", ["ristorazione"]]);
    const casone = leggiProceduraSintel("900000010", [rigaSintel({ id_procedura: "900000010", codice_cpv: "55300000-3", nome_procedura: "Affidamento in concessione del casone “Paduli” per la durata di sette anni (prova sintetica)" })], OGGI) as EsclusioneSintel;
    uguale("Sintel: la concessione di un immobile con CPV della ristorazione è esclusa per oggetto, con la regola", [casone.motivo, casone.regole], ["esclusa_per_oggetto", ["concessione_di_immobili"]]);
    const casoneS = leggiElementoAflink("sardegnacat", { ...elementoBase("700098"), CPV: "55300000-3 - Servizi di ristorazione", Oggetto: "Affidamento in concessione del casone “Paduli” per la durata di sette anni (prova sintetica)", TitoloDocumento: "Casone (prova)" }, ADESSO) as EsclusioneAflink;
    uguale("SardegnaCAT: stesso caso, stessa esclusione (classificatore unico)", [casoneS.motivo, casoneS.regole], ["esclusa_per_oggetto", ["concessione_di_immobili"]]);
  }

  // ───── 4. Sintel: rete simulata ─────
  {
    const richieste: string[] = [];
    const pagina = Array.from({ length: 1000 }, (_, i) => rigaSintel({ id_procedura: String(900100000 + i) }));
    const s = new SessioneFonte("Sintel", LIMITI_PROVA, rete([{ stato: 200, corpo: JSON.stringify({ rowsUpdatedAt: 1794895401 }) }, { stato: 200, corpo: JSON.stringify(pagina) }, { stato: 200, corpo: JSON.stringify([rigaSintel({})]) }], richieste));
    const l = new LettoreSintel(s);
    const data = await l.dataAggiornamento();
    const r = await l.leggiDaGiorno(OGGI, 3);
    atteso("Sintel: metadati, poi pagine fino alla prima pagina corta", data !== null && r.completo && r.righe.length === 1001 && richieste.length === 3);
    atteso("Sintel: si leggono solo i due indirizzi del dataset", richieste[0] === URL_METADATI_SINTEL && richieste.slice(1).every((u) => u.startsWith(`${URL_DATI_SINTEL}?`)));
    atteso("Sintel: nessuna richiesta chiede le colonne degli aggiudicatari", richieste.every((u) => !/aggiudicatar/i.test(decodeURIComponent(u))));
  }
  for (const [nome, risposta] of [
    ["403", { stato: 403, corpo: "vietato", tipo: "text/plain" }],
    ["429", { stato: 429, corpo: "troppe", tipo: "text/plain" }],
    ["pagina HTML", { stato: 200, corpo: "<html><body>Verifica che tu non sia un robot</body></html>", tipo: "text/html" }],
    ["colonna vietata", { stato: 200, corpo: JSON.stringify([{ id_procedura: "1", id_fiscale_aggiudicatario: "X" }]) }],
  ] as const) {
    let errore: unknown = null;
    try {
      await new LettoreSintel(new SessioneFonte("Sintel", LIMITI_PROVA, rete([risposta], []))).leggiDaGiorno(OGGI, 1);
    } catch (e) {
      errore = e;
    }
    atteso(`Sintel: ${nome} → connettore sospeso, nessun nuovo tentativo`, errore instanceof ErroreFonte && errore.sospendi);
  }
  {
    const richieste: string[] = [];
    let errore: unknown = null;
    try {
      await new LettoreSintel(new SessioneFonte("Sintel", { ...LIMITI_PROVA, tentativi: 2, richiesteMassime: 6 }, rete([{ stato: 503, corpo: "", tipo: "text/plain" }], richieste))).leggiDaGiorno(OGGI, 1);
    } catch (e) {
      errore = e;
    }
    atteso("Sintel: errore temporaneo = un solo nuovo tentativo, poi errore senza sospensione", richieste.length === 2 && errore instanceof ErroreFonte && !errore.sospendi);
  }
  {
    const richieste: string[] = [];
    const pagina = JSON.stringify(Array.from({ length: 1000 }, (_, i) => rigaSintel({ id_procedura: String(900200000 + i) })));
    let errore: unknown = null;
    try {
      await new LettoreSintel(new SessioneFonte("Sintel", { ...LIMITI_PROVA, richiesteMassime: 2 }, rete([{ stato: 200, corpo: pagina }], richieste))).leggiDaGiorno(OGGI, 5);
    } catch (e) {
      errore = e;
    }
    atteso("Sintel: il tetto di richieste per giro non si supera mai", richieste.length === 2 && errore instanceof ErroreFonte && errore.tetto);
  }

  // ───── 5. SardegnaCAT: lettura del feed ─────
  const xml = feedXml([
    elementoBase("700001"),
    elementoBase("700002", { Oggetto: "<strong>Bando Rettificato - </strong> Servizio di pulizia degli edifici scolastici &amp; uffici – prova sintetica", CPV: "90919200-4 - Servizi di pulizia di uffici", DtScadenzaBandoTecnical: "2026-12-03T12:00:00" }),
    elementoBase("700003", { TipoProcedura: "Affidamento Diretto" }),
    elementoBase("700004", { TipoProcedura: "Negoziata", Oggetto: "Procedura negoziata senza bando - mensa (prova sintetica)" }),
    elementoBase("700005", { Tipo: "Avviso", TipoProcedura: "Negoziata", Oggetto: "Avviso di indagine di mercato per il servizio mensa (prova sintetica)" }),
    elementoBase("700006", { CIG: "CIG VARI", a_base_asta: "35086" }),
    elementoBase("700007", { statoFunzionale: "Revocato", Oggetto: "<strong>Bando Revocato</strong> Servizio mensa (prova sintetica)" }),
    elementoBase("700008", { CPV: "45233140-2 - Lavori stradali", Contratto: "Lavori", Oggetto: "Lavori stradali (prova sintetica)", TitoloDocumento: "Strade" }),
    elementoBase("700009", { DtScadenzaBandoTecnical: "2026-12-11T00:00:00" }),
  ]);
  const feed = leggiFeedAflink(xml);
  atteso("SardegnaCAT: il feed sintetico si legge (9 elementi, totale dichiarato)", !("errore" in feed) && feed.elementi.length === 9 && feed.totaleDichiarato === 9);
  if ("errore" in feed) throw new Error(feed.errore);
  const letti = leggiElementiAflink("sardegnacat", feed.elementi, ADESSO);
  const b = (i: number) => letti[i] as BandoAflink;
  const motivo = (i: number) => (letti[i] as EsclusioneAflink).motivo;
  atteso("SardegnaCAT: bando aperto di ristorazione entra", b(0).tipo === "bando" && b(0).settori.includes("ristorazione") && b(0).opportunita.tipo === "bando");
  uguale(
    "SardegnaCAT: chiave, fonte, identificativo della piattaforma, regione dell'ente",
    [b(0).record.chiaveProcedura, b(0).record.fonte, b(0).meta.idPiattaforma, b(0).regioni, b(0).record.ente.comune],
    ["sardegnacat:700001", "regionale", "sardegnacat:700001", ["sardegna"], "Provasintetica"],
  );
  uguale("SardegnaCAT: scadenza d'inverno (ora italiana → UTC+1)", [b(0).record.scadenzaGiorno, b(0).record.scadenzaOfferte, b(0).record.scadenzaOraIndicata], ["2026-12-10", "2026-12-10T09:00:00.000Z", true]);
  uguale("SardegnaCAT: importo in formato italiano, CIG come lotto unico", [b(0).record.valoreBase, b(0).record.lotti.map((l) => l.cig)], [1234567.89, ["PRV0000002"]]);
  uguale("SardegnaCAT: data di pubblicazione dal feed", b(0).record.dataPubblicazione, "2026-11-03");
  uguale("SardegnaCAT: «Bando Rettificato» riconosciuto e tolto dall'oggetto, entità decodificate", [b(1).rettificato, b(1).record.oggetto], [true, "Servizio di pulizia degli edifici scolastici & uffici – prova sintetica"]);
  uguale("SardegnaCAT: affidamento diretto e negoziata non entrano", [motivo(2), motivo(3)], ["affidamento", "riservata"]);
  atteso("SardegnaCAT: un avviso di indagine di mercato entra come indagine", b(4).tipo === "bando" && b(4).opportunita.tipo === "indagine_mercato");
  uguale("SardegnaCAT: «CIG VARI» = lotti sconosciuti, nessun CIG inventato", [b(5).record.lotti.length, b(5).mancanti.includes("cig"), b(5).record.valoreBase], [0, true, 35086]);
  atteso("SardegnaCAT: un bando revocato è annullato e l'oggetto è pulito", b(6).record.annullata && b(6).record.oggetto === "Servizio mensa (prova sintetica)");
  uguale("SardegnaCAT: lavori stradali fuori dai settori", motivo(7), "fuori_settore");
  uguale("SardegnaCAT: mezzanotte esatta = giorno senza ora (mai presunta)", [b(8).record.scadenzaGiorno, b(8).record.scadenzaOfferte, b(8).record.scadenzaOraIndicata], ["2026-12-11", null, false]);
  atteso("SardegnaCAT: un elemento già scaduto non entra", (leggiElementoAflink("sardegnacat", { ...elementoBase("700010"), DtScadenzaBandoTecnical: "2026-11-17T10:00:00" }, ADESSO) as EsclusioneAflink).motivo === "scaduta");

  // ora legale e cambi d'ora (2026: 29 marzo e 25 ottobre)
  uguale(
    "SardegnaCAT: ora italiana convertita con l'ora legale giusta",
    ["2026-07-15T12:00:00", "2026-03-29T10:00:00", "2026-03-28T10:00:00", "2026-10-25T10:00:00", "2026-10-24T10:00:00"].map((d) => scadenzaAflink(d)?.iso),
    ["2026-07-15T10:00:00.000Z", "2026-03-29T08:00:00.000Z", "2026-03-28T09:00:00.000Z", "2026-10-25T09:00:00.000Z", "2026-10-24T08:00:00.000Z"],
  );
  uguale("SardegnaCAT: formati non riconosciuti → nessuna scadenza", [scadenzaAflink("10/12/2026"), scadenzaAflink(""), scadenzaAflink(null)], [null, null, null]);
  uguale("SardegnaCAT: importi validi e non validi", ["200.221,44", "35086", "1.234.567,89", "12,5", "1,234.56", "abc", "", "0"].map(importoAflink), [200221.44, 35086, 1234567.89, 12.5, null, null, null, null]);
  uguale("SardegnaCAT: entità e caratteri accentati", decodificaEntita("Citt&#224; &amp; Comune dell&#39;Isola &lt;prova&gt; &#x20AC;"), "Città & Comune dell'Isola <prova> €");
  uguale(
    "SardegnaCAT: avvisi di stato tolti dall'oggetto in tutte le forme",
    ["<strong>Bando Revocato</strong> Mensa", "Bando Rettificato - Mensa", "<strong>Bando in Rettifica - </strong>Mensa", "<strong>Procedura Ripristinata</strong> - Mensa"].map((o) => oggettoAflink(o).testo),
    ["Mensa", "Mensa", "Mensa", "Mensa"],
  );
  uguale("SardegnaCAT: «Scarica Allegati» e i collegamenti nell'oggetto non entrano nel testo", oggettoAflink('Servizio mensa <a href="https://esempio.invalid/loginportale.asp">Scarica Allegati</a>').testo, "Servizio mensa");
  const conAltraScadenzaNelLink = leggiElementoAflink("sardegnacat", { ...feed.elementi[0], link: feed.elementi[0].link.replace("scadenzaBando=2026-12-10T10:00:00", "scadenzaBando=2026-12-10T10:00:01") }, ADESSO) as BandoAflink;
  atteso("SardegnaCAT: l'impronta non dipende dall'indirizzo della pagina (che contiene la scadenza)", conAltraScadenzaNelLink.record.impronta === b(0).record.impronta);
  const prorogato = leggiElementoAflink("sardegnacat", { ...feed.elementi[0], DtScadenzaBandoTecnical: "2026-12-17T10:00:00" }, ADESSO) as BandoAflink;
  atteso("SardegnaCAT: una proroga cambia l'impronta", prorogato.record.impronta !== b(0).record.impronta);
  uguale("SardegnaCAT: tipi del feed → opportunità", [opportunitaAflink("Bando", "Aperta", "")?.tipo, opportunitaAflink("Avviso", "Negoziata", "Manifestazione di interesse")?.tipo, opportunitaAflink("Esito", "Aperta", "")], ["bando", "manifestazione_interesse", null]);

  uguale(
    "SardegnaCAT: formati inattesi rifiutati (la fonte si sospende)",
    ["<html><body>Accesso negato</body></html>", '<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>', feedXml([{ IdMsg: "1" }]).replace(/<afs:IdMsg>.*<\/afs:IdMsg>/, ""), feedXml([], 5)].map((x) => ("errore" in leggiFeedAflink(x) ? "errore" : "ok")),
    ["errore", "errore", "errore", "errore"],
  );

  // ───── 6. SardegnaCAT: rete simulata ─────
  {
    const richieste: string[] = [];
    const s = new SessioneFonte("SardegnaCAT", LIMITI_PROVA, rete([{ stato: 200, corpo: xml, tipo: "text/xml; charset=utf-8" }], richieste));
    const r = await new LettoreAflink("sardegnacat", s).leggiFeed();
    atteso("SardegnaCAT: una sola lettura, all'indirizzo pubblicato esatto", r.elementi.length === 9 && richieste.length === 1 && richieste[0] === ISTANZE_AFLINK.sardegnacat.urlFeed);
  }
  for (const [nome, risposta] of [
    ["403", { stato: 403, corpo: "", tipo: "text/plain" }],
    ["429", { stato: 429, corpo: "", tipo: "text/plain" }],
    ["pagina HTML", { stato: 200, corpo: "<!doctype html><html>Verifica</html>", tipo: "text/html" }],
    ["feed senza i campi attesi", { stato: 200, corpo: '<?xml version="1.0"?><rss version="2.0"><channel><item><title>x</title></item></channel></rss>', tipo: "text/xml" }],
  ] as const) {
    let errore: unknown = null;
    try {
      await new LettoreAflink("sardegnacat", new SessioneFonte("SardegnaCAT", LIMITI_PROVA, rete([risposta], []))).leggiFeed();
    } catch (e) {
      errore = e;
    }
    atteso(`SardegnaCAT: ${nome} → connettore sospeso`, errore instanceof ErroreFonte && errore.sospendi);
  }

  // ───── 7. identificativo della piattaforma (chiave esatta SardegnaCAT ↔ TED) ─────
  uguale(
    "Piattaforme: solo la pagina di dettaglio della procedura (SardegnaCAT) e l'asta (Sintel); la forma «bando=», i sosia e gli altri siti no",
    [
      "https://sardegnacat.regione.sardegna.it/Application/CustomDoc/DettaglioProcedura.asp?ID=1031830",
      "https://sardegnacat.regione.sardegna.it/portale/index.php/bandi?getdettaglio=yes&bando=1028716&tipobando=Bando",
      "http://www.sintel.regione.lombardia.it/eprocdata/auctionDetail.xhtml?id=226427680",
      "https://sardegnacat.regione.sardegna.it.esempio.invalid/DettaglioProcedura.asp?ID=1",
      "https://altro.esempio.invalid/DettaglioProcedura.asp?ID=1031830",
      "https://sardegnacat.regione.sardegna.it/portalegare/index.php/bandi",
      "javascript:alert(1)",
      null,
    ].map(idPiattaformaDaUrl),
    ["sardegnacat:1031830", null, "sintel:226427680", null, null, null, null, null],
  );
  atteso("Piattaforme: il feed e il collegamento TED della stessa gara danno la stessa chiave", idPiattaformaDaUrl("https://sardegnacat.regione.sardegna.it/Application/CustomDoc/DettaglioProcedura.asp?ID=700001") === b(0).meta.idPiattaforma);

  // ───── 8. regole sul codice ─────
  const nuovi = [
    "src/lib/radar/fonti/sessione-fonte.ts",
    "src/lib/radar/fonti/sintel-calcoli.ts",
    "src/lib/radar/fonti/sintel.ts",
    "src/lib/radar/fonti/aflink-calcoli.ts",
    "src/lib/radar/fonti/aflink.ts",
    "src/lib/radar/fonti/piattaforme-calcoli.ts",
    "src/lib/radar/opportunita-calcoli.ts",
  ];
  const senzaCommenti = (t: string) => t.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const codice = Object.fromEntries(nuovi.map((f) => [f, senzaCommenti(leggi(f))]));
  atteso("nessun accesso al database nei connettori (fase B2-0)", Object.values(codice).every((t) => !/supabase|\.from\(\s*["'`]|\.rpc\(/i.test(t)));
  atteso("nessuna dipendenza esterna: solo moduli del progetto", Object.values(codice).every((t) => [...t.matchAll(/from\s+["']([^"']+)["']/g)].every((m) => m[1].startsWith("./") || m[1].startsWith("../"))));
  atteso("nessuna rete nei file di calcolo", nuovi.filter((f) => /calcoli/.test(f)).every((f) => !/\bfetch\s*\(/.test(codice[f])));
  // le costanti vietate dell'ora presunta le controlla per tutto il codice e i test la verifica della scadenza senza ora (livello 1)
  atteso("nessuna ora presunta: niente fine giornata scritta nei connettori", Object.values(codice).every((t) => !/23:59/.test(t)));
  atteso("nessun modello AI nei connettori", Object.values(codice).every((t) => !/anthropic|openai|@ai-sdk|claude-/i.test(t)));
  atteso("stesso nome generico del programma di TED e PVL", USER_AGENT_FONTI === USER_AGENT_PVL);
  uguale("solo le istanze approvate: SardegnaCAT (GIADA e AURA aspettano la decisione S10)", Object.keys(ISTANZE_AFLINK), ["sardegnacat"]);
  atteso("SardegnaCAT: si legge solo l'indirizzo del feed (mai allegati o pagine di accesso)", !/loginportale|scarica|allegat/i.test(codice["src/lib/radar/fonti/aflink.ts"]) && /ISTANZE_AFLINK\[this\.istanza\]\.urlFeed/.test(codice["src/lib/radar/fonti/aflink.ts"]));
  atteso("Sintel: si leggono solo i due indirizzi del dataset", (codice["src/lib/radar/fonti/sintel.ts"].match(/sessione\.leggi\(/g) ?? []).length === 2 && /URL_METADATI_SINTEL/.test(codice["src/lib/radar/fonti/sintel.ts"]) && /URL_DATI_SINTEL/.test(codice["src/lib/radar/fonti/sintel.ts"]));
  atteso("citazione delle fonti presente", /ATTRIBUZIONE_SINTEL = "Regione Lombardia – Open Data Lombardia \(Sintel\), licenza CC0 1\.0"/.test(leggi("src/lib/radar/fonti/sintel-calcoli.ts")) && /attribuzione: "Regione Autonoma della Sardegna – SardegnaCAT/.test(leggi("src/lib/radar/fonti/aflink-calcoli.ts")));
  uguale("limiti fuori intervallo tornano ai predefiniti", limitiValidi({ pausaMs: 10, tentativi: 9, timeoutMs: 20_000 }, LIMITI_PROVA, { pausaMs: { min: 1_000, max: 60_000 }, timeoutMs: { min: 5_000, max: 120_000 }, tentativi: { min: 1, max: 3 }, richiesteMassime: { min: 1, max: 20 } }), { ...LIMITI_PROVA, timeoutMs: 20_000 });
  const vercel = JSON.parse(leggi("vercel.json")) as { crons: { path: string }[] };
  atteso("nessun cron nuovo in vercel.json", !vercel.crons.some((c) => /sintel|sardegna|aflink|radar-fonti/.test(c.path)));
  // B2-0 non porta migrazioni: dopo la 0117 (della PVL, approvata il 17/11) possono esserci solo la 0120 di B2a e la 0121 di B2 (PROGETTO
  // mai applicato, decisione dell'utente del 17/11; i suoi controlli sono in verifica-radar-0121.ts)
  // fase B4 (19/11): nel ramo B2 ci sono anche le BOZZE 0122–0125 del 26B (mai applicate), esattamente queste
  atteso("nessuna migrazione di B2-0 (oltre la 0117 solo la 0120 di B2a, il progetto 0121 e le bozze B4 0122–0125)", fs.readdirSync(path.join(RADICE, "supabase/migrations")).filter((f) => /^01(1[89]|[2-9]\d)_/.test(f)).every((f) => /^0120_|^0121_radar_classificazioni\.sql$|^0122_radar_profili_per_te\.sql$|^0123_radar_aggiornamenti_evidenza\.sql$|^0124_radar_avvisi_preferenze\.sql$|^0125_radar_avvisi_eventi_coda\.sql$/.test(f)));

  console.log(fallimenti.length === 0 ? "\nVerifica B2-0 (Sintel e SardegnaCAT): tutto a posto." : `\nVerifica B2-0: ${fallimenti.length} controlli falliti:\n - ${fallimenti.join("\n - ")}`);
  process.exit(fallimenti.length === 0 ? 0 : 1);
}

principale().catch((e) => {
  console.error(e);
  process.exit(1);
});
