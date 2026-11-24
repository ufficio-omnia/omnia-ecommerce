// Verifica dello script che ripristina sede dell'ente e regioni delle gare dello staging dopo il giro di prova PVL del 24/11/2026: su un
// database IN MEMORIA, senza rete, con le righe costruite dal piano (gli stessi id e valori lasciati dal giro). Controlla anche che il piano
// sia quello che il motore CORRETTO produce dai valori di prima e da quelli del giro, e che un nuovo giro PVL non lo riporti indietro.
// Uso: npx tsx scripts/verifica-ripristino-ente-luogo.ts
import { ID_TRACCIA, lancia, leggiPiano, pianoRipristino, ripristinaEnteLuogo, type GaraDelPiano } from "./ente-luogo/ripristina-ente-luogo-staging";
import { FermoCollaudo } from "./collaudo-z8/collaudo-motore-z8";
import { DbFinto } from "./lib/db-finto-motore";
import type { ClientDb } from "../src/lib/radar/notifiche/motore";
import { unisciVersione, versioneDa, type ProvenienzaCampi } from "../src/lib/radar/unione-calcoli";
import { rigaDaBandoPvl } from "../src/lib/radar/importa-pvl-calcoli";
import { leggiAvvisoPvl, type BandoPvl } from "../src/lib/radar/fonti/pvl-calcoli";
import type { RigaProcedura } from "../src/lib/radar/importa-calcoli";
import fs from "fs";
import path from "path";

let ok = 0;
const falliti: string[] = [];
function controlla(nome: string, condizione: boolean, dettaglio?: unknown): void {
  if (condizione) ok++;
  else falliti.push(`${nome}${dettaglio === undefined ? "" : ` → ${JSON.stringify(dettaglio).slice(0, 500)}`}`);
}
const chiamate: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => {
  chiamate.push(String(input instanceof URL ? input.href : typeof input === "string" ? input : input.url));
  return new Response(JSON.stringify({ code: "XX000", message: "finto" }), { status: 500, headers: { "content-type": "application/json" } });
}) as typeof fetch;

const ORA = new Date("2026-11-25T08:00:00Z");
const AGGIORNATA = "2026-11-24T14:32:58.000+00:00";
const piano = leggiPiano();
const GARE = piano.gare;
const sedeDi = (r: Record<string, unknown>) => JSON.stringify([r.sa_comune ?? null, r.sa_provincia ?? null, r.sa_regione ?? null, r.luogo_regioni ?? []]);
const sedePiano = (s: GaraDelPiano["atteso"]) => JSON.stringify([s.sa_comune, s.sa_provincia, s.sa_regione, s.luogo_regioni]);
function mondo(modifica?: (db: DbFinto) => void): DbFinto {
  const db = new DbFinto();
  db.tabelle.radar_procedure = [
    ...GARE.map((g) => ({ id: g.id, sa_comune: g.giro.sa_comune, sa_provincia: g.giro.sa_provincia, sa_regione: g.giro.sa_regione, luogo_regioni: [...g.giro.luogo_regioni], provenienza_campi: { _versione: g.giro.luogo, luogo: g.giro.luogo, ente: g.giro.luogo, oggetto: { f: "ted", id: "000001-2026", g: "2026-11-17", t: null, ted: "000001-2026" } }, aggiornata_il: AGGIORNATA, oggetto: "(gara sintetica)" })),
    { id: "altra-gara", sa_comune: "Taino", sa_provincia: null, sa_regione: null, luogo_regioni: [], provenienza_campi: { luogo: { f: "pvl", id: "x", g: "2026-11-20", t: null, ted: null } }, aggiornata_il: AGGIORNATA, oggetto: "(fuori dal piano)" },
  ];
  db.tabelle.radar_aggiornamenti = [];
  modifica?.(db);
  return db;
}
const gara = (db: DbFinto, id: string) => db.t("radar_procedure").find((r) => r.id === id)!;
const scritture = (db: DbFinto) => db.richieste.filter((r) => r.metodo !== "select");

async function principale(): Promise<void> {
  // il piano
  controlla("piano: 26 gare, 11 con valori e 15 solo con la provenienza della sede, tutte della parte A", piano.conteggi.gare === 26 && GARE.length === 26 && GARE.filter((g) => g.valori).length === 11 && GARE.filter((g) => !g.valori).length === 15 && GARE.every((g) => g.parte === "A"), piano.conteggi);
  controlla("piano: valori diversi dal giro esattamente nelle 11 gare «con valori»", GARE.every((g) => (sedePiano(g.giro) !== sedePiano(g.atteso)) === g.valori));
  controlla("piano: il giro aveva sempre la sede della PVL; il ripristino la dà a TED o Sintel (mai alla PVL)", GARE.every((g) => g.giro.luogo.f === "pvl" && ["ted", "sintel"].includes(g.provenienza.luogo.f)));
  const regioniSvuotate = GARE.filter((g) => g.giro.luogo_regioni.length === 0).map((g) => g.id.slice(0, 8)).sort();
  controlla("piano: le 3 gare con le regioni svuotate tornano con le regioni di prima", JSON.stringify(regioniSvuotate) === JSON.stringify(["56a35499", "aa7b73ba", "d1e67ebf"]) && GARE.filter((g) => g.giro.luogo_regioni.length === 0).every((g) => JSON.stringify(g.atteso.luogo_regioni) === JSON.stringify(g.prima.luogo_regioni) && g.atteso.luogo_regioni.length > 0), regioniSvuotate);
  controlla("piano: nessuna gara perde un valore che aveva prima del giro, tranne la provincia di un altro comune", GARE.every((g) => (["sa_comune", "sa_regione"] as const).every((c) => !g.prima[c] || g.atteso[c] === g.prima[c]) && (!g.prima.sa_provincia || g.atteso.sa_provincia === g.prima.sa_provincia)));

  // il piano è quello del motore corretto: riga di prima (sede della fonte di prima) + riga PVL del giro → valori attesi; e un nuovo giro
  // della stessa versione PVL sul valore ripristinato non cambia nulla
  const campione = JSON.parse(fs.readFileSync(path.join(process.cwd(), "scripts/dati/radar-pvl-campione.json"), "utf8")) as { avvisi: Record<string, unknown>[] };
  const base = rigaDaBandoPvl(leggiAvvisoPvl(campione.avvisi[1]) as BandoPvl, ORA);
  const conSede = (s: GaraDelPiano["atteso"], p: Partial<RigaProcedura> = {}): RigaProcedura => ({ ...base, ...p, sa_comune: s.sa_comune, sa_provincia: s.sa_provincia, sa_regione: s.sa_regione, luogo_regioni: [...s.luogo_regioni] });
  const ricalcolate = GARE.map((g) => {
    const provPrima: ProvenienzaCampi = { _versione: g.provenienza.luogo, luogo: g.provenienza.luogo };
    const prima = conSede(g.prima, { chiave: `${g.provenienza.luogo.f}:sintetica`, ultima_versione_id: g.provenienza.luogo.id });
    const u = unisciVersione(prima, provPrima, conSede(g.giro), versioneDa(g.giro.luogo), "2026-11-24T14:32:30.000Z");
    const ancora = unisciVersione({ ...conSede(g.atteso), chiave: "x" }, { ...u.provenienza, luogo: g.provenienza.luogo, luogo_regioni: g.provenienza.luogo_regioni }, conSede(g.giro), versioneDa(g.giro.luogo), "2026-11-25T08:05:00.000Z");
    return { id: g.id, motore: sedeDi(u.riga as unknown as Record<string, unknown>), piano: sedePiano(g.atteso), stabile: sedeDi(ancora.riga as unknown as Record<string, unknown>) === sedePiano(g.atteso) && ancora.provenienza.luogo?.f === g.provenienza.luogo.f };
  });
  const diverse = ricalcolate.filter((r) => r.motore !== r.piano);
  controlla("piano = motore corretto (unisciVersione) per tutte le 26 gare", diverse.length === 0, diverse.slice(0, 3));
  controlla("un nuovo giro della stessa versione PVL non riporta indietro nessuna gara", ricalcolate.every((r) => r.stabile), ricalcolate.filter((r) => !r.stabile).map((r) => r.id));

  // prova: solo letture
  const dbP = mondo();
  const piani = await pianoRipristino(dbP as unknown as ClientDb, GARE);
  controlla("prova: 26 piani, nessuna scrittura, nessuna già a posto", piani.length === 26 && scritture(dbP).length === 0 && piani.every((p) => !p.giaAPosto), { n: piani.length, scritture: scritture(dbP).length });

  // applica
  const db = mondo();
  const altraPrima = JSON.stringify(gara(db, "altra-gara"));
  const e = await ripristinaEnteLuogo(db as unknown as ClientDb, ORA, GARE);
  controlla("applica: 26 gare riscritte (11 valori, 15 provenienza), 26 tracce", e.cambiate === 26 && e.tracce === 26 && e.giaAPosto === 0, { cambiate: e.cambiate, tracce: e.tracce });
  controlla("applica: ogni gara ha sede e regioni del piano", GARE.every((g) => sedeDi(gara(db, g.id)) === sedePiano(g.atteso)), GARE.filter((g) => sedeDi(gara(db, g.id)) !== sedePiano(g.atteso)).map((g) => g.id));
  controlla("applica: provenienza della sede e delle regioni del piano; gli altri campi della provenienza intatti", GARE.every((g) => {
    const p = gara(db, g.id).provenienza_campi as ProvenienzaCampi;
    return JSON.stringify(p.luogo) === JSON.stringify(g.provenienza.luogo) && JSON.stringify(p.luogo_regioni) === JSON.stringify(g.provenienza.luogo_regioni) && p.oggetto?.id === "000001-2026" && JSON.stringify(p.ente) === JSON.stringify(g.giro.luogo);
  }));
  controlla("applica: aggiornata_il e gli altri campi delle gare non cambiano", GARE.every((g) => gara(db, g.id).aggiornata_il === AGGIORNATA && gara(db, g.id).oggetto === "(gara sintetica)"));
  controlla("applica: una gara fuori dal piano non cambia", JSON.stringify(gara(db, "altra-gara")) === altraPrima);
  const tracce = db.t("radar_aggiornamenti");
  controlla("applica: tracce «correzione_dati» mai notificabili, una per gara, con prima e dopo", tracce.length === 26 && tracce.every((t) => t.tipo === "correzione_dati" && t.notificabile === false && t.campo === "ente_luogo" && t.id_fonte === ID_TRACCIA && t.fonte === "manuale" && typeof t.valore_precedente === "string" && typeof t.valore_nuovo === "string") && new Set(tracce.map((t) => t.procedura_id)).size === 26);
  controlla("applica: solo radar_procedure (26 aggiornamenti) e radar_aggiornamenti (26 tracce)", scritture(db).length === 52 && scritture(db).filter((r) => r.tabella === "radar_procedure" && r.metodo === "update").length === 26 && scritture(db).filter((r) => r.tabella === "radar_aggiornamenti").length === 26);
  const foto = JSON.stringify(db.tabelle);
  const e2 = await ripristinaEnteLuogo(db as unknown as ClientDb, new Date("2026-11-26T08:00:00Z"), GARE);
  controlla("ripetuto: idempotente (0 gare cambiate, 26 già a posto, nessuna traccia nuova, nulla cambia)", e2.cambiate === 0 && e2.giaAPosto === 26 && e2.tracce === 0 && JSON.stringify(db.tabelle) === foto, { cambiate: e2.cambiate, giaAPosto: e2.giaAPosto, tracce: e2.tracce });

  // FERMO: qualunque differenza dallo stato lasciato dal giro, senza scrivere nulla per NESSUNA gara
  const quale = (prefisso: string) => (d: DbFinto) => d.t("radar_procedure").find((r) => String(r.id).startsWith(prefisso))!;
  const casi: [string, (d: DbFinto) => void][] = [
    ["una gara mancante", (d) => { d.tabelle.radar_procedure = d.t("radar_procedure").filter((r) => !String(r.id).startsWith("63e0b112")); }],
    ["un comune diverso da quello del giro", (d) => { quale("a092afc1")(d).sa_comune = "Gorizia"; }],
    ["regioni diverse da quelle del giro", (d) => { quale("d1e67ebf")(d).luogo_regioni = ["lazio", "umbria"]; }],
    ["la sede già passata a un'altra versione PVL", (d) => { (quale("dc2b688a")(d).provenienza_campi as ProvenienzaCampi).luogo = { f: "pvl", id: "altro-avviso", g: "2026-11-25", t: null, ted: null }; }],
    ["la sede tornata a TED ma con valori diversi dal piano", (d) => { Object.assign(quale("f66becb6")(d), { sa_comune: "Verbania", sa_provincia: null }); }],
  ];
  for (const [nome, rompi] of casi) {
    const d = mondo(rompi);
    let fermo = false;
    try {
      await ripristinaEnteLuogo(d as unknown as ClientDb, ORA, GARE);
    } catch (x) {
      fermo = x instanceof FermoCollaudo;
    }
    controlla(`FERMO con ${nome}: nessuna scrittura per nessuna gara`, fermo && scritture(d).length === 0);
  }
  {
    // la gara riscritta tra la lettura e la scrittura (aggiornata_il cambiata): la scrittura condizionata non colpisce nulla → FERMO
    const d = mondo();
    const originale = d.from.bind(d);
    let letture = 0;
    d.from = (nome: string) => {
      if (nome === "radar_procedure" && ++letture === GARE.length + 1) quale("a0c6c4b0")(d).aggiornata_il = "2026-11-25T07:00:00.000+00:00";
      return originale(nome);
    };
    let fermo = false;
    try {
      await ripristinaEnteLuogo(d as unknown as ClientDb, ORA, GARE);
    } catch (x) {
      fermo = x instanceof FermoCollaudo && /cambiate 0 righe/.test(x.message);
    }
    controlla("FERMO se una gara è riscritta tra lettura e scrittura (aggiornata_il diversa): quella gara non cambia", fermo && quale("a0c6c4b0")(d).sa_comune === "Firenze");
  }

  // guardie del lancio vero
  const ambiente = { NEXT_PUBLIC_SUPABASE_URL: "https://ryawdldqiumqsskrnyps.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "sb_secret_finto_per_la_prova", VERCEL_ENV: undefined as string | undefined };
  const porta = { controllaPorta: () => undefined };
  const rifiuta = async (nome: string, f: () => Promise<unknown>) => {
    const n = chiamate.length;
    let errore = false;
    try {
      await f();
    } catch {
      errore = true;
    }
    controlla(`${nome} → rifiutato senza nessuna richiesta`, errore && chiamate.length === n);
  };
  await rifiuta("applica senza autorizzazione registrata", () => lancia("applica", ambiente, null, GARE));
  await rifiuta("applica con la porta che nega", () => lancia("applica", ambiente, { controllaPorta: () => { throw new Error("negata"); } }, GARE));
  await rifiuta("database di produzione", () => lancia("prova", { ...ambiente, NEXT_PUBLIC_SUPABASE_URL: "https://bihfrzspqxsrzlbqqvqa.supabase.co" }, porta, GARE));
  await rifiuta("su Vercel", () => lancia("applica", { ...ambiente, VERCEL_ENV: "production" }, porta, GARE));
  let nomeScript = "";
  await lancia("applica", ambiente, { controllaPorta: ({ script }) => { nomeScript = script; } }, GARE).catch(() => undefined);
  controlla("la porta del registro riceve il nome esatto dello script", nomeScript === "ripristina-ente-luogo-staging.ts", nomeScript);
  const n = chiamate.length;
  let fermato = false;
  try {
    await lancia("prova", ambiente, null, GARE);
  } catch {
    fermato = true;
  }
  controlla("prova: guardie superate, una lettura solo verso lo staging (qui fallisce e si ferma)", fermato && chiamate.slice(n).length === 1 && chiamate.slice(n).every((u) => u.startsWith("https://ryawdldqiumqsskrnyps.supabase.co/rest/v1/radar_procedure?select")), chiamate.slice(n));
}
principale()
  .catch((e) => falliti.push(`eccezione: ${e instanceof Error ? e.stack ?? e.message : String(e)}`))
  .finally(() => {
    console.log(`Verifica del ripristino di ente e luogo (giro PVL del 24/11): ${ok} ok, ${falliti.length} falliti`);
    for (const f of falliti) console.log(`  FALLITO: ${f}`);
    process.exit(falliti.length ? 1 : 0);
  });
