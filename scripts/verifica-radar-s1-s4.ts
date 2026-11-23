// Verifica della parte di B2 delle regole S1–S4 (documento 49C, 23/11/2026): la DESCRIZIONE nel classificatore unico, negli importatori e
// nella riclassificazione (S2), lo stato «da_verificare» (S4, migrazione 0133) nel popolamento, nella riclassificazione e nella scrittura, e
// la situazione della gara per le pagine. Le REGOLE sono della sessione PVL (settori.ts, verifica-radar-qualita.ts). Tutto in memoria, dati
// SINTETICI. Uso: npx tsx scripts/verifica-radar-s1-s4.ts → codice 0 se tutto passa.
import fs from "fs";
import path from "path";
import { classificaPerArchivio } from "../src/lib/radar/classificazione-unita";
import { colonnaDaRigheAttive, giaClassificata, isoDaEsecuzione, pianoGara, tracciaRiallineamento, type GaraArchivio } from "../src/lib/radar/riclassifica-settori";
import { COLONNE_GARA_ARCHIVIO, riallineaSettoriGara } from "../src/lib/radar/riclassificazione";
import {
  REGOLA_DA_VERIFICARE,
  casoDaRigaDaVerificare,
  righeDaClassificazione,
  eDaVerificare,
  etichettaRilevanza,
  gareSuggeribili,
  situazioneGara,
  statoDopoTentativo,
  type RigaClassificazione,
  type RigaStato,
} from "../src/lib/radar/classificazioni-calcoli";
import { scriviClassificazioni } from "../src/lib/radar/classificazioni";
import { MOTIVI_DA_VERIFICARE, VERSIONE_REGOLE_SETTORI, descriviCorrezioneSettori } from "../src/lib/radar/settori";
import { databaseInMemoria } from "./lib/db-in-memoria";

let ok = 0;
const falliti: string[] = [];
function controlla(nome: string, condizione: boolean, dettaglio?: unknown): void {
  if (condizione) ok++;
  else falliti.push(`${nome}${dettaglio === undefined ? "" : ` → ${JSON.stringify(dettaglio).slice(0, 500)}`}`);
}
const ISO = "2026-11-23T12:00:00.000Z";
let n = 0;
const nuovoId = () => `id-${++n}`;
const misure = () => ({ richiesteDb: 0, msDb: 0 });

// casi guida del 49C (dati SINTETICI con lo stesso testo delle regole)
const MANN = { oggetto: "SERVIZIO DI TRASPORTO DI OPERE D’ARTE (prova sintetica)", cpv_principale: "63110000", cpv_tutti: ["63110000"], natura_contratto: "servizi" };
const MANN_DESCRIZIONE = "SERVIZIO DI TRASPORTO DI OPERE D’ARTE ‘DA CHIODO A CHIODO’, COMPRENSIVO DI IMBALLAGGIO E DISIMBALLAGGIO, MONTAGGIO E SMONTAGGIO DELLE OPERE IN ANDATA E RITORNO";
const BIBLIOTECA = { oggetto: "Gara europea per l'affidamento dei servizi integrati di biblioteca presso le strutture dell'Università (prova sintetica)", cpv_principale: "92511000", cpv_tutti: ["92511000"], natura_contratto: "servizi" };
const CASONE = { oggetto: "AFFIDAMENTO IN CONCESSIONE DEL CASONE “PADULI” PER LA DURATA DI SETTE ANNI (prova sintetica)", cpv_principale: "55300000", cpv_tutti: ["55300000"], natura_contratto: "servizi" };
const MENSA = { oggetto: "Servizio di ristorazione scolastica (prova sintetica)", cpv_principale: "55524000", cpv_tutti: ["55524000"], natura_contratto: "servizi" };

function garaArchivio(id: string, d: Partial<GaraArchivio>): GaraArchivio {
  return { id, chiave: `ted:proc-${id}`, oggetto: null, cpv_principale: null, cpv_tutti: null, settori: [], metodo_settore: null, natura_contratto: "servizi", fonti: ["ted"], aggiornata_il: "2026-11-01T00:00:00.000Z", unita_a: null, ...d };
}

async function principale(): Promise<void> {
  // ═════ S2: la descrizione arriva alla regola (e SOLO a quella) ═════
  const senza = classificaPerArchivio(MANN, []);
  const con = classificaPerArchivio({ ...MANN, descrizione: MANN_DESCRIZIONE }, []);
  controlla("S2: senza descrizione il trasporto resta C «trasporto_puro»", senza.settori.length === 0 && senza.perSettore.facchinaggio?.livello === "C" && senza.perSettore.facchinaggio?.regola === "trasporto_puro", senza.perSettore);
  controlla("S2: con la descrizione (classificatore unico) facchinaggio B «trasporto_con_movimentazione»", JSON.stringify(con.settori) === '["facchinaggio"]' && con.perSettore.facchinaggio?.livello === "B" && con.perSettore.facchinaggio?.regola === "trasporto_con_movimentazione", con.perSettore);
  const pMann = pianoGara({ gara: garaArchivio("MANN", { ...MANN, descrizione: MANN_DESCRIZIONE }), lotti: [], attive: [], stato: null, esecuzione: "20261123T120000000Z", adessoIso: ISO, nuovoId });
  controlla("S2: la riclassificazione passa la descrizione (gara dell'archivio): la colonna acquisisce facchinaggio", pMann.cambiaSettori && JSON.stringify(pMann.ric?.dopo.settori) === '["facchinaggio"]' && pMann.calcolate.some((r) => r.settore === "facchinaggio" && r.rilevanza === "B"), pMann.ric?.dopo);
  controlla("S2: la riclassificazione LEGGE la descrizione dall'archivio (COLONNE_GARA_ARCHIVIO)", /\bdescrizione\b/.test(COLONNE_GARA_ARCHIVIO));
  const leggi = (f: string) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  controlla("S2: il connettore TED passa la sua descrizione (description-proc) a classificaGara, solo se diversa dal titolo", /classificaGara\(\{[^\n]*descrizione: descrizione && descrizione !== titolo \? descrizione : null \}\)/.test(leggi("src/lib/radar/fonti/ted-calcoli.ts")));
  controlla("S2: il connettore PVL passa metadata.descrizione a classificaGara, solo se diversa dal titolo", /classificaGara\(\{[^\n]*descrizione: descrizioneMeta && descrizioneMeta !== titolo \? descrizioneMeta : null \}\)/.test(leggi("src/lib/radar/fonti/pvl-calcoli.ts")));
  controlla("S2: il classificatore unico passa g.descrizione a classificaGara", /descrizione: g\.descrizione \?\? null,/.test(leggi("src/lib/radar/classificazione-unita.ts")));

  // ═════ S4: «da_verificare» nel classificatore unico ═════
  const bib = classificaPerArchivio(BIBLIOTECA, []);
  const vb = bib.perSettore.vigilanza_portierato;
  controlla("S4 biblioteca: caso da verificare, nessun settore, livello C, riga C «da_verificare» con il motivo per il settore candidato", bib.settori.length === 0 && bib.livello === "C" && bib.daVerificare?.[0]?.caso === "biblioteca" && vb?.livello === "C" && vb.regole[0] === REGOLA_DA_VERIFICARE && vb.motivi.length === vb.regole.length && vb.motivi[0].length > 20, bib);
  const cas = classificaPerArchivio(CASONE, []);
  controlla("S4 casone: «da_verificare» PRIMA della regola C di oggi, che resta («concessione_di_immobili»)", JSON.stringify(cas.perSettore.ristorazione?.regole) === JSON.stringify([REGOLA_DA_VERIFICARE, "concessione_di_immobili"]) && cas.perSettore.ristorazione?.motivi.length === 2, cas.perSettore.ristorazione);
  const mensa = classificaPerArchivio(MENSA, []);
  controlla("S4: una gara pertinente non ha mai casi da verificare", mensa.settori.length > 0 && mensa.daVerificare === undefined && !Object.values(mensa.perSettore).some((v) => v?.regole.includes(REGOLA_DA_VERIFICARE)));

  // ═════ S4: lo stato (regola unica eDaVerificare, statoDopoTentativo) ═════
  const casi = [{ settore: "vigilanza_portierato" }];
  const C = (settore: string) => ({ settore: settore as RigaClassificazione["settore"], rilevanza: "C" as const, attiva: true, origine: "riclassificazione" as const });
  controlla("eDaVerificare: con casi e solo righe C → sì", eDaVerificare(casi, [{ rilevanza: "C" }], [C("vigilanza_portierato")]));
  controlla("eDaVerificare: senza casi → no", !eDaVerificare([], [{ rilevanza: "C" }], []) && !eDaVerificare(undefined, [], []) && !eDaVerificare(null, [], []));
  controlla("eDaVerificare: una riga A o B calcolata → no", !eDaVerificare(casi, [{ rilevanza: "B" }], []) && !eDaVerificare(casi, [{ rilevanza: "A" }, { rilevanza: "C" }], []));
  controlla("eDaVerificare: l'amministratore ha deciso il settore candidato (anche C) → no, il caso è chiuso", !eDaVerificare(casi, [{ rilevanza: "C" }], [{ ...C("vigilanza_portierato"), origine: "amministratore" }]));
  controlla("eDaVerificare: l'amministratore ha dato A a un ALTRO settore → no (la gara è pertinente)", !eDaVerificare(casi, [{ rilevanza: "C" }], [{ ...C("pulizia"), rilevanza: "A", origine: "amministratore" }]));
  controlla("eDaVerificare: una decisione dell'amministratore NON attiva non conta", eDaVerificare(casi, [{ rilevanza: "C" }], [{ ...C("vigilanza_portierato"), origine: "amministratore", attiva: false }]));
  const sv = statoDopoTentativo({ versione_regole: "2026-11-18e", classificata_il: "2026-11-18T00:00:00.000Z", tentativi: 1 }, { ok: true, versione: VERSIONE_REGOLE_SETTORI, daVerificare: true }, "G", ISO);
  controlla("statoDopoTentativo: «da_verificare» con versione, date valorizzate ed errore nullo (0121 e 0133)", sv.stato === "da_verificare" && sv.versione_regole === VERSIONE_REGOLE_SETTORI && sv.classificata_il === ISO && sv.tentativo_il === ISO && sv.errore === null && sv.tentativi === 2, sv);
  controlla("statoDopoTentativo: senza daVerificare resta «classificata»", statoDopoTentativo(null, { ok: true, versione: "v" }, "G", ISO).stato === "classificata");

  // ═════ S4: riclassificazione (piano) e idempotenza ═════
  const gb = garaArchivio("BIB", BIBLIOTECA);
  const p = pianoGara({ gara: gb, lotti: [], attive: [], stato: null, esecuzione: "20261123T120000000Z", adessoIso: ISO, nuovoId });
  controlla("piano: gara «biblioteca» → stato «da_verificare», riga C «da_verificare», colonna invariata (vuota)", p.stato?.stato === "da_verificare" && p.stato?.errore === null && !p.cambiaSettori && p.calcolate.some((r) => r.settore === "vigilanza_portierato" && r.rilevanza === "C" && r.regole[0] === REGOLA_DA_VERIFICARE), { stato: p.stato, righe: p.calcolate.map((r) => [r.settore, r.rilevanza, r.regole]) });
  controlla("piano: una gara «da_verificare» con la versione corrente è già chiusa (la seconda esecuzione non la riscrive)", giaClassificata(p.stato, gb.aggiornata_il) && pianoGara({ gara: gb, lotti: [], attive: p.calcolate, stato: p.stato, esecuzione: "x", adessoIso: ISO, nuovoId }).tipo === "gia_classificata");
  controlla("piano: «da_verificare» con una versione VECCHIA si ricalcola", !giaClassificata({ ...(p.stato as RigaStato), versione_regole: "2026-11-18e" }, gb.aggiornata_il));
  const decisa: RigaClassificazione = { ...p.calcolate[0], id: "admin-1", rilevanza: "B", sottocategorie: [], regole: ["decisione_amministratore"], motivi: ["Decisione dell'amministratore"], origine: "amministratore", nota: "Verificato nei documenti: comprende l'apertura e l'accoglienza", autore: "admin@prova.test" };
  const pDecisa = pianoGara({ gara: gb, lotti: [], attive: [decisa], stato: null, esecuzione: "x", adessoIso: ISO, nuovoId });
  controlla("piano: decisa dall'amministratore → «classificata» (la sua decisione chiude il caso)", pDecisa.stato?.stato === "classificata", pDecisa.stato);

  // ═════ S4: scrittura (scriviClassificazioni) sul database in memoria ═════
  const mem = databaseInMemoria({ radar_procedure: [], radar_classificazioni: [], radar_classificazioni_stato: [] }, { fonti: "0121" });
  const voce = { proceduraId: "BIB", versione: p.ric?.classificazione.versione ?? "", calcolate: p.calcolate, casiDaVerificare: p.ric?.classificazione.daVerificare ?? null };
  const e1 = await scriviClassificazioni(mem.client, [voce, { proceduraId: "MEN", versione: VERSIONE_REGOLE_SETTORI, calcolate: pianoGara({ gara: garaArchivio("MEN", MENSA), lotti: [], attive: [], stato: null, esecuzione: "x", adessoIso: ISO, nuovoId }).calcolate, casiDaVerificare: null }], misure(), ISO);
  const st = (id: string) => mem.tabelle.radar_classificazioni_stato.find((s) => s.procedura_id === id);
  controlla("scrittura: «da_verificare» per la biblioteca, «classificata» per la mensa; righe C scritte", e1.classificate === 2 && st("BIB")?.stato === "da_verificare" && st("BIB")?.errore === null && st("BIB")?.versione_regole === VERSIONE_REGOLE_SETTORI && st("MEN")?.stato === "classificata" && mem.tabelle.radar_classificazioni.some((r) => r.procedura_id === "BIB" && (r.regole as string[])[0] === REGOLA_DA_VERIFICARE), { stati: mem.tabelle.radar_classificazioni_stato });
  const mem2 = databaseInMemoria({ radar_procedure: [], radar_classificazioni: [{ ...decisa, procedura_id: "BIB" }], radar_classificazioni_stato: [] }, { fonti: "0121" });
  await scriviClassificazioni(mem2.client, [voce], misure(), ISO);
  controlla("scrittura: con la decisione dell'amministratore già nel database → «classificata»", mem2.tabelle.radar_classificazioni_stato.find((s) => s.procedura_id === "BIB")?.stato === "classificata");
  const lettura = (f: string) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  for (const [f, rx] of [
    ["src/lib/radar/importa.ts", /casiDaVerificare: ci\.unita\.daVerificare \?\? null/],
    ["src/lib/radar/importa-fonti-pagina.ts", /casiDaVerificare: s\.classificazione\.unita\.daVerificare \?\? null/],
    ["src/lib/radar/riclassificazione.ts", /casiDaVerificare: p\.ric\?\.classificazione\.daVerificare \?\? null/],
  ] as const) controlla(`testo ${path.basename(f)}: passa i casi da verificare alla scrittura`, rx.test(lettura(f)));

  // ═════ S4: la situazione della gara per le pagine (mai «non pertinente») ═════
  const righeBib = p.calcolate.map((r) => ({ settore: r.settore, rilevanza: r.rilevanza, attiva: true, regole: r.regole }));
  const s = situazioneGara({ stato: "da_verificare", versione_regole: VERSIONE_REGOLE_SETTORI, errore: null }, righeBib);
  controlla("situazione: «da_verificare» con i settori candidati, MAI «classificata» né fuori dai settori", s.tipo === "da_verificare" && JSON.stringify(s.candidati) === '["vigilanza_portierato"]', s);
  controlla("situazione: etichetta «Classificazione in verifica» (diversa da «fallita»)", etichettaRilevanza(s) === "Classificazione in verifica" && etichettaRilevanza({ tipo: "fallita", errore: "x" }) === "Classificazione da verificare");
  const sSenzaRegole = situazioneGara({ stato: "da_verificare", versione_regole: "v", errore: null }, [{ settore: "pulizia", rilevanza: "C", attiva: true }]);
  controlla("situazione: senza le regole nelle righe, candidati = i settori delle righe C", sSenzaRegole.tipo === "da_verificare" && JSON.stringify(sSenzaRegole.candidati) === '["pulizia"]');
  controlla("situazione: «classificata» con le stesse righe C sarebbe «fuori dai settori» (il caso che «da_verificare» evita)", (() => { const c = situazioneGara({ stato: "classificata", versione_regole: "v", errore: null }, righeBib); return c.tipo === "classificata" && c.fuoriDaiSettori; })());
  controlla("situazione: uno stato sconosciuto non diventa mai «classificata»", situazioneGara({ stato: "sconosciuto" as RigaStato["stato"], versione_regole: "v", errore: null }, righeBib).tipo === "non_classificata");
  controlla("suggerimenti: una gara «da_verificare» non si suggerisce mai, anche con una riga A", gareSuggeribili([{ procedura_id: "BIB", settore: "vigilanza_portierato", rilevanza: "A", attiva: true }], new Map([["BIB", { stato: "da_verificare" as const }]]), ["vigilanza_portierato"]).length === 0);
  controlla("motore delle notifiche: lo stato letto usa il tipo unico a 4 stati (StatoClassificazione), non un elenco suo", /leggiPer<\{ procedura_id: string; stato: StatoClassificazione \}>\("stato delle classificazioni"/.test(leggi("src/lib/radar/notifiche/motore.ts")));

  await provaRiallineamento(decisa);
  provaCasoDalMotivo();
}

// ═════ riallineamento della colonna di UNA gara dopo una decisione dell'amministratore (richiesta del coordinamento, 23/11) ═════
async function provaRiallineamento(decisa: RigaClassificazione): Promise<void> {
  const r = (settore: string, rilevanza: "A" | "B" | "C", x: Partial<RigaClassificazione> = {}) => ({ settore: settore as RigaClassificazione["settore"], rilevanza, attiva: true, da: "cpv" as const, ...x });
  const a = colonnaDaRigheAttive([r("vigilanza_portierato", "A", { da: "parole_chiave" })], { settori: [], metodo: null });
  controlla("colonna: decisa A una gara senza settori → entra nel settore, metodo dalla riga", JSON.stringify(a) === JSON.stringify({ settori: ["vigilanza_portierato"], metodo: "parole_chiave", cambia: true }), a);
  controlla("colonna: anche B conta (correlata), C no, una riga NON attiva no", JSON.stringify(colonnaDaRigheAttive([r("pulizia", "B"), r("ristorazione", "C"), r("facchinaggio", "A", { attiva: false })], { settori: [], metodo: null }).settori) === '["pulizia"]');
  controlla("colonna: righe uguali alla colonna → nessun cambio", colonnaDaRigheAttive([r("pulizia", "A"), r("ristorazione", "B")], { settori: ["ristorazione", "pulizia"], metodo: "cpv" }).cambia === false);
  const tolta = colonnaDaRigheAttive([r("pulizia", "C", { origine: "amministratore" } as Partial<RigaClassificazione>), r("ristorazione", "A")], { settori: ["pulizia", "ristorazione"], metodo: "cpv" });
  controlla("colonna: decisa C su un settore della colonna → tolto; l'ordine degli altri resta, il metodo resta", JSON.stringify(tolta) === JSON.stringify({ settori: ["ristorazione"], metodo: "cpv", cambia: true }), tolta);
  controlla("colonna: i nuovi settori in fondo in ordine alfabetico, quelli di prima nel loro ordine", JSON.stringify(colonnaDaRigheAttive([r("vigilanza_portierato", "A"), r("ristorazione", "A"), r("ausiliariato", "B")], { settori: ["vigilanza_portierato"], metodo: "cpv" }).settori) === '["vigilanza_portierato","ausiliariato","ristorazione"]');
  controlla("colonna: nessuna riga A o B → colonna vuota, metodo nullo", JSON.stringify(colonnaDaRigheAttive([r("pulizia", "C")], { settori: ["pulizia"], metodo: "cpv" })) === JSON.stringify({ settori: [], metodo: null, cambia: true }));
  // la traccia: stessa forma delle correzioni, frase per il cliente, mai annullabile come un'esecuzione
  const t = tracciaRiallineamento("BIB", { settori: [], metodo: null }, { settori: ["vigilanza_portierato"], metodo: "cpv" }, ISO);
  const idFonte = String(t.id_fonte);
  controlla("traccia: correzione_dati sul campo «settori», fonte delle regole, MAI notificabile, nota «Decisione dell'amministratore»", t.tipo === "correzione_dati" && t.campo === "settori" && t.fonte === "regole_settori" && t.notificabile === false && /^Decisione dell'amministratore/.test(String(t.nota)), t);
  controlla("traccia: identificativo «regole-settori-<versione>:aggiunta:amministratore-<istante>» entro 200 caratteri", idFonte === `regole-settori-${VERSIONE_REGOLE_SETTORI}:aggiunta:amministratore-20261123T120000000Z` && idFonte.length <= 200, idFonte);
  controlla("traccia: la frase per il cliente la legge («abbiamo aggiunto la gara a: vigilanza …»)", /^Il 23\/11\/2026 abbiamo aggiunto la gara a: vigilanza/.test(descriviCorrezioneSettori("23/11/2026", String(t.valore_precedente), String(t.valore_nuovo), idFonte)), descriviCorrezioneSettori("23/11/2026", String(t.valore_precedente), String(t.valore_nuovo), idFonte));
  controlla("traccia: l'esecuzione «amministratore-…» non è mai un'esecuzione della riclassificazione (non si annulla per sbaglio)", isoDaEsecuzione(idFonte.split(":").slice(2).join(":")) === null);
  // sul database in memoria
  const base = () => databaseInMemoria({ radar_procedure: [{ id: "BIB", chiave: "ted:BIB", settori: [], metodo_settore: null, oggetto: "x" }], radar_classificazioni: [{ ...decisa, procedura_id: "BIB", rilevanza: "A" }], radar_aggiornamenti: [] }, { fonti: "0121" });
  const m = base();
  const e1 = await riallineaSettoriGara(m.client, "BIB", ISO);
  const gara = () => m.tabelle.radar_procedure.find((g) => g.id === "BIB");
  controlla("riallineamento: decisa A → «aggiornata», colonna con il settore, UNA traccia", e1.esito === "aggiornata" && JSON.stringify(gara()?.settori) === '["vigilanza_portierato"]' && m.tabelle.radar_aggiornamenti.length === 1, { e1, gara: gara(), tracce: m.tabelle.radar_aggiornamenti.length });
  const e2 = await riallineaSettoriGara(m.client, "BIB", "2026-11-23T13:00:00.000Z");
  controlla("riallineamento: rifatto → «invariata», nessuna scrittura né traccia in più", e2.esito === "invariata" && m.tabelle.radar_aggiornamenti.length === 1);
  controlla("riallineamento: gara che non c'è → «gara_assente»", (await riallineaSettoriGara(m.client, "NESSUNA", ISO)).esito === "gara_assente");
  // traccia che non si scrive: la colonna torna com'era (nessun cambio senza traccia)
  const g2 = base();
  const conGuasto = { from: (t: string) => (t === "radar_aggiornamenti" ? { upsert: async () => ({ data: null, error: { message: "guasto di prova" } }) } : g2.client.from(t)) } as unknown as typeof g2.client;
  const e3 = await riallineaSettoriGara(conGuasto, "BIB", ISO);
  controlla("riallineamento: traccia non scritta → «errore» e colonna rimessa com'era", e3.esito === "errore" && JSON.stringify(g2.tabelle.radar_procedure[0].settori) === "[]" && g2.tabelle.radar_procedure[0].metodo_settore === null, { e3, gara: g2.tabelle.radar_procedure[0] });
  // colonna cambiata da altri dopo la lettura: la scrittura condizionata non tocca nulla
  const g3 = base();
  let letta = false;
  // la gara è già stata letta quando si leggono le righe: in quel momento qualcun altro cambia la colonna
  const intanto = {
    from: (t: string) => {
      if (t === "radar_classificazioni" && !letta) {
        letta = true;
        g3.tabelle.radar_procedure[0].settori = ["pulizia"];
      }
      return g3.client.from(t);
    },
  } as unknown as typeof g3.client;
  const e4 = await riallineaSettoriGara(intanto, "BIB", ISO);
  controlla("riallineamento: colonna cambiata da altri dopo la lettura → «cambiata_nel_frattempo», nessuna scrittura né traccia", e4.esito === "cambiata_nel_frattempo" && JSON.stringify(g3.tabelle.radar_procedure[0].settori) === '["pulizia"]' && g3.tabelle.radar_aggiornamenti.length === 0, { e4, gara: g3.tabelle.radar_procedure[0] });
}

// ═════ il caso S4 ricavato dal MOTIVO della riga «da_verificare» (non dal settore candidato) ═════
function provaCasoDalMotivo(): void {
  const STABULARI = { oggetto: "Gara europea a procedura aperta per l'affidamento dei Servizi di gestione degli stabilimenti utilizzatori di Ateneo (Monitoraggio sanitario, fornitura diete e lettiera, pulizie e cure degli animali) dell'Università degli Studi di Torino (prova sintetica)", cpv_principale: "77400000", cpv_tutti: ["77400000"], natura_contratto: "servizi" };
  const riga = (dati: typeof BIBLIOTECA) => {
    const c = classificaPerArchivio(dati, []);
    return righeDaClassificazione(c, { proceduraId: "G", origine: "riclassificazione", fonti: ["ted"], autore: "prova", adessoIso: ISO, nuovoId, settoriColonna: [] }).find((x) => x.regole.includes(REGOLA_DA_VERIFICARE));
  };
  const casi = [["casone", CASONE, "immobile_con_cpv_ristorazione"], ["stabulari", STABULARI, "stabulari"], ["biblioteca", BIBLIOTECA, "biblioteca"]] as const;
  for (const [nome, dati, atteso] of casi) {
    const x = riga(dati);
    controlla(`caso dal motivo (${nome}): dalla riga vera del classificatore → «${atteso}»`, !!x && casoDaRigaDaVerificare(x) === atteso, x ? { regole: x.regole, motivi: x.motivi } : "nessuna riga");
  }
  const bib = riga(BIBLIOTECA)!;
  controlla("caso dal motivo: NON dipende dal settore candidato (stesso motivo su un altro settore → stesso caso)", casoDaRigaDaVerificare({ ...bib, settore: "pulizia" } as RigaClassificazione) === "biblioteca");
  controlla("caso dal motivo: riga senza la regola «da_verificare» → null", casoDaRigaDaVerificare({ regole: ["concessione_di_immobili"], motivi: [MOTIVI_DA_VERIFICARE.immobile_con_cpv_ristorazione] }) === null);
  controlla("caso dal motivo: motivo diverso da quelli delle regole → null (mai un caso indovinato)", casoDaRigaDaVerificare({ regole: [REGOLA_DA_VERIFICARE], motivi: ["Servizi di biblioteca da verificare"] }) === null);
  controlla("caso dal motivo: la regola non per prima (dopo un'altra) → il motivo accanto alla regola", casoDaRigaDaVerificare({ regole: ["x", REGOLA_DA_VERIFICARE], motivi: ["altro", MOTIVI_DA_VERIFICARE.stabulari] }) === "stabulari");
  const motivi = Object.values(MOTIVI_DA_VERIFICARE);
  controlla("guardia: tre casi, tre motivi tutti diversi e lunghi meno di 300 caratteri (nessuna ambiguità, nessun taglio)", motivi.length === 3 && new Set(motivi).size === 3 && motivi.every((m) => m.length > 40 && m.length <= 300));
}

principale()
  .catch((e) => falliti.push(`eccezione: ${e instanceof Error ? e.stack ?? e.message : String(e)}`))
  .finally(() => {
    console.log(`Verifica della parte B2 di S1–S4 (descrizione, «da_verificare», 49C): ${ok} ok, ${falliti.length} falliti`);
    for (const f of falliti) console.log(`  FALLITO: ${f}`);
    process.exit(falliti.length ? 1 : 0);
  });
