// Verifica del CLASSIFICATORE UNICO sui dati uniti (fase B2, 17/11/2026): una gara pubblicata da più fonti ha una classificazione coerente
// e le ambiguità si segnalano (decisione dell'utente del 17/11). Database IN MEMORIA, nessuna rete; tutti i dati sono SINTETICI.
//   1. un solo calcolo: lo stesso della riclassificazione e degli importatori (classificaGara di settori.ts);
//   2. una gara di una sola fonte non viene mai segnalata e si comporta come prima;
//   3. fonti d'accordo: nessuna segnalazione;
//   4. settori diversi, livelli diversi (A/B/C) e dati uniti diversi: segnalati, mai risolti da soli (i settori restano l'unione);
//   5. la segnalazione è interna: correzione_dati, mai notificabile, mai nella scheda del cliente; rileggere non la duplica;
//   6. stessa regola su TUTTE le scritture (TED, PVL e fonti regionali);
//   7. righe interne del registro mai mostrate ai clienti (anche i suggerimenti di unione), né quelle di una fonte nascosta.
import fs from "fs";
import path from "path";
import { databaseInMemoria, type RigaMem } from "./lib/db-in-memoria";
import { ambiguitaTraFonti, classificaPerArchivio, rigaSegnalazioneClassificazione, type ClassificazioneArchivio } from "../src/lib/radar/classificazione-unita";
import { riclassificaGara } from "../src/lib/radar/riclassifica-settori";
import { CAMPI_INTERNI_REGISTRO, CAMPO_CLASSIFICAZIONE_AMBIGUA, aggiornamentoPerCliente } from "../src/lib/radar/fonti-gara-calcoli";
import { VERSIONE_REGOLE_SETTORI } from "../src/lib/radar/settori";
import { leggiElementoAflink, type BandoAflink } from "../src/lib/radar/fonti/aflink-calcoli";
import { applicaPaginaBandiRegionali } from "../src/lib/radar/importa-regionali-pagina";
import { bandoDaAflink, statisticheRegionaliVuote, type BandoRegionale } from "../src/lib/radar/importa-regionali-calcoli";
import { applicaPaginaBandi } from "../src/lib/radar/importa";
import { leggiBandoTed } from "../src/lib/radar/fonti/ted-calcoli";
import { unisciVersione, type VersioneFonte } from "../src/lib/radar/unione-calcoli";
import type { RigaProcedura } from "../src/lib/radar/importa-calcoli";
import { leggiSegnalazioneClassificazione } from "../src/lib/console/tender-intelligence-calcoli";

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
const misure = () => ({ richiesteDb: 0, msDb: 0 });

// ───── testi SINTETICI ─────
const MENSA = "Servizio di ristorazione scolastica (prova sintetica)";
const RSA = "Gestione dei servizi socio-assistenziali e di ristorazione della residenza per anziani (prova sintetica)";
const PULIZIA = "Servizio di pulizia degli uffici comunali (prova sintetica)";
const CASONE = "Affidamento in concessione del casone “Paduli” per la durata di sette anni (prova sintetica)";
const BAR = "Concessione della gestione del bar e punto ristoro del parco comunale (prova sintetica)";
const dati = (oggetto: string, cpv: string[], natura: string | null = "servizi") => ({ oggetto, cpv_principale: cpv[0] ?? null, cpv_tutti: cpv, natura_contratto: natura });
const cl = (oggetto: string, cpv: string[], natura: string | null = "servizi"): ClassificazioneArchivio => classificaPerArchivio(dati(oggetto, cpv, natura), []);

function garaMem(id: string, p: Partial<RigaMem> = {}): RigaMem {
  return {
    id,
    chiave: `ted:proc-${id}`,
    oggetto: MENSA,
    oggetto_breve: "Ristorazione scolastica",
    descrizione: null,
    sa_codice_fiscale: "00000000001",
    sa_denominazione: "COMUNE DI PROVASINTETICA",
    sa_comune: null,
    sa_provincia: null,
    sa_regione: "sardegna",
    codice_nuts: null,
    luogo_regioni: ["sardegna"],
    ente_tipo: null,
    tipo_avviso: "cn-standard",
    tipo_procedura: "Procedura aperta",
    criterio_aggiudicazione: null,
    natura_contratto: "servizi",
    settori_speciali: false,
    data_pubblicazione: "2026-11-01",
    scadenza_giorno: "2026-12-10",
    scadenza_offerte: "2026-12-10T09:00:00.000Z",
    scadenza_ora_indicata: true,
    scadenza_fonte: "2026-12-10+01:00 10:00:00+01:00",
    valore_stimato: 2000000,
    durata_mesi: null,
    n_lotti: 1,
    stato: "aperta",
    rettificata: false,
    url_avviso: `https://ted.europa.eu/it/notice/-/detail/${id}`,
    url_documenti: null,
    piattaforma_host: null,
    cpv_principale: "55524000",
    cpv_tutti: ["55524000"],
    settori: ["ristorazione"],
    metodo_settore: "cpv",
    ultima_versione_il: "2026-11-01",
    ultima_versione_id: "700001-2026",
    ultima_rilevazione_il: "2026-11-01T08:00:00.000Z",
    aggiornata_il: "2026-11-01T08:00:00.000Z",
    valore_base: null,
    piattaforma_id: null,
    tipo_opportunita: "bando",
    partecipazione: "libera",
    provenienza_campi: {},
    unita_a: null,
    unita_il: null,
    unita_motivo: null,
    unita_esclusa_con: [],
    fonti: ["ted"],
    prima_rilevazione_il: "2026-11-01T08:00:00.000Z",
    ...p,
  };
}
const lottoMem = (procedura_id: string, p: Partial<RigaMem> = {}): RigaMem => ({ procedura_id, numero_lotto: "LOT-0001", cig: "PRV0000099", oggetto: null, cpv_principale: "55524000", cpv_tutti: ["55524000"], valore_stimato: 2000000, durata_mesi: null, scadenza_giorno: "2026-12-10", scadenza_offerte: "2026-12-10T09:00:00.000Z", scadenza_ora_indicata: true, scadenza_fonte: null, url_documenti: null, ...p });

function elementoSardegna(id: string, p: Record<string, string> = {}): Record<string, string> {
  return {
    link: `https://sardegnacat.regione.sardegna.it/portale/index.php/bandi?getdettaglio=yes&bando=${id}&scadenzaBando=2026-12-10T10:00:00`,
    Oggetto: MENSA,
    Tipo: "Bando",
    DenominazioneEnte: "COMUNE DI PROVASINTETICA",
    Contratto: "Servizi",
    a_base_asta: "1.900.000,00",
    DtScadenzaBandoTecnical: "2026-12-10T10:00:00",
    CIG: "PRV0000099",
    TipoProcedura: "Aperta",
    statoFunzionale: "PresOfferte",
    IdMsg: id,
    TitoloDocumento: "Prova sintetica",
    dataUltimaModifica: "2026-11-05T10:00:00",
    CPV: "55524000-9 - Servizi di ristorazione scolastica",
    DtPubblicazioneTecnical: "2026-11-03T11:00:00",
    ...p,
  };
}
const bandoSardegna = (id: string, p: Record<string, string> = {}): BandoRegionale => bandoDaAflink(leggiElementoAflink("sardegnacat", elementoSardegna(id, p), ADESSO) as BandoAflink, OGGI) as BandoRegionale;

async function importaSardegna(mem: ReturnType<typeof databaseInMemoria>, bandi: BandoRegionale[]) {
  const stat = statisticheRegionaliVuote();
  await applicaPaginaBandiRegionali(mem.client, bandi, { fonte: "sardegnacat", modo: "incrementale", adesso: ADESSO, misure: misure(), stat, nascoste: new Set(), proponi: false });
  return stat;
}
const segnalazioni = (mem: ReturnType<typeof databaseInMemoria>) => (mem.tabelle.radar_aggiornamenti ?? []).filter((a) => a.campo === CAMPO_CLASSIFICAZIONE_AMBIGUA);
const gara = (mem: ReturnType<typeof databaseInMemoria>, id: string) => mem.tabelle.radar_procedure.find((r) => r.id === id) as RigaMem;

async function principale() {
  // ═════ 1. un solo calcolo ═════
  {
    const casi: [string, string[], string | null, { oggetto: string | null; cpv_principale: string | null; cpv_tutti: string[] }[]][] = [
      [MENSA, ["55524000"], "servizi", []],
      [RSA, ["55524000"], "servizi", []],
      [PULIZIA, ["90910000"], "servizi", []],
      [CASONE, ["55524000"], "servizi", []],
      [BAR, ["55300000"], "servizi", []],
      ["Servizio di ristorazione (prova sintetica)", [], "servizi", []],
      ["Servizio di ristorazione (prova sintetica)", [], "forniture", []],
      ["Servizi integrati per la scuola (prova sintetica)", ["80000000"], "servizi", [{ oggetto: "Lotto 1: pulizia dei plessi (prova sintetica)", cpv_principale: "90919300", cpv_tutti: ["90919300"] }, { oggetto: "Lotto 2: refezione (prova sintetica)", cpv_principale: "55524000", cpv_tutti: [] }]],
      ["Lavori di manutenzione della mensa (prova sintetica)", ["45453000", "55524000"], "lavori", []],
    ];
    let uguali = 0;
    for (const [oggetto, cpv, natura, lotti] of casi) {
      const c = classificaPerArchivio(dati(oggetto, cpv, natura), lotti);
      const r = riclassificaGara({ id: "x", ...dati(oggetto, cpv, natura), settori: [], metodo_settore: null }, lotti);
      const atteso = r.tipo === "invariata" ? { settori: [], metodo: null } : r.dopo;
      if (JSON.stringify({ settori: c.settori, metodo: c.metodo }) === JSON.stringify(atteso)) uguali++;
      else console.log(`  diverso: ${oggetto}`, JSON.stringify(c), JSON.stringify(atteso));
    }
    uguale("1. stesso calcolo della riclassificazione (CPV di gara e lotti, oggetto + lotti, natura) su tutti i casi", uguali, casi.length);
    uguale("1. livelli: mensa A, gestione della RSA B (correlata), casone C (non pertinente)", [cl(MENSA, ["55524000"]).livello, cl(RSA, ["55524000"]).livello, cl(CASONE, ["55524000"]).livello], ["A", "B", "C"]);
    uguale("1. la concessione del bar entra in ristorazione come concessione (regole definitive)", [cl(BAR, ["55300000"]).settori, cl(BAR, ["55300000"]).perSettore.ristorazione?.sottocategoria], [["ristorazione"], "concessione_bar"]);
    const src = leggi("src/lib/radar/classificazione-unita.ts");
    atteso("1. il modulo usa classificaGara e nessuna regola propria (niente REGOLE_PAROLE, ESCLUSIONI_OGGETTO, espressioni sulle parole)", src.includes("classificaGara(") && !/REGOLE_PAROLE|ESCLUSIONI_OGGETTO|new RegExp|\/\\b/.test(src));
  }

  // ═════ 2-4. il confronto tra le fonti ═════
  {
    const mensa = cl(MENSA, ["55524000"]);
    uguale("2. gara di una sola fonte (la stessa fonte si rilegge): nessuna segnalazione", ambiguitaTraFonti({ fonte: "pvl", altreFonti: ["pvl"], daFonte: cl(PULIZIA, ["90910000"]), altre: mensa, unita: mensa }), null);
    uguale("2. nessuna altra fonte: nessuna segnalazione", ambiguitaTraFonti({ fonte: "ted", altreFonti: [], daFonte: cl(PULIZIA, ["90910000"]), altre: mensa, unita: mensa }), null);
    uguale("3. fonti d'accordo (stessi settori, stesso livello): nessuna segnalazione", ambiguitaTraFonti({ fonte: "pvl", altreFonti: ["ted"], daFonte: mensa, altre: mensa, unita: mensa }), null);
    const s = ambiguitaTraFonti({ fonte: "sardegnacat", altreFonti: ["ted"], daFonte: cl(PULIZIA, ["90910000"]), altre: mensa, unita: classificaPerArchivio(dati(`${MENSA} ${PULIZIA}`, ["55524000", "90910000"]), []) });
    atteso("4. settori diversi tra le fonti: segnalati con le due classificazioni", !!s && s.motivi.some((m) => m === "Settori diversi tra le fonti: SardegnaCAT dà pulizia e sanificazione, TED ristorazione collettiva"), JSON.stringify(s?.motivi));
    const l = ambiguitaTraFonti({ fonte: "pvl", altreFonti: ["ted"], daFonte: cl(RSA, ["55524000"]), altre: mensa, unita: cl(RSA, ["55524000"]) });
    atteso("4. stesso settore, livelli diversi (PVL B correlata, TED A): segnalato con le regole", !!l && l.motivi.some((m) => m === "Livello diverso per ristorazione collettiva: PVL ANAC B (servizi_alla_persona), TED A (cpv_principale)"), JSON.stringify(l?.motivi));
    const c = ambiguitaTraFonti({ fonte: "pvl", altreFonti: ["ted"], daFonte: mensa, altre: mensa, unita: cl(CASONE, ["55524000"]) });
    atteso("4. le fonti sono d'accordo ma i dati uniti danno altro: segnalato", !!c && c.motivi.some((m) => m === "I dati uniti danno nessun settore; le fonti insieme ristorazione collettiva"), JSON.stringify(c?.motivi));
    // chiave stabile e corta
    const s2 = ambiguitaTraFonti({ fonte: "sardegnacat", altreFonti: ["ted", "ted"], daFonte: cl(PULIZIA, ["90910000"]), altre: mensa, unita: classificaPerArchivio(dati(`${MENSA} ${PULIZIA}`, ["55524000", "90910000"]), []) });
    atteso("5. stessa situazione = stessa chiave (rileggere non duplica); chiave con la versione delle regole, entro 200 caratteri", !!s && !!s2 && s.chiave === s2.chiave && s.chiave.startsWith(`classificazione:${VERSIONE_REGOLE_SETTORI}:sardegnacat:`) && s.chiave.length <= 200);
    atteso("5. situazione diversa = chiave diversa", !!s && !!l && s.chiave !== l.chiave);
    const r = rigaSegnalazioneClassificazione("G1", s!);
    uguale("5. la riga è interna: correzione_dati, campo classificazione_ambigua, mai notificabile", [r.tipo, r.campo, r.notificabile], ["correzione_dati", CAMPO_CLASSIFICAZIONE_AMBIGUA, false]);
    atteso("5. la riga rispetta i limiti delle colonne (campo 60, valori 2000, nota 1000, fonte)", String(r.campo).length <= 60 && String(r.valore_precedente).length <= 2000 && String(r.valore_nuovo).length <= 2000 && String(r.nota).length <= 1000 && /^[a-z0-9_]{2,40}$/.test(String(r.fonte)));
    const letta = leggiSegnalazioneClassificazione("sardegnacat", r.valore_precedente as string, r.valore_nuovo as string);
    uguale("5. la console legge le due classificazioni e i dati uniti", [letta.altreFonti, letta.daFonte, letta.altre, letta.datiUniti.settori], [["ted"], { settori: ["pulizia"], livello: "A" }, { settori: ["ristorazione"], livello: "A" }, ["ristorazione", "pulizia"]]);
    uguale("5. un valore non leggibile non rompe la console", leggiSegnalazioneClassificazione("ted", "{rotto", null).daFonte, { settori: [], livello: null });
  }

  // ═════ coerenza: i dati uniti non dipendono dall'ordine di arrivo delle fonti ═════
  {
    const riga = (fonte: "ted" | "pvl", oggetto: string, cpv: string[]): RigaProcedura => ({ ...(garaMem("x") as unknown as RigaProcedura), chiave: `${fonte}:x`, oggetto, cpv_principale: cpv[0], cpv_tutti: cpv, settori: classificaPerArchivio(dati(oggetto, cpv), []).settori, metodo_settore: "cpv" });
    const vTed: VersioneFonte = { fonte: "ted", id: "700001-2026", giorno: "2026-11-01", istante: null, ted: "700001-2026" };
    const vPvl: VersioneFonte = { fonte: "pvl", id: "av1", giorno: "2026-11-01", istante: "2026-11-01T10:00:00Z", ted: "700001-2026" };
    const iso = ADESSO.toISOString();
    const t = riga("ted", MENSA, ["55524000"]);
    const p = riga("pvl", RSA, ["55524000", "85311000"]);
    const a1 = unisciVersione(null, null, t, vTed, iso);
    const a = unisciVersione(a1.riga, a1.provenienza, p, vPvl, iso);
    const b1 = unisciVersione(null, null, p, vPvl, iso);
    const b = unisciVersione(b1.riga, b1.provenienza, t, vTed, iso);
    const ca = classificaPerArchivio(a.riga, []);
    const cb = classificaPerArchivio(b.riga, []);
    uguale("coerenza: TED poi PVL o PVL poi TED, stessa classificazione dei dati uniti", [ca.settori, ca.livello, ca.perSettore], [cb.settori, cb.livello, cb.perSettore]);
    uguale("coerenza: i settori della colonna restano l'unione delle fonti (nessuna fonte toglie un settore)", [[...a.riga.settori].sort(), [...b.riga.settori].sort()], [["ristorazione"], ["ristorazione"]]);
  }

  // ═════ 4-5. sulla scrittura unica (fonti regionali, stessa scrittura della PVL), database in memoria ═════
  {
    const mem = databaseInMemoria({
      radar_procedure: [garaMem("T")],
      radar_lotti: [lottoMem("T")],
      radar_procedure_fonti: [{ procedura_id: "T", fonte: "ted", id_fonte: "700001-2026", impronta: "imp-700001", id_procedura_fonte: "proc-T", rif_ted: null }],
      radar_aggiornamenti: [],
      omnia_ai_radar_gare_aggiunte: [],
    });
    // stessa gara (stesso CIG), stessa classificazione: nessuna segnalazione
    await importaSardegna(mem, [bandoSardegna("700201")]);
    uguale("3. SardegnaCAT unita per CIG con la stessa classificazione di TED: nessuna segnalazione", [gara(mem, "T").fonti, segnalazioni(mem).length], [["ted", "sardegnacat"], 0]);

    const mem2 = databaseInMemoria({
      radar_procedure: [garaMem("T")],
      radar_lotti: [lottoMem("T")],
      radar_procedure_fonti: [{ procedura_id: "T", fonte: "ted", id_fonte: "700001-2026", impronta: "imp-700001", id_procedura_fonte: "proc-T", rif_ted: null }],
      radar_aggiornamenti: [],
      omnia_ai_radar_gare_aggiunte: [],
    });
    const stat = await importaSardegna(mem2, [bandoSardegna("700202", { Oggetto: RSA })]);
    const seg = segnalazioni(mem2);
    uguale("4. SardegnaCAT dà ristorazione B (gestione della RSA), TED A: UNA segnalazione, contata nel giro", [seg.length, stat.ambiguita], [1, 1]);
    atteso("4. nessuna scelta automatica: la gara resta in ristorazione", JSON.stringify(gara(mem2, "T").settori) === JSON.stringify(["ristorazione"]));
    uguale("5. la segnalazione è interna e non notifica nessuno", seg.map((a) => [a.tipo, a.fonte, a.notificabile]), [["correzione_dati", "sardegnacat", false]]);
    atteso("5. la nota spiega il motivo, con la versione delle regole", String(seg[0]?.nota ?? "").includes("Livello diverso per ristorazione collettiva: SardegnaCAT B") && String(seg[0]?.nota ?? "").includes(VERSIONE_REGOLE_SETTORI));
    // la stessa versione riletta: nessuna scrittura; una versione nuova con la stessa situazione: nessuna seconda segnalazione
    await importaSardegna(mem2, [bandoSardegna("700202", { Oggetto: RSA })]);
    await importaSardegna(mem2, [bandoSardegna("700202", { Oggetto: RSA, dataUltimaModifica: "2026-11-06T10:00:00", a_base_asta: "1.950.000,00" })]);
    uguale("5. rilettura e nuova versione con la stessa situazione: sempre una sola segnalazione", segnalazioni(mem2).length, 1);
    atteso("7. la scheda del cliente non la mostra", segnalazioni(mem2).every((a) => !aggiornamentoPerCliente({ campo: a.campo as string | null, fonte: a.fonte as string }, new Set())));
  }

  // ═════ 6. stessa regola sulla scrittura TED (TED che si unisce a una gara arrivata dalla PVL) ═════
  {
    const BANDO: Record<string, unknown> = {
      "publication-number": "700301-2026",
      "notice-identifier": "sintetico-avviso-301",
      "notice-version": 1,
      "notice-type": "cn-standard",
      "publication-date": "2026-11-02+01:00",
      "procedure-identifier": "sintetica-procedura-301",
      "buyer-name": { ita: ["Comune di Prova (dati sintetici)"] },
      "organisation-identifier-buyer": ["00000000001"],
      "buyer-city": { mul: ["VENEZIA (VE)"] },
      "buyer-country-sub": ["ITH35"],
      "title-proc": { ita: PULIZIA },
      "title-lot": { ita: ["Pulizia (prova sintetica)"] },
      "identifier-lot": ["LOT-0001"],
      "main-classification-proc": ["90910000"],
      "main-classification-lot": ["90910000"],
      "classification-cpv": ["90910000"],
      "estimated-value-proc": "2000000.00",
      "estimated-value-cur-proc": "EUR",
      "estimated-value-lot": ["2000000.00"],
      "estimated-value-cur-lot": ["EUR"],
      "deadline-receipt-tender-date-lot": ["2026-12-10+01:00"],
      "deadline-receipt-tender-time-lot": ["10:00:00+01:00"],
      "procedure-type": "open",
      "contract-nature-main-proc": "services",
      "document-url-lot": ["https://piattaforma.esempio.test/gara/301"],
    };
    const mem = databaseInMemoria({
      radar_procedure: [garaMem("P", { chiave: "pvl:av-301", fonti: ["pvl"], oggetto: MENSA, ultima_versione_id: "pvl:av-301", provenienza_campi: { _versione: { f: "pvl", id: "av-301", g: "2026-11-02", t: "2026-11-02T10:00:00Z", ted: "700301-2026" }, oggetto: { f: "pvl", id: "av-301", g: "2026-11-02", t: "2026-11-02T10:00:00Z", ted: "700301-2026" } } })],
      radar_lotti: [lottoMem("P", { cig: "PRV0000301" })],
      radar_procedure_fonti: [{ procedura_id: "P", fonte: "pvl", id_fonte: "av-301", impronta: "imp-av-301", id_procedura_fonte: "proc-301", rif_ted: "700301-2026" }],
      radar_aggiornamenti: [],
      omnia_ai_radar_gare_aggiunte: [],
    });
    const b = leggiBandoTed(BANDO);
    atteso("6. (preparazione) l'avviso TED sintetico è un bando di pulizia", !("motivo" in b) && JSON.stringify((b as { settori: string[] }).settori) === JSON.stringify(["pulizia"]), JSON.stringify(b));
    await applicaPaginaBandi(mem.client, [b], "incrementale", ADESSO, misure());
    const seg = segnalazioni(mem);
    uguale("6. TED si unisce alla gara PVL con un settore diverso: una segnalazione dalla scrittura TED", [seg.length, seg[0]?.fonte, seg[0]?.notificabile], [1, "ted", false]);
    uguale("6. i settori restano l'unione delle fonti (nessuna scelta automatica)", [...(gara(mem, "P").settori as string[])].sort(), ["pulizia", "ristorazione"]);
    await applicaPaginaBandi(mem.client, [b], "incrementale", ADESSO, misure());
    uguale("6. rileggere lo stesso avviso TED non duplica la segnalazione", segnalazioni(mem).length, 1);
    for (const f of ["src/lib/radar/importa.ts", "src/lib/radar/importa-fonti-pagina.ts"]) {
      const t = leggi(f);
      atteso(`6. ${f}: usa il classificatore unico e la stessa segnalazione`, t.includes("ambiguitaTraFonti(") && t.includes("classificaPerArchivio(") && t.includes("rigaSegnalazioneClassificazione("));
    }
    atteso("6. la PVL passa dalla scrittura unica (adattatore), quindi ha la stessa regola", leggi("src/lib/radar/importa-pvl-pagina.ts").includes("applicaPaginaBandiFonte("));
  }

  // ═════ 7. righe interne e fonti nascoste mai ai clienti ═════
  {
    const nascoste = new Set(["sardegnacat"]);
    uguale(
      "7. scheda: interne escluse (suggerimenti di unione, decisioni, classificazioni da verificare), fonte nascosta esclusa, il resto mostrato",
      [
        ...CAMPI_INTERNI_REGISTRO.map((campo) => aggiornamentoPerCliente({ campo, fonte: "ted" }, nascoste)),
        aggiornamentoPerCliente({ campo: "scadenza_offerte", fonte: "sardegnacat" }, nascoste),
        aggiornamentoPerCliente({ campo: "scadenza_offerte", fonte: "ted" }, nascoste),
        aggiornamentoPerCliente({ campo: null, fonte: "pvl" }, nascoste),
        aggiornamentoPerCliente({ campo: "collegata_a", fonte: "manuale" }, nascoste),
      ],
      [false, false, false, false, true, true, true],
    );
    atteso("7. i campi interni sono quelli scritti dal motore (collegamenti.ts) e dal classificatore", leggi("src/lib/radar/collegamenti.ts").includes('campo: "collegamento_proposto"') && leggi("src/lib/radar/collegamenti.ts").includes('campo: "collegamento_proposta_decisa"') && CAMPO_CLASSIFICAZIONE_AMBIGUA === "classificazione_ambigua");
    atteso("7. la scheda della gara filtra il registro con aggiornamentoPerCliente", leggi("src/lib/radar/gara.ts").includes("filter((a) => aggiornamentoPerCliente(a, nascoste))"));
    atteso("7. Monitorate: solo rettifiche, proroghe, annullamenti ed esiti, e solo dalle fonti visibili", /\.in\("tipo", \["rettifica", "proroga", "annullamento", "esito"\]\)\s*\n\s*\/\/[^\n]*\n\s*\.in\("fonte", fontiVisibiliDa\(await fontiNascosteAiClienti\(\)\)\)/.test(leggi("src/app/site-omnia-ai/dashboard/omnia-ai/opportunita/monitorate/page.tsx")));
    atteso("7. la console mostra le classificazioni da verificare in sola lettura (nessuna azione che scelga)", (() => {
      const v = leggi("src/app/site-console/_componenti/tender-intelligence-vista.tsx");
      const i = v.indexOf("Classificazioni da verificare");
      const fine = v.indexOf("</Pannello>", i);
      return i > 0 && fine > i && !v.slice(i, fine).includes("ModuloAzione");
    })());
  }

  console.log("");
  if (fallimenti.length) {
    console.log(`Verifica del classificatore unico: ${fallimenti.length} controlli falliti:`);
    for (const f of fallimenti) console.log(` - ${f}`);
    process.exit(1);
  }
  console.log("Verifica del classificatore unico sui dati uniti: tutto a posto.");
}

principale().catch((e) => {
  console.error(e);
  process.exit(1);
});
