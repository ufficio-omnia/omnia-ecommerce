// Verifica della parte di B2 delle regole S1–S4 (documento 49C, 23/11/2026): la DESCRIZIONE nel classificatore unico, negli importatori e
// nella riclassificazione (S2), lo stato «da_verificare» (S4, migrazione 0133) nel popolamento, nella riclassificazione e nella scrittura, e
// la situazione della gara per le pagine. Le REGOLE sono della sessione PVL (settori.ts, verifica-radar-qualita.ts). Tutto in memoria, dati
// SINTETICI. Uso: npx tsx scripts/verifica-radar-s1-s4.ts → codice 0 se tutto passa.
import fs from "fs";
import path from "path";
import { classificaPerArchivio } from "../src/lib/radar/classificazione-unita";
import { giaClassificata, pianoGara, type GaraArchivio } from "../src/lib/radar/riclassifica-settori";
import { COLONNE_GARA_ARCHIVIO } from "../src/lib/radar/riclassificazione";
import {
  REGOLA_DA_VERIFICARE,
  eDaVerificare,
  etichettaRilevanza,
  gareSuggeribili,
  situazioneGara,
  statoDopoTentativo,
  type RigaClassificazione,
  type RigaStato,
} from "../src/lib/radar/classificazioni-calcoli";
import { scriviClassificazioni } from "../src/lib/radar/classificazioni";
import { VERSIONE_REGOLE_SETTORI } from "../src/lib/radar/settori";
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
}

principale()
  .catch((e) => falliti.push(`eccezione: ${e instanceof Error ? e.stack ?? e.message : String(e)}`))
  .finally(() => {
    console.log(`Verifica della parte B2 di S1–S4 (descrizione, «da_verificare», 49C): ${ok} ok, ${falliti.length} falliti`);
    for (const f of falliti) console.log(`  FALLITO: ${f}`);
    process.exit(falliti.length ? 1 : 0);
  });
