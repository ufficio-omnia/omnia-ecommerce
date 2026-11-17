// Prova d'integrazione della fase B1-bis SOLO sullo STAGING, con DATI SINTETICI dichiarati (oggetto «DATI SINTETICI», CIG e numeri TED
// inventati) che alla fine si cancellano. Percorre sul database vero il caso che il dato reale non mostra sempre:
//   1) bando sopra soglia arrivato PRIMA dalla PVL (gara «pvl:…», con il numero TED citato), in sincronizzazione → una sola «nuova»;
//   2) lo stesso bando da TED → stessa gara (nessuna gara nuova, nessuna «nuova» in più), CIG della PVL conservati;
//   3) rettifica TED (proroga) → un solo cambiamento, notificabile;
//   4) la stessa rettifica dalla PVL → nessun cambiamento in più;
//   5) esito dalla PVL → aggiudicata; lo stesso esito da TED → nessun doppione;
//   6) rilettura di tutto → nessuna scrittura (impronte).
// Uso: RADAR_STAGING_REF=<staging> npx tsx scripts/prova-radar-pvl-staging.ts (variabili dello staging nell'ambiente).
import { createClient } from "@supabase/supabase-js";
import { PROGETTO_PRODUZIONE, ambienteDb } from "../src/lib/radar/ambiente";
import { leggiAvvisoPvl, type BandoPvl, type EsitoPvl } from "../src/lib/radar/fonti/pvl-calcoli";
import { leggiBandoTed, leggiEsitoTed } from "../src/lib/radar/fonti/ted-calcoli";
import { applicaPaginaBandi, applicaPaginaEsiti, type Misure } from "../src/lib/radar/importa";
import { applicaEsitiPvl, applicaPaginaBandiPvl } from "../src/lib/radar/importa-pvl-pagina";
import { statistichePvlVuote } from "../src/lib/radar/importa-pvl-calcoli";
import { scollegaGara } from "../src/lib/radar/collegamenti";
import { leggiGaraPubblica } from "../src/lib/radar/gara";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const chiave = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const staging = process.env.RADAR_STAGING_REF ?? "";
if (!url || !chiave || url.includes(PROGETTO_PRODUZIONE) || !staging || !url.includes(`${staging}.supabase.co`) || ambienteDb(url) !== "staging") {
  console.error("STOP: questa prova gira solo contro lo staging.");
  process.exit(2);
}
const db = createClient(url, chiave, { auth: { persistSession: false, autoRefreshToken: false } });

const APPALTO = "00000000-0000-4000-8000-00000000b1b1";
const AVVISO_1 = "00000000-0000-4000-8000-00000000a001";
const AVVISO_2 = "00000000-0000-4000-8000-00000000a002";
const ESITO_PVL = "00000000-0000-4000-8000-00000000e001";
const TED_1 = "999901-2026";
const TED_2 = "999902-2026";
const TED_ESITO = "999903-2026";
const PROC_TED = "sintetica-b1bis-procedura-1";
const CIG = ["Z00000000A", "Z00000000B"];

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok || !dettaglio ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}

function avvisoPvl(idAvviso: string, numeroTed: string, giornoPub: string, scadenza: string): Record<string, unknown> {
  return {
    idAvviso,
    idAppalto: APPALTO,
    codiceScheda: "P1_16",
    tipologia: "BANDI",
    dataPubblicazione: `${giornoPub}T07:00:00.000+00:00`,
    dataScadenza: `${scadenza}T11:00:00.000+00:00`,
    attivo: true,
    oscurato: false,
    templates: [
      {
        template: {
          metadata: { link_eform_ted: `https://ted.europa.eu/udl?uri=TED:NOTICE:${numeroTed}:TEXT:IT:HTML`, titolo: "(DATI SINTETICI) Servizio di pulizia degli uffici comunali di prova" },
          sections: [
            { name: "SEZ. A - Committente", fields: { soggetti_sa: [{ codice_fiscale: "00000000000", denominazione_amministrazione: "COMUNE DI PROVA (DATI SINTETICI)" }] } },
            { name: "SEZ. B - Dati Generali", fields: { documenti_di_gara_link: "https://piattaforma.esempio.it/gara/sintetica", tipo_procedura_aggiudicazione: "Aperta" } },
            {
              name: "SEZ. C - Oggetto",
              items: CIG.map((cig) => ({ tipo_oggetto: "lotto", cig, natura_principale: "Servizi", descrizione: "(DATI SINTETICI) lotto", cpv: "Servizi di pulizia di uffici", valore_complessivo_stimato: 100000, luogo_nuts: "Venezia", luogo_istat: "VENEZIA", termine_ricezione: `${scadenza}+01:00`, criteri_aggiudicazione: "Qualità" })),
            },
          ],
        },
      },
    ],
  };
}

function avvisoTed(numero: string, giornoPub: string, scadenza: string, motivo: string | null): Record<string, unknown> {
  return {
    "publication-number": numero,
    "notice-version": 1,
    "notice-type": "cn-standard",
    "publication-date": `${giornoPub}+01:00`,
    "procedure-identifier": PROC_TED,
    "buyer-name": { ita: ["Comune di Prova (dati sintetici)"] },
    "organisation-identifier-buyer": ["00000000000"],
    "buyer-city": { mul: ["VENEZIA (VE)"] },
    "buyer-country-sub": ["ITH35"],
    "buyer-legal-type": ["la"],
    "title-proc": { ita: "(DATI SINTETICI) Servizio di pulizia degli uffici comunali (testo TED)" },
    "title-lot": { ita: ["Lotto 1 (sintetico)", "Lotto 2 (sintetico)"] },
    "identifier-lot": ["LOT-0001", "LOT-0002"],
    "main-classification-proc": ["90919200"],
    "main-classification-lot": ["90919200", "90919200"],
    "classification-cpv": ["90919200"],
    "estimated-value-proc": "200000.00",
    "estimated-value-cur-proc": "EUR",
    "estimated-value-lot": ["100000.00", "100000.00"],
    "estimated-value-cur-lot": ["EUR", "EUR"],
    "deadline-receipt-tender-date-lot": [`${scadenza}+01:00`, `${scadenza}+01:00`],
    "deadline-receipt-tender-time-lot": ["12:00:00+01:00", "12:00:00+01:00"],
    "procedure-type": "open",
    "contract-nature-main-proc": ["services"],
    "legal-basis": ["32014L0024"],
    "duration-period-value-lot": ["36", "36"],
    "duration-period-unit-lot": ["MONTH", "MONTH"],
    "place-of-performance-subdiv-proc": ["ITH35"],
    "award-criterion-type-lot": ["quality", "price"],
    ...(motivo ? { "change-reason-code": [motivo] } : {}),
  };
}

async function gara() {
  const { data: prov } = await db.from("radar_procedure_fonti").select("procedura_id").eq("fonte", "pvl").eq("id_procedura_fonte", APPALTO);
  const ids = [...new Set((prov ?? []).map((p) => p.procedura_id))];
  const { data: perTed } = await db.from("radar_procedure").select("id").eq("chiave", `ted:${PROC_TED}`);
  return { ids, idsTed: (perTed ?? []).map((r) => r.id) };
}

async function aggiornamenti(id: string) {
  const { data } = await db.from("radar_aggiornamenti").select("tipo, campo, fonte, notificabile").eq("procedura_id", id).order("rilevato_il");
  return data ?? [];
}

async function pulisci() {
  const { ids, idsTed } = await gara();
  const tutte = [...new Set([...ids, ...idsTed])];
  if (tutte.length) await db.from("radar_procedure").delete().in("id", tutte);
  await db.from("radar_procedure_fonti").delete().in("id_fonte", [AVVISO_1, AVVISO_2, ESITO_PVL, TED_1, TED_2, TED_ESITO]);
}

async function principale() {
  await pulisci();
  const misure: Misure = { richiesteDb: 0, msDb: 0 };
  const adesso = new Date("2026-11-16T12:00:00Z");
  const stat = statistichePvlVuote();

  // 1) PVL per prima
  await applicaPaginaBandiPvl(db, [leggiAvvisoPvl(avvisoPvl(AVVISO_1, TED_1, "2026-11-13", "2026-12-14")) as BandoPvl], "incrementale", adesso, misure, stat);
  let g = await gara();
  atteso("1) PVL per prima: una gara «pvl:», nessuna gara TED", g.ids.length === 1 && g.idsTed.length === 0, JSON.stringify(g));
  const id = g.ids[0];
  let agg = await aggiornamenti(id);
  atteso("1) una sola «nuova», notificabile (sincronizzazione, gara aperta)", agg.length === 1 && agg[0].tipo === "nuova" && agg[0].notificabile === true, JSON.stringify(agg));

  // 2) lo stesso bando da TED
  const t1 = await applicaPaginaBandi(db, [leggiBandoTed(avvisoTed(TED_1, "2026-11-17", "2026-12-14", null))], "incrementale", adesso, misure);
  g = await gara();
  atteso("2) TED dopo: nessuna gara nuova, unita alla gara PVL", t1.nuove === 0 && t1.unitePvl === 1 && g.idsTed.length === 0 && g.ids.length === 1, JSON.stringify({ t1, g }));
  agg = await aggiornamenti(id);
  atteso("2) nessun cambiamento in più (la stessa notizia da due fonti)", agg.length === 1, JSON.stringify(agg));
  const { data: lotti } = await db.from("radar_lotti").select("numero_lotto, cig, durata_mesi").eq("procedura_id", id).order("numero_lotto");
  atteso("2) lotti: CIG della PVL conservati, durata da TED", JSON.stringify((lotti ?? []).map((l) => [l.numero_lotto, l.cig, l.durata_mesi])) === JSON.stringify([["LOT-0001", CIG[0], 36], ["LOT-0002", CIG[1], 36]]), JSON.stringify(lotti));
  const { data: riga } = await db.from("radar_procedure").select("chiave, oggetto, durata_mesi, provenienza_campi, scadenza_offerte").eq("id", id).single();
  if (!riga) throw new Error("gara non trovata");
  atteso("2) oggetto della PVL, durata di TED, provenienza registrata per campo", riga.chiave === `pvl:${APPALTO}` && riga.oggetto.includes("uffici comunali di prova") && riga.durata_mesi === 36 && riga.provenienza_campi.durata_mesi?.f === "ted" && riga.provenienza_campi.oggetto?.f === "pvl", JSON.stringify(riga));

  // 3) rettifica TED con proroga
  const t2 = await applicaPaginaBandi(db, [leggiBandoTed(avvisoTed(TED_2, "2026-11-25", "2026-12-21", "cor-buy"))], "incrementale", adesso, misure);
  agg = await aggiornamenti(id);
  const proroghe = agg.filter((a) => a.tipo === "proroga");
  atteso("3) rettifica TED: una proroga, notificabile", t2.rettifiche === 1 && proroghe.length === 1 && proroghe[0].notificabile === true && proroghe[0].fonte === "ted", JSON.stringify({ t2, agg }));

  // 4) la stessa rettifica dalla PVL
  const stat2 = statistichePvlVuote();
  await applicaPaginaBandiPvl(db, [leggiAvvisoPvl(avvisoPvl(AVVISO_2, TED_2, "2026-11-24", "2026-12-21")) as BandoPvl], "incrementale", adesso, misure, stat2);
  agg = await aggiornamenti(id);
  atteso("4) la stessa rettifica dalla PVL: nessun cambiamento né notifica in più", agg.filter((a) => a.tipo === "proroga").length === 1 && agg.length === 2 && stat2.bandi.nuoveVersioni === 1, JSON.stringify({ agg, stat2: stat2.bandi }));
  const { data: dopoRett } = await db.from("radar_procedure").select("scadenza_giorno, rettificata").eq("id", id).single();
  atteso("4) scadenza prorogata, gara rettificata", dopoRett?.scadenza_giorno === "2026-12-21" && dopoRett?.rettificata === true, JSON.stringify(dopoRett));

  // 5) esito dalla PVL, poi da TED
  const esitoPvl = leggiAvvisoPvl({ idAvviso: ESITO_PVL, idAppalto: APPALTO, codiceScheda: "A1_29", dataPubblicazione: "2026-12-30T07:00:00.000+00:00", attivo: true, oscurato: false, templates: [{ template: { metadata: {}, sections: [{ name: "SEZ. C - Oggetto", items: [{ tipo_oggetto: "aggiudicazione", cig: CIG[0] }] }] } }] }) as EsitoPvl;
  const stat3 = statistichePvlVuote();
  await applicaEsitiPvl(db, [esitoPvl], "incrementale", adesso, misure, stat3);
  const e2 = await applicaPaginaEsiti(db, [leggiEsitoTed({ "publication-number": TED_ESITO, "notice-version": 1, "notice-type": "can-standard", "publication-date": "2027-01-05+01:00", "procedure-identifier": PROC_TED, "winner-selection-status": ["selec-w", "selec-w"] })!], "incrementale", adesso, misure);
  agg = await aggiornamenti(id);
  const { data: dopoEsito } = await db.from("radar_procedure").select("stato").eq("id", id).single();
  atteso("5) esito PVL: aggiudicata; esito TED dopo: trovato e senza doppioni", dopoEsito?.stato === "aggiudicata" && stat3.esiti.applicati === 1 && e2.senzaBando === 0 && agg.filter((a) => a.tipo === "esito").length === 1, JSON.stringify({ stato: dopoEsito?.stato, stat3: stat3.esiti, e2, agg }));

  // 6) rilettura di tutto: nessuna scrittura
  const prima = misure.richiesteDb;
  const stat4 = statistichePvlVuote();
  await applicaPaginaBandiPvl(db, [leggiAvvisoPvl(avvisoPvl(AVVISO_1, TED_1, "2026-11-13", "2026-12-14")) as BandoPvl, leggiAvvisoPvl(avvisoPvl(AVVISO_2, TED_2, "2026-11-24", "2026-12-21")) as BandoPvl], "incrementale", adesso, misure, stat4);
  const t3 = await applicaPaginaBandi(db, [leggiBandoTed(avvisoTed(TED_1, "2026-11-17", "2026-12-14", null)), leggiBandoTed(avvisoTed(TED_2, "2026-11-25", "2026-12-21", "cor-buy"))], "incrementale", adesso, misure);
  atteso("6) rilettura: tutto invariato, solo letture (2 richieste per fonte)", stat4.bandi.invariati === 2 && t3.invariati === 2 && misure.richiesteDb - prima === 2, JSON.stringify({ pvl: stat4.bandi.invariati, ted: t3.invariati, richieste: misure.richiesteDb - prima }));
  agg = await aggiornamenti(id);
  atteso("6) cambiamenti finali: nuova, proroga, esito (uno ciascuno)", JSON.stringify(agg.map((a) => a.tipo)) === JSON.stringify(["nuova", "proroga", "esito"]), JSON.stringify(agg));

  await pulisci();
  await casoRettificaPrimaDelBando(misure, adesso);
  await pulisci2();
  const finale = await gara();
  const finale2 = await gara2();
  atteso("dati sintetici cancellati", finale.ids.length === 0 && finale.idsTed.length === 0 && finale2.ids.length === 0 && finale2.idsTed.length === 0, JSON.stringify({ finale, finale2 }));
  console.log(fallimenti.length === 0 ? "\nProva d'integrazione PVL sullo staging: tutto a posto." : `\nProva d'integrazione: ${fallimenti.length} controlli falliti.`);
  process.exit(fallimenti.length === 0 ? 0 : 1);
}

// ───── caso 2: rettifica PVL letta PRIMA del bando TED (richiesta del titolare del 17/11) ─────
// La PVL pubblica la rettifica (cita il nuovo avviso TED 999912) prima che TED abbia letto il bando (999911): nascono due gare. Quando TED
// legge la rettifica 999912, le due si collegano: reversibile, tracciato, senza perdita di dati. Poi si annulla e non si ricollega.
const APPALTO_2 = "00000000-0000-4000-8000-00000000b2b2";
const AVVISO_R = "00000000-0000-4000-8000-00000000a0f1";
const TED_R1 = "999911-2026";
const TED_R2 = "999912-2026";
const PROC_TED_2 = "sintetica-b1bis-procedura-2";

async function gara2() {
  const { data: prov } = await db.from("radar_procedure_fonti").select("procedura_id").eq("fonte", "pvl").eq("id_procedura_fonte", APPALTO_2);
  const { data: perTed } = await db.from("radar_procedure").select("id").eq("chiave", `ted:${PROC_TED_2}`);
  return { ids: [...new Set((prov ?? []).map((p) => p.procedura_id))], idsTed: (perTed ?? []).map((r) => r.id) };
}

async function pulisci2() {
  const { ids, idsTed } = await gara2();
  const tutte = [...new Set([...ids, ...idsTed])];
  if (tutte.length) await db.from("radar_procedure").delete().in("id", tutte);
  await db.from("radar_procedure_fonti").delete().in("id_fonte", [AVVISO_R, TED_R1, TED_R2]);
}

async function fotografia(id: string) {
  const [g, l, p] = await Promise.all([
    db.from("radar_procedure").select("*").eq("id", id).single(),
    db.from("radar_lotti").select("numero_lotto, cig, oggetto, valore_stimato, scadenza_giorno, url_documenti").eq("procedura_id", id).order("numero_lotto"),
    db.from("radar_procedure_fonti").select("fonte, id_fonte, impronta, rif_ted, id_procedura_fonte").eq("procedura_id", id).order("id_fonte"),
  ]);
  const riga = { ...(g.data ?? {}) } as Record<string, unknown>;
  for (const k of ["unita_a", "unita_il", "unita_motivo", "unita_esclusa_con", "aggiornata_il"]) delete riga[k];
  return JSON.stringify({ riga, lotti: l.data, prov: p.data });
}

async function casoRettificaPrimaDelBando(misure: Misure, adesso: Date) {
  await pulisci2();
  const avviso = avvisoPvl(AVVISO_R, TED_R2, "2026-11-20", "2026-12-21");
  avviso.idAppalto = APPALTO_2;
  avviso.nuovoAvviso = null;
  const statR = statistichePvlVuote();
  await applicaPaginaBandiPvl(db, [leggiAvvisoPvl(avviso) as BandoPvl], "incrementale", adesso, misure, statR);
  const conProc = (a: Record<string, unknown>) => ({ ...a, "procedure-identifier": PROC_TED_2 });
  await applicaPaginaBandi(db, [leggiBandoTed(conProc(avvisoTed(TED_R1, "2026-11-17", "2026-12-14", null)))], "incrementale", adesso, misure);
  let g2 = await gara2();
  atteso("R1) rettifica PVL prima del bando TED: oggi nascono due gare (doppione atteso a questo punto)", g2.ids.length === 1 && g2.idsTed.length === 1 && g2.ids[0] !== g2.idsTed[0], JSON.stringify(g2));
  const idPvl = g2.ids[0];
  const idTed = g2.idsTed[0];
  const prima = await fotografia(idPvl);
  const primaTed = await fotografia(idTed);

  const t = await applicaPaginaBandi(db, [leggiBandoTed(conProc(avvisoTed(TED_R2, "2026-11-25", "2026-12-21", "cor-buy")))], "incrementale", adesso, misure);
  const { data: dopo } = await db.from("radar_procedure").select("unita_a, unita_il, unita_motivo").eq("id", idPvl).single();
  atteso("R2) TED legge la rettifica citata dalla PVL: le due gare si collegano (resta quella TED)", t.collegateDoppie === 1 && dopo?.unita_a === idTed && !!dopo?.unita_il && /999912-2026/.test(dopo?.unita_motivo ?? ""), JSON.stringify({ t, dopo }));
  atteso("R3) nessuna perdita di dati: la gara collegata è identica a prima (salvo il collegamento)", (await fotografia(idPvl)) === prima);
  const dopoTed = JSON.parse(await fotografia(idTed));
  atteso("R3) la gara che resta non perde nulla (si aggiungono solo la rettifica TED e il registro)", JSON.parse(primaTed).riga.chiave === dopoTed.riga.chiave && dopoTed.prov.length === 2);
  const { data: tracce } = await db.from("radar_aggiornamenti").select("procedura_id, tipo, campo, valore_nuovo, notificabile").in("procedura_id", [idPvl, idTed]).eq("tipo", "correzione_dati");
  atteso(
    "R4) tracciato su entrambe le gare, mai notificabile",
    (tracce ?? []).length === 2 && (tracce ?? []).some((r) => r.procedura_id === idPvl && r.campo === "collegata_a" && r.valore_nuovo === idTed) && (tracce ?? []).some((r) => r.procedura_id === idTed && r.campo === "collegata_da" && r.valore_nuovo === idPvl) && (tracce ?? []).every((r) => r.notificabile === false),
    JSON.stringify(tracce),
  );
  const { data: visibili } = await db.from("radar_procedure").select("id").in("id", [idPvl, idTed]).is("unita_a", null);
  atteso("R5) elenchi e ricerca: si vede solo la gara che resta", JSON.stringify((visibili ?? []).map((r) => r.id)) === JSON.stringify([idTed]));
  const scheda = await leggiGaraPubblica(db, idTed);
  atteso(
    "R5) la scheda che resta mostra anche l'avviso PVL e i CIG della gara collegata",
    !!scheda && scheda.collegate.includes(idPvl) && scheda.provenienze.some((p) => p.fonte === "pvl" && p.id_fonte === AVVISO_R) && scheda.cigCollegati.get("LOT-0001") === CIG[0],
    JSON.stringify({ collegate: scheda?.collegate, cig: [...(scheda?.cigCollegati ?? new Map()).entries()] }),
  );

  // annullamento dalla console (stessa funzione): la gara torna visibile e non si ricollega da sola
  const annullo = await scollegaGara(db, idPvl, new Date().toISOString());
  const { data: dopoAnnullo } = await db.from("radar_procedure").select("unita_a, unita_esclusa_con").eq("id", idPvl).single();
  atteso("R6) annullamento: torna visibile, il collegamento con quella gara è escluso", annullo.ok && dopoAnnullo?.unita_a === null && (dopoAnnullo?.unita_esclusa_con ?? []).includes(idTed), JSON.stringify({ annullo, dopoAnnullo }));
  atteso("R6) nessuna perdita di dati dopo l'annullamento", (await fotografia(idPvl)) === prima);
  const ripetuta = conProc(avvisoTed(TED_R2, "2026-11-25", "2026-12-21", "cor-buy"));
  ripetuta["title-proc"] = { ita: "(DATI SINTETICI) Servizio di pulizia degli uffici comunali (testo TED, nuova lettura)" };
  const t2 = await applicaPaginaBandi(db, [leggiBandoTed(ripetuta)], "incrementale", adesso, misure);
  const { data: dopoRilettura } = await db.from("radar_procedure").select("unita_a").eq("id", idPvl).single();
  atteso("R7) una nuova lettura di quell'avviso TED non ricollega la gara annullata a mano", t2.collegateDoppie === 0 && dopoRilettura?.unita_a === null, JSON.stringify({ t2: t2.collegateDoppie, dopoRilettura }));
  const { data: tracceAnnullo } = await db.from("radar_aggiornamenti").select("procedura_id, campo").in("procedura_id", [idPvl, idTed]).eq("campo", "collegamento_annullato");
  atteso("R7) annullamento tracciato su entrambe le gare", (tracceAnnullo ?? []).length === 2, JSON.stringify(tracceAnnullo));
}

principale().catch(async (e) => {
  console.error(e);
  await pulisci().catch(() => {});
  await pulisci2().catch(() => {});
  process.exit(1);
});
