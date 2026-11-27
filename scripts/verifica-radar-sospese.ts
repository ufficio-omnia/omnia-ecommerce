// Verifica della correzione «Sospeso» (27/11/2026, B2; famiglia AF: SardegnaCAT, EmPULIA, SIAPS): una procedura che il feed dichiara SOSPESA
// (statoFunzionale «Sospeso» e/o prefisso «<strong>Procedura Sospesa - </strong>» in testa all'oggetto, caso siaps:4828165 del collaudo) diventa
// «sospesa» (stato che esiste già, 0109/0112: nessuna migrazione) e perde il prefisso nell'oggetto; quando la fonte non la dice più sospesa torna
// «aperta». TUTTO IL RESTO IDENTICO: record e impronta delle procedure non sospese, altre fonti (TED, PVL, Sintel) che non conoscono la
// sospensione, esiti e annullamenti, nessuna email (rettifiche AF mai verificate). Dati [SINTETICI] (enti, numeri e CIG di prova); nessuna rete
// (fetch vietato), database in memoria.
// Uso: npx tsx scripts/verifica-radar-sospese.ts → codice 0 se passa.
import type { SupabaseClient } from "@supabase/supabase-js";
import { ISTANZE_AFLINK, NAMESPACE_AFLINK, leggiElementoAflink, oggettoAflink, sospesaAflink, type BandoAflink, type ElementoAflink, type IstanzaAflink } from "../src/lib/radar/fonti/aflink-calcoli";
import { bandoDaAflink, rigaDaBandoRegionale } from "../src/lib/radar/importa-regionali-calcoli";
import { cambiamentiTraVersioni, cambioDiSospensione, ETICHETTA_STATO, type RigaProcedura, type StatoProcedura } from "../src/lib/radar/importa-calcoli";
import { FONTI_CON_SOSPENSIONE, provenienzaDa, unisciVersione, type FonteUnita, type ProvenienzaCampi, type VersioneFonte } from "../src/lib/radar/unione-calcoli";
import { leggiProceduraSintel } from "../src/lib/radar/fonti/sintel-calcoli";
import { FONTI_ESECUZIONI } from "../src/lib/radar/esecuzioni-calcoli";
import { eseguiImportazioneRegionale } from "../src/lib/radar/importa-regionali";
import { DbFinto, type Riga } from "./lib/db-finto-motore";

let ok = 0;
const falliti: string[] = [];
function controlla(nome: string, condizione: boolean, dettaglio?: unknown): void {
  if (condizione) ok++;
  else falliti.push(`${nome}${dettaglio === undefined ? "" : ` → ${JSON.stringify(dettaglio).slice(0, 900)}`}`);
}
let richiesteDiRete = 0;
globalThis.fetch = (async () => {
  richiesteDiRete++;
  throw new Error("rete vietata nella verifica");
}) as typeof fetch;

const STAGING = { NEXT_PUBLIC_SUPABASE_URL: "https://ryawdldqiumqsskrnyps.supabase.co", RADAR_REGISTRO_EVIDENZA: "attivo" };
const ADESSO = new Date("2026-11-27T10:00:00Z");
const OGGI = "2026-11-27";
const AF: readonly IstanzaAflink[] = ["sardegnacat", "empulia", "siaps"];
const OGGETTO = "Procedura aperta per il servizio di pulizia degli uffici comunali [SINTETICA]";
const PREFISSO = "<strong>Procedura Sospesa - </strong> ";

// ───── voci [SINTETICHE] con la forma dei feed salvati dal 16/11 al 27/11 ─────
const voce = (istanza: IstanzaAflink, id: number, oggetto: string, extra: Partial<ElementoAflink> = {}): ElementoAflink =>
  ({
    IdMsg: String(id),
    Oggetto: oggetto,
    Tipo: "Bando",
    TipoProcedura: istanza === "sardegnacat" ? "Aperta" : "",
    DenominazioneEnte: "Comune di Provasintetica",
    DtScadenzaBandoTecnical: "2026-12-15T12:00:00",
    DtPubblicazioneTecnical: "2026-11-20T09:00:00",
    ...(istanza === "sardegnacat" || istanza === "empulia" ? { dataUltimaModifica: "2026-11-25T10:00:00" } : {}),
    statoFunzionale: "PresOfferte",
    Contratto: "Servizi",
    CPV: "90911200-8 - Servizi di pulizia di edifici",
    a_base_asta: "100.000,00",
    CIG: "PRVSO00001",
    link:
      istanza === "sardegnacat"
        ? `https://sardegnacat.regione.sardegna.it/Application/CustomDoc/DettaglioProcedura.asp?ID=${id}`
        : istanza === "empulia"
          ? `http://www.empulia.it/tno-a/empulia/Empulia/SitePages/New_Dettaglio Bando di Gara.aspx?getdettaglio=yes&bando=${id}&tipobando=Bando`
          : `http://siaps.soresa.it/portale/index.php/bandi?getdettaglio=yes&bando=${id}&tipobando=Bando`,
    ...extra,
  }) as ElementoAflink;
const leggi = (istanza: IstanzaAflink, e: ElementoAflink, adesso = ADESSO) => leggiElementoAflink(istanza, e, adesso);
const senza = (r: Record<string, unknown>, ...k: string[]) => JSON.stringify(Object.fromEntries(Object.entries(r).filter(([x]) => !k.includes(x))));

// ═════ A. lettura del feed: sospesa riconosciuta, prefisso tolto, tutto il resto identico ═════
function provaLettura(): void {
  for (const istanza of AF) {
    const aperta = leggi(istanza, voce(istanza, 7000001, OGGETTO));
    const sosp = leggi(istanza, voce(istanza, 7000001, PREFISSO + OGGETTO, { statoFunzionale: "Sospeso" }));
    if (aperta.tipo !== "bando" || sosp.tipo !== "bando") {
      controlla(`${istanza}: le due voci entrano`, false, { aperta: aperta.tipo, sosp: sosp.tipo });
      continue;
    }
    controlla(`${istanza}: la voce NON sospesa non ha il campo «sospesa» (record e impronta come prima della correzione)`, !("sospesa" in aperta.record));
    controlla(`${istanza}: «Sospeso» + prefisso → record.sospesa, oggetto SENZA prefisso (uguale a quello della voce aperta)`, sosp.record.sospesa === true && sosp.record.oggetto === aperta.record.oggetto && !/sospes/i.test(sosp.record.oggetto), sosp.record.oggetto);
    controlla(`${istanza}: tutti gli altri campi del record identici (scadenza con ora, ente, CIG, lotti, importo, procedura, collegamento)`, senza(sosp.record as unknown as Record<string, unknown>, "impronta", "sospesa") === senza(aperta.record as unknown as Record<string, unknown>, "impronta", "sospesa"));
    controlla(`${istanza}: opportunità, settori, regioni, scadenza della fonte e mancanti identici`, JSON.stringify([sosp.opportunita, sosp.settori, sosp.regioni, sosp.scadenzaFonte, sosp.mancanti, sosp.lottiScadenze, sosp.rettificato, sosp.ripristinato]) === JSON.stringify([aperta.opportunita, aperta.settori, aperta.regioni, aperta.scadenzaFonte, aperta.mancanti, aperta.lottiScadenze, aperta.rettificato, aperta.ripristinato]));
    controlla(`${istanza}: l'impronta cambia (il giro dopo vede la sospensione)`, sosp.record.impronta !== aperta.record.impronta);
    const rigaA = rigaDaBandoRegionale(bandoDaAflink(aperta, OGGI)!, ADESSO);
    const rigaS = rigaDaBandoRegionale(bandoDaAflink(sosp, OGGI)!, ADESSO);
    controlla(`${istanza}: gara nuova → «sospesa» se sospesa, «aperta» altrimenti; il resto della riga identico`, rigaS.stato === "sospesa" && rigaA.stato === "aperta" && senza(rigaS as unknown as Record<string, unknown>, "stato") === senza(rigaA as unknown as Record<string, unknown>, "stato"), { s: rigaS.stato, a: rigaA.stato });
  }
  // i due segnali da soli
  const soloStato = leggi("siaps", voce("siaps", 7000002, OGGETTO, { statoFunzionale: "Sospeso" }));
  const soloPrefisso = leggi("empulia", voce("empulia", 7000003, PREFISSO + OGGETTO, { statoFunzionale: "" }));
  const senzaGrassetto = leggi("sardegnacat", voce("sardegnacat", 7000004, `Procedura Sospesa - ${OGGETTO}`, { statoFunzionale: "Sospeso" }));
  controlla("solo statoFunzionale «Sospeso» (nessun prefisso): sospesa", soloStato.tipo === "bando" && soloStato.record.sospesa === true && soloStato.record.oggetto === OGGETTO);
  controlla("solo il prefisso (statoFunzionale vuoto, come le voci SIAPS/EmPULIA senza stato): sospesa, prefisso tolto", soloPrefisso.tipo === "bando" && soloPrefisso.record.sospesa === true && soloPrefisso.record.oggetto === OGGETTO, soloPrefisso.tipo === "bando" ? soloPrefisso.record.oggetto : soloPrefisso);
  controlla("prefisso senza grassetto: sospesa, prefisso tolto", senzaGrassetto.tipo === "bando" && senzaGrassetto.record.sospesa === true && senzaGrassetto.record.oggetto === OGGETTO);
  // le parole dentro il testo non bastano; revoca prima della sospensione; gli altri prefissi come prima
  const nelTesto = leggi("sardegnacat", voce("sardegnacat", 7000005, "Riavvio della procedura sospesa per il servizio di pulizia degli uffici comunali [SINTETICA]"));
  controlla("«procedura sospesa» DENTRO il testo (non in testa): NON sospesa, oggetto intatto", nelTesto.tipo === "bando" && !("sospesa" in nelTesto.record) && nelTesto.record.oggetto === "Riavvio della procedura sospesa per il servizio di pulizia degli uffici comunali [SINTETICA]", nelTesto.tipo === "bando" ? nelTesto.record : nelTesto);
  const revocata = leggi("sardegnacat", voce("sardegnacat", 7000006, `<strong>Bando Revocato - </strong> ${OGGETTO}`, { statoFunzionale: "Sospeso" }));
  controlla("revoca + «Sospeso»: annullata, mai sospesa", revocata.tipo === "bando" && revocata.record.annullata === true && !("sospesa" in revocata.record) && rigaDaBandoRegionale(bandoDaAflink(revocata, OGGI)!, ADESSO).stato === "annullata");
  const rettificato = leggi("sardegnacat", voce("sardegnacat", 7000007, `<strong>Bando Rettificato - </strong> ${OGGETTO}`, { statoFunzionale: "InRettifica" }));
  controlla("«Bando Rettificato» (prefisso di prima): oggetto e segnale come prima, nessuna sospensione", rettificato.tipo === "bando" && rettificato.rettificato && rettificato.record.oggetto === OGGETTO && !("sospesa" in rettificato.record));
  const ripristinata = oggettoAflink(`<strong>Procedura Ripristinata - </strong> ${OGGETTO}`);
  controlla("«Procedura Ripristinata» come prima (segnale e prefisso tolto), non sospesa", ripristinata.ripristinato && !ripristinata.sospeso && ripristinata.testo === OGGETTO);
  controlla("oggettoAflink: il segnale «sospeso» solo in testa (con o senza grassetto, «Sospesa»/«Sospeso»)", oggettoAflink(PREFISSO + OGGETTO).sospeso && oggettoAflink(`  procedura sospeso: ${OGGETTO}`).sospeso && !oggettoAflink(`${OGGETTO} - procedura sospesa`).sospeso && !oggettoAflink(OGGETTO).sospeso);
  controlla("sospesaAflink: Sospeso/sospesa sì, PresOfferte/Pubblicato/InRettifica/vuoto no, Revocato mai", sospesaAflink("Sospeso", { sospeso: false, revocato: false }) && sospesaAflink(" sospesa ", { sospeso: false, revocato: false }) && !["PresOfferte", "Pubblicato", "InRettifica", "", null].some((s) => sospesaAflink(s, { sospeso: false, revocato: false })) && !sospesaAflink("Revocato", { sospeso: true, revocato: false }) && !sospesaAflink("Sospeso", { sospeso: true, revocato: true }));
  // la sospensione scaduta resta esclusa come prima (scadenza passata)
  const scaduta = leggi("siaps", voce("siaps", 7000008, PREFISSO + OGGETTO, { statoFunzionale: "Sospeso", DtScadenzaBandoTecnical: "2026-11-01T12:00:00" }));
  controlla("sospesa con scadenza passata: esclusa «scaduta» come ogni voce scaduta", scaduta.tipo === "esclusione" && scaduta.motivo === "scaduta");
  // Sintel: il suo stato «Sospesa» resta com'era (gara in corso, nessun campo nuovo)
  const sintel = leggiProceduraSintel("900000001", [{ id_procedura: "900000001", stato_procedura: "Sospesa", nome_procedura: "Servizio di pulizia degli uffici [SINTETICO]", codice_cpv: "90911200-8", ambito_merceologico: "Servizi", modalita_scelta_contraente: "Procedura aperta", data_fine_negoziazione: "2026-12-20T00:00:00.000", denominazione_ente: "Comune di Provasintetica", codice_fiscale_ente: "00000000009" } as never], OGGI);
  controlla("Sintel «Sospesa»: come prima (meta «sospesa», nessun record.sospesa: la gara resta aperta)", sintel.tipo !== "bando" || !("sospesa" in sintel.record), sintel.tipo);
  controlla("FONTI_CON_SOSPENSIONE = SOLO sardegnacat, empulia, siaps", JSON.stringify([...FONTI_CON_SOSPENSIONE].sort()) === JSON.stringify(["empulia", "sardegnacat", "siaps"]));
  controlla("etichetta per il cliente: «Sospesa» (già esistente)", ETICHETTA_STATO.sospesa === "Sospesa");
}

// ═════ B. unione con la gara in archivio ═════
const vers = (fonte: FonteUnita, giorno: string, n = "1"): VersioneFonte => ({ fonte, id: `${fonte}-SINT-${n}@${giorno}`, giorno, istante: `${giorno}T10:00:00.000Z`, ted: null });
function rigaDi(istanza: IstanzaAflink, sospesa: boolean): RigaProcedura {
  const b = leggi(istanza, voce(istanza, 7100001, sospesa ? PREFISSO + OGGETTO : OGGETTO, { statoFunzionale: sospesa ? "Sospeso" : "PresOfferte" })) as BandoAflink;
  return rigaDaBandoRegionale(bandoDaAflink(b, OGGI)!, ADESSO);
}
function archiviata(stato: StatoProcedura, fonte: FonteUnita, giorno: string): { riga: RigaProcedura; prov: ProvenienzaCampi } {
  const v = vers(fonte, giorno, "0");
  const pv = provenienzaDa(v);
  const prov: ProvenienzaCampi = { _versione: pv, scadenza: pv, oggetto: pv, ente: pv, url_documenti: pv };
  return { riga: { ...rigaDi("sardegnacat", false), stato, rettificata: false, provenienza_campi: prov } as RigaProcedura, prov };
}
function provaUnione(): void {
  const iso = ADESSO.toISOString();
  const caso = (stato: StatoProcedura, fontePrima: FonteUnita, nuovaSospesa: boolean, fonteNuova: FonteUnita, giornoNuova: string) => {
    const a = archiviata(stato, fontePrima, "2026-11-20");
    return unisciVersione(a.riga, a.prov, rigaDi("sardegnacat", nuovaSospesa), vers(fonteNuova, giornoNuova), iso);
  };
  const s1 = caso("aperta", "sardegnacat", true, "sardegnacat", "2026-11-25");
  controlla("aperta + versione AF più recente sospesa → «sospesa», UNA rettifica dello stato aperta→sospesa, NON «rettificata»", s1.riga.stato === "sospesa" && JSON.stringify(s1.cambiamenti.map((c) => [c.tipo, c.campo, c.prima, c.dopo])) === JSON.stringify([["rettifica", "stato", "aperta", "sospesa"]]) && s1.riga.rettificata === false, { stato: s1.riga.stato, c: s1.cambiamenti, r: s1.riga.rettificata });
  const s2 = caso("aperta", "sardegnacat", true, "sardegnacat", "2026-11-20");
  controlla("stessa versione (lettura ripetuta dello stesso giorno, SIAPS/EmPULIA senza data di modifica): la sospensione vale", s2.riga.stato === "sospesa");
  const s3 = caso("aperta", "sardegnacat", true, "sardegnacat", "2026-11-18");
  controlla("versione PIÙ VECCHIA dell'ultima applicata: niente cambia (come l'annullamento)", s3.riga.stato === "aperta" && s3.cambiamenti.length === 0);
  for (const f of ["empulia", "siaps"] as const) {
    const s = caso("aperta", f, true, f, "2026-11-25");
    controlla(`${f}: aperta → sospesa`, s.riga.stato === "sospesa");
  }
  const r1 = caso("sospesa", "sardegnacat", false, "sardegnacat", "2026-11-25");
  controlla("sospesa + versione AF più recente NON sospesa → «aperta» (ripresa), rettifica sospesa→aperta, NON «rettificata»", r1.riga.stato === "aperta" && JSON.stringify(r1.cambiamenti.map((c) => [c.tipo, c.campo, c.prima, c.dopo])) === JSON.stringify([["rettifica", "stato", "sospesa", "aperta"]]) && r1.riga.rettificata === false, r1.cambiamenti);
  for (const f of ["ted", "pvl", "sintel", "sater", "tuttogare", "start"] as const) {
    const r = caso("sospesa", "sardegnacat", false, f, "2026-11-26");
    controlla(`sospesa + versione ${f} (non conosce la sospensione): RESTA sospesa`, r.riga.stato === "sospesa" && !r.cambiamenti.some((c) => c.campo === "stato"), r.riga.stato);
    const s = caso("aperta", "ted", true, f, "2026-11-26");
    controlla(`versione ${f} con stato «sospesa» (mai prodotta oggi): non sospende`, s.riga.stato === "aperta", s.riga.stato);
  }
  for (const st of ["aggiudicata", "chiusa_senza_aggiudicazione", "annullata", "sconosciuto"] as const) {
    const r = caso(st, "sardegnacat", true, "sardegnacat", "2026-11-25");
    controlla(`gara «${st}» + versione sospesa: resta «${st}»`, r.riga.stato === st, r.riga.stato);
  }
  // gara con più fonti (TED + PVL + SardegnaCAT): la piattaforma sospende e riprende; TED dopo non la riapre
  const multi = archiviata("aperta", "ted", "2026-11-20");
  multi.prov.oggetto = provenienzaDa(vers("pvl", "2026-11-21"));
  const m1 = unisciVersione(multi.riga, multi.prov, rigaDi("sardegnacat", true), vers("sardegnacat", "2026-11-25"), iso);
  const m2 = unisciVersione(m1.riga, m1.provenienza, rigaDi("sardegnacat", false), vers("ted", "2026-11-26"), iso);
  const m3 = unisciVersione(m2.riga, m2.provenienza, rigaDi("sardegnacat", false), vers("sardegnacat", "2026-11-27"), iso);
  controlla("gara TED+PVL+SardegnaCAT: SardegnaCAT sospende, TED dopo NON riapre, SardegnaCAT riapre", m1.riga.stato === "sospesa" && m2.riga.stato === "sospesa" && m3.riga.stato === "aperta", [m1.riga.stato, m2.riga.stato, m3.riga.stato]);
  // cambiamenti: regole di prima invariate
  const base = rigaDi("sardegnacat", false);
  const cc = (p: StatoProcedura, d: StatoProcedura) => cambiamentiTraVersioni({ ...base, stato: p }, { ...base, stato: d }).map((c) => `${c.tipo}:${c.campo}:${c.prima}>${c.dopo}`);
  controlla("cambiamenti: aperta→sospesa e sospesa→aperta = rettifica dello stato; aperta→annullata e annullata→aperta come prima; aperta→aperta niente", JSON.stringify([cc("aperta", "sospesa"), cc("sospesa", "aperta"), cc("aperta", "annullata"), cc("annullata", "aperta"), cc("aperta", "aperta"), cc("sospesa", "annullata")]) === JSON.stringify([["rettifica:stato:aperta>sospesa"], ["rettifica:stato:sospesa>aperta"], ["annullamento:stato:aperta>annullata"], ["rettifica:stato:annullata>aperta"], [], ["annullamento:stato:sospesa>annullata"]]), [cc("aperta", "sospesa"), cc("sospesa", "aperta"), cc("sospesa", "annullata")]);
  controlla("cambioDiSospensione: solo i cambi di stato che toccano «sospesa»", cambioDiSospensione({ campo: "stato", prima: "aperta", dopo: "sospesa" }) && cambioDiSospensione({ campo: "stato", prima: "sospesa", dopo: "aperta" }) && !cambioDiSospensione({ campo: "stato", prima: "annullata", dopo: "aperta" }) && !cambioDiSospensione({ campo: "oggetto", prima: "sospesa", dopo: "x" }));
}

// ═════ C. giri col database in memoria ═════
type Risposta = { stato?: number; testo: string };
const xml = (voci: readonly ElementoAflink[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:afs="${NAMESPACE_AFLINK}"><channel><title>Feed di prova [SINTETICO]</title>${voci
    .map((v) => `<item>${Object.entries(v).filter(([k]) => k !== "link").map(([k, x]) => `<afs:${k}><![CDATA[${x}]]></afs:${k}>`).join("")}${v.link ? `<link><![CDATA[${v.link}]]></link>` : ""}</item>`)
    .join("")}</channel></rss>`;
function reteFinta(risposte: Record<string, Risposta>): typeof fetch {
  return (async (url: string | URL | Request) => {
    const u = String(url);
    const r = risposte[u] ?? { stato: 404, testo: "non trovata" };
    return { status: r.stato ?? 200, url: u, redirected: false, headers: new Headers({ "content-type": "text/xml" }), text: async () => r.testo } as unknown as Response;
  }) as typeof fetch;
}
function mondo(fonte: IstanzaAflink, nascosta: boolean): DbFinto {
  const db = new DbFinto();
  const altre = FONTI_ESECUZIONI.filter((f) => f !== fonte).map((f) => ({ fonte: f, attiva: false, ultimo_successo_il: null, cursore: null, blocco_fino_a: null, conteggi: {}, nascosta_ai_clienti: false, dati_aggiornati_al: null }));
  db.tabelle.radar_fonti_stato = [...altre, { fonte, attiva: true, ultimo_successo_il: null, cursore: null, blocco_fino_a: null, conteggi: {}, nascosta_ai_clienti: nascosta, dati_aggiornati_al: null }];
  db.dopoScrittura = (tabella) => {
    if (tabella !== "radar_procedure_fonti" && tabella !== "radar_procedure") return;
    for (const p of db.t("radar_procedure")) {
      const da = db.t("radar_procedure_fonti").filter((f) => f.procedura_id === p.id).map((f) => String(f.fonte));
      const prima = Array.isArray(p.fonti) ? (p.fonti as string[]) : [];
      const tutte = [...new Set([...prima, ...da])];
      if (tutte.length !== prima.length) p.fonti = tutte;
    }
  };
  return db;
}
async function giro(db: DbFinto, fonte: IstanzaAflink, voci: readonly ElementoAflink[], adesso: Date) {
  db.orologio = () => adesso;
  return eseguiImportazioneRegionale(db as unknown as SupabaseClient, fonte, { env: STAGING, adesso: () => adesso, fetchFn: reteFinta({ [ISTANZE_AFLINK[fonte].urlFeed as string]: { testo: xml(voci) } }), origine: "script", limiti: { pausaMs: 0, tentativi: 1 } });
}
const statoDi = (db: DbFinto, chiave: string) => db.t("radar_procedure").find((x) => x.chiave === chiave);
const righeStato = (db: DbFinto, id: unknown) => db.t("radar_aggiornamenti").filter((x) => x.procedura_id === id && x.campo === "stato");
const nessunaEmail = (db: DbFinto) => db.t("omnia_ai_radar_eventi").length === 0 && db.t("omnia_ai_radar_email_consegne").length === 0 && !db.t("radar_aggiornamenti").some((x) => x.notifica_email === true);

async function provaGiri(): Promise<void> {
  const primaRete = richiesteDiRete;
  // SardegnaCAT VISIBILE (come online): una gara si sospende e riprende, l'altra resta com'è
  const db = mondo("sardegnacat", false);
  const v1 = (id: number, oggetto: string, extra: Partial<ElementoAflink>) => voce("sardegnacat", id, oggetto, { CIG: `PRVSO${String(id).slice(-5)}`, ...extra });
  const g1 = await giro(db, "sardegnacat", [v1(7200001, OGGETTO, { dataUltimaModifica: "2026-11-24T10:00:00" }), v1(7200002, "Procedura aperta per il servizio di vigilanza armata [SINTETICA]", { CPV: "79713000-5 - Servizi di guardia", dataUltimaModifica: "2026-11-24T10:00:00" })], new Date("2026-11-25T08:00:00Z"));
  const a = statoDi(db, "sardegnacat:7200001");
  const b0 = JSON.stringify(statoDi(db, "sardegnacat:7200002"));
  controlla("SardegnaCAT giro 1: due gare aperte", g1.eseguita && !g1.errore && a?.stato === "aperta" && JSON.parse(b0)?.stato === "aperta", g1.eseguita ? { errore: g1.errore, esclusi: g1.statistiche.esclusi } : g1);
  const g2 = await giro(db, "sardegnacat", [v1(7200001, PREFISSO + OGGETTO, { statoFunzionale: "Sospeso", dataUltimaModifica: "2026-11-26T09:00:00" }), v1(7200002, "Procedura aperta per il servizio di vigilanza armata [SINTETICA]", { CPV: "79713000-5 - Servizi di guardia", dataUltimaModifica: "2026-11-24T10:00:00" })], new Date("2026-11-26T08:00:00Z"));
  const a2 = statoDi(db, "sardegnacat:7200001");
  const rs2 = righeStato(db, a2?.id);
  controlla("SardegnaCAT giro 2 («Sospeso» + prefisso): gara «sospesa», oggetto SENZA prefisso, non «rettificata»", g2.eseguita && !g2.errore && a2?.stato === "sospesa" && a2?.oggetto === OGGETTO && a2?.rettificata === false, { stato: a2?.stato, oggetto: a2?.oggetto, rettificata: a2?.rettificata });
  controlla("SardegnaCAT giro 2: UNA riga di registro (rettifica stato aperta→sospesa), visibile nella cronologia (notificabile), MAI email (affidabilità «parziale»)", rs2.length === 1 && rs2[0].tipo === "rettifica" && rs2[0].valore_precedente === "aperta" && rs2[0].valore_nuovo === "sospesa" && rs2[0].notificabile === true && rs2[0].notifica_email === false && rs2[0].affidabilita === "parziale" && db.t("radar_aggiornamenti").filter((x) => x.procedura_id === a2?.id && x.tipo !== "nuova").length === 1, db.t("radar_aggiornamenti").filter((x) => x.procedura_id === a2?.id));
  controlla("SardegnaCAT giro 2: l'altra gara IDENTICA (nessuna riga, nessun campo cambiato)", JSON.stringify(statoDi(db, "sardegnacat:7200002")) === b0 && g2.eseguita && g2.statistiche.invariati >= 1);
  const g3 = await giro(db, "sardegnacat", [v1(7200001, OGGETTO, { statoFunzionale: "PresOfferte", dataUltimaModifica: "2026-11-27T09:00:00" }), v1(7200002, "Procedura aperta per il servizio di vigilanza armata [SINTETICA]", { CPV: "79713000-5 - Servizi di guardia", dataUltimaModifica: "2026-11-24T10:00:00" })], new Date("2026-11-27T08:00:00Z"));
  const a3 = statoDi(db, "sardegnacat:7200001");
  const rs3 = righeStato(db, a3?.id);
  controlla("SardegnaCAT giro 3 (ripresa): di nuovo «aperta», seconda riga sospesa→aperta, nessuna email", g3.eseguita && !g3.errore && a3?.stato === "aperta" && rs3.length === 2 && rs3[1].valore_precedente === "sospesa" && rs3[1].valore_nuovo === "aperta" && nessunaEmail(db), { stato: a3?.stato, righe: rs3.map((r) => [r.valore_precedente, r.valore_nuovo]) });

  // SIAPS NASCOSTA, il caso dello staging: siaps:4828165 scritta «aperta» col prefisso nell'oggetto (codice di prima), poi il giro corretto
  const s = mondo("siaps", true);
  const vs = (oggetto: string, stato: string) => voce("siaps", 4828165, oggetto, { statoFunzionale: stato, CIG: "", CPV: "55320000-9 - Servizi di distribuzione pasti" });
  await giro(s, "siaps", [vs(OGGETTO.replace("pulizia degli uffici comunali", "ristorazione degenti"), "PresOfferte")], new Date("2026-11-27T14:48:00Z"));
  const g = statoDi(s, "siaps:4828165");
  if (g) g.oggetto = `Procedura Sospesa - ${String(g.oggetto)}`; // com'era nel database dopo il collaudo col codice di prima
  const gs = await giro(s, "siaps", [vs(PREFISSO + OGGETTO.replace("pulizia degli uffici comunali", "ristorazione degenti"), "Sospeso")], new Date("2026-11-28T10:00:00Z"));
  const g2s = statoDi(s, "siaps:4828165");
  const righe = s.t("radar_aggiornamenti").filter((x) => x.procedura_id === g2s?.id && x.tipo !== "nuova");
  controlla("SIAPS (nascosta) il giorno dopo: «sospesa», prefisso tolto dall'oggetto già in archivio, righe stato+oggetto NON notificabili, nessuna email", gs.eseguita && !gs.errore && g2s?.stato === "sospesa" && g2s?.oggetto === OGGETTO.replace("pulizia degli uffici comunali", "ristorazione degenti") && righe.some((x) => x.campo === "stato" && x.valore_nuovo === "sospesa") && righe.every((x) => x.notificabile === false) && nessunaEmail(s), { stato: g2s?.stato, oggetto: g2s?.oggetto, righe: righe.map((x) => [x.tipo, x.campo, x.notificabile]) });
  controlla("nessuna richiesta alla rete vera nei giri", richiesteDiRete === primaRete);
}

async function principale(): Promise<void> {
  provaLettura();
  provaUnione();
  await provaGiri();
}
principale()
  .catch((e) => falliti.push(`eccezione: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`))
  .finally(() => {
    console.log(`Verifica della correzione «Sospeso» (famiglia AF): ${ok} ok, ${falliti.length} falliti`);
    for (const f of falliti) console.log(`  FALLITO: ${f}`);
    process.exit(falliti.length ? 1 : 0);
  });
