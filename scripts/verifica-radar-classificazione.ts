// Verifica del CLASSIFICATORE UNICO sui dati uniti (fase B2, 17/11/2026): una gara pubblicata da più fonti ha una classificazione coerente
// e le ambiguità si segnalano (decisione dell'utente del 17/11). Database IN MEMORIA, nessuna rete; tutti i dati sono SINTETICI.
//   1. un solo calcolo: lo stesso della riclassificazione e degli importatori (classificaGara di settori.ts);
//   2. una gara di una sola fonte non viene mai segnalata e si comporta come prima;
//   3. fonti d'accordo: nessuna segnalazione;
//   4. settori diversi, livelli diversi (A/B/C) e dati uniti diversi: segnalati, mai risolti da soli (i settori restano l'unione);
//   5. la segnalazione è interna: correzione_dati, mai notificabile, mai nella scheda del cliente; rileggere non la duplica;
//   6. stessa regola su TUTTE le scritture (TED, PVL e fonti regionali);
//   7. righe interne del registro mai mostrate ai clienti (anche i suggerimenti di unione), né quelle di una fonte nascosta;
//   9. fase B3 (decisione D2 dell'utente del 18/11, buoni pasto): la natura «fornitura» non esclude un vero servizio sostitutivo di mensa
//      (B), con una gestione autonoma della mensa è A, la sola stampa di tessere, badge o materiali resta C; le altre forniture restano
//      fuori come prima. Una sola regola (fonti/natura-contratto.ts) per l'archivio e per i connettori di TED, PVL, Sintel e SardegnaCAT,
//      con l'interruttore delle classificazioni spento e acceso.
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
import { erroriRiga, righeDaClassificazione } from "../src/lib/radar/classificazioni-calcoli";
import { esclusoPerNatura, settoriDopoNatura, SOTTOCATEGORIA_SOSTITUTIVI_MENSA } from "../src/lib/radar/fonti/natura-contratto";
import { SOTTOCATEGORIE } from "../src/lib/radar/settori";
import { leggiAvvisoPvl, type BandoPvl } from "../src/lib/radar/fonti/pvl-calcoli";
import { leggiProceduraSintel, type BandoSintel, type RigaSintel } from "../src/lib/radar/fonti/sintel-calcoli";
import { bandoDaSintel } from "../src/lib/radar/importa-regionali-calcoli";
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

  // ═════ 8. lotti: un lotto dedicato rende AUTONOMO il servizio (A invece di B); i settori non cambiano mai (regole 2026-11-17d) ═════
  {
    const g = { oggetto: "Organizzazione e gestione degli eventi culturali dell'estate comunale (prova sintetica)", cpv_principale: "79952000", cpv_tutti: ["79952000", "55520000"], natura_contratto: "servizi" };
    const lotti = [
      { oggetto: "Lotto 1: allestimento e organizzazione degli eventi (prova sintetica)", cpv_principale: "79952000", cpv_tutti: ["79952000"] },
      { oggetto: "Lotto 2: servizio di catering per gli eventi (prova sintetica)", cpv_principale: "55520000", cpv_tutti: ["55520000"] },
    ];
    const senza = classificaPerArchivio(g, []);
    const con = classificaPerArchivio(g, lotti);
    const uno = classificaPerArchivio(g, lotti.slice(1));
    uguale(
      "8. appalto di eventi con un lotto di catering: senza lotti B (organizzazione_eventi), con i due lotti A (lotto_autonomo), con un solo lotto B",
      [senza.perSettore.ristorazione?.livello, con.perSettore.ristorazione?.livello, con.perSettore.ristorazione?.regole[0], uno.perSettore.ristorazione?.livello],
      ["B", "A", "lotto_autonomo", "B"],
    );
    uguale("8. i lotti cambiano il livello, mai i settori", [senza.settori, con.settori, uno.settori], [["ristorazione"], ["ristorazione"], ["ristorazione"]]);
    const righe = righeDaClassificazione(con, { proceduraId: "G", origine: "importazione", fonti: ["ted"], autore: "importazione:ted", adessoIso: ADESSO.toISOString(), nuovoId: () => "x" });
    atteso("8. la riga con il lotto autonomo ha un motivo per ogni regola ed è valida per la 0121 (D1)", righe.length === 1 && righe[0].regole.length === 2 && righe[0].motivi.length === 2 && erroriRiga(righe[0]).length === 0);
    // TED: un avviso con due lotti passa i lotti al classificatore, e i settori (che entrano nell'impronta) restano quelli di sempre
    const avvisoEventi: Record<string, unknown> = {
      "publication-number": "700501-2026",
      "notice-identifier": "sintetico-700501",
      "notice-version": 1,
      "notice-type": "cn-standard",
      "publication-date": "2026-11-10+01:00",
      "procedure-identifier": "proc-eventi",
      "buyer-name": { ita: ["COMUNE DI PROVASINTETICA"] },
      "organisation-identifier-buyer": ["00000000001"],
      "buyer-country-sub": ["ITG2B"],
      "title-proc": { ita: g.oggetto },
      "title-lot": { ita: [lotti[0].oggetto, lotti[1].oggetto] },
      "identifier-lot": ["LOT-0001", "LOT-0002"],
      "main-classification-proc": ["79952000"],
      "main-classification-lot": ["79952000", "55520000"],
      "classification-cpv": ["79952000", "55520000"],
      "deadline-receipt-tender-date-lot": ["2026-12-20+01:00", "2026-12-20+01:00"],
      "procedure-type": "open",
      "contract-nature-main-proc": "services",
    };
    const b = leggiBandoTed(avvisoEventi);
    atteso("8. TED: l'avviso con due lotti entra in ristorazione, come prima (settori invariati)", !("motivo" in b) && JSON.stringify((b as { settori: string[] }).settori) === JSON.stringify(["ristorazione"]), JSON.stringify(b));
    for (const f of ["src/lib/radar/fonti/ted-calcoli.ts", "src/lib/radar/fonti/pvl-calcoli.ts", "src/lib/radar/fonti/sintel-calcoli.ts", "src/lib/radar/classificazione-unita.ts"]) {
      atteso(`8. ${f}: passa i lotti (oggetto e CPV di ciascuno) al classificatore`, /classificaGara\(\{[^;]*lotti: /.test(leggi(f).replace(/\/\/[^\n]*/g, "").replace(/\n\s*/g, " ")));
    }
    // fase B2b: la riclassificazione (ora di B2) USA il calcolo unico invece di ripeterlo
    atteso("8. il calcolo unico passa i lotti e la riclassificazione lo usa (nessun calcolo ripetuto)", leggi("src/lib/radar/classificazione-unita.ts").includes("lotti: lotti.map((l) => ({ testo: l.oggetto, cpv: [l.cpv_principale, ...(l.cpv_tutti ?? [])] }))") && leggi("src/lib/radar/riclassifica-settori.ts").includes("const c = classificaPerArchivio(g, lotti);") && !/\bclassificaGara\(/.test(leggi("src/lib/radar/riclassifica-settori.ts")));
  }

  // ═════ 9. D2, buoni pasto e natura del contratto (fase B3, 18/11): archivio e connettori di tutte le fonti, interruttore spento e acceso ═════
  {
    const BUONI = "Fornitura di buoni pasto per i dipendenti comunali (prova sintetica)";
    const SOSTITUTIVO = "Servizio sostitutivo di mensa mediante buoni pasto elettronici per il personale (prova sintetica)";
    const CON_MENSA = "Servizio di mensa interno e servizio sostitutivo di mensa mediante buoni pasto (prova sintetica)";
    const STAMPA = "Stampa di buoni pasto cartacei per i dipendenti (prova sintetica)";
    const BADGE = "Fornitura di badge e tessere per il servizio sostitutivo di mensa (prova sintetica)";
    const CANCELLERIA = "Fornitura di cancelleria per gli uffici comunali (prova sintetica)";
    const CANC_PULIZIA = "Fornitura di cancelleria e servizio di pulizia degli uffici comunali (prova sintetica)";
    const RISTORAZIONE = "Servizio di ristorazione (prova sintetica)";
    const MISTA = "Fornitura di buoni pasto e servizio di pulizia degli uffici (prova sintetica)";
    const CPV_BUONI = "30199770";
    const CPV_CANC = "30192000";
    type Breve = { settori: string[]; livello: string | null; per: Record<string, string> };
    const breve = (c: ClassificazioneArchivio): Breve => ({
      settori: [...c.settori],
      livello: c.livello,
      per: Object.fromEntries(
        Object.entries(c.perSettore)
          .map(([s, v]) => [s, `${v?.livello}:${v?.regole.join("+")}`])
          .sort(),
      ),
    });
    const B: Breve = { settori: ["ristorazione"], livello: "B", per: { ristorazione: "B:servizio_sostitutivo_mensa" } };
    const PER_NATURA = (s: string): Breve => ({ settori: [], livello: "C", per: { [s]: "C:natura_non_servizio" } });
    const SENZA_SERVIZIO: Breve = { settori: [], livello: "C", per: { ristorazione: "C:buoni_pasto_senza_servizio" } };

    // la regola pura
    atteso("9. la sottocategoria dei servizi sostitutivi di mensa esiste nelle regole della PVL con questo id", SOTTOCATEGORIE.ristorazione.some((s) => s.id === SOTTOCATEGORIA_SOSTITUTIVI_MENSA));
    const sost = { settore: "ristorazione" as const, livello: "B" as const, sottocategorie: [SOTTOCATEGORIA_SOSTITUTIVI_MENSA] };
    uguale(
      "9. regola pura: la fornitura non esclude il servizio sostitutivo (B e A); lo escludono i lavori, il livello C, un'altra sottocategoria, un altro settore; CPV del file, servizi, misto e natura non indicata non escludono mai",
      [
        esclusoPerNatura("parole_chiave", "forniture", sost),
        esclusoPerNatura("parole_chiave", "forniture", { ...sost, livello: "A" }),
        esclusoPerNatura("parole_chiave", "lavori", sost),
        esclusoPerNatura("parole_chiave", "forniture", { ...sost, livello: "C" }),
        esclusoPerNatura("parole_chiave", "forniture", { ...sost, sottocategorie: ["mense"] }),
        esclusoPerNatura("parole_chiave", "forniture", { ...sost, settore: "pulizia" }),
        esclusoPerNatura("cpv", "forniture", { ...sost, sottocategorie: [] }),
        esclusoPerNatura("parole_chiave", "servizi", { ...sost, sottocategorie: [] }),
        esclusoPerNatura("parole_chiave", "misto", { ...sost, sottocategorie: [] }),
        esclusoPerNatura("parole_chiave", null, { ...sost, sottocategorie: [] }),
      ],
      [false, false, true, true, true, true, false, false, false, false],
    );
    uguale(
      "9. regola pura: senza esclusioni i settori restano gli STESSI, nello stesso ordine",
      settoriDopoNatura({ settori: ["pulizia", "ristorazione"], metodo: "cpv", valutazioni: [] }, "forniture"),
      ["pulizia", "ristorazione"],
    );

    // l'archivio: riclassificazione e importatori con l'interruttore acceso (classificaPerArchivio)
    const f = (o: string, cpv: string[] = [], natura: string | null = "forniture") => breve(cl(o, cpv, natura));
    uguale("9. archivio: «fornitura di buoni pasto», con il CPV 30199770-8 o senza CPV → ristorazione B (servizio sostitutivo)", [f(BUONI, [CPV_BUONI]), f(BUONI)], [B, B]);
    uguale("9. archivio: servizio sostitutivo di mensa con natura «fornitura» → B", f(SOSTITUTIVO, [CPV_BUONI]), B);
    uguale("9. archivio: con una gestione autonoma della mensa, natura «fornitura» → A", f(CON_MENSA), { settori: ["ristorazione"], livello: "A", per: { ristorazione: "A:parole_chiave" } });
    uguale("9. archivio: sola stampa, o badge e tessere per il servizio → C (buoni_pasto_senza_servizio)", [f(STAMPA), f(BADGE)], [SENZA_SERVIZIO, SENZA_SERVIZIO]);
    uguale(
      "9. archivio: le altre forniture come prima (cancelleria nessun settore; cancelleria con pulizia e ristorazione «fornitura»: C per natura)",
      [f(CANCELLERIA, [CPV_CANC]), f(CANC_PULIZIA), f(RISTORAZIONE)],
      [{ settori: [], livello: null, per: {} }, PER_NATURA("pulizia"), PER_NATURA("ristorazione")],
    );
    uguale("9. archivio: nella stessa gara resta solo il servizio sostitutivo (B); la pulizia «fornitura» è C per natura", f(MISTA), { settori: ["ristorazione"], livello: "B", per: { pulizia: "C:natura_non_servizio", ristorazione: "B:servizio_sostitutivo_mensa" } });
    uguale(
      "9. archivio: con la mensa interna la gara mista resta A (livello migliore tra i settori che restano); la pulizia «fornitura» è C",
      f("Servizio di mensa interno, servizio sostitutivo di mensa mediante buoni pasto e servizio di pulizia degli uffici (prova sintetica)"),
      { settori: ["ristorazione"], livello: "A", per: { pulizia: "C:natura_non_servizio", ristorazione: "A:parole_chiave" } },
    );
    uguale("9. archivio: i lavori restano esclusi anche con i buoni pasto", f(BUONI, [CPV_BUONI], "lavori"), PER_NATURA("ristorazione"));
    uguale("9. archivio: con natura «servizi» o non indicata, come prima (B)", [f(BUONI, [CPV_BUONI], "servizi"), f(BUONI, [CPV_BUONI], null)], [B, B]);
    const ricl = riclassificaGara({ id: "x", ...dati(BUONI, [CPV_BUONI], "forniture"), settori: [], metodo_settore: null }, []);
    uguale("9. la riclassificazione usa lo stesso calcolo: aggiunge la ristorazione B", [ricl.dopo, ricl.classificazione.perSettore.ristorazione?.livello], [{ settori: ["ristorazione"], metodo: "parole_chiave" }, "B"]);

    // i connettori: la LETTURA dell'avviso, uguale con l'interruttore spento e acceso
    const esitoLettura = (x: unknown) => {
      const o = x as { motivo?: string; settori?: string[]; metodoSettore?: string };
      return o.motivo ?? `${(o.settori ?? []).join("+")}/${o.metodoSettore}`;
    };
    // TED
    const avvisoTed = (n: number, titolo: string, cpv: string[], natura: string): Record<string, unknown> => ({
      "publication-number": `7009${String(n).padStart(2, "0")}-2026`,
      "notice-identifier": `sintetico-avviso-9${n}`,
      "notice-version": 1,
      "notice-type": "cn-standard",
      "publication-date": "2026-11-02+01:00",
      "procedure-identifier": `sintetica-procedura-9${n}`,
      "buyer-name": { ita: ["Comune di Prova (dati sintetici)"] },
      "organisation-identifier-buyer": ["00000000001"],
      "buyer-city": { mul: ["VENEZIA (VE)"] },
      "buyer-country-sub": ["ITH35"],
      "title-proc": { ita: titolo },
      "title-lot": { ita: ["Lotto unico (prova sintetica)"] },
      "identifier-lot": ["LOT-0001"],
      "main-classification-proc": cpv.slice(0, 1),
      "main-classification-lot": cpv.slice(0, 1),
      "classification-cpv": cpv,
      "estimated-value-proc": "200000.00",
      "estimated-value-cur-proc": "EUR",
      "estimated-value-lot": ["200000.00"],
      "estimated-value-cur-lot": ["EUR"],
      "deadline-receipt-tender-date-lot": ["2026-12-10+01:00"],
      "deadline-receipt-tender-time-lot": ["10:00:00+01:00"],
      "procedure-type": "open",
      "contract-nature-main-proc": natura,
      "document-url-lot": [`https://piattaforma.esempio.test/gara/9${n}`],
    });
    uguale(
      "9. TED (supplies): buoni pasto, sostitutivo e mensa interna entrano in ristorazione; stampa, cancelleria con pulizia, ristorazione «fornitura» e buoni pasto «lavori» restano fuori; nella gara mista solo la ristorazione",
      [
        leggiBandoTed(avvisoTed(1, BUONI, [CPV_BUONI], "supplies")),
        leggiBandoTed(avvisoTed(2, SOSTITUTIVO, [], "supplies")),
        leggiBandoTed(avvisoTed(3, CON_MENSA, [], "supplies")),
        leggiBandoTed(avvisoTed(4, STAMPA, [], "supplies")),
        leggiBandoTed(avvisoTed(5, CANC_PULIZIA, [CPV_CANC], "supplies")),
        leggiBandoTed(avvisoTed(6, RISTORAZIONE, [], "supplies")),
        leggiBandoTed(avvisoTed(7, BUONI, [CPV_BUONI], "works")),
        leggiBandoTed(avvisoTed(8, MISTA, [], "supplies")),
        leggiBandoTed(avvisoTed(9, BUONI, [CPV_BUONI], "services")),
      ].map(esitoLettura),
      ["ristorazione/parole_chiave", "ristorazione/parole_chiave", "ristorazione/parole_chiave", "fuori_settore", "fuori_settore", "fuori_settore", "fuori_settore", "ristorazione/parole_chiave", "ristorazione/parole_chiave"],
    );
    // PVL: avviso del campione pubblico reso SINTETICO (ente, codice fiscale, oggetto, lotti e collegamenti inventati)
    type Ogg = Record<string, unknown>;
    const campione = JSON.parse(leggi("scripts/dati/radar-pvl-campione.json")) as { avvisi: Ogg[] };
    const avvisoPvl = (n: number, titolo: string, natura: string, cpv = ""): Ogg => {
      const a = JSON.parse(JSON.stringify(campione.avvisi[0])) as Ogg;
      a.idAvviso = `00000000-0000-4000-8000-0000000009${String(n).padStart(2, "0")}`;
      a.idAppalto = `00000000-0000-4000-9000-0000000009${String(n).padStart(2, "0")}`;
      const tpl = (a.templates as Ogg[])[0].template as { metadata: Ogg; sections: { name: string; fields?: Ogg; items?: Ogg[] }[] };
      tpl.metadata = { titolo, descrizione: titolo };
      for (const s of tpl.sections) {
        if (/^SEZ\. A/.test(s.name) && s.fields) s.fields.soggetti_sa = [{ codice_fiscale: "00000000001", denominazione_amministrazione: "COMUNE DI PROVASINTETICA" }];
        if (/^SEZ\. B/.test(s.name) && s.fields) s.fields.documenti_di_gara_link = `https://piattaforma.esempio.test/gara/9${n}`;
        if (/^SEZ\. C/.test(s.name) && s.items) {
          const { link_eform_ted: _ted, ...lotto } = s.items[0];
          void _ted;
          s.items = [{ ...lotto, cig: `PRV00009${String(n).padStart(2, "0")}`, natura_principale: natura, descrizione: titolo, cpv, documenti_di_gara_link: `https://piattaforma.esempio.test/gara/9${n}` }];
        }
      }
      return a;
    };
    uguale(
      "9. PVL (Forniture): buoni pasto e sostitutivo entrano in ristorazione; stampa, cancelleria con pulizia e buoni pasto «Lavori» restano fuori; nella gara mista solo la ristorazione",
      [
        leggiAvvisoPvl(avvisoPvl(1, BUONI, "Forniture")),
        leggiAvvisoPvl(avvisoPvl(2, SOSTITUTIVO, "Forniture")),
        leggiAvvisoPvl(avvisoPvl(3, CON_MENSA, "Forniture")),
        leggiAvvisoPvl(avvisoPvl(4, STAMPA, "Forniture")),
        leggiAvvisoPvl(avvisoPvl(5, CANC_PULIZIA, "Forniture")),
        leggiAvvisoPvl(avvisoPvl(7, BUONI, "Lavori")),
        leggiAvvisoPvl(avvisoPvl(8, MISTA, "Forniture")),
      ].map(esitoLettura),
      ["ristorazione/parole_chiave", "ristorazione/parole_chiave", "ristorazione/parole_chiave", "fuori_settore", "fuori_settore", "fuori_settore", "ristorazione/parole_chiave"],
    );
    // Sintel: righe SINTETICHE (stesse colonne del dataset). La natura è «forniture» solo per farmaci e dispositivi medici, «lavori» per i
    // lavori; «forniture/servizi» resta non indicata e non esclude nulla, come prima
    const rigaSintel = (n: number, nome: string, ambito: string, cpv = ""): RigaSintel => ({
      id_procedura: `9000009${String(n).padStart(2, "0")}`,
      id_lotto: "N/D",
      multilotto: "NO",
      cig: `PRV00009${String(n).padStart(2, "0")}`,
      codice_cpv: cpv,
      data_inizio_negoziazione: "2026-11-10T00:00:00.000",
      data_fine_negoziazione: "2026-12-15T00:00:00.000",
      modalita_scelta_contraente: "Procedura Aperta",
      ambito_merceologico: ambito,
      stato_procedura: "Pubblicata",
      stato_lotto: "N/D",
      accordo_quadro: "NO",
      valore_economico_procedura: "120000.5",
      cf_stazione_appaltante: "00000000001",
      stazione_appaltante: "COMUNE DI PROVASINTETICA",
      nome_procedura: nome,
      link_procedura: { url: `http://www.sintel.regione.lombardia.it/eprocdata/auctionDetail.xhtml?id=9000009${String(n).padStart(2, "0")}` },
    });
    const sintel = (n: number, nome: string, ambito: string, cpv = "") => leggiProceduraSintel(`9000009${String(n).padStart(2, "0")}`, [rigaSintel(n, nome, ambito, cpv)], OGGI);
    const FORN_SINTEL = "Procedura per farmaci e dispositivi medici (prova sintetica)";
    uguale(
      "9. Sintel (natura forniture): buoni pasto in ristorazione; stampa esclusa per oggetto; cancelleria con pulizia e buoni pasto «lavori» fuori; «forniture/servizi» (non indicata) come prima",
      [
        sintel(1, BUONI, FORN_SINTEL, "30199770-8"),
        sintel(4, STAMPA, FORN_SINTEL),
        sintel(5, CANC_PULIZIA, FORN_SINTEL, "30192000-1"),
        sintel(7, BUONI, "Procedura per lavori", "30199770-8"),
        sintel(8, MISTA, FORN_SINTEL),
        sintel(9, CANC_PULIZIA, "Procedura per forniture/servizi", "30192000-1"),
      ].map(esitoLettura),
      ["ristorazione/parole_chiave", "esclusa_per_oggetto", "fuori_settore", "fuori_settore", "ristorazione/parole_chiave", "pulizia/parole_chiave"],
    );
    // SardegnaCAT (feed AF Soluzioni, valori inventati)
    const sardegna = (n: number, oggetto: string, contratto: string, cpv = "") => leggiElementoAflink("sardegnacat", elementoSardegna(`9009${String(n).padStart(2, "0")}`, { Oggetto: oggetto, Contratto: contratto, CPV: cpv, CIG: `PRV00009${String(n).padStart(2, "0")}` }), ADESSO);
    uguale(
      "9. SardegnaCAT (Forniture): buoni pasto e sostitutivo in ristorazione; stampa esclusa per oggetto; cancelleria con pulizia e buoni pasto «Lavori» fuori; nella gara mista solo la ristorazione",
      [
        sardegna(1, BUONI, "Forniture", "30199770-8 - Buoni pasto"),
        sardegna(2, SOSTITUTIVO, "Forniture"),
        sardegna(4, STAMPA, "Forniture"),
        sardegna(5, CANC_PULIZIA, "Forniture", "30192000-1 - Articoli per ufficio"),
        sardegna(7, BUONI, "Lavori", "30199770-8 - Buoni pasto"),
        sardegna(8, MISTA, "Forniture"),
      ].map(esitoLettura),
      ["ristorazione/parole_chiave", "ristorazione/parole_chiave", "esclusa_per_oggetto", "fuori_settore", "fuori_settore", "ristorazione/parole_chiave"],
    );

    // le SCRITTURE, interruttore spento e acceso, su un database in memoria vuoto
    let nId = 0;
    const nuovoId = () => `id-b3-${++nId}`;
    const vuoto = () => ({ radar_procedure: [] as RigaMem[], radar_lotti: [] as RigaMem[], radar_procedure_fonti: [] as RigaMem[], radar_aggiornamenti: [] as RigaMem[], radar_classificazioni: [] as RigaMem[], radar_classificazioni_stato: [] as RigaMem[], omnia_ai_radar_gare_aggiunte: [] as RigaMem[] });
    const fotografia = (mem: ReturnType<typeof databaseInMemoria>) => ({
      gare: mem.tabelle.radar_procedure.map((g) => `${(g.settori as string[]).join("+")}/${g.metodo_settore}`),
      righe: (mem.tabelle.radar_classificazioni ?? []).filter((r) => r.attiva).map((r) => `${r.settore}=${r.rilevanza}:${(r.regole as string[]).join("+")}`),
      stati: (mem.tabelle.radar_classificazioni_stato ?? []).map((s) => s.stato),
    });
    const SPENTO = { gare: ["ristorazione/parole_chiave"], righe: [], stati: [] };
    const ACCESO = { gare: ["ristorazione/parole_chiave"], righe: ["ristorazione=B:servizio_sostitutivo_mensa"], stati: ["classificata"] };
    const scrivi = async (fonte: "ted" | "pvl" | "sintel" | "sardegnacat", acceso: boolean) => {
      const mem = databaseInMemoria(vuoto(), { fonti: "0121" });
      const o = acceso ? { classificazioni: true, nuovoId } : {};
      if (fonte === "ted") await applicaPaginaBandi(mem.client, [leggiBandoTed(avvisoTed(1, BUONI, [CPV_BUONI], "supplies")), leggiBandoTed(avvisoTed(4, STAMPA, [], "supplies"))], "incrementale", ADESSO, misure(), o);
      else if (fonte === "pvl") {
        const letti = [leggiAvvisoPvl(avvisoPvl(1, BUONI, "Forniture")), leggiAvvisoPvl(avvisoPvl(4, STAMPA, "Forniture"))].filter((x): x is BandoPvl => x.tipo === "bando");
        await applicaPaginaBandiPvl(mem.client, letti, "incrementale", ADESSO, misure(), statistichePvlVuote(), o);
      } else {
        const bandi =
          fonte === "sintel"
            ? [sintel(1, BUONI, FORN_SINTEL, "30199770-8"), sintel(4, STAMPA, FORN_SINTEL)].filter((x): x is BandoSintel => x.tipo === "bando").map((b) => bandoDaSintel(b, OGGI) as BandoRegionale)
            : [sardegna(1, BUONI, "Forniture", "30199770-8 - Buoni pasto"), sardegna(4, STAMPA, "Forniture")].filter((x): x is BandoAflink => x.tipo === "bando").map((b) => bandoDaAflink(b, OGGI) as BandoRegionale);
        await applicaPaginaBandiRegionali(mem.client, bandi, { fonte, modo: "incrementale", adesso: ADESSO, misure: misure(), stat: statisticheRegionaliVuote(), nascoste: new Set(), proponi: false, ...o });
      }
      return fotografia(mem);
    };
    for (const fonte of ["ted", "pvl", "sintel", "sardegnacat"] as const) {
      uguale(`9. ${fonte}, interruttore SPENTO: la «fornitura di buoni pasto» entra in ristorazione (colonna), la stampa no; nessuna riga della 0121`, await scrivi(fonte, false), SPENTO);
      uguale(`9. ${fonte}, interruttore ACCESO: colonna e riga B «servizio_sostitutivo_mensa» coerenti, stato classificata; la stampa non entra`, await scrivi(fonte, true), ACCESO);
    }

    // una regola sola: nessun connettore ha più il filtro proprio
    for (const f of ["ted", "pvl", "sintel", "aflink"]) {
      const t = leggi(`src/lib/radar/fonti/${f}-calcoli.ts`);
      atteso(`9. fonti/${f}-calcoli.ts: usa la regola unica della natura e scrive i settori che restano`, t.includes("const settoriTenuti = settoriDopoNatura(classificazione, natura);") && !/metodo === "parole_chiave" && natura/.test(t) && (t.match(/settori: settoriTenuti/g) ?? []).length === 2 && !t.includes("settori: classificazione.settori"));
    }
    const nat = leggi("src/lib/radar/fonti/natura-contratto.ts");
    atteso("9. la regola della natura non ha espressioni sulle parole: decide sul risultato delle regole della PVL", !/new RegExp|\/\\b|REGOLE_PAROLE|ESCLUSIONI_OGGETTO/.test(nat) && leggi("src/lib/radar/classificazione-unita.ts").includes("const tenuti = settoriDopoNatura(c, g.natura_contratto);"));
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
    atteso("7. la console mostra i conflitti tra fonti in sola lettura (nessuna azione che scelga)", (() => {
      const v = leggi("src/app/site-console/_componenti/tender-intelligence-vista.tsx");
      const i = v.indexOf("Conflitti tra fonti nella classificazione");
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
