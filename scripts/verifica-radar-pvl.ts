// Verifica della fase B1-bis di Tender Intelligence: connettore PVL di ANAC (solo staging). Lettura degli avvisi (copie REALI dei soli campi
// pubblici, senza aggiudicatari: scripts/dati/radar-pvl-campione.json), limiti e sospensioni verso la fonte (risposte simulate), unione con
// TED nella stessa gara in tutti gli ordini di arrivo, rettifiche senza doppioni, punto di ripresa, orari dei giri con l'ora legale, guardia
// anti-produzione, più controlli sul codice (nessuna AI, cron non attivo, migrazioni additive).
import fs from "fs";
import path from "path";
import {
  CHIAVI_LIMITI_PVL,
  LIMITI_PVL_INTERVALLI,
  LIMITI_PVL_PREDEFINITI,
  codiceFiscaleSa,
  confrontaVersioniPvl,
  cpvDaDescrizione,
  cpvRicercaPvl,
  dataPvl,
  leggiAvvisoPvl,
  leggiPaginaGrezza,
  limitiPvl,
  limitiPvlDaRighe,
  numeroTedDaLink,
  parametriRicercaPvl,
  scadenzaPvl,
  urlAvvisoPvl,
  type BandoPvl,
  type EsitoPvl,
  type LimitiPvl,
} from "../src/lib/radar/fonti/pvl-calcoli";
import { ErrorePvl, SessionePvl } from "../src/lib/radar/fonti/pvl";
import { provinciaDaTesto } from "../src/lib/radar/province";
import { fusoItaliano } from "../src/lib/radar/fonti/ted-calcoli";
import { REGIONI } from "../src/lib/radar/territorio";
import { aperta, rigaDaBando, type RigaProcedura } from "../src/lib/radar/importa-calcoli";
import { conteggioAnomalo, cursorePvlValido, eOraDiUnGiroPvl, prossimoGiroPvl, rigaDaBandoPvl, CRON_PVL_PROPOSTO } from "../src/lib/radar/importa-pvl-calcoli";
import { conFinestra, conIncrementale, cursorePvlDaSalvato, cursorePvlNuovo, dopoPaginaFinestra } from "../src/lib/radar/importa-pvl-cursore";
import { confrontaVersioni, provenienzaImplicita, unisciLotti, unisciVersione, type LottoUnito, type VersioneFonte } from "../src/lib/radar/unione-calcoli";
import { ambienteDb, scrittureRadarConsentite, PROGETTO_PRODUZIONE, PROGETTO_STAGING } from "../src/lib/radar/ambiente";
import { validaParametro } from "../src/lib/console/tender-intelligence-calcoli";
import { rigaDaScrivere } from "../src/lib/radar/importa";
import { descriviAvvisoLetto, etichettaFonti, fonteDelDato, fontiDellaGara, riepilogoFonti } from "../src/lib/radar/fonti-gara-calcoli";
import { sintesiDeterministica } from "../src/lib/radar/sintesi-calcoli";
import { decidiCollegamento, garaDaMostrare } from "../src/lib/radar/collegamenti-calcoli";
import { collegaDoppioniPerAvvisoTed, scollegaGara } from "../src/lib/radar/collegamenti";
import { applicaPaginaBandiPvl } from "../src/lib/radar/importa-pvl-pagina";
import { statistichePvlVuote } from "../src/lib/radar/importa-pvl-calcoli";

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

async function principale() {
  const campione = JSON.parse(leggi("scripts/dati/radar-pvl-campione.json")) as { avvisi: Record<string, unknown>[] };
  const azioniConsole0 = leggi("src/app/site-console/azioni/tender-intelligence.ts");
  const letti = campione.avvisi.map(leggiAvvisoPvl);
  const bando = (i: number) => letti[i] as BandoPvl;

  // ───── 1. il campione non contiene dati di persone né aggiudicatari ─────
  const testoCampione = leggi("scripts/dati/radar-pvl-campione.json");
  atteso("campione senza aggiudicatari (decisione D6) né email", !/aggiudicatari|"soggetti"|@/.test(testoCampione.replace(/"nota": "[^"]*"/, "")));

  // ───── 2. lettura degli avvisi reali ─────
  uguale(
    "tipi riconosciuti: 9 bandi (P1_16, P1_17, P2_16, P2_19), 2 esiti, l'indagine P7_1_3 ammessa (C1, letta come le schede di bando), modifica e affidamento esclusi",
    letti.map((l) => (l.tipo === "esclusione" ? `x:${l.motivo}` : l.tipo)),
    ["bando", "bando", "bando", "bando", "bando", "bando", "bando", "bando", "bando", "esito", "esito", "bando", "x:modifica_contrattuale", "x:affidamento"],
  );
  const genova = bando(0);
  uguale("bando UE a tre lotti: chiave della procedura PVL", genova.record.chiaveProcedura, "pvl:194486c3-4660-4b96-b881-4b583af44acc");
  uguale("numero dell'avviso TED citato dalla PVL", genova.meta.numeroTed, "776475-2026");
  uguale("lotti numerati come TED, con un CIG ciascuno", genova.record.lotti.map((l) => [l.numero, l.cig]), [["LOT-0001", "BDAEC5A4B8"], ["LOT-0002", "BDAEC5B58B"], ["LOT-0003", "BDAEC5C65E"]]);
  uguale("valore = somma dei lotti", genova.record.valoreStimato, 720000);
  uguale("scadenza UE: giorno dal termine, ora da dataScadenza (stesso giorno a Roma)", [genova.record.scadenzaGiorno, genova.record.scadenzaOfferte, genova.record.scadenzaOraIndicata], ["2026-12-10", "2026-12-10T11:00:00.000Z", true]);
  uguale("luogo: provincia di Genova → GE, Liguria", [genova.record.ente.comune, genova.record.ente.provincia, genova.regioni], ["Genova", "GE", ["liguria"]]);
  uguale("collegamento ufficiale alla pagina della PVL", genova.record.urlAvviso, "https://pubblicitalegale.anticorruzione.it/bandi/560583c4-ac90-4e7e-bfb7-cbd656b11269");
  atteso("collegamento ai documenti della piattaforma dell'ente", genova.record.urlDocumenti === "https://appalti.comune.genova.it/PortaleAppalti/it/procedure/codice/G11913");
  atteso("CPV non del file approvato («pulitura di serbatoi»): nessun codice inventato, segnalato tra i dati mancanti", genova.record.cpvPrincipale === null && genova.mancanti.includes("cpv_non_riconosciuto"));
  atteso("… ma la gara è di pulizia per parola chiave (servizi)", genova.settori.includes("pulizia") && genova.metodoSettore === "parole_chiave");
  uguale("durata senza unità di misura: non letta", genova.record.durataMesi, null);
  uguale("procedura e criterio", [genova.record.tipoProcedura, genova.record.criterioAggiudicazione], ["Procedura aperta", "Offerta economicamente più vantaggiosa"]);

  const venezia = bando(1);
  uguale("CPV come descrizione ufficiale → codice del file", [venezia.record.cpvPrincipale, venezia.settori, venezia.metodoSettore], ["90919200", ["pulizia"], "cpv"]);
  uguale("scadenza UE con ora", [venezia.record.scadenzaGiorno, venezia.record.scadenzaOfferte], ["2026-12-14", "2026-12-14T12:00:00.000Z"]);
  const nazionale = bando(4);
  uguale("bando nazionale: nessun avviso TED citato", nazionale.meta.numeroTed, null);
  uguale("bando nazionale: ora dal termine di ricezione", [nazionale.record.scadenzaGiorno, nazionale.record.scadenzaOfferte, nazionale.record.scadenzaOraIndicata], ["2026-11-13", "2026-11-13T11:00:00.000Z", true]);
  uguale("ora a fine giornata scritta dalla fonte: si conserva com'è (non è presunta)", [bando(5).record.scadenzaGiorno, bando(5).record.scadenzaOfferte], ["2026-11-30", "2026-11-30T22:59:00.000Z"]);
  uguale("termine in UTC («Z») convertito, giorno di Roma", [bando(6).record.scadenzaGiorno, bando(6).record.scadenzaOfferte], ["2026-12-17", "2026-12-17T11:00:00.000Z"]);
  uguale("luogo assente: nessuna regione inventata", [bando(6).regioni, bando(6).mancanti.includes("regione")], [[], true]);
  uguale("settori speciali dalla scheda (P1_17)", [bando(8).record.settoriSpeciali, bando(1).record.settoriSpeciali], [true, false]);
  const esito = letti[9] as EsitoPvl;
  uguale("esito: solo lo stato e i CIG (mai i nomi)", [esito.stato, esito.cig, Object.keys(esito)], ["aggiudicata", ["BBC85B0F92"], ["tipo", "meta", "stato", "cig"]]);
  atteso("impronta stabile: due letture uguali, stessa impronta", leggiAvvisoPvl(campione.avvisi[0]).tipo === "bando" && (leggiAvvisoPvl(campione.avvisi[0]) as BandoPvl).record.impronta === genova.record.impronta);
  const rettificato = structuredClone(campione.avvisi[1]) as Record<string, unknown>;
  rettificato.dataScadenza = "2026-12-21T12:00:00.000+00:00";
  ((((rettificato.templates as Record<string, unknown>[])[0].template as Record<string, unknown>).sections as Record<string, unknown>[])[2].items as Record<string, unknown>[])[0].termine_ricezione = "2026-12-21+01:00";
  atteso("un dato cambiato cambia l'impronta", (leggiAvvisoPvl(rettificato) as BandoPvl).record.impronta !== venezia.record.impronta);
  uguale("avviso oscurato: escluso", (leggiAvvisoPvl({ ...campione.avvisi[1], oscurato: true }) as { motivo: string }).motivo, "oscurato");
  uguale("avviso malformato: escluso", (leggiAvvisoPvl({ idAvviso: "x" }) as { motivo: string }).motivo, "avviso_malformato");
  const revocato = leggiAvvisoPvl({ ...campione.avvisi[1], nuovoAvviso: "11111111-2222-3333-4444-555555555555", tipoNuovoAvviso: "ANNULLAMENTO" }) as BandoPvl;
  uguale("avviso sostituito da un annullamento → gara annullata", [revocato.record.annullata, revocato.meta.sostituitoDa], [true, "11111111-2222-3333-4444-555555555555"]);
  atteso("ordine delle versioni PVL: istante di pubblicazione", confrontaVersioniPvl({ data: "2026-11-10T07:00:00.000Z", idAvviso: "b" }, { data: "2026-11-12T07:00:00.000Z", idAvviso: "a" }) < 0);

  // ───── 3. scadenza: mai un'ora presunta ─────
  uguale("termine senza ora e dataScadenza a mezzanotte di Roma → solo il giorno", scadenzaPvl("2026-12-09T23:00:00.000+00:00", "2026-12-10+01:00"), { giorno: "2026-12-10", iso: null, oraIndicata: false, fonte: "2026-12-10+01:00" });
  uguale("termine e dataScadenza in giorni diversi → solo il giorno del termine", scadenzaPvl("2026-12-11T10:00:00.000+00:00", "2026-12-10+01:00")?.iso ?? null, null);
  uguale("nessun termine, dataScadenza con ora → istante", scadenzaPvl("2026-12-11T10:00:00.000+00:00", null)?.iso ?? null, "2026-12-11T10:00:00.000Z");
  uguale("nessun dato → nessuna scadenza", scadenzaPvl(null, null), null);
  uguale("ora dalla data di scadenza descritta in ora italiana (nessun avviso di fuso inutile)", [genova.scadenzaFonte, fusoItaliano(genova.scadenzaFonte)], ["2026-12-10+01:00; ore 12:00 italiane dalla data di scadenza della PVL", true]);
  // nessuna ora predefinita nel connettore: lo controlla per tutto il codice la verifica della scadenza senza ora presunta (livello 1)
  const testoSrcPvl = ["src/lib/radar/fonti/pvl-calcoli.ts", "src/lib/radar/importa-pvl-calcoli.ts", "src/lib/radar/importa-pvl.ts", "src/lib/radar/importa-pvl-pagina.ts", "src/lib/radar/unione-calcoli.ts"].map(leggi).join("\n");

  // ───── 4. campi ausiliari ─────
  uguale("CPV: descrizione, codice con cifra di controllo, sconosciuto", [cpvDaDescrizione("Servizi di pulizia di uffici"), cpvDaDescrizione("90910000-9"), cpvDaDescrizione("Servizi di pulitura di serbatoi"), cpvDaDescrizione({ value: "Servizi di mensa" })], ["90919200", "90910000", null, "55510000"]);
  uguale("codice fiscale: identificativi interni ANAC non sono codici fiscali", [codiceFiscaleSa("00856930102"), codiceFiscaleSa("CFAVCP-0000ABC"), codiceFiscaleSa(" 0085693010 ")], ["00856930102", null, null]);
  uguale("numero TED dal collegamento", [numeroTedDaLink("https://ted.europa.eu/udl?uri=TED:NOTICE:787530-2026:TEXT:IT:HTML"), numeroTedDaLink("https://esempio.it")], ["787530-2026", null]);
  uguale(
    "province → sigla e regione; «ITALIA» e nomi sconosciuti → nulla",
    ["Venezia", "Forlì-Cesena", "Reggio Calabria", "Bolzano/Bozen", "Città metropolitana di Roma", "Barletta-Andria-Trani", "ITALIA", "", "ITH35", "Atlantide"].map((p) => { const x = provinciaDaTesto(p); return `${x.sigla ?? "-"}/${x.regione ?? "-"}`; }),
    ["VE/veneto", "FC/emilia_romagna", "RC/calabria", "BZ/trentino_alto_adige", "RM/lazio", "BT/puglia", "-/-", "-/-", "-/veneto", "-/-"],
  );
  atteso("ogni regione ha almeno una provincia", REGIONI.every((r) => ["Torino", "Aosta", "Genova", "Milano", "Trento", "Venezia", "Trieste", "Bologna", "Firenze", "Perugia", "Ancona", "Roma", "Pescara", "Campobasso", "Napoli", "Bari", "Potenza", "Catanzaro", "Palermo", "Cagliari"].some((p) => provinciaDaTesto(p).regione === r.id)));
  uguale("URL pubblico dell'avviso", urlAvvisoPvl("abc"), "https://pubblicitalegale.anticorruzione.it/bandi/abc");

  // ───── 5. interrogazione ─────
  uguale("ricerca: i 56 codici CPV del file approvato (6 aggiunti il 17/11) e poi i 60 dell'elenco di ricerca (C2), esatti, senza ripetizioni", [cpvRicercaPvl().length, new Set(cpvRicercaPvl()).size, cpvRicercaPvl().every((c) => /^\d{8}$/.test(c))], [116, 116, true]);
  uguale("data nel formato della ricerca", dataPvl("2026-11-09"), "09/11/2026");
  const p1 = parametriRicercaPvl({ da: "2026-11-09", a: "2026-11-16", cpv: ["90910000", "55510000"], avvisiPerPagina: 100, token: null });
  uguale("parametri della prima pagina", p1, { pageSize: "100", dataPubblicazioneStart: "09/11/2026", dataPubblicazioneEnd: "16/11/2026", sortField: "dataPubblicazione", sortDirection: "asc", operatore: "AND", cpv: "90910000,55510000" });
  const p2 = parametriRicercaPvl({ da: "2026-11-09", a: "2026-11-16", cpv: ["90910000"], avvisiPerPagina: 100, token: "TOK" });
  uguale("pagina successiva con il token", [p2.direzionePaginazione, p2.tokenPaginazione], ["AVANTI", "TOK"]);
  uguale("forma della pagina riconosciuta", leggiPaginaGrezza({ content: [{ idAvviso: "a" }], count: 1, lastPaginationToken: "t" }), { content: [{ idAvviso: "a" }], count: 1, token: "t" });
  uguale("forma cambiata → non riconosciuta", [leggiPaginaGrezza({ risultati: [] }), leggiPaginaGrezza({ content: [{ id: 1 }] }), leggiPaginaGrezza("<html>")], [null, null, null]);

  // ───── 6. limiti di cortesia ─────
  uguale("limiti predefiniti", LIMITI_PVL_PREDEFINITI, { avvisiPerPagina: 100, pausaMs: 3000, timeoutMs: 30000, tentativi: 2, richiesteMassime: 20 });
  uguale("valori fuori intervallo ignorati (mai più aggressivi)", limitiPvl({ pausaMs: 100, richiesteMassime: 500, tentativi: 9, avvisiPerPagina: 1000 }), LIMITI_PVL_PREDEFINITI);
  uguale("valori dalla console", limitiPvlDaRighe([{ chiave: "radar_pvl_pausa_ms", valore: "5000" }, { chiave: "radar_pvl_richieste_massime", valore: "8" }]), { ...LIMITI_PVL_PREDEFINITI, pausaMs: 5000, richiesteMassime: 8 });
  uguale("console: validazione nel server degli stessi intervalli", [validaParametro(CHIAVI_LIMITI_PVL.pausaMs, "1999").ok, validaParametro(CHIAVI_LIMITI_PVL.pausaMs, "2000"), validaParametro(CHIAVI_LIMITI_PVL.richiesteMassime, "61").ok], [false, { ok: true, valore: "2000" }, false]);
  atteso("pausa minima di 2 secondi, al massimo 3 tentativi, al massimo 60 richieste per giro", LIMITI_PVL_INTERVALLI.pausaMs.min === 2000 && LIMITI_PVL_INTERVALLI.tentativi.max === 3 && LIMITI_PVL_INTERVALLI.richiesteMassime.max === 60);

  const rapidi: LimitiPvl = { avvisiPerPagina: 100, pausaMs: 1, timeoutMs: 500, tentativi: 2, richiesteMassime: 3 };
  const risposte = (seq: (() => Response)[]) => {
    let i = 0;
    const chiamate: string[] = [];
    const f = (async (url: string | URL | Request, init?: RequestInit) => {
      chiamate.push(String(url));
      const ua = (init?.headers as Record<string, string>)["User-Agent"];
      if (!/^omnia-radar\//.test(ua)) throw new Error("user agent inatteso");
      const r = seq[Math.min(i, seq.length - 1)];
      i++;
      return r();
    }) as typeof fetch;
    return { f, chiamate };
  };
  const json = (o: unknown, stato = 200) => () => new Response(JSON.stringify(o), { status: stato, headers: { "content-type": "application/json" } });
  const pag = { content: [{ idAvviso: "a" }], count: 1, lastPaginationToken: null };
  const lettura = { da: "2026-11-09", a: "2026-11-16", cpv: ["90910000"], token: null };
  {
    const { f, chiamate } = risposte([json(pag)]);
    const s = new SessionePvl(rapidi, f);
    const p = await s.leggiPagina(lettura);
    uguale("200: pagina letta, una richiesta", [p.content.length, s.richieste, chiamate[0].startsWith("https://pubblicitalegale.anticorruzione.it/api/v0/avvisi-full-text-specializzata?")], [1, 1, true]);
  }
  for (const stato of [429, 403, 401]) {
    const { f } = risposte([json({}, stato), json(pag)]);
    const s = new SessionePvl(rapidi, f);
    const e = await s.leggiPagina(lettura).catch((x) => x);
    uguale(`${stato}: sospensione immediata, nessun nuovo tentativo`, [e instanceof ErrorePvl && e.sospendi, e.stato, s.richieste], [true, stato, 1]);
  }
  {
    const { f } = risposte([json({}, 503), json(pag)]);
    const s = new SessionePvl(rapidi, f);
    const p = await s.leggiPagina(lettura);
    uguale("503 poi 200: un nuovo tentativo, che conta come richiesta", [p.content.length, s.richieste], [1, 2]);
  }
  {
    const { f } = risposte([() => new Response("<html>Verifica di sicurezza</html>", { status: 200, headers: { "content-type": "text/html" } })]);
    const s = new SessionePvl(rapidi, f);
    const e = await s.leggiPagina(lettura).catch((x) => x);
    uguale("pagina HTML invece dei dati (verifica anti-robot): sospensione, nessun aggiramento", [e instanceof ErrorePvl && e.sospendi, s.richieste], [true, 1]);
  }
  {
    const { f } = risposte([json({ risultati: [] })]);
    const e = await new SessionePvl(rapidi, f).leggiPagina(lettura).catch((x) => x);
    atteso("struttura cambiata: sospensione", e instanceof ErrorePvl && e.sospendi);
  }
  {
    const { f } = risposte([json({}, 500)]);
    const s = new SessionePvl(rapidi, f);
    const e = await s.leggiPagina(lettura).catch((x) => x);
    uguale("500 ripetuto: errore dopo i tentativi ammessi, senza sospendere", [e instanceof ErrorePvl && !e.sospendi, s.richieste], [true, 2]);
  }
  {
    const { f } = risposte([json(pag)]);
    const s = new SessionePvl({ ...rapidi, richiesteMassime: 2 }, f);
    await s.leggiPagina(lettura);
    await s.leggiPagina(lettura);
    const e = await s.leggiPagina(lettura).catch((x) => x);
    uguale("tetto di richieste per giro: mai superato", [e instanceof ErrorePvl && e.tetto, s.richieste], [true, 2]);
  }
  {
    const lento = (async (_u: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_ok, ko) => init?.signal?.addEventListener("abort", () => ko(new Error("abort"))))) as typeof fetch;
    const s = new SessionePvl({ ...rapidi, timeoutMs: 50, tentativi: 1 }, lento);
    const e = await s.leggiPagina(lettura).catch((x) => x);
    atteso("tempo massimo per richiesta", e instanceof ErrorePvl && /tempo massimo/.test(e.message));
  }
  {
    const { f } = risposte([json(pag)]);
    const s = new SessionePvl({ ...rapidi, pausaMs: 120 }, f);
    const t0 = Date.now();
    await s.leggiPagina(lettura);
    await s.leggiPagina(lettura);
    atteso("pausa tra due richieste rispettata", Date.now() - t0 >= 115);
  }

  // ───── 7. unione TED + PVL nella stessa gara ─────
  const adesso = new Date("2026-11-16T12:00:00Z");
  const iso = adesso.toISOString();
  const rigaPvl = rigaDaBandoPvl(venezia, adesso);
  const vPvl: VersioneFonte = { fonte: "pvl", id: venezia.meta.idAvviso, giorno: venezia.meta.giorno, istante: venezia.meta.data, ted: "787530-2026" };
  // la stessa gara come la scriverebbe TED (testi diversi, durata e NUTS presenti, niente CIG né documenti diversi)
  const rigaTed: RigaProcedura = {
    ...rigaPvl,
    chiave: "ted:proc-venezia",
    oggetto: "Servizio triennale di pulizia della sede centrale (testo TED)",
    oggetto_breve: "Servizio triennale di pulizia della sede centrale (testo TED)",
    durata_mesi: 36,
    codice_nuts: "ITH35",
    ente_tipo: "body-pl",
    url_avviso: "https://ted.europa.eu/it/notice/-/detail/787530-2026",
    url_documenti: "https://venetostrade.esempio.it/doc",
    tipo_avviso: "cn-standard",
    data_pubblicazione: "2026-11-17",
    ultima_versione_il: "2026-11-17",
    ultima_versione_id: "787530-2026",
  };
  const vTed: VersioneFonte = { fonte: "ted", id: "787530-2026", giorno: "2026-11-17", istante: null, ted: "787530-2026" };

  const solo = unisciVersione(null, null, rigaPvl, vPvl, iso);
  uguale("PVL per prima: gara nuova con chiave PVL e provenienza per campo", [solo.riga.chiave, solo.provenienza.scadenza?.f, solo.provenienza._versione?.ted, solo.cambiamenti.length], [rigaPvl.chiave, "pvl", "787530-2026", 0]);
  const poiTed = unisciVersione(solo.riga, solo.provenienza, rigaTed, vTed, iso);
  uguale(
    "poi TED, stessa versione: stessa gara (chiave PVL), nessun cambiamento registrato",
    [poiTed.riga.chiave, poiTed.cambiamenti.length, poiTed.riga.rettificata],
    [rigaPvl.chiave, 0, false],
  );
  uguale("… TED riempie i dati che la PVL non dà (durata, NUTS), la PVL tiene testi e documenti", [poiTed.riga.durata_mesi, poiTed.riga.codice_nuts, poiTed.riga.oggetto === rigaPvl.oggetto, poiTed.riga.url_documenti === rigaPvl.url_documenti], [36, "ITH35", true, true]);
  uguale("… provenienza dei singoli dati conservata", [poiTed.provenienza.durata_mesi?.f, poiTed.provenienza.oggetto?.f, poiTed.provenienza.scadenza?.f], ["ted", "pvl", "pvl"]);
  uguale("… data di pubblicazione: la prima delle due fonti", poiTed.riga.data_pubblicazione, rigaPvl.data_pubblicazione);

  const tedPrima = unisciVersione(null, null, rigaTed, vTed, iso);
  const poiPvl = unisciVersione(tedPrima.riga, tedPrima.provenienza, rigaPvl, vPvl, iso);
  uguale("TED per primo, poi la PVL: stessa gara (chiave TED), nessun cambiamento", [poiPvl.riga.chiave, poiPvl.cambiamenti.length], ["ted:proc-venezia", 0]);
  uguale("… precedenza alla PVL per testi e documenti, TED tiene la durata", [poiPvl.riga.oggetto === rigaPvl.oggetto, poiPvl.riga.url_documenti === rigaPvl.url_documenti, poiPvl.riga.durata_mesi], [true, true, 36]);
  const daLegacy = unisciVersione({ ...rigaTed }, null, rigaPvl, vPvl, iso);
  uguale("gara TED importata prima della 0115 (provenienza implicita): stesso risultato", [daLegacy.riga.chiave, daLegacy.cambiamenti.length, daLegacy.riga.oggetto === rigaPvl.oggetto], ["ted:proc-venezia", 0, true]);
  uguale("provenienza implicita di una gara TED", provenienzaImplicita(rigaTed), { f: "ted", id: "787530-2026", g: "2026-11-17", t: null, ted: "787530-2026" });
  uguale(
    "gara TED di prima della 0115 unita alla PVL: i dati rimasti a TED restano attribuiti a TED (provenienza resa esplicita)",
    [daLegacy.provenienza.durata_mesi?.f, daLegacy.provenienza.codice_nuts?.f, daLegacy.provenienza.oggetto?.f, daLegacy.provenienza._versione?.f],
    ["ted", "ted", "pvl", "pvl"],
  );
  const daLegacyPoi = unisciVersione(daLegacy.riga, daLegacy.provenienza, rigaTed, vTed, iso);
  uguale("… e una nuova lettura TED della stessa versione non cambia nulla", [daLegacyPoi.cambiamenti.length, daLegacyPoi.riga.oggetto === rigaPvl.oggetto, daLegacyPoi.riga.durata_mesi], [0, true, 36]);

  // rettifica TED più recente (proroga), poi la stessa rettifica dalla PVL: un solo cambiamento
  const rettTed: RigaProcedura = { ...rigaTed, scadenza_giorno: "2026-12-21", scadenza_offerte: "2026-12-21T12:00:00.000Z", ultima_versione_il: "2026-11-25", ultima_versione_id: "800001-2026" };
  const vRettTed: VersioneFonte = { fonte: "ted", id: "800001-2026", giorno: "2026-11-25", istante: null, ted: "800001-2026" };
  const dopoRett = unisciVersione(poiTed.riga, poiTed.provenienza, rettTed, vRettTed, iso);
  uguale("rettifica TED più recente: proroga registrata una volta", [dopoRett.cambiamenti.map((c) => `${c.tipo}:${c.campo}`), dopoRett.riga.scadenza_giorno, dopoRett.riga.rettificata], [["proroga:scadenza_offerte"], "2026-12-21", true]);
  uguale("… ma l'oggetto resta quello della PVL (non è una rettifica dell'oggetto)", dopoRett.riga.oggetto === rigaPvl.oggetto, true);
  const rettPvl: RigaProcedura = { ...rigaPvl, scadenza_giorno: "2026-12-21", scadenza_offerte: "2026-12-21T12:00:00.000Z" };
  const vRettPvl: VersioneFonte = { fonte: "pvl", id: "rett-pvl", giorno: "2026-11-24", istante: "2026-11-24T07:00:00.000Z", ted: "800001-2026" };
  const dopoRettPvl = unisciVersione(dopoRett.riga, dopoRett.provenienza, rettPvl, vRettPvl, iso);
  uguale("la stessa rettifica dalla PVL: nessun cambiamento in più (niente notifiche doppie)", dopoRettPvl.cambiamenti.length, 0);
  // una versione più vecchia arriva in ritardo: non sovrascrive
  const vecchia = unisciVersione(dopoRett.riga, dopoRett.provenienza, rigaPvl, vPvl, iso);
  uguale("versione più vecchia arrivata dopo: la scadenza più recente resta", [vecchia.riga.scadenza_giorno, vecchia.cambiamenti.length], ["2026-12-21", 0]);
  // un dato vuoto non cancella quello dell'altra fonte
  const senzaValore = unisciVersione(poiTed.riga, poiTed.provenienza, { ...rigaTed, valore_stimato: null, ultima_versione_il: "2026-11-26", ultima_versione_id: "800002-2026" }, { ...vRettTed, id: "800002-2026", ted: "800002-2026", giorno: "2026-11-26" }, iso);
  uguale("un dato vuoto non cancella quello dell'altra fonte", senzaValore.riga.valore_stimato, rigaPvl.valore_stimato);
  // annullamento più recente
  const annullo = unisciVersione(poiTed.riga, poiTed.provenienza, { ...rigaPvl, stato: "annullata" }, { ...vPvl, id: "annullo", istante: "2026-11-30T07:00:00.000Z", giorno: "2026-11-30", ted: null }, iso);
  uguale("annullamento da una versione più recente", [annullo.riga.stato, annullo.cambiamenti.map((c) => c.tipo)], ["annullata", ["annullamento"]]);
  atteso("gara annullata mai mostrata aperta", !aperta(annullo.riga.stato, { giorno: annullo.riga.scadenza_giorno, iso: annullo.riga.scadenza_offerte }, adesso));

  // una sola fonte: comportamento identico a prima della B1-bis
  const t1: RigaProcedura = { ...rigaTed };
  const t2: RigaProcedura = { ...rigaTed, valore_stimato: null, scadenza_giorno: "2026-12-28", scadenza_offerte: null, scadenza_ora_indicata: false, ultima_versione_il: "2026-11-25", ultima_versione_id: "800001-2026" };
  const tt = unisciVersione(t1, null, t2, vRettTed, iso);
  uguale("solo TED, versione più recente: sostituisce tutto (anche un dato tolto) e registra come prima", [tt.riga.valore_stimato, tt.riga.scadenza_giorno, tt.cambiamenti.map((c) => `${c.tipo}:${c.campo}`).sort()], [null, "2026-12-28", ["proroga:scadenza_offerte", "rettifica:valore_stimato"]]);
  const tv = unisciVersione(t2, null, t1, vTed, iso);
  uguale("solo TED, versione più vecchia: nessun effetto", [tv.riga.scadenza_giorno, tv.cambiamenti.length, tv.campiPresi.length, tv.ultima], ["2026-12-28", 0, 0, false]);
  uguale("confronto versioni: numeri TED, istanti PVL, giorni", [confrontaVersioni(vRettTed, vTed) > 0, confrontaVersioni(vPvl, vTed), confrontaVersioni({ ...vPvl, ted: null, istante: "2026-11-13T08:00:00Z" }, { ...vPvl, ted: null }) > 0], [true, 0, true]);
  const conId = rigaDaScrivere({ ...poiTed.riga, id: "x", provenienza_campi: {} } as RigaProcedura, poiTed.provenienza);
  const senzaId = rigaDaScrivere(solo.riga, solo.provenienza);
  uguale("righe scritte a blocchi: stesse colonne per gare nuove ed esistenti, mai «id»", [Object.keys(conId).join(","), "id" in conId], [Object.keys(senzaId).join(","), false]);
  atteso("rigaDaBando accetta un avviso di qualunque fonte (stessa riga per la PVL)", rigaDaBando({ record: venezia.record, regioni: venezia.regioni, enteTipo: null, scadenzaFonte: venezia.scadenzaFonte, settori: venezia.settori, metodoSettore: venezia.metodoSettore, meta: { data: venezia.meta.giorno, numero: "pvl:x" } }, null, adesso).chiave === rigaPvl.chiave);

  // ───── 8. lotti ─────
  const lotto = (n: string, cig: string | null, valore: number | null): LottoUnito => ({ numero_lotto: n, cig, oggetto: `lotto ${n}`, cpv_principale: null, cpv_tutti: [], valore_stimato: valore, durata_mesi: 24, scadenza_giorno: "2026-12-10", scadenza_offerte: null, scadenza_ora_indicata: false, scadenza_fonte: null, url_documenti: null });
  const lottiTed = [lotto("LOT-0001", null, 240000), lotto("LOT-0002", null, 240000)];
  const lottiPvl = [{ ...lotto("LOT-0001", "BDAEC5A4B8", 240000), url_documenti: "https://doc.esempio.it" }, lotto("LOT-0002", "BDAEC5B58B", 240000)];
  const u1 = unisciLotti(lottiTed, lottiPvl, "pvl", false);
  uguale("lotti allineati: i CIG della PVL sui lotti di TED, la durata di TED resta", [u1.allineati, u1.lotti.map((l) => l.cig), u1.lotti[0].durata_mesi, u1.lotti[0].url_documenti], [true, ["BDAEC5A4B8", "BDAEC5B58B"], 24, "https://doc.esempio.it"]);
  const u2 = unisciLotti(u1.lotti, lottiTed, "ted", true);
  uguale("TED dopo la PVL: i CIG non si cancellano", u2.lotti.map((l) => l.cig), ["BDAEC5A4B8", "BDAEC5B58B"]);
  const u3 = unisciLotti(lottiTed, [lotto("LOT-0001", "BDAEC5A4B8", 100000), lotto("LOT-0002", "BDAEC5B58B", 380000)], "pvl", false);
  uguale("lotti con valori diversi: abbinamento non sicuro, nessun CIG assegnato", [u3.allineati, u3.lotti.map((l) => l.cig)], [false, [null, null]]);
  const u4 = unisciLotti([lotto("LOT-0001", "BAAAAAAAA1", 240000)], [lotto("LOT-0001", "BBBBBBBBB2", 240000)], "pvl", false);
  uguale("CIG diverso sullo stesso lotto: si tiene quello già presente e si conta", [u4.lotti[0].cig, u4.cigScartati], ["BAAAAAAAA1", 1]);

  // ───── 8bis. fonti mostrate al cliente ─────
  uguale("fonti della gara: dalla provenienza dei campi, altrimenti dalla chiave", [fontiDellaGara("ted:x", poiPvl.provenienza), fontiDellaGara("ted:x", {}), fontiDellaGara("pvl:y", null)], [["ted", "pvl"], ["ted"], ["pvl"]]);
  uguale("etichetta negli elenchi", [etichettaFonti(["ted", "pvl"]), etichettaFonti(["pvl"])], ["TED e PVL ANAC", "PVL ANAC"]);
  uguale("fonte di ogni dato", [fonteDelDato(poiTed.provenienza, "durata_mesi", "pvl:z"), fonteDelDato(poiTed.provenienza, "scadenza", "pvl:z"), fonteDelDato({}, "scadenza", "ted:z")], ["ted", "pvl", "ted"]);
  uguale("avvisi letti descritti senza identificativi interni", [descriviAvvisoLetto({ fonte: "ted", id_fonte: "787530-2026", tipo_avviso: "cn-standard" }), descriviAvvisoLetto({ fonte: "pvl", id_fonte: "uuid", tipo_avviso: "P1_16" }), descriviAvvisoLetto({ fonte: "pvl", id_fonte: "uuid", tipo_avviso: "A1_29" })], ["TED 787530-2026", "PVL ANAC, bando (scheda P1_16)", "PVL ANAC, esito (scheda A1_29)"]);
  const riep = riepilogoFonti(
    [
      { fonte: "ted", id_fonte: "787530-2026", url: "https://ted.europa.eu/it/notice/-/detail/787530-2026", pubblicato_il: "2026-11-17", tipo_avviso: "cn-standard", rilevato_il: "2026-11-17T10:00:00Z" },
      { fonte: "pvl", id_fonte: "a", url: "https://pubblicitalegale.anticorruzione.it/bandi/a", pubblicato_il: "2026-11-13", tipo_avviso: "P1_16", rilevato_il: "2026-11-16T19:00:00Z" },
      { fonte: "pvl", id_fonte: "b", url: null, pubblicato_il: "2026-11-20", tipo_avviso: "A1_29", rilevato_il: "2026-11-20T10:00:00Z" },
    ],
    { ted: "2026-11-18T09:20:00Z", pvl: "2026-11-20T17:05:00Z" },
  );
  uguale(
    "riepilogo per fonte: collegamento al bando (non all'esito), prima pubblicazione, ultima verifica della fonte",
    riep.map((r) => [r.fonte, r.url, r.avvisi, r.primaPubblicazione, r.verificataIl]),
    [["ted", "https://ted.europa.eu/it/notice/-/detail/787530-2026", 1, "2026-11-17", "2026-11-18T09:20:00Z"], ["pvl", "https://pubblicitalegale.anticorruzione.it/bandi/a", 2, "2026-11-13", "2026-11-20T17:05:00Z"]],
  );
  const frasiPvl = sintesiDeterministica({ oggetto: "x", settori: ["ristorazione"], cpvPrincipale: "55524000", ente: "Comune di Prova", comune: null, provincia: null, valoreStimato: 100000, durataMesi: null, nLotti: 1, tipoProcedura: null, criterio: null, scadenzaGiorno: "2026-12-01", scadenza: null, fonte: "PVL di ANAC", numeroAvviso: null, dataPubblicazione: "2026-11-13" });
  uguale("sintesi di una gara solo PVL: fonte e data, senza identificativo interno", frasiPvl.at(-1), "Fonte: PVL di ANAC, avviso pubblicato il 13 novembre 2026.");

  // ───── 8ter. gare doppie: collegamento reversibile (0117) ─────
  const gT = { id: "t", chiave: "ted:p", unita_a: null, unita_esclusa_con: [] };
  const gP = { id: "p", chiave: "pvl:a", unita_a: null, unita_esclusa_con: [] };
  uguale("doppione: resta la gara con l'avviso TED, si collega quella della PVL", decidiCollegamento("800001-2026", gT, gP), { collega: true, assorbita: "p", resta: "t", motivo: "stesso avviso TED 800001-2026, citato dalla PVL e letto da TED" });
  uguale(
    "niente collegamento: stessa gara, già collegata, annullato a mano, gara mancante",
    [decidiCollegamento("1-2026", gT, gT), decidiCollegamento("1-2026", gT, { ...gP, unita_a: "x" }), decidiCollegamento("1-2026", gT, { ...gP, unita_esclusa_con: ["t"] }), decidiCollegamento("1-2026", null, gP)].map((d) => (d.collega ? "collega" : d.motivo)),
    ["stessa_gara", "gia_collegata", "annullato_a_mano", "gara_mancante"],
  );
  uguale("gara da mostrare: quella che resta", [garaDaMostrare({ id: "p", unita_a: "t" }), garaDaMostrare({ id: "t", unita_a: null })], ["t", "t"]);
  const sql117 = leggi("supabase/migrations/0117_radar_collegamenti_reversibili.sql").replace(/--[^\n]*/g, "");
  atteso("0117 additiva, senza chiavi esterne, senza permessi nuovi", !/\bdrop\b|truncate|delete\s+from|\bupdate\s+public|references|grant/i.test(sql117) && /unita_a uuid/.test(sql117));
  atteso("ricerca: le gare collegate non compaiono negli elenchi", /\.is\("unita_a", null\)/.test(leggi("src/lib/radar/ricerca.ts")));
  atteso("scheda: una gara collegata porta a quella che resta", /if \(g\.unita_a\) redirect\(/.test(leggi("src/app/site-omnia-ai/dashboard/omnia-ai/opportunita/gara/[id]/page.tsx")));
  atteso("console: annullare un collegamento è solo per amministratori e registrato", /scollegaGaraDoppia[\s\S]*richiediAdminAzione[\s\S]*registroDisponibile\(admin\)[\s\S]*await registra\(admin, \[\{ oggetto: "gara:collegamento"/.test(azioniConsole0));
  atteso("collegamento mai notificabile e scrittura condizionata", /notificabile: false/.test(leggi("src/lib/radar/collegamenti.ts")) && /\.is\("unita_a", null\)\.select\("id"\)/.test(leggi("src/lib/radar/collegamenti.ts")));

  // ───── 8quater. unione e annullamento SENZA perdita di dati, su un database in memoria (nessuna rete, nessuna scrittura) ─────
  {
    const mem = databaseInMemoria({
      radar_procedure: [
        { id: "g-ted", chiave: "ted:proc-x", oggetto: "Pulizia (TED)", scadenza_giorno: "2026-12-21", unita_a: null, unita_il: null, unita_motivo: null, unita_esclusa_con: [], aggiornata_il: "2026-11-01T00:00:00Z" },
        { id: "g-pvl", chiave: "pvl:app-x", oggetto: "Pulizia (PVL)", scadenza_giorno: "2026-12-21", unita_a: null, unita_il: null, unita_motivo: null, unita_esclusa_con: [], aggiornata_il: "2026-11-01T00:00:00Z" },
      ],
      radar_procedure_fonti: [
        { procedura_id: "g-ted", fonte: "ted", id_fonte: "800002-2026", rif_ted: null },
        { procedura_id: "g-ted", fonte: "ted", id_fonte: "800001-2026", rif_ted: null },
        { procedura_id: "g-pvl", fonte: "pvl", id_fonte: "avviso-r", rif_ted: "800002-2026" },
      ],
      radar_lotti: [{ procedura_id: "g-pvl", numero_lotto: "LOT-0001", cig: "Z00000000A" }],
      radar_aggiornamenti: [{ procedura_id: "g-pvl", tipo: "nuova", campo: null, id_fonte: "avviso-r", notificabile: true }],
      omnia_ai_radar_salvate: [{ id: "s1", user_id: "impresa-sintetica", procedura_id: "g-pvl", monitorata: true }],
    });
    const senzaCollegamento = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).filter(([k]) => !["unita_a", "unita_il", "unita_motivo", "unita_esclusa_con", "aggiornata_il"].includes(k)));
    const fotografia = () => JSON.stringify({ gare: mem.tabelle.radar_procedure.map(senzaCollegamento), fonti: mem.tabelle.radar_procedure_fonti, lotti: mem.tabelle.radar_lotti, salvate: mem.tabelle.omnia_ai_radar_salvate, aggiornamenti: mem.tabelle.radar_aggiornamenti.filter((a) => a.tipo !== "correzione_dati") });
    const prima = fotografia();
    const misureMem = { richiesteDb: 0, msDb: 0 };
    const u1 = await collegaDoppioniPerAvvisoTed(mem.client, ["800002-2026"], "2026-11-17T12:00:00.000Z", misureMem);
    const pvlDopo = mem.tabelle.radar_procedure.find((r) => r.id === "g-pvl") as Record<string, unknown>;
    uguale("in memoria: unione — resta la gara TED, la PVL indica la gara che resta", [u1.collegate, pvlDopo.unita_a, (mem.tabelle.radar_procedure.find((r) => r.id === "g-ted") as Record<string, unknown>).unita_a], [1, "g-ted", null]);
    uguale("in memoria: unione senza perdita di dati (gare, fonti, lotti, gare salvate, cambiamenti invariati)", fotografia(), prima);
    uguale("in memoria: registro dell'unione su entrambe le gare, mai notificabile", mem.tabelle.radar_aggiornamenti.filter((a) => a.tipo === "correzione_dati").map((a) => [a.procedura_id, a.campo, a.valore_nuovo, a.notificabile]), [["g-pvl", "collegata_a", "g-ted", false], ["g-ted", "collegata_da", "g-pvl", false]]);
    const u2 = await collegaDoppioniPerAvvisoTed(mem.client, ["800002-2026"], "2026-11-17T13:00:00.000Z", misureMem);
    uguale("in memoria: ripetuta, non fa nulla (idempotente)", [u2.collegate, mem.tabelle.radar_aggiornamenti.filter((a) => a.tipo === "correzione_dati").length], [0, 2]);
    const a1 = await scollegaGara(mem.client, "g-pvl", "2026-11-17T14:00:00.000Z");
    uguale("in memoria: annullamento — torna visibile, collegamento escluso per sempre", [a1.ok, pvlDopo.unita_a, pvlDopo.unita_esclusa_con], [true, null, ["g-ted"]]);
    uguale("in memoria: annullamento senza perdita di dati", fotografia(), prima);
    uguale("in memoria: registro dell'annullamento su entrambe le gare", mem.tabelle.radar_aggiornamenti.filter((a) => a.campo === "collegamento_annullato").map((a) => [a.procedura_id, a.valore_precedente]), [["g-pvl", "g-ted"], ["g-ted", "g-pvl"]]);
    const u3 = await collegaDoppioniPerAvvisoTed(mem.client, ["800002-2026"], "2026-11-17T15:00:00.000Z", misureMem);
    uguale("in memoria: dopo l'annullamento non si ricollega da sola", [u3.collegate, u3.saltate, pvlDopo.unita_a], [0, { annullato_a_mano: 1 }, null]);
    uguale("in memoria: annullare una gara non collegata non cambia nulla", [(await scollegaGara(mem.client, "g-ted", "2026-11-17T16:00:00.000Z")).ok, fotografia()], [false, prima]);
  }

  // ───── 8quinquies. dopo il collegamento, una proroga pubblicata SOLO sulla PVL aggiorna la gara che resta (rilievo C1 di B2) ─────
  {
    const adessoC1 = new Date("2026-11-21T12:00:00Z");
    const resta = { ...rigaDaBandoPvl(venezia, adessoC1), chiave: "ted:proc-venezia", ultima_versione_id: "787530-2026", ultima_versione_il: "2026-11-17", id: "g-resta", provenienza_campi: {}, unita_a: null, unita_il: null, unita_motivo: null, unita_esclusa_con: [] };
    const copia = { ...rigaDaBandoPvl(venezia, adessoC1), id: "g-copia", provenienza_campi: {}, unita_a: "g-resta", unita_il: "2026-11-18T10:00:00.000Z", unita_motivo: "stesso avviso TED", unita_esclusa_con: [] };
    const mem = databaseInMemoria({
      radar_procedure: [resta, copia],
      radar_procedure_fonti: [
        { procedura_id: "g-resta", fonte: "ted", id_fonte: "787530-2026", id_procedura_fonte: "proc-venezia", rif_ted: null, impronta: "t" },
        { procedura_id: "g-copia", fonte: "pvl", id_fonte: venezia.meta.idAvviso, id_procedura_fonte: venezia.meta.idAppalto, rif_ted: "787530-2026", impronta: venezia.record.impronta },
      ],
      radar_lotti: [
        { procedura_id: "g-resta", numero_lotto: "LOT-0001", cig: null, oggetto: "lotto TED", cpv_principale: null, cpv_tutti: [], valore_stimato: 334750, durata_mesi: 36, scadenza_giorno: "2026-12-14", scadenza_offerte: "2026-12-14T12:00:00.000Z", scadenza_ora_indicata: true, scadenza_fonte: null, url_documenti: null },
        { procedura_id: "g-copia", numero_lotto: "LOT-0001", cig: "BDBDB123F0", oggetto: "lotto PVL", cpv_principale: "90919200", cpv_tutti: ["90919200"], valore_stimato: 334750, durata_mesi: null, scadenza_giorno: "2026-12-14", scadenza_offerte: "2026-12-14T12:00:00.000Z", scadenza_ora_indicata: true, scadenza_fonte: null, url_documenti: null },
      ],
      radar_aggiornamenti: [],
      omnia_ai_radar_salvate: [{ id: "s2", user_id: "impresa-sintetica", procedura_id: "g-copia", monitorata: true }],
      omnia_ai_radar_gare_aggiunte: [],
    });
    const copiaPrima = JSON.stringify({ g: mem.tabelle.radar_procedure.find((r) => r.id === "g-copia"), l: mem.tabelle.radar_lotti.filter((r) => r.procedura_id === "g-copia"), p: mem.tabelle.radar_procedure_fonti.filter((r) => r.procedura_id === "g-copia"), s: mem.tabelle.omnia_ai_radar_salvate });
    // proroga pubblicata solo sulla PVL: nuova versione della stessa procedura, con un avviso TED non (ancora) letto da TED
    const proroga = structuredClone(campione.avvisi[1]) as Record<string, unknown>;
    proroga.idAvviso = "00000000-0000-4000-8000-0000000000c1";
    proroga.dataPubblicazione = "2026-11-20T07:00:00.000+00:00";
    proroga.dataScadenza = "2026-12-21T12:00:00.000+00:00";
    const tpl = (proroga.templates as Record<string, unknown>[])[0].template as Record<string, unknown>;
    (tpl.metadata as Record<string, unknown>).link_eform_ted = "https://ted.europa.eu/udl?uri=TED:NOTICE:999999-2026:TEXT:IT:HTML";
    ((tpl.sections as Record<string, unknown>[])[2].items as Record<string, unknown>[])[0].termine_ricezione = "2026-12-21+01:00";
    const statC1 = statistichePvlVuote();
    await applicaPaginaBandiPvl(mem.client, [leggiAvvisoPvl(proroga) as BandoPvl], "incrementale", adessoC1, { richiesteDb: 0, msDb: 0 }, statC1);
    const restaDopo = mem.tabelle.radar_procedure.find((r) => r.id === "g-resta") as Record<string, unknown>;
    uguale("C1: la proroga solo PVL aggiorna la gara che resta (non la copia nascosta)", [restaDopo.scadenza_giorno, statC1.bandi.suGaraCollegata, statC1.bandi.conflitti, statC1.bandi.nuoveNazionali + statC1.bandi.nuoveSopraSogliaSenzaTed], ["2026-12-21", 1, 0, 0]);
    const agg = mem.tabelle.radar_aggiornamenti.filter((a) => a.tipo === "proroga");
    uguale("C1: proroga registrata sulla gara che resta, notificabile, una volta", agg.map((a) => [a.procedura_id, a.fonte, a.notificabile]), [["g-resta", "pvl", true]]);
    uguale("C1: il nuovo avviso PVL si registra sulla gara che resta", mem.tabelle.radar_procedure_fonti.filter((r) => r.id_fonte === "00000000-0000-4000-8000-0000000000c1").map((r) => r.procedura_id), ["g-resta"]);
    atteso(
      "C1: la copia nascosta resta identica (storico), gara salvata compresa",
      JSON.stringify({ g: mem.tabelle.radar_procedure.find((r) => r.id === "g-copia"), l: mem.tabelle.radar_lotti.filter((r) => r.procedura_id === "g-copia"), p: mem.tabelle.radar_procedure_fonti.filter((r) => r.procedura_id === "g-copia"), s: mem.tabelle.omnia_ai_radar_salvate }) === copiaPrima,
    );
    uguale("C1: il CIG resta sulla copia (lo mostra la scheda che resta), senza contarlo come scartato", [mem.tabelle.radar_lotti.find((r) => r.procedura_id === "g-resta")?.cig, statC1.bandi.cigScartati], [null, 0]);
  }

  // ───── 9. punto di ripresa e finestre (cursore v2 dal K4; recupero, buchi e completezza in verifica-radar-pvl-recupero.ts) ─────
  const ISTANTE = "2026-11-17T07:05:00.000Z";
  const f7 = conFinestra(cursorePvlNuovo("2026-11-17"), "2026-11-09", "2026-11-16");
  uguale("finestra controllata di 7 giorni", [f7.finestra?.da, f7.finestra?.a, f7.inCorso, f7.finestra?.token], ["2026-11-09", "2026-11-16", true, null]);
  const c1 = dopoPaginaFinestra(f7, 100, 150, "TOK1", 100);
  uguale("dopo una pagina piena: token salvato", [c1.finestra?.token, c1.finestra?.pagine, c1.inCorso], ["TOK1", 1, true]);
  uguale("pagina più corta del massimo: è l'ultima anche se la fonte dà un token (nessuna richiesta in più)", dopoPaginaFinestra(c1, 10, null, "TOK2", 100).inCorso, false);
  uguale(
    "fine dei risultati senza elenco: pagina vuota, non «struttura cambiata»",
    [leggiPaginaGrezza({ content: null, count: 110, lastPaginationToken: null }), leggiPaginaGrezza({ count: 0 }), leggiPaginaGrezza({ messaggio: "errore" })],
    [{ content: [], count: 110, token: null }, { content: [], count: 0, token: null }, null],
  );
  const c2 = dopoPaginaFinestra(c1, 20, null, null, 100);
  uguale("ultima pagina: giro finito, giorno letto", [c2.inCorso, c2.finestra, c2.ultimoGiorno], [false, null, "2026-11-16"]);
  const i2 = conIncrementale(c2, "2026-11-17", ISTANTE).incrementale;
  uguale("giro programmato, primo del giorno: dall'ultimo giorno meno uno a oggi", [i2?.da, i2?.a], ["2026-11-15", "2026-11-17"]);
  const lungo = conIncrementale({ ...c2, ultimoGiorno: "2026-10-01" }, "2026-11-17", ISTANTE);
  uguale("dopo un fermo lungo: incrementale al massimo 7 giorni indietro, il resto entra nei buchi (non si perde)", [lungo.incrementale?.da, lungo.buchi.map((b) => `${b.da}/${b.a}/${b.motivo}`)], ["2026-11-10", ["2026-09-30/2026-11-09/fermo"]]);
  const aMeta = { ...c2, inCorso: true, incrementale: { da: "2026-11-15", a: "2026-11-17", token: "TOK1", pagine: 1, dichiarati: 150, letti: 100 } };
  uguale("giro programmato interrotto: riprende dal suo token", conIncrementale(aMeta, "2026-11-17", ISTANTE).incrementale?.token, "TOK1");
  uguale("cursore illeggibile → cursore nuovo, giro da ieri a oggi", [cursorePvlValido({ versione: 2 }), conIncrementale(cursorePvlDaSalvato({ x: 1 }, "2026-11-17"), "2026-11-17", ISTANTE).incrementale?.da], [null, "2026-11-16"]);
  const finestra7 = { da: "2026-11-09", a: "2026-11-16" };
  uguale("numero di avvisi anomalo per la finestra", [conteggioAnomalo(500, finestra7), conteggioAnomalo(5000, finestra7), conteggioAnomalo(null, finestra7)], [false, true, false]);

  // ───── 10. giri programmati 8, 13, 18 ora italiana, con l'ora legale ─────
  uguale(
    "inverno (UTC+1): partono le 7:05, 12:05, 17:05 UTC, non le 6:05, 11:05, 16:05",
    ["2026-12-01T07:05:00Z", "2026-12-01T12:05:00Z", "2026-12-01T17:05:00Z", "2026-12-01T06:05:00Z", "2026-12-01T11:05:00Z", "2026-12-01T16:05:00Z"].map((d) => eOraDiUnGiroPvl(new Date(d))),
    [true, true, true, false, false, false],
  );
  uguale(
    "estate (UTC+2): partono le 6:05, 11:05, 16:05 UTC",
    ["2026-07-01T06:05:00Z", "2026-07-01T11:05:00Z", "2026-07-01T16:05:00Z", "2026-07-01T07:05:00Z"].map((d) => eOraDiUnGiroPvl(new Date(d))),
    [true, true, true, false],
  );
  uguale("cambio d'ora (29/03/2026): le 8 italiane sono le 6 UTC", eOraDiUnGiroPvl(new Date("2026-03-29T06:05:00Z")), true);
  uguale("prossimo giro previsto", [prossimoGiroPvl(new Date("2026-11-16T12:30:00Z")).toISOString(), prossimoGiroPvl(new Date("2026-11-16T17:30:00Z")).toISOString()], ["2026-11-16T17:00:00.000Z", "2026-11-17T07:00:00.000Z"]);
  uguale("cron proposto: le due ore UTC possibili per ognuno dei tre giri", CRON_PVL_PROPOSTO, "5 6,7,11,12,16,17 * * *");

  // ───── 11. protezione della produzione ─────
  const urlProd = `https://${PROGETTO_PRODUZIONE}.supabase.co`;
  const urlStaging = `https://${PROGETTO_STAGING}.supabase.co`;
  uguale("ambiente del database", [ambienteDb(urlProd), ambienteDb(urlStaging), ambienteDb("https://altro.supabase.co"), ambienteDb(undefined)], ["produzione", "staging", "sconosciuto", "sconosciuto"]);
  uguale(
    "PVL: solo staging, mai la produzione (nemmeno dal deploy di produzione)",
    [scrittureRadarConsentite("pvl", { NEXT_PUBLIC_SUPABASE_URL: urlStaging }).ok, scrittureRadarConsentite("pvl", { NEXT_PUBLIC_SUPABASE_URL: urlProd, VERCEL_ENV: "production" }).ok, scrittureRadarConsentite("pvl", { NEXT_PUBLIC_SUPABASE_URL: "https://altro.supabase.co" }).ok],
    [true, false, false],
  );
  uguale(
    "TED: produzione solo dal deploy di produzione; mai da un computer locale o da un'anteprima",
    [scrittureRadarConsentite("ted", { NEXT_PUBLIC_SUPABASE_URL: urlProd }).ok, scrittureRadarConsentite("ted", { NEXT_PUBLIC_SUPABASE_URL: urlProd, VERCEL_ENV: "preview" }).ok, scrittureRadarConsentite("ted", { NEXT_PUBLIC_SUPABASE_URL: urlProd, VERCEL_ENV: "production" }).ok, scrittureRadarConsentite("ted", { NEXT_PUBLIC_SUPABASE_URL: urlStaging }).ok],
    [false, false, true, true],
  );
  const importaPvl = leggi("src/lib/radar/importa-pvl.ts");
  atteso("giro PVL: guardia prima di qualunque accesso al database", importaPvl.indexOf('scrittureRadarConsentite("pvl"') > 0 && importaPvl.indexOf('scrittureRadarConsentite("pvl"') < importaPvl.indexOf('from("radar_fonti_stato")'));
  const importaTed = leggi("src/lib/radar/importa-ted.ts");
  atteso("giro TED: guardia prima di qualunque accesso al database", importaTed.indexOf('scrittureRadarConsentite("ted"') > 0 && importaTed.indexOf('scrittureRadarConsentite("ted"') < importaTed.indexOf('from("radar_fonti_stato")'));
  const azioni = leggi("src/app/site-console/azioni/tender-intelligence.ts");
  atteso("console: accendere la PVL è possibile solo sullo staging; ogni azione solo per amministratori e registrata", /impostaFontePvl[\s\S]*richiediAdminAzione[\s\S]*scrittureRadarConsentite\("pvl"[\s\S]*registra\(admin, \[\{ oggetto: "fonte:pvl:attiva"/.test(azioni));
  // regola del 17/11/2026: gli script che scrivono sullo staging partono solo dal lanciatore con un'autorizzazione registrata (porta)
  for (const [file, funzione] of [["scripts/radar-importa-pvl.ts", "async function main() {"], ["scripts/radar-importa-ted.ts", "async function main() {"], ["scripts/prova-radar-pvl-staging.ts", "async function principale() {"]] as const) {
    const t = leggi(file);
    const corpo = t.slice(t.indexOf(funzione));
    const nome = file.split("/").pop() as string;
    atteso(
      `${nome}: porta delle autorizzazioni come prima cosa (STOP senza lanciatore, controllaPorta prima del database)`,
      t.includes(funzione) && corpo.indexOf("process.env.TI_REGISTRO") > 0 && corpo.indexOf("process.env.TI_REGISTRO") < 200 && corpo.includes(`controllaPorta({ script: "${nome}" })`) && corpo.indexOf("controllaPorta(") < Math.min(...["createClient(", "eseguiImportazione", "pulisci()"].map((x) => (corpo.indexOf(x) < 0 ? Infinity : corpo.indexOf(x)))),
    );
  }
  const script = leggi("scripts/radar-importa-pvl.ts");
  atteso("script della prima importazione: rifiuta tutto ciò che non è lo staging", /PRODUZIONE|PROGETTO_PRODUZIONE/.test(script) && /RADAR_STAGING_REF/.test(script));

  // ───── 12. giri programmati configurati ma NON attivi; nessun polling; nessuna AI ─────
  const vercel = JSON.parse(leggi("vercel.json")) as { crons: { path: string }[] };
  atteso("nessun cron PVL in vercel.json (serve l'autorizzazione operativa)", !vercel.crons.some((c) => /pvl/.test(c.path)));
  const rotta = leggi("src/app/api/cron/radar-pvl/route.ts");
  // dal K1 (48C §3.1) l'interruttore RADAR_PVL_CRON e l'ora di Roma sono nella porta comune delle rotte cron (giro-programmato.ts)
  const porta = leggi("src/lib/radar/giro-programmato.ts") + leggi("src/lib/radar/programmazione-calcoli.ts");
  atteso("percorso del cron: segreto, interruttore RADAR_PVL_CRON=attivo, ora italiana", /CRON_SECRET/.test(rotta) && /portaGiroProgrammato\("pvl"/.test(rotta) && /pvl: "RADAR_PVL_CRON"/.test(porta) && /!== "attivo"/.test(porta) && /eOraDiUnGiro\(fonte, adesso\)/.test(porta));
  atteso("nessun modello AI nel connettore", !/anthropic|openai|@ai-sdk|claude-/i.test(testoSrcPvl + leggi("src/lib/radar/fonti/pvl.ts")));
  const componenti = fs.readdirSync(path.join(RADICE, "src/components/omnia-ai/opportunita")).map((f) => leggi(`src/components/omnia-ai/opportunita/${f}`)).join("\n");
  atteso("nessun controllo periodico nel browser", !/setInterval|refreshInterval|useSWR|router\.refresh\(\)\s*,\s*\d/.test(componenti));

  // ───── 13. migrazioni 0115 e 0116 ─────
  const sql115 = leggi("supabase/migrations/0115_radar_pvl_provenienza.sql").replace(/--[^\n]*/g, "");
  const sql116 = leggi("supabase/migrations/0116_radar_pvl_limiti.sql").replace(/--[^\n]*/g, "");
  atteso("0115/0116 additive (nessun drop, truncate, delete, update)", !/\bdrop\b|truncate|delete\s+from|\bupdate\s+public/i.test(sql115 + sql116));
  atteso("0115: nessun permesso nuovo ai clienti", !/grant[^;]*(anon|authenticated)/i.test(sql115) && !/create policy/i.test(sql115));
  atteso("0115: la fonte PVL nasce spenta", /\('pvl', false\)/.test(sql115));
  atteso("0116: valori iniziali uguali a quelli del codice", Object.entries(CHIAVI_LIMITI_PVL).every(([k, c]) => sql116.includes(`('${c}', '${LIMITI_PVL_PREDEFINITI[k as keyof LimitiPvl]}')`)));

  console.log(fallimenti.length === 0 ? "\nVerifica PVL: tutto a posto." : `\nVerifica PVL: ${fallimenti.length} controlli falliti:\n - ${fallimenti.join("\n - ")}`);
  process.exit(fallimenti.length === 0 ? 0 : 1);
}

// Un database in memoria con il sottoinsieme di supabase-js usato dal collegamento delle gare doppie (select con filtri eq/in/is/not,
// update condizionato, upsert con chiave unica e ignoreDuplicates, maybeSingle). Nessuna rete: serve a provare unione e annullamento
// senza scrivere su nessun database vero.
type RigaMem = Record<string, unknown>;
function databaseInMemoria(iniziali: Record<string, RigaMem[]>) {
  const tabelle: Record<string, RigaMem[]> = Object.fromEntries(Object.entries(iniziali).map(([k, v]) => [k, v.map((r) => structuredClone(r))]));
  let contatore = 0;
  const client = {
    from(nome: string) {
      const righe = (tabelle[nome] ??= []);
      const filtri: ((r: RigaMem) => boolean)[] = [];
      let operazione: { tipo: "select" } | { tipo: "update"; valori: RigaMem } | { tipo: "upsert"; nuove: RigaMem[]; chiavi: string[]; ignora: boolean } = { tipo: "select" };
      const esegui = () => {
        if (operazione.tipo === "update") {
          const colpite = righe.filter((r) => filtri.every((f) => f(r)));
          for (const r of colpite) Object.assign(r, structuredClone(operazione.valori));
          return { data: colpite.map((r) => ({ ...r })), error: null };
        }
        if (operazione.tipo === "upsert") {
          const { chiavi, ignora } = operazione;
          const toccate: RigaMem[] = [];
          for (const n of operazione.nuove) {
            const uguale = righe.find((r) => chiavi.every((k) => (r[k] ?? null) === (n[k] ?? null)));
            if (!uguale) {
              const nuova = structuredClone(n);
              if (nome === "radar_procedure" && !nuova.id) nuova.id = `mem-${++contatore}`;
              righe.push(nuova);
              toccate.push(nuova);
            } else {
              if (!ignora) Object.assign(uguale, structuredClone(n));
              toccate.push(uguale);
            }
          }
          return { data: toccate.map((r) => structuredClone(r)), error: null };
        }
        return { data: righe.filter((r) => filtri.every((f) => f(r))).map((r) => structuredClone(r)), error: null };
      };
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => (filtri.push((r) => r[c] === v), q),
        in: (c: string, v: unknown[]) => (filtri.push((r) => v.includes(r[c])), q),
        is: (c: string, v: null) => (filtri.push((r) => (r[c] ?? null) === v), q),
        not: (c: string, _op: "is", v: null) => (filtri.push((r) => (r[c] ?? null) !== v), q),
        update: (valori: RigaMem) => ((operazione = { tipo: "update", valori }), q),
        upsert: (nuove: RigaMem[], o: { onConflict: string; ignoreDuplicates?: boolean }) => ((operazione = { tipo: "upsert", nuove, chiavi: o.onConflict.split(","), ignora: !!o.ignoreDuplicates }), q),
        returns: () => q,
        maybeSingle: () => Promise.resolve({ data: (esegui().data as RigaMem[] | null)?.[0] ?? null, error: null }),
        then: (ok: (v: { data: unknown; error: null }) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(esegui()).then(ok, ko),
      };
      return q;
    },
  };
  return { tabelle, client: client as unknown as Parameters<typeof collegaDoppioniPerAvvisoTed>[0] };
}

principale().catch((e) => {
  console.error(e);
  process.exit(1);
});
