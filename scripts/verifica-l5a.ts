// Verifica della L5a (documento 47, B2, 23/11/2026): lo script che nasconde la PVL sullo staging, su un database IN MEMORIA, senza rete.
// Uso: npx tsx scripts/verifica-l5a.ts → codice 0 se tutto passa.
import fs from "fs";
import path from "path";
import { applica, nascondiPvl } from "./l5a/pvl-nascosta-staging";
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

const ORA = new Date("2026-11-23T12:00:00Z");
function mondo(righe = [
  { fonte: "pvl", attiva: true, nascosta_ai_clienti: false, cursore: { giorno: "2026-11-17" }, aggiornata_il: "2026-11-17T13:00:00Z" },
  { fonte: "sardegnacat", attiva: false, nascosta_ai_clienti: true, cursore: null, aggiornata_il: "2026-11-17T14:00:00Z" },
  { fonte: "sintel", attiva: false, nascosta_ai_clienti: false, cursore: null, aggiornata_il: "2026-11-17T14:00:00Z" },
  { fonte: "ted", attiva: true, nascosta_ai_clienti: false, cursore: { giorno: "2026-11-17" }, aggiornata_il: "2026-11-17T13:00:00Z" },
]) {
  const db = new DbFinto();
  db.tabelle.radar_fonti_stato = righe.map((r) => ({ ...r }));
  return db;
}
const copia = (db: DbFinto) => JSON.stringify(db.t("radar_fonti_stato").filter((r) => r.fonte !== "pvl"));

async function principale(): Promise<void> {
  const db = mondo();
  const altre = copia(db);
  const e = await nascondiPvl(db as unknown as ClientDb, ORA);
  const pvl = db.t("radar_fonti_stato").find((r) => r.fonte === "pvl")!;
  controlla("L5a: la PVL da visibile a nascosta, UNA riga cambiata", e.cambiate === 1 && e.prima === false && e.dopo === true && pvl.nascosta_ai_clienti === true);
  controlla("L5a: della riga pvl cambiano SOLO nascosta_ai_clienti e aggiornata_il (cursore, attiva intatti)", pvl.attiva === true && JSON.stringify(pvl.cursore) === JSON.stringify({ giorno: "2026-11-17" }) && pvl.aggiornata_il === ORA.toISOString());
  controlla("L5a: le altre fonti IDENTICHE (SardegnaCAT resta nascosta, TED e Sintel visibili)", copia(db) === altre);
  controlla("L5a: 3 richieste (lettura, scrittura condizionata, rilettura)", db.conta() === 3, db.conta());
  const prima2 = JSON.stringify(db.t("radar_fonti_stato"));
  const e2 = await nascondiPvl(db as unknown as ClientDb, new Date("2026-11-24T12:00:00Z"));
  controlla("L5a: ripetuta, non cambia NULLA (idempotente: già nascosta, nemmeno aggiornata_il)", e2.cambiate === 0 && e2.prima === true && JSON.stringify(db.t("radar_fonti_stato")) === prima2);
  let fermo = false;
  try {
    await nascondiPvl(mondo([{ fonte: "ted", attiva: true, nascosta_ai_clienti: false, cursore: null, aggiornata_il: "x" }]) as unknown as ClientDb, ORA);
  } catch {
    fermo = true;
  }
  controlla("L5a: senza la riga «pvl» si ferma e non scrive", fermo);
  // guardie del lancio: nessuna richiesta prima dei controlli
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
    controlla(`L5a: ${nome} → rifiutato senza nessuna richiesta`, errore && chiamate.length === n);
  };
  await rifiuta("senza autorizzazione registrata", () => applica(ambiente, { controllaPorta: () => { throw new Error("negata"); } }));
  await rifiuta("database di produzione", () => applica({ ...ambiente, NEXT_PUBLIC_SUPABASE_URL: "https://bihfrzspqxsrzlbqqvqa.supabase.co" }, porta));
  await rifiuta("su Vercel", () => applica({ ...ambiente, VERCEL_ENV: "preview" }, porta));
  const n = chiamate.length;
  let fermato = false;
  try {
    await applica(ambiente, porta);
  } catch {
    fermato = true;
  }
  controlla("L5a: guardie superate, un errore della prima lettura ferma tutto (nessuna scrittura), solo verso lo staging", fermato && chiamate.slice(n).length === 1 && chiamate.slice(n).every((u) => u.startsWith("https://ryawdldqiumqsskrnyps.supabase.co/rest/v1/radar_fonti_stato?select=")));
  const testo = fs.readFileSync(path.join(__dirname, "l5a", "pvl-nascosta-staging.ts"), "utf8");
  controlla("testo: la scrittura è condizionata a fonte = pvl E nascosta_ai_clienti = false, e mette solo true", /\.update\(\{ nascosta_ai_clienti: true, aggiornata_il: adesso\.toISOString\(\) \}\)\s*\.eq\("fonte", "pvl"\)\s*\.eq\("nascosta_ai_clienti", false\)/.test(testo));
  controlla("testo: l'autorizzazione si controlla prima dell'osservatore e del client", testo.indexOf("controllaPorta({ script") < testo.indexOf("installaOsservatore(url") && testo.indexOf("installaOsservatore(url") < testo.indexOf("createClient(url"));
}

principale()
  .catch((e) => falliti.push(`eccezione: ${e instanceof Error ? e.message : String(e)}`))
  .finally(() => {
    console.log(`Verifica L5a (PVL nascosta sullo staging): ${ok} ok, ${falliti.length} falliti`);
    for (const f of falliti) console.log(`  FALLITO: ${f}`);
    process.exit(falliti.length ? 1 : 0);
  });
