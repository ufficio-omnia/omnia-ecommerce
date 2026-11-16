// Verifica della fase B1 di Tender Intelligence: lettura degli avvisi TED, unione delle versioni (rettifiche, proroghe, annullamenti, esiti),
// punto di ripresa dell'importazione, sinonimi dalla mappa CPV, ricerca e rilevanza, gare aggiunte a mano, parametri della console, titolo
// breve e sintesi senza modello, territorio; più controlli sul codice (guardie, registro, nessuna AI, nessun controllo periodico nel browser,
// migrazioni additive). Gli avvisi qui sotto sono SINTETICI, costruiti sulla forma delle risposte reali dell'API di TED.
import fs from "fs";
import path from "path";
import {
  AVVISI_PER_PAGINA,
  CAMPI_BANDO,
  CAMPI_ESITO,
  PAROLE_TED,
  cigEtichettati,
  corpoRichiesta,
  eEsclusione,
  fineGiornoRoma,
  fusoItaliano,
  impronta,
  leggiBandoTed,
  leggiEsitoTed,
  parolaTedCoperta,
  queryAvvisi,
  type BandoTed,
} from "../src/lib/radar/fonti/ted-calcoli";
import { aperta, cambiamentiTraVersioni, notificabile, piuRecente, rigaDaBando, statoDopoEsito, statoMostrato } from "../src/lib/radar/importa-calcoli";
import { cursoreAllAvvio, cursoreDopoPagina, cursoreIniziale, finestraCorrente, serveNuovoRecupero, type CursoreTed } from "../src/lib/radar/importa-ted-calcoli";
import { SINONIMI, espandiDomanda } from "../src/lib/radar/sinonimi";
import { CANDIDATI_MASSIMI, PAGINE_MASSIME, analizzaDomanda, filtriDaParametri, ordinaCandidati, parametriDaFiltri, punteggioRilevanza } from "../src/lib/radar/ricerca-calcoli";
import { scadenzaDaCampi, validaGaraAggiunta } from "../src/lib/radar/aggiunte-calcoli";
import { CHIAVI_MODIFICABILI, etichettaParametro, modificheParametri, validaParametro } from "../src/lib/console/tender-intelligence-calcoli";
import { euro, sintesiDeterministica, titoloBreve } from "../src/lib/radar/sintesi-calcoli";
import { comuneEProvincia, regioneDaNuts } from "../src/lib/radar/territorio";
import { classificaGara, settoriDaParole, testoPerConfronto, vociCpv } from "../src/lib/radar/settori";

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

// ───── 1. lettura degli avvisi TED (sintetici) ─────
const BANDO: Record<string, unknown> = {
  "publication-number": "700001-2026",
  "notice-identifier": "sintetico-avviso-1",
  "notice-version": 1,
  "notice-type": "cn-standard",
  "publication-date": "2026-10-01+02:00",
  "procedure-identifier": "sintetica-procedura-1",
  "buyer-name": { ita: ["Comune di Prova (dati sintetici)"] },
  "organisation-identifier-buyer": ["00000000000"],
  "buyer-city": { mul: ["VENEZIA (VE)"] },
  "buyer-country-sub": ["ITH35"],
  "buyer-legal-type": ["la"],
  "title-proc": { ita: "APPALTO 12/2026 PROCEDURA APERTA per l'affidamento del servizio triennale di pulizia degli uffici comunali (dati sintetici)" },
  "description-proc": { ita: "Descrizione sintetica dell'appalto." },
  "title-lot": { ita: ["Pulizia degli uffici comunali (dati sintetici)"] },
  "identifier-lot": ["LOT-0001"],
  "main-classification-proc": ["90919200"],
  "main-classification-lot": ["90919200"],
  "classification-cpv": ["90919200", "90919200"],
  "estimated-value-proc": "334750.00",
  "estimated-value-cur-proc": "EUR",
  "estimated-value-lot": ["334750.00"],
  "estimated-value-cur-lot": ["EUR"],
  "deadline-receipt-tender-date-lot": ["2026-12-14+01:00"],
  "deadline-receipt-tender-time-lot": ["13:00:00+01:00"],
  "procedure-type": "open",
  "contract-nature-main-proc": "services",
  "legal-basis": ["32014L0024"],
  "document-url-lot": ["https://piattaforma.esempio.test/gara/1"],
  "duration-period-value-lot": ["36"],
  "duration-period-unit-lot": ["MONTH"],
  "place-of-performance-subdiv-proc": ["ITH35"],
  "award-criterion-type-lot": ["quality", "quality", "price"],
};
const comeBando = (n: Record<string, unknown>) => {
  const b = leggiBandoTed(n);
  if (eEsclusione(b)) throw new Error(`avviso sintetico escluso: ${b.motivo}`);
  return b;
};
const b1 = comeBando(BANDO);
uguale("chiave stabile della procedura", b1.record.chiaveProcedura, "ted:sintetica-procedura-1");
uguale("settore dal CPV del file", [b1.settori, b1.metodoSettore], [["pulizia"], "cpv"]);
uguale("scadenza con ora e fuso italiano", [b1.record.scadenzaOfferte, b1.record.scadenzaOraIndicata], ["2026-12-14T12:00:00.000Z", true]);
uguale("valore stimato, durata, lotti", [b1.record.valoreStimato, b1.record.durataMesi, b1.record.lotti.length], [334750, 36, 1]);
uguale("ente: comune e provincia dalla sigla, codice fiscale", [b1.record.ente.comune, b1.record.ente.provincia, b1.record.ente.codiceFiscale], ["Venezia", "VE", "00000000000"]);
uguale("regione dal luogo di esecuzione (NUTS)", b1.regioni, ["veneto"]);
uguale("procedura, criterio, natura, settori speciali", [b1.record.tipoProcedura, b1.record.criterioAggiudicazione, b1.record.natura, b1.record.settoriSpeciali], ["Procedura aperta", "Offerta economicamente più vantaggiosa", "servizi", false]);
atteso("collegamento all'avviso ufficiale e ai documenti", b1.record.urlAvviso === "https://ted.europa.eu/it/notice/-/detail/700001-2026" && b1.record.urlDocumenti === "https://piattaforma.esempio.test/gara/1");
atteso("scadenza della fonte conservata", b1.scadenzaFonte === "2026-12-14+01:00 13:00:00+01:00" && fusoItaliano(b1.scadenzaFonte));

const senzaOra = comeBando({ ...BANDO, "deadline-receipt-tender-time-lot": [] });
uguale("scadenza senza ora: ora non indicata, fine del giorno solo per la scadenza", [senzaOra.record.scadenzaOraIndicata, senzaOra.record.scadenzaOfferte], [false, fineGiornoRoma("2026-12-14")]);
uguale("fine del giorno a Roma in inverno e in estate", [fineGiornoRoma("2026-12-14"), fineGiornoRoma("2026-07-14")], ["2026-12-14T22:59:59.000Z", "2026-07-14T21:59:59.000Z"]);
const inUtc = comeBando({ ...BANDO, "deadline-receipt-tender-date-lot": ["2026-12-09Z"], "deadline-receipt-tender-time-lot": ["13:00:00Z"] });
atteso("ora in UTC («Z»): istante esatto e fuso segnalato come non italiano", inUtc.record.scadenzaOfferte === "2026-12-09T13:00:00.000Z" && !fusoItaliano(inUtc.scadenzaFonte));

const multilotto = comeBando({
  ...BANDO,
  "identifier-lot": ["LOT-0001", "LOT-0002"],
  "title-lot": { ita: ["Lotto uno (dati sintetici)", "Lotto due (dati sintetici)"] },
  "estimated-value-lot": ["100.00"],
  "deadline-receipt-tender-date-lot": ["2026-12-20+01:00", "2026-12-10+01:00"],
  "deadline-receipt-tender-time-lot": ["12:00:00+01:00", "12:00:00+01:00"],
});
atteso("array dei lotti sfalsati: nessun valore attribuito al lotto sbagliato", multilotto.record.lotti.every((l) => l.valoreStimato === null) && multilotto.record.valoreStimato === 334750);
uguale("più lotti: la scadenza della gara è la più vicina", multilotto.record.scadenzaOfferte, "2026-12-10T11:00:00.000Z");

const perParola = leggiBandoTed({ ...BANDO, "title-proc": { ita: "Servizio di mensa per la residenza per anziani (dati sintetici)" }, "title-lot": { ita: ["Mensa (dati sintetici)"] }, "main-classification-proc": ["85311000"], "classification-cpv": ["85311000"], "main-classification-lot": ["85311000"] });
atteso("trovata per parola chiave sull'oggetto (servizi)", !eEsclusione(perParola) && (perParola as BandoTed).metodoSettore === "parole_chiave" && (perParola as BandoTed).settori.includes("ristorazione"));
const rifiuti = leggiBandoTed({ ...BANDO, "title-proc": { ita: "Trasporto dei rifiuti biodegradabili di cucine e mense (dati sintetici)" }, "title-lot": { ita: ["Rifiuti (dati sintetici)"] }, "main-classification-proc": ["90510000"], "classification-cpv": ["90510000"], "main-classification-lot": ["90510000"] });
atteso("rifiuti «di cucine e mense»: esclusa", eEsclusione(rifiuti) && rifiuti.motivo === "fuori_settore");
const ingegneria = leggiBandoTed({ ...BANDO, "title-proc": { ita: "Servizi di ingegneria per i lavori di adeguamento della mensa (dati sintetici)" }, "title-lot": { ita: ["Progettazione (dati sintetici)"] }, "main-classification-proc": ["71220000"], "classification-cpv": ["71220000"], "main-classification-lot": ["71220000"] });
atteso("ingegneria e architettura trovata solo per parola: esclusa", eEsclusione(ingegneria));
const lavori = leggiBandoTed({ ...BANDO, "contract-nature-main-proc": "works", "title-proc": { ita: "Lavori di pulizia e risanamento (dati sintetici)" }, "title-lot": { ita: ["Lavori (dati sintetici)"] }, "main-classification-proc": ["45453100"], "classification-cpv": ["45453100"], "main-classification-lot": ["45453100"] });
atteso("lavori trovati solo per parola: esclusi", eEsclusione(lavori));
uguale("avviso senza numero di pubblicazione: malformato", (leggiBandoTed({ ...BANDO, "publication-number": undefined }) as { motivo: string }).motivo, "avviso_malformato");
atteso("dati del cliente o delle persone mai richiesti a TED", !CAMPI_BANDO.some((c) => /email|person|phone|contact/.test(c)) && !CAMPI_ESITO.some((c) => /email|person|phone|contact/.test(c)));
atteso("campi per pagina entro il limite dell'API (10.000)", CAMPI_BANDO.length * AVVISI_PER_PAGINA <= 10_000);

uguale("esito con un vincitore: aggiudicata", leggiEsitoTed({ ...BANDO, "notice-type": "can-standard", "winner-selection-status": ["selec-w", "clos"] })?.stato, "aggiudicata");
uguale("esito senza vincitore su tutti i lotti: chiusa senza aggiudicazione", leggiEsitoTed({ ...BANDO, "notice-type": "can-standard", "winner-selection-status": ["clos", "clos"] })?.stato, "chiusa_senza_aggiudicazione");
uguale("esito ancora aperto: stato invariato", leggiEsitoTed({ ...BANDO, "notice-type": "can-standard", "winner-selection-status": ["open-nw"] })?.stato, null);

atteso("ogni parola cercata in TED fa scattare una regola approvata", PAROLE_TED.every(parolaTedCoperta), PAROLE_TED.filter((p) => !parolaTedCoperta(p)).join(", "));
const cpv = vociCpv().map((v) => v.cpv);
const q = queryAvvisi("bando", cpv, "2026-10-01", "2026-10-31");
atteso("query: Italia, tipi di bando, i 50 CPV, intervallo di date, ordine di pubblicazione", q.startsWith("buyer-country=ITA AND notice-type IN (cn-standard") && cpv.every((c) => q.includes(c)) && q.includes("publication-date>=20261001 AND publication-date<=20261031") && q.endsWith("SORT BY publication-number"));
let erroreCpv = false;
try {
  queryAvvisi("bando", ["90910000) OR (x"], "2026-10-01", "2026-10-31");
} catch {
  erroreCpv = true;
}
atteso("query: un CPV non valido viene rifiutato (nessuna iniezione nella query)", erroreCpv);
uguale("richiesta: 250 avvisi per pagina, numerazione delle pagine", [corpoRichiesta(q, CAMPI_BANDO, 3).limit, corpoRichiesta(q, CAMPI_BANDO, 3).page, corpoRichiesta(q, CAMPI_BANDO, 3).paginationMode], [250, 3, "PAGE_NUMBER"]);
uguale("CIG solo se scritto con l'etichetta", [cigEtichettati("gara 54/2026 - CIG BB516EC957"), cigEtichettati("codice BB516EC957 senza etichetta")], [["BB516EC957"], []]);
atteso("impronta stabile e indipendente dall'ordine delle chiavi", impronta({ a: 1, b: [1, 2] }) === impronta({ b: [1, 2], a: 1 }) && impronta({ a: 1 }) !== impronta({ a: 2 }));

// ───── 2. versioni: rettifiche, proroghe, annullamenti, esiti ─────
const adesso = new Date("2026-11-16T10:00:00Z");
const riga1 = rigaDaBando(b1, null, adesso);
const b2 = comeBando({ ...BANDO, "publication-number": "710001-2026", "notice-version": 2, "publication-date": "2026-10-10+02:00", "change-reason-code": ["update-add"], "deadline-receipt-tender-date-lot": ["2026-12-21+01:00"] });
atteso("la rettifica è più recente del bando", piuRecente(b2.meta, { data: riga1.ultima_versione_il, numero: riga1.ultima_versione_id }));
const riga2 = rigaDaBando(b2, riga1, adesso);
uguale("scadenza spostata in avanti = proroga", cambiamentiTraVersioni(riga1, riga2).map((c) => [c.tipo, c.campo]), [["proroga", "scadenza_offerte"]]);
uguale("la data di pubblicazione resta quella del primo avviso", riga2.data_pubblicazione, "2026-10-01");
const b3 = comeBando({ ...BANDO, "publication-number": "720001-2026", "notice-version": 3, "publication-date": "2026-10-20+02:00", "change-reason-code": ["cancel"] });
const riga3 = rigaDaBando(b3, riga2, adesso);
atteso("avviso di annullamento: gara annullata e cambiamento registrato", riga3.stato === "annullata" && cambiamentiTraVersioni(riga2, riga3).some((c) => c.tipo === "annullamento"));
atteso("un avviso più vecchio non sovrascrive quello più recente", !piuRecente(b1.meta, { data: riga2.ultima_versione_il, numero: riga2.ultima_versione_id }));
atteso("stesso giorno: vale il numero di pubblicazione più alto", piuRecente({ data: "2026-10-01", numero: "700002-2026" }, { data: "2026-10-01", numero: "700001-2026" }));
const rigaAggiudicata = { ...riga1, stato: "aggiudicata" as const };
uguale("una correzione del bando non riapre una gara già aggiudicata", rigaDaBando(b2, rigaAggiudicata, adesso).stato, "aggiudicata");
uguale("esiti: aggiudicata, annullata resta annullata, nessun esito nessun cambio", [statoDopoEsito("aperta", "aggiudicata"), statoDopoEsito("annullata", "aggiudicata"), statoDopoEsito("aperta", null)], ["aggiudicata", null, null]);
const futura = "2026-12-14T12:00:00.000Z";
const passata = "2026-11-01T12:00:00.000Z";
uguale("notificabile solo in sincronizzazione e su gare aperte (mai dallo storico)", [notificabile("recupero", "aperta", futura, adesso), notificabile("incrementale", "aperta", futura, adesso), notificabile("incrementale", "aperta", passata, adesso), notificabile("incrementale", "annullata", futura, adesso)], [false, true, false, false]);
uguale("«scaduta» si calcola dalla data", [statoMostrato("aperta", passata, adesso), statoMostrato("aperta", futura, adesso), aperta("aperta", null, adesso)], ["scaduta", "aperta", true]);

// ───── 3. punto di ripresa dell'importazione ─────
const c0 = cursoreIniziale("2026-11-16");
uguale("recupero: ultimi 12 mesi, prima i bandi", [c0.fase, c0.inCorso, c0.da, c0.a, c0.tipo, c0.pagina], ["recupero", true, "2025-11-16", "2026-11-16", "bando", 1]);
uguale("recupero: finestre di 31 giorni", finestraCorrente(c0), { da: "2025-11-16", a: "2025-12-16" });
uguale("pagina piena: si passa alla pagina successiva", cursoreDopoPagina(c0, 250, 600, 250, "2026-11-16").pagina, 2);
uguale("finestra finita: si passa alla successiva dalla prima pagina", (({ finestraDa, pagina }: CursoreTed) => [finestraDa, pagina])(cursoreDopoPagina({ ...c0, pagina: 3 }, 100, 600, 250, "2026-11-16")), ["2025-12-17", 1]);
const ultimaBandi: CursoreTed = { ...c0, finestraDa: "2026-11-01" };
uguale("bandi finiti: si passa agli esiti dall'inizio", (({ tipo, finestraDa }: CursoreTed) => [tipo, finestraDa])(cursoreDopoPagina(ultimaBandi, 10, 10, 250, "2026-11-16")), ["esito", "2025-11-16"]);
const finito = cursoreDopoPagina({ ...ultimaBandi, tipo: "esito" }, 10, 10, 250, "2026-11-16");
uguale("esiti finiti: recupero completato, si passa alla sincronizzazione", [finito.fase, finito.inCorso, finito.ultimoGiorno, finito.recuperoCompletatoIl], ["incrementale", false, "2026-11-16", "2026-11-16"]);
const giro = cursoreAllAvvio(finito, "2026-11-18");
uguale("sincronizzazione: dall'ultimo giorno meno 3 fino a oggi", [giro.fase, giro.inCorso, giro.da, giro.a, giro.tipo, giro.pagina], ["incrementale", true, "2026-11-13", "2026-11-18", "bando", 1]);
uguale("sincronizzazione: una sola finestra per tutto l'intervallo", finestraCorrente(giro), { da: "2026-11-13", a: "2026-11-18" });
uguale("cursore illeggibile: si riparte dal recupero", cursoreAllAvvio({ fase: "boh" }, "2026-11-16").fase, "recupero");
uguale("un giro interrotto riprende dal suo punto", cursoreAllAvvio({ ...giro, pagina: 2 }, "2026-11-18").pagina, 2);
atteso("importazione ferma da più di 15 mesi: nuovo recupero", serveNuovoRecupero({ ...finito, ultimoGiorno: "2025-01-01" }, "2026-11-16") && !serveNuovoRecupero(finito, "2026-11-16"));

// ───── 4. sinonimi dalla mappa CPV ─────
const descrizioni = new Map(vociCpv().map((v) => [v.cpv, testoPerConfronto(v.descrizione)]));
for (const g of SINONIMI) {
  for (const t of g.termini) {
    if (t.origine.tipo === "cpv") {
      const codice = t.origine.cpv;
      const d = descrizioni.get(codice);
      atteso(`sinonimo «${t.termine}»: compare nella descrizione del CPV ${codice} del file approvato`, !!d && testoPerConfronto(t.termine).split(" ").every((p) => d.includes(p)) && vociCpv().find((v) => v.cpv === codice)?.settore === g.settore);
    } else {
      atteso(`sinonimo «${t.termine}»: è una parola chiave approvata del settore`, settoriDaParole(t.termine).includes(g.settore));
    }
  }
}
const esp = espandiDomanda(["pulizie"]);
atteso("«pulizie» si allarga ai sinonimi della pulizia (e non ripete sé stessa)", esp.length === 1 && esp[0].settore === "pulizia" && esp[0].aggiunti.some((t) => t.termine === "sanificazione") && !esp[0].aggiunti.some((t) => t.termine.startsWith("puliz")));
uguale("una parola senza gruppo non si allarga", espandiDomanda(["scuole"]), []);

// ───── 5. ricerca: filtri, domanda, rilevanza ─────
const f = filtriDaParametri({ settore: ["pulizia", "inventato"], regione: "veneto,zz", min: "100.000", scadenza: "15", stato: "boh", ordina: "importo", pagina: "999" });
uguale("filtri dall'indirizzo: valori non validi ignorati", [f.settori, f.regioni, f.importoMin, f.scadenzaEntroGiorni, f.stato, f.ordina, f.pagina], [["pulizia"], ["veneto"], 100000, 15, "aperte", "importo", 1]);
const sp = new URLSearchParams(parametriDaFiltri({ ...f, q: "pulizia scuole", pagina: 2 }));
const daSp: Record<string, string[]> = {};
for (const [k, v] of sp) (daSp[k] ??= []).push(v);
uguale("filtri → indirizzo → filtri: stesso risultato", filtriDaParametri(daSp), { ...f, q: "pulizia scuole", pagina: 2 });
atteso("tetto dei candidati e pagine", CANDIDATI_MASSIMI === 500 && PAGINE_MASSIME === 20);
uguale("CIG cercato come CIG", analizzaDomanda(" b6bc58dfba ").cig, "B6BC58DFBA");
uguale("codice fiscale dell'ente", analizzaDomanda("00000000000").codiceFiscale, "00000000000");
const d1 = analizzaDomanda("pulizie scuole");
uguale("domanda con sinonimi in un unico gruppo", d1.tsquery, "(pulizie | sanificazione | disinfezione | disinfestazione | fumigazione | (igiene & ambientale)) & scuole");
atteso("domanda ripulita: solo lettere, cifre e operatori", /^[a-z0-9 &|()]+$/.test(analizzaDomanda("l'affidamento; DROP TABLE x -- 'pulizia'").tsquery ?? ""));
uguale("parole vuote ignorate", analizzaDomanda("di per la gara").tsquery, null);
const base = { oggetto_breve: null, sa_denominazione: "Comune di Prova", settori: ["pulizia"], valore_stimato: 100000, rettificata: false };
const buona = { ...base, id: "a", oggetto: "Servizio di pulizia delle scuole", metodo_settore: "cpv", scadenza_offerte: "2026-12-06T10:00:00Z", data_pubblicazione: "2026-11-14" };
const scaduta = { ...base, id: "b", oggetto: "Servizio di pulizia delle scuole", metodo_settore: "parole_chiave", scadenza_offerte: "2026-11-10T10:00:00Z", data_pubblicazione: "2026-10-01" };
const pb = punteggioRilevanza(buona, d1, { settori: [] }, adesso);
atteso("rilevanza spiegata: testo, CPV, tempo utile, novità", pb.motivi.some((m) => m.includes("nell'oggetto")) && pb.motivi.includes("settore riconosciuto dal CPV") && pb.motivi.some((m) => m.includes("giorni per preparare")) && pb.motivi.includes("pubblicata negli ultimi 7 giorni"));
const ordinati = ordinaCandidati([{ ...scaduta, punteggio: punteggioRilevanza(scaduta, d1, { settori: [] }, adesso) }, { ...buona, punteggio: pb }], "rilevanza");
uguale("per rilevanza la gara aperta e riconosciuta dal CPV viene prima", ordinati.map((r) => r.id), ["a", "b"]);

// ───── 6. gare aggiunte a mano ─────
const campi = { cig: "", url: "", oggetto: "", ente: "", scadenzaGiorno: "", scadenzaOra: "", importo: "" };
atteso("serve il CIG o il collegamento", !validaGaraAggiunta(campi).ok);
const v1 = validaGaraAggiunta({ ...campi, cig: " b6bc58dfba ", importo: "250.000,00", scadenzaGiorno: "2026-07-15", scadenzaOra: "12:00" });
uguale("CIG in maiuscolo, importo all'italiana, ora d'estate", v1.ok ? [v1.valori.cig, v1.valori.importo, v1.valori.scadenzaOfferte, v1.valori.scadenzaOraIndicata] : v1, ["B6BC58DFBA", 250000, "2026-07-15T10:00:00.000Z", true]);
atteso("collegamenti non web rifiutati", !validaGaraAggiunta({ ...campi, url: "javascript:alert(1)" }).ok && !validaGaraAggiunta({ ...campi, url: "ftp://x.test/a" }).ok && validaGaraAggiunta({ ...campi, url: "https://piattaforma.esempio.test/g/1" }).ok);
atteso("CIG malformato, ora senza giorno, importo non numerico: rifiutati", !validaGaraAggiunta({ ...campi, cig: "ABC" }).ok && !validaGaraAggiunta({ ...campi, cig: "B6BC58DFBA", scadenzaOra: "12:00" }).ok && !validaGaraAggiunta({ ...campi, cig: "B6BC58DFBA", importo: "molti" }).ok);
uguale("scadenza senza ora: non si presume", scadenzaDaCampi("2026-12-15", ""), { iso: fineGiornoRoma("2026-12-15"), oraIndicata: false });
uguale("migliaia con il punto", validaGaraAggiunta({ ...campi, cig: "B6BC58DFBA", importo: "1.234.567" }).ok ? (validaGaraAggiunta({ ...campi, cig: "B6BC58DFBA", importo: "1.234.567" }) as { valori: { importo: number } }).valori.importo : null, 1234567);

// ───── 7. parametri della console ─────
uguale("parametri modificabili: interruttore, 7 costi, 4 limiti (gli stessi della 0111)", CHIAVI_MODIFICABILI.length, 12);
atteso("ogni parametro modificabile esiste nella migrazione 0111", CHIAVI_MODIFICABILI.every((c) => leggi("supabase/migrations/0111_radar_coda_impostazioni.sql").includes(`('${c.chiave}', '`)));
uguale(
  "validazione nel server",
  [validaParametro("radar_attivo", "1"), validaParametro("radar_attivo", "2").ok, validaParametro("radar_costo_ricerca", "1001").ok, validaParametro("radar_costo_ricerca", "-1").ok, validaParametro("radar_costo_ricerca", "007"), validaParametro("radar_limite_ricerche_minuto", "30"), validaParametro("radar_limite_inventato", "1").ok],
  [{ ok: true, valore: "1" }, false, false, false, { ok: true, valore: "7" }, { ok: true, valore: "30" }, false],
);
uguale("si scrivono e registrano solo i valori cambiati", modificheParametri(new Map([["a", "1"]]), [{ chiave: "a", valore: "1" }, { chiave: "b", valore: "2" }]), [{ chiave: "b", prima: null, dopo: "2" }]);
uguale("messaggi con nomi leggibili", etichettaParametro("radar_limite_ricerche_minuto"), "Limite (ricerche al minuto)");

// ───── 8. titolo breve e sintesi senza modello ─────
uguale("titolo breve: via numerazione e formule", titoloBreve("APPALTO 64/2026 PROCEDURA APERTA per l'affidamento del servizio triennale di pulizia della sede centrale"), "Servizio triennale di pulizia della sede centrale");
uguale("titolo breve: maiuscolo riportato in minuscolo", titoloBreve("SERVIZIO DI VIGILANZA PRIVATA DIURNA"), "Servizio di vigilanza privata diurna");
atteso("titolo breve: l'appalto riservato resta scritto", titoloBreve("APPALTO RISERVATO AI SENSI DELL'ART. 61 D. LGS. 36/2023 DEI SERVIZI DI PULIZIA").startsWith("Appalto riservato: servizi di pulizia"));
atteso("titolo breve: al massimo 90 caratteri", titoloBreve(`Servizio di ${"pulizia ".repeat(30)}`).length <= 90);
uguale("importi con i centesimi", [euro(285504.8), euro(334750)], ["285.504,80 €", "334.750 €"]);
const sintesi = sintesiDeterministica({ oggetto: "x", settori: ["pulizia"], cpvPrincipale: "90919200", ente: "Comune di Prova", comune: "Venezia", provincia: "VE", valoreStimato: 334750, durataMesi: 36, nLotti: 1, tipoProcedura: "Procedura aperta", criterio: "Minor prezzo", scadenza: "2026-12-14T12:00:00.000Z", scadenzaOraIndicata: true, fonte: "TED", numeroAvviso: "700001-2026", dataPubblicazione: "2026-10-01" });
atteso("sintesi: solo dati dell'avviso", sintesi.includes("Servizi di pulizia di uffici: gara indetta da Comune di Prova (Venezia, VE).") && sintesi.includes("Valore stimato 334.750 €, durata 36 mesi.") && sintesi.includes("Offerte entro il 14 dicembre 2026, ore 13:00.") && sintesi.includes("Fonte: TED, avviso 700001-2026 pubblicato il 1 ottobre 2026."), sintesi.join(" | "));
const numeriSintesi = sintesi.join(" ").match(/\d[\d.,]*/g) ?? [];
atteso("sintesi: nessun numero che non venga dai dati", numeriSintesi.every((n) => ["334.750", "36", "14", "2026", "13:00", "13", "00", "700001-2026", "700001", "1", "2026."].some((x) => n.replace(/[.,]$/, "") === x.replace(/[.,]$/, "") || x.startsWith(n))), numeriSintesi.join(" "));

// ───── 9. territorio ─────
uguale("regioni dai codici NUTS", [regioneDaNuts("ITH35"), regioneDaNuts("ITH1"), regioneDaNuts("ITH20"), regioneDaNuts("FR101"), regioneDaNuts("ITZZZ")], ["veneto", "trentino_alto_adige", "trentino_alto_adige", null, null]);
uguale("comune e provincia", [comuneEProvincia("VENEZIA (VE)"), comuneEProvincia("SAN DONÀ DI PIAVE")], [{ comune: "Venezia", provincia: "VE" }, { comune: "San Donà di Piave", provincia: null }]);
atteso("classificazione invariata per le gare del file approvato", classificaGara({ cpvPrincipale: "71220000", cpvTutti: ["90919200"], testo: "mensa" }).metodo === "cpv");

// ───── 10. controlli sul codice ─────
const sql112 = leggi("supabase/migrations/0112_radar_b1_monitorate_aggiunte_registro.sql").replace(/--[^\n]*/g, "");
const sql113 = leggi("supabase/migrations/0113_radar_scadenza_fonte.sql").replace(/--[^\n]*/g, "");
atteso("0112/0113: additive (unico drop: il controllo dello stato, ricreato più ampio)", !/\bdrop\s+(table|column|policy|function|index)\b|truncate|delete\s+from/i.test(sql112 + sql113) && (sql112.match(/drop constraint/gi) ?? []).length === 1 && sql112.includes("drop constraint if exists radar_procedure_stato_check"));
for (const t of ["omnia_ai_radar_gare_aggiunte", "omnia_ai_radar_salvate"]) {
  atteso(`0112: ${t} con RLS e regola del titolare effettivo`, sql112.includes(`alter table public.${t} enable row level security`) && new RegExp(`create policy "${t}_all_account" on public\\.${t}\\s+for all using \\(\\(select public\\.omnia_ai_titolare_effettivo\\(\\)\\) = user_id\\)\\s+with check`).test(sql112));
  atteso(`0112: ${t} chiusa ai visitatori, permessi espliciti agli utenti e al server`, sql112.includes(`revoke all on public.${t} from anon`) && sql112.includes(`grant select, insert, update, delete on public.${t} to authenticated`) && sql112.includes(`grant select, insert, update, delete on public.${t} to service_role`));
}
atteso("0112: registro della console chiuso agli utenti, solo lettura e inserimento dal server", sql112.includes("alter table public.radar_console_registro enable row level security") && sql112.includes("revoke all on public.radar_console_registro from anon, authenticated") && sql112.includes("grant select, insert on public.radar_console_registro to service_role") && !/grant[^;]*(update|delete)[^;]*radar_console_registro/i.test(sql112));
atteso("0112: registro senza chiavi esterne sulle colonne di registro", !/radar_console_registro[\s\S]*references/i.test(sql112.slice(sql112.indexOf("create table if not exists public.radar_console_registro"), sql112.indexOf("create index if not exists radar_console_registro_data_idx"))));
atteso("0112: fonte TED creata SPENTA", sql112.includes("insert into public.radar_fonti_stato (fonte, attiva) values ('ted', false) on conflict (fonte) do nothing"));
atteso("0112: nessuna notifica per lo storico per difetto (notificabile = falso)", sql112.includes("add column if not exists notificabile boolean not null default false"));

const cartellaPagine = "src/app/site-omnia-ai/dashboard/omnia-ai/opportunita";
const pagine = (fs.readdirSync(path.join(RADICE, cartellaPagine), { recursive: true }) as string[]).map(String).filter((p) => p.endsWith("page.tsx"));
uguale("pagine di Opportunità previste", pagine.map((p) => p.replace(/\\/g, "/")).sort(), ["aggiungi/page.tsx", "aggiunta/[id]/page.tsx", "cerca/page.tsx", "gara/[id]/page.tsx", "monitorate/page.tsx", "page.tsx"]);
for (const p of pagine) {
  const s = leggi(`${cartellaPagine}/${p}`);
  const guardia = s.indexOf("await richiediTitolarePagina()");
  const diritto = s.indexOf("dirittoRadarOppure404(");
  const primoDato = s.search(/\.from\(|cercaGare\(|leggiGaraPubblica\(/);
  atteso(`${p}: guardia del titolare, poi diritto al modulo, poi i dati`, guardia >= 0 && diritto > guardia && (primoDato < 0 || primoDato > diritto) && !s.includes("auth.getUser"));
}
const azioniRadar = leggi("src/app/actions/radar.ts");
for (const m of azioniRadar.matchAll(/export async function (\w+)\(([\s\S]*?)\n\}/g)) {
  atteso(`azione ${m[1]}: guardia del titolare e diritto al modulo come prima cosa`, /^[^\n]*\{\n\s*const g = await conDiritto\(await richiediTitolareAzione\(\)\);/.test(m[2].slice(m[2].indexOf(")"))));
}
const azioniConsole = leggi("src/app/site-console/azioni/tender-intelligence.ts");
for (const m of azioniConsole.matchAll(/export async function (\w+)\(([\s\S]*?)\n\}/g)) {
  atteso(`console ${m[1]}: solo amministratori`, m[2].includes("const sessione = await richiediAdminAzione();\n  if (!sessione) return { errore: \"Non autorizzato.\" };"));
  if (m[1] !== "eseguiGiroTed") atteso(`console ${m[1]}: senza registro non salva, e registra la modifica`, m[2].includes("registroDisponibile(admin)") && m[2].includes("await registra(admin"));
}
atteso("console: i cambi di interruttori svuotano subito la cache del menu", /salvaParametriRadar[\s\S]*updateTag\(TAG_PARAMETRI_RADAR\)/.test(azioniConsole) && /impostaImpresaRadar[\s\S]*updateTag\(TAG_CLIENTI_RADAR\)/.test(azioniConsole));
const visibilita = leggi("src/lib/radar/visibilita.ts");
atteso("menu: interruttori letti dalla cache dei dati (nessuna lettura per pagina a modulo spento)", (visibilita.match(/unstable_cache\(/g) ?? []).length === 2 && visibilita.includes("revalidate: 300") && /radarNelMenu\(user\.id\),\r?\n\s*\]\);/.test(leggi("src/app/site-omnia-ai/dashboard/omnia-ai/layout.tsx")));

const sorgentiNuove = [
  ...(fs.readdirSync(path.join(RADICE, "src/lib/radar"), { recursive: true }) as string[]).map((f) => `src/lib/radar/${String(f)}`),
  ...(fs.readdirSync(path.join(RADICE, "src/components/omnia-ai/opportunita")) as string[]).map((f) => `src/components/omnia-ai/opportunita/${f}`),
  ...pagine.map((p) => `${cartellaPagine}/${p}`),
  "src/app/actions/radar.ts",
].filter((f) => /\.tsx?$/.test(f));
const testoNuovo = sorgentiNuove.map((f) => leggi(f.replace(/\\/g, "/"))).join("\n");
atteso("nessuna chiamata a modelli AI nella ricerca, nelle schede e nell'importazione", !/@\/lib\/(anthropic|voyage|openai)|api\.anthropic|api\.voyageai|api\.openai/.test(testoNuovo));
const componenti = (fs.readdirSync(path.join(RADICE, "src/components/omnia-ai/opportunita")) as string[]).map((f) => leggi(`src/components/omnia-ai/opportunita/${f}`)).join("\n");
atteso("nessun controllo periodico nel browser (niente setInterval, setTimeout, router.refresh)", !/setInterval|setTimeout|router\.refresh|useInterval/.test(componenti));
atteso("ricerca: nessun conteggio esatto costoso", !leggi("src/lib/radar/ricerca.ts").includes('count: "exact"'));
atteso("ricerca testuale in italiano sulla colonna indicizzata", leggi("src/lib/radar/ricerca.ts").includes('textSearch("ricerca", domanda.tsquery, { config: "italian" })'));
const ted = leggi("src/lib/radar/fonti/ted.ts");
atteso("TED: solo l'API ufficiale, nome generico del programma, almeno 1 s tra le richieste", leggi("src/lib/radar/fonti/ted-calcoli.ts").includes('URL_RICERCA_TED = "https://api.ted.europa.eu/v3/notices/search"') && /PAUSA_MS = 1_500/.test(ted) && !/ted\.europa\.eu\/(packages|.*\/search\/result)/.test(testoNuovo));
const cron = leggi("src/app/api/cron/radar-ted/route.ts");
const vercel = JSON.parse(leggi("vercel.json")) as { crons: { path: string; schedule: string }[] };
atteso("cron dell'importazione protetto e nei soli giorni feriali", cron.includes("cronAutorizzato(request.headers.get(\"authorization\"), process.env.CRON_SECRET)") && vercel.crons.some((c) => c.path === "/api/cron/radar-ted" && /\* \* 1-5$/.test(c.schedule)));
atteso("i cron di prima restano invariati", ["/api/cron/omnia-ai-purge-cessati", "/api/cron/omnia-ai-email-retry", "/api/cron/omnia-ai-demo-sync", "/api/cron/omnia-ai-demo-purge"].every((p) => vercel.crons.some((c) => c.path === p)));
atteso("importazione: si ferma se la fonte è spenta, un giro alla volta", leggi("src/lib/radar/importa-ted.ts").includes('if (!fonte || !fonte.attiva) return { eseguita: false, motivo: "fonte_spenta" };') && leggi("src/lib/radar/importa-ted.ts").includes(".or(`blocco_fino_a.is.null,blocco_fino_a.lt.${inizio.toISOString()}`)"));
atteso("script locale: solo contro lo staging dichiarato", leggi("scripts/radar-importa-ted.ts").includes('url.includes(PRODUZIONE) || !staging || !url.includes(`${staging}.supabase.co`)'));

if (fallimenti.length) {
  console.error(`\n${fallimenti.length} controlli falliti:\n- ${fallimenti.join("\n- ")}`);
  process.exit(1);
}
console.log("\nTutti i controlli della fase B1 di Tender Intelligence sono superati.");
