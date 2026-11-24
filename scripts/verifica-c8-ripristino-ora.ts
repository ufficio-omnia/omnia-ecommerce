// Verifica dello script che riporta l'ora della scadenza sui lotti delle 5 gare dello staging (difetto del giro A1 del C8, 23/11/2026): su un
// database IN MEMORIA, senza rete, con dati SINTETICI che riproducono lo stato letto il 23/11. Uso: npx tsx scripts/verifica-c8-ripristino-ora.ts
import { GARE_C8, lancia, pianoRipristino, ripristinaOraLotti } from "./c8/ripristina-ora-lotti-staging";
import { FermoCollaudo } from "./collaudo-z8/collaudo-motore-z8";
import { DbFinto } from "./lib/db-finto-motore";
import type { ClientDb } from "../src/lib/radar/notifiche/motore";

let ok = 0;
const falliti: string[] = [];
function controlla(nome: string, condizione: boolean, dettaglio?: unknown): void {
  if (condizione) ok++;
  else falliti.push(`${nome}${dettaglio === undefined ? "" : ` → ${JSON.stringify(dettaglio).slice(0, 400)}`}`);
}
const chiamate: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => {
  chiamate.push(String(input instanceof URL ? input.href : typeof input === "string" ? input : input.url));
  return new Response(JSON.stringify({ code: "XX000", message: "finto" }), { status: 500, headers: { "content-type": "application/json" } });
}) as typeof fetch;

const ORA = new Date("2026-11-24T08:00:00Z");
const GIORNI = ["2026-12-10", "2026-11-23", "2026-11-27", "2026-12-09", "2026-12-14"];
function mondo(modifica?: (db: DbFinto) => void): DbFinto {
  const db = new DbFinto();
  db.tabelle.radar_procedure = [
    ...GARE_C8.map((id, i) => ({ id, n_lotti: 1, scadenza_giorno: GIORNI[i], scadenza_offerte: `${GIORNI[i]}T11:00:00+00:00`, scadenza_ora_indicata: true, scadenza_fonte: `${GIORNI[i]}+01:00; ore 12:00 italiane (prova sintetica)` })),
    { id: "altra-gara", n_lotti: 1, scadenza_giorno: "2026-12-01", scadenza_offerte: null, scadenza_ora_indicata: false, scadenza_fonte: "2026-12-01 (Sintel indica solo il giorno)" },
  ];
  db.tabelle.radar_lotti = [
    ...GARE_C8.map((id, i) => ({ procedura_id: id, numero_lotto: "LOT-0001", cig: `PRV000000${i}`, scadenza_giorno: GIORNI[i], scadenza_offerte: null, scadenza_ora_indicata: false, scadenza_fonte: `${GIORNI[i]} (Sintel indica solo il giorno)`, aggiornato_il: "2026-11-23T16:53:08.492+00:00" })),
    { procedura_id: "altra-gara", numero_lotto: "LOT-0001", cig: null, scadenza_giorno: "2026-12-01", scadenza_offerte: null, scadenza_ora_indicata: false, scadenza_fonte: "2026-12-01 (Sintel indica solo il giorno)", aggiornato_il: "x" },
  ];
  modifica?.(db);
  return db;
}
const lottoDi = (db: DbFinto, id: string) => db.t("radar_lotti").find((l) => l.procedura_id === id)!;
const scritture = (db: DbFinto) => db.richieste.filter((r) => r.metodo !== "select");

async function principale(): Promise<void> {
  // prova: solo letture
  const dbP = mondo();
  const piani = await pianoRipristino(dbP as unknown as ClientDb);
  controlla("prova: 5 piani, nessuna scrittura, valore di adesso e valore della gara", piani.length === 5 && scritture(dbP).length === 0 && piani.every((p, i) => p.prima.offerte === null && p.dopo.offerte === `${GIORNI[i]}T11:00:00+00:00` && !p.giaAPosto), piani);

  // applica
  const db = mondo();
  const altraPrima = JSON.stringify(lottoDi(db, "altra-gara"));
  const e = await ripristinaOraLotti(db as unknown as ClientDb, ORA);
  controlla("applica: 5 lotti cambiati, ognuno con la scadenza della sua gara (ora, testo), aggiornato_il", e.cambiate === 5 && GARE_C8.every((id, i) => {
    const l = lottoDi(db, id);
    return l.scadenza_offerte === `${GIORNI[i]}T11:00:00+00:00` && l.scadenza_ora_indicata === true && l.scadenza_fonte === `${GIORNI[i]}+01:00; ore 12:00 italiane (prova sintetica)` && l.aggiornato_il === ORA.toISOString() && l.scadenza_giorno === GIORNI[i];
  }), db.t("radar_lotti"));
  controlla("applica: un lotto di un'ALTRA gara (fuori dall'elenco) non cambia", JSON.stringify(lottoDi(db, "altra-gara")) === altraPrima);
  controlla("applica: le gare non cambiano", db.t("radar_procedure").every((g, i) => i >= 5 || g.scadenza_offerte === `${GIORNI[i]}T11:00:00+00:00`));
  controlla("applica: 5 scritture (una per lotto), nessuna su altre tabelle", scritture(db).length === 5 && scritture(db).every((r) => r.tabella === "radar_lotti"));
  const foto = JSON.stringify(db.t("radar_lotti"));
  const e2 = await ripristinaOraLotti(db as unknown as ClientDb, new Date("2026-11-25T08:00:00Z"));
  controlla("ripetuto: idempotente (0 cambiate, 5 già a posto, nulla cambia)", e2.cambiate === 0 && e2.giaAPosto === 5 && JSON.stringify(db.t("radar_lotti")) === foto);

  // FERMO: qualunque differenza dallo stato atteso, senza scrivere nulla per NESSUNA gara
  const casi: [string, (d: DbFinto) => void][] = [
    ["una gara con due lotti", (d) => { d.t("radar_procedure")[2].n_lotti = 2; }],
    ["un lotto di un altro giorno", (d) => { d.t("radar_lotti")[3].scadenza_giorno = "2026-12-20"; }],
    ["un lotto con un testo inatteso", (d) => { d.t("radar_lotti")[1].scadenza_fonte = "scritto a mano"; }],
    ["una gara senza l'ora", (d) => { Object.assign(d.t("radar_procedure")[4], { scadenza_offerte: null, scadenza_ora_indicata: false }); }],
    ["una gara mancante", (d) => { d.tabelle.radar_procedure = d.t("radar_procedure").slice(1); }],
    ["un lotto con un numero diverso", (d) => { d.t("radar_lotti")[0].numero_lotto = "LOT-0002"; }],
  ];
  for (const [nome, rompi] of casi) {
    const d = mondo(rompi);
    let fermo = false;
    try {
      await ripristinaOraLotti(d as unknown as ClientDb, ORA);
    } catch (x) {
      fermo = x instanceof FermoCollaudo;
    }
    controlla(`FERMO con ${nome}: nessuna scrittura per nessuna gara`, fermo && scritture(d).length === 0);
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
  await rifiuta("applica senza autorizzazione registrata", () => lancia("applica", ambiente, null));
  await rifiuta("applica con la porta che nega", () => lancia("applica", ambiente, { controllaPorta: () => { throw new Error("negata"); } }));
  await rifiuta("database di produzione", () => lancia("prova", { ...ambiente, NEXT_PUBLIC_SUPABASE_URL: "https://bihfrzspqxsrzlbqqvqa.supabase.co" }, porta));
  await rifiuta("su Vercel", () => lancia("applica", { ...ambiente, VERCEL_ENV: "production" }, porta));
  const n = chiamate.length;
  let fermato = false;
  try {
    await lancia("prova", ambiente, null);
  } catch {
    fermato = true;
  }
  controlla("prova: guardie superate, una lettura solo verso lo staging (qui fallisce e si ferma)", fermato && chiamate.slice(n).length === 1 && chiamate.slice(n).every((u) => u.startsWith("https://ryawdldqiumqsskrnyps.supabase.co/rest/v1/radar_procedure?select")), chiamate.slice(n));
}
principale()
  .catch((e) => falliti.push(`eccezione: ${e instanceof Error ? e.stack ?? e.message : String(e)}`))
  .finally(() => {
    console.log(`Verifica del ripristino dell'ora sui lotti (C8): ${ok} ok, ${falliti.length} falliti`);
    for (const f of falliti) console.log(`  FALLITO: ${f}`);
    process.exit(falliti.length ? 1 : 0);
  });
