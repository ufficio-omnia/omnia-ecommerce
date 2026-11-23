// Verifica della fase B2a di Tender Intelligence: motore di unione unico per TED, PVL, Sintel e SardegnaCAT. Contiene i 7 CONTROLLI DI
// ACCETTAZIONE chiesti dall'utente il 17/11/2026, ognuno con una prova automatica su un database IN MEMORIA (nessuna rete, nessun database
// vero), più i controlli sulla migrazione 0120 e sul codice. Tutti i dati sono SINTETICI (enti, CIG, identificativi inventati).
//   1. niente collegamenti circolari né catene di unioni non gestite;
//   2. tracciabilità di ogni singola gara assorbita;
//   3. unioni reversibili;
//   4. rettifiche e proroghe propagate da qualunque fonte alla gara che resta;
//   5. collegamenti conservati con progetti, documenti, gare monitorate, salvate e aggiunte a mano;
//   6. visibili ai clienti solo le fonti non nascoste (dal 23/11 nessuna di base: SardegnaCAT visibile senza parere, 48E D4-bis);
//   7. nessuna perdita né duplicazione nelle sincronizzazioni successive.
import fs from "fs";
import path from "path";
import { databaseInMemoria, type RigaMem } from "./lib/db-in-memoria";
import { leggiProceduraSintel, type BandoSintel } from "../src/lib/radar/fonti/sintel-calcoli";
import { leggiElementoAflink, type BandoAflink } from "../src/lib/radar/fonti/aflink-calcoli";
import { applicaPaginaBandiRegionali } from "../src/lib/radar/importa-regionali-pagina";
import { bandoDaAflink, bandoDaSintel, statisticheRegionaliVuote, type BandoRegionale, type StatisticheRegionali } from "../src/lib/radar/importa-regionali-calcoli";
import { collegaDoppioniPerAvvisoTed, collegaGare, confermaProposta, leggiProposteAperte, rifiutaProposta, scollegaGara } from "../src/lib/radar/collegamenti";
import { decidiUnione, restaInFondo, unoPerGaraMostrata, type GaraUnibile } from "../src/lib/radar/collegamenti-calcoli";
import { sintesiDeterministica } from "../src/lib/radar/sintesi-calcoli";
import { erroreAncoraAttuale } from "../src/lib/console/tender-intelligence-calcoli";
import { ATTRIBUZIONE_FONTE, fontiVisibili, garaVisibileAiClienti, riepilogoFonti } from "../src/lib/radar/fonti-gara-calcoli";
import { ATTRIBUZIONE_SINTEL } from "../src/lib/radar/fonti/sintel-calcoli";
import { ISTANZE_AFLINK } from "../src/lib/radar/fonti/aflink-calcoli";
import { PRECEDENZA_FONTI, unisciVersione } from "../src/lib/radar/unione-calcoli";
import { scrittureRadarConsentite } from "../src/lib/radar/ambiente";
import { eseguiImportazioneTed } from "../src/lib/radar/importa-ted";
import { eseguiImportazionePvl } from "../src/lib/radar/importa-pvl";
import { eseguiImportazioneRegionale } from "../src/lib/radar/importa-regionali";
import { opportunitaDaTipoAvviso } from "../src/lib/radar/opportunita-calcoli";
import { applicaPaginaBandi, applicaPaginaEsiti, gareCheRestano } from "../src/lib/radar/importa";
import { eEsclusione, leggiBandoTed, leggiEsitoTed, type EsitoTed } from "../src/lib/radar/fonti/ted-calcoli";

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
const ISO = ADESSO.toISOString();
const misure = () => ({ richiesteDb: 0, msDb: 0 });

// ───── dati SINTETICI ─────
function garaTed(id: string, p: Partial<RigaMem> = {}): RigaMem {
  return {
    id,
    chiave: `ted:proc-${id}`,
    oggetto: "Servizio di ristorazione scolastica (prova sintetica)",
    oggetto_breve: "Servizio di ristorazione scolastica",
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
    url_documenti: "https://sardegnacat.regione.sardegna.it/Application/CustomDoc/DettaglioProcedura.asp?ID=700001",
    piattaforma_host: "sardegnacat.regione.sardegna.it",
    cpv_principale: "55524000",
    cpv_tutti: ["55524000"],
    settori: ["ristorazione"],
    metodo_settore: "cpv",
    ultima_versione_il: "2026-11-01",
    ultima_versione_id: "700001-2026",
    ultima_rilevazione_il: "2026-11-01T08:00:00.000Z",
    aggiornata_il: "2026-11-01T08:00:00.000Z",
    valore_base: null,
    piattaforma_id: "sardegnacat:700001",
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
const lottoTed = (procedura_id: string, p: Partial<RigaMem> = {}): RigaMem => ({ procedura_id, numero_lotto: "LOT-0001", cig: null, oggetto: null, cpv_principale: "55524000", cpv_tutti: ["55524000"], valore_stimato: 2000000, durata_mesi: null, scadenza_giorno: "2026-12-10", scadenza_offerte: "2026-12-10T09:00:00.000Z", scadenza_ora_indicata: true, scadenza_fonte: null, url_documenti: null, ...p });
const provTed = (procedura_id: string, numero: string): RigaMem => ({ procedura_id, fonte: "ted", id_fonte: numero, impronta: `imp-${numero}`, id_procedura_fonte: `proc-${procedura_id}`, rif_ted: null });

function elementoSardegna(id: string, p: Record<string, string> = {}): Record<string, string> {
  return {
    link: `https://sardegnacat.regione.sardegna.it/portale/index.php/bandi?getdettaglio=yes&bando=${id}&scadenzaBando=2026-12-10T10:00:00`,
    Oggetto: "Servizio di ristorazione scolastica (prova sintetica)",
    Tipo: "Bando",
    DenominazioneEnte: "COMUNE DI PROVASINTETICA",
    Contratto: "Servizi",
    a_base_asta: "1.900.000,00",
    DtScadenzaBandoTecnical: "2026-12-10T10:00:00",
    CIG: "",
    TipoProcedura: "Aperta",
    statoFunzionale: "PresOfferte",
    IdMsg: id,
    TitoloDocumento: "Ristorazione (prova)",
    dataUltimaModifica: "2026-11-05T10:00:00",
    CPV: "55524000-9 - Servizi di ristorazione scolastica",
    DtPubblicazioneTecnical: "2026-11-03T11:00:00",
    ...p,
  };
}
const bandoSardegna = (id: string, p: Record<string, string> = {}): BandoRegionale => bandoDaAflink(leggiElementoAflink("sardegnacat", elementoSardegna(id, p), ADESSO) as BandoAflink, OGGI) as BandoRegionale;

function rigaSintel(p: Record<string, unknown>): Record<string, unknown> {
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
    valore_economico_procedura: "120000",
    cf_stazione_appaltante: "00000000002",
    stazione_appaltante: "COMUNE DI SINTETICO",
    nome_procedura: "Servizio di pulizia degli uffici (prova sintetica)",
    link_procedura: { url: "http://www.sintel.regione.lombardia.it/eprocdata/auctionDetail.xhtml?id=900000001" },
    ...p,
  };
}
const bandoSintel = (p: Record<string, unknown> = {}, oggi = OGGI): BandoRegionale => {
  const r = rigaSintel(p);
  return bandoDaSintel(leggiProceduraSintel(String(r.id_procedura), [r], oggi) as BandoSintel, oggi) as BandoRegionale;
};

async function importa(mem: ReturnType<typeof databaseInMemoria>, bandi: BandoRegionale[], o: { nascoste?: string[]; adesso?: Date; proponi?: boolean } = {}): Promise<StatisticheRegionali> {
  const stat = statisticheRegionaliVuote();
  const fonte = bandi[0].fonte;
  await applicaPaginaBandiRegionali(mem.client, bandi, { fonte, modo: "incrementale", adesso: o.adesso ?? ADESSO, misure: misure(), stat, nascoste: new Set(o.nascoste ?? []), proponi: o.proponi ?? fonte === "sintel" });
  return stat;
}
const gara = (mem: ReturnType<typeof databaseInMemoria>, id: string) => mem.tabelle.radar_procedure.find((r) => r.id === id) as RigaMem;
const visibili = (mem: ReturnType<typeof databaseInMemoria>) => mem.tabelle.radar_procedure.filter((r) => !r.unita_a);
const fotografia = (mem: ReturnType<typeof databaseInMemoria>) =>
  JSON.stringify({
    gare: mem.tabelle.radar_procedure.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !["unita_a", "unita_il", "unita_motivo", "unita_esclusa_con", "aggiornata_il"].includes(k)))),
    fonti: mem.tabelle.radar_procedure_fonti,
    lotti: mem.tabelle.radar_lotti,
    salvate: mem.tabelle.omnia_ai_radar_salvate,
    aggiunte: mem.tabelle.omnia_ai_radar_gare_aggiunte,
    cambiamenti: (mem.tabelle.radar_aggiornamenti ?? []).filter((a) => a.tipo !== "correzione_dati"),
  });

async function principale() {
  // ═════ 1. niente collegamenti circolari né catene di unioni non gestite ═════
  {
    const m = new Map<string, GaraUnibile>([
      ["A", { id: "A", chiave: "x:A", unita_a: "B", unita_esclusa_con: [], fonti: [], prima_rilevazione_il: null }],
      ["B", { id: "B", chiave: "x:B", unita_a: "A", unita_esclusa_con: [], fonti: [], prima_rilevazione_il: null }],
      ["C", { id: "C", chiave: "ted:C", unita_a: null, unita_esclusa_con: [], fonti: ["ted"], prima_rilevazione_il: null }],
    ]);
    uguale("1. un ciclo (che non dovrebbe esistere) viene riconosciuto e non si collega", [restaInFondo("A", m), decidiUnione("A", "C", m, "prova").collega], [null, false]);
  }
  {
    const mem = databaseInMemoria({
      radar_procedure: [garaTed("T"), garaTed("X", { chiave: "sintel:1", fonti: ["sintel"], piattaforma_id: "sintel:1", unita_a: "Y" }), garaTed("Y", { chiave: "sardegnacat:9", fonti: ["sardegnacat"], piattaforma_id: "sardegnacat:9" })],
      radar_aggiornamenti: [],
    });
    // Y (che ha X collegata) viene unita a T: X passa a T, nessuna catena X→Y→T
    const e = await collegaGare(mem.client, [{ a: "Y", b: "T", motivo: "prova sintetica", traccia: "prova", fonte: "sardegnacat" }], ISO, misure());
    uguale("1. una gara che resta e viene poi unita a un'altra: le sue gare collegate passano alla nuova (nessuna catena)", [e.collegate, e.spostate, gara(mem, "Y").unita_a, gara(mem, "X").unita_a], [1, 1, "T", "T"]);
    atteso("1. ogni gara collegata punta a una gara che non è collegata a sua volta", mem.tabelle.radar_procedure.every((r) => !r.unita_a || !gara(mem, r.unita_a as string).unita_a));
    // collegare di nuovo una gara assorbita a un'altra: si usa la gara che resta in fondo
    const e2 = await collegaGare(mem.client, [{ a: "X", b: "T", motivo: "prova", traccia: "prova2", fonte: "manuale" }], ISO, misure());
    uguale("1. una coppia già unita (anche passando da una gara assorbita) non si collega due volte", [e2.collegate, e2.saltate], [0, { stessa_gara: 1 }]);
  }

  // ═════ 2. tracciabilità di ogni singola gara assorbita ═════
  {
    const mem = databaseInMemoria({
      radar_procedure: [garaTed("T"), garaTed("P1", { chiave: "pvl:a1", fonti: ["pvl"] }), garaTed("P2", { chiave: "pvl:a2", fonti: ["pvl"] })],
      radar_procedure_fonti: [provTed("T", "800002-2026"), { procedura_id: "P1", fonte: "pvl", id_fonte: "av1", rif_ted: "800002-2026" }, { procedura_id: "P2", fonte: "pvl", id_fonte: "av2", rif_ted: "800002-2026" }],
      radar_aggiornamenti: [],
    });
    const e = await collegaDoppioniPerAvvisoTed(mem.client, ["800002-2026"], ISO, misure());
    const daT = mem.tabelle.radar_aggiornamenti.filter((a) => a.procedura_id === "T" && a.campo === "collegata_da").map((a) => a.valore_nuovo).sort();
    uguale("2. due gare PVL che citano lo stesso avviso TED: entrambe unite e tracciate una per una sulla gara che resta", [e.collegate, daT], [2, ["P1", "P2"]]);
    atteso("2. ogni gara assorbita ha la sua traccia (collegata_a), mai notificabile", ["P1", "P2"].every((id) => mem.tabelle.radar_aggiornamenti.some((a) => a.procedura_id === id && a.campo === "collegata_a" && a.valore_nuovo === "T" && a.notificabile === false)));
  }

  // ═════ 3. unioni reversibili (senza perdita di dati) ═════
  {
    const mem = databaseInMemoria({
      radar_procedure: [garaTed("T"), garaTed("S", { chiave: "sardegnacat:700001", fonti: ["sardegnacat"], prima_rilevazione_il: "2026-11-02T00:00:00.000Z" })],
      radar_lotti: [lottoTed("T"), lottoTed("S", { cig: "PRV0000009" })],
      radar_procedure_fonti: [provTed("T", "700001-2026"), { procedura_id: "S", fonte: "sardegnacat", id_fonte: "700001", impronta: "i", id_procedura_fonte: "700001", rif_ted: null }],
      omnia_ai_radar_salvate: [{ id: "s1", user_id: "impresa-sintetica", procedura_id: "S", monitorata: true }],
      radar_aggiornamenti: [],
    });
    const prima = fotografia(mem);
    const e = await collegaGare(mem.client, [{ a: "S", b: "T", motivo: "stesso identificativo della piattaforma", traccia: "piattaforma:sardegnacat:700001", fonte: "sardegnacat" }], ISO, misure());
    uguale("3. unione: resta la gara TED, quella di SardegnaCAT è assorbita", [e.collegate, gara(mem, "S").unita_a, gara(mem, "T").unita_a], [1, "T", null]);
    uguale("3. unione senza perdita di dati (gare, fonti, lotti, gare salvate, cambiamenti)", fotografia(mem), prima);
    const a = await scollegaGara(mem.client, "S", "2026-11-17T13:00:00.000Z");
    uguale("3. annullamento: la gara torna visibile e il collegamento non si rifà da solo", [a.ok, gara(mem, "S").unita_a, gara(mem, "S").unita_esclusa_con], [true, null, ["T"]]);
    uguale("3. annullamento senza perdita di dati", fotografia(mem), prima);
    const e2 = await collegaGare(mem.client, [{ a: "S", b: "T", motivo: "di nuovo", traccia: "piattaforma:sardegnacat:700001", fonte: "sardegnacat" }], ISO, misure());
    uguale("3. dopo l'annullamento la stessa unione automatica viene rifiutata", [e2.collegate, e2.saltate], [0, { annullato_a_mano: 1 }]);
  }

  // ═════ 4. rettifiche e proroghe propagate da qualunque fonte alla gara che resta ═════
  {
    const mem = databaseInMemoria({ radar_procedure: [garaTed("T")], radar_lotti: [lottoTed("T")], radar_procedure_fonti: [provTed("T", "700001-2026")], radar_aggiornamenti: [], omnia_ai_radar_gare_aggiunte: [] });
    const s1 = await importa(mem, [bandoSardegna("700001")]);
    const sId = mem.tabelle.radar_procedure.find((r) => r.chiave === "sardegnacat:700001")?.id as string;
    // l'identificativo della piattaforma è un numero TECNICO, non ufficiale: nessuna unione automatica, solo un suggerimento (17/11)
    uguale("4. stesso identificativo della piattaforma: gara propria e SOLO un suggerimento, nessuna unione automatica", [s1.nuove, s1.proposte, gara(mem, sId).unita_a, gara(mem, "T").scadenza_offerte], [1, 1, null, "2026-12-10T09:00:00.000Z"]);
    const proposta = (await leggiProposteAperte(mem.client))[0];
    await confermaProposta(mem.client, proposta.a, proposta.b, "admin sintetico", ISO, misure());
    uguale("4. dopo la conferma dell'amministratore: unione 0117, resta la gara TED", gara(mem, sId).unita_a, "T");
    const s2 = await importa(mem, [bandoSardegna("700001", { DtScadenzaBandoTecnical: "2026-12-17T10:00:00", dataUltimaModifica: "2026-11-16T09:00:00" })]);
    const proroghe = mem.tabelle.radar_aggiornamenti.filter((a) => a.tipo === "proroga");
    uguale("4. proroga pubblicata solo su SardegnaCAT dopo l'unione: arriva alla gara che resta, una sola volta, notificabile", [s2.rettifiche, gara(mem, "T").scadenza_giorno, gara(mem, "T").scadenza_offerte, proroghe.length, proroghe[0]?.procedura_id, proroghe[0]?.notificabile], [1, "2026-12-17", "2026-12-17T09:00:00.000Z", 1, "T", true]);
  }
  {
    // la stessa procedura SardegnaCAT era una gara a sé, poi unita a TED: la proroga successiva va alla gara che resta, la copia non cambia
    const mem = databaseInMemoria({
      radar_procedure: [garaTed("T"), garaTed("S", { chiave: "sardegnacat:700001", fonti: ["sardegnacat"], unita_a: "T" })],
      radar_lotti: [lottoTed("T")],
      radar_procedure_fonti: [provTed("T", "700001-2026"), { procedura_id: "S", fonte: "sardegnacat", id_fonte: "700001", impronta: "vecchia", id_procedura_fonte: "700001", rif_ted: null }],
      radar_aggiornamenti: [],
    });
    const copia = JSON.stringify(gara(mem, "S"));
    const s = await importa(mem, [bandoSardegna("700001", { DtScadenzaBandoTecnical: "2026-12-18T12:00:00", dataUltimaModifica: "2026-11-16T09:00:00" })]);
    uguale("4. su una gara già collegata la proroga va alla gara che resta (la copia nascosta resta com'era)", [s.suGaraCollegata, gara(mem, "T").scadenza_giorno, JSON.stringify(gara(mem, "S")) === copia], [1, "2026-12-18", true]);
    atteso("4. il cambiamento è registrato sulla gara che resta", mem.tabelle.radar_aggiornamenti.some((a) => a.procedura_id === "T" && a.tipo === "proroga"));
  }
  {
    // Sintel: proroga di un giorno, senza ora (l'ora non si presume)
    const mem = databaseInMemoria({ radar_procedure: [], radar_aggiornamenti: [] });
    await importa(mem, [bandoSintel()]);
    const id = mem.tabelle.radar_procedure[0].id as string;
    await importa(mem, [bandoSintel({ data_fine_negoziazione: "2026-12-22T00:00:00.000" }, "2026-11-18")], { adesso: new Date("2026-11-18T08:00:00Z") });
    uguale("4. proroga di Sintel (giorno nuovo, senza ora): registrata, nessuna ora presunta", [gara(mem, id).scadenza_giorno, gara(mem, id).scadenza_offerte, mem.tabelle.radar_aggiornamenti.filter((a) => a.tipo === "proroga").length], ["2026-12-22", null, 1]);
  }
  {
    // un'altra fonte con lo STESSO giorno ma senza ora non toglie l'ora già indicata (unione pura)
    const precedente = { ...(garaTed("T") as unknown as Parameters<typeof unisciVersione>[0] & object) };
    const nuova = { ...precedente, scadenza_offerte: null, scadenza_ora_indicata: false, scadenza_fonte: "solo giorno" };
    const u = unisciVersione(precedente, { _versione: { f: "ted", id: "700001-2026", g: "2026-11-01", t: null, ted: "700001-2026" }, scadenza: { f: "ted", id: "700001-2026", g: "2026-11-01", t: null, ted: "700001-2026" } }, nuova, { fonte: "sintel", id: "1@2026-11-17", giorno: "2026-11-17", istante: null, ted: null }, ISO);
    uguale("4. stesso giorno senza ora da un'altra fonte: l'ora indicata resta", [u.riga.scadenza_offerte, u.cambiamenti.length], ["2026-12-10T09:00:00.000Z", 0]);
  }
  {
    // TED (scrittura di B1, importa.ts): una gara TED assorbita da un'altra gara TED (stessa gara pubblicata due volte, unita per CIG).
    // La nuova versione e l'esito della sua procedura vanno alla gara che resta, come nella scrittura unica (rilievo C1); la copia non cambia.
    const avviso = (numero: string, p: Record<string, unknown> = {}): Record<string, unknown> => ({
      "publication-number": numero,
      "notice-identifier": `sintetico-${numero}`,
      "notice-version": 1,
      "notice-type": "cn-standard",
      "publication-date": "2026-11-10+01:00",
      "procedure-identifier": "proc-X",
      "buyer-name": { ita: ["COMUNE DI PROVASINTETICA"] },
      "organisation-identifier-buyer": ["00000000001"],
      "buyer-country-sub": ["ITG2B"],
      "title-proc": { ita: "Servizio di ristorazione scolastica (prova sintetica)" },
      "title-lot": { ita: ["Ristorazione (prova sintetica)"] },
      "identifier-lot": ["LOT-0001"],
      "main-classification-proc": ["55524000"],
      "main-classification-lot": ["55524000"],
      "classification-cpv": ["55524000"],
      "estimated-value-proc": "2000000.00",
      "estimated-value-cur-proc": "EUR",
      "estimated-value-lot": ["2000000.00"],
      "estimated-value-cur-lot": ["EUR"],
      "deadline-receipt-tender-date-lot": ["2026-12-20+01:00"],
      "deadline-receipt-tender-time-lot": ["10:00:00+01:00"],
      "procedure-type": "open",
      "contract-nature-main-proc": "services",
      ...p,
    });
    const iniziali = () =>
      databaseInMemoria({
        radar_procedure: [garaTed("A", { chiave: "ted:proc-A" }), garaTed("X", { chiave: "ted:proc-X", unita_a: "A", unita_il: ISO, unita_motivo: "stesso CIG (prova sintetica)" })],
        radar_lotti: [lottoTed("A", { cig: "PRV00000A1" }), lottoTed("X")],
        radar_procedure_fonti: [{ ...provTed("A", "700001-2026"), id_procedura_fonte: "proc-A" }, { ...provTed("X", "700400-2026"), id_procedura_fonte: "proc-X" }],
        radar_aggiornamenti: [],
        omnia_ai_radar_gare_aggiunte: [],
      });
    const mem = iniziali();
    const copia = JSON.stringify(gara(mem, "X"));
    const bando = leggiBandoTed(avviso("700402-2026"));
    atteso("4. (preparazione) l'avviso TED sintetico è un bando della procedura della gara assorbita", !eEsclusione(bando) && bando.record.chiaveProcedura === "ted:proc-X");
    const e = await applicaPaginaBandi(mem.client, [bando], "incrementale", ADESSO, misure());
    const proroghe = mem.tabelle.radar_aggiornamenti.filter((a) => a.tipo === "proroga");
    uguale(
      "4. TED: la nuova versione di una gara assorbita va alla gara che resta (proroga registrata lì, una volta, notificabile), nessuna gara nuova",
      [e.nuove, e.aggiornate, gara(mem, "A").scadenza_giorno, proroghe.map((p) => [p.procedura_id, p.notificabile]), mem.tabelle.radar_procedure.length],
      [0, 1, "2026-12-20", [["A", true]], 2],
    );
    uguale("4. TED: la copia assorbita resta com'era", JSON.stringify(gara(mem, "X")) === copia, true);
    uguale("4. TED: l'avviso nuovo è registrato sulla gara che resta", mem.tabelle.radar_procedure_fonti.find((p) => p.id_fonte === "700402-2026")?.procedura_id, "A");
    uguale("4. TED: i lotti della gara che resta si uniscono, non si sovrascrivono (il suo CIG resta)", mem.tabelle.radar_lotti.filter((l) => l.procedura_id === "A").map((l) => l.cig), ["PRV00000A1"]);
    const esito = leggiEsitoTed(avviso("700403-2026", { "notice-type": "can-standard", "winner-selection-status": ["selec-w"] })) as EsitoTed;
    await applicaPaginaEsiti(mem.client, [esito], "incrementale", ADESSO, misure());
    const esiti = mem.tabelle.radar_aggiornamenti.filter((a) => a.tipo === "esito");
    uguale("4. TED: l'esito di una gara assorbita va alla gara che resta (stato e registro lì, notificabile); la copia non cambia", [gara(mem, "A").stato, esiti.map((a) => [a.procedura_id, a.notificabile]), JSON.stringify(gara(mem, "X")) === copia], ["aggiudicata", [["A", true]], true]);
    const prima = JSON.stringify(mem.tabelle);
    const e2 = await applicaPaginaBandi(mem.client, [bando], "incrementale", ADESSO, misure());
    await applicaPaginaEsiti(mem.client, [esito], "incrementale", ADESSO, misure());
    uguale("4. TED: rileggere gli stessi avvisi non scrive nulla", [e2.invariati, JSON.stringify(mem.tabelle) === prima], [1, true]);
    // gara TED non collegata: nessuna lettura in più, comportamento di sempre
    const mem2 = databaseInMemoria({ radar_procedure: [garaTed("A", { chiave: "ted:proc-X" })], radar_lotti: [lottoTed("A")], radar_procedure_fonti: [{ ...provTed("A", "700400-2026"), id_procedura_fonte: "proc-X" }], radar_aggiornamenti: [], omnia_ai_radar_gare_aggiunte: [] });
    await applicaPaginaBandi(mem2.client, [bando], "incrementale", ADESSO, misure());
    uguale("4. TED: gara non collegata, la nuova versione si applica come sempre", gara(mem2, "A").scadenza_giorno, "2026-12-20");
    const norm = (r: Record<string, unknown>) => ({ id: String(r.id), unita_a: (r.unita_a as string | null) ?? null });
    const m0 = misure();
    const r0 = await gareCheRestano(iniziali().client, [{ id: "A", unita_a: null }], "id, unita_a", norm, m0);
    const m1 = misure();
    const r1 = await gareCheRestano(iniziali().client, [{ id: "A", unita_a: null }, { id: "X", unita_a: "A" }], "id, unita_a", norm, m1);
    uguale("4. TED: senza gare collegate la risoluzione non fa nessuna lettura; con una gara collegata una sola, e trova la gara che resta", [r0.size, m0.richiesteDb, m1.richiesteDb, r1.get("X")?.id], [0, 0, 1, "A"]);
    // difesa: se la gara che resta non si trova, la versione resta sulla gara collegata ma NON notifica nessuno (la notifica è della gara che resta)
    const mem3 = databaseInMemoria({
      radar_procedure: [garaTed("X", { chiave: "ted:proc-X", unita_a: "MANCANTE" })],
      radar_lotti: [lottoTed("X")],
      radar_procedure_fonti: [{ ...provTed("X", "700400-2026"), id_procedura_fonte: "proc-X" }],
      radar_aggiornamenti: [],
      omnia_ai_radar_gare_aggiunte: [],
    });
    await applicaPaginaBandi(mem3.client, [bando], "incrementale", ADESSO, misure());
    await applicaPaginaEsiti(mem3.client, [esito], "incrementale", ADESSO, misure());
    uguale("4. TED: gara collegata senza gara che resta raggiungibile: cambiamenti registrati ma mai notificabili", mem3.tabelle.radar_aggiornamenti.filter((a) => a.tipo === "proroga" || a.tipo === "esito").map((a) => [a.tipo, a.notificabile]), [["proroga", false], ["esito", false]]);
  }

  // ═════ 5. collegamenti conservati con gare monitorate, salvate e aggiunte a mano (e progetti e documenti) ═════
  {
    const mem = databaseInMemoria({
      radar_procedure: [garaTed("T")],
      radar_lotti: [lottoTed("T")],
      radar_procedure_fonti: [provTed("T", "700001-2026")],
      omnia_ai_radar_salvate: [{ id: "s1", user_id: "impresa-sintetica", procedura_id: "T", monitorata: true }],
      omnia_ai_radar_gare_aggiunte: [{ id: "g1", user_id: "impresa-sintetica", cig: "PRV0000001", procedura_id: null }],
      radar_aggiornamenti: [],
    });
    const salvatePrima = JSON.stringify(mem.tabelle.omnia_ai_radar_salvate);
    await importa(mem, [bandoSardegna("700001")]);
    const s = await importa(mem, [bandoSintel()]);
    const garaSintel = mem.tabelle.radar_procedure.find((r) => String(r.chiave).startsWith("sintel:"))?.id;
    uguale("5. la gara aggiunta a mano con lo stesso CIG si collega alla gara pubblica di Sintel", [s.aggiunteCollegate, mem.tabelle.omnia_ai_radar_gare_aggiunte[0].procedura_id], [1, garaSintel]);
    atteso("5. le gare salvate e monitorate non vengono mai toccate da importazioni e unioni", JSON.stringify(mem.tabelle.omnia_ai_radar_salvate) === salvatePrima);
    // salvata su una gara poi assorbita: la riga resta, e la gara da mostrare è quella che resta (come in Monitorate)
    const mem2 = databaseInMemoria({ radar_procedure: [garaTed("T"), garaTed("S", { chiave: "sardegnacat:700001", fonti: ["sardegnacat"] })], omnia_ai_radar_salvate: [{ id: "s2", user_id: "impresa-sintetica", procedura_id: "S", monitorata: true }], radar_aggiornamenti: [] });
    await collegaGare(mem2.client, [{ a: "S", b: "T", motivo: "prova", traccia: "prova", fonte: "sardegnacat" }], ISO, misure());
    uguale("5. una gara salvata e poi assorbita: la riga salvata resta intatta e porta alla gara che resta", [mem2.tabelle.omnia_ai_radar_salvate[0].procedura_id, gara(mem2, "S").unita_a], ["S", "T"]);
    const tabelleCollegate = (leggi("supabase/migrations/0109_radar_archivio_pubblico.sql") + leggi("supabase/migrations/0112_radar_b1_monitorate_aggiunte_registro.sql") + leggi("supabase/migrations/0110_radar_aggiudicazioni.sql")).match(/references public\.radar_procedure/g)?.length ?? 0;
    atteso("5. progetti e documenti: nessuna tabella dei progetti o dei documenti dipende oggi dall'archivio pubblico (le unioni non cancellano né spostano righe)", tabelleCollegate > 0 && !/delete\s+from|\.delete\(/i.test(leggi("src/lib/radar/collegamenti.ts") + leggi("src/lib/radar/importa-regionali-pagina.ts")));
  }

  // ═════ 6. visibili ai clienti solo le fonti autorizzate ═════
  {
    const nascoste = new Set(["sardegnacat"]);
    uguale("6. una gara di sola SardegnaCAT non si mostra; con anche TED sì", [garaVisibileAiClienti({ fonti: ["sardegnacat"], chiave: "sardegnacat:1" }, nascoste), garaVisibileAiClienti({ fonti: ["ted", "sardegnacat"], chiave: "ted:x" }, nascoste), garaVisibileAiClienti({ fonti: [], chiave: "ted:x" }, nascoste)], [false, true, true]);
    uguale("6. le fonti nascoste non compaiono nelle fonti della gara", fontiVisibili([{ fonte: "ted" }, { fonte: "sardegnacat" }], (x) => x.fonte, nascoste).map((x) => x.fonte), ["ted"]);
    // la procedura SardegnaCAT è già unita (dopo una conferma) alla gara TED visibile: le sue versioni vanno alla gara che resta
    const mem = databaseInMemoria({
      radar_procedure: [garaTed("T"), garaTed("S", { chiave: "sardegnacat:700001", fonti: ["sardegnacat"], unita_a: "T" })],
      radar_lotti: [lottoTed("T")],
      radar_procedure_fonti: [provTed("T", "700001-2026"), { procedura_id: "S", fonte: "sardegnacat", id_fonte: "700001", impronta: "vecchia", id_procedura_fonte: "700001", rif_ted: null }],
      radar_aggiornamenti: [],
    });
    const prima = JSON.stringify(gara(mem, "T"));
    const s = await importa(mem, [bandoSardegna("700001", { DtScadenzaBandoTecnical: "2026-12-17T10:00:00" })], { nascoste: ["sardegnacat"] });
    const prov = mem.tabelle.radar_procedure_fonti.find((p) => p.fonte === "sardegnacat");
    uguale("6. fonte nascosta su una gara visibile: i suoi dati NON entrano (scadenza invariata), resta solo la provenienza", [s.nonApplicateNascosta, gara(mem, "T").scadenza_giorno, String(prov?.impronta).startsWith("nascosta:")], [1, "2026-12-10", true]);
    atteso("6. la gara non cambia per una fonte nascosta (salvo l'elenco interno delle fonti)", JSON.stringify({ ...gara(mem, "T"), fonti: null }) === JSON.stringify({ ...JSON.parse(prima), fonti: null }));
    const nuova = await importa(mem, [bandoSardegna("700050", { DtScadenzaBandoTecnical: "2026-12-11T10:00:00" })], { nascoste: ["sardegnacat"] });
    const sola = mem.tabelle.radar_procedure.find((r) => r.chiave === "sardegnacat:700050") as RigaMem;
    uguale("6. una gara di sola fonte nascosta entra nell'archivio ma non è visibile; nessuna notifica", [nuova.nuove, garaVisibileAiClienti({ fonti: sola.fonti as string[], chiave: sola.chiave as string }, nascoste), mem.tabelle.radar_aggiornamenti.filter((a) => a.procedura_id === sola.id && a.notificabile).length], [1, false, 0]);
    const s2 = await importa(mem, [bandoSardegna("700001", { DtScadenzaBandoTecnical: "2026-12-17T10:00:00" })], { nascoste: [] });
    uguale("6. quando la fonte diventa visibile la versione non applicata entra al giro dopo", [s2.invariati, gara(mem, "T").scadenza_giorno], [0, "2026-12-17"]);
    const ricerca = leggi("src/lib/radar/ricerca.ts");
    atteso("6. la ricerca esclude le gare con sole fonti nascoste", /\.overlaps\("fonti"/.test(ricerca) || /garaVisibileAiClienti/.test(ricerca));
    atteso("6. SardegnaCAT nasce nascosta ai clienti nella migrazione 0120", /\('sardegnacat', false, true\)/.test(leggi("supabase/migrations/0120_radar_multifonte.sql")));
    atteso("6. citazione delle fonti identica ai connettori", ATTRIBUZIONE_FONTE.sintel === ATTRIBUZIONE_SINTEL && ATTRIBUZIONE_FONTE.sardegnacat === ISTANZE_AFLINK.sardegnacat.attribuzione);
    uguale("6. riepilogo delle fonti di una gara con Sintel e SardegnaCAT", riepilogoFonti([{ fonte: "sintel", id_fonte: "1", url: "u", pubblicato_il: null, tipo_avviso: "Procedura Aperta", rilevato_il: ISO }, { fonte: "sardegnacat", id_fonte: "2", url: "v", pubblicato_il: "2026-11-03", tipo_avviso: "Bando", rilevato_il: ISO }], {}).map((r) => [r.fonte, r.etichettaAvviso]), [["sintel", "Sintel, procedura 1"], ["sardegnacat", "SardegnaCAT, procedura 2"]]);
  }

  // ═════ 7. nessuna perdita né duplicazione nelle sincronizzazioni successive ═════
  {
    const mem = databaseInMemoria({ radar_procedure: [garaTed("T")], radar_lotti: [lottoTed("T")], radar_procedure_fonti: [provTed("T", "700001-2026")], radar_aggiornamenti: [], omnia_ai_radar_gare_aggiunte: [] });
    const pagina = () => [bandoSardegna("700001"), bandoSardegna("700002", { Oggetto: "Servizio mensa (prova sintetica)", DtScadenzaBandoTecnical: "2026-12-12T12:00:00", CIG: "PRV0000077" })];
    await importa(mem, pagina());
    const dopo1 = fotografia(mem);
    const conti1 = Object.fromEntries(Object.entries(mem.tabelle).map(([k, v]) => [k, v.length]));
    const s2 = await importa(mem, pagina());
    uguale("7. la stessa lettura ripetuta non scrive nulla (stesso contenuto = nessuna riga nuova)", [s2.invariati, fotografia(mem) === dopo1, JSON.stringify(Object.fromEntries(Object.entries(mem.tabelle).map(([k, v]) => [k, v.length]))) === JSON.stringify(conti1)], [2, true, true]);
    await importa(mem, [bandoSardegna("700001")]);
    atteso("7. una procedura sparita dalla fonte non viene cancellata", mem.tabelle.radar_procedure.some((r) => r.chiave === "sardegnacat:700002"));
    // la stessa gara letta da TED, SardegnaCAT e (via CIG) Sintel: una sola gara visibile
    await importa(mem, [bandoSintel({ cig: "PRV0000077", id_procedura: "900000077", nome_procedura: "Servizio mensa (prova sintetica)", codice_cpv: "55524000-9", stazione_appaltante: "COMUNE DI PROVASINTETICA", cf_stazione_appaltante: "00000000001", data_fine_negoziazione: "2026-12-12T00:00:00.000" })]);
    const conCig = mem.tabelle.radar_procedure.filter((r) => mem.tabelle.radar_lotti.some((l) => l.procedura_id === r.id && l.cig === "PRV0000077") || (r.fonti as string[]).includes("sintel"));
    uguale("7. stesso CIG da Sintel e SardegnaCAT: una sola gara, con entrambe le fonti", [conCig.length, (conCig[0]?.fonti as string[] | undefined)?.sort()], [1, ["sardegnacat", "sintel"]]);
    // TED e SardegnaCAT restano due gare finché un amministratore non conferma il suggerimento (identificativo della piattaforma non ufficiale)
    uguale("7. prima della conferma: TED e SardegnaCAT due gare con un suggerimento; SardegnaCAT e Sintel (stesso CIG) già una", [visibili(mem).length, (await leggiProposteAperte(mem.client)).length], [3, 1]);
    const pr = (await leggiProposteAperte(mem.client))[0];
    await confermaProposta(mem.client, pr.a, pr.b, "admin sintetico", ISO, misure());
    uguale("7. dopo la conferma: una sola gara visibile per ogni procedura", visibili(mem).length, 2);
    const conti2 = JSON.stringify(Object.fromEntries(Object.entries(mem.tabelle).map(([k, v]) => [k, v.length])));
    await importa(mem, pagina());
    uguale("7. sincronizzazione successiva dopo l'unione: nessuna riga nuova, nessun doppione", [JSON.stringify(Object.fromEntries(Object.entries(mem.tabelle).map(([k, v]) => [k, v.length]))) === conti2, visibili(mem).length], [true, 2]);
    const proroghe = (mem.tabelle.radar_aggiornamenti ?? []).filter((a) => a.tipo === "nuova");
    uguale("7. «nuova» registrata una sola volta per gara", proroghe.length, new Set(proroghe.map((p) => p.procedura_id)).size);
  }

  // ═════ suggerimenti (corrispondenze probabili, regola S9): mai unioni automatiche ═════
  {
    const mem = databaseInMemoria({ radar_procedure: [garaTed("T2", { sa_codice_fiscale: "00000000002", scadenza_giorno: "2026-12-15", piattaforma_id: null, url_documenti: null, sa_regione: "lombardia", luogo_regioni: ["lombardia"] })], radar_aggiornamenti: [] });
    const s = await importa(mem, [bandoSintel()]);
    const sintelId = mem.tabelle.radar_procedure.find((r) => String(r.chiave).startsWith("sintel:"))?.id as string;
    uguale("S9: stesso ente e stesso giorno: SOLO un suggerimento, nessuna unione automatica", [s.proposte, gara(mem, sintelId).unita_a, gara(mem, "T2").unita_a], [1, null, null]);
    const aperte = await leggiProposteAperte(mem.client);
    uguale("S9: il suggerimento è in console, da decidere", aperte.length, 1);
    const c = await confermaProposta(mem.client, aperte[0].a, aperte[0].b, "admin sintetico", ISO, misure());
    uguale("S9: confermato da un amministratore → unione 0117 (resta la gara TED)", [c.collegate, gara(mem, sintelId).unita_a], [1, "T2"]);
    uguale("S9: dopo la decisione non è più tra gli aperti", (await leggiProposteAperte(mem.client)).length, 0);
    const mem2 = databaseInMemoria({ radar_procedure: [garaTed("T3", { sa_codice_fiscale: "00000000002", scadenza_giorno: "2026-12-15", piattaforma_id: null, url_documenti: null })], radar_aggiornamenti: [] });
    await importa(mem2, [bandoSintel()]);
    const p2 = (await leggiProposteAperte(mem2.client))[0];
    await rifiutaProposta(mem2.client, p2.a, p2.b, "admin sintetico", ISO);
    const sid2 = mem2.tabelle.radar_procedure.find((r) => String(r.chiave).startsWith("sintel:"))?.id as string;
    uguale("S9: rifiutato → le due gare non si propongono né si uniscono più", [(await leggiProposteAperte(mem2.client)).length, (gara(mem2, sid2).unita_esclusa_con as string[]).includes("T3")], [0, true]);
    const mem3 = databaseInMemoria({ radar_procedure: [garaTed("T4", { sa_codice_fiscale: "00000000002", scadenza_giorno: "2026-12-15", piattaforma_id: null, url_documenti: null }), garaTed("T5", { sa_codice_fiscale: "00000000002", scadenza_giorno: "2026-12-15", piattaforma_id: null, url_documenti: null })], radar_aggiornamenti: [] });
    uguale("S9: due candidati dello stesso ente nello stesso giorno → nessun suggerimento", (await importa(mem3, [bandoSintel()])).proposte, 0);
  }

  // ═════ rilievi della prova di B1 (17/11), nei controlli 5, 6 e 7 ═════
  {
    // 5/7: l'impresa aveva salvato ENTRAMBE le copie di una gara poi collegata: in Monitorate una riga sola, nessun salvataggio cancellato
    const salvate = [
      { id: "s-copia", procedura_id: "C" },
      { id: "s-resta", procedura_id: "T" },
      { id: "s-altra", procedura_id: "Z" },
    ];
    const resta = new Map([["C", "T"]]);
    const uniche = unoPerGaraMostrata(salvate, (s) => resta.get(s.procedura_id) ?? s.procedura_id);
    uguale("rilievo 1: due salvataggi delle copie di una gara collegata → una sola riga (il primo dell'elenco), gli altri intatti", [uniche.map((s) => s.id), salvate.length], [["s-copia", "s-altra"], 3]);
    atteso("rilievo 1: Monitorate usa una riga per gara mostrata", /unoPerGaraMostrata\(salvate,/.test(leggi("src/app/site-omnia-ai/dashboard/omnia-ai/opportunita/monitorate/page.tsx")));
    // 6/7: conteggi della console come li vede il cliente (senza le copie collegate), le copie mostrate a parte
    const consoleDati = leggi("src/lib/console/tender-intelligence.ts");
    atteso("rilievo 2: «in archivio» e «aperte adesso» escludono le copie collegate; le copie si contano a parte", /select\("id", \{ count: "exact", head: true \}\)\.is\("unita_a", null\);/.test(consoleDati) && /\.is\("unita_a", null\)\.eq\("stato", "aperta"\)/.test(consoleDati) && /\.not\("unita_a", "is", null\);/.test(consoleDati) && /gareCollegate/.test(leggi("src/app/site-console/_componenti/tender-intelligence-vista.tsx")));
    // 6: la riga «Fonte» della sintesi elenca tutte le fonti visibili e rimanda a «Da dove vengono i dati»
    const frasi = sintesiDeterministica({ oggetto: "x", settori: ["ristorazione"], cpvPrincipale: "55524000", ente: "Comune di Prova", comune: null, provincia: null, valoreStimato: null, durataMesi: null, nLotti: 1, tipoProcedura: null, criterio: null, scadenza: null, scadenzaGiorno: "2026-12-10", fonte: "TED e PVL ANAC", numeroAvviso: null, dataPubblicazione: "2026-11-03" });
    atteso("rilievo 3: con più fonti la sintesi le elenca tutte e rimanda a «Da dove vengono i dati»", /^Fonti: TED e PVL ANAC; primo avviso pubblicato il .*vedi «Da dove vengono i dati»\.$/.test(frasi.at(-1) ?? ""), frasi.at(-1));
    atteso("rilievo 3: la scheda passa alla sintesi le fonti degli avvisi visibili", /fonte: fontiMostrate\.length > 1 \? etichettaFonti\(fontiMostrate\)/.test(leggi("src/app/site-omnia-ai/dashboard/omnia-ai/opportunita/gara/[id]/page.tsx")));
  }

  // ═════ console: suggerimenti con le prove affiancate; errore «risolto» ═════
  {
    const vista = leggi("src/app/site-console/_componenti/tender-intelligence-vista.tsx");
    const datiConsole = leggi("src/lib/console/tender-intelligence.ts");
    atteso("console: ogni suggerimento mostra le due gare affiancate (ente e codice fiscale, scadenza, importo, fonti, pagina ufficiale)", /export type ProvaGaraConsole = \{[^}]*ente[^}]*codiceFiscale[^}]*scadenzaGiorno[^}]*importo[^}]*collegamento[^}]*fonti/.test(datiConsole) && /\[p\.a, p\.b\]\.map\(\(g\) =>/.test(vista) && /Pagina ufficiale/.test(vista));
    uguale("console: l'ultimo errore è attuale solo se più recente dell'ultimo giro riuscito", [erroreAncoraAttuale("2026-11-17T10:00:00Z", "2026-11-17T09:00:00Z"), erroreAncoraAttuale("2026-11-17T08:00:00Z", "2026-11-17T09:00:00Z"), erroreAncoraAttuale("2026-11-17T08:00:00Z", null), erroreAncoraAttuale(null, null)], [true, false, true, false]);
    atteso("console: un errore superato si legge come «risolto»", /erroreAncoraAttuale\(f\.db\.ultimo_errore_il, f\.db\.ultimo_successo_il\)[\s\S]{0,120}risolto: ultimo giro riuscito il/.test(vista));
  }

  // ═════ regole generali ═════
  uguale("precedenza provvisoria (S8): PVL, SardegnaCAT, Sintel, TED; tra TED e PVL come prima", [PRECEDENZA_FONTI.pvl > PRECEDENZA_FONTI.sardegnacat, PRECEDENZA_FONTI.sardegnacat > PRECEDENZA_FONTI.sintel, PRECEDENZA_FONTI.sintel > PRECEDENZA_FONTI.ted], [true, true, true]);
  uguale("scritture delle fonti regionali solo sullo staging", [scrittureRadarConsentite("sintel", { NEXT_PUBLIC_SUPABASE_URL: "https://ryawdldqiumqsskrnyps.supabase.co" }).ok, scrittureRadarConsentite("sardegnacat", { NEXT_PUBLIC_SUPABASE_URL: "https://bihfrzspqxsrzlbqqvqa.supabase.co", VERCEL_ENV: "production" }).ok], [true, false]);
  // fase B3 (18/11): sulle anteprime di Vercel nessuna importazione, nemmeno sullo staging e con l'interruttore delle classificazioni acceso
  {
    const STAGING = "https://ryawdldqiumqsskrnyps.supabase.co";
    const PROD = "https://bihfrzspqxsrzlbqqvqa.supabase.co";
    const fonti = ["ted", "pvl", "sintel", "sardegnacat"] as const;
    uguale(
      "B3. anteprima Vercel (VERCEL_ENV=preview) sullo staging: nessuna fonte scrive, anche con RADAR_CLASSIFICAZIONI, RADAR_PVL_CRON e RADAR_REGIONALI_CRON accesi",
      fonti.map((f) => scrittureRadarConsentite(f, { NEXT_PUBLIC_SUPABASE_URL: STAGING, VERCEL_ENV: "preview", RADAR_CLASSIFICAZIONI: "attive", RADAR_PVL_CRON: "attivo", RADAR_REGIONALI_CRON: "attivo" }).ok),
      [false, false, false, false],
    );
    uguale(
      "B3. invariati: gli script locali sullo staging scrivono (VERCEL_ENV assente); TED in produzione solo dal deploy di produzione",
      [...fonti.map((f) => scrittureRadarConsentite(f, { NEXT_PUBLIC_SUPABASE_URL: STAGING }).ok), scrittureRadarConsentite("ted", { NEXT_PUBLIC_SUPABASE_URL: PROD, VERCEL_ENV: "production" }).ok, scrittureRadarConsentite("ted", { NEXT_PUBLIC_SUPABASE_URL: PROD, VERCEL_ENV: "preview" }).ok],
      [true, true, true, true, true, false],
    );
    // gli importatori si fermano PRIMA di qualunque accesso al database (un client che fallisce a ogni uso lo dimostra)
    let accessi = 0;
    const clientVietato = new Proxy({}, { get: () => { accessi++; throw new Error("accesso al database non atteso"); } }) as unknown as Parameters<typeof eseguiImportazioneTed>[0];
    const envAnteprima = { NEXT_PUBLIC_SUPABASE_URL: STAGING, VERCEL_ENV: "preview" };
    const esiti = [
      await eseguiImportazioneTed(clientVietato, { tempoMassimoMs: 1_000, pagineMassime: 1, env: envAnteprima }),
      await eseguiImportazionePvl(clientVietato, { modo: "incrementale", tempoMassimoMs: 1_000, env: envAnteprima }),
      await eseguiImportazioneRegionale(clientVietato, "sintel", { tempoMassimoMs: 1_000, env: envAnteprima }),
      await eseguiImportazioneRegionale(clientVietato, "sardegnacat", { tempoMassimoMs: 1_000, env: envAnteprima }),
    ];
    uguale(
      "B3. anteprima: TED, PVL, Sintel e SardegnaCAT finiscono con «ambiente_non_consentito» senza toccare il database (cron e «Esegui un giro adesso» passano di qui)",
      [esiti.map((e) => (e.eseguita ? "eseguita" : e.motivo)), accessi],
      [["ambiente_non_consentito", "ambiente_non_consentito", "ambiente_non_consentito", "ambiente_non_consentito"], 0],
    );
    for (const [rotta, importatore] of [["radar-ted", "eseguiImportazioneTed("], ["radar-pvl", "eseguiImportazionePvl("], ["radar-regionali", "eseguiImportazioneRegionale("]] as const) {
      const t = leggi(`src/app/api/cron/${rotta}/route.ts`);
      atteso(`B3. cron ${rotta}: CRON_SECRET per primo, poi l'importatore (che ha la guardia dell'anteprima)`, t.indexOf("cronAutorizzato(") > 0 && t.indexOf("cronAutorizzato(") < t.indexOf(importatore));
    }
    for (const f of ["importa-ted.ts", "importa-pvl.ts", "importa-regionali.ts"]) {
      const t = leggi(`src/lib/radar/${f}`);
      atteso(`B3. ${f}: il permesso dell'ambiente viene prima di ogni accesso al database`, t.indexOf("const permesso = scrittureRadarConsentite(") > 0 && t.indexOf("const permesso = scrittureRadarConsentite(") < t.indexOf("admin.from("));
    }
    const vercel = JSON.parse(leggi("vercel.json")) as { crons?: { path: string }[] };
    uguale("B3. vercel.json programma solo il cron di TED tra quelli del radar (PVL e regionali no)", (vercel.crons ?? []).map((c) => c.path).filter((p) => p.startsWith("/api/cron/radar")), ["/api/cron/radar-ted"]);
  }
  uguale("tipo di opportunità di TED e PVL", ["cn-standard", "pin-cfc-standard", "qu-sy", "P2_16", "can-standard"].map((t) => opportunitaDaTipoAvviso(t)?.tipo ?? null), ["bando", "bando", "sistema_qualificazione", "bando", null]);

  const sql = leggi("supabase/migrations/0120_radar_multifonte.sql").replace(/--[^\n]*/g, "");
  atteso("0120: additiva (nessun drop, truncate, delete, alter type, rename)", !/\bdrop\b|truncate|delete\s+from|alter\s+column[^;]*type|rename/i.test(sql));
  // istruzioni di primo livello (l'aggiornamento dentro la funzione del trigger è quello delle fonti, ed è rientrato)
  atteso("0120: gli aggiornamenti riempiono solo le colonne nuove vuote", (sql.match(/^update /gim) ?? []).length === 3 && /set fonti = s\.fonti[\s\S]*p\.fonti = '\{\}'/.test(sql) && (sql.match(/set piattaforma_id =[\s\S]*?where piattaforma_id is null/g) ?? []).length === 2);
  atteso("0120: nessuna tabella nuova, nessun permesso ai clienti, nessuna chiave esterna", !/create table/i.test(sql) && !/grant[^;]*(anon|authenticated)/i.test(sql) && !/references/i.test(sql) && /revoke all on function public\.radar_aggiungi_fonte_alla_gara\(\) from public, anon, authenticated/.test(sql));
  atteso("0120: riusa la 0117 senza ridefinirla", !/unita_a|unita_esclusa_con/.test(sql.replace(/^.*$/m, "")) || !/add column if not exists unita_/.test(sql));
  atteso("0120: le fonti nuove nascono spente", /\('sintel', false, false\)/.test(sql) && /\('sardegnacat', false, true\)/.test(sql));

  const codice = ["src/lib/radar/importa-fonti-pagina.ts", "src/lib/radar/importa-regionali-pagina.ts", "src/lib/radar/importa-regionali.ts", "src/lib/radar/collegamenti.ts"].map(leggi).join("\n");
  atteso("un solo sistema di unione: nessuna fusione che cancella o sposta righe", !/\.delete\(|delete from/i.test(codice));
  atteso("le fonti regionali scrivono con il motore di unione (unisciVersione, unisciLotti, collegaGare)", /unisciVersione/.test(codice) && /unisciLotti/.test(codice) && /collegaGare/.test(codice));
  atteso("il giro rispetta il blocco e il semaforo (occupata, nessuna scrittura)", /blocco_fino_a\.is\.null,blocco_fino_a\.lt\./.test(leggi("src/lib/radar/importa-regionali.ts")) && /"occupata"/.test(leggi("src/lib/radar/importa-regionali.ts")));
  const vercel = JSON.parse(leggi("vercel.json")) as { crons: { path: string }[] };
  atteso("nessun cron nuovo in vercel.json", !vercel.crons.some((c) => /regional|sintel|sardegna|fonti/.test(c.path)));
  const rotta = leggi("src/app/api/cron/radar-regionali/route.ts");
  atteso("cron delle fonti regionali: segreto e interruttore RADAR_REGIONALI_CRON=attivo", /cronAutorizzato\(request\.headers\.get\("authorization"\), process\.env\.CRON_SECRET\)/.test(rotta) && /RADAR_REGIONALI_CRON !== "attivo"/.test(rotta));
  const script = leggi("scripts/radar-importa-regionale.ts");
  atteso("script di importazione: solo staging e porta delle autorizzazioni prima di tutto", /controllaPorta\(\{ script: "radar-importa-regionale\.ts" \}\)/.test(script) && /RADAR_STAGING_REF/.test(script) && script.indexOf("controllaPorta") < script.indexOf("eseguiImportazioneRegionale(admin"));
  const azioni = leggi("src/app/site-console/azioni/tender-intelligence.ts");
  const nuoveAzioni = ["impostaFonteRegionale", "impostaVisibilitaFonte", "eseguiGiroRegionale", "decidiPropostaCollegamento"];
  atteso("console: le azioni nuove sono solo per amministratori", nuoveAzioni.every((n) => new RegExp(`export async function ${n}\\([^)]*\\)[^{]*\\{\\s*const sessione = await richiediAdminAzione\\(\\);\\s*if \\(!sessione\\)`).test(azioni)));
  atteso("console: accensione, visibilità e suggerimenti sempre nel registro", ["impostaFonteRegionale", "impostaVisibilitaFonte", "decidiPropostaCollegamento"].every((n) => new RegExp(`export async function ${n}[\\s\\S]*?registroDisponibile\\(admin\\)[\\s\\S]*?await registra\\(admin`).test(azioni)));
  // decisione 48E dell'utente (23/11/2026): SardegnaCAT visibile senza aspettare il parere legale (comportamento provato da
  // verifica-monitorate-fonti-nascoste.ts, MV1-MV5)
  atteso("console: SardegnaCAT si mostra ai clienti senza la conferma del parere legale (decisione 48E)", !/formData\.get\("parere"\)/.test(azioni));

  console.log(fallimenti.length === 0 ? "\nVerifica B2a (motore multifonte, 7 controlli di accettazione): tutto a posto." : `\nVerifica B2a: ${fallimenti.length} controlli falliti:\n - ${fallimenti.join("\n - ")}`);
  process.exit(fallimenti.length === 0 ? 0 : 1);
}

principale().catch((e) => {
  console.error(e);
  process.exit(1);
});
