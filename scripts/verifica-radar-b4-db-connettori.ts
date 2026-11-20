// Verifica della fase B4, CORREZIONI AI CONNETTORI e collegamento del rilevamento PVL (B2, Fase A del 20/11/2026; 26B §6.2 e A.5, L4).
// Livello 1: NESSUN database vero, NESSUNA rete (fetch bloccato). Gli importatori scrivono su un database in memoria (scripts/lib/db-in-memoria).
// Dati SINTETICI (gare e avvisi inventati) e il campione PUBBLICO della PVL già nel repository (scripts/dati/radar-pvl-campione.json).
// Uso: npx tsx scripts/verifica-radar-b4-db-connettori.ts   → codice 0 se tutto passa, 1 altrimenti.
import fs from "fs";
import path from "path";
import { databaseInMemoria, type RigaMem } from "./lib/db-in-memoria";
import { applicaPaginaBandi } from "../src/lib/radar/importa";
import { cambiamentiTraVersioni, type RigaProcedura } from "../src/lib/radar/importa-calcoli";
import { affidabilitaDi, documentiPerConfronto, evidenzaDellaRiga, oggettoPerConfronto, registroConEvidenza, rigaAvvisoSenzaCampi, stessaScadenza } from "../src/lib/radar/importa-evidenza";
import { campoRegistroPvl } from "../src/lib/radar/importa-fonti-pagina";
import { applicaPaginaBandiPvl, fotografieERilevamentiPvl } from "../src/lib/radar/importa-pvl-pagina";
import { statistichePvlVuote as statisticheVuote } from "../src/lib/radar/importa-pvl-calcoli";
import { fotoDaBandoPvl } from "../src/lib/radar/modifiche-pvl";
import { leggiAvvisoPvl, type BandoPvl } from "../src/lib/radar/fonti/pvl-calcoli";
import { eEsclusione, leggiBandoTed } from "../src/lib/radar/fonti/ted-calcoli";
import { leggiElementoAflink, type BandoAflink } from "../src/lib/radar/fonti/aflink-calcoli";
import { bandoDaAflink, bandoDaSintel, statisticheRegionaliVuote, type BandoRegionale } from "../src/lib/radar/importa-regionali-calcoli";
import { applicaPaginaBandiRegionali, bandoUnificabileRegionale } from "../src/lib/radar/importa-regionali-pagina";
import { leggiProceduraSintel, type BandoSintel, type RigaSintel } from "../src/lib/radar/fonti/sintel-calcoli";
import { cambiamentiDeiLotti, identificativoLottoStabile, unisciLotti, type LottoUnito } from "../src/lib/radar/unione-calcoli";

globalThis.fetch = (async () => {
  throw new Error("RETE VIETATA nella verifica dei connettori B4");
}) as typeof fetch;

let ok = 0;
const falliti: string[] = [];
function controlla(nome: string, condizione: boolean, dettaglio?: unknown): void {
  if (condizione) ok++;
  else falliti.push(`${nome}${dettaglio === undefined ? "" : ` → ${JSON.stringify(dettaglio).slice(0, 700)}`}`);
}
const RADICE = path.join(__dirname, "..");
const STAGING = "https://ryawdldqiumqsskrnyps.supabase.co";
const PROD = "https://bihfrzspqxsrzlbqqvqa.supabase.co";
const ADESSO = new Date("2026-11-12T08:00:00Z");
const misure = () => ({ richiesteDb: 0, msDb: 0 });

// ═══════════ 1. regole pure ═══════════
{
  const s = (giorno: string | null, iso: string | null) => ({ giorno, iso });
  controlla("scadenza: «Z» e «+01:00» dello stesso istante = stessa scadenza", stessaScadenza(s("2026-12-10", "2026-12-10T09:00:00.000Z"), s("2026-12-10", "2026-12-10T10:00:00+01:00")));
  controlla("scadenza: istante diverso = diversa", !stessaScadenza(s("2026-12-10", "2026-12-10T09:00:00Z"), s("2026-12-10", "2026-12-10T10:00:00Z")));
  controlla("scadenza: giorno diverso = diversa", !stessaScadenza(s("2026-12-10", null), s("2026-12-11", null)));
  controlla("scadenza: l'ora che SPARISCE nello stesso giorno non è una modifica", stessaScadenza(s("2026-12-10", "2026-12-10T09:00:00Z"), s("2026-12-10", null)));
  controlla("scadenza: l'ora che COMPARE nello stesso giorno è una modifica", !stessaScadenza(s("2026-12-10", null), s("2026-12-10", "2026-12-10T09:00:00Z")));
  controlla("scadenza: entrambe senza ora, stesso giorno = stessa", stessaScadenza(s("2026-12-10", null), s("2026-12-10", null)));
  controlla("oggetto: maiuscole, spazi, accenti, punteggiatura ed entità HTML non contano", oggettoPerConfronto("Servizio  di PULIZIA &amp; sanificazione — Città") === oggettoPerConfronto("servizio di pulizia & sanificazione, citta"));
  controlla("oggetto: parole diverse contano", oggettoPerConfronto("Servizio di pulizia") !== oggettoPerConfronto("Servizio di vigilanza"));
  controlla("documenti: protocollo, maiuscole dell'host, barra finale e frammento non contano", documentiPerConfronto("http://Esempio.invalid/gara/1/#doc") === documentiPerConfronto("https://esempio.invalid/gara/1"));
  controlla("documenti: un percorso diverso conta", documentiPerConfronto("https://esempio.invalid/gara/1") !== documentiPerConfronto("https://esempio.invalid/gara/2"));

  const base = { giorno: "2026-12-10", iso: "2026-12-10T09:00:00.000Z" };
  const riga = (p: Partial<RigaProcedura>): RigaProcedura =>
    ({ stato: "aperta", scadenza_giorno: base.giorno, scadenza_offerte: base.iso, valore_stimato: 1000, oggetto: "Servizio di pulizia", url_documenti: "https://esempio.invalid/doc", n_lotti: 1, ...p }) as RigaProcedura;
  const tipi = (a: RigaProcedura, b: RigaProcedura) => cambiamentiTraVersioni(a, b).map((c) => `${c.tipo}:${c.campo}`);
  controlla("versioni: stesso istante scritto in due modi → nessun cambiamento (le 16 false proroghe)", tipi(riga({}), riga({ scadenza_offerte: "2026-12-10T10:00:00+01:00" })).length === 0);
  controlla("versioni: ora persa nello stesso giorno → nessun cambiamento", tipi(riga({}), riga({ scadenza_offerte: null })).length === 0);
  controlla("versioni: proroga vera → «proroga»", JSON.stringify(tipi(riga({}), riga({ scadenza_giorno: "2026-12-20", scadenza_offerte: "2026-12-20T09:00:00Z" }))) === JSON.stringify(["proroga:scadenza_offerte"]));
  controlla("versioni: oggetto solo riformattato → nessun cambiamento", tipi(riga({}), riga({ oggetto: "SERVIZIO DI PULIZIA." })).length === 0);
  controlla("versioni: collegamento solo riformattato → nessun cambiamento", tipi(riga({}), riga({ url_documenti: "http://ESEMPIO.invalid/doc/" })).length === 0);
  controlla("versioni: collegamento davvero diverso → «rettifica» di url_documenti", JSON.stringify(tipi(riga({}), riga({ url_documenti: "https://esempio.invalid/altro" }))) === JSON.stringify(["rettifica:url_documenti"]));

  // evidenza e notifica_email: le stesse regole del vincolo della 0123, calcolate prima di scrivere
  const avviso = (dichiarazione: string | null) => ({ fonte: "ted", idAvviso: "700402-2026", idAvvisoPrecedente: "700001-2026", url: "https://ted.europa.eu/it/notice/-/detail/700402-2026", pubblicatoIl: "2026-11-10+01:00", versione: 2, tipo: "cn-standard", avvisoTed: "700402-2026", dichiarazione });
  const r = (tipo: string, campo: string | null, notificabile: boolean, fonte = "ted", prima: string | null = "a", dopo: string | null = "b") => ({ tipo, campo, valore_precedente: prima, valore_nuovo: dopo, notificabile, fonte });
  const ev = (x: ReturnType<typeof r>, d: string | null = "cor-buy") => evidenzaDellaRiga(x, { ...avviso(d), fonte: x.fonte }, null);
  controlla("evidenza TED: proroga con il codice del motivo → avviso ufficiale, email sì", ev(r("proroga", "scadenza_offerte", true)).affidabilita === "avviso_ufficiale" && ev(r("proroga", "scadenza_offerte", true)).notifica_email === true);
  controlla("evidenza TED: senza codice del motivo → confronto tra versioni, email sì", ev(r("rettifica", "valore_stimato", true), null).affidabilita === "confronto_versioni" && ev(r("rettifica", "valore_stimato", true), null).notifica_email === true);
  controlla("evidenza: non notificabile (giro iniziale, gara chiusa o collegata) → mai email", ev(r("proroga", "scadenza_offerte", false)).notifica_email === false);
  controlla("evidenza: «nuova», «esito», «correzione_dati» → mai email, nessuna affidabilità", ["nuova", "esito", "correzione_dati"].every((t) => ev(r(t, null, true)).notifica_email === false && ev(r(t, null, true)).affidabilita === null));
  controlla("evidenza: il solo collegamento ai documenti → mai email", ev(r("rettifica", "url_documenti", true)).notifica_email === false);
  controlla("evidenza: Sintel e SardegnaCAT → parziali, mai email", ev(r("proroga", "scadenza_offerte", true, "sintel")).affidabilita === "parziale" && ev(r("proroga", "scadenza_offerte", true, "sintel")).notifica_email === false && ev(r("rettifica", "oggetto", true, "sardegnacat"), "rettificato").notifica_email === false);
  const oraCompare = r("rettifica", "scadenza_offerte", true, "ted", "2026-12-14", "2026-12-14T16:00:00.000Z");
  controlla("evidenza: l'ora che compare nello stesso giorno SENZA dichiarazione → parziale, mai email", ev(oraCompare, null).affidabilita === "parziale" && ev(oraCompare, null).notifica_email === false);
  controlla("evidenza: l'ora che compare DENTRO una modifica dichiarata → avviso ufficiale (decisione 15)", ev(oraCompare, "cor-buy").affidabilita === "avviso_ufficiale" && ev(oraCompare, "cor-buy").notifica_email === true);
  controlla("evidenza: ora che compare a mezzanotte e mezza di Roma (giorno UTC precedente) riconosciuta", ev(r("rettifica", "scadenza_offerte", true, "ted", "2026-12-15", "2026-12-14T23:30:00.000Z"), null).affidabilita === "parziale");
  controlla("evidenza PVL: «rettifica» dichiarata → avviso ufficiale", affidabilitaDi("pvl", { dichiarazione: "rettifica" }, { campo: "oggetto", prima: "a", dopo: "b" }) === "avviso_ufficiale");
  // coerenza con il vincolo radar_aggiornamenti_notifica_email_ammessa della 0123, su TUTTE le combinazioni
  let coerenti = true;
  for (const tipo of ["nuova", "rettifica", "proroga", "annullamento", "esito", "correzione_dati"])
    for (const fonte of ["ted", "pvl", "sintel", "sardegnacat", "manuale"])
      for (const notificabile of [true, false])
        for (const d of [null, "cor-buy", "rettifica"])
          for (const campo of [null, "scadenza_offerte", "url_documenti", "avviso"]) {
            const e = evidenzaDellaRiga(r(tipo, campo, notificabile, fonte), { ...avviso(d), fonte }, null);
            const ammessa = !e.notifica_email || (notificabile && ["rettifica", "proroga", "annullamento"].includes(tipo) && ["avviso_ufficiale", "confronto_versioni"].includes(String(e.affidabilita ?? "")));
            if (!ammessa) coerenti = false;
          }
  controlla("evidenza: in nessuna combinazione la riga violerebbe il vincolo della 0123", coerenti);
  const e1 = evidenzaDellaRiga(r("proroga", "scadenza_offerte", true), { ...avviso("x".repeat(80)), avvisoTed: "non-valido", url: "javascript:alert(1)", pubblicatoIl: "ieri", versione: 9999 }, null);
  controlla("evidenza: valori fuori forma scartati (TED non valido, URL non http, data, versione, testo lungo)", e1.avviso_ted === null && e1.avviso_url === null && e1.avviso_pubblicato_il === null && e1.avviso_versione === null && String(e1.dichiarazione_fonte).length === 60);
  controlla("riga «avviso» senza campi: rettifica, campo «avviso», nessun valore", JSON.stringify(rigaAvvisoSenzaCampi("p", "ted", "700402-2026", true)) === JSON.stringify({ procedura_id: "p", tipo: "rettifica", campo: "avviso", valore_precedente: null, valore_nuovo: null, fonte: "ted", id_fonte: "700402-2026", notificabile: true }));
  // interruttore dell'evidenza
  controlla("interruttore dell'evidenza: spento di base", !registroConEvidenza({ NEXT_PUBLIC_SUPABASE_URL: STAGING }));
  controlla("interruttore dell'evidenza: «attivo» sullo staging", registroConEvidenza({ NEXT_PUBLIC_SUPABASE_URL: STAGING, RADAR_REGISTRO_EVIDENZA: "attivo" }));
  controlla("interruttore dell'evidenza: mai sulle anteprime né in produzione", !registroConEvidenza({ NEXT_PUBLIC_SUPABASE_URL: STAGING, RADAR_REGISTRO_EVIDENZA: "attivo", VERCEL_ENV: "preview" }) && !registroConEvidenza({ NEXT_PUBLIC_SUPABASE_URL: PROD, RADAR_REGISTRO_EVIDENZA: "attivo", VERCEL_ENV: "production" }));
  controlla("PVL: campi del registro (scadenza, lotto, avviso)", campoRegistroPvl({ campo: "scadenza", lotto: null }) === "scadenza_offerte" && campoRegistroPvl({ campo: "scadenza_lotto", lotto: "ABCDEFGHIJ" }) === "scadenza_offerte@ABCDEFGHIJ" && campoRegistroPvl({ campo: null, lotto: null }) === "avviso");
}

// ═══════════ 2. importatore TED con e senza evidenza ═══════════

function garaTed(id: string, p: Partial<RigaMem> = {}): RigaMem {
  return {
    id,
    chiave: `ted:proc-${id}`,
    oggetto: "Servizio di pulizia degli uffici (prova sintetica)",
    oggetto_breve: "Servizio di pulizia degli uffici",
    descrizione: null,
    sa_codice_fiscale: "00000000001",
    sa_denominazione: "COMUNE DI PROVASINTETICA",
    sa_comune: null,
    sa_provincia: null,
    sa_regione: "lombardia",
    codice_nuts: null,
    luogo_regioni: ["lombardia"],
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
    url_avviso: `https://ted.europa.eu/it/notice/-/detail/700001-2026`,
    url_documenti: "https://esempio.invalid/documenti/700001",
    piattaforma_host: "esempio.invalid",
    cpv_principale: "90910000",
    cpv_tutti: ["90910000"],
    settori: ["pulizia"],
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
const lottoTed = (procedura_id: string): RigaMem => ({ procedura_id, numero_lotto: "LOT-0001", cig: null, oggetto: null, cpv_principale: "90910000", cpv_tutti: ["90910000"], valore_stimato: 2000000, durata_mesi: null, scadenza_giorno: "2026-12-10", scadenza_offerte: "2026-12-10T09:00:00.000Z", scadenza_ora_indicata: true, scadenza_fonte: null, url_documenti: null });
const avvisoTed = (numero: string, p: Record<string, unknown> = {}): Record<string, unknown> => ({
  "publication-number": numero,
  "notice-identifier": `sintetico-${numero}`,
  "notice-version": 2,
  "notice-type": "cn-standard",
  "publication-date": "2026-11-10+01:00",
  "procedure-identifier": "proc-A",
  "buyer-name": { ita: ["COMUNE DI PROVASINTETICA"] },
  "organisation-identifier-buyer": ["00000000001"],
  "buyer-country-sub": ["ITC4C"],
  "title-proc": { ita: "Servizio di pulizia degli uffici (prova sintetica)" },
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
  "document-url-lot": ["https://esempio.invalid/documenti/700001"],
  ...p,
});
const memoria = () =>
  databaseInMemoria({
    radar_procedure: [garaTed("A", { chiave: "ted:proc-A" })],
    radar_lotti: [lottoTed("A")],
    radar_procedure_fonti: [{ procedura_id: "A", fonte: "ted", id_fonte: "700001-2026", impronta: "imp-700001", id_procedura_fonte: "proc-A", rif_ted: null }],
    radar_aggiornamenti: [],
    omnia_ai_radar_gare_aggiunte: [],
  });
const bandoTed = (a: Record<string, unknown>) => {
  const b = leggiBandoTed(a);
  if (eEsclusione(b)) throw new Error(`avviso sintetico escluso: ${JSON.stringify(b)}`);
  return b;
};

async function provaTed(): Promise<void> {
  // proroga ufficiale (codice del motivo) con l'evidenza accesa
  {
    const mem = memoria();
    const b = bandoTed(avvisoTed("700402-2026", { "change-reason-code": ["cor-buy"], "deadline-receipt-tender-date-lot": ["2026-12-20+01:00"] }));
    await applicaPaginaBandi(mem.client, [b], "incrementale", ADESSO, misure(), { evidenza: true });
    const p = mem.tabelle.radar_aggiornamenti.find((a) => a.tipo === "proroga");
    controlla("TED con evidenza: la proroga ufficiale porta avviso, precedente, versione, data, motivo, affidabilità, email", !!p && p.avviso_ted === "700402-2026" && p.avviso_precedente_id === "700001-2026" && p.avviso_versione === 2 && p.dichiarazione_fonte === "cor-buy" && p.affidabilita === "avviso_ufficiale" && p.notifica_email === true && p.avviso_pubblicato_il === "2026-11-10", p);
  }
  // stesso istante scritto in un altro fuso, con il codice del motivo e nessun altro cambiamento: nessuna proroga, ma la riga «avviso»
  {
    const mem = memoria();
    const b = bandoTed(avvisoTed("700403-2026", { "change-reason-code": ["update-add"], "deadline-receipt-tender-time-lot": ["09:00:00Z"] }));
    await applicaPaginaBandi(mem.client, [b], "incrementale", ADESSO, misure(), { evidenza: true });
    const righe = mem.tabelle.radar_aggiornamenti.map((a) => `${a.tipo}:${a.campo}:${a.notifica_email}`);
    controlla("TED: stesso istante in un altro fuso → nessuna proroga; avviso ufficiale senza campi → riga «avviso» notificabile", JSON.stringify(righe) === JSON.stringify(["rettifica:avviso:true"]), righe);
  }
  // senza evidenza: comportamento di prima (nessuna colonna nuova, nessuna riga «avviso»)
  {
    const mem = memoria();
    const b = bandoTed(avvisoTed("700404-2026", { "change-reason-code": ["cor-buy"], "deadline-receipt-tender-date-lot": ["2026-12-20+01:00"] }));
    await applicaPaginaBandi(mem.client, [b], "incrementale", ADESSO, misure());
    const righe = mem.tabelle.radar_aggiornamenti;
    controlla("TED senza evidenza: righe come prima, senza le colonne della 0123", righe.length === 1 && righe[0].tipo === "proroga" && !("notifica_email" in righe[0]) && !("affidabilita" in righe[0]), righe);
    const mem2 = memoria();
    await applicaPaginaBandi(mem2.client, [bandoTed(avvisoTed("700405-2026", { "change-reason-code": ["update-add"] }))], "incrementale", ADESSO, misure());
    controlla("TED senza evidenza: nessuna riga «avviso»", mem2.tabelle.radar_aggiornamenti.length === 0, mem2.tabelle.radar_aggiornamenti);
  }
  // collegamento ai documenti cambiato: registrato ma MAI email; giro iniziale: mai email
  {
    const mem = memoria();
    await applicaPaginaBandi(mem.client, [bandoTed(avvisoTed("700406-2026", { "change-reason-code": ["cor-buy"], "document-url-lot": ["https://esempio.invalid/documenti/altro"] }))], "incrementale", ADESSO, misure(), { evidenza: true });
    const u = mem.tabelle.radar_aggiornamenti.find((a) => a.campo === "url_documenti");
    controlla("TED: cambio del solo collegamento → registrato, notifica_email falso", !!u && u.notifica_email === false, mem.tabelle.radar_aggiornamenti);
    const mem2 = memoria();
    await applicaPaginaBandi(mem2.client, [bandoTed(avvisoTed("700407-2026", { "change-reason-code": ["cor-buy"], "deadline-receipt-tender-date-lot": ["2026-12-20+01:00"] }))], "recupero", ADESSO, misure(), { evidenza: true });
    controlla("TED: giro di recupero → mai email", mem2.tabelle.radar_aggiornamenti.every((a) => a.notifica_email === false), mem2.tabelle.radar_aggiornamenti);
  }
  // gara nuova: riga «nuova» con evidenza, mai email; tutte le righe dello stesso blocco con le stesse colonne
  {
    const mem = databaseInMemoria({ radar_procedure: [], radar_lotti: [], radar_procedure_fonti: [], radar_aggiornamenti: [], omnia_ai_radar_gare_aggiunte: [] });
    await applicaPaginaBandi(mem.client, [bandoTed(avvisoTed("700500-2026", { "procedure-identifier": "proc-NUOVA", "notice-version": 1 }))], "incrementale", ADESSO, misure(), { evidenza: true });
    const n = mem.tabelle.radar_aggiornamenti;
    controlla("TED: gara nuova → riga «nuova» con notifica_email falso", n.length === 1 && n[0].tipo === "nuova" && n[0].notifica_email === false && n[0].affidabilita === null, n);
  }
}

// ═══════════ 3. SardegnaCAT: il segnale di rettifica arriva al registro ═══════════
function provaSardegna(): void {
  // elemento SINTETICO del feed (stessa forma della verifica B2a), con il segnale «Bando Rettificato» nell'oggetto
  const elemento: Record<string, string> = {
    link: "https://sardegnacat.regione.sardegna.it/portale/index.php/bandi?getdettaglio=yes&bando=900001&scadenzaBando=2026-12-10T10:00:00",
    Oggetto: "Bando Rettificato - Servizio di ristorazione scolastica (prova sintetica)",
    Tipo: "Bando",
    DenominazioneEnte: "COMUNE DI PROVASINTETICA",
    Contratto: "Servizi",
    a_base_asta: "1.900.000,00",
    DtScadenzaBandoTecnical: "2026-12-10T10:00:00",
    CIG: "",
    TipoProcedura: "Aperta",
    statoFunzionale: "PresOfferte",
    IdMsg: "900001",
    TitoloDocumento: "Ristorazione (prova)",
    dataUltimaModifica: "2026-11-05T10:00:00",
    CPV: "55524000-9 - Servizi di ristorazione scolastica",
    DtPubblicazioneTecnical: "2026-11-03T11:00:00",
  };
  const letto = leggiElementoAflink("sardegnacat", elemento, ADESSO);
  if (letto.tipo !== "bando") {
    controlla("SardegnaCAT: (preparazione) l'elemento sintetico è un bando", false, letto);
    return;
  }
  const b = bandoDaAflink(letto as BandoAflink, "2026-11-12");
  controlla("SardegnaCAT: «Bando Rettificato» → dichiarazione «rettificato» nel bando regionale e nella provenienza", !!b && b.dichiarazione === "rettificato" && bandoUnificabileRegionale(b, ADESSO).motivoModifica === "rettificato", b?.dichiarazione);
}

// ═══════════ 4. PVL: fotografia e rilevamento collegati all'importatore (A.5, L4) ═══════════
type Avviso = Record<string, unknown>;
async function provaPvl(): Promise<void> {
  const campione = JSON.parse(fs.readFileSync(path.join(RADICE, "scripts/dati/radar-pvl-campione.json"), "utf8")) as { avvisi: Avviso[] };
  const reale = campione.avvisi.find((a) => typeof a.idAvviso === "string" && a.idAvviso.startsWith("f906425a")) as Avviso;
  if (!reale) {
    controlla("PVL: (preparazione) l'avviso pubblico di rettifica è nel campione", false);
    return;
  }
  const sezioneC = (a: Avviso) => (((a.templates as Record<string, unknown>[])[0].template ?? {}) as { sections: { name: string; items?: Record<string, unknown>[] }[] }).sections.find((s) => s.name === "SEZ. C")?.items ?? [];
  // versione precedente SINTETICA: stesso appalto, avviso TED precedente (781698 invece di 781699: la rettifica ha un suo avviso TED, quindi le
  // due versioni NON sono «pari» per il motore di unione), pubblicata il 02/11, sostituita dalla rettifica reale
  const precedente = JSON.parse(JSON.stringify(reale).split("781699-2026").join("781698-2026")) as Avviso;
  precedente.idAvviso = "00000000-0000-4000-8000-000000000001";
  precedente.dataPubblicazione = "2026-11-02T07:00:00.000+00:00";
  precedente.tipo = "avviso";
  precedente.nuovoAvviso = reale.idAvviso;
  precedente.tipoNuovoAvviso = "rettifica";
  precedente.attivo = false;
  precedente.dataScadenza = "2026-11-30T11:30:00.000+00:00";
  for (const l of sezioneC(precedente)) l.termine_ricezione = "2026-11-30+01:00";
  const bando = (a: Avviso) => {
    const l = leggiAvvisoPvl(a as never);
    if (l.tipo !== "bando") throw new Error("non è un bando");
    return l as BandoPvl;
  };
  const bPrec = bando(precedente);
  const bNuovo = bando(reale);
  // la versione precedente è già in archivio, con la sua fotografia (scritta da un giro con l'evidenza)
  const mem = databaseInMemoria({
    radar_procedure: [],
    radar_lotti: [],
    radar_procedure_fonti: [{ procedura_id: "G", fonte: "pvl", id_fonte: bPrec.meta.idAvviso, impronta: "imp-prec", id_procedura_fonte: bPrec.meta.idAppalto, rif_ted: null, foto: fotoDaBandoPvl(bPrec, precedente) }],
    radar_aggiornamenti: [],
    omnia_ai_radar_gare_aggiunte: [],
  });
  const m = misure();
  const r = await fotografieERilevamentiPvl(mem.client, [bNuovo], new Map([[bNuovo.meta.idAvviso, reale]]), m);
  const ril = r.rilevamenti.get(bNuovo.meta.idAvviso);
  controlla("PVL: una sola lettura a blocchi delle fotografie precedenti", m.richiesteDb === 1, m);
  controlla("PVL: la nuova versione si confronta con la precedente in archivio (rettifica dichiarata, scadenza cambiata)", !!ril && ril.confrontabili && ril.rettificaDichiarata && ril.modifiche.some((x) => x.campo === "scadenza"), ril);
  controlla("PVL: la fotografia nuova porta il «tipo» dell'avviso grezzo", r.foto.get(bNuovo.meta.idAvviso)?.tipoDichiarato === "rettifica");
  // senza fotografia precedente: nessun confronto (comportamento di prima)
  const vuota = databaseInMemoria({ radar_procedure: [], radar_lotti: [], radar_procedure_fonti: [], radar_aggiornamenti: [], omnia_ai_radar_gare_aggiunte: [] });
  const r0 = await fotografieERilevamentiPvl(vuota.client, [bNuovo], new Map([[bNuovo.meta.idAvviso, reale]]), misure());
  controlla("PVL: senza fotografia precedente → «nessuna_versione_precedente», rettifica dichiarata ricordata", r0.rilevamenti.get(bNuovo.meta.idAvviso)?.confrontabili === false && r0.rilevamenti.get(bNuovo.meta.idAvviso)?.rettificaDichiarata === true);
  // due versioni nella STESSA pagina: la seconda si confronta con la prima
  const r2 = await fotografieERilevamentiPvl(vuota.client, [bNuovo, bPrec], new Map<string, unknown>([[bNuovo.meta.idAvviso, reale], [bPrec.meta.idAvviso, precedente]]), misure());
  controlla("PVL: due versioni nella stessa pagina → la più recente si confronta con l'altra, in ordine", r2.rilevamenti.get(bNuovo.meta.idAvviso)?.confrontabili === true && r2.rilevamenti.get(bPrec.meta.idAvviso)?.confrontabili === false);

  // dall'importatore: la gara entra dalla versione precedente, poi arriva la rettifica con l'evidenza accesa
  const memG = databaseInMemoria({ radar_procedure: [], radar_lotti: [], radar_procedure_fonti: [], radar_aggiornamenti: [], omnia_ai_radar_gare_aggiunte: [] });
  const stat = statisticheVuote();
  await applicaPaginaBandiPvl(memG.client, [bPrec], "incrementale", new Date("2026-11-03T08:00:00Z"), misure(), stat, { evidenza: true, grezzi: new Map([[bPrec.meta.idAvviso, precedente]]) });
  const provPrec = memG.tabelle.radar_procedure_fonti.find((p) => p.id_fonte === bPrec.meta.idAvviso);
  controlla("PVL importatore: la provenienza della prima versione porta la fotografia", !!provPrec?.foto && (provPrec.foto as { idAvviso: string }).idAvviso === bPrec.meta.idAvviso, provPrec);
  await applicaPaginaBandiPvl(memG.client, [bNuovo], "incrementale", new Date("2026-11-05T08:00:00Z"), misure(), stat, { evidenza: true, grezzi: new Map([[bNuovo.meta.idAvviso, reale]]) });
  const registro = memG.tabelle.radar_aggiornamenti.filter((a) => a.tipo !== "nuova");
  const scad = registro.find((a) => String(a.campo).startsWith("scadenza_offerte") && a.id_fonte === bNuovo.meta.idAvviso && !String(a.campo).includes("@"));
  controlla("PVL importatore: la modifica della scadenza dentro la rettifica dichiarata ha l'evidenza della PVL (avviso ufficiale, precedente, URL dell'avviso) e l'email", !!scad && scad.affidabilita === "avviso_ufficiale" && scad.avviso_precedente_id === bPrec.meta.idAvviso && /^https:\/\//.test(String(scad.avviso_url)) && scad.dichiarazione_fonte === "rettifica" && scad.notifica_email === true, registro);
  controlla("PVL importatore: nessuna riga del registro viola il vincolo della 0123", memG.tabelle.radar_aggiornamenti.every((a) => !a.notifica_email || (a.notificabile && ["rettifica", "proroga", "annullamento"].includes(String(a.tipo)) && ["avviso_ufficiale", "confronto_versioni"].includes(String(a.affidabilita)))));
  controlla("PVL importatore: le modifiche non registrate dal motore di unione restano evidenza senza email", registro.filter((a) => a.notificabilePvl !== undefined).length === 0 && registro.filter((a) => String(a.campo).includes("@") || ["oggetto", "url_documenti", "criterio_aggiudicazione"].includes(String(a.campo))).every((a) => a.notifica_email === false));
  // senza evidenza: nessuna fotografia, registro come prima
  const memS = databaseInMemoria({ radar_procedure: [], radar_lotti: [], radar_procedure_fonti: [], radar_aggiornamenti: [], omnia_ai_radar_gare_aggiunte: [] });
  await applicaPaginaBandiPvl(memS.client, [bPrec], "incrementale", new Date("2026-11-03T08:00:00Z"), misure(), statisticheVuote());
  controlla("PVL senza evidenza: provenienza senza fotografia e registro senza le colonne della 0123", memS.tabelle.radar_procedure_fonti.every((p) => !("foto" in p)) && memS.tabelle.radar_aggiornamenti.every((a) => !("notifica_email" in a)));
}

// ═══════════ 6. difetti del 20/11 (Incarico 3): proroga di UN solo lotto e modifiche Sintel ═══════════
const righeRegistro = (mem: ReturnType<typeof databaseInMemoria>) =>
  mem.tabelle.radar_aggiornamenti
    .filter((a) => a.tipo !== "nuova")
    .map((a) => `${a.tipo}:${a.campo}:${a.notifica_email}`)
    .sort();
const lottoArchivio = (procedura_id: string, numero: string, iso: string): RigaMem => ({ procedura_id, numero_lotto: numero, cig: null, oggetto: null, cpv_principale: "90910000", cpv_tutti: ["90910000"], valore_stimato: 1000000, durata_mesi: null, scadenza_giorno: iso.slice(0, 10), scadenza_offerte: iso, scadenza_ora_indicata: true, scadenza_fonte: null, url_documenti: null });
// gara TED con due lotti in archivio; la gara porta la scadenza PIÙ VICINA tra i lotti (come il lettore TED)
function memoriaDueLotti(s1: string, s2: string): ReturnType<typeof databaseInMemoria> {
  const vicina = [s1, s2].sort()[0];
  return databaseInMemoria({
    radar_procedure: [garaTed("A", { chiave: "ted:proc-A", n_lotti: 2, scadenza_giorno: vicina.slice(0, 10), scadenza_offerte: vicina })],
    radar_lotti: [lottoArchivio("A", "LOT-0001", s1), lottoArchivio("A", "LOT-0002", s2)],
    radar_procedure_fonti: [{ procedura_id: "A", fonte: "ted", id_fonte: "700001-2026", impronta: "imp-700001", id_procedura_fonte: "proc-A", rif_ted: null }],
    radar_aggiornamenti: [],
    omnia_ai_radar_gare_aggiunte: [],
  });
}
// avviso TED SINTETICO con due lotti, ore 10:00 di Roma
const avvisoDueLotti = (numero: string, giorni: [string, string], p: Record<string, unknown> = {}) =>
  avvisoTed(numero, {
    "change-reason-code": ["cor-buy"],
    "title-lot": { ita: ["Pulizia lotto 1 (prova sintetica)", "Pulizia lotto 2 (prova sintetica)"] },
    "identifier-lot": ["LOT-0001", "LOT-0002"],
    "main-classification-lot": ["90910000", "90910000"],
    "estimated-value-lot": ["1000000.00", "1000000.00"],
    "estimated-value-cur-lot": ["EUR", "EUR"],
    "deadline-receipt-tender-date-lot": [`${giorni[0]}+01:00`, `${giorni[1]}+01:00`],
    "deadline-receipt-tender-time-lot": ["10:00:00+01:00", "10:00:00+01:00"],
    "document-url-lot": ["https://esempio.invalid/documenti/700001", "https://esempio.invalid/documenti/700001"],
    ...p,
  });
const lottoDi = (mem: ReturnType<typeof databaseInMemoria>, procedura: string, numero: string) => mem.tabelle.radar_lotti.find((l) => l.procedura_id === procedura && l.numero_lotto === numero);

async function provaLottoTed(): Promise<void> {
  const d10 = "2026-12-10T09:00:00.000Z", d15 = "2026-12-15T09:00:00.000Z";
  // DIFETTO: proroga del solo lotto 2 (la gara, «la più vicina», non cambia). Prima: nessuna riga di scadenza, solo la riga «avviso»
  {
    const mem = memoriaDueLotti(d10, d10);
    await applicaPaginaBandi(mem.client, [bandoTed(avvisoDueLotti("700410-2026", ["2026-12-10", "2026-12-20"]))], "incrementale", ADESSO, misure(), { evidenza: true });
    const r = righeRegistro(mem);
    controlla("difetto lotto (TED): la proroga del SOLO lotto 2 è una riga del registro con il lotto, notificabile per email", JSON.stringify(r) === JSON.stringify(["proroga:scadenza_offerte@LOT-0002:true"]), r);
    const riga = mem.tabelle.radar_aggiornamenti.find((a) => a.campo === "scadenza_offerte@LOT-0002");
    controlla("difetto lotto (TED): prima e dopo del lotto, avviso ufficiale", !!riga && String(riga.valore_precedente).startsWith("2026-12-10") && String(riga.valore_nuovo).startsWith("2026-12-20") && riga.affidabilita === "avviso_ufficiale" && riga.avviso_ted === "700410-2026", riga);
    controlla("difetto lotto (TED): l'archivio mostra la nuova scadenza del lotto 2", lottoDi(mem, "A", "LOT-0002")?.scadenza_giorno === "2026-12-20" && lottoDi(mem, "A", "LOT-0001")?.scadenza_giorno === "2026-12-10");
  }
  // la stessa versione riletta (stesso numero TED, impronta diversa): non è una modifica, nessuna riga di lotto
  {
    const mem = memoriaDueLotti(d10, d10);
    await applicaPaginaBandi(mem.client, [bandoTed(avvisoDueLotti("700001-2026", ["2026-12-10", "2026-12-20"], { "change-reason-code": [], "notice-version": 1 }))], "incrementale", ADESSO, misure(), { evidenza: true });
    controlla("lotti (TED): la stessa versione riletta non dà righe di lotto", !mem.tabelle.radar_aggiornamenti.some((a) => String(a.campo).includes("@")), mem.tabelle.radar_aggiornamenti);
  }
  // tutti i lotti cambiano come la gara: basta la riga della gara
  {
    const mem = memoriaDueLotti(d10, d10);
    await applicaPaginaBandi(mem.client, [bandoTed(avvisoDueLotti("700411-2026", ["2026-12-20", "2026-12-20"]))], "incrementale", ADESSO, misure(), { evidenza: true });
    const r = righeRegistro(mem);
    controlla("lotti (TED): tutti i lotti prorogati come la gara → solo la riga della gara", JSON.stringify(r) === JSON.stringify(["proroga:scadenza_offerte:true"]), r);
  }
  // il lotto più vicino prorogato OLTRE l'altro: la gara passa alla scadenza dell'altro lotto; la riga del lotto dice la proroga vera
  {
    const mem = memoriaDueLotti(d10, d15);
    await applicaPaginaBandi(mem.client, [bandoTed(avvisoDueLotti("700412-2026", ["2026-12-20", "2026-12-15"]))], "incrementale", ADESSO, misure(), { evidenza: true });
    const r = righeRegistro(mem);
    controlla("lotti (TED): lotto 1 prorogato oltre il lotto 2 → riga della gara (dal 10 al 15) e riga del lotto 1 (dal 10 al 20)", JSON.stringify(r) === JSON.stringify(["proroga:scadenza_offerte:true", "proroga:scadenza_offerte@LOT-0001:true"]), r);
  }
  // un lotto che esce dall'avviso non è una proroga
  {
    const mem = memoriaDueLotti(d10, d10);
    const uno = avvisoTed("700413-2026", { "change-reason-code": ["cor-buy"], "identifier-lot": ["LOT-0001"], "deadline-receipt-tender-date-lot": ["2026-12-10+01:00"] });
    await applicaPaginaBandi(mem.client, [bandoTed(uno)], "incrementale", ADESSO, misure(), { evidenza: true });
    controlla("lotti (TED): un lotto che esce dall'avviso non dà righe di lotto", !mem.tabelle.radar_aggiornamenti.some((a) => String(a.campo).includes("@")), mem.tabelle.radar_aggiornamenti);
  }
  // senza l'evidenza: registro come prima e nessuna lettura in più; con l'evidenza UNA lettura in più (i lotti in archivio)
  {
    const mem = memoriaDueLotti(d10, d10);
    const m0 = misure();
    await applicaPaginaBandi(mem.client, [bandoTed(avvisoDueLotti("700414-2026", ["2026-12-10", "2026-12-20"]))], "incrementale", ADESSO, m0);
    controlla("lotti (TED) senza evidenza: nessuna riga di lotto, archivio aggiornato come prima", mem.tabelle.radar_aggiornamenti.length === 0 && lottoDi(mem, "A", "LOT-0002")?.scadenza_giorno === "2026-12-20", mem.tabelle.radar_aggiornamenti);
    const mem1 = memoriaDueLotti(d10, d10);
    const m1 = misure();
    await applicaPaginaBandi(mem1.client, [bandoTed(avvisoDueLotti("700414-2026", ["2026-12-10", "2026-12-20"]))], "incrementale", ADESSO, m1, { evidenza: true });
    // con l'evidenza: UNA lettura in più (i lotti in archivio, a blocchi) e la scrittura del registro, che senza evidenza non c'è perché
    // non c'è nessuna riga da scrivere
    controlla("lotti (TED): con l'evidenza una sola lettura in più (lotti in archivio) più la scrittura della riga del lotto", m1.richiesteDb === m0.richiesteDb + 2, { senza: m0.richiesteDb, con: m1.richiesteDb });
  }
}

// PVL: la proroga di UN lotto nella rettifica reale del campione (3 lotti con CIG). Prima: la riga del rilevamento c'era, ma senza email
async function provaLottoPvl(): Promise<void> {
  const campione = JSON.parse(fs.readFileSync(path.join(RADICE, "scripts/dati/radar-pvl-campione.json"), "utf8")) as { avvisi: Avviso[] };
  const reale = campione.avvisi.find((a) => typeof a.idAvviso === "string" && a.idAvviso.startsWith("f906425a")) as Avviso;
  const lotti = (a: Avviso) => ((((a.templates as Record<string, unknown>[])[0].template ?? {}) as { sections: { name: string; items?: Record<string, unknown>[] }[] }).sections.find((s) => s.name.startsWith("SEZ. C"))?.items ?? []);
  if (!reale || lotti(reale).length !== 3) {
    controlla("PVL lotto: (preparazione) la rettifica reale con 3 lotti è nel campione", false);
    return;
  }
  // versione precedente SINTETICA: identica, salvo il lotto BD920D7140 che scadeva il 04/12 (la rettifica lo porta al 14/12)
  const precedente = JSON.parse(JSON.stringify(reale).split("781699-2026").join("781698-2026")) as Avviso;
  precedente.idAvviso = "00000000-0000-4000-8000-000000000002";
  precedente.dataPubblicazione = "2026-11-02T07:00:00.000+00:00";
  precedente.tipo = "avviso";
  precedente.nuovoAvviso = reale.idAvviso;
  precedente.tipoNuovoAvviso = "rettifica";
  precedente.attivo = false;
  for (const l of lotti(precedente)) if (l.cig === "BD920D7140") l.termine_ricezione = "2026-12-04+01:00";
  const bando = (a: Avviso) => {
    const l = leggiAvvisoPvl(a as never);
    if (l.tipo !== "bando") throw new Error("non è un bando");
    return l as BandoPvl;
  };
  const bPrec = bando(precedente);
  const bNuovo = bando(reale);
  const mem = databaseInMemoria({ radar_procedure: [], radar_lotti: [], radar_procedure_fonti: [], radar_aggiornamenti: [], omnia_ai_radar_gare_aggiunte: [] });
  await applicaPaginaBandiPvl(mem.client, [bPrec], "incrementale", new Date("2026-11-03T08:00:00Z"), misure(), statisticheVuote(), { evidenza: true, grezzi: new Map([[bPrec.meta.idAvviso, precedente]]) });
  await applicaPaginaBandiPvl(mem.client, [bNuovo], "incrementale", new Date("2026-11-05T08:00:00Z"), misure(), statisticheVuote(), { evidenza: true, grezzi: new Map([[bNuovo.meta.idAvviso, reale]]) });
  const diLotto = mem.tabelle.radar_aggiornamenti.filter((a) => String(a.campo).startsWith("scadenza_offerte@"));
  const r = diLotto.find((a) => a.campo === "scadenza_offerte@BD920D7140");
  controlla("difetto lotto (PVL): la proroga del SOLO lotto BD920D7140 dentro la rettifica dichiarata porta l'email (registrata anche dal motore di unione)", !!r && r.tipo === "proroga" && r.notifica_email === true && r.affidabilita === "avviso_ufficiale" && r.id_fonte === bNuovo.meta.idAvviso, diLotto);
  controlla("lotti (PVL): nessuna riga per i lotti che non cambiano", diLotto.length === 1, diLotto.map((a) => a.campo));
  controlla("lotti (PVL): nessuna riga del registro viola il vincolo della 0123", mem.tabelle.radar_aggiornamenti.every((a) => !a.notifica_email || (a.notificabile && ["rettifica", "proroga", "annullamento"].includes(String(a.tipo)) && ["avviso_ufficiale", "confronto_versioni"].includes(String(a.affidabilita)))));
}

// Sintel: righe SINTETICHE (stessa forma della verifica B2-0), un lotto per riga
function rigaSintel(p: Record<string, unknown>): RigaSintel {
  return {
    id_procedura: "900000002",
    id_lotto: "N/D",
    multilotto: "NO",
    cig: "PRV0000001",
    codice_cpv: "90910000-9",
    data_inizio_negoziazione: "2026-11-01T00:00:00.000",
    data_fine_negoziazione: "2026-12-15T00:00:00.000",
    modalita_scelta_contraente: "Procedura Aperta",
    ambito_merceologico: "Procedura per forniture/servizi",
    stato_procedura: "Pubblicata",
    stato_lotto: "N/D",
    accordo_quadro: "NO",
    valore_economico_procedura: "110000",
    cf_stazione_appaltante: "00000000001",
    stazione_appaltante: "COMUNE DI PROVASINTETICA",
    nome_procedura: "Servizio di pulizia degli uffici comunali (prova sintetica)",
    link_procedura: { url: "http://www.sintel.regione.lombardia.it/eprocdata/auctionDetail.xhtml?id=900000002" },
    ...p,
  };
}
const lottoSintel = (id: string, cig: string, fine: string, stato = "Pubblicata") =>
  rigaSintel({ multilotto: "SI", id_lotto: id, cig, base_asta_lotto: "50000", stato_lotto: stato, nome_lotto: `Lotto ${id} pulizia (prova sintetica)`, data_fine_negoziazione: `${fine}T00:00:00.000` });
function bandiSintel(righe: RigaSintel[], oggi: string): BandoRegionale[] {
  const letta = leggiProceduraSintel(String(righe[0].id_procedura), righe, oggi);
  if ((letta as { tipo: string }).tipo === "esclusione") throw new Error(`procedura Sintel sintetica esclusa: ${JSON.stringify(letta)}`);
  const b = bandoDaSintel(letta as BandoSintel, oggi);
  if (!b) throw new Error("procedura Sintel sintetica senza bando");
  return [b];
}
async function giornoSintel(mem: ReturnType<typeof databaseInMemoria>, righe: RigaSintel[], oggi: string): Promise<void> {
  await applicaPaginaBandiRegionali(mem.client, bandiSintel(righe, oggi), { fonte: "sintel", modo: "incrementale", adesso: new Date(`${oggi}T08:00:00Z`), misure: misure(), stat: statisticheRegionaliVuote(), nascoste: new Set(), proponi: false, evidenza: true });
}
const memoriaVuota = () => databaseInMemoria({ radar_procedure: [], radar_lotti: [], radar_procedure_fonti: [], radar_aggiornamenti: [], omnia_ai_radar_gare_aggiunte: [] });

async function provaSintel(): Promise<void> {
  // DIFETTO, dall'importatore: il lotto 11 si chiude (esce dall'elenco), il lotto 12 è prorogato dal 15/12 al 22/12. Prima: nessuna email
  {
    const mem = memoriaVuota();
    await giornoSintel(mem, [lottoSintel("11", "PRV0000011", "2026-12-15"), lottoSintel("12", "PRV0000012", "2026-12-15")], "2026-11-10");
    await giornoSintel(mem, [lottoSintel("11", "PRV0000011", "2026-12-15", "Chiusa"), lottoSintel("12", "PRV0000012", "2026-12-22")], "2026-11-11");
    const lotto = mem.tabelle.radar_aggiornamenti.find((a) => a.campo === "scadenza_offerte@PRV0000012");
    controlla("difetto Sintel: la proroga del lotto 12 è notificabile per email (confronto di versioni)", !!lotto && lotto.tipo === "proroga" && lotto.notifica_email === true && lotto.affidabilita === "confronto_versioni" && lotto.valore_precedente === "2026-12-15" && lotto.valore_nuovo === "2026-12-22", mem.tabelle.radar_aggiornamenti);
    const garaRiga = mem.tabelle.radar_aggiornamenti.find((a) => a.campo === "scadenza_offerte");
    controlla("Sintel: la scadenza della GARA che salta in avanti resta «parziale», senza email", !!garaRiga && garaRiga.notifica_email === false && garaRiga.affidabilita === "parziale", garaRiga);
    controlla("Sintel: nessuna riga per il lotto chiuso", !mem.tabelle.radar_aggiornamenti.some((a) => a.campo === "scadenza_offerte@PRV0000011"));
    const pid = String(mem.tabelle.radar_procedure[0]?.id);
    controlla("Sintel: in archivio il lotto chiuso resta com'era, il lotto 12 ha la nuova scadenza", lottoDi(mem, pid, "SINTEL-11")?.scadenza_giorno === "2026-12-15" && lottoDi(mem, pid, "SINTEL-12")?.scadenza_giorno === "2026-12-22", mem.tabelle.radar_lotti);
  }
  // falsa proroga: il lotto 11 si chiude e la minima salta dal 15/12 al 20/12, il lotto 12 non cambia → nessuna email
  {
    const mem = memoriaVuota();
    await giornoSintel(mem, [lottoSintel("11", "PRV0000011", "2026-12-15"), lottoSintel("12", "PRV0000012", "2026-12-20")], "2026-11-10");
    await giornoSintel(mem, [lottoSintel("11", "PRV0000011", "2026-12-15", "Chiusa"), lottoSintel("12", "PRV0000012", "2026-12-20")], "2026-11-11");
    const r = mem.tabelle.radar_aggiornamenti.filter((a) => a.tipo !== "nuova");
    controlla("Sintel: la falsa proroga (lotto chiuso) è registrata ma MAI email, e nessuna riga di lotto", r.some((a) => a.campo === "scadenza_offerte") && r.every((a) => a.notifica_email === false) && !r.some((a) => String(a.campo).includes("@")), r.map((a) => `${a.tipo}:${a.campo}:${a.notifica_email}`));
  }
  // monolotto: la proroga si notifica dalla riga del lotto (la gara resta «parziale»)
  {
    const mem = memoriaVuota();
    await giornoSintel(mem, [rigaSintel({})], "2026-11-10");
    await giornoSintel(mem, [rigaSintel({ data_fine_negoziazione: "2026-12-22T00:00:00.000" })], "2026-11-11");
    const r = righeRegistro(mem);
    controlla("difetto Sintel: monolotto prorogato → la riga del lotto porta l'email, quella della gara no", JSON.stringify(r) === JSON.stringify(["proroga:scadenza_offerte:false", "proroga:scadenza_offerte@PRV0000001:true"]), r);
  }
  // stessa lettura ripetuta lo stesso giorno: nessuna modifica
  {
    const mem = memoriaVuota();
    await giornoSintel(mem, [rigaSintel({})], "2026-11-10");
    await giornoSintel(mem, [rigaSintel({ data_fine_negoziazione: "2026-12-22T00:00:00.000" })], "2026-11-10");
    controlla("Sintel: due letture nello stesso giorno (stessa versione) → nessuna riga di lotto", !mem.tabelle.radar_aggiornamenti.some((a) => String(a.campo).includes("@")), righeRegistro(mem));
  }
  // senza l'evidenza: nessuna riga di lotto, registro come prima
  {
    const mem = memoriaVuota();
    const senza = (righe: RigaSintel[], oggi: string) =>
      applicaPaginaBandiRegionali(mem.client, bandiSintel(righe, oggi), { fonte: "sintel", modo: "incrementale", adesso: new Date(`${oggi}T08:00:00Z`), misure: misure(), stat: statisticheRegionaliVuote(), nascoste: new Set(), proponi: false });
    await senza([rigaSintel({})], "2026-11-10");
    await senza([rigaSintel({ data_fine_negoziazione: "2026-12-22T00:00:00.000" })], "2026-11-11");
    controlla("Sintel senza evidenza: nessuna riga di lotto, registro come prima", mem.tabelle.radar_aggiornamenti.some((a) => a.campo === "scadenza_offerte") && !mem.tabelle.radar_aggiornamenti.some((a) => String(a.campo).includes("@")) && mem.tabelle.radar_aggiornamenti.every((a) => !("notifica_email" in a)), righeRegistro(mem));
  }
  // regole pure (dopo l'importatore: col codice di prima si vedono prima i fallimenti veri)
  const l = (numero: string, giorno: string | null, iso: string | null = null): LottoUnito => ({ numero_lotto: numero, cig: null, oggetto: null, cpv_principale: null, cpv_tutti: [], valore_stimato: null, durata_mesi: null, scadenza_giorno: giorno, scadenza_offerte: iso, scadenza_ora_indicata: !!iso, scadenza_fonte: null, url_documenti: null });
  controlla("Sintel: «SINTEL-<id>» è un identificativo stabile, «LOT-0001» no", identificativoLottoStabile("SINTEL-12") && !identificativoLottoStabile("LOT-0001") && !identificativoLottoStabile("SINTEL-12x"));
  const u = unisciLotti([l("SINTEL-11", "2026-12-15"), l("SINTEL-12", "2026-12-15")], [l("SINTEL-12", "2026-12-22")], "sintel", true);
  controlla("difetto Sintel: un lotto chiuso esce dall'elenco → i lotti si abbinano per identificativo, l'altro si aggiorna", u.allineati && u.lotti.length === 2 && u.lotti.find((x) => x.numero_lotto === "SINTEL-11")?.scadenza_giorno === "2026-12-15" && u.lotti.find((x) => x.numero_lotto === "SINTEL-12")?.scadenza_giorno === "2026-12-22", u);
  const nuovoLotto = unisciLotti([l("SINTEL-11", "2026-12-15"), l("SINTEL-12", "2026-12-15")], [l("SINTEL-12", "2026-12-22"), l("SINTEL-13", "2026-12-22")], "sintel", true);
  controlla("Sintel: con un lotto NUOVO resta la regola di prima (stesso numero di lotti, altrimenti nulla si tocca)", nuovoLotto.allineati === false);
  controlla("lotti: un solo lotto (non Sintel) → basta la riga della gara", cambiamentiDeiLotti([l("LOT-0001", "2026-12-10")], [l("LOT-0001", "2026-12-20")], "ted", []).length === 0);
  controlla("lotti: Sintel con un solo lotto → la riga del lotto c'è", JSON.stringify(cambiamentiDeiLotti([l("LOT-0001", "2026-12-10")], [l("LOT-0001", "2026-12-20")], "sintel", []).map((c) => `${c.tipo}:${c.campo}`)) === JSON.stringify(["proroga:scadenza_offerte@LOT-0001"]));
  controlla("lotti: una scadenza che compare o un lotto che sparisce non sono proroghe", cambiamentiDeiLotti([l("A", null), l("B", "2026-12-10")], [l("A", "2026-12-20")], "sintel", []).length === 0);
  controlla("lotti: l'ora che sparisce nello stesso giorno non è una modifica; il CIG nel campo se c'è", cambiamentiDeiLotti([l("A", "2026-12-10", "2026-12-10T09:00:00Z"), l("B", "2026-12-10")], [l("A", "2026-12-10"), { ...l("B", "2026-12-12"), cig: "ABCDEFGHIJ" }], "ted", []).map((c) => c.campo).join() === "scadenza_offerte@ABCDEFGHIJ");
  const aff = (campo: string, prima: string, dopo: string) => affidabilitaDi("sintel", { dichiarazione: null }, { campo, prima, dopo });
  controlla("difetto Sintel: la scadenza di un LOTTO con il giorno cambiato è «confronto_versioni»", aff("scadenza_offerte@PRV0000012", "2026-12-15", "2026-12-22") === "confronto_versioni");
  controlla("Sintel: la scadenza della GARA (la minima dei lotti aperti), lo stesso giorno o un altro campo restano «parziale»", aff("scadenza_offerte", "2026-12-15", "2026-12-22") === "parziale" && aff("scadenza_offerte@PRV0000012", "2026-12-15", "2026-12-15") === "parziale" && aff("n_lotti", "2", "1") === "parziale");

}

// ═══════════ 5. testo dei file ═══════════
function provaTesto(): void {
  const leggi = (f: string) => fs.readFileSync(path.join(RADICE, f), "utf8");
  for (const f of ["src/lib/radar/importa-ted.ts", "src/lib/radar/importa-pvl.ts", "src/lib/radar/importa-regionali.ts"]) {
    const t = leggi(f);
    controlla(`${f}: l'evidenza dipende dall'interruttore registroConEvidenza`, /const evidenza = registroConEvidenza\(opzioni\.env \?\? process\.env\);/.test(t));
  }
  controlla("importa-evidenza.ts: nessuna rete né database", !/\bfetch\s*\(|\.from\(/.test(leggi("src/lib/radar/importa-evidenza.ts")));
  controlla("importa-evidenza.ts: righe con LF", !leggi("src/lib/radar/importa-evidenza.ts").includes("\r\n"));
}

(async () => {
  await provaTed();
  provaSardegna();
  await provaPvl();
  await provaLottoTed();
  await provaLottoPvl();
  await provaSintel();
  provaTesto();
})()
  .catch((e) => falliti.push(`eccezione: ${e instanceof Error ? `${e.message}\n${e.stack}` : String(e)}`))
  .finally(() => {
    console.log(`Verifica B4 connettori (correzioni ed evidenza): ${ok} ok, ${falliti.length} falliti`);
    for (const f of falliti) console.log(`  FALLITO: ${f}`);
    process.exit(falliti.length ? 1 : 0);
  });
